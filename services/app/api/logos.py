"""Series and radio show logos (UX-43).

A series logo is global: admins add, change or remove it, and everyone sees the same one. A radio
show is owned by the person who added it, so its owner changes its logo. Either way the file is kept
in the config folder (series-logos) and served by id, with an ETag.

Uploads are the raw file in the request body (PNG, WebP or SVG, up to 1 MB); the type is read from
the content. "From a cover" is an upload too: the browser cuts the logo out of a cover and sends a
PNG. Wikimedia Commons is searched and copied through the server, which only talks to
commons.wikimedia.org and upload.wikimedia.org.
"""

from datetime import UTC, datetime
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field

from app.api.dependencies import Admin, CurrentUser, Database, Member
from app.db.models import AuditEvent, RadioShow, SeriesLogo
from app.domain import logos, radio
from app.domain.operations import transaction_lock
from app.domain.radio_images import ImageError

router = APIRouter(tags=["logos"])

Colour = Literal["text", "accent"]
Source = Literal["upload", "cover", "commons"]
UPLOAD = {
    "requestBody": {
        "required": True,
        "description": "The logo file itself: PNG, WebP or SVG, up to 1 MB.",
        "content": {
            kind: {"schema": {"type": "string", "format": "binary"}}
            for kind in ("image/png", "image/webp", "image/svg+xml")
        },
    }
}
IMAGE = {200: {"content": {kind: {} for kind in logos.KINDS.values()}}, 304: {}, 404: {}}


class LogoView(BaseModel):
    url: str
    format: Literal["png", "webp", "svg"]
    colour: Colour
    source: Source
    source_title: str | None = None
    licence: str | None = None
    source_url: str | None = None
    # Where the copy is kept, relative to Storyarr's config folder.
    saved_path: str
    updated_at: datetime | None = None


class ColourBody(BaseModel):
    colour: Colour


class CommonsChoice(BaseModel):
    title: str = Field(min_length=1, max_length=250)
    colour: Colour = "text"


class CommonsResult(BaseModel):
    title: str
    thumbnail_url: str | None
    width: int
    height: int
    format: Literal["png", "webp", "svg"]
    licence: str | None
    source_page: str
    description: str
    probable_wrong_match: bool


class CommonsResults(BaseModel):
    items: list[CommonsResult]


def _view(url: str, file: str, colour, source, title, licence, source_url, updated) -> LogoView:
    return LogoView(
        url=f"{url}?v={logos.version(file, updated)}",
        format=file.rsplit(".", 1)[1],
        colour=colour or "text",
        source=source or "upload",
        source_title=title,
        licence=licence,
        source_url=source_url,
        saved_path=logos.shown_path(file),
        updated_at=updated,
    )


def series_url(external_id: str) -> str:
    return f"/api/catalog/series/hardcover/{external_id}/logo"


def series_view(row: SeriesLogo | None) -> LogoView | None:
    if not row:
        return None
    return _view(
        series_url(row.external_id),
        row.file,
        row.colour,
        row.source,
        row.source_title,
        row.licence,
        row.source_url,
        row.updated_at,
    )


def show_view(show: RadioShow) -> LogoView | None:
    if not show.logo_path:
        return None
    return _view(
        f"/api/radio/shows/{show.id}/logo",
        show.logo_path,
        show.logo_colour,
        show.logo_source,
        show.logo_title,
        show.logo_licence,
        show.logo_source_url,
        show.logo_updated_at,
    )


async def series_logo(db, external_id: str) -> SeriesLogo | None:
    return await db.get(SeriesLogo, ("hardcover", external_id))


def _series_key(external_id: str) -> str:
    try:
        return logos.key("hardcover", external_id)
    except ImageError:
        raise HTTPException(422, "Invalid series identifier") from None


async def _body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > logos.MAX_BYTES:
        raise HTTPException(413, "The logo is larger than 1 MB")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > logos.MAX_BYTES:
            raise HTTPException(413, "The logo is larger than 1 MB")
    return bytes(data)


def _checked(data: bytes) -> tuple[str, bytes]:
    try:
        return logos.check(data)
    except ImageError as error:
        raise HTTPException(422, str(error)) from None


def _image(file: str | None, if_none_match: str | None, missing: str) -> Response:
    answer = logos.response(file, if_none_match)
    if not answer:
        raise HTTPException(404, missing)
    return answer


async def _commons_copy(title: str) -> logos.CommonsCopy:
    try:
        return await logos.commons_copy(title)
    except ImageError as error:
        raise HTTPException(502, str(error)) from None


def _audit(db, user, action: str, **detail) -> None:
    db.add(AuditEvent(actor_id=user.id, action=action, detail=detail))


# Series --------------------------------------------------------------------------------------


@router.get(
    "/catalog/series/hardcover/{external_id}/logo", response_class=Response, responses=IMAGE
)
async def get_series_logo(
    external_id: str,
    user: CurrentUser,
    db: Database,
    if_none_match: str | None = Header(default=None),
):
    """The saved series logo. SVG files are served cleaned, with a sandbox policy."""
    _series_key(external_id)
    row = await series_logo(db, external_id)
    return _image(row.file if row else None, if_none_match, "No logo saved for this series")


async def _save_series(db, user, external_id: str, found: str, data: bytes, **fields) -> LogoView:
    name = _series_key(external_id)
    await transaction_lock(db, f"series-logo:hardcover:{external_id}")
    row = await db.get(SeriesLogo, ("hardcover", external_id), with_for_update=True)
    file = logos.save(name, found, data)
    if not row:
        row = SeriesLogo(provider="hardcover", external_id=external_id)
        db.add(row)
    row.file = file
    row.source = fields["source"]
    row.colour = fields["colour"]
    row.source_title = fields.get("source_title")
    row.licence = fields.get("licence")
    row.source_url = fields.get("source_url")
    row.updated_by = user.id
    row.updated_at = datetime.now(UTC)
    _audit(db, user, "series.logo.saved", external_id=external_id, source=row.source, file=file)
    await db.commit()
    return series_view(row)


@router.put(
    "/catalog/series/hardcover/{external_id}/logo", response_model=LogoView, openapi_extra=UPLOAD
)
async def upload_series_logo(
    external_id: str,
    request: Request,
    user: Admin,
    db: Database,
    source: Literal["upload", "cover"] = Query(default="upload"),
    title: str | None = Query(default=None, max_length=300),
    colour: Annotated[Colour, Query()] = "text",
):
    """Save a logo for everyone: an uploaded file, or a cut-out of one of the series' covers."""
    _series_key(external_id)
    found, data = _checked(await _body(request))
    return await _save_series(
        db, user, external_id, found, data, source=source, colour=colour, source_title=title
    )


@router.post("/catalog/series/hardcover/{external_id}/logo/commons", response_model=LogoView)
async def copy_series_logo(external_id: str, body: CommonsChoice, user: Admin, db: Database):
    """Download a Wikimedia Commons file once and save it, with its licence and source page."""
    _series_key(external_id)
    copy = await _commons_copy(body.title)
    return await _save_series(
        db,
        user,
        external_id,
        copy.found,
        copy.data,
        source="commons",
        colour=body.colour,
        source_title=copy.title,
        licence=copy.licence,
        source_url=copy.source_page or None,
    )


@router.patch("/catalog/series/hardcover/{external_id}/logo", response_model=LogoView)
async def colour_series_logo(external_id: str, body: ColourBody, user: Admin, db: Database):
    """Draw the logo in the text colour or the accent colour."""
    _series_key(external_id)
    row = await db.get(SeriesLogo, ("hardcover", external_id), with_for_update=True)
    if not row:
        raise HTTPException(404, "No logo saved for this series")
    row.colour = body.colour
    row.updated_by = user.id
    await db.commit()
    return series_view(row)


@router.delete("/catalog/series/hardcover/{external_id}/logo", status_code=204)
async def remove_series_logo(external_id: str, user: Admin, db: Database):
    """Remove the logo; the series name is shown as a wordmark again."""
    _series_key(external_id)
    row = await db.get(SeriesLogo, ("hardcover", external_id), with_for_update=True)
    if row:
        file = row.file
        await db.delete(row)
        _audit(db, user, "series.logo.removed", external_id=external_id, file=file)
        await db.commit()
        logos.remove(file)
    return Response(status_code=204)


# Radio shows ---------------------------------------------------------------------------------


@router.get("/radio/shows/{show_id}/logo", response_class=Response, responses=IMAGE)
async def get_show_logo(
    show_id: UUID,
    user: CurrentUser,
    db: Database,
    if_none_match: str | None = Header(default=None),
):
    """The saved show logo."""
    show = await radio.owned_show(db, user, show_id)
    return _image(show.logo_path, if_none_match, "No logo saved for this show")


async def _save_show(db, user, show_id: UUID, found: str, data: bytes, **fields) -> LogoView:
    show = await radio.owned_show(db, user, show_id, lock=True)
    show.logo_path = logos.save(logos.key("radio", str(show.id)), found, data)
    show.logo_source = fields["source"]
    show.logo_colour = fields["colour"]
    show.logo_title = fields.get("source_title")
    show.logo_licence = fields.get("licence")
    show.logo_source_url = fields.get("source_url")
    show.logo_updated_at = datetime.now(UTC)
    _audit(db, user, "radio.show.logo.saved", show_id=str(show.id), source=show.logo_source)
    await db.commit()
    return show_view(show)


@router.put("/radio/shows/{show_id}/logo", response_model=LogoView, openapi_extra=UPLOAD)
async def upload_show_logo(
    show_id: UUID,
    request: Request,
    user: Member,
    db: Database,
    source: Literal["upload", "cover"] = Query(default="upload"),
    title: str | None = Query(default=None, max_length=300),
    colour: Annotated[Colour, Query()] = "text",
):
    """Save a logo for your show: an uploaded file, or a cut-out of the show's artwork."""
    await radio.owned_show(db, user, show_id)
    found, data = _checked(await _body(request))
    return await _save_show(
        db, user, show_id, found, data, source=source, colour=colour, source_title=title
    )


@router.post("/radio/shows/{show_id}/logo/commons", response_model=LogoView)
async def copy_show_logo(show_id: UUID, body: CommonsChoice, user: Member, db: Database):
    """Download a Wikimedia Commons file once and save it as the show's logo."""
    await radio.owned_show(db, user, show_id)
    copy = await _commons_copy(body.title)
    return await _save_show(
        db,
        user,
        show_id,
        copy.found,
        copy.data,
        source="commons",
        colour=body.colour,
        source_title=copy.title,
        licence=copy.licence,
        source_url=copy.source_page or None,
    )


@router.patch("/radio/shows/{show_id}/logo", response_model=LogoView)
async def colour_show_logo(show_id: UUID, body: ColourBody, user: Member, db: Database):
    """Draw the show's logo in the text colour or the accent colour."""
    show = await radio.owned_show(db, user, show_id, lock=True)
    if not show.logo_path:
        raise HTTPException(404, "No logo saved for this show")
    show.logo_colour = body.colour
    await db.commit()
    return show_view(show)


@router.delete("/radio/shows/{show_id}/logo", status_code=204)
async def remove_show_logo(show_id: UUID, user: Member, db: Database):
    """Remove the show's logo; its name is shown as a wordmark again."""
    show = await radio.owned_show(db, user, show_id, lock=True)
    file = show.logo_path
    if file:
        show.logo_path = show.logo_source = show.logo_colour = None
        show.logo_title = show.logo_licence = show.logo_source_url = None
        show.logo_updated_at = datetime.now(UTC)
        _audit(db, user, "radio.show.logo.removed", show_id=str(show.id))
        await db.commit()
        logos.remove(file)
    return Response(status_code=204)


# Wikimedia Commons ---------------------------------------------------------------------------


@router.get("/logos/commons", response_model=CommonsResults)
async def search_commons(
    user: Member,
    q: str = Query(min_length=1, max_length=200),
    name: str = Query(default="", max_length=300),
    people: Annotated[list[str] | None, Query(max_length=10)] = None,
):
    """Search Wikimedia Commons for logo files. A file that mentions neither the series (or show)
    name nor a person's surname is flagged as a probable wrong match."""
    try:
        found = await logos.commons_search(q, logos.match_words(name or q, people or []))
    except ImageError as error:
        raise HTTPException(502, str(error)) from None
    return CommonsResults(items=[CommonsResult(**vars(item)) for item in found])

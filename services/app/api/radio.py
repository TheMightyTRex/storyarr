"""Radio shows (FEAT-R): stations, shows, series and episodes from the BBC.

Shows are owned by the person who added them; stations are shared. Adding a show is two steps:
a preview that saves nothing, then a save with a follow choice. Images are served by id from
the copies Storyarr keeps in its config folder.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select

from app.adapters.bbc_programmes import SERVICE_ID, SearchResult, ShowData
from app.adapters.contracts import AdapterError
from app.api.dependencies import CurrentUser, Database, Member
from app.api.metadata import adapter_http_error
from app.api.operations import OperationView
from app.db.models import (
    AuditEvent,
    Operation,
    RadioEpisode,
    RadioSeries,
    RadioShow,
    RadioStation,
)
from app.domain import radio, radio_images
from app.domain.follow_status import StatusKind

router = APIRouter(prefix="/radio", tags=["radio"])

Follow = Literal["all", "from_now_on", "none"]
STATUS_LABELS = {
    "in_library": "In library",
    "downloading": "Downloading",
    "importing": "Importing",
    "searching": "Searching",
    "waiting": "Waiting",
    "not_released": "Not released",
    "attention": "Needs attention",
    "wanted": "Wanted",
    "excluded": "Excluded",
    "not_requested": "Not requested",
}


class RadioStationRef(BaseModel):
    id: str
    name: str
    logo_url: str | None = None


class RadioStationView(RadioStationRef):
    show_count: int


class RadioStationList(BaseModel):
    items: list[RadioStationView]


class RadioPreviewSeries(BaseModel):
    pid: str
    kind: Literal["series", "specials"]
    number: int
    title: str
    expected_episodes: int | None
    first_broadcast: datetime | None


class RadioShowPreview(BaseModel):
    pid: str
    title: str
    synopsis: str | None
    first_broadcast: datetime | None
    station: RadioStationRef | None
    image_pid: str | None
    series_count: int
    episode_count: int | None
    series: list[RadioPreviewSeries]
    # Set when this show is already in the person's radio shows.
    existing_show_id: UUID | None = None


class RadioSearchItem(BaseModel):
    pid: str
    title: str
    synopsis: str | None
    station_id: str | None
    station_name: str | None
    image_pid: str | None


class RadioSearchView(BaseModel):
    source: Literal["bbc_sounds"] = "bbc_sounds"
    items: list[RadioSearchItem]


class RadioShowInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # A BBC programmes or BBC Sounds link, or a programme id.
    link: str = Field(min_length=8, max_length=500)
    follow: Follow = "from_now_on"


class RadioShowEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    follow: Follow


class RadioEpisodeStatus(BaseModel):
    kind: StatusKind
    label: str
    detail: str | None = None


class RadioEpisodeView(BaseModel):
    id: UUID
    pid: str
    number: int
    number_source: Literal["bbc", "broadcast_order"]
    title: str
    synopsis: str | None
    first_broadcast: datetime | None
    duration_seconds: int | None
    status: RadioEpisodeStatus


class RadioSeriesView(BaseModel):
    id: UUID
    pid: str
    kind: Literal["series", "specials"]
    number: int
    number_source: Literal["bbc", "broadcast_order"]
    title: str
    synopsis: str | None
    station: RadioStationRef | None
    expected_episodes: int | None
    first_broadcast: datetime | None
    episode_count: int
    episodes: list[RadioEpisodeView]


class RadioShowSummary(BaseModel):
    id: UUID
    provider: Literal["bbc"]
    external_id: str
    title: str
    synopsis: str | None
    first_broadcast: datetime | None
    station: RadioStationRef | None
    # Every station the show's series were on, the show's own station first.
    stations: list[RadioStationRef]
    follow: Follow
    followed_at: datetime | None
    artwork_url: str | None
    logo_colour: str | None
    logo_source: str | None
    series_count: int
    episode_count: int
    refreshed_at: datetime | None
    refresh: OperationView | None


class RadioShowList(BaseModel):
    items: list[RadioShowSummary]
    total: int


class RadioShowDetail(RadioShowSummary):
    series: list[RadioSeriesView]


class RadioEpisodeShow(BaseModel):
    id: UUID
    title: str
    artwork_url: str | None


class RadioEpisodeSeries(BaseModel):
    id: UUID
    kind: Literal["series", "specials"]
    number: int
    title: str
    station: RadioStationRef | None


class RadioEpisodeDetail(RadioEpisodeView):
    show: RadioEpisodeShow
    series: RadioEpisodeSeries


def station_ref(station: RadioStation | None) -> RadioStationRef | None:
    if not station:
        return None
    return RadioStationRef(
        id=station.id,
        name=station.name,
        logo_url=f"/api/radio/stations/{station.id}/logo" if station.logo_path else None,
    )


def artwork_url(show: RadioShow) -> str | None:
    return f"/api/radio/shows/{show.id}/artwork" if show.artwork_path else None


def status_view(episode: RadioEpisode) -> RadioEpisodeStatus:
    detail = None
    if episode.status == "not_released" and episode.first_broadcast:
        day = episode.first_broadcast.date()
        detail = f"First broadcast {day.day} {day:%B %Y}"
    elif episode.status == "wanted":
        detail = "Broadcast while you follow this show"
    return RadioEpisodeStatus(
        kind=episode.status, label=STATUS_LABELS.get(episode.status, "Unknown"), detail=detail
    )


def episode_view(episode: RadioEpisode) -> RadioEpisodeView:
    return RadioEpisodeView(
        id=episode.id,
        pid=episode.pid,
        number=episode.number,
        number_source=episode.number_source,
        title=episode.title,
        synopsis=episode.synopsis,
        first_broadcast=episode.first_broadcast,
        duration_seconds=episode.duration_seconds,
        status=status_view(episode),
    )


async def stations_by_id(db, ids) -> dict[str, RadioStation]:
    ids = {value for value in ids if value}
    if not ids:
        return {}
    return {
        row.id: row
        for row in await db.scalars(select(RadioStation).where(RadioStation.id.in_(ids)))
    }


async def summaries(db, shows: list[RadioShow]) -> list[RadioShowSummary]:
    if not shows:
        return []
    ids = [show.id for show in shows]
    series_counts = dict(
        (
            await db.execute(
                select(RadioSeries.show_id, func.count())
                .where(RadioSeries.show_id.in_(ids), RadioSeries.kind == "series")
                .group_by(RadioSeries.show_id)
            )
        ).all()
    )
    episode_counts = dict(
        (
            await db.execute(
                select(RadioEpisode.show_id, func.count())
                .where(RadioEpisode.show_id.in_(ids))
                .group_by(RadioEpisode.show_id)
            )
        ).all()
    )
    series_stations: dict[UUID, list[str]] = {}
    for show_id, station_id in (
        await db.execute(
            select(RadioSeries.show_id, RadioSeries.station_id)
            .where(RadioSeries.show_id.in_(ids), RadioSeries.station_id.is_not(None))
            .group_by(RadioSeries.show_id, RadioSeries.station_id)
            .order_by(RadioSeries.show_id, func.min(RadioSeries.number))
        )
    ).all():
        series_stations.setdefault(show_id, []).append(station_id)
    stations = await stations_by_id(
        db,
        {show.station_id for show in shows}
        | {value for values in series_stations.values() for value in values},
    )
    operations = {
        row.id: row
        for row in await db.scalars(
            select(Operation).where(
                Operation.id.in_([show.operation_id for show in shows if show.operation_id])
            )
        )
    }
    result = []
    for show in shows:
        order = list(dict.fromkeys([show.station_id, *series_stations.get(show.id, [])]))
        operation = operations.get(show.operation_id)
        result.append(
            RadioShowSummary(
                id=show.id,
                provider="bbc",
                external_id=show.external_id,
                title=show.title,
                synopsis=show.synopsis,
                first_broadcast=show.first_broadcast,
                station=station_ref(stations.get(show.station_id)),
                stations=[station_ref(stations[value]) for value in order if value in stations],
                follow=show.follow,
                followed_at=show.followed_at,
                artwork_url=artwork_url(show),
                logo_colour=show.logo_colour,
                logo_source=show.logo_source,
                series_count=series_counts.get(show.id, 0),
                episode_count=episode_counts.get(show.id, 0),
                refreshed_at=show.refreshed_at,
                refresh=OperationView.model_validate(operation) if operation else None,
            )
        )
    return result


async def detail_view(db, show: RadioShow) -> RadioShowDetail:
    (summary,) = await summaries(db, [show])
    series = list(
        await db.scalars(
            select(RadioSeries)
            .where(RadioSeries.show_id == show.id)
            .order_by(
                (RadioSeries.kind == "specials").asc(),
                RadioSeries.number,
                RadioSeries.first_broadcast,
            )
        )
    )
    episodes: dict[UUID, list[RadioEpisode]] = {}
    for episode in await db.scalars(
        select(RadioEpisode)
        .where(RadioEpisode.show_id == show.id)
        .order_by(RadioEpisode.number, RadioEpisode.first_broadcast)
    ):
        episodes.setdefault(episode.series_id, []).append(episode)
    stations = await stations_by_id(db, {row.station_id for row in series})
    return RadioShowDetail(
        **summary.model_dump(),
        series=[
            RadioSeriesView(
                id=row.id,
                pid=row.pid,
                kind=row.kind,
                number=row.number,
                number_source=row.number_source,
                title=row.title,
                synopsis=row.synopsis,
                station=station_ref(stations.get(row.station_id)),
                expected_episodes=row.expected_episodes,
                first_broadcast=row.first_broadcast,
                episode_count=len(episodes.get(row.id, [])),
                episodes=[episode_view(episode) for episode in episodes.get(row.id, [])],
            )
            for row in series
        ],
    )


def preview_view(data: ShowData, existing: UUID | None) -> RadioShowPreview:
    station = RadioStationRef(id=data.station[0], name=data.station[1]) if data.station else None
    return RadioShowPreview(
        pid=data.pid,
        title=data.title,
        synopsis=data.synopsis,
        first_broadcast=data.first_broadcast,
        station=station,
        image_pid=data.image_pid,
        series_count=sum(1 for item in data.series if item.kind == "series"),
        episode_count=data.episode_count,
        series=[
            RadioPreviewSeries(
                pid=item.pid,
                kind=item.kind,
                number=item.number,
                title=item.title,
                expected_episodes=item.expected_episodes,
                first_broadcast=item.first_broadcast,
            )
            for item in data.series
        ],
        existing_show_id=existing,
    )


async def _read_bbc(db, call):
    # No request transaction is held while the BBC answers.
    await db.rollback()
    try:
        return await call()
    except AdapterError as error:
        raise adapter_http_error(error) from None


@router.get("/search", response_model=RadioSearchView)
async def search(user: Member, db: Database, q: str = Query(min_length=2, max_length=100)):
    """Find shows by name through BBC Sounds search."""
    results: list[SearchResult] = await _read_bbc(db, lambda: radio.search(q.strip()))
    return RadioSearchView(items=[RadioSearchItem(**vars(item)) for item in results[:25]])


@router.get("/preview", response_model=RadioShowPreview)
async def preview(user: Member, db: Database, link: str = Query(min_length=8, max_length=500)):
    """What a BBC link points to, without saving anything."""
    user_id = user.id
    radio.link_pid(link)
    data = await _read_bbc(db, lambda: radio.preview(link))
    existing = await db.scalar(
        select(RadioShow.id).where(
            RadioShow.owner_id == user_id,
            RadioShow.provider == "bbc",
            RadioShow.external_id == data.pid,
        )
    )
    return preview_view(data, existing)


@router.post("/shows", response_model=RadioShowSummary, status_code=201)
async def add_show(body: RadioShowInput, user: Member, db: Database):
    """Save a show with a follow choice; a background refresh then reads every series."""
    user_id = user.id
    radio.link_pid(body.link)
    data = await _read_bbc(db, lambda: radio.preview(body.link))
    show, _ = await radio.add(db, user_id, data, body.follow)
    db.add(
        AuditEvent(
            actor_id=user_id,
            action="radio.show.added",
            detail={"show_id": str(show.id), "pid": show.external_id, "follow": show.follow},
        )
    )
    await db.commit()
    (summary,) = await summaries(db, [show])
    return summary


@router.get("/shows", response_model=RadioShowList)
async def list_shows(
    user: CurrentUser,
    db: Database,
    station: str | None = Query(default=None, max_length=60),
    followed: bool | None = None,
):
    query = select(RadioShow).where(RadioShow.owner_id == user.id)
    if station:
        if not SERVICE_ID.fullmatch(station):
            raise HTTPException(422, "Unknown station id")
        on_station = select(RadioSeries.show_id).where(RadioSeries.station_id == station)
        query = query.where(or_(RadioShow.station_id == station, RadioShow.id.in_(on_station)))
    if followed is True:
        query = query.where(RadioShow.follow != "none")
    elif followed is False:
        query = query.where(RadioShow.follow == "none")
    shows = list(await db.scalars(query.order_by(func.lower(RadioShow.title), RadioShow.id)))
    return RadioShowList(items=await summaries(db, shows), total=len(shows))


@router.get("/stations", response_model=RadioStationList)
async def list_stations(user: CurrentUser, db: Database):
    """Stations of the person's shows, with how many shows each has (any series counts)."""
    owned = select(RadioShow.id).where(RadioShow.owner_id == user.id)
    pairs = (
        select(RadioShow.id.label("show_id"), RadioShow.station_id)
        .where(RadioShow.owner_id == user.id)
        .union(
            select(RadioSeries.show_id, RadioSeries.station_id).where(
                RadioSeries.show_id.in_(owned)
            )
        )
        .subquery()
    )
    rows = (
        await db.execute(
            select(RadioStation, func.count(func.distinct(pairs.c.show_id)))
            .join(pairs, pairs.c.station_id == RadioStation.id)
            .group_by(RadioStation.id)
            .order_by(RadioStation.name)
        )
    ).all()
    return RadioStationList(
        items=[
            RadioStationView(**station_ref(station).model_dump(), show_count=count)
            for station, count in rows
        ]
    )


@router.get("/shows/{show_id}", response_model=RadioShowDetail)
async def show_detail(show_id: UUID, user: CurrentUser, db: Database):
    return await detail_view(db, await radio.owned_show(db, user, show_id))


@router.patch("/shows/{show_id}", response_model=RadioShowSummary)
async def edit_show(show_id: UUID, body: RadioShowEdit, user: Member, db: Database):
    """Change the follow choice; episode statuses follow it."""
    show = await radio.owned_show(db, user, show_id, lock=True)
    await radio.set_follow(db, show, body.follow)
    await db.commit()
    (summary,) = await summaries(db, [show])
    return summary


@router.post("/shows/{show_id}/refresh", response_model=OperationView, status_code=202)
async def refresh_show(show_id: UUID, user: Member, db: Database):
    """Read the show from the BBC again, and fetch its images again."""
    show = await radio.owned_show(db, user, show_id, lock=True)
    operation = await radio.start_refresh(db, user.id, show)
    await db.commit()
    await db.refresh(operation)
    return operation


@router.delete("/shows/{show_id}", status_code=204)
async def remove_show(show_id: UUID, user: Member, db: Database):
    """Remove the show with its series and episodes. Saved images stay (other people may share
    them); stations stay."""
    show = await radio.owned_show(db, user, show_id, lock=True)
    db.add(
        AuditEvent(
            actor_id=user.id,
            action="radio.show.removed",
            detail={"show_id": str(show.id), "pid": show.external_id},
        )
    )
    if show.operation_id:
        operation = await db.get(Operation, show.operation_id)
        if operation and operation.status in radio.ACTIVE:
            operation.status, operation.message = "cancelled", "The show was removed"
    await db.delete(show)
    await db.commit()
    return Response(status_code=204)


@router.get("/episodes/{episode_id}", response_model=RadioEpisodeDetail)
async def episode_detail(episode_id: UUID, user: CurrentUser, db: Database):
    row = (
        await db.execute(
            select(RadioEpisode, RadioSeries, RadioShow)
            .join(RadioSeries, RadioSeries.id == RadioEpisode.series_id)
            .join(RadioShow, RadioShow.id == RadioEpisode.show_id)
            .where(RadioEpisode.id == episode_id, RadioShow.owner_id == user.id)
        )
    ).first()
    if not row:
        raise HTTPException(404, "Episode not found")
    episode, series, show = row
    station = await db.get(RadioStation, series.station_id) if series.station_id else None
    return RadioEpisodeDetail(
        **episode_view(episode).model_dump(),
        show=RadioEpisodeShow(id=show.id, title=show.title, artwork_url=artwork_url(show)),
        series=RadioEpisodeSeries(
            id=series.id,
            kind=series.kind,
            number=series.number,
            title=series.title,
            station=station_ref(station),
        ),
    )


def _image(data: bytes, kind: str, if_none_match: str | None, extra=None) -> Response:
    tag = radio_images.etag(data)
    headers = {"Cache-Control": "private, max-age=86400", "ETag": tag, **(extra or {})}
    if tag in {value.strip().removeprefix("W/") for value in (if_none_match or "").split(",")}:
        return Response(status_code=304, headers=headers)
    return Response(data, media_type=kind, headers=headers)


IMAGE_RESPONSES = {200: {"content": {"image/jpeg": {}, "image/svg+xml": {}}}, 404: {}}


@router.get("/shows/{show_id}/artwork", response_class=Response, responses=IMAGE_RESPONSES)
async def show_artwork(
    show_id: UUID,
    user: CurrentUser,
    db: Database,
    if_none_match: str | None = Header(default=None),
):
    """The saved copy of the show's BBC artwork (640 by 640 JPEG)."""
    show = await radio.owned_show(db, user, show_id)
    data = radio_images.read(show.artwork_path)
    if not data:
        raise HTTPException(404, "No artwork saved for this show")
    return _image(data, "image/jpeg", if_none_match)


@router.get("/stations/{station_id}/logo", response_class=Response, responses=IMAGE_RESPONSES)
async def station_logo(
    station_id: str,
    user: CurrentUser,
    db: Database,
    if_none_match: str | None = Header(default=None),
):
    """The saved, cleaned copy of the station's BBC Sounds logo (SVG)."""
    station = await db.get(RadioStation, station_id) if SERVICE_ID.fullmatch(station_id) else None
    data = radio_images.read(station.logo_path) if station else None
    if not data:
        raise HTTPException(404, "No logo saved for this station")
    return _image(data, "image/svg+xml", if_none_match, radio_images.SVG_HEADERS)

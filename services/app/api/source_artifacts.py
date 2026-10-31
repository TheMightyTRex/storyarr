from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Path, Query
from fastapi.responses import Response
from pydantic import BaseModel

from app.adapters.contracts import AdapterError
from app.adapters.nzb_descriptor import NzbDescriptor
from app.adapters.source_releases import SourceRelease, release_value
from app.adapters.torrent_descriptor import TorrentDescriptor
from app.api.dependencies import Database, Member
from app.api.metadata import adapter_http_error
from app.db.models import AcquisitionIntent, SourceArtifact, SourceConnection, Version, Work
from app.domain import release_override
from app.domain.acquisition import RequestSpec
from app.domain.permissions import OVERRIDE_RELEASES, has
from app.domain.release_profiles import catalog_language_release
from app.domain.source_artifacts import resolve_mam

router = APIRouter(tags=["source-artifacts"])


class SourceArtifactView(BaseModel):
    id: UUID
    created_at: datetime
    source_key: str
    source_id: str
    source_generation: int
    current_connection: bool
    descriptor: TorrentDescriptor | NzbDescriptor
    release: SourceRelease
    dispatch_available: bool = False


async def artifact_view(db, identifier, user_id):
    row = await db.get(SourceArtifact, identifier)
    if not row or row.owner_id != user_id:
        raise HTTPException(404, "Source artifact not found")
    source = await db.get(SourceConnection, row.source_key, populate_existing=True)
    return SourceArtifactView(
        id=row.id,
        created_at=row.created_at,
        source_key=row.source_key,
        source_id=row.source_id,
        source_generation=row.source_generation,
        current_connection=bool(
            source and source.enabled and source.generation == row.source_generation
        ),
        descriptor=row.descriptor,
        release=row.release_snapshot,
    )


@router.post("/sources/mam/releases/{source_id}/artifact", response_model=SourceArtifactView)
async def resolve_artifact(
    user: Member, db: Database, source_id: str = Path(pattern=r"^[1-9][0-9]{0,17}$")
):
    user_id = user.id
    await db.rollback()
    try:
        identifier = await resolve_mam(user_id, source_id)
    except AdapterError as error:
        raise adapter_http_error(error) from error
    return await artifact_view(db, identifier, user_id)


@router.get("/source-artifacts/{artifact_id}", response_model=SourceArtifactView)
async def get_artifact(artifact_id: UUID, user: Member, db: Database):
    return await artifact_view(db, artifact_id, user.id)


class ReleaseChecks(BaseModel):
    # Checks Storyarr could not make for this book, which a person must confirm.
    unconfirmed: list[Literal["identity", "language"]]
    can_override: bool


@router.get("/source-artifacts/{artifact_id}/checks", response_model=ReleaseChecks)
async def release_checks(
    artifact_id: UUID,
    user: Member,
    db: Database,
    intent_id: UUID,
    slot: Literal["ebook", "audio", "either"] = Query(),
):
    artifact = await db.get(SourceArtifact, artifact_id)
    intent = await db.get(AcquisitionIntent, intent_id)
    if not artifact or artifact.owner_id != user.id:
        raise HTTPException(404, "Source artifact not found")
    if not intent or intent.owner_id != user.id:
        raise HTTPException(404, "Request not found")
    work = await db.get(Work, intent.work_id)
    book = {"title": work.title, "authors": work.authors}
    release = catalog_language_release(
        release_value(artifact.source_key, artifact.release_snapshot), book
    )
    medium = slot if slot != "either" else release.medium
    if medium not in {"ebook", "audio"}:
        raise HTTPException(409, "The source does not confirm the requested medium")
    rule = RequestSpec.model_validate(intent.specification).rule(medium)
    version = await db.get(Version, UUID(rule["version_id"])) if rule["version_id"] else None
    return ReleaseChecks(
        unconfirmed=release_override.unconfirmed(release, book, rule, version),
        can_override=has(user, OVERRIDE_RELEASES),
    )


@router.get("/source-artifacts/{artifact_id}/torrent", response_class=Response)
async def save_torrent(artifact_id: UUID, user: Member, db: Database):
    from app.domain.source_artifacts import artifact_bytes

    row = await db.get(SourceArtifact, artifact_id)
    if not row or row.owner_id != user.id:
        raise HTTPException(404, "Source artifact not found")
    return Response(
        content=artifact_bytes(row),
        media_type="application/x-bittorrent",
        headers={"Content-Disposition": f'attachment; filename="release-{row.id}.torrent"'},
    )

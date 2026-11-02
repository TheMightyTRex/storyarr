"""The radio library (FEAT-R, R3): choose the Audiobookshelf podcast library radio is filed into.

Admins choose one podcast library, one of its folders and the same folder as Storyarr sees it.
Storyarr then reads the library every 15 minutes and marks the episodes it holds as in your
library. Nothing in Audiobookshelf changes until an episode is filed.
"""

import asyncio
import os
from datetime import datetime
from pathlib import Path, PurePosixPath
from uuid import UUID

from cryptography.fernet import InvalidToken
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from app.adapters import abs_podcasts
from app.adapters.audiobookshelf import backend_path
from app.adapters.contracts import AdapterError
from app.api.dependencies import Admin, Database
from app.api.library_folders import library_client
from app.db.models import AuditEvent, Integration, RadioEpisode, RadioLibrary, RadioLibraryFile
from app.domain.download_folders import browse_roots, readable_folder
from app.domain.operations import transaction_lock
from app.importing.storage import storage_settings
from app.jobs.queue import enqueue

router = APIRouter(prefix="/radio/library", tags=["radio"])
SYNC = "radio.library.sync"


class PodcastLibraryOption(BaseModel):
    integration_id: UUID
    server_name: str
    library_id: str
    name: str
    folders: list[str]


class RadioLibraryView(BaseModel):
    integration_id: UUID
    server_name: str
    library_id: str
    name: str
    abs_folder: str
    local_path: str
    synced_at: datetime | None
    last_error: str | None
    files: int
    linked: int


class RadioLibrarySetup(BaseModel):
    current: RadioLibraryView | None
    options: list[PodcastLibraryOption]
    # Why a server's podcast libraries could not be read, by server name.
    errors: list[str] = []


class RadioLibraryInput(BaseModel):
    integration_id: UUID
    library_id: str = Field(min_length=1, max_length=200)
    abs_folder: str = Field(max_length=1024)
    local_path: str = Field(max_length=1024)

    @field_validator("abs_folder")
    @classmethod
    def library_root(cls, value):
        return backend_path(value)

    @field_validator("local_path")
    @classmethod
    def worker_folder(cls, value):
        value = value.strip()
        path = Path(value)
        if (
            not value.startswith("/")
            or value.startswith("//")
            or "\\" in value
            or str(path) == "/"
            or ".." in path.parts
            or "\x00" in value
        ):
            raise ValueError("Choose an absolute folder path below /")
        return str(path)


async def _servers(db):
    return (
        await db.scalars(
            select(Integration)
            .where(
                Integration.kind == "audiobookshelf",
                Integration.enabled.is_(True),
                Integration.deleted_at.is_(None),
            )
            .order_by(Integration.name)
        )
    ).all()


async def _libraries(integration):
    async with library_client(integration) as client:
        return await abs_podcasts.podcast_libraries(client)


async def _view(db, library: RadioLibrary) -> RadioLibraryView:
    integration = await db.get(Integration, library.integration_id)
    files = await db.scalar(
        select(func.count())
        .select_from(RadioLibraryFile)
        .where(RadioLibraryFile.library_id == library.id)
    )
    linked = await db.scalar(
        select(func.count())
        .select_from(RadioEpisode)
        .join(RadioLibraryFile, RadioLibraryFile.id == RadioEpisode.file_id)
        .where(RadioLibraryFile.library_id == library.id)
    )
    return RadioLibraryView(
        integration_id=library.integration_id,
        server_name=integration.name if integration else "Removed server",
        library_id=library.external_id,
        name=library.name,
        abs_folder=library.abs_folder,
        local_path=library.local_path,
        synced_at=library.synced_at,
        last_error=library.last_error,
        files=files or 0,
        linked=linked or 0,
    )


@router.get("", response_model=RadioLibrarySetup)
async def setup(admin: Admin, db: Database):
    """The chosen radio library, and every podcast library on the connected servers."""
    servers = await _servers(db)
    found = await asyncio.gather(
        *(_libraries(server) for server in servers), return_exceptions=True
    )
    options, errors = [], []
    for server, libraries in zip(servers, found, strict=True):
        if isinstance(libraries, AdapterError | InvalidToken | ValueError | KeyError):
            errors.append(f"Could not read the podcast libraries on {server.name}.")
            continue
        if isinstance(libraries, BaseException):
            raise libraries
        options.extend(
            PodcastLibraryOption(
                integration_id=server.id,
                server_name=server.name,
                library_id=library.id,
                name=library.name,
                folders=library.folders,
            )
            for library in libraries
        )
    library = await db.scalar(select(RadioLibrary).order_by(RadioLibrary.created_at).limit(1))
    return RadioLibrarySetup(
        current=await _view(db, library) if library else None, options=options, errors=errors
    )


def _check_folder(local: str, roots) -> None:
    path = Path(local)
    if not readable_folder(local, roots) or not path.is_dir():
        raise HTTPException(422, "Choose a folder inside a volume mounted for Storyarr.")
    if not os.access(path, os.W_OK | os.X_OK):
        raise HTTPException(422, "Storyarr cannot write to that folder. Check its permissions.")


@router.put("", response_model=RadioLibraryView)
async def choose(body: RadioLibraryInput, admin: Admin, db: Database):
    """Choose the radio library and its folder, then read it."""
    await transaction_lock(db, "radio-library")
    integration = await db.get(Integration, body.integration_id)
    if (
        not integration
        or integration.deleted_at
        or not integration.enabled
        or integration.kind != "audiobookshelf"
    ):
        raise HTTPException(422, "Choose a podcast library on a connected Audiobookshelf server.")
    try:
        libraries = await _libraries(integration)
    except (AdapterError, InvalidToken, ValueError, KeyError) as error:
        raise HTTPException(
            422,
            "Could not read the podcast libraries. "
            + (str(error) if isinstance(error, AdapterError) else "Reconnect the server."),
        ) from error
    library = next((row for row in libraries if row.id == body.library_id), None)
    if not library:
        raise HTTPException(422, "That podcast library is no longer on the server.")
    if body.abs_folder not in library.folders:
        raise HTTPException(422, "Choose one of the library's own folders.")
    roots = browse_roots(await storage_settings(db), include_libraries=True)
    await asyncio.to_thread(_check_folder, body.local_path, roots)
    row = await db.scalar(
        select(RadioLibrary).order_by(RadioLibrary.created_at).limit(1).with_for_update()
    )
    if not row:
        row = RadioLibrary()
        db.add(row)
    changed = (row.integration_id, row.external_id) != (integration.id, library.id)
    row.integration_id, row.external_id, row.name = integration.id, library.id, library.name
    row.abs_folder, row.local_path = body.abs_folder, body.local_path
    if changed:
        row.synced_at, row.last_error = None, None
    await db.flush()
    if changed:
        # Files from the library chosen before belong to it, so they go with the old choice.
        await db.execute(
            RadioLibraryFile.__table__.delete().where(RadioLibraryFile.library_id == row.id)
        )
    db.add(
        AuditEvent(
            actor_id=admin.id,
            action="radio.library.chosen",
            entity_id=row.id,
            detail={"library": library.name, "folder": str(PurePosixPath(body.abs_folder))},
        )
    )
    await enqueue(db, SYNC, job_lock=SYNC)
    await db.commit()
    return await _view(db, row)


@router.post("/sync", status_code=202, response_class=Response)
async def sync_now(admin: Admin, db: Database):
    """Read the radio library again now."""
    row = await db.scalar(select(RadioLibrary).order_by(RadioLibrary.created_at).limit(1))
    if not row:
        raise HTTPException(404, "Choose a radio library first.")
    await enqueue(db, SYNC, job_lock=SYNC)
    await db.commit()
    return Response(status_code=202)

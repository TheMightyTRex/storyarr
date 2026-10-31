"""Delete a library copy from Audiobookshelf, keeping its files in a holding folder by default.

Held files go to <library root>/.deleted-books/<date>/<path in the library>. Audiobookshelf skips
hidden folders, and the holding folder is on the same filesystem as the library, so holding a book
is a rename and the files can be put back by moving the folder home. A daily job removes dated
holding folders older than the installation's retention period.
"""

import asyncio
import logging
import shutil
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, exists, select

from app.adapters.audiobookshelf import Audiobookshelf
from app.adapters.contracts import AdapterError
from app.db.models import (
    AcquisitionIntent,
    AcquisitionReason,
    AssetContains,
    AuditEvent,
    BookList,
    ImportDestination,
    Integration,
    Library,
    LibraryAsset,
    ListAcquisitionPolicy,
    ListEntry,
    ListObservation,
    ListSubscription,
)
from app.db.session import session_factory
from app.domain.libro_library import library_token
from app.domain.work_graph import acquisition_lock, family_ids
from app.importing.storage import storage_settings

HOLDING = ".deleted-books"
logger = logging.getLogger(__name__)


class DeleteInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # "hold" moves the files to the holding folder; "delete" has Audiobookshelf delete them.
    files: Literal["hold", "delete"] = "hold"
    # Withdraw the member's requests and exclude the book from their follows and lists.
    forget: bool = True


class DeleteResult(BaseModel):
    held_path: str | None = None
    # Where the files were, in Storyarr's paths, so they can be moved back.
    original_path: str | None = None
    withdrawn_requests: int = 0
    excluded_from_lists: int = 0
    # Automatic manual lists (no catalog subscription) the book was taken out of.
    removed_from_lists: int = 0
    message: str


def _confine(root, relative):
    """Resolve a book folder below a library root, refusing the root and the holding folder."""
    base = Path(root).resolve()
    local = (base / relative).resolve()
    if not relative.parts or base not in local.parents or relative.parts[0] == HOLDING:
        raise HTTPException(409, "This item's folder is not a single book inside the library")
    return base, relative, local


async def _library_folder(db, asset, item_path):
    """Storyarr's own path for an Audiobookshelf item folder, inside a configured library root."""
    settings = await storage_settings(db)
    rows = await db.scalars(
        select(ImportDestination).where(
            ImportDestination.deleted_at.is_(None),
            ImportDestination.library_id == asset.library_id,
        )
    )
    for row in rows:
        root = settings.import_destinations.get(row.root_key)
        backend = row.backend_path.rstrip("/")
        if not root or not (item_path == backend or item_path.startswith(backend + "/")):
            continue
        relative = Path(item_path[len(backend) :].lstrip("/"))
        return await asyncio.to_thread(_confine, root, relative)
    raise HTTPException(
        409,
        "Storyarr cannot reach this library's files. Add the library under Library folders, "
        "or delete the files permanently instead.",
    )


def _holding_path(base, relative, today):
    target = base / HOLDING / today.isoformat() / relative
    candidate, number = target, 2
    while candidate.exists():
        candidate = target.with_name(f"{target.name} ({number})")
        number += 1
    return candidate


async def _forget(db, user, asset):
    works = list(
        await db.scalars(select(AssetContains.work_id).where(AssetContains.asset_id == asset.id))
    )
    family = set()
    for work_id in works:
        family |= set(await db.scalars(family_ids(work_id)))
    if not family:
        return 0, 0, 0
    from app.api.list_subscriptions import ensure_membership, remove_unneeded
    from app.domain.acquisition import evaluate

    withdrawn = 0
    intents = await db.scalars(
        select(AcquisitionIntent).where(
            AcquisitionIntent.owner_id == user.id, AcquisitionIntent.work_id.in_(family)
        )
    )
    for intent in intents:
        await acquisition_lock(db, intent.work_id)
        reasons = list(
            await db.scalars(
                select(AcquisitionReason).where(
                    AcquisitionReason.intent_id == intent.id, AcquisitionReason.active.is_(True)
                )
            )
        )
        for reason in reasons:
            reason.active = False
            withdrawn += 1
        if reasons:
            await db.flush()
            await evaluate(db, user, intent)
    excluded = 0
    rows = (
        await db.execute(
            select(ListObservation, ListSubscription)
            .join(ListSubscription, ListSubscription.id == ListObservation.subscription_id)
            .join(BookList, BookList.id == ListSubscription.list_id)
            .where(
                BookList.owner_id == user.id,
                ListObservation.work_id.in_(family),
                ListObservation.excluded.is_(False),
            )
        )
    ).all()
    for observation, subscription in rows:
        observation.excluded = True
        excluded += 1
        await db.flush()
        await remove_unneeded(db, user, subscription, observation.work_id)
        await ensure_membership(db, subscription, observation)
    # Manual lists have no exclusion; leaving the book in one with automatic acquisition would
    # download it again. Reading lists elsewhere (writeback) are deliberately left unchanged.
    from app.domain.acquisition import withdraw_list_reasons

    automatic = (
        select(ListAcquisitionPolicy.list_id)
        .join(BookList, BookList.id == ListAcquisitionPolicy.list_id)
        .where(
            BookList.owner_id == user.id,
            ListAcquisitionPolicy.active.is_(True),
            ListAcquisitionPolicy.configuration["mode"].astext == "automatic",
            ~exists().where(ListSubscription.list_id == ListAcquisitionPolicy.list_id),
        )
    )
    lists = set(
        await db.scalars(
            select(ListEntry.list_id).where(
                ListEntry.list_id.in_(automatic), ListEntry.work_id.in_(family)
            )
        )
    )
    for list_id in lists:
        await db.execute(
            delete(ListEntry).where(ListEntry.list_id == list_id, ListEntry.work_id.in_(family))
        )
        for work_id in works:
            await withdraw_list_reasons(db, user, list_id, work_id)
    return withdrawn, excluded, len(lists)


async def delete_copy(db, user, asset_id, body: DeleteInput) -> DeleteResult:
    asset = await db.get(LibraryAsset, asset_id, with_for_update=True)
    if not asset or asset.state in {"intentionally-removed", "missing-confirmed"}:
        raise HTTPException(404, "Library copy not found")
    library = await db.get(Library, asset.library_id)
    integration = await db.get(Integration, library.integration_id, with_for_update=True)
    if integration.kind != "audiobookshelf" or not integration.enabled:
        raise HTTPException(409, "Only copies in a connected Audiobookshelf library can be deleted")
    held = local = None
    try:
        async with Audiobookshelf(
            integration.base_url, library_token(integration.encrypted_secrets)
        ) as client:
            item = await client.item(asset.external_id)
            if body.files == "hold":
                if not item.path:
                    raise HTTPException(409, "Audiobookshelf did not report this item's folder")
                base, relative, local = await _library_folder(db, asset, item.path)
                if not local.exists():
                    raise HTTPException(409, "The book's files are not where Audiobookshelf says")
                held = _holding_path(base, relative, datetime.now(UTC).date())
                held.parent.mkdir(parents=True, exist_ok=True)
                await asyncio.to_thread(shutil.move, str(local), str(held))
            try:
                await client.delete_item(asset.external_id, delete_files=body.files == "delete")
            except AdapterError:
                if held:
                    # Leave the library exactly as it was if Audiobookshelf refused.
                    await asyncio.to_thread(shutil.move, str(held), str(local))
                raise
    except AdapterError as error:
        raise HTTPException(502, f"Audiobookshelf refused the delete: {error}") from error
    asset.state, asset.missing_since = "intentionally-removed", None
    withdrawn, excluded, removed = await _forget(db, user, asset) if body.forget else (0, 0, 0)
    db.add(
        AuditEvent(
            actor_id=user.id,
            action="library.copy.deleted",
            entity_id=asset.id,
            detail={
                "title": asset.title,
                "files": body.files,
                "held_path": str(held) if held else None,
                "withdrawn_requests": withdrawn,
                "excluded_from_lists": excluded,
                "removed_from_lists": removed,
            },
        )
    )
    return DeleteResult(
        held_path=str(held) if held else None,
        original_path=str(local) if held else None,
        withdrawn_requests=withdrawn,
        excluded_from_lists=excluded,
        removed_from_lists=removed,
        message=(
            "Moved to the holding folder and removed from Audiobookshelf"
            if held
            else "Deleted from Audiobookshelf, including its files"
        ),
    )


def _expired_folders(roots, retention_days, today: date):
    cutoff = today - timedelta(days=retention_days)
    for root in roots:
        holding = Path(root) / HOLDING
        if not holding.is_dir():
            continue
        for folder in sorted(holding.iterdir()):
            try:
                day = date.fromisoformat(folder.name)
            except ValueError:
                continue  # never touch anything Storyarr didn't create
            if folder.is_dir() and day < cutoff:
                yield folder


async def purge_held():
    """Remove dated holding folders older than the retention period. 0 days never purges."""
    from app.domain.automation_settings import installation

    async with session_factory()() as db, db.begin():
        _, settings = await installation(db)
        if not settings.deleted_retention_days:
            return
        roots = set((await storage_settings(db)).import_destinations.values())
        for folder in _expired_folders(roots, settings.deleted_retention_days, date.today()):
            await asyncio.to_thread(shutil.rmtree, folder)
            logger.info("Removed held deleted books in %s", folder)
            db.add(
                AuditEvent(
                    actor_id=None, action="library.held.purged", detail={"path": str(folder)}
                )
            )

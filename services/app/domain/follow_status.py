"""One status per book in a followed author or series, from local state only.

The status combines library ownership, the follow's filters, the list's automatic acquisition
progress and any of the member's requests and downloads for the book. It never contacts a
provider or changes acquisition state.
"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel
from sqlalchemy import select

from app.db.models import (
    AcquisitionIntent,
    AcquisitionReason,
    AcquisitionSelection,
    AcquisitionTarget,
    AutomaticImport,
    DownloadAttempt,
    DownloadMembership,
    ListAcquisitionBook,
    ListAcquisitionPolicy,
    MonitoredRelease,
)
from app.domain.automation_settings import current as automation_settings
from app.domain.work_graph import canonical_map

StatusKind = Literal[
    "in_library",
    "downloading",
    "importing",
    "searching",
    "waiting",
    "not_released",
    "attention",
    "wanted",
    "excluded",
    "not_requested",
]
STATUS_KINDS: tuple[StatusKind, ...] = StatusKind.__args__
# Same live states as the request card's "Downloading" chip.
LIVE_DOWNLOADS = {"queued", "preflight", "submitting", "uncertain", "downloading"}


class BookStatus(BaseModel):
    kind: StatusKind
    label: str
    detail: str | None = None
    # A time the reader's browser formats locally, such as the next automatic search.
    at: datetime | None = None
    progress: float | None = None


def medium_detail(ebook, audio):
    return "Audiobook and ebook" if ebook and audio else "Audiobook" if audio else "Ebook"


def release_detail(day):
    if not day:
        return "No release date yet"
    day = date.fromisoformat(day) if isinstance(day, str) else day
    return f"Release date {day.day} {day:%b %Y}"


async def _list_books(db, list_id, work_ids):
    policy = await db.scalar(
        select(ListAcquisitionPolicy).where(ListAcquisitionPolicy.list_id == list_id)
    )
    if not policy:
        return None, {}
    mapping = canonical_map(
        select(ListAcquisitionBook.work_id).where(
            ListAcquisitionBook.policy_id == policy.id,
            ListAcquisitionBook.generation == policy.generation,
        )
    )
    rows = await db.execute(
        select(mapping.c.work_id, ListAcquisitionBook)
        .join(mapping, mapping.c.origin_id == ListAcquisitionBook.work_id)
        .where(
            ListAcquisitionBook.policy_id == policy.id,
            ListAcquisitionBook.generation == policy.generation,
            mapping.c.work_id.in_(work_ids),
        )
    )
    return policy, {work_id: book for work_id, book in rows.all()}


async def _requests(db, user, work_ids):
    """The member's active request targets per book, with their latest download, if any."""
    mapping = canonical_map(
        select(AcquisitionIntent.work_id).where(AcquisitionIntent.owner_id == user.id)
    )
    active = (
        select(AcquisitionReason.intent_id).where(AcquisitionReason.active.is_(True)).distinct()
    )
    rows = (
        await db.execute(
            select(mapping.c.work_id, AcquisitionTarget)
            .join(AcquisitionIntent, AcquisitionIntent.id == AcquisitionTarget.intent_id)
            .join(mapping, mapping.c.origin_id == AcquisitionIntent.work_id)
            .where(
                AcquisitionIntent.owner_id == user.id,
                AcquisitionIntent.id.in_(active),
                mapping.c.work_id.in_(work_ids),
                AcquisitionTarget.state != "cancelled",
            )
        )
    ).all()
    targets = {}
    for work_id, target in rows:
        targets.setdefault(work_id, []).append(target)
    if not rows:
        return targets, {}
    selections = (
        await db.execute(
            select(AcquisitionSelection.target_id, AcquisitionSelection.id)
            .where(
                AcquisitionSelection.target_id.in_([t.id for _, t in rows]),
                AcquisitionSelection.state.in_(["prepared", "committed", "fulfilled"]),
            )
            .order_by(AcquisitionSelection.created_at)
        )
    ).all()
    latest = dict(selections)
    attempts = {}
    if latest:
        found = (
            await db.execute(
                select(DownloadMembership.selection_id, DownloadAttempt, AutomaticImport)
                .join(DownloadAttempt, DownloadAttempt.id == DownloadMembership.attempt_id)
                .outerjoin(AutomaticImport, AutomaticImport.attempt_id == DownloadAttempt.id)
                .where(DownloadMembership.selection_id.in_(latest.values()))
                .order_by(DownloadAttempt.created_at)
            )
        ).all()
        by_selection = {selection: (attempt, imported) for selection, attempt, imported in found}
        for target_id, selection_id in latest.items():
            if selection_id in by_selection:
                attempts[target_id] = by_selection[selection_id]
    return targets, attempts


def _download_status(targets, attempts):
    for target in targets:
        attempt, imported = attempts.get(target.id, (None, None))
        if not attempt or target.state == "satisfied":
            continue
        raw = (attempt.observation or {}).get("progress")
        progress = (
            float(raw) if isinstance(raw, int | float) and not isinstance(raw, bool) else None
        )
        if (imported and imported.state == "held") or attempt.state == "held":
            message = imported.message if imported and imported.state == "held" else attempt.message
            return BookStatus(kind="attention", label="Needs attention", detail=message)
        if attempt.state in LIVE_DOWNLOADS:
            percent = f" {progress * 100:.0f}%" if progress is not None else ""
            return BookStatus(kind="downloading", label="Downloading" + percent, progress=progress)
        if attempt.state == "complete":
            return BookStatus(
                kind="importing",
                label="Importing",
                detail=imported.message if imported else None,
            )
    return None


def _list_status(book):
    if not book or book.state in {"baseline", "removed"}:
        return None
    if book.state == "available":
        return None
    if book.state == "held":
        return BookStatus(kind="attention", label="Needs attention", detail=book.message)
    if book.state in {"searching", "selecting"}:
        return BookStatus(kind="searching", label="Searching", detail=book.message)
    if book.state == "pending":
        return BookStatus(kind="waiting", label="Waiting", detail=book.message)
    if book.progress.get("waiting_for_release"):
        return BookStatus(kind="not_released", label="Not released yet", detail=book.message)
    if book.next_check_at:
        return BookStatus(
            kind="waiting",
            label="Waiting",
            detail="Next automatic search",
            at=book.next_check_at,
        )
    return BookStatus(kind="wanted", label="Wanted", detail=book.message)


async def _retries(db, user, work_ids):
    """Next automatic search for wanted requests, when Search again for wanted books covers them."""
    _, settings = await automation_settings(db, user.id)
    rows = await db.scalars(
        select(MonitoredRelease).where(
            MonitoredRelease.owner_id == user.id,
            MonitoredRelease.work_id.in_(work_ids),
            MonitoredRelease.state == "wanted",
            MonitoredRelease.next_check_at.is_not(None),
        )
    )
    return {
        row.work_id: row.next_check_at
        for row in rows
        if settings.wanted_search.allows((row.specification or {}).get("mode"))
    }


async def statuses(db, user, list_id, records):
    """Status for each catalog record (rows from following_overview.catalog), by work id."""
    if not records:
        return {}
    work_ids = [record.work_id for record in records]
    policy, list_books = await _list_books(db, list_id, work_ids)
    targets, attempts = await _requests(db, user, work_ids)
    retries = await _retries(db, user, work_ids)
    automatic = bool(policy and policy.active and policy.configuration["mode"] == "automatic")
    result = {}
    for record in records:
        work_id = record.work_id
        if record.ebook or record.audio:
            status = BookStatus(
                kind="in_library",
                label="In library",
                detail=medium_detail(record.ebook, record.audio),
            )
        elif not record.eligible:
            status = BookStatus(
                kind="excluded",
                label="Excluded",
                detail="Excluded by you"
                if record.excluded
                else record.snapshot.get("filter_reason") or "Excluded",
            )
        else:
            status = _download_status(targets.get(work_id, []), attempts) or (
                _list_status(list_books.get(work_id)) if automatic else None
            )
            if status is None and record.upcoming:
                status = BookStatus(
                    kind="not_released", label="Not released yet", detail=release_detail(record.day)
                )
            if status is None and any(t.state == "wanted" for t in targets.get(work_id, [])):
                status = (
                    BookStatus(
                        kind="waiting",
                        label="Waiting",
                        detail="Next automatic search",
                        at=retries[work_id],
                    )
                    if work_id in retries
                    else BookStatus(
                        kind="wanted",
                        label="Wanted",
                        detail="Requested; not searched automatically",
                    )
                )
            if status is None and targets.get(work_id):
                status = BookStatus(
                    kind="waiting", label="Waiting", detail=targets[work_id][0].message
                )
            if status is None:
                status = BookStatus(
                    kind="not_requested",
                    label="Not requested",
                    detail="Missing from your library",
                )
        result[work_id] = status
    return result

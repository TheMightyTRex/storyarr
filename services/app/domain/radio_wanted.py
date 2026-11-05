"""Radio following (R4): wanted episodes are requested through the book acquisition path.

An episode a person wants (its status, worked out from the follow choice, is wanted) is
requested through a private catalogue record of its own, with an acquisition reason of kind
`episode` whose reference is the episode id. The request then shows in Activity like any other
and the radio sources of R5 can search for it. When the episode is no longer wanted (the follow
choice changed, the episode is in the radio library, or the show was removed) the reason is
withdrawn and the request is evaluated again.

Nothing here contacts the BBC or a source. Episode requests are never searched for books: the
release monitor only adopts manual requests, and the record is kept out of book matching.

The poll (`schedule`) is gentle: every 15 minutes it works out the statuses of episodes whose
broadcast time has passed (no BBC request), then starts at most two show refreshes, each show
at most once in twelve hours, and up to four podcast feeds, each at most once an hour. The
refresh itself is cached and spaces its requests out.
"""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import String, cast, func, select

from app.config import get_settings
from app.db.models import (
    AcquisitionIntent,
    AcquisitionReason,
    Operation,
    RadioEpisode,
    RadioSeries,
    RadioShow,
    User,
    Work,
)
from app.db.session import session_factory
from app.domain.corrections import revision
from app.domain.work_graph import acquisition_lock

KIND = "episode"
# Episode statuses that keep the request open. R5 sets searching, downloading and the rest.
WANTING = {"wanted", "searching", "waiting", "downloading", "importing", "attention"}
CHECK_EVERY = timedelta(hours=12)
MAX_PER_RUN = 2
# Podcast feeds are one small request each and change often, so they are read every hour.
FEED_EVERY = timedelta(hours=1)
FEEDS_PER_RUN = 4
SPECIFICATION = {"mode": "audio"}
# Radio sources (Prowlarr radio categories, MAM) are phase R5. Until then a wanted episode waits.
NO_SOURCES = "Wanted. Storyarr does not search for radio episodes yet."


def shown_message(state: str, message: str) -> str:
    """What a radio episode request says, in place of the book wording about sources."""
    return NO_SOURCES if state == "wanted" else message


def episode_code(series_number: int, episode_number: int) -> str:
    return f"S{series_number:02d}E{episode_number:02d}"


def request_title(show: RadioShow, series: RadioSeries, episode: RadioEpisode) -> str:
    """The same words as the file name in the radio library: Show - S20E03 - Title."""
    return f"{show.title} - {episode_code(series.number, episode.number)} - {episode.title}"[:600]


async def _work(db, show, series, episode) -> Work:
    work = await db.get(Work, episode.work_id) if episode.work_id else None
    title = request_title(show, series, episode)
    if work:
        work.title = title
        return work
    work = Work(
        title=title,
        authors=[show.title[:200]],
        description=episode.synopsis,
        language="en",
        provisional=False,
        catalog_public=False,
        catalog_owner_id=show.owner_id,
        # identity_rejected keeps the record out of book matching, enrichment and discovery.
        metadata_fields={
            "origin": "radio",
            "identity_rejected": True,
            "radio": {"show_id": str(show.id), "episode_id": str(episode.id), "pid": episode.pid},
        },
    )
    db.add(work)
    await db.flush()
    episode.work_id = work.id
    return work


async def want(db, owner: User, show, series, episode) -> AcquisitionIntent:
    """Request the episode (or keep its request open) with an `episode` reason."""
    from app.domain.acquisition import RequestSpec, evaluate

    work = await _work(db, show, series, episode)
    await acquisition_lock(db, work.id)
    spec = RequestSpec.model_validate(SPECIFICATION).model_dump(mode="json")
    fingerprint = revision(spec)
    intent = await db.scalar(
        select(AcquisitionIntent).where(
            AcquisitionIntent.owner_id == owner.id,
            AcquisitionIntent.work_id == work.id,
            AcquisitionIntent.fingerprint == fingerprint,
        )
    )
    if not intent:
        intent = AcquisitionIntent(
            owner_id=owner.id, work_id=work.id, fingerprint=fingerprint, specification=spec
        )
        db.add(intent)
        await db.flush()
    reason = await db.scalar(
        select(AcquisitionReason).where(
            AcquisitionReason.intent_id == intent.id,
            AcquisitionReason.kind == KIND,
            AcquisitionReason.reference == str(episode.id),
        )
    )
    if not reason:
        reason = AcquisitionReason(
            intent_id=intent.id,
            kind=KIND,
            reference=str(episode.id),
            approval_status="approved",
            decided_by=owner.id,
            decided_at=datetime.now(UTC),
        )
        db.add(reason)
    reason.active = True
    await db.flush()
    await evaluate(db, owner, intent)
    return intent


async def withdraw(db, reason: AcquisitionReason, intent: AcquisitionIntent):
    from app.domain.acquisition import evaluate

    await acquisition_lock(db, intent.work_id)
    reason.active = False
    await db.flush()
    await evaluate(db, await db.get(User, intent.owner_id), intent)


def _reasons(show_ids=None):
    query = (
        select(AcquisitionReason, AcquisitionIntent, RadioEpisode.status)
        .join(AcquisitionIntent, AcquisitionIntent.id == AcquisitionReason.intent_id)
        .outerjoin(RadioEpisode, cast(RadioEpisode.id, String) == AcquisitionReason.reference)
        .where(AcquisitionReason.kind == KIND, AcquisitionReason.active.is_(True))
        .order_by(AcquisitionIntent.work_id, AcquisitionReason.id)
    )
    if show_ids is not None:
        query = query.where(RadioEpisode.show_id.in_(show_ids))
    return query


async def sync(db, show_ids=None, *, removing=False) -> tuple[int, int]:
    """Open a request for every wanted episode of these shows (all shows when None) and withdraw
    the requests of episodes no longer wanted. Returns (requested, withdrawn)."""
    show_ids = list(show_ids) if show_ids is not None else None
    if show_ids == []:
        return 0, 0
    withdrawn = 0
    for reason, intent, status in (await db.execute(_reasons(show_ids))).all():
        if removing or status not in WANTING:
            await withdraw(db, reason, intent)
            withdrawn += 1
    if removing:
        return 0, withdrawn
    open_ids = select(AcquisitionReason.reference).where(
        AcquisitionReason.kind == KIND, AcquisitionReason.active.is_(True)
    )
    query = (
        select(RadioEpisode, RadioSeries, RadioShow, User)
        .join(RadioSeries, RadioSeries.id == RadioEpisode.series_id)
        .join(RadioShow, RadioShow.id == RadioEpisode.show_id)
        .join(User, User.id == RadioShow.owner_id)
        .where(
            RadioEpisode.status.in_(WANTING),
            cast(RadioEpisode.id, String).not_in(open_ids),
            User.active.is_(True),
            User.role != "viewer",
        )
        .order_by(RadioShow.id, RadioEpisode.first_broadcast, RadioEpisode.id)
    )
    if show_ids is not None:
        query = query.where(RadioShow.id.in_(show_ids))
    requested = 0
    for episode, series, show, owner in (await db.execute(query)).all():
        await want(db, owner, show, series, episode)
        requested += 1
    return requested, withdrawn


async def still_wanted(db, reason: AcquisitionReason) -> bool:
    """For evaluate: an `episode` reason lasts while its episode exists and is wanted."""
    try:
        episode = await db.get(RadioEpisode, UUID(reason.reference))
    except ValueError:
        return False
    return bool(episode and episode.status in WANTING)


async def catch_up(db, now=None) -> int:
    """Episodes whose first broadcast has passed become wanted (or not requested) without
    asking the BBC. Returns how many shows changed."""
    from app.domain.radio import restatus

    now = now or datetime.now(UTC)
    shows = list(
        await db.scalars(
            select(RadioShow)
            .where(
                RadioShow.id.in_(
                    select(RadioEpisode.show_id).where(
                        RadioEpisode.status == "not_released",
                        RadioEpisode.first_broadcast <= now,
                    )
                ),
            )
            .order_by(RadioShow.id)
            .with_for_update(skip_locked=True)
        )
    )
    for show in shows:
        restatus(
            show,
            await db.scalars(
                select(RadioEpisode).where(
                    RadioEpisode.show_id == show.id, RadioEpisode.status == "not_released"
                )
            ),
            now,
        )
    await db.flush()
    await sync(db, [show.id for show in shows])
    return len(shows)


async def due_shows(db, now, limit=MAX_PER_RUN, *, feeds=False) -> list[RadioShow]:
    """Followed shows not read for CHECK_EVERY (feeds: FEED_EVERY), oldest first, without a
    refresh running or started (or failed) within that time."""
    from app.domain.radio import ACTIVE

    since = now - (FEED_EVERY if feeds else CHECK_EVERY)
    recent = select(Operation.id).where(Operation.created_at >= since)
    busy = select(Operation.id).where(Operation.status.in_(ACTIVE))
    return list(
        await db.scalars(
            select(RadioShow)
            .join(User, User.id == RadioShow.owner_id)
            .where(
                RadioShow.follow != "none",
                (RadioShow.provider == "feed") if feeds else (RadioShow.provider != "feed"),
                User.active.is_(True),
                (RadioShow.refreshed_at.is_(None)) | (RadioShow.refreshed_at < since),
                RadioShow.operation_id.is_(None)
                | (RadioShow.operation_id.not_in(recent) & RadioShow.operation_id.not_in(busy)),
            )
            .order_by(RadioShow.refreshed_at.asc().nulls_first(), RadioShow.id)
            .limit(limit)
            .with_for_update(of=RadioShow, skip_locked=True)
        )
    )


async def schedule(now=None) -> int:
    """The periodic follow check. Returns how many show refreshes it started."""
    from app.domain.radio import start_refresh

    if get_settings().recovery_mode:
        return 0
    now = now or datetime.now(UTC)
    async with session_factory()() as db, db.begin():
        await catch_up(db, now)
    async with session_factory()() as db, db.begin():
        shows = await due_shows(db, now) + await due_shows(db, now, FEEDS_PER_RUN, feeds=True)
        for show in shows:
            await start_refresh(db, show.owner_id, show)
    return len(shows)


async def calendar_entries(db, user, start, end) -> list[dict]:
    """Episodes of the person's followed shows first broadcast in these days (UK dates), for
    the release calendar. Upcoming ones are "not released"; the rest show their status."""
    from zoneinfo import ZoneInfo

    from app.db.models import RadioStation

    london = ZoneInfo("Europe/London")
    low = datetime.combine(start, datetime.min.time(), tzinfo=UTC) - timedelta(days=1)
    high = datetime.combine(end, datetime.min.time(), tzinfo=UTC) + timedelta(days=2)
    rows = (
        await db.execute(
            select(RadioEpisode, RadioSeries, RadioShow, RadioStation.name)
            .join(RadioSeries, RadioSeries.id == RadioEpisode.series_id)
            .join(RadioShow, RadioShow.id == RadioEpisode.show_id)
            .outerjoin(
                RadioStation,
                RadioStation.id == func.coalesce(RadioSeries.station_id, RadioShow.station_id),
            )
            .where(
                RadioShow.owner_id == user.id,
                RadioShow.follow != "none",
                RadioEpisode.first_broadcast >= low,
                RadioEpisode.first_broadcast < high,
            )
            .order_by(RadioEpisode.first_broadcast, RadioEpisode.id)
        )
    ).all()
    entries = []
    for episode, series, show, station in rows:
        day = episode.first_broadcast.astimezone(london).date()
        if not start <= day <= end:
            continue
        entries.append(
            {
                "work_id": None,
                "external_id": episode.pid,
                "provider": "radio",
                "title": show.title,
                "authors": [],
                "cover_url": f"/api/radio/shows/{show.id}/artwork" if show.artwork_path else None,
                "release_date": day,
                "basis": "unknown",
                "followed": True,
                "in_library": episode.status == "in_library",
                "genres": [],
                "state": episode.status,
                "radio": {
                    "show_id": show.id,
                    "episode_id": episode.id,
                    "show_title": show.title,
                    "episode_title": episode.title,
                    "code": episode_code(series.number, episode.number),
                    "station": station,
                    "broadcast_at": episode.first_broadcast,
                    "status": episode.status,
                },
            }
        )
    return entries

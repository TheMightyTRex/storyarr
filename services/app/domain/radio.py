"""Radio shows (FEAT-R): adding, refreshing and following BBC shows, owned per person.

A show is added from a preview (a few BBC requests), then a background job reads every series
and its episodes. BBC responses are cached for an hour through the catalog gateway, requests
are spaced out, and series that are complete and long finished are not read again. Each
refresh also fetches the station logos and the show artwork once (see radio_images).
"""

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert

from app.adapters import bbc_programmes as bbc_feed
from app.adapters.contracts import AdapterError, FailureKind
from app.config import get_settings
from app.db.models import (
    Operation,
    RadioEpisode,
    RadioSeries,
    RadioShow,
    RadioStation,
    User,
)
from app.db.session import session_factory
from app.domain import radio_images
from app.domain.catalog_network import CatalogGateway
from app.domain.operations import transaction_lock
from app.jobs.queue import enqueue
from app.jobs.retry import CatalogRetry

KIND = "radio.show.refresh"
# Tests replace this with an httpx mock transport.
TRANSPORT = None
REQUEST_INTERVAL = 1.5
# Episode lengths need one request each, so each refresh fills in at most this many.
DURATION_BUDGET = 30
# A series with all its expected episodes, the last broadcast this long ago, is not read again.
SETTLED_AFTER = timedelta(days=60)
ACTIVE = {"queued", "running", "retrying"}
# Statuses this phase works out from broadcast dates and the follow choice. Later phases set
# the others (in library, downloading and so on) and a refresh leaves those alone.
COMPUTED = {"not_released", "wanted", "not_requested"}
MESSAGES = {
    FailureKind.NOT_FOUND: "The BBC has no programme with this id. Check the link.",
    FailureKind.RATE_LIMIT: "The BBC is limiting requests. Storyarr will try again later.",
    FailureKind.PARSER: bbc_feed.CHANGED,
}


def friendly(error: AdapterError) -> AdapterError:
    """Gateway errors (written for library servers) in words about the BBC."""
    message = MESSAGES.get(
        error.kind, "The BBC programme data could not be reached. Try again later."
    )
    return AdapterError(error.kind, message, retry_after=error.retry_after)


@asynccontextmanager
async def bbc(*, provider="bbc"):
    """A cached, paced reader for BBC programme data (or BBC Sounds search)."""
    async with CatalogGateway(
        provider, "public", request_interval=REQUEST_INTERVAL, transport=TRANSPORT
    ) as gateway:

        async def fetch(path, params):
            try:
                return await gateway.request("GET", path, params=params)
            except AdapterError as error:
                raise friendly(error) from None

        yield fetch


def link_pid(link: str) -> str:
    try:
        return bbc_feed.parse_link(link)
    except bbc_feed.LinkError as error:
        raise HTTPException(422, str(error)) from None


async def preview(link: str) -> bbc_feed.ShowData:
    pid = link_pid(link)
    async with bbc() as fetch:
        return await bbc_feed.preview(fetch, pid)


async def search(query: str) -> list[bbc_feed.SearchResult]:
    """Name search through BBC Sounds (public, no sign-in). Shows only, best match first."""
    async with bbc(provider="bbc-sounds") as fetch:
        data = await fetch("v2/programmes/search/container", {"q": query})
    return bbc_feed.search_results(data)


async def popular(*, category: str | None = None, network: str | None = None):
    """Popular shows on BBC Sounds for one category or one station (cached for an hour)."""
    params = {"sort": "popular", "limit": 60}
    if category:
        params["category"] = category
    if network:
        params["network"] = network
    async with bbc(provider="bbc-sounds") as fetch:
        data = await fetch("v2/programmes/playable", params)
    return bbc_feed.popular_shows(data)


def episode_status(first_broadcast, follow, followed_at, current=None, now=None) -> str:
    if current and current not in COMPUTED:
        return current
    now = now or datetime.now(UTC)
    if first_broadcast and first_broadcast > now:
        return "not_released"
    if follow == "all":
        return "wanted"
    if (
        follow == "from_now_on"
        and first_broadcast
        and followed_at
        and first_broadcast >= followed_at
    ):
        return "wanted"
    return "not_requested"


async def save_station(db, station) -> str | None:
    if not station:
        return None
    service_id, name = station
    statement = insert(RadioStation).values(id=service_id, name=name)
    await db.execute(
        statement.on_conflict_do_update(index_elements=[RadioStation.id], set_={"name": name})
    )
    return service_id


async def apply(db, show: RadioShow, data: bbc_feed.ShowData, now=None):
    """Save what the BBC returned. Nothing is deleted when the BBC drops an item."""
    now = now or datetime.now(UTC)
    show.title, show.synopsis = data.title, data.synopsis
    show.first_broadcast = data.first_broadcast or show.first_broadcast
    show.station_id = await save_station(db, data.station) or show.station_id
    show.image_pid = data.image_pid or show.image_pid
    saved = {
        row.pid: row
        for row in await db.scalars(select(RadioSeries).where(RadioSeries.show_id == show.id))
    }
    episodes = {
        row.pid: row
        for row in await db.scalars(select(RadioEpisode).where(RadioEpisode.show_id == show.id))
    }
    for item in data.series:
        row = saved.get(item.pid)
        if not row:
            row = RadioSeries(id=uuid4(), show_id=show.id, pid=item.pid)
            saved[item.pid] = row
            db.add(row)
        row.kind, row.number, row.number_source = item.kind, item.number, item.number_source
        row.title, row.synopsis = item.title, item.synopsis or row.synopsis
        row.station_id = await save_station(db, item.station) or row.station_id or show.station_id
        row.expected_episodes = item.expected_episodes
        row.first_broadcast = item.first_broadcast or row.first_broadcast
        if item.episodes is None:
            continue
        # No ORM relationships, so the series row goes in before its episodes.
        await db.flush()
        row.walked_at = now
        for entry in item.episodes:
            episode = episodes.get(entry.pid)
            if not episode:
                episode = RadioEpisode(
                    show_id=show.id, pid=entry.pid, status="not_requested", series_id=row.id
                )
                db.add(episode)
                episodes[entry.pid] = episode
            episode.series_id = row.id
            episode.number, episode.number_source = entry.number, entry.number_source
            episode.title, episode.synopsis = entry.title, entry.synopsis or episode.synopsis
            episode.first_broadcast = entry.first_broadcast or episode.first_broadcast
    for pid, seconds in data.durations.items():
        if pid in episodes:
            episodes[pid].duration_seconds = seconds
    await db.flush()
    restatus(show, episodes.values(), now)
    show.refreshed_at = now


def restatus(show, episodes, now=None):
    for episode in episodes:
        episode.status = episode_status(
            episode.first_broadcast, show.follow, show.followed_at, episode.status, now
        )


async def owned_show(db, user, show_id, *, lock=False) -> RadioShow:
    query = select(RadioShow).where(RadioShow.id == show_id, RadioShow.owner_id == user.id)
    show = await db.scalar(query.with_for_update() if lock else query)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


async def add(db, owner_id, data: bbc_feed.ShowData, follow: str) -> tuple[RadioShow, Operation]:
    await transaction_lock(db, f"radio-show:{owner_id}:{data.pid}")
    existing = await db.scalar(
        select(RadioShow.id).where(
            RadioShow.owner_id == owner_id,
            RadioShow.provider == "bbc",
            RadioShow.external_id == data.pid,
        )
    )
    if existing:
        raise HTTPException(409, "This show is already in your radio shows")
    now = datetime.now(UTC)
    show = RadioShow(
        id=uuid4(),
        owner_id=owner_id,
        provider="bbc",
        external_id=data.pid,
        title=data.title,
        follow=follow,
        followed_at=now if follow != "none" else None,
    )
    db.add(show)
    await db.flush()
    await apply(db, show, data, now)
    # Only the preview has been read so far; the refresh job reads every series.
    show.refreshed_at = None
    operation = await start_refresh(db, owner_id, show)
    return show, operation


async def set_follow(db, show: RadioShow, follow: str):
    if follow == show.follow:
        return
    show.follow = follow
    show.followed_at = datetime.now(UTC) if follow != "none" else None
    restatus(show, await db.scalars(select(RadioEpisode).where(RadioEpisode.show_id == show.id)))


async def job_state(db, operation) -> str | None:
    return await db.scalar(
        text("SELECT status::text FROM book_queue.procrastinate_jobs WHERE id = :id"),
        {"id": operation.job_id},
    )


async def start_refresh(db, owner_id, show: RadioShow) -> Operation:
    if get_settings().recovery_mode:
        raise HTTPException(409, "Radio refresh is paused for recovery")
    await transaction_lock(db, f"radio-refresh:{show.id}")
    if show.operation_id:
        previous = await db.get(Operation, show.operation_id)
        if previous and previous.status in ACTIVE:
            if await job_state(db, previous) in {"todo", "doing"}:
                return previous
            previous.status, previous.message = "failed", "The refresh stopped; a new one started"
    operation = Operation(
        owner_id=owner_id,
        kind=KIND,
        idempotency_key=f"radio-refresh:{show.id}:{uuid4()}",
        payload={"show_id": str(show.id)},
        message="Waiting to read the show from the BBC",
    )
    db.add(operation)
    await db.flush()
    show.operation_id = operation.id
    operation.job_id = await enqueue(db, KIND, operation_id=str(operation.id))
    return operation


async def _current(db, operation_id):
    operation = await db.get(Operation, operation_id, with_for_update=True, populate_existing=True)
    if not operation or operation.kind != KIND or operation.status not in ACTIVE:
        return None, None
    show = await db.get(RadioShow, UUID(operation.payload["show_id"]), populate_existing=True)
    owner = await db.get(User, operation.owner_id)
    if not show or show.operation_id != operation.id or not owner or not owner.active:
        operation.status, operation.message = "cancelled", "The show was removed or replaced"
        return None, None
    return operation, show


async def settled(db, show_id, now) -> set[str]:
    rows = await db.execute(
        select(
            RadioSeries.pid,
            RadioSeries.expected_episodes,
            func.count(RadioEpisode.id),
            func.max(RadioEpisode.first_broadcast),
        )
        .outerjoin(RadioEpisode, RadioEpisode.series_id == RadioSeries.id)
        .where(RadioSeries.show_id == show_id, RadioSeries.walked_at.is_not(None))
        .group_by(RadioSeries.id)
    )
    return {
        pid
        for pid, expected, count, latest in rows.all()
        if expected and count >= expected and latest and latest < now - SETTLED_AFTER
    }


async def run(operation_id):
    """The refresh job: read the show from the BBC, then fetch images, then save."""
    if get_settings().recovery_mode:
        raise CatalogRetry(60)
    now = datetime.now(UTC)
    async with session_factory()() as db, db.begin():
        operation, show = await _current(db, operation_id)
        if not operation:
            return
        pid, show_id = show.external_id, show.id
        skip = await settled(db, show.id, now)
        lengths = (
            await db.execute(
                select(
                    RadioEpisode.pid, RadioEpisode.first_broadcast, RadioEpisode.duration_seconds
                ).where(RadioEpisode.show_id == show.id)
            )
        ).all()
        known = {pid for pid, _, seconds in lengths if seconds}
        missing = [(pid, start) for pid, start, seconds in lengths if not seconds]
        operation.status, operation.message = "running", "Reading the show from the BBC"
    try:
        async with bbc() as fetch:
            data = await bbc_feed.walk(
                fetch,
                pid,
                settled=skip,
                known_durations=known,
                stored_missing=missing,
                duration_budget=DURATION_BUDGET,
            )
    except AdapterError as error:
        transient = error.kind in {
            FailureKind.RATE_LIMIT,
            FailureKind.TIMEOUT,
            FailureKind.UNAVAILABLE,
            FailureKind.ROUTE,
        }
        async with session_factory()() as db, db.begin():
            operation, _ = await _current(db, operation_id)
            if not operation:
                return
            failures = operation.payload.get("failures", 0) + 1
            retry = transient and failures < 5
            operation.payload = {**operation.payload, "failures": failures}
            operation.status = "retrying" if retry else "failed"
            operation.message = str(error)
        if retry:
            raise CatalogRetry(error.retry_after) from None
        return
    stations = {data.station} | {item.station for item in data.series}
    logos = {}
    for station in sorted(filter(None, stations)):
        logos[station[0]] = await radio_images.fetch_station_logo(station[0])
    artwork = await radio_images.fetch_artwork(pid, data.image_pid) if data.image_pid else None
    async with session_factory()() as db, db.begin():
        await transaction_lock(db, f"radio-refresh:{show_id}")
        operation, show = await _current(db, operation_id)
        if not operation:
            return
        await apply(db, show, data)
        # Episodes already in the radio library show as in your library straight away.
        from app.domain.radio_library import relink

        await relink(db, show_id=show.id)
        for service_id, path in logos.items():
            if path:
                station = await db.get(RadioStation, service_id)
                station.logo_path, station.logo_fetched_at = path, datetime.now(UTC)
        if artwork:
            show.artwork_path, show.artwork_fetched_at = artwork, datetime.now(UTC)
        series = [item for item in data.series if item.kind == "series"]
        read = sum(len(item.episodes or []) for item in data.series)
        operation.status = "completed"
        operation.message = f"Read {len(series)} series and {read} episodes from the BBC" + (
            f"; {len(skip)} finished series were already up to date" if skip else ""
        )

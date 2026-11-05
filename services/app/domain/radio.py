"""Radio shows (FEAT-R): adding, refreshing and following shows, owned per person.

Shows come from the BBC, podcast feeds (Apple Podcasts shows are saved as their feed) or the
Internet Archive; see radio_sources.

A show is added from a preview (a few BBC requests), then a background job reads every series
and its episodes. BBC responses are cached for an hour through the catalog gateway, requests
are spaced out, and series that are complete and long finished are not read again. Each
refresh also fetches the station logos and the show artwork once (see radio_images).
"""

from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert

from app.adapters import bbc_programmes as bbc_feed
from app.adapters import podcast_feed
from app.adapters.contracts import AdapterError, FailureKind
from app.config import get_settings
from app.db.models import (
    Operation,
    RadioEpisode,
    RadioSeries,
    RadioShow,
    RadioShowAlias,
    RadioStation,
    User,
)
from app.db.session import session_factory
from app.domain import radio_images, radio_sources
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


def check_link(link: str) -> tuple[str, str]:
    """The source and id a pasted link points to (422 when it is not a show's link)."""
    return radio_sources.classify(link)


async def preview(link: str) -> bbc_feed.ShowData:
    return await radio_sources.preview(link)


async def search(query: str) -> list[bbc_feed.SearchResult]:
    """Name search through BBC Sounds (public, no sign-in). Shows only, best match first.

    BBC Sounds leaves out many older shows, so when none of its results has the name asked for,
    the BBC programmes A to Z is read too and its radio shows come first.
    """
    async with bbc(provider="bbc-sounds") as fetch:
        data = await fetch("v2/programmes/search/container", {"q": query})
    found = bbc_feed.search_results(data)
    key = bbc_feed.atoz_key(query)
    if any(bbc_feed.atoz_key(result.title) == key for result in found):
        return found
    try:
        async with bbc() as fetch:
            listed = await bbc_feed.atoz(fetch, query)
    except AdapterError:
        return found
    pids = {result.pid for result in listed}
    return listed + [result for result in found if result.pid not in pids]


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


def episode_status(
    first_broadcast, follow, followed_at, current=None, now=None, monitored=None
) -> str:
    """The status worked out from the broadcast date and the follow choice, or from the choice
    made by hand for this episode (monitored True or False)."""
    if current and current not in COMPUTED:
        return current
    now = now or datetime.now(UTC)
    if first_broadcast and first_broadcast > now:
        return "not_released"
    if monitored is not None:
        return "wanted" if monitored else "not_requested"
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
    """Save what the source returned. Nothing is deleted when the source drops an item: it is
    marked as no longer listed (removed_at), and the mark goes when it comes back. A read that
    was cut short (data.complete is False) or found nothing marks nothing."""
    now = now or datetime.now(UTC)
    show.title, show.synopsis = data.title, data.synopsis
    show.first_broadcast = data.first_broadcast or show.first_broadcast
    show.station_id = await save_station(db, data.station) or show.station_id
    show.image_pid = data.image_pid or show.image_pid
    show.author = data.author or show.author
    show.web_url = data.web_url or show.web_url
    show.artwork_url = data.artwork_url or show.artwork_url
    if data.provider == "archive":
        show.licence = data.licence
    if data.provider == "feed":
        show.feed_validators = list(data.validators) if data.validators else None
    saved = {
        row.pid: row
        for row in await db.scalars(select(RadioSeries).where(RadioSeries.show_id == show.id))
    }
    episodes = {
        row.pid: row
        for row in await db.scalars(select(RadioEpisode).where(RadioEpisode.show_id == show.id))
    }
    listed_series, listed_episodes, read_series = set(), set(), set()
    for item in data.series:
        listed_series.add(item.pid)
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
        row.removed_at = None
        if item.episodes is None:
            continue
        # No ORM relationships, so the series row goes in before its episodes.
        await db.flush()
        row.walked_at = now
        read_series.add(row.id)
        for entry in item.episodes:
            listed_episodes.add(entry.pid)
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
            episode.enclosure_url = entry.enclosure_url or episode.enclosure_url
            episode.removed_at = None
    for pid, seconds in data.durations.items():
        if pid in episodes:
            episodes[pid].duration_seconds = seconds
    if data.complete and (listed_series or listed_episodes):
        for pid, row in saved.items():
            if pid not in listed_series and not row.removed_at:
                row.removed_at = now
        for pid, episode in episodes.items():
            # Only episodes of a series read now: a settled series is not read again.
            if (
                episode.series_id in read_series
                and pid not in listed_episodes
                and not episode.removed_at
            ):
                episode.removed_at = now
    await db.flush()
    restatus(show, episodes.values(), now)
    show.refreshed_at = now


def restatus(show, episodes, now=None):
    for episode in episodes:
        episode.status = episode_status(
            episode.first_broadcast,
            show.follow,
            show.followed_at,
            episode.status,
            now,
            monitored=episode.monitored,
        )


async def owned_show(db, user, show_id, *, lock=False) -> RadioShow:
    query = select(RadioShow).where(RadioShow.id == show_id, RadioShow.owner_id == user.id)
    show = await db.scalar(query.with_for_update() if lock else query)
    if not show:
        raise HTTPException(404, "Show not found")
    return show


def show_keys(data: bbc_feed.ShowData) -> list[tuple[str, str]]:
    """Every (provider, id) a show is known by: its own and the ids that led to it."""
    return list(dict.fromkeys([(data.provider, data.pid), *data.aliases]))


async def existing_show(db, owner_id, keys) -> UUID | None:
    """The person's show known by any of these (provider, id) pairs, by its own id or an alias.
    Feed addresses are compared without the scheme, case or a trailing slash."""
    keys = [(provider, value) for provider, value in keys if value]
    if not keys:
        return None
    feeds = {radio_sources.feed_key(value) for provider, value in keys if provider == "feed"}
    own = or_(*(and_(RadioShow.provider == p, RadioShow.external_id == v) for p, v in keys))
    if feeds:
        own = or_(
            own,
            and_(
                RadioShow.provider == "feed",
                func.rtrim(func.lower(func.split_part(RadioShow.external_id, "://", 2)), "/").in_(
                    feeds
                ),
            ),
        )
    aliased = select(RadioShowAlias.show_id).where(
        or_(*(and_(RadioShowAlias.provider == p, RadioShowAlias.external_id == v) for p, v in keys))
    )
    return await db.scalar(
        select(RadioShow.id)
        .where(RadioShow.owner_id == owner_id, or_(own, RadioShow.id.in_(aliased)))
        .limit(1)
    )


async def save_aliases(db, show_id, keys) -> None:
    for provider, value in keys:
        statement = insert(RadioShowAlias).values(
            show_id=show_id, provider=provider[:20], external_id=value[:1000]
        )
        await db.execute(statement.on_conflict_do_nothing())


async def add(
    db, owner_id, data: bbc_feed.ShowData, follow: str, library_item_id: str | None = None
) -> tuple[RadioShow, Operation]:
    await transaction_lock(db, f"radio-show:{owner_id}:{data.provider}:{data.pid}")
    if await existing_show(db, owner_id, show_keys(data)):
        raise HTTPException(409, "This show is already in your radio shows")
    now = datetime.now(UTC)
    show = RadioShow(
        id=uuid4(),
        owner_id=owner_id,
        provider=data.provider,
        external_id=data.pid,
        title=data.title,
        follow=follow,
        followed_at=now if follow != "none" else None,
        library_item_id=library_item_id,
    )
    db.add(show)
    await db.flush()
    await save_aliases(db, show.id, data.aliases)
    await apply(db, show, data, now)
    # Only the preview has been read so far; the refresh job reads every series (and fetches
    # the artwork), so it must not be skipped as "not changed".
    show.refreshed_at = None
    show.feed_validators = None
    operation = await start_refresh(db, owner_id, show)
    return show, operation


async def set_follow(db, show: RadioShow, follow: str):
    """Change the follow choice; episode statuses and their requests follow it. A new choice
    also wants again the episodes withdrawn in Activity (excluded)."""
    from app.domain.radio_wanted import sync

    if follow == show.follow:
        return
    show.follow = follow
    show.followed_at = datetime.now(UTC) if follow != "none" else None
    episodes = list(await db.scalars(select(RadioEpisode).where(RadioEpisode.show_id == show.id)))
    for episode in episodes:
        # A new follow choice applies to every episode, including those chosen by hand.
        episode.monitored = None
        if episode.status == "excluded":
            episode.status = "not_requested"
    restatus(show, episodes)
    await db.flush()
    await sync(db, [show.id])


async def set_monitored(db, show: RadioShow, episodes, monitored: bool | None):
    """Want or do not want these episodes by hand (None: follow the show again). Their
    statuses and requests follow; an episode withdrawn in Activity can be wanted again."""
    from app.domain.radio_wanted import sync

    episodes = list(episodes)
    for episode in episodes:
        episode.monitored = monitored
        if episode.status == "excluded" and monitored is not False:
            episode.status = "not_requested"
    restatus(show, episodes)
    await db.flush()
    await sync(db, [show.id])


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
        message=f"Waiting to read the show from {source_name(show.provider)}",
    )
    db.add(operation)
    await db.flush()
    show.operation_id = operation.id
    operation.job_id = await enqueue(db, KIND, operation_id=str(operation.id))
    return operation


def source_name(provider: str) -> str:
    return {"bbc": "the BBC", "feed": "its podcast feed", "archive": "the Internet Archive"}.get(
        provider, "its source"
    )


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
        pid, show_id, provider = show.external_id, show.id, show.provider
        validators = tuple(show.feed_validators) if show.feed_validators else None
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
        operation.status = "running"
        operation.message = f"Reading the show from {source_name(provider)}"
    try:
        options = (
            {
                "settled": skip,
                "known_durations": known,
                "stored_missing": missing,
                "duration_budget": DURATION_BUDGET,
            }
            if provider == "bbc"
            else {"validators": validators}
        )
        data = await radio_sources.read_show(provider, pid, **options)
    except podcast_feed.FeedUnchanged:
        async with session_factory()() as db, db.begin():
            operation, show = await _current(db, operation_id)
            if not operation:
                return
            show.refreshed_at = datetime.now(UTC)
            operation.status = "completed"
            operation.message = "The podcast feed has not changed since it was last read"
        return
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
    if provider == "bbc":
        artwork = await radio_images.fetch_artwork(pid, data.image_pid) if data.image_pid else None
    else:
        artwork = (
            await radio_images.fetch_remote_artwork(data.artwork_url) if data.artwork_url else None
        )
    async with session_factory()() as db, db.begin():
        await transaction_lock(db, f"radio-refresh:{show_id}")
        operation, show = await _current(db, operation_id)
        if not operation:
            return
        await apply(db, show, data)
        await save_aliases(db, show.id, data.aliases)
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
        operation.message = (
            f"Read {len(series)} series and {read} episodes from {source_name(provider)}"
        ) + (f"; {len(skip)} finished series were already up to date" if skip else "")

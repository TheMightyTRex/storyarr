"""BBC radio shows from the public /programmes JSON and BBC Sounds search.

The /programmes feed is undocumented, so every read is checked and a missing or changed feed
raises an AdapterError with a plain message. Requests go through a caller-supplied ``fetch``
(see app.domain.radio), which caches responses and spaces requests out.

A show is a brand (or a series with no brand). Its children are series and, sometimes, episodes
listed straight under the brand; those become the "specials" series, number 0. Series and
episodes without a BBC position are numbered in first-broadcast order, after the highest
position the BBC gives.
"""

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from urllib.parse import urlsplit

from app.adapters.contracts import AdapterError, FailureKind

# BBC pids use digits and consonants only, such as b007mf4f or m002vm5p.
PID = re.compile(r"[0-9b-df-hj-np-tv-z]{8,15}")
SERVICE_ID = re.compile(r"[a-z0-9_]{2,60}")
HOSTS = {"bbc.co.uk", "www.bbc.co.uk", "bbc.com", "www.bbc.com"}
# bbc.co.uk/sounds/brand/{pid}, /sounds/series/{pid} and /sounds/play/{pid} (an episode).
SOUNDS_PAGES = {"brand", "series", "play", "episode"}
PAGE_SIZE = 50
MAX_PAGES = 20
CHANGED = (
    "The BBC programme data has changed, so Storyarr cannot read it. "
    "Saved series and episodes are kept."
)

Fetch = Callable[[str, dict | None], Awaitable[dict]]


class LinkError(ValueError):
    pass


def parse_link(value: str) -> str:
    """The pid in a BBC programmes or BBC Sounds link, or a bare pid."""
    value = (value or "").strip()
    if PID.fullmatch(value):
        return value
    if len(value) > 500 or any(ord(character) < 33 for character in value):
        raise LinkError("Paste a BBC programmes or BBC Sounds link, or a programme id")
    if "://" not in value:
        value = "https://" + value
    try:
        parts = urlsplit(value)
        host = (parts.hostname or "").lower()
    except ValueError:
        raise LinkError("Paste a BBC programmes or BBC Sounds link, or a programme id") from None
    if parts.scheme not in {"http", "https"} or host not in HOSTS or parts.username:
        raise LinkError("Paste a link from bbc.co.uk/programmes or bbc.co.uk/sounds")
    segments = [segment for segment in parts.path.split("/") if segment]
    pid = None
    if len(segments) >= 2 and segments[0] == "programmes":
        pid = segments[1].removesuffix(".json")
    elif len(segments) >= 3 and segments[0] == "sounds" and segments[1] in SOUNDS_PAGES:
        pid = segments[2]
    if not pid or not PID.fullmatch(pid):
        raise LinkError("This BBC link does not point to a show or an episode")
    return pid


def when(value) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _text(value, limit=600):
    return value.strip()[:limit] if isinstance(value, str) and value.strip() else None


def _pid(value):
    return value if isinstance(value, str) and PID.fullmatch(value) else None


def _synopsis(item):
    for key in ("long_synopsis", "medium_synopsis", "short_synopsis"):
        if text := _text(item.get(key), 5000):
            return text
    return None


def station_of(item) -> tuple[str, str] | None:
    service = ((item.get("ownership") or {}).get("service")) or {}
    service_id, name = service.get("id"), _text(service.get("title"), 200)
    if isinstance(service_id, str) and SERVICE_ID.fullmatch(service_id) and name:
        return service_id, name
    return None


def image_of(item) -> str | None:
    return _pid((item.get("image") or {}).get("pid"))


@dataclass
class EpisodeData:
    pid: str
    number: int
    number_source: str
    title: str
    synopsis: str | None
    first_broadcast: datetime | None


@dataclass
class SeriesData:
    pid: str
    kind: str
    number: int
    number_source: str
    title: str
    synopsis: str | None
    station: tuple[str, str] | None
    expected_episodes: int | None
    first_broadcast: datetime | None
    # None when the series was not read again (it is settled), so saved episodes stay.
    episodes: list[EpisodeData] | None = None


@dataclass
class ShowData:
    pid: str
    title: str
    synopsis: str | None
    first_broadcast: datetime | None
    station: tuple[str, str] | None
    image_pid: str | None
    series: list[SeriesData] = field(default_factory=list)
    episode_count: int | None = None
    # Episode lengths in seconds, by episode pid (see walk).
    durations: dict[str, int] = field(default_factory=dict)


async def programme(fetch: Fetch, pid: str) -> dict:
    data = await fetch(f"programmes/{pid}.json", None)
    item = data.get("programme") if isinstance(data, dict) else None
    if (
        not isinstance(item, dict)
        or item.get("pid") != pid
        or item.get("type") not in {"brand", "series", "episode", "clip"}
    ):
        raise AdapterError(FailureKind.PARSER, CHANGED)
    return item


async def children(fetch: Fetch, pid: str) -> list[dict]:
    found = []
    for page in range(1, MAX_PAGES + 1):
        data = await fetch(
            f"programmes/{pid}/children.json",
            {"limit": PAGE_SIZE, **({"page": page} if page > 1 else {})},
        )
        listing = data.get("children") if isinstance(data, dict) else None
        items = listing.get("programmes") if isinstance(listing, dict) else None
        total = listing.get("total") if isinstance(listing, dict) else None
        if not isinstance(items, list) or not isinstance(total, int):
            raise AdapterError(FailureKind.PARSER, CHANGED)
        found.extend(item for item in items if isinstance(item, dict) and _pid(item.get("pid")))
        if not items or len(found) >= total:
            break
    return found


def top_pid(item: dict) -> str | None:
    """The brand above an episode or series, or the topmost series when there is no brand."""
    top, node = None, item
    for _ in range(6):
        parent = ((node.get("parent") or {}).get("programme")) or None
        if not isinstance(parent, dict):
            break
        if parent.get("type") in {"brand", "series"} and _pid(parent.get("pid")):
            top = parent["pid"]
        node = parent
    return top


async def resolve(fetch: Fetch, pid: str) -> dict:
    """The show's top programme for any pid in it (an episode resolves to its brand)."""
    item = await programme(fetch, pid)
    if item["type"] == "brand":
        return item
    top = top_pid(item)
    if top and top != pid:
        return await programme(fetch, top)
    if item["type"] == "series":
        return item
    raise AdapterError(
        FailureKind.NOT_FOUND,
        "This is a single programme, not part of a show. Paste a link to the show instead.",
    )


def numbered(items: list[dict]) -> list[tuple[dict, int, str]]:
    """BBC position when it is given; otherwise first-broadcast order after the last position."""
    taken = [
        item["position"]
        for item in items
        if isinstance(item.get("position"), int) and item["position"] > 0
    ]
    result = [(item, item["position"], "bbc") for item in items if item.get("position") in taken]
    following = max(taken, default=0)
    loose = [item for item in items if item.get("position") not in taken]
    far = datetime.max.replace(tzinfo=UTC)
    loose.sort(key=lambda item: (when(item.get("first_broadcast_date")) or far, item["pid"]))
    for item in loose:
        following += 1
        result.append((item, following, "broadcast_order"))
    return sorted(result, key=lambda entry: entry[1])


def _episode(item, number, source):
    return EpisodeData(
        pid=item["pid"],
        number=number,
        number_source=source,
        title=_text(item.get("title")) or f"Episode {number}",
        synopsis=_synopsis(item),
        first_broadcast=when(item.get("first_broadcast_date")),
    )


def episodes_of(items: list[dict]) -> list[EpisodeData]:
    return [_episode(item, number, source) for item, number, source in numbered(items)]


async def _series_episodes(fetch: Fetch, pid: str, depth=0) -> list[dict]:
    """Episodes of a series; a series inside a series is folded into its parent."""
    found = []
    nested = False
    for item in await children(fetch, pid):
        if item.get("type") == "episode":
            found.append(item)
        elif item.get("type") == "series" and depth < 2:
            nested = True
            found.extend(await _series_episodes(fetch, item["pid"], depth + 1))
    if nested:
        # Positions repeat across folded series; broadcast order is the only safe order.
        found = [{**item, "position": None} for item in found]
    return found


async def preview(fetch: Fetch, pid: str) -> ShowData:
    """The show and its series list, without reading every series (a few requests)."""
    top = await resolve(fetch, pid)
    show = _show(top)
    if top["type"] == "series":
        show.series = [_single_series(top)]
        return show
    kids = await children(fetch, top["pid"])
    show.series = _series_list(top, kids)
    return show


def _show(top):
    title = _text(top.get("title"))
    if not title:
        raise AdapterError(FailureKind.PARSER, CHANGED)
    count = top.get("aggregated_episode_count")
    return ShowData(
        pid=top["pid"],
        title=title,
        synopsis=_synopsis(top),
        first_broadcast=when(top.get("first_broadcast_date")),
        station=station_of(top),
        image_pid=image_of(top),
        episode_count=count if isinstance(count, int) and count >= 0 else None,
    )


def _single_series(top):
    position = top.get("position")
    return SeriesData(
        pid=top["pid"],
        kind="series",
        number=position if isinstance(position, int) and position > 0 else 1,
        number_source="bbc" if isinstance(position, int) and position > 0 else "broadcast_order",
        title=_text(top.get("title")) or "Series 1",
        synopsis=_synopsis(top),
        station=station_of(top),
        expected_episodes=_count(top.get("expected_child_count")),
        first_broadcast=when(top.get("first_broadcast_date")),
    )


def _count(value):
    return value if isinstance(value, int) and value >= 0 else None


def _series_list(top, kids):
    # The station of each series is read with the series itself (see walk).
    series = [item for item in kids if item.get("type") == "series"]
    result = [
        SeriesData(
            pid=item["pid"],
            kind="series",
            number=number,
            number_source=source,
            title=_text(item.get("title")) or f"Series {number}",
            synopsis=_synopsis(item),
            station=None,
            expected_episodes=_count(item.get("expected_child_count")),
            first_broadcast=when(item.get("first_broadcast_date")),
        )
        for item, number, source in numbered(series)
    ]
    loose = [item for item in kids if item.get("type") == "episode"]
    if loose:
        starts = [when(item.get("first_broadcast_date")) for item in loose]
        result.append(
            SeriesData(
                pid=top["pid"],
                kind="specials",
                number=0,
                number_source="bbc",
                title="Specials",
                synopsis=None,
                station=None,
                expected_episodes=None,
                first_broadcast=min((start for start in starts if start), default=None),
                episodes=episodes_of(loose),
            )
        )
    return result


async def walk(
    fetch: Fetch,
    pid: str,
    *,
    settled: set[str] = frozenset(),
    known_durations: set[str] = frozenset(),
    stored_missing: list[tuple[str, datetime]] = (),
    duration_budget: int = 0,
) -> ShowData:
    """The whole show. Series in ``settled`` are listed but not read again.

    Episode lengths need a request each, so at most ``duration_budget`` are read, newest
    broadcast first, from episodes read now and saved episodes still without a length."""
    show = await preview(fetch, pid)
    top_is_series = len(show.series) == 1 and show.series[0].pid == show.pid
    for series in show.series:
        if series.kind == "specials":
            continue
        if series.pid in settled:
            continue
        if top_is_series:
            items = await _series_episodes(fetch, series.pid)
        else:
            detail = await programme(fetch, series.pid)
            series.station = station_of(detail) or show.station
            series.synopsis = _synopsis(detail) or series.synopsis
            items = await _series_episodes(fetch, series.pid)
        series.episodes = episodes_of(items)
    if duration_budget > 0:
        now = datetime.now(UTC)
        candidates = {
            episode.pid: episode.first_broadcast
            for series in show.series
            for episode in series.episodes or []
            if episode.pid not in known_durations
        }
        candidates.update({pid: start for pid, start in stored_missing})
        due = sorted(
            ((start, pid) for pid, start in candidates.items() if start and start <= now),
            reverse=True,
        )
        for _, pid in due[:duration_budget]:
            try:
                seconds = duration(await programme(fetch, pid))
            except AdapterError as error:
                # Lengths are a nicety: a missing episode page is skipped, a limit stops here.
                if error.kind == FailureKind.RATE_LIMIT:
                    break
                continue
            if seconds:
                show.durations[pid] = seconds
    return show


def duration(item: dict) -> int | None:
    versions = [version for version in item.get("versions") or [] if isinstance(version, dict)]
    versions.sort(key=lambda version: version.get("canonical") != 1)
    for version in versions:
        seconds = version.get("duration")
        if isinstance(seconds, int) and 0 < seconds < 24 * 3600:
            return seconds
    return None


@dataclass
class SearchResult:
    pid: str
    title: str
    synopsis: str | None
    station_id: str | None
    station_name: str | None
    image_pid: str | None


def search_results(data: dict) -> list[SearchResult]:
    """Shows from BBC Sounds container search (rms.api.bbc.co.uk/v2/programmes/search/container)."""
    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise AdapterError(
            FailureKind.PARSER, "BBC Sounds search has changed. Paste a link to the show instead."
        )
    results = []
    for item in items:
        if not isinstance(item, dict) or item.get("type") != "container_item":
            continue
        pid = _pid(item.get("id"))
        title = _text((item.get("titles") or {}).get("primary"))
        if not pid or not title:
            continue
        network = item.get("network") or {}
        service_id = network.get("id") if isinstance(network, dict) else None
        image = re.search(r"/([0-9b-df-hj-np-tv-z]{8,15})\.jpg$", str(item.get("image_url") or ""))
        results.append(
            SearchResult(
                pid=pid,
                title=title,
                synopsis=_text((item.get("synopses") or {}).get("short"), 1000),
                station_id=service_id
                if isinstance(service_id, str) and SERVICE_ID.fullmatch(service_id)
                else None,
                station_name=_text(network.get("short_title"), 200)
                if isinstance(network, dict)
                else None,
                image_pid=image[1] if image else None,
            )
        )
    return results

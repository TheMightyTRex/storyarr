"""Radio shows from podcast feeds (RSS 2.0 with the iTunes podcast tags).

A feed is one show. Items with `itunes:season` go to that series; items with no season go to
series 1; trailers and bonus items (`itunes:episodeType`) go to the specials. An item's id is
its guid, else its audio address, else its link, else its title. Episodes keep the number the
feed gives (`itunes:episode`); the rest are numbered in broadcast order with the lowest numbers
not already taken.

A web page that advertises a feed (`<link rel="alternate" type="application/rss+xml">`) is
followed once. Parsing uses defusedxml, so entity expansion and external entities are refused.
"""

import hashlib
import re
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from xml.etree.ElementTree import Element, ParseError

from defusedxml import DefusedXmlException
from defusedxml.ElementTree import fromstring

from app.adapters.bbc_programmes import EpisodeData, SeriesData, ShowData
from app.adapters.contracts import AdapterError, FailureKind

ITUNES = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"
CONTENT = "{http://purl.org/rss/1.0/modules/content/}"
MAX_FEED = 10 * 1024 * 1024
MAX_ITEMS = 5000
ID_LENGTH = 200
FEED_TYPES = {
    "application/rss+xml",
    "application/atom+xml",
    "application/xml",
    "text/xml",
}
ACCEPT = "application/rss+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5"
SPECIAL_TYPES = {"trailer", "bonus"}
NOT_A_FEED = "This address is not a podcast feed, and its page does not link to one."


def unreadable(message=NOT_A_FEED) -> AdapterError:
    return AdapterError(FailureKind.PARSER, message)


class _FeedLinks(HTMLParser):
    """The feeds a web page advertises in its <head>."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag != "link":
            return
        values = {key.lower(): (value or "") for key, value in attrs}
        rels = values.get("rel", "").lower().split()
        if "alternate" in rels and values.get("type", "").lower() in {
            "application/rss+xml",
            "application/atom+xml",
        }:
            if values.get("href"):
                self.links.append(values["href"])


def feed_link(page_url: str, html: bytes) -> str | None:
    """The first feed address a web page advertises, made absolute."""
    parser = _FeedLinks()
    try:
        parser.feed(html[: 2 * 1024 * 1024].decode("utf-8", "replace"))
    except (ValueError, AssertionError):
        return None
    for link in parser.links:
        address = urljoin(page_url, link.strip())
        if urlsplit(address).scheme in {"http", "https"}:
            return address
    return None


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_starttag(self, tag, attrs):
        if tag in {"br", "p", "li", "div"}:
            self.parts.append("\n")


def plain(value: str | None, limit=5000) -> str | None:
    """Show notes as plain text: tags removed, runs of spaces and blank lines closed up."""
    if not value or not value.strip():
        return None
    parser = _Text()
    try:
        parser.feed(value)
        parser.close()
        text = "".join(parser.parts)
    except (ValueError, AssertionError):
        text = re.sub(r"<[^>]*>", " ", value)
    lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in text.split("\n")]
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return text[:limit] or None


def _child(node: Element, name: str) -> str | None:
    found = node.find(name)
    if found is None or found.text is None:
        return None
    return found.text.strip() or None


def _web(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    if len(value) > 1000 or urlsplit(value).scheme not in {"http", "https"}:
        return None
    return value


def published(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        moment = parsedate_to_datetime(value.strip())
    except (TypeError, ValueError, IndexError):
        try:
            moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def duration(value: str | None) -> int | None:
    """itunes:duration as HH:MM:SS, MM:SS or seconds."""
    if not value:
        return None
    value = value.strip()
    try:
        if ":" in value:
            parts = [float(part) for part in value.split(":")]
            if len(parts) > 3 or any(part < 0 for part in parts):
                return None
            seconds = 0.0
            for part in parts:
                seconds = seconds * 60 + part
        else:
            seconds = float(value)
    except ValueError:
        return None
    return round(seconds) if 0 < seconds < 48 * 3600 else None


def _number(value: str | None) -> int | None:
    if value and value.strip().isdigit():
        number = int(value.strip())
        return number if 0 < number < 100_000 else None
    return None


def item_id(guid, enclosure, link, title) -> str | None:
    """The episode id: the guid, else the audio address, else the link, else the title. Ids
    longer than the column are kept as a digest, which stays the same between reads."""
    for value in (guid, enclosure, link, title):
        if value and value.strip():
            value = value.strip()
            if len(value) <= ID_LENGTH:
                return value
            return "sha1:" + hashlib.sha1(value.encode(), usedforsecurity=False).hexdigest()
    return None


def number_episodes(entries: list[tuple[int | None, EpisodeData]]) -> list[EpisodeData]:
    """Numbers the feed gives are kept (the first item to claim a number keeps it); the rest get
    the lowest free numbers in broadcast order, undated items last."""
    taken: set[int] = set()
    numbered, loose = [], []
    for number, episode in entries:
        if number is not None and number not in taken:
            taken.add(number)
            episode.number, episode.number_source = number, "source"
            numbered.append(episode)
        else:
            loose.append(episode)
    far = datetime.max.replace(tzinfo=UTC)
    loose.sort(key=lambda episode: (episode.first_broadcast or far, episode.pid))
    following = 1
    for episode in loose:
        while following in taken:
            following += 1
        episode.number, episode.number_source = following, "broadcast_order"
        taken.add(following)
    return sorted(numbered + loose, key=lambda episode: episode.number)


def parse(feed_url: str, body: bytes) -> ShowData:
    try:
        root = fromstring(body)
    except (ParseError, DefusedXmlException, ValueError):
        raise unreadable() from None
    channel = root.find("channel") if root.tag == "rss" else None
    if channel is None:
        raise unreadable()
    title = _child(channel, "title")
    if not title:
        raise unreadable("This podcast feed has no title.")
    image = channel.find(f"{ITUNES}image")
    artwork = _web(image.get("href")) if image is not None else None
    artwork = artwork or _web(_child(channel, "image/url"))
    seasons: dict[int, list[tuple[int | None, EpisodeData]]] = {}
    specials: list[tuple[int | None, EpisodeData]] = []
    seen: set[str] = set()
    for item in channel.findall("item")[:MAX_ITEMS]:
        enclosure_node = item.find("enclosure")
        enclosure = _web(enclosure_node.get("url")) if enclosure_node is not None else None
        guid = _child(item, "guid")
        name = plain(_child(item, "title"), 600)
        key = item_id(guid, enclosure, _child(item, "link"), name)
        if not key or key in seen:
            continue
        seen.add(key)
        episode = EpisodeData(
            pid=key,
            number=0,
            number_source="source",
            title=name or "Untitled episode",
            synopsis=plain(_child(item, f"{CONTENT}encoded") or _child(item, "description"))
            or plain(_child(item, f"{ITUNES}summary")),
            first_broadcast=published(_child(item, "pubDate")),
            enclosure_url=enclosure,
            duration_seconds=duration(_child(item, f"{ITUNES}duration")),
        )
        number = _number(_child(item, f"{ITUNES}episode"))
        kind = (_child(item, f"{ITUNES}episodeType") or "").lower()
        if kind in SPECIAL_TYPES:
            specials.append((number, episode))
            continue
        season = _number(_child(item, f"{ITUNES}season")) or 1
        seasons.setdefault(season, []).append((number, episode))
    series = []
    for season in sorted(seasons):
        episodes = number_episodes(seasons[season])
        series.append(
            SeriesData(
                pid=f"season:{season}",
                kind="series",
                number=season,
                number_source="source",
                title=f"Series {season}",
                synopsis=None,
                station=None,
                expected_episodes=None,
                first_broadcast=min(
                    (episode.first_broadcast for episode in episodes if episode.first_broadcast),
                    default=None,
                ),
                episodes=episodes,
            )
        )
    if specials:
        episodes = number_episodes(specials)
        series.append(
            SeriesData(
                pid="specials",
                kind="specials",
                number=0,
                number_source="source",
                title="Specials",
                synopsis=None,
                station=None,
                expected_episodes=None,
                first_broadcast=None,
                episodes=episodes,
            )
        )
    dates = [
        episode.first_broadcast
        for item in series
        for episode in item.episodes or []
        if episode.first_broadcast
    ]
    show = ShowData(
        pid=feed_url,
        title=plain(title, 600) or title[:600],
        synopsis=plain(_child(channel, "description") or _child(channel, f"{ITUNES}summary")),
        first_broadcast=min(dates, default=None),
        station=None,
        image_pid=None,
        series=series,
        episode_count=sum(len(item.episodes or []) for item in series),
        provider="feed",
        author=plain(_child(channel, f"{ITUNES}author") or _child(channel, "managingEditor"), 300),
        web_url=_web(_child(channel, "link")),
        artwork_url=artwork,
    )
    show.durations = {
        episode.pid: episode.duration_seconds
        for item in series
        for episode in item.episodes or []
        if episode.duration_seconds
    }
    return show


def looks_like_feed(content_type: str, body: bytes) -> bool:
    if content_type in FEED_TYPES:
        return True
    head = body[:1024].lstrip().lower()
    return head.startswith(b"<?xml") or head.startswith(b"<rss")


async def read(url: str, fetch) -> ShowData:
    """The show behind a feed address, or behind a web page that links to its feed.
    ``fetch(url)`` returns a public_web.Page."""
    page = await fetch(url)
    if not looks_like_feed(page.content_type, page.body):
        found = feed_link(page.url, page.body)
        if not found:
            raise unreadable()
        page = await fetch(found)
        if not looks_like_feed(page.content_type, page.body):
            raise unreadable()
    show = parse(page.url, page.body)
    if page.url != url:
        show.aliases.append(("feed", url[:1000]))
    return show

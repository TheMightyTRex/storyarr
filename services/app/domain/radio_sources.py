"""Where radio shows come from (RADIO-02): the BBC, podcast feeds, Apple Podcasts and the
Internet Archive's old-time radio.

A link decides its source: a BBC programmes or Sounds link (or a bare pid) is the BBC, a
podcasts.apple.com link is looked up and saved as its feed, an archive.org/details link is the
Internet Archive, and any other web address is read as a feed (or a page that links to one).

Search by name asks the sources a person has turned on that suit their country and language:
the BBC is for the United Kingdom and English, Welsh or Scottish Gaelic; the others are for
everywhere. Sources for the person's own country come first; the same feed found twice is
listed once. One source failing does not stop the others.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from fastapi import HTTPException

from app.adapters import apple_podcasts, archive_radio, podcast_feed, public_web
from app.adapters import bbc_programmes as bbc_feed
from app.adapters.contracts import AdapterError, FailureKind
from app.domain.catalog_network import CatalogGateway

LOG = logging.getLogger(__name__)
SOURCES = ("bbc", "apple", "archive")
SOURCE_NAMES = {
    "bbc": "BBC",
    "apple": "Apple Podcasts",
    "archive": "Internet Archive",
    "feed": "Podcast feed",
}
BBC_COUNTRIES = {"GB"}
BBC_LANGUAGES = {"en", "cy", "gd"}
REQUEST_INTERVAL = 1.5
# Tests replace these: an httpx transport for the gateway and for public addresses, and the
# name resolver for public addresses.
TRANSPORT = None
PUBLIC_TRANSPORT = None
PUBLIC_RESOLVER = None
LINK_HELP = (
    "Paste a link to a show: BBC programmes or BBC Sounds, Apple Podcasts, archive.org, "
    "or a podcast feed"
)


@dataclass
class Prefs:
    """A person's radio choices: their country (two letters, or None for anywhere), their
    language (or None for any) and the sources turned on."""

    country: str | None = None
    language: str | None = None
    sources: tuple[str, ...] = SOURCES


@dataclass
class Hit:
    source: str
    # What to preview and add: a BBC programmes link, a feed address or an archive.org link.
    link: str
    title: str
    synopsis: str | None = None
    author: str | None = None
    station_id: str | None = None
    station_name: str | None = None
    artwork_url: str | None = None
    # BBC only, for the BBC artwork address the page builds.
    pid: str | None = None
    image_pid: str | None = None
    licence: str | None = None
    # Other ids this hit is known by, to mark it as already in the person's radio shows.
    keys: list[tuple[str, str]] = field(default_factory=list)


@dataclass
class SearchOutcome:
    hits: list[Hit]
    # Sources that did not answer, by name, so the page can say so.
    failed: list[str]


def bbc_link(pid: str) -> str:
    return f"https://www.bbc.co.uk/programmes/{pid}"


def classify(link: str) -> tuple[str, str]:
    """(kind, value) for a pasted link: bbc and a pid, apple and an id, archive and an
    identifier, or feed and a web address."""
    value = (link or "").strip()
    if not value or len(value) > 1000:
        raise HTTPException(422, LINK_HELP)
    if bbc_feed.PID.fullmatch(value):
        return "bbc", value
    address = value if "://" in value else "https://" + value
    try:
        host = (urlsplit(address).hostname or "").lower()
    except ValueError:
        raise HTTPException(422, LINK_HELP) from None
    if host in bbc_feed.HOSTS:
        try:
            return "bbc", bbc_feed.parse_link(value)
        except bbc_feed.LinkError as error:
            raise HTTPException(422, str(error)) from None
    if apple_id := apple_podcasts.show_id(value):
        return "apple", apple_id
    if host in apple_podcasts.HOSTS:
        raise HTTPException(422, "This Apple Podcasts link does not point to a show")
    if identifier := archive_radio.identifier(value):
        return "archive", identifier
    if host in archive_radio.HOSTS:
        raise HTTPException(422, "Paste an archive.org/details link to an item")
    try:
        public_web.checked_url(address)
    except AdapterError:
        raise HTTPException(422, LINK_HELP) from None
    if "." not in host and ":" not in host:
        raise HTTPException(422, LINK_HELP)
    return "feed", address


def friendly(source: str, error: AdapterError) -> AdapterError:
    name = SOURCE_NAMES.get(source, "The source")
    messages = {
        FailureKind.RATE_LIMIT: f"{name} is limiting requests. Storyarr will try again later.",
        FailureKind.TIMEOUT: f"{name} did not answer in time. Try again later.",
    }
    if error.kind in messages:
        return AdapterError(error.kind, messages[error.kind], retry_after=error.retry_after)
    if source == "feed" or error.kind in {FailureKind.NOT_FOUND, FailureKind.PARSER}:
        return error
    return AdapterError(
        error.kind, f"{name} could not be reached. Try again later.", retry_after=error.retry_after
    )


@asynccontextmanager
async def gateway(provider: str):
    """A cached, paced reader for Apple Podcasts or the Internet Archive."""
    async with CatalogGateway(
        provider, "public", request_interval=REQUEST_INTERVAL, transport=TRANSPORT
    ) as reader:

        async def fetch(path, params):
            try:
                return await reader.request("GET", path, params=params)
            except AdapterError as error:
                raise friendly(provider, error) from None

        yield fetch


async def read_page(url: str) -> public_web.Page:
    options = {"resolver": PUBLIC_RESOLVER} if PUBLIC_RESOLVER else {}
    return await public_web.fetch(
        url,
        accept=podcast_feed.ACCEPT,
        limit=podcast_feed.MAX_FEED,
        transport=PUBLIC_TRANSPORT,
        **options,
    )


async def read_feed(url: str) -> bbc_feed.ShowData:
    try:
        return await podcast_feed.read(url, read_page)
    except AdapterError as error:
        raise friendly("feed", error) from None


async def preview(link: str) -> bbc_feed.ShowData:
    """What a link points to, from its source (a few requests; nothing is saved)."""
    from app.domain import radio

    kind, value = classify(link)
    if kind == "bbc":
        async with radio.bbc() as fetch:
            return await bbc_feed.preview(fetch, value)
    if kind == "apple":
        async with gateway("apple") as fetch:
            hit = await apple_podcasts.lookup(fetch, value)
        show = await read_feed(hit.feed_url)
        show.aliases.append(("apple", value))
        show.artwork_url = show.artwork_url or hit.artwork_url
        return show
    if kind == "archive":
        async with gateway("archive") as fetch:
            return await archive_radio.item(fetch, value)
    return await read_feed(value)


async def read_show(provider: str, external_id: str, **bbc_options) -> bbc_feed.ShowData:
    """The whole show again, for a refresh."""
    from app.domain import radio

    if provider == "bbc":
        async with radio.bbc() as fetch:
            return await bbc_feed.walk(fetch, external_id, **bbc_options)
    if provider == "archive":
        async with gateway("archive") as fetch:
            return await archive_radio.item(fetch, external_id)
    if provider == "feed":
        return await read_feed(external_id)
    raise AdapterError(FailureKind.UNSUPPORTED, "Storyarr cannot read this kind of show")


def offered(prefs: Prefs) -> list[str]:
    """The sources to search, the person's own country first."""
    chosen = [source for source in SOURCES if source in prefs.sources]
    if "bbc" in chosen and (
        (prefs.country and prefs.country not in BBC_COUNTRIES)
        or (prefs.language and prefs.language not in BBC_LANGUAGES)
    ):
        chosen.remove("bbc")
    return chosen


def feed_key(url: str) -> str:
    """Feed addresses compared without the scheme, case or a trailing slash."""
    return url.split("://", 1)[-1].lower().rstrip("/")


async def _search_bbc(query: str) -> list[Hit]:
    from app.domain import radio

    return [
        Hit(
            source="bbc",
            link=bbc_link(item.pid),
            title=item.title,
            synopsis=item.synopsis,
            station_id=item.station_id,
            station_name=item.station_name,
            pid=item.pid,
            image_pid=item.image_pid,
            keys=[("bbc", item.pid)],
        )
        for item in await radio.search(query)
    ]


async def _search_apple(query: str, prefs: Prefs) -> list[Hit]:
    async with gateway("apple") as fetch:
        found = await apple_podcasts.search(fetch, query, prefs.country)
    return [
        Hit(
            source="apple",
            link=item.feed_url,
            title=item.title,
            author=item.author,
            synopsis=item.genre,
            artwork_url=item.artwork_url,
            keys=[("apple", item.apple_id), ("feed", item.feed_url)],
        )
        for item in found
    ]


async def _search_archive(query: str) -> list[Hit]:
    async with gateway("archive") as fetch:
        found = await archive_radio.search(fetch, query)
    return [
        Hit(
            source="archive",
            link=f"https://archive.org/details/{item.identifier}",
            title=item.title,
            author=item.author,
            synopsis=item.synopsis,
            artwork_url=f"https://archive.org/services/img/{item.identifier}",
            licence=item.licence,
            keys=[("archive", item.identifier)],
        )
        for item in found
    ]


async def search(query: str, prefs: Prefs) -> SearchOutcome:
    sources = offered(prefs)
    calls = {
        "bbc": lambda: _search_bbc(query),
        "apple": lambda: _search_apple(query, prefs),
        "archive": lambda: _search_archive(query),
    }
    answers = await asyncio.gather(*(calls[source]() for source in sources), return_exceptions=True)
    hits, failed, seen = [], [], set()
    for source, answer in zip(sources, answers, strict=True):
        if isinstance(answer, BaseException):
            if not isinstance(answer, AdapterError | HTTPException):
                LOG.warning("Radio search in %s failed: %s", source, type(answer).__name__)
            failed.append(SOURCE_NAMES[source])
            continue
        for hit in answer:
            key = feed_key(hit.link) if hit.source == "apple" else (hit.source, hit.link)
            if key in seen:
                continue
            seen.add(key)
            hits.append(hit)
    if failed and not hits and len(failed) == len(sources):
        raise AdapterError(
            FailureKind.UNAVAILABLE, "No radio source could be reached. Try again later."
        )
    return SearchOutcome(hits=hits, failed=failed)

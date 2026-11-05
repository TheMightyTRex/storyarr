"""Apple Podcasts: search by name and links to a show, handed on to the show's feed.

Apple only says where a show's feed is, so a show found here is saved as that feed: it then
keeps working if Apple's search changes. No key is needed. Requests go through a caller-supplied
``fetch(path, params)`` (the catalog gateway: cached and spaced out).
"""

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from app.adapters.contracts import AdapterError, FailureKind

HOSTS = {"podcasts.apple.com", "itunes.apple.com"}
SHOW_ID = re.compile(r"/id(\d{3,15})(?:$|[/?])")
COUNTRY = re.compile(r"[A-Z]{2}")


@dataclass
class PodcastHit:
    apple_id: str
    title: str
    author: str | None
    feed_url: str
    artwork_url: str | None
    genre: str | None


def show_id(link: str) -> str | None:
    """The Apple id in a podcasts.apple.com link, or None for other links."""
    try:
        parts = urlsplit(link if "://" in link else "https://" + link)
    except ValueError:
        return None
    if (parts.hostname or "").lower() not in HOSTS:
        return None
    match = SHOW_ID.search(parts.path + "/")
    return match[1] if match else None


def _web(value) -> str | None:
    if isinstance(value, str) and value.startswith(("https://", "http://")) and len(value) < 1000:
        return value
    return None


def _hits(data: dict) -> list[PodcastHit]:
    results = data.get("results")
    if not isinstance(results, list):
        raise AdapterError(
            FailureKind.PARSER, "Apple Podcasts sent an answer Storyarr cannot read."
        )
    hits = []
    for item in results:
        if not isinstance(item, dict):
            continue
        feed = _web(item.get("feedUrl"))
        title = item.get("collectionName") or item.get("trackName")
        if not feed or not isinstance(title, str) or not item.get("collectionId"):
            continue
        hits.append(
            PodcastHit(
                apple_id=str(item["collectionId"]),
                title=title.strip()[:600],
                author=item.get("artistName") if isinstance(item.get("artistName"), str) else None,
                feed_url=feed,
                artwork_url=_web(item.get("artworkUrl600")) or _web(item.get("artworkUrl100")),
                genre=item.get("primaryGenreName")
                if isinstance(item.get("primaryGenreName"), str)
                else None,
            )
        )
    return hits


def country_code(country: str | None) -> str:
    country = (country or "").upper()
    return country if COUNTRY.fullmatch(country) else "US"


async def search(fetch, term: str, country: str | None, limit: int = 15) -> list[PodcastHit]:
    data = await fetch(
        "search",
        {
            "media": "podcast",
            "entity": "podcast",
            "term": term[:100],
            "country": country_code(country),
            "limit": limit,
        },
    )
    return _hits(data)


async def lookup(fetch, apple_id: str) -> PodcastHit:
    data = await fetch("lookup", {"id": apple_id, "entity": "podcast"})
    hits = _hits(data)
    if not hits:
        raise AdapterError(
            FailureKind.NOT_FOUND, "Apple Podcasts has no show with a feed for this link."
        )
    return hits[0]

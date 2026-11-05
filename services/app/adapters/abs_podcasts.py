"""Audiobookshelf podcast libraries, read for radio (FEAT-R, R3).

The book reader (audiobookshelf.py) skips podcast libraries. This reads them on their own: the
libraries and their folders, then each show with its episodes. Only the facts needed to match an
episode to a BBC episode are kept, never descriptions.
"""

import logging
import re
from datetime import UTC, datetime

from pydantic import BaseModel, Field

from app.adapters.audiobookshelf import Audiobookshelf, backend_path, external_id
from app.adapters.batching import read_batches
from app.adapters.contracts import AdapterError, FailureKind

logger = logging.getLogger(__name__)
# BBC pids: a letter then seven letters or digits with no vowels, such as p0nyr5cl or b006qykl.
PID = re.compile(r"(?<![0-9a-z])([bpmwl][0-9bcdfghjklmnpqrstvwxyz]{7})(?![0-9a-z])")
BATCH = 5
DETAIL_BYTES = 48 * 1024 * 1024


class PodcastLibrary(BaseModel):
    id: str
    name: str
    folders: list[str]


class PodcastEpisode(BaseModel):
    id: str
    title: str
    season: int | None = None
    episode: int | None = None
    pid: str | None = None
    # The feed item's guid and audio address, for exact matches with shows from feeds.
    guid: str | None = None
    enclosure_url: str | None = None
    published_at: datetime | None = None
    duration_seconds: int | None = None
    path: str
    size: int = Field(ge=0)


class PodcastShow(BaseModel):
    id: str
    title: str
    path: str
    episodes: list[PodcastEpisode]


def find_pid(*values) -> str | None:
    """The first BBC pid in the guid, the download link or the file name, in that order."""
    for value in values:
        if isinstance(value, str) and (match := PID.search(value.lower())):
            return match.group(1)
    return None


def _number(value) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool):
        return value if 0 <= value < 100_000 else None
    if isinstance(value, str) and value.strip().isdigit():
        return _number(int(value.strip()))
    return None


def _short(value, limit: int) -> str | None:
    """A text value that fits its column, or None (a longer one cannot be an exact match)."""
    if isinstance(value, str) and value.strip() and len(value.strip()) <= limit:
        return value.strip()
    return None


def _published(value) -> datetime | None:
    if isinstance(value, int | float) and not isinstance(value, bool) and value > 0:
        return datetime.fromtimestamp(value / 1000, UTC)
    return None


def parse_episode(value: dict) -> PodcastEpisode | None:
    """One episode, or None when it has no audio file yet (listed in the feed, not downloaded)."""
    audio = value.get("audioFile")
    if not isinstance(audio, dict) or audio.get("exclude"):
        return None
    file = audio["metadata"]
    title = value.get("title")
    enclosure = value.get("enclosure") if isinstance(value.get("enclosure"), dict) else {}
    duration = audio.get("duration")
    return PodcastEpisode(
        id=external_id(value["id"]),
        title=(title.strip() if isinstance(title, str) and title.strip() else file["filename"])[
            :600
        ],
        season=_number(value.get("season")),
        episode=_number(value.get("episode")),
        pid=find_pid(value.get("guid"), enclosure.get("url"), file.get("filename")),
        guid=_short(value.get("guid"), 500),
        enclosure_url=_short(enclosure.get("url"), 2000),
        published_at=_published(value.get("publishedAt")),
        duration_seconds=round(duration) if isinstance(duration, int | float) else None,
        path=file["path"],
        size=file["size"],
    )


def _readable_episode(value) -> PodcastEpisode | None:
    """One unreadable episode is skipped, so it cannot hide the rest of the show."""
    try:
        return parse_episode(value) if isinstance(value, dict) else None
    except (KeyError, TypeError, ValueError, AttributeError, AdapterError):
        logger.warning("Skipped an Audiobookshelf podcast episode Storyarr could not read")
        return None


def parse_show(value: dict) -> PodcastShow:
    try:
        if value.get("mediaType") != "podcast":
            raise ValueError("Unexpected media type")
        media = value["media"]
        title = media["metadata"]["title"]
        if not isinstance(title, str) or not title.strip():
            raise ValueError("Missing title")
        episodes = media.get("episodes") or []
        if not isinstance(episodes, list):
            raise ValueError("Invalid episode list")
        return PodcastShow(
            id=external_id(value["id"]),
            title=title.strip()[:600],
            path=value["path"],
            episodes=[episode for entry in episodes if (episode := _readable_episode(entry))],
        )
    except (KeyError, TypeError, ValueError, AttributeError) as error:
        raise AdapterError(
            FailureKind.PARSER, "Audiobookshelf returned a podcast show Storyarr cannot read."
        ) from error


async def podcast_libraries(client: Audiobookshelf) -> list[PodcastLibrary]:
    response = await client.request("GET", "api/libraries")
    values = response.get("libraries")
    if not isinstance(values, list):
        raise AdapterError(FailureKind.PARSER, "Audiobookshelf returned an invalid library list.")
    result = []
    for library in values:
        if not isinstance(library, dict) or library.get("mediaType") != "podcast":
            continue
        folders = []
        for folder in library.get("folders") or []:
            try:
                folders.append(backend_path(folder.get("fullPath") or folder.get("path")))
            except (ValueError, AttributeError):
                continue
        name = library.get("name")
        result.append(
            PodcastLibrary(
                id=external_id(library.get("id")),
                name=name[:200] if isinstance(name, str) else "Podcasts",
                folders=folders,
            )
        )
    return result


async def podcast_shows(client: Audiobookshelf, library_id: str):
    """Every show in the library with its downloaded episodes, a few shows per request."""
    ids, page = [], 0
    while True:
        rows, total = await client._summary_page(library_id, page, client.page_size)
        ids.extend(external_id(row["id"]) for row in rows)
        page += 1
        if len(ids) >= total or not rows:
            break

    async def details(batch):
        response = await client.request(
            "POST",
            "api/items/batch/get",
            json={"libraryItemIds": batch},
            max_bytes=DETAIL_BYTES,
            response_label="Audiobookshelf podcast details",
        )
        values = response.get("libraryItems")
        if not isinstance(values, list):
            raise AdapterError(FailureKind.UNCERTAIN, "Podcast details changed during sync.")
        shows = []
        for value in values:
            try:
                shows.append(parse_show(value))
            except AdapterError:
                logger.warning("Skipped an Audiobookshelf podcast show Storyarr could not read")
        return shows

    async for show in read_batches(ids, details, size=BATCH):
        yield show

"""Old-time radio from the Internet Archive.

Search is limited to audio in the old-time radio collection or with the radio subject. An item
is one show; each original audio recording in it is one episode (an MP3 made from a FLAC is the
same episode, and its MP3 is the file to download). Episodes are numbered by track when the
item gives tracks, otherwise in file-name order. The licence is kept as the item gives it; no
licence given is shown as such, because an empty licence does not mean free to use.
"""

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from urllib.parse import quote, urlsplit

from app.adapters.bbc_programmes import EpisodeData, SeriesData, ShowData
from app.adapters.contracts import AdapterError, FailureKind
from app.adapters.podcast_feed import duration as clock_duration
from app.adapters.podcast_feed import number_episodes, plain

IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}")
HOSTS = {"archive.org", "www.archive.org"}
AUDIO = {".mp3", ".flac", ".ogg", ".m4a", ".opus", ".wav", ".aac"}
# Search words only: the Internet Archive's query language is not passed through.
WORD = re.compile(r"[^\W_]+", re.UNICODE)
LICENCES = {
    "publicdomain/mark": "Public domain",
    "publicdomain/zero": "CC0 (public domain)",
}
MAX_FILES = 3000
DATE_IN_NAME = re.compile(r"(?<!\d)(?:19|20)\d{2}-\d{2}-\d{2}(?!\d)")


@dataclass
class ArchiveHit:
    identifier: str
    title: str
    author: str | None
    synopsis: str | None
    licence: str | None


def identifier(link: str) -> str | None:
    """The item in an archive.org/details link, or None for other links."""
    try:
        parts = urlsplit(link if "://" in link else "https://" + link)
    except ValueError:
        return None
    if (parts.hostname or "").lower() not in HOSTS:
        return None
    segments = [segment for segment in parts.path.split("/") if segment]
    if len(segments) >= 2 and segments[0] == "details" and IDENTIFIER.fullmatch(segments[1]):
        return segments[1]
    return None


def licence_name(url) -> str | None:
    """A licence address in words, such as "Creative Commons BY-NC-SA 3.0"."""
    if not isinstance(url, str) or not url.strip():
        return None
    url = url.strip()
    for key, name in LICENCES.items():
        if key in url:
            return name
    match = re.search(r"creativecommons\.org/licenses/([a-z-]+)/([\d.]+)", url)
    if match:
        return f"Creative Commons {match[1].upper()} {match[2]}"
    return url[:300]


def _first(value):
    if isinstance(value, list):
        value = value[0] if value else None
    return value.strip() if isinstance(value, str) and value.strip() else None


def query(term: str) -> str:
    words = WORD.findall(term)[:12]
    if not words:
        raise AdapterError(FailureKind.NOT_FOUND, "Enter a show name to search for")
    return f"({' '.join(words)}) AND mediatype:audio AND (collection:oldtimeradio OR subject:radio)"


async def search(fetch, term: str, limit: int = 15) -> list[ArchiveHit]:
    data = await fetch(
        "advancedsearch.php",
        {
            "q": query(term),
            "fl[]": ["identifier", "title", "creator", "description", "licenseurl"],
            "rows": limit,
            "output": "json",
        },
    )
    docs = (data.get("response") or {}).get("docs")
    if not isinstance(docs, list):
        raise AdapterError(
            FailureKind.PARSER, "The Internet Archive sent an answer Storyarr cannot read."
        )
    hits = []
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        name, title = doc.get("identifier"), _first(doc.get("title"))
        if not isinstance(name, str) or not IDENTIFIER.fullmatch(name) or not title:
            continue
        hits.append(
            ArchiveHit(
                identifier=name,
                title=title[:600],
                author=(_first(doc.get("creator")) or "")[:300] or None,
                synopsis=plain(_first(doc.get("description"))),
                licence=licence_name(doc.get("licenseurl")),
            )
        )
    return hits


def _seconds(value) -> int | None:
    if isinstance(value, int | float):
        return round(value) if 0 < value < 48 * 3600 else None
    if isinstance(value, str):
        try:
            return _seconds(float(value))
        except ValueError:
            return clock_duration(value)
    return None


def _track(value) -> int | None:
    if isinstance(value, str):
        value = value.split("/", 1)[0].strip()
        return int(value) if value.isdigit() and 0 < int(value) < 100_000 else None
    return None


def _dated(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    for size, pattern in ((10, "%Y-%m-%d"), (7, "%Y-%m"), (4, "%Y")):
        try:
            return datetime.strptime(value.strip()[:size], pattern).replace(tzinfo=UTC)
        except ValueError:
            continue
    return None


def show(name: str, data: dict) -> ShowData:
    metadata = data.get("metadata")
    files = data.get("files")
    if not isinstance(metadata, dict) or not isinstance(files, list):
        raise AdapterError(FailureKind.NOT_FOUND, "The Internet Archive has no item with this id.")
    if _first(metadata.get("mediatype")) not in {None, "audio", "etree"}:
        raise AdapterError(FailureKind.NOT_FOUND, "This Internet Archive item is not audio.")
    files = [item for item in files[:MAX_FILES] if isinstance(item, dict) and item.get("name")]
    # The MP3 made from each original, when there is one: it is the file to download.
    derived = {}
    for item in files:
        if item.get("source") == "derivative" and str(item["name"]).lower().endswith(".mp3"):
            if isinstance(item.get("original"), str):
                derived.setdefault(item["original"], item)
    entries = []
    for item in files:
        file_name = str(item["name"])
        path = PurePosixPath(file_name)
        if item.get("source") != "original" or path.suffix.lower() not in AUDIO:
            continue
        download = derived.get(file_name) if path.suffix.lower() != ".mp3" else None
        chosen = download or item
        title = _first(item.get("title")) or path.stem.replace("_", " ")
        episode = EpisodeData(
            pid=path.stem[:200],
            number=0,
            number_source="source",
            title=title[:600],
            synopsis=None,
            # Old-time radio files are usually named by their broadcast date.
            first_broadcast=_dated(found[0]) if (found := DATE_IN_NAME.search(file_name)) else None,
            enclosure_url=f"https://archive.org/download/{name}/{quote(str(chosen['name']))}",
            duration_seconds=_seconds(item.get("length")) or _seconds(chosen.get("length")),
        )
        entries.append((_track(item.get("track")), file_name, episode))
    # Tracks number the episodes only when every recording has its own; otherwise they run in
    # broadcast order (the date in the file name), then by file name.
    tracks = [track for track, _, _ in entries]
    by_track = all(track is not None for track in tracks) and len(set(tracks)) == len(tracks)
    if not by_track:
        far = datetime.max.replace(tzinfo=UTC)
        entries.sort(key=lambda entry: (entry[2].first_broadcast or far, entry[1].lower()))
    episodes = number_episodes(
        [
            (track if by_track else index, episode)
            for index, (track, _, episode) in enumerate(entries, start=1)
        ]
    )
    if not by_track:
        for episode in episodes:
            episode.number_source = "broadcast_order"
    title = _first(metadata.get("title")) or name
    result = ShowData(
        pid=name,
        title=title[:600],
        synopsis=plain(_first(metadata.get("description"))),
        first_broadcast=_dated(_first(metadata.get("date"))),
        station=None,
        image_pid=None,
        series=[
            SeriesData(
                pid="season:1",
                kind="series",
                number=1,
                number_source="source",
                title="Series 1",
                synopsis=None,
                station=None,
                expected_episodes=len(episodes) or None,
                first_broadcast=None,
                episodes=episodes,
            )
        ]
        if episodes
        else [],
        episode_count=len(episodes),
        provider="archive",
        author=(_first(metadata.get("creator")) or "")[:300] or None,
        web_url=f"https://archive.org/details/{name}",
        artwork_url=f"https://archive.org/services/img/{name}",
        licence=licence_name(_first(metadata.get("licenseurl"))),
    )
    result.durations = {
        episode.pid: episode.duration_seconds for episode in episodes if episode.duration_seconds
    }
    return result


async def item(fetch, name: str) -> ShowData:
    if not IDENTIFIER.fullmatch(name or ""):
        raise AdapterError(FailureKind.NOT_FOUND, "This is not an Internet Archive item id.")
    return show(name, await fetch(f"metadata/{name}", None))

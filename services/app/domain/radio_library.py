"""The radio library (FEAT-R, R3): which radio episodes are in Audiobookshelf.

One Audiobookshelf podcast library is chosen as the radio library, with the folder Storyarr files
episodes into. A sync reads its shows and episodes and keeps one row per episode file. Each radio
episode is then linked to the file that holds it, which makes its status "in_library":

1. By the BBC pid, from the episode's guid, download link or file name. This is exact, so it
   works across shows.
2. In a show with the same title, by series and episode number: the ones Audiobookshelf read, or
   S20E03 in the title or file name (how Storyarr names radio files).
3. In a show with the same title, by an episode title that only one episode has.

Nothing is written to Audiobookshelf or the files here.
"""

import logging
import re
import unicodedata
from datetime import UTC, datetime
from pathlib import PurePosixPath
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.adapters import abs_podcasts
from app.adapters.contracts import AdapterError, FailureKind
from app.db.models import (
    Integration,
    RadioEpisode,
    RadioLibrary,
    RadioLibraryFile,
    RadioSeries,
    RadioShow,
)
from app.db.session import session_factory
from app.domain.operations import transaction_lock

logger = logging.getLogger(__name__)
LOCK = "radio-library"
SEASON_EPISODE = re.compile(r"(?<![a-z0-9])s(\d{1,4})\s?e(\d{1,5})(?![0-9])", re.IGNORECASE)


def title_key(value: str | None) -> str:
    """Titles compared without case, accents, punctuation or a leading "The"."""
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(character for character in text if not unicodedata.combining(character))
    text = re.sub(r"[^0-9a-z]+", " ", text.casefold()).strip()
    return re.sub(r"^the ", "", text)


def season_episode(file: RadioLibraryFile) -> tuple[int, int] | None:
    for value in (file.title, PurePosixPath(file.path).name):
        if match := SEASON_EPISODE.search(value or ""):
            return int(match.group(1)), int(match.group(2))
    if file.season is not None and file.episode is not None:
        return file.season, file.episode
    return None


def links(shows, series, episodes, files) -> dict[UUID, UUID]:
    """Which file holds each episode, as episode id to file id. One file per episode."""
    by_pid = {file.pid: file for file in files if file.pid}
    by_show: dict[str, list] = {}
    for file in files:
        by_show.setdefault(title_key(file.show_title), []).append(file)
    numbers = {row.id: row.number for row in series}
    result: dict[UUID, UUID] = {}
    for show in shows:
        own = [episode for episode in episodes if episode.show_id == show.id]
        candidates = by_show.get(title_key(show.title), [])
        numbered = {}
        for file in candidates:
            if key := season_episode(file):
                numbered.setdefault(key, file)
        titles: dict[str, list] = {}
        for file in candidates:
            titles.setdefault(title_key(file.title), []).append(file)
        episode_titles: dict[str, int] = {}
        for episode in own:
            key = title_key(episode.title)
            episode_titles[key] = episode_titles.get(key, 0) + 1
        for episode in own:
            file = by_pid.get(episode.pid)
            if not file:
                file = numbered.get((numbers.get(episode.series_id), episode.number))
            if not file:
                key = title_key(episode.title)
                same = titles.get(key, [])
                if key and len(same) == 1 and episode_titles[key] == 1:
                    file = same[0]
            if file:
                result[episode.id] = file.id
    return result


async def relink(db, *, show_id: UUID | None = None) -> int:
    """Link episodes to files and set "in_library" to match. Returns how many are linked."""
    from app.domain.radio import episode_status

    await transaction_lock(db, LOCK)
    files = (await db.scalars(select(RadioLibraryFile))).all()
    show_query = select(RadioShow)
    if show_id:
        show_query = show_query.where(RadioShow.id == show_id)
    shows = (await db.scalars(show_query)).all()
    ids = [show.id for show in shows]
    series = (await db.scalars(select(RadioSeries).where(RadioSeries.show_id.in_(ids)))).all()
    episodes = (await db.scalars(select(RadioEpisode).where(RadioEpisode.show_id.in_(ids)))).all()
    found = links(shows, series, episodes, files)
    owners = {show.id: show for show in shows}
    now = datetime.now(UTC)
    for episode in episodes:
        file_id = found.get(episode.id)
        if file_id:
            episode.file_id, episode.status = file_id, "in_library"
        elif episode.file_id or episode.status == "in_library":
            show = owners[episode.show_id]
            episode.file_id = None
            # Worked out again from the broadcast date and the follow choice.
            episode.status = episode_status(
                episode.first_broadcast, show.follow, show.followed_at, None, now
            )
    await db.flush()
    return len(found)


def within(path: str, folder: str) -> bool:
    return PurePosixPath(path).is_relative_to(PurePosixPath(folder))


async def sync(library_id: UUID) -> int:
    """Read the radio library from Audiobookshelf, save its episodes and relink. Returns the count."""
    from app.api.library_folders import library_client

    async with session_factory()() as db:
        library = await db.get(RadioLibrary, library_id)
        integration = await db.get(Integration, library.integration_id) if library else None
        if not library:
            return 0
        external, folder = library.external_id, library.abs_folder
    try:
        if not integration or not integration.enabled or integration.kind != "audiobookshelf":
            raise AdapterError(
                FailureKind.UNAVAILABLE, "Connect the Audiobookshelf server again to read radio."
            )
        seen = []
        async with library_client(integration) as client:
            async for show in abs_podcasts.podcast_shows(client, external):
                if not within(show.path, folder):
                    continue
                seen.extend((show, episode) for episode in show.episodes)
    except AdapterError as error:
        async with session_factory()() as db, db.begin():
            library = await db.get(RadioLibrary, library_id)
            if library:
                library.last_error = str(error)[:500]
        logger.warning("Radio library sync failed: %s", error)
        return 0
    now = datetime.now(UTC)
    async with session_factory()() as db, db.begin():
        await transaction_lock(db, LOCK)
        library = await db.get(RadioLibrary, library_id, with_for_update=True)
        if not library:
            return 0
        for show, episode in seen:
            values = {
                "item_id": show.id,
                "show_title": show.title,
                "title": episode.title,
                "season": episode.season,
                "episode": episode.episode,
                "pid": episode.pid,
                "published_at": episode.published_at,
                "duration_seconds": episode.duration_seconds,
                "path": episode.path,
                "size": episode.size,
                "seen_at": now,
            }
            statement = insert(RadioLibraryFile).values(
                library_id=library.id, episode_id=episode.id, **values
            )
            await db.execute(
                statement.on_conflict_do_update(
                    index_elements=[RadioLibraryFile.library_id, RadioLibraryFile.episode_id],
                    set_=values,
                )
            )
        await db.execute(
            delete(RadioLibraryFile).where(
                RadioLibraryFile.library_id == library.id, RadioLibraryFile.seen_at < now
            )
        )
        library.synced_at, library.last_error = now, None
        await relink(db)
    return len(seen)


async def sync_all() -> None:
    async with session_factory()() as db:
        ids = (await db.scalars(select(RadioLibrary.id))).all()
    for library_id in ids:
        await sync(library_id)

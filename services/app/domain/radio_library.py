"""The radio library (FEAT-R, R3): which radio episodes are in Audiobookshelf.

One Audiobookshelf podcast library is chosen as the radio library, with the folder Storyarr files
episodes into. A sync reads its shows and episodes and keeps one row per episode file. Each radio
episode is then linked to the file that holds it, which makes its status "in_library":

1. By the BBC pid, from the episode's guid, download link or file name. This is exact, so it
   works across shows.
2. In a show with the same title, by series and episode number: the ones Audiobookshelf read, or
   S20E03 in the title or file name (how Storyarr names radio files).
3. In a show with the same title, by an episode title that only one episode has.

A show added from the radio library review also takes the files of the library show (folder) it
was added from, whatever that folder is called. Links made by hand in the review are kept as they
are, and their files are not offered to other episodes.

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


def show_files(show, files) -> list:
    """The library files that belong to a show: the same title, or the folder it was added from."""
    key = title_key(show.title)
    return [
        file
        for file in files
        if title_key(file.show_title) == key
        or (show.library_item_id and file.item_id == show.library_item_id)
    ]


def links(shows, series, episodes, files) -> dict[UUID, UUID]:
    """Which file holds each episode, as episode id to file id. One file per episode.

    Episodes linked by hand are left out, and so are the files they hold in the same show.
    """
    numbers = {row.id: row.number for row in series}
    result: dict[UUID, UUID] = {}
    for show in shows:
        everything = [episode for episode in episodes if episode.show_id == show.id]
        taken = {episode.file_id for episode in everything if episode.file_manual}
        own = [episode for episode in everything if not episode.file_manual]
        free = [file for file in files if file.id not in taken]
        by_pid = {file.pid: file for file in free if file.pid}
        candidates = show_files(show, free)
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
        if episode.file_manual:
            show = owners[episode.show_id]
            episode.status = (
                "in_library"
                if episode.file_id
                else episode_status(
                    episode.first_broadcast, show.follow, show.followed_at, None, now
                )
            )
            continue
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
    # Requests follow the statuses: wanted episodes are requested, the rest withdrawn.
    from app.domain.radio_wanted import sync

    await sync(db, ids if show_id else None)
    return len(found)


def within(path: str, folder: str) -> bool:
    return PurePosixPath(path).is_relative_to(PurePosixPath(folder))


async def sync(library_id: UUID) -> int:
    """Read the radio library, save its episodes and relink them. Returns the episode count."""
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


async def review(db, owner_id: UUID) -> tuple[list[tuple[str, str, int]], list[tuple]]:
    """What the radio library holds that one person's radio shows do not cover yet.

    Returns the library shows none of their shows takes files from, as (item id, title, files),
    and each of their shows with its files that hold no episode, as (show, [files]).
    """
    files = (
        await db.scalars(
            select(RadioLibraryFile).order_by(
                RadioLibraryFile.show_title, RadioLibraryFile.season, RadioLibraryFile.episode
            )
        )
    ).all()
    shows = (
        await db.scalars(
            select(RadioShow).where(RadioShow.owner_id == owner_id).order_by(RadioShow.title)
        )
    ).all()
    linked = set(
        (
            await db.scalars(
                select(RadioEpisode.file_id).where(
                    RadioEpisode.show_id.in_([show.id for show in shows]),
                    RadioEpisode.file_id.is_not(None),
                )
            )
        ).all()
    )
    claimed: set[UUID] = set()
    unmatched = []
    for show in shows:
        own = show_files(show, files)
        claimed.update(file.id for file in own)
        loose = [file for file in own if file.id not in linked]
        if loose:
            unmatched.append((show, loose))
    missing: dict[str, list] = {}
    for file in files:
        if file.id not in claimed:
            missing.setdefault(file.item_id, []).append(file)
    to_add = sorted(
        ((item_id, group[0].show_title, len(group)) for item_id, group in missing.items()),
        key=lambda row: title_key(row[1]),
    )
    return to_add, unmatched

"""Filing a radio episode into the radio library (FEAT-R, R3).

An episode is written to one folder per show, ``Show/Show - S20E03 - Title.m4a``, with Specials
as series 0. The audio is copied by ffmpeg without re-encoding, and the copy gets the tags:
``album`` (the show), ``title``, ``disc`` (the series), ``track`` (the episode), ``date`` (the
first broadcast) and a comment with the BBC pid, so the radio sync matches it exactly. The
source file is only read, so a seeding download is never changed. Nothing is overwritten: an
episode that already has a file is left as it is. Audiobookshelf is then asked to rescan.

Sorting the radio already in Audiobooks (R6) and downloads (R5) file episodes through here.
"""

import asyncio
import os
import subprocess
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath

from app.importing.naming import component

# The ffmpeg format for each kind of file, so the copy keeps its container.
MUXERS = {"m4a": "mp4", "m4b": "mp4", "mp3": "mp3", "flac": "flac", "ogg": "ogg", "opus": "opus"}
TIME_LIMIT = 600


class FilingError(Exception):
    """Safe text for the person filing: no paths beyond the radio folder."""


@dataclass(frozen=True)
class EpisodeFacts:
    show: str
    series: int
    episode: int
    title: str
    pid: str
    first_broadcast: datetime | None = None
    station: str | None = None


def episode_path(facts: EpisodeFacts, extension: str) -> PurePosixPath:
    """``Show/Show - S20E03 - Title.m4a``, relative to the radio folder."""
    show = component(facts.show, limit=120)
    code = f"S{facts.series:02d}E{facts.episode:02d}"
    title = component(facts.title, limit=120)
    name = component(f"{show} - {code} - {title}.{extension.lower()}", limit=240)
    return PurePosixPath(show) / name


def tags(facts: EpisodeFacts) -> dict[str, str]:
    values = {
        "album": facts.show,
        "title": facts.title,
        "disc": str(facts.series),
        "track": str(facts.episode),
        "genre": "Radio",
        "comment": f"BBC programme {facts.pid}",
    }
    if facts.first_broadcast:
        values["date"] = facts.first_broadcast.date().isoformat()
    if facts.station:
        values["artist"] = facts.station
    return values


def tag_command(source: Path, output: Path, facts: EpisodeFacts, muxer: str) -> list[str]:
    command = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-v",
        "error",
        "-i",
        str(source),
        "-map",
        "0:a",
        "-c",
        "copy",
        "-map_metadata",
        "-1",
    ]
    for key, value in tags(facts).items():
        command.extend(["-metadata", f"{key}={value}"])
    command.extend(["-f", muxer, "-y", str(output)])
    return command


def file_episode(source: Path, root: Path, facts: EpisodeFacts) -> Path:
    """Write the tagged copy into the radio folder and return where it went."""
    extension = source.suffix.lstrip(".").lower()
    muxer = MUXERS.get(extension)
    if not muxer:
        raise FilingError(f"Storyarr cannot file .{extension} radio files yet.")
    if not source.is_file():
        raise FilingError("The episode file is no longer there.")
    if not root.is_dir():
        raise FilingError("The radio library folder is not available to Storyarr.")
    target = root / episode_path(facts, extension)
    if target.exists():
        raise FilingError(f"{target.name} is already in the radio library.")
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(f".{target.name}.storyarr-part")
    try:
        completed = subprocess.run(
            tag_command(source, partial, facts, muxer),
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=TIME_LIMIT,
            check=False,
        )
        if completed.returncode:
            tail = completed.stderr.decode("utf-8", "replace").strip().splitlines()
            raise FilingError(
                "Could not copy the episode (" + (tail[-1][:180] if tail else "ffmpeg failed") + ")"
            )
        # A link fails rather than replacing a file that appeared meanwhile.
        os.link(partial, target)
    except FileNotFoundError as error:
        raise FilingError("Filing radio needs ffmpeg on the worker.") from error
    except FileExistsError as error:
        raise FilingError(f"{target.name} is already in the radio library.") from error
    except subprocess.TimeoutExpired as error:
        raise FilingError("Copying the episode took too long.") from error
    finally:
        # Only Storyarr's own unfinished copy is removed.
        partial.unlink(missing_ok=True)
    return target


async def file_and_scan(library, client, source: Path, facts: EpisodeFacts) -> Path:
    """File the episode, then ask Audiobookshelf to rescan the radio library."""
    target = await asyncio.to_thread(file_episode, source, Path(library.local_path), facts)
    await client.scan(library.external_id)
    return target

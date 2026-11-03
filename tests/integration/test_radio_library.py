"""The radio library (R3): reading an Audiobookshelf podcast library, linking episodes, filing."""

import json
import shutil
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.adapters import abs_podcasts
from app.adapters.abs_podcasts import PodcastEpisode, PodcastLibrary, PodcastShow, find_pid
from app.db.models import (
    Integration,
    RadioEpisode,
    RadioLibrary,
    RadioLibraryFile,
    RadioSeries,
)
from app.domain import radio_filing, radio_library
from app.domain.radio_filing import EpisodeFacts, FilingError
from tests.integration.test_radio import add, finish
from tests.integration.test_radio import bbc as recorded_bbc

pytestmark = pytest.mark.integration
# The recorded BBC responses from the radio tests.
bbc = recorded_bbc
BASE = "/api/radio/library"


def test_bbc_pids_come_from_the_guid_link_or_file_name():
    assert find_pid("https://www.bbc.co.uk/programmes/p0nyr5cl") == "p0nyr5cl"
    assert find_pid(None, "https://example.test/Show-20260715-p0nyr5cl.m4a") == "p0nyr5cl"
    assert find_pid("", None, "Just_a_Minute_-_Series_95_b0b1qdds_original.m4a") == "b0b1qdds"
    assert find_pid("https://example.test/feed/56", None, "Your Next Listen.m4a") is None


def test_a_podcast_show_keeps_only_downloaded_episodes():
    audio = {
        "metadata": {"filename": "One.m4a", "path": "/radio/Show/One.m4a", "size": 2048},
        "duration": 1695.4,
    }
    show = abs_podcasts.parse_show(
        {
            "id": "item-1",
            "mediaType": "podcast",
            "path": "/radio/Show",
            "media": {
                "metadata": {"title": " The Show "},
                "episodes": [
                    {
                        "id": "episode-1",
                        "title": "One",
                        "season": "",
                        "episode": "56",
                        "guid": "https://www.bbc.co.uk/programmes/p0nyr5cl",
                        "publishedAt": 1784131200000,
                        "audioFile": audio,
                    },
                    {"id": "episode-2", "title": "Not downloaded", "audioFile": None},
                    {"id": "episode-3", "title": "Broken", "audioFile": {"metadata": {}}},
                ],
            },
        }
    )
    assert show.title == "The Show"
    [episode] = show.episodes
    assert (episode.pid, episode.season, episode.episode, episode.duration_seconds) == (
        "p0nyr5cl",
        None,
        56,
        1695,
    )
    assert episode.published_at == datetime(2026, 7, 15, 16, tzinfo=UTC)


def _episode(show_id, series_id, number, title, pid, *, file_id=None, manual=False):
    return SimpleNamespace(
        id=uuid4(),
        show_id=show_id,
        series_id=series_id,
        number=number,
        title=title,
        pid=pid,
        file_id=file_id,
        file_manual=manual,
    )


def _file(show_title, title, path, *, pid=None, season=None, episode=None, item_id="item"):
    return SimpleNamespace(
        id=uuid4(),
        item_id=item_id,
        show_title=show_title,
        title=title,
        path=path,
        pid=pid,
        season=season,
        episode=episode,
    )


def test_links_use_the_pid_then_numbers_then_a_unique_title():
    show = SimpleNamespace(id=uuid4(), title="The Unbelievable Truth", library_item_id=None)
    other = SimpleNamespace(id=uuid4(), title="Just a Minute", library_item_id=None)
    series = [SimpleNamespace(id=uuid4(), number=20), SimpleNamespace(id=uuid4(), number=1)]
    by_pid = _episode(show.id, series[0].id, 1, "Episode 1", "b0aaaaa1")
    by_code = _episode(show.id, series[0].id, 3, "Episode 3", "b0aaaaa3")
    by_title = _episode(show.id, series[0].id, 4, "The Christmas Special", "b0aaaaa4")
    shared_title = _episode(show.id, series[1].id, 1, "Episode 1", "b0aaaaa5")
    elsewhere = _episode(other.id, series[1].id, 3, "Episode 3", "b0aaaaa6")
    files = [
        _file("Some other feed", "Anything", "/r/a.m4a", pid="b0aaaaa1"),
        _file("Unbelievable Truth", "Episode 3", "/r/Show - S20E03 - Episode 3.m4a"),
        _file("unbelievable truth!", "The Christmas special", "/r/x.m4a"),
        _file("The Unbelievable Truth", "Episode 1", "/r/y.m4a"),
    ]
    found = radio_library.links(
        [show, other],
        series,
        [by_pid, by_code, by_title, shared_title, elsewhere],
        files,
    )
    assert found == {
        by_pid.id: files[0].id,
        by_code.id: files[1].id,
        by_title.id: files[2].id,
    }


def test_links_take_the_folder_a_show_was_added_from_and_keep_hand_links():
    show = SimpleNamespace(
        id=uuid4(), title="Hamish and Dougal: You'll Have Had Your Tea", library_item_id="hd"
    )
    series = [SimpleNamespace(id=uuid4(), number=1)]
    first = _episode(show.id, series[0].id, 1, "The Musical Evening", "b0hd0001")
    second = _episode(show.id, series[0].id, 2, "Episode 2", "b0hd0002")
    files = [
        _file("Hamish And Dougal", "The Musical Evening", "/r/H - S01E01.mp3", item_id="hd"),
        _file("Hamish And Dougal", "Two", "/r/H - S01E02.mp3", item_id="hd"),
        _file("Someone Else", "One", "/r/S - S01E01.mp3", item_id="other"),
    ]
    assert radio_library.links([show], series, [first, second], files) == {
        first.id: files[0].id,
        second.id: files[1].id,
    }

    # By hand: the first file is the second episode, and the first episode has no file.
    first.file_id, first.file_manual = None, True
    second.file_id, second.file_manual = files[0].id, True
    assert radio_library.links([show], series, [first, second], files) == {}
    third = _episode(show.id, series[0].id, 1, "The Musical Evening", "b0hd0003")
    # The hand-linked file is not offered to another episode of the show.
    assert radio_library.links([show], series, [first, second, third], files) == {}


async def test_the_bbc_a_to_z_finds_shows_bbc_sounds_leaves_out():
    from app.adapters import bbc_programmes

    titles = [f"C{index:03d} filler" for index in range(70)]
    titles[45:48] = ["Cabin Fever", "Cabin Pressure", "Cabin Pressure: The Specials"]
    titles.sort(key=bbc_programmes.atoz_key)
    calls = []

    def item(title, kind="brand", service="radio"):
        return {
            "title": title,
            "programme": {
                "pid": f"b00{abs(hash(title)) % 100000:05d}",
                "title": title,
                "type": kind,
                "short_synopsis": "A synopsis",
                "ownership": {
                    "service": {"type": service, "id": "bbc_radio_four", "title": "BBC Radio 4"}
                },
            },
        }

    async def fetch(path, params):
        calls.append(params["page"])
        assert path == "programmes/a-z/by/c/all.json"
        start = (params["page"] - 1) * 30
        rows = [item(title) for title in titles[start : start + 30]]
        if params["page"] == 2:
            rows.append(item("Cabin Pressure", kind="episode"))
            rows.append(item("Cabin Pressure Live", service="tv"))
        return {"atoz": {"total": len(titles), "tleo_titles": rows}}

    found = await bbc_programmes.atoz(fetch, "Cabin Pressure")
    assert [result.title for result in found] == ["Cabin Pressure", "Cabin Pressure: The Specials"]
    assert found[0].station_name == "BBC Radio 4"
    assert len(calls) <= 5
    assert await bbc_programmes.atoz(fetch, "  ") == []


@pytest.fixture
def podcasts(monkeypatch, tmp_path):
    """A stand-in Audiobookshelf with one podcast library, and a folder Storyarr can write to."""
    folder = tmp_path / "radio"
    folder.mkdir()
    state = {"shows": [], "scans": []}

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *error):
            return False

        async def scan(self, library_id):
            state["scans"].append(library_id)

    async def libraries(client):
        return [PodcastLibrary(id="radio-lib", name="Radio", folders=["/radio"])]

    async def shows(client, library_id):
        for show in state["shows"]:
            yield show

    monkeypatch.setattr("app.api.library_folders.library_client", lambda integration: Client())
    monkeypatch.setattr("app.api.radio_library.library_client", lambda integration: Client())
    monkeypatch.setattr(abs_podcasts, "podcast_libraries", libraries)
    monkeypatch.setattr(abs_podcasts, "podcast_shows", shows)
    monkeypatch.setattr(
        "app.api.radio_library.browse_roots", lambda settings, include_libraries=False: [tmp_path]
    )
    state["folder"] = folder
    state["client"] = Client()
    return state


async def _server(database):
    async with database() as db, db.begin():
        integration = Integration(
            kind="audiobookshelf",
            name="Home server",
            base_url="http://fixture.invalid",
            encrypted_secrets="unused",
        )
        db.add(integration)
    return integration.id


async def test_choosing_and_syncing_the_radio_library_links_episodes(
    client, admin, database, bbc, podcasts
):
    server = await _server(database)
    setup = (await client.get(BASE)).json()
    assert setup["current"] is None
    assert [(row["name"], row["folders"]) for row in setup["options"]] == [("Radio", ["/radio"])]

    body = {
        "integration_id": str(server),
        "library_id": "radio-lib",
        "abs_folder": "/radio",
        "local_path": str(podcasts["folder"]),
    }
    wrong = await client.put(BASE, json={**body, "abs_folder": "/podcasts"})
    assert wrong.status_code == 422
    assert wrong.json()["detail"] == "Choose one of the library's own folders."
    outside = await client.put(BASE, json={**body, "local_path": "/etc"})
    assert outside.status_code == 422
    chosen = await client.put(BASE, json=body)
    assert chosen.status_code == 200, chosen.text
    assert (chosen.json()["name"], chosen.json()["files"]) == ("Radio", 0)

    show = await add(client, follow="all")
    await finish(database, show)
    async with database() as db:
        rows = (
            await db.execute(
                select(RadioEpisode, RadioSeries)
                .join(RadioSeries, RadioSeries.id == RadioEpisode.series_id)
                .order_by(RadioSeries.number, RadioEpisode.number)
            )
        ).all()
    (first, _), (second, second_series) = rows[0], rows[1]

    def episode(identifier, title, path, **extra):
        return PodcastEpisode(id=identifier, title=title, path=path, size=1000, **extra)

    podcasts["shows"] = [
        PodcastShow(
            id="item-1",
            title="The Unbelievable Truth",
            path="/radio/The Unbelievable Truth",
            episodes=[
                episode("e1", "Anything", "/radio/The Unbelievable Truth/a.m4a", pid=first.pid),
                episode(
                    "e2",
                    "Anything else",
                    f"/radio/The Unbelievable Truth/The Unbelievable Truth - "
                    f"S{second_series.number:02d}E{second.number:02d} - Something.m4a",
                ),
            ],
        ),
        PodcastShow(id="item-2", title="Elsewhere", path="/podcasts/Elsewhere", episodes=[]),
    ]
    async with database() as db:
        library_id = await db.scalar(select(RadioLibrary.id))
    assert await radio_library.sync(library_id) == 2

    async with database() as db:
        statuses = {
            row.id: (row.status, row.file_id is not None)
            for row in await db.scalars(select(RadioEpisode))
        }
    assert statuses[first.id] == ("in_library", True)
    assert statuses[second.id] == ("in_library", True)
    detail = (await client.get(f"/api/radio/episodes/{first.id}")).json()
    assert detail["status"]["kind"] == "in_library"
    assert {key: detail["file"][key] for key in ("name", "size", "library")} == {
        "name": "a.m4a",
        "size": 1000,
        "library": "Radio",
    }
    assert detail["file_manual"] is False
    view = (await client.get(BASE)).json()["current"]
    assert (view["files"], view["linked"], view["last_error"]) == (2, 2, None)

    # A file that leaves the library takes the episode back to its worked-out status.
    podcasts["shows"][0].episodes.pop(0)
    assert await radio_library.sync(library_id) == 1
    async with database() as db:
        again = await db.get(RadioEpisode, first.id)
    assert (again.status, again.file_id) == ("wanted", None)


async def test_the_review_adds_library_shows_and_links_files_by_hand(
    client, admin, database, bbc, podcasts
):
    server = await _server(database)
    chosen = await client.put(
        BASE,
        json={
            "integration_id": str(server),
            "library_id": "radio-lib",
            "abs_folder": "/radio",
            "local_path": str(podcasts["folder"]),
        },
    )
    assert chosen.status_code == 200, chosen.text

    def episode(identifier, title, name, **extra):
        return PodcastEpisode(
            id=identifier, title=title, path=f"/radio/Truth/{name}", size=1000, **extra
        )

    # The folder is called "Truth", not the BBC title, so nothing links by title.
    podcasts["shows"] = [
        PodcastShow(
            id="item-truth",
            title="Truth",
            path="/radio/Truth",
            episodes=[
                episode("e1", "First", "Truth - S01E01 - First.m4a"),
                episode("e2", "Odd", "Truth - S09E09 - Odd.m4a"),
            ],
        )
    ]
    async with database() as db:
        library_id = await db.scalar(select(RadioLibrary.id))
    await radio_library.sync(library_id)
    review = (await client.get(BASE + "/review")).json()
    assert review["library"] == "Radio"
    assert review["shows"] == [{"item_id": "item-truth", "title": "Truth", "files": 2}]
    assert (review["unmatched"], review["unmatched_files"]) == ([], 0)

    response = await client.post(
        "/api/radio/shows",
        json={"link": "https://www.bbc.co.uk/programmes/b007mf4f", "library_item_id": "item-truth"},
    )
    assert response.status_code == 201, response.text
    show = response.json()
    await finish(database, show)
    async with database() as db:
        first, first_series = (
            await db.execute(
                select(RadioEpisode, RadioSeries)
                .join(RadioSeries, RadioSeries.id == RadioEpisode.series_id)
                .order_by(RadioSeries.number, RadioEpisode.number)
                .limit(1)
            )
        ).one()
    code = f"S{first_series.number:02d}E{first.number:02d}"
    podcasts["shows"][0].episodes[0] = episode("e1", "First", f"Truth - {code} - First.m4a")
    await radio_library.sync(library_id)
    review = (await client.get(BASE + "/review")).json()
    assert review["shows"] == []
    [loose] = review["unmatched"]
    assert loose["show_id"] == show["id"]
    assert [(file["name"], file["season"]) for file in loose["files"]] == [
        ("Truth - S09E09 - Odd.m4a", None)
    ]
    odd = loose["files"][0]["id"]
    linked = (await client.get(f"/api/radio/episodes/{first.id}")).json()
    assert linked["file"]["name"] == f"Truth - {code} - First.m4a"

    # By hand: the odd file is really series 1 episode 1; the sync keeps it so.
    put = await client.put(f"/api/radio/episodes/{first.id}/file", json={"file_id": odd})
    assert put.status_code == 200, put.text
    assert (put.json()["file"]["id"], put.json()["file_manual"]) == (odd, True)
    await radio_library.sync(library_id)
    after = (await client.get(f"/api/radio/episodes/{first.id}")).json()
    assert (after["file"]["id"], after["status"]["kind"]) == (odd, "in_library")
    review = (await client.get(BASE + "/review")).json()
    assert [file["name"] for file in review["unmatched"][0]["files"]] == [
        f"Truth - {code} - First.m4a"
    ]

    # Not this file: no file, and the sync leaves it so.
    none = await client.put(f"/api/radio/episodes/{first.id}/file", json={"file_id": None})
    assert (none.json()["file"], none.json()["file_manual"]) == (None, True)
    assert none.json()["status"]["kind"] != "in_library"
    # A file of another show is refused.
    async with database() as db:
        other = RadioLibraryFile(
            library_id=library_id,
            item_id="x",
            episode_id="x1",
            show_title="Other",
            title="A",
            path="/radio/Other/a.m4a",
            size=1,
            seen_at=datetime.now(UTC),
        )
        db.add(other)
        await db.commit()
        other_id = other.id
    wrong = await client.put(
        f"/api/radio/episodes/{first.id}/file", json={"file_id": str(other_id)}
    )
    assert wrong.status_code == 422
    # Automatic again: the sync finds the file by its number.
    back = await client.delete(f"/api/radio/episodes/{first.id}/file")
    assert back.status_code == 200, back.text
    assert (back.json()["file"]["name"], back.json()["file_manual"]) == (
        f"Truth - {code} - First.m4a",
        False,
    )


def _has_ffmpeg():
    return shutil.which("ffmpeg") and shutil.which("ffprobe")


@pytest.mark.skipif(not _has_ffmpeg(), reason="needs ffmpeg")
def test_filing_writes_a_tagged_copy_and_never_overwrites(tmp_path):
    source = tmp_path / "download" / "b0b1qdds_original.m4a"
    source.parent.mkdir()
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:a",
            "aac",
            "-metadata",
            "title=Old title",
            str(source),
        ],
        check=True,
    )
    before = source.read_bytes()
    root = tmp_path / "radio"
    root.mkdir()
    facts = EpisodeFacts(
        show="The Unbelievable Truth",
        series=20,
        episode=3,
        title="Episode 3: Lies/Truth",
        pid="b0b1qdds",
        first_broadcast=datetime(2018, 5, 7, 17, 30, tzinfo=UTC),
        station="BBC Radio 4",
    )
    target = radio_filing.file_episode(source, root, facts)
    assert target == root / "The Unbelievable Truth" / (
        "The Unbelievable Truth - S20E03 - Episode 3 Lies Truth.m4a"
    )
    assert source.read_bytes() == before
    assert [path.name for path in target.parent.iterdir()] == [target.name]
    probed = json.loads(
        subprocess.run(
            ["ffprobe", "-v", "error", "-show_format", "-of", "json", str(target)],
            check=True,
            capture_output=True,
        ).stdout
    )
    found = {key.lower(): value for key, value in probed["format"]["tags"].items()}
    assert found["album"] == "The Unbelievable Truth"
    assert found["title"] == "Episode 3: Lies/Truth"
    assert found["track"].split("/")[0] == "3"
    assert found["disc"].split("/")[0] == "20"
    assert found["date"].startswith("2018-05-07")
    assert found["comment"] == "BBC programme b0b1qdds"
    assert found["artist"] == "BBC Radio 4"

    with pytest.raises(FilingError, match="already in the radio library"):
        radio_filing.file_episode(source, root, facts)
    with pytest.raises(FilingError, match="cannot file .wav"):
        radio_filing.file_episode(source.with_suffix(".wav"), root, facts)


def test_episode_names_are_safe_and_specials_are_series_zero():
    facts = EpisodeFacts(show="Show: Live?", series=0, episode=1, title="A/B", pid="p0000001")
    assert str(radio_filing.episode_path(facts, "MP3")) == "Show Live/Show Live - S00E01 - A B.mp3"


async def test_file_and_scan_asks_audiobookshelf_to_rescan(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(
        radio_filing, "file_episode", lambda source, root, facts: calls.append(root) or root / "x"
    )

    class Client:
        async def scan(self, library_id):
            calls.append(library_id)

    library = SimpleNamespace(local_path=str(tmp_path), external_id="radio-lib")
    facts = EpisodeFacts(show="S", series=1, episode=1, title="T", pid="p0000001")
    assert (
        await radio_filing.file_and_scan(library, Client(), Path("/x.m4a"), facts) == tmp_path / "x"
    )
    assert calls == [tmp_path, "radio-lib"]

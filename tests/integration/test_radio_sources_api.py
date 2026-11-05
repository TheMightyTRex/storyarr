"""Radio beyond the BBC through the API (RADIO-02 and the Reelix comparison): podcast feeds,
Apple Podcasts links, the Internet Archive, shows kept when a source drops items, episodes
monitored by hand, matching by guid, aliases, health and search by country."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import select

from app.adapters import public_web
from app.adapters.contracts import AdapterError, FailureKind
from app.db.models import (
    Integration,
    RadioEpisode,
    RadioLibrary,
    RadioLibraryFile,
    RadioShow,
)
from app.domain import radio_library, radio_sources, radio_wanted
from tests.integration import test_radio as recorded
from tests.integration.test_radio import BASE, finish

pytestmark = pytest.mark.integration
bbc = recorded.bbc
FIXTURES = Path(__file__).parents[1] / "fixtures/radio"
FEED = "https://feeds.example.org/show.xml"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200


def feed_body(*guids, title="Test show"):
    items = "".join(
        f"<item><guid>{guid}</guid><title>Episode {guid}</title>"
        f"<pubDate>Mon, 0{index + 1} Sep 2025 10:00:00 GMT</pubDate>"
        f'<enclosure url="https://cdn.example.org/{guid}.mp3"/>'
        "<itunes:duration>30:00</itunes:duration></item>"
        for index, guid in enumerate(guids)
    )
    return (
        '<?xml version="1.0"?><rss version="2.0" '
        'xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel>'
        f"<title>{title}</title><link>https://example.org/show</link>"
        "<itunes:author>A Maker</itunes:author>"
        '<itunes:image href="https://img.example.org/art.png"/>'
        f"{items}</channel></rss>"
    ).encode()


@pytest.fixture
def web(monkeypatch, bbc):
    """Public web addresses, Apple Podcasts and the Internet Archive from stand-ins."""
    state = {
        "pages": {
            FEED: ("application/rss+xml", feed_body("g1", "g2", "g3")),
            "https://img.example.org/art.png": ("image/png", PNG),
        },
        "calls": [],
        "apple": json.loads((FIXTURES / "apple-search.json").read_text()),
        "archive": json.loads((FIXTURES / "archive-raysalaugh.json").read_text()),
        "down": set(),
        "validators": [],
    }

    async def fetch(url, *, accept, limit, transport=None, resolver=None, validators=None):
        state["calls"].append(url)
        if url not in state["pages"]:
            raise AdapterError(FailureKind.NOT_FOUND, "Nothing was found at this web address")
        kind, body = state["pages"][url]
        tag = f'"{hash(body)}"'
        state["validators"].append(validators)
        if validators and validators[0] == tag:
            return public_web.Page(url, "", b"", not_modified=True)
        return public_web.Page(url, kind, body, etag=tag)

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def gateway(provider):
        async def answer(path, params):
            state["calls"].append(f"{provider}:{path}")
            if provider in state["down"]:
                raise AdapterError(FailureKind.UNAVAILABLE, "down")
            if provider == "apple":
                if path == "lookup":
                    result = dict(state["apple"]["results"][0])
                    result["feedUrl"] = FEED
                    return {"results": [result]}
                return state["apple"]
            if path.startswith("metadata/"):
                return state["archive"]
            return {"response": {"docs": [{"identifier": "RaysALaugh1949", "title": "Ray"}]}}

        yield answer

    monkeypatch.setattr(public_web, "fetch", fetch)
    monkeypatch.setattr(radio_sources, "gateway", gateway)
    return state


async def add_link(client, link, follow="from_now_on"):
    response = await client.post(BASE + "/shows", json={"link": link, "follow": follow})
    assert response.status_code == 201, response.text
    return response.json()


async def detail(client, show):
    return (await client.get(f"{BASE}/shows/{show['id']}")).json()


def episodes_of(data):
    return {e["pid"]: e for s in data["series"] for e in s["episodes"]}


async def test_a_feed_is_previewed_added_and_read(client, admin, database, web):
    preview = await client.get(BASE + "/preview", params={"link": FEED})
    assert preview.status_code == 200, preview.text
    shown = preview.json()
    assert (shown["provider"], shown["source_name"], shown["title"]) == (
        "feed",
        "Podcast feed",
        "Test show",
    )
    assert (shown["author"], shown["artwork_url"], shown["episode_count"]) == (
        "A Maker",
        "https://img.example.org/art.png",
        3,
    )
    show = await add_link(client, FEED, follow="all")
    assert show["provider"] == "feed" and show["refresh"]["message"].endswith("its podcast feed")
    operation = await finish(database, show)
    assert operation.status == "completed", operation.message
    assert operation.message.startswith("Read 1 series and 3 episodes from its podcast feed")
    data = await detail(client, show)
    assert data["author"] == "A Maker" and data["web_url"] == "https://example.org/show"
    assert {e["status"]["kind"] for e in episodes_of(data).values()} == {"wanted"}
    assert episodes_of(data)["g1"]["duration_seconds"] == 1800
    art = await client.get(data["artwork_url"])
    assert (art.status_code, art.headers["content-type"]) == (200, "image/png")
    episode = episodes_of(data)["g2"]
    one = (await client.get(f"{BASE}/episodes/{episode['id']}")).json()
    assert one["source_url"] == "https://cdn.example.org/g2.mp3"
    # The same feed again, written another way, is the same show.
    again = await client.post(BASE + "/shows", json={"link": "HTTP://FEEDS.example.org/show.xml/"})
    web["pages"]["https://FEEDS.example.org/show.xml/"] = web["pages"][FEED]
    again = await client.post(BASE + "/shows", json={"link": "https://FEEDS.example.org/show.xml/"})
    assert again.status_code == 409


async def test_an_apple_link_is_saved_as_its_feed_and_known_by_both(client, admin, database, web):
    link = "https://podcasts.apple.com/gb/podcast/desert-island-discs/id342735925"
    show = await add_link(client, link)
    assert (show["provider"], show["external_id"]) == ("feed", FEED)
    by_feed = (await client.get(BASE + "/preview", params={"link": FEED})).json()
    assert by_feed["existing_show_id"] == show["id"]
    by_apple = (await client.get(BASE + "/preview", params={"link": link})).json()
    assert by_apple["existing_show_id"] == show["id"]
    # Search marks the Apple hit for this show as already added.
    found = (await client.get(BASE + "/search", params={"q": "desert island"})).json()
    apple = [item for item in found["items"] if item["source"] == "apple"]
    assert apple[0]["existing_show_id"] == show["id"]
    assert all(item["existing_show_id"] is None for item in apple[1:])


async def test_episodes_a_feed_drops_are_kept_and_marked(client, admin, database, web):
    show = await add_link(client, FEED, follow="all")
    await finish(database, show)
    web["pages"][FEED] = ("application/rss+xml", feed_body("g2", "g3"))
    await client.post(f"{BASE}/shows/{show['id']}/refresh")
    await finish(database, show)
    listed = episodes_of(await detail(client, show))
    assert set(listed) == {"g1", "g2", "g3"}
    assert listed["g1"]["removed_at"] and not listed["g2"]["removed_at"]
    # A feed that comes back empty (a broken feed) marks nothing more.
    web["pages"][FEED] = ("application/rss+xml", feed_body())
    await client.post(f"{BASE}/shows/{show['id']}/refresh")
    await finish(database, show)
    listed = episodes_of(await detail(client, show))
    assert not listed["g2"]["removed_at"]
    # It comes back: the mark goes.
    web["pages"][FEED] = ("application/rss+xml", feed_body("g1", "g2", "g3"))
    await client.post(f"{BASE}/shows/{show['id']}/refresh")
    await finish(database, show)
    assert not episodes_of(await detail(client, show))["g1"]["removed_at"]


async def test_a_broken_feed_fails_the_refresh_and_keeps_the_show(client, admin, database, web):
    show = await add_link(client, FEED)
    await finish(database, show)
    web["pages"][FEED] = ("text/html", b"<html>gone</html>")
    await client.post(f"{BASE}/shows/{show['id']}/refresh")
    operation = await finish(database, show)
    assert operation.status == "failed" and "not a podcast feed" in operation.message
    assert len(episodes_of(await detail(client, show))) == 3


async def test_episodes_and_series_are_monitored_by_hand(client, admin, database, web):
    show = await add_link(client, FEED, follow="none")
    await finish(database, show)
    data = await detail(client, show)
    episode = episodes_of(data)["g1"]
    assert episode["status"]["kind"] == "not_requested"
    wanted = await client.put(
        f"{BASE}/episodes/{episode['id']}/monitored", json={"monitored": True}
    )
    assert wanted.status_code == 200, wanted.text
    assert (wanted.json()["monitored"], wanted.json()["status"]["kind"]) == (True, "wanted")
    assert wanted.json()["status"]["detail"] == "Wanted by hand"
    assert wanted.json()["request"] is not None
    series = data["series"][0]["id"]
    every = await client.put(f"{BASE}/series/{series}/monitored", json={"monitored": True})
    assert every.status_code == 200 and every.json()["wanted_count"] == 3
    none = await client.put(f"{BASE}/series/{series}/monitored", json={"monitored": False})
    assert none.json()["wanted_count"] == 0
    # A new follow choice applies to every episode again, including those chosen by hand.
    await client.patch(f"{BASE}/shows/{show['id']}", json={"follow": "all"})
    after = episodes_of(await detail(client, show))
    assert {e["monitored"] for e in after.values()} == {None}
    assert {e["status"]["kind"] for e in after.values()} == {"wanted"}
    # Someone else's series cannot be changed.
    missing = await client.put(
        f"{BASE}/series/00000000-0000-0000-0000-000000000000/monitored", json={"monitored": True}
    )
    assert missing.status_code == 404


async def test_files_match_a_feed_by_guid_or_address(client, admin, database, web, tmp_path):
    show = await add_link(client, FEED, follow="all")
    await finish(database, show)
    async with database() as db, db.begin():
        server = Integration(
            kind="audiobookshelf",
            name="Home",
            base_url="https://abs.example.org/",
            encrypted_secrets="unused",
        )
        db.add(server)
        await db.flush()
        library = RadioLibrary(
            integration_id=server.id,
            external_id="radio",
            name="Radio",
            abs_folder="/radio",
            local_path=str(tmp_path),
        )
        db.add(library)
        await db.flush()
        now = datetime.now(UTC)
        for number, (guid, address) in enumerate(
            [("g1", None), (None, "https://cdn.example.org/g2.mp3"), (None, None)], start=1
        ):
            db.add(
                RadioLibraryFile(
                    library_id=library.id,
                    item_id="item-9",
                    episode_id=f"e{number}",
                    show_title="Something else entirely",
                    title=f"File {number}",
                    guid=guid,
                    enclosure_url=address,
                    path=f"/radio/x/{number}.mp3",
                    size=1,
                    seen_at=now,
                )
            )
    async with database() as db, db.begin():
        await radio_library.relink(db)
    data = await detail(client, show)
    listed = episodes_of(data)
    assert listed["g1"]["status"]["kind"] == "in_library"
    assert listed["g2"]["status"]["kind"] == "in_library"
    assert listed["g3"]["status"]["kind"] == "wanted"
    assert data["library_url"] == "https://abs.example.org/item/item-9"
    health = (await client.get(BASE + "/health")).json()
    assert health["items"] == []


async def test_health_explains_why_followed_shows_go_nowhere(client, admin, database, web):
    assert (await client.get(BASE + "/health")).json()["items"] == []
    show = await add_link(client, FEED, follow="none")
    assert (await client.get(BASE + "/health")).json()["items"] == []
    await client.patch(f"{BASE}/shows/{show['id']}", json={"follow": "from_now_on"})
    items = (await client.get(BASE + "/health")).json()["items"]
    assert [(item["kind"], item["fix"]) for item in items] == [("warning", "radio_library")]
    async with database() as db, db.begin():
        server = Integration(
            kind="audiobookshelf", name="Home", base_url="http://abs", encrypted_secrets="x"
        )
        db.add(server)
        await db.flush()
        db.add(
            RadioLibrary(
                integration_id=server.id,
                external_id="radio",
                name="Radio",
                abs_folder="/radio",
                local_path="/no/such/folder",
                last_error="The server could not be reached.",
            )
        )
    messages = [item["message"] for item in (await client.get(BASE + "/health")).json()["items"]]
    assert any("could not be read" in message for message in messages)
    assert any("cannot see the radio folder" in message for message in messages)


async def test_an_archive_item_keeps_its_licence(client, admin, database, web):
    preview = (
        await client.get(
            BASE + "/preview", params={"link": "https://archive.org/details/RaysALaugh1949"}
        )
    ).json()
    assert (preview["provider"], preview["licence"]) == ("archive", None)
    show = await add_link(client, "https://archive.org/details/RaysALaugh1949", follow="none")
    await finish(database, show)
    data = await detail(client, show)
    assert data["provider"] == "archive" and data["source_name"] == "Internet Archive"
    assert data["licence"] is None and data["episode_count"] > 3
    one = next(iter(episodes_of(data).values()))
    episode = (await client.get(f"{BASE}/episodes/{one['id']}")).json()
    assert episode["source_url"].startswith("https://archive.org/download/RaysALaugh1949/")


async def test_search_follows_the_country_and_sources_chosen(client, admin, database, web, bbc):
    everywhere = (await client.get(BASE + "/search", params={"q": "ray"})).json()
    assert everywhere["sources"] == ["BBC", "Apple Podcasts", "Internet Archive"]
    bbc["calls"].clear()
    saved = await client.patch(
        "/api/preferences", json={"radio_country": "US", "radio_sources": ["apple", "archive"]}
    )
    assert saved.status_code == 200, saved.text
    american = (await client.get(BASE + "/search", params={"q": "ray"})).json()
    assert american["sources"] == ["Apple Podcasts", "Internet Archive"]
    assert {item["source"] for item in american["items"]} == {"apple", "archive"}
    assert not [call for call in bbc["calls"] if "search" in call]
    web["down"].add("apple")
    partly = (await client.get(BASE + "/search", params={"q": "ray two"})).json()
    assert partly["failed"] == ["Apple Podcasts"] and partly["items"]
    cleared = await client.patch("/api/preferences", json={"radio_country": ""})
    assert cleared.json()["radio_country"] is None
    for wrong in (
        {"radio_country": "gb"},
        {"radio_sources": []},
        {"radio_sources": ["bbc", "bbc"]},
    ):
        assert (await client.patch("/api/preferences", json=wrong)).status_code == 422


async def test_feeds_are_read_every_hour_and_bbc_shows_twice_a_day(client, admin, database, web):
    show = await add_link(client, FEED, follow="all")
    await finish(database, show)
    now = datetime.now(UTC)
    async with database() as db, db.begin():
        row = await db.get(RadioShow, UUID(show["id"]))
        row.refreshed_at = now - timedelta(hours=2)
        row.operation_id = None
    async with database() as db, db.begin():
        assert [item.id for item in await radio_wanted.due_shows(db, now)] == []
        due = await radio_wanted.due_shows(db, now, feeds=True)
        assert [item.id for item in due] == [UUID(show["id"])]


async def test_links_to_private_addresses_are_refused(client, admin, database, bbc):
    for link in ("http://127.0.0.1/feed.xml", "http://169.254.169.254/latest", "http://[::1]/f"):
        response = await client.get(BASE + "/preview", params={"link": link})
        assert response.status_code == 422, (link, response.text)
        assert "public internet" in response.json()["detail"]
    async with database() as db:
        assert (await db.scalar(select(RadioEpisode.id).limit(1))) is None


async def test_an_unchanged_feed_costs_one_small_request(client, admin, database, web):
    show = await add_link(client, FEED, follow="all")
    await finish(database, show)
    await client.post(f"{BASE}/shows/{show['id']}/refresh")
    operation = await finish(database, show)
    assert operation.status == "completed"
    assert operation.message == "The podcast feed has not changed since it was last read"
    # The add and the first read sent no validators; the second read sent the ETag.
    assert web["validators"][-1] and web["validators"][-1][0].startswith('"')
    assert len(episodes_of(await detail(client, show))) == 3
    # The feed changes: it is read in full again.
    web["pages"][FEED] = ("application/rss+xml", feed_body("g1", "g2", "g3", "g4"))
    await client.post(f"{BASE}/shows/{show['id']}/refresh")
    operation = await finish(database, show)
    assert operation.message.startswith("Read 1 series and 4 episodes")

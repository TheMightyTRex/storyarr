"""Radio shows through the API: preview, add, refresh, follow, images, and who can see what."""

import json
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path
from uuid import UUID

import httpx
import pytest
from sqlalchemy import func, select

from app.adapters.contracts import AdapterError, FailureKind
from app.db.models import Operation, RadioEpisode, RadioSeries, RadioShow, RadioStation
from app.domain import radio, radio_images

pytestmark = pytest.mark.integration
BASE = "/api/radio"
RECORDED = json.loads(
    (Path(__file__).parents[1] / "fixtures/bbc/programmes.json").read_text(encoding="utf-8")
)
LOGO = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><path d="M0 0h4v4H0z"/></svg>'
JPEG = b"\xff\xd8\xff\xe0" + b"\x01" * 300


@pytest.fixture
def bbc(monkeypatch, tmp_path):
    """BBC programme data from recorded responses, and images from a stand-in server."""
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "radio_images_root", tmp_path / "radio-images")
    state = {"data": deepcopy(RECORDED), "calls": [], "images": [], "image_status": 200}

    @asynccontextmanager
    async def reader(*, provider="bbc"):
        async def fetch(path, params):
            state["calls"].append(path)
            if path not in state["data"]:
                raise radio.friendly(AdapterError(FailureKind.NOT_FOUND, "Not found"))
            return deepcopy(state["data"][path])

        yield fetch

    async def download(url, kinds, limit, *, transport=None):
        state["images"].append(url)
        if state["image_status"] != 200:
            raise radio_images.ImageError("unavailable")
        return LOGO if url.endswith(".svg") else JPEG

    monkeypatch.setattr(radio, "bbc", reader)
    monkeypatch.setattr(radio_images, "download", download)
    return state


async def add(client, link="https://www.bbc.co.uk/programmes/b007mf4f", follow=None):
    body = {"link": link, **({"follow": follow} if follow else {})}
    response = await client.post(BASE + "/shows", json=body)
    assert response.status_code == 201, response.text
    return response.json()


async def finish(database, show):
    async with database() as db:
        operation_id = (await db.get(RadioShow, UUID(show["id"]))).operation_id
    await radio.run(operation_id)
    async with database() as db:
        return await db.get(Operation, operation_id)


async def sign_in(client, username, role):
    from app.main import create_app

    created = await client.post(
        "/api/auth/users",
        json={
            "username": username,
            "password": f"a long {username} password",
            "display_name": username.title(),
            "role": role,
        },
    )
    assert created.status_code == 201, created.text
    other = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    )
    signed = await other.post(
        "/api/auth/login", json={"username": username, "password": f"a long {username} password"}
    )
    assert signed.status_code == 200, signed.text
    other.headers["X-CSRF-Token"] = signed.json()["csrf_token"]
    return other


async def test_preview_saves_nothing_and_add_reads_the_whole_show(client, admin, database, bbc):
    preview = await client.get(BASE + "/preview", params={"link": "bbc.co.uk/sounds/play/b0b1qdds"})
    assert preview.status_code == 200, preview.text
    shown = preview.json()
    assert (shown["pid"], shown["title"], shown["station"]["id"]) == (
        "b007mf4f",
        "The Unbelievable Truth",
        "bbc_radio_four",
    )
    assert (shown["series_count"], shown["episode_count"], shown["existing_show_id"]) == (
        1,
        210,
        None,
    )
    async with database() as db:
        assert await db.scalar(select(func.count()).select_from(RadioShow)) == 0

    show = await add(client)
    assert (show["follow"], show["refresh"]["status"]) == ("from_now_on", "queued")
    operation = await finish(database, show)
    assert operation.status == "completed", operation.message
    assert operation.message == "Read 1 series and 8 episodes from the BBC"

    detail = (await client.get(f"{BASE}/shows/{show['id']}")).json()
    assert detail["artwork_url"] == f"/api/radio/shows/{show['id']}/artwork"
    assert [(s["kind"], s["number"], s["episode_count"]) for s in detail["series"]] == [
        ("series", 20, 6),
        ("specials", 0, 2),
    ]
    series = detail["series"][0]
    assert series["station"]["logo_url"] == "/api/radio/stations/bbc_radio_four/logo"
    assert [episode["number"] for episode in series["episodes"]] == [1, 2, 3, 4, 5, 6]
    sixth = series["episodes"][-1]
    assert (sixth["pid"], sixth["duration_seconds"]) == ("b0b1qdds", 1800)
    # Followed from now on: earlier broadcasts are not requested.
    assert {episode["status"]["kind"] for episode in series["episodes"]} == {"not_requested"}

    again = await client.get(BASE + "/preview", params={"link": "b007mf4f"})
    assert again.json()["existing_show_id"] == show["id"]
    duplicate = await client.post(BASE + "/shows", json={"link": "b007mf4f"})
    assert duplicate.status_code == 409


async def test_follow_choice_changes_episode_statuses(client, admin, database, bbc):
    show = await add(client, "m0012qgy", follow="all")
    await finish(database, show)
    detail = (await client.get(f"{BASE}/shows/{show['id']}")).json()
    statuses = {e["status"]["kind"] for s in detail["series"] for e in s["episodes"]}
    assert statuses == {"wanted"}
    edited = await client.patch(f"{BASE}/shows/{show['id']}", json={"follow": "none"})
    assert edited.status_code == 200 and edited.json()["follow"] == "none"
    episode_id = detail["series"][0]["episodes"][0]["id"]
    episode = (await client.get(f"{BASE}/episodes/{episode_id}")).json()
    assert episode["status"] == {"kind": "not_requested", "label": "Not requested", "detail": None}
    assert (episode["show"]["title"], episode["series"]["number"]) == ("Sandi Toksvig's Hygge", 1)
    assert episode["series"]["station"]["id"] == "bbc_radio_four"
    assert (
        await client.patch(f"{BASE}/shows/{show['id']}", json={"follow": "some"})
    ).status_code == 422


async def test_lists_and_station_counts_follow_each_series(client, admin, database, bbc):
    moved = bbc["data"]["programmes/m0012qgx.json"]["programme"]
    moved["ownership"]["service"] = {"id": "bbc_radio_four_extra", "title": "BBC Radio 4 Extra"}
    hygge = await add(client, "https://www.bbc.co.uk/sounds/brand/m0012qgy")
    truth = await add(client, "b007mf4f", follow="none")
    await finish(database, hygge)
    await finish(database, truth)

    stations = (await client.get(BASE + "/stations")).json()["items"]
    assert [(s["id"], s["show_count"]) for s in stations] == [
        ("bbc_radio_four", 2),
        ("bbc_radio_four_extra", 1),
    ]
    extra = (await client.get(BASE + "/shows", params={"station": "bbc_radio_four_extra"})).json()
    assert [item["title"] for item in extra["items"]] == ["Sandi Toksvig's Hygge"]
    assert [s["id"] for s in extra["items"][0]["stations"]] == [
        "bbc_radio_four",
        "bbc_radio_four_extra",
    ]
    followed = (await client.get(BASE + "/shows", params={"followed": "true"})).json()
    assert [item["title"] for item in followed["items"]] == ["Sandi Toksvig's Hygge"]
    everything = (await client.get(BASE + "/shows")).json()
    assert [item["title"] for item in everything["items"]] == [
        "Sandi Toksvig's Hygge",
        "The Unbelievable Truth",
    ]
    assert everything["items"][0]["series_count"] == 2
    assert everything["items"][0]["episode_count"] == 10


async def test_images_are_saved_once_and_served_by_id(client, admin, database, bbc):
    show = await add(client)
    await finish(database, show)
    assert sorted(bbc["images"]) == [
        "https://ichef.bbci.co.uk/images/ic/640x640/p0m1qg1t.jpg",
        "https://sounds.files.bbci.co.uk/3.12.0/networks/bbc_radio_four/blocks-colour_default.svg",
    ]
    artwork = await client.get(f"{BASE}/shows/{show['id']}/artwork")
    assert (artwork.status_code, artwork.headers["content-type"], artwork.content) == (
        200,
        "image/jpeg",
        JPEG,
    )
    cached = await client.get(
        f"{BASE}/shows/{show['id']}/artwork", headers={"If-None-Match": artwork.headers["etag"]}
    )
    assert cached.status_code == 304
    logo = await client.get(BASE + "/stations/bbc_radio_four/logo")
    assert logo.status_code == 200 and logo.headers["content-type"] == "image/svg+xml"
    assert "sandbox" in logo.headers["content-security-policy"]
    assert logo.headers["x-content-type-options"] == "nosniff"
    # Reading pages never fetches images; only a refresh does, and a failure keeps the copy.
    await client.get(f"{BASE}/shows/{show['id']}")
    assert len(bbc["images"]) == 2
    bbc["image_status"] = 503
    refreshed = await client.post(f"{BASE}/shows/{show['id']}/refresh")
    assert refreshed.status_code == 202
    await finish(database, show)
    assert len(bbc["images"]) == 4
    assert (await client.get(f"{BASE}/shows/{show['id']}/artwork")).content == JPEG
    assert (await client.get(BASE + "/stations/bbc_radio_two/logo")).status_code == 404


async def test_a_show_without_images_has_no_image(client, admin, database, bbc):
    bbc["image_status"] = 503
    show = await add(client)
    await finish(database, show)
    detail = (await client.get(f"{BASE}/shows/{show['id']}")).json()
    assert detail["artwork_url"] is None and detail["station"]["logo_url"] is None
    assert (await client.get(f"{BASE}/shows/{show['id']}/artwork")).status_code == 404


async def test_refresh_reuses_a_waiting_job_and_skips_settled_series(client, admin, database, bbc):
    show = await add(client, "m0012qgy")
    first = await client.post(f"{BASE}/shows/{show['id']}/refresh")
    assert first.json()["id"] == show["refresh"]["id"]
    await finish(database, show)
    bbc["calls"].clear()
    second = await client.post(f"{BASE}/shows/{show['id']}/refresh")
    assert second.status_code == 202 and second.json()["id"] != show["refresh"]["id"]
    operation = await finish(database, show)
    # Both series are complete and long finished, so only the show and its list are read
    # (and episode pages for lengths still missing).
    assert bbc["calls"][:2] == ["programmes/m0012qgy.json", "programmes/m0012qgy/children.json"]
    assert not [call for call in bbc["calls"] if "m000py9t" in call or "m0012qgx" in call]
    assert "2 finished series were already up to date" in operation.message
    async with database() as db:
        assert await db.scalar(select(func.count()).select_from(RadioEpisode)) == 10


async def test_a_missing_or_changed_feed_is_explained(client, admin, database, bbc):
    missing = await client.get(BASE + "/preview", params={"link": "b00zzzzz"})
    assert missing.status_code == 404
    assert missing.json()["detail"] == "The BBC has no programme with this id. Check the link."
    bad = await client.get(BASE + "/preview", params={"link": "https://example.com/programmes/x"})
    assert bad.status_code == 422
    show = await add(client, "m0012qgy")
    bbc["data"]["programmes/m0012qgy/children.json"] = {"children": {"programmes": "?"}}
    operation = await finish(database, show)
    assert operation.status == "failed"
    assert operation.message.startswith("The BBC programme data has changed")
    # The show keeps what was saved when it was added.
    async with database() as db:
        assert await db.scalar(select(func.count()).select_from(RadioSeries)) == 2


async def test_shows_belong_to_the_person_who_added_them(client, admin, database, bbc):
    show = await add(client)
    await finish(database, show)
    episode_id = (await client.get(f"{BASE}/shows/{show['id']}")).json()["series"][0]["episodes"][
        0
    ]["id"]
    member = await sign_in(client, "member", "member")
    viewer = await sign_in(client, "viewer", "viewer")
    try:
        assert (await member.get(BASE + "/shows")).json() == {"items": [], "total": 0}
        assert (await member.get(BASE + "/stations")).json() == {"items": []}
        for path in (
            f"/shows/{show['id']}",
            f"/shows/{show['id']}/artwork",
            f"/episodes/{episode_id}",
        ):
            assert (await member.get(BASE + path)).status_code == 404
        assert (await member.post(f"{BASE}/shows/{show['id']}/refresh")).status_code == 404
        assert (
            await member.patch(f"{BASE}/shows/{show['id']}", json={"follow": "all"})
        ).status_code == 404
        assert (await member.delete(f"{BASE}/shows/{show['id']}")).status_code == 404
        # Stations are shared, so anyone signed in can see a logo.
        assert (await member.get(BASE + "/stations/bbc_radio_four/logo")).status_code == 200
        # The same show can be added by someone else, as their own.
        theirs = await add(member, "b007mf4f")
        assert theirs["id"] != show["id"]
        # Viewers can read but not add or look up shows.
        assert (await viewer.get(BASE + "/shows")).status_code == 200
        assert (await viewer.post(BASE + "/shows", json={"link": "b007mf4f"})).status_code == 403
        assert (await viewer.get(BASE + "/preview", params={"link": "b007mf4f"})).status_code == 403
        assert (await viewer.get(BASE + "/search", params={"q": "truth"})).status_code == 403
    finally:
        await member.aclose()
        await viewer.aclose()
    signed_out = httpx.AsyncClient(transport=client._transport, base_url="http://testserver")
    async with signed_out:
        assert (await signed_out.get(BASE + "/shows")).status_code == 401
        assert (await signed_out.get(BASE + "/stations/bbc_radio_four/logo")).status_code == 401


async def test_removing_a_show_removes_its_series_and_episodes(client, admin, database, bbc):
    show = await add(client)
    await finish(database, show)
    removed = await client.delete(f"{BASE}/shows/{show['id']}")
    assert removed.status_code == 204
    assert (await client.get(f"{BASE}/shows/{show['id']}")).status_code == 404
    async with database() as db:
        for model in (RadioShow, RadioSeries, RadioEpisode):
            assert await db.scalar(select(func.count()).select_from(model)) == 0
        # Stations and saved images stay.
        assert await db.get(RadioStation, "bbc_radio_four")
    assert radio_images.read("shows/b007mf4f.jpg") == JPEG


async def test_name_search_uses_bbc_sounds(client, admin, bbc):
    found = await client.get(BASE + "/search", params={"q": "unbelievable truth"})
    assert found.status_code == 200, found.text
    first = found.json()["items"][0]
    assert (first["pid"], first["station_id"]) == ("b007mf4f", "bbc_radio_four")
    assert bbc["calls"] == ["v2/programmes/search/container"]


async def test_name_search_falls_back_to_the_bbc_a_to_z(client, admin, bbc):
    """BBC Sounds has no show called this, so the BBC programmes A to Z is read too."""
    service = {"type": "radio", "id": "bbc_radio_four", "title": "BBC Radio 4"}
    bbc["data"]["programmes/a-z/by/c/all.json"] = {
        "atoz": {
            "total": 2,
            "tleo_titles": [
                {
                    "title": "Cabin Pressure",
                    "programme": {
                        "pid": "b00lmcxj",
                        "title": "Cabin Pressure",
                        "type": "brand",
                        "ownership": {"service": service},
                    },
                },
                {
                    "title": "Cabin Pressure",
                    "programme": {"pid": "b00ph8rn", "title": "Cabin Pressure", "type": "episode"},
                },
            ],
        }
    }
    found = await client.get(BASE + "/search", params={"q": "Cabin Pressure"})
    assert found.status_code == 200, found.text
    items = found.json()["items"]
    assert (items[0]["pid"], items[0]["station_name"]) == ("b00lmcxj", "BBC Radio 4")
    assert "b00ph8rn" not in [item["pid"] for item in items]
    assert bbc["calls"] == ["v2/programmes/search/container", "programmes/a-z/by/c/all.json"]


async def test_bbc_reads_are_cached_through_the_catalog_gateway(client, admin, monkeypatch):
    """The real reader: one request per address, then the saved copy; missing ids are explained."""
    requests = []

    def respond(request):
        requests.append(request.url.path)
        path = request.url.path.lstrip("/")
        if path not in RECORDED:
            return httpx.Response(404)
        return httpx.Response(200, json=RECORDED[path])

    monkeypatch.setattr(radio, "TRANSPORT", httpx.MockTransport(respond))
    monkeypatch.setattr(radio, "REQUEST_INTERVAL", 0)
    for _ in range(2):
        preview = await client.get(BASE + "/preview", params={"link": "m0012qgy"})
        assert preview.status_code == 200, preview.text
    assert requests == ["/programmes/m0012qgy.json", "/programmes/m0012qgy/children.json"]
    missing = await client.get(BASE + "/preview", params={"link": "b00zzzzz"})
    assert missing.status_code == 404
    assert "no programme with this id" in missing.json()["detail"]

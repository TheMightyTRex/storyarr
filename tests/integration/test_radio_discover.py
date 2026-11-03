"""Discover, For you, Radio: stations, popular shows by type or station, and the saved types."""

import json
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path

import pytest

from app.adapters.contracts import AdapterError, FailureKind
from app.db.models import RadioShow, RadioStation
from app.domain import radio

pytestmark = pytest.mark.integration
BASE = "/api/radio/discover"
RECORDED = json.loads(
    (Path(__file__).parents[1] / "fixtures/bbc/popular.json").read_text(encoding="utf-8")
)


@pytest.fixture
def sounds(monkeypatch):
    """BBC Sounds popular episodes from recorded responses, keyed by category or station."""
    calls = []

    @asynccontextmanager
    async def reader(*, provider="bbc"):
        async def fetch(path, params):
            calls.append((provider, path, dict(params)))
            key = (
                f"category={params['category']}"
                if "category" in params
                else f"network={params.get('network')}"
            )
            if key not in RECORDED:
                raise radio.friendly(AdapterError(FailureKind.UNAVAILABLE, "Down"))
            return deepcopy(RECORDED[key])

        yield fetch

    monkeypatch.setattr(radio, "bbc", reader)
    return calls


async def test_popular_shows_are_one_per_show_in_popularity_order(client, admin, sounds):
    found = await client.get(BASE + "/popular", params={"type": "comedy"})
    assert found.status_code == 200, found.text
    items = found.json()["items"]
    titles = [item["title"] for item in items]
    assert titles[:4] == [
        "Room 101 with Paul Merton",
        "Dad's Army",
        "Elis James and John Robins",
        "Murder They Wrote with Laura Whitmore and Iain Stirling",
    ]
    assert len(titles) == len(set(titles)) == 12
    first = items[0]
    assert (first["pid"], first["station_id"], first["station_name"]) == (
        "m001x0mr",
        "bbc_radio_four",
        "Radio 4",
    )
    assert first["image_url"].startswith("https://ichef.bbci.co.uk/images/ic/320x320/")
    assert first["show_id"] is None
    assert sounds == [
        (
            "bbc-sounds",
            "v2/programmes/playable",
            {"sort": "popular", "limit": 60, "category": "comedy"},
        )
    ]


async def test_popular_by_station_and_shows_already_added(client, admin, database, sounds):
    async with database() as db, db.begin():
        user_id = (await db.scalars(select_admin())).one()
        db.add(RadioShow(owner_id=user_id, external_id="b006qpgr", title="The Archers"))
    found = await client.get(BASE + "/popular", params={"station": "bbc_radio_four"})
    assert found.status_code == 200, found.text
    archers = found.json()["items"][0]
    assert archers["title"] == "The Archers"
    assert archers["show_id"]


async def test_popular_checks_its_choice(client, admin, sounds):
    for params in ({}, {"type": "comedy", "station": "bbc_radio_four"}, {"type": "westerns"}):
        assert (await client.get(BASE + "/popular", params=params)).status_code == 422
    assert (await client.get(BASE + "/popular", params={"station": "Radio 4!"})).status_code == 422
    down = await client.get(BASE + "/popular", params={"type": "news"})
    assert down.status_code == 503, down.text
    assert sounds[-1][2]["category"] == "news"


async def test_five_stations_with_the_persons_own_first(client, admin, database):
    empty = (await client.get(BASE)).json()
    assert [station["id"] for station in empty["stations"]] == [
        "bbc_radio_four",
        "bbc_radio_four_extra",
        "bbc_radio_two",
        "bbc_radio_five_live",
        "bbc_world_service",
    ]
    assert empty["chosen"] == ["comedy", "drama-scifiandfantasy", "news"]
    assert {
        "id": "drama-scifiandfantasy",
        "label": "Science fiction and fantasy",
        "group": "Drama",
    } in empty["types"]
    async with database() as db, db.begin():
        user_id = (await db.scalars(select_admin())).one()
        db.add(RadioStation(id="bbc_6music", name="Radio 6 Music"))
        await db.flush()
        for pid in ("b0000001", "b0000002"):
            db.add(RadioShow(owner_id=user_id, external_id=pid, title=pid, station_id="bbc_6music"))
    stations = (await client.get(BASE)).json()["stations"]
    assert [(s["id"], s["show_count"]) for s in stations[:2]] == [
        ("bbc_6music", 2),
        ("bbc_radio_four", 0),
    ]
    assert len(stations) == 5
    assert stations[0]["logo_url"].startswith("https://sounds.files.bbci.co.uk/")


async def test_chosen_types_save_with_the_account(client, admin):
    saved = await client.patch("/api/preferences", json={"radio_types": ["drama-crime", "news"]})
    assert saved.status_code == 200, saved.text
    assert saved.json()["radio_types"] == ["drama-crime", "news"]
    assert (await client.get(BASE)).json()["chosen"] == ["drama-crime", "news"]
    for wrong in (["westerns"], ["news", "news"]):
        response = await client.patch("/api/preferences", json={"radio_types": wrong})
        assert response.status_code == 422, wrong
    cleared = await client.patch("/api/preferences", json={"radio_types": []})
    assert cleared.json()["radio_types"] == []


def select_admin():
    from sqlalchemy import select

    from app.db.models import User

    return select(User.id).where(User.role == "admin").limit(1)

"""BBC radio data: links, the brand to series to episode walk, numbering and stations."""

import json
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.adapters import bbc_programmes as bbc
from app.adapters.contracts import AdapterError, FailureKind
from app.db.models import RADIO_EPISODE_STATUS
from app.domain.follow_status import STATUS_KINDS
from app.domain.radio import episode_status, friendly

RECORDED = json.loads(
    (Path(__file__).parents[1] / "fixtures/bbc/programmes.json").read_text(encoding="utf-8")
)


def feed(overrides=None):
    """A fetch that answers from the recorded BBC responses and logs each request."""
    data = {**deepcopy(RECORDED), **(overrides or {})}

    async def fetch(path, params):
        fetch.calls.append((path, params))
        if path not in data:
            raise AdapterError(FailureKind.NOT_FOUND, "missing")
        return deepcopy(data[path])

    fetch.calls = []
    return fetch


@pytest.mark.parametrize(
    "link",
    [
        "b007mf4f",
        "https://www.bbc.co.uk/programmes/b007mf4f",
        "https://www.bbc.co.uk/programmes/b007mf4f/episodes/guide",
        "www.bbc.co.uk/programmes/b007mf4f.json",
        "http://bbc.co.uk/sounds/brand/b007mf4f",
        "https://www.bbc.co.uk/sounds/series/b007mf4f?partner=x",
        "  https://www.bbc.com/sounds/play/b007mf4f  ",
    ],
)
def test_links_give_the_pid(link):
    assert bbc.parse_link(link) == "b007mf4f"


@pytest.mark.parametrize(
    "link",
    [
        "",
        "unbelievable truth",
        "https://example.com/programmes/b007mf4f",
        "https://www.bbc.co.uk.evil.test/programmes/b007mf4f",
        "https://user@www.bbc.co.uk/programmes/b007mf4f",
        "https://www.bbc.co.uk/sounds/category/comedy",
        "https://www.bbc.co.uk/programmes/aeiou123",
        "ftp://www.bbc.co.uk/programmes/b007mf4f",
    ],
)
def test_other_links_are_refused(link):
    with pytest.raises(bbc.LinkError):
        bbc.parse_link(link)


def test_numbering_falls_back_to_first_broadcast_order():
    items = [
        {"pid": "a", "position": 2, "first_broadcast_date": "2020-01-08T00:00:00Z"},
        {"pid": "b", "position": None, "first_broadcast_date": "2021-01-01T00:00:00Z"},
        {"pid": "c", "position": 1, "first_broadcast_date": "2020-01-01T00:00:00Z"},
        {"pid": "d", "first_broadcast_date": "2019-06-01T00:00:00Z"},
        {"pid": "e", "position": None, "first_broadcast_date": None},
    ]
    numbered = [(item["pid"], number, source) for item, number, source in bbc.numbered(items)]
    assert numbered == [
        ("c", 1, "bbc"),
        ("a", 2, "bbc"),
        ("d", 3, "broadcast_order"),
        ("b", 4, "broadcast_order"),
        ("e", 5, "broadcast_order"),
    ]


async def test_walk_reads_brand_series_and_episodes_with_specials():
    fetch = feed()
    show = await bbc.walk(fetch, "b007mf4f", known_durations=set(), duration_budget=1)
    assert (show.title, show.station, show.image_pid) == (
        "The Unbelievable Truth",
        ("bbc_radio_four", "BBC Radio 4"),
        "p0m1qg1t",
    )
    (series, specials) = show.series
    assert (series.number, series.number_source, series.title) == (20, "bbc", "Series 20")
    assert series.expected_episodes == 6
    assert series.station == ("bbc_radio_four", "BBC Radio 4")
    assert [episode.number for episode in series.episodes] == [1, 2, 3, 4, 5, 6]
    assert {episode.number_source for episode in series.episodes} == {"bbc"}
    # Episodes listed straight under the brand become specials, in broadcast order.
    assert (specials.kind, specials.number, specials.pid) == ("specials", 0, "b007mf4f")
    assert [episode.title for episode in specials.episodes] == [
        "Christmas Special",
        "New Year Special",
    ]
    assert [episode.number for episode in specials.episodes] == [1, 2]
    # One episode length per request; the newest broadcast episode is read first.
    assert series.episodes[-1].pid == "b0b1qdds"
    assert show.durations == {"b0b1qdds": 1800}
    assert fetch.calls[-1] == ("programmes/b0b1qdds.json", None)


async def test_episode_lengths_are_best_effort_and_include_saved_episodes():
    fetch = feed()
    show = await bbc.walk(
        fetch,
        "m0012qgy",
        settled={"m000py9t", "m0012qgx"},
        stored_missing=[("b0b1qdds", datetime(2018, 5, 7, tzinfo=UTC)), ("b00zzzzz", None)],
        duration_budget=5,
    )
    assert show.durations == {"b0b1qdds": 1800}
    # Episode pages the BBC does not have are skipped without failing the walk.
    show = await bbc.walk(feed(), "m0012qgy", duration_budget=3)
    assert show.durations == {}


async def test_settled_series_are_not_read_again():
    fetch = feed()
    show = await bbc.walk(fetch, "m0012qgy", settled={"m000py9t"})
    second, first = show.series[1], show.series[0]
    assert (first.number, first.episodes) == (1, None)
    assert [episode.title for episode in second.episodes][:1] == ["Krishnan Guru-Murthy"]
    assert ("programmes/m000py9t/children.json", {"limit": 50}) not in fetch.calls
    assert ("programmes/m000py9t.json", None) not in fetch.calls


async def test_a_show_that_moved_station_keeps_a_station_per_series():
    moved = deepcopy(RECORDED["programmes/m0012qgx.json"])
    moved["programme"]["ownership"]["service"] = {
        "id": "bbc_radio_four_extra",
        "title": "BBC Radio 4 Extra",
    }
    show = await bbc.walk(feed({"programmes/m0012qgx.json": moved}), "m0012qgy")
    assert [(item.number, item.station[0]) for item in show.series] == [
        (1, "bbc_radio_four"),
        (2, "bbc_radio_four_extra"),
    ]


async def test_series_without_positions_use_broadcast_order():
    listing = deepcopy(RECORDED["programmes/m0012qgy/children.json"])
    for item in listing["children"]["programmes"]:
        item["position"] = None
    episodes = deepcopy(RECORDED["programmes/m0012qgx/children.json"])
    for item in episodes["children"]["programmes"]:
        item.pop("position")
    show = await bbc.walk(
        feed(
            {
                "programmes/m0012qgy/children.json": listing,
                "programmes/m0012qgx/children.json": episodes,
            }
        ),
        "m0012qgy",
    )
    assert [(item.pid, item.number, item.number_source) for item in show.series] == [
        ("m000py9t", 1, "broadcast_order"),
        ("m0012qgx", 2, "broadcast_order"),
    ]
    later = show.series[1].episodes
    assert [episode.title for episode in later][:2] == ["Krishnan Guru-Murthy", "Gina Miller"]
    assert {episode.number_source for episode in later} == {"broadcast_order"}


async def test_an_episode_link_resolves_to_its_brand():
    fetch = feed()
    show = await bbc.preview(fetch, "b0b1qdds")
    assert show.pid == "b007mf4f"
    assert fetch.calls[:2] == [
        ("programmes/b0b1qdds.json", None),
        ("programmes/b007mf4f.json", None),
    ]


async def test_a_single_programme_is_not_a_show():
    lone = deepcopy(RECORDED["programmes/b0b1qdds.json"])
    del lone["programme"]["parent"]
    with pytest.raises(AdapterError, match="single programme"):
        await bbc.preview(feed({"programmes/b0b1qdds.json": lone}), "b0b1qdds")


async def test_children_are_read_page_by_page():
    first = deepcopy(RECORDED["programmes/m0012qgy/children.json"])
    first["children"]["total"] = 3
    second = {
        "children": {"page": 2, "total": 3, "programmes": [first["children"]["programmes"][0]]}
    }
    pages = {1: first, 2: second}

    async def fetch(path, params):
        fetch.calls.append(params)
        return deepcopy(pages[params.get("page", 1)])

    fetch.calls = []
    assert len(await bbc.children(fetch, "m0012qgy")) == 3
    assert fetch.calls == [{"limit": 50}, {"limit": 50, "page": 2}]


async def test_a_changed_or_missing_feed_says_so():
    changed = {"children": {"items": []}}
    with pytest.raises(AdapterError) as error:
        await bbc.preview(feed({"programmes/m0012qgy/children.json": changed}), "m0012qgy")
    assert (error.value.kind, str(error.value)) == (FailureKind.PARSER, bbc.CHANGED)
    with pytest.raises(AdapterError) as error:
        await bbc.preview(
            feed({"programmes/m0012qgy.json": {"programme": {"pid": "x"}}}), "m0012qgy"
        )
    assert error.value.kind == FailureKind.PARSER
    with pytest.raises(AdapterError) as error:
        await bbc.preview(feed(), "b00zzzzz")
    assert error.value.kind == FailureKind.NOT_FOUND


def test_gateway_errors_are_explained_in_bbc_terms():
    gone = friendly(
        AdapterError(FailureKind.NOT_FOUND, "The requested library item was not found.")
    )
    assert str(gone) == "The BBC has no programme with this id. Check the link."
    moved = friendly(AdapterError(FailureKind.ROUTE, "The server redirected the request."))
    assert "could not be reached" in str(moved)
    unreadable = friendly(AdapterError(FailureKind.PARSER, "unreadable API response"))
    assert str(unreadable) == bbc.CHANGED


def test_sounds_search_results():
    results = bbc.search_results(RECORDED["v2/programmes/search/container"])
    assert results[0].pid == "b007mf4f"
    assert (results[0].title, results[0].station_id, results[0].image_pid) == (
        "The Unbelievable Truth",
        "bbc_radio_four",
        "p0m1qg1t",
    )
    with pytest.raises(AdapterError):
        bbc.search_results({"results": []})


def test_episode_status_from_broadcast_and_follow():
    now = datetime(2026, 11, 2, tzinfo=UTC)
    followed = now - timedelta(days=7)
    past, recent, future = (
        now - timedelta(days=30),
        now - timedelta(days=1),
        now + timedelta(days=2),
    )
    assert episode_status(future, "all", followed, now=now) == "not_released"
    assert episode_status(past, "all", followed, now=now) == "wanted"
    assert episode_status(past, "from_now_on", followed, now=now) == "not_requested"
    assert episode_status(recent, "from_now_on", followed, now=now) == "wanted"
    assert episode_status(recent, "none", None, now=now) == "not_requested"
    # Statuses set by downloads and imports are kept.
    assert episode_status(past, "none", None, "in_library", now=now) == "in_library"


def test_episode_statuses_use_the_follow_status_words():
    assert set(RADIO_EPISODE_STATUS) == set(STATUS_KINDS)

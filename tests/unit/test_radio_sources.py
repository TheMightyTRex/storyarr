"""Radio sources beyond the BBC (RADIO-02): podcast feeds, Apple Podcasts, the Internet Archive,
reading public web addresses safely, and radio release names (RADIO-01)."""

import json
from datetime import UTC, date, datetime
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException

from app.adapters import apple_podcasts, archive_radio, podcast_feed, public_web
from app.adapters.contracts import AdapterError, FailureKind
from app.domain import radio_releases, radio_sources

FIXTURES = Path(__file__).parents[1] / "fixtures/radio"
IN_OUR_TIME = (FIXTURES / "in-our-time.rss").read_bytes()


def feed(items: str, channel: str = "<title>Test show</title>") -> bytes:
    return (
        '<?xml version="1.0"?><rss version="2.0" '
        'xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">'
        f"<channel>{channel}{items}</channel></rss>"
    ).encode()


def item(guid, *, season=None, episode=None, kind=None, date_="Mon, 03 Nov 2025 10:00:00 GMT"):
    parts = [f"<guid>{guid}</guid>", f"<title>Title {guid}</title>", f"<pubDate>{date_}</pubDate>"]
    parts.append(f'<enclosure url="https://cdn.example.org/{guid}.mp3" type="audio/mpeg"/>')
    if season is not None:
        parts.append(f"<itunes:season>{season}</itunes:season>")
    if episode is not None:
        parts.append(f"<itunes:episode>{episode}</itunes:episode>")
    if kind:
        parts.append(f"<itunes:episodeType>{kind}</itunes:episodeType>")
    return "<item>" + "".join(parts) + "</item>"


# Podcast feeds


def test_a_real_feed_is_read_as_one_show():
    show = podcast_feed.parse("https://podcasts.files.bbci.co.uk/b006qykl.rss", IN_OUR_TIME)
    assert (show.provider, show.title, show.author) == ("feed", "In Our Time", "BBC Radio 4")
    assert show.artwork_url.endswith(".jpg") and show.web_url.endswith("b006qykl")
    assert [series.pid for series in show.series] == ["season:1"]
    episodes = show.series[0].episodes
    assert len(episodes) == 4 and [episode.number for episode in episodes] == [1, 2, 3, 4]
    assert all(episode.pid.startswith("urn:bbc:podcast:") for episode in episodes)
    assert all(episode.enclosure_url.startswith("http") for episode in episodes)
    assert all(episode.duration_seconds and episode.duration_seconds > 60 for episode in episodes)
    # Show notes are plain text, with no HTML left.
    assert "<p>" not in show.synopsis and "world-class seminar" in show.synopsis
    # Broadcast order: the oldest is episode 1.
    dates = [episode.first_broadcast for episode in episodes]
    assert dates == sorted(dates)


def test_seasons_specials_and_numbers():
    show = podcast_feed.parse(
        "https://example.org/feed",
        feed(
            item("a", season=2, episode=5)
            + item("b", season=2, date_="Tue, 04 Nov 2025 10:00:00 GMT")
            + item("c", season=2, episode=5, date_="Wed, 05 Nov 2025 10:00:00 GMT")
            + item("d")
            + item("t", kind="trailer")
            + item("e", kind="bonus", season=2)
            + item("a", season=2, episode=9)  # the same guid twice: the first one counts
        ),
    )
    by_pid = {series.pid: series for series in show.series}
    assert list(by_pid) == ["season:1", "season:2", "specials"]
    assert (by_pid["specials"].kind, by_pid["specials"].number) == ("specials", 0)
    second = {episode.pid: episode for episode in by_pid["season:2"].episodes}
    assert (second["a"].number, second["a"].number_source) == (5, "source")
    # Numbers the feed does not give, or gives twice, are the lowest free ones in date order.
    assert (second["b"].number, second["b"].number_source) == (1, "broadcast_order")
    assert (second["c"].number, second["c"].number_source) == (2, "broadcast_order")
    assert [episode.pid for episode in by_pid["season:1"].episodes] == ["d"]
    assert sorted(episode.pid for episode in by_pid["specials"].episodes) == ["e", "t"]
    assert show.episode_count == 6


def test_long_ids_are_kept_as_a_stable_digest():
    guid = "https://example.org/" + "x" * 400
    first = podcast_feed.parse("https://example.org/f", feed(item(guid)))
    again = podcast_feed.parse("https://example.org/f", feed(item(guid)))
    pid = first.series[0].episodes[0].pid
    assert pid.startswith("sha1:") and len(pid) <= 200
    assert again.series[0].episodes[0].pid == pid


@pytest.mark.parametrize(
    ("value", "seconds"),
    [
        ("1:02:03", 3723),
        ("45:30", 2730),
        ("1800", 1800),
        ("12.5", 12),
        ("", None),
        ("x", None),
        ("-5", None),
        ("1:2:3:4", None),
        ("99999999", None),
    ],
)
def test_lengths(value, seconds):
    assert podcast_feed.duration(value) == seconds


@pytest.mark.parametrize(
    "body",
    [
        b"",
        b"not xml at all",
        b"<html><body>Hello</body></html>",
        b'<?xml version="1.0"?><rss><channel><item/></channel></rss>',  # no title
        b'<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A</title></feed>',
    ],
)
def test_what_is_not_a_feed_is_refused(body):
    with pytest.raises(AdapterError) as raised:
        podcast_feed.parse("https://example.org/f", body)
    assert raised.value.kind == FailureKind.PARSER


def test_entity_expansion_and_external_entities_are_refused():
    laughs = (
        b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaaaaaaaa">'
        b'<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;">]>'
        b"<rss><channel><title>&c;</title></channel></rss>"
    )
    external = (
        b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
        b"<rss><channel><title>&x;</title></channel></rss>"
    )
    for body in (laughs, external):
        with pytest.raises(AdapterError):
            podcast_feed.parse("https://example.org/f", body)


def test_hostile_text_stays_text():
    show = podcast_feed.parse(
        "https://example.org/f",
        feed(
            "<item><guid>1</guid><title><![CDATA[<script>alert(1)</script>Ep]]></title>"
            "<description><![CDATA[<img src=x onerror=alert(1)><b>Bold</b>]]></description>"
            '<enclosure url="javascript:alert(1)"/></item>',
            channel="<title><![CDATA[<b>Name</b>]]></title><link>javascript:alert(1)</link>"
            '<itunes:image href="data:image/png;base64,AAAA"/>',
        ),
    )
    episode = show.series[0].episodes[0]
    assert show.title == "Name" and show.web_url is None and show.artwork_url is None
    assert "<" not in episode.title and episode.synopsis == "Bold"
    assert episode.enclosure_url is None


def test_a_web_page_leads_to_its_feed():
    html = (
        b"<html><head><link rel='stylesheet' href='/a.css'>"
        b'<link rel="alternate" type="application/rss+xml" href="/podcast.xml"></head></html>'
    )
    assert podcast_feed.feed_link("https://example.org/show/", html) == (
        "https://example.org/podcast.xml"
    )
    assert podcast_feed.feed_link("https://example.org/", b"<html></html>") is None
    javascript = b'<link rel="alternate" type="application/rss+xml" href="javascript:x">'
    assert podcast_feed.feed_link("https://example.org/", javascript) is None


async def test_reading_a_page_follows_one_feed_link_only():
    pages = {
        "https://example.org/show": public_web.Page(
            "https://example.org/show",
            "text/html",
            b'<link rel="alternate" type="application/rss+xml" href="/again">',
        ),
        "https://example.org/again": public_web.Page(
            "https://example.org/again",
            "text/html",
            b'<link rel="alternate" type="application/rss+xml" href="/show">',
        ),
    }
    calls = []

    async def fetch(url):
        calls.append(url)
        return pages[url]

    with pytest.raises(AdapterError):
        await podcast_feed.read("https://example.org/show", fetch)
    assert calls == ["https://example.org/show", "https://example.org/again"]


async def test_a_moved_feed_remembers_the_old_address():
    async def fetch(url):
        return public_web.Page("https://new.example.org/feed", "application/rss+xml", IN_OUR_TIME)

    show = await podcast_feed.read("http://old.example.org/feed", fetch)
    assert show.pid == "https://new.example.org/feed"
    assert show.aliases == [("feed", "http://old.example.org/feed")]


# Links and sources


@pytest.mark.parametrize(
    ("link", "kind", "value"),
    [
        ("b006qykl", "bbc", "b006qykl"),
        ("https://www.bbc.co.uk/sounds/brand/b006qykl", "bbc", "b006qykl"),
        (
            "https://podcasts.apple.com/gb/podcast/desert-island-discs/id342735925",
            "apple",
            "342735925",
        ),
        ("podcasts.apple.com/us/podcast/x/id1200361736?i=1000", "apple", "1200361736"),
        ("https://archive.org/details/RaysALaugh1949", "archive", "RaysALaugh1949"),
        (
            "https://podcasts.files.bbci.co.uk/b006qykl.rss",
            "feed",
            "https://podcasts.files.bbci.co.uk/b006qykl.rss",
        ),
        ("feeds.example.com/show.xml", "feed", "https://feeds.example.com/show.xml"),
    ],
)
def test_links_choose_their_source(link, kind, value):
    assert radio_sources.classify(link) == (kind, value)


@pytest.mark.parametrize(
    "link",
    [
        "",
        "not a link at all",
        "ftp://example.org/feed.xml",
        "file:///etc/passwd",
        "https://user:secret@example.org/feed",
        "https://www.bbc.co.uk/news",
        "https://podcasts.apple.com/gb/browse",
        "https://archive.org/search?query=goon",
        "localhost",
        "https://" + "a" * 1000 + ".org",
    ],
)
def test_links_that_are_not_shows_are_refused(link):
    with pytest.raises(HTTPException) as raised:
        radio_sources.classify(link)
    assert raised.value.status_code == 422


def test_the_bbc_is_offered_for_the_united_kingdom_only():
    everywhere = radio_sources.Prefs()
    assert radio_sources.offered(everywhere) == ["bbc", "apple", "archive"]
    assert radio_sources.offered(radio_sources.Prefs(country="GB", language="cy")) == [
        "bbc",
        "apple",
        "archive",
    ]
    assert radio_sources.offered(radio_sources.Prefs(country="US")) == ["apple", "archive"]
    assert radio_sources.offered(radio_sources.Prefs(language="de")) == ["apple", "archive"]
    assert radio_sources.offered(radio_sources.Prefs(sources=("archive",))) == ["archive"]


async def test_search_lists_each_feed_once_and_survives_a_failing_source(monkeypatch):
    async def bbc(query):
        raise AdapterError(FailureKind.UNAVAILABLE, "down")

    async def apple(query, prefs):
        return [
            radio_sources.Hit("apple", "https://a.example/feed", "A"),
            radio_sources.Hit("apple", "HTTP://A.example/feed/", "A again"),
        ]

    async def archive(query):
        return [radio_sources.Hit("archive", "https://archive.org/details/x", "X")]

    monkeypatch.setattr(radio_sources, "_search_bbc", bbc)
    monkeypatch.setattr(radio_sources, "_search_apple", apple)
    monkeypatch.setattr(radio_sources, "_search_archive", archive)
    outcome = await radio_sources.search("a", radio_sources.Prefs())
    assert [hit.title for hit in outcome.hits] == ["A", "X"]
    assert outcome.failed == ["BBC"]


async def test_search_with_every_source_down_says_so(monkeypatch):
    async def down(*args):
        raise AdapterError(FailureKind.UNAVAILABLE, "down")

    for name in ("_search_bbc", "_search_apple", "_search_archive"):
        monkeypatch.setattr(radio_sources, name, down)
    with pytest.raises(AdapterError) as raised:
        await radio_sources.search("a", radio_sources.Prefs())
    assert "No radio source" in str(raised.value)


# Apple Podcasts


async def test_apple_search_and_lookup_give_feeds():
    data = json.loads((FIXTURES / "apple-search.json").read_text())
    asked = []

    async def fetch(path, params):
        asked.append((path, params))
        return data

    hits = await apple_podcasts.search(fetch, "desert island discs", "gb")
    assert hits[0].title == "Desert Island Discs"
    assert hits[0].feed_url == "https://podcasts.files.bbci.co.uk/b006qnmr.rss"
    assert asked[0][1]["country"] == "GB"
    await apple_podcasts.search(fetch, "x", "nonsense")
    assert asked[1][1]["country"] == "US"
    assert (await apple_podcasts.lookup(fetch, "1")).apple_id == hits[0].apple_id

    async def empty(path, params):
        return {"results": [{"collectionId": 1, "collectionName": "No feed"}]}

    with pytest.raises(AdapterError) as raised:
        await apple_podcasts.lookup(empty, "1")
    assert raised.value.kind == FailureKind.NOT_FOUND


# The Internet Archive


def test_an_archive_item_has_one_episode_per_original_recording():
    data = json.loads((FIXTURES / "archive-raysalaugh.json").read_text())
    show = archive_radio.show("RaysALaugh1949", data)
    assert (show.provider, show.licence) == ("archive", None)
    assert show.artwork_url == "https://archive.org/services/img/RaysALaugh1949"
    episodes = show.series[0].episodes
    names = [episode.pid for episode in episodes]
    assert len(names) == len(set(names))
    # The MP3 made from an M4A original is the file to download; the episode is the original.
    first = episodes[0]
    assert first.pid == "Ray's A Laugh - 1949-10-11 [Rpt 2012-05-06]"
    assert first.enclosure_url.endswith(".mp3") and first.duration_seconds == 2160
    assert first.first_broadcast == datetime(1949, 10, 11, tzinfo=UTC)
    assert [episode.number for episode in episodes] == list(range(1, len(episodes) + 1))
    # Every recording has its own track, so the tracks are the numbers.
    assert {episode.number_source for episode in episodes} == {"source"}
    # One recording without a track: broadcast order (the date in the name) instead.
    for file in data["files"]:
        if file.get("track") == "03":
            del file["track"]
    mixed = archive_radio.show("RaysALaugh1949", data).series[0].episodes
    assert {episode.number_source for episode in mixed} == {"broadcast_order"}
    dates = [episode.first_broadcast for episode in mixed]
    assert dates == sorted(dates)


def test_archive_licences_and_links():
    assert archive_radio.licence_name("http://creativecommons.org/licenses/by-nc-sa/3.0/") == (
        "Creative Commons BY-NC-SA 3.0"
    )
    assert archive_radio.licence_name("https://creativecommons.org/publicdomain/mark/1.0/") == (
        "Public domain"
    )
    assert archive_radio.licence_name("") is None
    assert archive_radio.identifier("archive.org/details/OTRR_Goon") == "OTRR_Goon"
    assert archive_radio.identifier("https://evil.example/details/x") is None
    assert archive_radio.query('goon" OR collection:*') == (
        "(goon OR collection) AND mediatype:audio AND (collection:oldtimeradio OR subject:radio)"
    )
    with pytest.raises(AdapterError):
        archive_radio.query("***")
    with pytest.raises(AdapterError):
        archive_radio.show("x", {"metadata": {"mediatype": "movies"}, "files": []})


async def test_archive_search_reads_hits():
    data = json.loads((FIXTURES / "archive-search.json").read_text())

    async def fetch(path, params):
        assert path == "advancedsearch.php" and "oldtimeradio" in params["q"]
        return data

    hits = await archive_radio.search(fetch, "goon")
    assert hits and all(archive_radio.IDENTIFIER.fullmatch(hit.identifier) for hit in hits)


# Reading public web addresses


def answer(routes):
    def handler(request: httpx.Request):
        key = request.headers["host"] + request.url.raw_path.decode()
        status, headers, body = routes[key]
        return httpx.Response(status, headers=headers, content=body)

    return httpx.MockTransport(handler)


async def public(host, port):
    return {"evil.example": ["10.0.0.5"], "meta.example": ["169.254.169.254"]}.get(
        host, ["93.184.216.34"]
    )


async def test_public_addresses_are_read_and_redirects_are_checked():
    routes = {
        "a.example/feed": (301, {"location": "https://b.example/real"}, b""),
        "b.example/real": (200, {"content-type": "application/rss+xml"}, b"<rss/>"),
        "c.example/feed": (302, {"location": "http://evil.example/admin"}, b""),
        "d.example/feed": (302, {"location": "http://meta.example/latest"}, b""),
    }
    page = await public_web.fetch(
        "https://a.example/feed", accept="*/*", limit=100, transport=answer(routes), resolver=public
    )
    assert (page.url, page.body) == ("https://b.example/real", b"<rss/>")
    for start in ("https://c.example/feed", "https://d.example/feed", "http://evil.example/"):
        with pytest.raises(AdapterError) as raised:
            await public_web.fetch(
                start, accept="*/*", limit=100, transport=answer(routes), resolver=public
            )
        assert raised.value.kind == FailureKind.PERMISSION


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.1.2.3",
        "192.168.1.10",
        "::1",
        "fd00::1",
        "169.254.169.254",
        "100.64.0.1",
        "::ffff:127.0.0.1",
    ],
)
async def test_private_addresses_are_refused(address):
    with pytest.raises(AdapterError) as raised:
        await public_web.public_addresses(address, 80)
    assert raised.value.kind == FailureKind.PERMISSION


async def test_big_bodies_and_redirect_loops_stop():
    routes = {
        "big.example/f": (200, {"content-type": "text/xml"}, b"x" * 2000),
        "loop.example/a": (302, {"location": "/a"}, b""),
    }
    with pytest.raises(AdapterError):
        await public_web.fetch(
            "https://big.example/f",
            accept="*/*",
            limit=1000,
            transport=answer(routes),
            resolver=public,
        )
    with pytest.raises(AdapterError) as raised:
        await public_web.fetch(
            "https://loop.example/a",
            accept="*/*",
            limit=1000,
            transport=answer(routes),
            resolver=public,
        )
    assert "too many times" in str(raised.value)


# Radio release names


@pytest.mark.parametrize(
    ("name", "show", "series", "episode", "aired", "station"),
    [
        ("The Unbelievable Truth S20E03", "The Unbelievable Truth", 20, 3, None, None),
        ("The Unbelievable Truth - S20E03 - Tea", "The Unbelievable Truth", 20, 3, None, None),
        ("The.Unbelievable.Truth.S20E03.MP3-GROUP", "The Unbelievable Truth", 20, 3, None, None),
        ("Cabin Pressure 2x04", "Cabin Pressure", 2, 4, None, None),
        ("Cabin Pressure Series 2, Episode 4", "Cabin Pressure", 2, 4, None, None),
        ("The Archers 2026-11-04 (128kbps)", "The Archers", None, None, date(2026, 11, 4), None),
        ("The Archers 2026.11.04", "The Archers", None, None, date(2026, 11, 4), None),
        ("The Archers 20261104", "The Archers", None, None, date(2026, 11, 4), None),
        ("The Archers 04 Nov 2026", "The Archers", None, None, date(2026, 11, 4), None),
        (
            "BBC.Radio.4.The.Archers.2026.11.04.MP3-X",
            "The Archers",
            None,
            None,
            date(2026, 11, 4),
            "BBC Radio 4",
        ),
        (
            "[BBC R4] Just a Minute S93E01 [64kbps opus]",
            "Just a Minute",
            93,
            1,
            None,
            "BBC Radio 4",
        ),
    ],
)
def test_release_names_are_read(name, show, series, episode, aired, station):
    parsed = radio_releases.parse(name)
    assert parsed is not None
    assert (parsed.show, parsed.series, parsed.episode, parsed.aired) == (
        show,
        series,
        episode,
        aired,
    )
    if station:
        assert parsed.station and parsed.station.lower().startswith("bbc")


def test_get_iplayer_names_carry_the_pid():
    parsed = radio_releases.parse(
        "The_Unbelievable_Truth_-_Series_20_Episode_3_b09zv5m0_original.m4a"
    )
    assert parsed.pid == "b09zv5m0" and parsed.codec == "m4a"
    assert radio_releases.matches(
        parsed, show="Something else", series=1, episode=1, pid="b09zv5m0"
    )


def test_search_terms_and_matches():
    assert radio_releases.search_terms(
        "The Archers", 1, 3, datetime(2026, 11, 4, 19, tzinfo=UTC), "Episode 3"
    ) == ["The Archers S01E03", "The Archers 2026 11 04"]
    assert radio_releases.search_terms("Show", None, 3, None, "A Good Title") == [
        "Show A Good Title"
    ]
    archers = radio_releases.parse("BBC.Radio.4.The.Archers.2026.11.05.MP3-X")
    assert radio_releases.matches(
        archers, show="The Archers", series=None, episode=1, aired=date(2026, 11, 4)
    )
    assert not radio_releases.matches(
        archers, show="The Archers", series=None, episode=1, aired=date(2026, 11, 7)
    )
    truth = radio_releases.parse("Unbelievable Truth S20E03")
    assert radio_releases.matches(truth, show="The Unbelievable Truth", series=20, episode=3)
    assert not radio_releases.matches(truth, show="The Unbelievable Truth", series=20, episode=4)
    assert not radio_releases.matches(truth, show="The Museum of Curiosity", series=20, episode=3)
    # Films and books are never taken, whatever the name says.
    assert not radio_releases.matches(
        truth, show="The Unbelievable Truth", series=20, episode=3, categories=[2040]
    )
    assert not radio_releases.matches(
        truth, show="The Unbelievable Truth", series=20, episode=3, categories=[7020]
    )
    assert radio_releases.parse("S01E01") is None
    assert radio_releases.parse("") is None


def test_a_feed_past_the_item_limit_marks_nothing_removed(monkeypatch):
    monkeypatch.setattr(podcast_feed, "MAX_ITEMS", 2)
    show = podcast_feed.parse("https://example.org/f", feed(item("a") + item("b") + item("c")))
    assert show.episode_count == 2 and show.complete is False
    assert podcast_feed.parse("https://example.org/f", feed(item("a"))).complete is True

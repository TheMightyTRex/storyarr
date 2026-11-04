"""Radio following (R4): wanted episodes become requests with an `episode` reason, the follow
choice decides which, a gentle poll finds new episodes, and the calendar shows broadcasts."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import func, select

from app.db.models import (
    AcquisitionIntent,
    AcquisitionReason,
    AcquisitionTarget,
    Operation,
    RadioEpisode,
    RadioSeries,
    RadioShow,
    Work,
)
from app.domain import radio, radio_wanted
from tests.integration import test_radio as recorded
from tests.integration.test_radio import BASE, add, finish

pytestmark = pytest.mark.integration
# BBC programme data from recorded responses (the fixture of test_radio).
bbc = recorded.bbc


async def reasons(database, active=True):
    async with database() as db:
        rows = (
            await db.execute(
                select(AcquisitionReason, AcquisitionTarget)
                .join(AcquisitionTarget, AcquisitionTarget.intent_id == AcquisitionReason.intent_id)
                .where(AcquisitionReason.kind == "episode", AcquisitionReason.active.is_(active))
            )
        ).all()
    return rows


async def statuses(client, show):
    detail = (await client.get(f"{BASE}/shows/{show['id']}")).json()
    return {e["pid"]: e["status"]["kind"] for s in detail["series"] for e in s["episodes"]}


def new_series(bbc, start: datetime, *offsets: timedelta):
    """A series 21 of The Unbelievable Truth that the BBC lists from now on."""
    data = bbc["data"]
    programme = {**data["programmes/b09ysnw5.json"]["programme"]}
    programme.update(
        pid="p0nw2100",
        position=21,
        title="Series 21",
        expected_child_count=len(offsets),
        first_broadcast_date=(start + offsets[0]).isoformat(),
    )
    data["programmes/p0nw2100.json"] = {"programme": programme}
    listed = data["programmes/b007mf4f/children.json"]["children"]
    listed["programmes"].insert(
        0,
        {
            "type": "series",
            "pid": "p0nw2100",
            "title": "Series 21",
            "position": 21,
            "expected_child_count": len(offsets),
            "first_broadcast_date": (start + offsets[0]).isoformat(),
        },
    )
    listed["total"] += 1
    data["programmes/p0nw2100/children.json"] = {
        "children": {
            "page": 1,
            "total": len(offsets),
            "limit": 50,
            "offset": 0,
            "programmes": [
                {
                    "type": "episode",
                    "pid": f"p0nw21{number:02d}",
                    "title": f"Episode {number}",
                    "position": number,
                    "first_broadcast_date": (start + offset).isoformat(),
                }
                for number, offset in enumerate(offsets, start=1)
            ],
        }
    }


async def test_all_series_requests_every_episode_through_the_acquisition_path(
    client, admin, database, bbc
):
    show = await add(client, "m0012qgy", follow="all")
    await finish(database, show)
    found = await reasons(database)
    # Every one of the 10 broadcast episodes is wanted, each through its own request.
    assert len(found) == 10
    assert {target.state for _, target in found} == {"wanted"}
    async with database() as db:
        works = (
            await db.scalars(select(Work).where(Work.id.in_(select(RadioEpisode.work_id))))
        ).all()
        assert len(works) == 10
        assert all(
            not work.catalog_public and work.metadata_fields["identity_rejected"] for work in works
        )
        first = await db.scalar(select(RadioEpisode).where(RadioEpisode.pid == "m0012qgw"))
        series = await db.get(RadioSeries, first.series_id)
        work = await db.get(Work, first.work_id)
    assert work.title == f"Sandi Toksvig's Hygge - S{series.number:02d}E03 - Andy Hamilton"

    # Activity shows them as radio requests that open the show, with the follow as the reason.
    listed = (await client.get("/api/requests", params={"limit": 100})).json()
    assert listed["total"] == 10
    item = next(row for row in listed["items"] if row["work_id"] == str(work.id))
    assert (item["radio_show_id"], item["radio_episode_id"]) == (show["id"], str(first.id))
    assert item["can_open_book"] is False
    assert item["description"] == "Radio episode"
    assert [reason["label"] for reason in item["reasons"]] == ["Following Sandi Toksvig's Hygge"]
    assert item["targets"][0]["message"] == radio_wanted.NO_SOURCES

    # The episode slide-out names the open request.
    episode = (await client.get(f"{BASE}/episodes/{first.id}")).json()
    assert episode["status"]["detail"] == "You follow all series"
    assert episode["request"]["id"] == item["id"]
    assert episode["request"]["message"] == radio_wanted.NO_SOURCES
    assert episode["request"]["title"] == work.title
    summary = (await client.get(f"{BASE}/shows")).json()["items"][0]
    assert summary["wanted_count"] == 10

    # A refresh does not request anything twice.
    await client.post(f"{BASE}/shows/{show['id']}/refresh")
    await finish(database, show)
    async with database() as db:
        assert await db.scalar(select(func.count()).select_from(AcquisitionIntent)) == 10


async def test_follow_none_withdraws_and_a_new_choice_requests_again(client, admin, database, bbc):
    show = await add(client, "m0012qgy", follow="all")
    await finish(database, show)
    edited = await client.patch(f"{BASE}/shows/{show['id']}", json={"follow": "none"})
    assert edited.status_code == 200 and edited.json()["wanted_count"] == 0
    assert await reasons(database) == []
    withdrawn = await reasons(database, active=False)
    assert len(withdrawn) == 10
    assert {target.state for _, target in withdrawn} == {"cancelled"}
    # From now on wants nothing already broadcast.
    await client.patch(f"{BASE}/shows/{show['id']}", json={"follow": "from_now_on"})
    assert await reasons(database) == []
    # All series again reopens the same requests rather than making new ones.
    await client.patch(f"{BASE}/shows/{show['id']}", json={"follow": "all"})
    assert len(await reasons(database)) == 10
    async with database() as db:
        assert await db.scalar(select(func.count()).select_from(AcquisitionIntent)) == 10


async def test_withdrawing_in_activity_excludes_the_episode(client, admin, database, bbc):
    show = await add(client, "m0012qgy", follow="all")
    await finish(database, show)
    reason, target = (await reasons(database))[0]
    cancelled = await client.delete(f"/api/requests/{target.intent_id}/reasons/{reason.id}")
    assert cancelled.status_code == 200, cancelled.text
    async with database() as db:
        episode = await db.get(RadioEpisode, UUID(reason.reference))
    assert episode.status == "excluded"
    # A refresh does not want it again; the follow choice does.
    await client.post(f"{BASE}/shows/{show['id']}/refresh")
    await finish(database, show)
    assert len(await reasons(database)) == 9
    detail = (await client.get(f"{BASE}/episodes/{episode.id}")).json()
    assert detail["status"]["kind"] == "excluded" and detail["request"] is None
    await client.patch(f"{BASE}/shows/{show['id']}", json={"follow": "none"})
    await client.patch(f"{BASE}/shows/{show['id']}", json={"follow": "all"})
    assert len(await reasons(database)) == 10


async def test_from_now_on_wants_new_broadcasts_found_by_the_poll(client, admin, database, bbc):
    show = await add(client)
    await finish(database, show)
    assert await reasons(database) == []
    now = datetime.now(UTC)
    async with database() as db, db.begin():
        row = await db.get(RadioShow, UUID(show["id"]))
        row.followed_at = now - timedelta(days=3)
    # The BBC lists a new series: one episode broadcast since the follow, one still to come.
    new_series(bbc, now, timedelta(days=-1), timedelta(days=2))

    # Read less than twelve hours ago: the poll leaves it alone.
    assert await radio_wanted.schedule(now) == 0
    later = now + timedelta(hours=13)
    assert await radio_wanted.schedule(later) == 1
    async with database() as db:
        operation = await db.get(
            Operation, (await db.get(RadioShow, UUID(show["id"]))).operation_id
        )
    assert operation.status == "queued"
    # A refresh started this run is not started again by the next one.
    assert await radio_wanted.schedule(later + timedelta(minutes=15)) == 0
    await radio.run(operation.id)
    found = await statuses(client, show)
    assert (found["p0nw2101"], found["p0nw2102"], found["b0b1qdds"]) == (
        "wanted",
        "not_released",
        "not_requested",
    )
    wanted = await reasons(database)
    assert len(wanted) == 1
    async with database() as db:
        episode = await db.get(RadioEpisode, UUID(wanted[0][0].reference))
    assert episode.pid == "p0nw2101"

    # Once the second is broadcast the poll wants it, without asking the BBC.
    bbc["calls"].clear()
    await radio_wanted.schedule(now + timedelta(days=2, hours=1))
    assert bbc["calls"] == []
    assert (await statuses(client, show))["p0nw2102"] == "wanted"
    assert len(await reasons(database)) == 2


async def test_the_poll_is_gentle_and_skips_shows_not_followed(client, admin, database, bbc):
    shows = [await add(client, link) for link in ("b007mf4f", "m0012qgy")]
    for show in shows:
        await finish(database, show)
    later = datetime.now(UTC) + timedelta(hours=13)
    async with database() as db:
        due = await radio_wanted.due_shows(db, later, limit=10)
    assert {show.external_id for show in due} == {"b007mf4f", "m0012qgy"}
    await client.patch(f"{BASE}/shows/{shows[1]['id']}", json={"follow": "none"})
    async with database() as db:
        due = await radio_wanted.due_shows(db, later, limit=10)
    assert [show.external_id for show in due] == ["b007mf4f"]
    await client.patch(f"{BASE}/shows/{shows[1]['id']}", json={"follow": "all"})
    async with database() as db, db.begin():
        row = await db.get(RadioShow, UUID(shows[0]["id"]))
        row.refreshed_at = None
    # At most two refreshes a run; the show never read comes first.
    assert radio_wanted.MAX_PER_RUN == 2
    async with database() as db:
        first = await radio_wanted.due_shows(db, later, limit=1)
    assert first[0].external_id == "b007mf4f"


async def test_episodes_in_the_radio_library_or_a_removed_show_are_withdrawn(
    client, admin, database, bbc
):
    show = await add(client, "m0012qgy", follow="all")
    await finish(database, show)
    async with database() as db, db.begin():
        episode = await db.scalar(select(RadioEpisode).where(RadioEpisode.pid == "m0012qgw"))
        episode.status = "in_library"
        await radio_wanted.sync(db, [episode.show_id])
    assert len(await reasons(database)) == 9
    removed = await client.delete(f"{BASE}/shows/{show['id']}")
    assert removed.status_code == 204
    assert await reasons(database) == []
    # The requests stay in the history, as withdrawn.
    listed = (await client.get("/api/requests", params={"limit": 100})).json()
    assert listed["total"] == 10
    assert all(item["radio_show_id"] is None for item in listed["items"])


async def test_the_calendar_shows_followed_broadcasts(client, admin, database, bbc):
    show = await add(client)
    await finish(database, show)
    not_followed = await add(client, "m0012qgy", follow="none")
    await finish(database, not_followed)
    now = datetime.now(UTC)
    async with database() as db, db.begin():
        row = await db.get(RadioShow, UUID(show["id"]))
        row.followed_at = now - timedelta(days=40)
        # Episode 6 goes out in 5 days; episode 5 went out a day ago (both UK evenings).
        sixth = await db.scalar(select(RadioEpisode).where(RadioEpisode.pid == "b0b1qdds"))
        fifth = await db.scalar(select(RadioEpisode).where(RadioEpisode.pid == "b0b0ptm5"))
        sixth.first_broadcast = (now + timedelta(days=5)).replace(hour=18, minute=30)
        fifth.first_broadcast = (now - timedelta(days=1)).replace(hour=18, minute=30)
        radio.restatus(row, [sixth, fifth])
    months = {sixth.first_broadcast.strftime("%Y-%m"), fifth.first_broadcast.strftime("%Y-%m")}
    items = []
    for month in sorted(months):
        response = await client.get("/api/releases/calendar", params={"month": month})
        assert response.status_code == 200, response.text
        items += [item for item in response.json()["items"] if item["provider"] == "radio"]
    by_pid = {item["external_id"]: item for item in items}
    assert set(by_pid) == {"b0b1qdds", "b0b0ptm5"}
    upcoming = by_pid["b0b1qdds"]
    assert upcoming["release_date"] == sixth.first_broadcast.date().isoformat()
    assert (upcoming["title"], upcoming["state"], upcoming["cover_url"]) == (
        "The Unbelievable Truth",
        "not_released",
        f"/api/radio/shows/{show['id']}/artwork",
    )
    assert upcoming["radio"] == {
        "show_id": show["id"],
        "episode_id": str(sixth.id),
        "show_title": "The Unbelievable Truth",
        "episode_title": "Episode 6",
        "code": "S20E06",
        "station": "BBC Radio 4",
        "broadcast_at": upcoming["radio"]["broadcast_at"],
        "status": "not_released",
    }
    assert by_pid["b0b0ptm5"]["radio"]["status"] == "wanted"

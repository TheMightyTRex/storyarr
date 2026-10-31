# ruff: noqa: F811
from uuid import UUID

import pytest
from sqlalchemy import select

from app.db.models import AuditEvent, LibraryGrant, SourceArtifact, User
from app.domain.permissions import MEMBER, OVERRIDE_RELEASES
from tests.integration.test_acquisition import body, catalog, request  # noqa: F401
from tests.integration.test_acquisition_selections import prepare, selection_route  # noqa: F401

pytestmark = pytest.mark.integration


async def unconfirmed_release(client, database, catalog, route):
    """A release whose name matches another book and which names no language."""
    saved = await request(
        client,
        body(catalog, "audio", audio_library_id=str(catalog["library"]), language="en"),
    )
    route["intent_id"] = saved["request"]["id"]
    async with database() as db, db.begin():
        artifact = await db.get(SourceArtifact, UUID(route["artifact_id"]))
        artifact.release_snapshot = {
            **artifact.release_snapshot,
            "title": "A completely different book",
            "language": None,
            "series": [],
        }


async def checks(client, route):
    response = await client.get(
        f"/api/source-artifacts/{route['artifact_id']}/checks",
        params={"intent_id": route["intent_id"], "slot": "audio"},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_admin_must_confirm_each_check_and_the_choice_is_audited(
    client, admin, database, catalog, selection_route
):
    await unconfirmed_release(client, database, catalog, selection_route)
    assert await checks(client, selection_route) == {
        "unconfirmed": ["identity", "language"],
        "can_override": True,
    }
    refused = await prepare(client, selection_route, "override-none")
    assert refused.status_code == 409
    assert refused.json()["detail"] == (
        "Confirm the title and author and the language before downloading this release"
    )
    partly = await prepare(
        client, {**selection_route, "confirmed_checks": ["identity"]}, "override-partly"
    )
    assert partly.status_code == 409 and "the language" in partly.json()["detail"]
    chosen = await prepare(
        client, {**selection_route, "confirmed_checks": ["identity", "language"]}, "override-all"
    )
    assert chosen.status_code == 201, chosen.text
    async with database() as db:
        event = await db.scalar(
            select(AuditEvent).where(AuditEvent.action == "acquisition.release-override")
        )
        assert event.actor_id == UUID(admin["id"])
        assert event.detail["checks"] == ["identity", "language"]


async def test_members_need_the_permission(client, admin, database, catalog, selection_route):
    await unconfirmed_release(client, database, catalog, selection_route)
    confirmed = {**selection_route, "confirmed_checks": ["identity", "language"]}
    async with database() as db, db.begin():
        person = await db.get(User, UUID(admin["id"]))
        person.role, person.permissions = "member", MEMBER
        db.add(LibraryGrant(library_id=catalog["library"], user_id=person.id))
    assert (await checks(client, selection_route))["can_override"] is False
    refused = await prepare(client, confirmed, "member-without")
    assert refused.status_code == 403, refused.text
    async with database() as db, db.begin():
        (await db.get(User, UUID(admin["id"]))).permissions = MEMBER | OVERRIDE_RELEASES
    assert (await checks(client, selection_route))["can_override"] is True
    assert (await prepare(client, confirmed, "member-with")).status_code == 201


async def test_a_release_naming_another_language_stays_blocked(
    client, admin, database, catalog, selection_route
):
    await unconfirmed_release(client, database, catalog, selection_route)
    async with database() as db, db.begin():
        artifact = await db.get(SourceArtifact, UUID(selection_route["artifact_id"]))
        artifact.release_snapshot = {**artifact.release_snapshot, "language": "fr"}
    assert (await checks(client, selection_route))["unconfirmed"] == ["identity"]
    response = await prepare(
        client, {**selection_route, "confirmed_checks": ["identity", "language"]}, "french"
    )
    assert response.status_code == 422

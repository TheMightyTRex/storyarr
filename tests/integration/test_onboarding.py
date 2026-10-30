import re
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy import select

from app.api.setup import ONBOARDING_STEPS
from app.db.models import CatalogAccount, Integration, Library, LibraryGrant

pytestmark = pytest.mark.integration


async def test_new_account_progress_persists_through_sign_in(client, admin):
    assert admin["onboarding_status"] == "pending"
    initial = await client.get("/api/setup/onboarding")
    assert initial.json() == {"status": "pending", "step": 0, "skipped": []}
    progress = {"status": "deferred", "step": 3, "skipped": [1, 2]}
    assert (await client.put("/api/setup/onboarding", json=progress)).json() == progress
    assert (await client.get("/api/auth/me")).json()["user"]["onboarding_status"] == "deferred"
    await client.post("/api/auth/logout")
    response = await client.post(
        "/api/auth/login", json={"username": "admin", "password": "a long test password"}
    )
    assert response.json()["user"]["onboarding_status"] == "deferred"
    assert (await client.get("/api/setup/onboarding")).json() == progress


@pytest.mark.parametrize("status", ["completed", "skipped"])
async def test_setup_can_be_dismissed_without_connections(client, admin, status):
    response = await client.put("/api/setup/onboarding", json={"status": status, "step": 0})
    assert response.status_code == 200
    assert (await client.get("/api/auth/me")).json()["user"]["onboarding_status"] == status
    assert (await client.get("/api/integrations")).json() == []


async def test_progress_belongs_to_current_user(client, admin):
    response = await client.post(
        "/api/auth/users",
        json={
            "username": "viewer",
            "display_name": "Viewer",
            "password": "a separate long password",
            "role": "viewer",
        },
    )
    assert response.status_code == 201
    await client.put("/api/setup/onboarding", json={"status": "completed"})
    await client.post("/api/auth/logout")
    response = await client.post(
        "/api/auth/login", json={"username": "viewer", "password": "a separate long password"}
    )
    assert response.json()["user"]["onboarding_status"] == "pending"
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]
    assert (
        await client.put("/api/setup/onboarding", json={"status": "skipped"})
    ).status_code == 200
    assert (await client.get("/api/setup/readiness")).status_code == 403


@pytest.mark.parametrize(
    "body", [{"status": "unknown"}, {"step": 9}, {"skipped": [-1]}, {"skipped": [9]}]
)
async def test_progress_validation(client, admin, body):
    assert (await client.put("/api/setup/onboarding", json=body)).status_code == 422


async def test_progress_requires_auth_and_csrf(client, admin):
    del client.headers["X-CSRF-Token"]
    assert (
        await client.put("/api/setup/onboarding", json={"status": "skipped"})
    ).status_code == 403
    client.cookies.clear()
    assert (await client.get("/api/setup/onboarding")).status_code == 401


@pytest.mark.parametrize("role", ["member", "viewer", "requester", "approver", "admin"])
async def test_admin_policy_controls_local_sign_in_without_changing_progress(client, admin, role):
    assert (await client.get("/api/setup/onboarding-policy")).json() == {
        "show_member_onboarding": True
    }
    created = await client.post(
        "/api/auth/users",
        json={
            "username": "new-reader",
            "display_name": "Reader",
            "role": role,
            "password": "a separate long password",
        },
    )
    assert created.status_code == 201
    original = created.json()
    login_body = {"username": "new-reader", "password": "a separate long password"}
    first = await client.post("/api/auth/login", json=login_body)
    assert first.json()["user"]["onboarding_required"] is True
    # Set the policy as administrator, then sign in twice through the normal local flow.
    administrator = await client.post(
        "/api/auth/login",
        json={
            "username": "admin",
            "password": "a long test password",
        },
    )
    client.headers["X-CSRF-Token"] = administrator.json()["csrf_token"]
    saved = await client.put("/api/setup/onboarding-policy", json={"show_member_onboarding": False})
    assert saved.status_code == 200
    assert (await client.get("/api/auth/me")).json()["user"]["onboarding_required"] is True
    for _ in range(2):
        login = await client.post("/api/auth/login", json=login_body)
        client.headers["X-CSRF-Token"] = login.json()["csrf_token"]
        user = login.json()["user"]
        assert user["onboarding_required"] == (role not in {"member", "viewer"})
        assert user["onboarding_status"] == "pending"
        for key in ("id", "permissions", "role", "access_label"):
            assert user[key] == original[key]
        assert (await client.get("/api/setup/onboarding")).json() == {
            "status": "pending",
            "step": 0,
            "skipped": [],
        }
    # Optional setup remains writable, and completing it still persists normally.
    progress = {"status": "completed", "step": 1, "skipped": [0]}
    assert (await client.put("/api/setup/onboarding", json=progress)).json() == progress
    signed_in = (await client.post("/api/auth/login", json=login_body)).json()["user"]
    assert signed_in["onboarding_status"] == "completed"
    assert signed_in["onboarding_required"] is False


async def test_onboarding_policy_is_admin_only_and_requires_csrf(client, admin):
    del client.headers["X-CSRF-Token"]
    assert (
        await client.put(
            "/api/setup/onboarding-policy",
            json={
                "show_member_onboarding": False,
            },
        )
    ).status_code == 403
    logged = await client.post(
        "/api/auth/login",
        json={
            "username": "admin",
            "password": "a long test password",
        },
    )
    client.headers["X-CSRF-Token"] = logged.json()["csrf_token"]
    await client.post(
        "/api/auth/users",
        json={
            "username": "member",
            "display_name": "Member",
            "role": "member",
            "password": "a separate long password",
        },
    )
    logged = await client.post(
        "/api/auth/login",
        json={
            "username": "member",
            "password": "a separate long password",
        },
    )
    client.headers["X-CSRF-Token"] = logged.json()["csrf_token"]
    assert (await client.get("/api/setup/onboarding-policy")).status_code == 403
    assert (
        await client.put(
            "/api/setup/onboarding-policy",
            json={
                "show_member_onboarding": False,
            },
        )
    ).status_code == 403
    assert (await client.get("/api/auth/me")).json()["user"]["onboarding_required"] is True
    client.cookies.clear()
    assert (await client.get("/api/setup/onboarding-policy")).status_code == 401


@pytest.mark.parametrize("body", [{"show_member_onboarding": "false"}, {"unexpected": False}])
async def test_onboarding_policy_rejects_invalid_values(client, admin, body):
    assert (await client.put("/api/setup/onboarding-policy", json=body)).status_code == 422


async def test_custom_role_keeps_its_onboarding_policy(client, admin):
    catalog = (await client.get("/api/auth/access")).json()
    permissions = next(item["permissions"] for item in catalog["presets"] if item["id"] == "member")
    role = await client.post(
        "/api/auth/roles",
        json={
            "name": "Custom family role",
            "permissions": permissions,
        },
    )
    assert role.status_code == 201, role.text
    created = await client.post(
        "/api/auth/users",
        json={
            "username": "custom-reader",
            "display_name": "Custom reader",
            "role_id": role.json()["id"],
            "password": "a separate long password",
        },
    )
    assert created.status_code == 201, created.text
    await client.put("/api/setup/onboarding-policy", json={"show_member_onboarding": False})
    login = await client.post(
        "/api/auth/login",
        json={
            "username": "custom-reader",
            "password": "a separate long password",
        },
    )
    assert login.json()["user"]["onboarding_required"] is True


async def test_policy_preserves_library_grants_and_personal_catalog_accounts(
    client, admin, database
):
    async with database() as db, db.begin():
        integration = Integration(
            kind="audiobookshelf",
            name="Shared",
            base_url="http://fixture.invalid",
            encrypted_secrets="unused",
        )
        db.add(integration)
        await db.flush()
        granted = Library(integration_id=integration.id, external_id="granted", name="Family books")
        private = Library(
            integration_id=integration.id, external_id="private", name="Private books"
        )
        db.add_all([granted, private])
        await db.flush()
        granted_id = str(granted.id)
    created = await client.post(
        "/api/auth/users",
        json={
            "username": "family-reader",
            "display_name": "Family reader",
            "role": "member",
            "password": "a separate long password",
            "library_ids": [granted_id],
        },
    )
    assert created.status_code == 201, created.text
    reader_id = UUID(created.json()["id"])
    saved = await client.put(
        "/api/metadata/account", json={"enabled": True, "token": "admin-personal-test-token"}
    )
    assert saved.status_code == 200, saved.text
    async with database() as db:
        encrypted = (await db.get(CatalogAccount, UUID(admin["id"]))).encrypted_token
    saved = await client.put("/api/setup/onboarding-policy", json={"show_member_onboarding": False})
    assert saved.status_code == 200
    login = await client.post(
        "/api/auth/login",
        json={"username": "family-reader", "password": "a separate long password"},
    )
    assert login.json()["user"]["onboarding_required"] is False
    libraries = (await client.get("/api/library/libraries")).json()
    assert [library["id"] for library in libraries] == [granted_id]
    personal = (await client.get("/api/metadata/account")).json()
    assert personal["enabled"] is False
    async with database() as db:
        assert await db.get(CatalogAccount, reader_id) is None
        assert (await db.get(CatalogAccount, UUID(admin["id"]))).encrypted_token == encrypted
        assert list(
            await db.scalars(
                select(LibraryGrant.library_id).where(LibraryGrant.user_id == reader_id)
            )
        ) == [UUID(granted_id)]


async def test_progress_accepts_every_step_of_the_admin_flow(client, admin):
    last = ONBOARDING_STEPS - 1
    progress = {"status": "pending", "step": last, "skipped": list(range(last + 1))}
    response = await client.put("/api/setup/onboarding", json=progress)
    assert response.status_code == 200, response.text
    assert (await client.get("/api/setup/onboarding")).json() == progress


def test_step_limit_matches_the_setup_page():
    # The web app's admin step ids must fit saved progress, or saving later steps fails.
    page = Path(__file__).parents[2] / "apps/web/src/pages/GettingStarted.tsx"
    admin_flow = re.search(r"const ids = admin\s*\?\s*\[(.*?)\]", page.read_text(), re.S)
    assert admin_flow
    assert len(re.findall(r'"[a-z-]+"', admin_flow.group(1))) == ONBOARDING_STEPS

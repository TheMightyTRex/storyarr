# Findings of the security check of 3 November 2026 (docs/SECURITY.md), each kept fixed by a test
# here.
from uuid import UUID

import pytest

pytestmark = pytest.mark.integration


async def test_release_details_and_the_api_map_need_a_sign_in(client):
    # The exact version, the administrator's upgrade page and the whole API map were open to anyone.
    for path in ("/api/application/release", "/api/application/releases"):
        assert (await client.get(path)).status_code == 401, path
    for path in ("/openapi.json", "/docs", "/redoc"):
        response = await client.get(path)
        assert '"openapi"' not in response.text, path
        assert "swagger" not in response.text.lower(), path


async def test_release_details_still_show_when_signed_in(client, admin, monkeypatch):
    from app.api import application_release

    monkeypatch.setattr(application_release, "application_release", lambda: None)
    response = await client.get("/api/application/release")
    assert response.status_code != 401


async def test_a_csrf_token_with_other_characters_is_refused_not_an_error(client, admin):
    # A header with characters outside ASCII made the comparison raise, so the answer was 500, not
    # 403.
    response = await client.post("/api/auth/logout", headers={"X-CSRF-Token": "tokén".encode()})
    assert response.status_code == 403


async def test_a_huge_request_body_is_refused_before_it_is_read(client):
    # Nothing limited a request body, so anyone, signed in or not, could make Storyarr hold a body
    # of any size in memory. Bodies over 5 MB are refused, whether the size is declared or the body
    # is streamed.
    big = b'{"username": "' + b"x" * (6 * 1024 * 1024) + b'", "password": "a long test password"}'
    declared = await client.post(
        "/api/auth/login", content=big, headers={"Content-Type": "application/json"}
    )
    assert declared.status_code == 413

    async def chunks():
        for start in range(0, len(big), 65536):
            yield big[start : start + 65536]

    streamed = await client.post(
        "/api/auth/login", content=chunks(), headers={"Content-Type": "application/json"}
    )
    assert streamed.status_code == 413


async def test_a_normal_request_body_still_works(client, admin):
    response = await client.post(
        "/api/auth/login", json={"username": "admin", "password": "a long test password"}
    )
    assert response.status_code == 200


async def test_expired_sessions_and_old_sign_in_counts_are_deleted(client, admin, database):
    # Expired sessions and sign-in counters were never deleted, so every guessed username added a
    # row for good.
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import func, select

    from app.db.models import LoginSession, RateLimit
    from app.domain import auth_cleanup

    now = datetime.now(UTC)
    async with database() as db, db.begin():
        db.add(LoginSession(token_hash="e" * 64, user_id=UUID(admin["id"]), expires_at=now))
        db.add(RateLimit(key="login:old", count=3, resets_at=now - timedelta(days=2)))
        db.add(RateLimit(key="login:recent", count=3, resets_at=now - timedelta(hours=1)))
    assert await auth_cleanup.purge() == (1, 1)
    async with database() as db:
        assert await db.scalar(select(func.count()).select_from(LoginSession)) == 1
        assert await db.scalar(select(RateLimit.key).where(RateLimit.key.like("login:%"))) == (
            "login:recent"
        )
    assert (await client.get("/api/auth/me")).status_code == 200


async def sign_in(client, username, password):
    response = await client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text
    client.headers["X-CSRF-Token"] = response.json()["csrf_token"]


async def test_people_change_their_own_password_and_other_browsers_sign_out(
    client, admin, database
):
    # There was no way to change a password, so a leaked one could not be replaced.
    from sqlalchemy import func, select

    from app.db.models import LoginSession

    async with database() as db, db.begin():
        db.add(LoginSession(token_hash="o" * 64, user_id=UUID(admin["id"]), expires_at=_later()))
    wrong = await client.put(
        "/api/auth/password",
        json={"current_password": "not the password", "new_password": "a brand new password"},
    )
    assert wrong.status_code == 422
    short = await client.put(
        "/api/auth/password",
        json={"current_password": "a long test password", "new_password": "short"},
    )
    assert short.status_code == 422
    changed = await client.put(
        "/api/auth/password",
        json={"current_password": "a long test password", "new_password": "a brand new password"},
    )
    assert changed.status_code == 204, changed.text
    # This browser stays signed in; the other one is signed out.
    assert (await client.get("/api/auth/me")).status_code == 200
    async with database() as db:
        assert await db.scalar(select(func.count()).select_from(LoginSession)) == 1
    client.cookies.clear()
    old = await client.post(
        "/api/auth/login", json={"username": "admin", "password": "a long test password"}
    )
    assert old.status_code == 401
    await sign_in(client, "admin", "a brand new password")


async def test_an_administrator_sets_a_new_password_for_someone_else(client, admin, database):
    from sqlalchemy import func, select

    from app.db.models import LoginSession

    created = await client.post(
        "/api/auth/users",
        json={
            "username": "reader",
            "display_name": "Reader",
            "password": "the reader's password",
            "role": "member",
        },
    )
    assert created.status_code == 201, created.text
    reader = created.json()["id"]
    async with database() as db, db.begin():
        db.add(LoginSession(token_hash="r" * 64, user_id=UUID(reader), expires_at=_later()))
    own = await client.put(
        f"/api/auth/users/{admin['id']}/password", json={"password": "another long password"}
    )
    assert own.status_code == 409
    reset = await client.put(
        f"/api/auth/users/{reader}/password", json={"password": "a password from the admin"}
    )
    assert reset.status_code == 204, reset.text
    async with database() as db:
        signed_in = select(func.count()).select_from(LoginSession)
        assert await db.scalar(signed_in.where(LoginSession.user_id == UUID(reader))) == 0
    client.cookies.clear()
    await sign_in(client, "reader", "a password from the admin")
    # A member cannot set anyone's password.
    refused = await client.put(
        f"/api/auth/users/{admin['id']}/password", json={"password": "taking over the admin"}
    )
    assert refused.status_code == 403


def _later():
    from datetime import UTC, datetime, timedelta

    return datetime.now(UTC) + timedelta(days=1)

from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text

from app.config import get_settings

pytestmark = pytest.mark.integration


async def sign_in(client, username, role):
    created = await client.post(
        "/api/auth/users",
        json={
            "username": username,
            "display_name": username.title(),
            "role": role,
            "password": "a separate long password",
        },
    )
    assert created.status_code == 201, created.text
    login = await client.post(
        "/api/auth/login",
        json={"username": username, "password": "a separate long password"},
    )
    client.headers["X-CSRF-Token"] = login.json()["csrf_token"]


async def test_preferences_follow_the_account(client, admin):
    assert (await client.get("/api/preferences")).json() == {"collection_view": "detail"}
    saved = await client.patch("/api/preferences", json={"collection_view": "list"})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"collection_view": "list"}
    assert (await client.get("/api/preferences")).json() == {"collection_view": "list"}
    # A partial change keeps what is already saved.
    assert (await client.patch("/api/preferences", json={})).json() == {"collection_view": "list"}
    for bad in ({"collection_view": "grid"}, {"theme": "dark"}):
        assert (await client.patch("/api/preferences", json=bad)).status_code == 422


async def test_each_person_has_their_own_preferences(client, admin):
    await client.patch("/api/preferences", json={"collection_view": "list"})
    # Viewers can save their own choices too.
    await sign_in(client, "reader", "viewer")
    assert (await client.get("/api/preferences")).json() == {"collection_view": "detail"}
    assert (
        await client.patch("/api/preferences", json={"collection_view": "list"})
    ).status_code == 200
    client.cookies.clear()
    assert (await client.get("/api/preferences")).status_code == 401


def test_the_preferences_column_can_be_removed_and_restored(migrated_database):
    migration = import_module("app.db.migrations.versions.storyarr_0085_user_preferences")
    engine = create_engine(get_settings().database_url.get_secret_value())

    def columns(connection):
        return set(
            connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns WHERE table_name = 'users'"
                )
            ).scalars()
        )

    try:
        with engine.connect() as connection, connection.begin():
            assert "preferences" in columns(connection)
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
                assert "preferences" not in columns(connection)
                migration.upgrade()
            assert "preferences" in columns(connection)
            connection.rollback()
    finally:
        engine.dispose()

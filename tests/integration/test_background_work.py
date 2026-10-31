from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, select, text

from app.config import get_settings
from app.db.models import AuditEvent
from app.jobs import pace

pytestmark = pytest.mark.integration


async def test_admins_choose_the_background_work_pace(client, admin, database):
    assert (await client.get("/api/background-work")).json() == {"pace": "normal"}
    saved = await client.put("/api/background-work", json={"pace": "light"})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"pace": "light"}
    assert (await client.get("/api/background-work")).json() == {"pace": "light"}
    assert await pace.current() == "light"
    assert (await client.put("/api/background-work", json={"pace": "turbo"})).status_code == 422
    async with database() as db:
        actions = list(await db.scalars(select(AuditEvent.action)))
    assert "background_work.changed" in actions
    pace.remember("normal")


async def test_background_work_is_admin_only(client, admin):
    created = await client.post(
        "/api/auth/users",
        json={
            "username": "pace-member",
            "display_name": "Member",
            "role": "member",
            "password": "a separate long password",
        },
    )
    assert created.status_code == 201
    login = await client.post(
        "/api/auth/login",
        json={"username": "pace-member", "password": "a separate long password"},
    )
    client.headers["X-CSRF-Token"] = login.json()["csrf_token"]
    assert (await client.get("/api/background-work")).status_code == 403
    assert (await client.put("/api/background-work", json={"pace": "light"})).status_code == 403


def table_exists(connection):
    return connection.execute(
        text("SELECT to_regclass('public.background_work_settings')")
    ).scalar()


def test_the_background_work_migration_can_be_removed_and_restored(migrated_database):
    migration = import_module("app.db.migrations.versions.storyarr_0084_background_work")
    engine = create_engine(get_settings().database_url.get_secret_value())
    try:
        with engine.connect() as connection, connection.begin():
            assert table_exists(connection)
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
                assert table_exists(connection) is None
                migration.upgrade()
            assert table_exists(connection)
            connection.rollback()
    finally:
        engine.dispose()

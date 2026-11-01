"""Notifications are titled for Storyarr, and the title change can be undone."""

from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text

from app.config import get_settings

pytestmark = pytest.mark.integration


def function_title(connection):
    definition = connection.execute(
        text("SELECT pg_get_functiondef('capture_notification_event()'::regprocedure)")
    ).scalar_one()
    return [name for name in ("Dewarr notification", "Storyarr notification") if name in definition]


def stored_title(connection, key):
    return connection.execute(
        text("SELECT payload ->> 'title' FROM notification_events WHERE key = :key"), {"key": key}
    ).scalar_one()


def test_notification_title_can_be_undone_and_redone(migrated_database):
    migration = import_module("app.db.migrations.versions.storyarr_0086_notification_title")
    engine = create_engine(get_settings().database_url.get_secret_value())
    try:
        with engine.connect() as connection, connection.begin():
            assert function_title(connection) == ["Storyarr notification"]
            connection.execute(
                text(
                    "INSERT INTO notification_events(id, key, event_type, payload) "
                    "VALUES (gen_random_uuid(), 'title-test', 'test', "
                    '\'{"title": "Storyarr notification", "message": "m"}\')'
                )
            )
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
                assert function_title(connection) == ["Dewarr notification"]
                assert stored_title(connection, "title-test") == "Dewarr notification"
                migration.upgrade()
            assert function_title(connection) == ["Storyarr notification"]
            assert stored_title(connection, "title-test") == "Storyarr notification"
            connection.rollback()
    finally:
        engine.dispose()

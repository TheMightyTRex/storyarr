"""The operation lookup indexes upgrade and downgrade cleanly, and the request lookup uses them."""

from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text

from app.config import get_settings

pytestmark = pytest.mark.integration
NAMES = {"ix_operations_kind_status_created", "ix_operations_command_intent"}


def indexes(connection):
    return set(
        connection.execute(
            text("SELECT indexname FROM pg_indexes WHERE tablename = 'operations'")
        ).scalars()
    )


def test_operation_lookup_indexes_can_be_removed_and_restored(migrated_database):
    migration = import_module("app.db.migrations.versions.0083_operation_lookups")
    engine = create_engine(get_settings().database_url.get_secret_value())
    try:
        with engine.connect() as connection, connection.begin():
            assert NAMES <= indexes(connection)
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
                assert not NAMES & indexes(connection)
                migration.upgrade()
            assert NAMES <= indexes(connection)
            # The planner can use the request index for the expression the app's queries compile to.
            connection.execute(text("SET LOCAL enable_seqscan = off"))
            plan = "\n".join(
                connection.execute(
                    text(
                        "EXPLAIN SELECT id FROM operations "
                        "WHERE payload['command'] ->> 'intent_id' = 'x' "
                        "AND kind = 'acquisition.auto-select'"
                    )
                ).scalars()
            )
            assert "ix_operations_command_intent" in plan
            connection.rollback()
    finally:
        engine.dispose()

"""Upgrade existing settings without changing identity or access defaults."""

from importlib import import_module

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text

from app.config import get_settings

pytestmark = pytest.mark.integration


def test_member_setup_migration_preserves_existing_configuration(migrated_database):
    migration = import_module("app.db.migrations.versions.0080_member_setup")
    engine = create_engine(get_settings().database_url.get_secret_value())
    try:
        with engine.connect() as connection, connection.begin():
            # All schema changes and fixture rows are rolled back after this check.
            connection.execute(text("DELETE FROM oidc_provider"))
            connection.execute(text("DELETE FROM onboarding_settings"))
            with Operations.context(MigrationContext.configure(connection)):
                migration.downgrade()
                connection.execute(
                    text("""
                    INSERT INTO oidc_provider
                    (id, enabled, label, issuer, authorization_endpoint, token_endpoint,
                     userinfo_endpoint, jwks_uri, client_id, encrypted_secret, signing_algorithm,
                     match_existing, auto_register, default_role, group_claim, group_scope,
                     admin_group, member_group, viewer_group)
                    VALUES (1, true, 'Existing provider', 'https://id.example/realm/',
                     'https://id.example/auth', 'https://id.example/token',
                     'https://id.example/userinfo', 'https://id.example/jwks', 'client',
                     'opaque-encrypted-secret', 'RS256', 'email', true, 'viewer', 'groups', '',
                     'admins', 'readers', 'guests')
                """)
                )
                before = dict(
                    connection.execute(text("SELECT * FROM oidc_provider")).mappings().one()
                )
                migration.upgrade()
                after = dict(
                    connection.execute(text("SELECT * FROM oidc_provider")).mappings().one()
                )
                assert {key: after[key] for key in before} == before
                assert after["requester_group"] == after["approver_group"] == ""
                connection.execute(text("INSERT INTO onboarding_settings (id) VALUES (1)"))
                assert (
                    connection.scalar(
                        text("SELECT show_member_onboarding FROM onboarding_settings")
                    )
                    is True
                )
                connection.execute(text("UPDATE oidc_provider SET default_role = 'requester'"))
                with pytest.raises(RuntimeError, match="pre-upgrade backup"):
                    migration.downgrade()
                connection.execute(text("UPDATE oidc_provider SET default_role = 'viewer'"))
                connection.execute(
                    text("UPDATE onboarding_settings SET show_member_onboarding = false")
                )
                with pytest.raises(RuntimeError, match="pre-upgrade backup"):
                    migration.downgrade()
                connection.rollback()
    finally:
        engine.dispose()

"""Support all OIDC role presets and optional member onboarding."""

import sqlalchemy as sa
from alembic import op

revision = "0080_member_setup"
down_revision = "0079_book_coverage_index"
branch_labels = depends_on = None


def upgrade():
    for name in ("requester_group", "approver_group"):
        op.add_column(
            "oidc_provider", sa.Column(name, sa.String(120), nullable=False, server_default="")
        )
    op.drop_constraint("oidc_provider_default_role_check", "oidc_provider", type_="check")
    op.create_check_constraint(
        "oidc_provider_default_role_check",
        "oidc_provider",
        "default_role IN ('admin', 'approver', 'member', 'requester', 'viewer')",
    )
    op.create_table(
        "onboarding_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("show_member_onboarding", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.CheckConstraint("id = 1"),
    )


def downgrade():
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS (SELECT 1 FROM oidc_provider "
            "WHERE default_role NOT IN ('member', 'viewer') "
            "OR requester_group <> '' OR approver_group <> '') "
            "OR EXISTS (SELECT 1 FROM onboarding_settings WHERE NOT show_member_onboarding)"
        )
    ):
        raise RuntimeError(
            "Restore a pre-upgrade backup rather than dropping member setup settings"
        )
    op.drop_table("onboarding_settings")
    op.drop_constraint("oidc_provider_default_role_check", "oidc_provider", type_="check")
    op.create_check_constraint(
        "oidc_provider_default_role_check", "oidc_provider", "default_role IN ('member', 'viewer')"
    )
    op.drop_column("oidc_provider", "approver_group")
    op.drop_column("oidc_provider", "requester_group")

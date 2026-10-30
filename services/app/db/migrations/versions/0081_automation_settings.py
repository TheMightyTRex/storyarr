"""Per-member automation defaults, starting with follow book-type filters."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0081_automation_settings"
down_revision = "0080_member_setup"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "automation_settings",
        sa.Column(
            "owner_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("generation", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "settings",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )


def downgrade():
    op.drop_table("automation_settings")

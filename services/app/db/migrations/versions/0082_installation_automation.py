"""Installation-wide automation settings, starting with the deleted-book retention period."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0082_installation_automation"
down_revision = "0081_automation_settings"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "installation_automation",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("generation", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "settings",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.CheckConstraint("id = 1"),
    )


def downgrade():
    op.drop_table("installation_automation")

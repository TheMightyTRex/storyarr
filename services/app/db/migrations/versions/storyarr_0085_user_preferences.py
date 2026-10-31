"""
Per-person preferences, such as the Series tab layout, so a choice follows someone to every
browser they sign in on. An empty object means every default.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "storyarr_0085_user_preferences"
down_revision = "storyarr_0084_background_work"
branch_labels = depends_on = None


def upgrade():
    op.add_column(
        "users",
        sa.Column(
            "preferences",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade():
    op.drop_column("users", "preferences")

"""
Radio library review (RADIO-03): a show remembers the radio library folder it was added from, so
its files link even when the folder name differs from the BBC title, and an episode can be linked
to a file by hand (or kept from a wrong file), which the radio sync then leaves alone.
"""

import sqlalchemy as sa
from alembic import op

revision = "storyarr_0090_radio_review"
down_revision = "storyarr_0089_radio_library"
branch_labels = depends_on = None


def upgrade():
    op.add_column("radio_shows", sa.Column("library_item_id", sa.String(200)))
    op.add_column(
        "radio_episodes",
        sa.Column("file_manual", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column("radio_episodes", "file_manual")
    op.drop_column("radio_shows", "library_item_id")

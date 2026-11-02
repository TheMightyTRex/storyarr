"""
The radio library (FEAT-R, R3): an Audiobookshelf podcast library that holds radio shows, the
folder Storyarr files episodes into, and the episodes Audiobookshelf has in it. A radio episode
links to the file that holds it. The way back drops the tables and leaves the files alone.
"""

import sqlalchemy as sa
from alembic import op

revision = "storyarr_0089_radio_library"
down_revision = "storyarr_0088_series_logos"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "radio_libraries",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "integration_id",
            sa.Uuid(),
            sa.ForeignKey("integrations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("external_id", sa.String(200), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("abs_folder", sa.String(1024), nullable=False),
        sa.Column("local_path", sa.String(1024), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True)),
        sa.Column("last_error", sa.String(500)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("integration_id", "external_id"),
    )
    op.create_table(
        "radio_library_files",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "library_id",
            sa.Uuid(),
            sa.ForeignKey("radio_libraries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item_id", sa.String(200), nullable=False),
        sa.Column("episode_id", sa.String(200), nullable=False),
        sa.Column("show_title", sa.String(600), nullable=False),
        sa.Column("title", sa.String(600), nullable=False),
        sa.Column("season", sa.Integer()),
        sa.Column("episode", sa.Integer()),
        sa.Column("pid", sa.String(20), index=True),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column("duration_seconds", sa.Integer()),
        sa.Column("path", sa.String(2048), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("library_id", "episode_id"),
    )
    op.add_column(
        "radio_episodes",
        sa.Column(
            "file_id",
            sa.Uuid(),
            sa.ForeignKey("radio_library_files.id", ondelete="SET NULL"),
            index=True,
        ),
    )


def downgrade():
    op.drop_column("radio_episodes", "file_id")
    op.drop_table("radio_library_files")
    op.drop_table("radio_libraries")

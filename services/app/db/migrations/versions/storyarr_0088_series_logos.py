"""
Series logos (UX-43): one logo per series, saved by an admin and shared by everyone, with where it
came from. Radio shows keep their logo on the show (storyarr_0087) and gain the same details.
The files themselves are in the config folder (series-logos); the way back leaves them there.
"""

import sqlalchemy as sa
from alembic import op

revision = "storyarr_0088_series_logos"
down_revision = "storyarr_0087_radio_shows"
branch_labels = depends_on = None

RADIO_COLUMNS = (
    ("logo_title", sa.String(300)),
    ("logo_licence", sa.String(200)),
    ("logo_source_url", sa.String(1000)),
    ("logo_updated_at", sa.DateTime(timezone=True)),
)


def upgrade():
    op.create_table(
        "series_logos",
        sa.Column("provider", sa.String(20), primary_key=True),
        sa.Column("external_id", sa.String(40), primary_key=True),
        sa.Column("file", sa.String(100), nullable=False),
        sa.Column("colour", sa.String(20), nullable=False, server_default="text"),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("source_title", sa.String(300)),
        sa.Column("licence", sa.String(200)),
        sa.Column("source_url", sa.String(1000)),
        sa.Column("updated_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("provider = 'hardcover'", name="series_logos_provider_check"),
        sa.CheckConstraint("colour IN ('text', 'accent')", name="series_logos_colour_check"),
        sa.CheckConstraint(
            "source IN ('upload', 'cover', 'commons')", name="series_logos_source_check"
        ),
    )
    for name, kind in RADIO_COLUMNS:
        op.add_column("radio_shows", sa.Column(name, kind))


def downgrade():
    for name, _ in reversed(RADIO_COLUMNS):
        op.drop_column("radio_shows", name)
    op.drop_table("series_logos")

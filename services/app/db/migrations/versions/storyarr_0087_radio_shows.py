"""
Radio (FEAT-R, phase R1): stations, shows, series and episodes from BBC programme data. Shows
are owned by one person; stations are shared. Nothing here links to works or versions yet.
"""

import sqlalchemy as sa
from alembic import op

revision = "storyarr_0087_radio_shows"
down_revision = "storyarr_0086_notification_title"
branch_labels = depends_on = None

STATUS = (
    "'in_library', 'downloading', 'importing', 'searching', 'waiting', 'not_released', "
    "'attention', 'wanted', 'excluded', 'not_requested'"
)


def _created():
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
    )


def upgrade():
    op.create_table(
        "radio_stations",
        sa.Column("id", sa.String(60), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("logo_path", sa.String(300)),
        sa.Column("logo_fetched_at", sa.DateTime(timezone=True)),
        _created(),
    )
    op.create_table(
        "radio_shows",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _created(),
        sa.Column(
            "owner_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("external_id", sa.String(20), nullable=False),
        sa.Column("title", sa.String(600), nullable=False),
        sa.Column("synopsis", sa.Text()),
        sa.Column("first_broadcast", sa.DateTime(timezone=True)),
        sa.Column(
            "station_id", sa.String(60), sa.ForeignKey("radio_stations.id", ondelete="SET NULL")
        ),
        sa.Column("image_pid", sa.String(20)),
        sa.Column("artwork_path", sa.String(300)),
        sa.Column("artwork_fetched_at", sa.DateTime(timezone=True)),
        sa.Column("logo_path", sa.String(300)),
        sa.Column("logo_colour", sa.String(20)),
        sa.Column("logo_source", sa.String(20)),
        sa.Column("follow", sa.String(20), server_default="from_now_on", nullable=False),
        sa.Column("followed_at", sa.DateTime(timezone=True)),
        sa.Column("refreshed_at", sa.DateTime(timezone=True)),
        sa.Column("operation_id", sa.Uuid(), sa.ForeignKey("operations.id", ondelete="SET NULL")),
        sa.UniqueConstraint("owner_id", "provider", "external_id"),
        sa.CheckConstraint("provider = 'bbc'", name="radio_shows_provider_check"),
        sa.CheckConstraint(
            "follow IN ('all', 'from_now_on', 'none')", name="radio_shows_follow_check"
        ),
    )
    op.create_index("ix_radio_shows_owner_id", "radio_shows", ["owner_id"])
    op.create_index("ix_radio_shows_station_id", "radio_shows", ["station_id"])
    op.create_table(
        "radio_series",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _created(),
        sa.Column(
            "show_id",
            sa.Uuid(),
            sa.ForeignKey("radio_shows.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("pid", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("number_source", sa.String(20), nullable=False),
        sa.Column("title", sa.String(600), nullable=False),
        sa.Column("synopsis", sa.Text()),
        sa.Column(
            "station_id", sa.String(60), sa.ForeignKey("radio_stations.id", ondelete="SET NULL")
        ),
        sa.Column("expected_episodes", sa.Integer()),
        sa.Column("first_broadcast", sa.DateTime(timezone=True)),
        sa.Column("walked_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("show_id", "pid"),
        sa.CheckConstraint("kind IN ('series', 'specials')", name="radio_series_kind_check"),
        sa.CheckConstraint(
            "number_source IN ('bbc', 'broadcast_order')",
            name="radio_series_number_source_check",
        ),
    )
    op.create_index("ix_radio_series_show_id", "radio_series", ["show_id"])
    op.create_index("ix_radio_series_station_id", "radio_series", ["station_id"])
    op.create_table(
        "radio_episodes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        _created(),
        sa.Column(
            "show_id",
            sa.Uuid(),
            sa.ForeignKey("radio_shows.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "series_id",
            sa.Uuid(),
            sa.ForeignKey("radio_series.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("pid", sa.String(20), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("number_source", sa.String(20), nullable=False),
        sa.Column("title", sa.String(600), nullable=False),
        sa.Column("synopsis", sa.Text()),
        sa.Column("first_broadcast", sa.DateTime(timezone=True)),
        sa.Column("duration_seconds", sa.Integer()),
        sa.Column("status", sa.String(20), nullable=False),
        sa.UniqueConstraint("show_id", "pid"),
        sa.CheckConstraint(f"status IN ({STATUS})", name="radio_episodes_status_check"),
        sa.CheckConstraint(
            "number_source IN ('bbc', 'broadcast_order')",
            name="radio_episodes_number_source_check",
        ),
    )
    op.create_index("ix_radio_episodes_show_id", "radio_episodes", ["show_id"])
    op.create_index("ix_radio_episodes_series_id", "radio_episodes", ["series_id"])


def downgrade():
    op.drop_table("radio_episodes")
    op.drop_table("radio_series")
    op.drop_table("radio_shows")
    op.drop_table("radio_stations")

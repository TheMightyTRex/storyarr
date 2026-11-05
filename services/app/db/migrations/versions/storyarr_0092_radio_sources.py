"""
Radio sources beyond the BBC, and safer following (RADIO-02 with the Reelix comparison).

- Shows can come from a podcast feed (`feed`, also used for Apple Podcasts) or the Internet
  Archive (`archive`), so ids are longer and a show keeps its author, web page, remote artwork
  and licence.
- Series and episodes the source stops listing are kept and marked `removed_at`.
- An episode can be monitored by hand (`monitored`: true or false; null follows the show).
- Files rejected with "Not this file" are remembered per episode (`rejected_files`), so
  automatic matching can still find the right one.
- Radio library files keep their guid and enclosure address, for exact matches with feeds.
- Other ids a show was added or opened under (`radio_show_aliases`).
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "storyarr_0092_radio_sources"
down_revision = "storyarr_0091_radio_following"
branch_labels = depends_on = None

NUMBER_SOURCES = ("bbc", "broadcast_order", "source")


def _replace_check(table, name, expression):
    op.drop_constraint(name, table, type_="check")
    op.create_check_constraint(name, table, expression)


def _numbering(values):
    listed = ", ".join(f"'{value}'" for value in values)
    return f"number_source IN ({listed})"


def upgrade():
    _replace_check(
        "radio_shows", "radio_shows_provider_check", "provider IN ('bbc', 'feed', 'archive')"
    )
    op.alter_column("radio_shows", "external_id", type_=sa.String(1000))
    op.add_column("radio_shows", sa.Column("author", sa.String(300)))
    op.add_column("radio_shows", sa.Column("web_url", sa.String(1000)))
    op.add_column("radio_shows", sa.Column("artwork_url", sa.String(1000)))
    op.add_column("radio_shows", sa.Column("licence", sa.String(300)))

    op.alter_column("radio_series", "pid", type_=sa.String(200))
    op.add_column("radio_series", sa.Column("removed_at", sa.DateTime(timezone=True)))
    _replace_check("radio_series", "radio_series_number_source_check", _numbering(NUMBER_SOURCES))

    op.alter_column("radio_episodes", "pid", type_=sa.String(200))
    op.add_column("radio_episodes", sa.Column("enclosure_url", sa.String(2000)))
    op.add_column("radio_episodes", sa.Column("removed_at", sa.DateTime(timezone=True)))
    op.add_column("radio_episodes", sa.Column("monitored", sa.Boolean()))
    op.add_column(
        "radio_episodes",
        sa.Column(
            "rejected_files",
            postgresql.ARRAY(sa.Uuid()),
            nullable=False,
            server_default=sa.text("'{}'::uuid[]"),
        ),
    )
    _replace_check(
        "radio_episodes", "radio_episodes_number_source_check", _numbering(NUMBER_SOURCES)
    )

    op.add_column("radio_library_files", sa.Column("guid", sa.String(500)))
    op.add_column("radio_library_files", sa.Column("enclosure_url", sa.String(2000)))
    op.create_index("ix_radio_library_files_guid", "radio_library_files", ["guid"])

    op.create_table(
        "radio_show_aliases",
        sa.Column(
            "show_id",
            sa.Uuid(),
            sa.ForeignKey("radio_shows.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("provider", sa.String(20), primary_key=True),
        sa.Column("external_id", sa.String(1000), primary_key=True),
    )
    op.create_index(
        "ix_radio_show_aliases_lookup", "radio_show_aliases", ["provider", "external_id"]
    )


def downgrade():
    bind = op.get_bind()
    if bind.scalar(sa.text("SELECT EXISTS(SELECT 1 FROM radio_shows WHERE provider <> 'bbc')")):
        raise RuntimeError(
            "Shows from podcast feeds or the Internet Archive need a pre-upgrade backup, "
            "or remove them first"
        )
    op.drop_index("ix_radio_show_aliases_lookup", "radio_show_aliases")
    op.drop_table("radio_show_aliases")
    op.drop_index("ix_radio_library_files_guid", "radio_library_files")
    op.drop_column("radio_library_files", "enclosure_url")
    op.drop_column("radio_library_files", "guid")
    bind.execute(
        sa.text("UPDATE radio_episodes SET number_source = 'bbc' WHERE number_source = 'source'")
    )
    bind.execute(
        sa.text("UPDATE radio_series SET number_source = 'bbc' WHERE number_source = 'source'")
    )
    _replace_check(
        "radio_episodes", "radio_episodes_number_source_check", _numbering(NUMBER_SOURCES[:2])
    )
    _replace_check(
        "radio_series", "radio_series_number_source_check", _numbering(NUMBER_SOURCES[:2])
    )
    for column in ("rejected_files", "monitored", "removed_at", "enclosure_url"):
        op.drop_column("radio_episodes", column)
    op.alter_column("radio_episodes", "pid", type_=sa.String(20))
    op.drop_column("radio_series", "removed_at")
    op.alter_column("radio_series", "pid", type_=sa.String(20))
    for column in ("licence", "artwork_url", "web_url", "author"):
        op.drop_column("radio_shows", column)
    op.alter_column("radio_shows", "external_id", type_=sa.String(20))
    _replace_check("radio_shows", "radio_shows_provider_check", "provider = 'bbc'")

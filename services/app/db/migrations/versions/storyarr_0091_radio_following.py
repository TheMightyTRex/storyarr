"""
Radio following (R4): a wanted episode is requested through the acquisition path with a new
reason kind, `episode`, and remembers the private catalogue record it is requested through.
"""

import sqlalchemy as sa
from alembic import op

revision = "storyarr_0091_radio_following"
down_revision = "storyarr_0090_radio_review"
branch_labels = depends_on = None


def replace_kinds(expression):
    checks = sa.inspect(op.get_bind()).get_check_constraints("acquisition_reasons")
    for check in checks:
        if "kind" in check["sqltext"]:
            op.drop_constraint(check["name"], "acquisition_reasons", type_="check")
    op.create_check_constraint("acquisition_reason_kind", "acquisition_reasons", expression)


def upgrade():
    replace_kinds("kind IN ('manual', 'list', 'series', 'episode')")
    op.add_column(
        "radio_episodes",
        sa.Column("work_id", sa.Uuid(), sa.ForeignKey("works.id", ondelete="SET NULL")),
    )
    op.create_index("ix_radio_episodes_work_id", "radio_episodes", ["work_id"])


def downgrade():
    if op.get_bind().scalar(
        sa.text("SELECT EXISTS(SELECT 1 FROM acquisition_reasons WHERE kind = 'episode')")
    ):
        raise RuntimeError("Radio episode requests require a pre-upgrade backup")
    op.drop_index("ix_radio_episodes_work_id", "radio_episodes")
    op.drop_column("radio_episodes", "work_id")
    replace_kinds("kind IN ('manual', 'list', 'series')")

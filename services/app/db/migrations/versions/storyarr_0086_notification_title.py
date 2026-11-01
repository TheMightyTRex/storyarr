"""
Notifications are titled "Storyarr notification" instead of "Dewarr notification". The trigger
function from 0062 is rewritten in place, and notifications already stored are renamed too.
"""

from alembic import op

revision = "storyarr_0086_notification_title"
down_revision = "storyarr_0085_user_preferences"
branch_labels = depends_on = None


def _retitle(old: str, new: str) -> None:
    op.execute(
        f"""
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('capture_notification_event()'::regprocedure) INTO definition;
  EXECUTE replace(definition, '''{old}''', '''{new}''');
END $$
"""
    )
    op.execute(
        f"""
UPDATE notification_events
SET payload = jsonb_set(payload, '{{title}}', to_jsonb('{new}'::text))
WHERE payload ->> 'title' = '{old}'
"""
    )


def upgrade():
    _retitle("Dewarr notification", "Storyarr notification")


def downgrade():
    _retitle("Storyarr notification", "Dewarr notification")

"""Delete sign-in records that can no longer be used: expired sessions and old sign-in counters."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete

from app.db.models import LoginSession, RateLimit
from app.db.session import session_factory


async def purge() -> tuple[int, int]:
    """Runs each night. Counters stay a day after they reset, so a burst still shows."""
    now = datetime.now(UTC)
    async with session_factory()() as db, db.begin():
        sessions = await db.execute(delete(LoginSession).where(LoginSession.expires_at <= now))
        counters = await db.execute(
            delete(RateLimit).where(RateLimit.resets_at < now - timedelta(days=1))
        )
    return sessions.rowcount, counters.rowcount

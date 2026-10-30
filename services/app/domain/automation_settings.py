"""Member automation defaults, separate from release preferences frozen into requests."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.adapters.hardcover_follows import FollowFilters
from app.db.models import AutomationSettings


class AutomationDefaults(BaseModel):
    # Settings saved by a newer release may hold fields this one doesn't know yet.
    model_config = ConfigDict(extra="ignore")
    follow_filters: FollowFilters = Field(default_factory=FollowFilters)
    # Media for "Add missing books"; None follows the member's download preferences.
    missing_media: Literal["audio", "ebook", "both"] | None = None


async def current(db, owner_id, *, lock=False):
    statement = select(AutomationSettings).where(AutomationSettings.owner_id == owner_id)
    if lock:
        statement = statement.with_for_update()
    row = await db.scalar(statement)
    return row, AutomationDefaults.model_validate(row.settings if row else {})

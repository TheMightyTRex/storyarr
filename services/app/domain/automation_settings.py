"""Member automation defaults, separate from release preferences frozen into requests."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.adapters.hardcover_follows import FollowFilters
from app.db.models import AutomationSettings, InstallationAutomation


class WantedSearch(BaseModel):
    """Search again, on a back-off schedule, for requested books that are still wanted."""

    model_config = ConfigDict(extra="ignore")
    enabled: bool = True
    # Formats to keep searching for. A request for both formats is searched while either is on.
    audio: bool = True
    ebook: bool = True

    def allows(self, mode):
        if not self.enabled:
            return False
        if mode == "audio":
            return self.audio
        if mode == "ebook":
            return self.ebook
        return self.audio or self.ebook


class AutomationDefaults(BaseModel):
    # Settings saved by a newer release may hold fields this one doesn't know yet.
    model_config = ConfigDict(extra="ignore")
    follow_filters: FollowFilters = Field(default_factory=FollowFilters)
    # Media for "Add missing books"; None follows the member's download preferences.
    missing_media: Literal["audio", "ebook", "both"] | None = None
    wanted_search: WantedSearch = Field(default_factory=WantedSearch)


async def current(db, owner_id, *, lock=False):
    statement = select(AutomationSettings).where(AutomationSettings.owner_id == owner_id)
    if lock:
        statement = statement.with_for_update()
    row = await db.scalar(statement)
    return row, AutomationDefaults.model_validate(row.settings if row else {})


class InstallationDefaults(BaseModel):
    model_config = ConfigDict(extra="ignore")
    # Days a deleted book's files stay in the holding folder before Storyarr removes them.
    # 0 keeps them until someone deletes them by hand.
    deleted_retention_days: int = Field(default=30, ge=0, le=3650)


async def installation(db, *, lock=False):
    statement = select(InstallationAutomation).where(InstallationAutomation.id == 1)
    if lock:
        statement = statement.with_for_update()
    row = await db.scalar(statement)
    return row, InstallationDefaults.model_validate(row.settings if row else {})

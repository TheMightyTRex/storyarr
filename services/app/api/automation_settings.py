"""A member's own automation defaults, used for new follows and later automation."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.adapters.hardcover_follows import FollowFilters
from app.api.dependencies import Database, Member
from app.db.models import AuditEvent, AutomationSettings
from app.domain.automation_settings import AutomationDefaults, current

router = APIRouter(prefix="/automation/settings", tags=["automation-settings"])


class AutomationValues(BaseModel):
    follow_filters: FollowFilters
    missing_media: Literal["audio", "ebook", "both"] | None


class AutomationSettingsView(BaseModel):
    settings: AutomationValues
    built_in: AutomationValues
    generation: int


class AutomationSettingsInput(BaseModel):
    """Only the fields sent are changed."""

    model_config = ConfigDict(extra="forbid")
    follow_filters: FollowFilters | None = None
    missing_media: Literal["audio", "ebook", "both"] | None = None
    expected_generation: int = Field(ge=0)


def view(row, settings):
    return AutomationSettingsView(
        settings=settings.model_dump(),
        built_in=AutomationDefaults().model_dump(),
        generation=row.generation if row else 0,
    )


@router.get("", response_model=AutomationSettingsView)
async def read(user: Member, db: Database):
    return view(*await current(db, user.id))


@router.put("", response_model=AutomationSettingsView)
async def save(body: AutomationSettingsInput, user: Member, db: Database):
    row, settings = await current(db, user.id, lock=True)
    if (row.generation if row else 0) != body.expected_generation:
        raise HTTPException(409, "Automation settings changed; reload before saving")
    if not row:
        row = AutomationSettings(owner_id=user.id, generation=0, settings={})
        db.add(row)
    changes = body.model_dump(exclude={"expected_generation"}, exclude_unset=True)
    if changes.get("follow_filters") is None:
        changes.pop("follow_filters", None)
    settings = AutomationDefaults.model_validate({**settings.model_dump(), **changes})
    # Keep fields a newer release saved, so moving between versions loses nothing.
    row.settings = {**row.settings, **settings.model_dump(mode="json")}
    row.generation += 1
    db.add(
        AuditEvent(
            actor_id=user.id,
            action="automation.settings.updated",
            detail={"generation": row.generation},
        )
    )
    await db.commit()
    return view(row, settings)

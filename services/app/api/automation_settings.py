"""A member's own automation defaults, used for new follows and later automation."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.adapters.hardcover_follows import FollowFilters
from app.api.dependencies import Database, Member
from app.db.models import AuditEvent, AutomationSettings
from app.domain.automation_settings import AutomationDefaults, current

router = APIRouter(prefix="/automation/settings", tags=["automation-settings"])


class AutomationValues(BaseModel):
    follow_filters: FollowFilters


class AutomationSettingsView(BaseModel):
    settings: AutomationValues
    built_in: AutomationValues
    generation: int


class AutomationSettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    follow_filters: FollowFilters
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
    settings = settings.model_copy(update={"follow_filters": body.follow_filters})
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

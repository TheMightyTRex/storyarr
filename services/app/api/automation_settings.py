"""A member's own automation defaults, used for new follows and later automation."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.adapters.hardcover_follows import FollowFilters
from app.api.dependencies import Admin, Database, Member
from app.db.models import AuditEvent, AutomationSettings, InstallationAutomation
from app.domain.automation_settings import (
    AutomationDefaults,
    InstallationDefaults,
    WantedSearch,
    current,
    installation,
)

router = APIRouter(prefix="/automation/settings", tags=["automation-settings"])


class AutomationValues(BaseModel):
    follow_filters: FollowFilters
    missing_media: Literal["audio", "ebook", "both"] | None
    wanted_search: WantedSearch


class AutomationSettingsView(BaseModel):
    settings: AutomationValues
    built_in: AutomationValues
    generation: int


class AutomationSettingsInput(BaseModel):
    """Only the fields sent are changed."""

    model_config = ConfigDict(extra="forbid")
    follow_filters: FollowFilters | None = None
    missing_media: Literal["audio", "ebook", "both"] | None = None
    wanted_search: WantedSearch | None = None
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
    for name in ("follow_filters", "wanted_search"):
        if changes.get(name) is None:
            changes.pop(name, None)
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


class InstallationSettingsView(BaseModel):
    settings: InstallationDefaults
    built_in: InstallationDefaults
    generation: int


class InstallationSettingsInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    deleted_retention_days: int = Field(ge=0, le=3650)
    expected_generation: int = Field(ge=0)


@router.get("/installation", response_model=InstallationSettingsView)
async def read_installation(admin: Admin, db: Database):
    row, settings = await installation(db)
    return InstallationSettingsView(
        settings=settings, built_in=InstallationDefaults(), generation=row.generation if row else 0
    )


@router.put("/installation", response_model=InstallationSettingsView)
async def save_installation(body: InstallationSettingsInput, admin: Admin, db: Database):
    row, settings = await installation(db, lock=True)
    if (row.generation if row else 0) != body.expected_generation:
        raise HTTPException(409, "Automation settings changed; reload before saving")
    if not row:
        row = InstallationAutomation(id=1, generation=0, settings={})
        db.add(row)
    settings = settings.model_copy(update={"deleted_retention_days": body.deleted_retention_days})
    row.settings = {**row.settings, **settings.model_dump(mode="json")}
    row.generation += 1
    db.add(
        AuditEvent(
            actor_id=admin.id,
            action="automation.installation.updated",
            detail={"generation": row.generation},
        )
    )
    await db.commit()
    return InstallationSettingsView(
        settings=settings, built_in=InstallationDefaults(), generation=row.generation
    )

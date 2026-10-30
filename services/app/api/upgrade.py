"""The upgrade wizard and settings backups (admins)."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select

from app import upgrade_backups
from app.api.dependencies import Admin, Database
from app.db.models import AuditEvent, User
from app.domain import upgrades

router = APIRouter(prefix="/upgrade", tags=["upgrade"])


class BackupView(BaseModel):
    name: str
    created_at: str | None = None
    reason: str | None = None
    release_from: str | None = None
    release_to: str | None = None
    schema_from: str | None = None
    schema_to: str | None = None
    size: int
    rows: dict[str, int]


class UpgradeView(BaseModel):
    release: str
    acknowledged: str | None
    # True on an existing install that has not finished the wizard for this release.
    pending: bool
    releases: list[upgrades.UpgradeRelease]
    backups: list[BackupView]
    restored_from: str | None = None
    # Upgrades finish on their own: a backup is taken and new settings keep their defaults.
    automatic: bool
    automatic_from_environment: bool


class RestoreInput(BaseModel):
    confirm: bool


class RestoreView(BaseModel):
    backup_taken: str
    tables: dict[str, dict[str, int]]


async def _existing_install(db) -> bool:
    accounts = await db.scalars(select(User.onboarding).where(User.role == "admin"))
    # Setup that was finished, skipped or put off for later all mean the install is in use.
    return any(
        (value or {}).get("status") in {"completed", "skipped", "deferred"} for value in accounts
    )


async def view(db) -> UpgradeView:
    saved = await upgrades.state(db)
    acknowledged = saved.get("release")
    return UpgradeView(
        release=upgrades.CURRENT,
        acknowledged=acknowledged,
        pending=acknowledged != upgrades.CURRENT and await _existing_install(db),
        releases=upgrades.since(acknowledged),
        backups=upgrade_backups.listing(),
        restored_from=saved.get("restored_from"),
        automatic=bool(saved.get("automatic")) or upgrades.automatic_from_environment(),
        automatic_from_environment=upgrades.automatic_from_environment(),
    )


@router.get("", response_model=UpgradeView)
async def read(admin: Admin, db: Database):
    return await view(db)


@router.post("/acknowledge", response_model=UpgradeView)
async def acknowledge(admin: Admin, db: Database):
    await upgrades.save_state(db, release=upgrades.CURRENT)
    db.add(
        AuditEvent(
            actor_id=admin.id, action="upgrade.acknowledged", detail={"release": upgrades.CURRENT}
        )
    )
    await db.commit()
    return await view(db)


@router.post("/backups", response_model=BackupView, status_code=201)
async def take_backup(admin: Admin, db: Database):
    try:
        name = await upgrades.snapshot(db, "manual")
    except OSError as error:
        raise HTTPException(
            503, "The backup could not be written. Check that /config can be written to."
        ) from error
    db.add(AuditEvent(actor_id=admin.id, action="upgrade.backup", detail={"name": name}))
    await db.commit()
    return next(item for item in upgrade_backups.listing() if item["name"] == name)


@router.get("/backups/{name}")
async def download(name: str, admin: Admin):
    try:
        path = upgrade_backups.path_for(name)
    except FileNotFoundError as error:
        raise HTTPException(404, "Backup not found") from error
    return FileResponse(path, media_type="application/json", filename=name)


@router.post("/backups/{name}/restore", response_model=RestoreView)
async def restore(name: str, body: RestoreInput, admin: Admin, db: Database):
    if not body.confirm:
        raise HTTPException(422, "Confirm the restore to continue")
    try:
        upgrade_backups.path_for(name)
    except FileNotFoundError as error:
        raise HTTPException(404, "Backup not found") from error
    # Keep today's settings first, so the restore itself can be undone.
    taken = await upgrades.snapshot(db, "before-restore")
    try:
        tables = await upgrades.restore(db, name)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    db.add(
        AuditEvent(
            actor_id=admin.id,
            action="upgrade.restored",
            detail={"name": name, "backup_taken": taken},
        )
    )
    await db.commit()
    return RestoreView(backup_taken=taken, tables=tables)


class AutomaticInput(BaseModel):
    automatic: bool


@router.put("/settings", response_model=UpgradeView)
async def settings(body: AutomaticInput, admin: Admin, db: Database):
    await upgrades.save_state(db, automatic=body.automatic)
    db.add(
        AuditEvent(
            actor_id=admin.id,
            action="upgrade.settings",
            detail={"automatic": body.automatic},
        )
    )
    await db.commit()
    return await view(db)


@router.post("/automatic", response_model=UpgradeView)
async def automatic(admin: Admin, db: Database):
    """For scripts: take a backup, keep the defaults for new settings, and finish the upgrade."""
    try:
        saved = await upgrades.accept_defaults(db)
    except OSError as error:
        raise HTTPException(
            503, "The backup could not be written. Check that /config can be written to."
        ) from error
    db.add(
        AuditEvent(
            actor_id=admin.id,
            action="upgrade.accepted",
            detail={"release": upgrades.CURRENT, "backup": saved.get("backup")},
        )
    )
    await db.commit()
    return await view(db)

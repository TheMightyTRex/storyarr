import json
import os

import psycopg
import pytest
from sqlalchemy import select

from app import upgrade_backups
from app.db.models import User
from app.domain import audible_store, upgrades

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def backup_folder(tmp_path, monkeypatch):
    monkeypatch.setattr(upgrade_backups, "ROOT", tmp_path / "upgrade-backups")
    yield tmp_path / "upgrade-backups"
    audible_store.remember(None)


async def finish_onboarding(database, status="completed"):
    async with database() as db, db.begin():
        user = await db.scalar(select(User).where(User.username == "admin"))
        user.onboarding = {**(user.onboarding or {}), "status": status}


async def test_the_wizard_shows_once_on_an_existing_install(client, admin, database):
    fresh = (await client.get("/api/upgrade")).json()
    # Before setup is finished this is a new install: onboarding comes first, not the wizard.
    assert fresh["pending"] is False and fresh["release"] == upgrades.CURRENT
    # Setup put off for later still means the install is in use.
    await finish_onboarding(database, "deferred")
    shown = (await client.get("/api/upgrade")).json()
    assert shown["pending"] is True and shown["acknowledged"] is None
    assert [release["id"] for release in shown["releases"]] == [upgrades.CURRENT]
    assert {item["id"] for item in shown["releases"][0]["review"]} >= {"layout", "audible-store"}
    done = await client.post("/api/upgrade/acknowledge")
    assert done.status_code == 200, done.text
    assert done.json()["pending"] is False and done.json()["releases"] == []
    # Saving another installation setting keeps the wizard's record.
    current = (await client.get("/api/automation/settings/installation")).json()
    await client.put(
        "/api/automation/settings/installation",
        json={"deleted_retention_days": 7, "expected_generation": current["generation"]},
    )
    assert (await client.get("/api/upgrade")).json()["pending"] is False


async def test_a_settings_backup_can_be_downloaded_and_restored(
    client, admin, database, backup_folder
):
    assert (
        await client.put("/api/metadata/preferences", json={"audible_region": "uk"})
    ).status_code == 200
    taken = await client.post("/api/upgrade/backups")
    assert taken.status_code == 201, taken.text
    name = taken.json()["name"]
    assert taken.json()["rows"]["metadata_settings"] == 1
    assert oct((backup_folder / name).stat().st_mode & 0o777) == "0o600"
    download = await client.get(f"/api/upgrade/backups/{name}")
    assert download.status_code == 200
    assert "metadata_settings" in json.loads(download.content)["tables"]

    await client.put("/api/metadata/preferences", json={"audible_region": "us"})
    refused = await client.post(f"/api/upgrade/backups/{name}/restore", json={"confirm": False})
    assert refused.status_code == 422
    restored = await client.post(f"/api/upgrade/backups/{name}/restore", json={"confirm": True})
    assert restored.status_code == 200, restored.text
    assert restored.json()["tables"]["metadata_settings"] == {"restored": 1, "skipped": 0}
    assert "users" not in restored.json()["tables"]
    assert (await client.get("/api/metadata/preferences")).json()["audible_region"] == "uk"
    # Today's settings were saved first, so the restore can be undone.
    names = [item["name"] for item in (await client.get("/api/upgrade")).json()["backups"]]
    assert restored.json()["backup_taken"] in names and len(names) == 2
    assert (await client.get("/api/upgrade/backups/../app_key")).status_code == 404
    assert (await client.get("/api/upgrade/backups/settings-nope.json")).status_code == 404


async def test_startup_saves_settings_once_before_an_upgrade(client, admin, backup_folder):
    from app import container

    url = os.environ["BOOK_DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(url, autocommit=True) as connection:
        record = container.prepare_upgrade(connection)
        assert record == {"backed_up_for": upgrades.CURRENT}
        [backup] = upgrade_backups.listing()
        assert backup["reason"] == "before-upgrade" and backup["release_to"] == upgrades.CURRENT
        container._save_upgrade_state(connection, **record)
        # The same release and schema again: no second backup.
        assert container.prepare_upgrade(connection) == {}
        assert len(upgrade_backups.listing()) == 1

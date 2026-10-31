"""
Settings backups for upgrades: a JSON copy of the configuration tables, taken automatically before
an upgrade changes the database, and on request. Library data, history and caches are left out, so
a backup is small and quick. A restore puts the saved settings back over the current ones, and never
deletes rows.
"""

import json
import os
import re
from datetime import UTC, datetime
from pathlib import Path

FORMAT = 1
ROOT = Path(os.environ.get("BOOK_UPGRADE_BACKUPS", "/config/upgrade-backups"))
NAME = re.compile(r"^settings-\d{8}-\d{6}-[a-z-]+\.json$")

# Configuration only. Users are saved for reference but never restored, so a restore cannot change
# anyone's password or role.
TABLES = [
    "metadata_settings",
    "automation_settings",
    "installation_automation",
    "acquisition_defaults",
    "acquisition_profiles",
    "automatic_import_policies",
    "capacity_settings",
    "download_recovery_settings",
    "import_storage_settings",
    "import_destinations",
    "organization_settings",
    "onboarding_settings",
    "background_work_settings",
    "notification_policy",
    "notification_channels",
    "request_quota_policies",
    "permission_roles",
    "oidc_provider",
    "integrations",
    "source_connections",
    "catalog_accounts",
    "libraries",
    "library_grants",
    "book_lists",
    "list_subscriptions",
    "list_acquisition_policies",
    "list_writeback_policies",
    "discovery_layouts",
    "users",
]
NOT_RESTORED = {"users"}


def file_name(reason: str, now: datetime | None = None) -> str:
    stamp = (now or datetime.now(UTC)).strftime("%Y%m%d-%H%M%S")
    reason = re.sub(r"[^a-z-]+", "-", reason.lower()).strip("-") or "manual"
    return f"settings-{stamp}-{reason}.json"


def document(tables: dict[str, list[dict]], **details) -> dict:
    return {
        "format": FORMAT,
        "created_at": datetime.now(UTC).isoformat(),
        **details,
        "tables": tables,
    }


def write(document_: dict, reason: str, root: Path | None = None) -> Path:
    root = root or ROOT
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = root / file_name(reason)
    counter = 1
    while path.exists():
        counter += 1
        path = root / file_name(f"{reason}-{counter}")
    # Integrations hold encrypted secrets and users hold password hashes: keep the file private.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(document_, handle, indent=1, default=str)
    return path


def listing(root: Path | None = None) -> list[dict]:
    root = root or ROOT
    if not root.is_dir():
        return []
    found = []
    for path in sorted(root.iterdir(), reverse=True):
        if not NAME.match(path.name) or not path.is_file():
            continue
        try:
            data = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        found.append(
            {
                "name": path.name,
                "created_at": data.get("created_at"),
                "reason": data.get("reason"),
                "release_from": data.get("release_from"),
                "release_to": data.get("release_to"),
                "schema_from": data.get("schema_from"),
                "schema_to": data.get("schema_to"),
                "size": path.stat().st_size,
                "rows": {name: len(rows) for name, rows in data.get("tables", {}).items()},
            }
        )
    return found


def path_for(name: str, root: Path | None = None) -> Path:
    root = root or ROOT
    if not NAME.match(name):
        raise FileNotFoundError(name)
    path = root / name
    if not path.is_file():
        raise FileNotFoundError(name)
    return path


def snapshot_sync(connection, reason: str, **details) -> Path:
    """Take a backup with a psycopg connection, before the app's own database session exists."""
    present = {
        row[0]
        for row in connection.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
        ).fetchall()
    }
    tables = {}
    for name in TABLES:
        if name in present:
            rows = connection.execute(f'SELECT row_to_json(t) FROM "{name}" t').fetchall()
            tables[name] = [row[0] for row in rows]
    return write(document(tables, reason=reason, **details), reason)

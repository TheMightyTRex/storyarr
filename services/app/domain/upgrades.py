"""Releases of this fork, the upgrade wizard's state, and settings backups taken from the app."""

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import text

from app import upgrade_backups
from app.db.models import InstallationAutomation


class UpgradeReviewItem(BaseModel):
    id: str
    title: str
    description: str
    link: str


class UpgradeRelease(BaseModel):
    id: str
    title: str
    highlights: list[str]
    # New settings worth a look after upgrading; each has built-in defaults already applied.
    review: list[UpgradeReviewItem] = []
    # Changes to the database structure, each with how to undo it. A settings backup is taken
    # before they run; take a full database backup too.
    database_changes: list[str] = []
    rollback: str | None = None


# Newest last. Add a release whenever an upgrade brings changes an existing install should hear
# about.
RELEASES = [
    UpgradeRelease(
        id="2026.10.30",
        title="Layout, light theme, bookshelves and smarter searching",
        highlights=[
            "A choice of layout: Classic, or Shelf with a slim icon menu and page menus in the "
            "header.",
            "A light theme by default, with Dark and Match device, plus display and "
            "accessibility settings: text size, a low-vision font, high contrast, reduced "
            "motion, underlined links and wider spacing.",
            "A bookshelf page for each followed author or series, with progress, statuses and a "
            "book drawer.",
            "Book types for follows, statuses for every followed book, and Add missing books.",
            "Delete library books, with a holding folder you can restore from and a retention "
            "period.",
            "Activity in three tabs: Queue, Wanted and History, each with filters.",
            "Settings in six groups.",
            "Wanted books are searched again automatically.",
            "Audible search when matching library audiobooks, and a choice of Audible store.",
        ],
        review=[
            UpgradeReviewItem(
                id="layout",
                title="Layout and display",
                description="Choose Classic or Shelf, a theme and a text size.",
                link="/settings#display",
            ),
            UpgradeReviewItem(
                id="follow-types",
                title="Book types for new follows",
                description="Which kinds of books new author and series follows include.",
                link="/settings?group=follow-defaults#automation",
            ),
            UpgradeReviewItem(
                id="wanted-search",
                title="Wanted books",
                description="Whether wanted books are searched again, and for which formats.",
                link="/settings?group=wanted-search#automation",
            ),
            UpgradeReviewItem(
                id="deleted-books",
                title="Deleted books",
                description="How long deleted books stay in the holding folder.",
                link="/settings?group=deleted-books#automation",
            ),
            UpgradeReviewItem(
                id="audible-store",
                title="Audible store",
                description="The Audible store used for Audible search and recording details.",
                link="/settings#catalog",
            ),
        ],
    ),
    UpgradeRelease(
        id="2026.10.30.2",
        title="Faster pages",
        highlights=[
            "Request counts take under a second instead of several minutes, so Activity and "
            "background work are much quicker.",
            "Leaving a page now stops the database work it started.",
            "A loading bar under the header shows when a page is fetching data.",
            "The request count badge is no longer in the main menu.",
            "Book lookups across the app use a quicker query.",
        ],
        database_changes=[
            "Two new indexes on the operations table: by kind and status, and by request.",
        ],
        rollback=(
            "To undo the indexes, downgrade the database to 0082_installation_automation "
            "(alembic downgrade 0082_installation_automation). This removes only the indexes; "
            "no settings or data change."
        ),
    ),
]
CURRENT = RELEASES[-1].id


async def state(db) -> dict[str, Any]:
    row = await db.get(InstallationAutomation, 1)
    return dict((row.settings or {}).get("upgrade", {})) if row else {}


async def save_state(db, **changes) -> dict[str, Any]:
    row = await db.get(InstallationAutomation, 1, with_for_update=True)
    if not row:
        row = InstallationAutomation(id=1, generation=0, settings={})
        db.add(row)
    current = {**(row.settings or {}).get("upgrade", {}), **changes}
    row.settings = {**(row.settings or {}), "upgrade": current}
    return current


def since(release: str | None) -> list[UpgradeRelease]:
    ids = [item.id for item in RELEASES]
    if release in ids:
        return RELEASES[ids.index(release) + 1 :]
    return list(RELEASES)


async def _schema(db) -> str | None:
    return await db.scalar(text("SELECT version_num FROM alembic_version"))


async def snapshot(db, reason: str) -> str:
    present = set(
        await db.scalars(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        )
    )
    tables = {}
    for name in upgrade_backups.TABLES:
        if name in present:
            rows = await db.scalars(text(f'SELECT row_to_json(t) FROM "{name}" t'))
            tables[name] = list(rows)
    upgraded = await state(db)
    schema = await _schema(db)
    path = upgrade_backups.write(
        upgrade_backups.document(
            tables,
            reason=reason,
            schema_from=schema,
            schema_to=schema,
            release_from=upgraded.get("release"),
            release_to=CURRENT,
        ),
        reason,
    )
    return path.name


def _quoted(names) -> str:
    return ", ".join(f'"{name}"' for name in names)


async def _keys(db, table: str) -> tuple[list[str], list[str]]:
    columns = list(
        await db.scalars(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' AND table_name = :table ORDER BY ordinal_position"
            ),
            {"table": table},
        )
    )
    primary = list(
        await db.scalars(
            text(
                "SELECT a.attname FROM pg_index i "
                "JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) "
                "WHERE i.indrelid = CAST(:table AS regclass) AND i.indisprimary"
            ),
            {"table": f'public."{table}"'},
        )
    )
    return columns, primary


async def restore(db, name: str) -> dict[str, dict[str, int]]:
    """
    Put a backup's settings back. Rows in the backup replace the matching current rows, rows that no
    longer exist are added back, and nothing is deleted. Columns added since the backup keep their
    current values. Users are not restored.
    """
    import json

    data = json.loads(upgrade_backups.path_for(name).read_text())
    if data.get("format") != upgrade_backups.FORMAT:
        raise ValueError("This backup was made by a different version and cannot be restored")
    summary = {}
    for table in upgrade_backups.TABLES:
        rows = data.get("tables", {}).get(table)
        if rows is None or table in upgrade_backups.NOT_RESTORED:
            continue
        columns, primary = await _keys(db, table)
        if not columns or not primary:
            continue
        restored = skipped = 0
        for row in rows:
            names = [column for column in columns if column in row]
            if not set(primary) <= set(names):
                skipped += 1
                continue
            listed = _quoted(names)
            updates = [column for column in names if column not in primary]
            conflict = (
                "DO UPDATE SET " + ", ".join(f'"{c}" = EXCLUDED."{c}"' for c in updates)
                if updates
                else "DO NOTHING"
            )
            statement = text(
                f'INSERT INTO "{table}" ({listed}) '
                f'SELECT {listed} FROM json_populate_record(NULL::"{table}", CAST(:row AS json)) '
                f"ON CONFLICT ({_quoted(primary)}) {conflict}"
            )
            try:
                async with db.begin_nested():
                    await db.execute(statement, {"row": json.dumps(row)})
                restored += 1
            except Exception:
                # For example a row that points at a user who has since been removed.
                skipped += 1
        summary[table] = {"restored": restored, "skipped": skipped}
    await save_state(db, restored_from=name, restored_at=datetime.now(UTC).isoformat())
    return summary


def automatic_from_environment() -> bool:
    import os

    return os.environ.get("BOOK_UPGRADE_AUTOMATIC", "").strip().lower() in {"1", "true", "yes"}


async def accept_defaults(db, reason="automatic") -> dict[str, Any]:
    """Finish the upgrade without the wizard: take a backup and keep every new setting's default."""
    name = await snapshot(db, reason)
    return await save_state(
        db,
        release=CURRENT,
        backup=name,
        accepted_at=datetime.now(UTC).isoformat(),
    )

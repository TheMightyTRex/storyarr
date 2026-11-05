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
    # What the release brings, in the change types of the changelog (CHANGELOG.md), in this order.
    added: list[str] = []
    changed: list[str] = []
    deprecated: list[str] = []
    removed: list[str] = []
    fixed: list[str] = []
    security: list[str] = []
    # Notes with no change type; every release in RELEASES uses the lists above instead.
    highlights: list[str] = []
    # New settings worth a look after upgrading; each has built-in defaults already applied.
    review: list[UpgradeReviewItem] = []
    # Changes to the database structure, each with how to undo it. A settings backup is taken
    # before they run; take a full database backup too.
    database_changes: list[str] = []
    # Changes to configuration an administrator should know about before carrying on, such as a
    # renamed environment variable or a new required volume.
    configuration_changes: list[str] = []
    rollback: str | None = None

    def needs_attention(self) -> bool:
        """The wizard opens only for a choice to make or a change worth a backup and a way back."""
        return bool(self.review or self.database_changes or self.configuration_changes)


# Newest last. Add a release whenever an upgrade brings changes an existing install should hear
# about.
RELEASES = [
    UpgradeRelease(
        id="2026.10.30",
        title="Layout, light theme, bookshelves and smarter searching",
        added=[
            "A choice of layout: Classic, or Shelf with a slim icon menu and page menus in the "
            "header.",
            "A light theme by default, with Dark and Match device, plus display and accessibility "
            "settings: text size, a low-vision font, high contrast, reduced motion, underlined "
            "links and wider spacing.",
            "A bookshelf page for each followed author or series, with progress, statuses and a "
            "book drawer.",
            "Book types for follows, statuses for every followed book, and Add missing books.",
            "Delete library books, with a holding folder you can restore from and a retention "
            "period.",
            "Wanted books are searched again automatically.",
            "Audible search when matching library audiobooks, and a choice of Audible store.",
        ],
        changed=[
            "Activity in three tabs: Queue, Wanted and History, each with filters.",
            "Settings in six groups.",
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
        added=[
            "A loading bar under the header shows when a page is fetching data.",
        ],
        changed=[
            "Request counts take under a second instead of several minutes, so Activity and "
            "background work are much quicker.",
            "Leaving a page now stops the database work it started.",
        ],
        removed=[
            "The request count badge is no longer in the main menu.",
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
    UpgradeRelease(
        id="2026.10.31",
        title="Storyarr",
        added=[
            "The calendar has a Show menu: covers on the calendar, and which sources and authors "
            "appear.",
            "The bookshelf drawer can start a search now, and exclude a book from the follow.",
        ],
        changed=[
            "The app is now called Storyarr, with a new icon. It is a fork of Dewarr by logabell.",
            "Settings, Reading is now Settings, Sources.",
        ],
    ),
    UpgradeRelease(
        id="2026.10.31.2",
        title="Background work",
        added=[
            "Settings, System, Background work chooses how often scheduled jobs run: Normal, "
            "Relaxed, Light or Minimal. A slower pace saves CPU and database work on a small "
            "server.",
            "Normal keeps the usual schedule, so nothing changes until you choose another pace.",
        ],
        review=[
            UpgradeReviewItem(
                id="background-work",
                title="Background work",
                description="How often downloads, imports, lists and connections are checked.",
                link="/settings#background-work",
            ),
        ],
        database_changes=[
            "A new background_work_settings table holds the chosen pace.",
        ],
        rollback=(
            "To remove the table, run python -m app.downgrade 0083_operation_lookups in the "
            "Storyarr container before switching back to v0.4.1. Only this setting is removed."
        ),
    ),
    UpgradeRelease(
        id="2026.10.31.3",
        title="Series, Authors and Following layouts",
        added=[
            "My library Series and Authors, and Following, have two layouts: List and detail (the "
            "list beside the chosen series or author) and List (one aligned row each).",
            "List and detail is the default. The layout switch is next to the search, and your "
            "choice is saved with your account, so it follows you to every browser.",
        ],
        changed=[
            "Each series or author shows its covers, the author's picture beside the name, "
            "progress, statuses and actions in the same place every time.",
        ],
        database_changes=[
            "A new preferences column on users holds each person's own choices, starting with "
            "this layout.",
        ],
        rollback=(
            "To remove the column, run python -m app.downgrade storyarr_0084_background_work in "
            "the Storyarr container before switching back to v0.4.2. Only saved layout choices are "
            "removed."
        ),
    ),
    UpgradeRelease(
        id="2026.10.31.4",
        title="Sorting and releases Storyarr could not confirm",
        added=[
            "Series, Authors and Following can be sorted by Newest, Number of books, Date "
            "published, Author or A to Z, with Reverse order.",
            "Review release lets an administrator confirm a release whose name does not clearly "
            "match the book, or whose language is not stated, before downloading it.",
            "Requests has Review sources, which shows a request's sources in a dialog.",
        ],
        fixed=[
            "Series whose names differ only in punctuation, a leading The or a trailing Series "
            "are grouped together.",
        ],
        review=[
            UpgradeReviewItem(
                id="override-releases",
                title="Download unconfirmed releases",
                description="A new permission. Give it to people who are not administrators so "
                "they can choose these releases too.",
                link="/accounts",
            ),
        ],
    ),
    UpgradeRelease(
        id="2026.11.01",
        title="A new My library bookshelf",
        changed=[
            "My library shows smaller covers, so more books fit. Click a book and a summary "
            "slides out from the right with its series, formats, rating and description.",
            "Covers in My library no longer show Quick add. Getting a missing format is in the "
            "summary.",
            "Searching sources shows the loading bar under the header until the search finishes.",
        ],
        fixed=[
            "Downloads held after a library switched from hardlink to copy can be repaired and "
            "carry on.",
        ],
    ),
    UpgradeRelease(
        id="2026.11.01.2",
        title="Storyarr everywhere",
        changed=[
            "In the My library summary, the author and series open their pages, and selecting "
            "anywhere outside the summary closes it.",
            "Notifications are titled Storyarr notification, including the ones you already have.",
            "The sample compose files, the default database name and user, and the Docker guide "
            "use storyarr. Compose files moved from Dewarr set DB_NAME and DB_USER, so they need "
            "no change.",
        ],
        database_changes=[
            "The notification title is renamed in the database function that creates "
            "notifications and in notifications already stored.",
        ],
        rollback=(
            "To go back to v0.4.5, run python -m app.downgrade storyarr_0085_user_preferences in "
            "the Storyarr container first. Only the notification title changes back."
        ),
    ),
    UpgradeRelease(
        id="2026.11.01.3",
        title="Soulseek with an administrator key",
        fixed=[
            "Connecting slskd with a read-write API key now explains what to change: slskd only "
            "shares its download folder with an administrator key. Give the key the administrator "
            "role in slskd, then test the connection again.",
        ],
    ),
    UpgradeRelease(
        id="2026.11.01.4",
        title="Quieter upgrades",
        changed=[
            "A red dot on the version number, with Upgrade available, when a new version is out.",
            "The upgrade wizard opens only when a version has settings to choose or changes to "
            "your configuration or database. Every upgrade still saves a settings backup first.",
            "The way back is in Settings, System, Upgrades and backups, as Restore previous "
            "version.",
            "One typeface on every page: Atkinson Hyperlegible Next, designed for readers with "
            "low vision.",
            "Every slide-out panel has the same header: its name in bold and the close button.",
            "The Library tabs share one toolbar, and each can save its filters and order as your "
            "default, with your account. Reset them in Settings, General, Saved views.",
            "On phones, a menu button in the header opens every section and its pages.",
        ],
        removed=[
            "The Low-vision font switch is gone, because every page now uses the low-vision "
            "typeface.",
        ],
    ),
    UpgradeRelease(
        id="2026.11.02",
        title="Cover actions, shelf arrows and radio",
        added=[
            "Series pages have a new header: the series logo above the name in one solid colour, "
            "or the name set large when there is no logo, with the author, the number of books, "
            "the next book, a short description, how many you have and the first covers.",
            "Admins add a series logo for everyone with Change logo: cut it out of one of the "
            "covers, find it on Wikimedia Commons with its licence, or upload a file. Storyarr "
            "keeps a copy in its config folder. Radio show pages have Change logo too.",
            "Every cover has its actions: Details, Ebook, Audiobook, Add to a list and More, on "
            "the cover or beside it. Book rows have them at the end, and small covers have a More "
            "button.",
            "Radio, an early feature: add BBC radio shows by link or name, and browse shows, "
            "stations, series and episodes. Downloading episodes and filing them in "
            "Audiobookshelf come in a later version.",
        ],
        changed=[
            "A new header: each page's tabs have a row of their own, with icons. On phones, the "
            "menu holds search as well as every section.",
            "Every slide-out panel works the same way, and the accent colour is teal.",
            "Status chips have an icon and the same words on every page. Buttons and fields are "
            "44px high, and each Settings section has one bar to save or discard changes.",
            "Discover shelves have no scroll bars: the covers fade at each end, with an arrow "
            "when there are more books that way.",
            "Covers always line up, and covers on In my libraries are 10% larger.",
        ],
        review=[
            UpgradeReviewItem(
                id="cover-actions",
                title="Cover actions",
                description="Whether a book's buttons sit on the cover or beside it. Saved with "
                "your account.",
                link="/settings#display",
            ),
        ],
        database_changes=[
            "New tables for radio: stations, shows, series and episodes.",
            "A new table for series logos (storyarr_0088_series_logos), and where each radio "
            "show's logo came from. The logo files are kept in the config folder, in "
            "series-logos. Nothing else changes.",
        ],
        rollback=(
            "To go back to v0.4.8, run python -m app.downgrade storyarr_0086_notification_title "
            "in the Storyarr container first. Only the radio tables, the shows in them and the "
            "series logos are removed. The logo files stay in the config folder."
        ),
    ),
    UpgradeRelease(
        id="2026.11.02.2",
        title="A tidier, more consistent look",
        changed=[
            "Display and accessibility opens as a slide-out from the right, with Done and Reset "
            "at the bottom.",
            "The chosen option is teal everywhere, with a tick or a bar as well, and every "
            "control has the same focus ring.",
            "Dates, times and numbers are written the British way on every page.",
        ],
        fixed=[
            "Deleting a notification channel asks first, and Users and access fits on phones.",
        ],
    ),
    UpgradeRelease(
        id="2026.11.02.3",
        title="A radio library, and one look for series, authors and radio",
        added=[
            "Radio library: choose an Audiobookshelf podcast library for radio in Settings, "
            "Connections. Storyarr reads it every 15 minutes and shows the episodes it holds as "
            "in your library.",
            "Change logo has one editor for a cover, an uploaded file and a logo found online, "
            "with clean-up, an eraser and a paintbrush.",
        ],
        changed=[
            "My library, Series and Authors show the list beside the chosen one, with its own "
            "header. Radio shows follow the same design.",
            "Scroll bars are thin and square on every page.",
        ],
        review=[
            UpgradeReviewItem(
                id="radio-library",
                title="Radio library",
                description="The Audiobookshelf podcast library radio is filed into. Make a "
                "Podcasts library for radio in Audiobookshelf first.",
                link="/settings#libraries",
            ),
        ],
        database_changes=[
            "New tables for the radio library and the episodes in it "
            "(storyarr_0089_radio_library), and a link from each radio episode to its file. "
            "Nothing else changes.",
        ],
        rollback=(
            "To go back to v0.5.9, run python -m app.downgrade storyarr_0088_series_logos in the "
            "Storyarr container first. Only the radio library choice and its list of episode "
            "files are removed. No audio files are touched."
        ),
    ),
    UpgradeRelease(
        id="2026.11.05",
        title="Review the radio library, passwords and security fixes",
        added=[
            "Review the radio library in My library, Radio: add its shows, and link files that "
            "match no episode by hand.",
            "Change password in Settings, Sign-in, and Set new password for someone else in "
            "their account's details.",
            "Send feedback under the version number, sent as a GitHub issue.",
            "Discover, For you has Books and Radio tabs.",
        ],
        changed=[
            "Confirmations are toasts, and settings pages say when they were saved.",
            "Settings are activated and deactivated, and are active or inactive.",
        ],
        fixed=[
            "Dates are written the same way on every page, whatever your browser's language.",
        ],
        security=[
            "Fixes from the security check of 3 November 2026, each with a test. The release "
            "notes list them.",
        ],
        database_changes=[
            "Two new columns for the radio library review (storyarr_0090_radio_review): the "
            "radio library folder a show was added from, and whether an episode's file was "
            "linked by hand.",
        ],
        rollback=(
            "To go back to v0.6.0, run python -m app.downgrade storyarr_0089_radio_library in the "
            "Storyarr container first. Only the links chosen by hand in the review are lost. No "
            "audio files are touched."
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


def needs_wizard(release: str | None) -> bool:
    """Releases with only news finish on their own; their notes are under the version number."""
    return any(item.needs_attention() for item in since(release))


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
            # Names come from upgrade_backups.TABLES.
            rows = await db.scalars(
                text(f'SELECT row_to_json(t) FROM "{name}" t')  # nosec B608
            )
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
                "DO UPDATE SET "
                + ", ".join(
                    # Column names come from the database's own catalogue.
                    f'"{c}" = EXCLUDED."{c}"'  # nosec B608
                    for c in updates
                )
                if updates
                else "DO NOTHING"
            )
            # The names come from TABLES and the database's own catalogue; values are bound.
            statement = text(
                f'INSERT INTO "{table}" ({listed}) '  # nosec B608
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

"""Which Audible store catalog lookups use: the metadata setting, else BOOK_AUDIBLE_REGION."""

import time

from app.config import get_settings

STORES = {
    "us": "United States",
    "uk": "United Kingdom",
    "au": "Australia",
    "ca": "Canada",
    "de": "Germany",
    "es": "Spain",
    "fr": "France",
    "in": "India",
    "it": "Italy",
    "jp": "Japan",
}
# Each process keeps the saved store in memory and checks the database at most this often, so
# synchronous callers can read it. Saving the setting updates this process at once.
REFRESH_SECONDS = 60

_saved: str | None = None
_checked = float("-inf")


def region() -> str:
    return _saved or get_settings().audible_region


def remember(value: str | None) -> None:
    global _saved, _checked
    _saved = value if value in STORES else None
    _checked = time.monotonic()


async def refresh(*, force=False) -> str:
    if not force and time.monotonic() - _checked < REFRESH_SECONDS:
        return region()
    from app.db.models import MetadataSettings
    from app.db.session import session_factory

    async with session_factory()() as db:
        row = await db.get(MetadataSettings, 1)
        remember((row.preferences or {}).get("audible_region") if row else None)
    return region()

# ruff: noqa: F401, F811
"""Exercise a real inspected MAM audiobook whose tags include a catalog series label."""

from datetime import UTC, datetime
from uuid import UUID

import pytest

from app.db.models import CatalogSeries, SeriesMembership, WorkMetadataSource
from tests.abs_import_fixture import ScanningBackend
from tests.integration import test_single_file_acquisition as single
from tests.integration.test_single_file_acquisition import (
    destination_route,
    ready_route,
    resolution_provider,
    review_account,
)

pytestmark = pytest.mark.integration


@pytest.mark.parametrize(
    "file_title,identified",
    [
        ("First Harbor (Harbor #1) (Unabridged)", False),
        ("Harbor, Book 1", False),
        ("First Harbor (Harbor #1)", True),
    ],
)
async def test_catalog_series_labels_import_with_and_without_an_identified_edition(
    client,
    admin,
    database,
    ready_route,
    monkeypatch,
    review_account,
    resolution_provider,
    file_title,
    identified,
):
    original_scan = ScanningBackend.scan

    def scan_with_series(backend):
        original_scan(backend)
        for item in backend.items.values():
            item["media"]["metadata"]["series"] = [{"name": "The Harbor Saga", "sequence": "1"}]

    monkeypatch.setattr(ScanningBackend, "scan", scan_with_series)
    original_audio = single.audio
    original_prepare = single.prepare_audio_route

    def tagged_audio(path, **kwargs):
        kwargs["title"] = file_title
        if identified:
            kwargs["tags"]["isbn"] = "9781234567897"
        return original_audio(path, **kwargs)

    async def prepare(*args, **kwargs):
        result = await original_prepare(*args, **kwargs)
        async with database() as db, db.begin():
            series = CatalogSeries(
                owner_id=UUID(admin["id"]),
                provider="hardcover",
                external_id="harbor",
                name="The Harbor Saga",
                snapshot={"count": 1},
                fetched_at=datetime.now(UTC),
            )
            db.add(series)
            await db.flush()
            db.add(
                SeriesMembership(
                    series_id=series.id,
                    external_id="1",
                    work_id=UUID(args[3]),
                    snapshot={"position": "1", "release_date": "2000-01-01"},
                )
            )
            db.add(
                WorkMetadataSource(
                    work_id=UUID(args[3]),
                    provider="hardcover",
                    external_id="series-file-test",
                    accepted=True,
                    fetched_at=datetime.now(UTC),
                    snapshot={
                        "title": "First Harbor",
                        "authors": ["Alex Morgan"],
                        "series": [{"name": "The Harbor Saga", "position": "1"}],
                    },
                )
            )
        return result

    monkeypatch.setattr(single, "audio", tagged_audio)
    monkeypatch.setattr(single, "prepare_audio_route", prepare)
    await single.test_single_epub_download_to_confirmed_library_keeps_neighbor_private(
        client,
        admin,
        database,
        ready_route,
        monkeypatch,
        "",
        "automatic-audio" if identified else "automatic-linked-audio",
        review_account,
        resolution_provider,
    )

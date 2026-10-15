# ruff: noqa: F401, F811
"""Review corroborated series titles through the API and real file publication."""

import base64
import hashlib
from datetime import UTC, datetime, timedelta
from uuid import UUID

import libtorrent as lt
import pytest
from sqlalchemy import func, select

from app.adapters.mam import release
from app.adapters.torrent_descriptor import inspect_torrent
from app.config import get_settings
from app.db.models import (
    AcquisitionSelection,
    CatalogSeries,
    DownloadAttempt,
    DownloadFulfillment,
    ImportEntry,
    ImportRun,
    Integration,
    SeriesMembership,
    SourceArtifact,
    SourceConnection,
    Version,
    Work,
    WorkMetadataSource,
)
from app.domain import download_attempts
from app.jobs.queue import get_queue
from app.security import encrypt_secrets
from tests.integration.test_acquisition import body
from tests.integration.test_acquisition import request as request_book
from tests.integration.test_acquisition_selections import prepare
from tests.integration.test_download_attempts import Client, start
from tests.integration.test_single_file_acquisition import (
    destination_route,
    prepare_audio_route,
    ready_route,
)
from tests.mam_fixture import release_row
from tests.media_fixtures import audio

pytestmark = pytest.mark.integration


@pytest.fixture
async def series_download(client, admin, database, ready_route, monkeypatch, request):
    options = getattr(request, "param", {})
    route = ready_route
    backend = route["scan_backend"]
    original_scan = backend.scan

    def scan_with_series():
        original_scan()
        for item in backend.items.values():
            item["media"]["metadata"]["series"] = [{"name": "The Harbor Saga", "sequence": "1"}]

    monkeypatch.setattr(backend, "scan", scan_with_series)
    work_id = UUID(route["plan"]["document"]["groups"][0]["work_id"])
    title = "First & Last Harbor" if options.get("connector") else "First Harbor"
    file_title = options.get("title", "Harbor, Book 1")
    source = route["source"] / "selected.mp3"
    audio(
        source,
        title=file_title,
        author=options.get("author", "Alex Morgan"),
        track=options.get("track", "1/1"),
        tags={"language": "en", **({"isbn": "9781234567897"} if options.get("identified") else {})},
    )
    catalog = await prepare_audio_route(client, database, route, str(work_id), source)
    original = source.read_bytes()
    raw = lt.bencode(
        {
            b"info": {
                b"name": source.name.encode(),
                b"length": len(original),
                b"piece length": 16384,
                b"pieces": b"".join(
                    hashlib.sha1(original[n : n + 16384]).digest()
                    for n in range(0, len(original), 16384)
                ),
            }
        }
    )
    descriptor = await inspect_torrent(raw)
    async with database() as db, db.begin():
        (await db.get(Work, work_id)).title = title
        (await db.get(Version, catalog["version"])).title = title
        metadata = await db.get(WorkMetadataSource, catalog["source"])
        metadata.snapshot = {
            **metadata.snapshot,
            "title": title,
            "series": [{"name": "The Harbor Saga", "position": "1"}],
        }
        series = CatalogSeries(
            owner_id=UUID(admin["id"]),
            provider="hardcover",
            external_id="harbor",
            name="The Harbor Saga",
            snapshot={"count": 1},
            fetched_at=datetime.now(UTC),
        )
        downloader = Integration(
            kind="qbittorrent",
            name="Series fixture",
            base_url="http://qbit.test",
            encrypted_secrets=encrypt_secrets({"username": "fixture", "password": "fixture"}),
            credential_generation=1,
            status="connected",
            config={
                "save_path": "/downloads",
                "category": "book-search",
                "mappings": [
                    {
                        "download_root": "/downloads",
                        "source_key": "fixture",
                        "source_path": str(route["source"]),
                    }
                ],
            },
        )
        db.add(
            SourceConnection(
                key="mam",
                base_url="https://mam.test",
                encrypted_secrets=encrypt_secrets({"mam_id": "fixture"}),
            )
        )
        await db.flush()
        artifact = SourceArtifact(
            owner_id=UUID(admin["id"]),
            source_key="mam",
            source_id="502",
            source_generation=1,
            sha256=descriptor.artifact_sha256,
            descriptor=descriptor.model_dump(mode="json"),
            encrypted_content=encrypt_secrets({"torrent": base64.b64encode(raw).decode()}),
            release_snapshot=release(
                release_row(
                    id=502,
                    title=title,
                    main_cat=13,
                    filetype="MP3",
                    narrator_info='{"1":"Jordan Lee"}',
                ),
                datetime.now(UTC),
            ).model_dump(mode="json"),
        )
        db.add_all([series, downloader, artifact])
        await db.flush()
        db.add(
            SeriesMembership(
                series_id=series.id,
                external_id="1",
                work_id=work_id,
                snapshot={"position": "1", "release_date": "2000-01-01"},
            )
        )
    wanted = await request_book(
        client, body({"work": work_id}, "audio", audio_library_id=route["library_id"])
    )
    prepared = await prepare(
        client,
        {
            "intent_id": wanted["request"]["id"],
            "slot": "audio",
            "artifact_id": str(artifact.id),
            "downloader_id": str(downloader.id),
            "downloader_generation": 1,
            "destination_id": route["destination"]["id"],
            "destination_revision": route["destination"]["revision"],
            "confirmed_work_id": str(work_id),
        },
    )
    assert prepared.status_code == 201, prepared.text
    qbit = Client(database, descriptor.model_dump(mode="json"))
    qbit.complete = True
    monkeypatch.setattr(download_attempts, "QbitClient", lambda *args: qbit)
    monkeypatch.setattr(get_settings(), "download_dispatch_enabled", True)
    started = await start(client, prepared.json())
    assert started.status_code == 202, started.text
    await get_queue().run_worker_async(wait=False, concurrency=1)
    async with database() as db:
        attempt = await db.get(DownloadAttempt, UUID(started.json()["id"]))
        assert attempt.state == "complete" and attempt.inspection_id
    return {
        "route": route,
        "work": work_id,
        "version": catalog["version"],
        "series": series.id,
        "selection": UUID(prepared.json()["id"]),
        "source": source,
        "original": original,
        "endpoint": f"/api/organization/inspections/{attempt.inspection_id}",
    }


async def review(client, download):
    endpoint = download["endpoint"]
    inspection = (await client.get(endpoint)).json()
    grouping = (await client.get(endpoint + "/grouping")).json()
    matches = await client.get(
        endpoint + "/matches", params={"grouping_revision": grouping["revision"]}
    )
    assert matches.status_code == 200, matches.text
    return inspection, grouping, matches.json()["items"][0]


@pytest.mark.parametrize(
    "series_download",
    [
        {},
        {"title": "Harbor, Book I"},
        {"identified": True},
        {"title": "First and Last Harbor (Harbor #1)", "connector": True, "identified": True},
    ],
    indirect=True,
)
async def test_series_review_confirms_one_import_and_replays_without_republication(
    client,
    database,
    series_download,
):
    download = series_download
    inspection, grouping, match = await review(client, download)
    assert inspection["download"]["file_conflicts"] == []
    assert match["evidence"]["titles"]
    version_id = match["selected_version_id"]
    if not version_id:
        attached = await client.post(
            download["endpoint"] + "/editions",
            json={
                "work_id": str(download["work"]),
                "group_key": match["group_key"],
                "grouping_revision": grouping["revision"],
            },
        )
        assert attached.status_code == 200, attached.text
        version_id = attached.json()["version_id"]
        assert attached.json()["title"] == "First Harbor"
    else:
        assert match["status"] == "matched" and match["candidates"][0]["conflicts"] == []
    settings = (await client.get("/api/organization/settings")).json()
    plan = await client.post(
        download["endpoint"] + "/plans",
        json={
            "inspection_revision": inspection["snapshot"]["revision"],
            "grouping_revision": grouping["revision"],
            "profile_revision": settings["revision"],
            "destinations": {"audio": download["route"]["destination"]["id"]},
            "selections": [
                {
                    "group_key": match["group_key"],
                    "work_id": str(download["work"]),
                    "version_id": version_id,
                    "full_content": True,
                    **(
                        {"match_revision": match["revision"]}
                        if match["status"] == "matched"
                        else {}
                    ),
                }
            ],
        },
    )
    assert plan.status_code == 201, plan.text
    url = f"/api/organization/plans/{plan.json()['id']}/imports"
    payload = {
        "plan_revision": plan.json()["revision"],
        "destinations": {
            "audio": {
                "id": download["route"]["destination"]["id"],
                "revision": download["route"]["destination"]["revision"],
            }
        },
    }
    first = await client.post(
        url, json=payload, headers={"Idempotency-Key": "series-review-import"}
    )
    assert first.status_code == 202, first.text
    await get_queue().run_worker_async(wait=False, concurrency=1)
    replay = await client.post(
        url, json=payload, headers={"Idempotency-Key": "series-review-import"}
    )
    assert replay.status_code == 202 and replay.json()["id"] == first.json()["id"]
    assert replay.json()["entries"][0]["state"] == "confirmed", replay.text
    assert (await client.get(download["endpoint"])).json()["download"]["state"] == "complete"
    async with database() as db:
        assert await db.scalar(select(func.count()).select_from(ImportRun)) == 1
        assert await db.scalar(select(func.count()).select_from(DownloadFulfillment)) == 1
    output = list(download["route"]["target"].rglob("*.mp3"))
    assert len(output) == 1
    assert output[0].read_bytes() == download["source"].read_bytes() == download["original"]
    assert output[0].stat().st_ino == download["source"].stat().st_ino


@pytest.mark.parametrize(
    "fault",
    [
        "ambiguous",
        "multiple-positions",
        "stale",
        "unpublished",
        "compilation",
        "incomplete-catalog",
        "exact-edition",
        "collection",
        "wrong-source",
        "manifest",
        "conflicting-metadata",
    ],
)
async def test_uncorroborated_series_labels_stay_held_in_review_and_confirmation(
    client,
    database,
    series_download,
    fault,
):
    download = series_download
    async with database() as db, db.begin():
        series = await db.get(CatalogSeries, download["series"])
        member = await db.scalar(
            select(SeriesMembership).where(SeriesMembership.series_id == series.id)
        )
        selection = await db.get(AcquisitionSelection, download["selection"])
        if fault == "conflicting-metadata":
            source = await db.scalar(
                select(WorkMetadataSource).where(WorkMetadataSource.work_id == download["work"])
            )
            source.snapshot = {
                **source.snapshot,
                "series": [{"name": "The Harbor Saga", "position": "2"}],
            }
        elif fault in {"ambiguous", "multiple-positions"}:
            work_id = download["work"]
            if fault == "ambiguous":
                other = Work(title="Another Harbor", authors=["Alex Morgan"])
                db.add(other)
                await db.flush()
                work_id = other.id
            db.add(
                SeriesMembership(
                    series_id=series.id,
                    external_id="2",
                    work_id=work_id,
                    snapshot={
                        "position": "1.0" if fault == "ambiguous" else "2",
                        "release_date": "2000-01-01",
                    },
                )
            )
            series.snapshot = {"count": 2}
        elif fault == "stale":
            series.fetched_at = datetime.now(UTC) - timedelta(days=2)
        elif fault in {"unpublished", "compilation"}:
            member.snapshot = {
                **member.snapshot,
                **(
                    {"release_date": "2999-01-01"}
                    if fault == "unpublished"
                    else {"compilation": True}
                ),
            }
        elif fault == "incomplete-catalog":
            series.snapshot = {"count": 2}
        elif fault == "exact-edition":
            selection.frozen = {
                **selection.frozen,
                "requirements": {
                    **selection.frozen["requirements"],
                    "version_id": str(download["version"]),
                },
            }
        elif fault in {"collection", "wrong-source"}:
            selection.frozen = {
                **selection.frozen,
                "release": {
                    **selection.frozen["release"],
                    "title": "Harbor Collection" if fault == "collection" else "Different Book",
                },
            }
        elif fault == "manifest":
            descriptor = selection.frozen["descriptor"]
            selection.frozen = {
                **selection.frozen,
                "descriptor": {
                    **descriptor,
                    "files": [{**descriptor["files"][0], "size_bytes": 1}],
                },
            }
    inspection, grouping, match = await review(client, download)
    assert inspection["download"]["file_conflicts"] == ["The files name a different book"]
    assert match["status"] != "matched" and match["selected_version_id"] is None
    attached = await client.post(
        download["endpoint"] + "/editions",
        json={
            "work_id": str(download["work"]),
            "group_key": match["group_key"],
            "grouping_revision": grouping["revision"],
        },
    )
    assert attached.status_code == 409, attached.text
    assert attached.json()["detail"] == "The files name a different book"
    settings = (await client.get("/api/organization/settings")).json()
    forced = await client.post(
        download["endpoint"] + "/plans",
        json={
            "inspection_revision": inspection["snapshot"]["revision"],
            "grouping_revision": grouping["revision"],
            "profile_revision": settings["revision"],
            "selections": [
                {
                    "group_key": match["group_key"],
                    "work_id": str(download["work"]),
                    "version_id": str(download["version"]),
                    "full_content": True,
                }
            ],
        },
    )
    assert (
        forced.status_code == 409 and forced.json()["detail"] == "The files name a different book"
    )
    async with database() as db:
        assert await db.scalar(select(func.count()).select_from(ImportEntry)) == 0
    assert not list(download["route"]["target"].rglob("*.mp3"))


@pytest.mark.parametrize(
    "series_download",
    [
        {"title": "Harbor, Book 2"},
        {"title": "Harbor, Book 1.5"},
        {"title": "Other Series, Book 1"},
        {"title": "Harbor, Books 1-3"},
        {"author": "Other Writer"},
        {"track": "1/2"},
    ],
    indirect=True,
)
async def test_wrong_or_partial_file_identity_cannot_be_confirmed(client, series_download):
    inspection, grouping, match = await review(client, series_download)
    assert "The files name a different book" in inspection["download"]["file_conflicts"]
    attached = await client.post(
        series_download["endpoint"] + "/editions",
        json={
            "work_id": str(series_download["work"]),
            "group_key": match["group_key"],
            "grouping_revision": grouping["revision"],
        },
    )
    assert (
        attached.status_code == 409
        and attached.json()["detail"] == "The files name a different book"
    )

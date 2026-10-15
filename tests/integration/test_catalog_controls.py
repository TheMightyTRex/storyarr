"""Provider responses through follow synchronization and catalog edition views."""

from copy import deepcopy
from uuid import UUID

import httpx
import pytest
from sqlalchemy import select

from app.adapters.catalog_providers import Hardcover
from app.db.models import CatalogAccount, ListObservation, ListSubscription, Operation
from app.domain.catalog_network import CatalogGateway
from app.security import encrypt_secrets
from tests.integration.test_follows import observe
from tests.unit.test_hardcover_follows import response

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("kind", ["author", "series"])
@pytest.mark.parametrize("language", [None, "en"])
async def test_current_schema_follows_publish_verified_language_filtered_pages(
    client, database, admin, monkeypatch, kind, language
):
    async with database() as db, db.begin():
        db.add(
            CatalogAccount(
                user_id=UUID(admin["id"]),
                enabled=True,
                generation=1,
                encrypted_token=encrypt_secrets({"token": "fixture-only"}),
            )
        )
    cursors = []

    async def request(self, method, path, *, json):
        # Replay the reported schema boundary, including the old query's failure.
        if "editions_aggregate" in json["query"]:
            return {"errors": [{"extensions": {"code": "validation-failed"}}]}
        variables = json["variables"]
        assert variables["language"] == (language or "")
        cursor = variables["after"]
        cursors.append(cursor)
        data = response()
        data["books_aggregate"]["aggregate"]["count"] = 3
        template = data["books"][0]
        data["books"] = []
        for key in [42, 43, 44]:
            if key <= cursor:
                continue
            row = deepcopy(template)
            row.update(
                id=key,
                title=f"Book {key}",
                release_date="2020-01-01",
                matching_editions=[{"id": key * 10}] if key != 43 else [],
            )
            data["books"].append(row)
        data["books"] = data["books"][:2]
        return {"data": data}

    monkeypatch.setattr(CatalogGateway, "request", request)
    created = await client.post(
        "/api/following",
        json={
            "source_kind": kind,
            "external_id": 9,
            "name": "Writer",
            "filters": {"language": language},
        },
    )
    assert created.status_code == 201, created.text
    follow = created.json()
    await observe(client, database, follow, initial=True)
    assert cursors == [0, 43, 44, 0, 43, 44]
    async with database() as db:
        subscription = await db.get(ListSubscription, UUID(follow["subscription"]["id"]))
        operation = await db.get(Operation, subscription.operation_id)
        assert operation.status == "completed", operation.message
        observations = (
            await db.scalars(
                select(ListObservation)
                .where(ListObservation.subscription_id == subscription.id)
                .order_by(ListObservation.external_id)
            )
        ).all()
        assert [row.external_id for row in observations] == ["42", "43", "44"]
        assert [row.snapshot["filter_reason"] for row in observations] == [
            None,
            "No matching language edition" if language else None,
            None,
        ]
    listing = (await client.get(f"/api/lists/{follow['list_id']}")).json()
    assert sorted(row["title"] for row in listing["items"]) == (
        ["Book 42", "Book 44"] if language else ["Book 42", "Book 43", "Book 44"]
    )


async def test_reported_audiobook_survives_identifier_cache_import_and_format_paging(
    client, database, admin, monkeypatch
):
    from app.api import metadata

    calls = []
    book = {
        "id": 602482,
        "title": "Tress of the Emerald Sea",
        "canonical_id": None,
        "cached_contributors": [{"author": {"name": "Brandon Sanderson"}}],
    }
    # Observed on Hardcover's public edition page on 2026-10-15. The transport
    # uses the GraphQL field names consumed by the adapter (the page uses camelCase).
    audio = {
        "id": 31639613,
        "book_id": 602482,
        "title": book["title"],
        "isbn_13": "9798890553157",
        "asin": "B0D9PHGVV7",
        "reading_format": {"format": "Listened"},
        "language": None,
        "publisher": {"name": "Graphic Audio LLC"},
    }
    editions = [
        {
            "id": key,
            "book_id": 602482,
            "title": f"Print {key}",
            "reading_format": {"format": "Physical"},
        }
        for key in range(1, 25)
    ] + [audio]

    def respond(request):
        import json

        payload = json.loads(request.content)
        calls.append(payload)
        if "LibraryIdentifierMatch" in payload["query"]:
            return httpx.Response(200, json={"data": {"editions": [{**audio, "book": book}]}})
        assert payload["variables"] == {"id": 602482, "offset": 0}
        return httpx.Response(200, json={"data": {"books": [book], "editions": editions}})

    class Gateway(CatalogGateway):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs, transport=httpx.MockTransport(respond))

        async def reserve(self):
            pass

    monkeypatch.setattr(metadata, "CatalogGateway", Gateway)
    async with database() as db, db.begin():
        db.add(
            CatalogAccount(
                user_id=UUID(admin["id"]),
                enabled=True,
                generation=1,
                encrypted_token=encrypt_secrets({"token": "fixture-only"}),
            )
        )
    async with Gateway("hardcover", "identifier-test", "fixture-only") as gateway:
        identified = await Hardcover(gateway.request).identifier_search([("isbn", "9798890553157")])
    assert [(b.external_id, b.canonical_id) for b in identified.items] == [("602482", None)]
    assert identified.items[0].editions[0].medium == "audio"
    preview = await client.get("/api/metadata/books/hardcover/602482")
    assert preview.status_code == 200, preview.text
    result = preview.json()
    assert result["stale"] is False and result["warning"] is None
    assert result["book"]["editions"][-1]["external_id"] == "31639613"
    assert result["book"]["editions"][-1]["medium"] == "audio"
    imported = await client.post("/api/metadata/books/hardcover/602482/import")
    assert imported.status_code == 200, imported.text
    assert len(calls) == 2  # Import reuses the cached raw response and the same mapper.
    url = f"/api/metadata/works/{imported.json()['id']}"
    all_editions = (await client.get(url, params={"limit": 1, "scope": "display"})).json()
    assert all_editions["versions_total"] == 25
    filtered = (
        await client.get(url, params={"medium": "audio", "limit": 1, "scope": "display"})
    ).json()
    assert filtered["versions_total"] == 1
    assert [(v["medium"], v["identifiers"]["isbn_13"]) for v in filtered["versions"]] == [
        ("audio", "9798890553157")
    ]
    print_page = (
        await client.get(url, params={"medium": "print", "limit": 1, "offset": 23})
    ).json()
    assert print_page["versions_total"] == 24 and print_page["versions"][0]["medium"] == "print"
    empty = (await client.get(url, params={"medium": "ebook"})).json()
    assert empty["versions_total"] == 0 and empty["versions"] == []
    assert (await client.get(url, params={"medium": "invalid"})).status_code == 422

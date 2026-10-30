# ruff: noqa: F811
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.adapters.contracts import AdapterError, FailureKind
from app.db.models import ImportDestination, ImportStorageSettings, LibraryAsset
from app.domain import library_delete
from tests.integration.test_follows import bind_work, follow_fixture, observe, record  # noqa: F401
from tests.integration.test_library_discovery import add

pytestmark = pytest.mark.integration


class FakeShelf:
    def __init__(self):
        self.path = "/audiobooks/Writer/Book"
        self.calls = []
        self.fail = False

    def __call__(self, base_url, token):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *error):
        return False

    async def item(self, item_id):
        return SimpleNamespace(path=self.path)

    async def delete_item(self, item_id, *, delete_files):
        if self.fail:
            raise AdapterError(FailureKind.PERMISSION, "Not allowed to delete")
        self.calls.append((item_id, delete_files))


@pytest.fixture
async def shelf(database, tmp_path, monkeypatch):
    fake = FakeShelf()
    monkeypatch.setattr(library_delete, "Audiobookshelf", fake)
    monkeypatch.setattr(library_delete, "library_token", lambda secrets: "token")
    book = tmp_path / "Writer/Book"
    book.mkdir(parents=True)
    (book / "part 1.mp3").write_bytes(b"audio")
    async with database() as db, db.begin():
        work, library, asset = await add(db, "Book", medium="audio")
        db.add(
            ImportDestination(
                root_key="library-audio",
                library_id=library.id,
                medium="audio",
                backend_path="/audiobooks",
                mode="copy",
            )
        )
        db.add(
            ImportStorageSettings(id=1, destinations={"library-audio": str(tmp_path)}, sources={})
        )
        asset_id, work_id = str(asset.id), str(work.id)
    return SimpleNamespace(fake=fake, root=tmp_path, book=book, asset=asset_id, work=work_id)


async def state(database, asset_id):
    async with database() as db:
        return (await db.get(LibraryAsset, asset_id)).state


async def test_delete_holds_files_and_removes_the_item_from_audiobookshelf(
    client, admin, database, shelf
):
    response = await client.post(f"/api/library/assets/{shelf.asset}/delete", json={})
    assert response.status_code == 200, response.text
    held = shelf.root / ".deleted-books" / datetime.now(UTC).date().isoformat() / "Writer/Book"
    assert response.json()["held_path"] == str(held)
    assert (held / "part 1.mp3").read_bytes() == b"audio"
    assert not shelf.book.exists()
    assert shelf.fake.calls == [("one", False)]
    assert await state(database, shelf.asset) == "intentionally-removed"
    again = await client.post(f"/api/library/assets/{shelf.asset}/delete", json={})
    assert again.status_code == 404


async def test_refused_delete_puts_the_files_back(client, admin, database, shelf):
    shelf.fake.fail = True
    response = await client.post(f"/api/library/assets/{shelf.asset}/delete", json={})
    assert response.status_code == 502
    assert (shelf.book / "part 1.mp3").exists()
    assert not (shelf.root / ".deleted-books").exists() or not any(
        (shelf.root / ".deleted-books").rglob("*.mp3")
    )
    assert await state(database, shelf.asset) == "present"


async def test_permanent_delete_leaves_file_removal_to_audiobookshelf(
    client, admin, database, shelf
):
    response = await client.post(
        f"/api/library/assets/{shelf.asset}/delete", json={"files": "delete"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["held_path"] is None
    assert shelf.fake.calls == [("one", True)]


@pytest.mark.parametrize("path", ["/elsewhere/Book", "/audiobooks", "/audiobooks/.deleted-books/x"])
async def test_folders_outside_a_single_library_book_are_refused(
    client, admin, database, shelf, path
):
    shelf.fake.path = path
    response = await client.post(f"/api/library/assets/{shelf.asset}/delete", json={})
    assert response.status_code == 409
    assert shelf.fake.calls == [] and shelf.book.exists()


async def test_retention_setting_and_purge_only_remove_old_dated_folders(
    client, admin, database, shelf, monkeypatch
):
    view = (await client.get("/api/automation/settings/installation")).json()
    assert view["settings"]["deleted_retention_days"] == 30 and view["generation"] == 0
    saved = await client.put(
        "/api/automation/settings/installation",
        json={"deleted_retention_days": 7, "expected_generation": 0},
    )
    assert saved.status_code == 200 and saved.json()["generation"] == 1
    holding = shelf.root / ".deleted-books"
    today = date.today()
    old = holding / (today - timedelta(days=8)).isoformat() / "Old"
    recent = holding / (today - timedelta(days=6)).isoformat() / "Recent"
    other = holding / "kept by hand"
    for folder in (old, recent, other):
        folder.mkdir(parents=True)
    await library_delete.purge_held()
    assert not old.parent.exists() and recent.exists() and other.exists()
    await client.put(
        "/api/automation/settings/installation",
        json={"deleted_retention_days": 0, "expected_generation": 1},
    )
    (holding / "2000-01-01").mkdir()
    await library_delete.purge_held()
    assert (holding / "2000-01-01").exists()


async def test_forgetting_a_deleted_book_excludes_it_from_follows(
    client, admin, database, shelf, follow_fixture
):
    remote, follow = follow_fixture
    remote.records = [record(10, "Book"), record(20, "Other book")]
    await bind_work(database, admin, 10, shelf.work)
    await observe(client, database, follow, initial=True)
    response = await client.post(f"/api/library/assets/{shelf.asset}/delete", json={})
    assert response.status_code == 200, response.text
    assert response.json()["excluded_from_lists"] == 1
    books = (await client.get(f"/api/following/{follow['list_id']}/books")).json()
    status = {book["title"]: book["status"] for book in books["items"]}
    assert status["Book"]["detail"] == "Excluded by you"
    assert status["Other book"]["kind"] == "not_requested"

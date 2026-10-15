from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.importing import linked_download
from app.importing.match_evidence import MatchEvidence


@pytest.mark.parametrize(
    "title,accepted",
    [
        ("Angels and Demons (Robert Langdon, Book 1)", True),
        ("Angels and Demons: Robert Langdon, Book 1", True),
        ("Angels and Demons (Robert Langdon, Book 1.5)", False),
        ("Angels and Demons: A Study Guide (Robert Langdon, Book 1)", False),
        ("Angels and Demons Sequel (Robert Langdon, Book 1)", False),
        ("Angels and Demons (Robert Langdon, Book 1", False),
    ],
)
def test_series_annotation_preserves_complete_connector_equivalent_title(title, accepted):
    work = SimpleNamespace(
        title="Angels & Demons", authors=["Dan Brown"], language="en", metadata_fields={}
    )
    assert (
        linked_download.agrees_with_request(
            work,
            {"source": "mam", "title": "Angels & Demons", "authors": ["Dan Brown"]},
            MatchEvidence(titles=[title], authors=[["dan brown"]]),
            series=[{"name": "Robert Langdon", "position": "1"}],
        )
        is accepted
    )


@pytest.mark.parametrize(
    "title,position,author,accepted",
    [
        ("Midnight Sun (Twilight #5) (Unabridged)", "5", "Stephenie Meyer", True),
        ("Midnight Sun: The Twilight Saga, Book 5 (Unabridged)", "5", "Stephenie Meyer", True),
        ("Midnight Sun (The Twilight Saga, Book 5)", "5", "Stephenie Meyer", True),
        ("Midnight Sun (Twilight #4)", "5", "Stephenie Meyer", False),
        ("Midnight Sun (Twilight #5.5)", "5", "Stephenie Meyer", False),
        ("Midnight Sun (Twilight #1-5)", "5", "Stephenie Meyer", False),
        ("Midnight Sun (Other Series #5)", "5", "Stephenie Meyer", False),
        ("Midnight Sun (Twilight #5)", "", "Stephenie Meyer", False),
        ("Midnight Sun (Twilight #5)", "5", "Other Writer", False),
        ("Midnight Sun: Study Guide (Twilight #5)", "5", "Stephenie Meyer", False),
    ],
)
async def test_mam_file_series_labels_use_catalog_position(
    monkeypatch, title, position, author, accepted
):
    work = SimpleNamespace(
        id=uuid4(),
        title="Midnight Sun",
        authors=["Stephenie Meyer"],
        language="en",
        metadata_fields={},
    )
    facts = MatchEvidence(titles=[title.lower()], authors=[[author.lower()]])
    selection = SimpleNamespace(
        owner_id=uuid4(),
        frozen={
            "origin_work_id": str(work.id),
            "requirements": {"medium": "audio"},
            "release": {"source": "mam", "title": "Midnight Sun", "authors": work.authors},
        },
    )
    version = SimpleNamespace(id=uuid4())
    attach = AsyncMock(return_value=(version, True))
    monkeypatch.setattr(linked_download, "canonical_work", AsyncMock(return_value=work))
    monkeypatch.setattr(
        linked_download,
        "identity",
        AsyncMock(return_value={"series": [{"name": "The Twilight Saga", "position": position}]}),
    )
    monkeypatch.setattr(linked_download, "group_evidence", lambda *args: facts)
    monkeypatch.setattr(linked_download, "attach_file_edition", attach)
    found = await linked_download.linked_version(
        AsyncMock(),
        None,
        selection,
        SimpleNamespace(id=uuid4(), snapshot={}),
        SimpleNamespace(key="audio", medium="audio"),
        "revision",
        match=SimpleNamespace(candidates=[]),
    )
    assert found is (version if accepted else None)
    assert attach.await_count == int(accepted)

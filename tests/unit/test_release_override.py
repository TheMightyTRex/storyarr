from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.domain.automatic_eligibility import collection_candidate
from app.domain.permissions import MEMBER, OVERRIDE_RELEASES
from app.domain.release_override import require_confirmation
from app.domain.release_profiles import co_author_credits, indexer_title_authors

WORK = {"title": "The Long Earth", "authors": ["Terry Pratchett", "Stephen Baxter"]}


def release(title, source="prowlarr"):
    return SimpleNamespace(
        source=source,
        title=title,
        raw_title=title,
        authors=[],
        tags=[],
        details={},
        coverage=[],
        series=[],
    )


def test_every_co_author_together_is_one_credit():
    credits = co_author_credits(WORK["authors"])
    assert "terry pratchett stephen baxter" in credits
    assert "stephen baxter and terry pratchett" in credits
    assert co_author_credits(["Terry Pratchett"]) == set()


@pytest.mark.parametrize(
    "title",
    [
        "Terry Pratchett  Stephen Baxter - The Long Earth 2012 MP3",
        "Terry Pratchett & Stephen Baxter - The Long Earth",
        "The Long Earth - Terry Pratchett & Stephen Baxter",
    ],
)
def test_release_names_crediting_both_authors_match(title):
    assert indexer_title_authors(release(title), WORK) == ["Stephen Baxter", "Terry Pratchett"]


def test_another_co_author_does_not_match():
    title = "Terry Pratchett Neil Gaiman - The Long Earth"
    assert indexer_title_authors(release(title), WORK) == []


@pytest.mark.parametrize(
    "title",
    [
        "The Long Earth Series By Stephen Baxter and Terry Pratchett",
        "The Long Earth series, books 1 to 5 - Terry Pratchett & Stephen Baxter",
    ],
)
def test_whole_series_names_are_collections(title):
    assert collection_candidate(release(title), WORK)


def person(role, permissions=None):
    return SimpleNamespace(role=role, active=True, permissions=permissions, can_automate=False)


def test_confirmation_needs_the_permission_and_every_check():
    require_confirmation(person("member"), [], [])
    with pytest.raises(HTTPException) as refused:
        require_confirmation(person("member"), ["identity"], ["identity"])
    assert refused.value.status_code == 403
    allowed = person("member", MEMBER | OVERRIDE_RELEASES)
    require_confirmation(allowed, ["identity"], ["identity"])
    with pytest.raises(HTTPException) as unchecked:
        require_confirmation(person("admin"), ["identity", "language"], ["identity"])
    assert unchecked.value.status_code == 409
    assert unchecked.value.detail == "Confirm the language before downloading this release"

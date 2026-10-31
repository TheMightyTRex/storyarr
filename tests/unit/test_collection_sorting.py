from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.domain.following_overview import order
from app.domain.name_order import surname


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Ursula Le Guin", "le guin"),
        ("Michelle  Smith", "smith"),
        ("Ludwig van Beethoven", "van beethoven"),
        ("Guy de la Bedoyere", "de la bedoyere"),
        ("J. R. R. Tolkien", "tolkien"),
        ("Plato", "plato"),
        ("", None),
        (None, None),
    ],
)
def test_surnames_keep_their_particles(name, expected):
    assert surname(name) == expected


def follow(name, kind="author", day=1, owned=None):
    return SimpleNamespace(
        list_id=uuid4(),
        name=name,
        source_kind=kind,
        followed_at=datetime(2026, 1, day, tzinfo=UTC),
        library_books=owned,
    )


def names(items):
    return [item.name for item in items]


def test_follows_sort_in_each_order_and_reverse():
    guin = follow("Ursula Le Guin", day=3, owned=2)
    plato = follow("Plato", day=1, owned=None)
    banks = follow("Iain Banks", day=2, owned=5)
    culture = follow("Culture", kind="series", day=4, owned=2)
    items = [guin, plato, banks, culture]
    counts = {
        guin.list_id: SimpleNamespace(last_day="1972-01-01", next_day=None, author=None),
        banks.list_id: SimpleNamespace(last_day="2012-10-04", next_day="2027-01-01", author=None),
        culture.list_id: SimpleNamespace(
            last_day="2012-10-04", next_day=None, author="Iain M. Banks"
        ),
    }
    assert names(order(items, counts, "new")) == [
        "Culture",
        "Ursula Le Guin",
        "Iain Banks",
        "Plato",
    ]
    assert names(order(items, counts, "new", reverse=True))[0] == "Plato"
    # Ties run A to Z in both directions; nothing to count stays at the end.
    assert names(order(items, counts, "number")) == [
        "Iain Banks",
        "Culture",
        "Ursula Le Guin",
        "Plato",
    ]
    assert names(order(items, counts, "number", reverse=True)) == [
        "Culture",
        "Ursula Le Guin",
        "Iain Banks",
        "Plato",
    ]
    assert names(order(items, counts, "published")) == [
        "Culture",
        "Iain Banks",
        "Ursula Le Guin",
        "Plato",
    ]
    # Series follow their author's surname.
    assert names(order(items, counts, "author")) == [
        "Culture",
        "Iain Banks",
        "Ursula Le Guin",
        "Plato",
    ]
    assert names(order(items, counts, "author", reverse=True)) == [
        "Plato",
        "Ursula Le Guin",
        "Culture",
        "Iain Banks",
    ]
    assert names(order(items, counts, "name")) == [
        "Culture",
        "Iain Banks",
        "Plato",
        "Ursula Le Guin",
    ]
    # Older links keep working.
    assert names(order(items, counts, "recent")) == names(order(items, counts, "new"))
    assert names(order(items, counts, "library")) == names(order(items, counts, "number"))
    assert names(order(items, counts, "release")) == [
        "Iain Banks",
        "Culture",
        "Plato",
        "Ursula Le Guin",
    ]

from datetime import UTC, datetime
from types import SimpleNamespace

from app.domain.follow_status import _download_status, _list_status, release_detail


def book(state, message="", progress=None, next_check_at=None):
    return SimpleNamespace(
        state=state, message=message, progress=progress or {}, next_check_at=next_check_at
    )


def test_list_automation_states_become_reader_statuses():
    due = datetime(2026, 10, 30, 16, 31, tzinfo=UTC)
    assert _list_status(None) is None
    assert _list_status(book("baseline")) is None
    assert _list_status(book("searching", "Searching sources")).kind == "searching"
    waiting = _list_status(book("wanted", "Search expired", next_check_at=due))
    assert (waiting.kind, waiting.detail, waiting.at) == ("waiting", "Next automatic search", due)
    held = _list_status(book("held", "This download needs attention in Activity"))
    assert (held.kind, held.detail) == ("attention", "This download needs attention in Activity")
    release = _list_status(book("wanted", "Waiting until 2027-01-02", {"waiting_for_release": 1}))
    assert release.kind == "not_released"


def test_downloads_report_progress_import_and_review():
    target = SimpleNamespace(id=1, state="wanted")

    def attempt(state, **observation):
        return SimpleNamespace(state=state, message="Held by client", observation=observation)

    live = _download_status([target], {1: (attempt("downloading", progress=0.456), None)})
    assert (live.kind, live.label, live.progress) == ("downloading", "Downloading 46%", 0.456)
    imported = SimpleNamespace(state="running", message="Importing files")
    done = _download_status([target], {1: (attempt("complete"), imported)})
    assert (done.kind, done.detail) == ("importing", "Importing files")
    held = SimpleNamespace(state="held", message="No catalog edition of this format matches")
    review = _download_status([target], {1: (attempt("complete"), held)})
    assert (review.kind, review.detail) == ("attention", held.message)
    satisfied = SimpleNamespace(id=1, state="satisfied")
    assert _download_status([satisfied], {1: (attempt("downloading"), None)}) is None


def test_release_dates_read_naturally():
    assert release_detail("2027-01-02") == "Release date 2 Jan 2027"
    assert release_detail(None) == "No release date yet"

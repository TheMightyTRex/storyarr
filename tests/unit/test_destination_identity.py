"""Root-inode transitions with real files, journals and publication operations."""
# ruff: noqa: F811

import json

import pytest

from app.importing import publication
from tests.filesystem_fixtures import changing_root_inode  # noqa: F401
from tests.unit.test_import_publication import specification  # noqa: F401


@pytest.mark.parametrize("mode", ["copy", "hardlink"])
@pytest.mark.parametrize("interrupt", [False, True])
def test_root_inode_change_allows_fresh_publication_and_retry(
    specification, changing_root_inode, mode, interrupt
):
    spec = specification.model_copy(update={"mode": mode})
    change = changing_root_inode(spec.destination_root)
    original = spec.source_root / "pack/book.epub"
    before = original.read_bytes()

    def checkpoint(phase):
        if phase == "prepared":
            change()
            if interrupt:
                raise RuntimeError("worker stopped")

    if interrupt:
        with pytest.raises(RuntimeError, match="worker stopped"):
            publication.publish_item(spec, checkpoint=checkpoint)
        assert publication.remaining_import_bytes(spec) == 0
        result = publication.publish_item(spec)
    else:
        result = publication.publish_item(spec, checkpoint=checkpoint)
    assert result["state"] == "published"
    assert publication.publish_item(spec) == result
    assert len(list(spec.destination_root.rglob("*.epub"))) == 1
    published = spec.destination_root / spec.folder / spec.files[0].name
    assert published.read_bytes() == original.read_bytes() == before
    assert (published.stat().st_ino == original.stat().st_ino) == (mode == "hardlink")


def stop_at(phase):
    def checkpoint(current):
        if current == phase:
            raise RuntimeError("worker stopped")

    return checkpoint


@pytest.mark.parametrize("replacement", ["empty", "copied-marker", "symlink", "changed-device"])
def test_replaced_root_is_rejected_before_publication(specification, monkeypatch, replacement):
    import shutil

    spec = specification
    old = spec.destination_root.with_name("old-library")

    def replace(phase):
        if phase != "before-publish":
            return
        if replacement == "changed-device":
            actual = publication.object_id
            with publication.directory(spec.destination_root) as root:
                identity = actual(root)

            def changed(fd):
                value = actual(fd)
                return {**value, "device": value["device"] + 1} if value == identity else value

            monkeypatch.setattr(publication, "object_id", changed)
            return
        spec.destination_root.rename(old)
        if replacement == "symlink":
            spec.destination_root.symlink_to(old, target_is_directory=True)
        else:
            spec.destination_root.mkdir()
            if replacement == "copied-marker":
                shutil.copy2(
                    old / publication.ROOT_MARKER, spec.destination_root / publication.ROOT_MARKER
                )

    with pytest.raises((publication.PublicationError, OSError)):
        publication.publish_item(spec, checkpoint=replace)
    assert not list(spec.destination_root.rglob("*.epub"))
    assert not list(old.rglob("*.epub"))
    assert (spec.source_root / "pack/book.epub").exists()
    assert len(list(spec.staging_root.glob("item-*"))) == 1


@pytest.mark.parametrize("change", ["missing", "token", "copy", "symlink", "hardlink", "fifo"])
def test_marker_replacement_is_not_trusted_even_with_unchanged_root(specification, change):
    import os

    spec = specification
    with pytest.raises(RuntimeError):
        publication.publish_item(spec, checkpoint=stop_at("prepared"))
    marker = spec.destination_root / publication.ROOT_MARKER
    old = spec.destination_root.with_name("saved-marker")
    marker.rename(old)
    if change == "token":
        old.rename(marker)
        marker.write_text("0" * 32 + "\n")
    elif change == "copy":
        marker.write_bytes(old.read_bytes())
    elif change == "symlink":
        marker.symlink_to(old)
    elif change == "hardlink":
        os.link(old, marker)
    elif change == "fifo":
        os.mkfifo(marker)
    with pytest.raises((publication.PublicationError, OSError)):
        publication.publish_item(spec)
    assert not list(spec.destination_root.rglob("*.epub"))
    assert (spec.source_root / "pack/book.epub").exists()


def test_changed_root_keeps_one_destination_lock(specification, changing_root_inode):
    from uuid import uuid4

    spec = specification
    change = changing_root_inode(spec.destination_root)
    with (
        publication.private_staging(spec.staging_root) as staging,
        publication.directory(spec.destination_root) as root,
    ):
        with publication.destination_lock(staging, root):
            change()
            with pytest.raises(publication.PublicationBusy):
                publication.publish_item(
                    spec.model_copy(update={"entry_id": uuid4(), "folder": "Other book"})
                )
    assert publication.publish_item(spec)["state"] == "published"
    assert len(list(spec.staging_root.glob("*.json"))) == 1


@pytest.mark.parametrize("phase", ["prepared", "published-before-receipt", "complete"])
def test_read_only_recovery_and_bookdrop_keep_receipts_across_root_change(
    specification, changing_root_inode, phase
):
    from app.importing.bookdrop import recovered_handoff
    from app.importing.recovery import read_publication
    from tests.unit.test_recovery_file_observations import inputs

    spec = specification
    if phase == "complete":
        publication.publish_item(spec)
    else:
        with pytest.raises(RuntimeError):
            publication.publish_item(spec, checkpoint=stop_at(phase))
    changing_root_inode(spec.destination_root)()

    def snapshot():
        return {
            str(p): (p.read_bytes(), p.stat().st_mtime_ns)
            for p in spec.destination_root.parent.rglob("*")
            if p.is_file()
        }

    before = snapshot()
    state, _, _, receipt = read_publication(*inputs(spec))
    assert state == ("staged" if phase == "prepared" else "published")
    if phase != "prepared":
        if phase == "published-before-receipt":
            assert recovered_handoff(spec)["state"] == "prepared"
        else:
            assert recovered_handoff(spec)["state"] == "published"
    assert snapshot() == before
    assert receipt is not None


@pytest.mark.parametrize("phase", ["prepared", "published-before-receipt", "complete"])
def test_legacy_receipt_is_not_rebound_and_only_owned_stage_can_be_cancelled(
    specification, changing_root_inode, phase
):
    from uuid import uuid4

    from app.importing.cancel_files import cancel_files

    spec = specification
    if phase == "complete":
        publication.publish_item(spec)
    else:
        with pytest.raises(RuntimeError):
            publication.publish_item(spec, checkpoint=stop_at(phase))
    path = spec.staging_root / f"{spec.entry_id}.json"
    receipt = json.loads(path.read_text())
    receipt["destination_identity"].pop("root_marker")
    path.write_text(json.dumps(receipt))
    changing_root_inode(spec.destination_root)()
    with pytest.raises(publication.PublicationError, match="identity changed"):
        publication.publish_item(spec)
    assert json.loads(path.read_text())["destination_identity"] == receipt["destination_identity"]
    if phase == "prepared":
        assert cancel_files(spec)["state"] == "cancelled"
        assert cancel_files(spec)["state"] == "cancelled"
        assert not list(spec.staging_root.glob("item-*"))
        assert (
            publication.publish_item(spec.model_copy(update={"entry_id": uuid4()}))["state"]
            == "published"
        )
    else:
        with pytest.raises(publication.PublicationError):
            cancel_files(spec)
    assert len(list(spec.destination_root.rglob("*.epub"))) == 1
    assert (spec.source_root / "pack/book.epub").exists()


def test_legacy_receipt_on_unchanged_root_still_retries(specification):
    spec = specification
    with pytest.raises(RuntimeError):
        publication.publish_item(spec, checkpoint=stop_at("prepared"))
    path = spec.staging_root / f"{spec.entry_id}.json"
    receipt = json.loads(path.read_text())
    receipt["destination_identity"].pop("root_marker")
    path.write_text(json.dumps(receipt))
    result = publication.publish_item(spec)
    assert result["state"] == "published"
    assert result["destination_identity"] == receipt["destination_identity"]


def test_combine_and_separation_survive_root_inode_change(tmp_path, changing_root_inode):
    from app.importing import combine
    from tests.unit.test_combine_parts import context, library

    root, stage = library(tmp_path)
    spec = combine.build_spec(context(root, stage))
    change = changing_root_inode(root)

    def checkpoint(phase):
        if phase == "staged":
            change()

    assert combine.publish_combined(spec, checkpoint=checkpoint)["state"] == "published"
    assert combine.publish_combined(spec)["state"] == "published"
    combine.mark(spec, "handed-over")
    assert combine.cleanup_parts(spec) == []
    combine.mark(spec, "done")
    combine.restore_parts(spec)
    combine.mark(spec, "separated")
    assert combine.remove_combined(spec)
    assert len(list(root.rglob("*.mp3"))) == 6


def test_seeding_rename_plan_survives_root_inode_change(specification, changing_root_inode):
    import os

    spec = specification.model_copy(update={"mode": "rename"})
    plan = {"files": ["First Harbor.epub"]}
    assert publication.remember_rename_plan(spec, plan) == plan
    changing_root_inode(spec.destination_root)()
    assert publication.load_rename_plan(spec) == plan
    leaf = spec.destination_root / spec.folder
    leaf.mkdir(parents=True)
    os.rename(spec.source_root / "pack/book.epub", leaf / "First Harbor.epub")
    assert publication.publish_item(spec)["state"] == "published"
    assert publication.publish_item(spec)["state"] == "published"


def test_concurrent_marker_initialization_publishes_one_identity(specification, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier

    barrier = Barrier(2)
    actual = publication.no_replace

    def create(*args):
        barrier.wait(timeout=5)
        return actual(*args)

    monkeypatch.setattr(publication, "no_replace", create)

    def initialize():
        with publication.directory(specification.destination_root) as root:
            return publication.destination_identity(root, create=True)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(initialize) for _ in range(2)]
        results = [future.result(timeout=10) for future in futures]
    assert results[0] == results[1]
    assert [p.name for p in specification.destination_root.iterdir()] == [publication.ROOT_MARKER]

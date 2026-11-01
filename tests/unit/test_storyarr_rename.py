"""A Dewarr merge that brings back a lowercase name Storyarr renamed is caught and restored."""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/storyarr_rename.py"
spec = importlib.util.spec_from_file_location("storyarr_rename", SCRIPT)
rename = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rename)


@pytest.mark.parametrize(
    ("path", "merged", "expected"),
    [
        ("pyproject.toml", 'name = "dewarr"\n', 'name = "storyarr"\n'),
        ("apps/web/package.json", '  "name": "dewarr-web",', '  "name": "storyarr-web",'),
        ("services/app/diagnostics.py", "version('dewarr')", "version('storyarr')"),
        (
            "services/app/container.py",
            'logging.getLogger("dewarr")',
            'logging.getLogger("storyarr")',
        ),
        (
            "services/app/container.py",
            'os.environ.get("DB_NAME", "dewarr")',
            'os.environ.get("DB_NAME", "storyarr")',
        ),
        ("tests/unit/test_container.py", 'logger="dewarr"', 'logger="storyarr"'),
        (".github/workflows/image.yml", "tags: dewarr:ci", "tags: storyarr:ci"),
        ("deploy/compose.dev.yaml", "services:\n  dewarr:\n", "services:\n  storyarr:\n"),
    ],
)
def test_renamed_lowercase_names_are_restored(path, merged, expected):
    text, found = rename.rename_lowercase(path, merged)
    assert text == expected
    assert found


@pytest.mark.parametrize(
    ("path", "text"),
    [
        ("services/app/api/dependencies.py", '"x-dewarr-proxy-token"'),
        (
            "services/app/domain/acquisition_selection.py",
            'save_path += "/dewarr-" + artifact.id.hex',
        ),
        ("services/app/adapters/torrent_rpc.py", r're.search(r"/dewarr-[0-9a-f]{32}$", path)'),
        ("docs/DOCKER.md", "DB_NAME: dewarr"),
    ],
)
def test_compatibility_names_are_left_alone(path, text):
    assert rename.rename_lowercase(path, text) == (text, [])

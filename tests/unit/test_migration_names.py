import re
from pathlib import Path

VERSIONS = Path(__file__).resolve().parents[2] / "services/app/db/migrations/versions"
# Dewarr's migrations, and the fork's first three, keep their plain numbers.
LAST_PLAIN = 83


def test_new_migrations_are_named_for_storyarr():
    """
    Dewarr numbers its migrations 0001, 0002 and so on. If Storyarr used the same pattern, a later
    Dewarr release could bring a different migration with the same number. From 0084, Storyarr's
    migrations are named storyarr_NNNN_..., in the file name and the revision id. Migrations
    merged from a Dewarr release keep their own names and carry a "# From Dewarr" line.
    """
    problems = []
    for path in sorted(VERSIONS.glob("*.py")):
        revision = re.search(r'^revision = "([^"]+)"', path.read_text(), re.M).group(1)
        plain = re.match(r"(\d{4})_", path.name)
        upstream = "# From Dewarr" in path.read_text()
        if plain and int(plain.group(1)) > LAST_PLAIN and not upstream:
            problems.append(f"{path.name}: name it storyarr_{plain.group(1)}_...")
        elif path.name.startswith("storyarr_") and not revision.startswith("storyarr_"):
            problems.append(f"{path.name}: its revision id should start with storyarr_")
    assert problems == []

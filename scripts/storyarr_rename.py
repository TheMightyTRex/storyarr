"""
Re-apply the Storyarr name after merging a Dewarr release.

    python3 scripts/storyarr_rename.py          # list "Dewarr" text that should say Storyarr
    python3 scripts/storyarr_rename.py --apply  # rewrite it in code and tests, then list the rest

Code and tests are rewritten. Documentation is only listed, because it often credits Dewarr on
purpose. Internal names that existing installs depend on are never changed: the Python package,
the `x-dewarr-proxy-token` header, `dewarr-` download folders and database defaults are all
lowercase, and only the capitalised name is touched. Migrations and Dewarr's own release notes
are history, so they are left alone.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NAME = re.compile(r"\bDewarr\b")
REWRITE = (
    "apps/web/src/",
    "apps/web/tests/",
    "apps/web/index.html",
    "services/app/",
    "tests/",
    "scripts/",
    ".github/",
    "Dockerfile",
)
SKIP = (
    "services/app/db/migrations/",
    "apps/web/src/api/schema.d.ts",  # generated from the server
    "docs/releases/v0.",  # Dewarr's release notes
    "docs/issues/",
    "LICENSE",
    "docs/notices/",
    "CHANGELOG.md",
    "docs/MIGRATING.md",  # about moving from Dewarr
    "docs/UPSTREAM.md",  # about working with Dewarr
    ".github/workflows/upstream-watch.yml",
    "scripts/upstream_watch.py",
    "tests/unit/test_migration_names.py",
    "scripts/storyarr_rename.py",
)
# Lines that mention Dewarr on purpose: credits, the move from Dewarr, and the real header name.
KEEP = re.compile(
    r"logabell|fork of|from Dewarr|to Dewarr|on Dewarr|how Dewarr|Dewarr v0\.|X-Dewarr-Proxy-Token"
    r"|with Dewarr|Dewarr's release|Dewarr releases|Dewarr will|Dewarr migration"
    r"|Dewarr notification"  # the old notification title, renamed by storyarr_0086
)


def tracked():
    out = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True)
    return [path for path in out.splitlines() if not path.startswith(SKIP)]


def main(argv):
    apply = argv == ["--apply"]
    if argv and not apply:
        print(__doc__)
        return 2
    changed, remaining = [], []
    for path in tracked():
        file = ROOT / path
        try:
            text = file.read_text()
        except (UnicodeDecodeError, FileNotFoundError, IsADirectoryError):
            continue
        if "Dewarr" not in text:
            continue
        lines = text.split("\n")
        rewrite = apply and path.startswith(REWRITE)
        for number, line in enumerate(lines):
            if not NAME.search(line) or KEEP.search(line):
                continue
            if rewrite:
                lines[number] = NAME.sub("Storyarr", line)
            else:
                remaining.append(f"{path}:{number + 1}: {line.strip()[:120]}")
        if rewrite:
            new = "\n".join(lines)
            if new != text:
                file.write_text(new)
                changed.append(path)
    for path in changed:
        print(f"renamed: {path}")
    for line in remaining:
        print(f"check:   {line}")
    if not changed and not remaining:
        print("Nothing to rename.")
    return 1 if remaining else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

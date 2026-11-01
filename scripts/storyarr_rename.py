"""
Re-apply the Storyarr name after merging a Dewarr release.

    python3 scripts/storyarr_rename.py          # list "Dewarr" text that should say Storyarr
    python3 scripts/storyarr_rename.py --apply  # rewrite it in code and tests, then list the rest

Code and tests are rewritten. Documentation is only listed, because it often credits Dewarr on
purpose. Migrations and Dewarr's own release notes are history, so they are left alone.

Lowercase names are only touched where Storyarr renamed them (the package, the logger, the
database defaults, CI image names and the deploy overrides; see LOWERCASE). Names existing installs
depend on keep `dewarr`: the `x-dewarr-proxy-token` header and the `dewarr-` download folders.
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
# Lowercase names Storyarr renamed: (files they apply to, pattern, replacement). A Dewarr merge that
# touches these lines brings `dewarr` back, so --apply restores them and the check reports them.
LOWERCASE = (
    (("pyproject.toml", "uv.lock"), r'^name = "dewarr"$', 'name = "storyarr"'),
    (
        ("apps/web/package.json", "apps/web/package-lock.json"),
        r'"name": "dewarr-web"',
        '"name": "storyarr-web"',
    ),
    (("services/",), r"""version\((['"])dewarr\1\)""", r"version(\1storyarr\1)"),
    (("services/", "tests/"), r"""(getLogger\(|logger=)(['"])dewarr(?=[.'"])""", r"\1\2storyarr"),
    (
        ("services/app/container.py",),
        r"""(["'](?:DB_USER|DB_NAME)["'], ["'])dewarr(["'])""",
        r"\1storyarr\2",
    ),
    (("services/app/adapters/deluge.py",), r'"dewarr\.torrent"', '"storyarr.torrent"'),
    (("services/app/adapters/grimmory.py",), r'"dewarr-inventory-"', '"storyarr-inventory-"'),
    (
        (".github/", "scripts/smoke_image.sh"),
        r"\bdewarr(?=:ci\b|:dev-candidate\b|-public\b|-smoke\b)",
        "storyarr",
    ),
    ((".github/",), r"scope=dewarr-", "scope=storyarr-"),
    (("deploy/",), r"^  dewarr:$", "  storyarr:"),
    (("deploy/", ".github/"), r"--wait dewarr\b", "--wait storyarr"),
    (("deploy/",), r"image: dewarr:local", "image: storyarr:local"),
    (("deploy/",), r"ghcr\.io/logabell/dewarr", "ghcr.io/themightytrex/storyarr"),
    (
        ("deploy/",),
        r"BOOK_RELEASE_REPOSITORY: logabell/dewarr",
        "BOOK_RELEASE_REPOSITORY: TheMightyTRex/storyarr",
    ),
)
LOWERCASE = tuple((paths, re.compile(pattern, re.M), new) for paths, pattern, new in LOWERCASE)


def rename_lowercase(path, text):
    """Return the text with Storyarr's lowercase names restored, and the lines that changed."""
    found = []
    for paths, pattern, new in LOWERCASE:
        if not path.startswith(paths):
            continue
        for match in pattern.finditer(text):
            line = text.count("\n", 0, match.start()) + 1
            found.append(f"{path}:{line}: {match.group(0)}")
        text = pattern.sub(new, text)
    return text, found


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
        lowered, found = rename_lowercase(path, text)
        if found:
            if apply:
                file.write_text(lowered)
                changed.append(path)
                text = lowered
            else:
                remaining += found
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
                if path not in changed:
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

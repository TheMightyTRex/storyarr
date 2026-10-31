"""
Weekly check for new Dewarr changes since the release Storyarr is based on.

Reads the base commit from .github/upstream-base, compares it with logabell/dewarr main, and
opens or updates one issue labelled "upstream" listing the new commits, releases and database
migrations. With --dry-run it prints the issue instead. Needs the gh CLI; in Actions it uses
GITHUB_TOKEN.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

UPSTREAM = "logabell/dewarr"
HERE = os.environ.get("GITHUB_REPOSITORY", "TheMightyTRex/storyarr")
TITLE = "Dewarr has new changes"
BASE = Path(__file__).resolve().parent.parent / ".github/upstream-base"


def gh(*args):
    return subprocess.check_output(["gh", *args], text=True)


def api(path):
    return json.loads(gh("api", path))


def report(base, label):
    compare = api(f"repos/{UPSTREAM}/compare/{base}...main")
    if not compare["ahead_by"]:
        return None
    releases = [
        r["tag_name"] for r in api(f"repos/{UPSTREAM}/releases?per_page=10") if not r["draft"]
    ]
    newer = releases[: releases.index(label)] if label in releases else releases
    migrations = sorted(
        f["filename"].rsplit("/", 1)[-1]
        for f in compare.get("files", [])
        if "/db/migrations/versions/" in f["filename"] and f["status"] == "added"
    )
    lines = [
        f"Dewarr `main` is {compare['ahead_by']} commits ahead of {label}, the release Storyarr is",
        "based on.",
        "",
        f"**New releases:** {', '.join(newer) if newer else 'none yet'}",
        "",
        "**New database migrations:** "
        + (", ".join(f"`{m}`" for m in migrations) if migrations else "none"),
        "",
        "**Commits:**",
        *[
            f"- [{c['sha'][:7]}]({c['html_url']}) {c['commit']['message'].splitlines()[0]}"
            for c in compare["commits"][-30:]
        ],
        "",
        f"[Compare on GitHub](https://github.com/{UPSTREAM}/compare/{base[:12]}...main) · "
        f"[How to bring a Dewarr release in](https://github.com/{HERE}/blob/main/docs/UPSTREAM.md)",
    ]
    return "\n".join(lines)


def main(argv):
    base, label = BASE.read_text().split()
    body = report(base, label)
    if body is None:
        print(f"No new Dewarr changes since {label}.")
        return 0
    if argv == ["--dry-run"]:
        print(body)
        return 0
    subprocess.run(
        [
            "gh",
            "label",
            "create",
            "upstream",
            "--color",
            "c2552c",
            "--force",
            "--description",
            "Changes in Dewarr to review",
        ],
        check=False,
    )
    found = json.loads(
        gh("issue", "list", "--label", "upstream", "--state", "open", "--json", "number")
    )
    if found:
        gh("issue", "edit", str(found[0]["number"]), "--body", body)
        print(f"Updated issue #{found[0]['number']}")
    else:
        gh("issue", "create", "--title", TITLE, "--label", "upstream", "--body", body)
        print("Opened an issue")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

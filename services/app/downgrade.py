"""
Move the database back to an earlier release before switching to an older image, for example
before going back to Dewarr v0.3.9. Run it in the Storyarr container, which has the settings it
needs:

    docker exec storyarr python -m app.downgrade 0080_member_setup

Then stop Storyarr and start the older image. Back up the database first.
"""

import subprocess
import sys

from app.container import configure_environment

# Where each earlier release's database ends. Only these targets are offered, so a typing mistake
# cannot remove more than intended.
RELEASES = {
    "0080_member_setup": "Dewarr v0.3.9",
    "0082_installation_automation": "Storyarr before the operation lookup indexes",
    "0083_operation_lookups": "Storyarr v0.4.1, before Background work",
    "storyarr_0084_background_work": "Storyarr v0.4.2, before saved layouts",
    "storyarr_0085_user_preferences": "Storyarr v0.4.5, before the notification title change",
}


def main(argv: list[str]) -> int:
    if len(argv) != 1 or argv[0] not in RELEASES:
        print("Usage: python -m app.downgrade <revision>", file=sys.stderr)
        for revision, release in RELEASES.items():
            print(f"  {revision}  ({release})", file=sys.stderr)
        return 2
    configure_environment()
    print(f"Moving the database back to {argv[0]} ({RELEASES[argv[0]]})")
    return subprocess.call(["alembic", "downgrade", argv[0]])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

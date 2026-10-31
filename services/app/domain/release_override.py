"""Releases Storyarr could not confirm, chosen by a person who checked them first.

Automatic selection never takes these. A person with the override permission may,
after confirming each unchecked fact. Downloaded files are still inspected before
import, as for every release.
"""

from fastapi import HTTPException

from app.domain.automatic_eligibility import collection_candidate
from app.domain.permissions import OVERRIDE_RELEASES, has
from app.domain.release_profiles import ReleasePreferences, assess_release

CHECKS = {"identity": "the title and author", "language": "the language"}


def unconfirmed(release, work, rule, version=None):
    """The checks this release leaves open for this book and medium."""
    missing = []
    identity = assess_release(release, work, ReleasePreferences(), rule["medium"]).identity
    if identity != "corroborated" and not collection_candidate(release, work):
        missing.append("identity")
    # A release that names another language stays blocked; only silence can be confirmed.
    if (rule["language"] or (version.language if version else None)) and not release.language:
        missing.append("language")
    return missing


def require_confirmation(user, missing, confirmed):
    if not missing:
        return
    if not has(user, OVERRIDE_RELEASES):
        raise HTTPException(
            403, "You do not have permission to download releases Storyarr could not confirm"
        )
    left = [check for check in missing if check not in confirmed]
    if left:
        raise HTTPException(
            409,
            "Confirm "
            + " and ".join(CHECKS[check] for check in left)
            + " before downloading this release",
        )

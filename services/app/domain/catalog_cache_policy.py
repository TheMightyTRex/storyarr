"""Freshness by query purpose; only display reads may refresh in the background."""

import re
from datetime import timedelta


def lifetime(provider, path, document):
    query = (document or {}).get("query", "")
    name = re.search(r"\bquery\s+(\w+)", query)
    name = name[1] if name else ""
    if provider == "bbc-sounds":
        return timedelta(minutes=5)
    if provider == "bbc":
        # Radio show data changes weekly at most; an hour is the shortest refresh interval.
        return timedelta(hours=1)
    if path == "search.json" or name in {
        "CatalogSearch",
        "LibraryTitleMatch",
        "LibraryIdentifierMatch",
    }:
        return timedelta(minutes=5)
    if name in {"CatalogBook", "CatalogBooks", "ReaderBookDetails"}:
        return timedelta(days=1)
    if provider == "openlibrary" and path.startswith(("works/", "authors/")):
        return timedelta(days=1)
    if name == "DiscoveryBooks":
        return timedelta(hours=1)
    if name.startswith(("Discovery", "Upcoming")):
        return timedelta(minutes=15)
    return timedelta(hours=1)


BROWSE_OPERATIONS = {
    "fetch",
    "reader_details",
    "author_details",
    "discovery",
    "related",
    "upcoming",
    "community_lists",
    "community_list",
    "collection_page",
    "collection_snapshot",
    "reader_match",
}

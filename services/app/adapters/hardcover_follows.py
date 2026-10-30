"""Complete, keyset-paged author/series catalogs for the standing list engine."""

import re
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.adapters.catalog_providers import contributors, identifier
from app.adapters.catalog_types import BookData, cover_url, year
from app.adapters.hardcover_lists import MAX_MEMBERS, ListPage, invalid


class FollowFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    compilations: bool = False
    box_sets: bool = False
    anthologies: bool = False
    non_main_series: bool = False
    coauthored: bool = True
    comics: bool = False
    plays: bool = False
    companions: bool = False
    non_fiction: bool = True
    language: str | None = Field(default=None, pattern=r"^[a-z]{2}$")


# Hardcover genre tags are crowd-sourced, so a single stray tag must not reclassify a novel.
# Title patterns catch items that carry no useful tags at all (maps, diaries, comic issues).
FICTION_GENRES = frozenset(
    {
        "fiction",
        "fantasy",
        "science fiction",
        "mystery",
        "thriller",
        "romance",
        "horror",
        "young adult",
        "literary fiction",
        "historical fiction",
        "adventure",
        "crime",
        "classics",
        "dystopian",
        "paranormal",
    }
)
FACTUAL_GENRES = frozenset(
    {
        "nonfiction",
        "non-fiction",
        "biography",
        "autobiography",
        "memoir",
        "memoirs",
        "essays",
        "history",
        "true crime",
        "self help",
        "philosophy",
        "reference",
        "journalism",
        "politics",
        "psychology",
        "popular science",
    }
)
COMIC_GENRES = frozenset({"comics", "comic books", "graphic novels", "graphic novel", "manga"})
PLAY_GENRES = frozenset({"plays", "theatre", "theater", "screenplays", "drama plays"})
# "Comic" alone usually means funny ("The Mammoth Book of Comic Fantasy").
COMIC_TITLE = re.compile(
    r"\bcomics\b|\bcomic (?:adaptation|book|strip)\b|\bbig comic\b|\bgraphic novel\b|\bmanga\b"
)
# A trailing "#3" is a comic issue unless readers tag the book as fiction (numbered novels) or
# the title names a magazine, anthology or series.
ISSUE_NUMBER = re.compile(r"#\s?\d+\s*$")
PERIODICAL = re.compile(r"\bmagazine\b|\bpack\b|\barchive\b|\banthology\b|\bstories\b|\bseries\b")
PLAY_TITLE = re.compile(
    r"\bthe play\b|\bscreenplay\b|\bstage (?:play|adaptation|version)\b|\bplayscript\b"
    r"|\bradio scripts?\b"
)
# Anchored where plain words are also series names ("The Murderbot Diaries") or novel titles
# ("Murder at the ABA: A Puzzle...", "The Companion: A Miss Marple Story").
COMPANION_TITLE = re.compile(
    r"\bdiary(?:\s+(?:19|20)\d\d)?\s*$|\bdiary\s+(?:19|20)\d\d\b|\byearbook\b|\bjournal\s*$"
    r"|\bcalendar\b|\balmana[ck]\b|\bmapp?\s*$|\bmapp\b|\batlas\b|(?<!\bthe )\bcompanion\b"
    r"|\bhandbook\b|\bcolou?ring book\b|\bjigsaw\b|\b\d+[ -]piece puzzle\b|\bpuzzle book\b"
    r"|\bquiz(?:book)?\b|\btourist guide\b|\bcook ?book\b|\bnotebook\b|\bthe art of\b"
    r"|\bportfolio\b|\bfolio\s*$"
    r"|\brole-?playing game\b|\brpg\b|\bgurps\b|\bcut-?out book\b|\bsticker book\b"
    r"|\bactivity book\b|\bencyclop(?:a)?edia\b|\bbestiary\b|\bwit and wisdom\b"
    r"|\bquotations\b|\bpostcards?\b|\bcompleat\b"
)
# A title-pattern companion (a "Journal", a "Map") is still a novel when readers tag it as one.
ESTABLISHED_FICTION = 10


def genre_counts(tags):
    if not isinstance(tags, dict):
        return {}
    counts = {}
    for key, values in tags.items():
        if str(key).casefold() != "genre" or not isinstance(values, list):
            continue
        for item in values:
            if isinstance(item, dict) and isinstance(item.get("tag"), str):
                count = item.get("count")
                name = item["tag"].casefold().strip()
                counts[name] = counts.get(name, 0) + (
                    count if type(count) is int and count > 0 else 1
                )
    return counts


def book_types(title, tags):
    """Kinds of book a follow can leave out: comic, play, companion, non_fiction."""
    text = title.casefold()
    genres = genre_counts(tags)

    def total(names):
        return sum(count for name, count in genres.items() if name in names)

    fiction, factual = total(FICTION_GENRES), total(FACTUAL_GENRES)
    kinds = []
    comic_tags = total(COMIC_GENRES)
    if (
        COMIC_TITLE.search(text)
        or comic_tags >= max(2, fiction / 2)
        or (
            ISSUE_NUMBER.search(text)
            and not PERIODICAL.search(text)
            and (comic_tags or fiction < ESTABLISHED_FICTION)
        )
    ):
        kinds.append("comic")
    if PLAY_TITLE.search(text) or total(PLAY_GENRES) >= max(2, fiction / 2):
        kinds.append("play")
    if COMPANION_TITLE.search(text) and fiction < ESTABLISHED_FICTION:
        kinds.append("companion")
    if factual > fiction:
        kinds.append("non_fiction")
    return kinds


AUTHOR = """contributions: {author_id: {_eq: $id}, _or: [
 {contribution: {_eq: "Author"}}, {contribution: {_is_null: true}}]}"""
SERIES = "book_series: {series_id: {_eq: $id}}"
QUERY = """query FollowCatalog($id: Int!, $after: Int!, $language: String!) {
 source: SOURCE(where: {id: {_eq: $id}}, limit: 1) { id name SOURCE_EXTRA }
 books_aggregate(where: {canonical_id: {_is_null: true}, PREDICATE}) {
  aggregate { count }
 }
 books(where: {id: {_gt: $after}, canonical_id: {_is_null: true}, PREDICATE},
  order_by: {id: asc}, limit: 100) {
  id title cached_contributors cached_image cached_tags release_date release_year is_partial_book
  book_series(limit: 101, order_by: {id: asc}) { series_id position compilation }
  matching_editions: editions(where: {language: {code2: {_eq: $language}}}, limit: 1) {
   id
  }
 }
}"""


def filter_reason(record, filters, kind):
    text = record["classification"]
    if not filters.box_sets and re.search(r"\bbox[ -]?set\b|\bboxed\b", text):
        return "Box set"
    if not filters.anthologies and re.search(r"\bantholog(?:y|ies)\b", text):
        return "Anthology"
    if not filters.compilations and (
        record["compilation"] or re.search(r"\bomnibus\b|\bcompilation\b|\bcollected works\b", text)
    ):
        return "Compilation"
    kinds = record.get("book_types") or []
    if not filters.comics and "comic" in kinds:
        return "Comic or graphic novel"
    if not filters.plays and "play" in kinds:
        return "Play or screenplay"
    if not filters.companions and "companion" in kinds:
        return "Companion, diary, map or game"
    if not filters.non_fiction and "non_fiction" in kinds:
        return "Non-fiction"
    if not filters.non_main_series and not record["main_series"]:
        return "Non-main-series title"
    if not filters.coauthored and len(record["authors"]) > 1:
        return "Co-authored book"
    if filters.language and not record["language_match"]:
        return "No matching language edition"
    return None


async def page(query, kind, external_id, cursor, filters):
    identifier("hardcover", external_id)
    if kind not in {"author", "series"}:
        raise invalid()
    statement = (
        QUERY.replace("SOURCE_EXTRA", "canonical_id" if kind == "series" else "cached_image")
        .replace("SOURCE", "authors" if kind == "author" else "series")
        .replace("PREDICATE", AUTHOR if kind == "author" else SERIES)
    )
    data = await query(
        statement, {"id": int(external_id), "after": cursor, "language": filters.language or ""}
    )
    try:
        sources = data["source"]
        if not isinstance(sources, list) or len(sources) != 1:
            raise invalid()
        source = sources[0]
        if (
            str(source["id"]) != external_id
            or not isinstance(source["name"], str)
            or not source["name"].strip()
            or len(source["name"]) > 600
            or source.get("canonical_id")
        ):
            raise invalid()
        count = data["books_aggregate"]["aggregate"]["count"]
        if type(count) is not int or not 0 <= count <= MAX_MEMBERS:
            raise invalid()
        rows = data["books"]
        if not isinstance(rows, list) or len(rows) > 100:
            raise invalid()
        records = []
        for raw in rows:
            key = raw["id"]
            if type(key) is not int or key <= cursor:
                raise invalid()
            cursor = key
            book = BookData(
                provider="hardcover",
                external_id=identifier("hardcover", str(key)),
                title=raw["title"],
                authors=contributors(raw["cached_contributors"], "Author"),
            )
            memberships = raw["book_series"]
            if not isinstance(memberships, list) or len(memberships) > 100:
                raise invalid()
            main, compilation = False, False
            for membership in memberships:
                if type(membership["compilation"]) is not bool:
                    raise invalid()
                compilation |= membership["compilation"]
                if kind == "author" or str(membership["series_id"]) == external_id:
                    number = (
                        Decimal(str(membership["position"]))
                        if membership["position"] is not None
                        else None
                    )
                    main |= bool(
                        number is not None
                        and number.is_finite()
                        and number > 0
                        and number == number.to_integral_value()
                        and not membership["compilation"]
                    )
            if type(raw["is_partial_book"]) is not bool:
                raise invalid()
            day = (
                date.fromisoformat(raw["release_date"]).isoformat() if raw["release_date"] else None
            )
            matches = raw["matching_editions"]
            if not isinstance(matches, list) or len(matches) > 1:
                raise invalid()
            if matches and (
                not isinstance(matches[0], dict)
                or type(matches[0].get("id")) is not int
                or not 1 <= matches[0]["id"] <= 2147483647
            ):
                raise invalid()
            record = {
                "source_kind": kind,
                "external_id": book.external_id,
                "title": book.title,
                "authors": book.authors,
                "isbn": None,
                "isbn13": None,
                "release_date": day,
                "coming_soon": not day and (year(raw.get("release_year")) or 0) > date.today().year,
                "compilation": compilation,
                "main_series": (main or (kind == "author" and not memberships))
                and not raw["is_partial_book"],
                "classification": (book.title + " " + str(raw.get("cached_tags") or "")).casefold(),
                "book_types": book_types(book.title, raw.get("cached_tags")),
                "language_match": bool(matches),
                "cover_url": cover_url((raw.get("cached_image") or {}).get("url")),
            }
            record["filter_reason"] = filter_reason(record, filters, kind)
            records.append(record)
        return ListPage(
            {
                "external_id": external_id,
                "name": source["name"],
                "count": count,
                "image_url": cover_url((source.get("cached_image") or {}).get("url")),
            },
            records,
            cursor,
        )
    except (KeyError, TypeError, ValueError, ArithmeticError, AttributeError, ValidationError):
        raise invalid() from None

"""Stronger evidence for files that name only a series and position."""

from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select

from app.db.models import CatalogSeries, DownloadAttempt, SeriesMembership
from app.domain import download_memberships
from app.domain.automatic_eligibility import PACK
from app.domain.identity import normalized
from app.domain.pack_coverage import CATALOG_FRESH_FOR, MAX_CATALOG_MEMBERS
from app.domain.series_identity import position_key, series_name, series_note_agrees
from app.domain.series_projection import full_book
from app.domain.title_matching import compatible_title
from app.domain.work_graph import canonical_map, family_ids
from app.importing.match_evidence import language_key


async def corroborated_titles(db, work, selection, inspection, group, facts, known_series):
    """Return file assertions proved by one complete, unambiguous book transfer."""
    rule, release = selection.frozen["requirements"], selection.frozen["release"]
    authors = sorted(normalized(name) for name in work.authors)
    if (
        rule.get("version_id")
        or rule["medium"] != group.medium
        or release.get("medium") != group.medium
        or not facts.titles
        or facts.issues
        or not authors
        or facts.authors != [authors]
        or (
            work.language and any(value != language_key(work.language) for value in facts.languages)
        )
        or sorted(normalized(name) for name in release.get("authors", [])) != authors
        or not compatible_title(release.get("title", ""), work.title)
        or work.metadata_fields.get("identity_rejected")
        or selection.frozen.get("collection_review")
        or selection.frozen.get("selected_paths")
        or len(release.get("coverage", [])) > 1
        or len((release.get("details", {}).get("collection_contents") or {}).get("items", [])) > 1
        or PACK.search(
            " ".join(
                [
                    release.get("raw_title", ""),
                    release.get("title", ""),
                    *release.get("tags", []),
                ]
            )
        )
    ):
        return ()
    files = {item["path"]: item for item in inspection.snapshot["files"]}
    if PACK.search(selection.frozen["descriptor"].get("name", "")) or any(
        PACK.search(path) for path in files
    ):
        return ()
    media = {path for path, item in files.items() if item.get("medium")}
    if {item.path for item in group.files} != media:
        return ()
    attempt = await db.scalar(
        select(DownloadAttempt).where(DownloadAttempt.inspection_id == inspection.id)
    )
    if not attempt or attempt.state != "complete":
        return ()
    if len(await download_memberships.for_attempt(db, attempt.id)) != 1:
        return ()
    from app.importing.automatic import content_reason, manifest_matches

    try:
        manifest_matches(selection, inspection)
    except HTTPException:
        return ()
    if content_reason(group, files, release):
        return ()
    rows = list(
        await db.scalars(
            select(CatalogSeries)
            .where(
                CatalogSeries.owner_id == selection.owner_id,
                CatalogSeries.fetched_at >= datetime.now(UTC) - CATALOG_FRESH_FOR,
                CatalogSeries.id.in_(
                    select(SeriesMembership.series_id).where(
                        SeriesMembership.work_id.in_(family_ids(work.id)),
                        SeriesMembership.present.is_(True),
                    )
                ),
            )
            .limit(4)
        )
    )
    if len(rows) > 3:
        return ()
    mapping = canonical_map()
    proofs = []
    for row in rows:
        members = (
            await db.execute(
                select(SeriesMembership.snapshot, mapping.c.work_id)
                .join(mapping, mapping.c.origin_id == SeriesMembership.work_id)
                .where(SeriesMembership.series_id == row.id, SeriesMembership.present.is_(True))
                .limit(MAX_CATALOG_MEMBERS + 1)
            )
        ).all()
        if len(members) > MAX_CATALOG_MEMBERS:
            return ()
        positions = {position_key(f.get("position")) for f, wid in members if wid == work.id}
        notes = [{"name": row.name, "position": str(p)} for p in positions if p is not None]
        if not all(series_note_agrees(t, notes, require_position=True) for t in facts.titles):
            continue
        positions.update(
            position_key(entry["position"])
            for entry in known_series
            if series_name(entry["name"]) == series_name(row.name) and entry.get("position")
        )
        if (
            len(positions) != 1
            or None in positions
            or (row.snapshot.get("count") is not None and row.snapshot["count"] != len(members))
        ):
            return ()
        position = next(iter(positions))
        same_position = [
            (f, wid) for f, wid in members if position_key(f.get("position")) == position
        ]
        # Include every competing work, even an unavailable or partial record.
        # Filtering those out would manufacture unique membership.
        if {wid for _, wid in same_position} != {work.id}:
            return ()
        today = datetime.now(UTC).date().isoformat()
        if any(
            not full_book(f)
            or f.get("compilation")
            or not f.get("release_date")
            or f["release_date"] > today
            for f, _ in same_position
        ):
            return ()
        proofs.append(row.id)
    return tuple(facts.titles) if len(proofs) == 1 else ()

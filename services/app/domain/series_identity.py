"""Catalog-backed series labels shared by release and downloaded-file matching."""

import re
from decimal import Decimal

from app.domain.catalog_titles import display_title
from app.domain.title_matching import exact_title_key


def position_key(value):
    value = str(value if value is not None else "").strip()
    return Decimal(value) if re.fullmatch(r"\d{1,4}(?:\.\d{1,4})?", value) else None


def series_name(value):
    """Only presentation wrappers are optional, not words inside a series name."""
    value = display_title(value)
    value = re.sub(r"^(?:the|a|an)\s+", "", value)
    return re.sub(r"\s+(?:saga|series)$", "", value).strip()


def series_note_agrees(note, series, *, require_position=False):
    # Preserve punctuation until numbers have been checked: 5.5 is not 5,
    # and 1-3 is a collection, not a single position.
    note = display_title(note)
    for entry in series:
        name = series_name(entry.get("name", ""))
        if not name:
            continue
        match = re.search(rf"(?<!\w){re.escape(name)}(?!\w)", note)
        if not match:
            continue
        remainder = note[: match.start()] + " " + note[match.end() :]
        numbers = re.findall(r"\d+(?:\.\d+)?", remainder)
        if require_position and len(numbers) != 1:
            continue
        if numbers and (
            len(numbers) != 1
            or position_key(numbers[0]) is None
            or position_key(numbers[0]) != position_key(entry.get("position"))
        ):
            continue
        remainder = re.sub(r"\d+(?:\.\d+)?", " ", remainder)
        remainder = re.sub(
            r"\b(?:a|an|the|trilogy|duology|quartet|saga|series|cycle|book|volume|vol)\b\.?",
            " ",
            remainder,
        )
        if not remainder.strip(" ,:;#"):
            return True
    return False


def title_outside_series_note(value, work):
    """Strip only a known series annotation after the complete catalog title."""
    title = display_title(work["title"])
    value = display_title(value)
    if not title:
        return None
    series = [entry for entry in work.get("series", []) if isinstance(entry, dict)]
    for boundary in re.finditer(r"\(|:", value):
        # Compare the complete title before interpreting its annotation. Keep
        # connector/punctuation equivalence without omitting actual subtitles.
        if exact_title_key(value[: boundary.start()]) != exact_title_key(title):
            continue
        suffix = value[boundary.start() :]
        if suffix.startswith("(") and suffix.endswith(")"):
            note = suffix[1:-1]
        elif suffix.startswith(":"):
            note = suffix[1:]
        else:
            continue
        if series_note_agrees(note, series):
            return title
    return None

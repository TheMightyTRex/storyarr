"""Radio release names (RADIO-01, ready for the radio sources of R5).

Torrent and Usenet names for radio come in many shapes. ``parse`` reads them:

- ``Show S20E03``, ``Show - S20E03 - Title``, ``Show 20x03``, ``Show Series 20 Episode 3``
- dates: ``Show 2026-11-04``, ``2026.11.04``, ``20261104``, ``04 Nov 2026``
- dotted scene names with a group at the end (``Show.S20E03.MP3-GROUP``)
- a station in front (``BBC.Radio.4.Show...``) or in a leading bracket (``[BBC R4] Show``)
- the BBC pid get_iplayer puts in its names (``..._b09zv5m0_original.m4a``)
- audio tags anywhere (``128kbps``, ``[64kbps opus]``, ``MP3``, ``AAC``, ``FLAC``, ``WEB``)

``search_terms`` gives the words to search for one episode, and ``matches`` checks a release
against it: the show must match (case, punctuation, accents and a leading "The" ignored, a
station in front allowed), then the series and episode numbers, else the broadcast date (a day
either way), else the episode title. Releases in film or book categories are never taken.
"""

import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from app.adapters.bbc_programmes import PID

MONTHS = {
    name: index
    for index, names in enumerate(
        [
            ("jan", "january"),
            ("feb", "february"),
            ("mar", "march"),
            ("apr", "april"),
            ("may",),
            ("jun", "june"),
            ("jul", "july"),
            ("aug", "august"),
            ("sep", "sept", "september"),
            ("oct", "october"),
            ("nov", "november"),
            ("dec", "december"),
        ],
        start=1,
    )
    for name in names
}
# Newznab and Torznab categories: 2000s are films, 7000s books, 3030 audiobooks.
REFUSED_CATEGORIES = range(2000, 3000), range(7000, 8000)
STATIONS = [
    (
        re.compile(r"^bbc[ ._-]*radio[ ._-]*(\d|one|two|three|four|five)(?:[ ._-]*extra)?\b", re.I),
        None,
    ),
    (
        re.compile(
            r"^bbc[ ._-]*(?:r|world[ ._-]*service|6[ ._-]*music|asian[ ._-]*network)\w*\b", re.I
        ),
        None,
    ),
    (
        re.compile(
            r"^(?:rte|rté|abc|cbc|npr|lbc|times[ ._-]*radio)(?:[ ._-]*radio)?(?:[ ._-]*\d)?\b", re.I
        ),
        None,
    ),
]
BRACKET = re.compile(r"^\s*[\[(]([^\])]{1,40})[\])]\s*")
TAGS = re.compile(
    r"[\[(]?\b(?:\d{2,3}\s?kbps|mp3|aac|m4a|m4b|flac|opus|ogg|web(?:[ ._-]?dl)?|"
    r"iplayer|get[ ._-]?iplayer|vbr|cbr|stereo|mono|hq|lq)\b[\])]?",
    re.I,
)
CODE = re.compile(r"\bs(\d{1,4})[ ._-]?e(\d{1,4})\b", re.I)
CROSS = re.compile(r"\b(\d{1,3})x(\d{1,3})\b", re.I)
WORDS = re.compile(r"\bseries[ ._-]*(\d{1,4})[ ,._-]*(?:episode|ep)[ ._-]*(\d{1,4})\b", re.I)
ISO = re.compile(r"\b((?:19|20)\d{2})[-. _](\d{1,2})[-. _](\d{1,2})\b")
COMPACT = re.compile(r"\b((?:19|20)\d{2})(\d{2})(\d{2})\b")
SPOKEN = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?[ ._-]+([a-z]{3,9})[ ._-]+((?:19|20)\d{2})\b", re.I
)
GROUP = re.compile(r"-[A-Za-z0-9]{2,15}$")
EXTENSION = re.compile(r"\.(mp3|m4a|m4b|aac|flac|ogg|opus|mka|ts|nzb|torrent)$", re.I)
BBC_PID = re.compile(r"(?<![a-z0-9])([bpmw][0-9b-df-hj-np-tv-z]{7})(?![a-z0-9])")


@dataclass
class ParsedRadio:
    show: str
    station: str | None = None
    series: int | None = None
    episode: int | None = None
    aired: date | None = None
    title: str | None = None
    pid: str | None = None
    codec: str | None = None
    bitrate: int | None = None


def key(value: str | None) -> str:
    """Compared without case, accents, punctuation or a leading "The"."""
    if not value:
        return ""
    value = unicodedata.normalize("NFKD", value)
    value = "".join(character for character in value if not unicodedata.combining(character))
    value = value.lower().replace("&", " and ")
    words = re.findall(r"[a-z0-9]+", value)
    if words and words[0] == "the":
        words = words[1:]
    return " ".join(words)


def _date(year, month, day) -> date | None:
    try:
        return date(int(year), int(month), int(day))
    except (TypeError, ValueError):
        return None


def _station(text: str) -> tuple[str | None, str]:
    bracket = BRACKET.match(text)
    if bracket:
        inside = bracket[1].strip()
        if re.search(r"\b(?:bbc|radio|r\d|fm|am)\b", inside, re.I):
            name = re.sub(r"\bR(\d)\b", r"Radio \1", inside, flags=re.I)
            return name.replace("Bbc", "BBC"), text[bracket.end() :]
    for pattern, _ in STATIONS:
        found = pattern.match(text)
        if found:
            name = re.sub(r"[._-]+", " ", found[0]).strip()
            return name, text[found.end() :].lstrip(" ._-")
    return None, text


def parse(name: str) -> ParsedRadio | None:
    """A release name read as a radio episode, or None when no show name is left."""
    codec_match = re.search(r"\b(mp3|aac|m4a|m4b|flac|opus|ogg)\b", name, re.I)
    text = EXTENSION.sub("", name.strip())
    bitrate_match = re.search(r"\b(\d{2,3})\s?kbps\b", text, re.I)
    pid_match = BBC_PID.search(text.lower())
    station, text = _station(text)
    text = GROUP.sub("", text) if re.search(r"[._]", text) and " " not in text else text
    if "." in text and " " not in text:
        text = text.replace(".", " ")
    text = text.replace("_", " ")
    parsed = ParsedRadio(
        show="",
        station=station,
        codec=codec_match[1].lower() if codec_match else None,
        bitrate=int(bitrate_match[1]) if bitrate_match else None,
        pid=pid_match[1] if pid_match and PID.fullmatch(pid_match[1]) else None,
    )
    marks = []
    for pattern in (CODE, WORDS, CROSS):
        found = pattern.search(text)
        if found:
            parsed.series, parsed.episode = int(found[1]), int(found[2])
            marks.append(found)
            break
    for pattern, order in ((ISO, (1, 2, 3)), (COMPACT, (1, 2, 3)), (SPOKEN, (3, 2, 1))):
        found = pattern.search(text)
        if not found:
            continue
        year, month, day = (found[index] for index in order)
        if not month.isdigit():
            month = MONTHS.get(month.lower())
        aired = _date(year, month, day)
        if aired:
            parsed.aired = aired
            marks.append(found)
            break
    cut = min((found.start() for found in marks), default=len(text))
    show = text[:cut]
    rest = text[max((found.end() for found in marks), default=len(text)) :]
    if not marks:
        # "Show - Episode title": the first dash splits the show from the episode.
        parts = re.split(r"\s+-\s+", text, maxsplit=1)
        show, rest = parts[0], parts[1] if len(parts) > 1 else ""
    show = TAGS.sub(" ", show)
    show = re.sub(r"[\[(][^\])]*[\])]", " ", show)
    show = re.sub(r"\s+", " ", show).strip(" -._,:")
    rest = TAGS.sub(" ", rest)
    rest = BBC_PID.sub(" ", rest.lower()) if parsed.pid else rest
    rest = re.sub(r"\b(original|editorial|complete|series|episode)\b", " ", rest, flags=re.I)
    title = re.sub(r"\s+", " ", re.sub(r"[\[(][^\])]*[\])]", " ", rest)).strip(" -._,:")
    parsed.title = title or None
    if not key(show):
        return None
    parsed.show = show
    return parsed


def episode_code(series: int, episode: int) -> str:
    return f"S{series:02d}E{episode:02d}"


GENERIC_TITLE = re.compile(r"^(episode|part|chapter|programme)\s*\d+$", re.I)


def search_terms(show: str, series: int | None, episode: int, aired, title: str | None):
    """Words to search an indexer for one episode, most exact first."""
    terms = []
    if series is not None:
        terms.append(f"{show} {episode_code(series, episode)}")
    if isinstance(aired, datetime):
        aired = aired.date()
    if aired:
        terms.append(f"{show} {aired:%Y %m %d}")
    if title and not GENERIC_TITLE.match(title.strip()) and key(title) != key(show):
        terms.append(f"{show} {title}")
    return list(dict.fromkeys(term.strip() for term in terms))


def same_show(release: ParsedRadio, show: str) -> bool:
    wanted = key(show)
    found = key(release.show)
    if not wanted or not found:
        return False
    if found == wanted:
        return True
    # A station the parser did not know, left in front: "BBC Radio 7 The Goon Show".
    return found.endswith(" " + wanted) and len(found.split()) - len(wanted.split()) <= 4


def refused(categories) -> bool:
    return any(number in blocked for number in categories or () for blocked in REFUSED_CATEGORIES)


def matches(
    release: ParsedRadio,
    *,
    show: str,
    series: int | None,
    episode: int,
    aired=None,
    title: str | None = None,
    pid: str | None = None,
    categories=(),
) -> bool:
    """Whether a parsed release is this episode."""
    if refused(categories):
        return False
    if pid and release.pid:
        return release.pid == pid
    if not same_show(release, show):
        return False
    if release.series is not None and release.episode is not None:
        return series is not None and (release.series, release.episode) == (series, episode)
    if isinstance(aired, datetime):
        aired = aired.date()
    if release.aired and aired:
        return abs(release.aired - aired) <= timedelta(days=1)
    if release.title and title:
        return key(release.title) == key(title)
    return False

"""Series and radio show logos (UX-43): saved once in the config folder and shared by everyone.

Files live under settings.series_logos_root, keyed by id: hardcover-<series id>.png (or .webp
or .svg) for a series, radio-<show id>.png for a radio show. A logo comes from an upload, from a
cut-out of one of the series' covers (made in the browser and uploaded as PNG), or from
Wikimedia Commons.

The real file type is read from the content, never from a name or a header. SVG files are cleaned
with the same defusedxml cleaning as the radio station logos. Commons is reached only through its
fixed API address, and files are downloaded only from upload.wikimedia.org: no other host, so a
search cannot be turned into a request to anywhere else.
"""

import asyncio
import hashlib
import io
import json
import logging
import os
import re
import warnings
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import Response
from PIL import Image

from app.config import get_settings
from app.domain import radio_images
from app.domain.radio_images import ImageError, sanitise_svg

LOG = logging.getLogger(__name__)
MAX_BYTES = 1024 * 1024
MAX_PIXELS = 16_000_000
MAX_SIDE = 8000
KINDS = {"png": "image/png", "webp": "image/webp", "svg": "image/svg+xml"}
SOURCES = ("upload", "cover", "commons")
COLOURS = ("text", "accent")
FILE = re.compile(r"(hardcover-[1-9]\d{0,9}|radio-[0-9a-f-]{36})\.(png|webp|svg)")
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
COMMONS_HOST = "commons.wikimedia.org"
UPLOAD_HOST = "upload.wikimedia.org"
USER_AGENT = "Storyarr/1.0 (self-hosted book manager; https://github.com/TheMightyTRex/storyarr)"
MAX_JSON = 512 * 1024
# Opened directly, a logo still cannot run script or load anything.
HEADERS = {
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
}


def root() -> Path:
    return get_settings().series_logos_root


def key(provider: str, external_id: str) -> str:
    """The file name without its extension; raises ImageError for anything not an id."""
    if provider == "hardcover" and re.fullmatch(r"[1-9]\d{0,9}", external_id or ""):
        return f"hardcover-{external_id}"
    if provider == "radio" and re.fullmatch(
        r"[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}", external_id or ""
    ):
        return f"radio-{external_id}"
    raise ImageError("Not a series or show id")


def kind(data: bytes) -> str:
    """png, webp or svg, read from the content."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    head = data[:1024].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    if head.startswith((b"<?xml", b"<svg", b"<!--")):
        return "svg"
    raise ImageError("Choose a PNG, WebP or SVG file")


def check(data: bytes) -> tuple[str, bytes]:
    """The file's type and the bytes to save: raster images are opened to prove they are images,
    SVG is cleaned of script, event handlers and outside references."""
    if not data:
        raise ImageError("The file is empty")
    if len(data) > MAX_BYTES:
        raise ImageError("The logo is larger than 1 MB")
    found = kind(data)
    if found == "svg":
        return found, sanitise_svg(data)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                if image.format != found.upper():
                    raise ImageError("The file is not the image it claims to be")
                width, height = image.size
                if width > MAX_SIDE or height > MAX_SIDE or width * height > MAX_PIXELS:
                    raise ImageError("The logo is too large: keep it under 8000 pixels a side")
                image.verify()
    except ImageError:
        raise
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError, Warning):
        raise ImageError("The file is not a readable PNG or WebP image") from None
    return found, data


def save(name: str, found: str, data: bytes) -> str:
    """Write <name>.<type> and remove the copy of another type; returns the file name."""
    base = root()
    base.mkdir(parents=True, exist_ok=True)
    file = f"{name}.{found}"
    if not FILE.fullmatch(file):
        raise ImageError("Not a logo file name")
    target = base / file
    temporary = base / f".{file}.{os.getpid()}.part"
    temporary.write_bytes(data)
    os.replace(temporary, target)
    for other in KINDS:
        if other != found:
            (base / f"{name}.{other}").unlink(missing_ok=True)
    return file


def read(file: str | None) -> bytes | None:
    if not file or not FILE.fullmatch(file):
        return None
    try:
        return (root() / file).read_bytes()
    except OSError:
        return None


def remove(file: str | None) -> None:
    if file and FILE.fullmatch(file):
        (root() / file).unlink(missing_ok=True)


def shown_path(file: str) -> str:
    """Where the copy is kept, as shown to people: relative to the config folder."""
    return f"config/series-logos/{file}"


def response(file: str | None, if_none_match: str | None) -> Response | None:
    data = read(file)
    if not data:
        return None
    tag = radio_images.etag(data)
    headers = {"Cache-Control": "private, max-age=86400", "ETag": tag, **HEADERS}
    if tag in {value.strip().removeprefix("W/") for value in (if_none_match or "").split(",")}:
        return Response(status_code=304, headers=headers)
    return Response(data, media_type=KINDS[file.rsplit(".", 1)[1]], headers=headers)


def version(file: str, updated) -> str:
    return hashlib.sha256(f"{file}:{updated.isoformat() if updated else ''}".encode()).hexdigest()[
        :12
    ]


# Wikimedia Commons ---------------------------------------------------------------------------


def allowed(url: str, host: str) -> bool:
    """True only for https://<host>/… with no user, password or other port."""
    try:
        parts = urlsplit(url)
        return (
            parts.scheme == "https"
            and parts.hostname == host
            and parts.port in {None, 443}
            and parts.username is None
            and parts.password is None
            and "\\" not in url
            and not any(ord(character) < 33 for character in url)
        )
    except ValueError:
        return False


@dataclass
class CommonsFile:
    title: str
    thumbnail_url: str | None
    width: int
    height: int
    format: str
    licence: str | None
    source_page: str
    description: str
    probable_wrong_match: bool


def _text(value) -> str:
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return re.sub(r"\s+", " ", text).strip()


def _client(transport=None) -> httpx.AsyncClient:
    proxy = get_settings().metadata_proxy_url
    return httpx.AsyncClient(
        transport=transport,
        proxy=proxy.get_secret_value() if proxy else None,
        trust_env=False,
        follow_redirects=False,
        timeout=httpx.Timeout(15, connect=5),
        headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"},
    )


async def _commons(params: dict, *, transport=None) -> dict:
    url = str(httpx.URL(COMMONS_API, params={**params, "format": "json", "formatversion": "2"}))
    if not allowed(url, COMMONS_HOST):
        raise ImageError("Only Wikimedia Commons can be searched")
    try:
        async with asyncio.timeout(30), _client(transport) as client:
            async with client.stream("GET", url, headers={"Accept": "application/json"}) as answer:
                if answer.status_code != 200:
                    raise ImageError(f"Wikimedia Commons answered {answer.status_code}")
                body = bytearray()
                async for chunk in answer.aiter_raw():
                    if len(body) + len(chunk) > MAX_JSON:
                        raise ImageError("Wikimedia Commons sent too much")
                    body.extend(chunk)
        return json.loads(body)
    except (httpx.HTTPError, TimeoutError, OSError, ValueError):
        raise ImageError("Wikimedia Commons could not be reached") from None


def _files(data: dict, names: list[str]) -> list[CommonsFile]:
    pages = (data.get("query") or {}).get("pages") or []
    if isinstance(pages, dict):
        pages = list(pages.values())
    found = []
    words = [name.casefold() for name in names if name and len(name) > 2]
    for page in sorted(pages, key=lambda page: page.get("index", 0)):
        info = (page.get("imageinfo") or [{}])[0]
        mime = str(info.get("mime") or "")
        form = {"image/png": "png", "image/svg+xml": "svg", "image/webp": "webp"}.get(mime)
        title = str(page.get("title") or "")
        if not form or not title.startswith("File:"):
            continue
        meta = info.get("extmetadata") or {}
        description = _text((meta.get("ImageDescription") or {}).get("value"))[:500]
        about = f"{title} {description} {_text((meta.get('Categories') or {}).get('value'))}"
        thumb = info.get("thumburl")
        source = str(info.get("descriptionurl") or "")
        found.append(
            CommonsFile(
                title=title.removeprefix("File:"),
                thumbnail_url=thumb if thumb and allowed(thumb, UPLOAD_HOST) else None,
                width=int(info.get("width") or 0),
                height=int(info.get("height") or 0),
                format=form,
                licence=_text((meta.get("LicenseShortName") or {}).get("value"))[:200] or None,
                source_page=source if allowed(source, COMMONS_HOST) else "",
                description=description,
                probable_wrong_match=not any(word in about.casefold() for word in words),
            )
        )
    return found


def match_words(name: str, people: list[str]) -> list[str]:
    """The series name, and each person's surname: a file that mentions none is a probable wrong
    match."""
    name = re.sub(r"^(the|a|an)\s+|\s+(series|trilogy|saga)$", "", name.strip(), flags=re.I)
    words = [name]
    for person in people:
        parts = person.replace(".", " ").split()
        if parts:
            words.append(parts[-1])
    return words


async def commons_search(query: str, words: list[str], *, transport=None) -> list[CommonsFile]:
    data = await _commons(
        {
            "action": "query",
            "generator": "search",
            "gsrnamespace": "6",
            "gsrlimit": "8",
            "gsrsearch": f"{query.strip()[:200]} logo",
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata",
            "iiurlwidth": "480",
        },
        transport=transport,
    )
    return _files(data, words)


@dataclass
class CommonsCopy:
    found: str
    data: bytes
    title: str
    licence: str | None
    source_page: str


async def commons_copy(title: str, *, transport=None) -> CommonsCopy:
    """Download one Commons file, only from upload.wikimedia.org, checked like an upload."""
    title = title.strip().removeprefix("File:")
    if not title or len(title) > 240 or any(c in title for c in "|#<>[]{}\n\r"):
        raise ImageError("Not a Wikimedia Commons file name")
    data = await _commons(
        {
            "action": "query",
            "titles": f"File:{title}",
            "prop": "imageinfo",
            "iiprop": "url|size|mime|extmetadata",
            "iiurlwidth": "1200",
        },
        transport=transport,
    )
    pages = (data.get("query") or {}).get("pages") or []
    if isinstance(pages, dict):
        pages = list(pages.values())
    info = ((pages[0] if pages else {}).get("imageinfo") or [{}])[0]
    mime = info.get("mime")
    size = int(info.get("size") or 0)
    # SVG originals are small; large PNGs come as Commons' own 1200px PNG version.
    if mime == "image/svg+xml" and 0 < size <= MAX_BYTES:
        url, kinds = info.get("url"), {"image/svg+xml"}
    elif mime in {"image/png", "image/webp", "image/svg+xml"}:
        url = info.get("url") if mime != "image/svg+xml" and 0 < size <= MAX_BYTES else None
        url = url or info.get("thumburl")
        kinds = {"image/png", "image/webp"}
    else:
        raise ImageError("That Commons file is not a PNG, WebP or SVG image")
    if not url or not allowed(url, UPLOAD_HOST):
        raise ImageError("Commons files are only downloaded from upload.wikimedia.org")
    raw = await radio_images.download(url, kinds, MAX_BYTES, transport=transport)
    found, clean = check(raw)
    meta = info.get("extmetadata") or {}
    source = str(info.get("descriptionurl") or "")
    return CommonsCopy(
        found=found,
        data=clean,
        title=title,
        licence=_text((meta.get("LicenseShortName") or {}).get("value"))[:200] or None,
        source_page=source if allowed(source, COMMONS_HOST) else "",
    )

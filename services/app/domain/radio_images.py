"""Station logos and show artwork, fetched once from the BBC and kept in the config folder.

Files live under settings.radio_images_root as stations/<service id>.svg and
shows/<brand pid>.jpg. They are fetched when a show is added or refreshed, never on a page
view, and served by id through the API. A failed fetch keeps the previous copy, or no image.
SVG logos are cleaned of scripts, event handlers and outside references before they are saved.
"""

import asyncio
import hashlib
import logging
import os
import re
from pathlib import Path
from xml.etree import ElementTree as Serialiser

import httpx
from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

from app.adapters.bbc_programmes import PID, SERVICE_ID
from app.config import get_settings

LOG = logging.getLogger(__name__)
STATION_URL = "https://sounds.files.bbci.co.uk/3.12.0/networks/{id}/blocks-colour_default.svg"
ARTWORK_URL = "https://ichef.bbci.co.uk/images/ic/640x640/{pid}.jpg"
MAX_SVG = 256 * 1024
MAX_JPEG = 2 * 1024 * 1024
SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
# Elements that can run script, load other documents or change links when animated.
UNSAFE = {
    "script",
    "foreignObject",
    "iframe",
    "object",
    "embed",
    "audio",
    "video",
    "image",
    "a",
    "animate",
    "animateMotion",
    "animateTransform",
    "set",
    "handler",
    "listener",
}
UNSAFE_STYLE = re.compile(r"url\(|@import|javascript:|expression\(", re.I)
# Any url() that is not a reference inside the same file, or script in an attribute.
OUTSIDE = re.compile(r"url\((?!\s*['\"]?#)|javascript:|expression\(", re.I)
SVG_HEADERS = {
    # Opened directly, the logo still cannot run script or load anything.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
}


class ImageError(ValueError):
    pass


def root() -> Path:
    return get_settings().radio_images_root


def station_path(service_id: str) -> str:
    if not SERVICE_ID.fullmatch(service_id):
        raise ImageError("Not a BBC service id")
    return f"stations/{service_id}.svg"


def artwork_path(show_pid: str) -> str:
    if not PID.fullmatch(show_pid):
        raise ImageError("Not a BBC programme id")
    return f"shows/{show_pid}.jpg"


async def download(url: str, kinds: set[str], limit: int, *, transport=None) -> bytes:
    proxy = get_settings().metadata_proxy_url
    try:
        async with (
            asyncio.timeout(30),
            httpx.AsyncClient(
                transport=transport,
                proxy=proxy.get_secret_value() if proxy else None,
                trust_env=False,
                follow_redirects=False,
                timeout=httpx.Timeout(15, connect=5),
                headers={
                    "Accept": ",".join(sorted(kinds)),
                    "Accept-Encoding": "identity",
                    "User-Agent": "Storyarr (self-hosted radio catalogue)",
                },
            ) as client,
            client.stream("GET", url) as response,
        ):
            if response.status_code != 200:
                raise ImageError(f"The image server answered {response.status_code}")
            kind = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if kind not in kinds:
                raise ImageError("The image server sent something that is not an image")
            if response.headers.get("content-encoding", "identity").lower() not in {
                "",
                "identity",
            }:
                raise ImageError("Compressed images are not supported")
            content = bytearray()
            async for chunk in response.aiter_raw():
                if len(content) + len(chunk) > limit:
                    raise ImageError("The image is too large")
                content.extend(chunk)
            return bytes(content)
    except (httpx.HTTPError, TimeoutError, OSError):
        raise ImageError("The image server could not be reached") from None


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def sanitise_svg(data: bytes) -> bytes:
    """A copy of the SVG without script, event handlers or references to other files."""
    try:
        document = ElementTree.fromstring(data, forbid_dtd=True)
    except (ElementTree.ParseError, DefusedXmlException, ValueError):
        raise ImageError("The logo is not a readable SVG") from None
    if document.tag != f"{{{SVG_NS}}}svg":
        raise ImageError("The logo is not an SVG")

    def clean(element):
        for child in list(element):
            name = _local(child.tag) if isinstance(child.tag, str) else ""
            if not name or name in UNSAFE:
                element.remove(child)
                continue
            if name == "style" and UNSAFE_STYLE.search(child.text or ""):
                element.remove(child)
                continue
            clean(child)
        for attribute in list(element.attrib):
            name = _local(attribute).lower()
            value = element.attrib[attribute]
            if (
                name.startswith("on")
                or (name == "href" and not value.startswith("#"))
                or OUTSIDE.search(value)
            ):
                del element.attrib[attribute]

    clean(document)
    Serialiser.register_namespace("", SVG_NS)
    Serialiser.register_namespace("xlink", XLINK_NS)
    return Serialiser.tostring(document, encoding="unicode").encode()


def check_jpeg(data: bytes) -> bytes:
    if not data.startswith(b"\xff\xd8\xff") or len(data) < 100:
        raise ImageError("The artwork is not a JPEG image")
    return data


def save(relative: str, data: bytes) -> str:
    base = root()
    target = base / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{os.getpid()}.part")
    temporary.write_bytes(data)
    os.replace(temporary, target)
    return relative


def read(relative: str | None) -> bytes | None:
    if not relative or not re.fullmatch(r"(stations|shows)/[a-z0-9_]{2,60}\.(svg|jpg)", relative):
        return None
    try:
        return (root() / relative).read_bytes()
    except OSError:
        return None


def etag(data: bytes) -> str:
    return '"' + hashlib.sha256(data).hexdigest() + '"'


async def fetch_station_logo(service_id: str, *, transport=None) -> str | None:
    """Fetch and save a station logo; None (keeping any earlier copy) when it fails."""
    try:
        relative = station_path(service_id)
        data = await download(
            STATION_URL.format(id=service_id), {"image/svg+xml"}, MAX_SVG, transport=transport
        )
        return save(relative, sanitise_svg(data))
    except (ImageError, OSError) as error:
        LOG.warning("Station logo for %s not saved: %s", service_id, error)
        return None


async def fetch_artwork(show_pid: str, image_pid: str, *, transport=None) -> str | None:
    """Fetch and save show artwork; None (keeping any earlier copy) when it fails."""
    try:
        relative = artwork_path(show_pid)
        if not PID.fullmatch(image_pid or ""):
            raise ImageError("The show has no BBC image")
        data = await download(
            ARTWORK_URL.format(pid=image_pid), {"image/jpeg"}, MAX_JPEG, transport=transport
        )
        return save(relative, check_jpeg(data))
    except (ImageError, OSError) as error:
        LOG.warning("Artwork for %s not saved: %s", show_pid, error)
        return None

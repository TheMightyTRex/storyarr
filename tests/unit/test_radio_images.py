"""Station logos and show artwork: fetched once, cleaned, saved locally, and no image on failure."""

import httpx
import pytest

from app.config import get_settings
from app.domain import radio_images

LOGO = (
    b'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
    b'viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script>'
    b'<defs><path id="p" d="M0 0h10v10H0z"/></defs>'
    b'<use xlink:href="#p" fill="#004be1"/><use href="https://example.com/x.svg#p"/>'
    b'<rect width="1" height="1" style="fill:url(https://example.com/a)"/>'
    b'<foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>'
    b'<a href="javascript:alert(3)"><path d="M1 1"/></a></svg>'
)
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200


@pytest.fixture(autouse=True)
def images_root(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "radio_images_root", tmp_path / "radio-images")
    return tmp_path / "radio-images"


def serve(status=200, kind="image/svg+xml", body=LOGO, seen=None):
    def respond(request):
        if seen is not None:
            seen.append(str(request.url))
        return httpx.Response(status, headers={"content-type": kind}, stream=httpx.ByteStream(body))

    return httpx.MockTransport(respond)


def test_svg_logos_lose_script_handlers_and_outside_references():
    clean = radio_images.sanitise_svg(LOGO).decode()
    for unsafe in ("script", "alert", "onload", "example.com", "foreignObject", "javascript"):
        assert unsafe not in clean
    assert 'd="M0 0h10v10H0z"' in clean
    assert 'href="#p"' in clean
    assert clean.startswith("<svg")


@pytest.mark.parametrize(
    "data",
    [
        b"<html><body>no</body></html>",
        b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg '
        b'xmlns="http://www.w3.org/2000/svg">&x;</svg>',
        b"not xml",
    ],
)
def test_other_files_are_not_logos(data):
    with pytest.raises(radio_images.ImageError):
        radio_images.sanitise_svg(data)


async def test_station_logo_is_fetched_once_and_saved(images_root):
    seen = []
    path = await radio_images.fetch_station_logo("bbc_radio_four", transport=serve(seen=seen))
    assert path == "stations/bbc_radio_four.svg"
    assert seen == [
        "https://sounds.files.bbci.co.uk/3.12.0/networks/bbc_radio_four/blocks-colour_default.svg"
    ]
    saved = (images_root / path).read_bytes()
    assert b"script" not in saved and radio_images.read(path) == saved


async def test_a_failed_fetch_gives_no_image_and_keeps_the_earlier_copy(images_root):
    assert await radio_images.fetch_station_logo("bbc_radio_four", transport=serve()) is not None
    before = radio_images.read("stations/bbc_radio_four.svg")
    for transport in (serve(404), serve(kind="text/html"), serve(body=b"x" * (300 * 1024))):
        assert await radio_images.fetch_station_logo("bbc_radio_four", transport=transport) is None
    assert radio_images.read("stations/bbc_radio_four.svg") == before
    assert await radio_images.fetch_station_logo("bbc_radio_two", transport=serve(404)) is None
    assert radio_images.read("stations/bbc_radio_two.svg") is None


async def test_show_artwork_is_saved_by_show_pid(images_root):
    seen = []
    path = await radio_images.fetch_artwork(
        "b007mf4f", "p0m1qg1t", transport=serve(kind="image/jpeg", body=JPEG, seen=seen)
    )
    assert path == "shows/b007mf4f.jpg"
    assert seen == ["https://ichef.bbci.co.uk/images/ic/640x640/p0m1qg1t.jpg"]
    assert (images_root / path).read_bytes() == JPEG
    # A page that claims to be a JPEG but is not one is refused.
    assert (
        await radio_images.fetch_artwork(
            "b007mf4f", "p0m1qg1t", transport=serve(kind="image/jpeg", body=b"<html>" * 50)
        )
        is None
    )


async def test_unreachable_image_server_gives_no_image():
    def fail(request):
        raise httpx.ConnectError("no route")

    assert (
        await radio_images.fetch_artwork(
            "b007mf4f", "p0m1qg1t", transport=httpx.MockTransport(fail)
        )
        is None
    )


def test_images_are_read_only_from_their_own_folders():
    for relative in ("../app_key", "stations/../../x.svg", "/etc/passwd", None, "shows/a b.jpg"):
        assert radio_images.read(relative) is None
    with pytest.raises(radio_images.ImageError):
        radio_images.station_path("../x")

"""Series logos: the real file type, SVG cleaning, keys by id and the Wikimedia Commons hosts."""

import io
import json

import httpx
import pytest
from PIL import Image

from app.config import get_settings
from app.domain import logos
from app.domain.radio_images import ImageError


def image(form="PNG", size=(40, 10)) -> bytes:
    buffer = io.BytesIO()
    mode = "RGBA" if form in {"PNG", "WEBP"} else "RGB"
    Image.new(mode, size).save(buffer, form)
    return buffer.getvalue()


SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">'
    b'<script>alert(2)</script><image href="https://example.com/x.png"/>'
    b'<path d="M0 0h10v10H0z"/></svg>'
)


@pytest.fixture(autouse=True)
def logos_root(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "series_logos_root", tmp_path / "series-logos")
    return tmp_path / "series-logos"


def test_the_type_comes_from_the_content_not_the_name():
    assert logos.check(image("PNG"))[0] == "png"
    assert logos.check(image("WEBP"))[0] == "webp"
    found, clean = logos.check(SVG)
    assert found == "svg"
    for unsafe in (b"script", b"alert", b"onload", b"example.com", b"<image"):
        assert unsafe not in clean
    assert b'd="M0 0h10v10H0z"' in clean


@pytest.mark.parametrize(
    "data",
    [
        b"",
        image("JPEG"),
        image("GIF"),
        b"<html><body>not a logo</body></html>",
        b"\x89PNG\r\n\x1a\n" + b"not really a png" * 4,
        b"RIFF\x10\x00\x00\x00WEBPVP8 junk",
        b"MZ\x90\x00 an executable",
        b"\x89PNG\r\n\x1a\n" + b"\x00" * (logos.MAX_BYTES + 1),
    ],
)
def test_other_files_are_refused(data):
    with pytest.raises(ImageError):
        logos.check(data)


def test_huge_images_are_refused_before_they_are_decoded():
    with pytest.raises(ImageError, match="too large"):
        logos.check(image("PNG", (9000, 2)))


def test_files_are_keyed_by_id_only(logos_root):
    assert logos.key("hardcover", "1042") == "hardcover-1042"
    uuid = "0b9d3e0c-2f4b-4d8a-9c1e-5a6b7c8d9e0f"
    assert logos.key("radio", uuid) == f"radio-{uuid}"
    for provider, value in [
        ("hardcover", "../../etc/passwd"),
        ("hardcover", "0"),
        ("hardcover", "12a"),
        ("openlibrary", "OL1W"),
        ("radio", "b007mf4f"),
    ]:
        with pytest.raises(ImageError):
            logos.key(provider, value)
    file = logos.save("hardcover-1042", "png", image())
    assert file == "hardcover-1042.png" and (logos_root / file).exists()
    # A new type replaces the old copy rather than leaving two.
    assert logos.save("hardcover-1042", "svg", logos.check(SVG)[1]) == "hardcover-1042.svg"
    assert not (logos_root / "hardcover-1042.png").exists()
    assert logos.read("hardcover-1042.svg")
    for name in ("../app_key", "hardcover-1042.svg/..", "radio-x.png", "hardcover-1042.jpg"):
        assert logos.read(name) is None
    logos.remove("hardcover-1042.svg")
    assert logos.read("hardcover-1042.svg") is None


def test_only_the_two_wikimedia_hosts_are_allowed():
    assert logos.allowed("https://commons.wikimedia.org/w/api.php?x=1", logos.COMMONS_HOST)
    assert logos.allowed("https://upload.wikimedia.org/a/b.svg", logos.UPLOAD_HOST)
    for url in (
        "http://upload.wikimedia.org/a.svg",
        "https://upload.wikimedia.org.evil.example/a.svg",
        "https://evil.example/upload.wikimedia.org/a.svg",
        "https://user@upload.wikimedia.org/a.svg",
        "https://upload.wikimedia.org:8443/a.svg",
        "https://upload.wikimedia.org\\@evil.example/a.svg",
        "https://127.0.0.1/a.svg",
        "file:///etc/passwd",
    ):
        assert not logos.allowed(url, logos.UPLOAD_HOST), url
    assert not logos.allowed("https://upload.wikimedia.org/a", logos.COMMONS_HOST)


def page(index, title, mime="image/svg+xml", **info):
    return {
        "index": index,
        "title": f"File:{title}",
        "imageinfo": [
            {
                "mime": mime,
                "width": 640,
                "height": 120,
                "size": 900,
                "url": f"https://upload.wikimedia.org/x/{title}",
                "thumburl": f"https://upload.wikimedia.org/thumb/{title}.png",
                "descriptionurl": f"https://commons.wikimedia.org/wiki/File:{title}",
                "extmetadata": {
                    "LicenseShortName": {"value": "Public domain"},
                    "ImageDescription": {"value": "<p>Logo of a <b>student</b> group</p>"},
                },
                **info,
            }
        ],
    }


def commons(pages, seen, files=None):
    def respond(request):
        seen.append(request.url)
        if request.url.host == "commons.wikimedia.org":
            body = json.dumps({"query": {"pages": pages}}).encode()
            return httpx.Response(200, stream=httpx.ByteStream(body))
        body, kind = (files or {}).get(str(request.url), (b"", "text/html"))
        return httpx.Response(200, headers={"content-type": kind}, stream=httpx.ByteStream(body))

    return httpx.MockTransport(respond)


async def test_commons_search_flags_files_that_do_not_mention_the_series_or_author():
    seen = []
    pages = [
        page(2, "Glass Harbour wordmark.svg"),
        page(1, "Harbour Aachen Logo.png", "image/png"),
        page(3, "Photo.jpg", "image/jpeg"),
        page(4, "Elsewhere.svg", thumburl="https://evil.example/t.png"),
    ]
    found = await logos.commons_search(
        "Glass Harbour",
        logos.match_words("The Glass Harbour", ["Mara Ellison"]),
        transport=commons(pages, seen),
    )
    assert [request.host for request in seen] == ["commons.wikimedia.org"]
    assert seen[0].params["gsrsearch"] == "Glass Harbour logo"
    assert [item.title for item in found] == [
        "Harbour Aachen Logo.png",
        "Glass Harbour wordmark.svg",
        "Elsewhere.svg",
    ]
    assert [item.probable_wrong_match for item in found] == [True, False, True]
    assert found[0].description == "Logo of a student group"
    assert found[0].licence == "Public domain"
    # A thumbnail from any other host is dropped, not shown.
    assert found[2].thumbnail_url is None


async def test_commons_copy_downloads_only_from_upload_wikimedia(logos_root):
    seen = []
    pages = [page(1, "Bad.svg", url="https://evil.example/Bad.svg")]
    with pytest.raises(ImageError, match="upload.wikimedia.org"):
        await logos.commons_copy("Bad.svg", transport=commons(pages, seen))
    assert [request.host for request in seen] == ["commons.wikimedia.org"]

    seen.clear()
    url = "https://upload.wikimedia.org/x/Good.svg"
    copy = await logos.commons_copy(
        "File:Good.svg",
        transport=commons([page(1, "Good.svg")], seen, {url: (SVG, "image/svg+xml")}),
    )
    assert [str(request) for request in seen][1:] == [url]
    assert (copy.found, copy.licence, copy.title) == ("svg", "Public domain", "Good.svg")
    assert copy.source_page == "https://commons.wikimedia.org/wiki/File:Good.svg"
    assert b"script" not in copy.data
    for title in ("", "a|b.svg", "x" * 300):
        with pytest.raises(ImageError):
            await logos.commons_copy(title, transport=commons([], []))


def test_match_words_drops_articles_and_closing_series_words():
    assert logos.match_words("The Glass Harbour Series", ["M. Ellison"]) == [
        "Glass Harbour",
        "Ellison",
    ]
    assert logos.match_words("Saga", []) == ["Saga"]
    # A long run of spaces stays quick.
    assert logos.match_words("x" + " " * 50_000 + "y", []) == ["x" + " " * 50_000 + "y"]

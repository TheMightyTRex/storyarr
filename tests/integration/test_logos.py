"""Series and radio show logos through the API: who can change them, upload, colour, remove,
Wikimedia Commons and ETags."""

import io
from uuid import UUID

import httpx
import pytest
from PIL import Image
from sqlalchemy import select

from app.db.models import AuditEvent, RadioShow, SeriesLogo
from app.domain import logos, radio_images

pytestmark = pytest.mark.integration
SERIES = "/api/catalog/series/hardcover/1042"
SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 2" onload="alert(1)">'
    b'<script>alert(2)</script><path d="M0 0h8v2H0z"/></svg>'
)


def png(size=(40, 10)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGBA", size, (0, 0, 0, 0)).save(buffer, "PNG")
    return buffer.getvalue()


@pytest.fixture(autouse=True)
def logos_root(tmp_path, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "series_logos_root", tmp_path / "series-logos")
    return tmp_path / "series-logos"


async def sign_in(client, username, role):
    from app.main import create_app

    created = await client.post(
        "/api/auth/users",
        json={
            "username": username,
            "password": f"a long {username} password",
            "display_name": username.title(),
            "role": role,
        },
    )
    assert created.status_code == 201, created.text
    other = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=create_app()),
        base_url="http://testserver",
        headers={"Origin": "http://testserver"},
    )
    signed = await other.post(
        "/api/auth/login", json={"username": username, "password": f"a long {username} password"}
    )
    assert signed.status_code == 200, signed.text
    other.headers["X-CSRF-Token"] = signed.json()["csrf_token"]
    return other


async def upload(client, path, data, kind="image/png", **params):
    return await client.put(path, content=data, headers={"Content-Type": kind}, params=params)


async def test_admins_save_a_series_logo_that_everyone_sees(client, admin, database, logos_root):
    saved = await upload(client, SERIES + "/logo", png(), source="cover", title="Book 1")
    assert saved.status_code == 200, saved.text
    view = saved.json()
    assert view["format"] == "png" and view["source"] == "cover" and view["colour"] == "text"
    assert view["saved_path"] == "config/series-logos/hardcover-1042.png"
    assert view["source_title"] == "Book 1"
    assert view["url"].startswith(SERIES + "/logo?v=")
    assert (logos_root / "hardcover-1042.png").read_bytes() == png()

    # The series page carries the logo even before the series is loaded.
    detail = (await client.get(SERIES)).json()
    assert detail["logo"]["url"] == view["url"]

    member = await sign_in(client, "member", "member")
    viewer = await sign_in(client, "viewer", "viewer")
    try:
        for reader in (client, member, viewer):
            image = await reader.get(view["url"])
            assert image.status_code == 200 and image.content == png()
            assert image.headers["content-type"] == "image/png"
            assert image.headers["x-content-type-options"] == "nosniff"
            assert "sandbox" in image.headers["content-security-policy"]
            again = await reader.get(view["url"], headers={"If-None-Match": image.headers["etag"]})
            assert again.status_code == 304
        assert (await member.get(SERIES)).json()["logo"]["url"] == view["url"]
        # Only admins change the shared logo.
        for other in (member, viewer):
            assert (await upload(other, SERIES + "/logo", png())).status_code == 403
            assert (
                await other.patch(SERIES + "/logo", json={"colour": "accent"})
            ).status_code == 403
            assert (await other.delete(SERIES + "/logo")).status_code == 403
            assert (
                await other.post(SERIES + "/logo/commons", json={"title": "x.svg"})
            ).status_code == 403
        assert (await viewer.get("/api/logos/commons", params={"q": "x"})).status_code == 403
    finally:
        await member.aclose()
        await viewer.aclose()

    coloured = await client.patch(SERIES + "/logo", json={"colour": "accent"})
    assert coloured.status_code == 200 and coloured.json()["colour"] == "accent"
    assert (await client.patch(SERIES + "/logo", json={"colour": "pink"})).status_code == 422

    # An SVG replaces the PNG, cleaned, whatever the request says it is.
    replaced = await upload(client, SERIES + "/logo", SVG, kind="image/png")
    assert replaced.status_code == 200 and replaced.json()["format"] == "svg"
    assert replaced.json()["url"] != view["url"]
    assert not (logos_root / "hardcover-1042.png").exists()
    served = await client.get(replaced.json()["url"])
    assert served.headers["content-type"] == "image/svg+xml"
    assert b"script" not in served.content and b"onload" not in served.content

    removed = await client.delete(SERIES + "/logo")
    assert removed.status_code == 204
    assert (await client.get(SERIES + "/logo")).status_code == 404
    assert not (logos_root / "hardcover-1042.svg").exists()
    assert (await client.get(SERIES)).json()["logo"] is None
    async with database() as db:
        assert await db.get(SeriesLogo, ("hardcover", "1042")) is None
        actions = list(await db.scalars(select(AuditEvent.action).order_by(AuditEvent.created_at)))
    assert actions.count("series.logo.saved") == 2 and "series.logo.removed" in actions


async def test_uploads_are_checked_by_content_and_size(client, admin, logos_root):
    for data in (b"<html>no</html>", b"GIF89a" + b"\x00" * 50, b"\x89PNG\r\n\x1a\nbroken"):
        refused = await upload(client, SERIES + "/logo", data)
        assert refused.status_code == 422, refused.text
    big = await upload(client, SERIES + "/logo", b"\x89PNG\r\n\x1a\n" + b"\x00" * logos.MAX_BYTES)
    assert big.status_code == 413
    assert (await upload(client, "/api/catalog/series/hardcover/x1/logo", png())).status_code == 422
    assert (await client.get("/api/catalog/series/hardcover/1042/logo")).status_code == 404
    assert not logos_root.exists() or not any(logos_root.iterdir())


async def test_a_commons_file_is_copied_once_with_its_licence(
    client, admin, monkeypatch, logos_root
):
    calls = []

    async def commons(params, *, transport=None):
        calls.append(params)
        info = {
            "mime": "image/svg+xml",
            "size": 400,
            "width": 640,
            "height": 120,
            "url": "https://upload.wikimedia.org/a/Glass_Harbour.svg",
            "thumburl": "https://upload.wikimedia.org/t/Glass_Harbour.png",
            "descriptionurl": "https://commons.wikimedia.org/wiki/File:Glass_Harbour.svg",
            "extmetadata": {"LicenseShortName": {"value": "CC BY-SA 4.0"}},
        }
        return {
            "query": {
                "pages": [{"index": 1, "title": "File:Glass Harbour.svg", "imageinfo": [info]}]
            }
        }

    async def download(url, kinds, limit, *, transport=None):
        calls.append(url)
        return SVG

    monkeypatch.setattr(logos, "_commons", commons)
    monkeypatch.setattr(radio_images, "download", download)
    found = await client.get(
        "/api/logos/commons",
        params={"q": "Glass Harbour", "name": "The Glass Harbour", "people": ["Mara Ellison"]},
    )
    assert found.status_code == 200, found.text
    (item,) = found.json()["items"]
    assert item["title"] == "Glass Harbour.svg" and item["probable_wrong_match"] is False
    assert item["licence"] == "CC BY-SA 4.0"
    copied = await client.post(
        SERIES + "/logo/commons", json={"title": "Glass Harbour.svg", "colour": "accent"}
    )
    assert copied.status_code == 200, copied.text
    view = copied.json()
    assert (view["source"], view["licence"], view["colour"]) == (
        "commons",
        "CC BY-SA 4.0",
        "accent",
    )
    assert view["source_url"] == "https://commons.wikimedia.org/wiki/File:Glass_Harbour.svg"
    assert calls[-1] == "https://upload.wikimedia.org/a/Glass_Harbour.svg"
    assert b"script" not in (logos_root / "hardcover-1042.svg").read_bytes()


async def test_radio_show_owners_change_their_show_logo(client, admin, database, logos_root):
    async with database() as db:
        show = RadioShow(
            owner_id=UUID(admin["id"]), provider="bbc", external_id="b007mf4f", title="Show"
        )
        db.add(show)
        await db.commit()
        show_id = show.id
    base = f"/api/radio/shows/{show_id}/logo"
    saved = await upload(client, base, png(), source="cover", title="From the artwork")
    assert saved.status_code == 200, saved.text
    assert saved.json()["saved_path"] == f"config/series-logos/radio-{show_id}.png"
    shown = (await client.get(f"/api/radio/shows/{show_id}")).json()
    assert shown["logo"]["source"] == "cover" and shown["logo_source"] == "cover"
    image = await client.get(saved.json()["url"])
    assert image.status_code == 200
    assert (
        await client.get(base, headers={"If-None-Match": image.headers["etag"]})
    ).status_code == 304
    assert (await client.patch(base, json={"colour": "accent"})).json()["colour"] == "accent"

    member = await sign_in(client, "member", "member")
    try:
        # Shows belong to the person who added them: nobody else sees or changes the logo.
        assert (await member.get(base)).status_code == 404
        assert (await upload(member, base, png())).status_code == 404
        assert (await member.delete(base)).status_code == 404
    finally:
        await member.aclose()

    assert (await client.delete(base)).status_code == 204
    assert (await client.get(base)).status_code == 404
    assert (await client.get(f"/api/radio/shows/{show_id}")).json()["logo"] is None
    assert not (logos_root / f"radio-{show_id}.png").exists()

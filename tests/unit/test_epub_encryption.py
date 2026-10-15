"""Font obfuscation is readable EPUB packaging, not permission to import DRM content."""

import zipfile

import pytest

from app.importing.inspection import inspect_download
from tests.media_fixtures import epub


def test_standard_font_obfuscation_keeps_readable_metadata_and_original_bytes(tmp_path):
    path = tmp_path / "book.epub"
    epub(path, obfuscated_font=True)
    original = path.read_bytes()
    snapshot = inspect_download(tmp_path, path.name)
    [file] = snapshot["files"]
    assert file["state"] == "inspected", file
    assert file["metadata"]["title"] == "First Harbor"
    assert file["metadata"]["authors"] == ["Alex Morgan"]
    assert len(snapshot["groups"]) == 1
    assert path.read_bytes() == original


@pytest.mark.parametrize(
    "change",
    [
        "unknown-algorithm",
        "encrypted-chapter",
        "undeclared-font",
        "missing-font",
        "external-reference",
        "escaped-reference",
        "fragment-reference",
        "cipher-value",
        "transforms",
        "empty-document",
        "duplicate-method",
        "mixed-encryption",
        "font-in-spine",
        "non-font-alias",
        "entity",
    ],
)
def test_other_encryption_stays_held(tmp_path, change):
    path = tmp_path / "book.epub"
    epub(path, obfuscated_font=True)
    with zipfile.ZipFile(path) as archive:
        entries = {name: archive.read(name) for name in archive.namelist()}
    encryption = entries["META-INF/encryption.xml"].decode()
    package = entries["OEBPS/book.opf"].decode()
    if change == "unknown-algorithm":
        encryption = encryption.replace("http://www.idpf.org/2008/embedding", "urn:unknown")
    elif change == "encrypted-chapter":
        encryption = encryption.replace("OEBPS/font.woff", "OEBPS/chapter.xhtml")
    elif change == "undeclared-font":
        package = package.replace('media-type="font/woff"', 'media-type="application/octet-stream"')
    elif change == "missing-font":
        del entries["OEBPS/font.woff"]
    elif change in {"external-reference", "escaped-reference", "fragment-reference"}:
        uri = {
            "external-reference": "https://example.test/font.woff",
            "escaped-reference": "%2e%2e/OEBPS/font.woff",
            "fragment-reference": "OEBPS/font.woff#data",
        }[change]
        encryption = encryption.replace("OEBPS/font.woff", uri)
    elif change == "cipher-value":
        encryption = encryption.replace(
            '<enc:CipherReference URI="OEBPS/font.woff"/>',
            "<enc:CipherValue>AAAA</enc:CipherValue>",
        )
    elif change == "transforms":
        encryption = encryption.replace(
            '<enc:CipherReference URI="OEBPS/font.woff"/>',
            '<enc:CipherReference URI="OEBPS/font.woff"><enc:Transforms/></enc:CipherReference>',
        )
    elif change == "empty-document":
        encryption = '<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"/>'
    elif change == "duplicate-method":
        encryption = encryption.replace(
            "<enc:CipherData>", '<enc:EncryptionMethod Algorithm="urn:unknown"/><enc:CipherData>'
        )
    elif change == "mixed-encryption":
        extra = encryption.split("<enc:EncryptedData>")[1].split("</enc:EncryptedData>")[0]
        encryption = encryption.replace(
            "</encryption>",
            "<enc:EncryptedData>"
            + extra.replace("OEBPS/font.woff", "OEBPS/chapter.xhtml")
            + "</enc:EncryptedData></encryption>",
        )
    elif change == "font-in-spine":
        package = package.replace("</spine>", '<itemref idref="font"/></spine>')
    elif change == "non-font-alias":
        package = package.replace(
            "</manifest>",
            '<item id="alias" href="font.woff" media-type="application/xhtml+xml"/></manifest>',
        )
    elif change == "entity":
        encryption = '<!DOCTYPE encryption [<!ENTITY bad SYSTEM "file:///etc/passwd">]>' + (
            encryption.replace("<enc:EncryptedData>", "&bad;<enc:EncryptedData>")
        )
    entries["META-INF/encryption.xml"] = encryption.encode()
    entries["OEBPS/book.opf"] = package.encode()
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    snapshot = inspect_download(tmp_path, path.name)
    assert snapshot["files"][0]["state"] == "held"
    assert not snapshot["groups"]
    assert "root:" not in str(snapshot)

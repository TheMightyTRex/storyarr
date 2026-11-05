"""Reading a web address someone pasted (a podcast feed, a show's web page or its artwork).

The address is not trusted, so every connection, and every redirect, must go to a public
address: names are resolved first, every address they give must be public, and the connection
is pinned to a checked address (no second lookup can rebind it). Bodies are size limited and
the whole read has a deadline.
"""

import asyncio
import contextvars
import ipaddress
import logging
import socket
from contextlib import AsyncExitStack
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx

from app.adapters.contracts import AdapterError, FailureKind
from app.network_addresses import public_address

LOG = logging.getLogger(__name__)
USER_AGENT = "Storyarr (self-hosted radio catalogue)"
MAX_REDIRECTS = 5
DEADLINE = 30
_reading = contextvars.ContextVar("public_web_reading", default=False)


class _QuietAddresses(logging.Filter):
    def filter(self, record):
        # HTTPX logs whole addresses; private feeds carry their key in the address.
        return not _reading.get()


logging.getLogger("httpx").addFilter(_QuietAddresses())


@dataclass
class Page:
    url: str
    content_type: str
    body: bytes
    # For conditional reads: what the server said identifies this version, and whether it
    # answered "not modified" to the validators sent (then the body is empty).
    etag: str | None = None
    last_modified: str | None = None
    not_modified: bool = False


def problem(message: str, kind=FailureKind.UNAVAILABLE) -> AdapterError:
    return AdapterError(kind, message)


def checked_url(url: str) -> tuple[str, str, int]:
    """(scheme, host, port) of an http or https address with no user name in it."""
    try:
        parts = urlsplit(url)
        host = (parts.hostname or "").lower()
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError:
        raise problem("This is not a web address", FailureKind.NOT_FOUND) from None
    if parts.scheme not in {"http", "https"} or not host or parts.username or parts.password:
        raise problem("Use an http or https web address", FailureKind.NOT_FOUND)
    if any(ord(character) < 33 for character in url) or len(url) > 2000:
        raise problem("This is not a web address", FailureKind.NOT_FOUND)
    return parts.scheme, host, port


async def public_addresses(host: str, port: int) -> list[str]:
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        literal = None
    if literal is not None:
        addresses = [str(literal)]
    else:
        try:
            records = await asyncio.get_running_loop().getaddrinfo(
                host, port, type=socket.SOCK_STREAM
            )
        except OSError:
            raise problem("The web address could not be found") from None
        addresses = list(dict.fromkeys(record[4][0] for record in records))
    if not addresses or any(not public_address(address) for address in addresses):
        raise problem(
            "Storyarr only reads web addresses on the public internet", FailureKind.PERMISSION
        )
    return addresses


async def fetch(
    url: str,
    *,
    accept: str,
    limit: int,
    transport=None,
    resolver=public_addresses,
    validators: tuple[str | None, str | None] | None = None,
) -> Page:
    """The body of a public web address, following up to five redirects, each checked."""
    marker = _reading.set(True)
    try:
        async with (
            asyncio.timeout(DEADLINE),
            httpx.AsyncClient(
                transport=transport,
                trust_env=False,
                follow_redirects=False,
                timeout=httpx.Timeout(15, connect=5),
                headers={
                    "Accept": accept,
                    "Accept-Encoding": "gzip, identity",
                    "User-Agent": USER_AGENT,
                },
            ) as client,
        ):
            etag, modified = validators or (None, None)
            conditional = {
                **({"If-None-Match": etag} if etag else {}),
                **({"If-Modified-Since": modified} if modified else {}),
            }
            for _ in range(MAX_REDIRECTS + 1):
                scheme, host, port = checked_url(url)
                addresses = await resolver(host, port)
                if not addresses or any(not public_address(address) for address in addresses):
                    raise problem(
                        "Storyarr only reads web addresses on the public internet",
                        FailureKind.PERMISSION,
                    )
                async with AsyncExitStack() as streams:
                    response = None
                    for address in addresses[:4]:
                        target = httpx.URL(url).copy_with(host=address)
                        client.cookies.clear()
                        try:
                            response = await streams.enter_async_context(
                                client.stream(
                                    "GET",
                                    target,
                                    headers={
                                        "Host": host if port in {80, 443} else f"{host}:{port}",
                                        **conditional,
                                    },
                                    extensions={"sni_hostname": host} if scheme == "https" else {},
                                )
                            )
                            break
                        except (httpx.ConnectError, httpx.ConnectTimeout):
                            continue
                    if response is None:
                        raise problem("The web address could not be reached")
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get("location")
                        if not location:
                            raise problem("The web address sent an incomplete redirect")
                        url = urljoin(url, location)
                        continue
                    if response.status_code == 304 and conditional:
                        return Page(url=url, content_type="", body=b"", not_modified=True)
                    if response.status_code == 404:
                        raise problem(
                            "Nothing was found at this web address", FailureKind.NOT_FOUND
                        )
                    if response.status_code == 429:
                        raise problem("The web site is limiting requests", FailureKind.RATE_LIMIT)
                    if response.status_code != 200:
                        raise problem(f"The web site answered {response.status_code}")
                    body = bytearray()
                    # aiter_bytes decodes gzip, so the limit applies to what is unpacked.
                    async for chunk in response.aiter_bytes():
                        if len(body) + len(chunk) > limit:
                            raise problem("The web page is too large", FailureKind.PARSER)
                        body.extend(chunk)
                    kind = response.headers.get("content-type", "").split(";", 1)[0]
                    return Page(
                        url=url,
                        content_type=kind.strip().lower(),
                        body=bytes(body),
                        etag=(response.headers.get("etag") or "")[:250] or None,
                        last_modified=(response.headers.get("last-modified") or "")[:100] or None,
                    )
            raise problem("The web address redirects too many times")
    except (TimeoutError, httpx.TimeoutException):
        raise problem("The web site did not answer in time", FailureKind.TIMEOUT) from None
    except httpx.HTTPError as error:
        LOG.info("Reading a public web address failed: %s", type(error).__name__)
        raise problem("The web address could not be reached") from None
    finally:
        _reading.reset(marker)

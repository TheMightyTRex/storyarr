"""Refuse request bodies over 5 MB before they are read into memory."""

import json

# The largest body any page sends: a reading list CSV (4 MB, app.adapters.list_csv) with room to
# spare. Logo uploads keep their own, smaller limit (1 MB).
LIMIT = 5 * 1024 * 1024
TOO_LARGE = json.dumps({"detail": "This request is too large"}).encode()


async def refuse(send) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(TOO_LARGE)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": TOO_LARGE})


class BodyLimit:
    """
    Nothing else limits a request body, so without this anyone who can reach the port, signed in or
    not, could make Storyarr hold a body of any size in memory (security check, 3 November 2026).
    A declared size over the limit is refused at once. A streamed body is counted as it arrives:
    once it passes the limit the answer is 413, and the page sees the browser as gone.
    """

    def __init__(self, app, limit: int = LIMIT):
        self.app = app
        self.limit = limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > self.limit):
            return await refuse(send)
        received = 0
        refused = started = False

        async def counted():
            nonlocal received, refused
            if refused:
                return {"type": "http.disconnect"}
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.limit:
                    refused = True
                    if not started:
                        await refuse(send)
                    return {"type": "http.disconnect"}
            return message

        async def answer(message):
            nonlocal started
            # After a 413 the page's own answer, if any, is dropped: the browser already has one.
            if not refused:
                started = True
                await send(message)

        await self.app(scope, counted, answer)

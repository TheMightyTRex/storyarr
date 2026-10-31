"""Stop a page's database work when the browser leaves before the answer arrives."""

import asyncio


class CancelOnDisconnect:
    """
    For API reads (GET and HEAD), cancel the request when the browser disconnects, for example after
    moving to another page. Cancelling the task makes the database driver cancel its running query,
    so an abandoned page no longer keeps a database connection busy. Writes always run to the end,
    so a change is never left half done. Once the answer has started, the request also runs to the
    end: servers report a disconnect as soon as a response is complete, and the clean-up after it
    (closing the database session, background tasks) must still happen.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope["method"] not in {"GET", "HEAD"}
            or not scope["path"].startswith("/api/")
        ):
            await self.app(scope, receive, send)
            return
        messages: asyncio.Queue = asyncio.Queue()
        gone = asyncio.Event()
        answered = asyncio.Event()

        async def listen():
            while True:
                message = await receive()
                await messages.put(message)
                if message["type"] == "http.disconnect":
                    if not answered.is_set():
                        gone.set()
                        handler.cancel()
                    return

        async def answer(message):
            if message["type"] == "http.response.start":
                answered.set()
            await send(message)

        handler = asyncio.ensure_future(self.app(scope, messages.get, answer))
        listener = asyncio.ensure_future(listen())
        try:
            await handler
        except asyncio.CancelledError:
            if not gone.is_set():
                raise
            # The browser has gone, so there is no one to answer.
        finally:
            listener.cancel()

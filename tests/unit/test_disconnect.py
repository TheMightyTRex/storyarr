import asyncio

from app.disconnect import CancelOnDisconnect


def scope(method="GET", path="/api/requests"):
    return {"type": "http", "method": method, "path": path}


async def run(method, path="/api/requests"):
    state = {"finished": False, "cancelled": False}

    async def slow(scope, receive, send):
        await receive()
        try:
            await asyncio.sleep(5)
            state["finished"] = True
        except asyncio.CancelledError:
            state["cancelled"] = True
            raise

    sent = [{"type": "http.request", "body": b"", "more_body": False}]

    async def receive():
        if sent:
            return sent.pop()
        await asyncio.sleep(0.05)  # The browser leaves shortly after asking.
        return {"type": "http.disconnect"}

    async def send(message):
        pass

    await asyncio.wait_for(CancelOnDisconnect(slow)(scope(method, path), receive, send), 1)
    return state


async def test_a_page_read_stops_when_the_browser_leaves():
    assert await run("GET") == {"finished": False, "cancelled": True}


async def test_writes_and_non_api_requests_are_left_alone():
    for method, path in (("POST", "/api/requests"), ("GET", "/assets/app.js")):
        try:
            await asyncio.wait_for(run(method, path), 0.2)
        except TimeoutError:
            continue  # Still running after the browser left: not cancelled.
        raise AssertionError(f"{method} {path} was cancelled")

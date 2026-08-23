"""Unit tests for EventBroadcaster (services/events.py)."""
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.events import EventBroadcaster


@pytest.fixture
def broadcaster():
    return EventBroadcaster()


# ── _subscribe / _unsubscribe ──────────────────────────────────────────────────

def test_subscribe_adds_queue_to_project(broadcaster):
    q = broadcaster._subscribe("proj-1")
    assert q in broadcaster._queues["proj-1"]
    assert isinstance(q, asyncio.Queue)


def test_unsubscribe_removes_queue(broadcaster):
    q = broadcaster._subscribe("proj-1")
    broadcaster._unsubscribe("proj-1", q)
    assert q not in broadcaster._queues["proj-1"]


def test_unsubscribe_nonexistent_queue_does_not_raise(broadcaster):
    q: asyncio.Queue = asyncio.Queue()
    broadcaster._unsubscribe("proj-1", q)  # must not raise


def test_multiple_subscriptions_tracked_independently(broadcaster):
    q1 = broadcaster._subscribe("proj-1")
    q2 = broadcaster._subscribe("proj-1")
    assert q1 in broadcaster._queues["proj-1"]
    assert q2 in broadcaster._queues["proj-1"]
    broadcaster._unsubscribe("proj-1", q1)
    assert q1 not in broadcaster._queues["proj-1"]
    assert q2 in broadcaster._queues["proj-1"]


# ── broadcast ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_broadcast_puts_payload_in_subscriber_queue(broadcaster):
    q = broadcaster._subscribe("proj-1")
    await broadcaster.broadcast("proj-1", "feature_created", {"id": "abc"})
    item = q.get_nowait()
    assert item == {"type": "feature_created", "data": {"id": "abc"}}


@pytest.mark.asyncio
async def test_broadcast_delivers_to_all_subscribers(broadcaster):
    q1 = broadcaster._subscribe("proj-1")
    q2 = broadcaster._subscribe("proj-1")
    await broadcaster.broadcast("proj-1", "update", {"x": 1})
    assert q1.get_nowait() == {"type": "update", "data": {"x": 1}}
    assert q2.get_nowait() == {"type": "update", "data": {"x": 1}}


@pytest.mark.asyncio
async def test_broadcast_does_not_cross_project_boundaries(broadcaster):
    q_other = broadcaster._subscribe("proj-2")
    await broadcaster.broadcast("proj-1", "update", {})
    assert q_other.empty()


@pytest.mark.asyncio
async def test_broadcast_to_project_with_no_subscribers_does_not_raise(broadcaster):
    await broadcaster.broadcast("proj-no-sub", "update", {})  # must not raise


# ── stream ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_stream_yields_connected_event_first(broadcaster):
    request = MagicMock()
    request.is_disconnected = AsyncMock(return_value=True)

    gen = broadcaster.stream("proj-1", request)
    first = await gen.__anext__()
    payload = json.loads(first.removeprefix("data: ").strip())
    assert payload == {"type": "connected"}
    await gen.aclose()


@pytest.mark.asyncio
async def test_stream_unsubscribes_on_disconnect(broadcaster):
    request = MagicMock()
    request.is_disconnected = AsyncMock(return_value=True)

    gen = broadcaster.stream("proj-1", request)
    await gen.__anext__()  # connected
    await gen.aclose()
    assert len(broadcaster._queues["proj-1"]) == 0


@pytest.mark.asyncio
async def test_stream_yields_broadcast_event(broadcaster):
    request = MagicMock()
    # First iteration: not disconnected → receive event; second: disconnected → stop
    request.is_disconnected = AsyncMock(side_effect=[False, True])

    gen = broadcaster.stream("proj-1", request)
    await gen.__anext__()  # connected

    await broadcaster.broadcast("proj-1", "test_event", {"x": 42})
    event_str = await gen.__anext__()
    payload = json.loads(event_str.removeprefix("data: ").strip())
    assert payload == {"type": "test_event", "data": {"x": 42}}
    await gen.aclose()


@pytest.mark.asyncio
async def test_stream_sends_keepalive_on_timeout(broadcaster):
    request = MagicMock()
    # First iteration: not disconnected → timeout fires; second: disconnected → stop
    request.is_disconnected = AsyncMock(side_effect=[False, True])

    gen = broadcaster.stream("proj-1", request)
    await gen.__anext__()  # connected

    # The real wait_for takes ownership of the coroutine it is handed; a plain
    # side_effect leaves q.get() un-awaited and warns when it is collected.
    async def timeout_immediately(coro, timeout):  # noqa: ANN001, ARG001
        coro.close()
        raise asyncio.TimeoutError

    with patch("app.services.events.asyncio.wait_for", timeout_immediately):
        keepalive = await gen.__anext__()

    assert keepalive == ": keepalive\n\n"
    await gen.aclose()


@pytest.mark.asyncio
async def test_stream_stops_when_client_disconnects(broadcaster):
    request = MagicMock()
    request.is_disconnected = AsyncMock(return_value=True)

    gen = broadcaster.stream("proj-1", request)
    await gen.__anext__()  # connected
    with pytest.raises(StopAsyncIteration):
        # Loop runs, is_disconnected returns True → break → generator exhausted
        await gen.__anext__()


@pytest.mark.asyncio
async def test_stream_unsubscribes_even_on_exception(broadcaster):
    request = MagicMock()
    request.is_disconnected = AsyncMock(side_effect=RuntimeError("boom"))

    gen = broadcaster.stream("proj-1", request)
    await gen.__anext__()  # connected
    with pytest.raises(RuntimeError):
        await gen.__anext__()

    assert len(broadcaster._queues["proj-1"]) == 0

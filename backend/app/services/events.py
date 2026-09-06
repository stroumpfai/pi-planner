import asyncio
import json
from collections import defaultdict
from typing import Any, AsyncGenerator

from fastapi import Request


def team_channel(team_id: str) -> str:
    """The broadcast channel for a team.

    Teams are a separate aggregate from projects and are edited without a project
    lock, so their events need their own channel. Prefixing keeps the two from
    colliding in the one keyspace the broadcaster has.
    """
    return f"team:{team_id}"


class EventBroadcaster:
    """In-process SSE broadcaster keyed by channel.

    A channel is a project's ``system_id`` or, for team data, ``team:<team_id>``
    (see ``team_channel``).
    """

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue[dict[str, Any]]]] = defaultdict(list)

    def _subscribe(self, channel: str) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._queues[channel].append(q)
        return q

    def _unsubscribe(self, channel: str, q: asyncio.Queue[dict[str, Any]]) -> None:
        try:
            self._queues[channel].remove(q)
        except ValueError:
            pass

    async def broadcast(self, channel: str, event_type: str, data: dict[str, Any]) -> None:
        payload = {"type": event_type, "data": data}
        for q in self._queues[channel]:
            await q.put(payload)

    async def stream(self, channel: str, request: Request) -> AsyncGenerator[str, None]:
        q = self._subscribe(channel)
        try:
            yield f"data: {json.dumps({'type': 'connected'})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            self._unsubscribe(channel, q)


broadcaster = EventBroadcaster()

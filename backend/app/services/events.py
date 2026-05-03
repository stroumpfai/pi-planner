import asyncio
import json
from collections import defaultdict
from typing import Any, AsyncGenerator

from fastapi import Request


class EventBroadcaster:
    """In-process SSE broadcaster keyed by project_id."""

    def __init__(self) -> None:
        self._queues: dict[str, list[asyncio.Queue[dict[str, Any]]]] = defaultdict(list)

    def _subscribe(self, project_id: str) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._queues[project_id].append(q)
        return q

    def _unsubscribe(self, project_id: str, q: asyncio.Queue[dict[str, Any]]) -> None:
        try:
            self._queues[project_id].remove(q)
        except ValueError:
            pass

    async def broadcast(self, project_id: str, event_type: str, data: dict[str, Any]) -> None:
        payload = {"type": event_type, "data": data}
        for q in list(self._queues[project_id]):
            await q.put(payload)

    async def stream(self, project_id: str, request: Request) -> AsyncGenerator[str, None]:
        q = self._subscribe(project_id)
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
            self._unsubscribe(project_id, q)


broadcaster = EventBroadcaster()

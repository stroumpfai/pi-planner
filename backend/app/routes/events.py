from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app.services.events import broadcaster

router = APIRouter(tags=["events"])


@router.get("/api/v1/projects/{project_id}/events")
async def project_events(project_id: str, request: Request) -> StreamingResponse:
    return StreamingResponse(
        broadcaster.stream(project_id, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )

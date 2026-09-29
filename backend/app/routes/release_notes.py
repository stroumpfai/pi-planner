"""The Release Notes modal's data (docs/RELEASE-NOTES.md, parsed).

Read-only, all roles: informational content, not project data, so a reader
should see it exactly like an editor or admin.
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.config import settings
from app.middleware.deps import get_current_user
from app.models.user import User
from app.schemas.release_notes import ReleaseNotesResponse
from app.services.release_notes import load_release_notes

router = APIRouter(prefix="/api/v1/release-notes", tags=["release-notes"])


@router.get("")
async def get_release_notes(_: Annotated[User, Depends(get_current_user)]) -> ReleaseNotesResponse:
    """docs/RELEASE-NOTES.md, parsed into sections. Empty when the file is missing."""
    return ReleaseNotesResponse(entries=load_release_notes(settings.release_notes_file))

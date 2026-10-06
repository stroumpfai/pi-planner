"""Receiving a calendar file over HTTP, for both ``.ics`` importers.

Kept out of `ics.py`, which is pure parsing with no web framework in it, the
way `concurrency.py` holds the HTTP side of `If-Match`.
"""

from fastapi import HTTPException, UploadFile, status

from app.services.ics import MAX_ICS_BYTES


async def read_ics_upload(file: UploadFile) -> bytes:
    """The uploaded file, refused past the size cap rather than read whole."""
    content = await file.read(MAX_ICS_BYTES + 1)
    if len(content) > MAX_ICS_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail={
                "error": "ICS_TOO_LARGE",
                "message": f"A calendar file may be at most {MAX_ICS_BYTES // (1024 * 1024)} MB.",
            },
        )
    return content

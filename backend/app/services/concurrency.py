"""Optimistic concurrency for team data (spec/teams.md §4.2).

Team routes live at ``/api/v1/teams/…`` and carry no ``project_id``, so
``require_edit_lock`` resolves nothing and lets them through — team endpoints are
outside the single-writer lock **by construction** (§4.1). That leaves team rows
with no concurrency control of their own, and last-write-wins would be a real if
narrow hole: two editors on the same absence, and one edit vanishes with nothing
to show for it.

So team reads return the row's ``modified_at`` as a strong ``ETag`` and team
``PATCH``/``DELETE`` require ``If-Match``. A mismatch is **412**, carrying the
current row so the client can show what changed.

**412 is deliberately not 409.** They are different failures needing different
words: 409 means *someone else holds this project's lock, wait*; 412 means *this
row changed under you, here it is*. A frontend that conflates them has to guess.

Nobody holds anything here, nothing expires, and two people editing *different*
absences never collide. This composes with the lock rather than competing with it.
"""

from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import Depends, Header, HTTPException, Response, status
from fastapi.encoders import jsonable_encoder


def etag_for(modified_at: datetime) -> str:
    """The strong ETag for a row, derived from its ``modified_at``.

    Team timestamps are written Python-side at microsecond precision, so two
    writes inside the same second still produce different tags — SQLite's
    ``func.now()`` only has second granularity and would let a lost update
    through.
    """
    stamp = modified_at if modified_at.tzinfo else modified_at.replace(tzinfo=timezone.utc)
    return f'"{stamp.astimezone(timezone.utc).isoformat()}"'


def set_etag(response: Response, modified_at: datetime) -> None:
    """Stamp a read response with the row's ETag."""
    response.headers["ETag"] = etag_for(modified_at)


def require_if_match(
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> str:
    """The ``If-Match`` header, which team writes must carry.

    ``*`` is refused rather than honoured. RFC 7232 reads it as "any current
    representation", which is exactly the last-write-wins behaviour this exists to
    prevent — a client that cannot quote a concrete ETag has not read the row it
    is overwriting.
    """
    if not if_match:
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail={
                "error": "IF_MATCH_REQUIRED",
                "message": "This write must carry the If-Match header from the row's last read.",
            },
        )
    if if_match.strip() == "*":
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail={
                "error": "IF_MATCH_REQUIRED",
                "message": "If-Match must quote the ETag from the row's last read, not '*'.",
            },
        )
    return if_match


IfMatch = Annotated[str, Depends(require_if_match)]


def optional_if_match(
    if_match: Annotated[str | None, Header(alias="If-Match")] = None,
) -> str | None:
    """``If-Match`` for a route that only sometimes overwrites an existing row.

    A create cannot quote an ETag for a row that does not exist yet, so the header
    cannot be mandatory at the door. Routes taking this must still call
    :func:`require_if_match_present` on whichever branch turns out to be an edit —
    otherwise the upsert is the one way back to last-write-wins.
    """
    if if_match is not None and if_match.strip() == "*":
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail={
                "error": "IF_MATCH_REQUIRED",
                "message": "If-Match must quote the ETag from the row's last read, not '*'.",
            },
        )
    return if_match


def require_if_match_present(if_match: str | None, message: str) -> str:
    """Turn a missing optional ``If-Match`` into the same 428 the door would give.

    ``message`` says *why* the header is suddenly required, because the caller
    reached here by posting what it believed was a create.
    """
    if not if_match:
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail={"error": "IF_MATCH_REQUIRED", "message": message},
        )
    return if_match


OptionalIfMatch = Annotated[str | None, Depends(optional_if_match)]


def check_if_match(if_match: str, modified_at: datetime, current: Any) -> None:
    """Reject a write whose ``If-Match`` no longer matches the stored row.

    ``current`` is the row as the client should now see it — the 412 body carries
    it so the UI can offer *keep theirs* / *reapply mine* instead of a spinner and
    a silent refetch.
    """
    expected = etag_for(modified_at)
    offered = {tag.strip() for tag in if_match.split(",")}
    if expected in offered:
        return
    raise HTTPException(
        status_code=status.HTTP_412_PRECONDITION_FAILED,
        detail={
            "error": "STALE",
            "message": "This row changed since you read it.",
            "current": jsonable_encoder(current),
        },
    )

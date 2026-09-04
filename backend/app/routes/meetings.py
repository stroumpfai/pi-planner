"""Booked time, and who is in it (spec/teams.md §3.5, §7.5).

Four rules here look like omissions next to `absences.py`, and are each
deliberate:

**`POST` writes one row, not one per member.** An absence fans out — everybody's
Christmas is one record each, correctable person by person. A meeting is a shared
event with one schedule, so `member_ids` is an **attendee set** on a single row.
That is what makes the Meetings view a matrix: a meeting is a column, and
attendance is a cell (§7.5).

**Attendance is edited through the meeting.** `PATCH` with `member_ids` replaces
the set, and the meeting's own `modified_at` is the concurrency token for both —
so a matrix cell toggle is an ordinary conditional write, and two people ticking
different cells of the same column still collide, which is correct: they are
editing one row.

**A recurring meeting has no per-occurrence exceptions.** `PATCH` and `DELETE`
act on the series, always — the rule absences already follow (§3.4).

**No `require_edit_lock`.** These paths carry no `project_id` and are outside the
single-writer lock by construction (§4.1); concurrency is `If-Match` per row, and
a mismatch is **412 with the current row in the body** (§4.2).
"""

from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.middleware.deps import get_current_user, require_editor_or_above
from app.models.team import Meeting, MeetingAttendee, Team, TeamMember
from app.models.user import User
from app.schemas.absence import default_window
from app.schemas.meeting import (
    MAX_MEETINGS_PER_TEAM,
    BulkMeetingRequest,
    BulkMeetingResult,
    MeetingCreate,
    MeetingFields,
    MeetingReorder,
    MeetingResponse,
    MeetingUpdate,
)
from app.services.concurrency import IfMatch, check_if_match, set_etag
from app.services.events import broadcaster, team_channel
from app.services.meetings import response_for

router = APIRouter(prefix="/api/v1/teams/{team_id}/meetings", tags=["team-meetings"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _team_or_404(db: AsyncSession, team_id: str) -> Team:
    team = await db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team


async def _meeting_or_404(db: AsyncSession, team_id: str, meeting_id: str) -> Meeting:
    """A meeting, checked against the team in the path.

    Not redundant with the primary key: without the check a meeting id from
    another team would be editable through any team's URL.
    """
    await _team_or_404(db, team_id)
    row = await db.get(Meeting, meeting_id, options=[selectinload(Meeting.attendees)])
    if not row or row.team_id != team_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meeting not found")
    return row


async def _member_ids_of(db: AsyncSession, team_id: str) -> list[str]:
    """The team's members in display order — the order attendance is stored in."""
    result = await db.execute(
        select(TeamMember.system_id)
        .where(TeamMember.team_id == team_id)
        .order_by(TeamMember.order_index.asc(), TeamMember.created_at.asc())
    )
    return list(result.scalars().all())


def _checked_attendees(wanted: list[str], members: list[str]) -> list[str]:
    """Attendees as ids, in the team's member order, with unknowns refused.

    Ordering here rather than in the response keeps the stored join rows in the
    order the matrix draws its rows, so a column's cells and the row labels beside
    them cannot drift apart.
    """
    unknown = [mid for mid in wanted if mid not in set(members)]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "error": "MEMBER_NOT_FOUND",
                "message": "Some of those members are not on this team.",
                "member_ids": unknown,
            },
        )
    chosen = set(wanted)
    return [mid for mid in members if mid in chosen]


def _window(window_from: date | None, window_to: date | None) -> tuple[date, date]:
    """The span occurrences are expanded over.

    Defaults to the same year absences default to — the reader of a matrix is
    usually about to pick one sprint out of it, and a rule with no end date has no
    last occurrence, so an unbounded expansion is not a larger answer but a
    non-terminating one.
    """
    if window_from is not None and window_to is not None:
        return window_from, window_to
    start, end = default_window(datetime.now(timezone.utc).date())
    return window_from or start, window_to or end


def _apply_rule(row: Meeting, fields: MeetingFields) -> None:
    row.title = fields.title
    row.kind = fields.kind
    row.start_date = fields.start_date
    row.end_date = fields.end_date
    row.weekday = fields.weekday
    row.interval_weeks = fields.interval_weeks
    row.half = fields.half
    row.duration_minutes = fields.duration_minutes


def _set_attendance(row: Meeting, member_ids: list[str]) -> None:
    """Replace the attendee set, keeping the rows that are already right.

    Rebuilding the whole list would churn `created_at` on people whose attendance
    never changed, which is the only record of when somebody was added to a
    standing meeting.
    """
    wanted = list(dict.fromkeys(member_ids))
    current = {attendee.member_id: attendee for attendee in row.attendees}
    row.attendees = [
        current.get(member_id) or MeetingAttendee(member_id=member_id) for member_id in wanted
    ]


async def _next_order_index(db: AsyncSession, team_id: str) -> int:
    """New meetings join at the right-hand end of the matrix."""
    highest = await db.scalar(
        select(func.max(Meeting.order_index)).where(Meeting.team_id == team_id)
    )
    return 0 if highest is None else int(highest) + 1


async def _guard_count(db: AsyncSession, team_id: str, adding: int) -> None:
    existing = await db.scalar(
        select(func.count(Meeting.system_id)).where(Meeting.team_id == team_id)
    )
    if (existing or 0) + adding > MAX_MEETINGS_PER_TEAM:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "MEETING_LIMIT_REACHED",
                "message": (
                    f"A team holds at most {MAX_MEETINGS_PER_TEAM} meetings. A recurring "
                    "meeting is one row — a daily stand-up is one weekly rule per weekday, "
                    "not one row per occurrence."
                ),
            },
        )


WindowFrom = Annotated[
    date | None, Query(alias="from", description="Expand occurrences from this date")
]
WindowTo = Annotated[
    date | None, Query(alias="to", description="Expand occurrences up to this date")
]


@router.get("")
async def list_meetings(
    team_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
    window_from: WindowFrom = None,
    window_to: WindowTo = None,
) -> list[MeetingResponse]:
    """Every meeting the team holds, with its occurrences inside the window.

    The rules are always returned in full; only the expansion is windowed. A
    meeting with no occurrence in the selected sprint keeps its column and
    contributes nothing, rather than disappearing from a matrix whose other
    columns are unchanged (§7.5).
    """
    await _team_or_404(db, team_id)
    start, end = _window(window_from, window_to)

    result = await db.execute(
        select(Meeting)
        .where(Meeting.team_id == team_id)
        .options(selectinload(Meeting.attendees))
        .order_by(Meeting.order_index.asc(), Meeting.created_at.asc())
    )
    return [response_for(row, start, end) for row in result.scalars().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_meeting(
    team_id: str,
    body: MeetingCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
    window_from: WindowFrom = None,
    window_to: WindowTo = None,
) -> MeetingResponse:
    """One meeting, one row, with its attendees (§3.5).

    The attendee list may be empty — a meeting nobody attends costs nothing, and
    entering the schedule first and ticking attendance afterwards in the matrix
    is the order people work in. No `If-Match`: a create cannot clobber (§4.2).
    """
    await _team_or_404(db, team_id)
    await _guard_count(db, team_id, 1)
    members = await _member_ids_of(db, team_id)
    attendees = _checked_attendees(body.member_ids, members)

    row = Meeting(team_id=team_id, order_index=await _next_order_index(db, team_id))
    _apply_rule(row, MeetingFields.model_validate(body.model_dump(exclude={"member_ids"})))
    _set_attendance(row, attendees)
    db.add(row)

    await db.commit()
    await db.refresh(row, ["attendees"])

    await broadcaster.broadcast(
        team_channel(team_id), "team:meeting:created", {"system_id": row.system_id}
    )
    start, end = _window(window_from, window_to)
    return response_for(row, start, end)


@router.post("/reorder")
async def reorder_meetings(
    team_id: str,
    body: MeetingReorder,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
    window_from: WindowFrom = None,
    window_to: WindowTo = None,
) -> list[MeetingResponse]:
    """Set the column order from a list of meeting ids (§7.5).

    No `If-Match`, on the same reasoning as the member reorder: order is not a
    field anyone edits in a form, and a reorder carries none of the values a stale
    write would overwrite. Ids belonging to another team are ignored rather than
    rejected — the list is a preference, and a partial one still beats the order
    it replaces.
    """
    await _team_or_404(db, team_id)
    result = await db.execute(
        select(Meeting).where(Meeting.team_id == team_id).options(selectinload(Meeting.attendees))
    )
    by_id = {row.system_id: row for row in result.scalars().all()}

    for index, meeting_id in enumerate(body.order):
        row = by_id.get(meeting_id)
        if row is not None:
            row.order_index = index

    await db.commit()
    await broadcaster.broadcast(
        team_channel(team_id), "team:meeting:reordered", {"team_id": team_id}
    )
    start, end = _window(window_from, window_to)
    return [
        response_for(row, start, end)
        for row in sorted(by_id.values(), key=lambda r: (r.order_index, r.created_at))
    ]


@router.patch("/{meeting_id}")
async def update_meeting(
    team_id: str,
    meeting_id: str,
    body: MeetingUpdate,
    if_match: IfMatch,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
    window_from: WindowFrom = None,
    window_to: WindowTo = None,
) -> MeetingResponse:
    """Edit the **whole series**, and optionally who attends it.

    The patch is merged onto the stored row and the result validated as a rule, so
    a partial edit cannot leave a weekly meeting without a weekday. Omitting
    `member_ids` leaves attendance alone; sending it replaces the set, which is
    how a matrix cell toggle arrives.
    """
    row = await _meeting_or_404(db, team_id, meeting_id)
    start, end = _window(window_from, window_to)
    check_if_match(if_match, row.modified_at, response_for(row, start, end))

    current = response_for(row).model_dump()
    patch = body.model_dump(exclude_unset=True)
    try:
        merged = MeetingFields.model_validate(
            {field: patch.get(field, current.get(field)) for field in MeetingFields.model_fields}
        )
    except ValidationError as err:
        # The merged rule is what has to hold together, not the patch: a request
        # setting only `kind` to "weekly" is rejected here, naming the field the
        # stored row never had to carry.
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "INVALID_SCHEDULE", "message": err.errors()[0]["msg"]},
        )

    _apply_rule(row, merged)
    if body.member_ids is not None:
        members = await _member_ids_of(db, team_id)
        _set_attendance(row, _checked_attendees(body.member_ids, members))

    row.modified_at = _now()
    await db.commit()
    await db.refresh(row, ["attendees"])

    await broadcaster.broadcast(
        team_channel(team_id), "team:meeting:updated", {"system_id": meeting_id}
    )
    set_etag(response, row.modified_at)
    return response_for(row, start, end)


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    team_id: str,
    meeting_id: str,
    if_match: IfMatch,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> None:
    """Delete the meeting and its attendance — permanently, as everywhere (§10)."""
    row = await _meeting_or_404(db, team_id, meeting_id)
    check_if_match(if_match, row.modified_at, response_for(row))

    await db.delete(row)
    await db.commit()

    await broadcaster.broadcast(
        team_channel(team_id), "team:meeting:deleted", {"system_id": meeting_id}
    )


@router.post("/bulk")
async def bulk_meetings(
    team_id: str,
    body: BulkMeetingRequest,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> BulkMeetingResult:
    """Replace the meetings anchored inside a date window, in one transaction.

    The same import path absences use, for the same reason: the meeting calendar
    lives on a wiki page read by a model, not in a CSV (§8.2.7).

    **Replace, not merge.** Everything anchored inside `[window_from, window_to]`
    is replaced by `entries`, so re-running an unchanged import writes the same
    rows and a meeting deleted from the page disappears here too. Membership is
    decided by `start_date`, so a stand-up anchored last year survives a window
    covering next month — pick a window matching the section you read.

    Unresolved attendee names are collected and returned **all at once**, and
    nothing is written when there are any; members are never created implicitly
    (§8.2.4).
    """
    await _team_or_404(db, team_id)
    members = await _member_ids_of(db, team_id)
    rows = await db.execute(select(TeamMember).where(TeamMember.team_id == team_id))
    by_name = {member.name.strip().lower(): member.system_id for member in rows.scalars().all()}

    unresolved: list[str] = []
    resolved: list[tuple[list[str], MeetingFields]] = []
    for entry in body.entries:
        ids: list[str] = list(members) if entry.all_members else []
        for name in entry.member_names:
            member_id = by_name.get(name.strip().lower())
            if member_id is None:
                if name not in unresolved:
                    unresolved.append(name)
                continue
            if member_id not in ids:
                ids.append(member_id)
        resolved.append(
            (
                _checked_attendees(ids, members),
                MeetingFields.model_validate(
                    entry.model_dump(exclude={"member_names", "all_members"})
                ),
            )
        )

    doomed = (
        await db.execute(
            select(Meeting)
            .where(
                Meeting.team_id == team_id,
                Meeting.start_date >= body.window_from,
                Meeting.start_date <= body.window_to,
            )
            .options(selectinload(Meeting.attendees))
        )
    ).scalars().all()

    if unresolved:
        # Nothing is written, and the whole list comes back at once — a batch
        # reporting one bad name per round-trip is a batch nobody finishes.
        return BulkMeetingResult(
            dry_run=True,
            window_from=body.window_from,
            window_to=body.window_to,
            created=0,
            deleted=0,
            unresolved_names=unresolved,
        )

    await _guard_count(db, team_id, len(resolved) - len(doomed))

    if body.dry_run:
        return BulkMeetingResult(
            dry_run=True,
            window_from=body.window_from,
            window_to=body.window_to,
            created=len(resolved),
            deleted=len(doomed),
        )

    for row in doomed:
        await db.delete(row)

    written: list[Meeting] = []
    order = await _next_order_index(db, team_id)
    for index, (attendees, rule) in enumerate(resolved):
        row = Meeting(team_id=team_id, order_index=order + index)
        _apply_rule(row, rule)
        _set_attendance(row, attendees)
        db.add(row)
        written.append(row)

    await db.commit()
    for row in written:
        await db.refresh(row, ["attendees"])

    await broadcaster.broadcast(
        team_channel(team_id),
        "team:meeting:bulk",
        {"created": len(written), "deleted": len(doomed)},
    )
    return BulkMeetingResult(
        dry_run=False,
        window_from=body.window_from,
        window_to=body.window_to,
        created=len(written),
        deleted=len(doomed),
        meetings=[response_for(row, body.window_from, body.window_to) for row in written],
    )

"""When members are not there (spec/teams.md §3.4, §7.4).

Three rules here look like omissions and are each deliberate:

**`POST` takes `member_ids` and writes one record each.** The multi-select is an
input convenience, not a shared object — which is what makes a team-wide holiday
correctable for the one person who is on call. It is also the *whole* mechanism
for public and national holidays: there is no holiday entity and no calendar
import (§3.4).

**A recurring entry has no per-occurrence exceptions.** `PATCH` and `DELETE` act
on the series, always. There is no "just this one" here and there must be none in
a UI either: an exception list is a second scheduling model inside the first, and
the model already answers both cases it would serve — end the rule and start a
new one, or add a one-day `range` alongside it, since absences union (§3.4).

**No `require_edit_lock`.** These paths carry no `project_id` and are outside the
single-writer lock by construction (§4.1); concurrency is `If-Match` per row, and
a mismatch is **412 with the current row in the body** so the client can offer
*keep theirs* / *reapply mine* rather than a spinner (§4.2).
"""

from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user, require_editor_or_above
from app.models.team import Absence, Team, TeamMember
from app.models.user import User
from app.schemas.absence import (
    MAX_ABSENCES_PER_MEMBER,
    AbsenceCreate,
    AbsenceResponse,
    AbsenceUpdate,
    BulkAbsenceRequest,
    BulkAbsenceResult,
    ScheduleFields,
    default_window,
)
from app.services.absences import format_halves, response_for
from app.services.concurrency import IfMatch, check_if_match, set_etag
from app.services.events import broadcaster, team_channel

router = APIRouter(prefix="/api/v1/teams/{team_id}/absences", tags=["team-absences"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _team_or_404(db: AsyncSession, team_id: str) -> Team:
    team = await db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team


async def _absence_or_404(db: AsyncSession, team_id: str, absence_id: str) -> Absence:
    """An absence, checked against the team in the path.

    Not redundant with the primary key: without the check an absence id from
    another team would be editable through any team's URL.
    """
    await _team_or_404(db, team_id)
    row = await db.get(Absence, absence_id)
    if not row or row.team_id != team_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Absence not found")
    return row


async def _members_of(db: AsyncSession, team_id: str) -> dict[str, TeamMember]:
    result = await db.execute(select(TeamMember).where(TeamMember.team_id == team_id))
    return {member.system_id: member for member in result.scalars().all()}


def _window(window_from: date | None, window_to: date | None) -> tuple[date, date]:
    """The span occurrences are expanded over.

    Defaults to the year the minimap spans, rather than to "everything": a rule
    with no end date has no last occurrence, so an unbounded expansion is not a
    larger answer but a non-terminating one.
    """
    if window_from is not None and window_to is not None:
        return window_from, window_to
    start, end = default_window(datetime.now(timezone.utc).date())
    return window_from or start, window_to or end


def _apply_rule(row: Absence, fields: ScheduleFields) -> None:
    row.kind = fields.kind
    row.label = fields.label
    row.start_date = fields.start_date
    row.end_date = fields.end_date
    row.start_half = fields.start_half
    row.end_half = fields.end_half
    row.weekday = fields.weekday
    row.halves = format_halves(fields.halves)
    row.interval_weeks = fields.interval_weeks


async def _guard_count(db: AsyncSession, member_id: str, adding: int) -> None:
    existing = await db.scalar(
        select(func.count(Absence.system_id)).where(Absence.member_id == member_id)
    )
    if (existing or 0) + adding > MAX_ABSENCES_PER_MEMBER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "ABSENCE_LIMIT_REACHED",
                "message": f"A member holds at most {MAX_ABSENCES_PER_MEMBER} absences.",
            },
        )


WindowFrom = Annotated[
    date | None, Query(alias="from", description="Expand occurrences from this date")
]
WindowTo = Annotated[
    date | None, Query(alias="to", description="Expand occurrences up to this date")
]


@router.get("")
async def list_absences(
    team_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
    window_from: WindowFrom = None,
    window_to: WindowTo = None,
    member_id: Annotated[str | None, Query(description="Only this member's absences")] = None,
) -> list[AbsenceResponse]:
    """Every absence rule the team holds, with its occurrences inside the window.

    The rules are always returned in full; only the expansion is windowed. A rule
    with no occurrence in view still appears — the minimap's density bars are
    drawn from rows the grid is not currently showing (§7.4).
    """
    await _team_or_404(db, team_id)
    start, end = _window(window_from, window_to)

    query = select(Absence).where(Absence.team_id == team_id)
    if member_id:
        query = query.where(Absence.member_id == member_id)
    result = await db.execute(query.order_by(Absence.start_date.asc(), Absence.created_at.asc()))
    return [response_for(row, start, end) for row in result.scalars().all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_absences(
    team_id: str,
    body: AbsenceCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
    window_from: WindowFrom = None,
    window_to: WindowTo = None,
) -> list[AbsenceResponse]:
    """One rule, one record per named member, in one transaction (§3.4).

    Returns them all — the caller selected several people and needs every id
    back, not the first. No `If-Match`: a create cannot clobber (§4.2).
    """
    await _team_or_404(db, team_id)
    members = await _members_of(db, team_id)

    unknown = [mid for mid in body.member_ids if mid not in members]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "error": "MEMBER_NOT_FOUND",
                "message": "Some of those members are not on this team.",
                "member_ids": unknown,
            },
        )

    rule = ScheduleFields.model_validate(body.model_dump(exclude={"member_ids"}))
    rows: list[Absence] = []
    for member_id in dict.fromkeys(body.member_ids):
        await _guard_count(db, member_id, 1)
        row = Absence(team_id=team_id, member_id=member_id)
        _apply_rule(row, rule)
        db.add(row)
        rows.append(row)

    await db.commit()
    for row in rows:
        await db.refresh(row)

    await broadcaster.broadcast(
        team_channel(team_id),
        "team:absence:created",
        {"system_ids": [row.system_id for row in rows]},
    )
    start, end = _window(window_from, window_to)
    return [response_for(row, start, end) for row in rows]


@router.patch("/{absence_id}")
async def update_absence(
    team_id: str,
    absence_id: str,
    body: AbsenceUpdate,
    if_match: IfMatch,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
    window_from: WindowFrom = None,
    window_to: WindowTo = None,
) -> AbsenceResponse:
    """Edit the **whole series**. There is no per-occurrence exception (§3.4).

    The patch is merged onto the stored row and the result validated as a rule,
    so a partial edit cannot leave a weekly entry without a weekday.
    """
    row = await _absence_or_404(db, team_id, absence_id)
    start, end = _window(window_from, window_to)
    check_if_match(if_match, row.modified_at, response_for(row, start, end))

    current = response_for(row).model_dump()
    patch = body.model_dump(exclude_unset=True)
    try:
        merged = ScheduleFields.model_validate(
            {field: patch.get(field, current.get(field)) for field in ScheduleFields.model_fields}
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
    row.modified_at = _now()
    await db.commit()
    await db.refresh(row)

    await broadcaster.broadcast(
        team_channel(team_id), "team:absence:updated", {"system_id": absence_id}
    )
    set_etag(response, row.modified_at)
    return response_for(row, start, end)


@router.delete("/{absence_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_absence(
    team_id: str,
    absence_id: str,
    if_match: IfMatch,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> None:
    """Delete the whole series — permanently, as everywhere in this app (§10)."""
    row = await _absence_or_404(db, team_id, absence_id)
    check_if_match(if_match, row.modified_at, response_for(row))

    await db.delete(row)
    await db.commit()

    await broadcaster.broadcast(
        team_channel(team_id), "team:absence:deleted", {"system_id": absence_id}
    )


@router.post("/bulk")
async def bulk_absences(
    team_id: str,
    body: BulkAbsenceRequest,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> BulkAbsenceResult:
    """Replace the absences anchored inside a window, in one transaction (§8.2.7).

    The bulk path exists because the planning inputs live on a wiki page read by
    a model, not in a CSV: thirteen months for twenty people is thousands of
    rows, and a per-row call would be unusable and would half-apply on failure.

    **Replace, not merge.** The page is re-read on a schedule, so appending would
    double everything; and only replacement survives an entry being *deleted*
    from the page. Membership of the window is decided by `start_date`, so a
    recurring rule anchored last year is left alone even though it reaches into
    the window.

    Unresolved member names are collected and returned **all at once**, and
    nothing is written when there are any: spelling variants arrive in groups,
    and members are never created implicitly (§8.2.4).
    """
    await _team_or_404(db, team_id)
    members = await _members_of(db, team_id)
    by_name = {member.name.strip().lower(): member for member in members.values()}

    unresolved: list[str] = []
    resolved: list[tuple[list[str], ScheduleFields]] = []
    for entry in body.entries:
        ids: list[str] = []
        for name in entry.member_names:
            member = by_name.get(name.strip().lower())
            if member is None:
                if name not in unresolved:
                    unresolved.append(name)
                continue
            ids.append(member.system_id)
        resolved.append((ids, ScheduleFields.model_validate(entry.model_dump(exclude={"member_names"}))))

    doomed = (
        await db.execute(
            select(Absence).where(
                Absence.team_id == team_id,
                Absence.start_date >= body.window_from,
                Absence.start_date <= body.window_to,
            )
        )
    ).scalars().all()

    if unresolved:
        # Nothing is written, and the whole list comes back at once — a batch
        # reporting one bad name per round-trip is a batch nobody finishes.
        return BulkAbsenceResult(
            dry_run=True,
            window_from=body.window_from,
            window_to=body.window_to,
            created=0,
            deleted=0,
            unresolved_names=unresolved,
        )

    per_member: dict[str, int] = {}
    for ids, _rule in resolved:
        for member_id in dict.fromkeys(ids):
            per_member[member_id] = per_member.get(member_id, 0) + 1
    replaced: dict[str, int] = {}
    for row in doomed:
        replaced[row.member_id] = replaced.get(row.member_id, 0) + 1
    for member_id, adding in per_member.items():
        await _guard_count(db, member_id, adding - replaced.get(member_id, 0))

    if body.dry_run:
        return BulkAbsenceResult(
            dry_run=True,
            window_from=body.window_from,
            window_to=body.window_to,
            created=sum(per_member.values()),
            deleted=len(doomed),
        )

    for row in doomed:
        await db.delete(row)

    written: list[Absence] = []
    for ids, rule in resolved:
        for member_id in dict.fromkeys(ids):
            row = Absence(team_id=team_id, member_id=member_id)
            _apply_rule(row, rule)
            db.add(row)
            written.append(row)

    await db.commit()
    for row in written:
        await db.refresh(row)

    await broadcaster.broadcast(
        team_channel(team_id),
        "team:absence:bulk",
        {"created": len(written), "deleted": len(doomed)},
    )
    return BulkAbsenceResult(
        dry_run=False,
        window_from=body.window_from,
        window_to=body.window_to,
        created=len(written),
        deleted=len(doomed),
        absences=[response_for(row, body.window_from, body.window_to) for row in written],
    )

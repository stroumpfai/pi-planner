"""What a team, and a PI board, sees of the shared holiday calendars (public-holidays.md §5, §6.4, §8.1).

The switch and the exceptions are team writes: no edit lock (teams.md §4.1), and
no ``If-Match`` either, because both are idempotent set operations — enabling an
enabled calendar or marking a day already marked changes nothing, so there is no
lost update to guard against.
"""

from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user, require_editor_or_above
from app.models.holiday import HolidayCalendar, HolidayEntry, HolidayException, TeamHolidayCalendar
from app.models.pi import PI
from app.models.sprint import Sprint
from app.models.team import Absence, Team, TeamMember, TeamProject
from app.models.user import User
from app.schemas.absence import default_window
from app.schemas.holiday import (
    MAX_CALENDARS_PER_TEAM,
    CleanupGroup,
    CleanupMember,
    CleanupRequest,
    CleanupResponse,
    CleanupResult,
    HolidayDay,
    HolidayExceptionRef,
    ProjectHolidaysResponse,
    SprintHoliday,
    SprintHolidays,
    TeamHolidayEntry,
    TeamHolidaysResponse,
)
from app.services.absences import rule_from_row
from app.services.events import broadcaster, team_channel
from app.services.holidays import (
    entry_days,
    entry_half_days,
    load_team_holidays,
    notify_team_holidays,
)
from app.services.occurrences import half_days
from app.services.team_capacity import resolve_version
from app.services.team_capacity_report import load_members

router = APIRouter(tags=["team-holidays"])

Reader = Annotated[User, Depends(get_current_user)]
Writer = Annotated[User, Depends(require_editor_or_above)]
Session = Annotated[AsyncSession, Depends(get_session)]
WindowFrom = Annotated[date | None, Query(alias="from")]
WindowTo = Annotated[date | None, Query(alias="to")]


async def _team_or_404(db: AsyncSession, team_id: str) -> Team:
    team = await db.get(Team, team_id)
    if team is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team


def _window(window_from: date | None, window_to: date | None) -> tuple[date, date]:
    start, end = default_window(datetime.now(timezone.utc).date())
    return window_from or start, window_to or end


# ── the team's effective holidays (§5.2, §5.3) ───────────────────────────────


@router.get("/api/v1/teams/{team_id}/holidays")
async def get_team_holidays(
    team_id: str, db: Session, _: Reader, window_from: WindowFrom = None, window_to: WindowTo = None
) -> TeamHolidaysResponse:
    """The enabled calendars' entries in a window, with each one's exceptions.

    One response feeds the strip, the member cells and the calendar panel's ticks,
    and it is expanded by the same generator the capacity figure is.
    """
    await _team_or_404(db, team_id)
    start, end = _window(window_from, window_to)
    holidays = await load_team_holidays(db, team_id, start, end)
    by_entry: dict[str, list[HolidayExceptionRef]] = defaultdict(list)
    for member_id, entry_id, day in sorted(holidays.exceptions, key=lambda x: (x[1], x[2], x[0])):
        by_entry[entry_id].append(HolidayExceptionRef(member_id=member_id, day=day))
    return TeamHolidaysResponse(
        team_id=team_id,
        enabled_calendar_ids=holidays.enabled_calendar_ids,
        entries=[
            TeamHolidayEntry(
                system_id=entry.system_id,
                calendar_id=entry.calendar_id,
                calendar_name=holidays.calendars[entry.calendar_id].name,
                label=entry.label,
                start_date=entry.start_date,
                start_half=entry.start_half,
                end_date=entry.end_date,
                end_half=entry.end_half,
                days=[HolidayDay(date=d, halves=h) for d, h in entry_days(entry, start, end)],
                exceptions=by_entry.get(entry.system_id, []),
            )
            for entry in holidays.entries
        ],
    )


# ── the switch (§3.3, §5.1) ──────────────────────────────────────────────────


@router.put("/api/v1/teams/{team_id}/holiday-calendars/{calendar_id}", status_code=status.HTTP_204_NO_CONTENT)
async def enable_calendar(team_id: str, calendar_id: str, db: Session, _: Writer) -> None:
    """Enable a calendar for the team. Undated: history moves, and the UI warns (§3.4)."""
    await _team_or_404(db, team_id)
    if await db.get(HolidayCalendar, calendar_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Holiday calendar not found")
    if await db.get(TeamHolidayCalendar, (team_id, calendar_id)) is not None:
        return
    enabled = (await db.execute(
        select(TeamHolidayCalendar.calendar_id).where(TeamHolidayCalendar.team_id == team_id)
    )).scalars().all()
    if len(enabled) >= MAX_CALENDARS_PER_TEAM:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "TEAM_CALENDAR_LIMIT_REACHED",
                "message": f"A team enables at most {MAX_CALENDARS_PER_TEAM} holiday calendars.",
            },
        )
    db.add(TeamHolidayCalendar(team_id=team_id, calendar_id=calendar_id))
    await db.commit()
    await notify_team_holidays(team_id, calendar_id)


@router.delete("/api/v1/teams/{team_id}/holiday-calendars/{calendar_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disable_calendar(team_id: str, calendar_id: str, db: Session, _: Writer) -> None:
    """Disable a calendar. Its exceptions stay stored and come back with it (§3.5)."""
    await _team_or_404(db, team_id)
    await db.execute(delete(TeamHolidayCalendar).where(
        TeamHolidayCalendar.team_id == team_id, TeamHolidayCalendar.calendar_id == calendar_id
    ))
    await db.commit()
    await notify_team_holidays(team_id, calendar_id)


# ── exceptions (§3.5, §5.3) ──────────────────────────────────────────────────


async def _exception_target(
    db: AsyncSession, team_id: str, member_id: str, entry_id: str, day: date
) -> HolidayEntry:
    await _team_or_404(db, team_id)
    member = await db.get(TeamMember, member_id)
    if member is None or member.team_id != team_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    entry = await db.get(HolidayEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Holiday entry not found")
    if not entry.start_date <= day <= entry.end_date:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "DAY_NOT_IN_HOLIDAY", "message": f"{day} is not a day of {entry.label}."},
        )
    return entry


@router.put(
    "/api/v1/teams/{team_id}/members/{member_id}/holiday-exceptions/{entry_id}/{day}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def set_exception(team_id: str, member_id: str, entry_id: str, day: date, db: Session, _: Writer) -> None:
    """The member works this day of the holiday."""
    entry = await _exception_target(db, team_id, member_id, entry_id, day)
    if await db.get(TeamHolidayCalendar, (team_id, entry.calendar_id)) is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "CALENDAR_NOT_ENABLED",
                "message": "Enable this holiday's calendar for the team before marking who works it.",
            },
        )
    existing = (await db.execute(select(HolidayException).where(
        HolidayException.member_id == member_id,
        HolidayException.entry_id == entry_id,
        HolidayException.day == day,
    ))).scalar_one_or_none()
    if existing is None:
        db.add(HolidayException(member_id=member_id, entry_id=entry_id, day=day))
        await db.commit()
    await notify_team_holidays(team_id)


@router.delete(
    "/api/v1/teams/{team_id}/members/{member_id}/holiday-exceptions/{entry_id}/{day}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def clear_exception(team_id: str, member_id: str, entry_id: str, day: date, db: Session, _: Writer) -> None:
    """The member is off on this day of the holiday after all."""
    await _exception_target(db, team_id, member_id, entry_id, day)
    await db.execute(delete(HolidayException).where(
        HolidayException.member_id == member_id,
        HolidayException.entry_id == entry_id,
        HolidayException.day == day,
    ))
    await db.commit()
    await notify_team_holidays(team_id)


# ── cleanup of old everyone-absences (§6.4) ──────────────────────────────────


async def _cleanup_candidates(db: AsyncSession, team_id: str) -> list[CleanupGroup]:
    """Range absences held by two or more members, wholly covered by the team's holidays.

    Matched by dates, never by words: the label is shown to help decide, and decides
    nothing. A copy is redundant only for a member the holiday actually covers — an
    on-call member's exception makes their absence meaningful again.
    """
    absences = list((await db.execute(
        select(Absence).where(Absence.team_id == team_id, Absence.kind == "range")
    )).scalars().all())
    if not absences:
        return []
    span_start = min(a.start_date for a in absences)
    span_end = max(a.end_date or a.start_date for a in absences)
    holidays = await load_team_holidays(db, team_id, span_start, span_end)
    if not holidays.entries:
        return []
    covering: dict[tuple[date, str], list[str]] = defaultdict(list)
    for entry in holidays.entries:
        for day, half in entry_half_days(entry):
            covering[(day, half)].append(entry.system_id)

    def redundant(row: Absence) -> bool:
        halves = list(half_days(rule_from_row(row), row.start_date, row.end_date or row.start_date))
        return bool(halves) and all(
            any((row.member_id, eid, day) not in holidays.exceptions for eid in covering.get((day, half), ()))
            for day, half in halves
        )

    names = {m.system_id: m.name for m in (await db.execute(
        select(TeamMember).where(TeamMember.team_id == team_id)
    )).scalars().all()}
    groups: dict[tuple[str, date, str, date, str], list[Absence]] = defaultdict(list)
    for row in absences:
        key = (
            " ".join((row.label or "").split()).lower(), row.start_date, row.start_half or "am",
            row.end_date or row.start_date, row.end_half or "pm",
        )
        groups[key].append(row)

    result: list[CleanupGroup] = []
    for key, rows in sorted(groups.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        if len({r.member_id for r in rows}) < 2:
            continue
        covered = [r for r in rows if redundant(r)]
        if not covered:
            continue
        first = rows[0]
        result.append(CleanupGroup(
            label=first.label,
            start_date=key[1],
            start_half=key[2],
            end_date=key[3],
            end_half=key[4],
            members=[
                CleanupMember(member_id=r.member_id, name=names.get(r.member_id, ""), absence_id=r.system_id)
                for r in sorted(covered, key=lambda r: names.get(r.member_id, ""))
            ],
        ))
    return result


@router.get("/api/v1/teams/{team_id}/holiday-cleanup")
async def list_cleanup(team_id: str, db: Session, _: Reader) -> CleanupResponse:
    await _team_or_404(db, team_id)
    return CleanupResponse(groups=await _cleanup_candidates(db, team_id))


@router.post("/api/v1/teams/{team_id}/holiday-cleanup")
async def apply_cleanup(team_id: str, body: CleanupRequest, db: Session, _: Writer) -> CleanupResult:
    """Delete the ticked absences — only ones that are still candidates.

    Re-checked here rather than trusted from the client: between the list and the
    click, someone may have disabled the calendar that made a copy redundant.
    """
    await _team_or_404(db, team_id)
    allowed = {m.absence_id for g in await _cleanup_candidates(db, team_id) for m in g.members}
    refused = [aid for aid in body.absence_ids if aid not in allowed]
    if refused:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "NOT_A_DUPLICATE",
                "message": "Some of those absences are no longer covered by a holiday. Refresh and try again.",
                "absence_ids": refused,
            },
        )
    rows = (await db.execute(select(Absence).where(Absence.system_id.in_(body.absence_ids)))).scalars().all()
    for row in rows:
        await db.delete(row)
    await db.commit()
    await broadcaster.broadcast(
        team_channel(team_id), "team:absence:deleted", {"system_ids": [r.system_id for r in rows]}
    )
    return CleanupResult(deleted=len(rows))


# ── PI board sprint headers (§8.1) ───────────────────────────────────────────


@router.get("/api/v1/pis/{pi_id}/holidays")
async def get_pi_holidays(pi_id: str, db: Session, _: Reader) -> ProjectHolidaysResponse:
    """Per sprint of the PI, the holidays that cost the serving team working time.

    An entry counts when it removes at least one contracted half-day from at least
    one member who counts towards capacity: a Saturday holiday, or one only
    part-timers are off for anyway, is not news to the sprint. Undated sprints get
    nothing, never a zero.
    """
    pi = await db.get(PI, pi_id)
    if pi is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PI not found")
    team_id = (await db.execute(
        select(TeamProject.team_id).where(TeamProject.project_id == pi.project_id)
    )).scalar_one_or_none()
    sprints = list((await db.execute(
        select(Sprint).where(Sprint.pi_id == pi_id).order_by(Sprint.sprint_index.asc())
    )).scalars().all())
    dated = [s for s in sprints if s.start_date is not None and s.end_date is not None]
    if team_id is None or not dated:
        return ProjectHolidaysResponse(
            project_id=pi.project_id, team_id=team_id,
            sprints=[SprintHolidays(sprint_id=s.system_id, holidays=[]) for s in sprints],
        )

    span_start = min(s.start_date for s in dated if s.start_date is not None)
    span_end = max(s.end_date for s in dated if s.end_date is not None)
    holidays = await load_team_holidays(db, team_id, span_start, span_end)
    counted = [m for _, m in await load_members(db, team_id) if m.counts_towards_capacity]

    def costs_time(entry: HolidayEntry, start: date, end: date) -> bool:
        for day, half in entry_half_days(entry, start, end):
            for member in counted:
                if not member.is_active_on(day) or not member.versions:
                    continue
                if (member.member_id, entry.system_id, day) in holidays.exceptions:
                    continue
                if resolve_version(member.versions, day).owes(day, half):
                    return True
        return False

    rows: list[SprintHolidays] = []
    for sprint in sprints:
        found: list[SprintHoliday] = []
        if sprint.start_date is not None and sprint.end_date is not None:
            for entry in holidays.entries:
                if entry.end_date < sprint.start_date or entry.start_date > sprint.end_date:
                    continue
                if costs_time(entry, sprint.start_date, sprint.end_date):
                    found.append(SprintHoliday(
                        label=entry.label,
                        calendar_name=holidays.calendars[entry.calendar_id].name,
                        start_date=entry.start_date,
                        start_half=entry.start_half,
                        end_date=entry.end_date,
                        end_half=entry.end_half,
                    ))
        rows.append(SprintHolidays(sprint_id=sprint.system_id, holidays=found))
    return ProjectHolidaysResponse(project_id=pi.project_id, team_id=team_id, sprints=rows)

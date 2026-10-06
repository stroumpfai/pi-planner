"""Shared holiday calendars and their entries (spec/public-holidays.md §3, §6, §7).

A calendar belongs to no team and no project, so these routes carry neither and
take no edit lock — concurrency is the per-row ``If-Match`` that team data uses
(teams.md §4.2). Every authenticated user reads; admins and editors write.

Every write broadcasts on the app-wide Calendars channel and on the channel of
each team that has the calendar enabled, because a calendar edit moves those
teams' capacity (§9.2).
"""

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import PlainTextResponse
from pydantic import ValidationError
from sqlalchemy import delete, extract, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user, require_editor_or_above
from app.models.holiday import HolidayCalendar, HolidayEntry, HolidayException, TeamHolidayCalendar
from app.models.user import User
from app.schemas.holiday import (
    MAX_CALENDARS,
    MAX_ENTRIES_PER_CALENDAR,
    BulkHolidayEntriesRequest,
    BulkHolidayEntriesResult,
    CopyYearPreview,
    CopyYearProposal,
    CopyYearRequest,
    EntriesCreatedResult,
    HolidayCalendarCreate,
    HolidayCalendarDetail,
    HolidayCalendarSummary,
    HolidayCalendarUpdate,
    HolidayEntryFields,
    HolidayEntryResponse,
    HolidayEntryUpdate,
    IcsImportResult,
    TeamRef,
)
from app.services.concurrency import IfMatch, check_if_match, etag_for, set_etag
from app.services.holiday_ics import export_ics, parse_ics
from app.services.holidays import (
    apply_fields,
    calendar_by_name,
    drop_exceptions_outside,
    entry_response,
    exception_days_by_entry,
    forget_entries,
    key_of,
    key_of_fields,
    notify_calendar_changed,
    teams_using,
)
from app.services.ics_upload import read_ics_upload

router = APIRouter(prefix="/api/v1/holiday-calendars", tags=["holiday-calendars"])

Reader = Annotated[User, Depends(get_current_user)]
Writer = Annotated[User, Depends(require_editor_or_above)]
Session = Annotated[AsyncSession, Depends(get_session)]


# ── helpers ──────────────────────────────────────────────────────────────────


async def _calendar_or_404(db: AsyncSession, calendar_id: str) -> HolidayCalendar:
    calendar = await db.get(HolidayCalendar, calendar_id)
    if calendar is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Holiday calendar not found")
    return calendar


async def _entry_or_404(db: AsyncSession, calendar_id: str, entry_id: str) -> HolidayEntry:
    """An entry, checked against the calendar in the path, as absences are against their team."""
    await _calendar_or_404(db, calendar_id)
    entry = await db.get(HolidayEntry, entry_id)
    if entry is None or entry.calendar_id != calendar_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Holiday entry not found")
    return entry


def _name_taken(name: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "CALENDAR_NAME_TAKEN",
            "message": f'A holiday calendar named "{name}" already exists.',
        },
    )


def _invalid(err: ValidationError | ValueError) -> HTTPException:
    message = err.errors()[0]["msg"] if isinstance(err, ValidationError) else str(err)
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail={"error": "INVALID_HOLIDAY", "message": message},
    )


async def _entry_count(db: AsyncSession, calendar_id: str) -> int:
    return int(await db.scalar(
        select(func.count(HolidayEntry.system_id)).where(HolidayEntry.calendar_id == calendar_id)
    ) or 0)


async def _guard_entry_count(db: AsyncSession, calendar_id: str, adding: int, removing: int = 0) -> None:
    if await _entry_count(db, calendar_id) - removing + adding > MAX_ENTRIES_PER_CALENDAR:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "HOLIDAY_LIMIT_REACHED",
                "message": f"A holiday calendar holds at most {MAX_ENTRIES_PER_CALENDAR} entries.",
            },
        )


async def _summaries(db: AsyncSession, calendars: list[HolidayCalendar]) -> list[HolidayCalendarSummary]:
    ids = [c.system_id for c in calendars]
    stats: dict[str, tuple[int, int | None, int | None]] = {}
    if ids:
        rows = (await db.execute(
            select(
                HolidayEntry.calendar_id,
                func.count(HolidayEntry.system_id),
                func.min(extract("year", HolidayEntry.start_date)),
                func.max(extract("year", HolidayEntry.end_date)),
            )
            .where(HolidayEntry.calendar_id.in_(ids))
            .group_by(HolidayEntry.calendar_id)
        )).all()
        stats = {
            row[0]: (int(row[1]), int(row[2]) if row[2] is not None else None,
                     int(row[3]) if row[3] is not None else None)
            for row in rows
        }
    using = await teams_using(db, ids)
    return [
        HolidayCalendarSummary(
            system_id=c.system_id,
            name=c.name,
            description=c.description,
            entry_count=stats.get(c.system_id, (0, None, None))[0],
            first_year=stats.get(c.system_id, (0, None, None))[1],
            last_year=stats.get(c.system_id, (0, None, None))[2],
            teams=[TeamRef(system_id=t.system_id, name=t.name) for t in using.get(c.system_id, [])],
            created_at=c.created_at,
            modified_at=c.modified_at,
            etag=etag_for(c.modified_at),
        )
        for c in calendars
    ]


async def _detail(db: AsyncSession, calendar: HolidayCalendar, year: int | None = None) -> HolidayCalendarDetail:
    query = select(HolidayEntry).where(HolidayEntry.calendar_id == calendar.system_id)
    if year is not None:
        query = query.where(
            HolidayEntry.start_date <= date(year, 12, 31), HolidayEntry.end_date >= date(year, 1, 1)
        )
    entries = list((await db.execute(
        query.order_by(HolidayEntry.start_date.asc(), HolidayEntry.label.asc())
    )).scalars().all())
    exceptions = await exception_days_by_entry(db, [e.system_id for e in entries])
    summary = (await _summaries(db, [calendar]))[0]
    return HolidayCalendarDetail(
        **summary.model_dump(),
        entries=[entry_response(e, exceptions.get(e.system_id, [])) for e in entries],
    )


async def _existing_keys(db: AsyncSession, calendar_id: str) -> set[tuple[str, date, str, date, str]]:
    entries = (await db.execute(
        select(HolidayEntry).where(HolidayEntry.calendar_id == calendar_id)
    )).scalars().all()
    return {key_of(e) for e in entries}


async def _create_entries(
    db: AsyncSession, calendar_id: str, fields: list[HolidayEntryFields]
) -> EntriesCreatedResult:
    """Add entries, skipping any identical to one already there (§6.3, §7.1)."""
    seen = await _existing_keys(db, calendar_id)
    created = duplicates = 0
    for item in fields:
        key = key_of_fields(item)
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        entry = HolidayEntry(calendar_id=calendar_id)
        apply_fields(entry, item)
        db.add(entry)
        created += 1
    await _guard_entry_count(db, calendar_id, 0)
    return EntriesCreatedResult(created=created, duplicates=duplicates)


# ── calendars ────────────────────────────────────────────────────────────────


@router.get("")
async def list_calendars(db: Session, _: Reader) -> list[HolidayCalendarSummary]:
    calendars = list((await db.execute(
        select(HolidayCalendar).order_by(func.lower(HolidayCalendar.name).asc())
    )).scalars().all())
    return await _summaries(db, calendars)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_calendar(body: HolidayCalendarCreate, db: Session, _: Writer) -> HolidayCalendarDetail:
    if await calendar_by_name(db, body.name):
        raise _name_taken(body.name)
    count = await db.scalar(select(func.count(HolidayCalendar.system_id)))
    if (count or 0) >= MAX_CALENDARS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "CALENDAR_LIMIT_REACHED", "message": f"At most {MAX_CALENDARS} holiday calendars."},
        )
    calendar = HolidayCalendar(name=body.name, description=body.description)
    db.add(calendar)
    await db.commit()
    await db.refresh(calendar)
    await notify_calendar_changed(db, calendar.system_id)
    return await _detail(db, calendar)


@router.get("/{calendar_id}")
async def get_calendar(
    calendar_id: str,
    response: Response,
    db: Session,
    _: Reader,
    year: Annotated[int | None, Query(ge=1900, le=2200, description="Only entries touching this year")] = None,
) -> HolidayCalendarDetail:
    calendar = await _calendar_or_404(db, calendar_id)
    set_etag(response, calendar.modified_at)
    return await _detail(db, calendar, year)


@router.patch("/{calendar_id}")
async def update_calendar(
    calendar_id: str,
    body: HolidayCalendarUpdate,
    if_match: IfMatch,
    response: Response,
    db: Session,
    _: Writer,
) -> HolidayCalendarDetail:
    calendar = await _calendar_or_404(db, calendar_id)
    check_if_match(if_match, calendar.modified_at, (await _summaries(db, [calendar]))[0])
    fields = body.model_fields_set
    if "name" in fields and body.name is not None:
        if await calendar_by_name(db, body.name, exclude_id=calendar_id):
            raise _name_taken(body.name)
        calendar.name = body.name
    if "description" in fields:
        calendar.description = body.description
    await db.commit()
    await db.refresh(calendar)
    await notify_calendar_changed(db, calendar_id)
    set_etag(response, calendar.modified_at)
    return await _detail(db, calendar)


@router.delete("/{calendar_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_calendar(calendar_id: str, if_match: IfMatch, db: Session, _: Writer) -> None:
    """Permanent, and removes the calendar from every team using it (§3.6).

    The confirmation names those teams before the call; the cascade is explicit,
    since SQLite runs here without foreign-key enforcement.
    """
    calendar = await _calendar_or_404(db, calendar_id)
    check_if_match(if_match, calendar.modified_at, (await _summaries(db, [calendar]))[0])
    team_ids = list((await db.execute(
        select(TeamHolidayCalendar.team_id).where(TeamHolidayCalendar.calendar_id == calendar_id)
    )).scalars().all())
    entry_ids = list((await db.execute(
        select(HolidayEntry.system_id).where(HolidayEntry.calendar_id == calendar_id)
    )).scalars().all())
    await forget_entries(db, entry_ids)
    await db.execute(delete(TeamHolidayCalendar).where(TeamHolidayCalendar.calendar_id == calendar_id))
    await db.execute(delete(HolidayEntry).where(HolidayEntry.calendar_id == calendar_id))
    await db.delete(calendar)
    await db.commit()
    await notify_calendar_changed(db, calendar_id, extra_team_ids=team_ids)


# ── entries ──────────────────────────────────────────────────────────────────


@router.post("/{calendar_id}/entries", status_code=status.HTTP_201_CREATED)
async def create_entry(
    calendar_id: str, body: HolidayEntryFields, db: Session, _: Writer
) -> HolidayEntryResponse:
    await _calendar_or_404(db, calendar_id)
    await _guard_entry_count(db, calendar_id, 1)
    entry = HolidayEntry(calendar_id=calendar_id)
    apply_fields(entry, body)
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    await notify_calendar_changed(db, calendar_id)
    return entry_response(entry)


@router.patch("/{calendar_id}/entries/{entry_id}")
async def update_entry(
    calendar_id: str,
    entry_id: str,
    body: HolidayEntryUpdate,
    if_match: IfMatch,
    response: Response,
    db: Session,
    _: Writer,
) -> HolidayEntryResponse:
    """Edit an entry. Exceptions on days it no longer covers are deleted (§3.5).

    The patch is merged onto the stored row and the result validated, so a
    partial edit cannot leave an entry ending before it starts.
    """
    entry = await _entry_or_404(db, calendar_id, entry_id)
    exceptions = await exception_days_by_entry(db, [entry_id])
    check_if_match(if_match, entry.modified_at, entry_response(entry, exceptions.get(entry_id, [])))

    current = {
        "label": entry.label, "start_date": entry.start_date, "start_half": entry.start_half,
        "end_date": entry.end_date, "end_half": entry.end_half,
    }
    patch = body.model_dump(exclude_unset=True)
    try:
        merged = HolidayEntryFields.model_validate({k: patch.get(k, v) for k, v in current.items()})
    except ValidationError as err:
        raise _invalid(err)

    apply_fields(entry, merged)
    await db.flush()
    await drop_exceptions_outside(db, entry)
    await db.commit()
    await db.refresh(entry)
    await notify_calendar_changed(db, calendar_id)
    set_etag(response, entry.modified_at)
    remaining = await exception_days_by_entry(db, [entry_id])
    return entry_response(entry, remaining.get(entry_id, []))


@router.delete("/{calendar_id}/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    calendar_id: str, entry_id: str, if_match: IfMatch, db: Session, _: Writer
) -> None:
    entry = await _entry_or_404(db, calendar_id, entry_id)
    check_if_match(if_match, entry.modified_at, entry_response(entry))
    await forget_entries(db, [entry_id])
    await db.delete(entry)
    await db.commit()
    await notify_calendar_changed(db, calendar_id)


@router.put("/{calendar_id}/entries")
async def replace_entries(
    calendar_id: str, body: BulkHolidayEntriesRequest, db: Session, _: Writer
) -> BulkHolidayEntriesResult:
    """Replace every entry starting inside the window, in one transaction (§7.3).

    Membership of the window is decided by ``start_date``, as for the absence
    bulk import. An exception survives when an entry with the same dates, halves
    and label comes back — the usual case, a re-read of an unchanged page — and
    is dropped otherwise.
    """
    await _calendar_or_404(db, calendar_id)
    doomed = list((await db.execute(
        select(HolidayEntry).where(
            HolidayEntry.calendar_id == calendar_id,
            HolidayEntry.start_date >= body.window_from,
            HolidayEntry.start_date <= body.window_to,
        )
    )).scalars().all())

    incoming: dict[tuple[str, date, str, date, str], HolidayEntryFields] = {}
    for item in body.entries:
        incoming.setdefault(key_of_fields(item), item)
    await _guard_entry_count(db, calendar_id, len(incoming), removing=len(doomed))

    old_exceptions: dict[tuple[str, date, str, date, str], list[HolidayException]] = {}
    for entry in doomed:
        rows = (await db.execute(
            select(HolidayException).where(HolidayException.entry_id == entry.system_id)
        )).scalars().all()
        old_exceptions.setdefault(key_of(entry), []).extend(rows)

    kept = sum(len(rows) for key, rows in old_exceptions.items() if key in incoming)
    dropped = sum(len(rows) for key, rows in old_exceptions.items() if key not in incoming)
    result = BulkHolidayEntriesResult(
        dry_run=body.dry_run, created=len(incoming), deleted=len(doomed),
        exceptions_kept=kept, exceptions_dropped=dropped,
    )
    if body.dry_run:
        return result

    carried: list[tuple[tuple[str, date, str, date, str], str, date]] = [
        (key, row.member_id, row.day) for key, rows in old_exceptions.items() if key in incoming
        for row in rows
    ]
    await forget_entries(db, [e.system_id for e in doomed])
    for entry in doomed:
        await db.delete(entry)
    await db.flush()

    created: dict[tuple[str, date, str, date, str], HolidayEntry] = {}
    for key, item in incoming.items():
        entry = HolidayEntry(calendar_id=calendar_id)
        apply_fields(entry, item)
        db.add(entry)
        created[key] = entry
    await db.flush()
    for key, member_id, day in carried:
        db.add(HolidayException(member_id=member_id, entry_id=created[key].system_id, day=day))

    await db.commit()
    await notify_calendar_changed(db, calendar_id)
    return result


# ── copy year (§6.3) ─────────────────────────────────────────────────────────


def _next_year(day: date) -> date:
    try:
        return day.replace(year=day.year + 1)
    except ValueError:  # 29 February
        return day.replace(year=day.year + 1, day=28)


@router.get("/{calendar_id}/copy-year")
async def preview_copy_year(
    calendar_id: str,
    db: Session,
    _: Reader,
    from_year: Annotated[int, Query(ge=1900, le=2199)],
) -> CopyYearPreview:
    """Every entry of ``from_year``, proposed one year later.

    Nothing is inferred about which holidays move: the planner corrects Easter and
    its kin in the preview. A proposal landing on a weekend is flagged, never moved.
    """
    await _calendar_or_404(db, calendar_id)
    entries = (await db.execute(
        select(HolidayEntry)
        .where(
            HolidayEntry.calendar_id == calendar_id,
            HolidayEntry.start_date >= date(from_year, 1, 1),
            HolidayEntry.start_date <= date(from_year, 12, 31),
        )
        .order_by(HolidayEntry.start_date.asc())
    )).scalars().all()
    existing = await _existing_keys(db, calendar_id)
    proposals: list[CopyYearProposal] = []
    for entry in entries:
        start = _next_year(entry.start_date)
        end = _next_year(entry.end_date)
        if end < start:
            end = start
        days = [start + timedelta(days=n) for n in range((end - start).days + 1)]
        proposal = CopyYearProposal(
            label=entry.label,
            start_date=start,
            start_half=entry.start_half,
            end_date=end,
            end_half=entry.end_half,
            source_start_date=entry.start_date,
            on_weekend=any(d.weekday() >= 5 for d in days),
            duplicate=False,
        )
        proposal.duplicate = key_of_fields(proposal) in existing
        proposals.append(proposal)
    return CopyYearPreview(from_year=from_year, to_year=from_year + 1, proposals=proposals)


@router.post("/{calendar_id}/copy-year")
async def copy_year(
    calendar_id: str, body: CopyYearRequest, db: Session, _: Writer
) -> EntriesCreatedResult:
    """Create the reviewed entries; exceptions are never copied (§6.3)."""
    await _calendar_or_404(db, calendar_id)
    result = await _create_entries(db, calendar_id, body.entries)
    await db.commit()
    await notify_calendar_changed(db, calendar_id)
    return result


# ── .ics (§7.1, §7.2) ────────────────────────────────────────────────────────


@router.post("/{calendar_id}/import/ics")
async def import_ics(
    calendar_id: str,
    db: Session,
    _: Writer,
    file: Annotated[UploadFile, File(description="An iCalendar (.ics) file")],
    dry_run: bool = False,
    from_year: Annotated[
        int | None, Query(ge=1900, le=2199, description="First year to expand yearly events into")
    ] = None,
    to_year: Annotated[
        int | None, Query(ge=1900, le=2199, description="Last year to expand yearly events into")
    ] = None,
) -> IcsImportResult:
    """Merge an ``.ics`` file into the calendar, skipping duplicates.

    Re-importing the same file changes nothing. Replacing a year is the bulk
    path's job (§7.3). The preview is the same request with ``dry_run``.
    """
    await _calendar_or_404(db, calendar_id)
    content = await read_ics_upload(file)
    try:
        parsed = parse_ics(content, from_year=from_year, to_year=to_year)
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"error": "INVALID_ICS", "message": str(err)},
        )
    existing = await _existing_keys(db, calendar_id)
    fresh: list[HolidayEntryFields] = []
    duplicates = 0
    for item in parsed.entries:
        key = key_of_fields(item)
        if key in existing:
            duplicates += 1
            continue
        existing.add(key)
        fresh.append(item)
    result = IcsImportResult(
        dry_run=dry_run, created=len(fresh), duplicates=duplicates,
        skipped=parsed.skipped, truncated_labels=parsed.truncated_labels, entries=fresh,
    )
    if dry_run:
        await _guard_entry_count(db, calendar_id, len(fresh))
        return result
    await _create_entries(db, calendar_id, fresh)
    await db.commit()
    await notify_calendar_changed(db, calendar_id)
    return result


@router.get("/{calendar_id}/export/ics", response_class=PlainTextResponse)
async def export_calendar_ics(calendar_id: str, db: Session, _: Reader) -> Response:
    calendar = await _calendar_or_404(db, calendar_id)
    entries = list((await db.execute(
        select(HolidayEntry)
        .where(HolidayEntry.calendar_id == calendar_id)
        .order_by(HolidayEntry.start_date.asc())
    )).scalars().all())
    safe = "".join(ch if ch.isalnum() or ch in " -_" else "_" for ch in calendar.name).strip() or "holidays"
    return Response(
        content=export_ics(calendar, entries),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe}.ics"'},
    )

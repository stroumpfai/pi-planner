"""Holiday calendars arriving in a team JSON file (spec/public-holidays.md §8.2).

Calendars are shared across the app, so a team import must never change one that
other teams depend on, and must never add one without being asked:

- A calendar whose name exists is **reused and enabled**; the existing calendar
  wins, and entries in the file that differ from it are reported, not merged.
- A calendar whose name does not exist is created only when the caller says
  ``create_missing_calendars``; otherwise the whole import is refused, naming them.

Everything is worked out by ``plan_holiday_import`` before the route writes
anything, so a refusal leaves no half-imported team behind.
"""

from dataclasses import dataclass, field
from datetime import date
from typing import Any

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holiday import HolidayCalendar, HolidayEntry, HolidayException, TeamHolidayCalendar
from app.schemas.holiday import (
    MAX_CALENDARS,
    MAX_CALENDARS_PER_TEAM,
    MAX_ENTRIES_PER_CALENDAR,
    HolidayCalendarCreate,
    HolidayEntryFields,
)
from app.services.holidays import apply_fields, calendar_by_name, key_of, key_of_fields


@dataclass
class _CalendarPlan:
    name: str
    description: str | None
    entries: list[HolidayEntryFields]
    existing: HolidayCalendar | None


@dataclass
class HolidayImportPlan:
    calendars: list[_CalendarPlan] = field(default_factory=list)
    exceptions: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _invalid(message: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        detail={"error": "INVALID_FORMAT", "message": message},
    )


async def plan_holiday_import(
    db: AsyncSession, team_data: dict[str, Any], *, create_missing_calendars: bool
) -> HolidayImportPlan:
    """Validate the file's calendars and decide what each one becomes. Writes nothing."""
    plan = HolidayImportPlan()
    raw_calendars = team_data.get("holiday_calendars") or []
    if not isinstance(raw_calendars, list):
        raise _invalid("'holiday_calendars' must be a list")
    if len(raw_calendars) > MAX_CALENDARS_PER_TEAM:
        raise _invalid(f"A team enables at most {MAX_CALENDARS_PER_TEAM} holiday calendars.")

    seen_names: set[str] = set()
    for raw in raw_calendars:
        if not isinstance(raw, dict):
            raise _invalid("Each holiday calendar must be an object")
        try:
            header = HolidayCalendarCreate.model_validate(
                {"name": raw.get("name", ""), "description": raw.get("description")}
            )
            entries = [HolidayEntryFields.model_validate(e) for e in raw.get("entries") or []]
        except ValidationError as err:
            raise _invalid(f"Holiday calendar {raw.get('name')!r}: {err.errors()[0]['msg']}")
        if header.name.lower() in seen_names:
            raise _invalid(f"Holiday calendar {header.name!r} appears twice")
        seen_names.add(header.name.lower())
        if len(entries) > MAX_ENTRIES_PER_CALENDAR:
            raise _invalid(f"Holiday calendar {header.name!r} has more than {MAX_ENTRIES_PER_CALENDAR} entries")
        plan.calendars.append(_CalendarPlan(
            name=header.name, description=header.description, entries=entries,
            existing=await calendar_by_name(db, header.name),
        ))

    missing = [c.name for c in plan.calendars if c.existing is None]
    if missing and not create_missing_calendars:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "CALENDARS_MISSING",
                "message": "This file uses holiday calendars that don't exist here. "
                           "Every team would be able to see them once created.",
                "calendars": missing,
            },
        )
    if missing:
        count = await db.scalar(select(func.count(HolidayCalendar.system_id)))
        if (count or 0) + len(missing) > MAX_CALENDARS:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "CALENDAR_LIMIT_REACHED", "message": f"At most {MAX_CALENDARS} holiday calendars."},
            )

    raw_exceptions = team_data.get("holiday_exceptions") or []
    if not isinstance(raw_exceptions, list):
        raise _invalid("'holiday_exceptions' must be a list")
    plan.exceptions = [e for e in raw_exceptions if isinstance(e, dict)]
    return plan


async def apply_holiday_import(
    db: AsyncSession, plan: HolidayImportPlan, team_id: str, member_id_map: dict[str, str]
) -> list[str]:
    """Create missing calendars, enable every calendar, restore the exceptions that resolve.

    Returns the notes the import reports: differing entries not applied, calendars
    created, exceptions dropped.
    """
    notes: list[str] = []
    calendar_ids: dict[str, str] = {}
    for item in plan.calendars:
        if item.existing is None:
            calendar = HolidayCalendar(name=item.name, description=item.description)
            db.add(calendar)
            await db.flush()
            seen: set[tuple[str, date, str, date, str]] = set()
            for fields in item.entries:
                if key_of_fields(fields) in seen:
                    continue
                seen.add(key_of_fields(fields))
                entry = HolidayEntry(calendar_id=calendar.system_id)
                apply_fields(entry, fields)
                db.add(entry)
            notes.append(f'Created holiday calendar "{item.name}" with {len(seen)} entries.')
            calendar_ids[item.name.lower()] = calendar.system_id
        else:
            calendar_ids[item.name.lower()] = item.existing.system_id
            existing_keys = {key_of(e) for e in (await db.execute(
                select(HolidayEntry).where(HolidayEntry.calendar_id == item.existing.system_id)
            )).scalars().all()}
            differing = sum(1 for f in item.entries if key_of_fields(f) not in existing_keys)
            if differing:
                notes.append(
                    f'{item.existing.name}: {differing} '
                    f'{"entry" if differing == 1 else "entries"} in the file differ from the existing '
                    "calendar and were not applied."
                )
        db.add(TeamHolidayCalendar(team_id=team_id, calendar_id=calendar_ids[item.name.lower()]))
    await db.flush()

    dropped = 0
    for raw in plan.exceptions:
        member_id = member_id_map.get(str(raw.get("member_id")))
        calendar_id = calendar_ids.get(str(raw.get("calendar", "")).strip().lower())
        raw_ref = raw.get("entry")
        ref: dict[str, Any] = raw_ref if isinstance(raw_ref, dict) else {}
        try:
            start = date.fromisoformat(str(ref.get("start_date")))
            day = date.fromisoformat(str(raw.get("day")))
        except ValueError:
            dropped += 1
            continue
        label = " ".join(str(ref.get("label", "")).split()).lower()
        target: HolidayEntry | None = None
        if member_id and calendar_id:
            candidates = (await db.execute(
                select(HolidayEntry).where(
                    HolidayEntry.calendar_id == calendar_id, HolidayEntry.start_date == start
                )
            )).scalars().all()
            target = next((e for e in candidates if " ".join(e.label.split()).lower() == label), None)
        if target is None or member_id is None or not target.start_date <= day <= target.end_date:
            dropped += 1
            continue
        db.add(HolidayException(member_id=member_id, entry_id=target.system_id, day=day))
    if dropped:
        notes.append(
            f"{dropped} holiday {'exception' if dropped == 1 else 'exceptions'} could not be matched "
            "to a holiday and were dropped."
        )
    return notes

"""Holiday calendars arriving in a team JSON file (spec/public-holidays.md §8.2).

The happy paths — reuse an existing calendar, refuse or create a missing one — run
end to end in `tests/integration/test_holiday_calendars.py`. These pin what the
planner refuses before anything is written, and what the apply step drops.
"""

from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.holiday import HolidayCalendar, HolidayEntry, HolidayException, TeamHolidayCalendar
from app.models.team import Team
from app.schemas.holiday import MAX_CALENDARS, MAX_CALENDARS_PER_TEAM, MAX_ENTRIES_PER_CALENDAR
from app.services.holiday_import import apply_holiday_import, plan_holiday_import

EASTER_MONDAY = "2026-04-06"


def _calendar(name: str = "Switzerland", *entries: dict) -> dict:
    return {"name": name, "entries": list(entries)}


def _holiday(label: str = "Easter Monday", start: str = EASTER_MONDAY, **rest) -> dict:
    return {"label": label, "start_date": start, **rest}


async def _refusal(db, team_data: dict, *, create: bool = True) -> HTTPException:
    with pytest.raises(HTTPException) as caught:
        await plan_holiday_import(db, team_data, create_missing_calendars=create)
    return caught.value


# ── Planning: refusals before anything is written ────────────────────────────


async def test_a_file_without_calendars_plans_nothing(db):
    plan = await plan_holiday_import(db, {"name": "Old"}, create_missing_calendars=False)
    assert (plan.calendars, plan.exceptions) == ([], [])


async def test_calendars_that_are_not_a_list_are_refused(db):
    err = await _refusal(db, {"holiday_calendars": {"name": "Switzerland"}})
    assert err.status_code == 422
    assert err.detail == {"error": "INVALID_FORMAT", "message": "'holiday_calendars' must be a list"}


async def test_more_calendars_than_a_team_may_enable_are_refused(db):
    calendars = [_calendar(f"C{i}") for i in range(MAX_CALENDARS_PER_TEAM + 1)]
    err = await _refusal(db, {"holiday_calendars": calendars})
    assert err.status_code == 422
    assert f"at most {MAX_CALENDARS_PER_TEAM}" in err.detail["message"]


async def test_exactly_the_team_limit_of_calendars_is_accepted(db):
    calendars = [_calendar(f"C{i}") for i in range(MAX_CALENDARS_PER_TEAM)]
    plan = await plan_holiday_import(db, {"holiday_calendars": calendars}, create_missing_calendars=True)
    assert len(plan.calendars) == MAX_CALENDARS_PER_TEAM


async def test_a_calendar_that_is_not_an_object_is_refused(db):
    err = await _refusal(db, {"holiday_calendars": ["Switzerland"]})
    assert err.status_code == 422
    assert err.detail["message"] == "Each holiday calendar must be an object"


async def test_a_calendar_without_a_name_is_refused(db):
    err = await _refusal(db, {"holiday_calendars": [{"entries": []}]})
    assert err.status_code == 422
    assert err.detail["message"].startswith("Holiday calendar None:")


async def test_a_malformed_entry_names_its_calendar(db):
    err = await _refusal(db, {"holiday_calendars": [_calendar("Switzerland", _holiday(start="not a date"))]})
    assert err.status_code == 422
    assert err.detail["message"].startswith("Holiday calendar 'Switzerland':")


async def test_an_entry_ending_before_it_starts_is_refused(db):
    backwards = _holiday(start="2026-04-07", end_date="2026-04-06")
    err = await _refusal(db, {"holiday_calendars": [_calendar("Switzerland", backwards)]})
    assert err.status_code == 422
    assert "end_date cannot fall before start_date" in err.detail["message"]


async def test_a_calendar_named_twice_ignoring_case_is_refused(db):
    err = await _refusal(db, {"holiday_calendars": [_calendar("Switzerland"), _calendar("  switzerland ")]})
    assert err.status_code == 422
    assert err.detail["message"] == "Holiday calendar 'switzerland' appears twice"


async def test_a_calendar_with_too_many_entries_is_refused(db):
    entries = [_holiday(f"Day {i}") for i in range(MAX_ENTRIES_PER_CALENDAR + 1)]
    err = await _refusal(db, {"holiday_calendars": [_calendar("Switzerland", *entries)]})
    assert err.status_code == 422
    assert f"more than {MAX_ENTRIES_PER_CALENDAR} entries" in err.detail["message"]


async def test_creating_calendars_past_the_instance_limit_is_refused(db):
    db.add_all(HolidayCalendar(name=f"Existing {i}") for i in range(MAX_CALENDARS - 1))
    await db.flush()

    one_more = await plan_holiday_import(db, {"holiday_calendars": [_calendar("New A")]}, create_missing_calendars=True)
    assert [c.name for c in one_more.calendars] == ["New A"]

    err = await _refusal(db, {"holiday_calendars": [_calendar("New A"), _calendar("New B")]})
    assert err.status_code == 409
    assert err.detail["error"] == "CALENDAR_LIMIT_REACHED"


async def test_reusing_calendars_at_the_instance_limit_is_fine(db):
    db.add_all(HolidayCalendar(name=f"Existing {i}") for i in range(MAX_CALENDARS))
    await db.flush()
    plan = await plan_holiday_import(
        db, {"holiday_calendars": [_calendar("existing 0")]}, create_missing_calendars=False
    )
    assert plan.calendars[0].existing is not None


async def test_exceptions_that_are_not_a_list_are_refused(db):
    err = await _refusal(db, {"holiday_calendars": [], "holiday_exceptions": {"day": EASTER_MONDAY}})
    assert err.status_code == 422
    assert err.detail["message"] == "'holiday_exceptions' must be a list"


async def test_exceptions_that_are_not_objects_are_ignored(db):
    plan = await plan_holiday_import(
        db, {"holiday_exceptions": ["junk", 3, {"day": EASTER_MONDAY}]}, create_missing_calendars=False
    )
    assert plan.exceptions == [{"day": EASTER_MONDAY}]


# ── Applying: duplicates collapse, unmatched exceptions drop ─────────────────


@pytest.fixture
async def team(db) -> Team:
    team = Team(name="Imported")
    db.add(team)
    await db.flush()
    return team


async def _apply(db, team: Team, team_data: dict, member_map: dict[str, str] | None = None) -> list[str]:
    plan = await plan_holiday_import(db, team_data, create_missing_calendars=True)
    return await apply_holiday_import(db, plan, team.system_id, member_map or {})


async def test_a_created_calendar_keeps_one_copy_of_a_repeated_entry(db, team):
    notes = await _apply(
        db,
        team,
        {
            "holiday_calendars": [
                _calendar(
                    "Switzerland",
                    _holiday(),
                    _holiday(label="  easter   MONDAY "),
                    _holiday("May Day", "2026-05-01"),
                )
            ]
        },
    )
    assert notes == ['Created holiday calendar "Switzerland" with 2 entries.']
    labels = (await db.execute(select(HolidayEntry.label).order_by(HolidayEntry.start_date))).scalars().all()
    assert labels == ["Easter Monday", "May Day"]
    assert await db.scalar(select(func.count()).select_from(TeamHolidayCalendar)) == 1


def _exception(
    member: str = "m-old",
    calendar: str = "Switzerland",
    label: str = "Easter Monday",
    start: str = EASTER_MONDAY,
    day: str = EASTER_MONDAY,
) -> dict:
    return {"member_id": member, "calendar": calendar, "entry": {"label": label, "start_date": start}, "day": day}


async def test_exceptions_that_match_no_holiday_are_dropped_and_counted(db, team):
    shutdown = _holiday("Shutdown", "2026-12-28", end_date="2026-12-31")
    notes = await _apply(
        db,
        team,
        {
            "holiday_calendars": [_calendar("Switzerland", _holiday(), shutdown)],
            "holiday_exceptions": [
                _exception(),  # kept
                _exception(label=" easter  monday", day=EASTER_MONDAY, member="m-two"),  # kept: label normalised
                _exception(day="not a date"),  # unreadable day
                {"member_id": "m-old", "calendar": "Switzerland", "entry": "Easter Monday", "day": EASTER_MONDAY},
                _exception(member="m-unknown"),  # member not in the file
                _exception(calendar="Elsewhere"),  # calendar not in the file
                _exception(label="Whit Monday"),  # no such holiday
                _exception(day="2026-04-07"),  # outside the holiday
                _exception(label="Shutdown", start="2026-12-28", day="2027-01-01"),  # past its end
            ],
        },
        {"m-old": "m-new", "m-two": "m-new-2"},
    )
    assert notes[-1] == "7 holiday exceptions could not be matched to a holiday and were dropped."
    kept = (await db.execute(select(HolidayException.member_id, HolidayException.day))).all()
    assert sorted(kept) == [("m-new", date(2026, 4, 6)), ("m-new-2", date(2026, 4, 6))]


async def test_one_dropped_exception_is_reported_in_the_singular(db, team):
    notes = await _apply(
        db,
        team,
        {
            "holiday_calendars": [_calendar("Switzerland", _holiday())],
            "holiday_exceptions": [_exception(day="2026-04-07")],
        },
        {"m-old": "m-new"},
    )
    assert notes[-1] == "1 holiday exception could not be matched to a holiday and were dropped."
    assert await db.scalar(select(func.count()).select_from(HolidayException)) == 0


async def test_matched_exceptions_add_no_note(db, team):
    notes = await _apply(
        db,
        team,
        {
            "holiday_calendars": [_calendar("Switzerland", _holiday())],
            "holiday_exceptions": [_exception()],
        },
        {"m-old": "m-new"},
    )
    assert notes == ['Created holiday calendar "Switzerland" with 1 entries.']

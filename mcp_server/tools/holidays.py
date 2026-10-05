"""Shared holiday calendar write tools (spec/public-holidays.md §9.3).

Three rules, each easy to get wrong from an agent's side:

**Calendars are addressed by name.** A calendar is shared across the whole app
and agents know it as "Switzerland — national", not by id. An unknown name is
rejected with the list of calendars that exist — never created implicitly — the
ADR-0003 rule `resolve_state_id` follows. Creating a calendar is its own tool.

**No edit lock.** Calendars belong to no project and are outside the
single-writer lock by construction, like team data. Concurrency is the per-row
`If-Match`: every update or delete reads the row first and quotes the ETag that
read returned.

**No `delete_holiday_calendar`.** teams.md §8.2.6 draws the line at "leaves yes,
containers no". A calendar is a container other teams depend on, so deleting one
stays a human act in the UI. Deleting a single entry is a leaf, and is exposed.
"""

from typing import Annotated

from fastmcp import Context, FastMCP
from pydantic import Field

from mcp_server.backend import call_backend

holidays_mcp = FastMCP("holidays")

_UUID_RE = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
_CALENDARS = "/api/v1/holiday-calendars"

_CALENDAR_NAME = "Holiday calendar name, as list_holiday_calendars reports it (case does not matter)"


async def resolve_calendar(name: str) -> dict:
    """The calendar with this name, or a ValueError naming the ones that exist."""
    calendars = (await call_backend("GET", _CALENDARS)).get("items", [])
    wanted = " ".join(name.split()).lower()
    for calendar in calendars:
        if calendar["name"].lower() == wanted:
            return calendar
    known = ", ".join(c["name"] for c in calendars) or "none yet"
    raise ValueError(
        f"No holiday calendar named {name!r}. Calendars: {known}. "
        "Create one with create_holiday_calendar if a new one is really meant."
    )


async def _entry(calendar_id: str, entry_id: str) -> dict:
    detail = await call_backend("GET", f"{_CALENDARS}/{calendar_id}")
    for entry in detail.get("entries", []):
        if entry["system_id"] == entry_id:
            return entry
    raise ValueError(
        f"No entry {entry_id} in this calendar. Call get_holiday_calendar to see its entries."
    )


def _entry_body(
    label: str | None, start_date: str | None, end_date: str | None,
    start_half: str | None, end_half: str | None,
) -> dict:
    body: dict = {}
    if label is not None:
        body["label"] = label
    if start_date is not None:
        body["start_date"] = start_date
    if end_date is not None:
        body["end_date"] = end_date
    if start_half is not None:
        body["start_half"] = start_half
    if end_half is not None:
        body["end_half"] = end_half
    return body


@holidays_mcp.tool()
async def create_holiday_calendar(
    name: Annotated[str, Field(max_length=100, description="Unique name, e.g. 'Switzerland — national'")],
    ctx: Context,
    description: Annotated[str | None, Field(default=None, max_length=500)] = None,
) -> dict:
    """
    Create a shared holiday calendar.

    Calendars belong to no team: every team that observes the same holidays
    enables the same calendar (enable_team_calendar). Names are unique ignoring
    case. Add holidays with create_holiday_entry, replace_holiday_entries or
    import_holiday_ics.
    """
    return await call_backend("POST", _CALENDARS, json={"name": name, "description": description})


@holidays_mcp.tool()
async def update_holiday_calendar(
    calendar: Annotated[str, Field(description=_CALENDAR_NAME)],
    ctx: Context,
    new_name: Annotated[str | None, Field(default=None, max_length=100)] = None,
    description: Annotated[str | None, Field(default=None, max_length=500)] = None,
) -> dict:
    """Rename a holiday calendar or change its description. Teams keep it: they enable it by id."""
    current = await resolve_calendar(calendar)
    body: dict = {}
    if new_name is not None:
        body["name"] = new_name
    if description is not None:
        body["description"] = description
    if not body:
        raise ValueError("Nothing to change: pass new_name and/or description.")
    return await call_backend(
        "PATCH", f"{_CALENDARS}/{current['system_id']}", json=body,
        headers={"If-Match": current["etag"]},
    )


@holidays_mcp.tool()
async def create_holiday_entry(
    calendar: Annotated[str, Field(description=_CALENDAR_NAME)],
    label: Annotated[str, Field(max_length=100, description="e.g. 'Christmas Day'")],
    start_date: Annotated[str, Field(description="First day, YYYY-MM-DD")],
    ctx: Context,
    end_date: Annotated[str | None, Field(default=None, description="Last day, inclusive; omit for one day")] = None,
    start_half: Annotated[str | None, Field(default=None, description="'am' (default) or 'pm'")] = None,
    end_half: Annotated[str | None, Field(default=None, description="'pm' (default) or 'am'")] = None,
) -> dict:
    """
    Add one holiday to a calendar. Every team with the calendar enabled loses
    capacity on it at once.

    A holiday is a dated range, never a recurring rule: one entry per occurrence.
    start_half 'am' (default) or 'pm' opens it; end_half 'pm' (default) or 'am'
    closes it — Christmas Eve afternoon is start_half='pm' on a one-day entry.
    """
    current = await resolve_calendar(calendar)
    body = _entry_body(label, start_date, end_date, start_half, end_half)
    return await call_backend("POST", f"{_CALENDARS}/{current['system_id']}/entries", json=body)



@holidays_mcp.tool()
async def update_holiday_entry(
    calendar: Annotated[str, Field(description=_CALENDAR_NAME)],
    entry_id: Annotated[str, Field(pattern=_UUID_RE, description="Entry system_id — from get_holiday_calendar")],
    ctx: Context,
    label: Annotated[str | None, Field(default=None, max_length=100)] = None,
    start_date: Annotated[str | None, Field(default=None)] = None,
    end_date: Annotated[str | None, Field(default=None)] = None,
    start_half: Annotated[str | None, Field(default=None)] = None,
    end_half: Annotated[str | None, Field(default=None)] = None,
) -> dict:
    """
    Change a holiday. Only the fields given change.

    "Works this holiday" exceptions on days the entry no longer covers are
    deleted. The returned entry's exception_days shows what remains.
    """
    current = await resolve_calendar(calendar)
    entry = await _entry(current["system_id"], entry_id)
    body = _entry_body(label, start_date, end_date, start_half, end_half)
    if not body:
        raise ValueError("Nothing to change.")
    return await call_backend(
        "PATCH", f"{_CALENDARS}/{current['system_id']}/entries/{entry_id}", json=body,
        headers={"If-Match": entry["etag"]},
    )


@holidays_mcp.tool()
async def delete_holiday_entry(
    calendar: Annotated[str, Field(description=_CALENDAR_NAME)],
    entry_id: Annotated[str, Field(pattern=_UUID_RE, description="Entry system_id — from get_holiday_calendar")],
    ctx: Context,
) -> dict:
    """
    Delete one holiday, permanently, with its "works this holiday" exceptions.

    Deleting a whole calendar is not available here; that stays a UI action.
    """
    current = await resolve_calendar(calendar)
    entry = await _entry(current["system_id"], entry_id)
    await call_backend(
        "DELETE", f"{_CALENDARS}/{current['system_id']}/entries/{entry_id}",
        headers={"If-Match": entry["etag"]},
    )
    return {"deleted": entry_id, "label": entry["label"]}


@holidays_mcp.tool()
async def replace_holiday_entries(
    calendar: Annotated[str, Field(description=_CALENDAR_NAME)],
    window_from: Annotated[str, Field(description="First day of the window, YYYY-MM-DD")],
    window_to: Annotated[str, Field(description="Last day of the window, YYYY-MM-DD")],
    entries: Annotated[
        list[dict],
        Field(
            max_length=2000,
            description=(
                "The holidays that should exist in the window, each "
                "{label, start_date, end_date?, start_half?, end_half?}. Every entry "
                "must start inside the window."
            ),
        ),
    ],
    ctx: Context,
    dry_run: Annotated[bool, Field(default=True, description="Preview the counts without writing (default)")] = True,
) -> dict:
    """
    Replace every holiday starting inside a window with the given list, in one transaction.

    This is the path for a holiday page an agent re-reads on a schedule:
    replacing, not appending, so a second run does not double everything and an
    entry deleted at the source disappears here. "Works this holiday" exceptions
    survive on entries that come back with the same dates, halves and label, and
    are dropped otherwise. Run with dry_run=true first and show the counts.
    """
    current = await resolve_calendar(calendar)
    return await call_backend(
        "PUT", f"{_CALENDARS}/{current['system_id']}/entries",
        json={"window_from": window_from, "window_to": window_to, "entries": entries, "dry_run": dry_run},
    )


@holidays_mcp.tool()
async def import_holiday_ics(
    calendar: Annotated[str, Field(description=_CALENDAR_NAME)],
    ics_content: Annotated[str, Field(description="The full text of an iCalendar (.ics) file")],
    ctx: Context,
    from_year: Annotated[int | None, Field(default=None, description="First year to expand yearly events into")] = None,
    to_year: Annotated[int | None, Field(default=None, description="Last year to expand yearly events into")] = None,
    dry_run: Annotated[bool, Field(default=True, description="Preview without writing (default)")] = True,
) -> dict:
    """
    Merge an .ics file (an Outlook or Google export) into a calendar.

    Holidays already there are skipped, so importing twice adds nothing. Yearly
    events are expanded into one dated entry per year in from_year..to_year
    (default: this year and next). Other recurrences and tasks are skipped and
    listed with the reason. Run with dry_run=true first.
    """
    current = await resolve_calendar(calendar)
    params: dict = {"dry_run": str(dry_run).lower()}
    if from_year is not None:
        params["from_year"] = from_year
    if to_year is not None:
        params["to_year"] = to_year
    return await call_backend(
        "POST", f"{_CALENDARS}/{current['system_id']}/import/ics",
        params=params,
        files={"file": ("holidays.ics", ics_content.encode(), "text/calendar")},
    )


@holidays_mcp.tool()
async def enable_team_calendar(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    calendar: Annotated[str, Field(description=_CALENDAR_NAME)],
    ctx: Context,
) -> dict:
    """
    Make a team observe a holiday calendar's holidays.

    Enabling restates the team's capacity for every sprint it touches, closed ones
    included, and through that its Achievement figures. Sprint Available is never
    rewritten: a derived project reads stale until someone pushes.
    """
    current = await resolve_calendar(calendar)
    await call_backend("PUT", f"/api/v1/teams/{team_id}/holiday-calendars/{current['system_id']}")
    return {"team_id": team_id, "calendar": current["name"], "enabled": True}



@holidays_mcp.tool()
async def disable_team_calendar(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    calendar: Annotated[str, Field(description=_CALENDAR_NAME)],
    ctx: Context,
) -> dict:
    """
    Stop a team observing a holiday calendar.

    Its "works this holiday" exceptions are kept and come back if it is enabled
    again. Disabling restates the team's capacity for every sprint it touches,
    closed ones included. Sprint Available is never rewritten.
    """
    current = await resolve_calendar(calendar)
    await call_backend("DELETE", f"/api/v1/teams/{team_id}/holiday-calendars/{current['system_id']}")
    return {"team_id": team_id, "calendar": current["name"], "enabled": False}



@holidays_mcp.tool()
async def set_holiday_exception(
    team_id: Annotated[str, Field(pattern=_UUID_RE, description="Team system_id (UUID) — from list_teams")],
    member_name: Annotated[str, Field(description="The member, by name as list_members reports them")],
    entry_id: Annotated[str, Field(pattern=_UUID_RE, description="Holiday entry system_id — from list_team_holidays")],
    day: Annotated[str, Field(description="The day of the holiday, YYYY-MM-DD")],
    works: Annotated[bool, Field(description="true: the member works this day; false: they are off after all")],
    ctx: Context,
) -> dict:
    """
    Record that a member works (or doesn't work) one day of a public holiday — e.g. on call.

    The exception covers the whole day and cancels only the holiday: leave booked
    on the same day still counts. The calendar must be enabled for the team.
    """
    from mcp_server.tools.teams import resolve_member_id

    member_id = await resolve_member_id(team_id, member_name)
    url = f"/api/v1/teams/{team_id}/members/{member_id}/holiday-exceptions/{entry_id}/{day}"
    await call_backend("PUT" if works else "DELETE", url)
    return {"member": member_name, "entry_id": entry_id, "day": day, "works": works}

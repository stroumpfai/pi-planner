"""Shared holiday calendars over the wire (spec/public-holidays.md).

An entry is always a dated range with a starting and an ending half — the same
shape as a `range` absence, and nothing else (§3.2). There is no recurrence:
moving holidays, and the series-editing problem teams.md §3.4 avoids, rule it out.
"""

from datetime import date

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.absence import Half
from app.schemas.common import UtcDatetime

# Sanity limits in the style of teams.md §9 (public-holidays.md §3.7).
MAX_CALENDARS = 200
MAX_ENTRIES_PER_CALENDAR = 2000
MAX_CALENDARS_PER_TEAM = 20


def _clean(value: str) -> str:
    return " ".join(value.split())


class HolidayEntryFields(BaseModel):
    label: str = Field(..., min_length=1, max_length=100)
    start_date: date
    start_half: Half = "am"
    # The last day, inclusive. Defaults to a one-day holiday.
    end_date: date | None = None
    end_half: Half = "pm"

    @field_validator("label")
    @classmethod
    def _label(cls, value: str) -> str:
        cleaned = _clean(value)
        if not cleaned:
            raise ValueError("label cannot be blank")
        return cleaned

    @model_validator(mode="after")
    def _coherent(self) -> "HolidayEntryFields":
        return validate_entry(self)

    @property
    def last_day(self) -> date:
        return self.end_date or self.start_date


def validate_entry(fields: HolidayEntryFields) -> HolidayEntryFields:
    """Reject a range that cannot be drawn: ending before it starts.

    Shared with the PATCH path, which merges a patch onto the stored row and then
    validates the result, as the absence routes do.
    """
    last = fields.end_date or fields.start_date
    if last < fields.start_date:
        raise ValueError("end_date cannot fall before start_date")
    if last == fields.start_date and fields.start_half == "pm" and fields.end_half == "am":
        raise ValueError("a one-day holiday cannot end in the morning after starting in the afternoon")
    return fields


class HolidayEntryUpdate(BaseModel):
    label: str | None = Field(None, min_length=1, max_length=100)
    start_date: date | None = None
    start_half: Half | None = None
    end_date: date | None = None
    end_half: Half | None = None


class HolidayEntryResponse(BaseModel):
    system_id: str
    calendar_id: str
    label: str
    start_date: date
    start_half: Half
    end_date: date
    end_half: Half
    # Every team's exceptions on this entry, so the dialog can say how many a date
    # change would drop before it is saved (§3.5).
    exception_days: list[date] = Field(default_factory=list)
    created_at: UtcDatetime
    modified_at: UtcDatetime
    etag: str = ""


class TeamRef(BaseModel):
    system_id: str
    name: str


class HolidayCalendarCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        cleaned = _clean(value)
        if not cleaned:
            raise ValueError("name cannot be blank")
        return cleaned


class HolidayCalendarUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=500)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = _clean(value)
        if not cleaned:
            raise ValueError("name cannot be blank")
        return cleaned


class HolidayCalendarSummary(BaseModel):
    system_id: str
    name: str
    description: str | None
    entry_count: int
    first_year: int | None
    last_year: int | None
    teams: list[TeamRef]
    created_at: UtcDatetime
    modified_at: UtcDatetime
    etag: str = ""


class HolidayCalendarDetail(HolidayCalendarSummary):
    entries: list[HolidayEntryResponse]


# ── bulk replace (§7.3) ──────────────────────────────────────────────────────


class BulkHolidayEntriesRequest(BaseModel):
    """Replace every entry whose ``start_date`` lies in the window, in one transaction.

    Replacement, not merge, for the reason the absence bulk import gives: a source
    re-read on a schedule would otherwise double everything, and only replacement
    survives an entry being deleted at the source.
    """

    window_from: date
    window_to: date
    entries: list[HolidayEntryFields] = Field(default_factory=list, max_length=MAX_ENTRIES_PER_CALENDAR)
    dry_run: bool = False

    @model_validator(mode="after")
    def _ordered(self) -> "BulkHolidayEntriesRequest":
        if self.window_to < self.window_from:
            raise ValueError("window_to cannot fall before window_from")
        outside = [e for e in self.entries if not self.window_from <= e.start_date <= self.window_to]
        if outside:
            # An entry outside the window could never be replaced by the next run.
            raise ValueError(
                f"every entry must start inside the window; {outside[0].label} "
                f"({outside[0].start_date}) does not"
            )
        return self


class BulkHolidayEntriesResult(BaseModel):
    dry_run: bool
    created: int
    deleted: int
    exceptions_kept: int
    exceptions_dropped: int


# ── copy year (§6.3) ─────────────────────────────────────────────────────────


class CopyYearProposal(HolidayEntryFields):
    source_start_date: date
    # Where a fixed-date holiday most often needs a second look; flagged, never moved.
    on_weekend: bool
    # Already in the target year with the same dates and label; copying would skip it.
    duplicate: bool


class CopyYearPreview(BaseModel):
    from_year: int
    to_year: int
    proposals: list[CopyYearProposal]


class CopyYearRequest(BaseModel):
    """The reviewed list. Nothing is inferred about which holidays move (§6.3)."""

    entries: list[HolidayEntryFields] = Field(..., max_length=MAX_ENTRIES_PER_CALENDAR)


class EntriesCreatedResult(BaseModel):
    created: int
    duplicates: int


# ── .ics import (§7.1) ───────────────────────────────────────────────────────


class IcsSkipped(BaseModel):
    summary: str
    reason: str


class IcsImportResult(BaseModel):
    dry_run: bool
    created: int
    duplicates: int
    skipped: list[IcsSkipped]
    truncated_labels: int
    # What would be (or was) created, so the preview can list it.
    entries: list[HolidayEntryFields]


# ── the team's side (§5) ─────────────────────────────────────────────────────


class HolidayDay(BaseModel):
    date: date
    halves: list[Half]


class HolidayExceptionRef(BaseModel):
    member_id: str
    day: date


class TeamHolidayEntry(BaseModel):
    system_id: str
    calendar_id: str
    calendar_name: str
    label: str
    start_date: date
    start_half: Half
    end_date: date
    end_half: Half
    days: list[HolidayDay]
    exceptions: list[HolidayExceptionRef]


class TeamHolidaysResponse(BaseModel):
    team_id: str
    enabled_calendar_ids: list[str]
    entries: list[TeamHolidayEntry]


class CleanupMember(BaseModel):
    member_id: str
    name: str
    absence_id: str


class CleanupGroup(BaseModel):
    """Old everyone-absences on dates an enabled calendar already covers (§6.4)."""

    label: str | None
    start_date: date
    start_half: Half
    end_date: date
    end_half: Half
    members: list[CleanupMember]


class CleanupResponse(BaseModel):
    groups: list[CleanupGroup]


class CleanupRequest(BaseModel):
    absence_ids: list[str] = Field(..., min_length=1, max_length=5000)


class CleanupResult(BaseModel):
    deleted: int


# ── PI board sprint headers (§8.1) ───────────────────────────────────────────


class SprintHoliday(BaseModel):
    label: str
    calendar_name: str
    start_date: date
    start_half: Half
    end_date: date
    end_half: Half


class SprintHolidays(BaseModel):
    sprint_id: str
    holidays: list[SprintHoliday]


class ProjectHolidaysResponse(BaseModel):
    project_id: str
    team_id: str | None
    sprints: list[SprintHolidays]

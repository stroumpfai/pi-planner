"""What a meeting is, over the wire (spec/teams.md §3.5, §7.5).

A meeting is a schedule rule — the **same three kinds an absence carries** — plus
three things an absence has no use for: the half-day an occurrence starts in, how
long it runs, and who attends.

Four shapes here look like inconsistencies with `absence.py` and are each
deliberate:

**One meeting, many attendees — not one record per person.** `POST /absences`
fans a rule out into one row per member because everybody's Christmas is
independently correctable afterwards. A meeting is the opposite: it is a shared
event with one schedule, and the thing that changes week to week is who is in it
(§7.5). So `member_ids` here is an **attendee set on one row**, and the Meetings
view can be a matrix of members against meetings rather than a list of
near-duplicate rows.

**`half`, not `halves`.** An absence covers whichever halves it names; a meeting
*starts* in one and spills into the rest of the day from there (§5.4 step 4).
Placement is what lets a meeting be cancelled against an absence, so it is a
single value, and a `range` meeting starts in the same half on each of its days.

**`duration_minutes`, not hours.** A five-minute stand-up is 5. As a float count
of hours it is 0.0833, and no rounding rule makes that read well.

**A response carries its occurrences**, expanded by the server inside the window
the reader asks for — for the same reason absences do: expanding a recurrence in
the client would be a second implementation of `occurrences.py`, free to disagree
with the one the capacity figures come from.
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import UtcDatetime

# spec/teams.md §9. A *definition* count, not an occurrence count: a daily
# stand-up over a year is one weekly rule per weekday, not 250 rows (§3.5).
MAX_MEETINGS_PER_TEAM = 100

# §3.5: five minutes to eight hours, in steps of 5. The upper bound is a whole
# working day and is deliberately not tied to the attendee's own day — an 8 h
# workshop is enterable for a 6 h/day member, and costs their whole day (§5.4).
MIN_DURATION_MINUTES = 5
MAX_DURATION_MINUTES = 480
DURATION_STEP_MINUTES = 5

Half = Literal["am", "pm"]
Kind = Literal["range", "weekly", "interval"]


class MeetingFields(BaseModel):
    """The schedule rule, the placement and the length — everything but attendance.

    `start_date` means what it means for an absence: the first day of a `range`,
    and the **anchor** of a recurrence — the date deciding which alternate weeks
    are hit. Fields belonging to the other kinds are ignored rather than rejected,
    so switching kind in a form need not clear them.
    """

    title: str = Field(..., min_length=1, max_length=100)
    kind: Kind
    start_date: date
    # For a `range`, the last day, inclusive — each day of the block is an
    # occurrence costing `duration_minutes` (§11). For a recurring rule, when it
    # stops; omitted means open-ended.
    end_date: date | None = None
    weekday: int | None = Field(None, ge=0, le=6)
    interval_weeks: int | None = Field(None, ge=2, le=52)
    # Where an occurrence *starts*. It is not confined there: a meeting longer
    # than its half spills into the rest of the same day (§3.5).
    half: Half = "am"
    duration_minutes: int = Field(
        ..., ge=MIN_DURATION_MINUTES, le=MAX_DURATION_MINUTES, multiple_of=DURATION_STEP_MINUTES
    )

    @model_validator(mode="after")
    def _coherent(self) -> "MeetingFields":
        return _validate_rule(self)


def _validate_rule(fields: "MeetingFields") -> "MeetingFields":
    """Reject a rule that cannot be drawn, whatever route assembled it.

    Shared with `MeetingUpdate`, which merges a patch onto a stored row and then
    validates the result — a partial update must not be able to leave behind a
    weekly meeting with no weekday.

    Deliberately *not* shared with the absence validator: they overlap on the
    recurrence fields and diverge on the half-day ones, and a common base that
    carried both sets would let a meeting be saved with `halves` it has no column
    for.
    """
    if fields.end_date is not None and fields.end_date < fields.start_date:
        raise ValueError("end_date cannot fall before start_date")
    if fields.kind == "range":
        return fields
    if fields.weekday is None:
        raise ValueError(f"a {fields.kind} rule needs a weekday (0 = Monday … 6 = Sunday)")
    if fields.kind == "interval" and fields.interval_weeks is None:
        raise ValueError("an interval rule needs interval_weeks (2–52)")
    return fields


class MeetingCreate(MeetingFields):
    """One meeting, with the people who attend it.

    The attendee list may be **empty**: a meeting nobody attends is allowed and
    costs nothing (§11). That is what lets the schedule be entered first and
    attendance ticked afterwards in the matrix, which is the order people work in.
    """

    member_ids: list[str] = Field(default_factory=list, max_length=50)


class MeetingUpdate(BaseModel):
    """A patch. Every field optional; the merged result is validated as a whole.

    `member_ids` **replaces** the attendee set when present and is left alone when
    absent — which is what makes a matrix cell toggle a single ordinary PATCH
    rather than a pair of add/remove endpoints.
    """

    title: str | None = Field(None, min_length=1, max_length=100)
    kind: Kind | None = None
    start_date: date | None = None
    end_date: date | None = None
    weekday: int | None = Field(None, ge=0, le=6)
    interval_weeks: int | None = Field(None, ge=2, le=52)
    half: Half | None = None
    duration_minutes: int | None = Field(
        None, ge=MIN_DURATION_MINUTES, le=MAX_DURATION_MINUTES, multiple_of=DURATION_STEP_MINUTES
    )
    member_ids: list[str] | None = Field(None, max_length=50)


class MeetingReorder(BaseModel):
    """Column order for the matrix, as a list of meeting ids (§7.5)."""

    order: list[str] = Field(..., max_length=MAX_MEETINGS_PER_TEAM)


class MeetingResponse(BaseModel):
    system_id: str
    team_id: str
    title: str
    kind: str
    start_date: date
    end_date: date | None
    weekday: int | None
    interval_weeks: int | None
    half: str
    duration_minutes: int
    order_index: int
    # The attendee set, in the team's member order. Attendance is edited through
    # the meeting, which is why there is no attendee endpoint of its own.
    member_ids: list[str] = []
    # The rule in words — "every 2nd Friday am, from 2026-09-04, ongoing". The
    # same sentence the column head, the dialog summary and an MCP result show.
    summary: str = ""
    # Occurrence dates inside the window that was read; empty when the meeting
    # falls entirely outside it. The rule still comes back — a meeting out of the
    # selected sprint keeps its column and simply contributes nothing (§7.5).
    occurrences: list[date] = []
    created_at: UtcDatetime
    modified_at: UtcDatetime
    # The tag a PATCH or DELETE must quote in If-Match. In the body, not a header:
    # meetings are read as a list, and a header describes one row (§4.2).
    etag: str = ""

    model_config = {"from_attributes": True}


class BulkMeetingEntry(MeetingFields):
    """One line of a bulk import, addressing attendees **by name**.

    Names rather than ids because the source is a wiki page read by a model, and
    it has never seen a UUID. Unknown names are reported, never created (§8.2.4).
    """

    member_names: list[str] = Field(default_factory=list, max_length=50)
    # "Everyone attends the stand-up" without the agent having to list the team,
    # and without it going stale the next time somebody joins (§8.2.4).
    all_members: bool = False


class BulkMeetingRequest(BaseModel):
    """Replace this team's meetings anchored inside a window (§8.2.7).

    **Replacement, not merge**, on the same rule absences use: membership of the
    window is decided by `start_date`, so a stand-up anchored last year survives
    a window covering next month even though it occurs inside it.
    """

    window_from: date
    window_to: date
    entries: list[BulkMeetingEntry] = Field(default_factory=list, max_length=MAX_MEETINGS_PER_TEAM)
    dry_run: bool = False

    @model_validator(mode="after")
    def _ordered(self) -> "BulkMeetingRequest":
        if self.window_to < self.window_from:
            raise ValueError("window_to cannot fall before window_from")
        return self


class BulkMeetingResult(BaseModel):
    """What a bulk write did, or would do.

    `unresolved_names` collects **every** unknown attendee rather than raising on
    the first: spelling variants arrive in groups (§8.2.7).
    """

    dry_run: bool
    window_from: date
    window_to: date
    created: int
    deleted: int
    unresolved_names: list[str] = []
    meetings: list[MeetingResponse] = []

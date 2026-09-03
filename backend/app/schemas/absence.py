"""What an absence is, over the wire (spec/teams.md §3.4).

An absence is a member plus a schedule rule, and nothing else. There is **no
category**: `label` is text for the human reading the row and is never
interpreted by the capacity maths.

Two shapes here are worth reading before using them:

**`POST` takes `member_ids`, not `member_id`.** One request creates one record
per member, in one transaction, each independently editable afterwards. That is
the whole mechanism for public holidays — Christmas is entered once with everyone
selected, and can then be corrected for whoever is actually on call (§3.4).

**A response carries its occurrences.** The rule is the stored truth, but the
grid draws half-days, and expanding a recurrence in the client would be a second
implementation of `occurrences.py` that could disagree with the one the capacity
figures come from. So the server expands, inside the window the reader asks for.
"""

from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.common import UtcDatetime

# spec/teams.md §9. Multi-year plans are expected: annual leave is routinely
# entered twelve months out, so the ceiling is per member and generous.
MAX_ABSENCES_PER_MEMBER = 2000

Half = Literal["am", "pm"]
Kind = Literal["range", "weekly", "interval"]

#: How far a default read looks when no window is named — a year from the start
#: of the current month, which is exactly what the view's 12-month minimap spans.
DEFAULT_WINDOW_MONTHS = 12


class ScheduleFields(BaseModel):
    """The schedule rule shared by absences and meetings (§3.4).

    Every kind uses `start_date`, and it means something different in each: the
    first day of a `range`, and the **anchor** of a recurrence — the date that
    decides which alternate weeks are hit. Nothing here is validated against the
    other kinds' fields being absent; they are simply ignored, so switching kind
    in a form need not clear them.
    """

    kind: Kind
    label: str | None = Field(None, max_length=100)
    start_date: date
    # Recurring kinds may run without an end — "every Wednesday afternoon, until
    # further notice" needs no sentinel date, because occurrences are only ever
    # generated inside a bounded window (§3.4). For a `range` this is the last
    # day, inclusive, and defaults to a one-day block.
    end_date: date | None = None
    start_half: Half = "am"
    end_half: Half = "pm"
    weekday: int | None = Field(None, ge=0, le=6)
    halves: list[Half] | None = None
    # 2, not 1. "Every week" is the `weekly` kind, and a field reading "every [1]
    # weeks" in front of the common case is what having three kinds avoids (§3.4).
    interval_weeks: int | None = Field(None, ge=2, le=52)

    @model_validator(mode="after")
    def _coherent(self) -> "ScheduleFields":
        return _validate_rule(self)


def _validate_rule(fields: "ScheduleFields") -> "ScheduleFields":
    """Reject a rule that cannot be drawn, whatever route assembled it.

    Shared with `AbsenceUpdate`, which merges a patch onto a stored row and then
    validates the result — a partial update must not be able to leave behind a
    weekly rule with no weekday.
    """
    if fields.kind == "range":
        last = fields.end_date or fields.start_date
        if last < fields.start_date:
            raise ValueError("end_date cannot fall before start_date")
        if last == fields.start_date and fields.start_half == "pm" and fields.end_half == "am":
            raise ValueError("a one-day range cannot start in the afternoon and end in the morning")
        return fields

    if fields.weekday is None:
        raise ValueError(f"a {fields.kind} rule needs a weekday (0 = Monday … 6 = Sunday)")
    if not fields.halves:
        raise ValueError(f"a {fields.kind} rule needs at least one half — am, pm, or both")
    if fields.end_date is not None and fields.end_date < fields.start_date:
        raise ValueError("end_date cannot fall before start_date")
    if fields.kind == "interval" and fields.interval_weeks is None:
        raise ValueError("an interval rule needs interval_weeks (2–52)")
    return fields


class AbsenceCreate(ScheduleFields):
    """One rule, applied to one or more members.

    The multi-select is an input convenience, not a shared object: the result is
    one record each. Editing "everyone's Christmas" for the one person who is
    working that day must not force a delete and recreate (§3.4).
    """

    member_ids: list[str] = Field(..., min_length=1, max_length=50)


class AbsenceUpdate(BaseModel):
    """A patch. Every field optional; the merged result is validated as a whole.

    ``member_id`` is deliberately absent — moving an absence to another person is
    a delete and a create, and letting it slide across in a patch would make the
    412 banner's "yours / theirs" compare two different people's rows.
    """

    label: str | None = Field(None, max_length=100)
    kind: Kind | None = None
    start_date: date | None = None
    end_date: date | None = None
    start_half: Half | None = None
    end_half: Half | None = None
    weekday: int | None = Field(None, ge=0, le=6)
    halves: list[Half] | None = None
    interval_weeks: int | None = Field(None, ge=2, le=52)


class AbsenceOccurrence(BaseModel):
    """One day this absence touches, and which halves of it.

    Expanded by the server inside the requested window so the grid and the
    capacity figures are drawn from the same generator (§3.4).
    """

    date: date
    halves: list[Half]


class AbsenceResponse(BaseModel):
    system_id: str
    team_id: str
    member_id: str
    label: str | None
    kind: str
    start_date: date
    end_date: date | None
    start_half: str
    end_half: str
    weekday: int | None
    halves: list[Half] | None
    interval_weeks: int | None
    # The rule in words — "every 2nd Friday am, from 2026-09-04, ongoing". The
    # same sentence the dialog's summary line and an MCP result show, so the two
    # cannot describe the same row differently.
    summary: str = ""
    # Empty when the row falls entirely outside the window that was read; the
    # rule is still returned, because the minimap needs to know it exists.
    occurrences: list[AbsenceOccurrence] = []
    created_at: UtcDatetime
    modified_at: UtcDatetime
    # The tag a PATCH or DELETE must quote in If-Match. In the body, not a
    # header: absences are read as a list, and a header describes one row (§4.2).
    etag: str = ""

    model_config = {"from_attributes": True}


class BulkAbsenceEntry(ScheduleFields):
    """One line of a bulk import, addressing members **by name**.

    Names rather than ids because the source is a wiki page read by a model, and
    it has never seen a UUID. Unknown names are reported, never created (§8.2.4).
    """

    member_names: list[str] = Field(..., min_length=1, max_length=50)


class BulkAbsenceRequest(BaseModel):
    """Replace this team's absences anchored inside a window (§8.2.7).

    **Replacement, not merge.** The source page is re-read on a schedule, so a
    second run must not double every absence — and only replacement survives an
    entry being *deleted* from the page, which a merge would keep forever.

    Membership of the window is decided by ``start_date``: an absence anchored
    inside it is replaced, one anchored outside is untouched even if it happens
    to overlap. Anything else would silently delete a recurring rule that has run
    since last year.
    """

    window_from: date
    window_to: date
    entries: list[BulkAbsenceEntry] = Field(default_factory=list, max_length=2000)
    # A preview writes nothing and reports the same counts, so an agent can show
    # a misread column before it lands (§8.2.7).
    dry_run: bool = False

    @model_validator(mode="after")
    def _ordered(self) -> "BulkAbsenceRequest":
        if self.window_to < self.window_from:
            raise ValueError("window_to cannot fall before window_from")
        return self


class BulkAbsenceResult(BaseModel):
    """What a bulk write did, or would do.

    ``unresolved_names`` collects **every** unknown name rather than raising on
    the first: spelling variants arrive in groups, and a batch that reports one
    per round-trip is a batch nobody finishes (§8.2.7).
    """

    dry_run: bool
    window_from: date
    window_to: date
    created: int
    deleted: int
    # Nothing is written when this is non-empty, dry run or not.
    unresolved_names: list[str] = []
    absences: list[AbsenceResponse] = []


def default_window(today: date) -> tuple[date, date]:
    """The year a read spans when it names no window — the minimap's own span."""
    start = today.replace(day=1)
    year, month = divmod(start.month - 1 + DEFAULT_WINDOW_MONTHS, 12)
    end = start.replace(year=start.year + year, month=month + 1) - timedelta(days=1)
    return start, end

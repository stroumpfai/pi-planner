from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.common import UtcDatetime

# spec/teams.md §9. A hard stop, not a soft one: 50 teams is far past the point
# where the landing page is still readable, and the list is not paginated.
MAX_TEAMS = 50


class TeamCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = Field(None, max_length=2000)
    # The divisor that turns hours into person-days (§5.2). A team field rather
    # than a hardcoded 8 because a 37.5 h week is ordinary, and a 7.5 h day would
    # otherwise inflate every headline figure by 6.7%.
    normal_day_hours: float = Field(8.0, ge=1.0, le=24.0)


class TeamUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = Field(None, max_length=2000)
    normal_day_hours: float | None = Field(None, ge=1.0, le=24.0)


class TeamResponse(BaseModel):
    """A team, with the two counts the landing page reads.

    Teams are not planning items: the dual-ID system does not apply, so there is
    no ``id`` beside ``system_id`` here (§3.1).
    """

    system_id: str
    name: str
    description: str | None
    normal_day_hours: float
    member_count: int = 0
    # The projects this team serves, **anchor first**. The home page builds the
    # reverse map from it to fill each project row's Team column, so a project
    # never has to carry a team field of its own.
    project_ids: list[str] = []
    # What share of the team each of those projects takes, keyed by project id.
    # It rides along with the ids because the home page shows "Platform · 70%"
    # on the project row, and a second request per team to learn one integer
    # would be a request per row on the landing page (§7.1).
    project_shares: dict[str, int] = {}
    created_at: UtcDatetime
    modified_at: UtcDatetime

    model_config = {"from_attributes": True}


# spec/teams.md §9. Both are hard stops. 50 members is already a planning team
# nobody can read on one screen, and 50 versions is a contract that changed every
# month for four years.
MAX_MEMBERS_PER_TEAM = 50
MAX_PATTERN_VERSIONS_PER_MEMBER = 50

# The 14 half-day booleans, in the order the grid draws them (§3.3).
HALF_DAY_FIELDS: tuple[str, ...] = (
    "mon_am", "mon_pm", "tue_am", "tue_pm", "wed_am", "wed_pm", "thu_am", "thu_pm",
    "fri_am", "fri_pm", "sat_am", "sat_pm", "sun_am", "sun_pm",
)

# focus moves in steps of 0.05 (§3.3). Checked with a tolerance because 0.85
# arrives from JSON as 0.8500000000000001 often enough to matter.
_FOCUS_STEP = 0.05
_FOCUS_TOLERANCE = 1e-6


def _validate_focus(value: float) -> float:
    steps = value / _FOCUS_STEP
    if abs(steps - round(steps)) > _FOCUS_TOLERANCE:
        raise ValueError("focus moves in steps of 0.05 (e.g. 0.7, 0.75, 0.8)")
    return value


class PatternFields(BaseModel):
    """The contract itself: which half-days are owed, how long they are, and focus.

    Every field here is versioned. The member row holds only what has no date —
    who they are, and when they joined and left (§3.3).
    """

    mon_am: bool = True
    mon_pm: bool = True
    tue_am: bool = True
    tue_pm: bool = True
    wed_am: bool = True
    wed_pm: bool = True
    thu_am: bool = True
    thu_pm: bool = True
    fri_am: bool = True
    fri_pm: bool = True
    sat_am: bool = False
    sat_pm: bool = False
    sun_am: bool = False
    sun_pm: bool = False
    # Hours in one *full* contracted day — not the person-day divisor, which is
    # the team's normal_day_hours and is shared by everyone (§5.2).
    hours_per_day: float = Field(8.0, ge=1.0, le=12.0)
    focus: float = Field(1.0, ge=0.1, le=1.0)
    note: str | None = Field(None, max_length=100)

    @field_validator("focus")
    @classmethod
    def _focus_step(cls, value: float) -> float:
        return _validate_focus(value)


class PatternVersionCreate(PatternFields):
    """A new version, or an edit of the one already on that date.

    Posting a version whose ``effective_from`` already exists **edits** it rather
    than creating a duplicate (§3.3) — one date, one version, and no way to
    express a gap or an overlap.
    """

    effective_from: date


class FirstPatternVersion(PatternFields):
    """The version created with the member, in the same transaction.

    ``effective_from`` is optional here alone: it defaults to the member's
    ``active_from``, or today when that is blank, which is what the create-member
    form does (§3.3).
    """

    effective_from: date | None = None


class PatternVersionUpdate(BaseModel):
    mon_am: bool | None = None
    mon_pm: bool | None = None
    tue_am: bool | None = None
    tue_pm: bool | None = None
    wed_am: bool | None = None
    wed_pm: bool | None = None
    thu_am: bool | None = None
    thu_pm: bool | None = None
    fri_am: bool | None = None
    fri_pm: bool | None = None
    sat_am: bool | None = None
    sat_pm: bool | None = None
    sun_am: bool | None = None
    sun_pm: bool | None = None
    hours_per_day: float | None = Field(None, ge=1.0, le=12.0)
    focus: float | None = Field(None, ge=0.1, le=1.0)
    note: str | None = Field(None, max_length=100)
    effective_from: date | None = None

    @field_validator("focus")
    @classmethod
    def _focus_step(cls, value: float | None) -> float | None:
        return None if value is None else _validate_focus(value)


class PatternVersionResponse(BaseModel):
    """A stored version.

    The fields are declared here rather than inherited from ``PatternFields``
    because a stored row always has all fourteen booleans, a day length and a
    focus — none of them optional. Inheriting the defaults would publish them as
    optional in the schema, and the generated client would then make every reader
    invent a fallback for a value the row is guaranteed to carry.
    """

    system_id: str
    member_id: str
    effective_from: date
    mon_am: bool
    mon_pm: bool
    tue_am: bool
    tue_pm: bool
    wed_am: bool
    wed_pm: bool
    thu_am: bool
    thu_pm: bool
    fri_am: bool
    fri_pm: bool
    sat_am: bool
    sat_pm: bool
    sun_am: bool
    sun_pm: bool
    hours_per_day: float
    focus: float
    note: str | None
    created_at: UtcDatetime
    modified_at: UtcDatetime
    # The tag a PATCH or DELETE of this version must quote in If-Match. Carried in
    # the body because a version is only ever read as part of a collection, and a
    # header can only describe one row (§4.2).
    etag: str = ""

    model_config = {"from_attributes": True}


class MemberCreate(BaseModel):
    """A member and their first working pattern, created together.

    They cannot be separated: a member with no version has no contracted
    half-days, which computes as zero capacity and reads as a bug rather than as
    missing data (§3.3).
    """

    name: str = Field(..., min_length=1, max_length=100)
    # Descriptive free text — never read by the capacity maths, and deliberately
    # not a vocabulary table: there is no roles list for anyone to administer (§3.2).
    role: str | None = Field(None, max_length=50)
    organisation: str | None = Field(None, max_length=50)
    active_from: date | None = None
    active_to: date | None = None
    pattern: FirstPatternVersion = Field(default_factory=FirstPatternVersion)

    @model_validator(mode="after")
    def _validity_ordered(self) -> "MemberCreate":
        if self.active_from and self.active_to and self.active_to < self.active_from:
            raise ValueError("active_to cannot fall before active_from")
        return self


class MemberUpdate(BaseModel):
    """Identity and validity only.

    Hours and focus are absent on purpose: changing them means dating a new
    version, not overwriting a field, so they are reachable only through the
    working-days endpoints (§3.3, §7.2).
    """

    name: str | None = Field(None, min_length=1, max_length=100)
    role: str | None = Field(None, max_length=50)
    organisation: str | None = Field(None, max_length=50)
    active_from: date | None = None
    active_to: date | None = None


class MemberReorder(BaseModel):
    order: list[str]


class MemberResponse(BaseModel):
    """A member as every team view reads them.

    ``effective_version`` is the version in force on the requested ``as_of`` date,
    which is what makes one endpoint serve both views: Members shows today's
    hours and focus read-only, and Working days shows the same fields for any date
    the picker names (§7.2, §7.3).
    """

    system_id: str
    team_id: str
    name: str
    role: str | None
    organisation: str | None
    active_from: date | None
    active_to: date | None
    order_index: int
    created_at: UtcDatetime
    modified_at: UtcDatetime
    etag: str = ""

    # Never null in practice — a member always has at least one version, and the
    # earliest extends backwards without limit, so every date resolves (§3.3).
    effective_version: PatternVersionResponse | None = None
    # One marker per version, ascending: the row's timeline in the Working days
    # view. The full versions are a separate read; this is what a list needs.
    version_dates: list[date] = []
    # What deleting this member would take with them (§10). The confirm dialog
    # states the counts, so it reads them off the row it is already showing.
    absence_count: int = 0
    meeting_count: int = 0

    model_config = {"from_attributes": True}


# spec/teams.md §9. Twenty projects is already a team serving more products than
# its share percentages can meaningfully divide.
MAX_PROJECTS_PER_TEAM = 20

#: How a project's Available budget is produced (§6.4). "velocity" is Phase 2 and
#: is deliberately absent: nothing can compute it on today's data (§6.5).
AvailableSource = Literal["manual", "factor"]


class TeamProjectCreate(BaseModel):
    project_id: str
    # 1–100. Shares summing over 100% warn but never block: teams really are
    # overcommitted, and refusing to represent that hides what the tool exists to
    # reveal (§6.3).
    share_pct: int = Field(100, ge=1, le=100)
    available_source: AvailableSource = "manual"
    # Always the user's, validated for nothing beyond > 0. effort_unit is free
    # text, so the app cannot tell points from hours and does not try (§6.4).
    units_per_pd: float = Field(1.0, gt=0)


class TeamProjectUpdate(BaseModel):
    share_pct: int | None = Field(None, ge=1, le=100)
    available_source: AvailableSource | None = None
    units_per_pd: float | None = Field(None, gt=0)


class TeamProjectResponse(BaseModel):
    """One project this team serves, and how its PD reaches that project."""

    system_id: str
    team_id: str
    project_id: str
    project_name: str
    # The unit the project's Available is expressed in — free text, and never
    # interpreted (§6.4).
    effort_unit: str
    share_pct: int
    available_source: str
    units_per_pd: float
    # The earliest assignment is the team's anchor: its sprint calendar is the one
    # the team's own views count in (§6.8).
    is_anchor: bool = False
    created_at: UtcDatetime
    modified_at: UtcDatetime
    etag: str = ""

    model_config = {"from_attributes": True}

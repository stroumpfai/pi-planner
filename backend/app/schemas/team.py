from datetime import date
from typing import Annotated, Literal

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


class MemberLoad(BaseModel):
    member_id: str
    name: str
    # Σ of the member's share in every project that counts them, as a percentage
    # of their current contract — shares in days converted against it (§6.3.3).
    share_pct: float
    # The same load in days a week, and the days the current contract owes.
    days_per_week: float
    contracted_days: float
    # What the member's projects leave of their current contract, in days a week,
    # not counting the team's remaining project — the part such a project takes
    # or would take (§6.3.4). Never below 0.
    remaining_days: float = 0.0


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
    # For projects whose share is entered in days a week, that figure — it wins
    # over the percentage above (§6.3.2).
    project_share_days: dict[str, float] = {}
    # The project taking the team's remaining capacity, if any: its share above
    # is not read (§6.3.4, ADR 0012).
    remaining_project_id: str | None = None
    # Σ share_pct over the projects each counting member's capacity reaches —
    # what "over-allocated" means once an assignment can count only some members
    # (§6.3, ADR 0009). Current members who count towards capacity, in display order.
    member_loads: list[MemberLoad] = []
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



class TeamImportResponse(TeamResponse):
    """The imported team, plus what the import could not apply as written.

    Holiday calendars are shared, so an import reuses an existing calendar rather
    than editing it, and says so here (public-holidays.md §8.2).
    """

    import_notes: list[str] = []

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
    # Off for someone tracked for their absences only — their capacity is shown
    # but never totalled, shared out to projects, or pushed (§3.2).
    counts_towards_capacity: bool = True
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
    counts_towards_capacity: bool | None = None


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
    counts_towards_capacity: bool
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


#: A share in days a week: half-day steps, as patterns and absences are entered,
#: and never more than a week (§6.3.2).
ShareDays = Annotated[float, Field(gt=0, le=7, multiple_of=0.5)]


class MemberShare(BaseModel):
    """One member's own share of a project, overriding the assignment's (ADR 0010).

    Exactly one of a percentage or days a week.
    """

    member_id: str
    share_pct: int | None = Field(None, ge=1, le=100)
    share_days: ShareDays | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> "MemberShare":
        if (self.share_pct is None) == (self.share_days is None):
            raise ValueError("Give a member's share as a percentage or as days a week — one of them")
        return self


class TeamProjectCreate(BaseModel):
    project_id: str
    # 1–100. Shares summing over 100% warn but never block: teams really are
    # overcommitted, and refusing to represent that hides what the tool exists to
    # reveal (§6.3).
    share_pct: int = Field(100, ge=1, le=100)
    # The share in days a week instead: each counted member gives this many of
    # their own days (§6.3.2). Not with share_pct as well.
    share_days: ShareDays | None = None
    available_source: AvailableSource = "manual"
    # Always the user's, validated for nothing beyond > 0. effort_unit is free
    # text, so the app cannot tell points from hours and does not try (§6.4).
    units_per_pd: float = Field(1.0, gt=0)
    # Whose capacity reaches the project: the whole team, or only ``member_ids``
    # (§6.3, ADR 0009). Listing members with ``all_members`` on is refused.
    all_members: bool = True
    member_ids: list[str] = Field(default_factory=list, max_length=MAX_MEMBERS_PER_TEAM)
    # Members with a share of their own (ADR 0010). On a scoped assignment they
    # are counted whether or not member_ids lists them.
    member_shares: list[MemberShare] = Field(default_factory=list, max_length=MAX_MEMBERS_PER_TEAM)
    # Take whatever the team's other projects leave of each member (§6.3.4,
    # ADR 0012). The whole team, so no share, member list or member shares with it.
    remaining: bool = False

    @model_validator(mode="after")
    def _one_unit(self) -> "TeamProjectCreate":
        if self.share_days is not None and "share_pct" in self.model_fields_set:
            raise ValueError("Give the share as a percentage or as days a week, not both")
        if self.remaining and (
            {"share_pct", "share_days", "member_ids", "member_shares"} & self.model_fields_set
            or not self.all_members
        ):
            raise ValueError(
                "The remaining capacity is the whole team's: give no share or members with it"
            )
        return self


class TeamProjectUpdate(BaseModel):
    # Setting either unit replaces the other: a share_pct clears share_days.
    share_pct: int | None = Field(None, ge=1, le=100)
    share_days: ShareDays | None = None
    available_source: AvailableSource | None = None
    units_per_pd: float | None = Field(None, gt=0)
    # Omit both to leave the scope alone. ``member_ids`` alone means "only these";
    # ``all_members: true`` alone means everyone again.
    all_members: bool | None = None
    member_ids: list[str] | None = Field(None, max_length=MAX_MEMBERS_PER_TEAM)
    # Replaces every member's own share when given; [] clears them all.
    member_shares: list[MemberShare] | None = Field(None, max_length=MAX_MEMBERS_PER_TEAM)
    # true: take the remaining capacity (§6.3.4). false, or any share or scope
    # given, turns it off again; the assignment then counts as stored.
    remaining: bool | None = None

    @model_validator(mode="after")
    def _one_unit(self) -> "TeamProjectUpdate":
        if self.share_pct is not None and self.share_days is not None:
            raise ValueError("Give the share as a percentage or as days a week, not both")
        if self.remaining and (
            self.share_pct is not None
            or self.share_days is not None
            or self.member_ids is not None
            or self.member_shares is not None
            or self.all_members is False
        ):
            raise ValueError(
                "The remaining capacity is the whole team's: give no share or members with it"
            )
        return self


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
    share_days: float | None = None
    available_source: str
    units_per_pd: float
    all_members: bool = True
    # The members counted when ``all_members`` is off, in the team's display order.
    # Empty and scoped means nobody counts: the project gets 0 PD.
    member_ids: list[str] = []
    # Members with a share of their own, in display order (ADR 0010).
    member_shares: list[MemberShare] = []
    # Takes what the team's other projects leave of each member; share_pct and
    # share_days are then not read (§6.3.4).
    remaining: bool = False
    # The earliest assignment is the team's anchor: its sprint calendar is the one
    # the team's own views count in (§6.8).
    is_anchor: bool = False
    created_at: UtcDatetime
    modified_at: UtcDatetime
    etag: str = ""

    model_config = {"from_attributes": True}

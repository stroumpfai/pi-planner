"""What the Capacity view reads (spec/teams.md §5.4, §7.6).

The shape follows the view rather than the tables, because the view is the whole
point of the feature: a grid of sprints across members, with every cell able to
show the chain that produced it.

Three decisions worth stating, since each has a wrong-looking alternative:

**A cell is `null`, never zero, for a sprint without both dates.** Unknown and
empty are different, and a 0 here would read as a team with no capacity rather
than a sprint nobody has dated yet (§5.3).

**Nothing rounds except the per-project `available`.** The whole chain is float
and rounds exactly once — at the boundary where a push would write an integer
into a sprint header (§6.4). That integer is carried here so a preview can show
what it will write rather than the unrounded number beside it.

**Labels carry no truncation.** `label` is `{PI name}.{n}` with *n* 1-based, and
PI names run to 100 characters; how much of that fits a column is the frontend's
problem, and solving it here would hand every other reader — an agent, an export —
a name with a "…" in it.
"""

from datetime import date

from pydantic import BaseModel


class CapacityBreakdown(BaseModel):
    """One member's capacity in one sprint, as the §5.4 steps produced it.

    The fields are the steps in order, because that is what an expanded cell
    renders: contracted → absences → meetings → focus → ÷ normal_day_hours. The
    collapsed cell shows the last two; the chain is what makes a surprising
    number traceable to its cause.
    """

    contracted_half_days: int
    contracted_hours: float
    absent_half_days: int
    hours_after_absences: float
    meeting_hours: float
    hours_after_meetings: float
    net_hours: float
    person_days: float
    # Surviving half-days counted in days. Presence and capacity answer different
    # questions: a member present 9 days contributes 6.3 PD when their day is 6 h
    # and two of those days are halves (§7.6).
    present_days: float


class CapacitySprint(BaseModel):
    """A column: one sprint of the team's anchor project (§7.0.1)."""

    sprint_id: str
    pi_id: str
    pi_name: str
    pi_state: str
    # 1-based, matching the board's own "Sprint 1…5" over stored indices 0–4.
    sprint_number: int
    label: str
    start_date: date | None
    end_date: date | None
    # False when either date is missing: the column exists, and every figure in it
    # reads "—".
    computable: bool
    # What the sprint header holds today, so a preview can say "12 → 14" without a
    # second read. Not yet compared to anything here — staleness is step 7.
    available: int


class MemberCapacityRow(BaseModel):
    member_id: str
    name: str
    # False when this member's cells are shown but left out of ``team`` and every
    # project row — someone tracked for their absences only (§3.2).
    counts_towards_capacity: bool
    # One entry per sprint in ``sprints``, positionally. Null where that sprint
    # cannot be computed.
    cells: list[CapacityBreakdown | None]


class ProjectCapacityRow(BaseModel):
    """A served project: the team's PD after its share, in the project's own unit."""

    project_id: str
    name: str
    effort_unit: str
    share_pct: int
    available_source: str
    units_per_pd: float
    # Share-adjusted PD per sprint — team PD × share_pct / 100.
    person_days: list[float | None]
    # …× units_per_pd, unrounded.
    units: list[float | None]
    # The integer a push would write, rounded half-up per sprint independently.
    # Null for a `manual` project as well as an undated sprint: nothing is meant
    # to flow into a manual project (§6.4).
    proposed_available: list[int | None]


class TeamCapacityResponse(BaseModel):
    team_id: str
    normal_day_hours: float
    # Null when the team serves no project: it then has no sprint calendar, and
    # says so rather than inventing one (§7.0.1).
    anchor_project_id: str | None
    sprints: list[CapacitySprint]
    members: list[MemberCapacityRow]
    # Team totals per sprint, over the members that count towards capacity.
    # team_PD == Σ of their member_PD by construction, because the divisor is
    # shared (§5.2).
    team: list[CapacityBreakdown | None]
    projects: list[ProjectCapacityRow]

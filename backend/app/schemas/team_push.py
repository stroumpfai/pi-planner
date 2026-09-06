"""What a push shows before it writes, and what it reports afterwards (§6.7).

The push is **review, then apply**, the same shape as the CSV import, and these
schemas exist to make the review honest:

**`proposed_available` is the integer that will be written.** The whole chain is
float — half-day hours, focus, PD, share, factor — and rounds exactly once, here,
half-up, per sprint independently (§6.4). Showing the unrounded number would let
a preview promise 13.8 and write 14; showing the rounded sum of a PI would let
the header disagree with itself.

**A result is per project, never a single verdict.** `POST /teams/{id}/push`
loops projects that are independent aggregates, so one row failing on someone
else's edit lock leaves the others applied. Failing all three because Carla is
editing the third would reintroduce exactly the coupling this design removes.
"""

from datetime import date

from pydantic import BaseModel

from app.schemas.common import UtcDatetime

# What a project push may write into. Sprints of a closed PI are never touched —
# a closed PI keeps the numbers it was closed with (§6.4).
PUSHABLE_PI_STATES = ("draft", "in_progress")


class PushSprintRow(BaseModel):
    """One sprint's line in the review table: current · proposed · Δ · behind it."""

    sprint_id: str
    pi_id: str
    pi_name: str
    pi_state: str
    # 1-based, matching the board's "Sprint 1…5" over stored indices 0–4.
    sprint_number: int
    label: str
    start_date: date | None
    end_date: date | None
    current_available: int
    # Null for a sprint missing either date: unknown is not zero, and a sprint
    # nobody has dated cannot be given a budget from a calendar it is not on.
    proposed_available: int | None
    delta: int | None
    # "behind it" — the float chain that produced the integer, so a surprising
    # proposal is traceable without opening the Capacity view.
    team_person_days: float | None
    share_adjusted_person_days: float | None
    in_project_units: float | None
    available_pushed_at: UtcDatetime | None


class PushPreview(BaseModel):
    """Everything a push into one project would do. Writes nothing."""

    project_id: str
    project_name: str
    effort_unit: str
    team_id: str
    team_name: str
    share_pct: int
    available_source: str
    units_per_pd: float
    sprints: list[PushSprintRow]
    # Sprints whose stored value would actually change. This is also the
    # staleness count: values are compared, never an input hash, so an absence
    # added and removed again reports nothing (§6.6).
    changed_count: int
    total_delta: int


class ProjectPushResult(BaseModel):
    """One row of the per-project result list (§6.7).

    ``status`` is one of ``updated`` · ``no_change`` · ``locked`` · ``manual`` ·
    ``no_team`` · ``error``. A locked row carries the holder and the expiry so the
    dialog can offer *Retry this one* against a real time.
    """

    project_id: str
    project_name: str
    status: str
    updated_sprints: int
    total_delta: int
    message: str | None = None
    locked_by: str | None = None
    locked_until: UtcDatetime | None = None


class TeamPushResponse(BaseModel):
    team_id: str
    results: list[ProjectPushResult]


class ProjectPushStatus(BaseModel):
    """Whether one project's sprints still agree with its team (§6.6).

    A `manual` project is never stale — nothing is meant to flow into it — and
    reports ``stale_sprints`` 0 with the source that says why.
    """

    project_id: str
    project_name: str
    team_id: str
    team_name: str
    share_pct: int
    available_source: str
    stale_sprints: int
    # Null means never pushed, which is a different state from in sync and is
    # labelled differently on the home page.
    last_pushed_at: UtcDatetime | None

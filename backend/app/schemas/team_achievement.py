"""What the Achievement view reads (spec/team-achievement.md §5).

The counterpart of the Capacity view: the same team, the same sprint columns
(``CapacitySprint``, from the anchor project's calendar), the other half of the
question. Every per-sprint list is positional over ``sprints``.

**Null, never zero, wherever a figure is unknown** — an undated sprint, a project
with no done State, a Committed figure for a project with no sprint on the
column's dates, a velocity over 0 PD. Unknown and empty are different (§5.5).
"""

from datetime import date

from pydantic import BaseModel

from app.schemas.pbi import PBIItemType
from app.schemas.team_capacity import CapacitySprint


class AchievedItem(BaseModel):
    """A story or bug behind an Achieved cell, for the expanded view (§5.4)."""

    system_id: str
    id: int | None  # the business user_id
    title: str
    item_type: PBIItemType
    effort: float | None
    completed_on: date


class ProjectAchievementRow(BaseModel):
    """One served project, in its own unit (§5.3)."""

    project_id: str
    name: str
    effort_unit: str
    share_pct: int
    available_source: str
    units_per_pd: float
    # False for a `manual` assignment: its units_per_pd is a default nobody set, so
    # its points are kept out of the team's PD total (§5.3). Its own rows stay.
    in_pd_total: bool
    # Points placed in the project's sprint matching the column's dates, whatever
    # their State. Null where the project has no sprint on those dates.
    committed: list[float | None]
    # Points whose completed_on falls inside the column's dates (§4.5).
    achieved: list[float | None]
    # team PD × share_pct / 100 — the same figure ProjectCapacityRow carries.
    pd_given: list[float | None]
    # achieved ÷ pd_given, in effort_unit per PD. Null where pd_given is 0 or null.
    velocity: list[float | None]
    # The items behind each achieved cell, positionally.
    achieved_items: list[list[AchievedItem]]
    # §5.5 footers.
    outside_calendar_points: float
    done_undated_count: int
    # "story" / "bug" when that list has no done-category State: rows then read null.
    item_types_without_done_state: list[PBIItemType]


class TeamAchievementTotals(BaseModel):
    """The team row, over projects with in_pd_total only (§5.3)."""

    achieved_pd: list[float | None]
    # The team's capacity over counting members — the Capacity view's total.
    available_pd: list[float | None]
    # achieved_pd ÷ available_pd: measured velocity over the typed factor.
    realised: list[float | None]


class TeamAchievementResponse(BaseModel):
    team_id: str
    # Null when the team serves no project: no calendar, and the view says so.
    anchor_project_id: str | None
    sprints: list[CapacitySprint]
    projects: list[ProjectAchievementRow]
    team: TeamAchievementTotals


class VelocitySprint(BaseModel):
    """One closed sprint the suggestion is measured over."""

    label: str
    start_date: date
    end_date: date
    achieved: float
    pd_given: float


class ProjectVelocityResponse(BaseModel):
    """The measured units_per_pd, offered beside the typed one (spec §6.3).

    A suggestion only: nothing here writes the assignment or pushes a sprint. Only
    sprints whose PI is ``closed`` count, since an open sprint's Achieved figure is
    still growing and would drag the average down every time anyone looked.
    """

    project_id: str
    effort_unit: str
    # What the assignment holds today, so the editor can show the two side by side.
    units_per_pd: float
    sprints_requested: int
    # The closed sprints actually used, oldest first. Fewer than requested when fewer
    # exist; empty when none do.
    sprints: list[VelocitySprint]
    # Σ achieved ÷ Σ pd_given over ``sprints``. Null when there is nothing to measure:
    # a factor from no closed sprint is worse than no factor.
    velocity: float | None

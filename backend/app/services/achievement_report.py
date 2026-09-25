"""The Achievement grid, assembled (spec/team-achievement.md §5.3, §6.3).

This module loads rows and assembles the §5.3 grid; where each point lands is
decided in `services/achievement.py`, which is pure and unit-tested. The columns,
the anchor and every PD figure come from the capacity report itself
(`build_report`), so the Capacity and Achievement views can never disagree on
which sprints exist or how many person-days a project was given.

Both the grid route and the §6.3 velocity suggestion read the report built here,
so the suggestion can never be computed a second way.

Cost is bounded by construction: a fixed number of queries per request, each
over every assigned project at once (`IN (...)`), never one per item or sprint.
"""

from collections import defaultdict
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.group import Group
from app.models.pbi import PBI
from app.models.pi import PI
from app.models.project_state import ProjectState
from app.models.sprint import Sprint
from app.models.swimline import Swimline
from app.models.team import Team
from app.schemas.pbi import PBIItemType
from app.schemas.team_achievement import (
    AchievedItem,
    ProjectAchievementRow,
    ProjectVelocityResponse,
    TeamAchievementResponse,
    TeamAchievementTotals,
    VelocitySprint,
)
from app.schemas.team_capacity import CapacitySprint
from app.services.achievement import (
    CalendarSprint,
    CompletedItem,
    ProjectAchievement,
    ProjectSprint,
    ProjectTotalsInput,
    achievement_per_column,
    committed_per_column,
    team_totals,
    unmeasured,
    velocity,
)
from app.services.completion import DONE_CATEGORY
from app.services.project_state import state_item_type_for_pbi
from app.services.team_capacity_report import build_report, load_sprint_columns

_ITEM_TYPES: tuple[PBIItemType, PBIItemType] = ("story", "bug")


def _calendar(columns: list[CapacitySprint]) -> list[CalendarSprint]:
    return [
        CalendarSprint(sprint_id=c.sprint_id, start_date=c.start_date, end_date=c.end_date)
        for c in columns
    ]


async def _done_lists(db: AsyncSession, project_ids: list[str]) -> dict[str, set[str]]:
    """Per project, the item types ("story"/"bug") whose State List has a done entry."""
    result = await db.execute(
        select(ProjectState.project_id, ProjectState.item_type)
        .where(
            ProjectState.project_id.in_(project_ids),
            ProjectState.category == DONE_CATEGORY,
            ProjectState.item_type.in_(_ITEM_TYPES),
        )
        .distinct()
    )
    lists: dict[str, set[str]] = defaultdict(set)
    for project_id, item_type in result.all():
        lists[project_id].add(item_type)
    return lists


async def _done_items(db: AsyncSession, project_ids: list[str]) -> dict[str, list[CompletedItem]]:
    """Per project, every story and bug in a done-category State, dated or not.

    Columns rather than ORM rows: ``PBI.state`` is a selectin relationship, and
    loading entities would fetch every State a second time for nothing.
    """
    result = await db.execute(
        select(
            PBI.project_id,
            PBI.system_id,
            PBI.user_id,
            PBI.title,
            PBI.item_type,
            PBI.effort,
            PBI.completed_on,
            ProjectState.item_type.label("list_type"),
        )
        .join(ProjectState, ProjectState.system_id == PBI.state_id)
        .where(PBI.project_id.in_(project_ids), ProjectState.category == DONE_CATEGORY)
    )
    items: dict[str, list[CompletedItem]] = defaultdict(list)
    for row in result.all():
        # An item holds a State from its own list by construction; a mismatch
        # would be corrupt data, and a bug's State must not measure a story.
        if row.list_type != state_item_type_for_pbi(row.item_type):
            continue
        items[row.project_id].append(
            CompletedItem(
                system_id=row.system_id,
                user_id=row.user_id,
                title=row.title,
                item_type=state_item_type_for_pbi(row.item_type),
                effort=row.effort,
                completed_on=row.completed_on,
            )
        )
    return items


async def _project_sprints(
    db: AsyncSession, project_ids: list[str]
) -> dict[str, list[ProjectSprint]]:
    """Per project, every sprint with the effort placed in it, whatever the State.

    Placement is ``Group.sprint_index`` within a swimlane of the sprint's PI —
    the same join `services/effort.py` uses for the board's own load figures.
    """
    placed_rows = await db.execute(
        select(
            Swimline.pi_id,
            Group.sprint_index,
            func.coalesce(func.sum(PBI.effort), 0).label("effort"),
        )
        .join(Group, PBI.group_id == Group.system_id)
        .join(Swimline, Group.swimline_id == Swimline.system_id)
        .join(PI, PI.system_id == Swimline.pi_id)
        .where(PI.project_id.in_(project_ids), PBI.effort.is_not(None))
        .group_by(Swimline.pi_id, Group.sprint_index)
    )
    placed: dict[tuple[str, int], float] = {
        (row.pi_id, row.sprint_index): float(row.effort)
        for row in placed_rows.all()
        if row.sprint_index is not None
    }

    sprint_rows = await db.execute(
        select(Sprint, PI.project_id)
        .join(PI, PI.system_id == Sprint.pi_id)
        .where(PI.project_id.in_(project_ids))
    )
    sprints: dict[str, list[ProjectSprint]] = defaultdict(list)
    for sprint, project_id in sprint_rows.all():
        effort = 0.0
        if sprint.sprint_index is not None:
            effort = placed.get((sprint.pi_id, sprint.sprint_index), 0.0)
        sprints[project_id].append(
            ProjectSprint(
                sprint_id=sprint.system_id,
                start_date=sprint.start_date,
                end_date=sprint.end_date,
                placed_effort=effort,
            )
        )
    return sprints


def _achieved_items(achievement: ProjectAchievement) -> list[list[AchievedItem]]:
    cells: list[list[AchievedItem]] = []
    for cell in achievement.achieved_items:
        listed: list[AchievedItem] = []
        for item in cell:
            assert item.completed_on is not None  # attributed items are dated
            listed.append(
                AchievedItem(
                    system_id=item.system_id,
                    id=item.user_id,
                    title=item.title,
                    item_type="bug" if item.item_type == "bug" else "story",
                    effort=item.effort,
                    completed_on=item.completed_on,
                )
            )
        cells.append(listed)
    return cells


async def build_achievement_report(
    db: AsyncSession,
    team: Team,
    window_from: date | None = None,
    window_to: date | None = None,
) -> TeamAchievementResponse:
    """The whole §5.3 grid for ``team``, optionally narrowed to a date window.

    Attribution runs over the anchor's **full** calendar even when a window is
    given, so narrowing the window never moves a point between columns or into
    "outside the calendar"; it only hides columns.
    """
    report = await build_report(db, team, window_from=window_from, window_to=window_to)
    columns = _calendar(report.sprints)
    calendar = columns
    if report.anchor_project_id is not None and (window_from or window_to):
        calendar = _calendar(await load_sprint_columns(db, report.anchor_project_id))

    project_ids = [p.project_id for p in report.projects]
    done_lists: dict[str, set[str]] = {}
    done_items: dict[str, list[CompletedItem]] = {}
    project_sprints: dict[str, list[ProjectSprint]] = {}
    if project_ids:
        done_lists = await _done_lists(db, project_ids)
        done_items = await _done_items(db, project_ids)
        project_sprints = await _project_sprints(db, project_ids)

    rows: list[ProjectAchievementRow] = []
    totals_input: list[ProjectTotalsInput] = []
    for capacity in report.projects:
        measured = done_lists.get(capacity.project_id, set())
        without_done: list[PBIItemType] = [t for t in _ITEM_TYPES if t not in measured]
        items = [i for i in done_items.get(capacity.project_id, []) if i.item_type in measured]
        if measured:
            achievement = achievement_per_column(columns, calendar, items)
        else:
            achievement = unmeasured(columns, done_undated_count=0)
        in_pd_total = capacity.available_source != "manual"

        rows.append(
            ProjectAchievementRow(
                project_id=capacity.project_id,
                name=capacity.name,
                effort_unit=capacity.effort_unit,
                share_pct=capacity.share_pct,
                available_source=capacity.available_source,
                units_per_pd=capacity.units_per_pd,
                in_pd_total=in_pd_total,
                committed=committed_per_column(
                    columns, project_sprints.get(capacity.project_id, [])
                ),
                achieved=achievement.achieved,
                pd_given=capacity.person_days,
                velocity=velocity(achievement.achieved, capacity.person_days),
                achieved_items=_achieved_items(achievement),
                outside_calendar_points=achievement.outside_calendar_points,
                done_undated_count=achievement.done_undated_count,
                item_types_without_done_state=without_done,
            )
        )
        totals_input.append(
            ProjectTotalsInput(
                in_pd_total=in_pd_total,
                units_per_pd=capacity.units_per_pd,
                achieved=achievement.achieved,
            )
        )

    available_pd = [cell.person_days if cell is not None else None for cell in report.team]
    totals = team_totals(totals_input, available_pd)
    return TeamAchievementResponse(
        team_id=team.system_id,
        anchor_project_id=report.anchor_project_id,
        sprints=report.sprints,
        projects=rows,
        team=TeamAchievementTotals(
            achieved_pd=totals.achieved_pd,
            available_pd=totals.available_pd,
            realised=totals.realised,
        ),
    )


def project_velocity(
    report: TeamAchievementResponse, project_id: str, sprints: int
) -> ProjectVelocityResponse | None:
    """The §6.3 suggestion for one project, read off an unwindowed ``report``.

    None when the team does not serve ``project_id``. A column is usable when it
    is dated, its PI is ``closed``, and the project both measured something
    (achieved non-null — so a project with no done State never qualifies) and was
    given PD (> 0). The latest ``sprints`` usable columns are kept, oldest first.

    The closed test reads the *column's* PI, which is the anchor project's: the
    columns are the anchor's calendar, and aligned PIs of the other projects share
    its dates (teams.md §6.8), so the anchor's PI state stands for the window.
    """
    row = next((p for p in report.projects if p.project_id == project_id), None)
    if row is None:
        return None

    usable: list[VelocitySprint] = []
    for column, achieved, pd_given in zip(
        report.sprints, row.achieved, row.pd_given, strict=True
    ):
        if not column.computable or column.pi_state != "closed":
            continue
        if achieved is None or pd_given is None or pd_given <= 0:
            continue
        assert column.start_date is not None and column.end_date is not None
        usable.append(
            VelocitySprint(
                label=column.label,
                start_date=column.start_date,
                end_date=column.end_date,
                achieved=achieved,
                pd_given=pd_given,
            )
        )
    usable.sort(key=lambda s: (s.start_date, s.end_date))
    chosen = usable[-sprints:]

    measured: float | None = None
    if chosen:
        # A ratio of sums, not a mean of ratios: each sprint weighs by its PD.
        measured = sum(s.achieved for s in chosen) / sum(s.pd_given for s in chosen)
    return ProjectVelocityResponse(
        project_id=row.project_id,
        effort_unit=row.effort_unit,
        units_per_pd=row.units_per_pd,
        sprints_requested=sprints,
        sprints=chosen,
        velocity=measured,
    )

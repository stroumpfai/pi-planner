"""Sprint date alignment between the projects one team serves (§6.8).

The rule: the **first project assigned to a team is the anchor**, and for every
pair of PIs *of different projects that overlap in time*, matching sprint indices
must carry identical dates. Pairing by PI name is not reliable — two teams name
their increments differently, and dates are the only common ground.

Enforcement is deliberate, and deliberately narrow:

**It is a rejection, not a warning.** "Must align" is a constraint. The
alternative is a capacity number quietly attributed to the wrong fortnight, which
no badge makes safe.

**It starts when the second project is assigned.** A team serving one project has
nothing to align to, so a single-project team pays nothing for this rule — no
extra query, no new failure mode. Pre-existing misalignment is reported *at
assignment time* as a blocking list to fix, and is never rewritten automatically:
silently moving someone's sprint dates to satisfy a constraint they have just met
for the first time would be the worst possible way to introduce it.

**An undated sprint conflicts with nothing.** Undated is not misaligned; it is
not yet placed. Only two dated sprints at the same index in two overlapping PIs
can disagree.
"""

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pi import PI
from app.models.project import Project
from app.models.sprint import Sprint
from app.models.team import TeamProject


@dataclass(frozen=True)
class PIWindow:
    """One PI reduced to what alignment cares about: a span and dated sprints."""

    project_id: str
    project_name: str
    pi_id: str
    pi_name: str
    start: date | None
    end: date | None
    sprints: dict[int, tuple[date, date]]

    def overlaps(self, other: "PIWindow") -> bool:
        if self.start is None or self.end is None:
            return False
        if other.start is None or other.end is None:
            return False
        return self.start <= other.end and other.start <= self.end


@dataclass(frozen=True)
class AlignmentConflict:
    """One index where two overlapping PIs disagree, with both ranges named."""

    sprint_index: int
    pi_name: str
    project_name: str
    start_date: date
    end_date: date
    other_project_id: str
    other_project_name: str
    other_pi_name: str
    other_start_date: date
    other_end_date: date

    def as_dict(self) -> dict[str, str | int]:
        return {
            "sprint_number": self.sprint_index + 1,
            "project_name": self.project_name,
            "pi_name": self.pi_name,
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "other_project_id": self.other_project_id,
            "other_project_name": self.other_project_name,
            "other_pi_name": self.other_pi_name,
            "other_start_date": self.other_start_date.isoformat(),
            "other_end_date": self.other_end_date.isoformat(),
        }

    def message(self) -> str:
        return (
            f"Sprint {self.sprint_index + 1} of {self.pi_name} runs "
            f"{self.start_date}–{self.end_date}, but sprint {self.sprint_index + 1} of "
            f"'{self.other_project_name}' {self.other_pi_name} runs "
            f"{self.other_start_date}–{self.other_end_date}. Projects served by one team "
            "must keep the same sprint calendar."
        )


async def sibling_project_ids(db: AsyncSession, project_id: str) -> list[str]:
    """The other projects served by the same team. Empty when there is no team."""
    assignment = await db.scalar(
        select(TeamProject).where(TeamProject.project_id == project_id)
    )
    if assignment is None:
        return []
    rows = await db.execute(
        select(TeamProject.project_id).where(
            TeamProject.team_id == assignment.team_id,
            TeamProject.project_id != project_id,
        )
    )
    return [row for row in rows.scalars().all()]


async def load_windows(db: AsyncSession, project_ids: list[str]) -> list[PIWindow]:
    """Every PI of the given projects, as a span plus its dated sprints.

    The span comes from the sprints rather than the PI's own dates: alignment is
    a statement about sprints, and a PI whose sprints are all undated should not
    overlap anything on the strength of a header date nobody has scheduled
    against. The PI's dates are the fallback when it has no dated sprint at all,
    which keeps a freshly dated PI from being invisible to the check.
    """
    if not project_ids:
        return []
    result = await db.execute(
        select(Sprint, PI, Project)
        .join(PI, PI.system_id == Sprint.pi_id)
        .join(Project, Project.system_id == PI.project_id)
        .where(PI.project_id.in_(project_ids))
    )
    by_pi: dict[str, dict[int, tuple[date, date]]] = {}
    meta: dict[str, tuple[PI, Project]] = {}
    for sprint, pi, project in result.all():
        meta[pi.system_id] = (pi, project)
        if sprint.start_date is None or sprint.end_date is None:
            continue
        index = sprint.sprint_index if sprint.sprint_index is not None else 0
        by_pi.setdefault(pi.system_id, {})[index] = (sprint.start_date, sprint.end_date)

    windows: list[PIWindow] = []
    for pi_id, (pi, project) in meta.items():
        sprints = by_pi.get(pi_id, {})
        start: date | None
        end: date | None
        if sprints:
            start = min(dates[0] for dates in sprints.values())
            end = max(dates[1] for dates in sprints.values())
        else:
            start, end = pi.start_date, pi.end_date
        windows.append(
            PIWindow(
                project_id=project.system_id,
                project_name=project.name,
                pi_id=pi_id,
                pi_name=pi.name,
                start=start,
                end=end,
                sprints=sprints,
            )
        )
    return windows


def conflicts_between(
    mine: list[PIWindow], theirs: list[PIWindow]
) -> list[AlignmentConflict]:
    """Every index where an overlapping pair disagrees, ``mine`` first."""
    found: list[AlignmentConflict] = []
    for window in mine:
        for other in theirs:
            if other.project_id == window.project_id or not window.overlaps(other):
                continue
            for index, dates in sorted(window.sprints.items()):
                other_dates = other.sprints.get(index)
                if other_dates is None or other_dates == dates:
                    continue
                found.append(
                    AlignmentConflict(
                        sprint_index=index,
                        pi_name=window.pi_name,
                        project_name=window.project_name,
                        start_date=dates[0],
                        end_date=dates[1],
                        other_project_id=other.project_id,
                        other_project_name=other.project_name,
                        other_pi_name=other.pi_name,
                        other_start_date=other_dates[0],
                        other_end_date=other_dates[1],
                    )
                )
    return found


async def conflicts_for_project(
    db: AsyncSession, project_id: str, sibling_ids: list[str] | None = None
) -> list[AlignmentConflict]:
    """Where *project_id* disagrees with the other projects of its team.

    Returns an empty list — after a single query, and often without even that —
    when the team serves only this project, which is the common case. Pass
    *sibling_ids* when the caller already knows them, as the assignment route
    does: it is checking a project the join row for does not exist yet.
    """
    resolved = await sibling_project_ids(db, project_id) if sibling_ids is None else sibling_ids
    if not resolved:
        return []
    mine = await load_windows(db, [project_id])
    theirs = await load_windows(db, list(resolved))
    return conflicts_between(mine, theirs)

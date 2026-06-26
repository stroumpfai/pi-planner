"""PI export service: generates CSV and PNG exports for a planned PI."""

import csv
import io

from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature import Feature
from app.models.group import Group
from app.models.pi import PI
from app.models.project import Project
from app.models.pbi import PBI
from app.models.sprint import Sprint
from app.models.swimline import Swimline
from app.services.effort import pi_effort_and_capacity, swimline_efforts


def safe_filename(name: str) -> str:
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in name)


async def export_pi_csv(db: AsyncSession, pi: PI) -> str:
    """Return a CSV string of all PBIs whose parent feature is in this PI."""
    result = await db.execute(
        select(
            PBI.user_id.label("pbi_user_id"),
            PBI.title.label("pbi_title"),
            Feature.user_id.label("feature_user_id"),
            Feature.title.label("feature_title"),
            Group.sprint_index.label("sprint_index"),
            Swimline.name.label("swimlane_name"),
            Swimline.order_index.label("swimlane_order"),
        )
        .join(Feature, PBI.parent_feature_system_id == Feature.system_id)
        .outerjoin(Group, PBI.group_id == Group.system_id)
        .outerjoin(Swimline, Group.swimline_id == Swimline.system_id)
        .where(Feature.pi_id == pi.system_id)
        .order_by(
            Swimline.order_index.asc().nullslast(),
            Feature.title.asc(),
            PBI.title.asc(),
        )
    )
    rows = result.all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["pbi_id", "pbi_name", "feature_id", "feature_name", "pi_name", "sprint_number", "swimlane_name"])
    for row in rows:
        sprint_num = "" if row.sprint_index is None else str(row.sprint_index + 1)
        writer.writerow([
            row.pbi_user_id if row.pbi_user_id is not None else "",
            row.pbi_title,
            row.feature_user_id if row.feature_user_id is not None else "",
            row.feature_title,
            pi.name,
            sprint_num,
            row.swimlane_name or "",
        ])

    return buf.getvalue()


async def export_pi_png(db: AsyncSession, pi: PI) -> bytes:
    """Return PNG bytes showing a swimlane roadmap for the PI."""
    effort, capacity = await pi_effort_and_capacity(db, pi.system_id)

    project = await db.get(Project, pi.project_id)
    effort_unit = (project.effort_unit if project and project.effort_unit else "pts")

    sprints_result = await db.execute(
        select(Sprint).where(Sprint.pi_id == pi.system_id).order_by(Sprint.sprint_index.asc())
    )
    sprints = sprints_result.scalars().all()
    num_sprints = len(sprints) or 5

    swimlines_result = await db.execute(
        select(Swimline)
        .where(Swimline.pi_id == pi.system_id)
        .order_by(Swimline.order_index.asc().nullslast())
    )
    swimlines = swimlines_result.scalars().all()

    swimline_ids = [s.system_id for s in swimlines]
    sl_efforts: dict[str, float] = await swimline_efforts(db, swimline_ids) if swimline_ids else {}

    spans: dict[str, tuple[int, int]] = {}
    if swimline_ids:
        spans_result = await db.execute(
            select(
                Group.swimline_id,
                func.min(Group.sprint_index).label("min_sprint"),
                func.max(Group.sprint_index).label("max_sprint"),
            )
            .where(Group.swimline_id.in_(swimline_ids), Group.sprint_index.is_not(None))
            .group_by(Group.swimline_id)
        )
        spans = {r.swimline_id: (int(r.min_sprint), int(r.max_sprint)) for r in spans_result.all()}

    n = max(len(swimlines), 1)
    fig_width = max(10.0, num_sprints * 2.2)
    fig_height = max(4.0, n * 1.0 + 2.5)

    fig = Figure(figsize=(fig_width, fig_height), dpi=150)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot(111)

    BASE_COLOR = "#6366f1"
    BAR_HEIGHT = 0.6

    # y = 0 is bottom; place first swimline at top (y = n-1)
    y_positions = list(range(n - 1, -1, -1))

    for i, swimline in enumerate(swimlines):
        y = y_positions[i]
        sl_effort = sl_efforts.get(swimline.system_id, 0.0)
        alpha = 0.25 + 0.75 * min(sl_effort / capacity, 1.0) if capacity > 0 else 0.35

        span = spans.get(swimline.system_id)
        if span is not None:
            left = float(span[0])
            width = float(span[1] - span[0] + 1)
            ax.barh(y, width, left=left, color=BASE_COLOR, alpha=alpha,
                    height=BAR_HEIGHT, edgecolor="white", linewidth=0.5)
            label = f"{sl_effort:g} {effort_unit}"
            ax.text(left + width / 2.0, y, label,
                    va="center", ha="center", fontsize=8, color="white", fontweight="bold")
        else:
            ax.text(num_sprints / 2.0, y, "(no planned items)",
                    va="center", ha="center", fontsize=8, color="#9ca3af", style="italic")

    ax.set_yticks(y_positions)
    ax.set_yticklabels([s.name for s in swimlines], fontsize=9)

    ax.set_xlim(0.0, float(num_sprints))
    ax.set_xticks([i + 0.5 for i in range(num_sprints)])
    sprint_labels = []
    for i in range(num_sprints):
        matching = [s for s in sprints if s.sprint_index == i]
        cap = matching[0].capacity if matching else 0
        sprint_labels.append(f"Sprint {i + 1}\n({cap} {effort_unit})")
    ax.set_xticklabels(sprint_labels, fontsize=8)

    for i in range(1, num_sprints):
        ax.axvline(x=float(i), color="#e2e8f0", linewidth=0.8, zorder=0)

    pct = round(effort / capacity * 100) if capacity > 0 else 0
    ax.set_title(
        f"{pi.name}\nTotal: {effort:g} / {capacity} {effort_unit}  ({pct}%)",
        fontsize=11, fontweight="bold", pad=12,
    )

    ax.set_ylim(-0.7, float(n) - 0.3)
    for spine in ("top", "right", "left"):
        ax.spines[spine].set_visible(False)
    ax.tick_params(left=False)

    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    buf.seek(0)
    return buf.read()

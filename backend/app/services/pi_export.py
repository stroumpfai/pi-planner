"""PI export service: generates CSV and PNG exports for a planned PI."""

import csv
import io
from datetime import date

from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature import Feature
from app.models.group import Group
from app.models.pi import PI
from app.models.pi_event import PIEvent
from app.models.project import Project
from app.models.pbi import PBI
from app.models.sprint import Sprint
from app.models.swimline import Swimline
from app.services.effort import pi_effort_and_capacity, swimline_efforts

EVENT_COLORS: dict[str, str] = {
    "release":   "#10b981",
    "milestone": "#6366f1",
    "deadline":  "#ef4444",
    "pilot":     "#8b5cf6",
    "go_no_go":  "#f59e0b",
    "other":     "#6b7280",
}


def _event_x(
    event_date: date,
    dated_sprints: list[tuple[int, date, date]],
    num_sprints: int,
) -> float | None:
    """Map an event date to an x-axis coordinate. Returns None if no sprint dates."""
    if not dated_sprints:
        return None
    sorted_sprints = sorted(dated_sprints)
    for sprint_index, start, end in sorted_sprints:
        if start <= event_date <= end:
            span = (end - start).days or 1
            frac = (event_date - start).days / span
            return sprint_index + frac
    first_start = min(s for _, s, _ in sorted_sprints)
    if event_date < first_start:
        return 0.0
    return float(num_sprints)


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


def _build_sprint_labels(
    sprints: list[Sprint], num_sprints: int, effort_unit: str
) -> list[str]:
    labels = []
    for i in range(num_sprints):
        matching = [s for s in sprints if s.sprint_index == i]
        cap = matching[0].capacity if matching else 0
        labels.append(f"Sprint {i + 1}\n({cap} {effort_unit})")
    return labels


def _draw_events(
    ax: object,
    events: list[PIEvent],
    dated_sprints: list[tuple[int, date, date]],
    num_sprints: int,
    n: int,
) -> None:
    for event in events:
        x = _event_x(event.event_date, dated_sprints, num_sprints)
        if x is None:
            continue
        color = EVENT_COLORS.get(event.event_type, "#6b7280")
        ax.axvline(x=x, color=color, linestyle="--", linewidth=0.8, zorder=3, alpha=0.8)  # type: ignore[union-attr]
        ax.text(  # type: ignore[union-attr]
            x, float(n) - 0.3, event.name,
            rotation=45, va="bottom", ha="left", fontsize=7, color=color,
            rotation_mode="anchor", clip_on=False,
        )


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

    events_result = await db.execute(
        select(PIEvent)
        .where(PIEvent.pi_id == pi.system_id)
        .order_by(PIEvent.event_date.asc())
    )
    events = events_result.scalars().all()

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

    dated_sprints = [
        (s.sprint_index, s.start_date, s.end_date)
        for s in sprints
        if s.start_date and s.end_date
    ]

    n = max(len(swimlines), 1)
    fig_width = max(10.0, num_sprints * 2.2)
    fig_height = max(3.0, n * 0.35 + 2.0)

    fig = Figure(figsize=(fig_width, fig_height), dpi=150)
    FigureCanvasAgg(fig)
    ax = fig.add_subplot(111)

    BASE_COLOR = "#6366f1"
    BAR_HEIGHT = 0.5

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
            label = f"{swimline.name} – {sl_effort:g} {effort_unit}"
            ax.text(left + width / 2.0, y, label,
                    va="center", ha="center", fontsize=8, color="white", fontweight="bold")
        else:
            ax.text(num_sprints / 2.0, y, "(no planned items)",
                    va="center", ha="center", fontsize=8, color="#9ca3af", style="italic")

    _draw_events(ax, events, dated_sprints, num_sprints, n)

    ax.set_yticks([])

    ax.set_xlim(0.0, float(num_sprints))
    ax.set_xticks([i + 0.5 for i in range(num_sprints)])
    ax.set_xticklabels(_build_sprint_labels(sprints, num_sprints, effort_unit), fontsize=8)

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

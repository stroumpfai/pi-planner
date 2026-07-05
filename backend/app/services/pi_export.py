"""PI export service: generates CSV and PNG exports for a planned PI."""

import csv
import io
from dataclasses import dataclass, field
from datetime import date

from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.figure import Figure
from matplotlib.gridspec import GridSpec
from matplotlib.patches import Rectangle
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
from app.services.effort import pi_effort_and_capacity, sprint_efforts_for_pi, swimline_efforts


@dataclass
class PNGExportOptions:
    show_pi_effort: bool = False
    show_sprint_effort: bool = False
    show_swimlane_effort: bool = False
    show_events: bool = False
    swimlane_text_center: bool = False
    show_export_date: bool = False

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


def _csv_safe(value: str) -> str:
    """Guard against spreadsheet formula injection (OWASP): a leading =, +, -, @,
    tab, or CR would be executed as a formula when the CSV is opened in Excel."""
    if value and value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{value}"
    return value


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
            _csv_safe(row.pbi_title),
            row.feature_user_id if row.feature_user_id is not None else "",
            _csv_safe(row.feature_title),
            _csv_safe(pi.name),
            sprint_num,
            _csv_safe(row.swimlane_name or ""),
        ])

    return buf.getvalue()


def _fmt_date(d: date | None) -> str:
    return d.strftime("%d.%m.%y") if d else "?"


def _swimlane_bar_color(ratio: float) -> tuple[str, str]:
    """Return (bar_color, text_color) interpolated from gray-200 (low) to gray-600 (high)."""
    lo = (0xe5, 0xe7, 0xeb)  # gray-200
    hi = (0x4b, 0x55, 0x63)  # gray-600
    r = round(lo[0] + (hi[0] - lo[0]) * ratio)
    g = round(lo[1] + (hi[1] - lo[1]) * ratio)
    b = round(lo[2] + (hi[2] - lo[2]) * ratio)
    bar = f"#{r:02x}{g:02x}{b:02x}"
    text = "white" if ratio >= 0.5 else "#1f2937"
    return bar, text


def _capacity_bar_color(used: float, capacity: int) -> str:
    if capacity == 0:
        return "#9ca3af"
    pct = used / capacity
    if pct > 1.0:
        return "#ef4444"
    if pct >= 0.85:
        return "#f59e0b"
    return "#3b82f6"


def _draw_sprint_header(
    ax: object,
    sprints: list[Sprint],
    sprint_efforts: dict[int, float],
    effort_unit: str,
    num_sprints: int,
    show_effort: bool = False,
) -> None:
    ax.set_xlim(0.0, float(num_sprints))  # type: ignore[union-attr]
    ax.set_ylim(0.0, 1.0)  # type: ignore[union-attr]
    ax.axis("off")  # type: ignore[union-attr]

    for i in range(num_sprints):
        matching = [s for s in sprints if s.sprint_index == i]
        sprint = matching[0] if matching else None
        cap = (sprint.capacity or 0) if sprint else 0
        used = sprint_efforts.get(i, 0.0)
        pct = used / cap if cap > 0 else 0.0

        ax.add_patch(Rectangle(  # type: ignore[union-attr]
            (i + 0.02, 0.02), 0.96, 0.96,
            facecolor="#f8fafc", edgecolor="#e2e8f0", linewidth=0.5,
        ))

        name_y = 0.88 if show_effort else 0.78
        ax.text(i + 0.5, name_y, f"Sprint {i + 1}",  # type: ignore[union-attr]
                ha="center", va="top", fontsize=8, fontweight="bold", color="#374151")

        if sprint and (sprint.start_date or sprint.end_date):
            date_y = 0.67 if show_effort else 0.52
            date_str = f"{_fmt_date(sprint.start_date)} – {_fmt_date(sprint.end_date)}"
            ax.text(i + 0.5, date_y, date_str,  # type: ignore[union-attr]
                    ha="center", va="top", fontsize=7, color="#6b7280")

        if show_effort:
            cap_text = f"{used:g}/{cap} {effort_unit} – {round(pct * 100)}%"
            ax.text(i + 0.5, 0.47, cap_text,  # type: ignore[union-attr]
                    ha="center", va="top", fontsize=7, color="#6b7280")

            bx, by, bw, bh = i + 0.08, 0.14, 0.84, 0.13
            ax.add_patch(Rectangle((bx, by), bw, bh, facecolor="#e2e8f0", edgecolor="none"))  # type: ignore[union-attr]
            fill_w = min(pct, 1.0) * bw
            if fill_w > 0:
                ax.add_patch(Rectangle(  # type: ignore[union-attr]
                    (bx, by), fill_w, bh,
                    facecolor=_capacity_bar_color(used, cap), edgecolor="none",
                ))


def _draw_events(
    ax: object,
    events: list[PIEvent],
    dated_sprints: list[tuple[int, date, date]],
    num_sprints: int,
    bottom_y: float,
) -> None:
    for event in events:
        x = _event_x(event.event_date, dated_sprints, num_sprints)
        if x is None:
            continue
        color = EVENT_COLORS.get(event.event_type, "#6b7280")
        ax.axvline(x=x, color=color, linestyle="--", linewidth=0.8, zorder=3, alpha=0.8)  # type: ignore[union-attr]
        ax.text(  # type: ignore[union-attr]
            x, bottom_y, event.name,
            rotation=-45, va="top", ha="left", fontsize=7, color=color,
            rotation_mode="anchor", clip_on=False,
        )


async def export_pi_png(db: AsyncSession, pi: PI, opts: PNGExportOptions | None = None) -> bytes:
    """Return PNG bytes showing a swimlane roadmap for the PI."""
    if opts is None:
        opts = PNGExportOptions()
    effort, capacity = await pi_effort_and_capacity(db, pi.system_id)
    sprint_efforts = await sprint_efforts_for_pi(db, pi.system_id)

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

    swimlines = [s for s in swimlines if s.system_id in spans]

    dated_sprints = [
        (s.sprint_index, s.start_date, s.end_date)
        for s in sprints
        if s.start_date and s.end_date
    ]

    n = max(len(swimlines), 1)
    HEADER_H = 1.0  # inches — fixed height for the sprint header row
    main_h = max(1.5, n * 0.35 + 1.0)
    fig_width = max(10.0, num_sprints * 2.2)
    fig_height = HEADER_H + main_h

    fig = Figure(figsize=(fig_width, fig_height), dpi=150, layout="constrained")
    FigureCanvasAgg(fig)
    gs = GridSpec(2, 1, figure=fig, height_ratios=[HEADER_H, main_h], hspace=0.05)
    ax_header = fig.add_subplot(gs[0])
    ax = fig.add_subplot(gs[1])

    _draw_sprint_header(ax_header, sprints, sprint_efforts, effort_unit, num_sprints,
                        show_effort=opts.show_sprint_effort)

    BAR_HEIGHT = 0.5
    ROW_SPACING = 0.65  # center-to-center distance between bars (data units)

    # y = 0 is bottom; place first swimline at top
    y_positions = [i * ROW_SPACING for i in range(n - 1, -1, -1)]

    for i, swimline in enumerate(swimlines):
        y = y_positions[i]
        sl_effort = sl_efforts.get(swimline.system_id, 0.0)
        ratio = min(sl_effort / capacity, 1.0) if capacity > 0 else 0.3
        bar_color, text_color = _swimlane_bar_color(ratio)

        span = spans[swimline.system_id]
        left = float(span[0])
        width = float(span[1] - span[0] + 1)
        ax.barh(y, width, left=left, color=bar_color,
                height=BAR_HEIGHT, edgecolor="white", linewidth=0.5)

        if opts.show_swimlane_effort:
            label = f"{swimline.name} – {sl_effort:g} {effort_unit}"
        else:
            label = swimline.name

        if opts.swimlane_text_center:
            text_x = left + width / 2.0
            ha = "center"
        else:
            text_x = left + 0.1
            ha = "left"

        ax.text(text_x, y, label,
                va="center", ha=ha, fontsize=8, color=text_color, fontweight="bold")

    bottom_y = -BAR_HEIGHT / 2 - 0.1

    if opts.show_events:
        _draw_events(ax, events, dated_sprints, num_sprints, bottom_y)

    ax.set_yticks([])
    ax.set_xlim(0.0, float(num_sprints))
    ax.set_xticks([])  # sprint info is in the header row above

    for i in range(1, num_sprints):
        ax.axvline(x=float(i), color="#e2e8f0", linewidth=0.8, zorder=0)

    if opts.show_pi_effort:
        pct = round(effort / capacity * 100) if capacity > 0 else 0
        title = f"{pi.name}  ·  Total: {effort:g} / {capacity} {effort_unit}  ({pct}%)"
    else:
        title = pi.name
    fig.suptitle(title, fontsize=10, fontweight="bold")

    if opts.show_export_date:
        date_str = date.today().strftime("%Y-%m-%d")
        fig.text(0.99, 0.01, f"Exported {date_str}",
                 ha="right", va="bottom", fontsize=7, color="#9ca3af")

    top_y = (n - 1) * ROW_SPACING + BAR_HEIGHT / 2 + 0.05
    ax.set_ylim(bottom_y, top_y)
    for spine in ("top", "right", "left", "bottom"):
        ax.spines[spine].set_visible(False)
    ax.tick_params(left=False)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    buf.seek(0)
    return buf.read()

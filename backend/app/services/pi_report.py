"""PI report service: generates readiness (B1) and planning-readout (B2) reports
for a planned PI, in Markdown or PDF.

Both reports are derived entirely from existing planning data (effort estimates,
sprint capacity, item placement, PI/sprint dates, PI events) — no schema change.
Data-gathering is kept separate from rendering: `build_readiness_model` /
`build_readout_model` produce plain dataclasses that the Markdown and PDF
renderers consume, so the two output formats never drift.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.feature import Feature
from app.models.group import Group
from app.models.pbi import PBI
from app.models.pi import PI
from app.models.pi_event import PIEvent
from app.models.project import Project
from app.models.sprint import Sprint
from app.models.swimline import Swimline
from app.services.effort import (
    pi_effort_and_capacity,
    sprint_efforts_for_pi,
    sprint_utilization,
    swimline_efforts,
)
from app.services.pi_export import _pbi_label, safe_filename  # reuse label + filename helpers

REPORT_TYPES = ("readiness", "readout")
REPORT_FORMATS = ("markdown", "pdf")

_USER_ID_MIN = 1
_USER_ID_MAX = 999_999


@dataclass
class ReportOptions:
    report_type: str = "readiness"  # readiness | readout
    fmt: str = "markdown"           # markdown | pdf
    show_ids: bool = True


# ── report models ────────────────────────────────────────────────────────────

# Severities that count as actionable problems. "info" findings are surfaced
# for awareness but do not block readiness (e.g. unestimated bugs, which many
# teams intentionally leave unestimated).
_ACTIONABLE_SEVERITIES = ("error", "warn")


@dataclass
class Finding:
    """One readiness check. Empty `items` means the check passed."""
    title: str
    severity: str          # "error" | "warn" | "info"
    items: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.items

    @property
    def actionable(self) -> bool:
        return self.severity in _ACTIONABLE_SEVERITIES


@dataclass
class ReadinessModel:
    pi_name: str
    findings: list[Finding]

    @property
    def total_issues(self) -> int:
        """Number of actionable problems — informational findings don't count."""
        return sum(len(f.items) for f in self.findings if f.actionable)

    @property
    def actionable_checks(self) -> int:
        return sum(1 for f in self.findings if f.actionable)


@dataclass
class SwimlaneLoad:
    name: str
    effort: float


@dataclass
class SprintLoad:
    number: int
    effort: float
    capacity: int
    status: str            # from sprint_utilization


@dataclass
class Milestone:
    name: str
    on: date
    event_type: str


@dataclass
class ReadoutModel:
    pi_name: str
    description: str | None
    state: str
    start_date: date | None
    end_date: date | None
    effort_unit: str
    total_effort: float
    total_capacity: int
    swimlanes: list[SwimlaneLoad]
    sprints: list[SprintLoad]
    milestones: list[Milestone]

    @property
    def over_capacity(self) -> list[SprintLoad]:
        return [s for s in self.sprints if s.status == "over"]

    @property
    def utilization(self) -> float:
        return self.total_effort / self.total_capacity if self.total_capacity else 0.0


# ── data gathering ───────────────────────────────────────────────────────────

async def _effort_unit(db: AsyncSession, pi: PI) -> str:
    project = await db.get(Project, pi.project_id)
    return project.effort_unit if project and project.effort_unit else "pts"


async def _pbis_in_pi(db: AsyncSession, pi_id: str) -> list[PBI]:
    """All PBIs whose parent feature belongs to this PI."""
    result = await db.execute(
        select(PBI)
        .join(Feature, PBI.parent_feature_system_id == Feature.system_id)
        .where(Feature.pi_id == pi_id)
        .order_by(PBI.title.asc())
    )
    return list(result.scalars().all())


async def _sprint_loads(db: AsyncSession, pi_id: str) -> list[SprintLoad]:
    sprints_result = await db.execute(
        select(Sprint).where(Sprint.pi_id == pi_id).order_by(Sprint.sprint_index.asc())
    )
    sprints = sprints_result.scalars().all()
    efforts = await sprint_efforts_for_pi(db, pi_id)
    loads: list[SprintLoad] = []
    for pos, sprint in enumerate(sprints):
        idx = sprint.sprint_index if sprint.sprint_index is not None else pos
        effort = efforts.get(idx, 0.0)
        _, status = sprint_utilization(effort, sprint.capacity)
        loads.append(SprintLoad(number=idx + 1, effort=effort, capacity=sprint.capacity, status=status))
    return loads


async def build_readiness_model(db: AsyncSession, pi: PI, show_ids: bool) -> ReadinessModel:
    pbis = await _pbis_in_pi(db, pi.system_id)

    # 1. Unestimated items — split stories/PBIs (actionable) from bugs (informational,
    #    since many teams intentionally leave bugs unestimated).
    unestimated = [
        _pbi_label(p.user_id, p.title, show_ids)
        for p in pbis if p.effort is None and p.item_type != "bug"
    ]
    unestimated_bugs = [
        _pbi_label(p.user_id, p.title, show_ids)
        for p in pbis if p.effort is None and p.item_type == "bug"
    ]

    # 2. Over-capacity sprints
    over = [
        f"Sprint {s.number}: {_num(s.effort)} / {s.capacity} "
        f"(over by {_num(s.effort - s.capacity)})"
        for s in await _sprint_loads(db, pi.system_id)
        if s.status == "over"
    ]

    # 3. Features in the PI with no PBIs
    feature_rows = await db.execute(
        select(Feature.system_id, Feature.user_id, Feature.title)
        .where(Feature.pi_id == pi.system_id)
    )
    features = feature_rows.all()
    features_with_pbis = {p.parent_feature_system_id for p in pbis}
    empty_features = [
        _pbi_label(f.user_id, f.title, show_ids)
        for f in features
        if f.system_id not in features_with_pbis
    ]

    # 4. PBIs in the PI not placed in any sprint
    placed_rows = await db.execute(
        select(PBI.system_id)
        .join(Group, PBI.group_id == Group.system_id)
        .join(Feature, PBI.parent_feature_system_id == Feature.system_id)
        .where(Feature.pi_id == pi.system_id, Group.sprint_index.is_not(None))
    )
    placed_ids = {row[0] for row in placed_rows.all()}
    unplaced = [
        _pbi_label(p.user_id, p.title, show_ids) for p in pbis if p.system_id not in placed_ids
    ]

    # 5. Orphaned PBIs — group_id set but the referenced group no longer exists
    orphan_rows = await db.execute(
        select(PBI.user_id, PBI.title)
        .join(Feature, PBI.parent_feature_system_id == Feature.system_id)
        .outerjoin(Group, PBI.group_id == Group.system_id)
        .where(
            Feature.pi_id == pi.system_id,
            PBI.group_id.is_not(None),
            Group.system_id.is_(None),
        )
    )
    orphaned = [_pbi_label(r.user_id, r.title, show_ids) for r in orphan_rows.all()]

    # 6. Duplicate / out-of-range user IDs across the whole project
    id_issues = await _user_id_issues(db, pi.project_id)

    findings = [
        Finding("Unestimated PBIs", "warn", unestimated),
        Finding("Unestimated bugs (estimate optional)", "info", unestimated_bugs),
        Finding("Over-capacity sprints", "error", over),
        Finding("Features with no PBIs", "warn", empty_features),
        Finding("PBIs not placed in a sprint", "warn", unplaced),
        Finding("Orphaned PBIs (broken group link)", "error", orphaned),
        Finding("Duplicate or invalid user IDs (project-wide)", "error", id_issues),
    ]
    return ReadinessModel(pi_name=pi.name, findings=findings)


async def _user_id_issues(db: AsyncSession, project_id: str) -> list[str]:
    """Return human-readable lines for duplicate or out-of-range user IDs.

    Features and PBIs share one user_id namespace per project."""
    feat_rows = await db.execute(
        select(Feature.user_id, Feature.title)
        .where(Feature.project_id == project_id, Feature.user_id.is_not(None))
    )
    pbi_rows = await db.execute(
        select(PBI.user_id, PBI.title)
        .where(PBI.project_id == project_id, PBI.user_id.is_not(None))
    )
    owners: dict[int, list[str]] = {}
    for uid, title in feat_rows.all():
        owners.setdefault(uid, []).append(f"Feature “{title}”")
    for uid, title in pbi_rows.all():
        owners.setdefault(uid, []).append(f"PBI “{title}”")

    lines: list[str] = []
    for uid in sorted(owners):
        labels = owners[uid]
        if len(labels) > 1:
            lines.append(f"user_id {uid} — used by {len(labels)} items: {', '.join(labels)}")
        if uid < _USER_ID_MIN or uid > _USER_ID_MAX:
            lines.append(f"user_id {uid} — out of range (1–999,999): {', '.join(labels)}")
    return lines


async def build_readout_model(db: AsyncSession, pi: PI) -> ReadoutModel:
    total_effort, total_capacity = await pi_effort_and_capacity(db, pi.system_id)
    effort_unit = await _effort_unit(db, pi)

    swimlines_result = await db.execute(
        select(Swimline)
        .where(Swimline.pi_id == pi.system_id)
        .order_by(Swimline.order_index.asc().nullslast(), Swimline.name.asc())
    )
    swimlines = swimlines_result.scalars().all()
    efforts = await swimline_efforts(db, [s.system_id for s in swimlines])
    swimlane_loads = [
        SwimlaneLoad(name=s.name, effort=efforts.get(s.system_id, 0.0)) for s in swimlines
    ]

    sprints = await _sprint_loads(db, pi.system_id)

    events_result = await db.execute(
        select(PIEvent).where(PIEvent.pi_id == pi.system_id).order_by(PIEvent.event_date.asc())
    )
    milestones = [
        Milestone(name=e.name, on=e.event_date, event_type=e.event_type)
        for e in events_result.scalars().all()
    ]

    return ReadoutModel(
        pi_name=pi.name,
        description=pi.description,
        state=pi.state,
        start_date=pi.start_date,
        end_date=pi.end_date,
        effort_unit=effort_unit,
        total_effort=total_effort,
        total_capacity=total_capacity,
        swimlanes=swimlane_loads,
        sprints=sprints,
        milestones=milestones,
    )


# ── formatting helpers ───────────────────────────────────────────────────────

def _num(value: float) -> str:
    """Render an effort number without a trailing .0 for whole values."""
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def _fmt_date(d: date | None) -> str:
    return d.strftime("%d.%m.%Y") if d else "—"


def _md_cell(text: str) -> str:
    return text.replace("|", "\\|")


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


# ── Markdown renderers ───────────────────────────────────────────────────────

def render_readiness_markdown(model: ReadinessModel) -> str:
    lines: list[str] = [f"# Readiness Report — {model.pi_name}", "", f"_Generated {_now_str()}_", ""]
    if model.total_issues == 0:
        lines += ["**✓ No issues found — this PI is ready.**", ""]
    else:
        lines += [
            f"**⚠ {model.total_issues} issue(s) found across {model.actionable_checks} checks.**",
            "",
        ]

    for f in model.findings:
        if f.ok:
            lines += [f"## ✓ {f.title}", "", "None.", ""]
            continue
        lines += [f"## {_SEVERITY_ICON[f.severity]} {f.title} ({len(f.items)})", ""]
        lines += [f"- {item}" for item in f.items]
        lines += [""]
    return "\n".join(lines).rstrip() + "\n"


_SEVERITY_ICON: dict[str, str] = {"error": "🔴", "warn": "🟠", "info": "🔵"}


def render_readout_markdown(model: ReadoutModel) -> str:
    u = model.effort_unit
    lines: list[str] = [
        f"# PI Planning Readout — {model.pi_name}",
        "",
        f"_Generated {_now_str()}_",
        "",
        f"- **Dates:** {_fmt_date(model.start_date)} → {_fmt_date(model.end_date)}",
        f"- **State:** {model.state}",
        f"- **Committed load:** {_num(model.total_effort)} / {model.total_capacity} {u} "
        f"({model.utilization * 100:.0f}% utilization)",
        "",
        "## Objectives",
        "",
        model.description.strip() if model.description and model.description.strip()
        else "_No description set._",
        "",
        "## Committed load by team",
        "",
        f"| Team | Effort ({u}) |",
        "|------|------|",
    ]
    if model.swimlanes:
        lines += [f"| {_md_cell(s.name)} | {_num(s.effort)} |" for s in model.swimlanes]
    else:
        lines += ["| _No teams_ | 0 |"]

    lines += ["", "## Sprint capacity", "", "| Sprint | Load | Capacity | Status |",
              "|--------|------|----------|--------|"]
    if model.sprints:
        for s in model.sprints:
            lines.append(
                f"| Sprint {s.number} | {_num(s.effort)} | {s.capacity} | {_STATUS_LABEL[s.status]} |"
            )
    else:
        lines += ["| _No sprints_ | 0 | 0 | — |"]

    if model.over_capacity:
        names = ", ".join(f"Sprint {s.number}" for s in model.over_capacity)
        lines += ["", f"> ⚠ **Over capacity:** {names}"]

    lines += ["", "## Milestones", ""]
    if model.milestones:
        lines += ["| Date | Event | Type |", "|------|-------|------|"]
        lines += [
            f"| {_fmt_date(m.on)} | {_md_cell(m.name)} | {m.event_type} |"
            for m in model.milestones
        ]
    else:
        lines += ["_No milestones defined._"]

    return "\n".join(lines).rstrip() + "\n"


_STATUS_LABEL: dict[str, str] = {
    "over": "🔴 over",
    "warn": "🟠 near limit",
    "ok": "🟢 ok",
    "no_capacity": "⚪ no capacity",
}

_STATUS_COLOR: dict[str, str] = {
    "over": "#ef4444",
    "warn": "#f59e0b",
    "ok": "#3b82f6",
    "no_capacity": "#9ca3af",
}


# ── PDF renderers (ReportLab) ────────────────────────────────────────────────

def _sprint_chart_png(model: ReadoutModel) -> bytes | None:
    """A small horizontal load-vs-capacity bar chart for the readout PDF."""
    if not model.sprints:
        return None
    from matplotlib.backends.backend_agg import FigureCanvasAgg
    from matplotlib.figure import Figure

    fig = Figure(figsize=(6.0, 0.4 * len(model.sprints) + 0.6), dpi=150, layout="constrained")
    FigureCanvasAgg(fig)
    ax = fig.add_subplot(111)
    labels = [f"Sprint {s.number}" for s in model.sprints]
    y = range(len(model.sprints))
    ax.barh(list(y), [s.capacity for s in model.sprints], color="#e5e7eb", label="Capacity")
    ax.barh(list(y), [s.effort for s in model.sprints],
            color=[_STATUS_COLOR[s.status] for s in model.sprints], height=0.5, label="Load")
    ax.set_yticks(list(y))
    ax.set_yticklabels(labels, fontsize=8)
    ax.invert_yaxis()
    ax.tick_params(axis="x", labelsize=8)
    for spine in ("top", "right"):
        ax.spines[spine].set_visible(False)
    ax.legend(fontsize=7, loc="lower right")

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    buf.seek(0)
    return buf.read()


def render_readiness_pdf(model: ReadinessModel) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import ListFlowable, ListItem, Paragraph, Spacer

    styles = getSampleStyleSheet()
    story: list[object] = [
        Paragraph(f"Readiness Report — {_esc(model.pi_name)}", styles["Title"]),
        Paragraph(f"Generated {_now_str()}", styles["Italic"]),
        Spacer(1, 12),
    ]
    if model.total_issues == 0:
        story.append(Paragraph("<b>No issues found — this PI is ready.</b>", styles["Normal"]))
    else:
        story.append(Paragraph(
            f"<b>{model.total_issues} issue(s) found across {model.actionable_checks} checks.</b>",
            styles["Normal"],
        ))
    story.append(Spacer(1, 12))

    for f in model.findings:
        color = colors.HexColor(_finding_hex(f))
        heading = f.title if f.ok else f"{f.title} ({len(f.items)})"
        story.append(Paragraph(f'<font color="{color.hexval()}"><b>{_esc(heading)}</b></font>',
                               styles["Heading3"]))
        if f.ok:
            story.append(Paragraph("None.", styles["Normal"]))
        else:
            story.append(ListFlowable(
                [ListItem(Paragraph(_esc(item), styles["Normal"])) for item in f.items],
                bulletType="bullet",
            ))
        story.append(Spacer(1, 8))

    return _build_pdf(story)


def render_readout_pdf(model: ReadoutModel) -> bytes:
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.platypus import Image, Paragraph, Spacer, Table

    styles = getSampleStyleSheet()
    u = model.effort_unit
    story: list[object] = [
        Paragraph(f"PI Planning Readout — {_esc(model.pi_name)}", styles["Title"]),
        Paragraph(f"Generated {_now_str()}", styles["Italic"]),
        Spacer(1, 12),
        Paragraph(f"<b>Dates:</b> {_fmt_date(model.start_date)} → {_fmt_date(model.end_date)}",
                  styles["Normal"]),
        Paragraph(f"<b>State:</b> {_esc(model.state)}", styles["Normal"]),
        Paragraph(
            f"<b>Committed load:</b> {_num(model.total_effort)} / {model.total_capacity} {u} "
            f"({model.utilization * 100:.0f}% utilization)",
            styles["Normal"],
        ),
        Spacer(1, 12),
        Paragraph("Objectives", styles["Heading2"]),
        Paragraph(
            _esc(model.description.strip()) if model.description and model.description.strip()
            else "<i>No description set.</i>",
            styles["Normal"],
        ),
        Spacer(1, 12),
        Paragraph("Committed load by team", styles["Heading2"]),
    ]

    team_rows = [["Team", f"Effort ({u})"]]
    team_rows += [[s.name, _num(s.effort)] for s in model.swimlanes] or [["No teams", "0"]]
    story.append(_grid(Table(team_rows, hAlign="LEFT")))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Sprint capacity", styles["Heading2"]))
    chart = _sprint_chart_png(model)
    if chart is not None:
        from reportlab.lib.utils import ImageReader

        px_w, px_h = ImageReader(io.BytesIO(chart)).getSize()
        width = 6 * inch
        story.append(Image(io.BytesIO(chart), width=width, height=width * px_h / px_w))
    if model.over_capacity:
        names = ", ".join(f"Sprint {s.number}" for s in model.over_capacity)
        story.append(Paragraph(
            f'<font color="#ef4444"><b>Over capacity:</b> {_esc(names)}</font>', styles["Normal"]))
    story.append(Spacer(1, 12))

    story.append(Paragraph("Milestones", styles["Heading2"]))
    if model.milestones:
        ms_rows = [["Date", "Event", "Type"]]
        ms_rows += [[_fmt_date(m.on), m.name, m.event_type] for m in model.milestones]
        story.append(_grid(Table(ms_rows, hAlign="LEFT")))
    else:
        story.append(Paragraph("<i>No milestones defined.</i>", styles["Normal"]))

    return _build_pdf(story)


def _grid(table: object) -> object:
    from reportlab.lib import colors
    from reportlab.platypus import TableStyle

    table.setStyle(TableStyle([  # type: ignore[attr-defined]
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f3f4f6")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f9fafb")]),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def _build_pdf(story: list[object]) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, title="PI Report",
                            topMargin=48, bottomMargin=48, leftMargin=48, rightMargin=48)
    doc.build(story)
    buf.seek(0)
    return buf.read()


def _esc(text: str) -> str:
    """Escape text for ReportLab's mini-HTML paragraph markup."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


_SEVERITY_HEX: dict[str, str] = {"error": "#ef4444", "warn": "#f59e0b", "info": "#3b82f6"}


def _finding_hex(f: Finding) -> str:
    if f.ok:
        return "#16a34a"
    return _SEVERITY_HEX[f.severity]


# ── public entry ─────────────────────────────────────────────────────────────

async def export_pi_report(
    db: AsyncSession, pi: PI, opts: ReportOptions
) -> tuple[bytes, str, str]:
    """Return (content_bytes, media_type, extension) for the requested report."""
    if opts.report_type == "readiness":
        model = await build_readiness_model(db, pi, opts.show_ids)
        if opts.fmt == "pdf":
            return render_readiness_pdf(model), "application/pdf", "pdf"
        text = render_readiness_markdown(model)
    else:  # readout
        readout = await build_readout_model(db, pi)
        if opts.fmt == "pdf":
            return render_readout_pdf(readout), "application/pdf", "pdf"
        text = render_readout_markdown(readout)
    return text.encode("utf-8"), "text/markdown; charset=utf-8", "md"


def report_filename(pi_name: str, report_type: str, ext: str) -> str:
    return f"{safe_filename(pi_name)}-{report_type}.{ext}"

"""PI dashboard service (C1): a self-contained, always-current HTML dashboard for
one PI, served from the same live data as the PNG/CSV/report exports.

The page bundles the glanceable views:

- capacity gauges (per-sprint load vs. capacity + a PI total),
- the capacity-vs-load heatmap (A1) as an HTML table,
- the backlog-composition grid (A2, PBI/bug counts) as an HTML table,
- a milestone timeline positioned along the sprint axis.

No schema change — every field already exists. The page is fully self-contained
(inline CSS + JS, no external calls) so it can be handed to an MCP client as a
resource string *or* opened directly in a browser. When served over HTTP an
optional inline script re-fetches the same URL on an interval so an open tab
stays current; that script is inert (and omitted) otherwise.

As with pi_report.py, data-gathering (`build_dashboard_model`) is kept separate
from rendering (`render_dashboard_html`) so the two never drift, and the colour
thresholds are the shared `sprint_utilization` / `_UTIL_COLORS` used everywhere
else, so the dashboard, PNG heatmap and reports always agree.
"""

from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pi import PI
from app.models.pi_event import PIEvent
from app.models.project import Project
from app.models.sprint import Sprint
from app.models.swimline import Swimline
from app.services.effort import (
    pi_effort_and_capacity,
    sprint_efforts_for_pi,
    sprint_swimline_efforts,
    sprint_swimline_item_counts,
    sprint_utilization,
)
from app.services.pi_export import (
    _UTIL_COLORS,
    EVENT_COLORS,
    _event_x,
    safe_filename,
)


@dataclass
class DashboardOptions:
    refresh_seconds: int = 0  # 0 disables the auto-refresh script
    show_ids: bool = False    # reserved for parity with the other exports


# ── model ────────────────────────────────────────────────────────────────────


@dataclass
class _SprintCell:
    index: int
    capacity: int
    effort: float
    ratio: float
    status: str
    start_date: date | None
    end_date: date | None


@dataclass
class _Lane:
    system_id: str
    name: str


@dataclass
class _Milestone:
    name: str
    on: date
    event_type: str
    x_pct: float | None  # position along the sprint axis, 0–100, or None if undatable


@dataclass
class DashboardModel:
    pi_name: str
    description: str | None
    state: str
    start_date: date | None
    end_date: date | None
    effort_unit: str
    total_effort: float
    total_capacity: int
    total_ratio: float
    total_status: str
    num_sprints: int
    sprints: list[_SprintCell]
    lanes: list[_Lane]
    heat: dict[tuple[int, str], float]
    comp: dict[tuple[int, str], tuple[int, int]]
    milestones: list[_Milestone]


# ── data gathering ───────────────────────────────────────────────────────────


async def build_dashboard_model(db: AsyncSession, pi: PI) -> DashboardModel:
    total_effort, total_capacity = await pi_effort_and_capacity(db, pi.system_id)
    total_ratio, total_status = sprint_utilization(total_effort, total_capacity)

    project = await db.get(Project, pi.project_id)
    effort_unit = project.effort_unit if project and project.effort_unit else "pts"

    sprints_result = await db.execute(
        select(Sprint).where(Sprint.pi_id == pi.system_id).order_by(Sprint.sprint_index.asc())
    )
    sprints = sprints_result.scalars().all()
    sprint_efforts = await sprint_efforts_for_pi(db, pi.system_id)

    sprint_cells: list[_SprintCell] = []
    for pos, s in enumerate(sprints):
        idx = s.sprint_index if s.sprint_index is not None else pos
        effort = sprint_efforts.get(idx, 0.0)
        ratio, status = sprint_utilization(effort, s.capacity or 0)
        sprint_cells.append(
            _SprintCell(
                index=idx,
                capacity=s.capacity or 0,
                effort=effort,
                ratio=ratio,
                status=status,
                start_date=s.start_date,
                end_date=s.end_date,
            )
        )
    num_sprints = len(sprint_cells) or 5

    swimlines_result = await db.execute(
        select(Swimline)
        .where(Swimline.pi_id == pi.system_id)
        .order_by(Swimline.order_index.asc().nullslast(), Swimline.name.asc())
    )
    lanes = [_Lane(system_id=s.system_id, name=s.name) for s in swimlines_result.scalars().all()]

    heat = await sprint_swimline_efforts(db, pi.system_id)
    comp = await sprint_swimline_item_counts(db, pi.system_id)

    dated_sprints = [
        (c.index, c.start_date, c.end_date)
        for c in sprint_cells
        if c.start_date and c.end_date
    ]
    events_result = await db.execute(
        select(PIEvent).where(PIEvent.pi_id == pi.system_id).order_by(PIEvent.event_date.asc())
    )
    milestones: list[_Milestone] = []
    for e in events_result.scalars().all():
        x = _event_x(e.event_date, dated_sprints, num_sprints)
        x_pct = None if x is None else max(0.0, min(100.0, x / num_sprints * 100.0))
        milestones.append(
            _Milestone(name=e.name, on=e.event_date, event_type=e.event_type, x_pct=x_pct)
        )

    return DashboardModel(
        pi_name=pi.name,
        description=pi.description,
        state=pi.state,
        start_date=pi.start_date,
        end_date=pi.end_date,
        effort_unit=effort_unit,
        total_effort=total_effort,
        total_capacity=total_capacity,
        total_ratio=total_ratio,
        total_status=total_status,
        num_sprints=num_sprints,
        sprints=sprint_cells,
        lanes=lanes,
        heat=heat,
        comp=comp,
        milestones=milestones,
    )


# ── formatting helpers ───────────────────────────────────────────────────────


def _num(value: float) -> str:
    """Render an effort number without a trailing .0 for whole values."""
    return str(int(value)) if float(value).is_integer() else f"{value:g}"


def _fmt_date(d: date | None) -> str:
    return d.strftime("%d.%m.%Y") if d else "—"


def _fmt_date_short(d: date | None) -> str:
    return d.strftime("%d.%m") if d else "?"


def _esc(text: str) -> str:
    return html.escape(text, quote=True)


# Text colour per capacity status, chosen for contrast against the _UTIL_COLORS fill.
# Mirrors _HEATMAP_TEXT_COLORS in pi_export.py.
_STATUS_TEXT: dict[str, str] = {
    "no_capacity": "#1f2937",
    "over": "#ffffff",
    "warn": "#1f2937",
    "ok": "#ffffff",
}

# ── rendering ────────────────────────────────────────────────────────────────


def render_dashboard_html(model: DashboardModel, opts: DashboardOptions) -> str:
    body = "\n".join(
        [
            _render_header(model),
            _render_gauges(model),
            _render_heatmap(model),
            _render_composition(model),
            _render_timeline(model),
            _render_footer(),
        ]
    )
    script = _render_refresh_script(opts.refresh_seconds)
    return _PAGE.format(
        title=_esc(model.pi_name),
        css=_CSS,
        body=body,
        script=script,
    )


def _render_header(m: DashboardModel) -> str:
    pct = round(m.total_ratio * 100)
    color = _UTIL_COLORS[m.total_status]
    dates = ""
    if m.start_date or m.end_date:
        dates = f'<span class="dates">{_fmt_date(m.start_date)} – {_fmt_date(m.end_date)}</span>'
    desc = f'<p class="desc">{_esc(m.description)}</p>' if m.description else ""
    return f"""
<header>
  <div class="titlebar">
    <h1>{_esc(m.pi_name)}</h1>
    <span class="badge state-{_esc(m.state)}">{_esc(m.state.replace("_", " "))}</span>
  </div>
  <div class="meta">
    {dates}
    <span class="total" style="--c:{color}">
      {_num(m.total_effort)} / {m.total_capacity} {_esc(m.effort_unit)} · {pct}%
    </span>
  </div>
  {desc}
</header>"""


def _render_gauges(m: DashboardModel) -> str:
    cards = []
    for c in m.sprints:
        pct = round(c.ratio * 100)
        color = _UTIL_COLORS[c.status]
        fill = min(c.ratio, 1.0) * 100
        cards.append(f"""
    <div class="gauge">
      <div class="g-head">
        <span class="g-name">Sprint {c.index + 1}</span>
        <span class="g-dates">{_fmt_date_short(c.start_date)}–{_fmt_date_short(c.end_date)}</span>
      </div>
      <div class="g-bar"><span style="width:{fill:.1f}%;background:{color}"></span></div>
      <div class="g-foot" style="color:{color}">{_num(c.effort)} / {c.capacity} · {pct}%</div>
    </div>""")
    return f"""
<section>
  <h2>Capacity by sprint</h2>
  <div class="gauges">{"".join(cards)}</div>
</section>"""


def _render_heatmap(m: DashboardModel) -> str:
    """Swimlane × sprint grid coloured by capacity utilization (A1)."""
    head = "".join(f"<th>S{c.index + 1}</th>" for c in m.sprints)
    rows = []
    for lane in m.lanes:
        cells = []
        team_total = 0.0
        for c in m.sprints:
            load = m.heat.get((c.index, lane.system_id), 0.0)
            team_total += load
            if load > 0:
                _, status = sprint_utilization(load, c.capacity)
                bg, fg = _UTIL_COLORS[status], _STATUS_TEXT[status]
                cells.append(f'<td style="background:{bg};color:{fg}">{_num(load)}</td>')
            else:
                cells.append('<td class="empty"></td>')
        rows.append(
            f'<tr><th class="lane">{_esc(lane.name)}</th>{"".join(cells)}'
            f'<td class="tot">{_num(team_total)}</td></tr>'
        )
    # bottom totals row: per-sprint load vs capacity — the real over-commit check
    foot_cells = []
    for c in m.sprints:
        col_total = sum(m.heat.get((c.index, lane.system_id), 0.0) for lane in m.lanes)
        _, status = sprint_utilization(col_total, c.capacity)
        bg, fg = _UTIL_COLORS[status], _STATUS_TEXT[status]
        foot_cells.append(
            f'<td style="background:{bg};color:{fg}">{_num(col_total)}/{c.capacity}</td>'
        )
    gbg, gfg = _UTIL_COLORS[m.total_status], _STATUS_TEXT[m.total_status]
    grand = f'<td style="background:{gbg};color:{gfg}">{_num(m.total_effort)}/{m.total_capacity}</td>'
    body = "".join(rows) if rows else (
        f'<tr><td class="empty" colspan="{m.num_sprints + 2}">No swimlanes</td></tr>'
    )
    return f"""
<section>
  <h2>Capacity vs. load</h2>
  <div class="table-scroll">
  <table class="grid heat">
    <thead><tr><th class="lane">Team</th>{head}<th class="tot">Total</th></tr></thead>
    <tbody>{body}</tbody>
    <tfoot><tr><th class="lane">Total</th>{"".join(foot_cells)}{grand}</tr></tfoot>
  </table>
  </div>
</section>"""


def _render_composition(m: DashboardModel) -> str:
    """Swimlane × sprint grid of PBI/bug counts (A2)."""
    head = "".join(f"<th>S{c.index + 1}</th>" for c in m.sprints)

    def pair(pbi: int, bug: int, total: bool = False) -> str:
        if not total and pbi == 0 and bug == 0:
            return '<td class="empty"></td>'
        cls = "tot" if total else ""
        return (
            f'<td class="{cls}"><span class="pbi">{pbi}</span>'
            f'<span class="dot">·</span><span class="bug">{bug}</span></td>'
        )

    rows = []
    grand_pbi = grand_bug = 0
    for lane in m.lanes:
        cells = []
        team_pbi = team_bug = 0
        for c in m.sprints:
            p, b = m.comp.get((c.index, lane.system_id), (0, 0))
            team_pbi += p
            team_bug += b
            cells.append(pair(p, b))
        grand_pbi += team_pbi
        grand_bug += team_bug
        rows.append(
            f'<tr><th class="lane">{_esc(lane.name)}</th>{"".join(cells)}'
            f"{pair(team_pbi, team_bug, total=True)}</tr>"
        )
    foot_cells = []
    for c in m.sprints:
        col_pbi = sum(m.comp.get((c.index, lane.system_id), (0, 0))[0] for lane in m.lanes)
        col_bug = sum(m.comp.get((c.index, lane.system_id), (0, 0))[1] for lane in m.lanes)
        foot_cells.append(pair(col_pbi, col_bug, total=True))
    body = "".join(rows) if rows else (
        f'<tr><td class="empty" colspan="{m.num_sprints + 2}">No swimlanes</td></tr>'
    )
    return f"""
<section>
  <h2>Backlog composition <span class="legend"><span class="pbi">PBIs</span> ·
    <span class="bug">Bugs</span></span></h2>
  <div class="table-scroll">
  <table class="grid comp">
    <thead><tr><th class="lane">Team</th>{head}<th class="tot">Total</th></tr></thead>
    <tbody>{body}</tbody>
    <tfoot><tr><th class="lane">Total</th>{"".join(foot_cells)}
      {pair(grand_pbi, grand_bug, total=True)}</tr></tfoot>
  </table>
  </div>
</section>"""


def _render_timeline(m: DashboardModel) -> str:
    if not m.milestones:
        return ""
    # sprint tick marks along the axis
    ticks = "".join(
        f'<span class="tick" style="left:{(i + 1) / m.num_sprints * 100:.2f}%"></span>'
        for i in range(m.num_sprints - 1)
    )
    markers = []
    undated = []
    for ms in m.milestones:
        color = EVENT_COLORS.get(ms.event_type, "#6b7280")
        label = f"{_esc(ms.name)} · {_fmt_date(ms.on)}"
        if ms.x_pct is None:
            undated.append(f'<li style="--c:{color}">{label}</li>')
            continue
        markers.append(
            f'<div class="marker" style="left:{ms.x_pct:.2f}%;--c:{color}" title="{label}">'
            f'<span class="dot"></span><span class="lbl">{label}</span></div>'
        )
    undated_html = f'<ul class="undated">{"".join(undated)}</ul>' if undated else ""
    return f"""
<section>
  <h2>Milestones</h2>
  <div class="timeline">
    <div class="axis">{ticks}</div>
    {"".join(markers)}
  </div>
  {undated_html}
</section>"""


def _render_footer() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return f'<footer>Generated <time id="stamp">{stamp}</time> · live from plan data</footer>'


def _render_refresh_script(refresh_seconds: int) -> str:
    if refresh_seconds <= 0:
        return ""
    # Guarded so it only runs when actually served over HTTP; when this HTML is
    # handed to an MCP client as a resource string the script is a no-op. Uses
    # fetch-and-swap (not location.reload) to avoid flicker/scroll loss, falling
    # back to a reload on error.
    return f"""<script>
(function () {{
  var P = location.protocol;
  if (P !== "http:" && P !== "https:") return;
  var ms = {refresh_seconds} * 1000;
  setInterval(async function () {{
    try {{
      var res = await fetch(location.href, {{ cache: "no-store" }});
      if (!res.ok) return;
      var doc = new DOMParser().parseFromString(await res.text(), "text/html");
      document.body.innerHTML = doc.body.innerHTML;
    }} catch (e) {{
      location.reload();
    }}
  }}, ms);
}})();
</script>"""


def dashboard_filename(pi_name: str) -> str:
    return safe_filename(pi_name) + "-dashboard.html"


_CSS = """
:root {
  --bg: #f8fafc; --card: #ffffff; --ink: #1f2937; --muted: #6b7280;
  --line: #e2e8f0; --accent: #3b82f6;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f172a; --card: #1e293b; --ink: #e2e8f0; --muted: #94a3b8;
    --line: #334155; --accent: #60a5fa;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 1.5rem; background: var(--bg); color: var(--ink);
  font: 14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
header { margin-bottom: 1.5rem; }
.titlebar { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
h1 { font-size: 1.5rem; margin: 0; }
h2 {
  font-size: .8rem; text-transform: uppercase; letter-spacing: .05em;
  color: var(--muted); margin: 0 0 .6rem;
}
.badge {
  font-size: .7rem; text-transform: uppercase; letter-spacing: .04em;
  padding: .15rem .5rem; border-radius: 999px; border: 1px solid var(--line);
  color: var(--muted);
}
.state-in_progress { color: #fff; background: var(--accent); border-color: transparent; }
.state-closed { opacity: .7; }
.meta { display: flex; align-items: center; gap: 1rem; margin-top: .4rem; flex-wrap: wrap; }
.dates { color: var(--muted); }
.total {
  font-weight: 600; color: var(--c); border: 1px solid var(--c);
  padding: .1rem .5rem; border-radius: 6px;
}
.desc { color: var(--muted); margin: .5rem 0 0; max-width: 60ch; }
section {
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 1rem 1.15rem; margin-bottom: 1.25rem;
}
.gauges { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: .75rem; }
.gauge { border: 1px solid var(--line); border-radius: 8px; padding: .6rem .7rem; }
.g-head { display: flex; justify-content: space-between; align-items: baseline; }
.g-name { font-weight: 600; }
.g-dates { font-size: .7rem; color: var(--muted); }
.g-bar { height: 8px; background: var(--line); border-radius: 999px; margin: .5rem 0 .4rem; overflow: hidden; }
.g-bar span { display: block; height: 100%; border-radius: 999px; }
.g-foot { font-size: .78rem; font-weight: 600; }
.grid { border-collapse: collapse; width: 100%; }
.grid th, .grid td {
  border: 1px solid var(--line); padding: .35rem .5rem; text-align: center;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.grid thead th, .grid tfoot th, .grid .tot { font-weight: 700; }
.grid tfoot td, .grid .tot { background: color-mix(in srgb, var(--line) 45%, transparent); }
.grid th.lane { text-align: left; font-weight: 600; max-width: 12rem; overflow: hidden; text-overflow: ellipsis; }
.grid td.empty { background: color-mix(in srgb, var(--line) 25%, transparent); }
.table-scroll { overflow-x: auto; }
.comp .pbi { color: var(--ink); font-weight: 600; }
.comp .bug { color: #ef4444; font-weight: 600; }
.comp .dot { color: var(--muted); margin: 0 .2rem; }
.legend { font-size: .7rem; font-weight: 600; text-transform: none; letter-spacing: 0; }
.timeline { position: relative; height: 74px; margin: 1.5rem .5rem 0; }
.axis { position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--line); }
.axis .tick { position: absolute; top: -3px; width: 1px; height: 8px; background: var(--line); }
.marker { position: absolute; top: -5px; transform: translateX(-50%); }
.marker .dot {
  display: block; width: 11px; height: 11px; background: var(--c);
  transform: rotate(45deg); margin: 0 auto;
}
.marker .lbl {
  display: block; margin-top: .35rem; font-size: .68rem; color: var(--c);
  white-space: nowrap; transform: rotate(-30deg); transform-origin: top left;
}
.undated { list-style: none; padding: 0; margin: .5rem 0 0; }
.undated li { font-size: .8rem; color: var(--c); }
footer { color: var(--muted); font-size: .75rem; text-align: right; }
"""

_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · PI Dashboard</title>
<style>{css}</style>
</head>
<body>
{body}
{script}
</body>
</html>"""


async def export_pi_dashboard(db: AsyncSession, pi: PI, opts: DashboardOptions | None = None) -> str:
    """Build the self-contained HTML dashboard for a PI."""
    if opts is None:
        opts = DashboardOptions()
    model = await build_dashboard_model(db, pi)
    return render_dashboard_html(model, opts)

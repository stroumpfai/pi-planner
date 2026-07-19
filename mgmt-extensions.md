# Management & Reporting Extensions

Propositions for expanding the outputs the PI Planner can generate — graphics, documents,
interactive/MCP apps, and data feeds — framed against agile (SAFe-style PI planning) and
traditional management practices.

## Where we are today

Current output surface:

- **PI CSV** — flat export of one PI ([`pi_export.py`](backend/app/services/pi_export.py))
- **PI PNG** — matplotlib roadmap or list view of one PI
- **Project JSON** — full, re-importable export
- **Snapshots** — in-app point-in-time copies
- **`summarize_project`** — text summary via the MCP `workflows` tools

### The one constraint that shapes everything

This is a **planning** tool, not an **execution** tracker. The data model gives us
plan-time information — effort estimates, sprint `capacity`, item placement, `item_type`
(story / pbi / bug), PI and sprint dates, and `pi_event` milestones — but **no execution
status**: there is no "done" flag, no actuals, no completed-points column.

The only time-series available is the **snapshot history** and the **activity log**. That
line divides the propositions below into:

- **Derivable today** — needs only existing fields.
- **Derivable from history** — needs the snapshot series or activity log.
- **Needs a new field** — a small, well-scoped schema addition.

Each proposition is tagged accordingly.

---

## A. Visual / graphic outputs

These extend the existing matplotlib PNG engine and the same `GET /api/v1/pis/{id}/export/...`
route pattern, plus matching MCP `export_pi_*` tools.

### A1. Capacity-vs-Load heatmap — *derivable today*

**Need:** The single most important question in PI planning is "did we over-commit any
team in any sprint?" Today that answer is buried in per-sprint capacity bars.

**What it is:** A grid, swimlane (team) on the Y axis × sprint on the X axis. Each cell is
coloured by utilization = placed effort ÷ sprint capacity: green ≤ 85%, amber 85–100%,
red > 100%. Cell text shows `load / capacity`. A right-hand column totals per team; a
bottom row totals per sprint.

**Data:** Sprint `capacity` + summed `effort` of PBIs placed in each (sprint, swimlane).
All present.

**Effort:** Low. Reuses `_capacity_bar_color` logic and the figure scaffolding already in
[`pi_export.py`](backend/app/services/pi_export.py).

### A2. Backlog composition chart — *derivable today*

**Need:** Backlog health and tech-debt ratio — "how much of our committed PI is new value
vs. bug-fixing?"

**What it is:** A stacked horizontal bar per swimlane splitting effort into story / pbi /
bug, plus a summary donut for the whole PI. Optionally a second view splitting
placed vs. unplaced effort.

**Data:** `PBI.item_type` + `effort`. All present.

**Effort:** Low–medium.

### A3. Multi-PI roadmap / Gantt — *derivable today*

**Need:** Stakeholders and traditional PMs want a timeline that spans *several* PIs, not the
single-PI board the tool exports today.

**What it is:** A horizontal timeline (quarters/PIs across the top) with one row per feature
(or per swimlane), bars positioned by the PI's `start_date`/`end_date`. Milestone diamonds
from `pi_event`s. Continuation links (a feature carried into the next PI) drawn as a joined
bar.

**Data:** PI dates, feature→PI placement, `continued_from_feature_id`, PI events. All
present.

**Effort:** Medium — new figure layout, but no new data.

### A4. SAFe Program Board with dependencies — *needs a new field*

**Need:** The canonical SAFe PI-planning artifact: the wall of features with red strings
showing cross-team dependencies.

**What it is:** The existing roadmap board plus arrows connecting dependent features across
swimlanes/sprints, drawn where a feature declares it depends on another.

**Data gap:** There is no dependency link between features today. Requires a small
`feature_dependencies` join (from_feature, to_feature, optional type). Scoped and additive.

**Effort:** Medium — schema + edge routing on the figure.

### A5. Scope burn-up from snapshots — *derivable from history*

**Need:** "How much did the plan grow after we committed?" — scope-creep tracking, a
governance staple.

**What it is:** A line chart over the saved snapshots of a PI: total committed effort, and
optionally count of PBIs, at each snapshot timestamp. A flat line is a stable plan; a
rising line is scope creep.

**Data:** The snapshot series ([`snapshot.py`](backend/app/services/snapshot.py)) holds
each point-in-time. No execution actuals needed — this measures *plan* movement, which is
honestly what a planning tool can report.

**Effort:** Medium — read N snapshots, diff, plot.

---

## B. Document / report outputs

New export formats aimed at the readouts and governance documents management actually
circulates.

### B1. Readiness / data-quality report — *derivable today* — ✅ **implemented**

**Need:** Catch the mistakes that quietly wreck a PI plan before the planning session ends.

**What it is:** A structured report (JSON + rendered Markdown/PDF) flagging:

- PBIs with no effort estimate
- Sprints loaded over capacity (with the overflow amount)
- Features with zero PBIs
- PBIs sitting in a PI but not placed in any sprint
- Orphaned items (PBI whose group/feature link is broken)
- Duplicate or out-of-range `user_id`s

Each finding lists the offending items by `[user_id] title` so they're actionable.

**Why first:** Fully backed by existing data, zero schema change, plugs straight into the
existing export + MCP tool pattern, and it prevents the highest-frequency planning errors.

**Effort:** Low.

### B2. PI Planning readout (1-page PDF) — *derivable today* — ✅ **implemented**

**Need:** The artifact a PO/PM presents at the end of planning day.

**What it is:** A one-pager: PI name and dates, per-team committed load, over-capacity
warnings (from B1), milestone timeline, and PI objectives/description. Essentially a curated
composite of A1 + the milestone strip + text.

**Effort:** Medium — mostly layout; a PDF renderer (matplotlib PDF backend or ReportLab).

### B3. ROAM risk board — *derivable today*

**Need:** SAFe's risk-management ritual (Resolved / Owned / Accepted / Mitigated).

**What it is:** The anomalies from B1 reframed as a risk register — over-capacity sprints and
unestimated scope are the risks, grouped into ROAM columns. A traditional PM variant renders
the same content as a RAG (red/amber/green) status table.

**Effort:** Low once B1 exists — it's a second rendering of the same findings.

### B4. Confluence / Markdown scope document — *derivable today*

**Need:** Teams that live in a wiki want the plan as editable prose, not an image.

**What it is:** A Markdown document: per-swimlane sections, feature tables with PBIs, effort
totals, sprint assignments. Drops into Confluence or a repo.

**Effort:** Low.

---

## C. Interactive / MCP-app outputs

### C1. Live HTML dashboard as an MCP resource — *derivable today*

**Need:** A glanceable, always-current view without exporting a static image each time.

**What it is:** A self-contained HTML page (inline CSS/JS, no external calls) served as an
MCP resource: capacity gauges, the load heatmap (A1), backlog composition (A2), and a
milestone timeline. Regenerated on request from live data.

**Effort:** Medium. Fits the existing MCP `read`/`projects` tool structure.

### C2. What-if capacity planner — *derivable today*

**Need:** "If we move this feature to sprint 3, who blows capacity?" — answered interactively
instead of by re-exporting.

**What it is:** An interactive version of A1 where effort can be reassigned between sprints
and utilization recomputes live. Read-only simulation; committing changes still goes through
the normal edit-lock write path.

**Effort:** Higher — genuine front-end interaction.

### C3. Portfolio rollup across projects — *derivable today*

**Need:** Leadership view across every project/team, not one project at a time.

**What it is:** One board aggregating capacity, load, and milestones across all projects the
user can read.

**Effort:** Medium.

---

## D. Data feeds / integrations (traditional management)

### D1. iCal feed of PI events + sprint boundaries — *derivable today*

**Need:** Milestones and iteration boundaries in everyone's Outlook/Google calendar.

**What it is:** An `.ics` endpoint emitting PI events and sprint start/end dates as calendar
entries.

**Effort:** Low — plain-text iCal generation.

### D2. Jira / Azure DevOps-shaped export — *derivable today*

**Need:** One-way handoff of the committed plan into the execution tool.

**What it is:** CSV/JSON matching a Jira or ADO import schema (issue type, summary, effort,
sprint, epic link). Complements the existing generic CSV.

**Effort:** Medium — mapping the schema.

### D3. Metrics JSON endpoint for BI tools — *derivable today*

**Need:** Power BI / Tableau connection for custom dashboards.

**What it is:** A flat JSON/CSV metrics feed — per (PI, swimlane, sprint): capacity, load,
utilization, item counts by type. A stable analytical shape distinct from the re-import
export.

**Effort:** Low–medium.

---

## E. History-derived analytics

### E1. Plan volatility / churn report — *derivable from history*

**Need:** "How stable was our plan?" — a governance and retrospective input.

**What it is:** A diff across snapshots (and/or the activity log) reporting what moved, was
added, or was cut between two points in time, with a churn score (effort added + removed ÷
committed effort).

**Data:** Snapshot series + [`activity_log`](backend/app/models/activity_log.py).

**Effort:** Medium — snapshot diffing.

---

## Recommended sequencing

1. **B1 — Readiness / data-quality report.** Highest value-to-effort, no schema change,
   prevents the most common planning errors. Unlocks B3 for free.
2. **A1 — Capacity-vs-Load heatmap.** Reuses the existing PNG engine; answers the core
   PI-planning question visually.
3. **C1 — Live HTML dashboard (MCP resource).** Packages A1 + A2 into a glanceable,
   always-current view.
4. Then pick from A3 (multi-PI roadmap), D1 (iCal), or A4 (dependencies, if the team needs
   the full SAFe program board and is willing to add the dependency field).

## Quick reference

| # | Output | Category | Feasibility | Effort |
|---|--------|----------|-------------|--------|
| A1 | Capacity-vs-Load heatmap | Graphic | Today | Low |
| A2 | Backlog composition | Graphic | Today | Low–Med |
| A3 | Multi-PI roadmap / Gantt | Graphic | Today | Med |
| A4 | SAFe program board (dependencies) | Graphic | New field | Med |
| A5 | Scope burn-up | Graphic | History | Med |
| B1 | Readiness / data-quality report | Document | ✅ Done | Low |
| B2 | PI planning readout (PDF) | Document | ✅ Done | Med |
| B3 | ROAM / RAG risk board | Document | Today | Low |
| B4 | Confluence / Markdown doc | Document | Today | Low |
| C1 | Live HTML dashboard (MCP) | Interactive | Today | Med |
| C2 | What-if capacity planner | Interactive | Today | High |
| C3 | Portfolio rollup | Interactive | Today | Med |
| D1 | iCal feed | Feed | Today | Low |
| D2 | Jira / ADO export | Feed | Today | Med |
| D3 | Metrics JSON for BI | Feed | Today | Low–Med |
| E1 | Plan volatility / churn | Analytics | History | Med |

# Handoff: Teams & Capacity (PI Planner)

## Overview
Adds a **Teams** area to PI Planner and connects it to projects: a team holds members, their
working-days patterns, absences and meetings; from those the app **derives** sprint capacity in
person-days (PD) and pushes a converted number into each project's sprint `Available` field.
Nine views plus three dialogs are specified. Source of truth for rules is the user's design brief
(`uploads/teams-design-brief.md`); this bundle is the design contract for the UI.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended
layout, information hierarchy and behaviour. They are **not production code to copy**. The task is
to **recreate these designs in the target codebase's existing environment** — React + Radix UI +
Tailwind CSS + dnd-kit, following that codebase's established component and styling patterns.
Do not port the inline styles, the `.dc.html` wrapper, or the annotation layer.

## Fidelity
**Low-fidelity (lofi) wireframes.** Greyscale, dashed rules, handwritten annotations. Use them for
**structure, hierarchy, states, copy and interaction rules**; apply the codebase's own design system
for colour, type and spacing. The few semantic colours that *are* meaningful:

- amber (`#fef3c7` bg / `#92400e` text) — **stale / warning**: "3 sprints differ", Σ shares > 100%, past-dated version, 412 conflict
- red (`#b91c1c`) — **destructive or blocked**: delete, 409 locked project, over capacity
- blue (`#2563eb`) — **primary action** only
- neutral tint (`#f4f3f0`) — **read-only derived value** (never an input)

Annotations in the handwritten face (Caveat) are **notes to the implementer** and must not be built.

## Reading the design file
`Teams Capacity Wireframes.dc.html` is a pan/zoom canvas of numbered turns, newest first. Each
option has a stable id shown as a badge:

| id | What it is | Status |
|----|-----------|--------|
| **7a** | Landing page — Projects + Teams side by side, both as column tables | final |
| **8a** | Per-view component map: Radix / dnd-kit primitives, Tailwind layout, required states | spec |
| **8b** | The two dnd-kit interactions, spelled out | spec |
| **8c** | Concurrency & write contract (409 / 412 / derivation rules) | spec |
| **9a** | "+ Add member" dialog | final |
| **1a** | Capacity — PD leads, hours secondary, one cell traced open | final |
| **1b** | Absences — year minimap over a 4-month half-day grid | final |
| **1c** | Working days — as-of date, per-member version timeline | final |
| **1d** | Update project(s) — preview → apply → per-project result | final |
| **1f** | Members table + Projects (shares) tab | final |
| **1g** | Meetings — member × meeting matrix | final |
| **2a** | The minimap explored on its own (already folded into 1b) | reference |
| **3a / 4a / 4b** | Add/edit absence dialog — Range / Weekly / Interval kinds | final |

**Read 8a, 8b and 8c first** — they are the normative spec cards; the drawings illustrate them.

## Domain model (from the brief)

### Team
`name`, ordered `members`, `normal_day_hours` (default **8**), served projects with a share %.

### Member
`name`, `role` (PO · Dev · Test · UX · SW-Arch), `org_unit` (BIT · Dev · ASTRA),
`valid_from`, `valid_to` (nullable = open). **No h/day or focus on the member** — those live on
working-days versions.

### WorkingDaysVersion (per member, dated, never edited in place)
`effective_from` (+ implicit open end), `half_days`: 7 weekdays × {am, pm} booleans,
`hours_per_day`, `focus_factor` (0 < f ≤ 1). Editing = **creating a new version** with a date;
earlier versions stay untouched. A member with **no version in effect** on the viewed date shows
"—", not 0.

### Absence
`label` (optional, ≤ 100 chars — never interpreted by the maths), `kind` ∈ {`range`, `weekly`},
`start_date` + `start_half` ∈ {am, pm}, `end_date` + `end_half` (**inclusive**),
`weekday` 0–6 (weekly only), `halves` ⊆ {am, pm} (weekly only), `interval_weeks` ≥ 1 (default 1),
`modified_at` (**concurrency token**). There is **no absence category**.
The UI splits `kind` into **three tabs** — Range, Weekly, Interval — where Interval is
`weekly` with `interval_weeks ≥ 2`; that is a UI affordance only, not a third stored kind.

### Meeting
`name`, `duration_minutes` (5 min – 8 h), the same three scheduling kinds as absences,
and an **attendee set** (subset of members).

## The capacity chain (normative — 8c and the traced cell in 1a)
Capacity is **never stored**. Per member, per sprint:

1. contracted **half-days** in the sprint window, from the working-days version(s) in effect
2. **− absences** (half-day resolution)
3. **= Present** (half-days, and half-days × hours_per_day / 2 = present hours)
4. **− meetings** the member attends that fall inside the sprint (minutes → hours)
5. **× focus_factor**
6. **÷ 8** — the team's `normal_day_hours`, **never the member's hours_per_day** → **PD**
7. **× project share % × conversion factor** → the project's unit (pts / days)

Worked example as drawn in 1a (Marta, Sprint 7.5, 10 working days):
`20 ½d = 80.0 h → −2 ½d absence = 18 ½d / 72.0 h Present → −4.5 h meetings = 67.5 h
→ × 0.8 focus = 54.0 h → ÷ 8 = 6.8 PD → × 70% × 1.5 = 7 pts`

Rules that fall out and must hold everywhere:
- **PD is the primary figure; hours are secondary** (smaller, muted) in every cell and total.
- A sprint **missing start or end date** renders every derived value as **"—", never 0** (Capacity and Meetings alike).
- A member **outside `valid_from`/`valid_to`** renders "—" with a reason ("joins 1 Oct"), and contributes nothing to team totals.
- **Presence ≠ capacity.** The cell footer shows presence (e.g. "9 d present · 6.8 PD"); the big number is capacity.
- A meeting **dated outside the selected sprint** keeps its column, greys its cells, contributes 0.
- Sprint `Available` changes **only** on an explicit "Update project(s)" push.
- Editing a working-days version dated in the **past** recomputes **open PIs only**; closed PIs keep their pushed numbers.

## Concurrency (8c)
- **412 — absence changed under you.** Send `modified_at` with every absence write. On 412: roll the optimistic cell back, then show the inline **yours / theirs** banner with **Keep theirs** / **Reapply mine**. Never a spinner, never a silent refetch.
- **409 — project locked.** Only on "Update project(s)". **Per project, non-atomic**: render one result row per project; successes stay successful; the locked row offers **Retry this one**.
- **Team edits take no lock.** There is deliberately **no "Request Edit Mode"** anywhere in the Teams area — locks belong to projects.

## Screens / Views

### 1 · Landing page (7a)
**Purpose** — see projects and teams one glance apart, and spot staleness.
**Layout** — app header (home · PI Planner breadcrumb · gear / user / sign out), then two columns
on a wide viewport (`flex-row`, Projects `flex:1.45`, Teams `flex:1`), stacking on narrow.
Each list is a card with a uppercase 10.5px column header row.

*Projects table* — `grid-cols-[1.5fr_110px_150px_92px]`: **Project** (name + description),
**Source** (Azure DevOps ↗ link), **Team** (team · share %, then the staleness badge or "in sync" /
"never pushed"), **Actions** (edit · export · snapshots · delete as icon buttons with tooltips).
Header actions: *Import*, *+ New Project*.

*Teams table* — `grid-cols-[1.1fr_74px_1.3fr_64px]`: **Team**, **Members** (count), **Serves**
(one line per project with share, staleness badge inline, and `Σ 120% — over-allocated` in amber
when shares exceed 100), **Actions** (edit · delete). Header action: *+ New Team*.

**States** — loading: 3 skeleton rows per list · empty per list (Teams: "No teams yet. A team lets
you compute sprint capacity from who is available.") · **reader**: Actions column and both
`+ New` buttons removed, badges stay (staleness is information, not an action) · a project with no
team shows "no team" and "—" for source.

### 2 · Team shell (all team views)
Left rail 172px: "◄ All teams", team name + member count, then six items —
**Members · Working days · Absences · Meetings · Capacity · Projects**. App header above it.
No edit-mode button.

### 3 · Members (1f)
Table `grid-cols-[22px_1.3fr_.7fr_.6fr_1.1fr_.8fr_.7fr_30px]`: drag grip, Name, Role, Org,
Valid (from → to), **h/day**, **focus**, ⋯ menu. h/day and focus are **read-only tinted chips with
the date they took effect** ("8.0 h  since 1 Sep") — clicking one navigates to Working days, it never
edits in place. Row order is user-set (dnd-kit). Empty state: "no members yet — capacity will read 0
until someone is added" + *Add the first member*.

### 4 · Add member dialog (9a)
`sm:max-w-xl`. Identity row: Name · Role (select) · Org unit (select). Validity row: **On the team
from** · **Until** (optional, "open — still on the team"). Then a divided block titled
**First working-days version**, "effective 1 Oct 2026 — same as *from*": the 7 × 2 am/pm circle
toggle group, **Hours / day** (step 0.5), **Focus** (step 0.05), and preset chips
*Full week* · *80% — Fri off* · *Copy from…*. Summary line shows half-days/week, h, focus and the
effective hours. One POST creates **member + first version dated `valid_from`** — never a
versionless member. Validation: name required, until ≥ from, ≥ 1 working half-day, 0 < focus ≤ 1,
duplicate person on the same team rejected inline.

### 5 · Working days (1c)
Header: **Pattern in effect on `<date>`** — one date picker that governs the whole view.
Per member row: 7 weekday columns × two am/pm circles, h/day, focus, and a *Change from…* button;
beneath each row a **version timeline** — one dot per version with its label
("2 versions — 1 Jan (60%) · 1 Sep (80%) ← showing v2"). Editing opens a dialog titled
"editing version N of M" with an effective-from date; a **past date** shows the amber warning that
closed PIs will not be recomputed. A member with no version in effect: circles disabled, "—" in
h/day and focus.

### 6 · Absences (1b)
**Minimap** (top): 12 monthly density bars for the year, 82px per month, with a **draggable window**
frame marking the 4 months shown below, a "jump to <month> <year>" dotted link in the left label
column, and month abbreviations (Jan…Dec). Clicking a bar or dragging the frame moves the grid.

**Grid**: rows = members (140px label column), columns = **half-days at 8px per day**
(two 3px cells + gaps), four months wide. Cell vocabulary — filled = absence · hatched = recurring ·
light tint = not a working half-day · grey = weekend · diagonal hatch = not yet on team.
A half-day absence literally fills half a cell.

**Selected entry bar** (below the grid): clicking a run selects it as one entry and shows
"name · dates · halves · duration · label · kind" with a **pencil and a bin side by side** —
delete is its own action, never buried in the edit dialog; the Delete key does the same.
Recurring entries confirm **this occurrence / whole series**.

**412 banner**: "this absence changed under you", yours vs theirs, *Keep theirs* / *Reapply mine*.

### 7 · Add / edit absence dialog (3a · 4a · 4b)
`sm:max-w-2xl` (a deliberate exception to the app's `max-w-md` — the member column earns it).
Left column 186px: **Who** — member checklist with an *all N* shortcut (this is the team-wide-holiday
flow). Right column: **Label** (optional), **Kind** tabs *Range | Weekly | Interval*, then the
fields for the active kind, a plain-language summary line, Cancel / Save.

- **Range (3a)** — From (date + am/pm) · To (date + am/pm, inclusive). Summary: "25 Dec, both halves, 6 members · 12 half-days removed from capacity".
- **Weekly (4a)** — Weekday · Halves (am / pm / both) · Runs from · Until (empty = open-ended). Summary counts occurrences.
- **Interval (4b)** — **Every N wks** (stepper, ≥ 1) · Weekday · Halves · **First occurrence** (this is the *anchor* — it decides which alternate weeks are hit, so it is labelled that way, not "runs from") · Until (optional) · **occurrence chips** ("4 Sep · 18 Sep · 2 Oct · 16 Oct · 30 Oct · every 2nd Friday, ongoing") as the check against an off-by-one week.

Editing a recurring entry asks **This occurrence / The whole series**.

### 8 · Meetings (1g)
A **member × meeting matrix** — no timeline. Columns are meetings
(`grid-cols-[150px_repeat(N,132px)_96px_200px]`); each head shows name, duration, schedule text,
a kind chip, and **pencil + bin icons**. Adding a meeting **adds a column** and opens the same
dialog as absences (Range / Weekly / Interval) plus duration and the attendee checklist. Cells are
attendance toggles. Last two columns: a dashed **"+ new meeting = new column"** head, and
**Meeting load** — whose head carries the **sprint selector** (`Sprint 7.5 ▾` with ◄ ► steppers and
"20 Apr – 1 May 2026 · from ISK") because it is the only sprint-dependent column. Sprint options come
from the **first project the team serves**. Bottom row: **Attending** counts per meeting.
Undated sprint → the load column and total read "—" while attendance stays intact.

### 9 · Capacity (1a)
Toolbar: project view select ("ISK (70%)"), unit and conversion factor, sprint pager.
Grid `grid-cols-[170px_repeat(6,1fr)]`: rows = members, columns = sprints labelled
**PI.sprint** (Sprint 7.4, 7.5, 8.1 …). Each cell: **PD large**, hours beneath, and a
dotted-rule footer with **presence** ("9 d present · 6.8 PD"). Below: a **Team** total row
(2px rule), then a project row "ISK 70% → pts" showing PD and converted points.
Any cell **expands (Collapsible)** into the full traced chain in the exact order of the capacity
chain above — this is the view's whole purpose.

### 10 · Projects tab (1f)
Per served project: share % (input), conversion factor, staleness badge. A **Σ > 100% amber
warning** that is non-blocking ("You can still save; the numbers will be optimistic"), the total row,
and *+ Assign project* / **Update project(s)**.

### 11 · Update project(s) (1d)
**Step 1 — review**: project checkboxes, then a table
`grid-cols-[1.1fr_.8fr_.9fr_.6fr_1.3fr]` — sprint · Current · **Proposed** · Δ · "behind it"
(the PD and hours that produced it). *Proposed is the whole number that will be written* —
**rounding happens in view, not silently on apply**. Primary: "Apply to N projects".
**Step 2 — result**, per project and **not atomic**: ✓ updated / ✓ no change /
✗ **locked by <user> until <time>** + *Retry this one*.

## Interactions & Behavior (8b)

### Drag-to-create in the absence grid — bespoke, not Sortable
- unit: one half-day cell = `{ memberId, date, half }`; 8px per day (two 3px cells), 15px tall
- sensors: PointerSensor (activation distance 4px) + KeyboardSensor for the accessible path
- drag: pointer-down anchors; move extends a **rectangular** range over dates × member rows; a drag overlay chip shows the live count ("12 half-days")
- drop: **opens the Add-absence dialog pre-filled from the range** — never writes silently
- invalid cells (non-working halves, not-yet-on-team) are **skipped, not blocking**: the range clips
- keyboard: arrows move focus, Space anchors, Shift+arrows extend, Enter opens the dialog, Delete = the bin action (same confirm)
- CSS: `touch-none select-none` on the grid; the minimap window is a separate draggable using the same sensor

### Sortable reordering
- **Members**: vertical strategy, handle is the ⠿ grip only; order persists per team
- **Meetings**: horizontal strategy on column heads; order is the team's, not chronological
- both inside `DndContext` with screen-reader announcements, and a ⋯ menu offering **Move up / Move down** as the non-drag equivalent

### Other
- optimistic cell/toggle updates with rollback on 409 / 412
- every destructive action goes through an AlertDialog; delete affordances are **visible buttons**, context menus only as a secondary path
- loading: skeleton rows matching the grid template; never a full-page spinner on a tab switch

## State Management
Per team view: `teamId`, `asOfDate` (Working days), `windowStartMonth` + `selectedEntryId` +
`dragRange` (Absences), `selectedSprintId` (Meetings — defaults to the current sprint of the first
served project), `projectView` + `sprintPage` + `expandedCellId` (Capacity), dialog open/kind/draft
state, and `pushPreview` + per-project `pushResults` (Update project(s)).
Server data: team, members, working-days versions, absences, meetings, served projects, sprints of
the served projects. All capacity figures are **computed client-side or by a dedicated endpoint —
never persisted**; `modified_at` travels with every absence.

## Design Tokens
The wireframes deliberately carry **no brand palette** — use the codebase's tokens. Values used
semantically here, to be mapped onto existing ones:

| Purpose | Wireframe value |
|---|---|
| warning / stale bg · text | `#fef3c7` · `#92400e` |
| destructive / blocked | `#b91c1c` |
| primary action | `#2563eb` |
| read-only derived chip | `#f4f3f0` |
| hairline / row rule | `#e6e4df`, dashed `#eceae6` |
| emphasis rule (totals) | 2px `#2b2b2b` |
| radius | 6px controls · 8–10px cards |
| type scale | 10.5px column header (uppercase, .04em) · 11–12px meta · 13px body · 16–19px headings |
| grid unit | absences 8px per day (2 × 3px + gaps); meeting column 132px |

Typography in the file (Kalam / Caveat) is **wireframe styling only** — do not reproduce it.

## Assets
None. Icons are inline SVG placeholders (pencil, bin) and text glyphs (↧ export, ◫ snapshots,
◄ ► steppers, ⠿ grip, ⋯ menu) — replace with the codebase's icon set.

## Files
- `Teams Capacity Wireframes.dc.html` — **the design canvas** (all turns and options; read in full)
- `Teams Capacity Wireframes - Review.dc.html` — the same views laid out as 11 printable pages in left-nav order, for review/PDF
- `support.js`, `doc-page.js` — runtime for the two HTML files (open the HTML directly in a browser; nothing to port)
- `teams-design-brief.md` — the user's original brief and rules (source of truth for the maths)

## Known scope notes
- The sprint-header treatment inside a project (Available 🔒, "team moved since", over-capacity red bar) was sketched and then removed from the canvas — confirm with the designer before building it.
- `Testing` is the example project with **no team**; `Frontline` is the example team with **no project yet**. Both are intentional empty-relationship cases.

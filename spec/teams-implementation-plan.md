# Teams & Capacity — Implementation Plan

**Reads:** [`spec/teams.md`](teams.md) (the specification — always wins),
[`spec/teams-design-brief.md`](teams-design-brief.md) (screens and states),
`design/teams/design_handoff_teams_capacity/` (wireframes; see
[`design-corrections.md`](../design/teams/design-corrections.md) for the eight places the bundle
still contradicts the spec).

Seven steps, each independently releasable. Every step ends with `scripts/check.sh` green and the
app shippable.

---

## Changes to the proposed sequence, and why

The six steps as proposed leave two of the six team views unbuilt and put the first useful number at
the very end. Three adjustments:

**1. Working days folds into the Members step (step 3).** They cannot ship apart. Members shows
`h/day` and `focus` as **read-only** values whose only editor is the Working days view (§7.2), so
Members alone ships a dead link — and a member's pattern, created with them at Add-member, could
never afterwards be changed.

**2. Capacity gets its own step, at 4 rather than last.** It is the payoff view, and it needs
nothing but patterns: contracted half-days → focus → PD. Placed here, it turns every later step into
a visible improvement — absences make the number drop, meetings make it drop again — instead of five
releases that show no number at all.

**3. Project *assignment* moves up to step 4; only the *push* stays last.** Capacity cannot be
displayed without it: the sprint calendar comes from the team's anchor project (§7.0.1), as do
`share_pct` and `units_per_pd`. Assignment is a small join table. The push — preview, apply,
per-project results, staleness, the sprint header — is the genuinely hard part and stays at the end,
where it is also the only step that writes into project data.

| # | Step | Ships |
|---|------|-------|
| 1 | Foundations | nothing user-visible; everything after it is unblocked |
| 2 | Landing page + team list | create, rename, delete a team |
| 3 | Members + Working days | staff a team; dated contracts |
| 4 | Project assignment + Capacity view | **the first real number** |
| 5 | Absences | the number drops for holidays |
| 6 | Meetings | the number drops for meetings |
| 7 | Push + staleness + sprint header | the number reaches the board |

Steps 2 and 3 may ship together if an empty Teams section is not worth a release on its own.

---

## What every sub-agent needs, whatever they are assigned

Assume no prior context beyond this file and the spec.

**Definition of done:** `scripts/check.sh` passes (~95s — ruff, mypy `--strict`, the OpenAPI
contract check, ESLint, `tsc`, all three suites). `--with-e2e` adds Cypress. The pre-push hook and
CI run the same script.

**After any route signature or schema change:** run `scripts/openapi.sh` to rewrite both
`frontend/openapi.json` and `frontend/src/types/api.generated.ts`. Skipping it leaves the frontend
typed against an API that no longer exists, and `scripts/check.sh` fails on `--check`.

**Backend rules.** Type hints everywhere; Pydantic v2; async SQLAlchemy; `selectinload` for
relationships. Every route carries an RBAC guard — `get_current_user`, `require_editor_or_above`, or
`require_admin`. **Team routes must NOT use `require_edit_lock`** (§4.1): they live under
`/api/v1/teams/…`, carry no project path param, and are therefore outside the lock by construction.
Only the push endpoints (which carry `project_id`) are guarded by it. Never edit an existing Alembic
migration — always add a new one.

**Frontend rules.** Strict TypeScript, **no `any`**, named exports, `interface Props` per component.
Server state in React Query, UI state in Zustand — never duplicate server state into a store.
Components in `src/components/`, hooks in `src/hooks/`, typed API clients in `src/services/` (one
file per resource).

**Visual language** — neumorphic soft-UI, not flat. Canvas `#f0f4f8` / dark `#1e2432`; band
`#e4eaf1` / `#171c28`; `shadow-soft`, `shadow-soft-sm`, `shadow-soft-inset` (wells, tracks, inputs),
`shadow-soft-hover`; `rounded-xl`; brand blue `#3b82f6`/`#2563eb` for primary buttons only. Both
themes required. Reuse `CapacityBar`, the Radix dialog pattern, and the list-card pattern
(`bg-canvas shadow-soft rounded-xl`, rows `divide-white/60`, hover `bg-band/40`).

**Cypress rules.** There is **no URL routing** — never assert on the URL; navigate by clicking.
`isEditing` is client-side, so use `cy.enterEditMode()`, not an API acquire. Match action labels
with anchored regexes (`/^Delete$/`) and scope modal actions with `cy.get('[role="dialog"]')`.
Projects and teams now share the landing page, so **scope selectors to their section** —
`cy.contains('Alpha')` can match either. Never point Cypress at a dev server; `scripts/e2e.sh`
builds a throwaway backend on :8901.

**Sequencing inside a step.** Each step begins with a blocking **contract task** — Pydantic schemas
plus `scripts/openapi.sh` — merged before anything else starts. After that the work packages are
independent and can run in parallel.

---

## Step 1 — Foundations

Nothing user-visible. Everything else depends on it, so it is the one step with no parallel
alternative.

### 1.0 · `capacity` → `available` rename (own PR, land first)

A pure column rename, no type change, no data conversion. Touches: the `sprints` table (migration),
`SprintCreate` / `SprintUpdate` / `SprintResponse`, `PIResponse.total_capacity` → `total_available`,
the sprint header and capacity bar, PNG/CSV/dashboard/report exports, snapshot write **and
restore**, MCP `update_sprint` and `set_sprint_capacities`, `scripts/openapi.sh`, and the Cypress
specs that select the sprint header by accessible name.

Two things that are easy to miss:

- **Snapshots keep the old key forever.** `services/snapshot.py` stores JSON; every snapshot taken
  before this rename carries `capacity`. Restore must read `available` and **fall back to
  `capacity`, permanently**. Add a test that restores a fixture snapshot using the old key.
- **`gt=0` becomes `ge=0`.** Available may legitimately be 0 (§6.2). Zero is already reachable today
  via `snapshot.py:46` (`capacity=s.get("capacity") or 0`) while the API refuses to set it, so this
  closes an existing inconsistency.

Also fix, while here: `CapacityBar` renders `12/0 pts · 0%` in **gray** when `used > 0` and
`available = 0`. It must read as over-capacity **red**.

MCP: accept `capacity` as a **deprecated alias** of `available` for one release, noted in the tool
description. An unrecognised parameter would fail agent calls that worked yesterday.

### 1.1 · Schema and migration

One migration adding: `teams`, `team_members`, `member_pattern_versions`, `absences`, `meetings`,
`meeting_attendees`, `team_projects`. Fields per §3.1–§3.5 and §6.3. Every team-owned table carries
`modified_at`. Index every FK; unique `(team_id, lower(name))` on members and `(member_id,
effective_from)` on versions.

### 1.2 · Concurrency plumbing

`ETag` on team reads; `If-Match` required on team `PATCH`/`DELETE`; mismatch → **412** with the
current row in the body (§4.2). One FastAPI dependency, used by every team route from here on. **412
is not 409** — 409 means *someone else holds the project lock, wait*; 412 means *this row changed
under you, here it is*. `mcp_server/backend.py:_raise_for_error` classifies 409/403/422/5xx and
falls through to `raise_for_status()`, so add a **412 → `STALE`** branch or agents get a raw httpx
error.

### 1.3 · Capacity engine skeleton

`backend/app/services/team_capacity.py`. Implements §5.4 with the pieces that exist: half-day set
from pattern versions resolved **per half-day**, membership validity, `focus`, `÷ normal_day_hours`.
Absence and meeting subtraction are stubs with the seams in place — steps 5 and 6 fill them.

Pure functions over plain data, no DB access in the maths, so it is unit-testable without fixtures.

**Get these right now; they are expensive to retrofit:** PD is `net_hours ÷ normal_day_hours`
(default 8.0) and **never** the member's own `hours_per_day`. The earliest pattern version extends
**backwards without limit**. Half-open version intervals, derived — there is no `effective_to`.
Round only at the push boundary, never intermediates.

### 1.4 · App shell

`activeTeamId` in `uiStore`, with `setActiveTeam` clearing `activeProjectId` exactly as
`setActiveProject` clears `activePIId` — the two are mutually exclusive. `App.tsx:90`'s two-way
branch becomes three-way. **`EditLockButton` must not render in team views** (it is gated on
`activeProjectId` at `App.tsx:65`; do not loosen that to "any active thing"). SSE subscribes to the
team channel while a team is active.

**Tests:** unit tests for the engine covering a full sprint, a part-timer, a mid-sprint version
change, a member outside their validity window, and PD ≠ hours ÷ 8 for a 6 h/day member. Integration
tests for 412 on a stale `If-Match`. Migration test. Snapshot round-trip with the legacy `capacity`
key.

**Done when:** the rename is invisible to users, `scripts/check.sh --with-e2e` is green, and the
engine returns correct PD for a hand-computed fixture.

---

## Step 2 — Landing page and team list

**Ships:** a Teams section on the home page; create, rename, delete a team.

**Contract first:** `GET/POST /api/v1/teams`, `GET/PATCH/DELETE /api/v1/teams/{team_id}`. Guards:
read for any authenticated user, `require_editor_or_above` for writes. Deleting a team that is
assigned to projects is **blocked** (§10) — 409 with the project list.

### Parallel work packages

**WP-2A · Backend** — `models/team.py`, `schemas/team.py`, `routes/teams.py`, registered in
`main.py`'s router loop. SSE `team:updated`. Integration tests: CRUD, 412 on stale `If-Match`, 403
for a reader, name uniqueness.

**WP-2B · Frontend** — `ProjectListPage` becomes a home page with **Projects** and **Teams**
sections. Projects rows gain a **Team column** (team · share, staleness badge, or "no team"). Teams
rows: name, member count, projects served. `CreateTeamModal`, `EditTeamModal`, `useTeams` hook,
`services/teams.ts`. Empty state: *"No teams yet — a team lets you compute sprint capacity from who
is available."* Reader state: no create/edit affordances, badges stay.

**WP-2C · MCP** — `read.py` gains `list_teams`, `get_team`. New `mcp_server/tools/teams.py`
(`teams_mcp`) with `create_team`, `update_team`, mounted in `server.py`. **No `edit_lock()`
wrapper** — team writes take no lock. **No `delete_team`** — containers are not deletable by agents
(§8.2.6).

**WP-2D · E2E** — `frontend/cypress/e2e/teams.cy.ts`: create a team from the home page, rename it,
delete it, see the empty state. Add `cy.openTeam(name)` to `cypress/support/commands.ts`. Scope
every selector to the Teams section.

**Done when:** a team can be created and deleted from the UI and from MCP, and the home page shows
both lists with correct empty and reader states.

---

## Step 3 — Members and Working days

**Ships:** staffing a team, with dated contracts.

**Contract first:** members CRUD; `GET/POST
/api/v1/teams/{team_id}/members/{member_id}/working-days` and `PATCH/DELETE
…/working-days/{version_id}`. `POST /members` creates **member + first pattern version in one
transaction** (§3.3) — a versionless member computes as zero capacity and reads as a bug.

### Parallel work packages

**WP-3A · Backend members** — model, schemas, routes, reorder endpoint. `role` and `organisation`
are **optional free text, max 50** — no enum, no vocabulary table. Deleting a member cascades to
absences, attendance and versions; the confirm payload states the counts.

**WP-3B · Backend pattern versions** — half-open intervals **derived** from `effective_from`; no
`effective_to` column. The earliest version extends backwards without limit. Adding a version on an
existing date **edits** it. Deleting merges into the preceding version; the **earliest cannot be
deleted**. `hours_per_day` (1.0–12.0) and `focus` (0.1–1.0, step 0.05) both live here, not on the
member.

**WP-3C · Frontend Members view** — table: grip, name, role, organisation, validity, and `h/day` +
`focus` as **read-only tinted chips with the date they took effect** ("8.0 h · since 1 Sep").
Clicking one **navigates to Working days**; it never edits in place. Role and organisation are
**free-text comboboxes** suggesting values already used in the team — not selects. dnd-kit
`SortableContext`, vertical, grip-only handle, plus a ⋯ menu with Move up / Move down as the
non-drag path.

**WP-3D · Frontend Working days view** — 7 × 2 am/pm toggles per member, plus that version's day
length and focus. A single **"Pattern in effect on ‹date›"** picker governs the whole view. Per-row
**version timeline** (a marker per `effective_from`) and a **"Change from…"** action opening a new
version pre-filled from the current one. A past date shows the amber warning that **closed PIs will
not be recomputed**. There is no "no version in effect" state — it is unreachable.

**WP-3E · Add-member dialog** — identity, validity, and the first working-days version in one form,
`effective_from` defaulting to `active_from`. Presets: *Full week*, *80% — Fri off*, *Copy from…*.

**WP-3F · MCP** — `list_members` (read); `create_member`, `update_member`, `add_pattern_version`
(write). Members are addressed **by name**: add `resolve_member_id(team_id, name)` mirroring
`resolve_state_id` in `states.py` — unknown names are rejected with the list of members that exist,
never created implicitly. No `delete_member`.

**WP-3G · Tests** — unit: version resolution at, before, between and after `effective_from`;
delete-merges-interval; earliest-not-deletable. E2E: add a member, change their pattern from a date,
confirm the as-of picker shows the old pattern for an earlier date.

**Done when:** a member added through the UI has a pattern version, the as-of date changes what the
grid shows, and a second version does not alter figures before its date.

---

## Step 4 — Project assignment and the Capacity view

**Ships:** the first real number.

**Contract first:** `GET/POST /api/v1/teams/{team_id}/projects`, `PATCH/DELETE
…/projects/{project_id}` (carrying `share_pct` 1–100, `available_source` ∈ {`manual`, `factor`},
`units_per_pd` > 0), and `GET /api/v1/teams/{team_id}/capacity?from=&to=`.

### Parallel work packages

**WP-4A · Backend assignment** — join table, cardinality (a project has **at most one** team; a team
serves many). Shares summing over 100% **warn, never block** (§6.3). The **first project assigned is
the anchor** whose sprint calendar the team uses (§6.8); sprint-date alignment enforcement can wait
for step 7 but the anchor concept is needed here.

**WP-4B · Backend capacity endpoint** — per member, per sprint, over a date range. Returns hours,
PD, presence, and the per-step breakdown that the expandable cell renders. Sprints without **both**
dates return `null`, rendered `—`, never `0`.

**WP-4C · Frontend Capacity view** — 6 sprint columns, paging left/right. Each cell **leads with
PD**, hours beneath, and a presence footer (`9 d present · 6.8 PD`). Rows are members; then a Team
total row; then a project row (`ISK 70% → pts`). **Every cell expands** into the traced chain in
§5.4's order — contracted half-days → absences → meetings → present → focus → ÷ 8 → share × factor.
This is the view's whole purpose; the collapsed cell is the summary, not the feature.

**WP-4D · Frontend Projects tab** — served projects with share %, conversion, staleness slot (filled
in step 7). Amber Σ > 100% warning that still saves. `+ Assign project`.

**WP-4E · Sprint labels and window** — shared helper: `{PI name}.{n}`, *n* **1-based** over stored
indices 0–4, truncating on the PI part and never on the sprint number. Used by Capacity now and
Meetings in step 6.

**WP-4F · MCP** — `get_team_capacity`, `preview_team_capacity` (both **read** tools, so "what would
this do" needs no write capability); `assign_project`, `update_assignment`.

**WP-4G · Tests** — integration: capacity across a version boundary; undated sprint returns null;
share applied; factor applied; rounding half-up (`Decimal.quantize(ROUND_HALF_UP)`, **not** Python's
banker's `round()`). E2E: assign a project, read a non-zero PD figure, expand a cell.

**Done when:** a team with members and one project shows correct PD and hours per sprint, and an
expanded cell reconciles line by line.

---

## Step 5 — Absences

**Ships:** the number drops for holidays.

**Contract first:** `GET/POST /api/v1/teams/{team_id}/absences`, `PATCH/DELETE …/{absence_id}`.
`POST` accepts a **`member_ids` array** and creates one record per member in one transaction — this
is the public-holiday flow.

### Parallel work packages

**WP-5A · Backend model and occurrences** — three kinds: `range`, `weekly`, `interval` (§3.4).
`interval_weeks` is **2–52** and belongs to `interval` only. Recurring kinds take an **optional
`end_date`** (open-ended). Occurrences are **anchored on `start_date`, never ISO week parity** —
parity breaks at the year boundary where week 52 can be followed by week 1. Generate occurrences
only inside the requested window. **No per-occurrence exceptions:** edits and deletes act on the
whole series.

**WP-5B · Capacity engine** — fill the absence stub: drop covered half-days, **union not sum** for
overlaps. An absence on a non-working half-day is allowed and has **no effect** — no warning.

**WP-5C · Frontend grid** — 4 months visible, rows = members, columns = half-days. Above it a
**12-month minimap** that is both density indicator and navigation: bars mark months holding
entries, a **draggable frame** shows which 4 months are below. Plus a month/year jump. Cell
vocabulary: filled = absence, hatched = recurring, tint = non-working, grey = weekend, diagonal =
not yet on team. A half-day absence fills literally half a cell.

**WP-5D · Drag-to-create** — bespoke dnd-kit, not Sortable. Unit is `{memberId, date, half}`;
PointerSensor at 4px; a rectangular range over dates × member rows; a live count chip ("12
half-days"); drop **opens the pre-filled dialog and never writes silently**. Invalid cells **clip,
not block**. Full keyboard path: arrows move, Space anchors, Shift+arrows extend, Enter opens,
Delete removes. `touch-none select-none` on the grid.

**WP-5E · Add/edit dialog** — `sm:max-w-2xl` (the documented exception to `max-w-md`; the member
column earns it). Member checklist left with an **"all N"** shortcut; kind tabs right. For
`interval`, label the anchor **"First occurrence"**, not "runs from", and show the next few
occurrence dates as chips — an off-by-one week is invisible in the rule and obvious in the dates.

**WP-5F · 412 banner** — yours/theirs with *Keep theirs* / *Reapply mine*. Roll the optimistic cell
back first. Never a spinner, never a silent refetch.

**WP-5G · MCP** — `list_absences`, `create_absence`, `update_absence`, `delete_absence`, plus
**`bulk_create_absences`** and `preview_bulk_absences`. Bulk is the real import path: the source is
a Confluence page read by an LLM, so bulk writes take a **date window and replace** within it —
replacement is the only rule that survives an entry being deleted from the page. Report **all**
unresolved member names at once, not the first.

**WP-5H · Tests** — unit: occurrence generation for all three kinds, across a year boundary, with
and without `end_date`; overlap union. E2E: drag-create, team-wide holiday via "all N", capacity
drops by the expected amount.

**Done when:** adding a holiday for the whole team visibly reduces the capacity figures from step 4.

---

## Step 6 — Meetings

**Ships:** the number drops for meetings.

**Contract first:** `GET/POST /api/v1/teams/{team_id}/meetings`, `PATCH/DELETE …/{meeting_id}`. A
meeting carries the **same schedule rule as an absence**, plus `half`, `duration_minutes` (**5–480,
steps of 5**) and attendees.

### Parallel work packages

**WP-6A · Backend model** — reuse the step-5 occurrence generator; a single meeting is a one-day
`range`. A recurring meeting is **one row, not one per occurrence** — hence the limit of 100 meeting
*definitions* per team against 2000 absences.

**WP-6B · Capacity engine — the clamp** — this is the subtle one. Meetings are deducted **per day,
not per half-day**: a meeting consumes from the half it **starts** in, then **spills into the other
half of the same day**, and the day's total is **clamped to the hours remaining after absences**.
Two cases decided by this: an 8 h workshop for a 6 h/day member costs their whole day and stops
(capacity 0, never negative); and a full-day meeting clamped per half would charge only half its
length. A meeting starting on an absent half costs nothing — the spill reaches only surviving hours.
**Meetings subtract before focus.**

**WP-6C · Frontend matrix** — rows are members, columns are meetings, cells are attendance. **Not a
timeline**: a 15-minute stand-up and an 8-hour workshop are two columns rather than two unreadable
bars. Column heads carry title, duration and the schedule in words. A trailing **Meeting load**
column whose head holds a **sprint selector** drawn from the anchor project's calendar (§7.0.1) —
the matrix has no time axis, so the total needs a window the grid cannot imply. Footer row per
meeting: attendee count and person-hours. Header toggles select a whole row or column.

**WP-6D · MCP** — `list_meetings`, `create_meeting`, `update_meeting`, `delete_meeting`,
`bulk_create_meetings`.

**WP-6E · Tests** — unit: the clamp, in all four cases above. Integration: attendance toggles change
capacity. E2E: add a meeting, tick the team, watch the load column and capacity move.

**Done when:** an 8 h workshop assigned to a 6 h/day member zeroes that day and never goes negative.

---

## Step 7 — Push, staleness, and the sprint header

**Ships:** the number reaches the board. The only step that writes project data.

**Contract first:** `GET /api/v1/projects/{project_id}/team-capacity/preview`, `POST …/apply`, and
`POST /api/v1/teams/{team_id}/push`. The two project-scoped routes carry `project_id`, so they
inherit the **existing** `require_edit_lock` and its 409 body with no new code — no acquire, no
release, no heartbeat.

### Parallel work packages

**WP-7A · Backend push** — writes **only** `sprints.available`, only for `draft`/`in_progress` PIs.
**Idempotent**: applying twice with nothing changed writes nothing. `manual` projects return 409
`AVAILABLE_SOURCE_IS_MANUAL`. Rounding happens **here, once, half-up**, per sprint independently —
so `total_available` is the sum of stored integers, not the rounded sum of floats.

**WP-7B · Multi-project push** — **per project, not atomic**. One result row each; a project locked
by another editor fails alone while the others apply. Failing all three because someone is editing
one would reintroduce exactly the coupling this design removes.

**WP-7C · Staleness** — compare **values, not an input hash**: recompute what the push would write
(the rounded integer) and diff it. A hash would flag an absence added and removed again, and a badge
people learn to ignore is worse than none. Surfaces on the PI board header and the home page project
row.

**WP-7D · Derived-Available guard** — `PATCH /sprints/{id}`, MCP `update_sprint` **and**
`set_sprint_capacities` must return 409 `AVAILABLE_IS_DERIVED` when the project's source is not
`manual`. Without it an agent writes a number the next push silently reverts.

**WP-7E · Frontend push dialog** — review then apply. Per sprint: current, proposed **as the integer
that will be written**, delta, and the PD/hours behind it. Then the per-project result list with
*Retry this one* on a locked row.

**WP-7F · Sprint header** — derived Available **read-only**, with source and push timestamp, and a
staleness badge. (Not in the wireframe bundle — see `design-corrections.md`.)

**WP-7G · Sprint date alignment** — a write breaking alignment between overlapping PIs of different
projects is **rejected** with 409 naming both ranges (§6.8). Enforced only from the moment a second
project is assigned.

**WP-7H · MCP** — `push_team_capacity`. This one **does** wrap `edit_lock(project_id)`, unlike every
other team tool: it is an ordinary project write, and acquiring makes an agent's push atomic against
a human editor.

**WP-7I · Tests** — integration: push writes, is idempotent, 409s under another user's lock, refuses
a manual project. E2E: full journey — team → members → absence → push → the board's Available
changes.

**Done when:** a capacity change in a team reaches a sprint header through an explicit push, and
never without one.

---

## Parallelism map

```
Step 1  ████  (no parallelism — everything depends on it)
        └─ 1.0 rename lands as its own PR first

Step 2      A─B─C─D   (contract → 4 packages)
Step 3        A─B─C─D─E─F─G
Step 4          A─B─C─D─E─F─G
Step 5            A─B─C─D─E─F─G─H
Step 6              A─B─C─D─E
Step 7                A─B─C─D─E─F─G─H─I
```

Within a step, the contract task blocks; everything after it runs concurrently. Across steps the
dependencies are real — 4 needs 3's patterns, 5 and 6 each extend 4's engine, 7 needs 4's assignment
— so do not overlap them.

**Highest-risk packages, worth the most careful reviewer:** 1.3 (the engine — wrong here is wrong
everywhere), 5D (the only bespoke drag gesture in the app), 6B (the clamp), 7A/7C (rounding and
staleness).

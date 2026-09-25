# Team Achievement & Velocity — Implementation Plan

**Reads:** [`spec/team-achievement.md`](team-achievement.md) (the specification — always wins),
[`spec/teams.md`](teams.md) (the capacity model this builds on; §6.5 is the section being closed),
[`spec/teams-implementation-plan.md`](teams-implementation-plan.md) (the conventions this plan
follows), [`docs/csv-import-logic.md`](../docs/csv-import-logic.md) (the importer's user-facing
contract, which step 2 changes).

Four steps plus one spike. Every step ends with `scripts/check.sh` green and the app shippable.

---

## Changes to the spec's proposed sequence, and why

`team-achievement.md` §9.3 proposes six steps. Three adjustments, for the same kind of reason the
teams plan reordered its own six:

**1. Categories and `completed_on` merge into one step.** §9.3 splits them, and they cannot ship
apart in any useful way. Stamping fires on a transition *into a `done`-category State* (§4.1), so
the completion logic cannot be written, let alone tested, before categories exist. Shipping
categories alone puts three dropdowns in the States editor that change nothing anywhere — a release
whose entire content is a promise. Merged, the step ships one coherent idea: **the app now knows
what "done" means and when it happened.**

**2. The CSV `Closed Date` moves ahead of the view, and forks from it.** §9.3 orders them 3 → 4 → 5;
they are in fact **independent branches off step 1** that share not one file. Two agent teams can
run them concurrently. But they must *land* in order, because of §9.2: without backfill the
Achievement view's first appearance shows `0` for every team, and "the feature is broken" is what
everyone concludes before reading the footnote explaining why. So: **parallel in development,
ordered in release.**

**3. A spike comes first, and it is not a coding task.** The date format of an Azure DevOps export
decided the shape of step 2, so it was settled against a real export before anyone wrote step 2's
contract. It has been done, and it did change step 2 (see Step 0).

| # | Step | Ships |
|---|------|-------|
| 0 | Date-format spike ✅ | nothing — an answer that shapes step 2 |
| 1 | Done-ness and completion dates ✅ | States carry a category; items carry a completion date |
| 2 | Backfill — CSV completion dates ✅ | real history, imported, in any exporter's format |
| 3 | The Achievement view ✅ | **the first real number** |
| 4 | The velocity suggestion ✅ (WP-4C open) | the measured factor, beside the typed one |

---

## Rules for running this with agents

Assume each agent has no context beyond this file and the spec. Everything in
[`teams-implementation-plan.md` § "What every sub-agent needs"](teams-implementation-plan.md) still
applies — `scripts/check.sh` as the definition of done, `scripts/openapi.sh` after any contract
change, RBAC on every route, no `any`, React Query for server state, the three Cypress rules, never
editing an existing migration. Five things are specific to running *this* work as parallel agents.

**Generated files have exactly one owner per step.** `frontend/openapi.json` and
`frontend/src/types/api.generated.ts` are checked in, are not produced by the build, and are
regenerated wholesale by `scripts/openapi.sh`. Two agents regenerating them from different schema
states produce a conflict that resolves to whichever ran last — silently dropping the other's types.
**Only the contract task runs `scripts/openapi.sh`.** A work package that discovers it needs another
field routes the change back through the contract task and waits; it does not regenerate.

**One migration per step, owned by the contract task.** Two agents running
`alembic revision --autogenerate` produce two heads and a broken `alembic upgrade head` for
everyone. This feature has exactly **one** migration in total (step 1: `pbis.completed_on`), so the
rule costs nothing to obey.

**Tests ship inside the work package that writes the code, not in a trailing "tests" package.**
`scripts/check.sh` enforces per-runner coverage floors globally, so a package that lands code
without tests fails the gate for every other agent in the step. The dedicated test packages below
own only what is genuinely cross-cutting: the E2E journeys and the hand-computed fixtures that
several packages assert against.

**Each work package names the files it owns, and no two packages in one step own the same file.**
The ownership map is given per step. Where a package must touch a file it does not own, it says so
in its handback rather than editing it.

**Isolate each package in its own worktree.** These packages touch disjoint files by construction,
so worktrees merge cleanly; the exception is the generated pair above, which is why it has a single
owner.

---

## Step 0 — Date-format spike ✅ done (2026-09-25)

Answered from a real ADO export (`ISK PI08 - PI Planner Export (8).csv`, trimmed by hand to six
rows). Findings are in `spec/team-achievement.md` §4.3. In short:

1. **Columns.** ADO offers `Resolved Date`, `Changed Date` and `Closed Date`, each set by a
   different State change. `Closed Date` is the source, `Resolved Date` the fallback, and
   `Changed Date` is never used: a sample PBI closed on 3 Sep was changed on 22 Sep.
2. **Format.** `9/3/2026 3:06:02 PM`: month first, no padding, 12-hour clock, time included. It
   comes from the exporting machine's regional settings, so **no format may be assumed.**
3. **Consequence for step 2.** The rule is no longer "reject slashes". It is **one format per
   file, worked out from every date cell in it**, asking the user only when the file is
   genuinely ambiguous. And because the CSV is parsed **client-side** (`csvParser.ts` →
   JSON `CsvRow`), that detection is frontend work. The backend only ever receives ISO dates.
   Step 2 below is rewritten accordingly.

Sample committed as `docs/csv-samples/10-closed-dates.csv` (anonymised, real date format).

---

## Step 1 — Done-ness and completion dates ✅ done (2026-09-25)

Landed on `feat/team-achievement` with `scripts/check.sh --with-e2e` clean. Beyond the packages
below, one gap turned up outside every package's files and was fixed: project **import**
(`routes/projects.py`) dropped `completed_on`, so an imported copy lost its history. MCP reports a
date on an item that isn't done as the module's usual `VALIDATION_ERROR` (with `NOT_COMPLETED` in the
message), not `CONFLICT`; spec §8.3 now says so.


**Ships:** States carry a category; stories and bugs carry a completion date that maintains itself.
Nothing aggregates yet.

### Contract task — blocking, merged before any package starts

- `schemas/project_state.py`: `category: StateCategory | None` on `ProjectStateCreate`; on
  `ProjectStateUpdate`, `value` becomes **optional** and `category` is added, with a model validator
  requiring at least one of the two. `StateCategory` and the response field already exist.
- `schemas/pbi.py`: `completed_on: date | None` on `PBIUpdate` and `PBIResponse`.
- **The one migration:** `pbis.completed_on` (nullable `Date`) + `idx_pbis_completed_on` on
  `(project_id, completed_on)`.
- `scripts/openapi.sh`.

### Parallel work packages

**WP-1A · Category writes** — owns `routes/project_states.py`, `services/project_state.py`,
`tests/integration/test_project_states.py`. POST accepts a category; PATCH sets **or clears** it
(explicit `null` clears; an absent key leaves it alone — the same distinction the importer draws for
the `State` column). Category survives a rename, because items reference by id. Broadcasts the
existing `state:updated`. **Nothing infers a category from a State's wording** — no prefill, no
suggestion, not even in a comment as a "future improvement". That is the ADR.

**WP-1B · The completion helper** ⚠️ *highest-risk package in the feature* — owns a new
`services/completion.py` and the four call sites listed below, plus
`tests/integration/test_pbis.py`.

`pbis.state_id` is written in exactly **four** places, across **two** files:

| Site | What it is |
|------|-----------|
| `routes/pbis.py:95` | create |
| `routes/pbis.py:159` / `:161` | update, and the explicit clear |
| `services/csv_import.py:469` / `:474` | update, and the type-change clear |
| `services/csv_import.py:528` | create, via the plan dataclass |

The transition logic must live in **one function called from all four**, never inline in a route.
Put it inline and the CSV path silently stops stamping — an import is the main way items become
done in this app, so the bug would be both the common case and invisible until someone opened the
Achievement view weeks later and found it empty.

```python
def apply_completion(
    pbi: PBI, new_state: ProjectState | None, *, explicit_date: date | None = None
) -> None:
    """Maintain ``completed_on`` across a State change (§4.1, §4.2)."""
```

Behaviour, all of it from §4.1–§4.2: stamp today on the **edge** into a `done` category while
`completed_on` is null; clear on any move out of `done`, including to an uncategorised State or to
no State; never re-stamp an item that was already `done` and stays `done`; `explicit_date` (the CSV
or a manual edit) always wins over the stamp. Setting `completed_on` on a non-`done` item is
`422 NOT_COMPLETED`.

**WP-1C · Snapshots** — owns `services/snapshot.py` and
`tests/integration/test_project_snapshots.py`. Add `completed_on` to the PBI payload; restore it
with `p.get("completed_on")` so a pre-feature snapshot restores as `NULL`, **permanently** — the
same shape as the `capacity`/`available` fallback teams.md §6.2 makes permanent. `category` already
round-trips (`snapshot.py:86`, `:285`, `routes/projects.py:265`); add an assertion rather than code.
This package is small and is separate precisely because it is the one that gets forgotten.

**WP-1D · States editor** — owns `components/ProjectStatesModal.tsx` and its test. A select per
entry — *(none)* / *not started* / *in progress* / *done* — on each of the three lists, saving
independently. The test must assert that a State named `Done` arrives with category `null`, not
`done`: that is the anti-inference rule, and an assertion is the only thing that keeps a later
well-meaning "helpful default" out.

**WP-1E · Item modal** — owns `components/PBIFormModal.tsx` and its test. **Completed on** beside
State, using the existing `DateInput` (`dd.mm.yyyy`), enabled only while the chosen State is
`done`-category, prefilling today on the transition and clearing on the way out. The modal shows the
rule by construction rather than explaining it in helper text.

**WP-1F · MCP** — owns `mcp_server/tools/states.py`, `mcp_server/tools/features.py` (the `update_pbi`
tool only), `mcp_server/tools/read.py` (the `list_states` description only). `create_state` gains
`category`; a new `set_state_category` takes a State **name** via the existing `resolve_state_id`
and rejects unknowns with the valid list — it is deliberately separate from `rename_state` so an
agent fixing a typo cannot recategorise by accident. `update_pbi` accepts `completed_on`. Nothing
new is destructive, so teams.md §8.2.6 needs no revision.

**WP-1G · E2E and docs** — owns `cypress/e2e/snapshots-and-states.cy.ts` (extended) and
`docs/csv-import-logic.md`'s State section. Journey: open a project's States editor, mark `Done` as
*done*, set a story to `Done`, reopen it and read the completion date back. ⚠️ `Done` is both a
State value and a plausible button label — scope every assertion, per the suite's third rule.

**Done when:** setting a story to a `done` State through the UI, the REST API, MCP **and a CSV
import** all leave the same `completed_on`, and moving it back clears it.

---

## Step 2 — Backfill: completion dates from the CSV ✅ done (2026-09-25)

Landed with `scripts/check.sh --with-e2e` clean. The detection lives in its own module,
`frontend/src/utils/dateFormat.ts`, rather than inside `csvParser.ts`, so the detector and the
parser could be built at once with no shared file. The parser gathers the cells; the detector only
decides. As first built, blank completion cells cleared a date, even on a row entering a done
State. That would have wiped every import's dates for a State the project marks *done* but Azure
DevOps doesn't treat as completed. It was changed on review: **blank cells never clear a date**
(spec §4.3), and the result's `completion_dates_cleared` counter went with it.


**Ships:** real completion history, imported.
**Depends on:** step 1 (the column and the helper). Step 0 is done.
**Runs concurrently with step 3.** Shares no file with it. Lands **before** it.

Step 0 moved the hard part of this step into the **frontend**: the file is parsed in the browser,
and so is its date format. The backend's share is small and strictly ISO.

### Contract task — blocking

`schemas/csv_import.py`: `completed_on: date | None` on `CsvRow`, with the same
absent / blank / value distinction `state` already carries (absent = neither date column in the
file, `""`-equivalent = clear), plus `has_completion_columns` on the request. The new counters on
`CsvImportResult` and `PlannedChange`: dates set, dates cleared, contradictions.
`scripts/openapi.sh`.

### Parallel work packages

**WP-2A · Format detection** ⚠️ *the risky package of this step* — owns the date parts of
`frontend/src/utils/csvParser.ts` (a new, pure, exported `detectDateFormat`) and
`csvParser.test.ts`. Implements §4.3 exactly:

- The candidates are ISO, `D.M.YYYY`, `M/D/YYYY` and `D/M/YYYY`, each with optional zero padding
  and an optional time part (24-hour or AM/PM), which is discarded.
- **Every date cell in every date column is evidence**, including `Changed Date` and any other
  date column that is never imported. Collect them from the header, not from a fixed list.
- A candidate is eliminated by one cell that is not a real calendar date under it.
- Returns *one format*, *several candidates* or *none, with the offending cells*. It never returns a
  guess.

**WP-2B · Column precedence and row mapping** — owns the row-mapping part of `csvParser.ts` (not
the detection) and `ImportCSVModal`'s request assembly. `Closed Date`, else `Resolved Date`,
converted to ISO with the detected format. `Changed Date` is never mapped. The three-way rule
applies over the two columns together. **Coordinate with WP-2A on the file:** 2A owns the new
detection function, 2B owns the existing row loop. The split is by function, so both can run at
once.

**WP-2C · Backend: write and count** — owns `services/csv_import.py` and
`tests/integration/test_csv_import.py`. Takes the ISO `completed_on`, passes it to step 1's
`apply_completion(..., explicit_date=...)` (never writes the column directly), counts a date on a
non-`done` row as a contradiction and ignores it, and reports the counts in the preview. Tests:
written, cleared, absent changes nothing (mirror the State-column test), contradiction, and
re-importing an unchanged file writes nothing.

**WP-2D · Import dialog** — owns `components/ImportCSVModal.tsx` and its test. Three states from
WP-2A's result:
- **One format:** one line naming it and the deciding cell.
- **Several candidates:** a required choice, pre-selected from the last answer for this project
  (`localStorage`, wrapped in try/catch, which is a per-viewer convenience only), with the preview
  re-rendering the dates as read so a wrong pick is visible before Confirm.
- **None:** the refusal, listing the cells.

A file with neither date column says so in one line, so "nothing was dated" never reads as a
failure.

**WP-2E · Docs and samples** — owns `docs/csv-import-logic.md` and `docs/csv-samples/` (except
`10-closed-dates.csv`, already committed by step 0). Adds the two date columns to the column
table, a subsection on format detection written for users ("export `Changed Date` too — it helps"),
removes "dates" from *Not imported*, and adds an ambiguous sample (`11-dates-ambiguous.csv`, every
day ≤ 12) plus both samples' rows in the README.

**WP-2F · E2E** — owns `cypress/e2e/csv-import.cy.ts` (extended). Import `10-closed-dates.csv`,
see "month/day/year" in the preview, confirm, and open a Done story to read its date back. Then
import `11-dates-ambiguous.csv`, see the format choice required, pick one, and confirm the preview
changes.

**Done when:** one import of a real export reproduces a quarter of completion history in whatever
format the exporting machine used; an ambiguous file cannot be imported without a stated format;
and a file without the columns leaves every existing date untouched.

---

## Step 3 — The Achievement view ✅ done (2026-09-25)

Landed with `scripts/check.sh --with-e2e` clean. WP-3A and WP-3B went to one agent, and WP-3C and
WP-3D to another: an engine and the endpoint that calls it, or a view and the rail entry that
mounts it, are one interface, and splitting them would have meant guessing it twice. The SSE
forwarding (WP-3E) was done after the merges, since it touches `csv_import.py`, which step 2 was
editing at the same time. It forwards more than the spec first said; §8.2 now lists every trigger.


**Ships:** the first real number.
**Depends on:** step 1 only.
**Runs concurrently with step 2.** Lands after it.

### Contract task — blocking, and the one worth the most care

`schemas/team_achievement.py`: the whole §5.3 grid in one response — sprint columns (reusing
`CapacitySprint`), per-project rows (committed, achieved, PD given, velocity), team totals
(achieved PD, available PD, realised), and the three §5.5 footers. Null, never zero, wherever a
figure is unknown. `scripts/openapi.sh`.

This shape is what three packages build against simultaneously, so it is merged before any of them
start and changed only through this task.

### Parallel work packages

**WP-3A · Attribution engine** — owns a new `services/achievement.py` and
`tests/unit/test_achievement.py`. Pure functions over plain data, no DB access in the maths, exactly
as `team_capacity.py` is built — that is what makes it unit-testable without fixtures.

Get these right; they are the whole feature: attribution is by `completed_on` within a sprint's
`[start_date, end_date]`, **inclusive at both ends**; overlapping sprints resolve to the
earliest-starting match and the points count **once**; a completion outside every sprint is
attributed to nothing and reported separately, never folded into the nearest column; an undated
sprint yields `None`, never `0`; `effort IS NULL` contributes zero points but one item, matching
`sprint_efforts_for_pi`.

**WP-3B · Endpoint** — owns a new `routes/team_achievement.py`, registered in `main.py`'s router
loop, and `tests/integration/test_team_achievement.py`. Guard is `get_current_user`: the view writes
nothing and a reader must see it. (`GET /teams/{id}/capacity` currently lives in
`routes/team_projects.py`; a separate module is cleaner here, since this endpoint joins the capacity
report to project item data and that file is already long.)

Assembles §5.3: Committed by placement (`Group.sprint_index` → swimlane → PI), Achieved by date,
PD given from the existing `ProjectCapacityRow`. **The two are asymmetric on purpose** — Committed
reads `—` where a project has no sprint matching the column's dates, while Achieved still computes.
**A `manual` assignment is excluded from the PD total** and from it alone; it keeps its own rows and
its own velocity, which needs no factor.

**WP-3C · The view** — owns `components/AchievementView.tsx` and its test, plus
`services/achievement.ts` and the hook (beside `useTeamCapacity`, which lives in
`hooks/useTeamProjects.ts`). Six sprint columns, the row groups of §5.3, cells expanding to the
items behind them with `WorkItemLink` where the project has an ADO template. Three empty states that
must each be distinct and each say why: no anchor project, no `done` State for an item type, no
projects with a factor. `—` not `0`, everywhere.

**WP-3D · Rail and minimap** — owns `pages/TeamPage.tsx` and the minimap wiring. A seventh entry,
**Achievement**, between *Capacity* and *Projects*; the rail already carries the comment explaining
why every destination is listed from the start. The minimap is the teams.md §7.4 control used a
third time and needs only what its contract asks: a number per month — here achieved PD, a sprint
straddling a month end split in proportion to its days — and a month's resolution to a sprint.
Reuse it; do not fork it.

**WP-3E · SSE** ⚠️ *the only genuinely new wiring in the feature* — owns the broadcast call sites in
`routes/pbis.py`, `routes/project_states.py` and `services/csv_import.py`, and the subscription in
the view's hook. A project write that changes `completed_on`, the effort of a completed item, or a
State's category, **and whose project has a `TeamProject` assignment**, broadcasts
`team:achievement:changed` with `{"project_id": ...}` on `team_channel(team_id)`.

This crosses an aggregate boundary deliberately and cheaply: it is a broadcast, not a write. No
project row is touched and no lock is involved. Do not "fix" it by subscribing the view to every
assigned project's channel — that is up to 20 `EventSource` connections behind one screen.

**WP-3F · MCP** — owns `mcp_server/tools/read.py` (the new tool only). `get_team_achievement`, a
**read** tool, so "how did we do" needs no write capability — the same reasoning that made
`preview_team_capacity` a read tool.

**WP-3G · E2E** — owns `cypress/e2e/achievement.cy.ts`. Import a CSV, mark `Done` as *done*,
complete a story, open the team and read the number off the right column. Then a story completed
outside the calendar appears in the footer and **not** in a column. `cy.openTeam` already exists in
`cypress/support/e2e.ts`.

**Done when:** a team serving two projects shows correct per-project points, a PD total that
excludes any `manual` project with the reason named, and figures that move when a story is
completed in another browser tab.

---

## Step 4 — The velocity suggestion ✅ done (2026-09-25), except WP-4C

Landed with `scripts/check.sh --with-e2e` clean. WP-4A first moved the Achievement grid's assembly
out of its route into `services/achievement_report.py`, so the suggestion reads the grid's own
figures instead of computing them a second way. The velocity is a ratio of sums over the chosen
sprints, not a mean of per-sprint ratios, so a short sprint weighs less than a long one.
**WP-4C is open and needs real data:** read the suggestion against a real quarter and record it
beside the typed factor in spec §7.


**Ships:** the measured factor, beside the typed one. This is the answer to "compute the velocity of
the team".
**Depends on:** step 3.

### Contract task — blocking

`GET /api/v1/teams/{team_id}/projects/{project_id}/velocity?sprints=N` and its response.
`scripts/openapi.sh`.

### Parallel work packages

**WP-4A · Endpoint** — owns the route and its integration tests. Achieved ÷ PD given over the last
*N* sprints **whose PI is `closed`**; `N` is 1–10, default 3. Closed only, because an in-progress
sprint's Achieved figure is incomplete and would drag the average down every single time anyone
looked. Fewer than *N* closed sprints: use what exists and report how many. **None: return nothing**
— a factor computed from one partial sprint is worse than no factor.

**WP-4B · Assignment editor** — owns `components/EditAssignmentModal.tsx` and a **new**
`EditAssignmentModal.test.tsx` (the modal has no test today, so this package adds the first one).
The suggestion block beneath the `units_per_pd` input, with `[Use this value]` filling the input and
**not saving** and **not pushing**. A human still accepts the factor, and teams.md §6.7's
review-then-apply push is untouched.

**WP-4C · Spec follow-up** — owns `spec/team-achievement.md` §7. Once the figure has been read
against a real quarter, record what it said next to what was typed. That paragraph is the evidence
for or against `available_source: "velocity"`, and it is the only thing that should decide it.

**Done when:** an assignment editor shows a measured pts/PD from closed sprints only, and shows
nothing at all where there are none.

---

## Serial vs parallel

```
Step 0  ▓▓ ✅       spike — done
Step 1  ████████    A B C D E F G   (contract → 7 packages)
             │
             ├──────────────► Step 2  ████  A B C D E F ─┐  land first
             │                                            │
             └──────────────► Step 3  ██████ A B C D E F G ┘  land second
                                              │
                                              └────► Step 4  ██  A B C
```

| | Serial | Parallel |
|--|--------|----------|
| **Step 0 vs step 1** | — | fully concurrent; 0 blocks only step 2 |
| **Step 1 → 2, 3** | hard dependency: both need the column and the helper | — |
| **Steps 2 and 3** | **release order only** — 2 lands first (§9.2) | **fully concurrent in development**; zero shared files |
| **Step 3 → 4** | hard: the suggestion divides the engine's numbers | — |
| **Inside any step** | the contract task blocks everything | every work package after it |

The one thing that is serial but does not look it: **steps 2 and 3 share no file and can be built at
the same time, yet must be merged in order.** Build them concurrently, hold step 3's merge until
step 2 is in. Getting this backwards does not break anything technically — it just means the
Achievement view's first appearance, for everyone, is a grid of zeros.

Realistic concurrency: 4–5 agents on step 1, 3–4 on step 2, 4–5 on step 3, 2 on step 4.

---

## Highest-risk packages, worth the most careful reviewer

| Package | Why |
|---------|-----|
| **WP-1B** — the completion helper | Four call sites in two files. Inline it in the route and CSV imports stop stamping, silently, and the loss only surfaces in step 3 |
| **WP-3A** — attribution | Wrong here is wrong in every figure on the screen. The boundary cases (inclusive ends, overlapping sprints, outside the calendar) are the ones that will not be noticed |
| **WP-2A** — date-format detection | A misread `6/3/2026` moves a sprint's velocity one column sideways and never fails loudly. The rule is *one format per file, or ask*, and the pressure to guess cell by cell will be constant |
| **WP-3E** — the SSE broadcast | The only cross-aggregate wiring. The wrong fix (subscribing to every project channel) looks more correct than the right one |
| **WP-1C** — snapshot restore | One `.get()` away from a permanent, silent data loss on every restore of an old snapshot |
| **WP-1A / WP-1D** — the anti-inference rule | Both will be tempted to prefill `Done` → `done`. The assertion in WP-1D's test is what holds the line after everyone here has moved on |

# Team Achievement & Velocity — Specification

> Status: draft for review. Extends `spec/teams.md`, which computes what a team *has*
> (capacity) but nothing about what it *delivered*. This document closes the two gaps
> `teams.md` §6.5 names as the blockers to velocity, and stops one step short of the third.
> Same conventions as that document; section references of the form "teams.md §6.5" point
> into it, bare "§" references point inside this file.

## 1. Problem

A team's capacity is derivable (teams.md §5). Its output is not. Nothing in the app can
answer *"how many points did this team finish in sprint 3"*, for three reasons:

1. **"Done" is not knowable.** `project_states.category` exists on the model and is
   explicitly reserved — nothing writes it. The only way to tell a finished item from a
   planned one is to read the State's *wording*, and the wording is whatever a CSV import
   discovered: `Done`, `Closed`, `Accepted`, `Erledigt`, `Ready for Release`. Guessing from
   text is how a project silently stops counting the day someone renames a column in Azure
   DevOps.
2. **Nothing records *when* an item finished.** An item's State is mutable and carries no
   timestamp, so "completed in sprint 3" has no representation.
3. **Achievement is per project; a team is not.** A team serves several projects
   (teams.md §6.1), each with its own free-text `effort_unit` and its own scale. Points from
   two projects are not addable as numbers.

This document fixes (1) and (2) with two small pieces of stored data, and answers (3) with a
conversion the team model already carries.

## 2. Scope

**In scope:** marking which States mean *done* per item type; recording when a story or bug
was completed; attributing that completion to a sprint; a team-level Achievement view showing
achieved points per sprint per project, converted to person-days for a team total; and the
resulting empirical velocity offered as a **suggestion** beside the typed `units_per_pd`.

**Not in scope:** per-member achievement (there is no member ↔ work-item link, and
teams.md §2 excludes one deliberately); in-sprint burndown; cycle time, lead time or any other
flow metric; completion dates on Features; automatic `available_source: "velocity"`
(§7 explains why it stays one step away); forecasting or commitment reliability scoring.

---

## 3. Data Model

Two additions. One is a column that already exists and has never been written; the other is a
single new nullable date.

### 3.1 State category — done-ness is declared, never inferred

`project_states.category` becomes writable. It is `not_started | in_progress | done | null`,
and the column, the `StateCategory` literal, the `ProjectStateResponse` field and the snapshot
round-trip are all **already in place** — only the writes are missing.

| Rule | |
|------|--|
| Nullable | `null` means *uncategorised*, and is the default for every existing entry and every entry a CSV import discovers. |
| Many per list | A list may have **several** `done` entries — `Done`, `Closed` and `Accepted` commonly coexist in one ADO workflow — and several `in_progress` ones. |
| Per item type | Categories are set on each of the three lists independently (ADR 0001). A Bug's `Resolved` and a Story's `Committed` are different rows and get their own answers. |
| Never inferred | Nothing derives a category from the State's text. Not on import, not on create, not as a "suggestion" prefilled in the editor. |

That last rule is the point of the feature and deserves its own ADR
(`docs/adr/0006-done-ness-is-declared-not-inferred.md`). Word-matching `done` would work for
`Done` and `Closed`, fail silently for `Ready for Release`, and — worse — *succeed wrongly* for
`Done in dev`. A vocabulary the user curates (ADR 0003) is exactly the place to put an explicit
answer, and the cost is three dropdowns in a modal they already open.

**A project with no `done` State measures nothing**, and every surface must say so rather than
render zeros (§5.5, §10).

### 3.2 `pbis.completed_on` — a date on the item

```python
completed_on: Mapped[date | None] = mapped_column(Date)
```

One nullable `Date` on `pbis`. New Alembic revision; `idx_pbis_completed_on` on
`(project_id, completed_on)` because every query in §5 filters exactly that pair.

**A date, not a timestamp.** Sprint boundaries are dates, the CSV source carries a date, and a
datetime would promise a precision neither has. **On the item, not in a log:** an item has one
completion date, and a full transition history is a different feature with a different cost
(§11).

**Only on `pbis`.** Features are excluded deliberately: `feature_efforts` derives a Feature's
effort from its stories, so counting both would double every point. A Feature's State can still
be categorised — that is vocabulary, useful on the board — it simply contributes no achievement.

### 3.3 What is deliberately not stored

| Not stored | Because |
|-----------|---------|
| A per-sprint achieved tally | Figures are recomputed on read (§5.6). A stored tally is a second source of truth that drifts from the items. |
| A state-transition log | §3.2. The one question this feature asks is "when did it finish", and one column answers it. |
| `completed_on` on features | §3.2 — double counting. |
| A member ↔ item link | Out of scope (§2); teams.md §2 excludes it. |
| Anything on the team | Achievement is entirely derived from project data plus the team's existing capacity model. The team aggregate gains no column. |

---

## 4. Recording Completion

### 4.1 Two sources, one field

`completed_on` is written by two paths, and the precedence between them is fixed.

| Source | Rule |
|--------|------|
| **CSV `Closed Date` column** (new, optional; `Resolved Date` as fallback — §4.3) | The date in the file is written. The source system knows when the work finished; the planner does not. |
| **State transition** | A write that moves an item's `state_id` from a State whose category is *not* `done` to one whose category *is* `done`, while `completed_on` is null, stamps **today's date**. |

**The CSV wins** when one row carries both — it is the only one of the two that can be right
about the past. A row with a `Closed Date` and a non-`done` State is a contradiction in the
source file: the date is ignored and the row is reported in the import preview's warnings, not
silently reconciled.

**Transition, not state.** Stamping fires on the *edge*, never on the level. An item already
sitting in a `done` State when this feature ships does not transition, so it is not stamped —
which is what keeps the migration honest (§9.2). It also means re-saving a done item does not
move its date.

### 4.2 Leaving `done` clears the date

Moving an item to a State whose category is not `done` — including to `null` category, or
clearing the State entirely — sets `completed_on` back to `NULL`.

Clearing loses the old date. That is correct: "when did this finish" has one answer, and an
item that is no longer finished has none. An item re-completed later gets a fresh date, which
is the date it actually finished the second time.

### 4.3 Completion dates in the CSV

Checked against a real Azure DevOps export (step 0 of the implementation plan). An ADO query can
export several dates per work item, each set by a different State change. What the export showed:

| Column | Set by ADO when | Used for `completed_on` |
|--------|-----------------|-------------------------|
| `Closed Date` | the item enters a *Completed*-category State (`Done`, `Closed`); cleared again if it is reopened | **Yes — the source** |
| `Resolved Date` | the item enters a *Resolved*-category State (Bugs: `Resolved`) | **Fallback only**, when `Closed Date` is blank (see below) |
| `Changed Date` | **any** edit to the item | **Never** |
| anything else (`Activated Date`, `Created Date`…) | — | Never |

`Changed Date` looks tempting and is wrong: in the sample, a PBI closed on 3 September carries a
`Changed Date` of 22 September, because someone touched it afterwards. It measures the last edit,
not the finish.

`Resolved Date` is the fallback because a project may declare a Bug's `Resolved` State as `done`
(§3.1), and ADO leaves `Closed Date` blank until the bug is actually closed. Where both are filled,
`Closed Date` wins.

The two completion columns, taken together:

| In the file | Effect |
|---|---|
| Neither `Closed Date` nor `Resolved Date` present | `completed_on` is left exactly as it is, for every row. |
| A date in `Closed Date`, else in `Resolved Date` | Written to `completed_on`, provided the row's State is `done`-category (§4.1). |
| Column(s) present, both cells blank | Nothing changes. The item keeps its date, or gets today's stamp if this row moves it into done (§4.1). |

**Blank cells never clear a date**, unlike a blank `State` cell. A project may declare a State
*done* that Azure DevOps doesn't treat as completed, such as `Ready for Release`. ADO then leaves
`Closed Date` blank for those items, and if blank cells cleared dates, every import would wipe the
date the planner stamped when the item entered that State. A blank cell is therefore no evidence
that an item is unfinished. A date goes only when the item leaves done (§4.2), which is also when
ADO clears its own `Closed Date`.

#### The date format belongs to the exporting machine

The sample exports dates as `9/3/2026 3:06:02 PM`: **month first, no zero padding, a 12-hour
clock with AM/PM, and a time part.** That comes from the regional settings of whoever exported
the file, not from ADO. A colleague elsewhere exports the same item as `03.09.2026 15:06:02` or
`3/9/2026 15:06:02`. The importer therefore **cannot assume a format**, and it must not guess
cell by cell either: `6/3/2026` means 3 June to one exporter and 6 March to another. Reading it
wrong never fails loudly. It just moves a sprint's velocity one column sideways.

The rule that follows: **one file, one format, worked out from the whole file.**

A file comes from one export on one machine, so every date cell in it, **in every date column,
including the ones not imported**, shares a single format. The importer tries each candidate
format against all of them:

| Candidate | Example |
|-----------|---------|
| ISO | `2026-09-03`, `2026-09-03T15:06:02` |
| day.month.year | `3.9.2026`, `03.09.2026 15:06` |
| month/day/year | `9/3/2026 3:06:02 PM` |
| day/month/year | `3/9/2026 15:06:02` |

Leading zeros are optional. A time part (24-hour or AM/PM, with or without seconds) is accepted
and **discarded**. A candidate is eliminated by any single cell it cannot read as a real calendar
date, such as a month above 12 or 31 September.

- **Exactly one candidate survives:** it is used, and the import preview says so and shows the
  cell that settled it: *"Dates read as month/day/year (9/22/2026 cannot be day/month)."*
- **Several survive**, because every day in the file is 12 or lower: the import dialog asks which
  format the file uses. It offers no default, but pre-selects the last answer given for this
  project. The preview then shows the dates as read, so a wrong answer is visible before Confirm.
- **None survive:** the file is refused, listing the cells no single format can read.

This is why `Changed Date` is still worth exporting even though it is never imported. It is
filled on **every** row, so it gives the format check far more evidence than the few rows with a
`Closed Date`. In the sample it settled the question on its own: `7/14/2025` and `9/22/2026`
cannot be day-first.

**Time zone.** The date kept is the exporting machine's local date. A completion within a few
hours of midnight can land one day off from another zone's view, and so, only at a sprint
boundary, in the neighbouring sprint. This is accepted: sprint boundaries are whole dates, and the
alternative is inventing a zone the file doesn't carry.

**Where this happens.** The CSV is parsed client-side (`frontend/src/utils/csvParser.ts`), which
already turns the file into JSON `CsvRow`s. Format detection and conversion live there, and the
backend receives only an ISO date plus the absent / blank / value distinction the `state` field
already carries. The API never sees a locale-formatted date.

### 4.4 Manual correction

`completed_on` is editable on the story/bug modal, as a date field beside State, **enabled only
while the item holds a `done`-category State**. Setting it on an item that is not done is
`422 NOT_COMPLETED`.

It is editable because the alternative is worse. The first import after this ships will stamp
nothing (§4.1), and a team whose CSV has no `Closed Date` column has no other way to enter the
history it needs before the view says anything. A read-only field would make the feature useless
for exactly the teams that would otherwise adopt it fastest.

### 4.5 Attribution to a sprint

> A story is achieved in the sprint whose dates contain its `completed_on`.

Not the sprint it was planned into. A story placed in sprint 1 and finished in sprint 4 counts
in **4**, because velocity is a measurement of output and attributing it to the plan would
report the plan back as if it were the outcome.

The precise rule:

- The calendar is the **team's anchor project** — its first assignment, which teams.md §7.0.1
  already makes the source of every team view's columns, and teams.md §6.8 makes every other assigned
  project align to.
- A completion is attributed to the sprint `S` with `S.start_date <= completed_on <= S.end_date`.
- **Overlapping sprints** in one PI (teams.md §11 admits these exist): the earliest-starting
  matching sprint wins, and the points count **once**. Same rule as overlapping absences.
- A `completed_on` that falls in **no** sprint — between two PIs, before the calendar begins,
  after it ends — is attributed to nothing and surfaced separately (§5.5). It is never folded
  into the nearest column.
- **Sprints with no dates contribute nothing**, and their column reads `—`, never `0`
  (teams.md §7.0.1).

Alignment is only enforced between *overlapping* PIs of assigned projects (teams.md §6.8), so a
project may hold a PI where the anchor holds none. Work completed in that window is "outside the
calendar" and the view says so. That is the honest answer; inventing a column for it would put a
number under a heading the team does not plan in.

---

## 5. The Achievement View

### 5.1 Where it sits

A **seventh entry on the team rail** in `TeamPage.tsx`, labelled **Achievement**, between
*Capacity* and *Projects*. It is the Capacity view's counterpart — same team, same columns, the
other half of the question — and the rail already carries the comment explaining why all
destinations are listed from the start.

No edit-mode button, like every other team view: this view writes nothing at all.

### 5.2 Columns

The **same sprint window as the Capacity view** (teams.md §7.0.1): six columns from the anchor
project's calendar, labelled `{PI name}.{n}` with the date range beneath, scrolling through time,
with the shared minimap above.

The minimap is the teams.md §7.4 control used a third time, and it needs only what that contract asks for:
a number per month and what a month resolves to. Here **a bar is the achieved PD in that month**,
a sprint straddling a month end split across both in proportion to its days, and a month resolves
to the best matching sprint exactly as in teams.md §7.6. A team with no anchor project has no calendar, and
the view says that instead of drawing an empty grid.

### 5.3 Rows

```
                          Q3-2026.1   Q3-2026.2   Q3-2026.3   Q3-2026.4
                          30.6–10.7   13.7–24.7   27.7–7.8    10.8–21.8
─────────────────────────────────────────────────────────────────────────
Alpha            share 70%
  Committed (pts)      24          26          26           28
  Achieved  (pts)      21          34          29           12
  PD given            16.8        18.2        17.8         15.4
  Velocity          1.25 pts/PD 1.87 pts/PD 1.63 pts/PD  0.78 pts/PD

Beta             share 30%
  Committed (sp)        8           8           8            —
  Achieved  (sp)        8           5          13            4
  PD given             7.2         7.8         7.6          6.6
  Velocity          1.11 sp/PD  0.64 sp/PD  1.71 sp/PD   0.61 sp/PD
─────────────────────────────────────────────────────────────────────────
Team
  Achieved  (PD)      19.3        26.0        25.4         11.7
  Available (PD)      24.0        26.0        25.4         22.0
  Realised             80%        100%        100%          53%

Outside the calendar: 3 pts (Alpha), 0 sp (Beta)
```

**Per project — always computable, no factor needed:**

| Row | Definition |
|-----|-----------|
| **Committed** | Σ `effort` of stories and bugs placed in that sprint (via `Group.sprint_index` → swimlane → PI), whatever their State. What the plan said. |
| **Achieved** | Σ `effort` of stories and bugs whose `completed_on` falls in the column's date range (§4.5). What happened. |
| **PD given** | The team PD this project received in that sprint — `team_PD × share_pct / 100`, the figure `ProjectCapacityRow` already carries. |
| **Velocity** | Achieved ÷ PD given, in the project's own unit per person-day. **This is the `units_per_pd` that teams.md §6.5 defines**, measured rather than typed, and it needs no knowledge of what the unit means. |

**Committed and Achieved are asymmetric, deliberately.** Achieved is found by date and works for
every project unconditionally. Committed is found by *placement*, which requires that project to
have a sprint whose `[start_date, end_date]` equals the column's — normally guaranteed by
teams.md §6.8, but not where a project has no PI in that window. Where there is no matching
sprint, Committed reads `—` and Achieved still reads a number. Naming the asymmetry is better
than suppressing the half that works.

**Team total — needs the conversion:**

| Row | Definition |
|-----|-----------|
| **Achieved (PD)** | Σ over projects of `achieved_points ÷ units_per_pd`. |
| **Available (PD)** | The team's capacity for that sprint, over members that count towards capacity — the number the Capacity view's total row already shows. |
| **Realised** | Achieved PD ÷ Available PD, as a percentage. |

**Realised reads as "how close is reality to the factor you typed"**, which is what it
arithmetically is: `(points ÷ typed_factor) ÷ PD` is the measured velocity over the typed one.
That makes it the one number on the screen that judges the plan rather than the team, and it is
labelled so — a separate word from *Velocity*, because conflating a pts/PD rate with a
dimensionless ratio is how a dashboard starts lying.

**Only projects with a factor reach the PD total.** A `manual` assignment's `units_per_pd` is a
default of 1.0 that nobody set, so converting its points through it would silently assert
1 point = 1 person-day. Such a project keeps every one of its own rows — including its Velocity,
which needs no factor — and is **excluded from the PD total**, with a line beneath the table
naming it and linking to the assignment editor. A team all of whose projects are `manual` shows
the per-project rows and no total, and says why.

### 5.4 Cells

A cell expands to the items behind it: each story or bug with its `user_id`, title, effort and
`completed_on`, linked through `WorkItemLink` where the project has an ADO URL template. A
surprising number is then one click from its cause, matching what the Capacity view's breakdown
does for the other side of the ratio.

### 5.5 What the view must not hide

Three figures sit under the table rather than being dropped:

- **Outside the calendar** — points completed in no sprint (§4.5), per project.
- **Done but undated** — items in a `done` State with `completed_on = NULL`. Every project will
  have these on day one (§9.2). The count is shown with a link to a filtered backlog so they can
  be dated or re-imported.
- **Uncategorised States** — per item type, when a project has no `done` entry at all. Its rows
  read `—`, never `0`, and the line points at the States editor.

### 5.6 Computed on read

Nothing is stored or frozen. Every figure is derived per request, the way teams.md §6.6 derives
staleness by comparing values rather than fingerprinting inputs.

The consequence is stated rather than hidden: **correcting data corrects history.** Fixing a
mistyped State or importing a CSV that was three weeks late will move a past sprint's bar. That
is the behaviour worth having — the alternative freezes a known-wrong number and then needs a
recompute escape hatch, which is the same recomputation with a worse default. Because attribution
is by a *recorded date* rather than by current placement, ordinary editing does not move the past;
only genuine corrections do.

Cost is bounded: one indexed query per project per window, over a handful of sprints.

---

## 6. Project-side surfaces

### 6.1 The States editor gains a category

`ProjectStatesModal` puts a small select beside each entry, on each of the three lists:

```
Product Backlog Item
  New           [ — ▾ ]        ↑ ↓  ✎  🗑
  Approved      [ — ▾ ]
  Committed     [ in progress ▾ ]
  Done          [ done ▾ ]
  Accepted      [ done ▾ ]
```

Options are *(none)* / *not started* / *in progress* / *done*. Nothing is prefilled from the
State's wording (§3.1). The list is where done-ness is declared, so this is the only place in the
UI that sets it.

The three lists are independent, so the modal shows and saves them independently — as it already
does for order and naming.

### 6.2 Completion on the item modal

`PBIFormModal` shows **Completed on** beside State, enabled only for a `done`-category State
(§4.4), using the app's existing `DateInput` (`dd.mm.yyyy`). Changing State to a done category
prefills today; changing it away clears and disables the field, so the modal shows the rule
rather than explaining it.

### 6.3 The assignment editor gains a suggestion

`EditAssignmentModal` shows, beneath the `units_per_pd` input:

```
units_per_pd  [1.50]
──────────────────────────────────────
Last 3 closed sprints: 1.42 pts/PD     [Use this value]
```

**Closed sprints only** — a sprint still in progress has an incomplete Achieved figure and would
drag the average down every time anyone looked. "Closed" means the sprint's PI is in state
`closed`. The count is adjustable 1–10, defaults to 3, and with **no** closed sprints the block
shows nothing rather than a number computed from one partial sprint.

`[Use this value]` fills the input; it does not save, and it does not push. A human still types
(or accepts) the factor, and the existing review-then-apply push (teams.md §6.7) is unchanged.

---

## 7. Why `available_source: "velocity"` stays one step away

teams.md §6.5 reserves a third source that would derive `units_per_pd` from history
automatically. This document supplies everything it needs — categorised States, dated
completions, and the division itself — and stops at §6.3's suggestion.

The reason is sequencing, not difficulty. The measurement has never run against real data. Wiring
it straight into `sprints.available` would make its first output a *plan*, and a velocity computed
over a quarter where half the items were dated by hand is not a number to budget from. The
suggestion makes the same figure visible in the same place, costs one endpoint and no new column,
and lets a team compare it against their typed factor for a PI or two.

When it is trusted, `velocity` is a small addition: `AVAILABLE_SOURCES` gains a member,
`compute_rows` in `team_push.py` reads the derived factor instead of the stored one, and
everything else — preview, rounding, staleness, the 409s — is already built. The window (N
sprints) becomes a field on the assignment. Nothing in this document forecloses it.

---

## 8. API and MCP Surface

### 8.1 REST

| Method | Path | Change | Guard |
|--------|------|--------|-------|
| `GET` | `/api/v1/teams/{team_id}/achievement?from=&to=` | **New.** Mirrors `/capacity`: the whole grid of §5.3 in one response. | `get_current_user` |
| `GET` | `/api/v1/teams/{team_id}/projects/{project_id}/velocity?sprints=N` | **New.** The §6.3 figure alone. | `get_current_user` |
| `POST` | `/api/v1/projects/{id}/states` | `category` added to the body, optional, default `null`. | `require_edit_lock` |
| `PATCH` | `/api/v1/projects/{id}/states/{state_id}` | `category` added; `value` becomes optional so a category-only patch is possible. At least one field required. | `require_edit_lock` |
| `PATCH` | `/api/v1/pbis/{id}` | `completed_on` accepted. `422 NOT_COMPLETED` when the item's State is not `done`-category. | as today |
| `GET` | `/api/v1/pbis/*` | `completed_on` added to `PBIResponse`. | as today |
| `POST` | `/api/v1/projects/{id}/import-csv` | `Closed Date` recognised; preview reports dates set, cleared and contradicted. | as today |

Standard envelope throughout. **Run `scripts/openapi.sh` after these** — `openapi.json` and
`api.generated.ts` are checked in and not produced by the build, and `scripts/check.sh` fails on
a stale pair.

### 8.2 SSE — the one genuinely new wiring

Achievement is team-level data computed from **project** writes, and teams.md §8.1 keeps the two
channels apart: team writes broadcast on the team channel, project writes on the project channel.
An open Achievement view would therefore never hear that someone just completed a story.

**A project write that can move an Achievement figure broadcasts
`team:achievement:changed` on the serving team's channel**, with payload `{"project_id": ...}`,
and the view refetches. "Can move a figure" is wider than completion alone, because the view's
Committed row depends on placement: story create, update, delete, place and unplace; group
create, update and delete; a feature moved, split, un-split or deleted and the bulk clears; a
State's category change (a rename alone is not forwarded); a CSV import; a snapshot restore. One
helper, `services/team_events.notify_team_achievement`, called once per request after the commit.
Sprint date edits are not forwarded: they move the columns themselves, and the Capacity view,
which has the same dependency, does not forward them either.

This crosses an aggregate boundary on purpose and cheaply: it is a broadcast, not a write. No
project row is touched, no lock is involved, and a team with no open viewer pays nothing. The
alternative — subscribing the view to every assigned project's channel — would put up to 20
`EventSource` connections behind one screen.

### 8.3 MCP

| Tool | Module | Change |
|------|--------|--------|
| `create_state` | `states.py` | Optional `category` parameter. |
| `set_state_category` | `states.py` | **New.** Sets or clears a category by State name, the same name-resolution as `rename_state`. Separate from `rename_state` so an agent fixing a typo cannot recategorise by accident. |
| `list_states` | `read.py` | Already returns `category`; the description must say what it means. |
| `get_team_achievement` | `read.py` | **New.** The §5.3 grid. |
| `update_pbi` | `features.py` | Accepts `completed_on`; rejects it on a non-done item with the same 422, surfaced as the module's usual `VALIDATION_ERROR` with `NOT_COMPLETED` in the message. |

`set_state_category` takes a State **name**, not an id, following `resolve_state_id` and
ADR 0003's precedent — and an unknown name is rejected with the list of valid ones rather than
creating an entry. Category is not vocabulary creation, so no new entry is ever minted here.

Nothing new is destructive, so §8.2.6 of teams.md needs no revision.

---

## 9. Migration and Rollout

### 9.1 Schema

One Alembic revision: `pbis.completed_on` (nullable `Date`) plus
`idx_pbis_completed_on (project_id, completed_on)`. `project_states.category` needs **no**
migration — the column has existed since `d8e9f0a1b2c3_add_project_states` and has simply never
been written.

**Snapshots.** `services/snapshot.py` must add `completed_on` to the PBI payload and read it back
with `p.get("completed_on")`, permanently — every snapshot taken before this ships lacks the key,
exactly as teams.md §6.2 describes for `capacity`/`available`. `category` is already carried in
both directions (`snapshot.py:86`, `:285`, `routes/projects.py:265`), so nothing changes there.

### 9.2 The day-one gap, stated rather than papered over

Existing items already sitting in a `done` State are **not back-stamped**. Stamping fires on a
transition (§4.1), and there is no transition; a migration that wrote `today()` into every done
item would collapse a project's entire history into one sprint and make the first chart a lie.

So on day one every project shows **0 achieved** and a "done but undated" count equal to its
finished work. Two ways out, both offered in the view (§5.5):

1. **Re-import the CSV with a `Closed Date` column** — one import restores the real history.
2. **Date the items by hand** (§4.4) — viable for a project with a handful of finished stories.

Nothing is silently invented. A project that does neither simply starts measuring from its next
completion, which is a correct answer to the question it is being asked.

### 9.3 Order of work

1. Category writes end-to-end: schemas, routes, `ProjectStatesModal`, MCP. Shippable alone —
   the State Lists become categorised, and nothing else changes.
2. `completed_on`: migration, stamping and clearing on state transition, item modal, snapshot.
3. `Closed Date` in the CSV importer, with the preview counts.
4. `achievement.py` service + `GET /teams/{id}/achievement`.
5. The Achievement view and the rail entry.
6. The §6.3 velocity suggestion.

Steps 1–3 are independently useful and independently testable; steps 4–6 are the view.

---

## 10. Edge Cases

| Case | Behaviour |
|------|-----------|
| Project has no `done` State for an item type | Rows read `—`, never `0`; the view names the item type and links to the States editor (§5.5) |
| Item in a `done` State, `completed_on` null | Counted in no sprint; appears in the "done but undated" figure (§5.5, §9.2) |
| `completed_on` outside every sprint | Counted in no column; appears in "outside the calendar" (§4.5) |
| `completed_on` set, State moved off `done` | Date cleared (§4.2) |
| Item re-completed after being reopened | Fresh date, the day it finished the second time (§4.2) |
| CSV `Closed Date` on a row whose State is not `done` | Date ignored, row reported as a warning in the preview (§4.1) |
| CSV with no `Closed Date` column | No `completed_on` changes at all, for any row (§4.3) |
| CSV with blank completion cells on a done row | Date kept; a row entering done keeps today's stamp (§4.3) |
| CSV dates where one format fits every cell | That format is used; the preview names it and the cell that decided it (§4.3) |
| CSV dates where several formats fit (every day ≤ 12) | The dialog asks which format; no default; preview shows the dates as read (§4.3) |
| CSV dates no single format fits | File refused, listing the offending cells (§4.3) |
| Only `Changed Date` differs from `Closed Date` | `Changed Date` is never imported; it only helps detect the format (§4.3) |
| Bug `Resolved`, not yet `Closed`, with `Resolved` marked `done` | `Resolved Date` used, since `Closed Date` is blank (§4.3) |
| `completed_on` set via API on a non-done item | `422 NOT_COMPLETED` |
| Story with `effort = NULL` completed | Counts as an item, contributes 0 points — matching `sprint_efforts_for_pi`, which already filters `effort IS NOT NULL` |
| Bug completed | Counts. Bugs carry effort and draw from their own State List; both lists need their own `done` marking |
| Feature in a `done` State | Contributes nothing — its effort is the sum of its stories (§3.2) |
| Story completed while unplaced (never on a board) | Achieved counts it; Committed does not. The two rows differ, which is the honest reading |
| Story planned in sprint 1, completed in sprint 4 | Committed in 1, Achieved in 4 (§4.5) |
| Sprint with no dates | Column reads `—` for every row (teams.md §7.0.1) |
| Two sprints of one PI overlapping in time | Earliest-starting match wins; points counted once (§4.5) |
| Project has no sprint matching a column's dates | Committed reads `—`, Achieved still computed (§5.3) |
| Team with no anchor project | No calendar; the view says so rather than drawing an empty grid (§5.2) |
| All of a team's projects are `manual` | Per-project rows shown, no PD total, with the reason named (§5.3) |
| One `manual` project among several | Excluded from the PD total only; keeps its own rows and its own Velocity (§5.3) |
| `share_pct` sum > 100 | Unchanged — amber warning, never blocked (teams.md §6.3) |
| Available PD is 0 for a sprint | Velocity and Realised read `—`, not `∞` or `0%` |
| Achieved > Available | Shown as over 100%; no clamping — it happens, and it is information |
| Member flagged not counting towards capacity | Unchanged: their PD never reaches Available, so Realised rises. ADR 0005's stated cost |
| Fewer than N closed sprints for the suggestion | Uses what exists and says how many; none at all shows nothing (§6.3) |
| A state's category changed after items were completed | History moves — figures are computed on read (§5.6) |
| Deleting a State | Unchanged: refused while any item holds it (`STATE_IN_USE`) |
| Snapshot restored from before this feature | `completed_on` restores as `NULL`; `category` restores as stored (§9.1) |
| Item deleted | Its points leave every figure, since nothing is tallied (§5.6) |
| PI closed | No effect on achievement — nothing freezes (§5.6). Only the §6.3 suggestion cares, and it cares by *only* using closed sprints |

---

## 11. Decisions Taken

| Decision | Alternative rejected | Why |
|----------|---------------------|-----|
| Done-ness is a declared category on the State | Matching the State's wording | `Ready for Release` fails; `Done in dev` matches wrongly. ADR 0006 |
| A completion **date** on the item | A per-sprint tally frozen at sprint close | The close never happens; sprints nobody closed would have no number, and there would be no per-item traceability |
| A completion **date** on the item | A full state-transition log | One question is being asked. A log is a bigger feature with a bigger table and a retention policy |
| Attribution by date | Attribution by board placement | Placement reports the plan back as the outcome, and does not survive cross-project aggregation |
| CSV `Closed Date` beats a stamped transition | Stamp always | The source system is the only one of the two that knows the past |
| Computed on read | Frozen when the PI closes | A frozen wrong number needs a recompute escape hatch, which is this, with a worse default |
| Cross-project total in PD | Summing raw points | `effort_unit` is free text; the app cannot tell pts from sp and does not try (teams.md §6.4) |
| `manual` projects excluded from the PD total | Using their default `units_per_pd = 1.0` | Silently asserting 1 point = 1 person-day |
| Velocity suggested, not applied | Implementing `available_source: "velocity"` now | Its first output would be a budget, computed over hand-dated history (§7) |
| Date format worked out per file, asked when ambiguous | A fixed format, or guessing cell by cell | The format belongs to the exporting machine. A wrong guess moves velocity one column sideways and never fails loudly |
| `Closed Date`, falling back to `Resolved Date` | `Changed Date` | Any edit moves `Changed Date`; the sample has a PBI closed 3 Sep and changed 22 Sep |
| Broadcast on the team channel from a project write | Subscribing the view to 20 project channels | A broadcast is free; 20 `EventSource` connections are not (§8.2) |

Two ADRs follow from this:

- `docs/adr/0006-done-ness-is-declared-not-inferred.md` — §3.1.
- `docs/adr/0007-achievement-is-a-date-on-the-item.md` — §3.2, §4.5, §5.6: why a date beats both
  a frozen tally and a transition log, and why attribution is by date rather than placement.

---

## 12. Test Plan

Four layers, as `docs/TESTING.md` defines them. `scripts/check.sh` is the gate; coverage floors
are enforced by each runner and this feature must not lower them.

### Backend unit — `backend/tests/unit/test_achievement.py`

The attribution and arithmetic, with no database where possible:

- A `completed_on` inside / on the boundary of / outside a sprint's range.
- Overlapping sprints: earliest wins, counted once.
- Completion before the calendar begins, after it ends, in a gap between PIs → "outside".
- Undated sprint → `None`, never `0`.
- PD conversion: points ÷ `units_per_pd`; a `manual` assignment excluded from the total.
- Realised with Available PD = 0 → `None`.
- The §6.3 suggestion: closed sprints only, fewer than N available, none available.
- `effort = NULL` contributes 0 points but one item.

### Backend integration

- `test_project_states.py` — create with a category; patch category alone; patch value alone;
  several `done` entries in one list; category survives rename; category is per item type.
- `test_pbis.py` — transition into `done` stamps today; transition out clears; re-entering
  stamps afresh; an already-done item is not re-stamped on an unrelated save; `completed_on`
  on a non-done item is `422 NOT_COMPLETED`; `PBIResponse` carries the field.
- `test_csv_import.py` — `completed_on` written from an ISO date; `Resolved Date` used only when
  `Closed Date` is blank; blank cells keep the date, and keep the stamp on a row entering done; both columns absent changes nothing (mirroring the
  existing `State`-column test); date on a non-`done` row is ignored and counted.
- `csvParser.test.ts` (frontend, where detection lives) — the step-0 sample reads as month/day/
  year from `Changed Date` evidence alone; `03.09.2026 15:06` reads as day.month; ISO with a
  time part; a file whose days are all ≤ 12 reports several candidates; a file mixing
  `9/22/2026` and `22/9/2026` is refused; `31.9.2026` eliminates day.month.
- `test_team_achievement.py` (new) — the whole grid over a seeded two-project team: Committed
  vs Achieved diverging, a project with no matching sprint, a project with no `done` State,
  "outside the calendar" and "done but undated" counts, and the guard (a reader may `GET` it).
- `test_project_snapshots.py` — `completed_on` round-trips; a snapshot payload without the key
  restores as `NULL`.
- `test_migrations.py` — the new revision applies and is reversible.

### Frontend (Vitest)

- `ProjectStatesModal.test.tsx` — the category select renders per entry, saves, and is **not**
  prefilled from the State's wording (assert `Done` arrives with category `null`).
- `PBIFormModal.test.tsx` — the date field is disabled until a done-category State is chosen,
  prefills today on the transition, and clears on the way out.
- `AchievementView.test.tsx` (new) — rows and totals from a mocked response; a `manual` project
  excluded from the PD total with the reason shown; the three §5.5 footers; `—` for an undated
  sprint; the no-`done`-State empty state; the no-anchor-project empty state.
- `EditAssignmentModal.test.tsx` (new — the modal has no test today) — the suggestion renders, `[Use this value]` fills the input
  without saving, and nothing renders with no closed sprints.

### E2E — `frontend/cypress/e2e/achievement.cy.ts`

One journey: import a CSV, mark `Done` as a done State in the States editor, complete a story,
open the team and read the number off the Achievement column. Plus: a story completed outside
the calendar appears in the footer, not in a column.

The suite's three standing rules apply — no URL routing (`cy.openTeam`, `cy.openProject`),
`cy.enterEditMode()` for anything that writes, and anchored regexes for action labels. Note that
`Done` is both a State value and a plausible button label, so assertions on it must be scoped.

### Contract

`scripts/openapi.sh` after every schema change in §8.1; `scripts/check.sh --check` on the pair is
part of the gate. `docs/csv-import-logic.md` gains the `Closed Date` row in its column table and a
`10-closed-dates.csv` sample, since that document is the importer's user-facing contract.

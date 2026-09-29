# CSV Import — what it does, and what it won't do

Backlog → **Import CSV**. The file is meant to be an Azure DevOps query export
(*Features*, *Product Backlog Items*, *Bugs*), but any CSV with the right column
names works.

Nothing is written until you press **Confirm Import**, and before that you are
shown exactly what pressing it will do — see [the review step](#the-review-step).
The whole file is applied as one change: either all of it lands, or none of it
does.

Ready-made files to try this out with are in [`csv-samples/`](csv-samples/) — see
the table at the end.

## The three rules everything follows

1. **Placement comes only from a clear `Iteration Path`.** An item moves on the PI
   board only when its path matches one you set on a PI or sprint — see
   [Placing items on the PI board](#placing-items-on-the-pi-board). Everything else is updated where it sits, and
   new items land in the backlog.
2. **The `ID` column is the identity.** An ID the project already knows is
   updated; an unknown or blank ID creates a new item. Titles are never matched.
3. **The file is not a mirror.** Items missing from the file are left alone.
   Deleting only ever happens through `State=Removed`, and only after you tick
   the item on the confirmation screen.

You need **Edit Mode** to import. Everyone else sees the result live.

---

## Columns

Comma-separated, with a header row. Column order doesn't matter, and any extra
columns are ignored.

| Column | Used for | Notes |
|---|---|---|
| `Work Item Type` | Required | `Feature`, `Product Backlog Item` or `Bug`. Anything else is an error. |
| `ID` | The business ID | 1–999 999. May be blank → always creates a new item. |
| `Title 1` | Feature title | Also used as a story's title if `Title 2` is blank. |
| `Title 2` | Story / bug title | |
| `Effort` | Story / bug effort | Only `0, 0.5, 1, 2, 3, 5, 8, 13, 21`. `0,5` and `0.5` both work. **Ignored on features** — a feature's effort is the sum of its stories. |
| `Parent` | Which feature a story belongs to | See *Parent* below. |
| `State` | The item's State, or the delete instruction | See *State* below. |
| `Closed Date` | When a story or bug was completed | See *Completion dates* below. |
| `Resolved Date` | Fallback for `Closed Date` | Used only where `Closed Date` is blank. |
| `Iteration Path` | PI and sprint placement | See [Placing items on the PI board](#placing-items-on-the-pi-board). |

Not imported: **descriptions**, comments, assignees, tags, area paths, and every
other date (`Changed Date`, `Created Date`, …). Those other date
columns are still worth exporting, because they help the import work out the
file's date format (see below). An item's existing description in the planner is never overwritten by an
import.

### Parent

The cell must start with the parent feature's ID. All of these resolve to
feature 101:

```
101          #101          101 Authentication          101: Authentication
```

A cell with no leading ID (`Authentication`) is an **error** — it isn't silently
treated as "no parent".

A blank `Parent` is fine and means "no parent" (see *Orphans*).

The parent may be a feature listed in this file **or** a feature already in the
project. That is what makes partial exports work — you can import this sprint's
new stories alone without re-sending the whole tree.

### State

| In the file | Effect |
|---|---|
| No `State` column at all | States are left exactly as they are. |
| A value (`New`, `Active`, `In Review`, …) | Set on the item. Unknown values are **added to the project's State list** automatically. Matching ignores case and spacing. |
| Blank cell | Clears the item's State. |
| `Removed` (any casing) | Not a State — it's a delete instruction. See below. |

Features, stories and bugs each have their own State list, so `Active` on a Bug
and `Active` on a Feature are separate entries.

A State that an import adds to a list arrives **uncategorised**. Whether `Done`,
`Closed` or `Ready for Release` means *done* is set by hand in the States editor
(Edit Project → Manage States…), never read from the word itself. Once a State is
marked *done*, an import that moves a story or bug into it records today as the
item's completion date, and one that moves it back out clears the date. Items
already in a *done* State when it gets marked keep no date: nothing is backdated.

### Completion dates

Velocity needs to know **when** each story or bug was finished. Add the
`Closed Date` column to your Azure DevOps query before exporting, and the import
takes those dates instead of stamping today.

| In the file | Effect |
|---|---|
| Neither `Closed Date` nor `Resolved Date` | Completion dates are left exactly as they are. |
| A date in `Closed Date` (else `Resolved Date`) | Becomes the item's completion date, if its State is marked *done*. |
| A date on an item whose State is **not** *done* | Ignored, and the row is listed in the review as a warning. |
| Both cells blank | Nothing changes. An item moving into a *done* State gets today's date, as it would without the column. |

A blank cell never clears a date. If your project marks a State as *done* that
Azure DevOps doesn't treat as completed (`Ready for Release`, say), ADO leaves
`Closed Date` blank for those items, and the date the planner recorded when they
entered that State is kept. A date is cleared only when the item moves out of a
*done* State.

`Resolved Date` is there for bugs. If your project counts a bug's `Resolved` State
as *done*, Azure DevOps leaves `Closed Date` blank until the bug is closed, and the
import falls back to `Resolved Date`. `Changed Date` is never used: it moves on
every edit, so a story closed on 3 September and touched on the 22nd would count
in the wrong sprint.

Features take no completion date. Their effort is the sum of their stories, so
counting them too would count every point twice.

#### The date format

Azure DevOps writes dates in the format of the computer that exported the file,
not in a fixed one: `9/3/2026 3:06:02 PM` on one machine, `03.09.2026 15:06` on
another. The import never assumes a format and never guesses one date at a time.
A file comes from a single export, so it has a single format, and the import works
that format out from **every** date in the file, in every date column.

- **One format fits every date.** It is used, and the review names it along with
  the date that decided it: *"Dates read as month/day/year (9/22/2026 settles
  it)"*.
- **Several formats fit.** This happens when every day in the file is 12 or lower,
  so `6/3/2026` could be 3 June or 6 March. The import asks you to pick the format
  and shows a few dates as they will be read, so a wrong pick is visible before
  you confirm. The next import for the same project starts from your last answer.
- **No single format fits.** The file is refused, and the dates that don't agree
  are listed.

This is why `Changed Date` is worth exporting even though it is never imported:
every row has one, so it usually settles the format on its own.

Accepted shapes: `2026-09-03`, `3.9.2026`, `9/3/2026` and `3/9/2026`, with or
without leading zeros, and with or without a time (24-hour or AM/PM). The time is
dropped.

### Iteration Path

Places features and stories on the PI board. It has a chapter of its own:
[Placing items on the PI board](#placing-items-on-the-pi-board).

---

## What happens to each row

### Features

| Situation | Result |
|---|---|
| ID is new, or blank | Feature created in the backlog — then placed on the board if its `Iteration Path` matches. |
| ID already exists as a feature | Title (and State) updated, wherever it lives. Its placement changes only through `Iteration Path`. |
| The feature was **split across PIs** | Title and State are applied to *every* part of it, so later PIs don't keep showing the old text. |
| ID exists as a *story* | See *Type changes*. |

### Stories and bugs

| Situation | Result |
|---|---|
| ID is new, or blank | Story created under the feature its `Parent` names — then placed in a sprint if its `Iteration Path` matches. |
| ID already exists | Title, Effort, type (story ↔ bug) and State updated **in place**. It keeps its sprint and group unless its `Iteration Path` says otherwise. |
| `Parent` names a feature that was split across PIs | A *new* story joins the newest part — the PI the work has actually reached. |
| `Parent` names a different feature than the one holding it | Not moved unless you ask. See *Re-parenting*. |
| Story ↔ bug switched, file has no `State` column | The State is cleared, because the old value belongs to the other list. |

### Orphans

A story is an orphan when `Parent` is blank, or names an ID that is neither in
the file nor in the project.

- **New** orphan stories are created under a placeholder feature called
  **"Unassigned"** in the backlog. The same placeholder is reused on every
  import, so you don't collect a pile of them.
- **Existing** orphan stories are left exactly where they are — an import never
  detaches something you already parented by hand. The summary names the feature
  they were found under.

---

## Placing items on the PI board

Azure DevOps already knows which PI, and often which sprint, each item is in. The
import can use the `Iteration Path` column to put features and stories there, so a
regular refresh doesn't mean redoing every placement by hand.

It only acts when the path is **clear**. Anything unclear leaves existing items where
planning put them, and new items go to the backlog as they always have.

### 1. Tell the planner which iteration each PI and sprint is

In Edit Mode, click **Edit** next to the PI in the PI list (closed PIs can't be edited):

- **Iteration path** — the PI's ADO iteration, e.g. `Planner\PI 08`.
- The sprint table's **Iteration path** column — each sprint's ADO iteration, e.g.
  `Planner\PI 08\Sprint 08.1`.

Copy them from Azure DevOps as they are; nothing is guessed from PI or sprint names.
Matching ignores upper/lower case, `/` versus `\`, and stray spaces or trailing
separators, so `planner / pi 08/` matches `Planner\PI 08`. One path can belong to only
one PI or sprint per project — saving a duplicate is refused with the name of the path.

Leave a sprint's path blank if ADO doesn't schedule to that sprint; items are then
placed in the PI without a sprint.

### 2. Keep it on, or switch it off

When the file has an `Iteration Path` column, the import dialog shows **Place items on
the PI board from Iteration Path**, **ticked by default**. Untick it and the import
behaves as if the column weren't there. A file without the column never changes a
placement.

If no PI in the project has a path yet, the dialog warns you: nothing could match.

### 3. How a cell is read

| The cell | Means |
|---|---|
| Matches a sprint's path | That sprint, in that sprint's PI |
| Matches a PI's path | That PI, no sprint |
| Blank | Not clear — nothing moves |
| Matches nothing (the ADO root `Planner`, a PI not mapped yet, a typo) | Not clear — nothing moves |

For anything *not clear*, a **new** item stays in the backlog and an **existing** item
stays exactly where it is. The import never moves an item back to the backlog because
of a path. The review lists every unmatched path once, with how many rows carry it —
usually that is a PI you haven't mapped yet.

### 4. Features

Features are placed before stories, so a feature and its stories that moved together
in ADO land together in one import.

| The feature is | The path names PI `P` → result |
|---|---|
| In the backlog | Placed in `P`, in the lane **Needs Swimlane** |
| Already in `P` | Nothing changes — it keeps the lane you gave it |
| In another PI | Moved to `P`: into the lane with the **same name** if `P` has one (teams usually recur PI after PI), else **Needs Swimlane**. Its stories leave their sprints, because *Sprint 2* of one PI is not *Sprint 2* of another; stories that are in the file are placed again by their own path |
| Split across PIs | Nothing changes if one of its parts is already in `P`; otherwise left alone and reported. A split is a board decision the CSV can't express |

A feature row whose path names a *sprint* is placed in that sprint's PI — features
don't go into sprints.

### 5. Stories and bugs

A story always stays in its feature's PI. Its path decides the **sprint** within that
PI, and never moves the feature.

| Situation | Result |
|---|---|
| Its feature is in the backlog | Left alone — *"its feature is in the backlog"* |
| Its feature is in a different PI than the path names | Left alone — *"its feature is in PI 07"* |
| Path names a sprint; the story is in no sprint | Placed directly in that sprint |
| Path names a sprint; the story is placed directly in another sprint | Moved to that sprint |
| Path names the sprint it is already in | Nothing changes |
| Path names the PI only; the story is placed directly in a sprint | Taken out of the sprint (ADO moved it back to the PI) |
| The story is in a **named group** | Left alone, whatever the path says. A group is a planning decision; the review names the group and its sprint |

"Placed directly" is a story dragged onto a sprint on its own, not as part of a group
you named.

### 6. What placement never does

- create a PI — an ADO iteration the planner doesn't have is reported, not created;
- move anything into or out of a **closed** PI — closed PIs stay read-only;
- move an item to the backlog;
- choose a real swimlane — ADO has nothing that maps to one;
- change a named group, or a feature split across PIs.

### 7. The Needs Swimlane lane

Every feature that arrives in a PI without a lane to go to lands in **Needs Swimlane**
— one per PI, created the first time it's needed, added at the bottom of the board.
It is your triage queue: drag each feature into its real lane when you get to it.

It is an ordinary lane in every other way. Rename it and it becomes a normal lane; the
next import that needs one creates a fresh Needs Swimlane. Delete it and its features
go back to the backlog, as with any lane.

### 8. A typical refresh

PI 08 has path `Planner\PI 08` and sprints `…\Sprint 08.1` to `…\Sprint 08.5`; PI 09
isn't mapped yet.

| Row | Iteration Path | Before | After |
|---|---|---|---|
| Feature 101 | `Planner\PI 08` | backlog | PI 08 · Needs Swimlane |
| Story 201 (of 101) | `Planner\PI 08\Sprint 08.1` | backlog | PI 08 · Sprint 1 |
| Story 202 (of 101) | `Planner\PI 08\Sprint 08.3` | PI 08 · Sprint 2, placed directly | Sprint 3 |
| Story 203 (of 101) | `Planner\PI 08\Sprint 08.3` | PI 08 · group "Release 1", Sprint 2 | unchanged — named group |
| Feature 102 | `Planner\PI 09` | backlog | unchanged — `Planner\PI 09` listed as unmatched |
| Feature 103 | `Planner` | PI 08 · Team A | unchanged — the ADO root matches nothing |

The review shows these as **Placed** (with `→ PI 08 · Needs Swimlane`,
`→ Sprint 1`, `Sprint 2 → Sprint 3`) and **Left alone** (with the reason) before
anything is written. Importing the same file again changes nothing.

---

## The three decisions the import asks you to make

Each one is off by default, because each can undo planning work that the CSV has
no way of knowing about.

### 1. Removals (`State=Removed`)

Rows marked `Removed` are never imported as items. If a removed row's ID matches
something in the project, you get a **per-item list before the import runs**:
everything is kept unless you tick it.

Deleting is permanent and cascades:

- a feature takes its stories, its groups and its later-PI parts with it;
- active child rows in the *file* whose parent feature is being removed are
  dropped from the import too — unless you keep the parent, in which case they
  come back in.

> ⚠️ `Removed` is only a delete instruction *on import*. It can also exist as an
> ordinary State you added by hand, and re-importing an item labelled that way
> **will delete it**.

### 2. Re-parenting

If an existing story's `Parent` names a different feature, the import reports it
and offers a tick-box. Left unticked, nothing moves.

Applying the move takes the story out of its group and onto its new parent's PI
and swimlane — so a story sitting in a sprint **loses that placement**. The
preview says how many are affected.

A story sitting under another part of the *same* split feature does not count as
a move: that split is a board decision the CSV can't express.

### 3. Type changes

When an ID exists in the project under the other kind of item:

| Direction | Behaviour |
|---|---|
| Story/Bug in the project → `Feature` in the file | Offered as a tick-box. Accepting deletes the story and creates the feature with the same ID, carrying the description across. Its **sprint placement is lost** — features aren't placed in sprints. Declining skips the row; the story is untouched. |
| Feature in the project → `Product Backlog Item`/`Bug` in the file | **Never applied**, only reported. A feature can hold stories, groups and later-PI parts with nowhere to go. Change it in the app first. |

---

## The review step

**Review changes** is the last screen before anything is written. It is not a
summary of the file — it is the outcome of the import, worked out by running it
against the project inside a transaction that is then thrown away. What it lists
is what will happen:

| It says | Meaning |
|---|---|
| **New** | Created. Stories say which feature they land under |
| **Updated** | Matched an existing item. Names the fields that differ, or says *no change* |
| **Moved** | Re-parented, as `old feature → new feature` |
| **Converted** | A story becoming a feature, and whether that costs a sprint placement |
| **Deleted** | Including the continuations and stories a removal reaches, which no row in your file mentions |
| **Unassigned** | An orphan going to the placeholder feature |
| **Placed** | Placed or moved on the PI board from its Iteration Path, e.g. `→ PI 08 · Needs Swimlane`, `Sprint 1 → Sprint 3` |
| **Left alone** | A change the import found and is not applying, with the reason |

Rows that change nothing are folded away behind **N rows unchanged**, which
expands. A refresh is mostly those — a file of 180 rows where two stories moved
would otherwise bury them — so the list shows what acts and counts the rest. If
nothing in the file changes anything, it says so instead of listing it.

**Back** returns to the previous screen and writes nothing — the trial run has
already been rolled back by then. Confirming sends the same request again for
real, so what you reviewed is what runs.

## What stops the import

These are reported per row, with the file's line number, and **nothing is
imported** until the file is fixed and re-selected:

- missing title;
- unknown `Work Item Type`;
- `ID` that isn't a whole number, or is outside 1–999 999;
- the same `ID` on two rows of the file;
- `Parent` that names no ID, or one outside 1–999 999;
- `Effort` that isn't a number, or isn't one of the allowed values;
- dates that no single date format can read (see *The date format*);
- a malformed CSV structure (reported against the line it occurs on).

## Not supported

- **Assigning a swimlane or group.** Iteration Path places items in a PI and sprint
  only; swimlanes and named groups are arranged in the app.
- **Creating PIs.** An Iteration Path naming a PI the planner doesn't have is
  reported, not created.
- **Descriptions, assignees, tags, links** — not read, not written. Of the
  dates, only `Closed Date` and `Resolved Date` are imported.
- **Effort on features** — always derived from the stories underneath.
- **Deleting by omission.** An item missing from the CSV stays.
- **Demoting a feature to a story.**
- **Undo.** Imports and their deletions are permanent — take a snapshot first if
  you're unsure.
- **Re-importing the PI CSV export.** That export is a board report with a
  different set of columns; it is not an import format.
- **Excel workbooks (`.xlsx`).** Save as CSV first.

---

## Sample files

In [`csv-samples/`](csv-samples/). Import them into a scratch project, in order —
several of them are built to be applied *after* `01-basic.csv`.

| File | Shows |
|---|---|
| `01-basic.csv` | A clean first import: two features, stories, a bug, States. |
| `02-update.csv` | Re-import: updates existing items, adds one, leaves the rest alone. |
| `03-orphans.csv` | Blank and unresolvable `Parent` → the "Unassigned" feature. |
| `04-removed.csv` | `State=Removed`, the reconcile screen, and children dropped with their parent. |
| `05-no-state-column.csv` | A file with no `State` column — States left untouched. |
| `06-parent-formats.csv` | The `Parent` cell shapes Azure DevOps writes. |
| `07-type-change.csv` | A story exported as a Feature (offered) and a feature exported as a story (blocked). |
| `08-reparent.csv` | A story whose `Parent` changed — the opt-in move. |
| `09-errors.csv` | One of each validation error. Nothing is imported. |
| `10-closed-dates.csv` | A real Azure DevOps export shape: completion dates, a month/day/year format settled by `Changed Date`. |
| `11-dates-ambiguous.csv` | Every day is 12 or lower, so the import asks for the date format. |
| `12-iterations.csv` | Iteration Path placement: a feature into PI 08, stories into its sprints, one unmapped PI reported. |

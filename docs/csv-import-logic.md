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

1. **Imports land in the backlog.** A CSV can never set a PI, swimlane or sprint.
   Items already on the PI board are still *updated* by an import, they just
   don't move.
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

Not imported: **descriptions**, comments, assignees, dates, tags, area/iteration
paths. An item's existing description in the planner is never overwritten by an
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

---

## What happens to each row

### Features

| Situation | Result |
|---|---|
| ID is new, or blank | Feature created in the backlog. |
| ID already exists as a feature | Title (and State) updated, wherever it lives. |
| The feature was **split across PIs** | Title and State are applied to *every* part of it, so later PIs don't keep showing the old text. |
| ID exists as a *story* | See *Type changes*. |

### Stories and bugs

| Situation | Result |
|---|---|
| ID is new, or blank | Story created in the backlog under the feature its `Parent` names. |
| ID already exists | Title, Effort, type (story ↔ bug) and State updated **in place** — it keeps its PI, sprint and group. |
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
| **Left alone** | A change the import found and is not applying, with the reason |

A refresh where most rows are unchanged says so, row by row. That is usually the
point: it is how you tell "this file is a no-op" from "this file is about to
rewrite forty titles".

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
- a malformed CSV structure (reported against the line it occurs on).

## Not supported

- **Assigning a PI, swimlane, sprint or group.** Board placement is done in the
  app, never by a file.
- **Descriptions, assignees, dates, tags, links** — not read, not written.
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

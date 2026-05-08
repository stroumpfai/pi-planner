# CSV Import Specification

## Purpose

Allow a Product Owner to import Features and Stories (PBIs and Bugs) from an Azure DevOps–style CSV export into a project's backlog.

---

## 1. Entry Point

The import is triggered from the **project backlog view**. A button "Import CSV" is available to users with edit access. The target project is the one currently open — no additional project selection is needed.

---

## 2. CSV Format

### Expected columns (in any order)

| Column | Description |
|---|---|
| `State` | Item lifecycle state. Used only for filtering. |
| `ID` | External numeric ID. Stored as the item's **user_id**. |
| `Work Item Type` | Determines the imported entity type. |
| `Title 1` | Title of a Feature (empty for stories). |
| `Title 2` | Title of a PBI or Bug (empty for features). |
| `Effort` | Story points estimate. Optional. |
| `Parent` | External ID of the parent item. |

### Column mapping

| CSV value | Application entity |
|---|---|
| `Feature` | Feature |
| `Product Backlog Item` | Story of type **PBI** |
| `Bug` | Story of type **Bug** |

### Columns not mapped

- `State` — used only to filter rows (see §3); not stored.
- `Parent` on Features — Features in the CSV reference Epics that do not exist in the application. The parent column is ignored for Features; all Features are imported at project level.

---

## 3. Row Filtering (pre-import)

Before any import logic runs, rows where **`State` = `Removed`** are silently discarded. All other states (`New`, `Estimated`, `In Progress`, …) are included.

---

## 4. Title Resolution

Features use **`Title 1`**. Stories (PBIs and Bugs) use **`Title 2`** with a fallback to **`Title 1`** when `Title 2` is blank. A story row where both `Title 1` and `Title 2` are empty is treated as invalid (see §7).

---

## 5. Effort Handling

- Blank `Effort` → stored as `null` (no effort set).
- `Effort` = `0` → stored as `null` (treated as no effort).
- Positive integer → stored as-is.
- Non-numeric, non-blank value → treated as invalid row (see §7).

---

## 6. Parent Resolution and Orphan Handling

### Features
Features have no application-level parent. The `Parent` column is ignored for Features.

### Stories (PBIs and Bugs)
The `Parent` value is matched against the `ID` of a **Feature row in the same CSV**. Stories are grouped under the Feature they reference.

**Orphan stories** are those where:
- the `Parent` column is blank, or
- the `Parent` ID does not match any Feature row in the CSV (e.g. parent is an Epic not present in the file).

Orphan stories are collected and placed under an auto-created Feature named **"Unassigned"** in the project backlog. This placeholder Feature is only created if at least one orphan story exists.

---

## 7. Validation (All-or-Nothing)

The import is **atomic**: if any row fails validation, the entire import is cancelled and nothing is written to the database. The UI displays a list of all validation errors with the row number and a description, so the user can fix the source CSV and retry.

### Validation rules

| Rule | Error message |
|---|---|
| Missing title (Title 1 and Title 2 both blank) | Row {n}: missing title |
| Unknown `Work Item Type` value | Row {n}: unknown type "{value}" |
| Non-numeric, non-blank `Effort` | Row {n}: effort must be a number |
| Duplicate `ID` within the CSV itself | Row {n}: ID {id} appears more than once in this file |

---

## 8. Duplicate Handling (IDs already in the project)

If an item's `ID` already exists as a `user_id` in the target project, the existing item is **updated** with the values from the CSV:

- **Feature**: title is overwritten.
- **Story (PBI / Bug)**: title, effort, and item_type are overwritten.

Updated items are counted separately in the post-import report. The parent relationship of an existing story is **not** changed by the import.

---

## 9. Import Process (Step-by-Step)

1. User clicks **"Import CSV"** in the backlog view.
2. A file picker opens; user selects a `.csv` file.
3. The file is parsed client-side for a preview.
4. A **preview summary** is shown before confirming:
   - Total rows in file
   - Removed rows (filtered out)
   - Features to import / skipped (duplicates)
   - Stories to import / skipped (duplicates)
   - Orphan stories (will land in "Unassigned" feature)
   - Validation errors (if any — import is blocked until resolved)
5. User clicks **"Confirm Import"**.
6. Backend receives the parsed payload, re-validates, and executes in a single transaction:
   - Insert non-duplicate Features into the project backlog.
   - If orphan stories exist, create the "Unassigned" placeholder Feature.
   - Insert non-duplicate Stories, linked to their resolved parent Feature.
7. Success screen shows: counts of imported Features and Stories, count of skipped duplicates.

---

## 10. Post-Import Report

After a successful import the UI shows:

- **Created**: X features, Y stories (new items)
- **Updated**: X features, Y stories (existing items overwritten)
- **Orphan stories placed in "Unassigned"**: count (if any)

The report does not persist; it is shown once and dismissed.

---

## 11. Constraints & Limitations

- Only `.csv` files are accepted. Other file types are rejected before parsing.
- The importer does not create or assign PI, swimlane, sprint, or group associations. All items land in the **backlog** (`location = "backlog"`).
- The `user_id` values from the CSV must fit the application's 1–999 999 range. IDs outside this range are treated as invalid rows (see §7).
- The "Unassigned" placeholder Feature created for orphans has no user_id (it is left blank) and can be renamed or deleted by the user after import.
- The `description` field is not present in this CSV format; imported items have no description.

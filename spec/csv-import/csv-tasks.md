# CSV Import — Implementation Tasks

Reference spec: `spec/csv-import/csv-import.md`  
Sample file: `spec/csv-import/sample.csv`

---

## Architecture Summary

The import follows a two-phase flow:

1. **Client-side parse** — browser reads the file, runs all structural validation (missing title, unknown type, bad effort, intra-CSV duplicate IDs), and displays a preview summary. No network request yet.
2. **Server-side import** — on confirm, the frontend sends structured JSON rows to the backend. The backend re-validates, resolves DB-level duplicates (existing `user_id`s), and executes the full insert in a single transaction.

The frontend sends **parsed rows** (JSON), not raw CSV bytes, so the backend never touches file I/O.

---

## Phase 1 — Backend

### B1 · Import schemas

**File:** `backend/app/schemas/csv_import.py` *(new)*

Define Pydantic models:

```
CsvRow
  row_number: int          # 1-based, for error messages
  item_type: "feature" | "pbi" | "bug"
  user_id: int | None      # from ID column; None if blank
  title: str
  effort: int | None       # 0 and blank both arrive as None
  parent_id: int | None    # CSV ID of parent feature; None for features / orphans

CsvImportRequest
  rows: list[CsvRow]       # only non-Removed rows, pre-filtered by client

CsvImportResult
  created_features: int
  created_stories: int
  updated_features: int    # features whose user_id already existed → overwritten
  updated_stories: int     # stories whose user_id already existed → overwritten
  orphan_stories: int      # stories placed in auto-created "Unassigned" feature
```

Export from `backend/app/schemas/__init__.py`.

---

### B2 · Import service

**File:** `backend/app/services/csv_import.py` *(new)*

Single async function `execute_import(db, project_id, rows) -> CsvImportResult`.

Steps inside a single DB transaction:

1. **Re-validate all rows** — collect all errors before touching the DB.
   - Missing title → error
   - Unknown `item_type` value → error (defensive; client should catch this too)
   - `user_id` outside 1–999 999 range → error
   - Intra-CSV duplicate `user_id` values → error
   - If any errors exist: raise `HTTPException 422` with the full error list.

2. **Fetch existing user_ids** — query `features` and `pbis` tables for all `user_id` values already in the project. Build a `set[int]` for O(1) lookup.

3. **Separate features from stories.** Build `feature_by_csv_id: dict[int, CsvRow]` for parent resolution.

4. **Upsert Features**:
   - If `user_id` not in existing set → insert new `Feature`, `location="backlog"`.
   - If `user_id` already exists → update `title` on the existing Feature.
   - Capture the mapping `csv_id → system_id` for linking stories (use existing `system_id` when updating).

5. **Resolve story parents.** For each story row:
   - If `parent_id` resolves to a feature in the CSV → link to that feature's `system_id`.
   - Otherwise (blank parent or parent not a Feature row) → mark as orphan.

6. **Create "Unassigned" placeholder** if any orphans exist:
   - `Feature(title="Unassigned", user_id=None, location="backlog")`.

7. **Upsert Stories**:
   - If `user_id` not in existing set → insert new PBI, `location="backlog"`, linked to parent from step 5/6.
   - If `user_id` already exists → update `title`, `effort`, and `item_type` on the existing PBI. Parent link is **not** changed.
   - Set `item_type` = `"pbi"` or `"bug"`.

8. **Commit** and return `CsvImportResult`.

---

### B3 · Import route

**File:** `backend/app/routes/csv_import.py` *(new)*

```
POST /api/v1/projects/{project_id}/import/csv
  Auth: requires edit lock (get_current_user dependency)
  Body: CsvImportRequest
  Response 200: CsvImportResult
  Response 404: project not found
  Response 422: validation errors  →  { errors: [{ row: int, message: str }] }
```

Delegate entirely to the service from B2.

---

### B4 · Wire up route

**File:** `backend/app/main.py`

Add `from app.routes import csv_import` and `app.include_router(csv_import.router)`.

---

## Phase 2 — Frontend

### F1 · Install papaparse

The CSV contains quoted fields with embedded commas and escaped double-quotes (`""`). A hand-rolled splitter will break on these edge cases.

```bash
npm install papaparse
npm install -D @types/papaparse
```

---

### F2 · Client-side CSV parser utility

**File:** `frontend/src/utils/csvParser.ts` *(new)*

Exports one function: `parseImportCSV(text: string): ParseResult`

```
ParseResult {
  rows: ParsedRow[]          # valid rows only, Removed already dropped
  removedCount: number
  errors: ParseError[]       # { row: number; message: string }
}

ParsedRow {
  rowNumber: number
  itemType: 'feature' | 'pbi' | 'bug'
  userId: number | null
  title: string
  effort: number | null
  parentId: number | null
}
```

Logic:
- Use `papaparse.parse(text, { header: true, skipEmptyLines: true })`.
- Drop rows where `State === 'Removed'`.
- Map `Work Item Type`: `"Feature"` → `feature`, `"Product Backlog Item"` → `pbi`, `"Bug"` → `bug`.
- Title resolution: Feature uses `Title 1`; PBI/Bug uses `Title 2` falling back to `Title 1`.
- Effort: blank or `"0"` → `null`; positive integer string → parse; anything else → error.
- Collect all errors across all rows (do not stop at first).
- After row errors, check for intra-file duplicate `ID` values → add errors.
- `userId` outside 1–999 999 → error.

---

### F3 · Preview builder utility

**File:** `frontend/src/utils/csvParser.ts` (same file, additional export)

Exports `buildPreview(result: ParseResult): ImportPreview`

```
ImportPreview {
  totalRows: number          # before filtering
  removedRows: number
  featureCount: number       # non-Removed features
  storyCount: number         # non-Removed PBIs + Bugs
  orphanCount: number        # stories whose parentId doesn't resolve to a Feature row
  errors: ParseError[]
  hasErrors: boolean
}
```

Orphan detection: build a `Set` of all `userId` values of feature rows in the file, then count stories whose `parentId` is not in that set (or is null).

---

### F4 · Import API service and hook

**File:** `frontend/src/services/csvImport.ts` *(new)*

```typescript
import type { CsvImportRequest, CsvImportResult } from '@/types'

export const csvImportApi = {
  execute: (projectId: string, body: CsvImportRequest) =>
    apiClient.post<CsvImportResult>(`/api/v1/projects/${projectId}/import/csv`, body)
}
```

**File:** `frontend/src/hooks/useCsvImport.ts` *(new)*

`useCsvImport(projectId)` — React Query `useMutation` wrapping `csvImportApi.execute`. On success, invalidates `['features', projectId]`.

---

### F5 · Update generated types

**File:** `frontend/src/types/api.generated.ts`

Add schemas matching B1:

```typescript
CsvRow: {
  row_number: number
  item_type: 'feature' | 'pbi' | 'bug'
  user_id: number | null
  title: string
  effort: number | null
  parent_id: number | null
}

CsvImportRequest: {
  rows: CsvRow[]
}

CsvImportResult: {
  imported_features: number
  imported_stories: number
  skipped_ids: number[]
  orphan_stories: number
}
```

Export aliases from `frontend/src/types/index.ts`.

---

### F6 · ImportCSVModal component

**File:** `frontend/src/components/ImportCSVModal.tsx` *(new)*

Three internal views driven by a `step` state: `'preview' | 'importing' | 'done' | 'error'`.

**Preview view** (after client parse):
- Show `ImportPreview` summary table:
  - Rows in file / Removed (filtered)
  - Features to import
  - Stories to import (PBIs + Bugs)
  - Orphan stories → "will be placed in Unassigned feature"
- If `hasErrors`: render error list (row + message), disable "Confirm Import" button.
- Buttons: "Cancel" / "Confirm Import" (disabled while `hasErrors || importing`).

**Importing view**: spinner + "Importing…" text (shown while mutation is in flight).

**Done view** (success):
- "Import complete" heading
- Created: X features, Y stories
- Updated: X features, Y stories (shown only if > 0)
- If `orphan_stories > 0`: "X orphan stories placed in 'Unassigned' feature"
- Single "Close" button — parent refreshes features on close.

**Error view** (backend 422):
- "Import failed" heading
- List of server-side validation errors.
- "Close" button.

Props:
```typescript
interface Props {
  open: boolean
  projectId: string
  file: File | null
  onClose: () => void
}
```

The modal reads and parses `file` in a `useEffect` (triggered when `file` changes and `open` is true).

---

### F7 · Import CSV button in BacklogPage

**File:** `frontend/src/pages/BacklogPage.tsx`

Changes:
- Add `selectedFile: File | null` state and `showImport: boolean` state.
- Add a hidden `<input type="file" accept=".csv">` ref.
- Add "Import CSV" button next to "New feature" in the header toolbar.
  - Disabled when `!isEditing`.
  - On click: trigger the hidden file input.
- On file input `onChange`: set `selectedFile` and `showImport = true`.
- Render `<ImportCSVModal open={showImport} projectId={projectId} file={selectedFile} onClose={...} />`.
- On modal close: reset `selectedFile = null`, `showImport = false`.

---

## Task Order (with dependencies)

```
B1  →  B2  →  B3  →  B4        (backend, sequential)
F1  →  F2  →  F3              (npm install then utilities, independent of backend)
F4  →  F5                     (API service depends on types)
B1, F3, F4, F5  →  F6  →  F7  (modal needs types, preview, and hook)
```

All backend tasks can be done in parallel with F1–F3. F4 onward requires B1 (for types) to be done.

---

## Edge Cases to Test

| Scenario | Expected behaviour |
|---|---|
| All rows are `Removed` | Preview shows 0 features, 0 stories; import produces empty result |
| Feature with no `user_id` (blank ID) | Valid; imported with `user_id = null` |
| Story referencing a Feature whose row was updated (duplicate ID) | The existing feature is updated; the story links to that existing feature's `system_id` |
| Two stories reference same Feature ID which already exists in DB | Both stories link to the updated existing feature |
| CSV has only stories, no features | All stories are orphans; one "Unassigned" feature is created |
| Effort = `"abc"` | Validation error on that row; entire import blocked |
| ID = `1000000` (out of range) | Validation error on that row |
| File is not valid CSV | `papaparse` returns parse errors; shown as top-level error before preview |

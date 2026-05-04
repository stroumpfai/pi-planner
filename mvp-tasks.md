# PI Planning — Phase 1 MVP Implementation Plan

## Status Key
- `[ ]` Not started
- `[~]` In progress
- `[x]` Done
- `[R]` Needs review

---

## Already Done

- [x] Repo structure (backend + frontend directories, configs)
- [x] SQLAlchemy models for all 10 tables + Alembic migration
- [x] Pydantic schemas for all resources
- [x] Route stubs for all endpoints (return 501)
- [x] FastAPI app wiring (CORS, lifespan, router registration)
- [x] Auth service (bcrypt, itsdangerous sessions, HTTP-only cookie)
- [x] Auth routes: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- [x] Default admin seed on first run (`admin` / `admin`)
- [x] Edit lock routes: acquire, release, keepalive (with SSE broadcast)
- [x] SSE broadcaster + `/projects/{id}/events` streaming route
- [x] Frontend: Vite + React 18 + TypeScript + Tailwind CSS
- [x] Frontend: Vitest (11 passing tests), Cypress scaffold
- [x] Frontend: Zustand stores (ui, auth, drag)
- [x] Frontend: React Query client + typed API service modules
- [x] Frontend: React Query hooks for all resources
- [x] Frontend: Login page (react-hook-form + zod)
- [x] Frontend: Auth-gated App shell (shows login if unauthenticated)
- [x] Frontend: EditLockButton component with keepalive heartbeat
- [x] Frontend: useSSE hook (invalidates React Query on server events)

---

## Milestone 1 — Projects CRUD

> **Goal:** Users can create, rename, and delete projects, and see a project list after login.

### 1A · Backend

- [x] `GET /api/v1/projects/` — list all projects (ordered by `modified_at` desc)
- [x] `POST /api/v1/projects/` — create project (unique name constraint → 409 on duplicate)
- [x] `GET /api/v1/projects/{id}` — get single project
- [x] `PATCH /api/v1/projects/{id}` — update name/description
- [x] `DELETE /api/v1/projects/{id}` — delete project (cascade all data)
- [x] `GET /api/v1/projects/{id}/export` — download full project as JSON
- [x] All mutating routes require `get_current_user` dependency
- [x] SSE broadcast `project:updated` / `project:deleted` on mutations

### 1B · Frontend

- [x] `ProjectListPage` — shows all projects, "New Project" button, export button per row
- [x] `CreateProjectModal` — form with name + description, zod validation
- [x] `useProjects` hook wired to real API (not stub)
- [x] Navigate into a project (store `activeProjectId` in Zustand `uiStore`)
- [x] App shell: project selector in header, sign-out button

### 1C · Testing

- [x] Backend integration tests: project CRUD happy path + duplicate name 409 (12 tests)
- [x] Backend integration test: export returns correct JSON shape
- [x] Frontend component test: `ProjectListPage` renders project names
- [x] Frontend component test: `CreateProjectModal` validates required name
- [x] Frontend component test: `CreateProjectModal` shows 409 error inline
- [ ] **Manual smoke test:** create project → refresh → project persists

### 1D · Review checkpoint
- [x] Code review: routes, error handling, cascade delete
- [x] Confirm SSE events fire on project mutations

---

## Milestone 2 — Backlog: Features

> **Goal:** Within a project, users can create, view, edit, and delete Features in the backlog.

### 2A · Backend

- [x] `GET /api/v1/projects/{id}/features` — list features, sorted by `created_at` desc; support `?sort=name`
- [x] `POST /api/v1/projects/{id}/features` — create feature (validate `user_id` range 1-999999, uniqueness per project)
- [x] `GET /api/v1/features/{id}` — get feature
- [x] `PATCH /api/v1/features/{id}` — update all fields via `model_fields_set`; user_id uniqueness → 409 `ID_ALREADY_EXISTS`
- [x] `DELETE /api/v1/features/{id}` — delete feature + cascade PBIs + cascade groups
- [x] SSE broadcast `feature:created`, `feature:updated`, `feature:deleted`

### 2B · Frontend

- [x] `BacklogPage` — list filtered to `location=backlog`, sort toggle (localStorage), feature count
- [x] `FeatureRow` — `[id] Title` prefix, effort badge, expand toggle, edit/delete with edit-lock guard
- [x] `FeatureFormModal` — unified create/edit form (title required, description, effort, id); 409 error inline
- [x] Delete confirmation via reusable `ConfirmDialog`
- [x] Sort toggle: Newest / Name (persisted in `localStorage`)
- [x] `useFeatures` hook wired to real API with sort param
- [x] Edit lock guard: create/edit/delete disabled with tooltip when `isEditing=false`
- [x] `BacklogPage` wired into `App.tsx` (shown when `activeProjectId` is set)

### 2C · Testing

- [x] Backend: 18 integration tests — CRUD, duplicate user_id 409, sort, cascade, cross-entity uniqueness
- [x] Frontend: `FeatureRow` shows `[101]` prefix, hides prefix when null, disabled buttons
- [x] Frontend: `BacklogPage` empty state, renders features, edit-lock guard, sort buttons
- [ ] **Manual smoke test:** create feature → edit id → duplicate id shows error

### 2D · Review checkpoint
- [x] Code review: user_id uniqueness spans Features+PBIs via validation service
- [x] `model_fields_set` used for all PATCH fields (supports explicit null to clear user_id)
- [x] SSE events fire on all mutations

---

## Milestone 3 — Backlog: PBIs

> **Goal:** Users can expand a Feature in the backlog and manage its child PBIs.

### 3A · Backend

- [ ] `GET /api/v1/projects/{id}/pbis?feature_id={fid}` — list PBIs for a feature
- [ ] `POST /api/v1/projects/{id}/pbis` — create PBI (validate `parent_feature_system_id` exists in project; validate `user_id` uniqueness across Features+PBIs)
- [ ] `GET /api/v1/pbis/{id}` — get PBI
- [ ] `PATCH /api/v1/pbis/{id}` — update title/description/effort/user_id
- [ ] `DELETE /api/v1/pbis/{id}` — delete PBI; if last PBI in a group, delete the group
- [ ] SSE broadcast `pbi:created`, `pbi:updated`, `pbi:deleted`

### 3B · Frontend

- [ ] `FeatureRow` expand toggle reveals `PBIList` child component
- [ ] `PBIRow` — shows `[id] Title`, effort badge, edit/delete actions
- [ ] `CreatePBIModal` — title (required), description, effort, optional user id
- [ ] `EditPBIModal` — pre-filled, handles 409 duplicate-id inline
- [ ] Delete PBI confirmation dialog
- [ ] `usePBIs` hook wired to real API (fetches by `feature_id` query param)

### 3C · Testing

- [ ] Backend: user_id uniqueness spans Features+PBIs — PBI with same id as Feature → 409
- [ ] Backend: deleting last PBI in a group deletes the group
- [ ] Frontend component test: PBI list renders inside expanded FeatureRow
- [ ] Frontend component test: empty PBI list shows "No PBIs yet" placeholder
- [ ] **Manual smoke test:** create Feature → create 3 PBIs → delete PBI → count updates

### 3D · Review checkpoint
- [ ] Code review: cross-entity user_id uniqueness constraint handling
- [ ] Confirm PBI delete triggers group cleanup correctly

---

## Milestone 4 — PI Management

> **Goal:** Users can create and manage PIs with correct state transitions.

### 4A · Backend

- [ ] `GET /api/v1/projects/{id}/pis` — list PIs ordered by `created_at`
- [ ] `POST /api/v1/projects/{id}/pis` — create PI (state defaults to `draft`)
- [ ] `GET /api/v1/pis/{id}` — get PI with swimlines + sprints counts
- [ ] `PATCH /api/v1/pis/{id}` — update name/description/dates/state
  - Transitioning to `in_progress`: check no other PI is already `in_progress` → 409 if so
  - Transitioning to `closed`: no restriction
  - Closed PI: reject any further mutations with 403
- [ ] `DELETE /api/v1/pis/{id}` — delete PI (moves features back to backlog, deletes swimlines/groups)
- [ ] `POST /api/v1/pis/{pi_id}/sprints` — initialise all 5 sprints with capacity=0 (called automatically on PI create)
- [ ] `PATCH /api/v1/sprints/{id}` — update capacity/dates
- [ ] SSE broadcast `pi:created`, `pi:updated`, `pi:deleted`, `pi:state_changed`

### 4B · Frontend

- [ ] `PIListPanel` — sidebar or tab showing PIs with state badges (Draft/In Progress/Closed)
- [ ] `CreatePIModal` — name, description, start/end dates
- [ ] `PIStateButton` — "Start PI" / "Close PI" / "Reopen" buttons with confirmation dialogs
- [ ] PI detail header: name, state badge, date range, edit/delete actions
- [ ] `usePIs` and `useSprints` hooks wired to real API
- [ ] Prevent state change if another PI is `in_progress` (show error from API)

### 4C · Testing

- [ ] Backend: second PI to `in_progress` returns 409 while one is already active
- [ ] Backend: PATCH on closed PI returns 403
- [ ] Backend: creating PI auto-creates 5 sprint records
- [ ] Frontend component test: state badge renders correct colour per state
- [ ] Frontend component test: "Start PI" shows confirmation dialog
- [ ] **Manual smoke test:** create two PIs → start PI 1 → try to start PI 2 → blocked

### 4D · Review checkpoint
- [ ] Code review: state machine logic, edge-case transitions
- [ ] Confirm 5-sprint auto-creation is atomic with PI creation

---

## Milestone 5 — PI Board Structure

> **Goal:** The PI Board renders swimlines and sprint columns; features can be placed in swimlines.

### 5A · Backend

- [ ] `GET /api/v1/pis/{id}/swimlines` — list swimlines ordered by `order_index`
- [ ] `POST /api/v1/pis/{id}/swimlines` — create swimline (unique name per PI → 409; auto-assign `order_index`)
- [ ] `PATCH /api/v1/swimlines/{id}` — update name or `order_index`
- [ ] `DELETE /api/v1/swimlines/{id}` — delete swimline; features in swimline → backlog; groups deleted
- [ ] `POST /api/v1/swimlines/{id}/reorder` — accept `{order: [id1, id2, ...]}` array, bulk-update `order_index`
- [ ] `PATCH /api/v1/features/{id}` extended — support `location`, `pi_id`, `swimlane_id` fields for move operations
  - Moving to swimlane: clear old swimlane reference, set new one; validate feature not already in another swimlane within this PI
  - Moving to backlog: clear `pi_id` + `swimlane_id`; cascade-delete all groups for this feature
- [ ] SSE broadcast `swimline:created`, `swimline:updated`, `swimline:deleted`, `feature:moved`

### 5B · Frontend

- [ ] `PIBoardPage` — main grid: left feature-zone column + 5 sprint columns per swimlane
- [ ] `SwimlaneRow` — collapsible header with name, feature count chip, capacity bar, context menu (rename, delete)
- [ ] `SprintColumnHeader` — sprint number, date range, capacity display (`used/capacity pts %`), click to edit capacity
- [ ] `FeatureZone` — fixed-width left column showing features placed in this swimlane
- [ ] `FeatureCard` (in swimlane) — `[id] Title`, effort badge, ungrouped PBI count
- [ ] `CreateSwimlaneModal` — name field
- [ ] `useSwimlinesForPI` wired to real API
- [ ] Capacity bar component — colour coding: gray / amber (85-100%) / red (>100%)

### 5C · Testing

- [ ] Backend: duplicate swimlane name within PI → 409
- [ ] Backend: delete swimlane returns features to backlog
- [ ] Backend: feature already in swimlane A, move to swimlane B → clears A
- [ ] Frontend component test: `CapacityBar` renders red when effort > capacity
- [ ] Frontend component test: swimlane collapses on toggle click
- [ ] Frontend component test: sprint header shows `0/0 pts 0%` when empty
- [ ] **Manual smoke test:** create swimlane → create feature → move feature to swimlane → verify PI board

### 5D · Review checkpoint
- [ ] Code review: feature move atomicity, old swimlane cleared correctly
- [ ] UX check: PI board layout matches wireframe (`design/screenshots/01-PI-Board.png`)

---

## Milestone 6 — Drag-and-Drop

> **Goal:** Features can be dragged from backlog into swimlanes; groups can be dragged between sprint columns. Swimlines can be reordered by dragging.

### 6A · Frontend (dnd-kit wiring)

- [ ] Install `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (already in `package.json`)
- [ ] `DndProvider` wrapper in `PIBoardPage` with `DndContext`
- [ ] Drag Feature from `BacklogPanel` → drop on `FeatureZone` of a swimlane
  - On drop: call `PATCH /features/{id}` with `{location: 'pi', pi_id, swimlane_id}`
  - Optimistic update: remove from backlog list, add to swimlane feature list
- [ ] Drag Feature from `FeatureZone` → drop on different `FeatureZone` (move between swimlanes)
- [ ] Drag Feature from `FeatureZone` → drop on `BacklogPanel` (return to backlog, groups deleted)
- [ ] Drag Group card from feature zone → drop on sprint column (assign sprint)
- [ ] Drag Group card between sprint columns (move sprint)
- [ ] Drag swimlane header → reorder swimlines (calls `POST /swimlines/{pid}/reorder`)
- [ ] Visual feedback: ghost preview, drop zone highlight, invalid target dim

### 6B · Testing

- [ ] Frontend: drag Feature to swimlane updates `useFeatures` and `useSwimlinesForPI` caches
- [ ] Frontend: drag Feature to backlog shows confirmation toast (groups deleted silently)
- [ ] Frontend: Escape key cancels active drag
- [ ] **Manual smoke test:** drag feature from backlog → swimlane → different swimlane → back to backlog
- [ ] **Manual smoke test:** drag swimlane header to reorder → reload page → order persists

### 6C · Review checkpoint
- [ ] Code review: optimistic update rollback on API error
- [ ] Accessibility check: all drag operations have keyboard alternative

---

## Milestone 7 — Grouping & Sprint Assignment

> **Goal:** Users can select PBIs, create a group, and assign it to a sprint column.

### 7A · Backend

- [ ] `GET /api/v1/swimlines/{id}/groups` — list groups ordered by `sprint_index` then `order_index`
- [ ] `POST /api/v1/swimlines/{id}/groups` — create group (validate `feature_system_id` exists in this swimlane; validate all PBI ids belong to that feature; unique name per swimlane → 409)
- [ ] `PATCH /api/v1/groups/{id}` — update name, `sprint_index`, `order_index`
- [ ] `DELETE /api/v1/groups/{id}` — delete group; PBIs remain, returned to ungrouped state in feature zone (clear `group_id`)
- [ ] `PATCH /api/v1/pbis/{id}` extended — support `group_id` for moving PBI between groups
- [ ] SSE broadcast `group:created`, `group:updated`, `group:deleted`, `group:moved`

### 7B · Frontend

- [ ] Multi-select PBIs in feature zone (checkbox + Ctrl+Click)
- [ ] "Create Group" action (toolbar button or right-click context menu)
- [ ] `CreateGroupModal` — group name input
- [ ] `GroupCard` — shows group name, effort total, PBI list, sprint badge
- [ ] "Ungroup" button on `GroupCard` (no confirmation)
- [ ] "Delete Group" button on `GroupCard` (no confirmation)
- [ ] Move PBI between groups (drag PBI row within sprint column)
- [ ] `useGroupsForSwimline` hook wired to real API

### 7C · Testing

- [ ] Backend: create group with PBIs from wrong feature → 400
- [ ] Backend: delete group → PBIs get `group_id=null`
- [ ] Backend: move PBI to group from different feature → 400
- [ ] Frontend component test: `GroupCard` shows correct effort sum
- [ ] Frontend component test: "Ungroup" removes group and returns PBIs to feature zone
- [ ] **Manual smoke test:** select 3 PBIs → create group → drag group to Sprint 2 → verify capacity bar updates

### 7D · Review checkpoint
- [ ] Code review: group integrity constraints (all PBIs same feature)
- [ ] UX check: multi-select feels natural (checkbox vs Ctrl+click)

---

## Milestone 8 — Effort & Capacity Tracking

> **Goal:** Effort and capacity numbers are accurate everywhere and update in real time.

### 8A · Backend

- [ ] Computed fields in `GET /api/v1/pis/{id}` response:
  - `total_effort` — sum of all group efforts across all swimlines
  - `total_capacity` — sum of all sprint capacities
- [ ] Computed fields in `GET /api/v1/pis/{id}/swimlines`:
  - Per swimline: `effort` (sum of all groups in swimline), `capacity` (sum of sprint capacities)
- [ ] Computed fields in `GET /api/v1/pis/{id}/sprints`:
  - Per sprint: `effort` (sum of group efforts in that sprint_index across all swimlines)
- [ ] `PATCH /api/v1/sprints/{id}` — update capacity; broadcast `sprint:capacity_changed`

### 8B · Frontend

- [ ] Sprint column header shows live `effort / capacity pts %` (derived from groups in that sprint)
- [ ] Swimlane header capacity bar (live from swimlane effort/capacity)
- [ ] PI-level summary bar (total effort vs total capacity)
- [ ] `SprintCapacityModal` — click sprint header to edit capacity (integer > 0)
- [ ] All effort numbers update without page reload (via React Query invalidation or SSE)

### 8C · Testing

- [ ] Backend: effort calculation correct after PBI effort change
- [ ] Backend: capacity at 0 shows 0% (no divide-by-zero crash)
- [ ] Frontend component test: `CapacityBar` at 85% renders amber
- [ ] Frontend component test: `CapacityBar` at 101% renders red
- [ ] **Manual smoke test:** set sprint capacity → drag groups in → watch bars update

### 8D · Review checkpoint
- [ ] Performance check: effort computed on read (not stored), acceptable for ≤500 items
- [ ] Code review: no N+1 queries in swimline list

---

## Milestone 9 — Project Export

> **Goal:** Users can download the full project state as a JSON file.

### 9A · Backend

- [ ] `GET /api/v1/projects/{id}/export` — returns complete project JSON:
  - Project metadata
  - All PIs (with swimlines, groups, sprints)
  - All features (backlog + in PI)
  - All PBIs
  - No user data, no edit history
- [ ] Filename header: `Content-Disposition: attachment; filename="ProjectName_2026-05-03.json"`

### 9B · Frontend

- [ ] "Export" button on project list row
- [ ] Trigger download via `<a href>` blob URL
- [ ] Show brief loading state while export fetches

### 9C · Testing

- [ ] Backend: export JSON includes all features, PBIs, PIs
- [ ] Backend: export includes no `password_hash` or session data
- [ ] **Manual smoke test:** create project with data → export → open JSON → verify structure

### 9D · Review checkpoint
- [ ] Security review: confirm no sensitive fields leak into export

---

## Milestone 10 — Polish, Error Handling & Edge Cases

> **Goal:** The app handles errors gracefully, edge cases are covered, and UX is complete.

### 10A · Error Handling

- [ ] Global Axios error interceptor shows toast notifications for 5xx errors
- [ ] Inline form errors for 409 (duplicate user_id) on feature/PBI create and edit
- [ ] 403 "Edit lock required" shown as UI banner, not a crash
- [ ] Optimistic update rollback: if API call fails, revert UI state and show error toast
- [ ] Session expiry (401 on any API call) → clear user → show login page

### 10B · Closed PI Protection

- [ ] All edit actions (drag-drop, create, rename) disabled in Closed PI
- [ ] Disabled state visually distinct (greyed out, tooltip explains why)
- [ ] Backend 403 is a safety net, not primary enforcement

### 10C · Real-Time Updates for Read-Only Users

- [ ] `useSSE` hook active whenever a project is open
- [ ] All SSE event types trigger correct `queryClient.invalidateQueries` calls
- [ ] SSE reconnects automatically on connection drop (browser native `EventSource`)
- [ ] Read-only banner: "X is editing · Read-only for you" (from edit lock SSE events)

### 10D · UX Completeness

- [ ] Confirmation dialogs: delete Feature, delete PBI, delete swimlane (with content), PI state transitions
- [ ] Auto-scroll when dragging near viewport edge
- [ ] Save indicator: brief checkmark bottom-right after successful mutation (2s timeout)
- [ ] Empty states: "No features yet — add one to get started" in backlog and PI board
- [ ] Loading skeletons for initial data fetch

### 10E · Testing

- [ ] Backend integration test: full flow — create project → feature → PBI → PI → swimlane → group → export
- [ ] Backend test: closed PI rejects PATCH with 403
- [ ] Cypress E2E: login → create project → create feature + PBI → create PI → move feature to swimlane → group PBIs → verify capacity bar
- [ ] Cypress E2E: edit lock flow — user A locks → user B sees read-only banner
- [ ] Run `npm run test:coverage` — aim for ≥ 60% coverage on service modules and hooks

### 10F · Final Review

- [ ] Run `npm run build` — zero TypeScript errors
- [ ] Run `venv/bin/python -m mypy app/` — zero type errors
- [ ] Run `venv/bin/ruff check app/` — zero lint errors
- [ ] Cross-browser check: Chrome + Firefox
- [ ] Mobile layout check (read-only view, login)
- [ ] Performance: PI board with 20 features + 50 PBIs feels responsive

---

## Suggested Task Order

```
M1 (Projects) → M2 (Features) → M3 (PBIs) → M4 (PIs) → M5 (Board Structure)
       → M6 (Drag-Drop) → M7 (Grouping) → M8 (Effort) → M9 (Export) → M10 (Polish)
```

Each milestone: implement backend → write backend tests → implement frontend →
write frontend tests → manual smoke test → code review → commit.

---

## Definition of Done (Phase 1)

A feature is done when:
1. Backend route is implemented and tested (unit + integration)
2. Frontend component renders and interacts correctly
3. Component has at least one Vitest test
4. Feature works end-to-end in the browser (manual smoke test passed)
5. SSE events fire so read-only users see updates
6. Edit lock guard enforced in UI and backend
7. No TypeScript errors in `npm run build`
8. Code reviewed (self-review minimum; peer review preferred)

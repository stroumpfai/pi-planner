# Testing

How this project is tested, how to run each layer, and where the gaps are.
For the current pass/fail and coverage numbers see **[TEST-REPORT.md](TEST-REPORT.md)**,
which is generated — never edit it by hand.

```bash
scripts/test-report.sh            # run everything, rewrite TEST-REPORT.md
scripts/test-report.sh --no-e2e   # skip the browser suite (~90s faster)
scripts/test-report.sh --check    # same, but exit non-zero if anything failed
```

## The four layers

| Layer | Location | Runner | Gate |
|---|---|---|---|
| Backend | `backend/tests/{unit,integration}` | `cd backend && pytest tests/` | 75% |
| MCP server | `mcp_server/tests/` | `cd mcp_server && pytest tests/` | 80% |
| Frontend unit | `frontend/src/**/__tests__/` | `npm run test` | 70% stmts / 65% branch |
| End-to-end | `frontend/cypress/e2e/` | `npm run e2e` | journeys, not % |

Each gate is enforced by the runner itself, so a suite fails on its own if coverage
regresses. They are floors, not targets — the actual numbers sit well above them.

### Backend
`tests/unit/` covers services in isolation (argon2id hashing and the password
policy, effort rollups, the SSE broadcaster, rate limiting, schema serialization).
`tests/integration/` drives the API through `httpx.AsyncClient` against a real
SQLite database: every route, the RBAC guard on each endpoint, dual-ID uniqueness,
edit-lock enforcement, CSV import, snapshots and diffing, PI export and reports,
and `test_migrations.py`, which walks the Alembic chain so a bad migration fails
here rather than on deploy.

### MCP server
Auth (API key and the service JWT it exchanges for), the lock helper, and every
read, write and workflow tool. `test_contract.py` is the important one: it holds
the tool schemas against the backend's, so a route signature change that would
silently break an agent fails here.

### Frontend unit
Components, hooks, stores, services and utils with the network mocked. Each spec
declares its own `makeWrapper()` and data factories — there is no shared
`test-utils`, by convention rather than accident, so a spec reads standalone.

⚠️ **Keep `@testing-library/dom` deduped to a single copy** (`npm ls
@testing-library/dom`). Testing Library registers its `act()` event wrapper on
that package's module-level config, so a second copy — which is what
`@testing-library/react` v14 installed, since it depended on v9 while
`user-event` resolved v10 — leaves every `userEvent` interaction unwrapped and
floods the run with thousands of "not wrapped in act" warnings. Nothing fails, so
the regression is silent; `npm run test 2>&1 | grep -c 'not wrapped in act'`
should print `0`.

### End-to-end
A real browser against a real backend on a throwaway database. This layer exists
for what the other three structurally cannot see: that the pieces are wired
together. Three app-specific rules govern every spec — see the E2E section of
`CLAUDE.md`, which spells out the URL-routing, `isEditing` and label-collision
traps and the `cy.openProject` / `cy.openPI` / `cy.enterEditMode` helpers.

**Never point Cypress at your own dev server.** The suite calls
`POST /api/v1/test/reset`, which deletes every project, feature, PBI and PI.
`scripts/e2e.sh` stands up a throwaway backend on :8901 with its own SQLite file,
seeds `testuser` and `testuser2`, runs the suite and tears it all down.

#### Journeys covered

| Spec | Journey |
|---|---|
| `auth` | Login, bad password, no session, logout |
| `projects` | Project CRUD, duplicate-name error, Azure DevOps work-item links |
| `backlog` | Feature and PBI/bug create, edit, delete; persistence across reload |
| `backlog-search` | Filter by ID and title, clear, drag while filtered |
| `csv-import` | Preview, validation errors, confirmed import, empty file |
| `edit-lock` | Acquire, release, heartbeat, lock held by another user |
| `swimlanes` | Swimlane CRUD, collapse/expand all, focus mode |
| `pi-planning` | PI create, state transitions, single-in-progress rule, feature drag, grouping |
| `snapshots-and-states` | Snapshot create and restore; State lists add, separation, guarded delete |
| `admin-users` | User management, password policy, reader and editor RBAC |
| `api-keys` | Issue, reveal, cycle and revoke an API key |
| `export-png` / `export-report` | Modal options mapped to export query params |
| `sse-updates` | A second session's writes arriving over the event stream |
| `smoke` | The app boots |

## Where the gaps are

Ranked by risk, not by percentage. A low number on a file nobody edits matters
less than an untested path through code that changes every week.

### 1. `PIBoardPage.tsx` — 66% statements, 35% functions
The uncovered functions are the drag-and-drop handlers: `handleDragStart`,
`handleDragEnd`, and the `applyFeatureDrop` / `applySwimlaneReorder` branches for
group and PBI drops. E2E covers feature-to-swimlane and (in `backlog-search`)
dragging while filtered, but **group-to-sprint and PBI-to-sprint-cell drops have
no test at any layer**. Those two helpers are pure functions taking the drag and
drop payloads — they can be unit tested directly, without a browser, which is much
cheaper than more `realMouseDown` choreography.

### 2. Hooks that only exist behind components — `useAuth` 26%, `useEditLock` 31%, `useStates` 47%
Not alarming on their own, since components and E2E exercise the happy paths. What
is missing is the *failure* branches: a 409 from `acquire`, a session expiring
mid-edit, a keepalive that fails. The single-writer model is the app's core
constraint and its unhappy paths are the least tested part of it.

### 3. `services/api.ts` — 12.5% branch coverage
The axios instance and its interceptors. Almost every uncovered branch is error
handling: 401 redirect, network failure, the error-envelope unwrapping that every
component's error message depends on.

### 4. Journeys with no E2E coverage
PI events (create/edit/delete), sprint capacity editing, feature split and
continuation, Clear Backlog, project JSON export/import, snapshot diffing, theme
switching, and column resize. Ranked roughly by how much a silent break would
hurt: **feature split** and **project import** first — both move data in bulk and
neither has a browser-level test.

## Adding coverage well

- **Prefer the cheapest layer that can catch the bug.** A pure helper extracted
  from a drag handler beats an E2E test that simulates a drag.
- **E2E is for wiring, not for logic.** If a case can fail in a unit test, put it
  there; the browser suite should stay a thin layer over the journeys that matter.
- **Test the error branch.** Most of the remaining gap in this codebase is failure
  handling, not happy paths.
- **Match the existing style.** Backend tests use the fixtures in `conftest.py`;
  frontend specs declare local wrappers and factories; E2E specs select by
  accessible name, role and label rather than `data-testid`.

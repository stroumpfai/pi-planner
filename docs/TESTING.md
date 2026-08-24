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

Alongside them, `npm run typecheck` type-checks **the specs as well as `src`**.
`npm run build` only checks `tsconfig.app.json`, which excludes `__tests__`, so
without this a spec can drift from the generated API types unnoticed — and several
had: specs were asserting payloads (`{ label }` for a PI event, `current_password`
for a password change) that the backend would reject outright. They passed anyway,
because a spec that mocks the service layer and asserts the call was forwarded is
true for *any* payload. The type-check is the only thing that catches it, so CI
runs it.

Both pytest suites also run under `filterwarnings = ["error"]`, so a warning fails
the suite rather than scrolling past — a dependency's new deprecation, an
un-awaited coroutine left by a mock. When one fires, fix it at the source; add a
narrowly scoped `ignore` (matched on category *and* message) only when the
warning is telling you about behaviour you deliberately want, and say so in a
comment — as `mcp_server/tools/features.py` does for its `_UNSET` sentinel.

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
| `projects` | Project CRUD, duplicate-name error, Azure DevOps work-item links, JSON export/import round-trip |
| `backlog` | Feature and PBI/bug create, edit, delete; persistence across reload; Clear backlog vs everything |
| `feature-split` | Split PBIs into another PI, continuation lineage, cancel continuation |
| `backlog-search` | Filter by ID and title, clear, drag while filtered |
| `csv-import` | Preview, validation errors, confirmed import, empty file |
| `edit-lock` | Acquire, release, heartbeat, lock held by another user |
| `swimlanes` | Swimlane CRUD, collapse/expand all, focus mode |
| `pi-planning` | PI create, state transitions, single-in-progress rule, feature drag, grouping, group and PBI drops onto sprint cells |
| `snapshots-and-states` | Snapshot create and restore; State lists add, separation, guarded delete |
| `admin-users` | User management, password policy, reader and editor RBAC |
| `api-keys` | Issue, reveal, cycle and revoke an API key |
| `export-png` / `export-report` | Modal options mapped to export query params |
| `sse-updates` | A second session's writes arriving over the event stream |
| `smoke` | The app boots |

## Where the gaps are

Ranked by risk, not by percentage. A low number on a file nobody edits matters
less than an untested path through code that changes every week.

### 1. Journeys with no E2E coverage
Snapshot diffing and theme switching — what is left after the bulk-data journeys
were covered. Neither moves data, so a silent break costs a reader a stale view
rather than lost work. (PI events, sprint capacity editing and column resize are
unit-tested instead of driven through a browser, which is where the guidance below
would put them anyway.)

### 2. Thin spots, none of them load-bearing
`useSwimlinesAndGroups` and `useTheme` sit near 76%, and `services/states.ts` has
most of its functions covered only through the hooks that call them. All three are
small, stable and exercised end-to-end; none is worth a spec of its own until it
starts changing.

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
- **Stub a hook with `mockImplementation`, not `mockReturnValue`.** A component
  spec that does `vi.mock('@/hooks/useEditLock')` and hands back one frozen object
  gives the component a referential stability React Query never provides — every
  `useMutation` render returns a *new* result object (only `mutate` is stable). The
  edit-lock heartbeat depended on that identity in an effect's dep array and so
  never fired in production, for as long as the spec that stubbed it passed. If a
  component reads a hook result across renders, hand it a fresh object per call.
- **Test the interceptor by swapping the adapter, not the service.** Mocking
  `@/services/*` skips `services/api.ts` entirely, where the 401 session clear, the
  409 lock toast and the 5xx toast live. `src/services/__tests__/api.test.ts`
  replaces `api.defaults.adapter` instead, so everything above the wire — services,
  hooks, the stores the interceptor writes to — is the real thing.

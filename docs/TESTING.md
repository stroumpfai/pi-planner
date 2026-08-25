# Testing

How this project is tested, how to run each layer, and where the gaps are.
For the current pass/fail and coverage numbers see **[TEST-REPORT.md](TEST-REPORT.md)**,
which is generated — never edit it by hand.

```bash
scripts/check.sh                  # is this clean? — everything but the browser suite (~95s)
scripts/check.sh --with-e2e       # add Cypress (~3 min)
scripts/check.sh --quick          # static checks only, no test suites (~10s)
```

`check.sh` is the single definition of "clean": ruff, mypy `--strict`, the OpenAPI
contract check, ESLint, `tsc` over `src` *and* every spec, then the three test
suites with their coverage gates. It stops at the first failure and runs
cheapest-first, so a stale import costs you a second rather than a full test run.
The pre-push hook and CI both call it, so there is one place to change what
"clean" means — see [Gates](#gates) below.

For a release, `test-report.sh` runs the same suites but *records* the result:

```bash
scripts/test-report.sh            # run everything, rewrite TEST-REPORT.md
scripts/test-report.sh --no-e2e   # skip the browser suite (~90s faster)
scripts/test-report.sh --check    # same, but exit non-zero if anything failed
```

Use `check.sh` while working and before pushing; use `test-report.sh` when cutting
a release. The difference that matters day to day: `test-report.sh` rewrites
`docs/TEST-REPORT.md` every run, so it dirties the tree, and it does not run lint,
the type-checkers or the OpenAPI check.

## Gates

Nothing here is advisory — three things enforce it.

**The coverage floors**, enforced by each runner itself (see the table below).

**The `pre-push` hook** (`scripts/hooks/pre-push`), which runs `check.sh --with-e2e`
when — and only when — you push `main`. Feature-branch pushes are not gated; work
in progress is allowed to be broken. Install it once per clone:

```bash
git config core.hooksPath scripts/hooks
```

`.git/hooks/` is not versioned, which is why the hook lives in `scripts/hooks/` and
is wired up with `core.hooksPath` instead. Bypass a single push with
`git push --no-verify`.

**CI** (`.github/workflows/ci.yml`), on every push to `main`, every PR, and on
demand via *Run workflow*. It builds the same `backend/venv`, `mcp_server/.venv`
and `frontend/node_modules` layout a developer has and then runs the very same
`check.sh` and `e2e.sh` — there is no CI-only variant that can drift from what you
run locally. It is a genuine backstop rather than a duplicate of the hook: it runs
on a clean checkout, so it catches the missing migration or the uncommitted file
that a local venv papers over, and it still fires when someone uses `--no-verify`.

## The four layers

| Layer | Location | Runner | Gate |
|---|---|---|---|
| Backend | `backend/tests/{unit,integration}` | `cd backend && pytest tests/` | 75% |
| MCP server | `mcp_server/tests/` | `cd mcp_server && pytest tests/` | 80% |
| Frontend unit | `frontend/src/**/__tests__/` | `npm run test` | 70% stmts / 65% branch |
| End-to-end | `frontend/cypress/e2e/` | `npm run e2e` | journeys, not % |

Each gate is enforced by the runner itself, so a suite fails on its own if coverage
regresses. They are floors, not targets — the actual numbers sit well above them.

Alongside them, `npm run typecheck` type-checks **every spec as well as `src`**.
`npm run build` only checks `tsconfig.app.json`, which excludes `__tests__`, so
without this a spec can drift from the generated API types unnoticed — and several
had: specs were asserting payloads (`{ label }` for a PI event, `current_password`
for a password change) that the backend would reject outright. They passed anyway,
because a spec that mocks the service layer and asserts the call was forwarded is
true for *any* payload. The type-check is the only thing that catches it, so CI
runs it.

It is two `tsc` invocations, not one. The E2E specs live in their own project
(`cypress/tsconfig.json`) because Cypress's ambient globals and Vitest's are
mutually exclusive within a single program — merged into one `include`, `tsc`
reports 724 errors and finds no `cy` at all. Cypress transpiles specs with types
stripped, so until this was wired up nothing checked them, and four errors had
accumulated unseen behind a green suite. Note one Cypress typing trap that turned
up there: its first `contains` overload is `(content, options?) => Chainable<Subject>`
and `cy` is `Chainable<undefined>`, so a bare `cy.contains('x').then(($el) => …)`
types `$el` as `undefined` however well it works at runtime. Pass the element type
(`cy.contains<HTMLElement>('x')`) to select the overload that says what actually
gets yielded.

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
| `snapshot-diff` | The server-rendered diff page in a browser, and its auto-refresh |
| `admin-users` | User management, password policy, reader and editor RBAC |
| `api-keys` | Issue, reveal, cycle and revoke an API key |
| `export-png` / `export-report` | Modal options mapped to export query params |
| `sse-updates` | A second session's writes arriving over the event stream |
| `theme` | Light/dark/system switching, repaint and persistence |
| `smoke` | The app boots |

## Where the gaps are

Ranked by risk, not by percentage. A low number on a file nobody edits matters
less than an untested path through code that changes every week.

### 1. Journeys deliberately left to the cheaper layers
Every journey that has a browser surface now has an E2E spec. What is left out is
left out on purpose: PI events, sprint capacity editing and column resize are
unit-tested rather than driven through a browser, which is where the guidance
below would put them anyway.

The one journey without a browser surface is the **snapshot diff** — it is an API
consumed by the MCP server, rendered server-side, with no in-app UI. Its semantics
live in `backend/tests/integration/test_snapshot_diff.py`; `snapshot-diff.cy.ts`
covers only the two things pytest structurally cannot see, namely that the page
loads in a browser under session-cookie auth and that its auto-refresh script —
inert unless actually served over http — really re-fetches and swaps content. If
a diff UI is ever added to the app, that is when the spec grows a real journey.

### 2. Thin spots, none of them load-bearing
`useSwimlinesAndGroups` sits near 76%, and `services/states.ts` has most of its
functions covered only through the hooks that call them. Both are small, stable
and exercised end-to-end; neither is worth a spec of its own until it starts
changing.

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

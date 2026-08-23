# CLAUDE.md - PI Planning Application

## Project Overview

**PI Planning Web Application** — A single-tenant, browser-based tool for Product Owners and Product Managers to manage PI (Program Increment) planning and roadmaps.

- **Status**: Phase 1 MVP (deployed)
- **Type**: Web app (React frontend + Python backend, served from a single container)
- **Scope**: Backlog management + PI planning with swimlanes, sprints, grouping
- **Users**: Small team (1 editor + up to 10 readers); roles enforced

---

## Specifications

Before making changes, read:

1. **`spec/specification.md`** — Full Phase 1 product specification (features, workflows, constraints)
2. **`spec/design.md`** — Software architecture, tech stack decisions, database schema, API design

---

## Key Constraints & Decisions

### Single-Writer Pattern
⚠️ **Critical**: Only **ONE user can edit at a time**. All others are read-only.
- Edit lock acquired via "Request Edit Mode" button
- Lock held for 30 minutes (auto-timeout with heartbeat every 60s)
- Lock released on logout or timeout
- Read-only users see live updates via SSE
- No queuing — users wait for editor to finish

### Role-Based Access Control (RBAC)
Three roles enforced at every API endpoint:

| Role | Can do |
|------|--------|
| `admin` | All write operations + user management + API key management |
| `editor` | All write operations (features, PBIs, PIs, groups, etc.) |
| `reader` | Read-only; can view everything, cannot modify |

Backend deps: `require_admin`, `require_editor_or_above`, `get_current_user` (any authenticated user). Do not bypass these guards.

### Dual-ID System
⚠️ **Important**: Every Feature and PBI has two IDs:

1. **`system_id`** (UUID) — Database primary key, internal only
   - Never exposed in UI
   - Used for all database relationships
   - Auto-generated, immutable

2. **`user_id`** (1–999,999) — Business identifier, user-visible
   - Optional (can be blank)
   - User-editable anytime
   - Must be unique per project (Features and PBIs share namespace)
   - Shown in UI as `[101] Feature Name`

→ **API responses always include both**. Frontend uses `system_id` for API calls, displays `user_id` in UI.

### Dual Authentication
The backend accepts two authentication paths on every protected endpoint:

1. **Session cookie** (`pi_session`) — standard browser login
2. **Service JWT + `X-MCP-Actor` header** — used by the MCP server to act on behalf of a human user

Both paths are handled transparently by `get_current_user` in `backend/app/middleware/deps.py`.

### Password Policy (enforced on both frontend and backend)
- Minimum 12 characters
- Must not contain the username
- Must not relate to the app name (`piplanner`, `piplan`, etc.)
- Must not appear in the 1M common-passwords list (`backend/data/common-passwords.txt`)
- Hashing: **argon2id** (`argon2-cffi`) — never bcrypt, never plain text

---

## Tech Stack

| Layer | Technology | Key Points |
|-------|-----------|-----------|
| **Frontend** | React 18 + Vite + TypeScript | Components in `src/components/`, hooks in `src/hooks/` |
| **State Mgmt** | React Query + Zustand | Server state (Query), UI state (Zustand) |
| **UI** | Radix UI + Tailwind CSS | Unstyled components + utility-first styling |
| **Drag-Drop** | dnd-kit | Feature→Swimlane, Group→Sprint, Swimlane reorder, direct story placement |
| **Testing** | Vitest + Cypress | Unit/integration (Vitest), E2E (Cypress) |
| **Backend** | Python 3.11+ + FastAPI | Async, type-safe with Pydantic v2 |
| **Database** | SQLite 3 | File-based at `/data/db.sqlite` (container) or `~/.pi-planning/db.sqlite` (local) |
| **ORM** | SQLAlchemy 2.0 + Alembic | Async ORM, migrations |
| **Real-time** | Server-Sent Events (SSE) | One-way push to all connected clients |
| **MCP Server** | FastMCP | Separate service in `mcp_server/`; uses API keys + service JWT |

---

## Project Structure

```
pi-planner/
├── backend/                 # Python/FastAPI
│   ├── app/
│   │   ├── main.py         # FastAPI app, router registration, SPA serving
│   │   ├── config.py       # pydantic-settings (env vars)
│   │   ├── database.py     # SQLAlchemy async engine + session factory
│   │   ├── models/         # SQLAlchemy ORM models
│   │   │   ├── activity_log.py
│   │   │   ├── api_key.py
│   │   │   ├── edit_lock.py
│   │   │   ├── feature.py
│   │   │   ├── group.py    # includes is_implicit, story_system_id
│   │   │   ├── pbi.py      # includes item_type (pbi|bug)
│   │   │   ├── pi.py
│   │   │   ├── project.py
│   │   │   ├── project_state.py  # State List entries (3 per project: feature|story|bug)
│   │   │   ├── session.py
│   │   │   ├── sprint.py
│   │   │   ├── swimline.py
│   │   │   └── user.py     # Role enum: admin|editor|reader
│   │   ├── schemas/        # Pydantic request/response models
│   │   ├── routes/         # API endpoints (one file per resource)
│   │   │   ├── api_keys.py
│   │   │   ├── auth.py
│   │   │   ├── csv_import.py
│   │   │   ├── edit_lock.py
│   │   │   ├── events.py   # SSE stream
│   │   │   ├── features.py
│   │   │   ├── groups.py
│   │   │   ├── pbis.py
│   │   │   ├── pis.py
│   │   │   ├── project_states.py  # State Lists: list/create/rename/reorder/guarded delete
│   │   │   ├── projects.py
│   │   │   ├── sprints.py
│   │   │   ├── swimlines.py
│   │   │   ├── test_utils.py  # Only mounted when ALLOW_TEST_RESET=true
│   │   │   └── users.py    # Admin-only user management
│   │   ├── services/       # Business logic
│   │   │   ├── activity.py # Activity log writes
│   │   │   ├── auth.py     # argon2id hashing, sessions, password policy
│   │   │   ├── csv_import.py
│   │   │   ├── effort.py   # Derived effort calculations
│   │   │   ├── events.py   # SSE broadcaster
│   │   │   ├── project_state.py  # State dedupe, select-or-create, usage checks
│   │   │   ├── users.py    # User CRUD + seed_from_config
│   │   │   └── validation.py
│   │   ├── middleware/
│   │   │   ├── deps.py     # get_current_user, require_admin, require_editor_or_above
│   │   │   └── mcp_activity.py  # Logs MCP-originated requests to activity_log
│   │   └── data/
│   │       └── common-passwords.txt  # 1M password blocklist
│   ├── migrations/         # Alembic migrations
│   ├── tests/              # pytest tests
│   └── pyproject.toml
│
├── frontend/                # React/Vite
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx         # Shell: header, routing, UserMenu, UserManagementModal
│   │   ├── components/     # UI components (one file each, named export)
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── ProjectListPage.tsx
│   │   │   ├── BacklogPage.tsx
│   │   │   └── PIBoardPage.tsx
│   │   ├── hooks/          # Custom hooks (data fetching, SSE, edit lock, etc.)
│   │   ├── stores/
│   │   │   ├── authStore.ts    # user, isEditing, isAdmin(), canEdit()
│   │   │   ├── uiStore.ts      # activeProjectId, activePIId, activeModal
│   │   │   ├── dragStore.ts    # draggingId, draggingType
│   │   │   ├── toastStore.ts   # toast notifications
│   │   │   └── settingsStore.ts
│   │   ├── services/       # Typed API client functions (one file per resource)
│   │   ├── types/
│   │   │   ├── api.generated.ts  # Generated from openapi.json — see scripts/openapi.sh
│   │   │   └── index.ts          # Clean domain type aliases
│   │   ├── utils/
│   │   │   ├── csvParser.ts
│   │   │   ├── dates.ts
│   │   │   └── passwordPolicy.ts  # Frontend password validation (mirrors backend)
│   │   └── data/
│   │       └── common-passwords.json  # Blocklist for frontend validation
│   ├── cypress/            # E2E tests
│   └── package.json
│
├── mcp_server/              # MCP server (FastMCP)
│   ├── server.py           # FastMCP app, mounts read_mcp and projects_mcp
│   ├── auth.py             # APIKeyAuthProvider
│   ├── backend.py          # httpx client to the main app
│   ├── config.py
│   ├── lock.py
│   └── tools/
│       ├── read.py         # Read-only MCP tools
│       └── projects.py     # Write MCP tools (create PI, update project, etc.)
│
├── scripts/
│   ├── create_admin.py     # Interactive tool to generate config/users.json
│   └── sonar.sh
│
├── config/
│   └── users.json.example  # Seed file template with argon2id hash
│
├── spec/
│   ├── specification.md    # Product specification
│   └── design.md           # Architecture and design
│
├── Dockerfile              # Multi-stage: Vite build → Python image
└── docker-compose.yml      # app + mcp-server services
```

---

## Development Workflow

### Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env      # set SECRET_KEY to anything non-default
alembic upgrade head
uvicorn app.main:app --reload   # http://localhost:8000/docs
```

### Frontend Setup
```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
npm run test              # Vitest
npm run test:watch
npm run e2e               # E2E, headless (isolated backend — see below)
npm run e2e:open          # E2E, interactive
```

### API Contract

`frontend/openapi.json` is a checked-in copy of the FastAPI spec, and
`frontend/src/types/api.generated.ts` is generated from it. Neither is produced by
the build, so **after changing any route signature or schema, regenerate both**:

```bash
scripts/openapi.sh          # rewrite both files
scripts/openapi.sh --check  # fail if either is stale (no writes)
```

Skipping this leaves the frontend typed against an API that no longer exists — a new
query parameter simply won't be visible to `tsc`.

### Database
- Local dev: `~/.pi-planning/db.sqlite`
- Container: `/data/db.sqlite`
- Migrations: `alembic/versions/` — always create a new migration, never edit existing ones

---

## Coding Standards

### TypeScript (Frontend)
- **Strict mode**: `strict: true` in tsconfig
- **No `any` types**: Use proper interfaces from `src/types/`
- **Named exports**: All components use named exports
- **Props interface**: `interface Props {}` per component

```typescript
interface FeatureCardProps {
  featureId: string
  title: string
  onEdit?: () => void
}

export const FeatureCard: React.FC<FeatureCardProps> = ({ featureId, title, onEdit }) => {
  // ...
}
```

### Python (Backend)
- **Type hints everywhere**
- **Pydantic v2 models** for all request/response bodies
- **SQLAlchemy async**: always `async def`, `await`
- **No raw SQL** except for complex queries (document why)
- **snake_case** for functions/variables, **PascalCase** for classes

```python
async def get_features(session: AsyncSession, project_id: str) -> list[Feature]:
    result = await session.execute(
        select(Feature).where(Feature.project_id == project_id)
    )
    return result.scalars().all()
```

### API Design
- **Base URL**: `/api/v1/`
- **Response format** (standard envelope):
  ```json
  { "data": { /* payload */ }, "meta": { "timestamp": "ISO-8601" } }
  ```
- **Error format**:
  ```json
  { "error": "ERROR_CODE", "message": "Human-readable", "details": {} }
  ```
- **IDs in responses**: Always include both `system_id` and `id` (user_id)

### State Management (Frontend)
- **Server data** → React Query (`useQuery`, `useMutation`)
- **UI state** → Zustand (`uiStore`, `dragStore`, `authStore`, `toastStore`)
- **Never** duplicate server state in Zustand

---

## Common Tasks

### Add a New API Endpoint

1. **Schema** (`backend/app/schemas/`):
```python
class ThingCreate(BaseModel):
    title: str = Field(..., max_length=255)
    user_id: Optional[int] = Field(None, ge=1, le=999999)
```

2. **Route** (`backend/app/routes/`):
```python
router = APIRouter(prefix="/api/v1/things", tags=["things"])

@router.post("/", status_code=201)
async def create_thing(
    body: ThingCreate,
    db: AsyncSession = Depends(get_session),
    current_user: User = Depends(require_editor_or_above),  # pick correct guard
) -> ThingResponse:
    ...
```

3. **Register** in `backend/app/main.py` — add to the `for _router in [...]` loop.

### Add a New React Component

```typescript
// src/components/MyComponent.tsx
interface Props {
  title: string
  onSubmit: (value: string) => void
}

export const MyComponent: React.FC<Props> = ({ title, onSubmit }) => {
  return <div>{title}</div>
}
```

### Fetch Data with React Query

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'

export const useFeatures = (projectId: string) =>
  useQuery({
    queryKey: ['features', projectId],
    queryFn: () => api.get(`/api/v1/projects/${projectId}/features`),
    staleTime: 5 * 60 * 1000,
  })
```

### Edit Lock Flow

**Backend** (`backend/app/routes/edit_lock.py`):
```python
# POST /api/v1/projects/{id}/edit-lock/acquire
async def acquire(project_id: str, db: AsyncSession, user: User = Depends(require_editor_or_above)):
    lock = await db.get(EditLock, project_id)
    if lock and lock.expires_at > datetime.now(timezone.utc):
        raise HTTPException(status_code=409, detail="Already locked")
    ...
```

**Frontend** (via `useEditLock` hook in `src/hooks/useEditLock.ts`):
```typescript
const { acquire, release } = useEditLock(projectId)
```

### Broadcast SSE Event

```python
from app.services.events import broadcaster

await broadcaster.broadcast(project_id, {"type": "feature:updated", "data": {...}})
```

### Database Migration

```bash
cd backend
alembic revision --autogenerate -m "add my new column"
# Review the generated file in migrations/versions/
alembic upgrade head
```

---

## Testing

Full picture — layers, how to run each, and the current gaps — in
[`docs/TESTING.md`](docs/TESTING.md). Generated pass/fail and coverage numbers per
commit in [`docs/TEST-REPORT.md`](docs/TEST-REPORT.md), rewritten by
`scripts/test-report.sh` (run it before cutting a release).

### Frontend (Vitest)

```typescript
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeatureCard } from '@/components/FeatureCard'

describe('FeatureCard', () => {
  it('displays feature title', () => {
    render(<FeatureCard featureId="f1" title="Auth" />)
    expect(screen.getByText('Auth')).toBeInTheDocument()
  })
})
```

```bash
npm run test              # once
npm run test:watch        # watch
npm run test:coverage     # coverage
```

### Backend (pytest)

```python
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_create_feature(client: AsyncClient):
    response = await client.post(
        "/api/v1/projects/{id}/features",
        json={"title": "Auth", "id": 101},
    )
    assert response.status_code == 201
```

```bash
pytest tests/ -v
pytest --cov=app tests/
```

### E2E (Cypress)

```typescript
describe('Create Feature', () => {
  beforeEach(() => {
    cy.resetDb()
    cy.login()
    cy.request('POST', '/api/v1/projects/', { name: 'Backlog Test' })
  })

  it('creates a feature', () => {
    cy.openProject('Backlog Test')   // no URL routing — navigation is clicked
    cy.enterEditMode()               // isEditing is client-side state
    cy.contains('button', /\+ feature/i).click()
    cy.get('input[name="title"]').type('Authentication')
    cy.get('button[type="submit"]').click()
    cy.contains('Authentication').should('be.visible')
  })
})
```

Specs select by accessible name, role and label — the app has almost no
`data-testid` attributes (`backlog-panel` and `backlog-list` are the exceptions,
added so E2E can tell the backlog column apart from the board).

```bash
npm run e2e                                      # whole suite, headless
npm run e2e:open                                 # interactive runner
npm run e2e -- --spec cypress/e2e/backlog.cy.ts  # one spec
```

⚠️ **Never point Cypress at your own dev server.** The suite calls
`POST /api/v1/test/reset`, which deletes every project, feature, PBI and PI in the
database. `scripts/e2e.sh` exists so that can't happen: it starts a throwaway
backend on :8901 with its own SQLite file and `ALLOW_TEST_RESET=true`, a vite dev
server on :5901 proxying to it, seeds `testuser` and `testuser2`, runs the suite,
then tears it all down. `cypress:run` / `cypress:open` are aliases of it.

Three things the specs must respect, all consequences of how the app works:

1. **There is no URL routing.** The active project and PI live in `uiStore`, so
   navigation is clicked, never asserted on the URL, and a `cy.reload()` mid-journey
   drops you back to the project list. Use `cy.openProject(name)` / `cy.openPI(name)`.
2. **`isEditing` is client-side state**, set only by the acquire mutation's
   `onSuccess`. Acquiring the edit lock over the API leaves every write control
   disabled and makes drag-and-drop drops no-ops. Use `cy.enterEditMode()`.
3. **Match action labels exactly.** Item names collide with button labels — a
   project called "To Delete" is matched by `contains('button', 'Delete')`, and a PI
   called "Export PI" by `contains('button', 'Export')`. Use anchored regexes
   (`/^Delete$/`) and scope modal actions with `cy.get('[role="dialog"]')`.

If Cypress dies with `bad option: --no-sandbox`, `ELECTRON_RUN_AS_NODE=1` is set in
your environment; `scripts/e2e.sh` already unsets it.

---

## Important Notes

### ⚠️ Do NOT
- Expose `system_id` in UI
- Use `bcrypt` — password hashing is **argon2id** (`argon2-cffi`)
- Store plain-text passwords anywhere
- Skip RBAC guards on new endpoints — every route must call `get_current_user`, `require_editor_or_above`, or `require_admin`
- Duplicate server state in Zustand
- Allow CSV import to assign PI/swimlane/sprint (all imports go to backlog only)
- Let a CSV file with **no** `State` column clear anyone's States (blank cell clears; absent column changes nothing)
- Let an *item* write create a State List entry — feature/PBI writes take `state_id` only, and MCP rejects unknown names there. Vocabulary is created deliberately: by CSV import, in the States editor, or via the MCP `create_state` tool (see `docs/adr/0003-states-are-managed-explicitly.md`)
- Allow multiple PIs in `in_progress` state
- Allow undelete/trash (deletions are permanent)
- Commit `.env` or `config/users.json` (contains secrets/hashes)
- Edit existing Alembic migration files — always create a new one

### ✅ Do
- Include both `system_id` and `id` (user_id) in API responses
- Use `require_editor_or_above` (not just `get_current_user`) for any write operation
- Use `require_admin` for user management and API key admin endpoints
- Use `selectinload` for eager-loading SQLAlchemy relationships (avoid N+1)
- Broadcast SSE events after any state-changing operation
- Log write operations to `activity_log` for MCP-originated requests (handled automatically by `MCPActivityMiddleware`)
- Test: create → edit → move → delete flows end-to-end
- Validate user IDs (1–999,999 range, uniqueness per project)
- Handle edit lock 409 errors gracefully in the frontend

### 🔄 Common Workflows
1. **Create Feature** → Create PBIs → Move to PI → Create Groups → Assign to Sprints
2. **Edit Lock Request** → User edits → Auto-save on each action → Release lock
3. **Read-only User** → Sees live updates via SSE → Waits for editor → Requests lock
4. **MCP agent** → Authenticates with API key → Backend validates service JWT → Acts as named user
5. **New user account** → Admin uses UI (User Management modal) or `scripts/create_admin.py` for first boot

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | `change-me` | **Required.** Session signing key — app refuses to start with the default |
| `DATABASE_URL` | `sqlite+aiosqlite:////data/db.sqlite` | SQLite path |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | CORS origins (comma-separated) |
| `USERS_FILE` | `/config/users.json` | One-time user seed file (read only when DB is empty) |
| `MCP_SIGNING_SECRET` | `""` | Shared HS256 secret between app and MCP server |
| `ALLOW_TEST_RESET` | `false` | Mounts `/test/reset` endpoint — **never true in prod** |
| `DEBUG` | `false` | FastAPI debug mode |

---

## MCP Server

The `mcp_server/` directory is a separate FastMCP service that exposes PI Planning operations to Claude and other MCP clients.

- **Auth**: MCP clients authenticate with API keys (managed in the app's API Keys UI tab)
- **Backend calls**: MCP server calls the main app using a short-lived HS256 JWT (`MCP_SIGNING_SECRET`) + `X-MCP-Actor` header to impersonate the human user
- **Activity logging**: `MCPActivityMiddleware` records all MCP-originated write operations to `activity_logs`
- **Tools**: Read tools (`read_mcp`) and write tools (`projects_mcp`) — see `mcp_server/tools/`
- **Port**: 8010 (configurable via `PORT` env var)

---

## Debugging

```bash
# API docs and interactive testing
open http://localhost:8000/docs

# Health check
curl http://localhost:8000/health

# Tail logs (Docker)
docker compose logs -f app
docker compose logs -f mcp-server

# SQLite (local)
sqlite3 ~/.pi-planning/db.sqlite ".tables"
```

### Common Issues
- **`SECRET_KEY` not set**: App refuses to start — set a real value in `.env`
- **"Already locked" (409)**: Another user holds the edit lock — show "locked by X" in UI
- **Missing SSE updates**: Check `EventSource` connection in browser Network tab
- **Duplicate user_id (409)**: DB unique constraint — show error dialog in UI
- **MCP JWT rejected**: Check that `MCP_SIGNING_SECRET` matches on both services

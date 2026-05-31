# PI Planning Application — Software Architecture & Design

## 1. System Overview

Single-tenant, browser-based web application. React frontend communicates with a Python/FastAPI backend over a REST API. SQLite database stored on the server. Read-only users receive live updates via Server-Sent Events (SSE). Only one user can write at a time (enforced by a database-backed edit lock).

---

## 2. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend framework | React + TypeScript | 18+ / 5.0+ |
| Build tool | Vite | 4.4+ |
| Server state | TanStack React Query | 5.0+ |
| UI state | Zustand | 4.4+ |
| UI components | Radix UI (headless) | Latest |
| Styling | Tailwind CSS | 3.3+ |
| Drag-and-drop | dnd-kit | 8.0+ |
| Forms | react-hook-form + zod | 7+ / 3+ |
| HTTP client | axios | 1.4+ |
| Unit/integration tests | Vitest | 0.34+ |
| E2E tests | Cypress | 13+ |
| Backend framework | Python + FastAPI | 3.11+ / 0.104+ |
| Database | SQLite 3 | Latest |
| ORM | SQLAlchemy (async) | 2.0+ |
| Migrations | Alembic | 1.12+ |
| Async SQLite driver | aiosqlite | 0.19+ |
| Validation | Pydantic v2 | 2.0+ |
| Real-time | Server-Sent Events (SSE) | HTTP/1.1 |

### Technology Decision Rationale

| Decision | Choice | Rejected alternative |
|----------|--------|---------------------|
| Backend | FastAPI | Node.js/Express — less type-safe |
| Frontend | React | Vue — smaller ecosystem for complex DnD |
| Build | Vite | CRA — slower; Next.js — unnecessary SSR |
| State | React Query + Zustand | Redux — overkill; Context — no caching |
| UI | Radix + Tailwind | MUI — opinionated theming |
| Drag-drop | dnd-kit | react-beautiful-dnd — less accessible |
| Testing | Vitest + Cypress | Jest — 5–10x slower |
| Real-time | SSE | WebSocket — overkill for one-way push |
| Database | SQLite | PostgreSQL — unnecessary for single-tenant MVP |
| ORM | SQLAlchemy | Raw SQL — error-prone |

---

## 3. Project Structure

```
pi-planning/
├── backend/
│   ├── app/
│   │   ├── main.py             # FastAPI app + router registration
│   │   ├── config.py           # pydantic-settings configuration
│   │   ├── database.py         # SQLAlchemy engine + session factory
│   │   ├── models/             # SQLAlchemy ORM models
│   │   ├── schemas/            # Pydantic request/response models
│   │   ├── routes/             # API endpoints (one file per resource)
│   │   ├── services/           # Business logic (import, lock, etc.)
│   │   ├── middleware/         # Auth, CORS
│   │   └── utils/              # Helpers
│   ├── migrations/             # Alembic migration versions
│   ├── tests/
│   │   ├── unit/
│   │   └── integration/
│   ├── pyproject.toml
│   └── .env.example
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/         # Reusable UI components
│   │   ├── pages/              # Page containers
│   │   ├── hooks/              # Custom React hooks
│   │   ├── stores/             # Zustand stores
│   │   ├── services/           # API client wrappers
│   │   ├── types/              # TypeScript interfaces
│   │   ├── utils/              # Pure helpers (csvParser, etc.)
│   │   └── styles/
│   ├── cypress/
│   │   ├── e2e/
│   │   ├── support/
│   │   └── fixtures/
│   ├── vite.config.ts          # Vite + Vitest config
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
│
└── spec/                       # Specifications
    ├── specification.md        # Product spec (this document's companion)
    └── design.md               # Architecture (this document)
```

---

## 4. Frontend Architecture

### 4.1 State Management Layers

**Server state — React Query**

All data that lives on the server (Features, PBIs, PIs, swimlanes, etc.) is managed by React Query. Never duplicate server state in Zustand.

```typescript
export const useFeatures = (projectId: string) =>
  useQuery({
    queryKey: ['features', projectId],
    queryFn: () => api.get(`/projects/${projectId}/features`),
    staleTime: 5 * 60 * 1000,
  })
```

**UI state — Zustand**

Only for ephemeral client-side state: modal visibility, current selections, active drag operation, auth session status.

```typescript
// Stores
uiStore    // Modal visibility, sort/filter preferences
dragStore  // Active drag operation state
authStore  // Current user, session, edit lock status
```

**Rule**: If it needs to survive a page refresh → React Query. If it's transient UI state → Zustand.

### 4.2 Component Organization

- `components/` — Reusable, presentational components
- `pages/` — Route-level containers (fetch data, compose components)
- `hooks/` — Custom hooks encapsulating logic (e.g., `useEditLock`, `useCsvImport`)
- One `interface Props {}` per component; no `any` types; named exports

### 4.3 Drag-and-Drop (dnd-kit)

All drag operations share a single `DndContext` at the PI board level. Drag types are distinguished by `data.type` on draggable items:

- `DraggableFeature` → drops onto `SwimlaneDrop` (feature zone)
- `DraggableGroup` → drops onto `SprintColumnDrop`
- `DraggableStory` → drops onto `SprintColumnDrop` (direct placement, creates implicit group)
- `DraggableSwimlane` (via `@dnd-kit/sortable`) → reorders swimlanes

Visual feedback: `useDndMonitor` at the board level to highlight valid/invalid zones during drag.

### 4.4 Real-time (SSE)

Read-only users subscribe to `GET /api/v1/projects/{project_id}/events` via the browser's native `EventSource` API. On receiving an event, the relevant React Query query is invalidated to trigger a refetch.

```typescript
// Simplified SSE hook
useEffect(() => {
  const es = new EventSource(`/api/v1/projects/${projectId}/events`)
  es.addEventListener('feature:updated', () =>
    queryClient.invalidateQueries({ queryKey: ['features', projectId] })
  )
  return () => es.close()
}, [projectId])
```

SSE events: `feature:created`, `feature:updated`, `feature:deleted`, `group:moved`, `edit-lock:acquired`, `edit-lock:released`.

---

## 5. Backend Architecture

### 5.1 FastAPI App Structure

```python
# main.py — router registration
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(features.router)
app.include_router(pbis.router)
app.include_router(pis.router)
app.include_router(swimlanes.router)
app.include_router(groups.router)
app.include_router(sprints.router)
app.include_router(edit_lock.router)
app.include_router(events.router)       # SSE
app.include_router(csv_import.router)
```

### 5.2 Dependency Injection

```python
async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session

async def get_current_user(session: AsyncSession = Depends(get_session)) -> User:
    # Validate HTTP-only session cookie
    ...
```

### 5.3 Layer Responsibilities

| Layer | Responsibility |
|-------|---------------|
| `routes/` | HTTP request/response binding, status codes, auth guards |
| `services/` | Business logic, multi-step operations (import, lock management) |
| `models/` | SQLAlchemy ORM: table definitions, relationships, cascade rules |
| `schemas/` | Pydantic: request body validation, response serialization |

### 5.4 Async Pattern

All database operations are `async`/`await` using SQLAlchemy 2.0 async sessions with `aiosqlite`.

```python
async def get_features(session: AsyncSession, project_id: str) -> list[Feature]:
    result = await session.execute(
        select(Feature).where(Feature.project_id == project_id)
    )
    return result.scalars().all()
```

---

## 6. Database Schema

Database file location: `~/.pi-planning/db.sqlite`

SQLite chosen for Phase 1: single-tenant, file-based, no server setup, sufficient for < 1,000 items and 1 concurrent writer.

```sql
CREATE TABLE projects (
  system_id   TEXT PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE features (
  system_id   TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  user_id     INTEGER,                    -- nullable, 1–999,999
  title       TEXT NOT NULL,
  description TEXT,
  effort      INTEGER,
  location    TEXT DEFAULT 'backlog',     -- 'backlog' | 'pi'
  pi_id       TEXT,
  swimlane_id TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id)  REFERENCES projects(system_id),
  FOREIGN KEY (pi_id)       REFERENCES pis(system_id),
  FOREIGN KEY (swimlane_id) REFERENCES swimlanes(system_id),
  UNIQUE(project_id, user_id)
);

CREATE TABLE pbis (
  system_id               TEXT PRIMARY KEY,
  project_id              TEXT NOT NULL,
  user_id                 INTEGER,
  item_type               TEXT NOT NULL DEFAULT 'pbi',  -- 'pbi' | 'bug'
  parent_feature_system_id TEXT NOT NULL,
  title                   TEXT NOT NULL,
  description             TEXT,
  effort                  INTEGER,
  location                TEXT DEFAULT 'backlog',
  pi_id                   TEXT,
  swimlane_id             TEXT,
  group_id                TEXT,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id)               REFERENCES projects(system_id),
  FOREIGN KEY (parent_feature_system_id) REFERENCES features(system_id) ON DELETE CASCADE,
  FOREIGN KEY (pi_id)                    REFERENCES pis(system_id),
  FOREIGN KEY (swimlane_id)              REFERENCES swimlanes(system_id),
  FOREIGN KEY (group_id)                 REFERENCES groups(system_id),
  UNIQUE(project_id, user_id)
);

CREATE TABLE pis (
  system_id   TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  state       TEXT NOT NULL DEFAULT 'draft',  -- 'draft'|'in_progress'|'closed'
  start_date  DATE,
  end_date    DATE,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(system_id),
  UNIQUE(project_id, name)
);

CREATE TABLE swimlanes (
  system_id   TEXT PRIMARY KEY,
  pi_id       TEXT NOT NULL,
  name        TEXT NOT NULL,
  order_index INTEGER,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pi_id) REFERENCES pis(system_id),
  UNIQUE(pi_id, name)
);

CREATE TABLE groups (
  system_id         TEXT PRIMARY KEY,
  swimlane_id       TEXT NOT NULL,
  feature_system_id TEXT NOT NULL,
  name              TEXT NOT NULL,
  sprint_index      INTEGER,            -- 0–4
  order_index       INTEGER,
  is_implicit       BOOLEAN NOT NULL DEFAULT FALSE,
  story_system_id   TEXT,              -- FK to pbis; only set for implicit groups
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (swimlane_id)       REFERENCES swimlanes(system_id),
  FOREIGN KEY (feature_system_id) REFERENCES features(system_id) ON DELETE CASCADE,
  FOREIGN KEY (story_system_id)   REFERENCES pbis(system_id) ON DELETE CASCADE
);

-- Partial unique index: each story has at most one implicit group
CREATE UNIQUE INDEX uq_implicit_group_story ON groups(story_system_id) WHERE is_implicit = TRUE;

CREATE TABLE sprints (
  system_id    TEXT PRIMARY KEY,
  pi_id        TEXT NOT NULL,
  sprint_index INTEGER,                 -- 0–4
  capacity     INTEGER NOT NULL DEFAULT 0,
  start_date   DATE,
  end_date     DATE,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pi_id) REFERENCES pis(system_id),
  UNIQUE(pi_id, sprint_index)
);

CREATE TABLE edit_lock (
  system_id           TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL UNIQUE,
  locked_by_username  TEXT,
  locked_at           TIMESTAMP,
  expires_at          TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(system_id)
);

CREATE TABLE sessions (
  session_id  TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at  TIMESTAMP,
  remember_me BOOLEAN DEFAULT FALSE
);

CREATE TABLE users (
  username      TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'viewer',  -- 'admin' | 'editor' | 'viewer'
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Performance Indexes

```sql
CREATE INDEX idx_features_project   ON features(project_id);
CREATE INDEX idx_features_user_id   ON features(project_id, user_id);
CREATE INDEX idx_features_pi        ON features(pi_id);
CREATE INDEX idx_features_swimlane  ON features(swimlane_id);
CREATE INDEX idx_pbis_project       ON pbis(project_id);
CREATE INDEX idx_pbis_user_id       ON pbis(project_id, user_id);
CREATE INDEX idx_pbis_parent        ON pbis(parent_feature_system_id);
CREATE INDEX idx_pbis_group         ON pbis(group_id);
CREATE INDEX idx_pis_project        ON pis(project_id);
CREATE INDEX idx_swimlanes_pi       ON swimlanes(pi_id);
CREATE INDEX idx_groups_swimlane    ON groups(swimlane_id);
CREATE INDEX idx_groups_feature     ON groups(feature_system_id);
CREATE INDEX idx_sprints_pi         ON sprints(pi_id);
CREATE INDEX idx_edit_lock_project  ON edit_lock(project_id);
CREATE INDEX idx_sessions_username  ON sessions(username);
CREATE INDEX idx_sessions_expires   ON sessions(expires_at);
```

### Data Integrity Rules

- Feature delete → cascade delete all child PBIs
- Feature delete → cascade delete all groups linked to that Feature
- PBI delete → remove from group; if group becomes empty, delete group
- Swimlane delete → Features return to backlog; groups deleted
- Group delete → PBIs remain, return to feature zone ungrouped (ungrouped state)
- PI state: only one `in_progress` per project (enforced at application layer)

---

## 7. API Design

### 7.1 Base URL

`http://localhost:8000/api/v1`

### 7.2 Standard Response Envelope

```json
{
  "data": { /* payload */ },
  "meta": { "timestamp": "2026-05-31T10:00:00Z" }
}
```

### 7.3 Error Envelope

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable message",
  "details": { /* context */ }
}
```

### 7.4 ID Convention

API responses always include both IDs:
- `system_id` — always present, never null; clients use this for all relationships
- `id` — user-provided ID (nullable); clients display this in UI

```json
{
  "system_id": "f550e8c6-3b25-4b29-8c5d-a8c8c8c8c8c8",
  "id": 101,
  "title": "Authentication"
}
```

### 7.5 Key Endpoints

```
# Auth
POST   /auth/login
POST   /auth/logout

# Projects
GET    /projects
POST   /projects
GET    /projects/{id}
PATCH  /projects/{id}
DELETE /projects/{id}
GET    /projects/{id}/export

# Features
GET    /projects/{id}/features
POST   /projects/{id}/features
GET    /features/{id}
PATCH  /features/{id}
DELETE /features/{id}

# PBIs
GET    /projects/{id}/pbis
POST   /projects/{id}/pbis
GET    /pbis/{id}
PATCH  /pbis/{id}
DELETE /pbis/{id}

# Direct story placement
POST   /projects/{id}/stories/{story_id}/place        # place in sprint
DELETE /projects/{id}/stories/{story_id}/place        # return to feature zone

# PIs
GET    /projects/{id}/pis
POST   /projects/{id}/pis
GET    /pis/{id}
PATCH  /pis/{id}
DELETE /pis/{id}
POST   /pis/{id}/transition                           # state change

# Swimlanes
GET    /pis/{id}/swimlanes
POST   /pis/{id}/swimlanes
PATCH  /swimlanes/{id}
DELETE /swimlanes/{id}

# Groups
GET    /swimlanes/{id}/groups
POST   /swimlanes/{id}/groups
PATCH  /groups/{id}
DELETE /groups/{id}

# Sprints
GET    /pis/{id}/sprints
PATCH  /sprints/{id}

# Edit lock
POST   /projects/{id}/edit-lock/acquire
POST   /projects/{id}/edit-lock/keepalive
DELETE /projects/{id}/edit-lock/release
GET    /projects/{id}/edit-lock

# SSE
GET    /projects/{id}/events

# CSV import
POST   /projects/{id}/import/csv
```

---

## 8. Authentication & Session Flow

```
1. User submits username/password
2. POST /auth/login
3. Backend validates (argon2id hash), creates session in DB
4. Returns Set-Cookie: session_id=...; HttpOnly; Secure; SameSite=Lax
5. Browser stores cookie automatically
6. Subsequent requests include cookie via credentials: 'include'
7. Backend validates session on every request (dependency injection)
8. Session expires: 1 hour idle / 30 days with "remember me"
```

Password storage: **argon2id** (NIST-compliant), never plain text or bcrypt for new accounts.

---

## 9. Edit Lock Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│ Frontend (read-only)                                            │
│   User clicks "Request Edit Mode"                               │
│   → POST /projects/{id}/edit-lock/acquire                       │
├─────────────────────────────────────────────────────────────────┤
│ Backend                                                         │
│   Is lock free? Yes → write to edit_lock table (30-min expiry)  │
│   Broadcast SSE: "edit-lock:acquired"                           │
│   Return lock status                                            │
├─────────────────────────────────────────────────────────────────┤
│ Frontend (now editing)                                          │
│   Show "You • Editor" (green dot)                               │
│   Every 60s → POST /projects/{id}/edit-lock/keepalive           │
│   On each user action → auto-save (debounced 100ms)             │
├─────────────────────────────────────────────────────────────────┤
│ On release or 30-min timeout                                    │
│   Backend releases lock from DB                                 │
│   Broadcast SSE: "edit-lock:released"                           │
│   All clients return to "Request Edit Mode" state               │
└─────────────────────────────────────────────────────────────────┘
```

Conflict resolution: not needed in Phase 1 — edit lock prevents simultaneous writes. If an edge case occurs, last-write-wins.

---

## 10. CSV Import Architecture

Two-phase flow to minimize backend load and give user a preview before committing:

1. **Client-side parse** (browser, no network): read file, run all structural validation, build preview summary
2. **Server-side import** (on confirm): backend receives parsed JSON rows, re-validates, executes in single transaction

Backend receives structured JSON (`CsvImportRequest`), never raw CSV bytes.

```
Client parses CSV → ParseResult → ImportPreview (shown to user)
                                         ↓ user confirms
                          POST /projects/{id}/import/csv
                                 { rows: CsvRow[] }
                          Backend re-validates + upsert in tx
                          → CsvImportResult (counts)
```

---

## 11. Configuration

Environment variables (via `pydantic-settings`, loaded from `.env`):

```
DATABASE_URL=sqlite+aiosqlite:////home/user/.pi-planning/db.sqlite
SECRET_KEY=<generated-secure-random>
DEBUG=false
SESSION_TIMEOUT_MINUTES=60
EDIT_LOCK_TIMEOUT_MINUTES=30
REMEMBER_ME_DAYS=30
ALLOWED_ORIGINS=http://localhost:5173
```

---

## 12. CORS

- Allowed origins: `localhost:5173` (dev), production domain
- Allowed methods: GET, POST, PATCH, DELETE
- Allowed headers: Content-Type
- Credentials: `include` (required for cookie-based auth)

---

## 13. Performance Targets

| Metric | Target |
|--------|--------|
| Frontend initial load | < 2s |
| API response (average) | < 200ms |
| Drag-and-drop | 60 FPS |
| Edit lock acquisition | < 100ms |
| Auto-save (debounce) | < 500ms after action |
| SSE latency to read-only users | < 500ms |

Frontend optimizations:
- Lazy-load swimlane content on expand
- Virtual scrolling for large feature lists (> 500 items)
- React Query `staleTime` to avoid redundant fetches
- Debounce search/sort inputs (100ms minimum)

Backend optimizations:
- SQLAlchemy `selectinload` for eager-loading relationships (avoid N+1)
- SSE: broadcast only to connections subscribed to the relevant project

---

## 14. Security

| Concern | Mitigation |
|---------|-----------|
| XSS | React auto-escapes; no `dangerouslySetInnerHTML`; HTTP-only cookies |
| SQL injection | SQLAlchemy ORM (parameterized queries always) |
| CSRF | SameSite=Lax cookies; no state-changing GET requests |
| Password storage | argon2id with salt |
| Session hijacking | HTTP-only, Secure, SameSite cookies |
| Input validation | Pydantic on backend; zod on frontend |
| Brute force | Rate limiting (Phase 2); lock account after N failures (Phase 2) |
| CORS | Strict allowed-origins list |
| Secrets | `SECRET_KEY` from env; never committed |

---

## 15. Testing Strategy

### Backend (pytest)

```
tests/
  unit/           # Pure function / service logic, no DB
  integration/    # FastAPI TestClient + in-memory SQLite (:memory:)
```

Critical integration flows:
- Create Feature → Create PBI → Move to PI
- Edit lock acquire → keepalive → timeout → release
- PI state transitions
- CSV import (all edge cases from spec)

### Frontend (Vitest + Cypress)

Vitest: component behavior (not implementation); custom hooks; pure utilities.

Cypress E2E golden paths:
- Login → Create Feature → Create PBI → Move to PI → Group → Drag to Sprint
- Edit lock: user A edits, user B sees amber banner and cannot edit
- Export Project → download triggered

### Commands

```bash
# Backend
pytest tests/                    # all tests
pytest tests/integration/ -v     # verbose
pytest --cov=app tests/          # coverage

# Frontend
npm run test                     # Vitest once
npm run test:watch               # watch mode
npm run test:coverage            # coverage
npm run cypress:open             # interactive E2E
npm run cypress:run              # headless CI
```

---

## 16. Development Setup

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload    # :8000

# Frontend
cd frontend
npm install
npm run dev                      # :5173
```

API docs auto-generated by FastAPI at `http://localhost:8000/docs`

---

## 17. Phase 2 Migration Path

| Concern | Phase 2 option |
|---------|----------------|
| Database | Replace SQLite with PostgreSQL (change `DATABASE_URL`; SQLAlchemy + Alembic handle the rest) |
| Concurrent editing | Replace SSE with WebSocket + Socket.io; add Redis pub/sub |
| Background jobs | Add Celery + Redis |
| Deployment | Containerize with Docker; deploy to AWS ECS / Railway / Vercel |
| CI/CD | GitHub Actions |

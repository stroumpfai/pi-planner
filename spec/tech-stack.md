# Technology Stack Specification

**Project**: PI Planning Web Application (Phase 1 MVP)
**Status**: Single-tenant, browser-based web app
**Implementation**: Will be implemented by Claude Code

---

## 1. Frontend Stack

### 1.1 Core Framework
- **Framework**: React 18+ (TypeScript)
- **Why**: 
  - Mature ecosystem with excellent drag-and-drop libraries
  - Great for complex state management (edit locks, real-time sync)
  - Large community, many UI libraries available
  - TypeScript support prevents type-related bugs
- **Version**: `^18.2.0`
- **Package**: `react`, `react-dom`

### 1.2 Build Tool
- **Tool**: Vite
- **Why**:
  - Fast dev server (instant HMR)
  - Optimized build output
  - Modern ES modules native support
  - Great TypeScript support
- **Config**: `vite.config.ts` with React plugin
- **Port**: Development server on `http://localhost:5173`

### 1.3 State Management
**Layered approach:**

#### Server State (TanStack Query)
- **Library**: `@tanstack/react-query` (v4+)
- **Purpose**: Manage server-synced data (Features, PBIs, PIs, etc.)
- **Why**:
  - Built-in caching, invalidation, refetching
  - Handles optimistic updates
  - SSE polling integration for read-only users
  - Auto-handles stale-while-revalidate pattern
- **Usage**:
  - `useQuery()` for fetching Features, PBIs, etc.
  - `useMutation()` for create/update/delete
  - `useInfiniteQuery()` for paginated lists (if needed)

#### Client UI State (Zustand)
- **Library**: `zustand`
- **Purpose**: UI-only state (modals, selections, filters, drag state)
- **Why**:
  - Minimal boilerplate
  - Simple API (no actions/reducers)
  - Small bundle size (~2KB)
  - Works well with React Query (no duplication)
- **Stores**:
  - `uiStore`: Modal visibility, selections, filters
  - `dragStore`: Current drag operation state
  - `authStore`: Current user, session state

### 1.4 UI Component Library
- **Base**: Radix UI (Headless)
- **Styling**: Tailwind CSS
- **Why**:
  - Radix: Unstyled, fully accessible components (Dialog, Select, Dropdown, etc.)
  - Tailwind: Utility-first, fast styling, minimal CSS
  - Flexibility: Can customize every component
  - Modern: Works with latest React patterns
- **Installed as**:
  - `@radix-ui/*` (Dialog, Dropdown, Tabs, ScrollArea, etc.)
  - `tailwindcss` + `postcss` + `autoprefixer`

### 1.5 Drag and Drop
- **Library**: `dnd-kit`
- **Why**:
  - Modern, headless, framework-agnostic
  - Best accessibility support (A11y)
  - Lightweight, performant
  - Excellent for nested drag scenarios (swimlanes, sprint columns, groups)
- **Core packages**:
  - `@dnd-kit/core`
  - `@dnd-kit/sortable` (for swimline reordering)
  - `@dnd-kit/utilities`
  - `@dnd-kit/modifiers` (optional, for constraints/snapping)
- **Features**:
  - Feature → Swimlane drag
  - PBI → Group creation drag
  - Group → Sprint column drag
  - Swimlane → Reorder drag

### 1.6 Styling
- **CSS Framework**: Tailwind CSS v3+
- **Configuration**: `tailwind.config.ts`
- **Approach**:
  - Utility-first CSS
  - Design tokens from spec (colors, spacing)
  - Custom components for recurring patterns (Card, Button variants)
  - Dark mode support (if needed later)
- **Plugins**:
  - `@tailwindcss/forms` (form styling)
  - `tailwind-scrollbar-hide` (hide scrollbars where needed)

### 1.7 Form Handling
- **Library**: `react-hook-form`
- **Why**:
  - Minimal re-renders
  - Easy validation integration
  - Built-in TypeScript support
- **With**: `zod` for schema validation
  - Define data shapes once
  - Validate frontend and backend consistency
  - Type-safe form handling

### 1.8 HTTP Client
- **Library**: `axios` or `fetch` API
- **Preference**: `axios`
- **Why**:
  - Request/response interceptors (auth headers, error handling)
  - Built-in timeout, retry logic
  - Better error handling than fetch
- **Usage**: Wrapped in React Query mutations/queries

### 1.9 TypeScript
- **Version**: Latest (5.0+)
- **Configuration**: `tsconfig.json`
- **Strictness**: `strict: true` (all strict checks enabled)
- **Type Safety**:
  - Generate types from backend API (e.g., `openapi-typescript`)
  - Or share TS types between frontend/backend (monorepo)

### 1.10 Formatting & Linting
- **Formatter**: Prettier
  - Config: `.prettierrc` or `package.json` config
  - Format on save: IDE integration
  - Consistency across team
- **Linter**: ESLint
  - Config: `eslintrc.cjs`
  - Rules: React, React Hooks, TypeScript
  - Pre-commit hook: Prevent committing non-compliant code

### 1.11 Testing (Frontend)
- **Unit/Integration Tests**: Vitest
  - Config: `vitest.config.ts` (integrates with Vite)
  - Test files: `src/**/*.test.ts` or `src/**/*.spec.ts`
  - Testing library: `@testing-library/react`
  - Assertions: `@testing-library/vitest` or native Vitest matchers
  - Why Vitest:
    - Built on Vite, same config
    - 5-10x faster than Jest (no Babel transpilation)
    - Drop-in Jest replacement (mostly compatible syntax)
    - Native ESM support
    - Watch mode is instant
  - Commands:
    - `npm run test` — Run tests once
    - `npm run test:watch` — Watch mode
    - `npm run test:coverage` — Coverage report
- **E2E Tests**: Cypress
  - Config: `cypress.config.ts`
  - Test files: `cypress/e2e/**/*.cy.ts`
  - Critical user flows:
    - Login → Create Feature → Create PBI → Move to PI → Group → Drag to Sprint
    - Edit Lock → User 2 sees read-only mode
    - Export Project
  - Commands:
    - `npm run cypress:open` — Interactive mode
    - `npm run cypress:run` — Headless mode (CI)

### 1.12 Frontend Dependencies Summary

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^4.4.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-dropdown-menu": "^2.0.0",
    "@radix-ui/react-tabs": "^1.0.0",
    "@radix-ui/react-scroll-area": "^1.1.0",
    "@dnd-kit/core": "^8.0.0",
    "@dnd-kit/sortable": "^8.0.0",
    "@dnd-kit/utilities": "^3.2.0",
    "tailwindcss": "^3.3.0",
    "axios": "^1.4.0",
    "react-hook-form": "^7.45.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "vite": "^4.4.0",
    "@vitejs/plugin-react": "^4.0.0",
    "typescript": "^5.1.0",
    "eslint": "^8.44.0",
    "prettier": "^2.8.0",
    "vitest": "^0.34.0",
    "@vitest/ui": "^0.34.0",
    "@testing-library/react": "^14.0.0",
    "@testing-library/vitest": "^0.0.1",
    "jsdom": "^22.1.0",
    "@vitest/coverage-v8": "^0.34.0",
    "cypress": "^13.0.0"
  }
}
```

---

## 2. Backend Stack

### 2.1 Core Framework
- **Framework**: Python + FastAPI
- **Why**:
  - Type hints built-in (Pydantic models)
  - Automatic API documentation (Swagger/ReDoc)
  - Async-first (good for I/O-bound operations like SSE)
  - Fast performance (benchmarks show ~2x faster than Flask)
  - Modern, well-maintained
- **Version**: Python 3.11+ (recommended 3.12)
- **Package**: `fastapi`

### 2.2 Database
- **Database**: SQLite 3
- **Location**: `~/.pi-planning/db.sqlite`
- **ORM**: SQLAlchemy 2.0+ (async mode)
- **Migrations**: Alembic
- **Why SQLAlchemy**:
  - Full ORM with relationships
  - Type-safe queries with SQLAlchemy 2.0 style
  - Alembic handles schema migrations
  - Works with SQLite AND can migrate to PostgreSQL
  - Supports async/await natively

### 2.3 Database Access Pattern
- **Library**: `sqlalchemy` + `alembic`
- **Session management**: Dependency injection via FastAPI
- **Pattern**: Async SQLAlchemy sessions
  ```python
  # Example
  async def get_features(session: AsyncSession) -> List[Feature]:
      result = await session.execute(select(Feature))
      return result.scalars().all()
  ```

### 2.4 Authentication & Sessions
- **Session storage**: Database (`sessions` table)
- **Password hashing**: `bcrypt` or `argon2`
- **Session library**: `itsdangerous` (secure tokens)
- **Cookie**: HTTP-only, Secure, SameSite
- **Expiry**: 1 hour (configurable "Remember me" up to 30 days)

### 2.5 Real-time Sync (SSE)
- **Protocol**: Server-Sent Events (SSE) over HTTP
- **Library**: FastAPI's `StreamingResponse`
- **Why SSE over WebSocket**:
  - One-way (server → client only)
  - Simpler to implement
  - No WebSocket library needed
  - Auto-reconnect handled by browser
  - Works through most proxies/firewalls
- **Implementation**:
  - `GET /api/projects/{project_id}/events` → SSE stream
  - Client receives updates in real-time
  - Auto-reconnect with exponential backoff (browser native)
- **Messages**:
  - Feature created/updated/deleted
  - Edit lock acquired/released
  - Group moved
  - etc.

### 2.6 API Design
- **Style**: RESTful JSON API
- **Version**: v1 (no versioning in MVP)
- **Base URL**: `http://localhost:8000/api/v1`
- **Response format**:
  ```json
  {
    "data": { /* response payload */ },
    "meta": { "timestamp": "2026-03-05T..." }
  }
  ```
- **Error format**:
  ```json
  {
    "error": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { /* additional context */ }
  }
  ```

### 2.7 Validation
- **Schema validation**: Pydantic v2
- **Input validation**: Pydantic models for request bodies
- **Output validation**: Pydantic models for responses
- **Business logic validation**: SQLAlchemy constraints + custom validation
- **Example**:
  ```python
  from pydantic import BaseModel, Field
  
  class FeatureCreate(BaseModel):
      title: str = Field(..., max_length=255)
      description: Optional[str] = Field(None, max_length=2000)
      effort: Optional[int] = Field(None, ge=1)
      user_id: Optional[int] = Field(None, ge=1, le=999999)
  ```

### 2.8 Testing (Backend)
- **Unit Tests**: pytest
  - Config: `pyproject.toml`
  - Test files: `tests/unit/**/*.py`
  - Coverage: `pytest-cov`
- **Integration Tests**: pytest + TestClient
  - Test files: `tests/integration/**/*.py`
  - Database: Temporary SQLite in-memory (`:memory:`)
  - FastAPI TestClient for API testing
- **Critical flows**:
  - Create Feature → Create PBI → Move to PI
  - Edit lock acquisition → timeout → release
  - Project export/import (JSON)
  - Multi-user access (read-only while editing)

### 2.9 Async & Concurrency
- **Async runtime**: `asyncio` (built-in)
- **Async driver**: `aiosqlite` for SQLite
- **Concurrency model**:
  - 1 write request at a time (edit lock enforces)
  - Multiple read requests in parallel (no lock)
  - SSE connections (streaming, no lock)

### 2.10 Environment & Configuration
- **Config**: `pydantic-settings`
- **Environment file**: `.env` (for development)
- **Variables**:
  ```
  DATABASE_URL=sqlite:////path/to/db.sqlite
  SECRET_KEY=<generated-on-first-run>
  DEBUG=true
  SESSION_TIMEOUT_MINUTES=60
  EDIT_LOCK_TIMEOUT_MINUTES=30
  ```

### 2.11 Logging
- **Library**: Python's `logging` module
- **Configuration**: Structured logging (JSON output for production)
- **Levels**: DEBUG (dev), INFO (general), WARNING (issues), ERROR (failures)
- **Files**: `logs/app.log` (if file logging enabled)

### 2.12 Backend Dependencies Summary

```toml
[project]
dependencies = [
    "fastapi>=0.104.0",
    "uvicorn[standard]>=0.23.0",
    "sqlalchemy>=2.0.0",
    "alembic>=1.12.0",
    "aiosqlite>=0.19.0",
    "pydantic>=2.0.0",
    "pydantic-settings>=2.0.0",
    "python-multipart>=0.0.6",
    "bcrypt>=4.0.0",
    "itsdangerous>=2.1.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-cov>=4.1.0",
    "pytest-asyncio>=0.21.0",
    "httpx>=0.24.0",
    "black>=23.0.0",
    "ruff>=0.1.0",
    "mypy>=1.4.0",
]
```

---

## 3. Full Stack Integration

### 3.1 Development Environment

**Required:**
- Node.js 18+ (for frontend)
- npm 9+ (comes with Node)
- Python 3.11+ (for backend)

**Optional (but recommended):**
- Docker (for consistent environment)
- Docker Compose (for local database/redis)
- VS Code + Extensions:
  - ES7+ React/Redux/React-Native snippets
  - Prettier - Code formatter
  - ESLint
  - Python
  - Pylance
  - SQLTools (for SQLite browsing)

### 3.2 Project Structure

```
pi-planning/
├── backend/                    # Python/FastAPI
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py            # FastAPI app setup
│   │   ├── config.py          # Configuration
│   │   ├── database.py        # SQLAlchemy setup
│   │   ├── models/            # SQLAlchemy models
│   │   ├── schemas/           # Pydantic schemas
│   │   ├── routes/            # API endpoints
│   │   ├── services/          # Business logic
│   │   ├── middleware/        # Auth, CORS, etc.
│   │   └── utils/             # Helpers
│   ├── migrations/            # Alembic migrations
│   ├── tests/
│   ├── pyproject.toml
│   ├── .env.example
│   └── README.md
│
├── frontend/                   # React/Vite
│   ├── src/
│   │   ├── main.tsx           # Entry point
│   │   ├── App.tsx
│   │   ├── components/        # React components
│   │   │   └── __tests__/     # Component tests (Vitest)
│   │   ├── pages/             # Page layouts
│   │   ├── hooks/             # Custom hooks
│   │   │   └── __tests__/     # Hook tests (Vitest)
│   │   ├── stores/            # Zustand stores
│   │   │   └── __tests__/     # Store tests (Vitest)
│   │   ├── services/          # API client
│   │   │   └── __tests__/     # Service tests (Vitest)
│   │   ├── types/             # TypeScript types
│   │   ├── utils/             # Helpers
│   │   │   └── __tests__/     # Utility tests (Vitest)
│   │   ├── styles/            # Global styles
│   │   └── assets/            # Images, icons
│   ├── public/                # Static assets
│   ├── cypress/               # Cypress E2E tests
│   │   ├── e2e/               # E2E test specs
│   │   ├── support/           # Cypress helpers
│   │   └── fixtures/          # Test data
│   ├── vite.config.ts         # Vite + Vitest config
│   ├── vitest.config.ts       # Vitest-specific overrides (optional)
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── cypress.config.ts
│   ├── package.json
│   ├── .env.example
│   └── README.md
│
├── spec/                      # Specifications
│   ├── p2-pi-planning-detailed-IMPROVED.md
│   ├── TECHNICAL-SPEC-IDS-DATABASE.md
│   └── TECH-STACK.md
│
├── docker-compose.yml         # Local development stack
├── README.md                  # Root README
└── .gitignore
```

### 3.3 API Base URLs

**Development:**
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`
- API: `http://localhost:8000/api/v1`

**Production:**
- Frontend: `https://pi-planning.example.com`
- API: `https://api.pi-planning.example.com/api/v1`

### 3.4 CORS Configuration
- **Allowed origins**: `localhost:5173` (dev), `pi-planning.example.com` (prod)
- **Allowed methods**: GET, POST, PATCH, DELETE
- **Allowed headers**: Content-Type, Authorization
- **Credentials**: Include (for cookies)

### 3.5 Authentication Flow

```
1. User submits username/password (frontend form)
2. POST /api/v1/auth/login (unencrypted, HTTPS only)
3. Backend validates, creates session, returns Set-Cookie
4. Browser stores HTTP-only cookie automatically
5. Subsequent requests include cookie (CORS credentials: include)
6. Backend validates session, returns user + edit lock status
7. Frontend displays edit mode button or read-only indicator
```

### 3.6 Edit Lock Workflow

```
Frontend (Read-only)
│
├─ User clicks "Request Edit Mode"
│  └─ POST /api/v1/projects/{id}/edit-lock/acquire
│
Backend
├─ Check: Is lock free? Yes → Acquire & store in DB with 30-min expiry
├─ Send SSE event: "edit-lock:acquired" to all clients
└─ Return lock status
│
Frontend (Now Editing)
├─ Show "You • Editor"
├─ Every 1 minute: heartbeat POST /api/v1/projects/{id}/edit-lock/keepalive
├─ User makes changes (auto-save on each action)
└─ User clicks "Release Edit Mode" OR goes inactive 30 min
│
Backend (On release/timeout)
├─ Release lock from DB
├─ Send SSE event: "edit-lock:released"
└─ Other clients back to "Request Edit Mode" state
```

---

## 4. Development Workflow

### 4.1 Local Development (Single Machine)

**Terminal 1 (Backend):**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -e ".[dev]"
alembic upgrade head     # Run migrations
uvicorn app.main:app --reload --port 8000
```

**Terminal 2 (Frontend):**
```bash
cd frontend
npm install
npm run dev              # Vite dev server on :5173
```

**Access:**
- App: `http://localhost:5173`
- API Docs: `http://localhost:8000/docs`

### 4.2 Docker Development (Optional)

```yaml
# docker-compose.yml
version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: sqlite:////app/db.sqlite
    volumes:
      - ./backend:/app
      - pi-planning-db:/app/data

  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    volumes:
      - ./frontend:/app
      - /app/node_modules

volumes:
  pi-planning-db:
```

### 4.3 Build & Deploy

**Frontend build:**
```bash
npm run build          # Vite builds to dist/
npm run preview        # Test build locally
```

**Backend deployment:**
```bash
# Gunicorn + Uvicorn workers (production)
gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000
```

---

## 5. Key Design Decisions & Rationale

| Decision | Choice | Why Not Alternative |
|----------|--------|-------|
| Backend | Python + FastAPI | Node.js/Express is faster but less type-safe; FastAPI + Pydantic ensures API consistency |
| Frontend | React | Vue is simpler but React ecosystem larger; Svelte is trendy but less suitable for complex drag-and-drop |
| Build | Vite | CRA is slower; Next.js adds SSR complexity we don't need |
| State Mgmt | React Query + Zustand | Redux would be overkill; Context API lacks caching/sync features |
| UI Lib | Radix + Tailwind | MUI is opinionated; shadcn/ui is good but Radix is more flexible |
| Drag-drop | dnd-kit | react-beautiful-dnd is mature but less accessible; react-dnd is more complex |
| Testing | Vitest + Cypress | Jest is mature but 5-10x slower; Vitest is Vite-native, instant HMR in watch mode |
| Real-time | SSE | WebSocket is overkill for one-way push; polling wastes bandwidth |
| Database | SQLite | PostgreSQL unnecessary for single-tenant MVP; can migrate easily |
| ORM | SQLAlchemy | Raw SQL too error-prone; Tortoise is too new/unproven |

---

## 6. Performance Targets

- **Frontend load time**: < 2s (Lighthouse score > 80)
- **API response time**: < 200ms (average)
- **Drag-and-drop**: 60 FPS (smooth)
- **Edit lock acquisition**: < 100ms
- **Auto-save**: < 500ms (debounced)
- **SSE latency**: < 500ms (for read-only users)

---

## 7. Security Considerations

1. **HTTPS only**: All production traffic encrypted
2. **HTTP-only cookies**: Session tokens immune to XSS
3. **CSRF protection**: FastAPI `CsrfProtectMiddleware` if needed
4. **SQL injection**: SQLAlchemy ORM prevents
5. **XSS**: React auto-escapes; Tailwind classes prevent inline styles
6. **Password hashing**: Bcrypt with salt
7. **Input validation**: Pydantic on backend, react-hook-form on frontend
8. **CORS**: Strict allowed origins
9. **Rate limiting**: Future (not MVP)

---

## 8. Dependencies Maintenance

### Frontend
- Peer dependencies: React 18+
- Major libraries: Update quarterly
- Type definitions: Use @types/* packages

### Backend
- Python version: Lock to 3.12.x
- SQLAlchemy: Follow 2.0 patterns (async/await)
- Alembic: Keep in sync with SQLAlchemy

### Monitoring Tools
- Frontend: Lighthouse (Chrome DevTools)
- Backend: FastAPI logs, uvicorn stats
- Database: SQLite CLI, or SQLTools VS Code extension

---

## 9. Migration Path (Phase 2+)

### If Scaling Needed:
1. **PostgreSQL migration**:
   - SQLAlchemy + Alembic handle schema migration
   - Change `DATABASE_URL` connection string
   - No code changes required (abstracted by ORM)

2. **Real-time upgrade** (if concurrent editing):
   - Replace SSE with WebSocket + Socket.io
   - Add Celery for background tasks
   - Add Redis for pub/sub and caching

3. **Cloud deployment**:
   - Containerize with Docker
   - Deploy to AWS ECS, Railway, or Vercel
   - Add CI/CD (GitHub Actions)

---

## 10. Summary

| Layer | Tech | Version |
|-------|------|---------|
| **Frontend** | React | 18+ |
| **Build** | Vite | 4.4+ |
| **State** | React Query + Zustand | 5.0+ / 4.4+ |
| **UI** | Radix + Tailwind | Latest |
| **Drag-drop** | dnd-kit | 8.0+ |
| **Testing** | Vitest + Cypress | 0.34+ / 13+ |
| **Backend** | FastAPI | 0.104+ |
| **Python** | Python | 3.11+ |
| **Database** | SQLite 3 | Latest |
| **ORM** | SQLAlchemy | 2.0+ |
| **Migrations** | Alembic | 1.12+ |
| **Real-time** | SSE | HTTP/1.1 |

---

## 11. Getting Started (For Claude Code Implementation)

1. **Clone/initialize repo structure** (as per section 3.2)
2. **Backend setup**:
   - Create `pyproject.toml` with dependencies
   - Initialize FastAPI app with routes skeleton
   - Set up SQLAlchemy models from TECHNICAL-SPEC-IDS-DATABASE.md
   - Create Alembic migrations

3. **Frontend setup**:
   - Initialize Vite React TypeScript project
   - Configure Tailwind CSS
   - Set up Vitest config (vite.config.ts with test option)
   - Set up Zustand stores for UI state
   - Configure React Query client
   - Set up Cypress for E2E testing

4. **API contract**:
   - Define Pydantic schemas for all endpoints
   - Generate TypeScript types from OpenAPI spec
   - Implement API client wrapper

5. **Integration**:
   - Connect React Query to FastAPI backend
   - Set up authentication flow
   - Implement SSE for read-only users


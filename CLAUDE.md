# CLAUDE.md - PI Planning Application

## Project Overview

**PI Planning Web Application** — A single-tenant, browser-based tool for Product Owners and Product Managers to manage PI (Program Increment) planning and roadmaps.

- **Status**: Phase 1 MVP
- **Type**: Web app (React frontend + Python backend)
- **Scope**: Backlog management + PI planning with swimlanes, sprints, grouping
- **Users**: Small team (1 editor + up to 10 readers)
- **Database**: SQLite (file-based at `~/.pi-planning/db.sqlite`)

---

## Key Constraints & Decisions

### Single-Writer Pattern
⚠️ **Critical**: Only **ONE user can edit at a time**. All others are read-only.
- Edit lock acquired via "Request Edit Mode" button
- Lock held for 30 minutes (auto-timeout)
- Lock released on logout or timeout
- Read-only users see live updates via SSE
- No queuing, no takeover — users wait for editor to finish

### Dual-ID System
⚠️ **Important**: Every Feature and PBI has two IDs:

1. **`system_id`** (UUID) — Database primary key, internal only
   - Never exposed in UI
   - Used for all database relationships
   - Auto-generated, immutable
   
2. **`user_id`** (1–999,999) — Business identifier, user-visible
   - Optional (can be blank)
   - User-editable anytime
   - Must be unique per project
   - Shown in UI as `[101] Feature Name`

→ **API responses always include both**. Frontend uses `system_id` for API calls, displays `user_id` in UI.

### Phase 1 Scope (No CSV, Dependencies, Rich Text)
- ✗ CSV import/export (Phase 2)
- ✗ Dependencies/predecessor-successor (Phase 2)
- ✗ Rich text descriptions (plain text only)
- ✗ Advanced search (sort by name only)
- ✗ User registration (admin creates accounts)

---

## Tech Stack

| Layer | Technology | Key Points |
|-------|-----------|-----------|
| **Frontend** | React 18 + Vite + TypeScript | Components in `src/components/`, hooks in `src/hooks/` |
| **State Mgmt** | React Query + Zustand | Server state (Query), UI state (Zustand) |
| **UI** | Radix UI + Tailwind CSS | Unstyled components + utility-first styling |
| **Drag-Drop** | dnd-kit | Feature→Swimlane, PBI→Group, Group→Sprint, Swimlane reorder |
| **Testing** | Vitest + Cypress | Unit/integration (Vitest), E2E (Cypress) |
| **Backend** | Python 3.11+ + FastAPI | Async, type-safe with Pydantic |
| **Database** | SQLite 3 | File-based at `~/.pi-planning/db.sqlite` |
| **ORM** | SQLAlchemy 2.0 + Alembic | Async ORM, migrations |
| **Real-time** | Server-Sent Events (SSE) | One-way push for read-only users |

---

## Project Structure

```
pi-planning/
├── backend/                 # Python/FastAPI
│   ├── app/
│   │   ├── main.py         # FastAPI app + routes
│   │   ├── database.py     # SQLAlchemy session, engine
│   │   ├── models/         # SQLAlchemy ORM models
│   │   ├── schemas/        # Pydantic request/response models
│   │   ├── routes/         # API endpoints (by resource)
│   │   ├── services/       # Business logic
│   │   ├── middleware/     # Auth, CORS, etc.
│   │   └── utils/          # Helpers
│   ├── migrations/         # Alembic migrations
│   ├── tests/              # pytest tests
│   ├── pyproject.toml
│   └── .env.example
│
├── frontend/                # React/Vite
│   ├── src/
│   │   ├── main.tsx        # Entry point
│   │   ├── App.tsx         # Root component
│   │   ├── components/     # Reusable components
│   │   ├── pages/          # Page containers
│   │   ├── hooks/          # Custom hooks
│   │   ├── stores/         # Zustand stores
│   │   ├── services/       # API client
│   │   ├── types/          # TypeScript interfaces
│   │   ├── utils/          # Helpers
│   │   └── styles/         # Global CSS
│   ├── cypress/            # E2E tests
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   └── package.json
│
├── spec/                    # Specifications (READ FIRST)
│   ├── p2-pi-planning-detailed-IMPROVED.md
│   ├── TECHNICAL-SPEC-IDS-DATABASE.md
│   └── TECH-STACK.md
│
└── TECH-STACK.md           # (referenced above)
```

---

## Before You Start

### 📖 Read These Specs First
1. **`spec/p2-pi-planning-detailed-IMPROVED.md`** — Full Phase 1 specification (features, workflows, constraints)
2. **`spec/TECHNICAL-SPEC-IDS-DATABASE.md`** — ID system, database schema, API examples
3. **`TECH-STACK.md`** — Technology choices and integration patterns

### Key Files to Understand
- **Database schema**: See `spec/TECHNICAL-SPEC-IDS-DATABASE.md` (section 4.3)
- **API endpoints**: Use REST pattern, Pydantic schemas for validation
- **Edit lock flow**: Critical for single-writer, see spec section 1.2 and TECH-STACK section 3.6
- **Frontend state**: React Query for server state, Zustand for UI state (don't duplicate)

---

## Development Workflow

### Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate          # or venv\Scripts\activate on Windows
pip install -e ".[dev]"
alembic upgrade head              # Run migrations
uvicorn app.main:app --reload     # Start dev server (port 8000)
```

### Frontend Setup
```bash
cd frontend
npm install
npm run dev                        # Start Vite dev server (port 5173)
npm run test                       # Run Vitest
npm run test:watch                # Watch mode
npm run cypress:open              # Interactive E2E tests
```

### Database
- SQLite file: `~/.pi-planning/db.sqlite`
- View with: SQLTools VS Code extension
- Migrations: `alembic/versions/`
- Never commit migrations from random branches (see schema locks)

---

## Coding Standards

### TypeScript (Frontend)
- **Strict mode enabled**: `strict: true` in tsconfig.json
- **No `any` types**: Use proper interfaces/types
- **Component exports**: Named exports preferred
- **Props interface**: Create `interface Props {}` for component props
- **Naming**: Components PascalCase, files match component name

```typescript
// ✓ Good
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
- **Type hints everywhere**: `def get_features(session: AsyncSession) -> list[Feature]:`
- **Pydantic models**: For all request/response bodies
- **SQLAlchemy async**: Always use `async def`, `await`
- **No raw SQL**: Use ORM queries except for complex ones (document why)
- **Naming**: snake_case for functions/variables, PascalCase for classes

```python
# ✓ Good
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

async def get_features(session: AsyncSession, project_id: str) -> list[Feature]:
    result = await session.execute(
        select(Feature).where(Feature.project_id == project_id)
    )
    return result.scalars().all()
```

### API Design
- **Endpoints**: RESTful JSON
- **Response format**: 
  ```json
  {
    "data": { /* payload */ },
    "meta": { "timestamp": "ISO-8601" }
  }
  ```
- **Error format**:
  ```json
  {
    "error": "ERROR_CODE",
    "message": "Human-readable message",
    "details": { /* context */ }
  }
  ```
- **IDs in responses**: Always include both `system_id` and `id` (user_id)

### React Components
- **State management**: 
  - Server data → React Query (`useQuery`, `useMutation`)
  - UI state → Zustand (modal visibility, selections)
  - Don't duplicate server state in Zustand
- **Hooks**: Extract complex logic into custom hooks (`src/hooks/`)
- **Testing**: Test component behavior, not implementation details

### Database
- **Always use ORM**: SQLAlchemy models, not raw SQL
- **Relationships**: Define properly in models (FK constraints)
- **Cascade rules**: Delete Feature → delete child PBIs (model level + database)
- **Migrations**: One migration per logical change
  ```bash
  alembic revision --autogenerate -m "add swimlane table"
  alembic upgrade head
  ```

---

## Common Tasks

### Add a New API Endpoint

1. **Create Pydantic schema** (`backend/app/schemas/`):
   ```python
   from pydantic import BaseModel, Field
   
   class FeatureCreate(BaseModel):
       title: str = Field(..., max_length=255)
       user_id: Optional[int] = Field(None, ge=1, le=999999)
   ```

2. **Create route** (`backend/app/routes/`):
   ```python
   from fastapi import APIRouter, Depends
   from sqlalchemy.ext.asyncio import AsyncSession
   
   router = APIRouter(prefix="/api/v1/features", tags=["features"])
   
   @router.post("/")
   async def create_feature(
       feature: FeatureCreate,
       session: AsyncSession = Depends(get_session)
   ) -> FeatureResponse:
       # Business logic here
       return FeatureResponse(...)
   ```

3. **Add to main app** (`backend/app/main.py`):
   ```python
   from app.routes import features
   app.include_router(features.router)
   ```

4. **Test with FastAPI docs**: `http://localhost:8000/docs`

### Add a New React Component

1. **Create component** (`frontend/src/components/MyComponent.tsx`):
   ```typescript
   interface MyComponentProps {
     title: string
     onSubmit: (value: string) => void
   }
   
   export const MyComponent: React.FC<MyComponentProps> = ({ title, onSubmit }) => {
     return <div>{title}</div>
   }
   ```

2. **Export from index** (`frontend/src/components/index.ts`):
   ```typescript
   export { MyComponent } from './MyComponent'
   ```

3. **Use in page**:
   ```typescript
   import { MyComponent } from '@/components'
   ```

### Fetch Data with React Query

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '@/services/api'

export const useFeatures = (projectId: string) => {
  return useQuery({
    queryKey: ['features', projectId],
    queryFn: () => api.get(`/projects/${projectId}/features`),
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}
```

### Implement Edit Lock Flow

**Backend**:
```python
# POST /api/v1/projects/{project_id}/edit-lock/acquire
async def acquire_edit_lock(project_id: str, session: AsyncSession):
    lock = await session.get(EditLock, project_id)
    if lock and lock.expires_at > datetime.now():
        raise HTTPException(status_code=409, detail="Already locked")
    # Create/update lock with 30-min expiry
    return {"locked_by": username, "expires_at": expiry_time}
```

**Frontend**:
```typescript
const { mutate: acquireEditLock } = useMutation({
  mutationFn: () => api.post(`/projects/${projectId}/edit-lock/acquire`),
  onSuccess: () => {
    setIsEditing(true)
    queryClient.invalidateQueries({ queryKey: ['editLock', projectId] })
  },
})
```

### Drag-and-Drop with dnd-kit

```typescript
import { DndContext } from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'

// Draggable item
function DraggableFeature({ id, title }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id })
  return <div ref={setNodeRef} {...listeners} {...attributes}>{title}</div>
}

// Drop zone
function DropZone({ id }) {
  const { setNodeRef } = useDroppable({ id })
  return <div ref={setNodeRef}>Drop here</div>
}

// In container
<DndContext onDragEnd={handleDragEnd}>
  <DraggableFeature id="f1" title="Auth" />
  <DropZone id="swimlane1" />
</DndContext>
```

---

## Testing

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

  it('calls onEdit when edit button clicked', async () => {
    const onEdit = vi.fn()
    render(<FeatureCard featureId="f1" title="Auth" onEdit={onEdit} />)
    await userEvent.click(screen.getByRole('button', { name: /edit/i }))
    expect(onEdit).toHaveBeenCalled()
  })
})
```

**Run tests**:
```bash
npm run test              # Once
npm run test:watch       # Watch mode
npm run test:coverage    # Coverage report
```

### Backend (pytest)

```python
import pytest
from fastapi.testclient import TestClient
from app.main import app

@pytest.fixture
def client():
    return TestClient(app)

def test_create_feature(client, session):
    response = client.post(
        "/api/v1/features",
        json={"title": "Auth", "user_id": 101}
    )
    assert response.status_code == 201
    assert response.json()["data"]["id"] == 101
```

**Run tests**:
```bash
pytest tests/                    # All tests
pytest tests/unit/ -v            # Verbose
pytest --cov=app tests/          # Coverage
```

### E2E (Cypress)

```typescript
describe('Create Feature Flow', () => {
  beforeEach(() => {
    cy.visit('http://localhost:5173')
    cy.login('user@example.com', 'password')
  })

  it('creates a feature and PBI', () => {
    cy.get('[data-testid="btn-create-feature"]').click()
    cy.get('input[name="title"]').type('Authentication')
    cy.get('input[name="id"]').type('101')
    cy.get('button[type="submit"]').click()
    cy.contains('Authentication').should('be.visible')
  })
})
```

**Run E2E tests**:
```bash
npm run cypress:open    # Interactive
npm run cypress:run     # Headless (CI)
```

---

## Critical Implementation Details

### Edit Lock
- Stored in `edit_lock` table (one per project)
- Timeout: 30 minutes from last heartbeat
- Heartbeat: Client pings every 1 minute (POST `/edit-lock/keepalive`)
- Release: User clicks button OR timeout fires
- SSE broadcasts lock state to all clients
- No queuing — if locked, request fails with 409 Conflict

### Auto-save
- Triggered on every action (create, edit, delete, move)
- Debounced 100ms (rapid changes batched)
- Optimistic updates (UI updates before response)
- Save indicator shows briefly (checkmark)
- No explicit "Save" button required

### Real-time Updates (SSE)
- One-way: Server → read-only clients only
- URL: `GET /api/v1/projects/{project_id}/events`
- Events: Feature created/updated/deleted, group moved, lock acquired/released, etc.
- Auto-reconnect: Browser handles via native EventSource API
- Used for: Lock indicator, live updates when another user edits

### ID System
- **Display**: Show `[101] Feature Name` in UI (user_id only)
- **API responses**: Include both `system_id` and `id` (user_id)
- **API requests**: Use `system_id` in URLs and bodies (for relationships)
- **Database**: All FKs use system_id
- **Validation**: Unique (project_id, user_id) constraint in DB

### Swimline/Group Movement
- Feature drag → swimlane: Feature placed in swimlane feature zone
- PBI multi-select → create group: Group created, appears in feature zone
- Group drag → sprint: Group moves to sprint column
- Swimlane drag → reorder: Swimline order updated
- All movements use dnd-kit with proper drop zone validation

---

## Important Notes

### ⚠️ Do NOT
- Expose `system_id` in UI (keep it internal)
- Allow CSV import (Phase 2 only)
- Add dependency tracking (Phase 2 only)
- Use rich text editors (plain text only)
- Create multiple PIs in "In Progress" state
- Allow undelete/trash (deletions are permanent)
- Skip database constraints (enforce at DB level)

### ✅ Do
- Include both `system_id` and `user_id` in API responses
- Use React Query for server state (no Zustand duplication)
- Use Zustand only for UI state (modals, selections)
- Validate user IDs (1–999,999 range, uniqueness per project)
- Handle edit lock 409 errors gracefully (show "locked" UI)
- Test critical flows: create → edit → move → delete
- Document API schema (FastAPI Swagger auto-generates)
- Use TypeScript strict mode (no `any` types)

### 🔄 Common Workflows
1. **Create Feature** → Create PBIs → Move to PI → Create Groups → Assign to Sprints
2. **Edit Lock Request** → User edits → Auto-save on each action → Release lock
3. **Read-only User** → Sees live updates via SSE → Waits for editor → Requests lock when ready
4. **Export Project** → JSON file with all PIs, backlog, metadata → Can be re-imported (Phase 2)

---

## Database Migrations

### Create a Migration
```bash
cd backend
alembic revision --autogenerate -m "add swimline color field"
# Edit alembic/versions/xxxx_add_swimline_color_field.py if needed
alembic upgrade head
```

### Migrate Back
```bash
alembic downgrade -1
```

### Never
- Edit migration files after running (create new migration instead)
- Migrate database by hand (always use Alembic)
- Create circular FKs (SQLAlchemy will catch it)

---

## Performance Considerations

### Frontend
- Lazy load swimline content (render on-demand, not all at once)
- Virtual scrolling for large feature lists (if > 500 items)
- Debounce search/sort (100ms minimum)
- Cache API responses via React Query (staleTime settings)

### Backend
- Index on `(project_id, user_id)` for fast lookups
- Index on `project_id` for filtering
- N+1 queries: Use SQLAlchemy eager loading (`selectinload`)
- SSE: Don't broadcast to all users, only those in project

### Database
- SQLite: Fine for MVP (< 1000 items per project)
- Backup: Copy `~/.pi-planning/db.sqlite` regularly
- Vacuum: Run `VACUUM` periodically if database grows (optional)

---

## Debugging

### API Debugging
```bash
# View API docs and test endpoints
open http://localhost:8000/docs

# View database with SQLTools (VS Code)
# Right-click db.sqlite in explorer → Create Connection

# Check backend logs
tail -f backend/logs/app.log (if enabled)
```

### Frontend Debugging
```bash
# React Query Devtools (optional addon)
# Zustand store logging: console.log(store.getState())
# Network tab: Check SSE connection for real-time
```

### Common Issues
- **"Already locked" error**: Another user editing → show "locked by X" UI
- **Missing SSE updates**: Check EventSource connection in Network tab
- **Duplicate user_id error**: DB constraint violated → show error dialog
- **Drag-drop not working**: Check dnd-kit context is wrapping drop zones

---

## Deployment

### Local Testing
```bash
# Backend
cd backend && uvicorn app.main:app --reload

# Frontend
cd frontend && npm run dev

# Access app
open http://localhost:5173
```

### Build for Production
```bash
# Frontend
cd frontend && npm run build  # Creates dist/

# Backend
# Package with gunicorn or deploy to cloud (see TECH-STACK.md)
```

---

## Links & References

- **Full Spec**: `spec/p2-pi-planning-detailed-IMPROVED.md`
- **Database Schema**: `spec/TECHNICAL-SPEC-IDS-DATABASE.md` (section 4.3)
- **Tech Stack**: `TECH-STACK.md`
- **API Examples**: `spec/TECHNICAL-SPEC-IDS-DATABASE.md` (section 5)

---

## Questions?

If something is unclear:
1. Check the spec documents (links above)
2. Look for examples in `backend/app/routes/` or `frontend/src/components/`
3. Run tests to see expected behavior
4. Ask in code comments (document *why*, not *what*)

---

**Happy coding! Build incrementally, test frequently, and reference the specs often.** 🚀


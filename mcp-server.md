# MCP Server for PI Planner

## Overview

A server-side MCP (Model Context Protocol) wrapper around the existing FastAPI backend.
Allows Claude to assist with PI planning tasks: querying the board, creating and updating
items, restructuring the PI, and running compound workflows.

Key design decisions:
- **Auth**: Per-user API keys created by admins, usable by admins and editors. Claude acts as the key owner.
- **Edit lock**: Option B — MCP auto-acquires and releases the lock per operation.
- **Activity log**: Human vs. Claude activities logged separately, mapped back to key owner.
- **Compound tools**: Multi-step workflows (e.g. bulk create, plan PI backlog) hold the lock for the entire batch.

---

## Deployment Plan

### Step 1 — MVP (Groups 1 + 2)

Delivers a working MCP server that can read the full board and manage the project/PI
lifecycle. No write access to features, PBIs, swimlines, or groups yet. Validates the
auth flow, edit lock, activity log, and frontend key management end-to-end before
expanding scope.

**Scope:** 17 tools — all of Group 1 (read) + Group 2 (project & PI lifecycle)

**Parallel workstreams — run as 3 subagents simultaneously:**

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│  Subagent A             │  │  Subagent B             │  │  Subagent C             │
│  Backend foundations    │  │  MCP server scaffold    │  │  Frontend: API Keys tab │
├─────────────────────────┤  ├─────────────────────────┤  ├─────────────────────────┤
│ • APIKey model          │  │ • mcp_server/ package   │  │ • Tabs.Root wiring in   │
│ • ActivityLog model     │  │ • config.py             │  │   UserManagementModal   │
│ • Alembic migration     │  │ • auth.py               │  │ • ApiKeysTab component  │
│ • auth.py extensions    │  │ • backend.py            │  │ • ApiKeyCard component  │
│   (create/verify/revoke)│  │ • lock.py               │  │ • IssueKeyForm          │
│ • activity.py service   │  │ • server.py (lifespan,  │  │ • SecretRevealPanel     │
│ • api_keys.py routes    │  │   middleware, health)   │  │ • apiKeys.ts service    │
│ • mcp_activity middleware│  │ • tools/read.py         │  │ • Type exports          │
│ • /health endpoint      │  │ • tools/projects.py     │  │ • Cycle / Revoke flows  │
│ • deps.py JWT verify    │  │ • tests/conftest.py     │  │                         │
└────────────┬────────────┘  └────────────┬────────────┘  └────────────┬────────────┘
             │                            │                            │
             └────────────────────────────┴────────────────────────────┘
                                          │
                              Integration point (sequential):
                              • Wire Subagent B tools to Subagent A backend
                              • Run: pytest backend/tests/ + pytest mcp_server/tests/
                              • Smoke test: admin creates key → Claude calls list_projects
```

**Sequencing within MVP:**
1. **Subagents A, B, C run in parallel** — they touch different parts of the codebase
2. **Subagent A must complete first** before B can be wired to a real backend
   (B can use `respx` mocks until A is done)
3. **Integration** — one final sequential pass: wire + test + smoke test

**Gate before Step 2:**
- [ ] Admin creates API key in UI → key appears in list
- [ ] Claude calls `list_projects` via MCP → returns real data
- [ ] Claude calls `create_pi` → PI appears in UI
- [ ] Activity log shows `actor_type=mcp_bot` for all Claude calls
- [ ] `health://status` returns `{"status": "healthy"}`
- [ ] `pytest backend/tests/ && pytest mcp_server/tests/` all green

---

### Step 2 — Full (Groups 3–6)

Adds write access across all resources and compound workflow tools. Builds on the
validated auth/lock/log infrastructure from Step 1.

**Scope:** remaining 18 tools — Groups 3 (swimlines), 4 (features + PBIs),
5 (groups), 6 (workflows)

**Parallel workstreams — run as 3 subagents simultaneously:**

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│  Subagent D             │  │  Subagent E             │  │  Subagent F             │
│  Groups 3 + 4 tools     │  │  Group 5 + 6 tools      │  │  Tests                  │
├─────────────────────────┤  ├─────────────────────────┤  ├─────────────────────────┤
│ • tools/swimlines.py    │  │ • tools/groups.py       │  │ • test_contract.py      │
│   - create_swimline     │  │   - create/update/      │  │   (all 35 tools listed) │
│   - update_swimline     │  │     delete_group        │  │ • test_tools/           │
│   - delete_swimline     │  │ • tools/workflows.py    │  │   test_swimlines.py     │
│   - reorder_swimlines   │  │   - bulk_create_features│  │   test_features.py      │
│ • tools/features.py     │  │   - bulk_create_pbis    │  │   test_groups.py        │
│   - create/update/      │  │   - plan_pi_backlog     │  │   test_workflows.py     │
│     move_feature        │  │   - set_sprint_capacities│ │ • test_lock.py edge     │
│   - create/update_pbi   │  │   - propose_pbi_sprint_ │  │   cases (long batches,  │
│   - place/remove_pbi_   │  │     plan (read-only)    │  │   partial failures)     │
│     in_sprint           │  │   - apply_pbi_sprint_   │  │                         │
│                         │  │     plan                │  │                         │
│                         │  │   - summarize_project   │  │                         │
└────────────┬────────────┘  └────────────┬────────────┘  └────────────┬────────────┘
             │                            │                            │
             └────────────────────────────┴────────────────────────────┘
                                          │
                              Integration point (sequential):
                              • D must complete before E's workflow tools
                                (plan_pi_backlog and apply_pbi_sprint_plan
                                 depend on move_feature and place_pbi_in_sprint)
                              • F runs contract tests against final tool list
                              • Full E2E smoke test (see below)
```

**Dependency within Step 2:**
- Subagents D and F can start immediately (no cross-dependency)
- Subagent E's `plan_pi_backlog` and `apply_pbi_sprint_plan` call `move_feature` and
  `place_pbi_in_sprint` — E must wait for D's tools to be testable (via respx mocks is fine)
- `summarize_project` is read-only — E can implement it independently of D

**Gate before release:**
- [ ] `pytest mcp_server/tests/test_contract.py` — all 35 tools listed and schemas valid
- [ ] `pytest mcp_server/tests/` — full suite green
- [ ] Claude can run `bulk_create_features` + `plan_pi_backlog` + `apply_pbi_sprint_plan`
  in sequence and the board reflects all changes
- [ ] Lock is acquired once and released once for compound tool batches
- [ ] `propose_pbi_sprint_plan` returns a plan with no DB writes (verified via activity log)

---

### Subagent prompt templates

When spawning subagents, use these as the briefing basis:

**Subagent A (Backend foundations)**
> Implement the backend foundations for MCP API key auth in `/home/david/work/pi-planner/backend/`.
> Add: `APIKey` and `ActivityLog` models, Alembic migration, `create_api_key` / `verify_api_key` /
> `revoke_api_key` in `auth.py`, `activity.py` service, `api_keys.py` routes (admin-only create/cycle/revoke,
> editor/admin list-own), `mcp_activity.py` middleware, `GET /health` endpoint, JWT verification
> in `deps.py`. Key format: `kid_xxx.secret` (PK lookup + argon2). JWT: HS256, exp=300s.
> Full spec in `/home/david/work/pi-planner/mcp-server.md` (Auth flow + Backend Components sections).

**Subagent B (MCP server scaffold + Groups 1–2)**
> Build the `mcp_server/` Python package in `/home/david/work/pi-planner/mcp_server/`.
> Framework: FastMCP v2. Files: `config.py`, `auth.py`, `backend.py` (shared httpx client,
> JWT minting, MCPBackendError), `lock.py` (edit_lock context manager), `server.py`
> (lifespan with httpx client + timeouts, api_key_middleware with rate limiting, health resource,
> mount all sub-servers), `tools/read.py` (11 read tools), `tools/projects.py` (6 project+PI tools),
> `tests/conftest.py`. Use `Annotated` + `Field` for all params. Rich docstrings.
> Full spec in `/home/david/work/pi-planner/mcp-server.md`.

**Subagent C (Frontend: API Keys tab)**
> Add an "API Keys" tab to `UserManagementModal.tsx` in
> `/home/david/work/pi-planner/frontend/src/components/`.
> Add: `Tabs.Root/List/Content` wiring, `ApiKeysTab`, `ApiKeyUserSection`, `ApiKeyCard`,
> `IssueKeyForm` (react-hook-form + Zod), `SecretRevealPanel` (one-time display, clipboard, clears on dismiss),
> Cycle flow (ConfirmDialog → reveal new secret), Revoke flow (ConfirmDialog → key removed).
> New service: `frontend/src/services/apiKeys.ts`. New types in `frontend/src/types/index.ts`.
> Admin-only tab. Follow existing patterns from `UserManagementModal.tsx` and `users.ts`.
> Full UI spec in `/home/david/work/pi-planner/mcp-server.md` (API Keys Tab section).

**Subagent D (Groups 3–4 tools)**
> Implement `mcp_server/tools/swimlines.py` and `mcp_server/tools/features.py` in
> `/home/david/work/pi-planner/mcp_server/tools/`.
> swimlines.py: `create_swimline`, `update_swimline`, `delete_swimline`, `reorder_swimlines`.
> features.py: `create_feature`, `update_feature`, `move_feature`, `create_pbi`, `update_pbi`,
> `place_pbi_in_sprint`, `remove_pbi_from_sprint`.
> All write tools use `async with edit_lock(project_id):`. `Annotated` + `Field` constraints
> on all params. Rich docstrings. Mount sub-servers in `server.py`.
> Full spec in `/home/david/work/pi-planner/mcp-server.md`.

**Subagent E (Groups 5–6 tools)**
> Implement `mcp_server/tools/groups.py` and `mcp_server/tools/workflows.py`.
> groups.py: `create_group`, `update_group`, `delete_group`.
> workflows.py: `bulk_create_features`, `bulk_create_pbis`, `plan_pi_backlog`,
> `set_sprint_capacities`, `propose_pbi_sprint_plan` (read-only, no lock),
> `apply_pbi_sprint_plan`, `summarize_project` (read-only).
> Compound tools acquire the edit lock once for the full batch.
> `propose_pbi_sprint_plan` must make no writes — verified by checking no lock is acquired.
> Full spec in `/home/david/work/pi-planner/mcp-server.md`.

**Subagent F (Tests)**
> Write the full test suite for `mcp_server/tests/` in `/home/david/work/pi-planner/mcp_server/tests/`.
> `test_contract.py`: use FastMCP v2 `Client` to assert all 35 tools are registered and schemas
> match `Annotated` constraints (maxLength, ge/le, etc.).
> `test_auth.py`, `test_lock.py`, `test_backend.py`: unit tests, no HTTP.
> `test_tools/test_read.py`, `test_tools/test_features.py`, `test_tools/test_swimlines.py`,
> `test_tools/test_groups.py`, `test_tools/test_workflows.py`: integration tests via `respx`.
> Key cases: lock released on backend error, 409 includes expires_at, rate limit at 21 attempts,
> propose_pbi_sprint_plan acquires no lock.
> Full test spec in `/home/david/work/pi-planner/mcp-server.md` (Local Testing section).

---

```
Claude  →  MCP Server (Python)  →  FastAPI Backend
            - Verifies API key           - Validates service token
            - Identifies user/role       - Enforces edit lock
            - Manages edit lock          - Runs business logic
            - Logs activity              - Broadcasts SSE events
```

### Auth flow

There are **two separate credentials** in play:

| Credential | Held by | Purpose |
|------------|---------|---------|
| **User API key** | Human user → given to Claude | Identifies which user Claude is acting as |
| **Service JWT** | Minted per-request by MCP server, verified with `MCP_SIGNING_SECRET` | Authenticates the MCP server to FastAPI; expires in 5 min |

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. User creates an API key (once, via UI or API)                │
│    POST /api/v1/api-keys/                                       │
│    ← { id: "key_abc", secret: "sk_..." }  ← shown ONCE         │
│    User stores secret securely, gives it to Claude              │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│ 2. Claude calls MCP server tool                                 │
│    Authorization: Bearer sk_...   (user's API key secret)       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│ 3. MCP server verifies the API key                              │
│    Token format: "kid_abc12345.secretpart"                      │
│    - Split on "." → key_id="kid_abc12345", secret="secretpart"  │
│    - Fetch APIKey row by key_id (PK lookup, O(1))               │
│    - Check: is_active=true, not expired                         │
│    - argon2.verify(row.key_hash, secret)  ← verify secret only  │
│    - Retrieve: username, role from row                          │
│    - Role check: reject 401 if role = "reader"                  │
│    - Update last_used_at on the key                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│ 4. MCP server mints a short-lived JWT and calls FastAPI         │
│    Authorization: Bearer <signed-jwt>      (expires in 5 min)   │
│    X-MCP-Actor: alice                      (key owner username) │
│    X-MCP-Key-Id: kid_abc12345              (for audit trail)    │
└───────────────────────────┬─────────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────────┐
│ 5. FastAPI backend processes the request                        │
│    - Auth middleware verifies JWT signature (MCP_SIGNING_SECRET)│
│    - Checks: iss="mcp-server", sub="service", not expired       │
│    - Trusts X-MCP-Actor as the acting user (sets request.state) │
│    - Enforces role from X-MCP-Actor's user record               │
│    - Activity middleware writes ActivityLog:                    │
│        actor_type = "mcp_bot"                                   │
│        actor_username = "alice"                                 │
│        api_key_id = "kid_abc12345"                              │
└─────────────────────────────────────────────────────────────────┘
```

#### Fix #1 — Short-lived JWT instead of static service token

The original design used a static `SERVICE_TOKEN` shared between the MCP server and FastAPI.
A leaked token would give permanent, unrestricted impersonation of any user.

**Mitigation: the MCP server mints a fresh JWT per request, signed with a shared
`MCP_SIGNING_SECRET`. See the full `backend.py` implementation in the MCP Server Structure
section below.** The FastAPI side verifies it as follows:

```python
# backend/app/middleware/deps.py  (FastAPI side)
import jwt

def verify_service_jwt(token: str) -> bool:
    try:
        claims = jwt.decode(token, settings.MCP_SIGNING_SECRET, algorithms=["HS256"])
        return claims.get("iss") == "mcp-server" and claims.get("sub") == "service"
    except jwt.PyJWTError:
        return False
```

Why this is better than a static token:
- A captured JWT is useless after 5 minutes (network sniff, log leak, etc.)
- `MCP_SIGNING_SECRET` is still sensitive but **its exposure window is bounded** — rotating
  it invalidates all outstanding JWTs within 5 minutes, with no deployment coordination needed
- `X-MCP-Actor` headers remain trusted **only when JWT verification passes** — a regular
  session token cannot pass this check, preventing spoofing

`MCP_SIGNING_SECRET` rotation procedure:
1. Generate new secret: `python -c "import secrets; print(secrets.token_urlsafe(32))"`
2. Set the new value in both MCP server and FastAPI env vars
3. Restart both services — old JWTs expire within 5 minutes naturally

#### Fix #2 — Correct API key lookup using key ID prefix

argon2 hashes are salted, so you cannot search a database by hash. The naive
"hash the incoming secret and find the row" would require a full table scan and would
still fail because the salt differs per row.

**Mitigation: encode the `key_id` into the secret string itself so the row can be
fetched by primary key, then verify only the secret portion with argon2.**

Key format: `{key_id}.{secret}` — e.g. `kid_abc12345.Xk9mR2vQpL8nW4jT`

```python
# backend/app/services/auth.py

import secrets
from argon2 import PasswordHasher

_ph = PasswordHasher(...)  # existing instance

def _generate_api_key(key_id: str) -> tuple[str, str]:
    """Return (full_token_for_user, secret_for_hashing)."""
    secret = secrets.token_urlsafe(24)       # 32-char URL-safe string
    full_token = f"{key_id}.{secret}"        # what the user stores
    return full_token, secret                # hash only the secret part

async def create_api_key(db, username, name, purpose, expires_in_days):
    key_id = f"kid_{secrets.token_urlsafe(8)}"   # e.g. "kid_Xk9mR2vQ"
    full_token, secret = _generate_api_key(key_id)
    key_hash = _ph.hash(secret)              # argon2 hash of secret only
    db.add(APIKey(id=key_id, username=username, key_hash=key_hash, ...))
    await db.commit()
    return key_id, full_token                # full_token shown ONCE to user

async def verify_api_key(db, full_token: str) -> tuple[str, str] | None:
    """Return (key_id, username) or None."""
    if "." not in full_token:
        return None
    key_id, secret = full_token.split(".", 1)   # O(1) split
    api_key = await db.get(APIKey, key_id)       # O(1) PK lookup — no table scan
    if not api_key or not api_key.is_active:
        return None
    if api_key.expires_at and api_key.expires_at < datetime.now(timezone.utc):
        return None
    try:
        _ph.verify(api_key.key_hash, secret)     # argon2 verify on the secret part only
    except Exception:
        return None
    api_key.last_used_at = datetime.now(timezone.utc)
    await db.commit()
    return api_key.id, api_key.username
```

Why this is correct:
- `key_id` is stored in plaintext as the primary key → single-row fetch, no scan
- argon2 is called with the correct `(stored_hash, incoming_secret)` pair
- Compromising the `key_id` alone reveals nothing — the secret portion is still hashed
- Key IDs are safe to log (e.g. in `X-MCP-Key-Id`) without exposing the secret

#### Security constraints

- `X-MCP-Actor` / `X-MCP-Key-Id` headers are **only trusted when the service JWT is valid**.
  Any request with those headers and a regular user session cookie is rejected with 400.
- `MCP_SIGNING_SECRET` is stored only in the MCP server's and FastAPI's environment. Never in git.
- The full API key token (`kid_xxx.secret`) is shown **exactly once** at creation and never
  stored — only the argon2 hash of the secret portion is persisted.

#### API key lifecycle

Only admins can create, cycle, and revoke keys. An admin creates a key for a specific user
(including themselves or an editor), then hands the secret to that user out-of-band.

```
Admin                                   Backend DB
  │                                          │
  │  POST /api/v1/api-keys/                  │
  │  { username: "alice", name: "Claude MCP",│
  │    expires_in_days: 90 }                 │
  │─────────────────────────────────────────►│  INSERT api_keys row
  │◄─────────────────────────────────────────│  { id: "key_abc", secret: "sk_..." } ← one-time
  │                                          │
  │  [Admin hands secret to alice]           │
  │  [Alice stores it in her MCP config]     │
  │                                          │
  │  POST /api/v1/api-keys/admin/cycle/{id}  │  ← rotate secret without losing history
  │─────────────────────────────────────────►│  SET is_active=false on old row
  │                                          │  INSERT new api_keys row (same username+name)
  │◄─────────────────────────────────────────│  { id: "key_xyz", secret: "sk_NEW..." } ← one-time
  │                                          │
  │  [Admin hands new secret to alice]       │
  │  [Old key immediately stops working]     │
  │                                          │
  │  DELETE /api/v1/api-keys/admin/keys/{id} │  ← revoke without replacement
  │─────────────────────────────────────────►│  SET is_active = false
```

- **Cycle** (`POST .../admin/cycle/{id}`) — atomically invalidates the old key and issues a new
  one with the same owner and name. Use this for routine rotation or if the secret leaks.
- **Revoke** (`DELETE .../admin/keys/{id}`) — permanently disables the key with no replacement.
  Use this when removing a user's Claude access entirely.
- Keys are soft-deleted (`is_active = false`) so the activity log retains its foreign key reference.
- Expired keys (past `expires_at`) are automatically treated as inactive — no explicit revoke needed.

#### Role enforcement

| User role | Can create/cycle/revoke API key | Can use MCP write tools | Can use MCP read tools |
|-----------|---------------------------------|-------------------------|------------------------|
| `admin`   | Yes (own + any user's)          | Yes                     | Yes                    |
| `editor`  | No (403)                        | Yes (if admin issued one) | Yes (if admin issued one) |
| `reader`  | No (403)                        | No (401 on MCP server)  | No (401 on MCP server) |

Readers are blocked at the MCP server level before any backend call is made.
Editors receive their key from an admin — they can use it but cannot create, cycle, or revoke keys.

### Edit lock flow

```python
# mcp_server/lock.py
@asynccontextmanager
async def edit_lock(project_id: str):
    """Acquire before write, release after (always, even on error)."""
    await backend.post(f"/projects/{project_id}/edit-lock/acquire")
    try:
        yield
    finally:
        await backend.post(f"/projects/{project_id}/edit-lock/release")
```

- All write tools: `async with edit_lock(project_id):`
- Compound tools hold the lock for the entire batch (single acquire/release)
- 409 on acquire → return error: "Project locked by {user}. Try again."
- Release failure → lock lapses after 30 min timeout (acceptable)

---

## MCP Tool Catalogue

### Group 1 — Read Tools (no lock required)

| Tool | Endpoint | Description |
|------|----------|-------------|
| `list_projects` | GET /api/v1/projects/ | List all projects |
| `get_project` | GET /api/v1/projects/{id} | Get one project |
| `list_pis` | GET /api/v1/projects/{id}/pis | List PIs for a project |
| `get_pi` | GET /api/v1/pis/{id} | Get one PI with effort/capacity |
| `list_sprints` | GET /api/v1/pis/{id}/sprints | List sprints with effort |
| `list_swimlines` | GET /api/v1/pis/{id}/swimlines | List swimlines with effort |
| `list_features` | GET /api/v1/projects/{id}/features | List features (backlog or PI) |
| `get_feature` | GET /api/v1/features/{id} | Get one feature |
| `list_pbis` | GET /api/v1/projects/{id}/pbis | List PBIs (optional filter: feature_id) |
| `list_groups` | GET /api/v1/swimlines/{id}/groups | List groups in a swimline |
| `get_edit_lock_status` | GET /api/v1/projects/{id}/edit-lock | Check current lock state |

### Group 2 — Project & PI Lifecycle (lock required)

| Tool | Endpoint | Description |
|------|----------|-------------|
| `create_project` | POST /api/v1/projects/ | Create a project |
| `update_project` | PATCH /api/v1/projects/{id} | Update name / description / effort_unit |
| `export_project` | GET /api/v1/projects/{id}/export | Export full project as JSON |
| `create_pi` | POST /api/v1/projects/{id}/pis | Create PI (auto-creates 5 sprints) |
| `update_pi` | PATCH /api/v1/pis/{id} | Update PI fields or transition state |
| `update_sprint` | PATCH /api/v1/sprints/{id} | Set capacity and/or dates |

### Group 3 — Swimline Management (lock required)

| Tool | Endpoint | Description |
|------|----------|-------------|
| `create_swimline` | POST /api/v1/pis/{id}/swimlines | Create a swimline |
| `update_swimline` | PATCH /api/v1/swimlines/{id} | Rename or reindex |
| `delete_swimline` | DELETE /api/v1/swimlines/{id} | Delete, return features to backlog |
| `reorder_swimlines` | POST /api/v1/swimlines/{id}/reorder | Bulk reorder all swimlines in a PI |

### Group 4 — Feature & PBI CRUD (lock required)

| Tool | Endpoint | Description |
|------|----------|-------------|
| `create_feature` | POST /api/v1/projects/{id}/features | Create feature in backlog |
| `update_feature` | PATCH /api/v1/features/{id} | Update title / description / user_id |
| `move_feature` | PATCH /api/v1/features/{id} | Move to PI+swimline or back to backlog |
| `create_pbi` | POST /api/v1/projects/{id}/pbis | Create PBI under a feature |
| `update_pbi` | PATCH /api/v1/pbis/{id} | Update PBI fields |
| `place_pbi_in_sprint` | POST /api/v1/pbis/{id}/place | Assign PBI to sprint (implicit group) |
| `remove_pbi_from_sprint` | DELETE /api/v1/pbis/{id}/place | Remove PBI from sprint |

### Group 5 — Group Management (lock required)

| Tool | Endpoint | Description |
|------|----------|-------------|
| `create_group` | POST /api/v1/swimlines/{id}/groups | Create explicit group |
| `update_group` | PATCH /api/v1/groups/{id} | Rename or move to sprint |
| `delete_group` | DELETE /api/v1/groups/{id} | Delete group (PBIs become ungrouped) |

### Group 6 — Compound Workflow Tools (lock held for full batch)

| Tool | Description |
|------|-------------|
| `bulk_create_features` | Create multiple features at once from a list |
| `bulk_create_pbis` | Create multiple PBIs under one feature |
| `plan_pi_backlog` | Move a set of features from backlog into a PI + swimline |
| `set_sprint_capacities` | Set capacity on all 5 sprints of a PI in one call |
| `propose_pbi_sprint_plan` | **Read-only** — read capacity + effort, return proposed PBI→sprint mapping |
| `apply_pbi_sprint_plan` | Execute a user-confirmed PBI→sprint mapping |
| `summarize_project` | Full picture: project + active PI + effort vs. capacity per sprint + backlog count |

> `propose_pbi_sprint_plan` + `apply_pbi_sprint_plan` are intentionally two-phase:
> Claude proposes, user confirms or adjusts, then Claude executes.

---

## New Backend Components

### Database Models
- `backend/app/models/api_key.py` — `APIKey` (id, username FK, key_hash, name, purpose, created_at, expires_at, last_used_at, is_active)
- `backend/app/models/activity_log.py` — `ActivityLog` (id, actor_type enum, actor_username, api_key_id, action, resource_type, resource_id, project_id, details JSON, timestamp, status)

### Service Extensions
- `backend/app/services/auth.py` — add `create_api_key`, `verify_api_key`, `revoke_api_key` (argon2, reuses existing hasher)
- `backend/app/services/activity.py` (new) — `log_activity`, `get_user_activities`, `get_mcp_activities_by_owner`

### Routes
- `backend/app/routes/api_keys.py` (new):
  - `GET /api/v1/api-keys/my-keys` — list own keys (editor/admin)
  - `GET /api/v1/api-keys/my-activities` — own human + Claude activities (editor/admin)
  - `POST /api/v1/api-keys/admin/keys` — create key for a user (admin only)
  - `POST /api/v1/api-keys/admin/cycle/{key_id}` — rotate secret, invalidate old key (admin only)
  - `DELETE /api/v1/api-keys/admin/keys/{key_id}` — revoke any key (admin only)
  - `GET /api/v1/api-keys/admin/all-keys` — list all keys in system (admin only)
  - `GET /api/v1/api-keys/admin/activities` — all activities across all users (admin only)

### Middleware
- `backend/app/middleware/mcp_activity.py` (new) — reads `X-MCP-Actor` / `X-MCP-Key-Id` on write requests, writes `ActivityLog`

### Health endpoint
- `GET /health` (new, unauthenticated) — returns `{"status": "healthy|degraded|unhealthy", "components": {"database": {...}, "disk": {...}}}`. Required by the MCP health check resource.

### Files to Modify
| File | Change |
|------|--------|
| `backend/app/models/__init__.py` | Import `APIKey`, `ActivityLog` |
| `backend/app/services/auth.py` | Add API key functions |
| `backend/app/main.py` | Include `api_keys` router, register `mcp_activity` middleware |
| `backend/app/middleware/deps.py` | Extend `get_current_user` to accept service token + trust `X-MCP-Actor` |

### Migration
`backend/migrations/versions/xxxx_add_api_keys_and_activity_log.py`

---

## MCP Server Structure

### Framework: FastMCP v2

```
mcp_server/
├── server.py          # FastMCP app, lifespan, middleware wiring, health check, mount all groups
├── auth.py            # verify_api_key (key_id PK lookup + argon2)
├── backend.py         # httpx wrapper: mints JWT, calls FastAPI, MCPBackendError classification
├── lock.py            # edit_lock async context manager
├── config.py          # pydantic-settings: MCP_SIGNING_SECRET, BACKEND_URL, etc.
├── tools/
│   ├── read.py        # Group 1: read tools      (FastMCP sub-server)
│   ├── projects.py    # Group 2: project + PI    (FastMCP sub-server)
│   ├── swimlines.py   # Group 3: swimlines       (FastMCP sub-server)
│   ├── features.py    # Group 4: features + PBIs (FastMCP sub-server)
│   ├── groups.py      # Group 5: groups          (FastMCP sub-server)
│   └── workflows.py   # Group 6: compound tools  (FastMCP sub-server)
├── tests/
│   ├── test_auth.py        # verify_api_key: valid key, expired, revoked, wrong secret, malformed
│   ├── test_lock.py        # edit_lock: acquire success, 409 conflict, release on error
│   ├── test_backend.py     # call_backend: error classification (409, 403, 422, 5xx, unreachable)
│   ├── test_contract.py    # MCP protocol compliance: tool list, parameter schemas, response shapes
│   └── test_tools/
│       ├── test_read.py         # read tools against a mock backend
│       └── test_features.py     # create/update/move feature round-trips
├── pyproject.toml
└── .env.example       # MCP_SIGNING_SECRET, BACKEND_URL
```

### Key FastMCP v2 patterns

**App assembly and mounting**

Each tool group is an independent `FastMCP` instance, mounted onto the root server. This
keeps files focused and lets groups be tested in isolation.

```python
# mcp_server/server.py
from fastmcp import FastMCP
from starlette.middleware.base import BaseHTTPMiddleware
from mcp_server.tools.read import read_mcp
from mcp_server.tools.projects import projects_mcp
from mcp_server.tools.swimlines import swimlines_mcp
from mcp_server.tools.features import features_mcp
from mcp_server.tools.groups import groups_mcp
from mcp_server.tools.workflows import workflows_mcp

mcp = FastMCP("pi-planner", lifespan=lifespan)
mcp.mount("read",      read_mcp)
mcp.mount("projects",  projects_mcp)
mcp.mount("swimlines", swimlines_mcp)
mcp.mount("features",  features_mcp)
mcp.mount("groups",    groups_mcp)
mcp.mount("workflows", workflows_mcp)

# Add API key auth middleware to the ASGI app
app = mcp.get_asgi_app()
app.add_middleware(BaseHTTPMiddleware, dispatch=api_key_middleware)

if __name__ == "__main__":
    mcp.run(transport="sse")   # or "stdio" for local Claude Desktop use
```

**Shared resources via lifespan**

The httpx client is created once at startup and shared across all tool calls via `lifespan`.
Timeouts are set here so every backend call fails fast instead of hanging indefinitely.

```python
# mcp_server/server.py
from contextlib import asynccontextmanager
import httpx

@asynccontextmanager
async def lifespan(server):
    async with httpx.AsyncClient(
        base_url=settings.BACKEND_URL,
        timeout=httpx.Timeout(10.0, connect=3.0),  # 3s connect, 10s read
    ) as client:
        yield {"http_client": client}
```

**API key auth middleware**

Runs before every tool call. Verifies the incoming API key, attaches `(username, key_id)`
to request state so tools can read it via `Context`. A sliding-window rate limiter on source
IP prevents brute-force key enumeration — 20 failed attempts per minute results in a 429.

```python
# mcp_server/server.py
import time
from collections import defaultdict
from mcp_server.auth import verify_api_key

# Sliding-window rate limiter: max 20 failed attempts per IP per 60 seconds
_failed_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_WINDOW = 60
_RATE_LIMIT = 20

def _is_rate_limited(ip: str) -> bool:
    now = time.monotonic()
    attempts = [t for t in _failed_attempts[ip] if now - t < _RATE_WINDOW]
    _failed_attempts[ip] = attempts
    return len(attempts) >= _RATE_LIMIT

def _record_failure(ip: str) -> None:
    _failed_attempts[ip].append(time.monotonic())

async def api_key_middleware(request, call_next):
    ip = request.client.host
    if _is_rate_limited(ip):
        return Response("Too Many Requests", status_code=429)

    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    result = await verify_api_key(token)          # PK lookup + argon2
    if result is None:
        _record_failure(ip)
        return Response("Unauthorized", status_code=401)
    key_id, username, role = result
    if role == "reader":
        return Response("Forbidden", status_code=401)
    request.state.mcp_username = username
    request.state.mcp_key_id   = key_id
    return await call_next(request)
```

**`backend.py` — shared client, JWT minting, structured errors**

`call_backend` pulls the shared httpx client from the lifespan context (no per-call
client creation). All backend error cases are classified into typed exceptions so tools
return actionable messages to Claude rather than raw tracebacks.

```python
# mcp_server/backend.py
import jwt, time, logging
from fastmcp import Context
from mcp_server.config import settings

log = logging.getLogger(__name__)

class MCPBackendError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message
        super().__init__(message)

def _mint_service_jwt() -> str:
    now = int(time.time())
    return jwt.encode(
        {"iss": "mcp-server", "sub": "service", "iat": now, "exp": now + 300},
        settings.MCP_SIGNING_SECRET, algorithm="HS256",
    )

async def call_backend(ctx: Context, method: str, path: str, **kwargs) -> dict:
    """Call FastAPI backend using the shared httpx client from lifespan."""
    client = ctx.request_context.lifespan_context["http_client"]  # ← shared, no new client
    headers = kwargs.pop("headers", {})
    headers["Authorization"] = f"Bearer {_mint_service_jwt()}"
    headers["X-MCP-Actor"]   = ctx.request_context.request.state.mcp_username
    headers["X-MCP-Key-Id"]  = ctx.request_context.request.state.mcp_key_id

    start = time.monotonic()
    try:
        r = await client.request(method, path, headers=headers, **kwargs)
    except Exception as exc:
        log.error("backend_unreachable path=%s error=%s", path, exc)
        raise MCPBackendError(503, "BACKEND_UNREACHABLE", "Backend is unreachable. Try again shortly.")

    elapsed_ms = int((time.monotonic() - start) * 1000)
    log.info("backend_call method=%s path=%s status=%d elapsed_ms=%d", method, path, r.status_code, elapsed_ms)

    if r.status_code == 409:
        detail = r.json().get("detail", {}) if isinstance(r.json().get("detail"), dict) else {}
        locked_by  = detail.get("locked_by", "another user")
        expires_at = detail.get("expires_at", "")
        retry_hint = f" Lock expires at {expires_at}." if expires_at else " Try again in a few minutes."
        raise MCPBackendError(409, "LOCKED", f"Project is being edited by {locked_by}.{retry_hint}")
    if r.status_code == 403:
        raise MCPBackendError(403, "FORBIDDEN", "Your role does not permit this action.")
    if r.status_code == 422:
        raise MCPBackendError(422, "VALIDATION_ERROR", f"Invalid input: {r.json().get('detail')}")
    if r.status_code >= 500:
        raise MCPBackendError(r.status_code, "BACKEND_ERROR", "Backend error. Try again later.")

    r.raise_for_status()
    return r.json() if r.content else {}
```

**Tool definition with Context injection and input validation**

`Context` is injected by FastMCP v2 when declared as a parameter. `Annotated` + `Field`
constraints are applied to every parameter so FastMCP generates a tight JSON schema for
Claude and invalid values are rejected before hitting the backend. Docstrings explain
*when* to call each tool and what to do with the result — not just what it does.

```python
# mcp_server/tools/features.py
from typing import Annotated
from fastmcp import FastMCP, Context
from pydantic import Field
from mcp_server.lock import edit_lock
from mcp_server.backend import call_backend

features_mcp = FastMCP("features")

@features_mcp.tool()
async def create_feature(
    project_id: str,
    title: Annotated[str, Field(max_length=255, description="Feature title, max 255 chars")],
    description: Annotated[str | None, Field(default=None, description="Optional plain-text description")],
    user_id: Annotated[int | None, Field(default=None, ge=1, le=999999,
        description="Optional business ID shown in UI as [101]. Must be unique per project.")] = None,
    ctx: Context = None,
) -> dict:
    """
    Create a new feature in the project backlog.

    Call this before create_pbi — features are the parent container for PBIs.
    The feature starts in the backlog (location='backlog').
    Use move_feature afterwards to assign it to a PI and swimline.
    Returns a FeatureResponse including system_id needed for subsequent calls.
    """
    async with edit_lock(project_id):
        return await call_backend(
            ctx, "POST", f"/projects/{project_id}/features",
            json={"title": title, "description": description, "id": user_id},
        )
```

**Health check resource**

Exposed as an MCP resource so Claude (or an operator) can verify connectivity before
running compound workflows. Forwards the backend's own component-level health rather than
just checking reachability, and maps to three tiers: `healthy`, `degraded`, `unhealthy`.

```python
# mcp_server/server.py
import json

@mcp.resource("health://status")
async def health_check(ctx: Context) -> str:
    """
    Check MCP server and backend health.
    Returns overall status: healthy | degraded | unhealthy.
    """
    client = ctx.request_context.lifespan_context["http_client"]
    try:
        r = await client.get("/health", timeout=3.0)
        if r.status_code == 200:
            backend_data = r.json()          # backend returns its own component statuses
            backend_status = backend_data.get("status", "healthy")
        elif r.status_code == 503:
            backend_data = r.json()
            backend_status = backend_data.get("status", "degraded")
        else:
            backend_data = {}
            backend_status = "unhealthy"
    except Exception as exc:
        backend_data = {"error": str(exc)}
        backend_status = "unhealthy"

    overall = "healthy" if backend_status == "healthy" else backend_status
    return json.dumps({
        "status": overall,                   # healthy | degraded | unhealthy
        "mcp": "healthy",
        "backend": backend_status,
        "components": backend_data.get("components", {}),
    })
```

The backend's `/health` endpoint (FastAPI) is expected to return:
```json
{
  "status": "healthy",
  "components": {
    "database": {"status": "healthy", "response_ms": 2},
    "disk": {"status": "healthy", "free_gb": 14.2}
  }
}
```

**Dependencies (`pyproject.toml`)**

```toml
[project]
name = "pi-planner-mcp"
requires-python = ">=3.11"
dependencies = [
    "fastmcp>=2.0",
    "httpx>=0.27",
    "pyjwt>=2.8",
    "argon2-cffi>=23.1",
    "pydantic-settings>=2.0",
    "pydantic>=2.0",
]
```

---

## Verification Checklist

**API key management**
- [ ] POST `/api/v1/api-keys/admin/keys` as admin → key secret returned once, key in list
- [ ] POST `/api/v1/api-keys/admin/keys` as editor → 403
- [ ] POST `/api/v1/api-keys/admin/keys` as reader → 403
- [ ] POST `/api/v1/api-keys/admin/cycle/{id}` → old key inactive, new secret returned once
- [ ] GET `/api/v1/api-keys/admin/all-keys` as admin → all users' keys visible

**Edit lock**
- [ ] MCP write tool → GET `/edit-lock` shows locked during operation, released after
- [ ] Two concurrent MCP writes → second returns 409 with message naming the lock holder
- [ ] Backend error during write → lock is still released (`finally` block)

**Activity log**
- [ ] MCP tool run → activity log shows `actor_type=mcp_bot`, `actor_username=<key owner>`
- [ ] `bulk_create_features` with 5 items → single lock acquire/release in log

**Compound workflows**
- [ ] `propose_pbi_sprint_plan` → returns plan, no DB writes, no lock acquired
- [ ] `apply_pbi_sprint_plan` with confirmed plan → PBIs assigned to sprints

**Error handling**
- [ ] Invalid `user_id` (e.g. 0 or > 999999) → rejected at MCP layer before backend call
- [ ] Backend returns 5xx → Claude receives `BACKEND_ERROR` message, not a traceback
- [ ] Backend unreachable (connect timeout) → Claude receives `BACKEND_UNREACHABLE` within 3s

**Health & observability**
- [ ] `health://status` → `{"status": "healthy", ...}` when both MCP and backend up
- [ ] `health://status` → `{"status": "unhealthy", "backend": "unhealthy"}` when FastAPI down
- [ ] `health://status` → `{"status": "degraded"}` when backend is up but a component (e.g. disk) is degraded
- [ ] Structured log lines appear on each `call_backend` with `method`, `path`, `status`, `elapsed_ms`

**Rate limiting**
- [ ] 21 consecutive failed auth attempts from same IP → 429 on attempt 21
- [ ] Successful auth resets failure count for that IP

**Retry guidance**
- [ ] 409 LOCKED error message includes `expires_at` from the lock

**Contract tests**
- [ ] `pytest mcp_server/tests/test_contract.py` → all 35 tools present in tool list
- [ ] Each tool's parameter schema matches declared `Annotated` constraints

**Unit tests**
- [ ] `pytest mcp_server/tests/` → all passing
- [ ] `pytest backend/tests/` → all passing (no regressions)

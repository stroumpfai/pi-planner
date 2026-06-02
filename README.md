# PI Planning

A single-tenant, browser-based PI Planning tool for Product Owners and Product Managers. Supports Features, PBIs, swimlanes, sprints, and a single-writer edit lock so the whole team can view live while one person plans.

---

## Quick Start (local development)

**Backend** (Python 3.11+):
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # edit as needed
alembic upgrade head
uvicorn app.main:app --reload
# API + Swagger docs → http://localhost:8000/docs
```

**Frontend** (Node 18+):
```bash
cd frontend
npm install
npm run dev
# App → http://localhost:5173
```

---

## Docker (single container, recommended for deployment)

The repo ships with a multi-stage `Dockerfile` that builds the React frontend and embeds it into the FastAPI backend image. A single container serves both the app and the API on port 8000.

### Build

```bash
docker build -t pi-planner:latest .
```

### Run

```bash
docker run -d \
  --name pi-planner \
  -p 8000:8000 \
  -v $(pwd)/data:/data \
  -v $(pwd)/config:/config:ro \
  -e SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')" \
  pi-planner:latest
# App → http://localhost:8000
```

| Mount | Purpose |
|-------|---------|
| `/data` | Persistent SQLite database (`db.sqlite`) |
| `/config` | Read-only config directory; must contain `users.json` |

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | `change-me-in-production` | **Required in prod.** Session signing key — generate with `python -c "import secrets; print(secrets.token_hex(32))"` |
| `DATABASE_URL` | `sqlite+aiosqlite:////data/db.sqlite` | SQLite path inside the container |
| `ALLOWED_ORIGINS` | `http://localhost:8000` | CORS allowed origins (comma-separated) |
| `USERS_FILE` | `/config/users.json` | Path to the users bootstrap file |
| `MCP_SIGNING_SECRET` | `change-me-in-production` | Shared secret between the app and the MCP server |
| `LOG_LEVEL` | `WARNING` | Log level for the application (`DEBUG`, `INFO`, `WARNING`, `ERROR`). Also controls uvicorn startup logs. Do not use `DEBUG` in production — request data may appear in logs. |

The container runs `alembic upgrade head` on every startup before launching uvicorn, so schema migrations apply automatically on upgrade.

---

## Docker Compose (app + MCP server)

For a full stack including the MCP server:

**Step 1 — Create the users seed file**

`config/users.json` is read **once**, on first boot, when the database contains no users. After that it is never consulted again. It must contain argon2id password hashes — plain-text passwords are rejected at startup.

The easiest way to create the file is with the provided script, which prompts interactively, validates the password, and writes the correct hash:

```bash
mkdir -p config data
cd backend && python -m venv venv && source venv/bin/activate && pip install -e ".[dev]" && cd ..
python scripts/create_admin.py
```

The script auto-detects the backend venv, so after the first run you can add further users with just:
```bash
python scripts/create_admin.py
```

Alternatively, copy the example file (default admin password is `changeme`) and edit it by hand — the `password_hash` field must be a valid argon2id hash:
```bash
cp config/users.json.example config/users.json
```

Valid roles: `admin`, `editor`, `reader`. Once the database has been seeded you can add and manage users from the admin UI — the file is no longer needed.

**Step 2 — Set secrets and start**

```bash
export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_hex(32))')"
export MCP_SIGNING_SECRET="$(python -c 'import secrets; print(secrets.token_hex(32))')"

docker compose up -d

# App   → http://localhost:8000
# MCP   → http://localhost:8010
```

### MCP server environment variables

Configure the MCP server by editing `mcp_server/.env` (copy from `mcp_server/.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_SIGNING_SECRET` | — | **Required.** Must match the app's `MCP_SIGNING_SECRET` |
| `BACKEND_URL` | `http://localhost:8000` | URL of the main app (overridden to `http://app:8000` in Docker Compose) |
| `PORT` | `8010` | Port the MCP server listens on |
| `LOG_LEVEL` | `WARNING` | Log level for MCP server code (`DEBUG`, `INFO`, `WARNING`, `ERROR`). Set to `INFO` to see the startup version line and OAuth flow logs. |
| `FASTMCP_LOG_LEVEL` | `INFO` | Log level for FastMCP/uvicorn framework logs. Set to `warning` to suppress `INFO: Started server...` noise. |
| `OAUTH_BASE_URL` | *(empty)* | Public URL of the MCP server — enables OAuth 2.1 for Claude.ai / ChatGPT. Leave empty for Claude Code (direct API key auth). |

To rebuild after a code change:
```bash
docker compose up -d --build
```

To stop:
```bash
docker compose down
```

Data is persisted in `./data/db.sqlite` on the host.

---

## Project Structure

```
pi-planner/
├── backend/           Python / FastAPI / SQLite
├── frontend/          React 18 / Vite / TypeScript / Tailwind
├── mcp_server/        MCP server (Claude integration)
├── spec/              Product spec and architecture docs
├── Dockerfile         Multi-stage build (frontend + backend)
├── docker-compose.yml App + MCP server
└── .dockerignore
```

See [`spec/specification.md`](spec/specification.md) for the full product specification and [`spec/design.md`](spec/design.md) for the software architecture.

---

## Running Tests

**Backend:**
```bash
cd backend
pytest tests/ -v
pytest --cov=app tests/   # with coverage
```

**Frontend:**
```bash
cd frontend
npm run test              # Vitest (once)
npm run test:watch        # watch mode
npm run cypress:open      # interactive E2E
npm run cypress:run       # headless E2E (CI)
```

---

## Roadmap

MCP server integration is live. Below are planned improvements:

- [x] MCP server - Part I
- [x] MCP server - Part II
- [ ] New front-end
- [ ] Major upgrades of frontend libraries
- [ ] Encrypt the SQLite database
- [ ] User activity log (human and Claude)
- [ ] Project / DB snapshots
- [ ] Optimise password help (conflict blacklist and strength scoring)
- [ ] Make sprint columns resizable
- [ ] Make feature / swimlane column resizable

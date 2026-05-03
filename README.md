# PI Planning

A single-tenant, browser-based PI Planning tool for Product Owners and Product Managers.

## Quick Start

**Backend** (Python 3.11+):
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env   # edit as needed
alembic upgrade head
uvicorn app.main:app --reload
# → http://localhost:8000/docs
```

**Frontend** (Node 18+):
```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

## Project Structure

```
pi-planner/
├── backend/    Python / FastAPI / SQLite
├── frontend/   React 18 / Vite / TypeScript / Tailwind
└── spec/       Specifications (read these first)
```

See `spec/p2-pi-planning-detailed-IMPROVED.md` for the full feature spec.

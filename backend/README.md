# PI Planning — Backend

Python 3.11+ / FastAPI / SQLAlchemy 2.0 / SQLite / Alembic.

## Setup

```bash
python -m venv venv && source venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

API docs: http://localhost:8000/docs

## Commands

| Command | Description |
|---------|-------------|
| `uvicorn app.main:app --reload` | Start dev server |
| `pytest tests/` | Run all tests |
| `pytest --cov=app tests/` | With coverage |
| `alembic upgrade head` | Apply migrations |
| `alembic revision --autogenerate -m "..."` | New migration |

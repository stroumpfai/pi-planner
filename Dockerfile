# ── Stage 1: Build React/Vite frontend ────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci --quiet
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production image ──────────────────────────────────────────────────
FROM python:3.12-slim

ARG APP_VERSION=1.4.5
LABEL version="${APP_VERSION}"
ENV APP_VERSION=${APP_VERSION}

WORKDIR /app

# Install Python dependencies (separate layer for cache efficiency)
RUN pip install --no-cache-dir \
    "fastapi>=0.104.0" \
    "uvicorn[standard]>=0.23.0" \
    "sqlalchemy>=2.0.0" \
    "alembic>=1.12.0" \
    "aiosqlite>=0.19.0" \
    "pydantic>=2.0.0" \
    "pydantic-settings>=2.0.0" \
    "python-multipart>=0.0.6" \
    "argon2-cffi>=23.1" \
    "itsdangerous>=2.1.0" \
    "pyjwt>=2.8" \
    "python-dotenv>=1.0.0"

# Copy backend source and migrations
COPY backend/app/ ./app/
COPY backend/migrations/ ./migrations/
COPY backend/alembic.ini ./

# Copy built frontend into the location expected by main.py
COPY --from=frontend /build/dist/ ./static/

# Persistent data volume for the SQLite database
VOLUME /data

# Runtime configuration — override these when running the container
ENV DATABASE_URL=sqlite+aiosqlite:////data/db.sqlite \
    SECRET_KEY=change-me-in-production \
    ALLOWED_ORIGINS=http://localhost:8000 \
    USERS_FILE=/config/users.json \
    PYTHONUNBUFFERED=1

EXPOSE 8000

COPY backend/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]

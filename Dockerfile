# ── Stage 1: Build React/Vite frontend ────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci --quiet
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production image ──────────────────────────────────────────────────
FROM python:3.12-slim

ARG APP_VERSION=1.6.0
LABEL version="${APP_VERSION}"
ENV APP_VERSION=${APP_VERSION}

WORKDIR /app

# Install Python dependencies (separate layer for cache efficiency)
RUN pip install --no-cache-dir \
    "fastapi>=0.138.1" \
    "uvicorn[standard]>=0.49.0" \
    "sqlalchemy>=2.0.51" \
    "alembic>=1.18.5" \
    "aiosqlite>=0.22.1" \
    "pydantic>=2.13.4" \
    "pydantic-settings>=2.14.2" \
    "python-multipart>=0.0.32" \
    "argon2-cffi>=25.1.0" \
    "itsdangerous>=2.2.0" \
    "pyjwt>=2.13.0" \
    "python-dotenv>=1.2.2"

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

#!/bin/sh
set -e

echo "PI Planner v${APP_VERSION} starting..."

case "${SECRET_KEY:-}" in
  ""|"change-me"|"change-me-in-production"|"change-me-to-a-random-secret-key")
    echo "ERROR: SECRET_KEY is not set. Set a strong random value via -e SECRET_KEY=... (e.g. openssl rand -hex 32)" >&2
    exit 1
    ;;
esac

echo "Running database migrations..."
alembic upgrade head

echo "Starting PI Planning on :8000"
LOG_LEVEL_LOWER=$(echo "${LOG_LEVEL:-warning}" | tr '[:upper:]' '[:lower:]')
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level "$LOG_LEVEL_LOWER"

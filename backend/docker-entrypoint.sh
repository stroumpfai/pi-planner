#!/bin/sh
set -e

echo "PI Planner v${APP_VERSION} starting..."

# Same rule as app.config.secret_problem — checked here too so a bad key fails
# before migrations touch the database.
case "${SECRET_KEY:-}" in
  ""|*change-me*|*CHANGE-ME*)
    echo "ERROR: SECRET_KEY is not set or is still the example placeholder. Set a strong random value via -e SECRET_KEY=... (e.g. openssl rand -hex 32)" >&2
    exit 1
    ;;
esac
if [ "${#SECRET_KEY}" -lt 32 ]; then
  echo "ERROR: SECRET_KEY is shorter than 32 characters. Use e.g. openssl rand -hex 32" >&2
  exit 1
fi

echo "Running database migrations..."
alembic upgrade head

echo "Starting PI Planning on :8000"
LOG_LEVEL_LOWER=$(echo "${LOG_LEVEL:-warning}" | tr '[:upper:]' '[:lower:]')
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --log-level "$LOG_LEVEL_LOWER"

#!/usr/bin/env bash
#
# Run the Cypress E2E suite against a throwaway backend.
#
# The suite calls POST /api/v1/test/reset, which deletes every project, feature,
# PBI and PI in the database. It must therefore NEVER run against a developer's
# real backend. This script starts its own backend on its own port with its own
# SQLite file, runs the suite, and tears everything down again.
#
#   scripts/e2e.sh                       # headless, whole suite
#   scripts/e2e.sh --spec .../auth.cy.ts # headless, one spec
#   scripts/e2e.sh --open                # interactive Cypress runner
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_PORT="${E2E_BACKEND_PORT:-8901}"
FRONTEND_PORT="${E2E_FRONTEND_PORT:-5901}"
WORKDIR="$(mktemp -d -t pi-planner-e2e-XXXXXX)"

MODE="run"
if [[ "${1:-}" == "--open" ]]; then MODE="open"; shift; fi

# Both servers spawn children (uvicorn reloader, npx -> node), so killing the shell
# job is not enough. These two ports belong to this script, so clear them by port.
free_port() {
  local port="$1" pids
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
  fi
}

cleanup() {
  local code=$?
  free_port "$BACKEND_PORT"
  free_port "$FRONTEND_PORT"
  wait 2>/dev/null || true
  if [[ $code -ne 0 && -f "$WORKDIR/backend.log" ]]; then
    echo "==> backend log (last 30 lines)"; tail -30 "$WORKDIR/backend.log"
  fi
  rm -rf "$WORKDIR"
  exit $code
}
trap cleanup EXIT INT TERM

# A previous run that was killed hard can leave a server bound. Reclaim the ports
# up front, otherwise the new backend dies on bind and the health check silently
# passes against the stale one (which is pointed at a deleted database).
for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "==> port $port still in use from a previous run, reclaiming it"
    free_port "$port"
  fi
done

PY="$ROOT/backend/venv/bin/python"
if [[ ! -x "$PY" ]]; then
  echo "error: backend venv not found at $PY" >&2
  echo "       cd backend && python -m venv venv && source venv/bin/activate && pip install -e '.[dev]'" >&2
  exit 1
fi

# Two accounts: the suite's main user, plus a second one for the "lock held by
# another user" test. Both are seeded from a hash, so the password policy that
# applies to interactive password changes does not reject "testpass".
"$PY" - "$WORKDIR/users.json" <<'SEED'
import json, sys
from argon2 import PasswordHasher
ph = PasswordHasher(memory_cost=19456, time_cost=2, parallelism=1)
json.dump(
    [
        {"username": "testuser", "display_name": "Test User",
         "password_hash": ph.hash("testpass"), "role": "admin"},
        {"username": "testuser2", "display_name": "Second Test User",
         "password_hash": ph.hash("testpass"), "role": "editor"},
    ],
    open(sys.argv[1], "w"),
    indent=2,
)
SEED

export DATABASE_URL="sqlite+aiosqlite:///$WORKDIR/e2e.sqlite"
export SECRET_KEY="e2e-only-secret-key-never-used-in-production"
export USERS_FILE="$WORKDIR/users.json"
export ALLOW_TEST_RESET=true
export ALLOWED_ORIGINS="http://localhost:$FRONTEND_PORT"

echo "==> migrating throwaway database"
(cd "$ROOT/backend" && "$ROOT/backend/venv/bin/alembic" upgrade head >"$WORKDIR/alembic.log" 2>&1) \
  || { cat "$WORKDIR/alembic.log"; exit 1; }

echo "==> starting backend on :$BACKEND_PORT"
(cd "$ROOT/backend" && exec "$ROOT/backend/venv/bin/uvicorn" app.main:app \
  --host 127.0.0.1 --port "$BACKEND_PORT" >"$WORKDIR/backend.log" 2>&1) &

echo "==> starting frontend on :$FRONTEND_PORT"
(cd "$ROOT/frontend" && VITE_PORT="$FRONTEND_PORT" \
  VITE_API_TARGET="http://localhost:$BACKEND_PORT" \
  exec npx vite >"$WORKDIR/vite.log" 2>&1) &

echo "==> waiting for both servers"
for _ in $(seq 1 60); do
  back=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$BACKEND_PORT/health" || true)
  front=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$FRONTEND_PORT" || true)
  [[ "$back" == "200" && "$front" == "200" ]] && break
  sleep 1
done
if [[ "$back" != "200" || "$front" != "200" ]]; then
  echo "error: servers did not come up (backend=$back frontend=$front)" >&2
  tail -20 "$WORKDIR/backend.log" "$WORKDIR/vite.log" >&2
  exit 1
fi

# ELECTRON_RUN_AS_NODE makes Cypress's Electron binary run as plain Node, which
# fails with a misleading "bad option: --no-sandbox".
cd "$ROOT/frontend"
echo "==> running cypress ($MODE)"
env -u ELECTRON_RUN_AS_NODE \
  CYPRESS_baseUrl="http://localhost:$FRONTEND_PORT" \
  npx cypress "$MODE" "$@"

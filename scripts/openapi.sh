#!/usr/bin/env bash
#
# Regenerate the API contract the frontend builds against.
#
# frontend/openapi.json is a checked-in copy of the FastAPI app's spec, and
# frontend/src/types/api.generated.ts is generated from that copy. Neither is
# produced by the build, so adding a route or a query parameter leaves both stale
# until someone runs this. Run it after any change to a route signature or schema.
#
#   scripts/openapi.sh          # rewrite both files
#   scripts/openapi.sh --check  # fail if either is out of date (no writes)
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SPEC="$ROOT/frontend/openapi.json"
PYTHON="$ROOT/backend/venv/bin/python"

CHECK=0
if [[ "${1:-}" == "--check" ]]; then CHECK=1; fi

[[ -x "$PYTHON" ]] || { echo "no backend venv at $PYTHON — see CLAUDE.md Backend Setup" >&2; exit 1; }

# app.openapi() needs the settings to import; the value is irrelevant to the spec,
# but the app refuses to start on the default key.
dump_spec() {
  ( cd "$ROOT/backend" && SECRET_KEY="${SECRET_KEY:-openapi-generation-placeholder}" \
      "$PYTHON" -c 'import json; from app.main import app; print(json.dumps(app.openapi(), indent=2), end="")' )
}

if [[ $CHECK -eq 1 ]]; then
  tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
  dump_spec > "$tmp"
  if ! diff -q "$SPEC" "$tmp" >/dev/null; then
    echo "frontend/openapi.json is out of date — run scripts/openapi.sh" >&2
    diff "$SPEC" "$tmp" | head -40 >&2
    exit 1
  fi
  echo "openapi.json is up to date"
  exit 0
fi

dump_spec > "$SPEC"
echo "==> wrote frontend/openapi.json"

( cd "$ROOT/frontend" && npm run --silent generate:types )
echo "==> wrote frontend/src/types/api.generated.ts"

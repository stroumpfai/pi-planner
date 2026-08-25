#!/usr/bin/env bash
#
# The single definition of "clean" for this repo.
#
#   scripts/check.sh            # everything except the browser suite (~95s)
#   scripts/check.sh --with-e2e # add Cypress (~3 min total)
#   scripts/check.sh --quick    # static checks only, no test suites (~20s)
#
# Checks run cheapest-first and the script stops at the first failure, so a
# formatting slip costs you a second rather than a full test run. CI
# (.github/workflows/ci.yml) and the pre-push hook (scripts/hooks/pre-push)
# both call this file, so there is one place to change what "clean" means.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WITH_E2E=0
QUICK=0
for arg in "$@"; do
  case "$arg" in
    --with-e2e) WITH_E2E=1 ;;
    --quick)    QUICK=1 ;;
    -h|--help)  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

BACKEND_PY="$ROOT/backend/venv/bin/python"
MCP_PY="$ROOT/mcp_server/.venv/bin/python"

# CI installs into the ambient environment rather than the local venvs.
[[ -x "$BACKEND_PY" ]] || BACKEND_PY="$(command -v python3 || true)"
[[ -x "$MCP_PY" ]]     || MCP_PY="$(command -v python3 || true)"

GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; OFF=$'\033[0m'
[[ -t 1 ]] || { GREEN=""; RED=""; DIM=""; OFF=""; }

step() {
  local name="$1"; shift
  printf '%s==>%s %s ' "$DIM" "$OFF" "$name"
  local start out rc
  start=$(date +%s)
  out="$("$@" 2>&1)"; rc=$?
  local elapsed=$(( $(date +%s) - start ))
  if [[ $rc -eq 0 ]]; then
    printf '%sok%s %s(%ss)%s\n' "$GREEN" "$OFF" "$DIM" "$elapsed" "$OFF"
    return 0
  fi
  printf '%sFAILED%s %s(%ss)%s\n\n' "$RED" "$OFF" "$DIM" "$elapsed" "$OFF"
  printf '%s\n\n' "$out"
  # $name is padded for column alignment; the summary line wants it bare.
  printf '%sfailed at: %s%s\n' "$RED" "${name%"${name##*[![:space:]]}"}" "$OFF"
  exit 1
}

# ── static checks (seconds) ──────────────────────────────────────────────────
step "ruff              " "$BACKEND_PY" -m ruff check backend/app
step "mypy (strict)     " bash -c 'cd backend && "$0" -m mypy app' "$BACKEND_PY"
step "openapi contract  " scripts/openapi.sh --check
step "eslint            " bash -c 'cd frontend && npm run --silent lint'
step "tsc (src + specs) " bash -c 'cd frontend && npm run --silent typecheck'

if [[ $QUICK -eq 1 ]]; then
  echo ""
  echo "${GREEN}static checks clean${OFF} ${DIM}(test suites skipped — --quick)${OFF}"
  exit 0
fi

# ── test suites ──────────────────────────────────────────────────────────────
step "pytest backend    " bash -c 'cd backend && "$0" -m pytest tests/ -q' "$BACKEND_PY"
step "pytest mcp_server " bash -c 'cd mcp_server && "$0" -m pytest tests/ -q' "$MCP_PY"
step "vitest            " bash -c 'cd frontend && npx vitest run --silent'

if [[ $WITH_E2E -eq 1 ]]; then
  step "cypress e2e       " scripts/e2e.sh
else
  printf '%s==>%s cypress e2e        %sskipped (pass --with-e2e)%s\n' "$DIM" "$OFF" "$DIM" "$OFF"
fi

echo ""
echo "${GREEN}all checks clean${OFF}"

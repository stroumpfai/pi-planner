#!/usr/bin/env bash
#
# The single definition of "clean" for this repo.
#
#   scripts/check.sh            # everything except the browser suite (~70s)
#   scripts/check.sh --with-e2e # add Cypress (~3 min total: 4 parallel stacks)
#   scripts/check.sh --quick    # static checks only, no test suites (~20s)
#
# Checks run cheapest-first and the script stops at the first failure, so a
# formatting slip costs you a second rather than a full test run. CI
# (.github/workflows/ci.yml) calls this file, so there is one place to change
# what "clean" means.
#
# A clean --with-e2e run on a clean checkout stamps HEAD's tree into
# .git/check-passed; the pre-push hook only compares against that stamp.
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
    -h|--help)  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

BACKEND_PY="$ROOT/backend/venv/bin/python"
MCP_PY="$ROOT/mcp_server/.venv/bin/python"

# CI installs into the ambient environment rather than the local venvs.
[[ -x "$BACKEND_PY" ]] || BACKEND_PY="$(command -v python3 || true)"
[[ -x "$MCP_PY" ]]     || MCP_PY="$(command -v python3 || true)"

# The stamp vouches for a commit, so it is only written when the commit is
# exactly what was tested: no tracked edits anywhere, and no untracked files
# where code lives (a forgotten `git add` would pass here and break on main).
# Taken now and re-checked at the end, so an edit made mid-run voids it.
STAMP="$(git rev-parse --git-path check-passed)"
tree_state() {
  git rev-parse 'HEAD^{tree}'
  git status --porcelain --untracked-files=no
  git status --porcelain -- backend frontend mcp_server scripts
}
START_STATE="$(tree_state)"
STAMPABLE=0
[[ "$(printf '%s\n' "$START_STATE" | wc -l)" -eq 1 ]] && STAMPABLE=1

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

# A stale stamp must not survive an e2e run that went on to fail.
[[ $WITH_E2E -eq 1 ]] && rm -f "$STAMP"

E2E_SHARDS="${E2E_SHARDS:-4}"
E2E_SUMMARY="$(git rev-parse --git-path e2e-summary.json)"

# ── test suites ──────────────────────────────────────────────────────────────
step "pytest backend    " bash -c 'cd backend && "$0" -m pytest tests/ -q -n auto' "$BACKEND_PY"
step "  per-file floors " bash -c 'cd backend && "$0" ../scripts/coverage-floors.py backend' "$BACKEND_PY"
step "pytest mcp_server " bash -c 'cd mcp_server && "$0" -m pytest tests/ -q' "$MCP_PY"
step "  per-file floors " bash -c 'cd mcp_server && "$0" ../scripts/coverage-floors.py mcp_server' "$MCP_PY"
step "vitest            " bash -c 'cd frontend && npx vitest run --silent --coverage --coverage.reporter=text-summary'

if [[ $WITH_E2E -eq 1 ]]; then
  # Parallel isolated stacks (own ports and SQLite files), but run on their own: beside
  # pytest -n auto the browsers starve, and tests fail on 4s timeouts and missed drops
  # that are fine on a quiet machine. The summary lands next to the stamp so
  # test-report.sh --reuse-e2e can quote it instead of re-running the suite.
  rm -f "$E2E_SUMMARY"
  step "cypress e2e       " scripts/e2e.sh --parallel "$E2E_SHARDS" --summary "$E2E_SUMMARY"
else
  printf '%s==>%s cypress e2e        %sskipped (pass --with-e2e)%s\n' "$DIM" "$OFF" "$DIM" "$OFF"
fi

echo ""
echo "${GREEN}all checks clean${OFF}"

if [[ $WITH_E2E -eq 1 ]]; then
  if [[ $STAMPABLE -eq 1 && "$(tree_state)" == "$START_STATE" ]]; then
    printf '%s\n' "$START_STATE" > "$STAMP"
    echo "${DIM}stamped $(git rev-parse --short HEAD) as pushable${OFF}"
  else
    echo "${DIM}not stamped: uncommitted changes, or untracked files under backend/ frontend/ mcp_server/ scripts/${OFF}"
  fi
fi

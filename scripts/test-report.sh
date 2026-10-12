#!/usr/bin/env bash
#
# Run every test suite and write a release-ready summary to docs/TEST-REPORT.md.
#
#   scripts/test-report.sh              # run everything, rewrite the report
#   scripts/test-report.sh --no-e2e     # skip Cypress (much faster)
#   scripts/test-report.sh --check      # fail if any suite fails; leaves the report
#   scripts/test-report.sh --reuse-e2e  # quote the e2e result of the check.sh --with-e2e
#                                       # run that stamped this exact tree, don't re-run it
#
# The report records what was run, how many tests passed, and the coverage each
# suite reached, against a specific commit — so a release can point at it.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/docs/TEST-REPORT.md"
TMP="$(mktemp -d -t pi-planner-report-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

RUN_E2E=1
REUSE_E2E=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --no-e2e) RUN_E2E=0 ;;
    --check)  CHECK_ONLY=1 ;;
    --reuse-e2e) REUSE_E2E=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

FAILED=0
note_failure() { FAILED=1; }

# ── backend ──────────────────────────────────────────────────────────────────
echo "==> backend (pytest)"
BACKEND_PY="$ROOT/backend/venv/bin/python"
if [[ -x "$BACKEND_PY" ]]; then
  (cd "$ROOT/backend" && "$BACKEND_PY" -m pytest tests/ -q -n auto --cov=app --cov-config=coverage-branch.ini --cov-report=term) \
    >"$TMP/backend.txt" 2>&1 || note_failure
else
  echo "backend venv missing at $BACKEND_PY" >"$TMP/backend.txt"; note_failure
fi
tail -3 "$TMP/backend.txt"

# ── mcp server ───────────────────────────────────────────────────────────────
echo "==> mcp server (pytest)"
MCP_PY="$ROOT/mcp_server/.venv/bin/python"
if [[ -x "$MCP_PY" ]]; then
  (cd "$ROOT/mcp_server" && "$MCP_PY" -m pytest tests/ -q --cov=. --cov-report=term) \
    >"$TMP/mcp.txt" 2>&1 || note_failure
else
  echo "mcp venv missing at $MCP_PY" >"$TMP/mcp.txt"; note_failure
fi
tail -3 "$TMP/mcp.txt"

# ── frontend unit ────────────────────────────────────────────────────────────
echo "==> frontend (vitest)"
(cd "$ROOT/frontend" && npx vitest run --coverage) >"$TMP/vitest.txt" 2>&1 || note_failure
grep -E "Tests |All files" "$TMP/vitest.txt" | head -2

# ── e2e ──────────────────────────────────────────────────────────────────────
# The browser suite is reduced to one merged JSON (scripts/e2e-summary.py), whether
# it ran as one stack, four local stacks or four CI shards. --reuse-e2e quotes the
# summary check.sh --with-e2e left beside its stamp, but only if that stamp vouches
# for exactly this tree: a clean checkout whose tree hash it matches.
E2E_JSON="$TMP/e2e.json"
if [[ $RUN_E2E -eq 1 ]]; then
  REUSED=0
  if [[ $REUSE_E2E -eq 1 ]]; then
    STAMP="$(git -C "$ROOT" rev-parse --git-path check-passed)"
    SAVED="$(git -C "$ROOT" rev-parse --git-path e2e-summary.json)"
    if [[ -f "$STAMP" && -f "$SAVED" \
          && "$(head -1 "$STAMP")" == "$(git -C "$ROOT" rev-parse 'HEAD^{tree}')" \
          && -z "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]]; then
      echo "==> e2e (reusing the run that stamped this tree)"
      cp "$SAVED" "$E2E_JSON"; REUSED=1
    else
      echo "==> no check.sh --with-e2e stamp for this tree; running e2e"
    fi
  fi
  if [[ $REUSED -eq 0 ]]; then
    echo "==> e2e (cypress, ${E2E_SHARDS:-4} parallel stacks)"
    "$ROOT/scripts/e2e.sh" --parallel "${E2E_SHARDS:-4}" --summary "$E2E_JSON" >"$TMP/e2e.txt" 2>&1 || note_failure
  fi
  if [[ -s "$E2E_JSON" ]]; then
    python3 "$ROOT/scripts/e2e-summary.py" show "$E2E_JSON" | tail -1
  else
    note_failure
  fi
else
  echo "==> e2e skipped (--no-e2e)"
fi

# ── extract numbers ──────────────────────────────────────────────────────────
py() { python3 -c "$1" "${@:2}"; }

read_pytest() {  # file -> "passed|coverage"
  local f="$1"
  local passed cov
  passed="$(grep -oE '[0-9]+ passed' "$f" | tail -1 | grep -oE '[0-9]+' || echo '?')"
  cov="$(grep -oE 'Total coverage: [0-9.]+%' "$f" | tail -1 | grep -oE '[0-9.]+%' || echo '?')"
  echo "${passed}|${cov}"
}

BACKEND="$(read_pytest "$TMP/backend.txt")"
MCP="$(read_pytest "$TMP/mcp.txt")"
VITEST_PASSED="$(grep -oE 'Tests +[0-9]+ passed' "$TMP/vitest.txt" | tail -1 | grep -oE '[0-9]+' || echo '?')"
VITEST_COV="$(grep -E '^All files' "$TMP/vitest.txt" | head -1 | awk -F'|' '{gsub(/ /,"",$2); print $2"%"}' || echo '?')"

E2E_SPECS="$(ls "$ROOT/frontend/cypress/e2e"/*.cy.ts | wc -l | tr -d ' ')"
E2E_DETAIL=""
if [[ $RUN_E2E -eq 1 && -s "$E2E_JSON" ]]; then
  eval "$(python3 - "$E2E_JSON" <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1]))
clock = lambda s: f"{int(s)//60}:{int(s)%60:02d}"
slow = ", ".join(f"{x['spec'].removesuffix('.cy.ts')} {clock(x['seconds'])}"
                 for x in sorted(d["specs"], key=lambda x: -x["seconds"])[:3])
print(f"E2E_PASSED={d['passing']}")
print(f"E2E_STATUS={'pass' if d['status'] == 'pass' else 'FAIL'}")
print(f"E2E_DETAIL='{clock(d['duration_s'])} wall-clock over {d.get('shards', 1)} stack(s), {clock(d['cpu_s'])} total spec time; slowest: {slow}'")
PYEOF
)"
elif [[ $RUN_E2E -eq 1 ]]; then
  E2E_PASSED="?"; E2E_STATUS="FAIL"
else
  E2E_PASSED="not run"; E2E_STATUS="skipped"
fi

BACKEND_PASSED="${BACKEND%%|*}"; BACKEND_COV="${BACKEND##*|}"
MCP_PASSED="${MCP%%|*}";         MCP_COV="${MCP##*|}"

TOTAL="$(py 'import sys
vals=[v for v in sys.argv[1:] if v.isdigit()]
print(sum(int(v) for v in vals))' "$BACKEND_PASSED" "$MCP_PASSED" "$VITEST_PASSED" "$E2E_PASSED")"

COMMIT="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
DATE="$(date -u +'%Y-%m-%d %H:%M UTC')"
STATUS=$([[ $FAILED -eq 0 ]] && echo '✅ all green' || echo '❌ failures — see below')

# ── write the report ─────────────────────────────────────────────────────────
mkdir -p "$ROOT/docs"
cat > "$OUT" <<REPORT
# Test Report

<!-- Generated by scripts/test-report.sh — do not edit by hand. -->

| | |
|---|---|
| **Status** | $STATUS |
| **Generated** | $DATE |
| **Commit** | \`$COMMIT\` on \`$BRANCH\` |
| **Total tests** | **$TOTAL** |

## Suites

| Suite | Tests | Coverage | Runner |
|---|---|---|---|
| Backend (pytest) | $BACKEND_PASSED | $BACKEND_COV | \`cd backend && pytest tests/\` |
| MCP server (pytest) | $MCP_PASSED | $MCP_COV | \`cd mcp_server && pytest tests/\` |
| Frontend unit (Vitest) | $VITEST_PASSED | $VITEST_COV | \`npm run test\` |
| End-to-end (Cypress) | $E2E_PASSED across $E2E_SPECS specs | n/a — journey coverage | \`npm run e2e\` |

End-to-end run: $E2E_STATUS${E2E_DETAIL:+ — $E2E_DETAIL}.

Backend and MCP figures are lines + branches; the frontend figure is statements
(its branch figure is in the Vitest output). The backend's daily gate in
\`check.sh\` measures lines only, for speed — see \`backend/coverage-branch.ini\`.

Coverage gates are enforced by the runners themselves: 93% for the backend
(\`backend/pyproject.toml\`), 95% for the MCP server, and 94% statements / 85%
branches / 80% functions for the frontend (\`frontend/vite.config.ts\`). The
access-guarding files also have their own per-file floors
(\`scripts/coverage-floors.py\`, and the globs in \`vite.config.ts\`). A suite fails
if it drops below its gate.

## What each layer covers

- **Backend** — every route, schema and service: RBAC guards on each endpoint, the
  dual-ID rules, edit-lock enforcement, CSV import, effort rollups, snapshots and
  diffing, PI export/report rendering, and the Alembic migration chain.
- **MCP server** — auth (API key + service JWT), the lock helper, and every read,
  write and workflow tool, including the contract test that keeps tool schemas in
  step with the backend.
- **Frontend unit** — components, hooks, stores, services and utils in isolation,
  with the network layer mocked.
- **End-to-end** — real browser against a real backend on a throwaway database.
  See \`docs/TESTING.md\` for the journeys covered and the known gaps.

## Reproducing

\`\`\`bash
scripts/test-report.sh            # everything, rewrites this file
scripts/test-report.sh --no-e2e   # skip the browser suite
scripts/test-report.sh --reuse-e2e  # quote the check.sh --with-e2e run for this tree
\`\`\`

E2E runs as parallel stacks, each with its own backend and SQLite file on its own
ports (:8901 upward); it never touches a developer database. See \`scripts/e2e.sh\`.
REPORT

if [[ $FAILED -ne 0 ]]; then
  {
    echo ""
    echo "## Failures"
    echo ""
    echo "This run was not green. Tails of the failing suites:"
    echo ""
    for name in backend mcp vitest e2e; do
      [[ -f "$TMP/$name.txt" ]] || continue
      grep -qiE 'fail|error' "$TMP/$name.txt" || continue
      echo "### $name"
      echo ""
      echo '```'
      tail -20 "$TMP/$name.txt"
      echo '```'
      echo ""
    done
  } >> "$OUT"
fi

echo ""
echo "==> wrote $OUT"
[[ $CHECK_ONLY -eq 1 && $FAILED -ne 0 ]] && exit 1
exit 0

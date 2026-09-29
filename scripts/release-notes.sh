#!/usr/bin/env bash
#
# Append new commits to docs/RELEASE-NOTES.md's "## Unreleased" section.
#
# Between two version bumps there are usually dozens of commits, most of them
# internal (refactors, tests, docs, chores) — telling those apart from
# user-facing changes needs a human (or an LLM) reading intent, not a pattern
# match on commit subjects. So this script only ever adds raw material; it
# never removes or rewrites a line. The workflow is:
#
#   scripts/release-notes.sh   # appends commits since the tracked marker
#   ...edit docs/RELEASE-NOTES.md directly: condense, merge, drop internal-only
#      bullets, reword into short user-facing sentences...
#   ...commit docs/RELEASE-NOTES.md...
#
# The file tracks its own progress with a marker comment near the top:
#   <!-- since: <sha> -->
# Each run appends commits since that marker, then advances it to HEAD — so a
# second run before you've committed your edits finds nothing new and leaves
# the file untouched (no risk of wiping in-progress edits).
#
#   scripts/release-notes.sh              # commits since the tracked marker
#   scripts/release-notes.sh --since SHA  # commits since an explicit commit instead
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="$ROOT/docs/RELEASE-NOTES.md"

# The one version-bump commit that exists in history so far — the starting
# point before docs/RELEASE-NOTES.md has ever been created.
DEFAULT_MARKER="b5660b0"

since=""
case "${1:-}" in
  --since)
    since="${2:?--since requires a commit}"
    ;;
  "") ;;
  *)
    echo "unknown option: $1" >&2
    echo "usage: scripts/release-notes.sh [--since SHA]" >&2
    exit 2
    ;;
esac

if [[ ! -f "$FILE" ]]; then
  mkdir -p "$(dirname "$FILE")"
  cat > "$FILE" <<EOF
<!-- since: $DEFAULT_MARKER — scripts/release-notes.sh appends new commits
     here; condense/edit in place, then commit. -->

## Unreleased

EOF
fi

marker="$since"
if [[ -z "$marker" ]]; then
  marker="$(grep -m1 -o '<!-- since: [0-9a-f]\{7,40\}' "$FILE" | awk '{print $3}')"
  marker="${marker:-$DEFAULT_MARKER}"
fi

commits_file="$(mktemp)"
trap 'rm -f "$commits_file"' EXIT
( cd "$ROOT" && git log --no-merges --format='- %s' "$marker"..HEAD ) > "$commits_file"

if [[ ! -s "$commits_file" ]]; then
  echo "no commits since $marker — docs/RELEASE-NOTES.md left untouched"
  exit 0
fi

head_sha="$(cd "$ROOT" && git rev-parse --short HEAD)"
tmp_out="$(mktemp)"

awk -v newbullets="$commits_file" '
  BEGIN { in_unreleased = 0; injected = 0 }
  /^## Unreleased[ \t]*$/ { print; in_unreleased = 1; next }
  /^## / && in_unreleased && !injected {
    while ((getline line < newbullets) > 0) print line
    print ""
    injected = 1
    in_unreleased = 0
    print
    next
  }
  { print }
  END {
    if (in_unreleased && !injected) {
      while ((getline line < newbullets) > 0) print line
    }
  }
' "$FILE" | sed "s/<!-- since: $marker/<!-- since: $head_sha/" > "$tmp_out"

mv "$tmp_out" "$FILE"

n="$(wc -l < "$commits_file" | tr -d ' ')"
echo "==> appended $n commit(s) to docs/RELEASE-NOTES.md's Unreleased section ($marker -> $head_sha)"
echo "    edit the file directly to condense before committing"

#!/usr/bin/env bash
#
# Append new commits to docs/RELEASE-NOTES.md's "# Unreleased" section.
#
# Between two version bumps there are usually dozens of commits, most of them
# internal (refactors, tests, docs, chores) — telling those apart from
# user-facing changes needs a human (or an LLM) reading intent, not a pattern
# match on commit subjects. So this script only ever adds raw material; it
# never removes or rewrites a line. New commits land under a
# "### Commits to triage" subheading inside "# Unreleased" (created if absent,
# appended to if present). The workflow is:
#
#   scripts/release-notes.sh   # appends commits since the tracked marker
#   ...edit docs/RELEASE-NOTES.md directly: condense, merge, drop internal-only
#      bullets, reword into short user-facing sentences, file them under
#      "### Group" subheadings, and delete the "### Commits to triage" heading...
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
<!-- since: $DEFAULT_MARKER — scripts/release-notes.sh moves this marker.
     Format (read by backend/app/services/release_notes.py):
     - "# Unreleased" and "# X.Y.Z — YYYY-MM-DD" are the only level-1 headings.
     - "### Group" subheadings and "- " bullets (nested by 2-space indent) go inside.
     - The script appends raw commits under "### Commits to triage" in Unreleased.
       Condense them into groups, then delete that subheading.
     - To release: rename "# Unreleased" to "# X.Y.Z — date" and open a new one. -->

# Unreleased

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

# Renaming "# Unreleased" to the version is how a release is cut, so the run
# after a bump finds no such section. Open a fresh one above the newest release
# rather than appending nowhere — which used to advance the marker anyway and
# silently drop every commit in between.
#
# Only a level-1 heading closes the section: "###" groups live inside it.
awk -v newbullets="$commits_file" '
  BEGIN { mode = 0; nb = 0 }   # 0 before Unreleased, 1 inside it, 2 after it
  function inject(   line) {
    while ((getline line < newbullets) > 0) print line
  }
  function fresh() {
    print "# Unreleased"; print ""
    print "### Commits to triage"; print ""
    inject()
    print ""
  }
  function emit_section(   i, tri, end) {
    tri = 0
    for (i = 1; i <= nb; i++) if (buf[i] ~ /^#+[ \t]+Commits to triage[ \t]*$/) { tri = i; break }
    if (tri) {
      # Append at the end of the existing triage block, before the next heading.
      end = nb + 1
      for (i = tri + 1; i <= nb; i++) if (buf[i] ~ /^#+[ \t]/) { end = i; break }
      while (end - 1 > tri && buf[end - 1] ~ /^[ \t]*$/) end--
      for (i = 1; i < end; i++) print buf[i]
      inject()
      for (i = end; i <= nb; i++) print buf[i]
    } else {
      end = nb
      while (end > 0 && buf[end] ~ /^[ \t]*$/) end--
      if (end == 0) print ""
      for (i = 1; i <= end; i++) print buf[i]
      if (end > 0) print ""
      print "### Commits to triage"; print ""
      inject()
      print ""
    }
  }
  mode == 1 && /^#[ \t]/ { emit_section(); mode = 2; print; next }
  mode == 1 { buf[++nb] = $0; next }
  mode == 0 && /^# Unreleased[ \t]*$/ { print; mode = 1; next }
  mode == 0 && /^#[ \t]/ { fresh(); mode = 2; print; next }
  { print }
  END {
    if (mode == 1) emit_section()
    else if (mode == 0) { print ""; fresh() }
  }
' "$FILE" | sed "s/<!-- since: [0-9a-f]\{7,40\}/<!-- since: $head_sha/" > "$tmp_out"

# The marker must only move when the commits were written, or they are lost.
# It is the *file's* marker that moves, not "$marker": after --since the two
# differ, and matching on "$marker" would leave the file's marker where it was,
# so the next plain run would append the same commits again.
n="$(wc -l < "$commits_file" | tr -d ' ')"
written="$(grep -cFx -f "$commits_file" "$tmp_out" || true)"
if (( written < n )); then
  rm -f "$tmp_out"
  echo "error: could not place the new commits in docs/RELEASE-NOTES.md — file and marker left untouched" >&2
  exit 1
fi

mv "$tmp_out" "$FILE"

echo "==> appended $n commit(s) to docs/RELEASE-NOTES.md's Unreleased > Commits to triage ($marker -> $head_sha)"
echo "    edit the file directly to condense before committing"

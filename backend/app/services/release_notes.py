"""Parses docs/RELEASE-NOTES.md into structured entries.

The file is hand-authored (see scripts/release-notes.sh): a `<!-- since: <sha> -->`
marker comment, then '## ' headings ("Unreleased", or "1.14.0 — 2026-10-05") each
followed by '- ' bullet lines. A heading of any level starts a section, the same
rule scripts/release-notes.sh uses to close "Unreleased" — a hand-written
'# Version 1.14' must not fold its bullets into the section above it. This module
only reads that shape — it never writes the file.
"""

import re
from pathlib import Path

from app.schemas.release_notes import ReleaseNoteEntry

_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_HEADING_RE = re.compile(r"^#+[ \t]+(.+)$", re.MULTILINE)


def parse_release_notes(text: str) -> list[ReleaseNoteEntry]:
    stripped = _COMMENT_RE.sub("", text)
    headings = list(_HEADING_RE.finditer(stripped))

    entries: list[ReleaseNoteEntry] = []
    for index, match in enumerate(headings):
        heading = match.group(1).strip()
        body_start = match.end()
        body_end = headings[index + 1].start() if index + 1 < len(headings) else len(stripped)
        body = stripped[body_start:body_end]

        notes = [
            line.strip().removeprefix("- ").strip()
            for line in body.splitlines()
            if line.strip().startswith("- ")
        ]

        version, _, date = heading.partition(" — ")
        entries.append(ReleaseNoteEntry(version=version.strip(), date=date.strip() or None, notes=notes))

    return entries


def load_release_notes(path: str) -> list[ReleaseNoteEntry]:
    file = Path(path)
    if not file.is_file():
        return []
    return parse_release_notes(file.read_text())

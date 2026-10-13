"""Parses docs/RELEASE-NOTES.md into structured entries.

The file's contract (also stated in its header comment):

* a `<!-- ... -->` comment, ignored here;
* '# ' (level-1) headings are the only sections: `# Unreleased`, or
  `# 1.14.0 — 2026-10-11` for a shipped version;
* deeper headings ('### CSV Import') are groups inside the section;
* '- ' bullets, nested by indentation, are the notes.

scripts/release-notes.sh closes "Unreleased" at the next '# ' heading, the same
rule used here. This module only reads that shape — it never writes the file.
"""

import re
from pathlib import Path

from app.schemas.release_notes import ReleaseNoteEntry, ReleaseNoteGroup, ReleaseNoteItem

UNRELEASED = "Unreleased"

_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_SECTION_RE = re.compile(r"^#[ \t]+(.+?)[ \t]*$")
_GROUP_RE = re.compile(r"^#{2,6}[ \t]+(.+?)[ \t]*$")
_BULLET_RE = re.compile(r"^([ \t]*)[-*][ \t]+(.+?)[ \t]*$")


def _indent(whitespace: str) -> int:
    return len(whitespace.expandtabs(4))


def parse_release_notes(text: str) -> list[ReleaseNoteEntry]:
    entries: list[ReleaseNoteEntry] = []
    group: ReleaseNoteGroup | None = None
    # (indent, item) for the bullets currently open, shallowest first.
    stack: list[tuple[int, ReleaseNoteItem]] = []

    for line in _COMMENT_RE.sub("", text).splitlines():
        if section := _SECTION_RE.match(line):
            version, _, date = section.group(1).partition(" — ")
            entries.append(ReleaseNoteEntry(version=version.strip(), date=date.strip() or None, groups=[]))
            group, stack = None, []
        elif entries and (heading := _GROUP_RE.match(line)):
            group = ReleaseNoteGroup(title=heading.group(1), items=[])
            entries[-1].groups.append(group)
            stack = []
        elif entries and (bullet := _BULLET_RE.match(line)):
            if group is None:
                group = ReleaseNoteGroup(title=None, items=[])
                entries[-1].groups.append(group)
            indent = _indent(bullet.group(1))
            item = ReleaseNoteItem(text=bullet.group(2))
            while stack and stack[-1][0] >= indent:
                stack.pop()
            (stack[-1][1].children if stack else group.items).append(item)
            stack.append((indent, item))

    return entries


def load_release_notes(path: str) -> list[ReleaseNoteEntry]:
    file = Path(path)
    if not file.is_file():
        return []
    return parse_release_notes(file.read_text())


def load_shipped_release_notes(path: str) -> list[ReleaseNoteEntry]:
    """What users see: every version except the working "Unreleased" section."""
    return [e for e in load_release_notes(path) if e.version.lower() != UNRELEASED.lower()]

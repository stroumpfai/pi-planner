"""What the Release Notes modal reads (docs/RELEASE-NOTES.md, parsed)."""

from pydantic import BaseModel


class ReleaseNoteEntry(BaseModel):
    """One '## ' section of docs/RELEASE-NOTES.md: a version or 'Unreleased'."""

    version: str
    # None for the "Unreleased" section; "2026-10-05" once a version has shipped.
    date: str | None
    notes: list[str]


class ReleaseNotesResponse(BaseModel):
    # Newest first, as the file reads top to bottom.
    entries: list[ReleaseNoteEntry]

"""What the Release Notes modal reads (docs/RELEASE-NOTES.md, parsed)."""

from pydantic import BaseModel, Field


class ReleaseNoteItem(BaseModel):
    """One bullet; indented bullets beneath it are its children, to any depth."""

    text: str
    children: list["ReleaseNoteItem"] = Field(default_factory=list)


class ReleaseNoteGroup(BaseModel):
    """The bullets under one '### ' subheading. `title` is None for bullets before any."""

    title: str | None
    items: list[ReleaseNoteItem]


class ReleaseNoteEntry(BaseModel):
    """One '# ' section of docs/RELEASE-NOTES.md: a shipped version, or 'Unreleased'."""

    version: str
    # None for the "Unreleased" section; "2026-10-05" once a version has shipped.
    date: str | None
    groups: list[ReleaseNoteGroup]


class ReleaseNotesResponse(BaseModel):
    # Newest first, as the file reads top to bottom. "Unreleased" is never included.
    entries: list[ReleaseNoteEntry]

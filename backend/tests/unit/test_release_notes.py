"""The docs/RELEASE-NOTES.md parser (app/services/release_notes.py).

The file is hand-authored, not generated, so these pin the shape a human is
expected to produce: a marker comment to ignore, an "Unreleased" section with
no date, and shipped sections with a "version — date" heading.
"""

from app.services.release_notes import load_release_notes, parse_release_notes

FIXTURE = """<!-- since: abc1234 — run scripts/release-notes.sh, condense by hand,
     then scripts/release-notes.sh --mark -->

## Unreleased

- Teams can now be exported to and imported from JSON

## 1.13.0 — 2026-08-14

- Show who counts towards capacity in every team view
- Add a team Achievement view
"""


def test_parses_unreleased_and_shipped_sections():
    entries = parse_release_notes(FIXTURE)

    assert [e.version for e in entries] == ["Unreleased", "1.13.0"]
    assert entries[0].date is None
    assert entries[0].notes == ["Teams can now be exported to and imported from JSON"]
    assert entries[1].date == "2026-08-14"
    assert entries[1].notes == [
        "Show who counts towards capacity in every team view",
        "Add a team Achievement view",
    ]


def test_strips_marker_comment():
    entries = parse_release_notes(FIXTURE)
    for entry in entries:
        for note in entry.notes:
            assert "since:" not in note


def test_empty_text_has_no_entries():
    assert parse_release_notes("") == []


def test_section_with_no_notes_yet():
    entries = parse_release_notes("## Unreleased\n")
    assert entries == [type(entries[0])(version="Unreleased", date=None, notes=[])]


def test_load_missing_file_returns_empty():
    assert load_release_notes("/nonexistent/path/RELEASE-NOTES.md") == []


def test_load_reads_real_file(tmp_path):
    file = tmp_path / "RELEASE-NOTES.md"
    file.write_text(FIXTURE)
    entries = load_release_notes(str(file))
    assert [e.version for e in entries] == ["Unreleased", "1.13.0"]

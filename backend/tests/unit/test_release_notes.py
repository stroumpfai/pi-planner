"""The docs/RELEASE-NOTES.md parser (app/services/release_notes.py).

The file is hand-authored, not generated, so these pin the shape a human is
expected to produce: a comment to ignore, level-1 sections ("Unreleased", or
"version — date"), '###' groups, and bullets nested by indentation.
"""

from app.services.release_notes import load_release_notes, load_shipped_release_notes, parse_release_notes

FIXTURE = """<!-- since: abc1234 — format rules live here -->

# Unreleased

### Commits to triage

- Raw commit subject

# 1.13.0 — 2026-08-14

### Teams

- Show who counts towards capacity in every team view
  - Also in the export
    - And the PNG
- Add a team Achievement view

### Security

- Hash with argon2id
"""


def test_parses_sections_groups_and_nesting():
    entries = parse_release_notes(FIXTURE)

    assert [e.version for e in entries] == ["Unreleased", "1.13.0"]
    assert entries[0].date is None
    assert entries[1].date == "2026-08-14"
    assert [g.title for g in entries[1].groups] == ["Teams", "Security"]

    teams = entries[1].groups[0].items
    assert [i.text for i in teams] == [
        "Show who counts towards capacity in every team view",
        "Add a team Achievement view",
    ]
    assert teams[0].children[0].text == "Also in the export"
    assert teams[0].children[0].children[0].text == "And the PNG"
    assert teams[1].children == []


def test_bullets_before_any_group_have_no_title():
    entries = parse_release_notes("# 1.0.0 — 2026-01-01\n\n- Plain\n  - Nested\n\n### Later\n- In group\n")

    assert [g.title for g in entries[0].groups] == [None, "Later"]
    assert entries[0].groups[0].items[0].children[0].text == "Nested"


def test_only_level_one_heading_starts_a_section():
    # '###' is a group; it must not turn "Commits to triage" into a version.
    entries = parse_release_notes("# Unreleased\n\n### Commits to triage\n- x\n\n## Sub\n- y\n")

    assert [e.version for e in entries] == ["Unreleased"]
    assert [g.title for g in entries[0].groups] == ["Commits to triage", "Sub"]


def test_dedent_returns_to_the_right_parent():
    entries = parse_release_notes("# 1.0.0\n- a\n  - b\n    - c\n  - d\n- e\n")

    items = entries[0].groups[0].items
    assert [i.text for i in items] == ["a", "e"]
    assert [c.text for c in items[0].children] == ["b", "d"]


def test_strips_comment():
    texts = {i.text for e in parse_release_notes(FIXTURE) for g in e.groups for i in g.items}
    assert not any("since:" in t for t in texts)


def test_empty_text_has_no_entries():
    assert parse_release_notes("") == []


def test_section_with_no_notes_yet():
    entries = parse_release_notes("# Unreleased\n")
    assert entries == [type(entries[0])(version="Unreleased", date=None, groups=[])]


def test_load_missing_file_returns_empty():
    assert load_release_notes("/nonexistent/path/RELEASE-NOTES.md") == []


def test_shipped_excludes_unreleased(tmp_path):
    file = tmp_path / "RELEASE-NOTES.md"
    file.write_text(FIXTURE)

    assert [e.version for e in load_release_notes(str(file))] == ["Unreleased", "1.13.0"]
    assert [e.version for e in load_shipped_release_notes(str(file))] == ["1.13.0"]

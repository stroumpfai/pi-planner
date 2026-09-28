"""Export/import for teams, mirroring the project feature (test_projects.py).

Deliberately excludes project assignments (TeamProject) from the round-trip: they
reference project ids that may not exist wherever the file is later imported, and
re-assigning a team to a project is a separate, existing action.
"""
import json

import pytest
from httpx import AsyncClient

from app.schemas import (
    MAX_ABSENCES_PER_MEMBER,
    MAX_MEETINGS_PER_TEAM,
    MAX_MEMBERS_PER_TEAM,
    MAX_PATTERN_VERSIONS_PER_MEMBER,
    MAX_TEAMS,
)

_TEAMS = "/api/v1/teams"


async def _create_team(client, name: str = "Platform") -> dict:
    resp = await client.post(_TEAMS, json={"name": name})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_member(client, team_id: str, name: str = "Marta Lindqvist", **fields) -> dict:
    resp = await client.post(f"{_TEAMS}/{team_id}/members", json={"name": name, **fields})
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _add_version(client, team_id: str, member_id: str, effective_from: str, **fields) -> dict:
    resp = await client.post(
        f"{_TEAMS}/{team_id}/members/{member_id}/working-days",
        json={"effective_from": effective_from, **fields},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_absence(client, team_id: str, member_ids: list[str], **rule) -> list[dict]:
    resp = await client.post(
        f"{_TEAMS}/{team_id}/absences",
        json={"member_ids": member_ids, "kind": "range", "start_date": "2026-03-01", **rule},
        params={"from": "2026-01-01", "to": "2026-12-31"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_meeting(client, team_id: str, member_ids: list[str], **rule) -> dict:
    body = {
        "title": "Sprint planning",
        "kind": "range",
        "start_date": "2026-09-07",
        "half": "am",
        "duration_minutes": 120,
        "member_ids": member_ids,
    }
    body.update(rule)
    resp = await client.post(
        f"{_TEAMS}/{team_id}/meetings", json=body, params={"from": "2026-01-01", "to": "2026-12-31"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _upload(payload: dict) -> tuple[str, tuple[str, bytes, str]]:
    return ("file", ("team-backup.json", json.dumps(payload).encode(), "application/json"))


def _make_export_payload(name: str = "Import Test", **overrides) -> dict:
    return {
        "version": "1.0",
        "exported_at": "2026-01-01T00:00:00+00:00",
        "team": {
            "system_id": "old-team-uuid",
            "name": name,
            "description": None,
            "normal_day_hours": 8.0,
            "created_at": "2026-01-01T00:00:00+00:00",
            "modified_at": "2026-01-01T00:00:00+00:00",
            "members": [],
            "absences": [],
            "meetings": [],
            **overrides,
        },
    }


# ── Export ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_export_team(client):
    team = await _create_team(client, "Export Me")
    resp = await client.get(f"{_TEAMS}/{team['system_id']}/export")
    assert resp.status_code == 200
    data = resp.json()
    assert data["version"] == "1.0"
    assert "exported_at" in data
    assert data["team"]["name"] == "Export Me"
    assert data["team"]["members"] == []


@pytest.mark.asyncio
async def test_export_includes_members_patterns_absences_meetings(client):
    team = await _create_team(client, "Full Team")
    team_id = team["system_id"]
    member = await _create_member(client, team_id, "Marta", pattern={"effective_from": "2026-01-01"})
    await _add_version(client, team_id, member["system_id"], "2026-06-01", focus=0.5)
    await _create_absence(client, team_id, [member["system_id"]], label="Holiday")
    await _create_meeting(client, team_id, [member["system_id"]])

    data = (await client.get(f"{_TEAMS}/{team_id}/export")).json()
    team_data = data["team"]

    assert len(team_data["members"]) == 1
    exported_member = team_data["members"][0]
    assert exported_member["name"] == "Marta"
    assert len(exported_member["pattern_versions"]) == 2
    assert {v["effective_from"] for v in exported_member["pattern_versions"]} == {"2026-01-01", "2026-06-01"}

    assert len(team_data["absences"]) == 1
    assert team_data["absences"][0]["member_id"] == member["system_id"]
    assert team_data["absences"][0]["label"] == "Holiday"

    assert len(team_data["meetings"]) == 1
    assert team_data["meetings"][0]["attendee_member_ids"] == [member["system_id"]]


@pytest.mark.asyncio
async def test_export_excludes_project_assignments(client):
    team = await _create_team(client, "Assigned Team")
    project = (await client.post("/api/v1/projects/", json={"name": "Served Project"})).json()
    resp = await client.post(
        f"{_TEAMS}/{team['system_id']}/projects", json={"project_id": project["system_id"]}
    )
    assert resp.status_code == 201, resp.text

    data = (await client.get(f"{_TEAMS}/{team['system_id']}/export")).json()
    assert "projects" not in data["team"]
    assert "team_projects" not in data["team"]
    assert json.dumps(data).count(project["system_id"]) == 0


@pytest.mark.asyncio
async def test_export_404_unknown_team(client):
    resp = await client.get(f"{_TEAMS}/nonexistent/export")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_export_content_disposition_filename(client):
    team = await _create_team(client, "My Team Name")
    resp = await client.get(f"{_TEAMS}/{team['system_id']}/export")
    cd = resp.headers["Content-Disposition"]
    assert "attachment" in cd
    assert "My_Team_Name" in cd
    assert ".json" in cd


# ── Import ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_import_creates_new_team(client: AsyncClient):
    resp = await client.post(_TEAMS + "/import", files=[_upload(_make_export_payload("Imported Team"))])
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Imported Team"
    assert "system_id" in data

    teams = (await client.get(_TEAMS)).json()
    assert any(t["name"] == "Imported Team" for t in teams)


@pytest.mark.asyncio
async def test_import_creates_new_team_with_new_ids(client: AsyncClient):
    old_member_id = "old-member-uuid"
    old_meeting_id = "old-meeting-uuid"
    payload = _make_export_payload(
        "UUID Regen",
        members=[
            {
                "system_id": old_member_id,
                "name": "Marta",
                "pattern_versions": [{"effective_from": "2026-01-01"}],
            }
        ],
        absences=[
            {
                "system_id": "old-absence-uuid",
                "member_id": old_member_id,
                "kind": "range",
                "start_date": "2026-03-01",
            }
        ],
        meetings=[
            {
                "system_id": old_meeting_id,
                "title": "Standup",
                "kind": "weekly",
                "start_date": "2026-01-05",
                "weekday": 0,
                "half": "am",
                "duration_minutes": 15,
                "attendee_member_ids": [old_member_id],
            }
        ],
    )

    resp = await client.post(_TEAMS + "/import", files=[_upload(payload)])
    assert resp.status_code == 201
    new_team_id = resp.json()["system_id"]
    assert new_team_id != "old-team-uuid"

    export = (await client.get(f"{_TEAMS}/{new_team_id}/export")).json()
    team_data = export["team"]

    new_member_id = team_data["members"][0]["system_id"]
    assert new_member_id != old_member_id
    assert team_data["absences"][0]["member_id"] == new_member_id
    assert team_data["meetings"][0]["attendee_member_ids"] == [new_member_id]


@pytest.mark.asyncio
async def test_import_name_conflict_auto_suffix(client: AsyncClient):
    payload = _make_export_payload("Conflict Name")
    await client.post(_TEAMS + "/import", files=[_upload(payload)])

    resp2 = await client.post(_TEAMS + "/import", files=[_upload(payload)])
    assert resp2.status_code == 201
    assert resp2.json()["name"] == "Conflict Name (imported)"

    resp3 = await client.post(_TEAMS + "/import", files=[_upload(payload)])
    assert resp3.status_code == 201
    assert resp3.json()["name"] == "Conflict Name (imported 2)"


@pytest.mark.asyncio
async def test_import_invalid_json(client: AsyncClient):
    resp = await client.post(
        _TEAMS + "/import", files=[("file", ("bad.json", b"not valid json", "application/json"))]
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_JSON"


@pytest.mark.asyncio
async def test_import_missing_required_fields(client: AsyncClient):
    payload = {"version": "1.0", "team": {"description": "no name"}}
    resp = await client.post(_TEAMS + "/import", files=[_upload(payload)])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_FORMAT"


@pytest.mark.asyncio
async def test_import_wrong_version(client: AsyncClient):
    payload = _make_export_payload("Version Test")
    payload["version"] = "2.0"
    resp = await client.post(_TEAMS + "/import", files=[_upload(payload)])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "UNSUPPORTED_VERSION"


@pytest.mark.asyncio
async def test_import_file_too_large(client: AsyncClient):
    huge = _make_export_payload("Huge", description="x" * (10 * 1024 * 1024 + 1))
    resp = await client.post(_TEAMS + "/import", files=[_upload(huge)])
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_import_enforces_member_cap(client: AsyncClient):
    payload = _make_export_payload(
        "Too Many Members",
        members=[
            {"system_id": f"m{i}", "name": f"Member {i}", "pattern_versions": []}
            for i in range(MAX_MEMBERS_PER_TEAM + 1)
        ],
    )
    resp = await client.post(_TEAMS + "/import", files=[_upload(payload)])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "IMPORT_LIMIT_EXCEEDED"


@pytest.mark.asyncio
async def test_import_enforces_pattern_version_cap(client: AsyncClient):
    payload = _make_export_payload(
        "Too Many Versions",
        members=[
            {
                "system_id": "m1",
                "name": "Marta",
                "pattern_versions": [
                    {"effective_from": f"2026-01-{day:02d}"}
                    for day in range(1, MAX_PATTERN_VERSIONS_PER_MEMBER + 2)
                ],
            }
        ],
    )
    resp = await client.post(_TEAMS + "/import", files=[_upload(payload)])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "IMPORT_LIMIT_EXCEEDED"


@pytest.mark.asyncio
async def test_import_enforces_absence_cap(client: AsyncClient):
    payload = _make_export_payload(
        "Too Many Absences",
        members=[{"system_id": "m1", "name": "Marta", "pattern_versions": []}],
        absences=[
            {"system_id": f"a{i}", "member_id": "m1", "kind": "range", "start_date": "2026-03-01"}
            for i in range(MAX_ABSENCES_PER_MEMBER + 1)
        ],
    )
    resp = await client.post(_TEAMS + "/import", files=[_upload(payload)])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "IMPORT_LIMIT_EXCEEDED"


@pytest.mark.asyncio
async def test_import_enforces_meeting_cap(client: AsyncClient):
    payload = _make_export_payload(
        "Too Many Meetings",
        meetings=[
            {
                "system_id": f"mt{i}",
                "title": f"Meeting {i}",
                "kind": "range",
                "start_date": "2026-09-07",
                "half": "am",
                "duration_minutes": 15,
                "attendee_member_ids": [],
            }
            for i in range(MAX_MEETINGS_PER_TEAM + 1)
        ],
    )
    resp = await client.post(_TEAMS + "/import", files=[_upload(payload)])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "IMPORT_LIMIT_EXCEEDED"


@pytest.mark.asyncio
async def test_import_enforces_team_limit(client: AsyncClient):
    for i in range(MAX_TEAMS):
        await client.post(_TEAMS, json={"name": f"Team {i}"})
    resp = await client.post(_TEAMS + "/import", files=[_upload(_make_export_payload("One Too Many"))])
    assert resp.status_code == 409
    assert resp.json()["detail"]["error"] == "TEAM_LIMIT_REACHED"


@pytest.mark.asyncio
async def test_import_dangling_absence_member_reference(client: AsyncClient):
    payload = _make_export_payload(
        "Dangling",
        absences=[
            {"system_id": "a1", "member_id": "unknown-member", "kind": "range", "start_date": "2026-03-01"}
        ],
    )
    resp = await client.post(_TEAMS + "/import", files=[_upload(payload)])
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "DANGLING_REFERENCE"


# ── RBAC ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reader_cannot_export_team(client, reader_client):
    team = await _create_team(client, "RO Export")
    resp = await reader_client.get(f"{_TEAMS}/{team['system_id']}/export")
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_reader_cannot_import_team(reader_client):
    resp = await reader_client.post(
        _TEAMS + "/import", files=[_upload(_make_export_payload("Should Fail"))]
    )
    assert resp.status_code == 403

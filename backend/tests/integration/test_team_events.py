"""Project writes that move an Achievement figure reach the serving team's channel.

Team and project events travel on separate channels, so without this forwarding an
open Achievement view would never hear that a story was completed, re-estimated or
moved (team-achievement.md §8.2).
"""

import pytest

from app.services.events import team_channel
from app.services.team_events import ACHIEVEMENT_CHANGED

_TEAMS = "/api/v1/teams"


@pytest.fixture
def captured_events(monkeypatch):
    events: list[tuple[str, str, dict]] = []

    async def fake_broadcast(channel, event_type, data):
        events.append((channel, event_type, data))

    from app.services.events import broadcaster
    monkeypatch.setattr(broadcaster, "broadcast", fake_broadcast)
    return events


async def _project(client, name: str) -> tuple[str, str]:
    pid = (await client.post("/api/v1/projects/", json={"name": name})).json()["system_id"]
    fid = (await client.post(
        f"/api/v1/projects/{pid}/features", json={"title": "Checkout"},
    )).json()["system_id"]
    return pid, fid


async def _served_project(client) -> tuple[str, str, str]:
    team_id = (await client.post(_TEAMS, json={"name": "Platform"})).json()["system_id"]
    pid, fid = await _project(client, "Served")
    resp = await client.post(f"{_TEAMS}/{team_id}/projects", json={"project_id": pid})
    assert resp.status_code == 201, resp.text
    return team_id, pid, fid


def _forwarded(events, team_id: str, pid: str) -> list:
    return [e for e in events if e == (team_channel(team_id), ACHIEVEMENT_CHANGED, {"project_id": pid})]


@pytest.mark.asyncio
async def test_a_story_write_reaches_the_serving_team(client, captured_events):
    team_id, pid, fid = await _served_project(client)
    pbi = (await client.post(f"/api/v1/projects/{pid}/pbis", json={
        "title": "Pay by card", "parent_feature_system_id": fid,
    })).json()
    assert len(_forwarded(captured_events, team_id, pid)) == 1  # create

    captured_events.clear()
    await client.patch(f"/api/v1/pbis/{pbi['system_id']}", json={"effort": 3})
    assert len(_forwarded(captured_events, team_id, pid)) == 1

    captured_events.clear()
    await client.delete(f"/api/v1/pbis/{pbi['system_id']}")
    assert len(_forwarded(captured_events, team_id, pid)) == 1


@pytest.mark.asyncio
async def test_a_project_no_team_serves_forwards_nothing(client, captured_events):
    pid, fid = await _project(client, "Alone")
    await client.post(f"/api/v1/projects/{pid}/pbis", json={
        "title": "Pay by card", "parent_feature_system_id": fid,
    })
    assert not [e for e in captured_events if e[1] == ACHIEVEMENT_CHANGED]


@pytest.mark.asyncio
async def test_recategorising_a_state_is_forwarded_and_renaming_is_not(client, captured_events):
    team_id, pid, _ = await _served_project(client)
    state = (await client.post(
        f"/api/v1/projects/{pid}/states/", json={"item_type": "story", "value": "Done"},
    )).json()

    captured_events.clear()
    await client.patch(f"/api/v1/projects/{pid}/states/{state['system_id']}", json={"value": "Closed"})
    assert _forwarded(captured_events, team_id, pid) == []

    await client.patch(f"/api/v1/projects/{pid}/states/{state['system_id']}", json={"category": "done"})
    assert len(_forwarded(captured_events, team_id, pid)) == 1


@pytest.mark.asyncio
async def test_deleting_a_feature_takes_its_stories_out_and_is_forwarded(client, captured_events):
    team_id, pid, fid = await _served_project(client)
    captured_events.clear()
    await client.delete(f"/api/v1/features/{fid}")
    assert len(_forwarded(captured_events, team_id, pid)) == 1


@pytest.mark.asyncio
async def test_a_csv_import_is_forwarded_once(client, captured_events):
    team_id, pid, _ = await _served_project(client)
    captured_events.clear()
    resp = await client.post(f"/api/v1/projects/{pid}/import/csv", json={"rows": [
        {"row_number": 2, "item_type": "feature", "user_id": 101, "title": "Auth"},
        {"row_number": 3, "item_type": "story", "user_id": 201, "title": "Login", "parent_id": 101},
    ]})
    assert resp.status_code in (200, 201), resp.text
    assert len(_forwarded(captured_events, team_id, pid)) == 1

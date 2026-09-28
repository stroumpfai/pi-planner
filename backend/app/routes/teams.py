import json
from datetime import date, datetime, timezone
from typing import Annotated, Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.middleware.deps import get_current_user, require_editor_or_above
from app.models.project import Project
from app.models.team import Absence, Meeting, MeetingAttendee, MemberPatternVersion, Team, TeamMember, TeamProject
from app.models.user import User
from app.schemas import (
    MAX_ABSENCES_PER_MEMBER,
    MAX_MEETINGS_PER_TEAM,
    MAX_MEMBERS_PER_TEAM,
    MAX_PATTERN_VERSIONS_PER_MEMBER,
    MAX_TEAMS,
    TeamCreate,
    TeamResponse,
    TeamUpdate,
)
from app.services.concurrency import IfMatch, check_if_match, set_etag
from app.services.events import broadcaster, team_channel
from app.services.team_export import serialize_team

_IMPORT_MAX_BYTES = 10 * 1024 * 1024  # 10 MB

# No require_edit_lock anywhere below. These paths carry no project_id, so
# _resolve_locked_project_id would return None and the dependency would be a
# no-op — team endpoints are outside the single-writer lock by construction
# (spec/teams.md §4.1). Concurrency here is If-Match, per row (§4.2).
router = APIRouter(prefix="/api/v1/teams", tags=["teams"])


async def _get_or_404(db: AsyncSession, team_id: str) -> Team:
    team = await db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team


async def _counts(
    db: AsyncSession, team_ids: list[str]
) -> tuple[dict[str, int], dict[str, list[tuple[str, int]]]]:
    """Member counts, and served projects with their shares, in two queries."""
    if not team_ids:
        return {}, {}
    member_rows = await db.execute(
        select(TeamMember.team_id, func.count(TeamMember.system_id))
        .where(TeamMember.team_id.in_(team_ids))
        .group_by(TeamMember.team_id)
    )
    members = {team_id: count for team_id, count in member_rows.all()}

    project_rows = await db.execute(
        select(TeamProject.team_id, TeamProject.project_id, TeamProject.share_pct)
        .where(TeamProject.team_id.in_(team_ids))
        .order_by(TeamProject.created_at.asc())
    )
    projects: dict[str, list[tuple[str, int]]] = {}
    for team_id, project_id, share_pct in project_rows.all():
        projects.setdefault(team_id, []).append((project_id, share_pct))
    return members, projects


def _response(
    team: Team, member_count: int, assignments: list[tuple[str, int]]
) -> TeamResponse:
    return TeamResponse.model_validate(team).model_copy(
        update={
            "member_count": member_count,
            "project_ids": [project_id for project_id, _ in assignments],
            "project_shares": {project_id: share for project_id, share in assignments},
        }
    )


async def _one_response(db: AsyncSession, team: Team) -> TeamResponse:
    members, projects = await _counts(db, [team.system_id])
    return _response(team, members.get(team.system_id, 0), projects.get(team.system_id, []))


def _name_taken(name: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"error": "TEAM_NAME_TAKEN", "message": f"A team named '{name}' already exists"},
    )


@router.get("")
async def list_teams(
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[TeamResponse]:
    result = await db.execute(select(Team).order_by(func.lower(Team.name).asc()))
    teams = list(result.scalars().all())
    members, projects = await _counts(db, [t.system_id for t in teams])
    return [
        _response(t, members.get(t.system_id, 0), projects.get(t.system_id, []))
        for t in teams
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_team(
    body: TeamCreate,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> TeamResponse:
    existing = await db.scalar(select(func.count(Team.system_id)))
    if (existing or 0) >= MAX_TEAMS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "TEAM_LIMIT_REACHED",
                "message": f"An instance holds at most {MAX_TEAMS} teams.",
            },
        )

    team = Team(
        name=body.name,
        description=body.description,
        normal_day_hours=body.normal_day_hours,
    )
    db.add(team)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _name_taken(body.name)
    await db.refresh(team)
    # No create event: a team nobody is watching yet has no channel with listeners,
    # exactly as a newly created project has none.

    # Stamp the tag here too, so "create then immediately rename" does not need a
    # GET in between purely to learn a value this response already knows.
    set_etag(response, team.modified_at)
    return _response(team, 0, [])


@router.get("/{team_id}")
async def get_team(
    team_id: str,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> TeamResponse:
    team = await _get_or_404(db, team_id)
    # The tag a later PATCH or DELETE has to quote back in If-Match (§4.2).
    set_etag(response, team.modified_at)
    return await _one_response(db, team)


@router.patch("/{team_id}")
async def update_team(
    team_id: str,
    body: TeamUpdate,
    if_match: IfMatch,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> TeamResponse:
    team = await _get_or_404(db, team_id)
    check_if_match(if_match, team.modified_at, await _one_response(db, team))

    if body.name is not None:
        team.name = body.name
    if "description" in body.model_fields_set:
        team.description = body.description
    if body.normal_day_hours is not None:
        team.normal_day_hours = body.normal_day_hours
    team.modified_at = datetime.now(timezone.utc)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _name_taken(body.name or team.name)
    await db.refresh(team)

    await broadcaster.broadcast(team_channel(team_id), "team:updated", {"system_id": team_id})
    set_etag(response, team.modified_at)
    return await _one_response(db, team)


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_team(
    team_id: str,
    if_match: IfMatch,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> None:
    team = await _get_or_404(db, team_id)
    check_if_match(if_match, team.modified_at, await _one_response(db, team))

    # Blocked while the team serves anything, so nobody loses a capacity model by
    # accident — unassigning is the explicit step (§10). The names come back with
    # the error because "unassign every project first" is useless without them.
    assigned = await db.execute(
        select(TeamProject.project_id, Project.name)
        .join(Project, Project.system_id == TeamProject.project_id)
        .where(TeamProject.team_id == team_id)
        .order_by(Project.name.asc())
    )
    projects = [{"system_id": pid, "name": name} for pid, name in assigned.all()]
    if projects:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "TEAM_HAS_PROJECTS",
                "message": "Unassign this team's projects before deleting it.",
                "projects": projects,
            },
        )

    await db.delete(team)
    await db.commit()
    await broadcaster.broadcast(team_channel(team_id), "team:deleted", {"system_id": team_id})


async def _unique_team_name(db: AsyncSession, base_name: str) -> str:
    name = base_name
    suffix = 1
    while True:
        result = await db.execute(select(Team).where(func.lower(Team.name) == name.lower()))
        if not result.scalar_one_or_none():
            return name
        name = f"{base_name} (imported)" if suffix == 1 else f"{base_name} (imported {suffix})"
        suffix += 1


def _validate_team_import_payload(payload: object) -> dict[str, Any]:
    if not isinstance(payload, dict) or "version" not in payload or "team" not in payload:
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_FORMAT", "message": "Missing required top-level fields: version, team"},
        )
    if payload["version"] != "1.0":
        raise HTTPException(
            status_code=422,
            detail={"error": "UNSUPPORTED_VERSION", "message": f"Unsupported export version: {payload['version']}"},
        )
    team_data = payload["team"]
    if not isinstance(team_data, dict) or "name" not in team_data:
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_FORMAT", "message": "Field 'team' must be an object with a 'name'"},
        )
    return team_data


def _check_import_limits(team_data: dict[str, Any]) -> None:
    members = team_data.get("members", [])
    if len(members) > MAX_MEMBERS_PER_TEAM:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "IMPORT_LIMIT_EXCEEDED",
                "message": f"A team holds at most {MAX_MEMBERS_PER_TEAM} members.",
            },
        )
    for member in members:
        versions = member.get("pattern_versions", [])
        if len(versions) > MAX_PATTERN_VERSIONS_PER_MEMBER:
            raise HTTPException(
                status_code=422,
                detail={
                    "error": "IMPORT_LIMIT_EXCEEDED",
                    "message": f"A member holds at most {MAX_PATTERN_VERSIONS_PER_MEMBER} pattern versions.",
                },
            )

    absences_per_member: dict[str, int] = {}
    for absence in team_data.get("absences", []):
        member_id = absence.get("member_id")
        absences_per_member[member_id] = absences_per_member.get(member_id, 0) + 1
    if any(count > MAX_ABSENCES_PER_MEMBER for count in absences_per_member.values()):
        raise HTTPException(
            status_code=422,
            detail={
                "error": "IMPORT_LIMIT_EXCEEDED",
                "message": f"A member holds at most {MAX_ABSENCES_PER_MEMBER} absences.",
            },
        )

    if len(team_data.get("meetings", [])) > MAX_MEETINGS_PER_TEAM:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "IMPORT_LIMIT_EXCEEDED",
                "message": f"A team holds at most {MAX_MEETINGS_PER_TEAM} meetings.",
            },
        )


def _opt_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None


def _remapped_member_id(member_id_map: dict[str, str], old_id: str | None) -> str:
    member_id = member_id_map.get(old_id) if old_id else None
    if member_id is None:
        raise HTTPException(
            status_code=422,
            detail={"error": "DANGLING_REFERENCE", "message": f"Unknown member reference: {old_id!r}"},
        )
    return member_id


def _add_members(
    db: AsyncSession, team_data: dict[str, Any], new_team_id: str, member_id_map: dict[str, str]
) -> None:
    for order_index, member in enumerate(team_data.get("members", [])):
        new_member_id = member_id_map[member["system_id"]]
        db.add(TeamMember(
            system_id=new_member_id,
            team_id=new_team_id,
            name=member["name"],
            role=member.get("role"),
            organisation=member.get("organisation"),
            active_from=_opt_date(member.get("active_from")),
            active_to=_opt_date(member.get("active_to")),
            counts_towards_capacity=member.get("counts_towards_capacity", True),
            order_index=member.get("order_index", order_index),
        ))
        for version in member.get("pattern_versions", []):
            db.add(MemberPatternVersion(
                system_id=str(uuid4()),
                member_id=new_member_id,
                effective_from=date.fromisoformat(version["effective_from"]),
                hours_per_day=version.get("hours_per_day", 8.0),
                focus=version.get("focus", 1.0),
                note=version.get("note"),
                **{field: version.get(field, True) for field in (
                    "mon_am", "mon_pm", "tue_am", "tue_pm", "wed_am", "wed_pm",
                    "thu_am", "thu_pm", "fri_am", "fri_pm",
                )},
                **{field: version.get(field, False) for field in ("sat_am", "sat_pm", "sun_am", "sun_pm")},
            ))


def _add_absences(
    db: AsyncSession, team_data: dict[str, Any], new_team_id: str, member_id_map: dict[str, str]
) -> None:
    for absence in team_data.get("absences", []):
        db.add(Absence(
            system_id=str(uuid4()),
            team_id=new_team_id,
            member_id=_remapped_member_id(member_id_map, absence.get("member_id")),
            label=absence.get("label"),
            kind=absence["kind"],
            start_date=date.fromisoformat(absence["start_date"]),
            end_date=_opt_date(absence.get("end_date")),
            start_half=absence.get("start_half"),
            end_half=absence.get("end_half"),
            weekday=absence.get("weekday"),
            halves=absence.get("halves"),
            interval_weeks=absence.get("interval_weeks"),
        ))


def _add_meetings(
    db: AsyncSession, team_data: dict[str, Any], new_team_id: str, member_id_map: dict[str, str]
) -> None:
    for order_index, meeting in enumerate(team_data.get("meetings", [])):
        new_meeting_id = str(uuid4())
        db.add(Meeting(
            system_id=new_meeting_id,
            team_id=new_team_id,
            title=meeting["title"],
            kind=meeting["kind"],
            start_date=date.fromisoformat(meeting["start_date"]),
            end_date=_opt_date(meeting.get("end_date")),
            weekday=meeting.get("weekday"),
            interval_weeks=meeting.get("interval_weeks"),
            half=meeting["half"],
            duration_minutes=meeting["duration_minutes"],
            order_index=meeting.get("order_index", order_index),
        ))
        for attendee_id in meeting.get("attendee_member_ids", []):
            db.add(MeetingAttendee(
                meeting_id=new_meeting_id,
                member_id=_remapped_member_id(member_id_map, attendee_id),
            ))


@router.post(
    "/import",
    status_code=status.HTTP_201_CREATED,
    responses={422: {"description": "Invalid or malformed import payload"}},
)
async def import_team(
    file: UploadFile,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> TeamResponse:
    raw = await file.read(_IMPORT_MAX_BYTES + 1)
    if len(raw) > _IMPORT_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail={"error": "FILE_TOO_LARGE", "message": "Import file must be ≤ 10 MB"},
        )
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=422, detail={"error": "INVALID_JSON", "message": str(exc)})

    team_data = _validate_team_import_payload(payload)
    _check_import_limits(team_data)

    existing = await db.scalar(select(func.count(Team.system_id)))
    if (existing or 0) >= MAX_TEAMS:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "TEAM_LIMIT_REACHED",
                "message": f"An instance holds at most {MAX_TEAMS} teams.",
            },
        )

    resolved_name = await _unique_team_name(db, team_data["name"])
    new_team_id = str(uuid4())
    member_id_map = {m["system_id"]: str(uuid4()) for m in team_data.get("members", [])}

    team = Team(
        system_id=new_team_id,
        name=resolved_name,
        description=team_data.get("description"),
        normal_day_hours=team_data.get("normal_day_hours", 8.0),
    )
    db.add(team)
    _add_members(db, team_data, new_team_id, member_id_map)
    _add_absences(db, team_data, new_team_id, member_id_map)
    _add_meetings(db, team_data, new_team_id, member_id_map)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "TEAM_NAME_TAKEN", "message": f"A team named '{resolved_name}' already exists"},
        )
    await db.refresh(team)
    # No SSE broadcast: brand-new team has no subscribers yet.
    return await _one_response(db, team)


@router.get("/{team_id}/export")
async def export_team(
    team_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> Response:
    team = await _get_or_404(db, team_id)

    payload = await serialize_team(db, team)

    date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    safe_name = team.name.replace(" ", "_").replace("/", "-")
    filename = f"{safe_name}_{date_str}.json"

    return JSONResponse(
        content=payload,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

"""Members and their dated working patterns (spec/teams.md §3.2, §3.3).

Two rules shape everything here, and both look like omissions until you read the
spec.

**A member is never without a pattern.** ``POST /members`` writes the member and
their first version in one transaction (§3.3): no version means no contracted
half-days, which computes as zero capacity and reads as a bug rather than as
missing data. There is no endpoint that can leave a member versionless, and
``DELETE`` of a version refuses the earliest one for the same reason.

**Nothing on the member row is dated.** ``MemberUpdate`` carries no
``hours_per_day`` and no ``focus``: changing either means dating a new version,
not overwriting a field, so they are reachable only through the working-days
routes. That is what the Members view means by showing them read-only (§7.2).

No ``require_edit_lock`` anywhere below, exactly as in ``teams.py``: these paths
carry no ``project_id`` and are outside the single-writer lock by construction
(§4.1). Concurrency is ``If-Match`` per row (§4.2).
"""

from datetime import date, datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.middleware.deps import get_current_user, require_editor_or_above
from app.models.team import Absence, MeetingAttendee, MemberPatternVersion, Team, TeamMember
from app.models.user import User
from app.schemas import (
    HALF_DAY_FIELDS,
    MAX_MEMBERS_PER_TEAM,
    MAX_PATTERN_VERSIONS_PER_MEMBER,
    MemberCreate,
    MemberReorder,
    MemberResponse,
    MemberUpdate,
    PatternVersionCreate,
    PatternVersionResponse,
    PatternVersionUpdate,
)
from app.services.concurrency import (
    IfMatch,
    OptionalIfMatch,
    check_if_match,
    etag_for,
    require_if_match_present,
    set_etag,
)
from app.services.events import broadcaster, team_channel
from app.services.team_capacity import resolve_version

router = APIRouter(prefix="/api/v1/teams/{team_id}/members", tags=["team-members"])


def _today() -> date:
    return datetime.now(timezone.utc).date()


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Lookups ───────────────────────────────────────────────────────────────────


async def _team_or_404(db: AsyncSession, team_id: str) -> Team:
    team = await db.get(Team, team_id)
    if not team:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
    return team


async def _member_or_404(db: AsyncSession, team_id: str, member_id: str) -> TeamMember:
    """A member, checked against the team in the path.

    The check is not redundant with the primary key: a member id from another
    team would otherwise be editable through any team's URL, and the 404 is what
    keeps one team's data from leaking into another's view.
    """
    await _team_or_404(db, team_id)
    member = await db.get(
        TeamMember,
        member_id,
        options=[selectinload(TeamMember.pattern_versions)],
    )
    if not member or member.team_id != team_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
    return member


async def _version_or_404(
    db: AsyncSession, member: TeamMember, version_id: str
) -> MemberPatternVersion:
    version = await db.get(MemberPatternVersion, version_id)
    if not version or version.member_id != member.system_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Pattern version not found"
        )
    return version


# ── Responses ─────────────────────────────────────────────────────────────────


def _version_response(version: MemberPatternVersion) -> PatternVersionResponse:
    return PatternVersionResponse.model_validate(version).model_copy(
        update={"etag": etag_for(version.modified_at)}
    )


async def _counts(db: AsyncSession, member_ids: list[str]) -> tuple[dict[str, int], dict[str, int]]:
    """What deleting each member would take with them (§10), in two queries."""
    if not member_ids:
        return {}, {}
    absence_rows = await db.execute(
        select(Absence.member_id, func.count(Absence.system_id))
        .where(Absence.member_id.in_(member_ids))
        .group_by(Absence.member_id)
    )
    meeting_rows = await db.execute(
        select(MeetingAttendee.member_id, func.count(MeetingAttendee.meeting_id))
        .where(MeetingAttendee.member_id.in_(member_ids))
        .group_by(MeetingAttendee.member_id)
    )
    return (
        {member_id: count for member_id, count in absence_rows.all()},
        {member_id: count for member_id, count in meeting_rows.all()},
    )


def _member_response(
    member: TeamMember,
    versions: list[MemberPatternVersion],
    as_of: date,
    absences: int,
    meetings: int,
) -> MemberResponse:
    """One member, with the version in force on *as_of*.

    ``effective_version`` is what makes one endpoint serve both views: Members
    reads it for today, Working days reads it for whatever date the picker names
    (§7.2, §7.3).
    """
    ordered = sorted(versions, key=lambda v: v.effective_from)
    effective = resolve_version(ordered, as_of) if ordered else None
    return MemberResponse.model_validate(member).model_copy(
        update={
            "etag": etag_for(member.modified_at),
            "effective_version": _version_response(effective) if effective else None,
            "version_dates": [v.effective_from for v in ordered],
            "absence_count": absences,
            "meeting_count": meetings,
        }
    )


async def _one_response(db: AsyncSession, member: TeamMember, as_of: date) -> MemberResponse:
    absences, meetings = await _counts(db, [member.system_id])
    await db.refresh(member, ["pattern_versions"])
    return _member_response(
        member,
        list(member.pattern_versions),
        as_of,
        absences.get(member.system_id, 0),
        meetings.get(member.system_id, 0),
    )


async def _list_responses(db: AsyncSession, team_id: str, as_of: date) -> list[MemberResponse]:
    result = await db.execute(
        select(TeamMember)
        .where(TeamMember.team_id == team_id)
        .options(selectinload(TeamMember.pattern_versions))
        .order_by(TeamMember.order_index.asc(), TeamMember.created_at.asc())
    )
    members = list(result.scalars().all())
    absences, meetings = await _counts(db, [m.system_id for m in members])
    return [
        _member_response(
            m,
            list(m.pattern_versions),
            as_of,
            absences.get(m.system_id, 0),
            meetings.get(m.system_id, 0),
        )
        for m in members
    ]


def _name_taken(name: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "MEMBER_NAME_TAKEN",
            "message": f"This team already has a member called '{name}'.",
        },
    )


def _apply_pattern(version: MemberPatternVersion, fields: dict[str, Any]) -> None:
    for name in (*HALF_DAY_FIELDS, "hours_per_day", "focus", "note"):
        if name in fields:
            setattr(version, name, fields[name])


AsOf = Annotated[
    date | None,
    Query(description="Show the pattern version in force on this date. Defaults to today."),
]


# ── Members ───────────────────────────────────────────────────────────────────


@router.get("")
async def list_members(
    team_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
    as_of: AsOf = None,
) -> list[MemberResponse]:
    await _team_or_404(db, team_id)
    return await _list_responses(db, team_id, as_of or _today())


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_member(
    team_id: str,
    body: MemberCreate,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> MemberResponse:
    """Create a member together with their first working pattern.

    One transaction, because the two cannot be separated (§3.3). The version's
    ``effective_from`` defaults to the member's ``active_from``, or today when
    that is blank — the date their contract starts being true.
    """
    await _team_or_404(db, team_id)

    existing = await db.scalar(
        select(func.count(TeamMember.system_id)).where(TeamMember.team_id == team_id)
    )
    if (existing or 0) >= MAX_MEMBERS_PER_TEAM:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "MEMBER_LIMIT_REACHED",
                "message": f"A team holds at most {MAX_MEMBERS_PER_TEAM} members.",
            },
        )

    highest = await db.scalar(
        select(func.max(TeamMember.order_index)).where(TeamMember.team_id == team_id)
    )
    member = TeamMember(
        team_id=team_id,
        name=body.name,
        role=body.role,
        organisation=body.organisation,
        active_from=body.active_from,
        active_to=body.active_to,
        counts_towards_capacity=body.counts_towards_capacity,
        order_index=(highest + 1) if highest is not None else 0,
    )
    db.add(member)

    pattern = body.pattern
    version = MemberPatternVersion(
        member=member,
        effective_from=pattern.effective_from or body.active_from or _today(),
        **pattern.model_dump(exclude={"effective_from"}),
    )
    db.add(version)

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _name_taken(body.name)
    await db.refresh(member)

    await broadcaster.broadcast(
        team_channel(team_id), "team:member:created", {"system_id": member.system_id}
    )
    set_etag(response, member.modified_at)
    return await _one_response(db, member, _today())


@router.post("/reorder")
async def reorder_members(
    team_id: str,
    body: MemberReorder,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> list[MemberResponse]:
    """Set the display order from a list of member ids.

    No ``If-Match``: order is not a field anyone edits in a form, and a reorder
    carries none of the values a stale write would overwrite. Ids belonging to
    another team are ignored rather than rejected — the list is a preference, and
    a partial one is still an improvement on the old order.
    """
    await _team_or_404(db, team_id)
    result = await db.execute(select(TeamMember).where(TeamMember.team_id == team_id))
    by_id = {m.system_id: m for m in result.scalars().all()}

    for index, member_id in enumerate(body.order):
        member = by_id.get(member_id)
        if member is not None:
            member.order_index = index

    await db.commit()
    await broadcaster.broadcast(team_channel(team_id), "team:member:reordered", {"team_id": team_id})
    return await _list_responses(db, team_id, _today())


@router.patch("/{member_id}")
async def update_member(
    team_id: str,
    member_id: str,
    body: MemberUpdate,
    if_match: IfMatch,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> MemberResponse:
    member = await _member_or_404(db, team_id, member_id)
    check_if_match(if_match, member.modified_at, await _one_response(db, member, _today()))

    if body.name is not None:
        member.name = body.name
    if body.counts_towards_capacity is not None:
        member.counts_towards_capacity = body.counts_towards_capacity
    for field in ("role", "organisation", "active_from", "active_to"):
        if field in body.model_fields_set:
            setattr(member, field, getattr(body, field))

    if member.active_from and member.active_to and member.active_to < member.active_from:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "error": "INVALID_VALIDITY",
                "message": "active_to cannot fall before active_from.",
            },
        )

    member.modified_at = _now()
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise _name_taken(body.name or member.name)
    await db.refresh(member)

    await broadcaster.broadcast(
        team_channel(team_id), "team:member:updated", {"system_id": member_id}
    )
    set_etag(response, member.modified_at)
    return await _one_response(db, member, _today())


@router.delete("/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_member(
    team_id: str,
    member_id: str,
    if_match: IfMatch,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> None:
    """Delete a member, and with them every absence, attendance and version.

    The cascade is the reason the response carries the counts: the confirm dialog
    states what goes before it goes (§10), and setting ``active_to`` is the
    non-destructive alternative when someone has merely left.
    """
    member = await _member_or_404(db, team_id, member_id)
    check_if_match(if_match, member.modified_at, await _one_response(db, member, _today()))

    # Loaded eagerly so the ORM cascade can run without a lazy load mid-flush.
    await db.refresh(member, ["pattern_versions", "absences", "meeting_attendances"])
    await db.delete(member)
    await db.commit()

    await broadcaster.broadcast(
        team_channel(team_id), "team:member:deleted", {"system_id": member_id}
    )


# ── Working-day pattern versions ──────────────────────────────────────────────


@router.get("/{member_id}/working-days")
async def list_pattern_versions(
    team_id: str,
    member_id: str,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(get_current_user)],
) -> list[PatternVersionResponse]:
    """Every version this member owns, ascending.

    Intervals are half-open and derived: each version holds until the day before
    the next one's ``effective_from``, and the latest holds indefinitely — which
    is why no end date is returned (§3.3).
    """
    member = await _member_or_404(db, team_id, member_id)
    versions = sorted(member.pattern_versions, key=lambda v: v.effective_from)
    return [_version_response(v) for v in versions]


@router.post("/{member_id}/working-days", status_code=status.HTTP_201_CREATED)
async def create_pattern_version(
    team_id: str,
    member_id: str,
    body: PatternVersionCreate,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    if_match: OptionalIfMatch,
    _: Annotated[User, Depends(require_editor_or_above)],
) -> PatternVersionResponse:
    """Add a version, or replace the one already on that date.

    Posting onto an existing ``effective_from`` **edits** that version rather than
    creating a duplicate (§3.3) — one date, one version, so a gap or an overlap
    cannot be expressed. The body carries the whole pattern, so this is a
    replacement and not a merge: there is no half of someone else's edit for it to
    keep by accident.

    Which makes that branch a full overwrite of a row someone else may have moved,
    so it carries the same ``If-Match`` contract as the equivalent ``PATCH``
    (§4.2): without the header it is **428**, against a stale one **412**. Only
    the create branch may go without, because there is no ETag to quote for a
    version that does not exist yet.
    """
    member = await _member_or_404(db, team_id, member_id)
    fields = body.model_dump(exclude={"effective_from"})

    existing = next(
        (v for v in member.pattern_versions if v.effective_from == body.effective_from), None
    )
    if existing is not None:
        check_if_match(
            require_if_match_present(
                if_match,
                f"A working-pattern version already starts on {body.effective_from}. "
                "Posting onto it replaces it, so this write must carry the If-Match "
                "header from that version's last read.",
            ),
            existing.modified_at,
            _version_response(existing),
        )
        _apply_pattern(existing, fields)
        existing.modified_at = _now()
        version = existing
    else:
        if len(member.pattern_versions) >= MAX_PATTERN_VERSIONS_PER_MEMBER:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "PATTERN_VERSION_LIMIT_REACHED",
                    "message": (
                        f"A member holds at most {MAX_PATTERN_VERSIONS_PER_MEMBER} "
                        "working-pattern versions."
                    ),
                },
            )
        version = MemberPatternVersion(effective_from=body.effective_from, **fields)
        # Appended through the relationship rather than added to the session, so
        # the member's loaded collection and the database agree straight away —
        # the very next read of this member goes through that collection.
        member.pattern_versions.append(version)

    await db.commit()
    await db.refresh(version)

    await broadcaster.broadcast(
        team_channel(team_id),
        "team:member:pattern:changed",
        {"member_id": member_id, "system_id": version.system_id},
    )
    set_etag(response, version.modified_at)
    return _version_response(version)


@router.patch("/{member_id}/working-days/{version_id}")
async def update_pattern_version(
    team_id: str,
    member_id: str,
    version_id: str,
    body: PatternVersionUpdate,
    if_match: IfMatch,
    response: Response,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> PatternVersionResponse:
    member = await _member_or_404(db, team_id, member_id)
    version = await _version_or_404(db, member, version_id)
    check_if_match(if_match, version.modified_at, _version_response(version))

    _apply_pattern(version, body.model_dump(exclude_unset=True, exclude={"effective_from"}))
    if body.effective_from is not None:
        version.effective_from = body.effective_from
    version.modified_at = _now()

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "PATTERN_VERSION_DATE_TAKEN",
                "message": "This member already has a version effective from that date.",
            },
        )
    await db.refresh(version)

    await broadcaster.broadcast(
        team_channel(team_id),
        "team:member:pattern:changed",
        {"member_id": member_id, "system_id": version_id},
    )
    set_etag(response, version.modified_at)
    return _version_response(version)


@router.delete("/{member_id}/working-days/{version_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_pattern_version(
    team_id: str,
    member_id: str,
    version_id: str,
    if_match: IfMatch,
    db: Annotated[AsyncSession, Depends(get_session)],
    _: Annotated[User, Depends(require_editor_or_above)],
) -> None:
    """Delete a version; its interval merges into the preceding one.

    The merge needs no work because intervals are derived — with the row gone, the
    version before it simply holds until the next one. The **earliest cannot be
    deleted**: something has to define the beginning, and every date before the
    first ``effective_from`` resolves to it (§3.3).
    """
    member = await _member_or_404(db, team_id, member_id)
    version = await _version_or_404(db, member, version_id)
    check_if_match(if_match, version.modified_at, _version_response(version))

    earliest = min(member.pattern_versions, key=lambda v: v.effective_from)
    if earliest.system_id == version_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "EARLIEST_VERSION_NOT_DELETABLE",
                "message": (
                    "The earliest working-pattern version defines where this member's "
                    "history begins and cannot be deleted. Change its date or its values "
                    "instead."
                ),
            },
        )

    # Removed from the collection rather than deleted through the session: the
    # delete-orphan cascade does the delete, and the member is left holding the
    # versions that actually exist.
    member.pattern_versions.remove(version)
    await db.commit()

    await broadcaster.broadcast(
        team_channel(team_id),
        "team:member:pattern:changed",
        {"member_id": member_id, "system_id": version_id},
    )

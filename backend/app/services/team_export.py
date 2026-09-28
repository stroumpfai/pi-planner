from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import Absence, Meeting, MeetingAttendee, MemberPatternVersion, Team, TeamMember

_HALF_DAY_FIELDS = (
    "mon_am", "mon_pm", "tue_am", "tue_pm", "wed_am", "wed_pm", "thu_am", "thu_pm",
    "fri_am", "fri_pm", "sat_am", "sat_pm", "sun_am", "sun_pm",
)


def _opt_iso(value: Any) -> str | None:
    return value.isoformat() if value else None


async def serialize_team(db: AsyncSession, team: Team) -> dict[str, Any]:
    """Build the export-format payload for a team.

    Deliberately excludes ``TeamProject`` assignments: they reference project ids
    that may not exist in whatever instance this file is later imported into, and
    re-assigning a team to a project is a separate, existing action.
    """
    team_id = team.system_id

    members_result = await db.execute(
        select(TeamMember).where(TeamMember.team_id == team_id).order_by(TeamMember.order_index)
    )
    members = members_result.scalars().all()

    absences_result = await db.execute(
        select(Absence).where(Absence.team_id == team_id).order_by(Absence.start_date)
    )
    absences = absences_result.scalars().all()

    meetings_result = await db.execute(
        select(Meeting).where(Meeting.team_id == team_id).order_by(Meeting.order_index)
    )
    meetings = meetings_result.scalars().all()

    member_data = []
    for m in members:
        versions_result = await db.execute(
            select(MemberPatternVersion)
            .where(MemberPatternVersion.member_id == m.system_id)
            .order_by(MemberPatternVersion.effective_from)
        )
        versions = versions_result.scalars().all()
        member_data.append({
            "system_id": m.system_id,
            "name": m.name,
            "role": m.role,
            "organisation": m.organisation,
            "active_from": _opt_iso(m.active_from),
            "active_to": _opt_iso(m.active_to),
            "counts_towards_capacity": m.counts_towards_capacity,
            "order_index": m.order_index,
            "created_at": m.created_at.isoformat(),
            "modified_at": m.modified_at.isoformat(),
            "pattern_versions": [
                {
                    "system_id": v.system_id,
                    "effective_from": v.effective_from.isoformat(),
                    **{field: getattr(v, field) for field in _HALF_DAY_FIELDS},
                    "hours_per_day": v.hours_per_day,
                    "focus": v.focus,
                    "note": v.note,
                    "created_at": v.created_at.isoformat(),
                    "modified_at": v.modified_at.isoformat(),
                }
                for v in versions
            ],
        })

    absence_data = [
        {
            "system_id": a.system_id,
            "member_id": a.member_id,
            "label": a.label,
            "kind": a.kind,
            "start_date": a.start_date.isoformat(),
            "end_date": _opt_iso(a.end_date),
            "start_half": a.start_half,
            "end_half": a.end_half,
            "weekday": a.weekday,
            "halves": a.halves,
            "interval_weeks": a.interval_weeks,
            "created_at": a.created_at.isoformat(),
            "modified_at": a.modified_at.isoformat(),
        }
        for a in absences
    ]

    meeting_data = []
    for meeting in meetings:
        attendees_result = await db.execute(
            select(MeetingAttendee.member_id).where(MeetingAttendee.meeting_id == meeting.system_id)
        )
        meeting_data.append({
            "system_id": meeting.system_id,
            "title": meeting.title,
            "kind": meeting.kind,
            "start_date": meeting.start_date.isoformat(),
            "end_date": _opt_iso(meeting.end_date),
            "weekday": meeting.weekday,
            "interval_weeks": meeting.interval_weeks,
            "half": meeting.half,
            "duration_minutes": meeting.duration_minutes,
            "order_index": meeting.order_index,
            "created_at": meeting.created_at.isoformat(),
            "modified_at": meeting.modified_at.isoformat(),
            "attendee_member_ids": list(attendees_result.scalars().all()),
        })

    return {
        "version": "1.0",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "team": {
            "system_id": team.system_id,
            "name": team.name,
            "description": team.description,
            "normal_day_hours": team.normal_day_hours,
            "created_at": team.created_at.isoformat(),
            "modified_at": team.modified_at.isoformat(),
            "members": member_data,
            "absences": absence_data,
            "meetings": meeting_data,
        },
    }

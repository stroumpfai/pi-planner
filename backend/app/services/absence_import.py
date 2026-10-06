"""Planning an ``.ics`` import against what the team already holds (teams.md §7.4.1).

`absence_ics.py` reads the file; this decides what it *does* to the stored rows.
The preview and the apply both start here, from the same file and window, so
the rows a user ticked are the rows the server re-derives.

**Re-import is an upsert on ``(member_id, source_uid)``** (ADR 0011). A moved
event updates its row; an identical one writes nothing; an event gone from the
file is *proposed* for removal. Hand-entered rows carry no ``source_uid`` and
are never looked at.

**Removals are fenced twice.** Only rows anchored inside the window, so an
Outlook export of "the next three months" leaves older imports alone; and only
rows of members this import involves, so importing Anna's file never deletes
Ben's. The preview lists them, and the apply deletes only those the user kept
ticked.
"""

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.team import Absence, TeamMember
from app.schemas.absence import AbsenceImportCandidate, ImportAction, ImportMatch
from app.services.absence_ics import (
    AbsenceEvent,
    ParsedAbsenceIcs,
    default_years,
    match_members,
    parse_absence_ics,
)
from app.services.absences import fields_of, response_for, rule_key
from app.services.occurrences import ScheduleRule, describe


class MemberNotOnTeam(LookupError):
    def __init__(self, member_ids: list[str]) -> None:
        super().__init__("Some of those members are not on this team.")
        self.member_ids = member_ids


@dataclass
class ImportPlan:
    parsed: ParsedAbsenceIcs
    window: tuple[date, date] | None
    candidates: list[AbsenceImportCandidate] = field(default_factory=list)
    removals: list[Absence] = field(default_factory=list)
    # (member_id, source_uid) → the row an import of that pair would update.
    existing: dict[tuple[str, str], Absence] = field(default_factory=dict)

    @property
    def events_by_uid(self) -> dict[str, AbsenceEvent]:
        return {event.source_uid: event for event in self.parsed.events}


def _years(window: tuple[date, date]) -> range:
    return range(window[0].year, window[1].year + 1)


def _parse_for_window(
    content: bytes, window: tuple[date, date] | None
) -> tuple[ParsedAbsenceIcs, tuple[date, date] | None]:
    """The file read over the window that will be used, and that window.

    With no window named, the default is the span of the file's dated events;
    yearly rules are then expanded over *that* window's years. The preview hands
    the window back and the apply sends it again, so both expand the same years
    and see the same rows.
    """
    if window is not None:
        return parse_absence_ics(content, years=_years(window)), window
    parsed = parse_absence_ics(content)
    derived = parsed.span
    if derived is None and parsed.events:
        # Nothing but yearly rules: the years they were expanded over.
        years = default_years()
        derived = (date(years.start, 1, 1), date(years.stop - 1, 12, 31))
    if derived is not None and _years(derived) != default_years():
        parsed = parse_absence_ics(content, years=_years(derived))
    return parsed, derived


def _summary(event: AbsenceEvent) -> str:
    rule = event.rule
    return describe(ScheduleRule(
        kind=rule.kind, start_date=rule.start_date, end_date=rule.end_date,
        start_half=rule.start_half, end_half=rule.end_half, weekday=rule.weekday,
        halves=tuple(rule.halves or ("am", "pm")), interval_weeks=rule.interval_weeks,
    ))


def _candidate(
    event: AbsenceEvent,
    how: ImportMatch,
    member_id: str | None,
    row: Absence | None,
) -> AbsenceImportCandidate:
    return AbsenceImportCandidate(
        source_uid=event.source_uid,
        title=event.title,
        rule=event.rule,
        rule_summary=_summary(event),
        member_id=member_id,
        match=how,
        selected_by_default=event.selected_by_default,
        hint=event.hint,
        action=action_for(row, event) if member_id is not None else None,
        previous=response_for(row) if row is not None else None,
    )


def action_for(existing: Absence | None, event: AbsenceEvent) -> ImportAction:
    if existing is None:
        return "create"
    return "unchanged" if rule_key(fields_of(existing)) == rule_key(event.rule) else "update"


async def plan_import(
    db: AsyncSession,
    team_id: str,
    content: bytes,
    *,
    member_id: str | None,
    window: tuple[date, date] | None,
    also_involved: set[str] | None = None,
) -> ImportPlan:
    """What the file would do to this team's absences.

    ``member_id`` names the one member a personal file belongs to; without it
    each event is matched to members by name. ``also_involved`` widens the
    members removals are looked for among — the apply passes the members the
    user assigned by hand, so the removal set can only grow from the preview's.

    Raises ``ValueError`` for a file it can't read and ``MemberNotOnTeam``.
    """
    parsed, used_window = _parse_for_window(content, window)
    members = list((await db.execute(
        select(TeamMember).where(TeamMember.team_id == team_id).order_by(TeamMember.order_index)
    )).scalars().all())
    member_ids = {member.system_id for member in members}
    if member_id is not None and member_id not in member_ids:
        raise MemberNotOnTeam([member_id])

    imported = (await db.execute(
        select(Absence).where(Absence.team_id == team_id, Absence.source_uid.is_not(None))
    )).scalars().all()
    plan = ImportPlan(
        parsed=parsed,
        window=used_window,
        existing={(row.member_id, row.source_uid or ""): row for row in imported},
    )

    named = [(member.system_id, member.name) for member in members]
    involved: set[str] = set(also_involved or ())
    for event in parsed.events:
        matched: list[str]
        how: ImportMatch
        if member_id is not None:
            matched, how = [member_id], "picked"
        else:
            matched, how = match_members(event, named)
        involved.update(matched)
        if not matched:
            # Offered with its tick but no member: the dialog will not import a
            # ticked row until one is picked, and MCP refuses it unassigned.
            plan.candidates.append(_candidate(event, how, None, None))
            continue
        for matched_id in matched:
            row = plan.existing.get((matched_id, event.source_uid))
            plan.candidates.append(_candidate(event, how, matched_id, row))

    if used_window is not None:
        in_file = {event.source_uid for event in parsed.events}
        first, last = used_window
        plan.removals = sorted(
            (
                row for row in imported
                if row.member_id in involved
                and row.source_uid not in in_file
                and first <= row.start_date <= last
            ),
            key=lambda row: (row.start_date, row.member_id),
        )
    return plan

# Meetings can follow the sprint calendar

A meeting can be placed by the team's sprints instead of by the week. **`kind = sprint`** puts a meeting on a named working day of every sprint: the first day for planning, the last for review and retro, or a few working days in from either. **`skip_sprint_days`** on a weekly or interval meeting drops the occurrences that land on a sprint's first day, last day, or both. "Refinement every Thursday, except at the sprint change" is one weekly rule. Both read the anchor project's dated sprints, the same calendar the Capacity view uses (`spec/teams.md` §3.5, §7.0.1).

## Why

A user asked for a meeting that recurs weekly except when the sprint changes, and the concern was cost. If both refinement and the sprint ceremonies are entered on that Thursday, capacity charges both, because meetings on the same day add up (§5.4). The only way out was an `interval` rule every two weeks starting on the other Thursday. That works only while every sprint is two weeks long. An IP sprint, a three-week sprint or a shifted PI boundary makes the rule drift without warning. Ceremonies entered as `interval` rules drift the same way.

## Considered options

**Per-occurrence exceptions.** `spec/teams.md` §3.4 rejected these: they would need their own storage, `If-Match` conflicts, closed-PI rules and display. They also don't follow the calendar, so each moved sprint means editing the exceptions again.

**A "replaces" link between meetings** (the ceremony suppresses refinement on days both occur). More general, but it is a link that has to be cleaned up on delete (there is no `PRAGMA foreign_keys`, see ADR 0009), and the case that exists is the sprint change.

**Clock times, with overlapping time counted once.** This changes what "two meetings booked at once" costs. It doesn't cover the case asked for, where refinement is simply not held and isn't necessarily at the same hour.

**A sprint kind and a sprint-day skip.** Chosen. Both are rules derived from data the team already keeps, so they stay correct when sprint lengths vary or dates move.

## Consequences

- **The meeting readers take the calendar.** `meetings.response_for`, `occurrences_of` and `build_lookup` all take a `SprintCalendar`, loaded by `load_sprint_calendar` from the anchor project. The Meetings list, the Capacity view and the push use the same days. `response_for` requires the calendar so that a caller can't forget it and silently un-skip.
- **Working days only.** Sprint days count Monday to Friday (`services/sprint_days.py`). A sprint stored as ending on a Sunday ends on the Friday, and offsets skip the weekend.
- **Editing sprint dates changes meeting cost.** This is the point. Past figures are restated like any other team change, and a derived Available reads stale until it is pushed.
- **No calendar, no sprint days.** A team with no project, or no dated sprint, gets no `sprint` occurrences and no skips. This is the same rule §7.0.1 applies to undated sprints: unknown, not invented.
- **Stored only where read.** The route clears `skip_sprint_days` on `range` and `sprint` meetings, and clears the sprint fields on the other kinds. Switching kind can't leave a stale value behind.
- **Visible skips.** A response lists `skipped` dates beside `occurrences`, and the summary says "except at the sprint change". The column head shows the skipped days inside the selected sprint.
- **MCP.** `create_meeting`, `update_meeting` and `bulk_create_meetings` take `sprint_day`, `sprint_offset` and `skip_sprint_days`. `list_meetings` returns them along with `skipped`.
- **Downgrade drops sprint meetings.** They have no weekly shape to fall back to.

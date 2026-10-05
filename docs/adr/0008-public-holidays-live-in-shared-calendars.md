# Public holidays live in shared calendars that each team enables, not in per-member absences

Public holidays are entries in **holiday calendars**, which are shared across the whole app and belong to no team or project, for example "Switzerland — national", "Canton Zurich" or "Company shutdowns". A team enables any number of them, in the way an Outlook user adds a shared calendar to their view. The enabled calendars' entries remove capacity exactly as an absence does. Where a member works on a holiday (on call), a per-member, per-day exception cancels it for that member. The full design is in `spec/public-holidays.md`.

This replaces the rule in `spec/teams.md` §3.4 that a public holiday is an absence entered once with every member selected, and that there is "no holiday entity".

## Why

The per-member rule was written for one team. With several teams it means entering every holiday once per team, so ten teams make ten copies of Christmas, two hundred rows that drift apart. Members who join later have none of them. A holiday also can't be told apart from someone's leave, in the Absences view or in the capacity breakdown. All the teams observe the same few calendars, so the calendar is the thing to share, and the team only says which ones apply.

## Considered options

**A `category` on each absence**, with holidays still copied to every member. This was drafted first. It fixes the display, but it keeps one copy per team and per member, so it doesn't solve sharing across teams.

**Enabling calendars per member**, for people in different regions. Deferred. No team spans regions today, and switching per team is simpler to understand.

**A yearly recurrence on entries.** Rejected. Many holidays move from year to year (Easter, Ascension, Whit Monday), and a recurrence brings back the "edit this occurrence or the series" problem that §3.4 avoids. Entries are dated, and a "copy year" helper with a manual review stands in for the recurrence.

**A live subscription to an external calendar URL.** Rejected for now. It needs outbound network access, and an outside party could change capacity figures without anyone in the app noticing. `.ics` import covers the Outlook use case.

**A dated "enabled from" on the team's switch.** Rejected for simplicity. The switch is undated, like `counts_towards_capacity` (ADR 0005).

## Consequences

- **History moves.** Enabling, disabling or editing a calendar changes capacity for every sprint it touches, closed ones included, and through that the Achievement figures. The UI warns before enabling or disabling, and the entry dialog names the teams an edit affects. Sprint Available is never rewritten: a derived project's figure reads stale until someone pushes.
- **The engine is unchanged.** Holidays join the same `(member, day, half)` set as absences, so overlaps count once. `holiday_half_days` reports the holiday share, and where a holiday overlaps leave the half counts as a holiday.
- **Holidays already entered as everyone-absences stay** until a planner removes them with an opt-in cleanup. That cleanup matches by date and never deletes anything without a tick. Meanwhile they cost nothing extra.
- **The team JSON export moves to `1.1`** and carries the enabled calendars by name, with their entries. On import, an existing calendar of the same name wins and is never edited, and creating a missing one needs explicit consent, because a team import must not change data other teams share.
- **Calendars are app-wide data with no edit lock.** Concurrency is the per-row `If-Match` used for teams, and a new app-wide SSE channel keeps the Calendars page live.
- **Deleting a calendar stays a UI action.** It is a container on the "leaves yes, containers no" line (`spec/teams.md` §8.2.6), so MCP gets `delete_holiday_entry` but no `delete_holiday_calendar`.

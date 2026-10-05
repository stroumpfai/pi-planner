# Shared Holiday Calendars — Specification

> Status: draft for review (2026-10-05). Amends `spec/teams.md`: §3.4 (absences, which says
> public holidays are absences entered for every member), §5.4 (the capacity computation),
> §7.4 (the Absences view) and §7.6 (the Capacity view). References written "teams.md §3.4"
> point into that document; bare "§" references point inside this one. The decision to move
> holidays out of absences is recorded in
> `docs/adr/0008-public-holidays-live-in-shared-calendars.md`.

## 1. Problem

Today a public holiday is an absence entered once with every member ticked, which creates one
row per member (teams.md §3.4). That worked for one team. It doesn't work for several:

- **Every team re-enters the same holidays.** Ten teams entering Christmas means ten
  selections and two hundred rows, and they drift apart when one team forgets Whit Monday.
- **A member who joins later has none of them**, unless someone remembers to add each one.
- **A holiday can't be told apart from leave.** In the Absences view, Christmas looks like
  someone's day off. In the capacity breakdown, a sprint that lost two days to Easter reads
  like one where someone took two days off.

People already handle this in Outlook: the holidays live in a shared calendar, and each person
adds it to their view. This specification does the same for teams.

## 2. Scope

**In scope:**
- **Holiday calendars** shared across the whole app, with dated entries.
- **Per-team enabling**: a team turns calendars on or off, and may use several.
- **Per-member exceptions** for whoever works on a holiday.
- Holidays in the capacity computation, shown separately in the Absences view, the Capacity
  view, the PI board's sprint headers and the PI Team report.
- Three ways to fill a calendar: by hand, by `.ics` import, and by an MCP bulk replace.
- `.ics` export.
- Calendars in the team JSON export/import.
- A one-off cleanup of old everyone-absences that a calendar now covers.

**Not in scope:**
- Enabling calendars per member or per region. Switching is per team, by decision.
- A live subscription to an external calendar URL (webcal). It would need outbound network
  access, and it would let a third party change capacity unnoticed.
- A yearly recurrence on entries. Entries are dated (§3.2), and "copy year" (§6.3) is the
  helper.
- Holidays on the PNG/PDF roadmap export.
- A dated "enabled from" on the team switch. The switch is undated, by decision (§3.4).

---

## 3. Data Model

Four new tables. None of them adds a column to an existing table.

### 3.1 `holiday_calendars`

| Field | Rule |
|---|---|
| `system_id` | UUID |
| `name` | Required, max 100 chars, **unique across the app** (compared trimmed, ignoring case). Team import matches calendars by name (§8.2), so the name is the calendar's identity outside the database |
| `description` | Optional, max 500 chars, e.g. "Federal holidays; cantonal ones are in Canton Zurich" |
| `created_at`, `modified_at` | `modified_at` is the `If-Match` concurrency token, as for every team-owned row (teams.md §4.2) |

A calendar belongs to no team and no project. Every authenticated user can read every calendar.
Admins and editors can create, edit and delete calendars and their entries; readers cannot.

### 3.2 `holiday_entries`

| Field | Rule |
|---|---|
| `system_id` | UUID |
| `calendar_id` | FK, `ON DELETE CASCADE` |
| `label` | Required, max 100 chars ("Christmas Day", "Office shutdown") |
| `start_date` + `start_half` | First day and the half it opens on (`am`/`pm`, default `am`) |
| `end_date` + `end_half` | Last day, inclusive, and the half it closes on (default: `start_date`, `pm`) |
| `modified_at` | `If-Match` token |

**An entry is always a dated range.** It uses the same shape as a `range` absence
(teams.md §3.4), so one day, several days and half a day are all expressible:

| Holiday | Entry |
|---|---|
| Christmas Day | 25 Dec am → 25 Dec pm |
| Christmas Eve afternoon | 24 Dec pm → 24 Dec pm |
| Good Friday to Easter Monday | One entry over four days; the weekend in between costs nothing |
| Shutdown between the years | One entry |

There is **no recurrence**:

- Holidays are dates, not weekly patterns.
- Many of them move from year to year (Easter, Ascension, Whit Monday).
- A yearly rule would bring back the "edit this occurrence or the series" problem that
  teams.md §3.4 deliberately avoids.

Each year's holidays are therefore separate entries. Copy year (§6.3) and `.ics` import (§7.1)
make entering them cheap.

Entries may overlap within a calendar and across calendars. Overlaps union: a half-day covered
twice costs one half-day, the same rule as for absences.

### 3.3 `team_holiday_calendars`: the team's switch

| Field | Rule |
|---|---|
| `team_id`, `calendar_id` | Composite primary key; both `ON DELETE CASCADE` |
| `created_at` | When it was enabled; display only |

A row exists exactly when the calendar is **enabled** for the team, so disabling deletes the
row. A team may enable any number of calendars, and they combine: a half that is a holiday in
any enabled calendar is a holiday for the team.

### 3.4 The switch is undated, and history moves

Capacity is computed whenever it is read (teams.md §5). Enabling, disabling or editing a
calendar therefore changes the team's capacity for **every** sprint it touches, closed ones
included, and through that the Achievement view's *PD given*, *Velocity* and *Realised* for
past sprints.

This is accepted, by decision, and for the same reason ADR 0005 accepts it for
`counts_towards_capacity`: the switch says what the team observes, not a contract term that
changes on a date. Three things limit the effect:

- **Sprint Available is never rewritten.** It changes only through an explicit push
  (teams.md §6.7), and sprints of closed PIs are never written. A calendar change instead
  makes a derived project's Available **stale**, and the existing staleness badge shows it,
  because staleness is computed by comparing values.
- **Enabling or disabling warns first.** The confirmation reads: *"This changes capacity for
  every sprint of this team, including closed ones."*
- **Editing an entry in a calendar that teams use** shows, in the entry dialog, which teams it
  affects: *"Used by 4 teams: Alpha, Beta, …"*.

### 3.5 `holiday_exceptions`: "works this holiday"

| Field | Rule |
|---|---|
| `system_id` | UUID |
| `member_id` | FK to `team_members`, `ON DELETE CASCADE` |
| `entry_id` | FK to `holiday_entries`, `ON DELETE CASCADE` |
| `day` | One date inside the entry's range |
| Unique | `(member_id, entry_id, day)` |

An exception says that this member works this day of this holiday, so the holiday removes
nothing from them on that day. It covers a **whole day** of the entry, because the gesture is a
click on the member's cell for that day (§5.3). A five-day shutdown with one on-call day is one
exception, not five.

- **Exceptions belong to the member.** If the team disables the calendar, its exceptions stay
  stored and inactive, and they apply again if the calendar is re-enabled. Nobody loses the
  on-call record by toggling a switch.
- **Deleting the entry deletes its exceptions.** Changing the entry's dates deletes any
  exception whose `day` falls outside the new range, and the entry dialog says how many before
  saving.

### 3.6 Deleting a calendar

Deletion is permanent, as everywhere in the app. Deleting a calendar removes it from every team
that enabled it, together with its entries and their exceptions. The confirmation names the
teams and states the effect: *"Used by Alpha, Beta. Their capacity will rise for every sprint
that had one of these holidays."*

### 3.7 Limits

These are sanity limits in the style of teams.md §9:

| | Limit |
|---|---|
| Calendars | 200 per app |
| Entries per calendar | 2,000 |
| Calendars enabled per team | 20 |

### 3.8 Migration

One Alembic revision creates the four tables. Nothing existing is altered or back-filled: the
holidays entered as everyone-absences stay absences until someone cleans them up (§6.4).

---

## 4. Capacity

### 4.1 One more input to the same seam

The engine already removes absences through one seam: a set of `(member, day, half)` built per
window by `build_lookup` (`services/absences.py`), which is what makes overlapping absences a
union (teams.md §5.4, step 2). Holidays join the **same set**:

```
covered(member) = absence halves(member)
                ∪ { (d, h) of every entry in the team's enabled calendars }
                − { both halves of (d) for every exception of member on that entry }
```

Everything downstream is unchanged. The member must owe the half under their pattern version;
the member's active dates still apply; and meetings, focus, PD, shares, Available and the push
see one number, as before. The engine stays pure: the report layer loads the entries and
exceptions and hands the engine a set.

**An exception cancels only the holiday.** A member on call on 1 August who also booked that
afternoon off still loses the afternoon, to the absence.

### 4.2 Holidays reported separately

`CapacityBreakdown` keeps `absent_half_days` and gains a subset:

| Field | Meaning |
|---|---|
| `absent_half_days` | **Meaning unchanged:** every contracted half-day removed. It now includes holidays |
| `holiday_half_days` | **New:** the subset removed by a holiday |

**The holiday takes precedence.** Where a holiday and leave cover the same half, it counts
once, as a holiday. The day was not the member's to take off, and their leave on it is not
leave spent. Leave is therefore `absent_half_days − holiday_half_days`.

Keeping `absent_half_days` as the total means every existing reader (API, MCP, the minimap)
stays correct without change.

---

## 5. The Team's Views

### 5.1 Choosing calendars, Outlook-style

At the top of the **Absences** view there is a **Holiday calendars** panel. It lists every
calendar with a checkbox, in the way Outlook's sidebar lists shared calendars. Ticking enables
the calendar for the team, after the history warning (§3.4). Each line shows the calendar's
name, how many of its entries fall in the visible months, and a link to the calendar's page.

Admins and editors can tick; readers see the ticks read-only. The panel doesn't take a lock:
team writes never do (teams.md §4.1).

### 5.2 The holiday strip

Above the member rows there is one strip, **Public holidays**, with the same day columns and
half-day split as a member row. It shows the entries of the enabled calendars that fall in the
window, each labelled with its `label`, and the calendar's name on hover.

- **Two entries on one day** (one calendar's "Christmas Day" and another's "Office shutdown")
  stack in the strip.
- **Exceptions are visible.** An entry with exceptions reads, for example, *"Christmas Day:
  18 of 20 members (Ana, Ben work)"*.
- **No holidays in the window:** the strip collapses to one line, *"No public holidays in these
  months"*. When **no calendar is enabled**, that line says so instead and links to the panel
  (§5.1).

### 5.3 Member cells

`CellState` (`frontend/src/utils/absenceGrid.ts`) gains two states:

| State | Meaning | Precedence |
|---|---|---|
| `holiday` | An enabled calendar's entry covers the half, and the member has no exception for that day | Above `absence` and `recurring` |
| `works-holiday` | An entry covers the half, but the member has an exception | Drawn as a free cell with a holiday outline, so the correction stays visible |

Every existing state is unchanged. Each new state gets a colour token pair for both themes and
a place in the legend, so the legend becomes **public holiday, works holiday, absence,
recurring, not working, weekend**.

**Clicking a `holiday` cell** opens a small popover: the entry's label and calendar, and a
**Works this day** toggle that creates or deletes the exception (§3.5). Admins and editors see
the toggle; readers see the popover only. A drag across holiday cells still creates an absence,
as today. The absence is stored, but it costs nothing on that half while the holiday applies.

### 5.4 The Capacity view

- **The cell breakdown** (`CapacityCell`) replaces its single absences line with two, leaving
  out either one when it is zero: *"− public holidays (n half-days)"* and *"− leave (n
  half-days)"*.
- **The minimap's month bars** get two segments: person-days lost to holidays at the bottom,
  and everything else (leave and meetings) above it. The total height is unchanged
  (teams.md §7.6).

---

## 6. The Calendars Page

### 6.1 Where it lives

The **Calendars** page is a new top-level destination, beside Teams in the project list's
navigation, using a `uiStore` flag in the same way as `activeTeamId`. There is no URL routing
(CLAUDE.md).

- **The list** shows each calendar's name, description, number of entries, the years it covers,
  and the teams using it.
- **Actions:** New calendar, Import `.ics` (§7.1), and per calendar Open, Export `.ics` (§7.2)
  and Delete (§3.6).

### 6.2 One calendar

The page has a year selector and the year's entries as a list, sorted by date. Each row shows
the date range (with halves), the weekday, the label, and the number of exceptions across all
teams.

- **Add** and **edit** entries in a dialog with the `DateInput` dates, the half selectors and a
  label. The dialog names the teams the change affects (§3.4).
- **Delete** an entry, confirming the number of exceptions it takes with it.
- **The header** carries the name and description, editable in place, and the teams using the
  calendar.

### 6.3 Copy year

**Copy {year} to {year + 1}** opens a preview listing every entry of the source year with a
proposed date one year later. **Nothing is inferred** about which holidays move. Each row shows
the proposed date and weekday, and the planner corrects the dates of the moving ones (Easter,
Ascension, Whit Monday) or unticks rows before confirming. The preview **flags** a proposed
date that lands on a weekend, since that is where a fixed-date holiday most often needs a
second look.

The copy creates new, independent entries. Exceptions are never copied: being on call this
Christmas says nothing about next Christmas.

### 6.4 Cleaning up old everyone-absences

Holidays entered before this feature are per-member absences. Once a team enables a calendar
that covers the same days, the grid already draws those days as holidays (§5.3) and capacity
counts them once (§4.1). The old absences are harmless duplicates underneath, and the view does
not show them.

A one-off **Clean up duplicates** action in the Absences view's calendar panel lists candidates.
A candidate is a `range` absence held by **two or more** members whose every covered half is
also a holiday of an enabled calendar. Candidates are grouped by date and label, with the
members holding them, and the planner ticks the groups to delete. Nothing is pre-ticked, and
nothing is deleted without the tick.

This matches dates, not words. The label is shown to help the planner decide, but it never
decides anything (ADR 0006's rule).

---

## 7. Filling and Exporting a Calendar

### 7.1 `.ics` import

`POST /api/v1/holiday-calendars/{id}/import/ics` takes a file upload and `dry_run`. A new
calendar is created first and then imported into, so the endpoint always has a target.

| In the file | Becomes |
|---|---|
| All-day `VEVENT` (`DTSTART;VALUE=DATE`) | One entry over its days. `DTEND` is **exclusive** in iCalendar and is converted to the inclusive `end_date` |
| Timed `VEVENT` | One entry. The start half is `am` if `DTSTART` is before 12:00, else `pm`. The end half is `am` if `DTEND` is at or before 12:00, else `pm`. This is how Outlook stores "Christmas Eve afternoon" |
| An entry exported by this app (§7.2) | Its `X-PIPLANNER-START-HALF` / `X-PIPLANNER-END-HALF` are read in preference to the clock times, so a round trip is exact |
| `RRULE:FREQ=YEARLY` (with or without `BYMONTH`/`BYMONTHDAY`, `COUNT`, `UNTIL`) | **Expanded into dated entries** over the years the dialog asks for (default: this year and next). Entries are dated (§3.2), so the rule itself is never stored |
| Any other `RRULE`, an `EXDATE` the expansion can't honour, a `VTODO`/`VJOURNAL` | Skipped, and listed in the preview with the reason |
| `SUMMARY` | The `label`, truncated to 100 chars with a warning |
| Time zones | The date as written in the event's own zone. Same reasoning as the CSV importer (team-achievement.md §4.3): a holiday is a date, and inventing a zone would only move it |

- **Merging, not replacing:** an event identical to an existing entry (same dates, halves and
  label, compared ignoring case) is skipped and counted as a duplicate. Re-importing the same
  file therefore changes nothing. Replacing a year is the bulk path's job (§7.3).
- **The preview** (a dry run, rolled back) lists what would be created, skipped as duplicate,
  and skipped with a reason. Confirm runs the same request without `dry_run`. Nothing is
  half-imported.
- **Parsing is server-side**, so the MCP tools and the UI share one parser. It uses the
  `icalendar` package (pure Python, small; a new runtime dependency) for the file format.
  Yearly expansion is our own code, limited to the rules in the table above.

### 7.2 `.ics` export

`GET /api/v1/holiday-calendars/{id}/export/ics` returns one `VCALENDAR` with `X-WR-CALNAME`
set to the calendar's name and one `VEVENT` per entry.

- **Full-day entries** are all-day events, so Outlook and Google show them as holidays.
- **Entries starting or ending on a half day** are timed events, 08:00–12:00 for a morning and
  13:00–17:00 for an afternoon, and carry the two `X-PIPLANNER-*-HALF` properties for exact
  re-import.
- Each `UID` is stable (`{entry system_id}@piplanner`), so re-importing the export into Outlook
  updates events instead of duplicating them.
- Exceptions are never exported. They are team data.

### 7.3 Bulk replace (MCP and API)

`PUT /api/v1/holiday-calendars/{id}/entries` replaces every entry whose `start_date` lies in
`[window_from, window_to]` with the given list, in one transaction, with `dry_run` support.
This is the same contract as the absence bulk import (teams.md §8.2.7), and for the same
reason: an agent re-reads a source on a schedule, so appending would double everything, and
only replacement survives an entry being deleted at the source.

- **Exceptions on replaced entries are carried over** when an entry with the same dates and
  label comes back in the list (the usual case, a re-read of an unchanged page). Otherwise
  they are deleted, and the result counts them.
- The result reports created, deleted and exceptions dropped. The dry run reports the same
  counts.

---

## 8. Elsewhere in the App

### 8.1 PI board sprint headers

A sprint header shows a **holiday chip** when the team serving the project (`TeamProject`) has
enabled calendars with entries inside the sprint's dates, for example *"2 public holidays"*.
Hovering lists each one with its date and label.

- **Counted:** an entry counts if it removes at least one contracted half-day from at least one
  member who counts towards capacity. A holiday on a Saturday, or one only part-timers are off
  for anyway, isn't news to the sprint.
- **Not shown:** for a project with no team, and for an undated sprint. An undated sprint is
  never shown as zero (teams.md §7.0.1).
- **Data:** a new read endpoint, `GET /api/v1/pis/{pi_id}/holidays`, returns the qualifying
  entries per sprint of that PI, so the board doesn't load team data it doesn't otherwise need.
- **Live updates:** calendar and switch writes broadcast to each affected team's channel
  (§9.2), and project boards refetch when their team's capacity status changes.

### 8.2 Team JSON export and import

**Export** (version `"1.1"`) adds two arrays:

```json
"holiday_calendars": [
  { "name": "Switzerland — national", "description": "…",
    "entries": [ { "label": "Christmas Day", "start_date": "2026-12-25",
                   "start_half": "am", "end_date": "2026-12-25", "end_half": "pm" } ] }
],
"holiday_exceptions": [
  { "member_id": "<exported member id>", "calendar": "Switzerland — national",
    "entry": { "label": "Christmas Day", "start_date": "2026-12-25" }, "day": "2026-12-25" }
]
```

- `holiday_calendars` lists the team's **enabled** calendars, each with **all** its entries, so
  the file is complete on an installation that doesn't have them.
- `holiday_exceptions` refers to entries by calendar name, label and start date, because entry
  ids don't survive the trip.

**Import:**

- **A `1.0` file** imports exactly as today, with no calendars. This is permanent, as the
  `capacity` → `available` fallback is (teams.md §6.2).
- **A calendar whose name exists** (compared ignoring case) is **reused and enabled**. The
  existing calendar wins. Entries in the file that differ from it are **not** merged, but are
  reported in the result: *"Switzerland — national: 3 entries in the file differ from the
  existing calendar and were not applied"*. A team import must not edit a calendar that other
  teams depend on.
- **A calendar whose name doesn't exist** is created **only** with `create_missing_calendars:
  true`. Without the flag, the import is refused with `409 CALENDARS_MISSING`, listing the
  names. The dialog then asks *"Create these calendars? Every team will be able to see them."*
  and retries with the flag. A team import never quietly adds app-wide data.
- **Exceptions** are restored when their calendar, entry and day resolve. Any that don't
  resolve are dropped and counted in the result.
- Everything happens in one transaction, as today (teams.md §8).

**Older deployments** refuse a `1.1` file with the existing `UNSUPPORTED_VERSION`, rather than
importing it without its holidays.

### 8.3 The PI Team report

The PI Team report is drafted in `plan-team-report.md` and not built yet. Its absences section
shows holidays as **"Public holiday: {label}"**, while leave stays **"Absent"** with its label
hidden, as that plan's decision #4 already says. The holiday precedence of §4.2 applies to
every per-day or per-sprint cell, and per-sprint counts split into the two. The report reads
the same engine, so the report and the Capacity view can't disagree.

### 8.4 Surfaces that do not change

- **The Achievement view, the velocity suggestion and the push:** these read PD. PD now
  reflects holidays, which is the point, and nothing else changes in them.
- **Project snapshots and project export:** neither carries team data.
- **PI CSV, PNG/PDF and dashboard exports, and the readiness, readout and breakdown reports.**
- **Absences:** model, routes and MCP tools are unchanged. Holidays no longer need to be
  entered as absences, but nothing stops it.

---

## 9. API, SSE and MCP

### 9.1 REST

| Method | Path | Purpose | Guard |
|---|---|---|---|
| `GET` | `/api/v1/holiday-calendars` | List calendars, with entry counts, years covered and teams using each | `get_current_user` |
| `POST` | `/api/v1/holiday-calendars` | Create; `409 CALENDAR_NAME_TAKEN` | `require_editor_or_above` |
| `GET` | `/api/v1/holiday-calendars/{id}` | One calendar with its entries (`?year=` filters) | `get_current_user` |
| `PATCH` | `/api/v1/holiday-calendars/{id}` | Name, description; `If-Match` | `require_editor_or_above` |
| `DELETE` | `/api/v1/holiday-calendars/{id}` | §3.6 | `require_editor_or_above` |
| `POST` | `/api/v1/holiday-calendars/{id}/entries` | Create an entry | `require_editor_or_above` |
| `PATCH` / `DELETE` | `/api/v1/holiday-calendars/{id}/entries/{entry_id}` | Edit or delete; `If-Match`; reports exceptions dropped | `require_editor_or_above` |
| `PUT` | `/api/v1/holiday-calendars/{id}/entries` | Bulk replace in a window (§7.3), `dry_run` | `require_editor_or_above` |
| `POST` | `/api/v1/holiday-calendars/{id}/copy-year` | §6.3; takes the reviewed list | `require_editor_or_above` |
| `POST` | `/api/v1/holiday-calendars/{id}/import/ics` | §7.1, `dry_run` | `require_editor_or_above` |
| `GET` | `/api/v1/holiday-calendars/{id}/export/ics` | §7.2 | `get_current_user` |
| `PUT` / `DELETE` | `/api/v1/teams/{team_id}/holiday-calendars/{calendar_id}` | Enable / disable | `require_editor_or_above` |
| `PUT` / `DELETE` | `/api/v1/teams/{team_id}/members/{member_id}/holiday-exceptions/{entry_id}/{day}` | Works this day / doesn't | `require_editor_or_above` |
| `GET` | `/api/v1/teams/{team_id}/holidays?from=&to=` | The team's effective holidays and exceptions in a window, for the strip and the cells | `get_current_user` |
| `GET` | `/api/v1/teams/{team_id}/holiday-cleanup` / `POST …` | §6.4: candidates / delete the ticked groups | read / `require_editor_or_above` |
| `GET` | `/api/v1/pis/{pi_id}/holidays` | §8.1 sprint-header chips | `get_current_user` |
| `GET` | `/api/v1/holiday-calendar-events` | §9.2 the Calendars page's SSE stream | `get_current_user` |
| `GET` | `/api/v1/teams/{id}/capacity` | `holiday_half_days` added (§4.2) | unchanged |
| `POST` | `/api/v1/teams/import` | `?create_missing_calendars=true`, `409 CALENDARS_MISSING` (§8.2); the response gains `import_notes` | unchanged |

All responses use the standard envelope. Calendar writes take no edit lock: they aren't
project data, and the per-row `If-Match` covers concurrent editors, as for teams
(teams.md §4.2). **Run `scripts/openapi.sh`** after the schema changes.

### 9.2 SSE

Calendars belong to no team, but their effects land in teams. So:

- **Every calendar or entry write** broadcasts `holidays:changed` with `{"calendar_id": …}` on
  the channel of **each team that has the calendar enabled**. This is the same
  broadcast-not-write crossing that `notify_team_achievement` makes (team-achievement.md §8.2).
- **Enabling, disabling and exception writes** broadcast on that one team's channel.
- **The Calendars page** listens on one new app-wide channel, `holiday-calendars`, streamed at
  `/api/v1/holiday-calendar-events`, so two editors on the page see each other's changes.
- Team views refetch their holidays and capacity on `holidays:changed`. The PI board refetches
  its chips through the existing team-capacity-status invalidation.

### 9.3 MCP

New tools live in a new module, `mcp_server/tools/holidays.py` (`holidays_mcp`, mounted beside
`teams_mcp`). Read tools go in `read.py`.

| Tool | Kind | Purpose |
|---|---|---|
| `list_holiday_calendars` | read | Calendars with counts and teams using each |
| `get_holiday_calendar` | read | Entries, optionally for one year |
| `list_team_holidays` | read | A team's effective holidays and exceptions in a window |
| `create_holiday_calendar`, `update_holiday_calendar` | write | By name; an unknown name is rejected with the list of valid ones (ADR 0003's precedent) |
| `create_holiday_entry`, `update_holiday_entry`, `delete_holiday_entry` | write | Range only |
| `replace_holiday_entries` | write | §7.3 bulk replace, with `dry_run`. This is the agent's path for a holiday page it re-reads |
| `import_holiday_ics` | write | §7.1, from file content, with `dry_run` |
| `enable_team_calendar`, `disable_team_calendar` | write | The description states the history effect (§3.4) |
| `set_holiday_exception` | write | Member, entry, day, works yes/no |
| `get_team_capacity`, `preview_team_capacity` | read, changed | Return `holiday_half_days` |

**Deleting a calendar is not an MCP tool.** teams.md §8.2.6 draws the line at "leaves yes,
containers no": there is no `delete_project` or `delete_pi`. A calendar is a container, and
other teams depend on it (§3.6), so deleting one stays a UI action with its confirmation.
Deleting an entry is a leaf, so `delete_holiday_entry` is exposed.

---

## 10. Edge Cases

| Case | Behaviour |
|---|---|
| Holiday and leave on the same half | Counted once, as holiday (§4.2); drawn as holiday |
| Holiday on a weekend or a half the member doesn't work | Costs nothing; still drawn in the strip; no sprint chip unless some counted member loses a half (§8.1) |
| Two enabled calendars with the same day | Union, counted once; two entries stacked in the strip |
| Member works the holiday | Exception for that day (§3.5); cell drawn `works-holiday`; strip says "n of m" |
| Member works the holiday but booked the afternoon off | The absence still removes the afternoon (§4.1) |
| Calendar disabled, then re-enabled | Exceptions come back with it (§3.5) |
| Entry dates changed so an exception's day falls outside | That exception is deleted; the dialog said how many (§3.5) |
| Member joins after the holiday was entered | Has it from their active date; nothing to copy |
| Member not counted towards capacity | Drawn and listed; never reaches the team total, as for any absence (ADR 0005) |
| Calendar deleted while teams use it | Confirmation names them; it is removed from all of them (§3.6) |
| Calendar renamed | Every team keeps it, since the switch is by id. A later team import matches the **new** name |
| Two calendars named "CH" and "ch" | Refused, because names are unique ignoring case (§3.1) |
| Team import with an existing calendar whose entries differ | Existing calendar wins; differences reported (§8.2) |
| Team import with an unknown calendar, no flag | `409 CALENDARS_MISSING`, nothing written |
| `.ics` with a yearly rule | Expanded over the chosen years (§7.1) |
| `.ics` with a weekly rule | Skipped, listed in the preview |
| `.ics` imported twice | Second run creates nothing; all duplicates (§7.1) |
| Bulk replace re-reads an unchanged page | Entries recreated; exceptions carried over (§7.3) |
| Copy year onto a weekend date | Flagged in the preview, not changed (§6.3) |
| Old everyone-absence on a calendar day | Harmless; counted once; offered by the cleanup (§6.4) |
| Sprint with no dates | No chip; capacity cell `null` as today |
| Closed PI | Its sprints' Available is never rewritten; capacity and Achievement figures move (§3.4) |

---

## 11. Order of Work

1. **Model and calendar API:** the migration, calendar and entry CRUD, the switch, and
   `scripts/openapi.sh`.
2. **Capacity:** holidays in the engine's seam, exceptions, `holiday_half_days`, and the
   capacity view's two lines and two-segment minimap. *This alone makes the numbers right.*
3. **Calendars page:** list, calendar page, entry dialog, copy year.
4. **Absences view:** the calendar panel, the strip, the `holiday` and `works-holiday` states,
   and the exception popover. *This step answers the original request.*
5. **`.ics` import and export.**
6. **Team JSON `1.1`:** export, and import with `CALENDARS_MISSING`.
7. **PI board chips** and the project holidays endpoint.
8. **MCP:** `holidays_mcp`, plus the read tool changes.
9. **Cleanup of old everyone-absences** (§6.4).
10. **PI Team report:** applied when that report is built (§8.3).

---

## 12. Decisions Taken

| # | Decision | Alternative rejected | Why |
|---|---|---|---|
| 1 | Holidays live in shared, app-wide calendars | One absence per member (teams.md §3.4); a category on absences | Several teams share the same holidays; entering them once per team drifts and misses new members (ADR 0008) |
| 2 | Admins and editors manage calendars; readers view them | Admin only | Same as every other planning write |
| 3 | A dedicated Calendars page | Calendars managed inside a team | They belong to no team |
| 4 | Enabled per team; several combine | Per member; per region | Decided; teams are each in one place today |
| 5 | "Works this holiday" exception per member, entry and day | No exceptions | On-call people would read as away |
| 6 | Dated entries only; copy year with manual review | A yearly recurrence | Moving holidays, and the series-editing problem of teams.md §3.4 |
| 7 | Hand entry, `.ics` import and MCP bulk replace | Fewer paths | Decided: all three |
| 8 | No live webcal subscription | Fetching an external URL | Outbound network access, and capacity changing unnoticed |
| 9 | Undated switch; history moves; warn | Dated "enabled from" | Decided: simple. Available is still never rewritten (§3.4) |
| 10 | Team export carries calendars by name, with their entries; existing calendar wins; creating needs a flag | Team import edits shared calendars | A team import must not change other teams' data |
| 11 | `.ics` export | None | Decided; makes the round trip to Outlook |
| 12 | Holiday chip on PI sprint headers; not on roadmap exports | Both, or neither | Decided |
| 13 | Opt-in cleanup of old everyone-absences | Leave them; delete automatically | Decided; matching by date, never deleting without a tick |
| 14 | Holiday wins over leave; `absent_half_days` keeps its total meaning | Count both; split into disjoint fields | One count per half; existing readers stay correct |
| 15 | Deleting a calendar is UI-only; deleting an entry is an MCP tool | Both as MCP tools | Leaves yes, containers no (teams.md §8.2.6) |
| 16 | `icalendar` dependency; our own yearly expansion | A hand-written parser; a full RRULE engine | The format has real edge cases; only yearly rules are needed |

---

## 13. Test Plan

Same layers as `docs/TESTING.md`; `scripts/check.sh` is the gate.

**Backend unit**
- **Engine (`test_team_capacity.py`):** holidays remove contracted halves; overlap with leave
  counts once, as holiday; an exception restores the day but not an absence on it; weekend and
  non-working halves cost nothing; two calendars union; `absent_half_days` totals and
  `holiday_half_days` is its subset; member active dates respected.
- **`.ics` parser:** all-day `DTEND` exclusivity; timed events to halves; the app's own
  `X-PIPLANNER` halves win; `FREQ=YEARLY` expansion with `COUNT`/`UNTIL`; weekly rules skipped
  with a reason; long `SUMMARY` truncated; duplicates detected.
- **Copy year:** proposed dates; weekend flags; exceptions never copied.

**Backend integration**
- **Calendars:** CRUD; case-insensitive name uniqueness; `If-Match`; guards (a reader can read
  but not write).
- **Entries:** CRUD; date change drops out-of-range exceptions and reports them; bulk replace
  carries exceptions over for unchanged entries and reports the dropped ones; `dry_run` writes
  nothing.
- **Switch:** enable and disable; the limit of 20; capacity moves for a closed PI's sprint while
  its Available does not; a derived project reads stale.
- **Exceptions:** create and delete; survive disable and re-enable.
- **Team export/import:** `1.1` round trip; `1.0` unchanged; existing-calendar-wins with
  differences reported; `CALENDARS_MISSING` without the flag; created with it; unresolved
  exceptions counted.
- **Delete calendar:** cascades entries, exceptions and switches.
- **Cleanup:** only multi-member ranges fully covered by holidays are candidates; nothing is
  deleted unless chosen.
- **Project holidays endpoint:** a chip only when a counted member loses a half; none for an
  undated sprint or a project with no team.
- **Migration:** applies and is reversible.

**MCP:** each new tool against the backend; the name-resolution errors; there is no delete
tool.

**Frontend (Vitest)**
- **`absenceGrid.test.ts`:** `holiday` precedence; `works-holiday` drawing.
- **Strip helper:** stacking; "n of m"; empty and no-calendar lines.
- **Calendar panel:** the ticks; the history warning; read-only for readers.
- **Exception popover:** the toggle, hidden for readers.
- **Calendars page:** list; entry dialog naming affected teams; copy-year preview with weekend
  flags.
- **`.ics` import dialog:** the preview counts.
- **`CapacityCell`:** two lines. **Minimap:** two segments summing to today's bar.
- **Sprint header:** the chip and its hover.
- **Team import:** the `CALENDARS_MISSING` retry prompt.

**E2E** (`holidays.cy.ts`): create a calendar with Christmas; enable it for a team; see the
strip and the holiday cells; mark one member as working and read "n of m"; see "− public
holidays" in Capacity and the chip on the PI board. Standard rules apply (`cy.openTeam`,
`cy.enterEditMode()` where a project write is involved, anchored regexes). "Public holidays"
is both a strip heading and part of the chip text, so scope those assertions.

**Contract:** `scripts/openapi.sh` after §9.1.

# iCalendar import samples

Small `.ics` files for trying out the two calendar importers by hand:

- **Holiday calendars** — Calendars → pick a calendar → **Import .ics**. Rules in
  `spec/public-holidays.md` §7.1 and `backend/app/services/holiday_ics.py`.
- **Absences** — a team's Absences view → **Import .ics**. Rules in
  `spec/teams.md` §7.4.1 and `backend/app/services/absence_ics.py`.

Every file is dated 2027, so the outcomes below don't drift with today's date.
Both dialogs preview before they write; **Back** or closing the dialog writes
nothing. `backend/tests/integration/test_ics_samples.py` reads every file here and
checks it still produces what this page says.

## Holiday calendars

Use a scratch calendar. In the import dialog set **Yearly holidays from** `2027`
**to** `2028` — yearly rules are expanded over those years, and the defaults
(this year and next) give different counts.

| File | What you should see |
|---|---|
| `01-holidays-zurich-2027.ics` | 11 entries, nothing skipped. Whole days for the all-day events; *Sechseläuten* and *Heiligabend* as **afternoon** halves (timed events starting at or after noon); *Weihnachten / Stephanstag* as one two-day entry, 25–26 Dec (all-day `DTEND` is exclusive); *Bundesfeiertag* — a `FREQ=YEARLY` rule from 2000 — once for 1 Aug 2027 and once for 1 Aug 2028 |
| `02-holidays-awkward.ics` | 4 entries, 6 skipped with a reason each. Kept: a **morning** half (08:00–12:00); *Exported by PI Planner*, 30 Dec pm → 31 Dec am from its `X-PIPLANNER-*-HALF` properties; *Company day* only for 2028 (2027 is an `EXDATE`); and a title cut to 100 characters, reported as truncated. Skipped: a monthly rule, a yearly rule with `RDATE`, a yearly rule with `INTERVAL=2`, a yearly rule naming two dates, an event with no start, and a `VTODO` |
| `99-not-a-calendar.ics` | Refused: *This is not a readable iCalendar file*. Nothing written |

Importing the same file twice into the same calendar adds nothing the second
time — entries are matched by date and label.

## Absences

Create a team with members **Anna Keller**, **Ben Okafor**, **Michel Anders** and
**Chiara Rossi**. Leave the window fields blank — the preview fills them with the
file's span.

| File | Mode | What you should see |
|---|---|---|
| `10-absences-anna.ics` | One person: Anna Keller | Window 6 Jan – 23 Jul 2027. **Ticked:** *Summer vacation* 12–23 Jul; *Doctor's appointment* 10 Mar pm (timed, but Outlook *out of office*); *Part-time: Wednesday afternoons* as one weekly rule, pm; *Every other Friday off* as one every-2-weeks rule until 25 Jun; *Evening-school course* — `BYDAY=MO,TH;COUNT=10` — as two weekly rules (Mon, Thu mornings) both ending 4 Mar. **Unticked:** *Sprint review* (a timed event, *looks like a meeting*) and *Birthday* for 2027 (*repeats yearly*). **Skipped:** *Ski week (cancelled)* |
| `11-absences-anna-updated.ics` | One person: Anna Keller, after importing 10 with its default ticks | Re-import by `UID`: *Summer vacation* **updated** to 19–30 Jul; *Conference* 20–22 Apr **new**; the weekly rules **unchanged**; *Doctor's appointment* — gone from the file, and inside the window — **proposed for removal**, ticked. Hand-entered absences are never proposed |
| `12-absences-team.ics` | A shared team calendar | *Vacation* → Ben (his `ORGANIZER` name); *Vacation – Anna Keller* → Anna (full name in the title); *Anders Michel – parental leave* → Michel (either word order); *Customer workshop in Lyon* → **two rows**, Anna and Chiara (both attendees). *Anna – dentist* and *Office closed for moving* match nobody — a first name alone never matches — and wait unticked behind the filter for a member to be picked |
| `13-absences-unsupported.ics` | Either | Nothing to import; 9 skipped, each with its reason: a weekly rule with `EXDATE`, a moved occurrence (`RECURRENCE-ID`), a monthly rule, a numbered weekday (`BYDAY=1MO`), a daily rule, a two-day weekly event, a rule every 60 weeks, an event with no `UID`, and a `VTODO` |
| `99-not-a-calendar.ics` | Either | Refused. Nothing written |

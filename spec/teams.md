# Teams & Capacity — Specification

> Status: draft for review. Extends `spec/specification.md` (Phase 1 MVP), which has a
> project perspective only and no notion of *who* does the work. Sections below use the
> same conventions as that document.

## 1. Problem

A sprint's capacity is a number somebody types into the sprint header. Nothing behind it
says who is on the team, how much of their week they actually give to this work, or when
they are away. Teams make that number derivable, and make it wrong in visible ways rather
than invisible ones.

A team is modelled **independently of projects** because the same people serve several
projects, and because a team outlives any single PI.

## 2. Scope

**In scope:** team and member records, contracted working days, absences, meetings,
per-sprint capacity in person-days (PD) and hours, assignment of a team to projects, and
translation of computed capacity into each project's effort unit.

**Not in scope:** linking members to application logins, absence approval workflows,
cost/rate tracking, skills-based matching or staffing suggestions, individual assignment of
PBIs to members, and importing holiday calendars from an external source. `role` and
`organisation` are **stored and displayed** (§3.2); nothing computes on them.

---

## 3. Data Model

### 3.1 Team

| Field | Rule |
|-------|------|
| `system_id` | UUID primary key |
| `name` | Required, max 100 chars, unique across the instance |
| `description` | Optional, max 2000 chars |
| `normal_day_hours` | Float 1.0–24.0, default 8.0 — the divisor that turns hours into days (§5.2) |
| `created_at` / `modified_at` | Timestamps |

Teams are **not** planning items: the dual-ID system (§2.2 of the product spec) does not
apply. There is no `user_id`, and nothing about a team is shown in the `[101] Title` form.

### 3.2 Member

Members are **manual entries, deliberately not linked to `users`**. You plan for people
who have no account in this tool — contractors, colleagues from another department,
someone who starts next month — and a login is not evidence of being on a team.

| Field | Rule |
|-------|------|
| `system_id` | UUID primary key |
| `team_id` | FK to `teams.system_id` |
| `name` | Required, max 100 chars, unique per team (case-insensitive) |
| `role` | Optional, max 50 chars — free text (`Dev`, `SW-Arch`, `Test`, `SM`, `PO`, `UX`…) |
| `organisation` | Optional, max 50 chars — free text (`Dev`, `BIT`, `ASTRA`…) |
| `active_from` / `active_to` | Optional dates; membership validity (see below) |
| `order_index` | Display order, reorderable |
| `modified_at` | Timestamp — the concurrency token (§4.2) |

`active_from` / `active_to` are **an addition to the draft**. Without them, hiring
someone mid-PI or a leaver forces you to delete the member, which destroys their absence
history and silently rewrites capacity for sprints that are already closed. Half-days
outside the validity window contribute nothing.

`role` and `organisation` are **descriptive only** — free text, optional, and never read by
the capacity maths. Both are entered through a **free-text combobox**: the field suggests
values already used elsewhere in the team, and accepts anything typed. Neither is a managed
vocabulary — there is no roles table, nothing to administer, and no rejection of an unknown
value. A plain dropdown would imply a list somebody maintains, and there is none; a plain text
field would spell "SW-Arch" four ways by the fourth member. The suggestion list is derived from
the team's existing values, nothing more.

`organisation` matters because a planning team is routinely staffed from
several of them; a single team can hold people from three, and being able to say so removes
any need to model those as separate teams. Both are **not versioned**, unlike everything in
§3.3: they do not affect a single computed number, so dating them would add versions that
change nothing. The §3.3 rule is about inputs to capacity, and these are not inputs.

`hours_per_day` is **not** here: it is a contract term and lives on the dated working
pattern (§3.3), and neither is `focus`. Both are dated, because both change on a date. What
remains on the member is only what has no date: who they are, and when they joined and left.

`hours_per_day` sets how many hours that member's working day contributes — but it is **not**
the divisor for person-days: a PD is `normal_day_hours` of work for everyone, so a 6 h/day
part-timer's full day is 0.75 PD, not 1.0. See §5.2.

### 3.3 Working Pattern (contract), versioned by `effective_from`

A working pattern is a **dated version**, not a single editable row. Contracts change —
someone drops to 80%, a parental-leave arrangement ends, a part-timer swaps their free day
— and each change has a date from which it holds. A member therefore owns an ordered list
of pattern versions.

| Field | Rule |
|-------|------|
| `system_id` | UUID primary key |
| `member_id` | FK to `team_members.system_id` |
| `effective_from` | Required date; unique per member |
| `mon_am` … `sun_pm` | **14 booleans** (Mon–Sun × morning, afternoon) |
| `hours_per_day` | Float 1.0–12.0 — hours in one *full* contracted day (see below) |
| `focus` | Float 0.1–1.0, step 0.05, default 1.0 (see below) |
| `note` | Optional, max 100 chars (e.g. "80% from July") |
| `modified_at` | Timestamp — the concurrency token (§4.2) |

**A member's first version is created with the member, in the same transaction.** A member
can never exist without a pattern: no version means no contracted half-days, which computes as
zero capacity and reads as a bug rather than as missing data. The create-member form therefore
carries the first version's fields, and `effective_from` defaults to the member's `active_from`
(or today when that is blank).

Defaults for that first version: Mon–Fri both halves on, weekend off, 8.0 h/day, focus 1.0.
Offering one-click presets for the common contracts (full week, 80% with Friday off, and
"copy from" an existing member) costs nothing and is where most of them will come from.

This is the **contract only**. Absences, holidays, training and the like belong in §3.4.
The separation matters: the pattern answers "which half-days does this person owe us",
absences answer "which of those are they not there for".

#### Intervals are half-open, and derived

A version holds **from its `effective_from` (inclusive) until the day before the next
version's `effective_from`**; the latest version holds indefinitely. There is deliberately
**no `effective_to` column** — storing both ends invites gaps and overlaps that then need
validating and repairing. With one date per version, a gap cannot be expressed.

The **earliest version extends backwards without limit.** Any date before the first
`effective_from` uses that first version, so no day is ever undefined and no capacity query
has to handle a missing pattern. This is also what makes the model cheap to adopt: an
existing member becomes one version carrying their current pattern, and every number stays
as it was.

#### `hours_per_day` and `focus` both live on the version

`hours_per_day` is a **contract term**, exactly like which half-days are worked, and the two
almost always change together — going from 100% to 80% is usually both fewer days *and* a
different day length. Leaving it on the member would mean a change still rewrites the past.

**`focus` is versioned too.** It was tempting to call it a pure planning assumption that
applies uniformly across time, but that is not how focus actually moves: it changes when
someone joins a support rota, picks up a second product, or comes off one — all events with
a date. Editing an undated focus would silently restate every past sprint, which is the exact
problem versioning exists to prevent, and it would do it to the one input people tune most
often.

The rule is now simple and has no exceptions: **everything that varies over time lives on the
dated version; the member row holds only identity and validity.**

#### Editing rules

- Adding a version with an existing `effective_from` **edits that version** rather than
  creating a duplicate.
- Deleting a version merges its interval into the preceding one. The **earliest version
  cannot be deleted** — something has to define the beginning.
- Back-dating a version into a `closed` PI is allowed but **does not recompute those
  sprints** (§11), and the UI says so before saving. Forward-dating is the normal case and
  touches nothing that has already happened.

**Worked case: "100% until 31.08., 80% from 01.09."** — one member, one allocation change on a
date. Two versions: the existing one, and a second with `effective_from = 1 Sep` carrying the
reduced days or hours. Nothing is edited, nothing before September moves, and the sprints
either side of the change compute from the version in force on each half-day (§5.4). This is
the shape the versioning was built for, and it needs no per-member project allocation to
express — the team-level share (§6.3) is untouched.

### 3.4 Absence

| Field | Rule |
|-------|------|
| `system_id` | UUID |
| `team_id`, `member_id` | Each absence belongs to exactly one member |
| `label` | Optional, max 100 chars (e.g. "Christmas", "Parental leave") |
| *schedule rule* | `kind` + its fields — see below |
| `modified_at` | Timestamp — the concurrency token (§4.2) |

There is **no absence category** — per the draft, an absence is an absence. `label` is text
for the human reading the row, and is never interpreted by the capacity maths.

#### The schedule rule — three kinds, shared with meetings

The same rule shape describes when an absence applies and when a meeting occurs, so absences
and meetings carry **identical scheduling fields** and are created through **one modal**.

| Kind | Means | Fields |
|------|-------|--------|
| `range` | A block of consecutive days | `start_date` + `start_half`, `end_date` + `end_half` (inclusive) |
| `weekly` | The same slot every week | `weekday` (0–6), `halves` ({`am`}, {`pm`} or both), `start_date`, optional `end_date` |
| `interval` | The same slot every *N* weeks | as `weekly`, plus `interval_weeks` (2–52) |

**`interval` is its own kind, not a number on `weekly`.** The two are mathematically the same
rule with *N* = 1, and collapsing them would be tidier in the schema — but it would put a
field reading "every `[1]` weeks" in front of everyone entering an ordinary weekly absence,
to express the case they almost always mean. Three named choices ask a question people can
answer; one choice plus a parameter asks them to encode an answer. The redundancy is one
enum value, and it buys the common path a form with nothing to fill in.

`interval_weeks` therefore starts at **2**. "Every second Friday" is a real contract shape,
and a weekly-only model over-deducts it by 100%.

**Recurring kinds take an optional `end_date`.** An open-ended rule is the honest
representation of "every Wednesday afternoon, until further notice" — a contract with no
agreed end. It needs no sentinel date, because capacity is only ever computed over a bounded
window (a sprint, or the visible months), and occurrences are generated inside that window.

**Occurrences are anchored on `start_date`, not on ISO week parity.** The first occurrence is
the first matching weekday on or after `start_date`; subsequent ones fall every
`interval_weeks` weeks from it.

Because that date decides *which* alternate weeks are hit, the UI labels it **"First
occurrence"** rather than "runs from" — it is an anchor, not a boundary, and naming it as a
boundary invites someone to type the start of the month and get the wrong fortnight. An
`interval` form also **previews the next few occurrence dates** as chips; an off-by-one week
is invisible in the rule and obvious in the dates.

Anchoring is what makes the rule total: even/odd ISO weeks
look equivalent but break at the year boundary, where week 52 can be followed by week 1 and
two "even" weeks land back to back. An anchor has no such seam, and it also lets two members
be on opposite fortnights — which parity cannot express at all.

A `range` covers a holiday and a fixed public holiday alike — Christmas is a one-day range.

#### A recurring entry has no per-occurrence exceptions

**Editing or deleting a recurring absence or meeting always acts on the whole series.** There
is no "just this one" — no exception list on the rule, no detached occurrence, no split-on-edit.
A UI must not offer *this occurrence / the whole series*: there is only the series.

The reason is that an exception list is a second scheduling model living inside the first. It
needs its own storage, its own conflict rules against `If-Match`, its own answer for what a
back-dated exception does to a closed PI, and its own display so an excepted occurrence is
visibly missing rather than apparently absent. That is a large amount of machinery for a case
with two adequate answers already in the model:

- **The pattern changed** → give the rule an `end_date` and start a new one. This is the
  honest record anyway: "every second Friday until October, then weekly" is two rules, and
  keeping it as one rule with a hole loses the fact that something changed.
- **One extra or missing day** → a one-day `range` alongside the recurrence. Absences union
  (§3.4), so adding is free; and a rule that over-covers by one day is better corrected by
  ending it a week early than by hiding a hole inside it.

If per-occurrence exceptions turn out to be genuinely needed, they are a deliberate later
addition (§13) — not something to slip in through a modal's confirm dialog.

Creating an absence for **multiple or all members creates one record per member**, each
independently editable and deletable afterwards. The multi-select is an input convenience,
not a shared object — otherwise editing "everyone's Christmas" for one person who is
working that day forces you to delete and recreate.

**This is the whole mechanism for public and national holidays.** Christmas, a national day
or an office shutdown is entered once with every member selected, and becomes one absence per
person that can then be corrected individually for whoever is actually on call. No holiday
entity, no calendar import, no per-team variant with per-member exceptions: an absence is an
absence, and the multi-select already does the fanning out.

Rules:
- An absence on a half-day the member does not work is **allowed and has no effect**. No
  warning: entering the office shutdown for the whole team should not produce noise for
  the four part-timers.
- Overlapping absences are **allowed and counted once** (set union, never a sum).

### 3.5 Meeting

| Field | Rule |
|-------|------|
| `system_id` | UUID |
| `team_id` | Meetings are team-scoped |
| `title` | Required, max 100 chars |
| *schedule rule* | `kind` + its fields — **the same three kinds as §3.4**, created through the same modal |
| `half` | The half-day an occurrence **starts** in (`am` / `pm`) |
| `duration_minutes` | Integer **5–480**, in steps of 5 |
| attendees | One, several or all members — one row per attendee |
| `modified_at` | Timestamp — the concurrency token (§4.2) |

The draft's Meeting View bullet reads "*absences* can be assigned … by selecting them in
the row" — read as **meetings**, matching the section heading.

**A meeting carries the same schedule rule as an absence** (§3.4): `range` for a three-day
workshop, `weekly` for a stand-up, `interval` for a fortnightly retro. One rule shape, one
modal, one occurrence generator, one set of validation — meetings and absences differ only in
what an occurrence *costs*, not in when it happens. A single-occurrence meeting is a one-day
`range`, exactly as Christmas is.

Note what a recurring meeting now is: **one row, not one row per occurrence.** A daily
stand-up over a year was previously 250 records; it is now a `weekly` rule per weekday, or
five rules for a five-day stand-up. That is why §9's meeting limit is a count of *definitions*
and is far lower than the absence limit.

Meetings carry a duration rather than a half-day because a 15-minute stand-up and a full
planning day are both meetings, and rounding both to a half-day makes the number useless.

**Minutes, not hours.** `duration_minutes` is an integer from **5 to 480** — five minutes to
eight hours — in steps of 5. A float count of hours would have to carry 0.0833 for a
five-minute stand-up, and no rounding rule makes that read well; minutes are exact and the
UI can offer a normal duration picker.

**A meeting is placed in a half-day but is not confined to one.** `half` says where it
*starts*; a meeting longer than that half spills into the rest of the day. Placement is kept
because it is what lets a meeting be cancelled against an absence — a 2 h meeting on a morning
the member is away costs nothing, and without placement it would wrongly consume their
afternoon.

**A meeting's length is independent of the attendee's working day.** An 8 h workshop is
enterable for a member contracted 6 h/day; it consumes their whole day and no more (§5.4).
The constraint belongs to the meeting, which is a real event of a real length, not to the
person attending it.

---

## 4. Permissions & Concurrency

Team data and project data are **two separate aggregates**, and the boundary between them is
one explicit action. Everything in §3 — members, pattern versions, absences, meetings — is
edited **without any project lock**, and changes nothing a project can see. A project's
Available values move only when someone runs **"Update project(s)"** (§6.7), and that action
alone meets the existing single-writer lock.

**"Local" means confined to the team aggregate, not held in the browser.** Team records live
in the database like everything else — readers watch them over SSE, MCP tools read them, and
a second device sees them. What is local is their *effect*: computing capacity reads team
tables and writes nothing to `sprints`.

### 4.1 This needs no change to the lock mechanism

`require_edit_lock` resolves the project it guards from **path params only** — `project_id`,
`feature_id`, `pbi_id`, `group_id`, `swimline_id`, `pi_id`, `sprint_id`. A route under
`/api/v1/teams/{team_id}/…` carries none of them, so `_resolve_locked_project_id` returns
`None` and the dependency returns the caller untouched. **Team endpoints are outside the lock
by construction**, simply by living at team-scoped paths. Nothing in `deps.py` is modified.

The push endpoint is `POST /api/v1/projects/{project_id}/team-capacity/apply`. It carries
`project_id`, so it inherits the existing enforcement and the existing 409 body
(`locked_by`, `expires_at`) with no new code.

And because the check is **permissive** — it rejects only when a *different* user holds an
unexpired lock, and lets the write through when no lock is held — the push needs
**no acquire, no release and no heartbeat**. It is an ordinary write that fails with 409 when
someone else is mid-edit, exactly like every other write in the app. There is no short-lived
programmatic lock to invent, and no new failure mode to explain in the UI.

This supersedes an earlier proposal to add a `scope` column to `EditLock` and key locks by
`(scope, target_id)`. That would have meant a migration, a second lock lifecycle, a second
heartbeat and a second "someone else is editing" state in the frontend. This approach costs
none of it and resolves the collision more cleanly, because it removes the coupling rather
than modelling it.

### 4.2 Team writes carry `If-Match`

Dropping the project lock leaves team data with no concurrency control of its own, and
last-write-wins would be a real if narrow hole: two editors on the same absence, and one
edit vanishes with nothing to show for it. Rather than wait to find out whether it bites,
team writes use **optimistic concurrency from the start**. It is cheap, it is per-row, and
retrofitting it later would mean changing every team endpoint's contract after clients exist.

- Every team-owned row carries `modified_at`: team, member, pattern version, absence,
  meeting, project assignment.
- Reads return it as a strong **`ETag`**.
- `PATCH` and `DELETE` **require `If-Match`**. A mismatch is **`412 Precondition Failed`**,
  carrying the current row so the client can show what changed.
- `POST` needs no precondition — a create cannot clobber.

**412 is deliberately not 409.** They are different failures needing different words: 409
means *someone else is editing this project, wait* (the lock, §4.1); 412 means *this absence
changed under you, here is the new version*. Collapsing them would make the frontend guess.

This is concurrency control, not a lock: nobody holds anything, nothing expires, there is no
heartbeat, and two people editing *different* absences never collide. It composes with §4.1
rather than competing with it — the lock guards project data, `If-Match` guards team rows.

Readers are unaffected: team writes use `require_editor_or_above`, so a reader sees every
view and every number and can change none of it.

### 4.3 Consequences to design around

1. **Derived Available is no longer live.** It is a value someone pushed, and the team may
   have moved since. Staleness becomes visible state — §6.6.
2. **A push to several projects is not atomic.** One of them may be locked by another
   editor — §6.7.
3. **Two failure codes, two messages.** `409` from the project lock, `412` from a stale team
   row. The frontend must not conflate them — §4.2.

---

## 5. Capacity Computation

### 5.1 Three granularities, deliberately different

The half-day was introduced as a **usability** decision — part-timers and absences come in
half or whole days, and asking anyone to type hours for "Tuesday afternoon off" is worse.
That does not make the half-day the right unit to *compute* in. Three layers, each chosen on
its own merits:

| Layer | Unit | Why |
|-------|------|-----|
| **Input** | half-day | How people actually describe working patterns and absences |
| **Computation** | **hour** | The only unit that adds up across unequal days and part-hour meetings |
| **Display** | hour **and** day | Hours are exact; days are what people plan in |

A half-day is therefore a **slot**, not a quantity. It answers *whether* a member is there;
its length in hours comes from the pattern version (§3.3), and everything downstream is hours.

### 5.2 A day means `normal_day_hours`, not "that person's day"

`team.normal_day_hours` (float, 1.0–24.0, **default 8.0**) is the divisor that turns hours
into days. **PD is a unit of work, not a unit of presence.**

This matters more than it looks. If a person-day meant *that member's own* working day, then
a full sprint would be "10 PD" for an 8 h/day member and also "10 PD" for a 6 h/day member —
two figures that look identical and represent 80 h and 60 h of work. Sizing a sprint budget
from that number would be wrong by a quarter, and the error grows with every part-timer
hired. Normalising fixes it: 10.0 PD and 7.5 PD, and the difference is visible.

Three things fall out, all of them simplifications:

- **`team_PD = team_hours / normal_day_hours`, always.** The two headline numbers are one
  number in two units, and there is nothing to explain.
- **A mid-sprint contract change needs no special handling.** Hours are hours no matter which
  version produced them, so per-half-day differences accumulate inside the hours sum and the
  conversion to days stays a single division at the end. This is what makes versioning `focus`
  (§3.3) cheap: it is one more per-slot term, not a second unit to reconcile.
- **`units_per_pd` (§6.4) stays calibrated.** With member-relative PD, hiring a part-timer
  raises the team's PD without raising its output, silently invalidating the factor. With
  normalised PD, PD is proportional to hours, so the factor keeps meaning what it meant.

`normal_day_hours` is a team field rather than a hardcoded 8 because a 37.5 h week is
ordinary and a 7.5 h day would otherwise inflate every headline figure by 6.7%. It is one
float, and mathematically the factor absorbs any constant — but the number is read by humans,
and it should match how they talk about their own days.

### 5.3 Inputs

Capacity is computed **per member, per sprint**, and needs `sprint.start_date` and
`sprint.end_date`. Both are optional today. A sprint missing either **contributes no
capacity and displays "—"** rather than zero — an undated sprint is unknown, not empty.
`start_date ≤ end_date` is validated on write.

### 5.4 Formula

For member *m* and sprint *s*:

1. **Half-day set** — every half-day from `start_date` to `end_date` inclusive where the
   **pattern version in effect on that date** (§3.3) has the half-day on, **and** the
   half-day is inside the membership validity window. The version is resolved per half-day,
   so a contract change mid-sprint needs no special case.
2. **Remove absences** — drop every half-day covered by any absence of *m* (union).
3. For each remaining half-day, `slot_hours = hours_per_day / 2`, taken from **that
   half-day's** version.
4. **Meetings, per day.** For each day, take every meeting **occurrence** *m* attends that
   starts on it — occurrences generated from the schedule rule (§3.4) exactly as absence
   occurrences are in step 2.
   Each consumes its `duration_minutes` from the half-day it starts in, then **spills into
   the other half of the same day**, and the day's total is **clamped to the hours that
   remain there** after steps 1–2.
5. `slot_net = (slot_hours − slot_meeting_hours) × focus`, with `focus` also taken from
   **that half-day's** version.
6. `net_hours = Σ slot_net` and `member_PD = net_hours / normal_day_hours`.

**Why step 4 clamps at the day, not the half-day.** A full-day workshop is one meeting, and
clamping each half separately would charge it for half its length — the afternoon it plainly
consumes would come back as free capacity, with nothing to indicate the number was wrong. The
day is the right boundary: an 8 h meeting for a member contracted 6 h/day costs their whole
day and stops there, so capacity reaches 0 and never goes below it.

Placement still matters, which is why the spill starts from `half` rather than the day as a
whole: a meeting on a morning the member is absent costs nothing, because there are no hours
in that half to consume and the spill can only reach hours that survived steps 1–2. Absence
beats meeting, always.

Both versioned quantities — `hours_per_day` and `focus` — are resolved **per half-day**, so
steps 3–5 are one accumulation and a mid-sprint contract change needs no special case. Note
what is being accumulated: **hours**. The conversion to days is still a single division at the
end, which is the property §5.2 buys and versioning `focus` does not cost. When nothing
changes during the sprint this reduces to the obvious
`(available_hours − meeting_hours) × focus`, which is how the examples read.

**Meetings are subtracted before focus** — they are booked time the member does not have,
like an absence, and the focus factor then discounts what is left. The consequence to state
plainly in the UI: **do not encode meeting overhead in the focus factor as well**, or you
pay for it twice. Focus is for the diffuse losses — context switching, support duty,
interrupts.

Team totals: `team_hours = Σ member net_hours`, and `team_PD = team_hours / normal_day_hours`
— equivalently `Σ member_PD`, since the divisor is now shared.

⚠️ **Morning and afternoon are assumed equal** (`hours_per_day / 2`). A member contracted for
6 h as a 4 h morning and a 2 h afternoon cannot be expressed. Per-slot hours — 14 floats
instead of 14 booleans plus `hours_per_day`, where "off" is simply 0.0 — would handle it and
would make step 3 a plain sum, but it costs the toggle-grid entry that made half-days worth
having. Deferred (§13); revisit only if such contracts turn out to be real here.

Rounding: compute in float throughout and **never round an intermediate**. Team-side figures
round to 1 decimal **for display only**; the single rounding that changes a stored value
happens when a push writes a sprint's Available (§6.4).

### 5.5 Worked example

Sprint: Mon 6 Apr – Fri 17 Apr 2026 (10 working days). `normal_day_hours` = 8.0.

**Alice** — focus 0.8, 8 h/day, Mon–Fri full. One day's holiday on 13 Apr. Attends sprint
planning (2 h, 6 Apr am) and a weekly 1 h sync on Mondays.

```
20 half-days × 4 h                      = 80.0 h
− holiday 13 Apr (2 half-days)          = 72.0 h
− meetings: 2 h planning + 1 h sync     = 69.0 h   (13 Apr sync skipped — absent)
× focus 0.8                             = 55.2 h
PD = 55.2 / 8                           =  6.9 PD
```

**Bob** — focus 1.0, 6 h/day, Mon–Thu full + Fri morning. No absences. Same two meetings
(120 min and 60 min).

```
18 half-days × 3 h                      = 54.0 h
− meetings: 2 h planning + 2 × 1 h sync = 50.0 h
× focus 1.0                             = 50.0 h
PD = 50.0 / 8                           =  6.3 PD
```

**Team: 105.2 h · 13.2 PD** — and 105.2 / 8 = 13.2, which is the PD figure. The two agree by
construction.

**A third case, for the clamp.** Give Bob a full-day workshop — one meeting, 480 min, starting
`am` on 8 Apr. It consumes his 3 h morning, spills into his 3 h afternoon, and stops: that day
costs him 6 h, not 8, and not the 3 h a per-half-day clamp would have charged. His sprint drops
to 44.0 h · 5.5 PD.

Note Bob: he is *present* for 9 working days but contributes **6.3 PD**, because his day is
6 h and two of those days are half-days. Presence and capacity are different questions, and
§7.6 shows both.

---

## 6. Projects, Shares and the "Available" Budget

### 6.1 Cardinality

- A team is assigned to **one or more projects**.
- A project is served by **at most one team** ("for now" — the draft's wording; §12).
- Unassigning a team leaves every sprint's Available value **exactly as it stands**, at what
  was last pushed, and switches the project back to `manual` (§6.4). This falls out of the
  push model for free: Available is always a value someone wrote, never a live view, so
  removing the team removes nothing. Plans do not silently deflate.

### 6.2 Sprint capacity is renamed "Available"

The existing `sprints.capacity` field is renamed **`available`**, labelled **"Available"**
in the UI, and keeps expressing the project's own `effort_unit` (pts, sp, h, days — set in
project configuration). Team capacity is *translated into* that budget (§6.4); it never
replaces the unit.

The migration is a **pure column rename** — no type change, no data conversion. It touches:
the `sprints` table, `SprintCreate` / `SprintUpdate` / `SprintResponse`,
`PIResponse.total_capacity` → `total_available`, the sprint header and
capacity bar in the PI board, PNG/CSV/dashboard/report exports, snapshot payloads and their
restore path, the MCP `update_sprint` and `set_sprint_capacities` tools, `openapi.json` +
`api.generated.ts` (`scripts/openapi.sh`), and the Cypress specs that select the header by
its accessible name.

**`available` stays a whole number** (`Integer`, ≥ 0). The column type does not change: a
budget is a whole number of points, days or hours that a human reads off a sprint header, and
the precision of the team model has no business leaking into it. The float lives entirely on
the team side; the boundary between them is one rounding step (§6.4).

**Available can be 0.** A sprint spanning the winter shutdown, with everyone on holiday, has
no budget, and the model must be able to say so rather than invent one. The one constraint
that moves is therefore `gt=0` → **`ge=0`**, in `SprintCreate.capacity` and
`SprintUpdate.capacity`. Nothing else about the column changes.

Zero is in fact **already reachable today, and only the API forbids it**: the snapshot restore
path writes `capacity=s.get("capacity") or 0` (`services/snapshot.py`), so a restored project
can hold a 0 the API would refuse to set or correct. Relaxing to `ge=0` closes that
inconsistency rather than opening a new case.

The frontend needs no work for the normal case — `CapacityBar` already guards `capacity === 0`
(gray bar, no division by zero, label `0/0 pts - 0%`). **One display bug becomes reachable**,
though: with `used > 0` and `available = 0` it renders `12/0 pts - 0%` in gray, when 12 points
against no budget is the most over-committed a sprint can be. That branch must report
over-capacity red, not 0%.

Snapshots store their payload as JSON, so **every snapshot taken before the rename carries a
`capacity` key forever**. The restore path must read `available` and fall back to `capacity`,
permanently — this is not a migration that can be finished.

### 6.3 Team share per project

Each project assignment carries **`share_pct`, an integer 1–100**. The team's capacity for
that project is `team_PD(s) × share_pct / 100`.

If a team's shares sum to **more than 100%**, show an amber over-allocation warning on the
team and on every affected project — **warn, do not block**. Teams really are overcommitted,
and a planner that refuses to represent the situation it exists to reveal is worse than one
that colours it amber. Under 100% is normal (slack, unassigned work) and is not flagged.

### 6.4 Translating PD into the project's effort unit

Per project assignment, `available_source` selects the method:

| Method | Behaviour |
|--------|-----------|
| `manual` | **Default, and today's behaviour unchanged.** Available is typed by hand; team capacity is shown beside it as a reference. Nothing about existing projects changes until someone opts in. |
| `factor` | `available = team_PD × share_pct/100 × units_per_pd`. `units_per_pd` is a float > 0 stored on the assignment. For a project whose unit *is* days, set 1.0; for hours, set the team's hours per PD. |
| `velocity` | `units_per_pd` derived from history instead of typed — **Phase 2, see below**. |

Worked through from §5.5, with a 70% share and 1.5 pts/PD:
`13.15 PD × 0.70 = 9.205 PD × 1.5 = 13.808` → rounded once → **Available 14 pts**.

#### Rounding at the boundary

The whole chain is float — per-half-day hours, focus, PD, share, factor — and **rounds
exactly once, when the push writes the sprint**. Nothing upstream rounds; nothing downstream
re-rounds.

- **Half-up, explicitly.** `Decimal(value).quantize(Decimal("1"), rounding=ROUND_HALF_UP)`.
  Python's built-in `round()` is **banker's rounding** — `round(0.5) == 0`, `round(2.5) == 2` —
  which is not what anyone reading a sprint header expects, and a `.5` lands often once
  shares and factors are in play. This is a trap worth naming in the code as well.
- **Per sprint, independently.** Each sprint rounds its own value; a PI total is never
  rounded and redistributed.
- Consequently **`total_available` is the sum of the stored integers**, not the rounded sum of
  the floats. Across five sprints the two can differ by up to 2.5, and the board must agree
  with itself rather than with the team model.
- **The preview shows the integer it will write** (§6.7), with the PD/hours float beside it —
  never the unrounded number alone, or the review lies about its own outcome.

Used effort stays a float (`pbis.effort` is `Float`), so a capacity bar reads
`15.5/16 pts · 97%`. That asymmetry already exists today and is intentional: estimates are
fractional, budgets are whole.

A useful side effect for §6.6: **staleness compares the rounded integers**, so team edits too
small to move the budget — an absence shifted by half a day, a meeting shortened — leave the
project alone instead of nagging.

A derived value is **persisted** to the sprint (so exports, bars and snapshots keep working
with no special cases) and marked read-only in the sprint header. It is written **only by an
explicit push** (§6.7) — never as a side effect of editing a team, because that write would
land in a project someone else may be holding the lock on (§4). Sprints belonging to `closed`
PIs are never written. The header shows the source and the timestamp of the push it came
from, so a stale figure reads as stale.

#### The factor is the user's, entirely

`effort_unit` stays **free text** (`Text`, max 20, no enum — "pts" today, but nothing stops
"story points", "SP" or "mandays"). The app therefore cannot tell whether a unit means points,
hours or days, and **it does not try**. No normalised `capacity_basis` column, no unit
sniffing, no suggested factor, no "this looks wrong" warning.

`units_per_pd` is **always explicit and always the user's**: a float `> 0`, validated for
nothing beyond that. A project measuring in days sets 1.0; one measuring in hours sets its
own hours per PD; one measuring in points sets whatever its history says a person-day buys.
The tool has no opinion, because it has no way to form one that would not be a guess dressed
as a rule.

The guard rail is **the review step, not the schema** (§6.7). A wrong factor shows up as
wrong integers in the preview, before anything is written — which catches a misplaced decimal
far more reliably than any validation the app could infer. That is the whole reason the push
is review-then-apply.

### 6.5 Velocity-based normalisation is Phase 2, and here is why

`units_per_pd` = Σ completed effort over the last *N* closed sprints ÷ Σ team PD available
in those same sprints. It is the right answer, and note that it **needs no knowledge of what
the unit means** — it divides a project's own completed effort by its own PD, so the free-text
`effort_unit` decision above costs it nothing. It is, however, **not computable on today's
data**:

1. **"Done" is not knowable.** `project_states.category` (`not_started` / `in_progress` /
   `done`) exists on the model but is explicitly reserved — *nothing writes it*. Until states
   are categorised, no query can tell completed effort from planned effort.
2. **There is no history of what was completed *in* a sprint.** An item's state is mutable
   and carries no timestamp; snapshots are ad-hoc, user-triggered JSON dumps, so a project
   may have none over the relevant period. Velocity needs a **completed-effort figure
   recorded at sprint close** — a small, dated per-sprint row.
3. **The team must have existed over those sprints**, with its members, patterns and
   absences as they were then. Dated pattern versions (§3.3) supply the contract half of
   this, so historical PD is reconstructible; what is still missing is the first two points.

All three are tractable; none is free. `factor` is the Phase 1 method, and it degrades
honestly: a wrong factor is visibly wrong within one sprint.

### 6.6 Staleness

Because Available is pushed rather than live, a project can be **behind its team**. That
state is made visible rather than hidden:

- Each sprint stores `available_pushed_at` alongside its value.
- **Staleness is detected by comparing values, not by hashing inputs.** Recompute what the
  push *would* write — the **rounded integer** — and compare it to what is stored; a project
  is stale only if some sprint would actually change. An input fingerprint would flag an
  absence that was added and
  removed again, or a meeting moved within the same half-day — nagging about changes that
  make no difference is how people learn to ignore the badge.
- The check is cheap: a handful of sprints per PI, computed on read.

Surfaces: a badge on the PI board header and on the project row of the home page — *"3 sprints
differ from the team"* — opening the review dialog (§6.7). Because the team list sits on that
same page (§7.0), the stale project and the team that moved are visible together, and the team
row repeats the count per project it serves.

`manual` projects are never stale — nothing is meant to flow into them.

### 6.7 "Update project(s)"

The push is **review, then apply**, the same shape as the CSV import: show exactly what will
change, then let someone confirm it.

| Step | |
|------|--|
| `GET /api/v1/projects/{project_id}/team-capacity/preview` | Per sprint: current Available, proposed Available **as the integer that will be written**, delta, and the PD/hours float behind it. Writes nothing. |
| `POST /api/v1/projects/{project_id}/team-capacity/apply` | Writes the proposed values in one transaction. |

Both carry `project_id`, so both sit behind the existing `require_edit_lock` (§4.1) and the
existing 409 body with no new code.

Rules:

- Writes **only `sprints.available`**, and only for sprints in `draft` or `in_progress` PIs
  whose dates fall inside the requested window. Closed PIs are never touched.
- **Idempotent.** Applying twice with nothing changed in between writes nothing and reports
  no changes.
- Only meaningful for a `factor` or `velocity` assignment. On a `manual` project both
  endpoints return 409 `AVAILABLE_SOURCE_IS_MANUAL` — silently doing nothing would look like
  a bug.
- Broadcasts `sprint:available:pushed` to the project and writes one `activity_log` entry
  naming the team, the sprint count and the total delta.

#### Pushing to several projects

**Per project, not atomic across projects.** `POST /api/v1/teams/{team_id}/push` is a
convenience that loops the single-project endpoint and returns a result per project:

```
Project A  ✓ 3 sprints updated
Project B  ✓ no change
Project C  ✗ locked by mfranck until 14:32
```

Failing all three because Carla is editing project C would reintroduce exactly the
cross-project coupling this design removes. Projects are independent aggregates; alignment
between them is on **dates** (§6.8), which a push never changes. C simply stays stale, its
badge says so, and someone pushes it later.

### 6.8 Sprint date alignment

> *"the second and further project must align in sprint dates"*

- The **first project assigned to a team is the anchor**; its PI sprint dates define the
  team's sprint calendar.
- Alignment is checked between PIs **of different projects that overlap in time**: for each
  overlapping pair, matching sprint indices must have **identical** `start_date` and
  `end_date`. Pairing by PI name is not reliable — dates are the only common ground.
- **Enforcement:** a write that would break alignment is rejected — `409` with an error
  payload naming the conflicting project, PI, sprint index and the two date ranges. "Must
  align" is a constraint, not a preference; the alternative is a capacity number quietly
  attributed to the wrong fortnight.
- Alignment is enforced **from the moment a second project is assigned**. Pre-existing
  misaligned data is reported at assignment time as a blocking list to fix, and is never
  rewritten automatically.

---

## 7. Views

### 7.0 Where teams live

**The team list sits on the project list page.** `ProjectListPage` is already the app's home
— `App.tsx` renders it whenever no project is active — so it becomes a landing page with two
sections, **Projects** and **Teams**, rather than a new destination reached from somewhere
else. Teams are peers of projects, not a sub-feature of one, and the page that lists one
should list the other.

Colocation pays for itself immediately: the staleness badge (§6.6) appears on a project row
**right beside the team that caused it**, so "3 sprints differ from the team" and the team to
open are one glance apart.

Navigation follows the app: **there is no URL routing.** The active team lives in `uiStore`
beside `activeProjectId`, every view is reached by clicking, and a reload returns home.

Four consequences for the shell:

1. **`activeTeamId` joins `uiStore`**, and `setActiveTeam` clears `activeProjectId` exactly as
   `setActiveProject` already clears `activePIId`. The two are **mutually exclusive** — you
   are in a project or in a team, never both.
2. **`App.tsx`'s two-way branch becomes three-way**: `activeProjectId` → project views;
   `activeTeamId` → team views; otherwise the home page.
3. **The header's `EditLockButton` must not appear in team views.** It renders on
   `activeProjectId` today, and team editing takes no lock (§4.1) — offering one there would
   contradict the whole design.
4. **SSE subscribes to the team channel** while a team is active, as `useSSE(activeProjectId)`
   does for projects.

### 7.0.1 The sprint window, shared by the team views

Two team views show numbers per sprint — Capacity (§7.6) and the meeting totals in §7.5 — and
both need the same answer to "which sprints?".

**The sprint calendar comes from the team's anchor project** — the first project assigned to
it, which already defines the calendar every other project must align to (§6.8). A team with
no project assigned has no sprint calendar, and both views say so rather than inventing one.

**Only a sprint with both `start_date` and `end_date` can be computed.** An undated sprint is
selectable but every figure in its column reads **"—"**, never `0`: unknown and empty are
different, and a zero here would look like a team with no capacity rather than a sprint with
no dates.

**Sprint labels: `{PI name}.{n}`**, where *n* is the **1-based** sprint number — `Q3-2026.4`
for the fourth sprint, matching the board's own "Sprint 1…5" numbering over stored indices
0–4. Where the header has room, the date range goes beneath. ⚠️ PI names are free text up to
100 characters, so this compacts well for a PI called `8` and badly for one called
`Release train 2026 H2`; the label truncates on the PI part and never on the sprint number,
which is the half that disambiguates adjacent columns.

For Cypress: a `cy.openTeam(name)` alongside `cy.openProject(name)`. Note that project and
team names now share one page, so `cy.contains('Alpha')` can match either — specs must scope
to the section, the same way the existing suite anchors action labels.

### 7.1 Team list
Sits under the Projects section on the home page. Per row: team name, member count, and which
projects it serves — each with its staleness badge (§6.6) when the project is behind. Create /
rename / delete, and a row opens the team's views.

### 7.2 Members view
One row per member: name, validity dates, and the **currently effective** focus and hours per
day shown read-only, with the date they took effect. Editing either opens the working days
view (§7.3), because changing them means dating a new version — not overwriting a field.
Inline add / remove, reorderable.

### 7.3 Working days view
One row per member; 14 half-day toggles (Mon–Sun × am/pm) plus that version's **day length and
focus**. Column header toggles a whole weekday for every member; row header toggles a whole
member.

The grid always shows the pattern **in effect on a chosen date**, defaulting to today, with a
date picker above it — so the view answers "who works when" for any point in time, including
a future sprint. Each member's row carries a small version timeline (a marker per
`effective_from`) and a **"Change from…"** action that opens a new version pre-filled with the
current one; the header states which version is being edited and the range it covers. Editing
a date already in the past is marked as such, and warns that closed PIs will not move (§11).

### 7.4 Absences view
Day-scope grid, **4 months visible**, one row per member, scrolling by month. Default
window opens on the current month; when reached from a PI, on that PI's start month.

**The window is a display choice, not a limit on the data.** Absences, meetings and pattern
versions may be entered **years ahead** — annual leave is routinely planned twelve months out,
and a contract change can be dated further still. Nothing rejects a far-future date, and
nothing prunes one. Three consequences for the view:

- Scrolling must reach **any** month that holds data, not a fixed span around today.
- A **date jump** (month/year picker) — reaching September 2028 by scrolling is not a feature.
- A **12-month minimap** above the grid, which is both the density indicator and the
  navigation control. Bars mark the months holding entries; a **draggable frame** shows which
  4 months the grid below is displaying, so the relationship between the two zooms is *drawn*
  rather than explained. Drag the frame, or click a month bar, to move the grid. The minimap
  carries no member identity — names live in the grid's row labels.

The one bound is a **sanity check, not a horizon**: a date more than 10 years out is almost
always a typo'd year, so it warns and asks for confirmation. It never refuses.

**Each day is one column, split across its middle: morning above, afternoon below** — the
arrangement a calendar uses, and the one people arrive already able to read. A week is
therefore seven columns, ruled at the Monday. Stacking the halves is also what retires
"half-day" as a marking of its own: a morning off is the top half of a column filled, so the
vocabulary is just **absence, recurring, not working, weekend** (plus days a member is not yet
on the team). Nothing about the model changes — an absence still covers `(day, half)` pairs
and capacity still deducts per half-day (§3.4, §5.4); only the geometry says so more plainly.

Drag across cells to create; click an existing absence to edit or delete. A drag stays **linear in time**, as the stored rule is: dragging from Monday
morning to Friday morning means "Monday morning through Friday morning", filling the days
between, not "five mornings" — a range absence has one starting half and one ending half, and
there is no shape in the model for the other reading.

Member multi-select in the left column applies one entry to several or all members (§3.4) —
with everyone selected, this is how public and national holidays are entered, and individual
rows can be corrected afterwards for whoever works that day.

### 7.5 Meetings view — an attendance matrix, not a timeline

**Rows are members; columns are meetings.** Each cell says whether that member attends that
meeting. This is a participation grid, and it is deliberately *not* the calendar layout used
for absences (§7.4).

The reason is that the two views answer different questions. An absence is one person's, and
*when* is the whole content — a calendar is the only sensible shape. A meeting is shared, its
schedule is fixed once and rarely revisited, and the thing that actually changes week to week
is **who is in it**. A matrix puts that on one screen: six people against a dozen meetings, and
every gap visible at a glance.

It also disposes of a layout problem the timeline could not solve. A 15-minute stand-up and an
8-hour workshop on one row are either both unreadable or wildly out of proportion; as columns
they are simply two columns.

Each **column header** carries the meeting's identity and its schedule, since the grid no
longer shows time: title, duration, and the rule in words — *"Sprint planning · 120 min ·
every 2 weeks from 6 Apr"*, *"Stand-up · 15 min · weekly, Tue"*. Clicking it opens the same
modal used for absences (§3.4) to edit the rule, and offers delete.

Two totals earn their place:

- A **trailing column per member**: total meeting hours **for one selected sprint**. This is
  the number that reaches capacity, and it is otherwise invisible in a matrix.

  A matrix has no time axis, so the total needs a window that the grid itself cannot imply.
  The view therefore carries a **sprint selector** in its header, drawn from the anchor
  project's calendar (§7.0.1) and defaulting to the current or next sprint. Pick an undated
  sprint and every total reads **"—"**; a team with no project assigned shows the matrix with
  the totals column empty and a line saying why.
- A **footer row per meeting**: attendee count, and the cost in person-hours.

Column-header and row-header toggles select a whole meeting or a whole member, so "everyone
attends the stand-up" is one click. Adding a meeting adds a column.

### 7.6 Capacity view
**6 sprint columns**, scrolling left and right through time. One row per member plus a team
total. Each cell **leads with PD** and shows **hours** beneath it. The two are one number in
two units (§5.2), so which leads is a question about the reader, not about accuracy: people
plan and talk in person-days, and the spreadsheets this replaces have no hours in them at all.
Hours stay directly beneath because they are the exact figure and the one that traces.

Presence is shown separately from capacity, because they answer different questions and
conflating them is what the normalised day exists to prevent: a member can be *around* for 9
days and contribute 6.3 PD. The cell footer reads `9 d present · 6.3 PD`.

With a project selected, a second line shows the share-adjusted figure and the resulting
Available in the project's unit. Cells expand to a breakdown: contracted half-days → absences
→ meetings → focus, i.e. the §5.4 steps in order, so a surprising number can be traced to its
cause.

---

## 8. API and MCP Surface

### 8.1 REST endpoints

| Method | Path | Guard |
|--------|------|-------|
| `GET/POST` | `/api/v1/teams` | read / `require_editor_or_above` |
| `GET/PATCH/DELETE` | `/api/v1/teams/{team_id}` | read / editor |
| `GET/POST` | `/api/v1/teams/{team_id}/members` | read / editor |
| `PATCH/DELETE` | `/api/v1/teams/{team_id}/members/{member_id}` | editor |
| `GET/POST` | `/api/v1/teams/{team_id}/members/{member_id}/working-days` | read / editor |
| `PATCH/DELETE` | `/api/v1/teams/{team_id}/members/{member_id}/working-days/{version_id}` | editor |
| `GET/POST` | `/api/v1/teams/{team_id}/absences` | read / editor |
| `PATCH/DELETE` | `/api/v1/teams/{team_id}/absences/{absence_id}` | editor |
| `GET/POST` | `/api/v1/teams/{team_id}/meetings` | read / editor |
| `PATCH/DELETE` | `/api/v1/teams/{team_id}/meetings/{meeting_id}` | editor |
| `GET` | `/api/v1/teams/{team_id}/capacity?from=&to=` | read |
| `POST` | `/api/v1/teams/{team_id}/push` | editor — loops the per-project apply (§6.7) |
| `GET` | `/api/v1/projects/{project_id}/team-capacity/preview` | read |
| `POST` | `/api/v1/projects/{project_id}/team-capacity/apply` | editor + **existing** `require_edit_lock` |
| `GET/POST` | `/api/v1/teams/{team_id}/projects` | read / editor |
| `PATCH/DELETE` | `/api/v1/teams/{team_id}/projects/{project_id}` | editor |

`POST /absences` and `POST /meetings` accept a **`member_ids` array** and create one record
per member in a single transaction, returning them all. This is also how a public or national
holiday is entered — select everyone (§3.4).

Every team read returns an **`ETag`**; every team `PATCH` and `DELETE` requires **`If-Match`**
and answers a mismatch with **412** (§4.2). The push endpoints are project writes, not team
writes: they take no `If-Match` and answer **409** when another user holds the lock.

Every response uses the standard envelope. Team writes broadcast on the **team** channel
only; a project channel hears nothing until a push (§6.7) — which is the whole point of the
split:

`team:updated`, `team:member:*`, `team:absence:*`, `team:meeting:*`, `team:capacity:changed`
(team channel), and `sprint:available:pushed` (project channel, on push only).

### 8.2 MCP tools

Teams add a `mcp_server/tools/teams.py` module (`teams_mcp`), mounted in `server.py` beside
the existing eight. Read tools join `read.py`. The split matches the REST one — but five
things about this feature do **not** follow the existing tool patterns, and copying a
neighbouring module without noticing them will produce subtly wrong tools.

#### 1. Team write tools must **not** wrap `edit_lock()`

Every existing MCP write wraps its call in `edit_lock(project_id)` (`mcp_server/lock.py`),
which acquires the project lock and releases it in a `finally`. **Team writes take no lock**
(§4.1) and have no `project_id` to lock — the context manager is not merely unnecessary
there, it is unusable.

`push_team_capacity` is the exception and **does** wrap `edit_lock(project_id)`: it is a
project write like any other, and acquiring makes an agent's push atomic against a human
editor rather than racing them. The multi-project push loops per project and lets a `LOCKED`
failure on one skip to the next (§6.7), matching the per-project result the REST endpoint
returns.

#### 2. `412` is not currently mapped, and would surface as a raw exception

`_raise_for_error` in `mcp_server/backend.py` classifies 409, 403, 422 and 5xx, then falls
through to `r.raise_for_status()`. A **412** from `If-Match` (§4.2) would therefore reach the
agent as an unhandled httpx error rather than a typed `MCPBackendError`. It needs its own
branch, raising a **`STALE`** error whose message tells the agent to re-read and retry —
distinct from `LOCKED`, which means wait for a human, and from `CONFLICT`, which means the
request was wrong.

#### 3. Optimistic concurrency inside a single tool call

An agent does not hold an `ETag` between calls, so a team write tool performs its own
**read → `If-Match` → write** within one call. The window is narrow rather than absent, which
is the honest description: it protects against a human editing between the agent's own read
and write, not against one editing mid-call. On `STALE` the tool re-reads once and retries; a
second failure is returned to the agent rather than looped.

#### 4. Members are addressed by **name**, and unknown names are rejected

This follows the `create_state` precedent exactly, and for the same reason: an agent knows a
person as "Alice", not as a UUID, and an unrecognised name is far more likely a typo than an
intent to hire. A `resolve_member_id(team_id, name)` helper mirrors `resolve_state_id` —
returning the id, or raising with the list of members who do exist.

**No team write tool creates a member implicitly.** `create_member` is the deliberate act,
mirroring the Members view. Creating a person is at least as consequential as creating State
vocabulary, and the project's rule is already that vocabulary is created on purpose
(`docs/adr/0003-states-are-managed-explicitly.md`).

Absence and meeting tools take `member_names: list[str]` plus an explicit `all_members: bool`,
so "add Christmas for everyone" is one call rather than a fan-out the agent has to assemble —
the tool-level form of §3.4.

#### 5. `update_sprint` and `set_sprint_capacities` must refuse a derived Available

This is the trap with the widest blast radius. Both tools write the sprint capacity field
today. Once a project's `available_source` is `factor`, that value is derived (§6.4), and an
agent setting it by hand would produce a number the next push silently reverts — with nothing
in between to show the plan changed twice.

Both must return **409 `AVAILABLE_IS_DERIVED`** when the project's source is not `manual`,
naming `push_team_capacity` as the way to change it. The same guard belongs on the REST
`PATCH /sprints/{id}`, so the rule holds however the write arrives.

#### 6. Deletes follow the existing line: leaves yes, containers no

Deletions here are permanent — this app has no trash — so what an agent may delete is drawn
where the codebase already draws it.

**The existing pattern is not "no deletes".** Five of the eight tool modules expose one —
`delete_feature`, `delete_group`, `delete_state`, `delete_swimline`, `delete_pi_event`. What
the codebase withholds is deletion of the **top-level containers**: there is no
`delete_project` and no `delete_pi`, though both exist over REST. Teams sort onto the same
line:

| Exposed to agents | Withheld |
|-------------------|----------|
| `delete_absence`, `delete_meeting` | `delete_team`, `delete_member`, `delete_pattern_version`, `unassign_project` |

**Absences and meetings are leaf records** — one row, no cascade, recreated in a single call
if removed by mistake. They are the direct analogue of `delete_pi_event`, which is already
exposed, and an agent that can add Christmas for twelve members should be able to take it back
when the date was wrong. Withholding these would leave absences create-only, which is the
worse failure: a wrong row that only a human can clear.

**The withheld four all destroy something that cannot be retyped.** Deleting a member cascades
to their absences, meeting attendance and every pattern version (§10); deleting a team takes
all of that for everyone at once; deleting a pattern version silently rewrites capacity
history by merging intervals; unassigning a project drops the share and factor behind its
budget. These are the team aggregate's containers, and they stay with `delete_project` and
`delete_pi` on the human side.

⚠️ **One asymmetry remains, deliberately:** an agent can `create_member` and `assign_project`
but cannot undo either. That is the right way round — a spurious member is inert and visible
in the Members view, while the tool that would remove one is the most destructive call in the
module. `update_member` and `update_assignment` cover every correction short of removal.

#### 7. MCP is the bulk-entry path — there is no CSV import

The planning inputs live on a Confluence page (holidays, working days, absences, meetings) and
reach the app by an LLM reading that page and calling these tools. **No CSV import is
specified for teams**, and none should be: the source is a hand-maintained wiki table whose
shape drifts, which is what a model reads well and a parser does not.

That makes these tools a **bulk data path**, not an occasional convenience, and four things
follow that ordinary write tools do not need:

- **Bulk tools, not loops.** `bulk_create_absences` and `bulk_create_meetings` take a list and
  write it in one transaction — following `bulk_create_features` / `bulk_create_pbis` in
  `workflows.py`. Thirteen months for twenty people is thousands of rows; a per-row tool call
  would be unusable and would half-apply on any failure.
- **Re-import must be idempotent.** The page is re-read on a schedule, so the second run must
  not double every absence. Bulk writes take a **date window** and *replace* the team's
  absences within it, rather than appending. Replacement is the only rule that survives an
  entry being **deleted** from the page — a merge would keep it forever.
- **Preview before apply.** A bulk write reports what it would create, update and remove
  before touching anything, exactly as the push does (§6.7). The input is free text
  interpreted by a model; the review step is where a misread column is caught, and it is worth
  more here than anywhere else in this spec.
- **Report every unresolved name at once.** `resolve_member_id` raising on the first unknown
  name is right for a single write and wrong for a batch: a bulk call collects them all and
  returns the list, since name-order and spelling variants ("Anders Michel" / "Michel Anders")
  arrive in groups. Members are still never created implicitly (§8.2.4).

⚠️ An agent importing a new page will call `create_member`, and **cannot undo it** (§8.2.6).
A wrong or duplicated person stays until a human removes it. That is the accepted cost of
withholding `delete_member`, and it argues for the preview above rather than against the rule.

#### Tool inventory

| Module | Tools |
|--------|-------|
| `read.py` | `list_teams`, `get_team`, `list_members`, `list_absences`, `list_meetings`, `get_team_capacity`, `preview_team_capacity` |
| `teams.py` | `create_team`, `update_team`, `create_member`, `update_member`, `add_pattern_version`, `create_absence`, `update_absence`, `delete_absence`, `create_meeting`, `update_meeting`, `delete_meeting`, `assign_project`, `update_assignment`, `push_team_capacity` |
| `teams.py` (bulk) | `bulk_create_absences`, `bulk_create_meetings`, `preview_bulk_absences` |

`delete_absence` and `delete_meeting` are the **only** destructive tools. Removing a team, a
member, a pattern version or a project assignment is a human act, through the UI or the REST
API — which keep every operation in §8.1.

`preview_team_capacity` is a read tool on purpose: an agent should be able to answer "what
would this do" without holding a write capability, and it makes the review step (§6.7)
reachable from a read-only API key.

Returns stay dict-only — `call_backend` already wraps list payloads as `{"items": [...]}`.
Ids are validated with the `_UUID_RE` pattern the existing modules use.

#### Two consequences outside the team tools

- **Activity logging.** `MCPActivityMiddleware` records MCP writes automatically, and
  `activity_logs.project_id` is nullable, so a team write logs cleanly with it `NULL`. But it
  then appears in no project's activity view. Team writes should set
  `resource_type="team"` / `resource_id=team_id` so they remain findable, and a push should
  log against **both** the project and the team.
- **The `capacity` → `available` rename is a breaking tool-contract change.** `update_sprint`
  and `set_sprint_capacities` take a `capacity` parameter that agents and saved prompts refer
  to by name. Accept `capacity` as a deprecated alias of `available` for one release, warn in
  the tool description, then drop it — an unrecognised parameter would otherwise fail calls
  that worked yesterday, with no hint why.

---

## 9. Data Limits

| Entity | Maximum |
|--------|---------|
| Teams per instance | 50 |
| Members per team | 50 |
| Pattern versions per member | 50 |
| Absences per member | 2000 (multi-year plans are expected — §7.4) |
| Meeting **definitions** per team | 100 — recurrence collapses occurrences (§3.5) |
| Meeting duration | 5–480 minutes, in steps of 5 |
| Recurrence interval | 1–52 weeks |
| Role / organisation | 50 characters each |
| Absence or pattern date | No horizon; beyond 10 years warns (§7.4) |
| Projects per team | 20 |
| Focus (per pattern version) | 0.1–1.0 |
| Hours per day (per pattern version) | 1.0–12.0 |
| `normal_day_hours` (per team) | 1.0–24.0, default 8.0 |
| Absence / meeting label | 100 characters |

## 10. Deletion Semantics

Deletions are permanent — there is no trash anywhere in this app. Only absences and meetings
are deletable from MCP (§8.2); every other row below is deleted by a human, through the UI or
REST.

| Deleting | Effect |
|----------|--------|
| A member | Cascades to their absences, meeting attendance and every pattern version. Confirm dialog states the counts. Past sprint capacity changes as a result — prefer setting `active_to`. |
| A pattern version | Its interval merges into the preceding version. Affected projects go stale until pushed (§6.6). The earliest version cannot be deleted (§3.3). |
| A team assigned to projects | Blocked. Unassign every project first (explicit, so nobody loses a capacity model by accident). |
| A project with a team | Removes the assignment; the team survives. |
| An absence or meeting | Affected projects go stale until pushed (§6.6); no project row is written. A recurring entry is deleted **as a whole series** — there is no per-occurrence delete (§3.4). |

## 11. Edge Cases

| Case | Behaviour |
|------|-----------|
| Sprint with no dates | Contributes nothing; capacity view shows "—" |
| Team with no members | Capacity 0 PD / 0 h; `factor` yields Available 0.0 |
| Member absent the whole sprint | 0 PD, no warning |
| Meeting longer than its half-day | Spills into the other half of the same day (§5.4) |
| 8 h meeting for a 6 h/day member | Allowed; costs their whole day, capacity 0, never negative |
| Meeting starting on an absent half-day | Costs nothing; the spill reaches only surviving hours |
| Absence every second week | `kind = interval`, `interval_weeks = 2`, anchored on `start_date` |
| Recurring rule with no `end_date` | Open-ended; occurrences generated only inside the computed window (§3.4) |
| Meeting spanning several days | `kind = range`; each day in the range costs `duration_minutes` |
| Meeting with no attendees | Allowed — a column with an empty matrix costs nothing |
| Delete one occurrence of a recurring entry | Not possible; end the rule and start a new one, or add a one-day `range` (§3.4) |
| Meeting totals with no sprint selected | Column reads `—`; a team with no anchor project shows why (§7.5) |
| Undated sprint in any team view | Every figure reads `—`, never `0` (§7.0.1) |
| Long PI name in a sprint label | Truncates on the PI part, never on the sprint number (§7.0.1) |
| Absence dated years ahead | Accepted and stored; beyond 10 years warns (§7.4) |
| Re-import of an unchanged page | Window replacement writes nothing new (§8.2.7) |
| Bulk import with unknown names | All unresolved names returned together, nothing written |
| Meeting on an absent or non-contracted half-day | Not deducted |
| Overlapping absences | Counted once |
| Sprints overlapping each other in one PI | Capacity counted in both; alignment check flags it |
| `share_pct` sum > 100 | Amber warning on team and projects; never blocked |
| Push while another user holds the project lock | 409 with `locked_by` / `expires_at`; project stays stale, nothing partially written |
| Push to a team's projects, one of them locked | Others still apply; result lists the failure per project (§6.7) |
| Push with nothing changed | No write, reports no changes; safe to repeat |
| Team edit too small to move the rounded value | Not stale, nothing to push (§6.4) |
| Rounded value is 0 | Written as 0; the sprint genuinely has no budget (§6.2) |
| Available 0 with effort already placed | Over-capacity red, not `0/0 - 0%` gray (§6.2) |
| Σ sprint Available ≠ rounded PI total | Expected; each sprint rounds independently (§6.4) |
| Push to a `manual` project | 409 `AVAILABLE_SOURCE_IS_MANUAL` |
| `update_sprint` on a derived Available | 409 `AVAILABLE_IS_DERIVED`, whether from MCP or REST (§8.2) |
| Agent passes an unknown member name | Rejected, listing the members that exist (§8.2) |
| Agent creates a wrong absence | It can delete it — absences are leaf records (§8.2) |
| Agent creates a spurious member | It cannot delete it; inert and visible in the Members view for a human to remove (§8.2) |
| Team edited, never pushed | Project keeps its last pushed values and shows a staleness badge (§6.6) |
| Two editors change the same absence | Second write gets `412` with the current row (§4.2) |
| Team write without `If-Match` | Rejected — the header is required on `PATCH`/`DELETE` |
| Pattern version added, dated after today | Only sprints from that date forward would change on the next push; history is untouched by construction |
| Pattern version back-dated into a closed PI | Stored, but closed PIs are never recomputed; open ones are. UI warns before saving |
| Contract changes mid-sprint | Each half-day uses the version in force on its own date; hours simply add, so no special case (§5.4) |
| Date before a member's earliest `effective_from` | Uses the earliest version — it extends backwards without limit |

## 12. Decisions Taken

No open questions remain. The ones that shaped this document, and how they were settled:

| Question | Decision | Where |
|----------|----------|-------|
| Team capacity vs. the board's capacity number | Sprint keeps the project's effort unit; `capacity` renamed **Available**; team PD translates into it | §6.2, §6.4 |
| Splitting a team across projects | **Team-level `share_pct`** per project assignment | §6.3 |
| Meetings vs. focus double-counting | Meetings subtract **before** focus | §5.4 |
| Edit-lock scope for cross-project teams | No lock change — team routes fall outside it by construction; one explicit push meets the existing lock | §4.1 |
| Team-data concurrency | **`If-Match` from the start**, `412` on mismatch — not last-write-wins, not a team lock | §4.2 |
| Available as float or integer | **Whole number**, rounded once at the push boundary, half-up | §6.2, §6.4 |
| Can Available be 0 | **Yes** — `gt=0` → `ge=0`; zero is already reachable via snapshot restore | §6.2 |
| Free-text `effort_unit` | Left as is; `units_per_pd` is **always the user's**, the review step is the guard rail | §6.4 |
| Half-day as the computation unit | **No** — half-day is input, **hour** is the unit, day is display | §5.1 |
| What a person-day means | **`normal_day_hours`** (default 8.0), not the member's own day | §5.2 |
| Versioning working days | **`effective_from`**, half-open intervals, earliest extends backwards | §3.3 |
| Versioning `hours_per_day` and `focus` | **Both versioned** — everything that varies over time is dated | §3.3 |
| Public and national holidays | **No holiday entity** — an absence created for all members, correctable per person | §3.4 |
| Where teams live in the UI | **On the project list page**, as a peer section — not a separate destination | §7.0 |
| `role` and `organisation` | Optional, descriptive, **not versioned** — one team is staffed from several organisations | §3.2 |
| Planning horizon | **Unbounded data**, 4-month display window; 10-year typo warning | §7.4 |
| Recurrence model | **Three explicit kinds** — `range`, `weekly`, `interval` — shared by absences and meetings, one modal | §3.4, §3.5 |
| `interval` as its own kind | Yes, though `weekly` ≡ interval 1 — the common path should have nothing to fill in | §3.4 |
| Recurrence anchoring | On `start_date`, **not** ISO week parity, which breaks at year end | §3.4 |
| Meetings view shape | **Attendance matrix** (members × meetings), not a calendar — schedule is set once, attendance changes | §7.5 |
| Per-occurrence exceptions | **None** — recurring entries edit and delete as a whole series; an exception list is a second scheduling model | §3.4 |
| Sprint window for team views | From the **anchor project's** calendar; undated sprints read `—`, never `0` | §7.0.1 |
| Sprint labels | `{PI name}.{n}`, 1-based, truncating on the PI part | §7.0.1 |
| Capacity cell emphasis | **PD leads**, hours beneath — people plan in person-days | §7.6 |
| Role / organisation input | **Free-text combobox** suggesting values already used in the team; no managed vocabulary | §3.2 |
| A member's first pattern version | Created **with the member**, same transaction — no version reads as 0 capacity and looks like a bug | §3.3 |
| Absences minimap | 12-month strip **is** the navigation control; draggable frame = the 4-month viewport | §7.4 |
| Meeting duration | **5–480 minutes**, independent of the attendee's day; clamped at the **day** | §3.5, §5.4 |
| Bulk team data entry | **MCP, not CSV** — a wiki page read by an LLM; window-replacement for idempotency | §8.2.7 |
| MCP write tools and the lock | Team tools take **no** `edit_lock()`; only `push_team_capacity` does | §8.2 |
| Agents addressing members | **By name**, unknown names rejected — never created implicitly | §8.2 |
| Delete tools in MCP | **Leaves only** — `delete_absence` / `delete_meeting`, like `delete_pi_event`; containers withheld, like `project` and `pi` | §8.2 |

## 13. Deferred

| Item | Reason |
|------|--------|
| Velocity-based normalisation | Needs state categories and per-sprint completion records (§6.5) |
| Per-half-day contracted hours (asymmetric mornings) | Costs the toggle grid; revisit if real (§5.4) |
| Auto-push on team change | Deliberately rejected — it is the coupling §4 removes |
| More than one team per project | Draft says "one team, for now" |
| Linking members to application users | Deliberate non-goal (§3.2) |
| Absence categories / approval workflow | Draft says no categorisation |
| Per-member PBI assignment | Capacity is a team-level number in this design |
| Holiday calendar import (iCal, public API) | External integration |
| CSV import of team data | **Deliberately rejected** — the source is a wiki page read by an LLM through MCP (§8.2.7) |

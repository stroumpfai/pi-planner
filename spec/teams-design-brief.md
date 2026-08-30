# Design Brief — Teams & Capacity wireframes

**For:** Claude Design · **Source of truth:** [`spec/teams.md`](teams.md) · **Date:** 2026-08-30

This brief is self-contained: it carries the product context, the existing design system, the
screen-by-screen content, and realistic sample data. Where it disagrees with `teams.md`, the
spec wins — but everything here has been checked against it.

**Deliverable:** wireframes for eight new screens plus three modified surfaces, listed in §7
in priority order. Desktop-first; this is a planning tool used on laptops, not phones.

---

## 1. What the feature is

A PI-planning app for Product Owners. It has projects, program increments, swimlanes and
sprints, and each sprint carries a budget number the user types by hand. **Teams make that
number derivable** from who is on the team, how much they work, and when they are away.

The chain, which the wireframes must make legible:

```
members  →  contracted working days  →  minus absences  →  minus meetings
         →  × focus  →  hours per sprint  →  ÷ 8  →  person-days
         →  × the team's share of this project  →  × a conversion factor
         →  "Available", a whole number in the project's unit (pts / days / h)
```

**Sprint labels are `{PI name}.{n}`**, *n* 1-based — `Q3-2026.4`. PI names are free text up to
100 chars, so truncate on the PI part, never on the sprint number. A sprint missing a start or
end date shows **`—`** everywhere, never `0`, and the sprint calendar always comes from the
team's **anchor project** (the first one assigned).

⚠️ **PD is hours ÷ 8** — a fixed normalised day, *not* the member's own hours/day. A 6 h/day
member working a full 10-day sprint is 7.5 PD, not 10. This is the one number the wireframes
must not get wrong.

Three facts that shape the UI more than anything else:

1. **A team is independent of projects.** One team serves several projects; a project has at
   most one team. Teams are peers of projects, not a sub-feature.
2. **Nothing flows automatically.** Editing a team changes no project number. A separate,
   explicit **"Update project(s)"** action — preview, then apply — writes the budget. So
   projects can be *behind* their team, and that staleness must be visible.
3. **Only one person can edit a project at a time** (an existing app-wide lock), but team
   editing takes no lock at all. Two people can edit different team rows simultaneously.

---

## 2. Design system — use these exact values

The app is **neumorphic / soft-UI**: a single flat canvas colour with dual light/dark shadows
instead of borders. This is unusual and must be matched, not reinterpreted.

| Token | Light | Dark |
|-------|-------|------|
| `canvas` (page + card background) | `#f0f4f8` | `#1e2432` |
| `band` (subtle row/zone tint) | `#e4eaf1` | `#171c28` |
| `shadow-soft` | `4px 4px 10px rgba(163,177,198,.6)`, `-4px -4px 10px rgba(255,255,255,.8)` | `4px 4px 10px rgba(0,0,0,.5)`, `-4px -4px 10px rgba(255,255,255,.04)` |
| `shadow-soft-sm` | `2px 2px 6px rgba(163,177,198,.5)`, `-2px -2px 6px rgba(255,255,255,.7)` | `2px 2px 6px rgba(0,0,0,.4)`, `-2px -2px 6px rgba(255,255,255,.03)` |
| `shadow-soft-inset` (wells, tracks, inputs) | `inset 3px 3px 8px rgba(163,177,198,.5)`, `inset -3px -3px 8px rgba(255,255,255,.7)` | `inset 3px 3px 8px rgba(0,0,0,.5)`, `inset -3px -3px 8px rgba(255,255,255,.03)` |
| `shadow-soft-hover` | `6px 6px 14px rgba(163,177,198,.7)`, `-6px -6px 14px rgba(255,255,255,.95)` | `6px 6px 14px rgba(0,0,0,.6)`, `-6px -6px 14px rgba(255,255,255,.06)` |

- **Brand blue:** `#3b82f6` / `#2563eb` (hover) / `#1d4ed8`. Primary buttons are solid blue
  with white text — the one place the soft treatment is dropped.
- **Radius:** `rounded-xl` (12px) for cards and controls, `rounded-full` for bars and pills.
- **Semantic colours** (already used by the capacity bar): gray `<85%`, **amber** `85–100%`,
  **red** `>100%`. Reuse these for over-allocation and staleness.
- **Type:** headings 18–20px semibold; labels 12–14px; body 14px; table/grid cells 12px.
- **Spacing:** 8px base unit throughout.
- **Both themes are required.** The app has a real dark mode (`.dark` class).

**Existing components to stay consistent with**

- **Capacity bar** — a 6px `rounded-full` track with `shadow-soft-inset`, filled bar inside,
  label above in 12px gray: `15.5/16 pts · 97%`.
- **Modals** — Radix dialog, centred, `max-w-md`, `bg-white`/`dark:bg-gray-800`, `rounded-lg`,
  `shadow-xl`, 24px padding. Title 16px semibold, then a 16px gap, fields in a 16px stack,
  actions right-aligned at the bottom: secondary (outlined) then primary (solid blue).
  **One documented exception:** the absence/meeting dialog is `sm:max-w-2xl` (672px), because
  it is the only two-column modal in the app — a member checklist on the left, the schedule
  fields on the right. At `max-w-md` those stack, the date fields fall below the fold, and
  "all 6" stops being the one click it exists to be. `max-w-md` remains the default for every
  other dialog; widen a new one only with a reason of the same kind.
- **Lists** — a `canvas` card with `shadow-soft`, `rounded-xl`, rows divided by
  `divide-white/60`, row hover `bg-band/40`.

---

## 3. Navigation and app shell

**There is no URL routing.** The active project, PI and team live in client state; everything
is reached by clicking, and a browser reload returns to the home page. Do not design
breadcrumbs that imply URLs, and do not rely on a back button.

- The **home page** lists Projects and now also **Teams**, as two sections on one page.
- Opening a team replaces the main area with the team's own views; opening a project replaces
  it with the project's. You are in one or the other, never both.
- The **team views need a local tab bar**: Members · Working days · Absences · Meetings ·
  Capacity · Projects. Six tabs, plus the team name and a back-to-home affordance.
- The header's **"Request Edit Mode" button must not appear** while a team is open — team
  editing takes no lock. Design the team header without it.

---

## 4. Sample data — use this, not placeholders

A team of six, staffed from three organisations. Wireframes should show this data so the
layout is stress-tested by real name lengths, part-timers and gaps.

| Name | Role | Org | Days | h/day | Focus | Notes |
|------|------|-----|------|-------|-------|-------|
| Marta Lindqvist | PO | BIT | Mon–Fri | 8.0 | 0.8 | |
| Tomas Bergerat | Dev | Dev | Mon–Fri | 8.0 | 0.9 | |
| Aïcha Ben Salah | SW-Arch | Dev | Mon–Thu, Fri am | 8.0 | 0.7 | 90% |
| Rui Domingues | Test | ASTRA | Mon–Fri | 6.0 | 1.0 | |
| Katrin Hofstetter | UX | BIT | Tue, Wed, Thu | 8.0 | 0.9 | 60%, **80% from 1 Sep** |
| Jonas Wehrli | Dev | Dev | Mon–Fri | 8.0 | 0.9 | joins 1 Oct 2026 |

**Absences to show:** a two-week block (Rui, 20–31 Jul); a single day (Marta, 3 Sep); a
half-day (Tomas, 14 Sep am); a fortnightly recurrence (Aïcha, every second Friday from 4 Sep);
and a **team-wide holiday** (25 Dec, all six) — the last one is important because it is how
public holidays are entered.

**Meetings:** daily stand-up 15 min (all, 09:00); sprint planning 120 min; a **480-minute
all-day workshop** for two people — this one matters, see §5.6.

**Teams and projects:** team *Platform* serves *ISK Portal* (70%) and *Data Exchange* (30%).
A second team, *Frontline*, serves one project. Sprint budget unit is `pts`.

---

## 5. Screens

### 5.1 Home page — Teams section (modified)

Add a **Teams** section beneath the existing Projects list, same card treatment.

Per team row: name, member count, and the projects it serves. Each project it serves shows a
**staleness badge** when that project is behind the team — `3 sprints differ`, amber pill.

The point of putting teams here is that a project row and the team that feeds it are one
glance apart. Show a project row in the Projects list *also* carrying its staleness badge, so
the pairing is visible.

States to draw: populated; **empty** ("No teams yet — a team lets you compute sprint capacity
from who is available"); and a **reader** (no create/edit controls at all).

### 5.2 Members view

Table, one row per member: name, role, organisation, validity dates, and the **currently
effective** hours/day and focus shown **read-only with the date they took effect**.

Role and organisation are **free-text comboboxes** — they suggest values already used in the
team and accept anything typed. Not dropdowns: a dropdown implies a list somebody maintains,
and there is none.

**Add member creates the first working-days version in the same form**, dated to match the
member's "on the team from". A member with no version computes as zero capacity and reads as a
bug, so the two cannot be separated. One-click presets (full week, 80% Friday off, copy from…)
are where most will come from.

Editing hours or focus is *not* inline — it opens the Working days view, because changing them
means dating a new version rather than overwriting a field. Make that read-only-ness legible
without making it look broken or disabled.

Add / remove member, and drag to reorder.

### 5.3 Working days view — the versioned one

The hardest screen, and worth the most attention.

A grid: one row per member, 14 half-day toggles (Mon–Sun × am/pm), plus that member's day
length and focus.

**It always shows the pattern in effect on a chosen date**, with a date picker above the grid
defaulting to today. So it answers "who works when" for any point in time, past or future.

Each member row carries a **small version timeline** — a marker per `effective_from` — and a
**"Change from…"** action that opens a new version pre-filled from the current one. The header
must state which version is being edited and the date range it covers.

Use Katrin (60%, going to 80% on 1 Sep) to show a member with two versions and the timeline
non-empty. Editing a date already in the past must be visibly marked as such, with a warning
that closed PIs will not be recomputed.

```
Date shown:  [ 15 Sep 2026 ▾ ]              ← everything below reflects this date

              Mon    Tue    Wed    Thu    Fri    Sat  Sun   h/day  focus
Katrin H.    ○ ○    ● ●    ● ●    ● ●    ○ ○    ○ ○  ○ ○    8.0    0.9
             └─ timeline: ●───────●──────────      [Change from…]
                        1 Jan    1 Sep
```

### 5.4 Absences view

Day-scope grid, **4 months visible**, one row per member, scrolling by month. Each day is two
half-day cells, so a half-day absence is visibly half a day.

Needed because plans run years ahead:
- a **date jump** (month/year picker) — scrolling to Sept 2028 is not a feature;
- a **12-month minimap** that is both the density indicator and the navigation control: bars
  mark months holding entries, and a **draggable frame** shows which 4 months the grid below
  displays. Drag the frame or click a month to move the grid. No member identity in the strip.

Interactions: drag across cells to create; click an existing absence to edit or delete;
**multi-select members in the left column** to apply one entry to several or all — which is
how the 25 Dec holiday is entered. Show that selection state.

**The create/edit modal offers three kinds**, and the same modal is used for meetings (5.5):

| Kind | Fields |
|------|--------|
| **Range** | start date + half → end date + half |
| **Weekly** | weekday, am/pm/both, start date, **optional** end date |
| **Interval** | as weekly, plus "every *N* weeks" (2–52) |

An empty end date means open-ended, which must read as deliberate rather than unfinished.
Design the modal so picking a kind changes which fields show, and so the weekly case has
nothing extra to fill in.

For **Interval**, label the anchor **"First occurrence"**, not "runs from" — it decides which
alternate weeks are hit — and preview the next few occurrence dates as chips, since an
off-by-one week is invisible in the rule and obvious in the dates.

⚠️ **Recurring entries have no per-occurrence exceptions.** Editing or deleting one always acts
on the whole series. **Do not offer "this occurrence / the whole series"** anywhere — there is
only the series. One extra or missing day is a one-day Range alongside the recurrence; a
changed pattern is an end date plus a new rule.

Show a recurring absence (Aïcha's fortnightly Friday) rendering on every occurrence, visually
distinguishable from one-off entries.

### 5.5 Meetings view — an attendance matrix

**Not a timeline.** Rows are members, columns are meetings, and each cell says whether that
member attends. Absences are one person's and *when* is the whole content, so they need a
calendar; a meeting's schedule is set once and rarely revisited, while **who is in it** changes
constantly. The matrix puts that on one screen.

It also removes the layout problem the timeline had: a 15-minute stand-up and an 8-hour
workshop are unreadable together on one row, and trivial as two columns.

**Column headers carry the schedule in words**, since the grid no longer shows time:
*"Sprint planning · 120 min · every 2 weeks from 6 Apr"*, *"Stand-up · 15 min · weekly, Tue"*.
Clicking a header opens the same three-kind modal as absences (5.4) to edit the rule, plus
delete. Adding a meeting adds a column.

The matrix has no time axis, so the totals need a window the grid cannot imply: put a
**sprint selector** in the view header, drawn from the anchor project's sprint calendar and
defaulting to the current or next sprint. An undated sprint makes every total read `—`; a team
with no project assigned shows the matrix with the totals column empty and a line saying why.

Two totals must be visible:
- **trailing column per member** — total meeting hours **for the selected sprint**; this is the
  number that reaches capacity, and is otherwise invisible in a matrix;
- **footer row per meeting** — attendee count and cost in person-hours.

Row and column header toggles select a whole member or a whole meeting, so "everyone attends
the stand-up" is one click.

```
                  Stand-up   Planning    Retro      Workshop   │ Total
                  15 min     120 min     60 min     480 min    │
                  weekly Tue every 2 wk  every 2 wk 10–12 Jun  │
Marta Lindqvist      ●          ●           ●          ○       │  4.2 h
Tomas Bergerat       ●          ●           ●          ●       │ 12.2 h
Aïcha Ben Salah      ●          ●           ○          ●       │ 11.2 h
Rui Domingues        ●          ○           ●          ○       │  2.2 h
──────────────────────────────────────────────────────────────┴────────
attendees            6/6        4/6         5/6        2/6
person-hours         1.5 h      8.0 h       5.0 h     16.0 h
```

Design the empty state too: a team with no meetings has no columns.

### 5.6 Capacity view

**6 sprint columns**, scrolling left and right through time. One row per member plus a team
total.

Each cell **leads with PD** and shows **hours beneath** — one number in two units. PD leads
because people plan and talk in person-days, and the spreadsheets this replaces contain no
hours at all; hours sit beneath as the exact, traceable figure.

A footer line separates *presence* from *capacity*, because they answer different
questions: `9 d present · 6.3 PD`.

Cells expand to show the calculation in order — contracted half-days → absences → meetings →
focus — so a surprising number can be traced to its cause. **Design the expanded state**; it is
where the feature earns trust.

With a project selected, a second line per cell shows the share-adjusted figure and the
resulting Available in the project's unit.

```
                 Sprint 5        Sprint 6        Sprint 7
                 6–17 Apr        20 Apr–1 May    4–15 May
Marta L.         55.2 h          64.0 h          48.0 h
                 6.9 PD          8.0 PD          6.0 PD
                 10 d · 6.9 PD   10 d · 8.0 PD   8 d · 6.0 PD
─────────────────────────────────────────────────────────────
Team             105.2 h         132.0 h         96.0 h
                 13.2 PD         16.5 PD         12.0 PD
  ISK Portal 70% 9.2 PD → 14 pts 11.6 PD → 17 pts 8.4 PD → 13 pts
```

### 5.7 Projects tab — assignment and share

Which projects this team serves. Per assignment: project name, **share %**, how capacity
converts to the project's unit (typed by hand, or manual), and a staleness indicator.

**If the shares sum to over 100%, show an amber over-allocation warning** — a warning, never a
block. Draw this state; teams really are overcommitted and the tool exists to show it. Under
100% is normal and is not flagged.

### 5.8 "Update project(s)" — preview then apply

The only place team data reaches a project. **Review, then confirm** — the same shape as the
app's existing CSV import.

Per sprint: current Available, proposed Available **as the whole number that will be written**,
the delta, and the PD/hours behind it. Then Apply.

Multi-project push is **per project, not atomic**. Draw the result state:

```
ISK Portal      ✓ 3 sprints updated
Data Exchange   ✓ no change
Frontline API   ✗ locked by mfranck until 14:32
```

### 5.9 Sprint header with a derived Available (modified)

On the existing PI board, when a project's budget comes from a team: the Available figure is
**read-only**, labelled with its source and the timestamp of the push it came from, with a
staleness badge when the team has moved since.

The existing capacity bar stays exactly as it is. One new state to draw: **Available 0 with
effort already placed** — currently this would render `12/0 pts · 0%` in gray, when it is the
most over-committed a sprint can be. It must read as over-capacity **red**.

---

## 6. States that must appear somewhere

Not one screen each — fold them into the screens above, but do not omit them.

| State | Where it belongs |
|-------|------------------|
| Empty team, no members | Members view |
| Reader (read-only) — no edit affordances at all | Any one view |
| Over-allocation, shares > 100% | Projects tab |
| Staleness — "3 sprints differ from the team" | Home page, sprint header |
| Push blocked, `409` — "locked by mfranck until 14:32" | Push result |
| Stale row, `412` — "this absence changed under you" | Absences view |
| Undated sprint — capacity shows `—`, not `0` | Capacity view |
| Available 0 with effort placed — red, not gray | Sprint header |
| Past-dated edit warning — "closed PIs will not be recomputed" | Working days view |

`409` and `412` mean different things and must not look alike: `409` is *someone else is
editing, wait*; `412` is *this changed under you, here it is*.

---

## 7. Priority order

1. **Capacity view** (5.6) — the payoff screen; everything else feeds it
2. **Absences view** (5.4) — highest data volume, hardest grid
3. **Working days view** (5.3) — the versioning concept has no precedent in the app
4. **Update project(s)** (5.8) — the one moment team data becomes project data
5. **Home page Teams section** (5.1)
6. **Members** (5.2) and **Projects tab** (5.7)
7. **Meetings view** (5.5) — matrix, changed from the earlier timeline
8. **Sprint header** (5.9)

## 8. Out of scope for these wireframes

The existing PI board, backlog, project list rows, login, and user management — except the two
modified surfaces named in 5.1 and 5.9. No mobile layouts. No icon set design; assume a
standard line-icon library. No marketing or empty-product pages.

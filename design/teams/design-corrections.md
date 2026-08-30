# Corrections for the Teams & Capacity canvas

Paste this into Claude Design with the `Teams Capacity Wireframes` canvas open.

---

**First, replace the uploaded brief.** The copy in the project is stale — it predates several
decisions below, and the handoff README cites it as "source of truth for the maths". Upload
the current `spec/teams-design-brief.md` over it. Items 2, 4, 5 and 6 are already written
there, so this fixes them at the source rather than one board at a time.

Thanks for the last pass — the `÷ 8` correction, the `Present` / `After meetings` split, the
`6.8 PD` footers, and the sprint selector on the meeting-load column are all exactly right.
Eight things still conflict with the specification.

---

## 1. Remove "this occurrence / the whole series" everywhere

**Recurring absences and meetings have no per-occurrence exceptions.** Editing or deleting one
always acts on the whole series. There is no "just this one" — no exception list, no detached
occurrence, no split-on-edit — so the confirm dialog must not offer the choice.

The reason, so it does not get designed back in: an exception list is a second scheduling model
inside the first. It needs its own storage, its own conflict rules against `If-Match`, its own
answer for what a back-dated exception does to a closed PI, and its own display so an excepted
occurrence reads as deliberately missing rather than simply absent. The model already has two
adequate answers: a changed pattern is an end date plus a new rule (which is the truer record —
"every second Friday until October, then weekly" *is* two rules), and one stray day is a one-day
Range alongside the recurrence, since absences union.

Five places carry it today:

- **1b** — annotation: "Bin on a recurring entry asks: this occurrence / whole series"
- **1g** — the drawn chips `[This occurrence] [The whole series]`
- **8a** — component map: "Radix AlertDialog (confirm; recurring → occurrence/series)"
- **README §6** — "Recurring entries confirm this occurrence / whole series"
- **README §7** — "Editing a recurring entry asks This occurrence / The whole series"

Replacement copy: deleting a recurring entry confirms once, naming what goes —
*"Delete 'Free Friday' — every occurrence from 4 Sep onwards?"*

## 2. Role and Org are free-text comboboxes, not selects

**9a** draws both as `Dev ▾` dropdowns, and the README states them as closed vocabularies
(`role (PO · Dev · Test · UX · SW-Arch)`, `org_unit (BIT · Dev · ASTRA)`).

Both are **optional free text, max 50 chars**, entered through a combobox that suggests values
already used in that team and accepts anything typed. There is no roles table, nothing to
administer, and no rejection of an unknown value. A dropdown implies a list somebody maintains
and there is none; a plain text field spells "SW-Arch" four ways by the fourth member. The
suggestion list is derived from the team's own existing values, nothing more.

## 3. `interval` is a third stored kind, not a UI affordance

The README says `kind ∈ {range, weekly}` with Interval as "a UI affordance only, not a third
stored kind", and `interval_weeks ≥ 1 (default 1)`.

The specification stores **three kinds** — `range`, `weekly`, `interval` — and `interval_weeks`
starts at **2** (range 2–52). The two are mathematically the same rule with N = 1, and merging
them is tidier in the schema, but it puts a field reading "every `[1]` weeks" in front of
everyone entering an ordinary weekly absence. Three named kinds ask a question people can
answer; one kind plus a parameter asks them to encode an answer. The redundancy is one enum
value, and it buys the common path a form with nothing to fill in.

The three tabs in **3a / 4a / 4b** are already right — this is a model note, not a layout change.

## 4. Field names — align with the specification

The handoff README is what a coding agent names props and payloads from, so these matter:

| Currently | Should be |
|---|---|
| `valid_from` / `valid_to` | `active_from` / `active_to` |
| `org_unit` | `organisation` |
| `focus_factor` | `focus` |
| Meeting `name` | Meeting `title` |

Also `focus` is **0.1–1.0 in steps of 0.05**, not `0 < f ≤ 1`.

(`half_days` as 7 × {am, pm} is fine — the spec stores 14 named booleans, but that is a storage
detail, not a design one.)

## 5. Drop "a member with no version in effect" — it cannot happen

**1c** and the README both describe a member with no working-days version on the viewed date
(circles disabled, "—" in h/day and focus). That state is unreachable by construction:

- a member's **first version is created with the member**, in the same transaction; and
- the **earliest version extends backwards without limit**, so every date before its
  `effective_from` resolves to it.

Designing the branch means either dead UI, or implying the earliest version does *not* extend
backwards — which would silently break capacity for every date before a member's first version.

Keep the neighbouring rule, which is correct: a member outside `active_from` / `active_to`
renders "—" with a reason ("joins 1 Oct") and contributes nothing to team totals.

## 6. The capacity chain is missing the meeting clamp

README step 4 reads "− meetings the member attends that fall inside the sprint (minutes →
hours)". It needs the clamp, which is the whole reason meetings are placed in a half-day:

> A meeting consumes its duration from the half-day it **starts** in, then **spills into the
> other half of the same day**, and the day's total is **clamped to the hours remaining there**
> after absences.

Two cases this decides, both of which go wrong without it:

- An **8 h workshop for a member contracted 6 h/day** costs their whole day and stops — capacity
  reaches 0 and never goes below. Unclamped, it goes negative.
- A **full-day meeting** clamped per half-day instead would charge half its length, handing back
  the afternoon it plainly consumes.

A meeting starting on a half-day the member is absent costs nothing, because the spill can only
reach hours that survived the absence. Absence beats meeting, always.

## 7. `If-Match` covers every team row, not only absences

The README says `modified_at` travels "with every absence". It travels with **every team-owned
row**: team, member, working-days version, absence, meeting, and project assignment. Each returns
an `ETag`; every `PATCH` and `DELETE` requires `If-Match`; a mismatch is **412**. `POST` needs no
precondition — a create cannot clobber.

The yours/theirs banner in **1b** is the right treatment; it just applies more widely than one view.

## 8. Two modal widths — say so, or unify

`9a` is `sm:max-w-xl`, the absence/meeting dialog is `sm:max-w-2xl`, and the brief documents a
single exception to the app's `max-w-md`. Either fold Add-member to `2xl`, or record both as
exceptions with their reasons. The absence dialog's reason is already good ("the member column
earns it"); Add-member needs its own or should match.

---

## And one thing to add back

The README's scope note says the **sprint-header treatment inside a project** was sketched and
removed. It is specified and needs a wireframe — it is the only place team data becomes visible
inside a project:

- Available shown **read-only** with its source and the timestamp of the push it came from;
- a **staleness badge** when the team has moved since ("3 sprints differ");
- and the case the current component gets wrong: **Available 0 with effort already placed**.
  Today that renders `12/0 pts · 0%` in **gray**, when 12 points against no budget is the most
  over-committed a sprint can be. It must read as over-capacity **red**.

# CSV import samples

Small files for trying out the import by hand. The behaviour they demonstrate is
described in [`../csv-import-logic.md`](../csv-import-logic.md).

**Use a scratch project.** Several of these delete items, and deletions are
permanent.

Import `01-basic.csv` first — everything else is written against the state it
leaves behind (features `101` Authentication and `102` Reporting, stories
`201`–`204`, bug `301`).

| File | What to do | What you should see |
|---|---|---|
| `01-basic.csv` | Import into an empty project | 2 features + 5 stories created, States `New` and `Active` added to the lists |
| `02-update.csv` | Import after 01 | Feature 101 renamed, stories 201/202 updated, 205 created; 203, 204 and 301 untouched |
| `03-orphans.csv` | Import after 01 | 401 and 402 created under a new **Unassigned** feature; 201 already exists and stays under Authentication |
| `04-removed.csv` | Import after 01 | Reconcile screen lists feature 102 and bug 301. Tick both → 102 takes stories 203/204 with it. Leave 102 unticked → its two child rows are imported after all |
| `05-no-state-column.csv` | Import after 01 | Story 206 created; every existing State left exactly as it was |
| `06-parent-formats.csv` | Import after 01 | All four stories land under Authentication — no orphans |
| `07-type-change.csv` | Import after 01 | Story 202 offered as a promotion to a feature (unticked = row skipped); feature 101 reported as blocked and never demoted |
| `08-reparent.csv` | Import after 01 | Story 201 reported as moved to Reporting. Unticked it stays put; ticked it moves and loses any sprint placement |
| `09-errors.csv` | Import any time | 7 validation errors listed by line number, **Review changes** disabled, nothing written |
| `10-closed-dates.csv` | Import after 01, then mark `Done` (story list) and `Resolved` (bug list) as *done* in Manage States, then import it again | First import: "Dates read as month/day/year", and rows 3, 4, 5 and 8 listed as completion dates ignored, because the States it just added aren't *done* yet. Second import: stories 201, 202 and 204 get 3 Sep, 16 Sep and 28 Aug 2026; bug 301 gets 18 Sep from its `Resolved Date` |
| `11-dates-ambiguous.csv` | Import after 10 | The review asks for the date format. Day/month/year dates story 201 to 6 Mar 2026; month/day/year dates it to 3 Jun 2026 |
| `12-iterations.csv` | Create PI `PI 08` and, in Edit PI, set its iteration path to `Planner\PI 08` and sprints 1–2 to `Planner\PI 08\Sprint 08.1` / `…\Sprint 08.2`. Import after 01 | Feature 101 lands in PI 08 in a new **Needs Swimlane** lane; 201 goes to Sprint 1, 202 and bug 301 to Sprint 2. Feature 102 and story 203 (`Planner\PI 09…`, not mapped) stay in the backlog, and both PI 09 paths are listed as unmatched. Import it again: nothing changes |

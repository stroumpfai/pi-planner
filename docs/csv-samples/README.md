# CSV import samples

Small files for trying out the import by hand. The behaviour they demonstrate is
described in [`../csv-import-logic.md`](../csv-import-logic.md).
`frontend/src/utils/__tests__/csvSamples.test.ts` reads every file here, so a
sample whose errors or date format drift from this table fails the build.

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
| `09-errors.csv` | Import any time | 9 validation errors listed by line number — one of each: missing title, ID not a number, ID out of range, Effort not allowed, Effort not a number, Parent naming no ID, Parent ID out of range, duplicate ID, unknown Work Item Type (`User Story`). **Review changes** disabled, nothing written |
| `10-closed-dates.csv` | Import after 01, then mark `Done` (story list) and `Resolved` (bug list) as *done* in Manage States, then import it again | First import: "Dates read as month/day/year", and rows 3, 4, 5 and 8 listed as completion dates ignored, because the States it just added aren't *done* yet. Second import: stories 201, 202 and 204 get 3 Sep, 16 Sep and 28 Aug 2026; bug 301 gets 18 Sep from its `Resolved Date` |
| `11-dates-ambiguous.csv` | Import after 10 | The review asks for the date format. Day/month/year dates story 201 to 6 Mar 2026; month/day/year dates it to 3 Jun 2026 |
| `12-iterations.csv` | Create PI `PI 08` and, in Edit PI, set its iteration path to `Planner\PI 08` and sprints 1–2 to `Planner\PI 08\Sprint 08.1` / `…\Sprint 08.2`. Import after 01 | Feature 101 lands in PI 08 in a new **Needs Swimlane** lane; 201 goes to Sprint 1, 202 and bug 301 to Sprint 2. Feature 102 and story 203 (`Planner\PI 09…`, not mapped) stay in the backlog, and both PI 09 paths are listed as unmatched. Import it again: nothing changes |
| `13-epics.csv` | Fresh project | The export with Epic rows and three title columns: the same features and stories as 01, no errors. Epics 901/902 are not imported as items — the preview counts them, and each feature's modal shows its Epic (`[901] Security`) and Area Path; stories show Area Path, Committed (201 and bug 301: Yes) and their feature's Epic. Then import 01 on top: Area Path and Committed stay (01 has neither column), but the Epics clear — 01 has a `Parent` column and its features' Parent cells are blank |
| `14-dates-day-first.csv` | Import after 01 | "Dates read as day.month.year" — dotted dates are always day-first, so no date has to settle it. Feature 101 → `Active`; stories 201 and 204 → `Done`, and 204's Effort `0,5` (decimal comma) is read as 0.5 |
| `15-dates-conflicting.csv` | Import any time | `9/22/2026` is month/day and `22/9/2026` is day/month, so no single format reads both. Row 3 listed as an error, nothing written |
| `16-story-bug-switch.csv` | Import after 01 | Story 202 becomes a bug and bug 301 a story, both listed as changing *type*. The file has no `State` column, yet both lose their State — the old one belongs to the other list |
| `17-blank-ids.csv` | Import after 01, then again | A story and a bug created under Authentication, with no ID. `  active` and `ACTIVE` match the existing `Active` entries (case and spacing ignored), so no State is added. The second import creates both again — a blank ID never matches anything |
| `18-iterations-refresh.csv` | Import after 12 (same PI setup) | The refresh: feature 102, whose path names a *sprint*, lands in PI 08 · Needs Swimlane (features don't go into sprints); story 201 (path is the PI only) is taken out of Sprint 1; 202 moves Sprint 2 → Sprint 1; 203 goes to Sprint 2 — its path `planner/pi 08/sprint 08.2/` matches despite case, slashes and the trailing separator; bug 301 (blank path) stays in Sprint 2. Import it again: nothing changes |

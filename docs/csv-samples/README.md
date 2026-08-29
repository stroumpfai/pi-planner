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
| `09-errors.csv` | Import any time | 7 validation errors listed by line number, Confirm disabled, nothing written |

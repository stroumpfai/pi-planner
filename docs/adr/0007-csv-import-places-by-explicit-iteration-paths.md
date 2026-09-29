# CSV import places items on the board only through iteration paths set by hand

CSV import used to land everything in the backlog: a file could never set a PI, swimlane or
sprint. Once the backlog became something refreshed from Azure DevOps every week or so, that
meant every placement ADO already knew had to be redone in the planner after each refresh.

The import now reads `Iteration Path` and places an item when — and only when — the cell
matches an iteration path someone has set on a PI or a sprint (Edit PI). Anything else places
nothing.

## Why explicit paths, not parsing

A PI's name in the planner (`PI 08`) and its ADO iteration (`Planner\PI 08`) are different
strings with no reliable relation, and a planner sprint has no name at all, only an index.
Any parsing rule would be a guess that is right for one team's naming and silently wrong for
the next. Typing the path once per PI makes the match exact and the rule explainable in one
sentence. Paths are compared normalised (case, `/` vs `\`, stray separators and spaces) and
are unique across all PIs and sprints of a project, so a cell can never match two places.

## The rules that follow from "only when clear"

- **Unclear never moves anything.** A blank or unmatched cell leaves an existing item where
  planning put it; new items land in the backlog as before. The import never moves an item
  *to* the backlog: "not clear" is not an instruction. Unmatched paths are reported once each,
  since the usual cause is a PI not mapped yet.
- **A story follows its feature, never the reverse.** A story is placed only within its
  feature's PI. Features are placed first, so a feature and its stories that moved together
  in ADO land together in one import.
- **Named groups are left alone.** Only stories placed directly in a sprint (implicit groups)
  are moved; a story in a group a planner named is reported, not pulled out.
- **Split features are not moved.** A continuation is a board decision the CSV cannot express.
- **Closed PIs stay read-only**, as they are in the API.
- **No PI is created.**

## The swimlane gap

ADO has nothing that maps to a planner swimlane, and the board cannot hold a feature without
one. A feature newly placed in a PI therefore lands in that PI's **Needs Swimlane** lane,
created on demand and found by name, like the "Unassigned" placeholder feature. A feature
moving between PIs keeps its lane when the target PI has one of the same name. A sprint index
means nothing in another PI, so a cross-PI move drops the feature's groups; stories in the
file re-place themselves by their own path.

## Consequences

- The opt-out is per import and ticked by default in the dialog; the API default is off, so
  other callers are unchanged.
- `pis.iteration_path` and `sprints.iteration_path` are carried by snapshots and project
  export/import.
- MCP `create_pi`, `update_pi` and `update_sprint` take `iteration_path`, so an agent can
  map a PI; the read tools return it, and the snapshot diff reports changes to it. CSV import
  itself stays a UI flow — MCP has its own bulk-create tools, which place explicitly.

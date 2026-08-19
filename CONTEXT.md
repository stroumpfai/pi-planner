# PI Planner

A single-tenant tool for Product Owners to manage a backlog and plan Program Increments. This glossary fixes the vocabulary; architecture lives in `spec/design.md`.

## Planning structure

**Program Increment (PI)**:
A fixed-length planning window containing a sequence of Sprints. Abbreviated PI everywhere, including in code.
_Avoid_: Increment, release, quarter

**Sprint**:
A time-boxed slice of a PI, into which work is scheduled.
_Avoid_: Iteration

**Swimlane**:
A horizontal band of a PI board, used to group Features by team or theme.
_Avoid_: Row, track, lane

**Group**:
A named bundle of PBIs within a Feature, scheduled into a Sprint as a unit.
_Avoid_: Batch, bundle, cluster

**Backlog**:
The holding area for work not yet placed in a PI. Every imported item starts here.
_Avoid_: Inbox, icebox

## Work items

**Feature**:
The top-level unit of work. Owns PBIs; is placed on a PI board in a Swimlane.
_Avoid_: Epic, initiative

**PBI**:
A child of a Feature and the unit that carries effort. A PBI is either a Story or a Bug.
_Avoid_: Task, ticket, issue, work item

**Story**:
A PBI representing new or changed functionality. The default kind of PBI.
_Avoid_: User story

**Bug**:
A PBI representing a defect. A Bug is a PBI, not a separate entity — it differs from a Story only in kind and in the States available to it.
_Avoid_: Defect, issue

**Item type**:
Which of the three kinds a work item is: Feature, Story, or Bug. Determines which State List applies.
_Avoid_: Work item type, category, kind

## Identity

**User ID**:
The user-facing business identifier of a Feature or PBI (1–999,999), optional, editable, unique per project across Features and PBIs. Shown in the UI as `[101] Feature name`.
_Avoid_: Number, key, reference

**System ID**:
The internal database identity of an entity. Never shown in the UI.
_Avoid_: UUID, primary key, internal ID

## State

**State**:
A project-defined label describing where a work item stands, sourced from the `State` column of an imported CSV or added in the States editor. Purely descriptive today. Named `state` to match the CSV column and the existing `PI.state`.
_Avoid_: Status, workflow state, stage

**State List**:
The ordered set of States available to one Item type within one project. Each project has three — Feature, Story, and Bug — independent of each other and empty until a CSV import discovers values or someone adds them. Two States are the same if they match after trimming whitespace, ignoring case; the first spelling seen is the one kept. Entries are only ever created deliberately: assigning a State to an item picks from the list and never extends it.
_Avoid_: Status list, vocabulary, enum, taxonomy

**States editor**:
The modal behind "Manage States…" in Edit Project, where the three State Lists are added to, renamed, reordered and deleted. Renaming updates every item carrying the State, because items reference States by identity rather than by text; deleting one still in use is refused.
_Avoid_: State manager, status settings

**Removed**:
The `State` cell value in an imported CSV that means the matching work item is to be deleted from the project, along with its children. Deletion is permanent — there is no trash.
_Avoid_: Deleted, archived, cancelled

Note the word carries a second, unrelated meaning: a user may also add `Removed` to a State List in the States editor, where it is an ordinary descriptive label that deletes nothing. The two meanings meet if such an item is exported and re-imported, at which point the label is read as the control value and the item is deleted.

## Editing

**Edit Lock**:
The single, time-limited right to make changes to a project. Exactly one holder at a time; everyone else is read-only and sees changes live.
_Avoid_: Lease, mutex, checkout

**Snapshot**:
A stored copy of a project's full state at a point in time, restorable in place.
_Avoid_: Backup, version, revision

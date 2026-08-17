# Three State Lists per project, one per item type

A project's work-item States are stored as three independent lists keyed by item type — Feature, Story, and Bug — rather than one merged list per project. This mirrors Azure DevOps, the source of the CSV imports that populate them: Features move through `New / In Progress / Done`, Product Backlog Items through `New / Approved / Committed / Done`, and Bugs through `New / Active / Resolved / Closed`. A single merged list would offer a Bug the option `Approved` and a Feature the option `Committed` — states those work item types can never hold in the source system.

## Considered Options

**One merged list per project.** Simpler in every dimension: one list, one dropdown, one section in the Edit Project modal, no question about what happens when an item changes type. Rejected because it discards precisely the distinction that makes the imported vocabulary meaningful.

**Two lists, keyed by entity** (Feature and PBI, with Stories and Bugs sharing). Rejected for the same reason as merging — the Bug workflow is the one that most clearly differs, so a split that merges Bugs with Stories buys the cost of splitting without the benefit.

## Consequences

Changing a PBI between Story and Bug clears its State, because the old value belongs to a list the item no longer draws from. This happens in the item modal and on re-import, since CSV import overwrites `item_type` unconditionally. Clearing was chosen over copying the value into the target list, which would let a mis-click permanently pollute a list, and over keeping a dangling out-of-list value, which would undermine the point of a controlled list.

Reversing this — merging the three lists — means migrating three lists into one, deduplicating across them, and repointing every `Feature.state_id` and `PBI.state_id`.

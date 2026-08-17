# "Removed" is both a delete instruction and an ordinary State

The word `Removed` carries two unrelated meanings in this codebase, deliberately. In an imported CSV's `State` column it is a **control value**: the row is dropped before import and the matching Feature or PBI is deleted from the project, cascading to child PBIs and groups. In a project's State List it can also be an **ordinary label** that a user typed by hand, describing an item without deleting anything.

This is surprising, and a future reader hitting it will assume one of the two is a bug. It is not.

## Consequences

The two meanings meet on a round trip. An item labelled `Removed` by hand is written to the PI CSV export with `State=Removed`; re-importing that file reads the label as the control value and **deletes the item**. The decision was to accept this rather than warn at the point of choice or suppress `Removed` in the exporter.

`Removed` never enters a State List through import — imported Removed rows are deleted, so no surviving item carries the value and there is nothing for discovery to pick up. The only way it appears in a list is a user typing it.

Anyone tempted to "fix" this by making Removed rows import as ordinary items should know that would remove the delete-on-import behaviour deliberately built in commit `f4f2a2a`, including remove-with-parent cascading and the removal counts in the import preview.

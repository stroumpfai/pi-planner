# State vocabulary is never created as a side effect of editing an item

A project's three State Lists are vocabulary. Entries enter them only two ways: a CSV import discovering values in the file's `State` column, or someone adding one deliberately — a human in the States editor (Edit Project → Manage States…), an agent by calling the MCP `create_state` tool.

Assigning a State to a Feature or PBI is not one of those ways. The API accepts only `state_id` on item writes; a name that isn't already in the matching list is rejected. The web UI enforces the same rule by construction: `StateSelect` is a `<select>` over the list with a `(none)` option, with nothing to type into.

## Why

An earlier version let the item modals accept a typed State, creating it on save. That was a bootstrap measure — with no editor, free typing was the only way to fill an empty list — and it cost a vocabulary that grew by typo with no way to fix it. Adding the editor removed the reason for it, so the path went away with it.

The lists have a Rename that makes this affordable: because items reference States by `state_id` rather than by text, fixing `In Progres` → `In Progress` updates every item carrying it, with no data migration and no orphaned spelling.

## The asymmetry this creates for MCP

MCP has full write tools for States — `create_state`, `rename_state`, `reorder_states`, `delete_state` — and yet passing an unknown State name to `update_pbi` or `update_feature` is still rejected rather than creating the entry. Read as capability, that looks inconsistent: the agent is clearly allowed to extend the list.

It is not about capability, it is about intent. A new name arriving on `create_state` is the agent saying "this list needs this word". The same name arriving on `update_pbi` is almost always a hallucination or a typo, and silently minting vocabulary from it is how the list rots. The rejection message names the valid values and points at `create_state`, so an agent that genuinely wants a new State has an unambiguous way to ask for one.

The same asymmetry holds for humans, in the same shape: the States editor creates, the item modal only chooses.

## Consequences

- `resolve_state_assignment` in `backend/app/services/project_state.py` handles `state_id` only; `get_or_create_state` has exactly two callers left — CSV import and the states POST route.
- Item writes no longer broadcast `state:created`, and the frontend item hooks no longer invalidate `['states', projectId]` — a save can no longer change the list.
- Adding a value the list already holds is a `409 STATE_VALUE_TAKEN` rather than a silent hand-back of the existing entry, matching Rename. With an explicit Add button, returning a different entry than the one asked for is misleading feedback.

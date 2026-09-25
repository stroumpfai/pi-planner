# Whether a State means "done" is declared on the State, never inferred from its wording

Each entry in a project's three State Lists carries a `category`: `not_started`, `in_progress`, `done`, or null (uncategorised). Someone sets it deliberately — in the States editor, or through the MCP `create_state` / `set_state_category` tools. `done` is what makes a story or bug count as completed, which is what velocity is built on (`spec/team-achievement.md`).

Nothing derives a category from the State's text. Not on CSV import, not on create, and not as a pre-selected suggestion in the editor. A State an import discovers, `Done` included, arrives uncategorised.

## Why

The States come from Azure DevOps exports, and the vocabulary is whatever a team's process uses. A real export from this project carries `New`, `Estimated`, `Committed`, `In Progress`, `Ready for Review`, `Ready for Test` and `Done` for one work item type. Matching the word "done" would work for `Done`. It would fail silently for `Closed`, `Accepted` or `Erledigt`, and a project would stop counting the day someone renamed a column in ADO. Worse, it would succeed wrongly for a State such as `Done in dev`. A wrong velocity doesn't fail loudly. It just looks like a slow sprint.

The lists are already curated vocabulary with an editor (ADR 0003), so an explicit answer costs three dropdowns in a modal people already open.

## Considered options

**Match on wording, with the editor as an override.** Rejected: an override only helps someone who notices the inference was wrong, and a plausible-looking number gives nobody a reason to look.

**Pre-select a guess in the editor and let the user confirm.** Rejected for a quieter version of the same reason: a pre-filled answer gets accepted, not checked. The `ProjectStatesModal` test asserts that a State named `Done` shows *(none)*, so a well-meant "helpful default" can't slip back in.

## Consequences

- Until someone marks a State *done*, a project measures nothing, and every achievement surface says so rather than showing zeros.
- A list may hold several `done` entries (`Done` and `Closed` often coexist), and each of the three lists is categorised independently (ADR 0001).
- Recategorising a State does not stamp or clear completion dates on the items already holding it. Dates are recorded only when an item *moves* into or out of a done State, so marking `Done` as done after the fact leaves those items "done but undated". A CSV `Closed Date` import is the way to recover their history.

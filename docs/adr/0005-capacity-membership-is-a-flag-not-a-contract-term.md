# Whether a member counts towards capacity is an undated flag on the member

A team member carries `counts_towards_capacity` (default true). When it is false, the member stays on the team with everything else intact: working pattern, absences, meetings, and a row in every view. Their own capacity is still computed and shown in the Capacity view, below the team total. But it is never added to that total, so it reaches no project's share, no push to a sprint's Available, and none of the minimap's bars.

It exists so that a team can put on record the absences of people who bring no development capacity, such as a PO, an SM or a stakeholder. Their holidays shape a plan, but their hours are not the team's to spend. Before this flag, keeping them out of the numbers meant not adding them, and then their absences were nowhere.

## Why it is on the member and not on the pattern version

`spec/teams.md` §3.3 states a rule with no exceptions: everything that is an input to capacity lives on the dated pattern version, so that a change never restates a sprint already planned. This flag is an input to capacity, and it is deliberately not dated.

The rule exists for contract terms: which half-days someone owes, how long their day is, and how focused they are. Those change on a date and are tuned often. This flag says what kind of entry the row is. It is set when the member is added and changes about as often as their name. Putting it on the version would mean a fifteenth field there, reached only through the Working days view's "Change from…" flow, and it would be invisible in the Members view where people look for it. That is a lot of machinery for a value that almost never moves.

## Consequences

- Flipping the flag **restates every sprint, closed ones included**, for this member's contribution. The spec, the MCP `update_member` description and this ADR all say so.
- A person whose job really does change on a date (from PO to developer, say) is recorded by ending the old membership with `active_to` and adding them again from the next day. Their history stays attached to the row that was true at the time.
- The engine keeps one implementation. `compute_team_capacity` computes every member and totals only the counting ones. The report builds its team row the same way, so the Capacity view, the push preview and the push itself cannot disagree.
- The flag is set only by an explicit write: the add and edit dialogs, or the MCP `create_member` and `update_member` tools. Nothing infers it from `role`, which stays descriptive text that no calculation reads (§3.2).

# One project per team can take the remaining capacity

A team can mark **one** of its project assignments as taking the **remaining capacity** (`team_projects.share_remaining`). That project gets, from every member, whatever the team's other projects leave of them. A member booked for 2 of 5 days elsewhere gives it 3, and a member booked fully gives it nothing. The figure is worked out each time from the other assignments' shares, so it follows them when they change. The full rule is in `spec/teams.md` §6.3.4.

## Why

ADR 0009 and ADR 0010 made it possible to book some members partly onto projects: "Sara, 2 days a week on Billing". In practice, what such a team has left goes to one catch-all project. Before this, the planner had to type that leftover by hand, member by member. It went wrong as soon as any other booking changed, and nothing said so. Over-allocation is warned about (§6.3.3), but under-allocation is normal and is not, so a leftover that drifted down became silent slack.

## Considered options

**A fill button that writes the leftover as ordinary shares.** This needs no backend change. It was rejected because it drifts in exactly the way described above.

**A remaining share per member** ("Sara: the rest on Search"). This is more general, but several remainders on one member then need a rule for splitting what is left between them. The case that exists is one catch-all project for the whole team.

**Several remaining projects splitting the rest equally.** Rejected for the same reason. It is a split rule nobody asked for, and it would make each project's figure depend on how many others share the rest.

**One per team, for the whole team.** Chosen. Since no remainder depends on another, the result has no evaluation order and no cycles. A partial unique index on `team_projects(team_id) WHERE share_remaining = 1` holds the rule in the database, and the API refuses a second remaining project with `409 REMAINING_TAKEN`, naming the project that holds it.

## Consequences

- **One more kind of weight, not a second model.** `Share.remaining_of` holds the member's shares in the team's other projects, and its weight per pattern version is `max(0, 1 − Σ their weights)`. Absences, contract changes mid-sprint and the push all work as they do for percentages and days. `assignment_scope.load_scopes` reads the team's other assignments whenever it resolves a remaining one, so callers that ask about a single project, such as the push and staleness, get the same figure as the Capacity view.
- **Editing one project moves another.** Changing Billing's share changes Search's figures. This is undated, like every scope and share (ADR 0009). The views restate history, and a derived Available reads stale until it is pushed. The frontend re-reads staleness for all projects after any assignment write.
- **No share and no members.** A remaining assignment has `all_members = 1`, no `team_project_members` rows, and a `share_pct` that is not read. Sending a share or members together with `remaining` is a 422. Giving the project a share or a scope ends the remainder.
- **Load.** The remainder brings a member's load to exactly 100% and never past it. A member over-booked elsewhere is still flagged by their fixed shares. `MemberLoad.remaining_days` reports the leftover whether or not a project takes it, which is what the dialog's hint and the "nobody has anything left" check read.
- **MCP.** `assign_project` and `update_assignment` take `remaining`. The read tools show `remaining` on assignments and capacity rows, `remaining_days` on loads, and the team's `remaining_project_id`.

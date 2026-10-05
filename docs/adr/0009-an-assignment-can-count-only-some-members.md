# A project assignment can count only some of the team's members

A team's assignment to a project counts either the whole team (`all_members`, the default) or only the members listed for it in `team_project_members`. The assignment's `share_pct` then applies to the listed members' PD alone. Over-allocation is judged per member: a member's load is the sum of the shares of every assignment that counts them, and a load over 100% is warned about by name. The full rule is in `spec/teams.md` §6.3.

This exists for one team in which a few people work on one project exclusively while the rest cover everything else. The Portal counts {Anna, Bruno} at 100%, and Billing and Search count {Carla, Dario} at 60% and 40%.

## Why

Before this, `share_pct` was the only way to divide a team, and it applied to everyone. Giving the Portal 50% meant giving it half of everyone, including the two people who never touch Billing. A share that approximated "Anna and Bruno's PD" drifted every sprint, because absences move whose capacity is there.

## Considered options

**Split the team in two**, which was the only way to model this before. It works with no new code. But meetings belong to a team, so every shared ceremony has to be entered and kept in sync twice, and the Capacity and Achievement views show two teams where the people see one.

**A share per member per project**, for example Anna 70% Portal and 30% Billing. This is more general, and it is a superset of this design. It was deferred because "exclusive" is the case that exists, and a share grid per member is much more to enter and read. If it is ever needed, it can extend the join row with an optional `share_pct` without changing what an unlisted member or an unscoped assignment means.

**More than one team per project.** Still deferred (§13). It solves a different problem, people from two teams on one project, and it would make the push sum several teams' contributions.

**An empty member list meaning "everyone".** Rejected. With that rule, deleting the last listed member would silently hand the project the whole team, and its numbers would jump with nothing to say why. `all_members` is an explicit flag, and an assignment scoped to nobody reads 0 PD.

## Consequences

- **History moves.** The scope is undated, like `counts_towards_capacity` (ADR 0005), so changing it restates every sprint in the Capacity view and Achievement, closed ones included. Sprint Available is never rewritten: a derived project reads stale until someone pushes. Someone who moves between groups on a date is recorded as two memberships, as ADR 0005 describes.
- **One question, asked in one place.** `services/assignment_scope.py` answers whether an assignment counts a given member. The Capacity view's project rows, the push and its preview, staleness, and `member_loads` all go through it, so they cannot disagree. An unscoped project reads the team row itself and comes out as exactly the number it was before.
- **The team-wide share total is no longer the warning.** `TeamResponse.member_loads` carries each current, counting member's load. The home page and the Projects tab warn from it, and the Projects tab's footer groups members by load.
- **No foreign-key enforcement.** SQLite runs without `PRAGMA foreign_keys`, so scope rows are deleted by hand when a member, an assignment or a project is deleted. Deleting a project now also deletes its `team_projects` row. Before, that row was left orphaned and kept counting towards the team's project limit.
- **MCP.** `assign_project` and `update_assignment` take `member_names`, resolved by name like absences and meetings: an unknown name is refused and never creates a person. `update_assignment` also takes `all_members=true` to count everyone again.
- **The team JSON export is unchanged.** It already leaves out project assignments, because they reference project ids from another instance.

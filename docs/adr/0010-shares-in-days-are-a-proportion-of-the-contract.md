# A share can be days a week, as a proportion of each member's contract

A project's share can be entered as **days a week** as well as a percentage. It can be set on the assignment, or on one member as a share of their own that overrides the assignment's. "Anna, 2 days a week on X" means 2 of Anna's contracted days. That is 40% of a full-timer and 50% of someone on a 4-day contract. The engine weighs each pattern version by its own contracted days. The full rule is in `spec/teams.md` §6.3.2.

## Why

People are booked in days at least as often as in percentages, and a percentage does not fit when one person splits their week differently from the rest of the team. ADR 0009 let an assignment count only some members, and it deferred a share per member until it was needed. This is that extension, together with the unit people actually use.

## Considered options

"Two days a week" can mean three different things, and only one is built.

**A proportion of the contract.** Chosen. The days become a fraction of the member's week. Absences reduce every project in proportion, exactly as a percentage share already does, so one person's absence model doesn't depend on how their bookings were typed. It fits the existing model: a share is a weight on a member's net hours.

**Fixed weekdays** (Mon + Tue on X). Rejected for now. The engine works per half-day and could do it. But it needs a set of half-days per booking and a rule for how the other projects' percentages split what remains. It is also not how bookings are usually agreed here.

**A reserved amount** (X always gets 2 days, and absences come out of the other projects). Rejected. It changes how absences are distributed, makes one project's figure depend on every other project's bookings, and has no meaning when the absences exceed the remainder.

**Days against a standard 5-day week, rather than the member's own contract.** Rejected. A part-timer booked "2 days" works 2 of *their* days, so 50% of a 4-day contract, not 40%.

## Consequences

- **Days are stored as days** on `team_projects.share_days` and `team_project_members.share_days`, and are never converted on save. If a member's contract changes, their booking still means 2 days. A contract change mid-sprint weighs each side by its own contract, using the per-version net hours that `MemberCapacity.net_hours_by_version` now records. That is what lets the weight be applied without a second pass over the half-days.
- **A uniform percentage keeps its old arithmetic.** When every counted member gives the assignment's percentage, the project's PD is still the counted members' PD × share, so existing figures don't move.
- **A days share above the contract** takes the member's whole capacity and no more, and it shows as a load over 100%: warned, never refused. A member with no contracted days gives nothing.
- **The load** (`member_loads`) is now a float percentage plus days a week against `contracted_days`. Days convert against the contract in force today.
- **Undated,** like the scope (ADR 0009): changing a share restates the history in the views, and sprint Available waits for a push.
- **MCP.** `assign_project` and `update_assignment` take `share_days` and `member_shares`, a list of members by name, each with `share_pct` or `share_days`. As with the scope, an unknown name is refused.

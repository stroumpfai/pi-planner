# A feature and its continuations are one work item

`POST /features/{id}/split` carries unfinished stories into a later PI by creating a second Feature row pointing back at the first through `continued_from_feature_id`. The two rows are one work item in the source system, drawn as one lineage on the board, and coloured as one by `getFeatureColorIdx`.

Three operations now treat them that way:

- **Deleting a feature deletes its continuations**, transitively, along with their stories and groups. `delete_features` is the only path — `DELETE /features/{id}` and CSV import removals both go through it.
- **A CSV row updates every member of the lineage.** A matched row's title and State are applied to all of them, not just the row that matched.
- **A new story joins the newest leaf**, not the root — the PI the feature has reached, not the one it started in.

Only the root carries a `user_id`. `split_feature` does not copy it, and `UniqueConstraint(project_id, user_id)` would reject it if it tried, so a business ID names a lineage rather than a row. `app/services/continuation.py` holds the walks that turn one into the other.

## Why deletion cascades rather than refusing

The alternative was to refuse, the way `cancel-continuation` refuses on a non-leaf, and make the user cancel continuations first. Cascading won for two reasons.

The CSV import is the deciding one. A `State = Removed` row means the work item is gone from the source system; it says nothing about PIs, because the source has no idea the work was split. Refusing would fail the whole import — it is one transaction — over a structure the file cannot describe and the user did not create in the file.

The second is that leaving a continuation behind is not actually an option. SQLite runs here without `PRAGMA foreign_keys`, so the `ON DELETE SET NULL` on `continued_from_feature_id` never fires, and the survivor keeps a pointer to a deleted row. That feature is then unreachable: `cancel-continuation` answers 404 for a missing origin, CSV import cannot match it because it has no `user_id`, and the lineage walks skip it. The only way out was deleting it by hand.

## Consequences

Deleting a backlog feature is unchanged — a feature with no continuations has a lineage of one.

Deleting a feature on a board can now destroy work in PIs the user is not looking at, so the count has to be visible before they confirm. The reconcile step in `ImportCSVModal` names the PIs a candidate spans and totals the stories and continuations going with it; `FeatureRow`'s confirmation covers the backlog case, where there are none.

`removed_stories` in the import result now counts stories deleted with their feature. It previously reported `0` for them, and — the reason this mattered more than the number — never broadcast `pbi:deleted`, so every other connected client kept the deleted stories in cache.

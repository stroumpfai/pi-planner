# Specification: Direct Story Placement in Sprints

**Status**: Draft  
**Date**: 2026-05-10  

---

## 1. Overview

Today, PBIs and Bugs can only appear in a sprint via a **named Group** (a user-created container). This spec adds a second path: dragging individual stories directly from the feature zone into a sprint column, without first creating a group.

Both placement modes coexist in the PI board:

| Mode | Description |
|------|-------------|
| **Group-based** (existing) | User creates a named group, adds stories to it, drags group to a sprint |
| **Direct placement** (new) | User drags one story from the feature zone directly into a sprint column |

---

## 2. Use Cases

### 2a — Group, then place
Stories from a feature are logically related and should be planned together:
1. User multi-selects PBIs/Bugs → creates a named Group
2. User drags the Group to a sprint column
3. Stories are hidden from the feature zone

### 2b — Place directly
A single story (PBI or Bug) belongs to a feature but will be delivered in a specific sprint independently:
1. User drags a single story from the feature zone to a sprint column
2. Story disappears from the feature zone immediately
3. No group is needed; the system creates an **implicit group** automatically

---

## 3. Implicit Group

When a story is placed directly into a sprint, the system creates an **implicit group** to wrap it. This keeps the data model and sprint layout consistent with group-based placement.

### 3.1 Appearance

The implicit group renders in the sprint column with the **story's own title** as the header (e.g. `Login flow`), visually identical to a named group but without a user-assigned name. Each directly-placed story gets its own implicit group — there is no aggregation by feature.

```
Sprint 2
┌─────────────────────────────┐
│ Backend Infra  (named group)│
│  · Story 1                  │
│  · Story 2                  │
├─────────────────────────────┤
│ Login flow          ← auto  │
│  · Login flow               │
├─────────────────────────────┤
│ Bug 42: NPE on load ← auto  │
│  · Bug 42: NPE on load      │
└─────────────────────────────┘
```

### 3.2 Rename → becomes a normal group

The user can click the implicit group header to rename it. After saving a non-empty name:
- The group becomes a **regular named group** (no longer implicit)
- The header shows the user-provided name instead of the story title
- The group behaves identically to any manually created group (other stories can be added to it)

### 3.3 One implicit group per story

Each directly-placed story always gets its own implicit group, even if another story from the same feature is already in the same sprint. There is no automatic aggregation. Two stories from the same feature in the same sprint will appear as two separate implicit groups.

---

## 4. Drag-and-Drop Interaction

### 4.1 Source: feature zone

Only stories that are currently **ungrouped** (visible in the feature zone) can be dragged directly to a sprint. Stories already inside a group are not draggable from the feature zone.

**Constraint**: The parent feature must be in the PI (not in the backlog). Backlog feature stories cannot be placed in sprints.

### 4.2 Target: sprint column

The drop target is any sprint column (Sprint 1–5) within the parent feature's swimlane. Cross-swimlane placement is not allowed; drop zones in other swimlanes are not highlighted and reject the drop.

### 4.3 Visual feedback during drag

- Valid drop zone (correct swimlane, sprint column): highlight with standard group drop indicator
- Invalid zone (wrong swimlane, feature zone of another swimlane): show no-drop cursor

### 4.4 On drop

1. Story is removed from the feature zone (no longer "ungrouped")
2. System creates or reuses an implicit group in the target sprint column (see §3.3)
3. Story appears in the sprint column under the implicit/named group header
4. Sprint effort recalculates immediately

---

## 5. Actions on Directly-Placed Stories

### 5.1 Move to another sprint

User drags the **implicit group** (or its containing story) to a different sprint column in the same swimlane. All stories inside the group move together. This is the same as moving a named group between sprints.

### 5.2 Return to feature zone

User removes a story from the implicit group (via context menu "Remove from sprint" or drag back to the feature zone). The story becomes ungrouped again and reappears in the feature zone. If the implicit group becomes empty after removal, it is deleted automatically.

### 5.3 Convert implicit group to named group

User clicks the implicit group header and types a name (see §3.2).

### 5.4 Merge into an existing group

User can drag a story from an implicit group into a named group within the same sprint. The story moves to the target group and the now-empty implicit group is deleted automatically. Merging into another implicit group is not allowed — rename the target first to create a named group.

### 5.5 Reorder within sprint

Groups (implicit and named) can be reordered within a sprint column by dragging, identical to the current group reorder behavior.

---

## 6. Capacity and Effort

Directly-placed stories contribute to sprint effort **identically to stories inside named groups**. Story points of all stories in a sprint (regardless of whether they are in named or implicit groups) are summed into the sprint's total effort and reflected in the utilization bar.

No separate accounting for "direct" vs "grouped" effort in the UI.

---

## 7. Data Model Changes

### 7.1 Groups table — add `is_implicit` flag

```sql
ALTER TABLE groups ADD COLUMN is_implicit BOOLEAN NOT NULL DEFAULT FALSE;
```

| Column | Type | Notes |
|--------|------|-------|
| `is_implicit` | BOOLEAN | `true` = auto-created for direct placement; `false` = user-named |

An implicit group is identical to a named group in all other respects (swimlane_id, feature_system_id, sprint_index, order_index, PBI relationships).

When the user renames an implicit group, `is_implicit` is set to `false` and `name` is updated.

### 7.2 Uniqueness constraint (implicit groups)

Each implicit group wraps exactly one story, enforced by a partial unique index on the story (PBI) side:

```sql
CREATE UNIQUE INDEX uq_implicit_group_story
  ON groups (story_system_id)
  WHERE is_implicit = TRUE;
```

This requires adding a `story_system_id` FK column to the groups table (nullable; only set for implicit groups):

```sql
ALTER TABLE groups ADD COLUMN story_system_id UUID REFERENCES pbis(system_id) ON DELETE CASCADE;
```

### 7.3 PBI table — no changes

The existing `group_id` (nullable FK to groups) is sufficient. A directly-placed story is assigned to the implicit group's `system_id`, just like any grouped story.

---

## 8. API Changes

### 8.1 Place story directly in sprint

`POST /api/v1/projects/{project_id}/stories/{story_id}/place`

**Request body**:
```json
{
  "sprint_index": 2
}
```

**Behavior**:
1. Validates story is ungrouped and its parent feature is in the PI
2. Creates an implicit group named after the story, linked to `story_system_id`, in the feature's swimlane at `sprint_index`
3. Assigns `story.group_id = implicit_group.system_id`
4. Returns updated story and group

**Response** (`200 OK`):
```json
{
  "data": {
    "story": { "system_id": "...", "group_id": "..." },
    "group": {
      "system_id": "...",
      "is_implicit": true,
      "sprint_index": 2,
      "name": null
    }
  },
  "meta": { "timestamp": "..." }
}
```

**Errors**:
- `409` — story is already in a group
- `422` — parent feature is not in the PI
- `422` — sprint_index out of range (0–4)

### 8.2 Remove story from sprint (return to feature zone)

`DELETE /api/v1/projects/{project_id}/stories/{story_id}/place`

**Behavior**:
1. Sets `story.group_id = null`
2. If source group is implicit and now empty → deletes the group
3. Returns updated story

### 8.3 Groups API — expose `is_implicit`

All existing group endpoints (`GET /groups`, `POST /groups`, `PATCH /groups/{id}`) include `is_implicit` in their response payload.

`PATCH /groups/{id}` with a `name` field on an implicit group sets `is_implicit = false`.

---

## 9. Constraints and Validation

| Rule | Enforcement |
|------|-------------|
| Parent feature must be in the PI (not backlog) | Backend validation on place endpoint |
| Story cannot be in two groups simultaneously | DB constraint: unique group_id per story (existing) |
| Drop target must be the feature's own swimlane | Frontend drag validation + backend validation |
| sprint_index must be 0–4 | Pydantic validator |
| Each story has at most one implicit group | Partial unique DB index on story_system_id (§7.2) |
| Renaming an implicit group requires a non-empty name | Frontend + backend validation |

---

## 10. Out of Scope

- Dragging a story from the **backlog** feature zone directly into a sprint (feature must be in the PI first)
- Placing a story that is currently inside a named group (must remove from group first, or use group drag)
- Cross-swimlane direct placement
- Bulk direct placement (multi-select drag) — only single-story drag in this iteration

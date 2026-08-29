# PI Planning Application — Product Specification (Phase 1 MVP)

## Vision

A single-tenant web-based application supporting a team's PI (Program Increment) planning and roadmap management. Enables creation and management of Features and PBIs with minimal training. Only one user can edit at a time; others access in read-only mode.

---

## 1. Authentication & Access Control

### 1.1 Authentication

- **Login required** to access the application
- **Single-tenant**: All team members login to the same workspace
- **Credentials**: Username and password (stored hashed in database)
- **Session management**:
  - Session expires after 1 hour of inactivity
  - "Remember me" checkbox persists session for 30 days (optional)
  - Logout clears session
- **User profile**: Username (required, unique), display name (optional)
- **No registration**: Admin creates user accounts (Phase 2)

### 1.2 Edit Mode Lock (Single-Writer Pattern)

- **Only one user can edit at a time**
- **Read-only users**: See live updates, cannot modify
- **Acquiring edit lock**:
  - User clicks "Request Edit Mode" button
  - Server grants lock immediately (no queuing)
  - Edit indicator shows "You • Editor" (green dot)
- **Lock timeout**: 30 minutes of inactivity
  - Auto-save triggered before release
  - Lock released; other users see "Edit mode available"
- **Lock release**: User clicks "Release Edit Mode", logs out, or browser inactive 30 min
- **Browser crash/close**: Lock auto-released after 5 minutes of no heartbeat
- **Heartbeat**: Client sends ping every 1 minute to reset timeout
- **Read-only indicator**: Amber banner: `[Username] is editing · Read-only for you`

### 1.3 Access Control

- **Phase 1**: All authenticated users have full access to all projects
- **Phase 2**: Admin roles, project-level permissions

---

## 2. Data Model

### 2.1 Core Entities

#### Feature
- **System ID** (`system_id`): Internal UUID primary key, never shown to users
- **User ID** (`user_id`): Optional integer 1–999,999, user-visible, editable anytime, unique per project
- **Title**: Required, max 255 characters
- **Description**: Optional, plain text only, max 2000 characters
- **Effort**: Optional, positive integer story points
- **Location**: `backlog` or `{piId, swimlaneId}`
- **Timestamps**: `created_at`, `modified_at`

#### PBI (Product Backlog Item)
- **System ID** (`system_id`): Internal UUID primary key
- **User ID** (`user_id`): Optional integer 1–999,999, unique per project (shared namespace with Features)
- **Title**: Required, max 255 characters
- **Description**: Optional, plain text only, max 2000 characters
- **Effort**: Optional, positive integer story points
- **Item type**: `pbi` or `bug`
- **Parent Feature System ID**: Required FK to `features.system_id`
- **Location**: `backlog` or `{piId, swimlaneId, groupId}`
- **Timestamps**: `created_at`, `modified_at`

#### PI (Program Increment)
- **System ID**: UUID
- **Name**: Required, max 100 characters (e.g., "Q2-2026")
- **State**: `draft` | `in_progress` | `closed`
- **Start/End Date**: Informational only
- **5 fixed sprints** per PI (indices 0–4), each with capacity and optional dates

#### Swimlane
- **System ID**: UUID
- **Name**: User-provided, required, max 100 chars, unique per PI
- **PI ID**: FK to parent PI
- **Order index**: Determines visual order, reorderable

#### Group
- **System ID**: UUID
- **Name**: User-provided, required, max 100 chars, unique per swimlane (or auto-generated for implicit groups)
- **Feature ID**: Single Feature (all PBIs in group must belong to same Feature)
- **Sprint Index**: 0–4
- **Swimlane ID**: FK to parent swimlane
- **`is_implicit`**: Boolean — `true` when auto-created by direct story placement

#### Project
- **System ID**: UUID
- **Name**: Required, unique per tenant, max 100 chars

### 2.2 Dual-ID System

Every Feature and PBI has two identifiers:

| Aspect | System ID | User ID |
|--------|-----------|---------|
| Primary key | Yes | No |
| DB FK references | All | None |
| User-visible | No | Yes |
| Mutable | No | Yes |
| Required | Yes | No (nullable) |
| Scope | Global | Per project |
| Format | UUID | Integer 1–999,999 |

- **Display**: `[101] Feature Title` when user_id is set; blank otherwise
- **API calls**: Always use `system_id` in URLs and relationships
- **Uniqueness**: Features and PBIs share the user_id namespace per project

### 2.3 Data Constraints

- User IDs: Optional, 1–999,999, unique per project across Features and PBIs combined
- Effort: Positive integer if provided
- Swimlane names: Unique within a PI
- Group names: Unique within a swimlane
- Only one PI can be `in_progress` at a time
- A Feature can only appear in one swimlane at a time
- Groups contain PBIs from one Feature only
- PBIs can only be in one group at a time

---

## 3. Backlog Area

### 3.1 Structure

- Simple list view: Features (expandable to show child PBIs)
- No grouping or swimlanes in backlog
- PBIs only grouped when moved to a PI

### 3.2 Item Management

#### Create Feature
- Mandatory: Title
- Optional: Description (plain text), Effort, User ID (1–999,999)
- Feature created in backlog

#### Create PBI
- Select parent Feature first
- Mandatory: Title
- Optional: Description, Effort, User ID, Item type (PBI/Bug)
- PBI added to parent Feature in backlog

#### Edit Items
- Editable fields: Title, Description, Effort, User ID (can be changed or cleared)
- Changing user ID validates uniqueness in project
- Requires edit lock; auto-saved on completion

#### Delete Items
- Requires confirmation dialog
- **Delete Feature**: Cascades to all child PBIs; removes Feature from any PI swimlane; deletes all its groups
- **Delete PBI**: Removed from group; if group becomes empty, group is deleted
- Deletions are **permanent** (no undo)

#### Move to PI
- Drag Feature from backlog to a PI swimlane (feature zone)
- All child PBIs remain ungrouped in feature zone initially

#### Return to Backlog
- Drag Feature from PI swimlane back to backlog
- All groups in sprint columns **silently deleted**
- PBIs return to ungrouped state

### 3.3 Text Format

- **Plain text only** (Phase 1)
- Line breaks preserved
- Max 2000 characters per description

### 3.4 Display & Sorting

- **Default sort**: By creation date (newest first)
- **Alternative sort**: By name (A-Z)
- Preference stored in localStorage
- Search deferred to Phase 2

---

## 4. PI Planning

### 4.1 PI Lifecycle

- States: **Draft → In Progress → Closed**
- Can move backwards: In Progress ↔ Draft, Closed ↔ In Progress (requires confirmation)
- **Closed PIs**: Read-only (no modifications)
- **Only one PI can be "In Progress"** at a time; transitioning a new PI auto-closes the previous one (requires confirmation)
- Multiple Draft PIs allowed

### 4.2 PI Board Structure

#### PI Header
- Shows: Name, State, Date range
- Actions (edit mode): state transition buttons, edit PI details

#### Sprint Column Headers (5 fixed columns)
- Sprint number and date range
- **Capacity**: User-set story points
- **Total effort**: Sum of all group efforts (derived)
- **Utilization bar**: `[used]/[capacity]pts [%]`
  - Gray (< 85%), Amber (85–100%), Red (> 100%)

#### Feature Zone
- Fixed width ~90–110px
- Shows Features placed in swimlane with ungrouped PBIs
- Drop target for Features from backlog

#### Swimlanes
- Span entire PI (Feature zone + 5 sprint columns)
- **Header** (collapsible): name, feature count, capacity bar, context menu (rename, delete, reorder)
- **Body**: Feature zone + sprint columns with groups

### 4.3 Swimlane Management

- **Reorder**: Drag swimlane header up/down, or use "Move up"/"Move down" in context menu
- **Reorder allowed**: Draft and In Progress states only
- **Delete empty swimlane**: No confirmation
- **Delete non-empty swimlane**: Requires confirmation; Features return to backlog; groups deleted

### 4.4 Grouping & Sprint Assignment

#### Create Group
1. Multi-select PBIs from same Feature (checkbox or Ctrl+click)
2. "Create Group" action → enter group name (required, max 100 chars)
3. Group appears in Feature zone (unassigned)
4. User drags group to a sprint column

#### Group Operations
- **Edit**: Rename, reorder PBIs within group, move PBIs between groups
- **Assign to sprint**: Drag to sprint column
- **Move between sprints**: Drag to different sprint column (same swimlane only)
- **Ungroup**: PBIs return to feature zone ungrouped; group deleted (not allowed in Closed PI)
- **Delete**: Group deleted; PBIs return to feature zone ungrouped (no confirmation)

### 4.5 Direct Story Placement in Sprints

Stories (PBIs/Bugs) can be dragged directly from the feature zone into a sprint column without creating a named group first.

#### Implicit Groups
- System auto-creates an **implicit group** wrapping the single story
- Renders with the story's title as the header
- Behaves identically to named groups in all other respects
- User can rename it → it becomes a regular named group (`is_implicit = false`)
- One implicit group per directly-placed story; no auto-aggregation

#### Constraints
- Source story must be ungrouped (in feature zone)
- Parent feature must be in the PI (not backlog)
- Drop target must be a sprint column within the feature's own swimlane
- Cross-swimlane placement not allowed

#### Merge
- Story from implicit group can be dragged into a named group (implicit group auto-deleted when empty)
- Merging into another implicit group requires renaming the target first

### 4.6 Effort & Capacity Tracking

- **Group effort** = sum of child PBI efforts (blank = 0)
- **Feature zone effort** = sum of ungrouped PBI efforts
- **Swimlane effort** = sum of all group efforts across all sprints
- **Sprint effort** = sum of all group efforts in that sprint (across all swimlanes)
- **PI total effort** = sum of all group efforts
- **PI total capacity** = sum of all sprint capacities

Sprint capacity: Set by clicking sprint header (integer, required, positive)

---

## 5. Item Movement & Drag-and-Drop

### 5.1 Movement Table

| What | From | To | Result |
|------|------|----|--------|
| Feature | Backlog | Swimlane feature zone | Feature placed in swimlane |
| Feature | Feature zone | Different swimlane | Feature moves swimlane |
| Feature | Feature zone | Backlog | Returns to backlog; all groups deleted |
| Group (named or implicit) | Feature zone | Sprint column | Group assigned to sprint |
| Group | Sprint column | Different sprint (same swimlane) | Group moves sprint |
| Story | Feature zone | Sprint column | Implicit group created (direct placement) |
| PBI | Within group | Reorder | PBI position changes |
| PBI | Group A | Group B (same feature) | PBI moves group |
| Swimlane | Position N | Position N' | Swimlane reordered |

### 5.2 Visual Feedback

- Source: dimmed ghost
- Valid drop targets: accent border highlight + "Drop here"
- Invalid targets: dimmed, no highlight
- Escape key cancels drag
- Auto-scroll near viewport edge

### 5.3 Constraints

- Feature in one swimlane at a time only
- Groups in one sprint at a time only
- PBIs in one group at a time (or ungrouped)
- PBIs in a group must come from same Feature

---

## 6. Multi-select & Batch Operations

- **Selection**: Checkbox or Ctrl+Click (Cmd+Click on Mac)
- **Selectable**: Features, PBIs, Groups (not swimlanes)
- Selected items highlighted with accent background
- **Batch actions**: Delete selected (with confirmation), Move to PI, Create group (from PBIs of same Feature)

---

## 7. UI/UX Interactions

### 7.1 Confirmation Dialogs Required

| Action | Confirmation |
|--------|-------------|
| Delete Feature (with PBIs) | Yes |
| Delete swimlane (with content) | Yes — "Content will return to backlog" |
| Delete PBI | Yes |
| Delete group | No |
| Move Feature to backlog | No |
| Move group to different sprint | No |
| Transition PI state (Draft ↔ In Progress) | Yes |
| Close PI | Yes — "PI will become read-only" |

### 7.2 Edit Indicator

- **You are editing**: "You • Editor" (green dot)
- **Someone else editing**: Amber banner: `[Username] is editing · Read-only for you` + expiry countdown
- **Available**: "🔓 Request Edit Mode" button
- Banner dismissible (doesn't affect lock state)

---

## 8. Data Persistence & Export

### 8.1 Auto-save

- Trigger: Every user action (create, edit, delete, move)
- Debounce: 100ms
- Optimistic updates: UI updates before server response
- Save indicator: Brief checkmark at bottom-right (disappears after 2 seconds)

### 8.2 Edit Lock Timeout Behavior

- **On 30-min inactivity**: auto-save → lock released → notification: "Edit session expired. Save completed. Read-only mode."

### 8.3 Project Export

- **Format**: JSON
- **Scope**: All PIs (including closed), swimlanes, backlog items, all Features and PBIs, metadata
- **Trigger**: "Export Project" button
- **Output**: Browser downloads `[ProjectName]_[Date].json`
- **No user data**: No usernames, edit history, or access logs included

### 8.4 Project Import (Phase 2)

- Creates new project (no overwriting existing)

---

## 9. CSV Import

### 9.1 Entry Point

"Import CSV" button in the backlog view (requires edit access). Imports into the currently open project.

### 9.2 CSV Format

Expected columns (any order): `State`, `ID`, `Work Item Type`, `Title 1`, `Title 2`, `Effort`, `Parent`

| CSV value | Application entity |
|-----------|-------------------|
| `Feature` | Feature |
| `Product Backlog Item` | PBI |
| `Bug` | Bug (story with `item_type = bug`) |

### 9.3 Import Rules

- **Row filtering**: Rows where `State = Removed` are silently discarded
- **Title resolution**: Features use `Title 1`; PBIs/Bugs use `Title 2` with fallback to `Title 1`
- **Effort**: Blank or `0` → null; positive integer → stored as-is; non-numeric → validation error
- **Parent resolution**: a story's `Parent` is matched first against the Feature rows in the
  file, then against Features already in the project. A partial export — this sprint's new
  stories, with no Feature rows at all — therefore links correctly instead of orphaning
- **Orphan stories** (`Parent` matches no Feature in the file *or* the project): placed under
  auto-created "Unassigned" Feature
- **Duplicate IDs** (user_id already exists in project): existing item is **updated** (title overwritten; parent link not changed)

### 9.4 Validation (All-or-Nothing)

Import is atomic: any validation error cancels the entire import. User sees all errors before confirming.

| Rule | Error message |
|------|---------------|
| Missing title | Row {n}: missing title |
| Unknown Work Item Type | Row {n}: unknown type "{value}" |
| Non-numeric Effort | Row {n}: effort must be a number |
| Duplicate ID within file | Row {n}: ID {id} appears more than once in this file |
| ID outside 1–999,999 | Row {n}: ID out of allowed range |

### 9.5 Import Flow

1. User selects `.csv` file
2. Client-side parse + preview summary (total rows, removed, features, stories, orphans, errors)
3. If no errors: user confirms
4. Backend re-validates and executes in a single transaction
5. Post-import report: created/updated counts, orphan count

### 9.6 Limitations

- Only `.csv` files accepted
- All items land in backlog (no PI/sprint/group assignments)
- Imported items have no description (not in CSV format)

---

## 10. Data Limits

| Entity | Maximum |
|--------|---------|
| Features per project | 999 |
| PBIs per Feature | 999 |
| Swimlanes per PI | 99 |
| Groups per sprint column | 99 |
| PBIs per group | 100 |
| Concurrent readers | 10 (1 writer + 9 readers) |
| Edit lock timeout | 30 minutes |
| Description length | 2000 characters |
| User ID range | 1–999,999 (optional) |
| User ID uniqueness | Per project (Features and PBIs share namespace) |

---

## 11. Design System

### Colors
- **Accent (active)**: Blue or amber for active states, in-progress PI, drag highlights
- **Warn**: Amber for capacity at 85–100%
- **Error**: Red for over-capacity (> 100%)
- **Neutral**: Grays for inactive states, borders

### Typography
- **Headings**: Bold, 18–20px (PI name, swimlane name)
- **Labels**: Regular, 12–14px (sprint headers, feature zone)
- **Body**: Regular, 14px (item titles, descriptions)

### Spacing
- **8px base unit**: All margins/padding multiples of 8px
- **Swimlane padding**: 16px
- **Group card padding**: 12px

### Capacity Bar
- **Height**: 3px
- **Colors**: Gray (< 85%) → Amber (85–100%) → Red (> 100%)
- **Label**: `[used]/[capacity]pts [%]`

---

## 12. Screens (Phase 1)

1. **Login**: Username/password, "Remember me", submit
2. **Project List**: All projects, active highlighted, export button
3. **Backlog Panel**: Features list, expandable PBIs, create/import buttons
4. **PI Board**: Swimlanes, sprint columns, groups, feature zone, drag-drop
5. **Edit Lock Indicator**: Status bar with editor name or "Request Edit Mode" button

---

## 13. PI Board Layout Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  PI: Q2-2026 (In Progress) | Apr 1 – May 30, 2026                           │
├─────────────┬──────────────┬──────────────┬──────────────┬──────────────────┤
│ FEATURE ZONE│  SPRINT 1    │  SPRINT 2    │  SPRINT 3    │  ...             │
│             │  Cap: 40 pts │  Cap: 40 pts │  Cap: 35 pts │                  │
├─────────────┼──────────────┼──────────────┼──────────────┼──────────────────┤
│ SWIMLANE: Backend                                                            │
├─────────────┼──────────────┼──────────────┼──────────────┼──────────────────┤
│ [101] Auth  │ Group:       │ Group:       │              │                  │
│ 45 pts      │ Login UI     │ Session Mgmt │              │                  │
│ ○ PBI-102   │ 13 pts       │ 13 pts       │              │                  │
│ ○ PBI-103   │ • PBI-101    │ • PBI-104    │              │                  │
│ [Create Grp]│ • PBI-102    │ • PBI-105    │              │                  │
├─────────────┼──────────────┼──────────────┼──────────────┼──────────────────┤
│ SWIMLANE: Frontend                                                           │
├─────────────┼──────────────┼──────────────┼──────────────┼──────────────────┤
│ [201] Dash  │              │              │ Group:       │                  │
│ 38 pts      │ (empty)      │ (empty)      │ Charts       │                  │
│ ○ PBI-203   │              │              │ 8 pts        │                  │
│ ○ PBI-204   │              │              │ • PBI-205    │                  │
│ [Create Grp]│              │              │ • PBI-206    │                  │
└─────────────┴──────────────┴──────────────┴──────────────┴──────────────────┘
```

---

## 14. Deferred to Phase 2

| Feature | Reason |
|---------|--------|
| Advanced authentication (registration, roles, admin panel) | Out of MVP scope |
| Dependency management (predecessor/successor) | Graph complexity |
| Advanced search & filtering | Full-text indexing |
| Rich text descriptions | Editor library + sanitization |
| Notifications (email, in-app) | External service integration |
| Audit logs & change history | Data retention policies |
| Real-time concurrent editing (CRDT) | Architecture complexity |
| Burndown charts, velocity tracking | Analytics infrastructure |
| Azure DevOps / Jira integration | Third-party API work |
| Keyboard shortcuts | Phase 1 not needed |
| Project import from JSON | Complements export |

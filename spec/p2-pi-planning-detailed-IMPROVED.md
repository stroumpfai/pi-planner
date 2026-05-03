# P2 PI Planning - Detailed Specification (Phase 1 MVP)

## Vision
A single-tenant web-based application supporting a team's PI (Program Increment) planning and roadmap management. The application enables creation and management of Features and PBIs with minimal training. Only one user can edit at a time; others access in read-only mode. Single-user login required.

---

## 1. Authentication & Access Control

### 1.1 Authentication (Phase 1 - Basic)
- **Login required** to access the application
- **Single-tenant**: All team members login to the same workspace
- **Credentials**: Username and password (stored hashed in database)
- **Session management**: 
  - Session expires after 1 hour of inactivity
  - "Remember me" checkbox persists session for 30 days (optional)
  - Logout clears session
- **User profile**:
  - Username (required, unique, alphanumeric)
  - Display name (optional, shown in edit lock indicator and comments in Phase 2)
  - Role: None in Phase 1 (all authenticated users have equal access)
- **No registration**: Admin creates user accounts (Phase 2 feature)

### 1.2 Edit Mode Lock (Single-Writer Pattern)
- **Only one user can edit at a time**
- **Read-only users**: See live updates, cannot modify
- **Acquiring edit lock**:
  - User clicks "Request Edit Mode" button (when read-only)
  - Server grants lock immediately (no queuing)
  - Edit indicator shows: "You • Editor" or username + green dot
  - User can now create/edit/delete items
- **Lock timeout**: 30 minutes of inactivity (no mouse/keyboard)
  - Auto-save triggered before release
  - Lock released, other users see "Edit mode available"
- **Lock release**:
  - User clicks "Release Edit Mode" button
  - Logout automatically releases lock
  - Browser close/crash: lock auto-released after 5 minutes of no heartbeat
- **Heartbeat**: Client sends "still alive" ping every 1 minute to reset timeout
- **Read-only users**: See amber banner: `[Username] is editing · Read-only for you`

### 1.3 Access Control
- **In Phase 1**: All authenticated users have full access to all projects
- **In Phase 2**: Admin roles, project-level permissions, view-only roles

---

## 2. Data Model

### 2.1 Core Entities

#### Feature
- **System ID** (`feature_id`): Internal database primary key (UUID or auto-increment, system-generated, never exposed to user)
- **User-provided ID**: Optional numerical identifier (set by user, max 999999, can be left blank)
  - If provided, must be unique within project (no duplicates)
  - User can rename/change this ID anytime
  - Not used as database primary key (used for business reference only)
  - When left blank, system generates a placeholder for display
- **Title**: Required, max 255 characters
- **Description**: Optional, plain text only, max 2000 characters
- **Effort**: Optional, integer story points (1, 2, 3, 5, 8, 13, 21, 34, ...)
- **Created**: Timestamp (auto-generated)
- **Modified**: Timestamp (auto-updated on edit)
- **Location**: "backlog" or `{ piId, swimlaneId }`
- **Child PBIs**: One or more (if all PBIs deleted, Feature remains)

#### PBI (Product Backlog Item)
- **System ID** (`pbi_id`): Internal database primary key (UUID or auto-increment, system-generated, never exposed to user)
- **User-provided ID**: Optional numerical identifier (set by user, max 999999, can be left blank)
  - If provided, must be unique within project (no duplicates with Features)
  - User can rename/change this ID anytime
  - Not used as database primary key (used for business reference only)
  - When left blank, system generates a placeholder for display
- **Title**: Required, max 255 characters
- **Description**: Optional, plain text only, max 2000 characters
- **Effort**: Optional, integer story points (same as Feature)
- **Parent Feature System ID**: Required (enforces referential integrity via system IDs, cannot be null)
- **Created**: Timestamp (auto-generated)
- **Modified**: Timestamp (auto-updated on edit)
- **Location**: "backlog" or `{ piId, swimlaneId, groupId }`

#### PI (Program Increment)
- **ID**: Auto-generated UUID
- **Name**: Required, max 100 characters (e.g., "Q2-2026", "PI-5")
- **Description**: Optional, plain text, max 500 characters
- **State**: "draft" | "in_progress" | "closed"
- **Start Date**: Informational (for display, not constraint)
- **End Date**: Informational (for display, not constraint)
- **Created**: Timestamp
- **Modified**: Timestamp
- **Swimlanes**: User-created (one per PI, not shared)
- **Sprints**: Fixed 5 sprints per PI
  - Each sprint has: index (0-4), capacity (integer, user-set), dates (start/end, informational)

#### Swimlane
- **ID**: Auto-generated UUID
- **Name**: User-provided (required, max 100 chars, e.g., "Backend", "Frontend")
- **PI ID**: Reference to parent PI
- **Order**: Numerical order within PI (determines visual order, reorderable)
- **Features**: List of Feature IDs placed in this swimlane
- **Groups**: List of Group objects (groups are sprint-specific within swimlane)

#### Group
- **ID**: Auto-generated UUID
- **Name**: User-provided (required, max 100 chars, e.g., "Login UI", "Auth Flow")
- **Feature ID**: Single Feature (all PBIs in group must belong to same Feature)
- **PBI IDs**: Ordered list of PBIs in this group
- **Sprint Index**: 0-4 (which sprint this group is assigned to)
- **Swimlane ID**: Reference to parent swimlane (groups don't move between swimlanes)

#### Project
- **ID**: Auto-generated UUID
- **Name**: Required, unique per tenant, max 100 chars
- **Description**: Optional, plain text, max 500 chars
- **Created**: Timestamp
- **Modified**: Timestamp
- **Backlog**: List of Features (not in any PI)
- **PIs**: List of PI objects

### 2.2 Data Constraints
- **System IDs**: Internal database primary keys (UUID or auto-increment) are unique and immutable
- **User-provided IDs**: Optional numerical IDs must be unique within a project (Features and PBIs share ID namespace)
  - Can be blank (no user-provided ID assigned)
  - Can be changed anytime (user can rename ID from 101 to 202)
  - Cannot duplicate another item's user ID in same project
  - Max value: 999999
- **Effort**: If provided, must be positive integer (1+)
- **Swimlane names**: Must be unique within a PI
- **Group names**: Must be unique within a swimlane
- **PI states**: Only one PI can be "in_progress" at a time
- **Features in swimlines**: Same Feature cannot appear in multiple swimlines simultaneously
- **Groups**: One group = PBIs from one Feature only
- **Parent references**: Must use system IDs internally (database referential integrity)

---

## 3. Backlog Area (Phase 1)

### 3.1 Structure
- **Simple list view**: Features (expandable to show child PBIs)
- **No grouping** in backlog
- **No swimlines** in backlog
- **PBIs only grouped when moved to a PI**

### 3.2 Item Management

#### Create Feature
- User provides:
  - **Title**: Mandatory
  - **Description**: Optional (plain text)
  - **Effort**: Optional (integer)
  - **User ID** (optional): Numerical identifier (1-999999, must be unique in project)
- System auto-generates internal system ID and timestamps
- Feature is created in backlog (not in any PI)
- If user-provided ID is blank, system displays as "Untitled #[system_id]" or similar

#### Create PBI
- User selects parent Feature first
- User provides:
  - **Title**: Mandatory
  - **Description**: Optional (plain text)
  - **Effort**: Optional (integer)
  - **User ID** (optional): Numerical identifier (1-999999, must be unique in project)
- System auto-generates internal system ID and timestamps
- PBI added to parent Feature's child list
- PBI starts in backlog
- If user-provided ID is blank, system displays as "Untitled #[system_id]" or similar

#### Edit Items
- User can edit: Title, Description, Effort, User ID (can change/add/remove user-provided ID)
  - Changing user ID must respect uniqueness constraint (no duplicates in project)
  - Clearing user ID is allowed (item becomes ID-less)
  - User IDs can be reassigned (e.g., change Feature #101 ID from 101 to 205)
- Feature edits update everywhere (backlog + all PIs)
- PBI edits in groups update immediately in sprint
- Edits require edit lock (user must be in edit mode)
- Auto-saved when user action completes (optimistic update)

#### Delete Items
- Deletions require confirmation dialog
- **Delete Feature**: All child PBIs deleted (cascade)
  - If Feature is in a PI swimlane, all its groups in sprint columns deleted
  - Feature removed from swimlane
- **Delete PBI**: 
  - Removed from parent Feature
  - If in a group in a sprint column, group updated
  - If group becomes empty, group deleted
  - If PBI is only ungrouped item in feature zone, feature zone shows feature with no PBIs
- Deleted data is **permanent** (no trash/archive, no undo)

#### Move to PI
- User selects Feature from backlog
- Drags Feature to a PI swimlane (feature zone)
- Feature moves (not copied) from backlog to swimlane
- All child PBIs remain ungrouped in feature zone initially
- User can then select PBIs and group them for sprint assignment

#### Return to Backlog
- User drags Feature from PI swimlane back to backlog
- Feature returns to backlog
- All groups in sprint columns are **silently deleted** (no confirmation)
- PBIs return to ungrouped state in backlog
- No data loss (PBIs remain, just ungrouped)

### 3.3 Rich Text & Descriptions
- **Format**: Plain text only (Phase 1)
- **Allowed**: Alphanumeric, spaces, basic punctuation, line breaks
- **Not allowed**: Bold, italic, links, HTML, Markdown
- **Line breaks**: Preserved (can use Enter key to add line breaks)
- **Max length**: 2000 characters (features), 2000 characters (PBIs)

### 3.4 Display & Sorting
- **Default sort**: By creation date (newest first)
  - Alternative: By name (A-Z)
  - User can toggle sort preference (stored in localStorage)
- **Search**: Deferred to Phase 2

---

## 4. PI (Program Increment) Planning (Phase 1)

### 4.1 PI Lifecycle & States
- **Draft** → **In Progress** → **Closed**
- Can move backwards: In Progress ↔ Draft, Closed ↔ In Progress (requires confirmation)
- **Closed PIs**: Read-only (no modifications to features, swimlines, groups, names)
- **Draft/In Progress PIs**: Full editing allowed
- **Only one PI can be "In Progress"** at a time
  - Transitioning a PI to "In Progress" auto-closes any other "In Progress" PI
  - User must confirm this action
- **Multiple Draft PIs** allowed (for preparation)
- **Closed PIs remain visible** (historical reference)

### 4.2 PI Structure

#### PI Header
- Shows: Name, State (Draft/In Progress/Closed), Date range
- Actions (in edit mode):
  - State transition buttons: "Start PI", "Close PI", "Replan"
  - Edit PI details (name, dates)

#### Sprint Column Headers (Fixed 5 Columns)
- Each column labeled: Sprint 1–5
- Each column shows:
  - Sprint number
  - Date range (start–end, informational only)
  - **Capacity**: User-set story points for this sprint
  - **Total effort**: Sum of all group efforts in this sprint (derived)
  - **Utilization**: `[effort] / [capacity]` with thin capacity bar
    - Color: Gray (normal, <85%), Amber (85-100%), Red (over 100%)
  - All 5 sprints have equal width (flex)

#### Feature Zone
- Fixed width (~90-110px)
- Shows Features placed in swimlines
- Each Feature displays:
  - Feature name (truncated if needed)
  - Effort badge (sum of child PBIs or sum of grouped PBIs)
  - Ungrouped PBIs (if any) with indicators
- Drop target for moving Features from backlog

#### Swimlanes
- Span entire PI (Feature zone + 5 sprint columns)
- **Header** (collapsible):
  - Collapse/expand toggle `▾` / `▸`
  - Swimlane name (editable in Draft/In Progress, read-only in Closed)
  - Feature count chip (number of features in swimlane)
  - Capacity bar: `[total effort] / [total capacity]pts [%]`
    - Color: Gray (normal), Amber (85-100%), Red (over 100%)
  - Context menu: Rename, Delete, Reorder (drag to reorder)
- **Body** (when expanded):
  - Feature zone: Features and ungrouped PBIs
  - 5 sprint columns: Groups of PBIs

#### Swimlane Reordering
- **Drag-to-reorder**: User grabs swimlane header and drags up/down
- **Visual feedback**: Swimlane dims while dragging, insertion point shown
- **Reorder buttons** (in context menu): "Move up", "Move down" (alternative to drag)
- **Order persists**: Saved immediately on reorder
- **Swimlines can be reordered**: In Draft and In Progress states
- **Closed PI swimlines**: Reorder not allowed (read-only)

#### Deleting Swimlines
- User can delete empty swimlines (no features, no groups)
- User can delete non-empty swimlines (confirmation required)
  - Features in swimline return to backlog
  - Groups in sprint columns are deleted
  - PBIs in those groups return to backlog (ungrouped)

### 4.3 Grouping & Sprint Assignment

#### Create Group
1. User selects multiple PBIs from the same Feature (multi-select via checkbox or Ctrl+click)
2. Right-click or use toolbar: "Create Group"
3. Modal: Enter group name (required, max 100 chars)
4. Group created and appears in Feature zone (ungrouped state)
5. User drags group to a sprint column to assign sprint

#### Assign Group to Sprint
- User drags group from Feature zone to a sprint column
- Group moves to that sprint
- Group shows: name, effort (sum of PBIs), PBI list

#### Edit Group
- User can edit group name (in edit mode, Draft/In Progress)
- User can reorder PBIs within group (drag within group)
- User can move PBIs between groups (drag PBI to target group)

#### Ungroup
- User clicks "Ungroup" on group (in Feature zone or sprint column)
- All PBIs in group return to ungrouped state in feature zone
- Group is deleted
- Cannot ungroup in Closed PI

#### Move Group Between Sprints
- User drags group to different sprint column (within same swimlane)
- Group moves (PBIs stay grouped)
- Cannot move groups between swimlines

#### Delete Group
- User clicks "Delete" on group (confirmation not required)
- Group deleted, PBIs return to feature zone ungrouped
- PBIs themselves are not deleted

### 4.4 Effort & Capacity Tracking

#### Effort Calculation (Derived)
- **Group effort** = Sum of child PBI efforts (if any PBI has no effort, treat as 0)
- **Feature zone effort** (for Feature with ungrouped PBIs) = Sum of ungrouped PBI efforts
- **Swimlane effort** = Sum of all group efforts in swimlane (across all sprints)
- **Sprint effort** = Sum of all group efforts in that sprint column (across all swimlanes)
- **PI total effort** = Sum of all group efforts across all swimlines and sprints
- **PI total capacity** = Sum of all sprint capacities (across all 5 sprints)

#### Capacity Display
- **Per sprint**: Capacity bar in sprint header (3px height)
  - Shows: `[used] / [capacity]pts [%]`
  - Color: Gray (normal), Amber (85-100%), Red (over 100%)
- **Per swimlane**: Capacity bar in swimlane header
  - Shows: `[total effort] / [total capacity]pts [%]`
  - Calculated from all groups in that swimlane across all sprints
- **PI-level**: Total effort vs total capacity (shown in PI status bar)

#### Setting Sprint Capacity
- User clicks on sprint column header to edit capacity (in edit mode)
- Modal: Enter capacity (integer, required, must be positive)
- Capacity applies to entire sprint (shared across swimlanes)
- Capacity change triggers recalculation of effort utilization

---

## 5. Item Movement & Drag-and-Drop

### 5.1 What Can Be Moved
| What | From | To | Result |
|------|------|----|----|
| Feature | Backlog | Swimlane feature zone | Feature placed in swimlane |
| Feature | Feature zone | Different swimlane | Feature moves swimlane |
| Feature | Feature zone | Backlog | Feature returns to backlog; all groups deleted |
| Group | Feature zone | Sprint column | Group assigned to sprint |
| Group | Sprint column | Different sprint column (same swimlane) | Group moves to new sprint |
| PBI | Ungrouped | Select multiple + Create Group | PBIs grouped together |
| PBI | Within group | Reorder within group | PBI position changes |
| PBI | Group A | Group B (same feature) | PBI moves to different group |
| Swimlane | Position N | Position N' | Swimlane reorders (via drag header or buttons) |

### 5.2 Drag-and-Drop Visual Feedback
- **Source**: Item being dragged appears dimmed/ghost
- **Valid drop targets**: Highlighted with accent border, "Drop here" label
- **Invalid targets**: Dimmed, no highlight
- **Drag preview**: Shows item name + icon
- **Escape key**: Cancels drag
- **Auto-scroll**: When dragging near viewport edge, scroll in that direction

### 5.3 Constraints
- Features can only be in one swimlane at a time (if moved, previous location cleared)
- Groups can only be in one sprint at a time
- PBIs can only be in one group at a time (or ungrouped)
- PBIs in a group must come from same Feature

---

## 6. Multi-select & Batch Operations (Phase 1)

### 6.1 Multi-select
- **Checkbox selection** or **Ctrl+Click** (Cmd+Click on Mac)
- Can select: Features, PBIs, Groups (independently)
- Cannot multi-select swimlines
- Selected items highlighted with accent background

### 6.2 Batch Operations
- **Delete selected**: Confirmation dialog
- **Move to PI**: Move all selected Features to same swimlane
- **Create group**: Create group from selected PBIs (same Feature only; cross-Feature selection disabled)

---

## 7. UI/UX Interactions

### 7.1 Confirmations Required
- Delete Feature (with child PBIs) → Confirm dialog
- Delete swimlane (with content) → Confirm: "Content will return to backlog"
- Delete PBI → Confirm
- Delete group → No confirmation
- Move Feature back to backlog → No confirmation (groups silently deleted)
- Move group to different sprint → No confirmation
- Transition PI state (Draft ↔ In Progress) → Confirm
- Close PI → Confirm ("PI will become read-only")

### 7.2 Dependency Visualization (Deferred to Phase 2)
- Predecessor/successor relationships deferred
- Dependency view deferred
- Broken dependency warnings deferred
- Cross-PI dependency warnings deferred

### 7.3 Edit Indicator
- **When editing** (you): "You • Editor" (green dot indicator)
- **When someone else editing**: Amber banner: `[Username] is editing · Read-only for you` + lock expiry countdown
- **When available**: "🔓 Request Edit Mode" button
- Banner dismissible (clicking X hides but doesn't affect lock state)

---

## 8. Data Persistence & Export

### 8.1 Auto-save Behavior
- **Trigger**: Every user action (create, edit, delete, move, reorder)
- **Debounce**: 100ms (rapid changes batched into single save)
- **Save location**: Server-side database (PostgreSQL)
- **Optimistic updates**: UI updates before server response completes
- **Save indicator**: Brief spinner/checkmark at bottom-right (disappears after 2 seconds)

### 8.2 Edit Lock & Save on Timeout
- **Inactivity timeout**: 30 minutes
- **On timeout**: 
  - Auto-save triggered
  - Edit lock released
  - User sees notification: "Edit session expired. Save completed. Read-only mode."
  - Other users can request edit mode

### 8.3 Conflict Resolution
- **Last-write-wins**: If two users somehow save conflicting changes (edge case with edit lock), last write overwrites
- **Detection**: Not needed in Phase 1 due to single-writer pattern
- **Prevention**: Edit lock prevents simultaneous writes

### 8.4 Project Export (Phase 1)
- **Format**: JSON
- **Scope**: Entire project state
  - All PIs (including closed ones)
  - Swimlines and configurations
  - Backlog items
  - All Features and PBIs
  - Metadata: name, description, created date, last modified date
- **Trigger**: User clicks "Export Project" in project list footer
- **Behavior**: Browser downloads JSON file (filename: `[ProjectName]_[Date].json`)
- **No user data**: Does not include user names, edit history, or access logs

### 8.5 Project Import (Phase 2)
- Deferred to Phase 2
- When implemented: Creates new project (no overwriting existing)

---

## 9. Data Limits & Constraints

| Entity | Max |
|--------|-----|
| Features per project | 999 |
| PBIs per Feature | 999 |
| Swimlanes per PI | 99 |
| Groups per swimlane (across all sprints) | 500 |
| Groups per sprint column | 99 |
| PBIs per group | 100 |
| Concurrent readers | 10 (1 writer + 9 readers max) |
| Edit lock timeout | 30 minutes |
| Max file upload (future phases) | 10 MB |
| Max text field length | 2000 characters (descriptions) |
| User-provided ID range | 1–999999 (optional, can be blank) |
| User-provided ID uniqueness | Per project (Features and PBIs share namespace) |

---

## 10. Technical Architecture Notes

### 10.1 Frontend State Management
- React components with TanStack Query (React Query) for server sync
- Zustand or Redux Toolkit for local UI state
- Real-time sync via Server-Sent Events (SSE) or polling for read-only users
- Optimistic updates: UI reflects action immediately, server catch-up async

### 10.2 Backend Design
- REST API for all CRUD operations
- Session-based authentication (HTTP-only cookies)
- Edit lock stored in database (or in-memory cache) with TTL (auto-expire after 30 min inactivity)
- Heartbeat endpoint for keepalive ping (resets timeout)
- Auto-save endpoint (triggered on every action)
- **Database**: SQLite recommended for Phase 1 MVP
  - Simple file-based, no server needed
  - Sufficient for single-tenant, few hundred items, 1 concurrent writer
  - Can scale to PostgreSQL in Phase 2 if needed
  - Indexes on: project_id, feature_system_id, pbi_system_id, pi_id, swimlane_id
  - Unique constraint on (project_id, user_id) for user-provided IDs

### 10.3 Data Validation
- **Frontend**: Real-time validation (title required, effort must be positive)
- **Backend**: Server-side validation (enforce all constraints, sanitize input)
- **ID uniqueness**: Checked on creation and update

---

## 11. Deferred to Phase 2

- ✗ CSV import (from Azure DevOps, Excel, etc.)
- ✗ Advanced authentication (user registration, role-based access, admin panel)
- ✗ Dependency management (predecessor/successor, broken dependencies, cross-PI warnings)
- ✗ Search & filtering (beyond sort by name)
- ✗ Rich text descriptions (Markdown, bold, italic, links)
- ✗ Notifications (email, in-app alerts)
- ✗ Audit logs & change history
- ✗ Project templates & swimlane templates
- ✗ Real-time multi-user concurrent editing (CRDT-based)
- ✗ Keyboard shortcuts
- ✗ Burndown charts, velocity tracking
- ✗ Integration with Azure DevOps, Jira, Slack

---

## 12. Acceptance Criteria Summary (Phase 1 MVP)

### Authentication ✓
- [x] User login with username/password
- [x] Session management (1 hour timeout, 30-day remember me)
- [x] Single-writer edit lock (30 min timeout)
- [x] Edit indicator (show who's editing)

### Backlog Area ✓
- [x] Create Features (title mandatory, others optional)
- [x] Create PBIs as children of Features (title mandatory)
- [x] Edit all items (title, description, effort, ID)
- [x] Delete items with cascade rules
- [x] Move Features to/from PIs
- [x] Sort by name, creation date
- [x] Support multiple projects

### PI Planning ✓
- [x] Multiple PIs (only one in progress)
- [x] PI states: Draft → In Progress → Closed
- [x] Features placed in swimlines
- [x] 5 fixed-width sprint columns (S1-S5)
- [x] Sprint dates and capacity per sprint
- [x] Swimlines span entire PI
- [x] Swimline naming, reordering, deletion
- [x] Group PBIs from same Feature
- [x] Move groups to sprint columns
- [x] Ungroup and regroup

### Item Management ✓
- [x] Create/edit/delete with cascade rules
- [x] Move items between swimlines and sprints
- [x] Drag-and-drop (features, groups, swimlanes)
- [x] Multi-select for features, PBIs, groups
- [x] Effort tracking (integer story points)
- [x] Capacity per sprint, effort display per swimlane
- [x] Utilization bars (normal/amber/red)

### Data Management ✓
- [x] Server-side persistence (auto-save)
- [x] Single-writer edit lock
- [x] Auto-save on timeout
- [x] Edit indicator for current editor
- [x] Export projects (JSON)

### State Management ✓
- [x] PI states: Draft ↔ In Progress → Closed
- [x] Feature edits update everywhere
- [x] PBI edits in groups update immediately
- [x] Closed PI prevents modifications
- [x] Edit mode available in Draft/In Progress

---

## Design System (Production Implementation)

These are minimum tokens — substitute your design system's equivalents:

### Colors
- **Accent (active)**: Blue or amber for active states, in-progress PI, drag highlights
- **Warn**: Amber for capacity warnings (85-100%)
- **Error**: Red for over-capacity (>100%)
- **Neutral**: Grays for inactive states, borders, disabled elements
- **Background**: White or light gray for main content

### Typography
- **Headings**: Bold, 18-20px (PI name, swimlane name)
- **Labels**: Regular, 12-14px (feature zone label, sprint headers)
- **Body**: Regular, 14px (item titles, descriptions)
- **Monospace**: Code font for IDs and effort badges

### Spacing
- **8px base unit**: All margins/padding multiples of 8px
- **Swimlane padding**: 16px
- **Group card padding**: 12px
- **Sprint column padding**: 8px

### Capacity Bar
- **Height**: 3px
- **Colors**: Gray (normal) → Amber (85-100%) → Red (>100%)
- **Label**: `[used]/[capacity]pts [%]`

---

## Screens Included in Phase 1

1. **Login Screen**: Username/password, "Remember me" checkbox, submit button
2. **Project List**: All projects, active project highlighted, export button
3. **Backlog Panel**: Features list, expandable PBIs, create/import buttons
4. **PI Board**: Swimlanes, sprint columns, groups, feature zone, drag-drop interaction
5. **Edit Lock Indicator**: Status bar showing editor or "Request Edit Mode" button

---

## Implementation Priority (for development teams)

1. **Backend Foundation** (Weeks 1-2): Auth, session management, edit lock, database schema, CRUD APIs
2. **Backlog UI** (Weeks 3-4): Feature/PBI creation, edit, delete, display
3. **PI Board Structure** (Weeks 5-6): PI CRUD, swimlines, sprint columns, rendering
4. **Drag-and-Drop** (Weeks 7-8): dnd-kit setup, all drag operations, visual feedback
5. **Grouping** (Weeks 9-10): Group creation, sprint assignment, ungroup, effort calculation
6. **Polish & Testing** (Weeks 11-12): Edge cases, error handling, performance, accessibility, docs


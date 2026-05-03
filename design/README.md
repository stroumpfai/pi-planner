# Handoff: PI Planning Web Application

## Overview

A web-based PI (Program Increment) planning and roadmap management tool for Product Owners and Product Managers. The application enables creation, import, and management of Features and PBIs (Product Backlog Items), organized into Program Increments with swimlanes and sprint columns.

---

## About the Design Files

The files in this bundle are **low-fidelity wireframe prototypes created in HTML** — sketchy, hand-drawn-style layouts showing structure, information hierarchy, flow, and key interactions. They are **not** production code to copy directly.

The task is to **implement this UI in your target codebase** using its established framework, component library, and design system. Apply your existing styling conventions; the wireframes are guides for layout structure and behavior, not visual style.

If no codebase exists yet, React (with TypeScript) is recommended given the complexity of the drag-and-drop interactions and state management requirements.

---

## Fidelity

**Low-fidelity (lofi)** wireframes. These show:
- Layout structure and proportions
- Information hierarchy and component placement
- Interaction patterns and flows
- Data model representation in the UI

Apply your codebase's existing design system for all colors, typography, shadows, and spacing. The wireframes use a sketchy aesthetic intentionally — ignore it.

---

## Screens / Views

### 1. Global Shell

**Layout:** Three-column fixed shell that fills the viewport height.

| Zone | Width | Description |
|------|-------|-------------|
| Project list | ~15% of viewport, min ~160px | Dark sidebar listing all projects |
| Backlog panel | ~25% of viewport | Always-visible backlog for the active project |
| Main content | remaining flex | PI board or auxiliary views (deps, import) |

**Top bar** (full width, above the three columns):
- App name / logo — left
- Breadcrumb: `[Project name] › [PI name or view name]` — center-left
- Edit lock indicator — right (see §Edit Lock)
- User avatar/name dropdown — far right
- Height: ~36px

---

### 2. Project List Column

**Purpose:** Navigate between projects; project-level actions.

**Structure (top to bottom):**
- Section header: "PROJECTS" label — uppercase, muted, small font
- Project list items (each): project name, active state = left accent border + highlighted background
- Footer action group (bottom, separated by top border):
  - `+ new project`
  - `↑ import project` (JSON)
  - `↓ export project` (JSON)
- Settings link at very bottom

**Behavior:**
- Clicking a project switches the backlog and main content to that project
- Active project shown with left accent border
- Export downloads full project JSON (all PIs, backlog, dependencies, metadata)
- Import creates a new project (never overwrites existing)

---

### 3. Backlog Panel

**Purpose:** Always-visible list of Features and their child PBIs not yet assigned to a PI (or returned from one).

**Structure (top to bottom):**
- Section header: "Backlog" label
- Search bar (filter by title)
- Scrollable feature list (flex-grow)
- Footer action group (bottom, separated by top border):
  - `+ add feature`
  - `↑ import CSV`

**Feature list item (collapsed):**
- Expand toggle `▸`
- Feature title (bold)
- Optional: ID badge `#123`
- Warning icon `⚠` if broken dependency or orphaned PBIs
- Effort badge (story points)
- Context menu `···`

**Feature list item (expanded):**
- Same header as collapsed but with `▾`
- Child PBI rows indented beneath:
  - PBI title
  - Optional: ID badge, dependency icon `→`, warning icon `⚠`, effort badge
  - Context menu

**Orphaned PBIs section** (below main list, separated by dashed border):
- Label: "⚠ Orphaned PBIs (missing feature)"
- PBI rows with warning styling

**Interactions:**
- Features draggable into PI board swimlane feature zones
- PBIs multi-selectable (checkbox or cmd+click) for group creation
- Context menu per item: Edit, Delete, Move to PI, Set dependency

---

### 4. PI Board (Main View)

**Purpose:** Core planning board. Features placed in swimlanes, PBI groups placed in sprint columns.

#### 4a. PI Tab Bar

Sits at top of main content area. Shows all PIs for the active project as tabs:
- Closed PIs: labeled with name + ✓, muted color
- In Progress PI: labeled with name + ●, amber accent
- Draft PIs: labeled with name + ◎
- `+ New PI` button at far right

#### 4b. PI Status Bar

Below the tab bar. Single row showing:
- State chip: `Draft` / `In Progress` / `Closed`
- Date range: `May 5 – Sep 26, 2024`
- Divider
- **PI-level effort summary** (derived, not user-set):
  - `∑ [X]pts` — sum of all group efforts across all swimlanes and sprints
  - Thin capacity progress bar (3px height) showing effort vs total capacity
  - `cap [Y]pts`
  - `[Z]%` utilization
- Divider
- Warning counts: `⚠ N broken deps`, `⚠ N cross-PI deps`
- Actions: `+ Swimlane`, `+ Feature`

> **Capacity calculation:** Total capacity = sum of all sprint capacities across all swimlanes. Sprint capacity is user-set per sprint. Effort is derived from groups assigned to that sprint.

#### 4c. Sprint Column Header Row

Fixed row above swimlanes. 5 fixed columns (S1–S5).

Each column header shows:
- Sprint number `S1`
- Sprint date range (informational, set per PI)
- Capacity bar (3px, thin, muted) — effort used vs sprint capacity
- `[used] / [cap] [pct%]` — color: normal=muted gray, >85%=amber, over=red

Left of sprint columns: "Feature Zone" label column (matches feature zone width below).

#### 4d. Swimlanes

Each swimlane spans the full width (feature zone + 5 sprint columns).

**Swimlane header (collapsible):**
- Collapse/expand toggle `▸` / `▾`
- Swimlane name (editable in Draft/In Progress)
- Thin capacity bar (same style as sprint header bars): effort vs capacity
- `[effort] / [cap]pts [pct%]`
- Feature count chip
- Context menu `···` (rename, delete, reorder)

**Swimlane body (when expanded), left to right:**

| Zone | Width | Contents |
|------|-------|----------|
| Feature zone | ~90–110px fixed | Feature pills for features placed in this swimlane + drop target |
| Sprint 1 | flex:1 | Groups assigned to Sprint 1 |
| Sprint 2 | flex:1 | Groups assigned to Sprint 2 |
| Sprint 3 | flex:1 | ... |
| Sprint 4 | flex:1 | ... |
| Sprint 5 | flex:1 | ... |

**Feature pills** (in feature zone):
- Feature name (truncated)
- Warning icon if broken dep
- Effort badge

**Groups (Variant A — stacked group cards):**

Each group card:
- Group name (bold, editable)
- Warning icon if broken/cross-PI dep
- Effort badge (sum of child PBIs)
- Child PBI rows beneath:
  - PBI title
  - Dependency icon if has deps
  - Warning icon if broken dep
  - Effort badge
- Drop target at bottom of empty column: dashed border placeholder

**Empty sprint cell:** dashed border, "drop group" hint text

**Add swimlane:** dashed border row at bottom of all swimlanes.

---

### 5. Dependency View

**Purpose:** List all predecessor/successor relationships across the project.

**Filter bar:**
- Filter chips: All / ⚠ Broken (N) / Cross-PI / Feature→Feature / PBI→PBI
- `⊕ Add dependency` button at right

**Dependency list** (each row):
- From item (name + type)
- Arrow `→`
- To item (name or `[missing — #ID]` in red if broken)
- Status chip: `✓ linked` / `⚠ cross-PI` / `⚠ broken`
- Delete button `✕`

---

### 6. CSV Import Dialog

**Purpose:** Modal dialog for importing Features and PBIs from CSV.

**CSV column spec:** `ID, Type, Title, Description, Effort, ParentFeatureID, Predecessor, Successor`

**Dialog contents:**
- Title: "Import from CSV"
- Column format description
- File drop zone: "Drop CSV here or browse..."
- Options:
  - Checkbox: "Update existing items by ID"
  - Checkbox: "Skip invalid rows silently"
- Preview/validation warnings panel (if issues found):
  - Warning list: Row N: [reason]
  - Categories: missing ParentFeatureID (→ orphaned), duplicate ID (→ skipped), broken dependency (→ imported + marked)
- Action buttons: Cancel / Import N rows →

**Import rules:**
- Invalid rows: skipped, reported
- Missing ParentFeatureID: PBI imported, marked "missing feature"
- Broken dependencies: imported, marked with warning
- Duplicate IDs in file: row skipped, reported
- Matching existing ID: updates all fields of existing item
- All imports land in backlog

---

### 7. Edit Lock Indicator

**Purpose:** Enforce single-writer pattern — only one user can edit at a time.

**States:**

| State | UI |
|-------|----|
| You are editing | Green dot + "You • Editor" label (or nothing prominent) |
| Someone else editing | Amber banner: `✏ [Name] is editing · read-only for you` + lock expiry countdown |
| No one editing, you can claim | `🔓 Request Edit Mode` button + "read-only" label |

**Behavior:**
- User clicks "Request Edit Mode" → server grants exclusive lock if free → UI switches to edit mode
- Lock timeout: 30 min inactivity → auto-save → lock released
- Connection loss: 20 min window to reconnect and resume lock
- No queuing, no takeover — user must wait

---

## Interactions & Behavior

### Drag and Drop

| What | From | To | Result |
|------|------|----|--------|
| Feature | Backlog list | Swimlane feature zone | Feature placed in swimlane (moved, not copied) |
| Feature | Feature zone | Different swimlane feature zone | Feature moves swimlane |
| Feature | Feature zone | Backlog | Feature returns to backlog; all its groups in sprint columns are deleted (no confirmation) |
| Group | Sprint column | Different sprint column (same swimlane) | Group moves sprint |
| PBI | Within group | Reorder within group | PBI reordered |
| PBI | Group | Another group (same feature only) | PBI moves group |

Active drag state (Option H pattern):
- Dragging item: source shown dimmed/ghost
- Valid drop targets: highlighted with accent border + "drop here" label
- Invalid targets: dimmed/no highlight
- Drag hint banner appears at top of board: "[Item name] — drop into a swimlane feature zone below"
- Esc cancels drag

### Multi-select

- `Cmd/Ctrl+click` or checkbox to select multiple Features, PBIs, or Groups
- Swimlanes cannot be multi-selected
- Batch actions on selection: move, delete, create group (PBIs from same feature only)

### Grouping Flow

1. Select multiple PBIs from the same Feature (multi-select)
2. Right-click → "Create group" or toolbar button
3. Name prompt → group created
4. Group appears in feature zone or can be dragged directly to a sprint column

### Confirmations Required

- Delete Feature (with child PBIs) → confirm dialog
- Delete swimlane (with content) → confirm: content returns to backlog
- Delete PBI with dependents → confirm: dependents marked broken
- Delete Feature with dependents → confirm: dependents marked broken

### No Confirmation Needed

- Move Feature between swimlanes
- Move group between sprints
- Move Feature back to backlog (groups silently deleted)

### PI State Transitions

`Draft → In Progress → Closed` (bidirectional except Closed is terminal unless explicitly reopened)

- Only one PI can be "In Progress" at a time
- Closed PI: fully read-only (no edits to features, swimlanes, groups, names)
- Draft/In Progress: full editing

---

## State Management

### Key State

```
projects[]
  id, name, description, createdAt, lastModifiedAt

project
  backlog: Feature[]
  pis: PI[]

Feature
  id (numerical, globally unique)
  title (required)
  description (rich text, optional)
  effort (integer story points, optional)
  pbis: PBI[]
  predecessors: id[]
  successors: id[]
  location: 'backlog' | { piId, swimlaneId }

PBI
  id (numerical, globally unique)
  title (required)
  description (rich text, optional)
  effort (integer story points, optional)
  parentFeatureId (required; null = "missing feature")
  predecessors: id[]  // PBI→PBI only
  successors: id[]
  location: 'backlog' | { piId, swimlaneId, groupId }

PI
  id, name, state: 'draft' | 'in_progress' | 'closed'
  startDate, endDate
  swimlanes: Swimlane[]
  sprints: Sprint[5]  // fixed 5

Swimlane
  id, name
  featureIds: id[]
  groups: Group[]

Group
  id, name
  featureId (parent feature — one group = one feature)
  pbiIds: id[]
  sprintIndex: 0–4 | null

Sprint
  index: 0–4
  capacity: integer (user-set)
  dates: { start, end }  // informational

editLock
  lockedBy: userId | null
  lockedAt: timestamp | null
  expiresAt: timestamp | null
```

### Derived Values (never stored, always computed)

- Group effort = sum of child PBI efforts
- Swimlane effort = sum of all group efforts in swimlane (across all sprints)
- Sprint effort = sum of all group efforts in that sprint column (across all swimlanes)
- PI total effort = sum of all group efforts across all swimlanes and sprints
- PI total capacity = sum of all sprint capacities across all swimlanes
- Broken dependency = referenced ID does not exist in current project
- Cross-PI dependency = referenced item is in a different PI

---

## Data Limits

| Entity | Max |
|--------|-----|
| Features per project | 999 |
| Swimlanes per PI | 99 |
| Groups per sprint | 99 |
| Sprint columns | Fixed at 5 |

---

## Persistence

- **Server-side storage** — not localStorage
- **Auto-save on every action** (optimistic updates)
- **Single-writer lock** — see Edit Lock section
- **Export:** Full project JSON (all PIs incl. closed, backlog, deps, metadata)
- **Import:** Creates new project; validates same as CSV import; preserves metadata
- **No undo/redo**, no change history, no version history
- Deleted data: immediately gone, no recovery

---

## Design Tokens

These are wireframe-level values — substitute your design system's equivalents.

### Colors (wireframe reference only)

| Token | Wireframe value | Usage |
|-------|----------------|-------|
| Accent / amber | `#f5a623` | Active states, In Progress chip, drag highlights |
| Warn | `#f0ad4e` / `#d97706` | Warning icons, broken deps |
| Error | `#dc2626` | Over-capacity, broken dep items |
| Dark sidebar bg | `#1e1e1e` | Project list column |
| Active project bg | `#2e2e2e` | Selected project row |
| Feature zone bg | `#ebe9e5` | Feature zone within swimlane |
| Swimlane bg | `#faf9f7` | Swimlane body background |
| Status bar bg | `#fef9f0` | PI status bar |
| Body bg | `#f5f3ef` | Canvas / page background |

### Capacity Bar

- Height: 3px
- Track color: muted gray (`#ece9e4`)
- Fill: gray at normal, amber >85%, red at over-capacity
- Always paired with `[used]/[cap]pts [pct]%` text

### Sprint Column Width

5 equal flex columns. No fixed widths — let them flex to fill available space.

### Feature Zone Width

Fixed: ~90–110px. Adjust based on typical feature name length in your use case.

---

## Assets

No images or icons required by the wireframes. In production:
- Warning icon `⚠` — use your icon library's warning/alert icon
- Dependency arrow `→` — use your icon library
- Collapse/expand `▾`/`▸` — use your icon library's chevron

---

## Screenshots

| File | Screen |
|------|--------|
| `screenshots/01-PI-Board.png` | PI Board — Option G (capacity bars, collapsible swimlanes, Variant A sprint columns) |
| `screenshots/02-Backlog.png` | Backlog panel — feature list with expanded PBIs, orphaned PBI section |
| `screenshots/03-Dependencies.png` | Dependencies view — filter bar, broken/cross-PI dependency list |
| `screenshots/04-CSV-Import.png` | CSV Import dialog — file drop zone, options, validation warnings |
| `screenshots/05-Drag-Interaction.png` | Drag state (Option H) — active drag highlight, drop zone indicators |

---

## Files in This Package

| File | Description |
|------|-------------|
| `PI Planning Wireframes.html` | Full interactive wireframe — 8 layout options (A–H), all screens accessible via Tweaks panel. Open in browser. |
| `design-canvas.jsx` | Canvas framework (pan/zoom artboard grid) — part of wireframe tooling, not for production |
| `tweaks-panel.jsx` | Tweaks panel component — part of wireframe tooling, not for production |
| `README.md` | This document |

**Key options to reference:**
- **Option G** — Recommended layout direction (3-column shell, capacity bars, collapsible swimlanes)
- **Option G — Variant A** — Recommended sprint column style (stacked group cards with expanded PBI rows)
- **Option H** — Drag state and drop zone interaction reference
- **CSV Import screen** — Switch screen in Tweaks panel → "CSV Import"
- **Dependencies screen** — Switch screen in Tweaks panel → "Dependencies"

---

## How to Use the Wireframe

1. Open `PI Planning Wireframes.html` in a browser
2. Click the **Tweaks** toggle in the top toolbar
3. Set **Show Options** to `Option G` to isolate the recommended layout
4. Use **Active Screen** to switch between: PI Board, Backlog, CSV Import, Dependencies
5. Double-click any artboard to focus it fullscreen
6. Scroll down within Option G's section to see sprint column Variants A, B, C

# PI Planning - Visual Layout Diagram

## 1. Overall PI Area Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PI: Q2-2026 (Draft) | Start: 2026-04-01 | End: 2026-05-30                  │
│  [Edit Toggle] [State: Draft] [Switch to: In Progress]                      │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                         PI PLANNING BOARD                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  FEATURE ZONE          SPRINT 1          SPRINT 2          SPRINT 3          │
│  (Feature View)     (Apr 1 - Apr 14)  (Apr 15 - Apr 28)  (Apr 29 - May 12)   │
│                     Cap: 40 pts       Cap: 40 pts        Cap: 35 pts         │
│                                                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ SWIMLINE: Backend                                                            │
│ Total Effort: 45 pts | Total Capacity: 115 pts                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ Feature: Auth   │  │ Group: Login UI │  │ Group: Session  │              │
│  │ ID: 101         │  │ Effort: 13 pts  │  │ Effort: 13 pts  │              │
│  │ Effort: 45 pts  │  │ [⚠ cross-PI]    │  │                 │              │
│  │ ─────────────── │  │ ─────────────── │  │ ─────────────── │              │
│  │ ○ PBI-101 (5)   │  │ ✓ PBI-101       │  │ ✓ PBI-102       │              │
│  │ ○ PBI-102 (8)   │  │ ✓ PBI-102       │  │ ✓ PBI-103       │              │
│  │ ○ PBI-103 (13)  │  │ ✓ PBI-104       │  │                 │              │
│  │ ○ PBI-104 (13)  │  │                 │  │ (Empty spots)   │              │
│  │ ○ PBI-105 (6)   │  │ (Empty spots)   │  │                 │              │
│  │ [Create Group]  │  │                 │  │                 │              │
│  │ [+] [-]         │  │ Edit   Delete   │  │ Edit   Delete   │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
│                                                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ SWIMLINE: Frontend                                                           │
│ Total Effort: 38 pts | Total Capacity: 115 pts                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ Feature: Dashboard                  │  │ Group: Charts   │              │
│  │ ID: 201         │  │                 │  │ Effort: 8 pts   │              │
│  │ Effort: 38 pts  │  │ (Empty)         │  │                 │              │
│  │ ─────────────── │  │ (Empty)         │  │ ─────────────── │              │
│  │ ○ PBI-201 (8)   │  │ (Empty)         │  │ ✓ PBI-205       │              │
│  │ ○ PBI-202 (13)  │  │ (Empty)         │  │ ✓ PBI-206       │              │
│  │ ○ PBI-203 (5)   │  │ (Empty)         │  │ (Empty spots)   │              │
│  │ ○ PBI-204 (12)  │  │ (Empty)         │  │                 │              │
│  │ ○ PBI-205 (8)   │  │ (Empty)         │  │                 │              │
│  │ ○ PBI-206 (10)  │  │                 │  │                 │              │
│  │ [Create Group]  │  │                 │  │                 │              │
│  │ [+] [-]         │  │                 │  │ Edit   Delete   │              │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘              │
│                                                                               │
├──────────────────────────────────────────────────────────────────────────────┤
│ SWIMLINE: Infra                                                              │
│ Total Effort: 21 pts | Total Capacity: 115 pts                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│  │ Feature: DevOps │  │ Group: CI/CD    │  │ (Empty)         │              │
│  │ ID: 301         │  │ Effort: 21 pts  │  │ (Empty)         │              │
│  │ Effort: 21 pts  │  │ [⚠ missing]     │  │ (Empty)         │              │
│  │ ─────────────── │  │ ─────────────── │  │ (Empty)         │              │
│  │ ○ PBI-301 (8)   │  │ ✓ PBI-301       │  │ (Empty)         │              │
│  │ ○ PBI-302 (13)  │  │ ✓ PBI-302       │  │ (Empty)         │              │
│  │ [Create Group]  │  │ [⚠ orphan]      │  │ (Empty)         │              │
│  │ [+] [-]         │  │                 │  │                 │              │
│  └─────────────────┘  │ Edit   Delete   │  │                 │              │
│                       └─────────────────┘  └─────────────────┘              │
│                                                                               │
│                                                        [Add Swimline] [+]    │
│                                                        [Delete Swimline] [-] │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 2. Feature Zone Detail

```
┌─────────────────────────────────────────────────────────────────────┐
│                          FEATURE ZONE                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  SWIMLINE: Backend                                                  │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Feature: Authentication (ID: 101) [→ Feature 105]             │ │
│  │ Description: User auth system                                 │ │
│  │ Effort: 45 pts  |  [Edit Feature] [Delete Feature]            │ │
│  │ ──────────────────────────────────────────────────────────────│ │
│  │ ✓ PBI-101: Login UI (5 pts) [Drag] [Edit] [Delete]            │ │
│  │ ✓ PBI-102: 2FA (8 pts) [Drag] [Edit] [Delete]  [→ PBI-201]    │ │
│  │ ○ PBI-103: JWT tokens (13 pts) [Drag] [Edit] [Delete]         │ │
│  │ ○ PBI-104: Logout (13 pts) [Drag] [Edit] [Delete]             │ │
│  │ ○ PBI-105: Session mgmt (6 pts) [Drag] [Edit] [Delete]        │ │
│  │                                                                 │ │
│  │ [Create Group with selected PBIs] [Reorder] [Multi-select]    │ │
│  │                                                                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  SWIMLINE: Frontend                                                 │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Feature: Dashboard (ID: 201)                                  │ │
│  │ Description: Main dashboard view                              │ │
│  │ Effort: 38 pts  |  [Move to Swimline ▼] [Edit] [Delete]      │ │
│  │ ──────────────────────────────────────────────────────────────│ │
│  │ ✓ PBI-201: Main layout (8 pts) [Drag] [Edit] [Delete]         │ │
│  │ ✓ PBI-202: Widgets (13 pts) [Drag] [Edit] [Delete]            │ │
│  │ ○ PBI-203: Responsive (5 pts) [Drag] [Edit] [Delete]          │ │
│  │ ○ PBI-204: Dark mode (12 pts) [Drag] [Edit] [Delete]          │ │
│  │ ○ PBI-205: Charts (8 pts) [Drag] [Edit] [Delete]              │ │
│  │ ○ PBI-206: Animations (10 pts) [Drag] [Edit] [Delete]         │ │
│  │                                                                 │ │
│  │ [Create Group with selected PBIs]                             │ │
│  │                                                                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│  [Add Feature] [+] [Filter] [Search] [Sort by Name]               │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. Sprint Column Detail

```
┌────────────────────────────────────────────────────────────────┐
│  SPRINT 1 (Apr 1 - Apr 14)                                     │
│  Capacity: 40 pts | Total Effort: 26 pts | Remaining: 14 pts   │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ GROUP: Login UI (from Feature: Auth)                     │  │
│  │ Total Effort: 13 pts  [⚠ cross-PI dependency]            │  │
│  │ ──────────────────────────────────────────────────────────  │
│  │ • PBI-101: Login UI (5 pts)                              │  │
│  │ • PBI-102: 2FA (8 pts)                                   │  │
│  │                                                           │  │
│  │ [Edit Group] [Move to Sprint ▼] [Ungroup] [Delete]      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ GROUP: Main Dashboard (from Feature: Dashboard)          │  │
│  │ Total Effort: 13 pts                                     │  │
│  │ ──────────────────────────────────────────────────────────  │
│  │ • PBI-201: Main layout (8 pts)                           │  │
│  │ • PBI-202: Widgets (5 pts)                               │  │
│  │                                                           │  │
│  │ [Edit Group] [Move to Sprint ▼] [Ungroup] [Delete]      │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [Empty space for more groups]                                 │
│                                                                 │
│  [Create New Group from backlog]                               │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

## 4. Swimline with All States

```
SWIMLINE: Backend (can be moved, reordered, deleted if empty)

Feature Zone (in swimline)         Sprint Columns (in swimline)
─────────────────────────────────────────────────────────────────

Feature: Auth          │ Group: Login    │ Group: Session  │ (empty) │ (empty)
[PBIs...]             │ Effort: 13 pts  │ Effort: 13 pts  │         │
                      │                 │                 │         │
                      │ [Edit] [Delete] │ [Edit] [Delete] │         │
                      │                 │                 │         │

Feature: Another       │ (empty)         │ Group: X        │ Group: Y │ (empty)
[PBIs...]             │                 │ Effort: 8 pts   │ Effort:5 │
                      │                 │                 │         │
                      │                 │ [Edit] [Delete] │[Edit][D]│

═════════════════════════════════════════════════════════════════════
Total Effort: 45 pts | Total Capacity: 115 pts
```

## 5. Backlog Area (Simple)

```
┌──────────────────────────────────────────────────────────────────┐
│                    BACKLOG AREA                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  [Create Feature] [+] [Import CSV] [Export Project] [Search ▼]  │
│  [Sort by Name]                                                  │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ ▼ Feature: Authentication (ID: 101) [→ 105]              │   │
│  │   Description: User auth system                          │   │
│  │   Effort: 45 pts  Created: 2026-02-15                    │   │
│  │   [Move to PI] [Edit] [Delete]                           │   │
│  │   ─────────────────────────────────────────────────────── │   │
│  │   └─ ○ PBI-101: Login UI (5 pts)                         │   │
│  │      [Edit] [Delete] [Set Dependency]                    │   │
│  │   └─ ○ PBI-102: 2FA (8 pts) [→ PBI-201]                  │   │
│  │      [Edit] [Delete] [Set Dependency]                    │   │
│  │   └─ ○ PBI-103: JWT tokens (13 pts)                      │   │
│  │   └─ ○ PBI-104: Logout (13 pts)                          │   │
│  │   └─ ○ PBI-105: Session mgmt (6 pts)                     │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ ▼ Feature: Dashboard (ID: 201)                            │   │
│  │   Description: Main dashboard view                        │   │
│  │   Effort: 38 pts  Created: 2026-02-16                    │   │
│  │   [Move to PI] [Edit] [Delete]                           │   │
│  │   ─────────────────────────────────────────────────────── │   │
│  │   └─ ○ PBI-201: Main layout (8 pts)                      │   │
│  │   └─ ○ PBI-202: Widgets (13 pts)                         │   │
│  │   └─ ○ PBI-203: Responsive (5 pts)                       │   │
│  │   └─ ○ PBI-204: Dark mode (12 pts)                       │   │
│  │   └─ ○ PBI-205: Charts (8 pts)                           │   │
│  │   └─ ○ PBI-206: Animations (10 pts)                      │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ ▼ Feature: DevOps (ID: 301) [⚠ has orphan PBIs]          │   │
│  │   Description: CI/CD pipeline                            │   │
│  │   Effort: 21 pts  Created: 2026-02-17                    │   │
│  │   [Move to PI] [Edit] [Delete]                           │   │
│  │   ─────────────────────────────────────────────────────── │   │
│  │   └─ ○ PBI-301: Jenkins setup (8 pts)                    │   │
│  │   └─ ✓ PBI-302: Docker (13 pts) [⚠ orphan]               │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

## 6. State Transitions & Visibility

```
┌──────────────────────────────────────────────────────────────────┐
│                    PI LIFECYCLE                                   │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Draft State                 In Progress State      Closed State  │
│  ─────────────────────────   ───────────────────    ──────────── │
│                                                                   │
│  ✓ Create swimlines          ✓ Full editing         ✗ Read-only  │
│  ✓ Add features              ✓ Move features        ✗ No edits   │
│  ✓ Edit features             ✓ Rename swimlines     ✗ No deletes  │
│  ✓ Create groups             ✓ Create groups        ✗ No moves    │
│  ✓ Move groups               ✓ Move groups          ✓ View only   │
│  ✓ Reorder swimlines         ✓ Edit capacity        ✓ Historical  │
│  ✓ Edit names                ✓ Ungroup              ✓ Export data │
│  ✓ Delete swimlines          ✓ Edit group names     
│                                                                   │
│  ┌─────────┐  [Start PI]  ┌──────────────┐  [Close]  ┌────────┐  │
│  │  Draft  │─────────────→│ In Progress  │─────────→ │ Closed │  │
│  └─────────┘ (confirm)    └──────────────┘           └────────┘  │
│       ▲                           │                        │      │
│       │                           └────── [Replan] ────────┘      │
│       │                                   (bidirectional)         │
│       └──────────────────────────────────────────────────────────┘│
│                    Can move back to Draft                         │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

## 7. Dependency Visualization

```
Item with Dependencies:

  PBI-102: 2FA Implementation
  ─────────────────────────────
  [⚠ dependency] (click for details)
  
  Predecessor: PBI-101 (Login UI) ✓ exists
  Successor: PBI-201 (Dashboard) ⚠ cross-PI (PI-2)
  
  ──────────────────────────────
  Description: Two-factor auth
  [Edit] [Delete] [Show in PI]


Item with Broken Dependency:

  PBI-302: Docker Container
  ─────────────────────────
  [⚠ broken] (click for details)
  
  Parent Feature: DevOps (ID: 301) ✗ MISSING
  
  ──────────────────────────────
  This PBI is orphaned. Parent feature was deleted.
  [Assign to Feature] [Delete PBI]


Item with Cross-PI Dependency:

  Group: Session Management
  ────────────────────────────
  [⚠ cross-PI] (click for details)
  
  PBI-104: Session timeout
  Depends on: PBI-201 (in PI-1: Q1-2026)
  
  ──────────────────────────────
  Warning: Dependency is in a different PI
  [View Dependency] [Show Timeline]
```

## 8. Multi-select Operations

```
BULK OPERATIONS (with Multi-select)

┌────────────────────────────────────────────────────────┐
│  ☐ Feature: Auth (ID: 101)        [☑]                │
│  ├─ ☐ PBI-101 (5 pts)             [ ]                │
│  ├─ ☑ PBI-102 (8 pts)             [☑]                │
│  ├─ ☑ PBI-103 (13 pts)            [☑]                │
│  ├─ ☐ PBI-104 (13 pts)            [ ]                │
│  └─ ☐ PBI-105 (6 pts)             [ ]                │
│                                                       │
│  ☐ Feature: Dashboard (ID: 201)   [ ]                │
│  └─ ☐ PBI-201 (8 pts)             [ ]                │
└────────────────────────────────────────────────────────┘

Selected: 3 items (Feature + 2 PBIs)

[Batch Actions]
├─ Move to PI...
├─ Move to Swimline...
├─ Set Dependency...
├─ Create Group
└─ Delete Selected (confirm)
```

---

## Legend

```
✓ = Item is complete/scheduled
○ = Item is available/ungrouped
⚠ = Warning (dependency, missing parent, etc.)
✗ = Not available/blocked
→ = Depends on / Points to
[  ] = Clickable button/action
☐ ☑ = Checkbox
▼ ▲ = Expandable/Collapsible
```

---

## Notes

1. **Feature Zone**: Left side, shows all features in swimlines with ungrouped PBIs
2. **Sprint Columns**: 5 equal-width columns, each represents one sprint
3. **Swimlines**: Run horizontally across entire PI (feature zone + all sprints)
4. **Groups**: Named containers of PBIs from same feature, placed in sprint columns
5. **Drag-Drop**: Features to swimlines, PBIs to groups, groups between sprints
6. **Effort Rollup**: Displayed at swimline level and group level
7. **Capacity**: Set per sprint, displayed with effort comparison
8. **Warnings**: Icons indicate broken/missing/cross-PI dependencies (clickable)

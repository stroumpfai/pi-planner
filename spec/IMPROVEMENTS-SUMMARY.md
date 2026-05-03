# Spec Improvements Summary

## Key Changes from Original to Phase 1 MVP

### 1. **Authentication & Access Control** (NEW SECTION)
**What was missing:** No details on user login or multi-user behavior
**What was added:**
- Basic authentication: Username/password login (Phase 1)
- Session management: 1-hour timeout, 30-day "Remember me" option
- **Single-writer pattern fully specified:**
  - Only 1 user can edit at a time
  - Up to 10 concurrent readers (read-only)
  - Edit lock acquirable immediately (no queuing)
  - 30-minute inactivity timeout + auto-save + lock release
  - 1-minute heartbeat to keep session alive
- Edit indicator: Green dot (you're editing) vs Amber banner (someone else editing)
- **Deferred to Phase 2:** User registration, role-based access, admin panel

### 2. **CSV Import, Dependencies Moved to Phase 2**
**What was removed from Phase 1:**
- ✗ CSV import (from Azure DevOps, Excel, etc.)
- ✗ Dependency management (predecessor/successor relationships)
- ✗ Broken dependency tracking and warnings
- ✗ Cross-PI dependency warnings
- ✗ Search by title (kept sorting by name/creation date)

**Why:** Reduces Phase 1 scope significantly; enables faster MVP delivery. Dependencies require bidirectional graph tracking and validation complexity deferred to Phase 2.

### 3. **Rich Text Support Clarified**
**What was unclear:** What "rich text" means
**What was specified:**
- **Phase 1: Plain text only**
  - No bold, italic, links, HTML, or Markdown
  - Line breaks allowed (Enter key creates new lines)
  - Max 2000 characters per description
- **Phase 2:** Rich text (Markdown or limited HTML) deferred

### 4. **CSV Format Detailed (for Phase 2)**
**What was deferred (section 10.1):**
- Column headers: `ID, Type, Title, Description, Effort, ParentFeatureID, Predecessor, Successor`
- Delimiter: Comma (`,`)
- Encoding: UTF-8
- Text escaping: Double-quote (`"`)
- Max file size: 10 MB
- Max rows: 2000
- Example CSV provided for reference

### 5. **Search & Sort Clarified**
**What was vague:** "Search by title, Sort by name"
**What was specified:**
- **Sort options:** By name (A-Z) or by creation date (newest first)
  - User can toggle preference (persisted in localStorage)
  - Default: Creation date (newest first)
- **Search:** Deferred to Phase 2 (full-text search, filters, advanced queries)
- **Phase 1:** Just sorting, no search

### 6. **Swimlane Reordering Detailed**
**What was missing:** How swimlines are reordered
**What was specified:**
- **Drag-to-reorder**: User grabs swimline header and drags up/down
- **Visual feedback**: Swimlane dims while dragging, insertion point shown
- **Alternative buttons**: "Move up", "Move down" in context menu
- **Allowed states:** Draft and In Progress (Closed is read-only)
- **Persistence:** Immediately saved, order affects visual layout

### 7. **Edit Conflict Handling Simplified**
**What was complex:** Merge strategies, conflict resolution algorithms
**What was clarified:**
- **Not needed in Phase 1** because edit lock prevents simultaneous writes
- **Strategy:** Last-write-wins (if edge case occurs, last save overwrites)
- **Prevention:** Single-writer pattern via edit lock

### 8. **Error Recovery & Timeouts Detailed**
**What was missing:** What happens on inactivity, disconnect, timeout
**What was specified:**
- **Edit lock timeout:** 30 minutes of inactivity
  - Auto-save triggered before release
  - Lock released, other users can request edit mode
- **Heartbeat:** Client pings every 1 minute to reset timeout
- **Browser crash/close:** Lock auto-released after 5 minutes of no heartbeat
- **Connection loss:** User can reconnect (lock auto-released, session can resume within 5 min)

### 9. **Performance & Scale Clarified**
**What was missing:** Expected data volume and concurrent user limits
**What was specified:**
- **Data volume:** A few hundred items per project (max 999 Features, 999 PBIs per Feature)
- **Concurrent users:** Max 1 writer + 10 readers
- **Scale limits:**
  - Swimlanes per PI: 99
  - Groups per sprint: 99
  - PBIs per group: 100
- **No offline mode:** Always-online assumption

### 10. **Rich Text Details Added (Section 3.3)**
**What was missing:** Exact rules for text formatting
**What was added:**
- Allowed: Alphanumeric, spaces, punctuation, line breaks
- Not allowed: Bold, italic, HTML, Markdown
- Max length: 2000 characters (descriptions)

### 11. **Data Model Expanded**
**What was simplified:**
- Clear **field types** for each entity (string max lengths, integer constraints)
- **Timestamps** added: created, modified (auto-managed)
- **Location tracking:** Features/PBIs can be in backlog or in PI/swimlane/group
- **Cascade rules** clarified:
  - Delete Feature → all PBIs deleted
  - Delete PBI → removed from group (group may become empty)
  - Move Feature to backlog → all groups deleted, PBIs ungrouped

### 12. **Phase 2 Deferred List (NEW SECTION 11)**
**What was unclear:** What's MVP vs. future
**What was specified:**
- **Deferred to Phase 2:** CSV import, authentication (advanced), dependencies, search, rich text, notifications, audit logs, templates, CRDT-based concurrent editing, integrations

### 13. **Design System Notes (NEW SECTION)**
**What was missing:** Color tokens, typography, spacing
**What was added:**
- Minimum token references (colors, typography, spacing, capacity bar styles)
- Note: Substitute your design system's equivalents

### 14. **Technical Architecture Notes (NEW SECTION 10)**
**What was missing:** Implementation guidance
**What was added:**
- Frontend: React + TanStack Query + Zustand/Redux
- Backend: REST API, session auth, Redis for edit lock, SSE for real-time
- Database: PostgreSQL with indexes on key fields
- Auto-save: Debounced 100ms, optimistic updates

### 15. **Detailed Swimlane Section (NEW Section 4.2)**
**What was vague:** Swimline interaction model
**What was specified:**
- Feature zone: Fixed width ~90-110px
- 5 sprint columns: Equal flex width
- Capacity bars: 3px height, color-coded (gray/amber/red)
- Collapsible headers with feature count
- Swimline body shows features + groups in sprint columns

### 16. **Swimlane Deletion Rules (NEW Section 4.2)**
**What was missing:** What happens when swimline deleted
**What was specified:**
- Empty swimlines: Can delete without confirmation
- Non-empty swimlines: Confirmation required
- On delete: Features return to backlog, groups deleted, PBIs ungrouped

### 17. **Group Management Detailed (NEW Section 4.3)**
**What was vague:** Exact grouping workflow
**What was specified:**
- Step-by-step: Select PBIs → Right-click → Create Group → Name → Drag to sprint
- Edit: Rename, reorder PBIs within group, move PBIs between groups
- Ungroup: Returns PBIs to feature zone (cannot ungroup in Closed PI)
- Delete: Deletes group only, not PBIs

### 18. **Acceptance Criteria Simplified (Section 12)**
**What was comprehensive:** 400+ lines of criteria
**What was simplified:** Focused on Phase 1 MVP only, removed dependencies/CSV criteria

---

## What's Still Deferred (Phase 2+)

| Feature | Reason | Phase |
|---------|--------|-------|
| CSV Import | Complex validation, error handling | Phase 2 |
| Dependencies | Graph tracking, bidirectional relationships | Phase 2 |
| Advanced Search | Full-text indexing, filter UI | Phase 2 |
| Rich Text | Editor library, content sanitization | Phase 2 |
| User Registration | Admin panel, role management | Phase 2 |
| Notifications | Email service, webhooks | Phase 2 |
| Audit Logs | Data retention, historical queries | Phase 2 |
| Real-time Sync | CRDT or OT, conflict resolution | Phase 2+ |
| Integrations | API design, third-party vendor APIs | Phase 2+ |

---

## Files Generated

- **`p2-pi-planning-detailed-IMPROVED.md`**: Complete Phase 1 MVP specification (comprehensive, all sections filled in)
- **`IMPROVEMENTS-SUMMARY.md`** (this file): Summary of changes and rationale

---

## Key Takeaways for Implementation Teams

1. **Phase 1 is scoped tightly**: No CSV, no dependencies, no rich text, no auth advanced features
2. **Single-writer pattern is core**: Edit lock design is critical to get right
3. **Auto-save is essential**: Every action triggers debounced save
4. **Simple data model**: No complex relationships, just Features → PBIs → Groups
5. **Plain text only**: Simplifies storage and UI validation
6. **5-minute quick start**: No CSV imports, just manual item creation
7. **Performance is not a concern**: Few hundred items, single-digit concurrent edits

---

## Questions to Clarify Before Implementation

1. **UI Framework**: React? Vue? Something else?
2. **Design System**: Any existing design tokens, component library?
3. **Deployment**: Docker? Kubernetes? Vercel/Render?
4. **Database**: PostgreSQL? SQLite? Managed service?
5. **Authentication library**: NextAuth, Passport, custom?
6. **Drag-and-drop library**: dnd-kit or react-beautiful-dnd?
7. **Timeline**: 12 weeks? 16 weeks? 6 months?
8. **Team size**: How many frontend/backend engineers?
9. **Accessibility requirements**: WCAG 2.1 AA? Basic compliance?
10. **Browser support**: Modern browsers only? IE11 support?


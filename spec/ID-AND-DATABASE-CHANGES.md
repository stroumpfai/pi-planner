# Changes: User-Provided IDs & SQLite Database

## Summary of Changes Made to p2-pi-planning-detailed-IMPROVED.md

### 1. User-Provided IDs (Optional, Not Primary Keys)

#### Conceptual Model (Section 2.1)
**Changed from:**
- Single "ID" field: System auto-generated, globally unique
- ID used as database primary key

**Changed to:**
- Two ID fields per entity:
  - **System ID** (`feature_id`, `pbi_id`): Internal database primary key
    - Type: UUID or auto-increment integer
    - System-generated, immutable, never exposed to user
    - Used for all database relationships and referential integrity
  - **User-provided ID**: Optional business identifier
    - Type: Numerical (1–999999)
    - Optional (can be blank/empty)
    - User can set, change, or remove anytime
    - Must be unique within project (Features and PBIs share ID namespace)
    - Not used for database relationships

#### Key Changes in Data Model (Section 2.1)

**Feature Entity:**
- ✓ New field: `feature_id` (system primary key, UUID/auto-increment)
- ✓ Changed field: `ID` → `user_id` (optional, 1–999999, can be null)
- ✓ Updated description: "User can rename/change this ID anytime"
- ✓ Clarified: "Not used as database primary key (used for business reference only)"

**PBI Entity:**
- ✓ New field: `pbi_id` (system primary key, UUID/auto-increment)
- ✓ Changed field: `ID` → `user_id` (optional, 1–999999, can be null)
- ✓ Updated description: "User can rename/change this ID anytime"
- ✓ Updated parent reference: Now uses parent's `feature_id` (system ID), not `user_id`
- ✓ Clarified: "Parent references must use system IDs internally (database referential integrity)"

#### Data Constraints (Section 2.2)
- ✓ Added: **System IDs are unique and immutable**
- ✓ Added: **User-provided IDs are optional, can be changed**
- ✓ Added: **User-provided IDs share namespace** (Features and PBIs cannot have duplicate user IDs)
- ✓ Added: **Parent references use system IDs** for integrity

#### Create & Edit Workflows (Section 3.2)
- ✓ Updated "Create Feature": User can optionally provide user ID (1–999999)
- ✓ Updated "Create PBI": User can optionally provide user ID
- ✓ Updated "Edit Items": User can change/add/remove user ID with uniqueness validation

#### Data Limits (Section 9)
- ✓ Added: `User-provided ID range: 1–999999 (optional, can be blank)`
- ✓ Added: `User-provided ID uniqueness: Per project (Features and PBIs share namespace)`

---

### 2. SQLite Database (Phase 1 MVP)

#### Backend Design (Section 10.2)
**Changed from:**
- PostgreSQL assumed for all phases
- "Database indexes on: project_id, feature_id, pbi_id, pi_id, swimlane_id"

**Changed to:**
- **SQLite recommended for Phase 1 MVP**
  - Simple file-based database, no server needed
  - Sufficient for single-tenant application with few hundred items
  - Sufficient for 1 concurrent writer (single-writer edit lock pattern)
  - Can migrate to PostgreSQL in Phase 2 if scalability needed
  - Simpler development/deployment (no database server setup)

#### Database Schema Details (New)
- Indexes on: `project_id`, `feature_system_id`, `pbi_system_id`, `pi_id`, `swimlane_id`
- Unique constraint on: `(project_id, user_id)` for user-provided IDs across Features and PBIs
- Foreign keys enforced:
  - `pbi.parent_feature_id` → `feature.feature_id`
  - `swimlane.pi_id` → `pi.pi_id`
  - `group.swimlane_id` → `swimlane.swimlane_id`
  - `group.feature_id` → `feature.feature_id`

#### Migration Path
- Phase 1: SQLite (file-based, single-file database)
- Phase 2+: Can migrate to PostgreSQL if:
  - Concurrent writes needed (true multi-user collaboration)
  - Larger data volumes (millions of items)
  - Advanced querying/analytics needed

---

## Database Schema Example (SQLite)

```sql
-- Projects
CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,  -- UUID
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Features
CREATE TABLE features (
  feature_id TEXT PRIMARY KEY,  -- UUID (system ID)
  project_id TEXT NOT NULL,
  user_id INTEGER,              -- Optional (1–999999)
  title TEXT NOT NULL,
  description TEXT,
  effort INTEGER,
  location TEXT DEFAULT 'backlog',  -- 'backlog' | 'pi'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id),
  UNIQUE(project_id, user_id)   -- Enforce user ID uniqueness per project
);

-- PBIs (Product Backlog Items)
CREATE TABLE pbis (
  pbi_id TEXT PRIMARY KEY,      -- UUID (system ID)
  project_id TEXT NOT NULL,
  parent_feature_id TEXT NOT NULL,  -- FK to feature_id (system ID)
  user_id INTEGER,              -- Optional (1–999999)
  title TEXT NOT NULL,
  description TEXT,
  effort INTEGER,
  location TEXT DEFAULT 'backlog',  -- 'backlog' | 'pi'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id),
  FOREIGN KEY (parent_feature_id) REFERENCES features(feature_id),
  UNIQUE(project_id, user_id)   -- Enforce user ID uniqueness per project
);

-- PIs (Program Increments)
CREATE TABLE pis (
  pi_id TEXT PRIMARY KEY,       -- UUID
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  state TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'in_progress' | 'closed'
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

-- Swimlines
CREATE TABLE swimlines (
  swimline_id TEXT PRIMARY KEY,  -- UUID
  pi_id TEXT NOT NULL,
  name TEXT NOT NULL,
  order_index INTEGER,           -- For reordering
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pi_id) REFERENCES pis(pi_id),
  UNIQUE(pi_id, name)
);

-- Groups (of PBIs within a swimline/sprint)
CREATE TABLE groups (
  group_id TEXT PRIMARY KEY,    -- UUID
  swimline_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,     -- Ensures one group = one feature
  name TEXT NOT NULL,
  sprint_index INTEGER,         -- 0–4
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (swimline_id) REFERENCES swimlines(swimline_id),
  FOREIGN KEY (feature_id) REFERENCES features(feature_id)
);

-- PBIs in Groups (junction table)
CREATE TABLE group_pbis (
  group_pbi_id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  pbi_id TEXT NOT NULL,
  order_index INTEGER,          -- For PBI order within group
  FOREIGN KEY (group_id) REFERENCES groups(group_id),
  FOREIGN KEY (pbi_id) REFERENCES pbis(pbi_id),
  UNIQUE(group_id, pbi_id)
);

-- Sprints (per PI)
CREATE TABLE sprints (
  sprint_id TEXT PRIMARY KEY,   -- UUID
  pi_id TEXT NOT NULL,
  sprint_index INTEGER,         -- 0–4
  capacity INTEGER,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pi_id) REFERENCES pis(pi_id),
  UNIQUE(pi_id, sprint_index)
);

-- Edit Lock (for single-writer pattern)
CREATE TABLE edit_lock (
  edit_lock_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  locked_by TEXT,               -- Username
  locked_at TIMESTAMP,
  expires_at TIMESTAMP,         -- 30 min from lock time
  FOREIGN KEY (project_id) REFERENCES projects(project_id)
);

-- Indexes for performance
CREATE INDEX idx_features_project ON features(project_id);
CREATE INDEX idx_features_user_id ON features(project_id, user_id);
CREATE INDEX idx_pbis_project ON pbis(project_id);
CREATE INDEX idx_pbis_parent ON pbis(parent_feature_id);
CREATE INDEX idx_pbis_user_id ON pbis(project_id, user_id);
CREATE INDEX idx_swimlines_pi ON swimlines(pi_id);
CREATE INDEX idx_groups_swimline ON groups(swimline_id);
```

---

## Impact on Implementation

### Frontend
- **Display**: Show user-provided ID if set, otherwise show system ID or placeholder
- **API calls**: Always use system IDs for relationships (PBI.parent_feature_id = feature_system_id)
- **CSV export**: Export both system ID and user-provided ID (for Phase 2 import)

### Backend
- **API responses**: Include both `id` (user-provided, nullable) and `system_id` (always present)
- **Database queries**: All JOINs use system IDs, not user-provided IDs
- **Validation**: Enforce unique constraint on `(project_id, user_id)` at database level
- **CSV import (Phase 2)**: Match user-provided IDs during import, not system IDs

### Example API Response
```json
{
  "feature": {
    "system_id": "f550e8c6-3b25-4b29-8c5d-a8c8c8c8c8c8",  // System ID (never changes)
    "id": 101,                                            // User-provided ID (optional)
    "title": "Authentication",
    "description": "User login system",
    "effort": 45,
    "pbis": [
      {
        "system_id": "p123e456-a789-4d5e-1234-b5e1234c5e89",
        "id": 102,
        "title": "Login UI",
        "effort": 5
      }
    ]
  }
}
```

---

## Key Advantages of This Approach

1. **Flexibility**: Users can organize items by any ID scheme (e.g., 101, 102 OR 001, 002 OR project-specific)
2. **Import/Export**: CSV files use user-provided IDs, making imports from other tools easier
3. **Database integrity**: System IDs prevent orphaned references and data corruption
4. **Rename capability**: Users can reorganize item IDs without database migration
5. **Backwards compatibility**: Can support legacy ID schemes during Phase 2 CSV import

---

## Questions for Implementation Team

1. **User ID display format**: Should blank user IDs show as "(no ID)", "#[system_id]", or empty?
2. **CSV export format (Phase 2)**: Include both system ID and user ID columns, or just user ID?
3. **ID validation**: Should user IDs allow letters (e.g., "FEAT-001") or strictly numbers (1–999999)?
4. **SQLite vs PostgreSQL**: Is SQLite acceptable for Phase 1, or required to use PostgreSQL from start?
5. **Database file location**: ~/.config/pi-planning/db.sqlite or embedded within app?


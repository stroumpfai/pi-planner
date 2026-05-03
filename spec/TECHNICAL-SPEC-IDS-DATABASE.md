# Technical Specification: IDs & Database Design

## 1. Overview

This specification defines:
- How Features and PBIs are identified (system IDs vs. user-provided IDs)
- Database schema and relationships
- ID validation and uniqueness rules
- Display and export rules

**Target**: Single-tenant MVP application with ~1-3 concurrent edits, SQLite database.

---

## 2. ID System Architecture

### 2.1 Dual-ID Model

Every Feature and PBI has **two identifiers**:

#### System ID (`system_id`)
- **Purpose**: Internal database primary key
- **Type**: UUID (36 chars) or bigint auto-increment
- **Generated**: Automatically by system
- **Immutable**: Never changes, never exposed to user in UI
- **Used for**: All database relationships, API internal references
- **Visibility**: Only in system logs/debugging

#### User-Provided ID (`user_id`)
- **Purpose**: Business identifier visible to users
- **Type**: Integer (1 to 999,999) OR blank/null
- **Set by**: User (can be left blank)
- **Mutable**: User can change/update/delete anytime
- **Unique**: Must be unique per project (Features and PBIs share namespace)
- **Visibility**: Displayed everywhere in UI (if set)

### 2.2 Distinction

| Aspect | System ID | User ID |
|--------|-----------|---------|
| Primary Key | ✓ | ✗ |
| Database FK references | ✓ (all) | ✗ |
| User-visible | ✗ | ✓ |
| Mutable | ✗ | ✓ |
| Required | ✓ | ✗ |
| Scope | Global (system) | Per-project |
| Example | `f550e8c6-3b25-4b29-8c5d-a8c8c8c8c8c8` | `101` or blank |

---

## 3. User ID Specification

### 3.1 Format & Validation

**User ID rules:**
- **Type**: Non-negative integer
- **Range**: 1 to 999,999
- **Blank allowed**: YES (user can leave empty or delete existing ID)
- **Letters/symbols allowed**: NO (numbers only; Phase 2 can extend)
- **Whitespace**: Trimmed automatically (leading/trailing spaces removed)
- **Duplicates**: NOT allowed within same project (Features and PBIs share namespace)

**Examples:**
- ✓ Valid: 1, 101, 999999, blank/null
- ✗ Invalid: 0, 1000000, "FEAT-001", "F101", "101.5", "-5"

### 3.2 Uniqueness Constraint

**Scope**: Per project (not global)

**Rule**: For each project, user IDs must be unique across Features AND PBIs combined.
- Feature #101 exists → Cannot create PBI #101 in same project
- PBI #202 exists → Cannot change Feature ID to #202 in same project
- Feature #101 in Project A, Feature #101 in Project B → ALLOWED (different projects)

**Enforcement**: Database-level unique constraint:
```sql
UNIQUE(project_id, user_id)
```

### 3.3 Display Rules

**When user ID is set (e.g., 101):**
- Display in UI: `101` or `#101` (with or without # prefix, team decides)
- In list: `[101] Feature Title` or `Feature Title (#101)`
- In breadcrumb: Show user ID if available

**When user ID is blank/null:**
- Display in UI: No ID shown OR show as "(No ID)" placeholder
- In list: `[—] Feature Title` or `Feature Title`
- In breadcrumb: Show system ID suffix for uniqueness (e.g., "Feature #f550e8c6")
- **Decision**: Show as empty/blank (clean UI) - no ID label if not set

### 3.4 Editing User IDs

**Update/change existing user ID:**
- User can change Feature #101 ID to #205 anytime (except in Closed PI, read-only)
- System validates: New ID not already taken in project
- If validation fails: Show error "ID #205 already used in this project"

**Delete/clear user ID:**
- User can set ID to blank (remove user ID)
- Item displays without ID in UI

**Auto-assignment (Phase 2+):**
- Future: Auto-increment user IDs if user desires
- For now: Manual user assignment only

---

## 4. Database Schema

### 4.1 SQLite Recommended

**Decision**: Use SQLite 3 for Phase 1 MVP

**Justification:**
- Single-tenant, no multi-database concerns
- Few hundred items (not millions)
- 1 concurrent writer (edit lock prevents conflicts)
- Simple file-based setup (no server)
- Easier to ship and test
- Can migrate to PostgreSQL in Phase 2 if needed

**Migration path (Phase 2+):**
- If concurrent writers needed → PostgreSQL
- If data > 1M items → PostgreSQL
- If CRDT/real-time collab → PostgreSQL + Redis

### 4.2 Database File Location

**Decision**: Application-managed directory

**Location**: `~/.pi-planning/db.sqlite` (user home directory)
- Cross-platform: Works on Windows, macOS, Linux
- User's home: Not system-wide, safe for multi-user machines
- Discoverable: Users know where to back up their database
- Portable: Can manually copy database to another machine

**Alternative paths** (not chosen):
- ✗ `~/.config/pi-planning/db.sqlite` (Linux-specific, confusing on Windows)
- ✗ Application directory (not portable, may require permissions)
- ✗ Browser localStorage (limits to ~5MB, not suitable)

**Initialization:**
- On first run: Create `~/.pi-planning/` directory if not exists
- On first run: Create `db.sqlite` file with schema
- On updates: Run migrations if schema changes

### 4.3 Database Schema

```sql
-- Projects (single-tenant, but structure allows expansion)
CREATE TABLE projects (
  system_id TEXT PRIMARY KEY,  -- UUID
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_projects_name ON projects(name);

-- Features
CREATE TABLE features (
  -- Primary Key & Identity
  system_id TEXT PRIMARY KEY,  -- UUID, never exposed to user
  project_id TEXT NOT NULL,
  
  -- User-Provided ID (business identifier)
  user_id INTEGER,             -- Nullable, 1–999,999
  
  -- Content
  title TEXT NOT NULL,         -- Max 255 chars
  description TEXT,            -- Max 2000 chars, plain text
  effort INTEGER,              -- Nullable, positive if set
  
  -- Location
  location TEXT DEFAULT 'backlog',  -- 'backlog' or 'pi'
  pi_id TEXT,                  -- Nullable, FK to pi_id (when in PI)
  swimlane_id TEXT,            -- Nullable, FK to swimlane_id (when in swimlane)
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Constraints
  FOREIGN KEY (project_id) REFERENCES projects(system_id),
  FOREIGN KEY (pi_id) REFERENCES pis(system_id),
  FOREIGN KEY (swimlane_id) REFERENCES swimlines(system_id),
  UNIQUE(project_id, user_id)  -- Enforce user ID uniqueness per project
);
CREATE INDEX idx_features_project ON features(project_id);
CREATE INDEX idx_features_user_id ON features(project_id, user_id);
CREATE INDEX idx_features_pi ON features(pi_id);
CREATE INDEX idx_features_swimlane ON features(swimlane_id);

-- PBIs (Product Backlog Items)
CREATE TABLE pbis (
  -- Primary Key & Identity
  system_id TEXT PRIMARY KEY,  -- UUID, never exposed to user
  project_id TEXT NOT NULL,
  
  -- User-Provided ID (business identifier)
  user_id INTEGER,             -- Nullable, 1–999,999
  
  -- Parent Feature (required)
  parent_feature_system_id TEXT NOT NULL,  -- FK to features.system_id
  
  -- Content
  title TEXT NOT NULL,         -- Max 255 chars
  description TEXT,            -- Max 2000 chars, plain text
  effort INTEGER,              -- Nullable, positive if set
  
  -- Location
  location TEXT DEFAULT 'backlog',  -- 'backlog' or 'pi'
  pi_id TEXT,                  -- Nullable, FK to pi_id
  swimlane_id TEXT,            -- Nullable, FK to swimlane_id
  group_id TEXT,               -- Nullable, FK to groups.system_id
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Constraints
  FOREIGN KEY (project_id) REFERENCES projects(system_id),
  FOREIGN KEY (parent_feature_system_id) REFERENCES features(system_id) ON DELETE CASCADE,
  FOREIGN KEY (pi_id) REFERENCES pis(system_id),
  FOREIGN KEY (swimlane_id) REFERENCES swimlines(system_id),
  FOREIGN KEY (group_id) REFERENCES groups(system_id),
  UNIQUE(project_id, user_id)  -- Enforce user ID uniqueness per project
);
CREATE INDEX idx_pbis_project ON pbis(project_id);
CREATE INDEX idx_pbis_user_id ON pbis(project_id, user_id);
CREATE INDEX idx_pbis_parent ON pbis(parent_feature_system_id);
CREATE INDEX idx_pbis_pi ON pbis(pi_id);
CREATE INDEX idx_pbis_group ON pbis(group_id);

-- PIs (Program Increments)
CREATE TABLE pis (
  system_id TEXT PRIMARY KEY,  -- UUID
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,          -- Max 100 chars
  description TEXT,            -- Max 500 chars
  state TEXT NOT NULL DEFAULT 'draft',  -- 'draft' | 'in_progress' | 'closed'
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(system_id),
  UNIQUE(project_id, name)
);
CREATE INDEX idx_pis_project ON pis(project_id);

-- Swimlines (per PI)
CREATE TABLE swimlines (
  system_id TEXT PRIMARY KEY,  -- UUID
  pi_id TEXT NOT NULL,
  name TEXT NOT NULL,          -- Max 100 chars, unique per PI
  order_index INTEGER,         -- For display order (0, 1, 2, ...)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pi_id) REFERENCES pis(system_id),
  UNIQUE(pi_id, name)
);
CREATE INDEX idx_swimlines_pi ON swimlines(pi_id);

-- Groups (of PBIs in swimline/sprint)
CREATE TABLE groups (
  system_id TEXT PRIMARY KEY,  -- UUID
  swimline_id TEXT NOT NULL,
  feature_system_id TEXT NOT NULL,  -- FK to features.system_id
  name TEXT NOT NULL,          -- Max 100 chars
  sprint_index INTEGER,        -- 0–4 (which sprint)
  order_index INTEGER,         -- For display order within sprint
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (swimline_id) REFERENCES swimlines(system_id),
  FOREIGN KEY (feature_system_id) REFERENCES features(system_id) ON DELETE CASCADE
);
CREATE INDEX idx_groups_swimline ON groups(swimline_id);
CREATE INDEX idx_groups_feature ON groups(feature_system_id);

-- Sprints (per PI, fixed 5 per PI)
CREATE TABLE sprints (
  system_id TEXT PRIMARY KEY,  -- UUID
  pi_id TEXT NOT NULL,
  sprint_index INTEGER,        -- 0–4
  capacity INTEGER NOT NULL,   -- User-set capacity (positive)
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  modified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pi_id) REFERENCES pis(system_id),
  UNIQUE(pi_id, sprint_index)
);
CREATE INDEX idx_sprints_pi ON sprints(pi_id);

-- Edit Lock (single-writer pattern)
CREATE TABLE edit_lock (
  system_id TEXT PRIMARY KEY,  -- UUID
  project_id TEXT NOT NULL UNIQUE,
  locked_by_username TEXT,     -- Username of editor
  locked_at TIMESTAMP,
  expires_at TIMESTAMP,        -- 30 min from locked_at
  FOREIGN KEY (project_id) REFERENCES projects(system_id)
);
CREATE INDEX idx_edit_lock_project ON edit_lock(project_id);

-- Sessions (user authentication)
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,  -- UUID or secure token
  username TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,        -- 1 hour from created_at
  remember_me BOOLEAN DEFAULT FALSE,
  UNIQUE(username, session_id)
);
CREATE INDEX idx_sessions_username ON sessions(username);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Users (single-tenant, may be pre-populated)
CREATE TABLE users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,  -- bcrypt or scrypt hash
  display_name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 4.4 Data Integrity Rules

**Referential Integrity:**
- Feature delete → Cascade delete all child PBIs
- Feature delete → Groups referencing Feature deleted
- PBI delete → Remove from group (group may become empty)
- Swimline delete → Features in swimline return to backlog
- Group delete → PBIs remain, return to feature zone ungrouped

**User ID Constraints:**
- Unique per project (Features + PBIs combined)
- Nullable (can be blank)
- Validated on create/update before write to database

**PI State Constraints:**
- Only one PI per project can be "in_progress"
- Closed PIs are read-only (enforced at application layer)

---

## 5. API Specification

### 5.1 ID Representation in Responses

**All API responses include both IDs:**

```json
{
  "feature": {
    "system_id": "f550e8c6-3b25-4b29-8c5d-a8c8c8c8c8c8",
    "id": 101,
    "title": "Authentication",
    "description": "User login system",
    "effort": 45,
    "created_at": "2026-03-01T10:30:00Z",
    "modified_at": "2026-03-05T14:22:00Z"
  }
}
```

**API convention:**
- `system_id`: Always included, never null, internal use only
- `id`: User-provided ID (nullable), displayed in UI
- Clients use `system_id` for all relationships/requests
- Clients display `id` in UI (if set)

### 5.2 Request/Response Examples

#### Create Feature
**Request:**
```json
POST /api/projects/{project_system_id}/features
{
  "title": "Authentication",
  "description": "User login system",
  "effort": 45,
  "id": 101                         // Optional user ID
}
```

**Response (201 Created):**
```json
{
  "system_id": "f550e8c6-3b25-4b29-8c5d-a8c8c8c8c8c8",
  "id": 101,
  "title": "Authentication",
  "description": "User login system",
  "effort": 45,
  "created_at": "2026-03-01T10:30:00Z"
}
```

#### Update Feature ID
**Request:**
```json
PATCH /api/features/{feature_system_id}
{
  "id": 205                         // Change user ID from 101 to 205
}
```

**Response (200 OK):**
```json
{
  "system_id": "f550e8c6-3b25-4b29-8c5d-a8c8c8c8c8c8",
  "id": 205,                        // Updated
  "title": "Authentication"
}
```

**Error Response (409 Conflict - duplicate ID):**
```json
{
  "error": "ID_ALREADY_EXISTS",
  "message": "ID 205 already used in this project",
  "details": {
    "conflicting_feature_system_id": "a1b2c3d4-5e6f-7g8h-9i0j-k1l2m3n4o5p6"
  }
}
```

#### Clear/Delete User ID
**Request:**
```json
PATCH /api/features/{feature_system_id}
{
  "id": null                        // Remove user ID
}
```

**Response (200 OK):**
```json
{
  "system_id": "f550e8c6-3b25-4b29-8c5d-a8c8c8c8c8c8",
  "id": null,                       // Cleared
  "title": "Authentication"
}
```

#### Create PBI with Parent Reference
**Request:**
```json
POST /api/projects/{project_system_id}/pbis
{
  "title": "Login UI",
  "parent_feature_system_id": "f550e8c6-3b25-4b29-8c5d-a8c8c8c8c8c8",  // Use system ID
  "effort": 5,
  "id": 102                         // Optional user ID
}
```

**Response (201 Created):**
```json
{
  "system_id": "p123e456-a789-4d5e-1234-b5e1234c5e89",
  "id": 102,
  "title": "Login UI",
  "parent_feature_system_id": "f550e8c6-3b25-4b29-8c5d-a8c8c8c8c8c8",
  "effort": 5,
  "created_at": "2026-03-01T10:35:00Z"
}
```

### 5.3 Validation Errors

**Invalid user ID (non-integer, out of range, duplicate):**
```json
{
  "error": "VALIDATION_ERROR",
  "message": "User ID validation failed",
  "fields": {
    "id": "Must be integer between 1 and 999999, or null"
  }
}
```

---

## 6. User Interface Display Rules

### 6.1 Feature/PBI Display

**In lists (backlog, swimlines):**
```
[101] Authentication              ← User ID in brackets
      ○ PBI-102: Login UI         ← User IDs for PBIs if set
      ○ PBI-103: 2FA              ← No user ID for this one
      ○ PBI-104: Logout
```

**With no user IDs:**
```
Authentication                    ← No ID shown
  ○ PBI-1: Login UI
  ○ PBI-2: 2FA
  ○ PBI-3: Logout
```

**In detail view/edit dialog:**
```
ID: 101        ← Input field, can be edited/cleared
Title: Authentication
Description: User login system
Effort: 45
```

### 6.2 ID Display Decision: No ID Label When Empty

**Decision**: When user ID is blank, show nothing (not "(No ID)")

**Rationale:**
- Cleaner UI
- Reduces clutter
- User can infer blank = no ID
- Matches common design patterns (empty cells shown as blank)

**Alternative** (not chosen): Show placeholder "(No ID)" when blank
- More explicit, but verbose
- Can be added later if users request it

### 6.3 Drag-and-Drop Labels

**Dragging feature to swimline:**
```
Dragging: [101] Authentication
          ↓ Drop into swimline
```

**Moving PBIs to group:**
```
Selected: [101] Auth, [102] Login UI, [103] 2FA
Action: Create Group
```

---

## 7. CSV Import/Export (Phase 2)

### 7.1 CSV Export Format

**Export includes:**
- User-provided ID (user_id column)
- System ID (not exported - internal only)
- Both Features and PBIs in single file

**CSV columns (when export implemented):**
```
user_id,type,title,description,effort,parent_user_id
101,Feature,Authentication,User login system,45,
102,PBI,Login UI,Create login form,5,101
103,PBI,2FA Implementation,Two-factor auth,8,101
,PBI,Forgotten Password,Allow password reset,3,101
201,Feature,Dashboard,Main dashboard display,38,
202,PBI,Main layout,Dashboard layout,8,201
```

**Notes:**
- `user_id`: User-provided ID (blank if not set)
- `parent_user_id`: References parent Feature's user ID (not system ID)
- System IDs not exported (not meant for human editing)
- Import should match by user_id (or create new if user_id not found)

### 7.2 CSV Import Behavior (Phase 2)

**When user_id matches existing item:**
- Update all fields for that item
- Preserve system_id

**When user_id is blank in import:**
- Create new item with no user ID
- System auto-generates system_id

**When user_id is duplicate in same import file:**
- Report error: "Duplicate user ID in import file"
- Skip row, continue with others

**When parent_user_id not found:**
- Mark PBI as "missing feature" (Phase 2 error handling)
- Or ask user to map parent during import

---

## 8. Implementation Checklist

### Database Setup
- [ ] Create SQLite database at `~/.pi-planning/db.sqlite`
- [ ] Run schema creation script on first run
- [ ] Add migration framework (e.g., Alembic for future changes)
- [ ] Add unique constraint on (project_id, user_id)
- [ ] Add all indexes for performance

### Backend API
- [ ] Include `system_id` and `id` in all responses
- [ ] Validate user ID on create/update:
  - [ ] Check range (1–999,999)
  - [ ] Check not duplicate in project
  - [ ] Allow null
- [ ] Use system_id for all FK relationships
- [ ] Allow editing user IDs (with uniqueness check)
- [ ] Return proper error messages for ID conflicts

### Frontend Display
- [ ] Show user ID in brackets: `[101] Feature Name`
- [ ] Show blank when no user ID (no placeholder text)
- [ ] Allow editing user ID in detail view
- [ ] Validate on client before API call
- [ ] Handle error responses for duplicate IDs

### Documentation
- [ ] Document system_id vs. user_id for developers
- [ ] Provide API examples with both IDs
- [ ] Add comments in code: "system_id = database primary key, do not expose"
- [ ] Add comments in code: "user_id = business ID, user-editable"

---

## 9. Future Considerations (Phase 2+)

**CSV Import/Export:**
- Implement full CSV import with user ID matching
- Export projects as CSV (all items)

**ID Customization:**
- Allow alphanumeric IDs (e.g., "FEAT-001")
- Allow auto-increment with prefix (e.g., "F-", "P-")
- Allow custom ID scheme per project

**PostgreSQL Migration:**
- If scaling needed, migrate to PostgreSQL
- Schema remains the same (system_id approach already compatible)
- Use migration tools (e.g., Alembic, Flyway)

**API Versioning:**
- Future API v2 might change ID representation
- For now, always include both system_id and user_id

---

## 10. Decision Summary

| Decision | Value | Rationale |
|----------|-------|-----------|
| System ID format | UUID | Immutable, globally unique, portable |
| User ID range | 1–999,999 | Simple, sufficient for few hundred items |
| User ID mutability | Yes, changeable | Users may reorganize IDs |
| User ID uniqueness scope | Per project | Features & PBIs share namespace |
| Database | SQLite | Simple, file-based, suitable for MVP |
| Database location | `~/.pi-planning/db.sqlite` | Cross-platform, discoverable |
| User ID display (empty) | Blank/no label | Clean UI, less clutter |
| Numeric IDs only (Phase 1) | Yes | Simple validation, Phase 2 can extend |
| CSV user ID | Allowed | Enables import from other tools |
| CSV system ID export | No | Internal only, not for import |

---

## 11. Questions & Answers

**Q: Why two IDs?**
A: System ID is for database integrity and relationships. User ID is for business workflows (e.g., importing from Azure DevOps which has its own ID scheme).

**Q: Can user IDs have letters?**
A: Not in Phase 1 (kept simple). Phase 2 can extend to "FEAT-001" format if needed.

**Q: What happens if user changes an ID?**
A: System ID stays the same. User ID updates. All database references use system ID, so no data integrity issues.

**Q: Why SQLite, not PostgreSQL?**
A: MVPquickness. Single-tenant, few items, 1 concurrent writer. PostgreSQL overkill for Phase 1. Trivial to migrate in Phase 2.

**Q: Can I export and re-import a project?**
A: Yes (Phase 2). Export uses user IDs, re-import matches by user ID. System IDs regenerated on new import.

**Q: What if user IDs collide between projects?**
A: No problem. Uniqueness is per-project. Feature #101 can exist in both Project A and Project B.

**Q: How do I know a user ID is set vs. blank?**
A: Check `id` field: if null/absent → blank. If integer → set.


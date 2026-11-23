# DATABASE — SAATH

Implementation: SQLAlchemy models (SQLite by default, PostgreSQL via `DATABASE_URL`). The SQL below is the reference schema in SQLite dialect; for PostgreSQL use `GENERATED ALWAYS AS IDENTITY` for ids and `JSONB`/`TIMESTAMPTZ` where noted. All timestamps are UTC.

## 1. Design summary
- **Users** are demo-grade identities with a role, alert/help opt-ins and last known location.
- **Incidents** hold the report, status, AI fields, freshness expiry and a `sensitive` flag. Reporter link is access-controlled.
- **Confirmations** enforce one community confirmation per user per incident.
- **Alerts** record which users were notified (simulated delivery).
- **SOS sessions** are time-limited; **help requests** reference an SOS and store only approximate location.
- **Camera references** are mock/authorized sources only.
- **Audit logs** record operator actions, status changes and feed access; the public status timeline is derived from them (no separate history table).

## 2. Relationships
```
users 1──* trusted_contacts
users 1──* incidents (reporter_id)
incidents 1──* incident_confirmations *──1 users
incidents 1──* alerts *──1 users (recipient)
users 1──* sos_sessions 1──* help_requests
audit_logs: actor_id → users; (entity_type, entity_id) is a soft reference
camera_references: standalone (mock)
```

## 3. Schema (SQLite dialect)
```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name     TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  contact          TEXT,                                   -- protected, never public
  role             TEXT NOT NULL DEFAULT 'citizen' CHECK (role IN ('citizen','operator')),
  alerts_opt_in    INTEGER NOT NULL DEFAULT 0 CHECK (alerts_opt_in IN (0,1)),
  alert_radius_km  REAL NOT NULL DEFAULT 2 CHECK (alert_radius_km BETWEEN 0.5 AND 5),
  help_opt_in      INTEGER NOT NULL DEFAULT 0 CHECK (help_opt_in IN (0,1)),
  last_lat         REAL CHECK (last_lat BETWEEN -90 AND 90),
  last_lng         REAL CHECK (last_lng BETWEEN -180 AND 180),
  last_seen_at     TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (display_name, role)
);

CREATE TABLE trusted_contacts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  contact   TEXT NOT NULL
);

CREATE TABLE incidents (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  category             TEXT NOT NULL CHECK (category IN
    ('road_hazard','accident','fire','water_issue','streetlight_outage',
     'suspicious_activity','theft','harassment','medical_emergency','missing_person','other')),
  description          TEXT NOT NULL CHECK (length(description) BETWEEN 10 AND 500),
  lat                  REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng                  REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  location_label       TEXT,
  occurred_at          TEXT NOT NULL,
  reported_at          TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at           TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN
    ('pending','community_confirmed','reviewed','resolved','dismissed')),
  reporter_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  evidence_url         TEXT,
  sensitive            INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0,1)),
  confirmations_count  INTEGER NOT NULL DEFAULT 0,
  ai_category          TEXT,
  ai_priority          TEXT CHECK (ai_priority IN ('low','medium','high','critical')),
  ai_summary           TEXT,
  ai_triage            TEXT,
  ai_confidence        REAL CHECK (ai_confidence BETWEEN 0 AND 1),
  ai_flags             TEXT NOT NULL DEFAULT '[]',        -- JSON array (JSONB on Postgres)
  ai_source            TEXT CHECK (ai_source IN ('gemini','rules'))
);
CREATE INDEX idx_incidents_geo      ON incidents (lat, lng);
CREATE INDEX idx_incidents_status   ON incidents (status, reported_at DESC);
CREATE INDEX idx_incidents_expires  ON incidents (expires_at);
CREATE INDEX idx_incidents_category ON incidents (category, reported_at DESC);
CREATE INDEX idx_incidents_reporter ON incidents (reporter_id);

CREATE TABLE incident_confirmations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id  INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (incident_id, user_id)
);

CREATE TABLE alerts (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id        INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  recipient_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  radius_km          REAL NOT NULL,
  delivery_status    TEXT NOT NULL DEFAULT 'simulated_delivered',
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (incident_id, recipient_user_id)
);
CREATE INDEX idx_alerts_recipient ON alerts (recipient_user_id, created_at DESC);

CREATE TABLE sos_sessions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat                 REAL NOT NULL,
  lng                 REAL NOT NULL,
  started_at          TEXT NOT NULL DEFAULT (datetime('now')),
  sharing_expires_at  TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','resolved')),
  notified_contacts   TEXT NOT NULL DEFAULT '[]'          -- JSON array of contact ids
);
CREATE INDEX idx_sos_user_status ON sos_sessions (user_id, status);

CREATE TABLE help_requests (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  sos_id            INTEGER NOT NULL REFERENCES sos_sessions(id) ON DELETE CASCADE,
  approx_lat        REAL NOT NULL,                        -- rounded ~300 m
  approx_lng        REAL NOT NULL,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opt_in_recipients TEXT NOT NULL DEFAULT '[]',           -- JSON array of user ids
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_help_status ON help_requests (status);

CREATE TABLE camera_references (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  lat              REAL NOT NULL,
  lng              REAL NOT NULL,
  mock_source_url  TEXT NOT NULL,
  is_simulated     INTEGER NOT NULL DEFAULT 1 CHECK (is_simulated = 1)   -- demo: always simulated
);

CREATE TABLE audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- NULL = system
  action       TEXT NOT NULL,        -- status_change | community_confirmed | camera_open | demo_reset | ...
  entity_type  TEXT NOT NULL,        -- incident | camera | sos | system
  entity_id    INTEGER,
  detail       TEXT NOT NULL DEFAULT '{}',                        -- JSON
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_entity ON audit_logs (entity_type, entity_id, created_at);
```

## 4. Constraints and rules enforced outside SQL
- Description is stripped and escaped; categories validated against the enum.
- Status transitions follow ARCHITECTURE.md section 6 (409 on invalid).
- A user cannot confirm their own incident; one confirmation per user (unique constraint).
- At most one `active` SOS per user (enforced in code).
- `expires_at` computed from category TTL (SPEC.md section 5).
- Public serializers omit `reporter_id`, `contact`, exact coordinates of sensitive incidents.
- Rate limits: 5 reports/hour/user, 3 SOS/hour/user.

## 5. Timeline derivation
Public status timeline for an incident = `reported_at` plus `audit_logs` rows where `entity_type='incident'` and `entity_id=<id>` and `action IN ('community_confirmed','status_change')`, ordered by `created_at`.

## 6. Index rationale
- `(lat,lng)`: bounding-box prefilter for nearby queries before Haversine.
- `(status, reported_at)`: operator queue and public filters.
- `expires_at`: freshness filtering.
- `(incident_id, recipient_user_id)` unique: prevents duplicate alerts.
- `(entity_type, entity_id, created_at)`: fast timeline.

## 7. Future (not built)
PostGIS geography column and GiST index, partitioning by date, retention policy for expired reports and location data.

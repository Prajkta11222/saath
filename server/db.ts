import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function initDatabase(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    const parentDir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
  }
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name     TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
      contact          TEXT,
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

    CREATE TABLE IF NOT EXISTS trusted_contacts (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name      TEXT NOT NULL,
      contact   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS incidents (
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
      ai_flags             TEXT NOT NULL DEFAULT '[]',
      ai_source            TEXT CHECK (ai_source IN ('gemini','rules'))
    );
    CREATE INDEX IF NOT EXISTS idx_incidents_geo      ON incidents (lat, lng);
    CREATE INDEX IF NOT EXISTS idx_incidents_status   ON incidents (status, reported_at DESC);
    CREATE INDEX IF NOT EXISTS idx_incidents_expires  ON incidents (expires_at);
    CREATE INDEX IF NOT EXISTS idx_incidents_category ON incidents (category, reported_at DESC);
    CREATE INDEX IF NOT EXISTS idx_incidents_reporter ON incidents (reporter_id);

    CREATE TABLE IF NOT EXISTS incident_confirmations (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id  INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (incident_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      incident_id        INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      recipient_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      radius_km          REAL NOT NULL,
      delivery_status    TEXT NOT NULL DEFAULT 'simulated_delivered',
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (incident_id, recipient_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_recipient ON alerts (recipient_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS sos_sessions (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lat                 REAL NOT NULL,
      lng                 REAL NOT NULL,
      started_at          TEXT NOT NULL DEFAULT (datetime('now')),
      sharing_expires_at  TEXT NOT NULL,
      status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','resolved')),
      notified_contacts   TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_sos_user_status ON sos_sessions (user_id, status);

    CREATE TABLE IF NOT EXISTS help_requests (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      sos_id            INTEGER NOT NULL REFERENCES sos_sessions(id) ON DELETE CASCADE,
      approx_lat        REAL NOT NULL,
      approx_lng        REAL NOT NULL,
      status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      opt_in_recipients TEXT NOT NULL DEFAULT '[]',
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_help_status ON help_requests (status);

    CREATE TABLE IF NOT EXISTS camera_references (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT NOT NULL,
      lat              REAL NOT NULL,
      lng              REAL NOT NULL,
      mock_source_url  TEXT NOT NULL,
      is_simulated     INTEGER NOT NULL DEFAULT 1 CHECK (is_simulated = 1)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action       TEXT NOT NULL,
      entity_type  TEXT NOT NULL,
      entity_id    INTEGER,
      detail       TEXT NOT NULL DEFAULT '{}',
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs (entity_type, entity_id, created_at);

    CREATE TABLE IF NOT EXISTS operator_credentials (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return db;
}

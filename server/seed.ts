import type Database from 'better-sqlite3';
import { config } from './config.js';
import { computeExpiresAt } from './services/geo.js';
import type { AiPriority, IncidentCategory, IncidentStatus } from '../src/types/saath.js';

interface SeedIncidentInput {
  category: IncidentCategory;
  description: string;
  lat: number;
  lng: number;
  location_label: string;
  minutesAgo: number;
  status: IncidentStatus;
  reporterKey: string;
  sensitive?: boolean;
  confirmationsCount?: number;
  ai_priority: AiPriority;
  ai_summary: string;
  ai_triage: string;
  ai_flags?: string[];
}

export function seedDatabase(db: Database.Database, forceReset = false): void {
  const userCountRow = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (!forceReset && userCountRow.count > 0) {
    return;
  }

  const runSeed = db.transaction(() => {
    if (forceReset) {
      db.exec(`
        DELETE FROM audit_logs;
        DELETE FROM help_requests;
        DELETE FROM sos_sessions;
        DELETE FROM alerts;
        DELETE FROM incident_confirmations;
        DELETE FROM incidents;
        DELETE FROM trusted_contacts;
        DELETE FROM camera_references;
        DELETE FROM users;
        DELETE FROM sqlite_sequence WHERE name IN (
          'users','trusted_contacts','incidents','incident_confirmations',
          'alerts','sos_sessions','help_requests','camera_references','audit_logs'
        );
      `);
    }

    const nowMs = Date.now();
    const isoAgo = (minutes: number) => new Date(nowMs - minutes * 60 * 1000).toISOString();

    const baseLat = config.defaultLat; // 21.1458
    const baseLng = config.defaultLng; // 79.0882

    const insertUser = db.prepare(`
      INSERT INTO users (display_name, contact, role, alerts_opt_in, alert_radius_km, help_opt_in, last_lat, last_lng, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const operatorId = Number(
      insertUser.run(
        'operator1',
        null,
        'operator',
        0,
        2,
        0,
        baseLat,
        baseLng,
        isoAgo(2),
        isoAgo(1440),
      ).lastInsertRowid,
    );

    // Citizens spread 0.3–3 km from Nagpur center for Demo Phones & Alert testing
    const ashaId = Number(
      insertUser.run(
        'Asha',
        '+91-98000-00101',
        'citizen',
        1,
        2.0,
        1,
        baseLat + 0.0025, // ~0.28 km N
        baseLng + 0.0018, // ~0.19 km E
        isoAgo(4),
        isoAgo(1440),
      ).lastInsertRowid,
    );

    const raviId = Number(
      insertUser.run(
        'Ravi',
        '+91-98000-00102',
        'citizen',
        1,
        2.0,
        1,
        baseLat - 0.006, // ~0.67 km S
        baseLng - 0.004,
        isoAgo(6),
        isoAgo(1440),
      ).lastInsertRowid,
    );

    const meeraId = Number(
      insertUser.run(
        'Meera',
        '+91-98000-00103',
        'citizen',
        1,
        1.5,
        0,
        baseLat + 0.025, // ~2.8 km N (outside default 2 km center radius)
        baseLng + 0.015,
        isoAgo(12),
        isoAgo(1440),
      ).lastInsertRowid,
    );

    const karanId = Number(
      insertUser.run(
        'Karan',
        '+91-98000-00104',
        'citizen',
        0, // opted out
        5.0,
        1,
        baseLat + 0.004,
        baseLng - 0.005,
        isoAgo(8),
        isoAgo(1440),
      ).lastInsertRowid,
    );

    const userIds: Record<string, number> = {
      operator1: operatorId,
      Asha: ashaId,
      Ravi: raviId,
      Meera: meeraId,
      Karan: karanId,
    };

    const insertContact = db.prepare(`
      INSERT INTO trusted_contacts (user_id, name, contact) VALUES (?, ?, ?)
    `);
    insertContact.run(ashaId, 'Neha Deshmukh (Sister)', '+91-98000-00201');
    insertContact.run(ashaId, 'Vikram Joshi (Neighbor)', '+91-98000-00202');

    const seedIncidents: SeedIncidentInput[] = [
      {
        category: 'road_hazard',
        description: 'Fallen tree branch blocking the left lane near Civil Lines Square.',
        lat: baseLat + 0.0032,
        lng: baseLng - 0.0048,
        location_label: 'Civil Lines Square (Synthetic Demo)',
        minutesAgo: 25,
        status: 'community_confirmed',
        reporterKey: 'Ravi',
        confirmationsCount: 2,
        ai_priority: 'medium',
        ai_summary: 'A fallen tree branch is partially obstructing the left lane near Civil Lines Square.',
        ai_triage: 'Notify municipal road clearance team and keep traffic advisory active.',
        ai_flags: [],
      },
      {
        category: 'streetlight_outage',
        description: 'Three consecutive streetlights are non-functional along Seminary Hills road.',
        lat: baseLat + 0.0075,
        lng: baseLng - 0.0112,
        location_label: 'Seminary Hills Road (Synthetic Demo)',
        minutesAgo: 180,
        status: 'reviewed',
        reporterKey: 'Meera',
        confirmationsCount: 1,
        ai_priority: 'low',
        ai_summary: 'Multiple streetlights are reported non-functional along Seminary Hills Road.',
        ai_triage: 'Route to municipal electrical maintenance queue.',
        ai_flags: [],
      },
      {
        category: 'water_issue',
        description: 'Water pipeline leak causing ankle-deep waterlogging near Dharampeth bus stop.',
        lat: baseLat - 0.0042,
        lng: baseLng - 0.0185,
        location_label: 'Dharampeth Bus Stop (Synthetic Demo)',
        minutesAgo: 95,
        status: 'pending',
        reporterKey: 'Karan',
        confirmationsCount: 0,
        ai_priority: 'medium',
        ai_summary: 'A pipeline leak has created localized waterlogging near Dharampeth bus stop.',
        ai_triage: 'Forward location to water works department for inspection.',
        ai_flags: [],
      },
      {
        category: 'accident',
        description: 'Two-wheeler minor collision near Variety Square; traffic moving slowly.',
        lat: baseLat - 0.0018,
        lng: baseLng - 0.0065,
        location_label: 'Variety Square (Synthetic Demo)',
        minutesAgo: 18,
        status: 'pending',
        reporterKey: 'Asha',
        confirmationsCount: 0,
        ai_priority: 'high',
        ai_summary: 'A two-wheeler collision is causing slow traffic near Variety Square.',
        ai_triage: 'Check nearby traffic camera reference and alert emergency dispatch if needed.',
        ai_flags: ['needs_emergency_services'],
      },
      {
        category: 'fire',
        description: 'Dry grass and roadside waste fire reported near Ambazari overflow boundary.',
        lat: baseLat - 0.0145,
        lng: baseLng - 0.032,
        location_label: 'Ambazari Boundary (Synthetic Demo)',
        minutesAgo: 35,
        status: 'reviewed',
        reporterKey: 'Ravi',
        confirmationsCount: 2,
        ai_priority: 'critical',
        ai_summary: 'A roadside dry grass and waste fire was reported near the Ambazari boundary.',
        ai_triage: 'Verify immediately and coordinate fire service response.',
        ai_flags: ['needs_emergency_services'],
      },
      {
        category: 'harassment',
        description: 'Verbal harassment reported near poorly lit alleyway off Sitabuldi West exit.',
        lat: baseLat - 0.0031,
        lng: baseLng - 0.0089,
        location_label: 'Sitabuldi West Area (Synthetic Demo)',
        minutesAgo: 110,
        status: 'pending',
        reporterKey: 'Meera',
        sensitive: true,
        confirmationsCount: 0,
        ai_priority: 'high',
        ai_summary: 'Harassment was reported near an unlit walkway in the Sitabuldi West area.',
        ai_triage: 'Keep public coordinates approximate and review lighting/patrol escalation.',
        ai_flags: ['sensitive_location'],
      },
      {
        category: 'medical_emergency',
        description: 'Pedestrian fainted near Zero Mile metro entrance; bystander requesting ambulance.',
        lat: baseLat + 0.0011,
        lng: baseLng - 0.0028,
        location_label: 'Zero Mile Metro (Synthetic Demo)',
        minutesAgo: 45,
        status: 'resolved',
        reporterKey: 'Karan',
        confirmationsCount: 1,
        ai_priority: 'critical',
        ai_summary: 'A medical assistance request was reported near Zero Mile metro entrance.',
        ai_triage: 'Confirm ambulance arrival and close report once cleared.',
        ai_flags: ['needs_emergency_services'],
      },
      {
        category: 'suspicious_activity',
        description: 'Unattended bag left near Railway Station West parcel gate for over 40 minutes.',
        lat: baseLat + 0.0062,
        lng: baseLng + 0.0012,
        location_label: 'Railway Station West Gate (Synthetic Demo)',
        minutesAgo: 260,
        status: 'pending',
        reporterKey: 'Asha',
        confirmationsCount: 1,
        ai_priority: 'medium',
        ai_summary: 'An unattended bag was reported near the Railway Station West parcel gate.',
        ai_triage: 'Advise station security desk to inspect from a safe perimeter.',
        ai_flags: [],
      },
      {
        category: 'road_hazard',
        description: 'Older pothole repair completed at Sadar Bazaar main crossing.',
        lat: baseLat + 0.0112,
        lng: baseLng - 0.0074,
        location_label: 'Sadar Bazaar (Synthetic Demo)',
        minutesAgo: 3200, // > 48 h -> stale
        status: 'resolved',
        reporterKey: 'Ravi',
        confirmationsCount: 2,
        ai_priority: 'low',
        ai_summary: 'Road surface pothole reported at Sadar Bazaar main crossing.',
        ai_triage: 'Historical resolved record for reference.',
        ai_flags: [],
      },
    ];

    const insertIncident = db.prepare(`
      INSERT INTO incidents (
        category, description, lat, lng, location_label, occurred_at, reported_at, expires_at,
        status, reporter_id, evidence_url, sensitive, confirmations_count,
        ai_category, ai_priority, ai_summary, ai_triage, ai_confidence, ai_flags, ai_source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertConfirmation = db.prepare(`
      INSERT INTO incident_confirmations (incident_id, user_id, created_at) VALUES (?, ?, ?)
    `);

    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const item of seedIncidents) {
      const reportedAt = isoAgo(item.minutesAgo);
      const occurredAt = isoAgo(item.minutesAgo + 5);
      const expiresAt = computeExpiresAt(item.category, reportedAt);
      const reporterId = userIds[item.reporterKey] ?? null;

      const incId = Number(
        insertIncident.run(
          item.category,
          item.description,
          item.lat,
          item.lng,
          item.location_label,
          occurredAt,
          reportedAt,
          expiresAt,
          item.status,
          reporterId,
          null,
          item.sensitive ? 1 : 0,
          item.confirmationsCount ?? 0,
          item.category,
          item.ai_priority,
          item.ai_summary,
          item.ai_triage,
          0.86,
          JSON.stringify(item.ai_flags ?? []),
          'rules',
        ).lastInsertRowid,
      );

      // Seed confirmations & audit timeline rows matching status
      if (item.status === 'community_confirmed' || (item.confirmationsCount ?? 0) >= 2) {
        insertConfirmation.run(incId, ashaId, isoAgo(Math.max(1, item.minutesAgo - 4)));
        if (reporterId !== meeraId) {
          insertConfirmation.run(incId, meeraId, isoAgo(Math.max(1, item.minutesAgo - 2)));
        } else {
          insertConfirmation.run(incId, karanId, isoAgo(Math.max(1, item.minutesAgo - 2)));
        }
        insertAudit.run(
          null,
          'community_confirmed',
          'incident',
          incId,
          JSON.stringify({ confirmations_count: 2, from: 'pending', to: 'community_confirmed' }),
          isoAgo(Math.max(1, item.minutesAgo - 2)),
        );
      }

      if (item.status === 'reviewed' || item.status === 'resolved') {
        insertAudit.run(
          operatorId,
          'status_change',
          'incident',
          incId,
          JSON.stringify({
            from: 'pending',
            to: 'reviewed',
            note: 'Verified with municipal dispatch (synthetic seed).',
          }),
          isoAgo(Math.max(2, item.minutesAgo - 10)),
        );
      }

      if (item.status === 'resolved') {
        insertAudit.run(
          operatorId,
          'status_change',
          'incident',
          incId,
          JSON.stringify({
            from: 'reviewed',
            to: 'resolved',
            note: 'Situation cleared and closed (synthetic seed).',
          }),
          isoAgo(Math.max(1, item.minutesAgo - 20)),
        );
      }
    }

    const insertCamera = db.prepare(`
      INSERT INTO camera_references (name, lat, lng, mock_source_url, is_simulated)
      VALUES (?, ?, ?, ?, 1)
    `);
    insertCamera.run('CAM-01 · Variety Square Junction (Simulated)', baseLat - 0.0016, baseLng - 0.0061, 'sim://cam-01');
    insertCamera.run('CAM-02 · Civil Lines Circle (Simulated)', baseLat + 0.0034, baseLng - 0.0044, 'sim://cam-02');
    insertCamera.run('CAM-03 · Railway West Approach (Simulated)', baseLat + 0.0060, baseLng + 0.0010, 'sim://cam-03');
  });

  runSeed();
}

import type Database from 'better-sqlite3';
import type { Server as SocketIOServer } from 'socket.io';
import { CATEGORY_LABELS, STATUS_LABELS } from '../../src/types/saath.js';
import { IncidentRow, UserRow, toPublicIncident } from '../serializers.js';
import { computeFreshness, formatRelativeTime, haversineKm } from './geo.js';

export interface DispatchedAlertPayload {
  incident_id: number;
  recipient_user_id: number;
  recipient_name: string;
  category: string;
  category_label: string;
  distance_km: number;
  status_label: string;
  message: string;
  created_at: string;
}

export function fanoutAlertsForIncident(
  db: Database.Database,
  io: SocketIOServer | null,
  incident: IncidentRow,
): DispatchedAlertPayload[] {
  const publicIncident = toPublicIncident(incident);
  if (io) {
    io.to('public').emit('incident:new', publicIncident);
  }

  const freshness = computeFreshness(incident.category, incident.reported_at, incident.expires_at);
  if (freshness === 'stale' || incident.status === 'dismissed' || incident.status === 'resolved') {
    return [];
  }

  const optedInUsers = db
    .prepare(
      `SELECT * FROM users
       WHERE alerts_opt_in = 1
         AND last_lat IS NOT NULL
         AND last_lng IS NOT NULL`,
    )
    .all() as UserRow[];

  const insertAlert = db.prepare(`
    INSERT OR IGNORE INTO alerts (incident_id, recipient_user_id, radius_km, delivery_status, created_at)
    VALUES (?, ?, ?, 'simulated_delivered', ?)
  `);

  const dispatched: DispatchedAlertPayload[] = [];
  const nowIso = new Date().toISOString();

  for (const user of optedInUsers) {
    if (incident.reporter_id !== null && user.id === incident.reporter_id) {
      continue;
    }
    if (user.last_lat === null || user.last_lng === null) {
      continue;
    }

    const distKm = haversineKm(user.last_lat, user.last_lng, publicIncident.lat, publicIncident.lng);
    if (distKm > user.alert_radius_km) {
      continue;
    }

    const roundedDist = Number(distKm.toFixed(2));
    insertAlert.run(incident.id, user.id, user.alert_radius_km, nowIso);

    const catLabel = CATEGORY_LABELS[incident.category] || 'Incident';
    const statusLabel = STATUS_LABELS[incident.status] || 'Unverified';
    const relTime = formatRelativeTime(incident.reported_at);

    const payload: DispatchedAlertPayload = {
      incident_id: incident.id,
      recipient_user_id: user.id,
      recipient_name: user.display_name,
      category: incident.category,
      category_label: catLabel,
      distance_km: roundedDist,
      status_label: statusLabel,
      message: `Reported nearby: ${catLabel}, ${roundedDist.toFixed(1)} km away, ${relTime} (${statusLabel})`,
      created_at: nowIso,
    };

    dispatched.push(payload);

    if (io) {
      io.to(`user:${user.id}`).emit('alert:nearby', payload);
      io.to('operators').emit('demo_phone:alert', payload);
      if (['Asha', 'Ravi', 'Meera', 'Karan'].includes(user.display_name)) {
        io.to('public').emit('demo_phone:alert', payload);
      }
    }
  }

  return dispatched;
}

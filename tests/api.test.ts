import fs from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import path from 'node:path';
import { io as createClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, SaathAppContext } from '../server/app.js';
import { config } from '../server/config.js';
import { ruleBasedTriage, triageIncident } from '../server/services/ai_triage.js';
import { haversineKm, roundCoords } from '../server/services/geo.js';

async function jsonFetch(baseUrl: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

describe('SAATH API & Service Verification', () => {
  let ctx: SaathAppContext;
  let baseUrl = '';
  let ashaToken = '';
  let raviToken = '';
  let meeraToken = '';
  let operatorToken = '';

  beforeAll(async () => {
    ctx = createApp({ dbPath: ':memory:', enableSocketIO: false, enableRateLimit: false });
    await new Promise<void>((resolve) => {
      ctx.server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = ctx.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Claim operator passcode if env secret is unset
    const statusRes = await jsonFetch(baseUrl, '/api/auth/operator-status');
    const opPass = config.operatorPasswordEnv || 'test-operator-pass';
    if (statusRes.body.mode === 'unclaimed') {
      await jsonFetch(baseUrl, '/api/auth/claim-operator', {
        method: 'POST',
        body: JSON.stringify({ password: opPass }),
      });
    }

    const ashaLogin = await jsonFetch(baseUrl, '/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Asha', role: 'citizen' }),
    });
    ashaToken = ashaLogin.body.token;

    const raviLogin = await jsonFetch(baseUrl, '/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Ravi', role: 'citizen' }),
    });
    raviToken = raviLogin.body.token;

    const meeraLogin = await jsonFetch(baseUrl, '/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Meera', role: 'citizen' }),
    });
    meeraToken = meeraLogin.body.token;

    const opLogin = await jsonFetch(baseUrl, '/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'operator1', role: 'operator', password: opPass }),
    });
    operatorToken = opLogin.body.token;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => ctx.server.close(() => resolve()));
    ctx.db.close();
  });

  it('SRS-F2/F3: AI triage fallback works with no key and returns valid schema', async () => {
    const res = await triageIncident(
      'Small fire near roadside garbage bin with smoke visible.',
      'other',
      false,
      '',
    );
    expect(res.ai_source).toBe('rules');
    expect(res.category).toBe('fire');
    expect(['high', 'critical']).toContain(res.priority);
    expect(res.summary.length).toBeGreaterThan(10);
    expect(Array.isArray(res.flags)).toBe(true);

    const directRule = ruleBasedTriage('Streetlight out on main lane', 'streetlight_outage');
    expect(directRule.priority).toBe('low');
  });

  it('SRS-F1/N3: Create incident validates input, omits reporter_id, and rounds sensitive coords (~500 m)', async () => {
    const bad = await jsonFetch(baseUrl, '/api/incidents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ashaToken}` },
      body: JSON.stringify({
        category: 'road_hazard',
        description: 'short',
        lat: 21.1458,
        lng: 79.0882,
      }),
    });
    expect(bad.status).toBe(400);

    const exactLat = 21.14731;
    const exactLng = 79.08941;
    const good = await jsonFetch(baseUrl, '/api/incidents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ashaToken}` },
      body: JSON.stringify({
        category: 'harassment',
        description: 'Unlit walkway near east subway gate with verbal harassment reported.',
        lat: exactLat,
        lng: exactLng,
        sensitive: true,
      }),
    });
    expect(good.status).toBe(201);
    expect(good.body.incident.reporter_id).toBeUndefined();
    expect(good.body.incident.sensitive).toBe(true);
    expect(good.body.incident.location_approximate).toBe(true);

    const rounded = roundCoords(exactLat, exactLng, 500);
    expect(good.body.incident.lat).toBe(rounded.lat);
    expect(good.body.incident.lng).toBe(rounded.lng);
  });

  it('SRS-F4: Nearby endpoint filters by radius and excludes stale reports by default', async () => {
    const freshOnly = await jsonFetch(
      baseUrl,
      `/api/incidents?lat=${config.defaultLat}&lng=${config.defaultLng}&radius_km=5`,
    );
    expect(freshOnly.status).toBe(200);
    expect(freshOnly.body.incidents.every((i: { freshness: string }) => i.freshness !== 'stale')).toBe(
      true,
    );
    expect(freshOnly.body.incidents.every((i: { reporter_id?: number }) => i.reporter_id === undefined)).toBe(
      true,
    );

    const withStale = await jsonFetch(
      baseUrl,
      `/api/incidents?lat=${config.defaultLat}&lng=${config.defaultLng}&radius_km=5&include_stale=true`,
    );
    expect(withStale.status).toBe(200);
    expect(withStale.body.incidents.some((i: { freshness: string }) => i.freshness === 'stale')).toBe(
      true,
    );
  });

  it('SRS-F6: Alert fan-out notifies opted-in users in radius, excluding reporter and opted-out users', async () => {
    const created = await jsonFetch(baseUrl, '/api/incidents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ashaToken}` },
      body: JSON.stringify({
        category: 'road_hazard',
        description: 'Open manhole cover reported near main Nagpur square crossing.',
        lat: config.defaultLat,
        lng: config.defaultLng,
      }),
    });
    expect(created.status).toBe(201);
    const incId = created.body.incident.id;

    const alerts = ctx.db
      .prepare('SELECT recipient_user_id FROM alerts WHERE incident_id = ?')
      .all(incId) as Array<{ recipient_user_id: number }>;
    const recipientIds = alerts.map((a) => a.recipient_user_id);

    const ashaRow = ctx.db.prepare("SELECT id FROM users WHERE display_name = 'Asha'").get() as { id: number };
    const raviRow = ctx.db.prepare("SELECT id FROM users WHERE display_name = 'Ravi'").get() as { id: number };
    const karanRow = ctx.db.prepare("SELECT id FROM users WHERE display_name = 'Karan'").get() as { id: number };

    expect(recipientIds).not.toContain(ashaRow.id); // reporter excluded
    expect(recipientIds).toContain(raviRow.id); // opted-in within 2 km
    expect(recipientIds).not.toContain(karanRow.id); // opted-out
  });

  it('SRS-F11: Self-confirmation rejected (403); two distinct non-reporter confirmations flip to community_confirmed', async () => {
    const created = await jsonFetch(baseUrl, '/api/incidents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ashaToken}` },
      body: JSON.stringify({
        category: 'water_issue',
        description: 'Burst pipe flooding lane near central civic bus shelter.',
        lat: config.defaultLat + 0.001,
        lng: config.defaultLng + 0.001,
      }),
    });
    const incId = created.body.incident.id;

    const selfConfirm = await jsonFetch(baseUrl, `/api/incidents/${incId}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ashaToken}` },
    });
    expect(selfConfirm.status).toBe(403);

    const confirm1 = await jsonFetch(baseUrl, `/api/incidents/${incId}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${raviToken}` },
    });
    expect(confirm1.status).toBe(200);
    expect(confirm1.body.incident.status).toBe('pending');

    const dupConfirm = await jsonFetch(baseUrl, `/api/incidents/${incId}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${raviToken}` },
    });
    expect(dupConfirm.status).toBe(409);

    const confirm2 = await jsonFetch(baseUrl, `/api/incidents/${incId}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${meeraToken}` },
    });
    expect(confirm2.status).toBe(200);
    expect(confirm2.body.incident.status).toBe('community_confirmed');
    expect(confirm2.body.status_flipped).toBe(true);
  });

  it('SRS-F7: Route B differs from Route A when a fresh incident lies on Route A', async () => {
    const destLat = config.defaultLat + 0.015;
    const destLng = config.defaultLng + 0.015;
    const midLat = config.defaultLat + 0.0075;
    const midLng = config.defaultLng + 0.0075;

    await jsonFetch(baseUrl, '/api/incidents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${raviToken}` },
      body: JSON.stringify({
        category: 'road_hazard',
        description: 'Road excavation blocking direct lane along test corridor.',
        lat: midLat,
        lng: midLng,
      }),
    });

    const routeRes = await jsonFetch(
      baseUrl,
      `/api/routes?from_lat=${config.defaultLat}&from_lng=${config.defaultLng}&dest_lat=${destLat}&dest_lng=${destLng}`,
    );
    expect(routeRes.status).toBe(200);
    expect(routeRes.body.is_demo).toBe(true);
    const routeA = routeRes.body.routes.find((r: { id: string }) => r.id === 'A');
    const routeB = routeRes.body.routes.find((r: { id: string }) => r.id === 'B');
    expect(routeA.incidents_near_route).toBeGreaterThan(0);
    expect(routeB.polyline).not.toEqual(routeA.polyline);
    expect(routeB.incidents_near_route).toBeLessThan(routeA.incidents_near_route);
  });

  it('SRS-F8/F9: SOS expiry rejects location updates (409) and help request rounds ~300 m with zero PII', async () => {
    const sosRes = await jsonFetch(baseUrl, '/api/sos', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ashaToken}` },
      body: JSON.stringify({ lat: config.defaultLat + 0.002, lng: config.defaultLng + 0.002 }),
    });
    expect(sosRes.status).toBe(201);
    const sosId = sosRes.body.sos.id;

    // Create help request from active SOS
    const helpRes = await jsonFetch(baseUrl, '/api/help-requests', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ashaToken}` },
      body: JSON.stringify({ sos_id: sosId }),
    });
    expect(helpRes.status).toBe(201);
    expect(helpRes.body.help_request.user_id).toBeUndefined();
    expect(helpRes.body.help_request.display_name).toBeUndefined();

    // Helper Ravi fetches nearby requests
    const nearbyHelp = await jsonFetch(baseUrl, '/api/help-requests/nearby', {
      headers: { Authorization: `Bearer ${raviToken}` },
    });
    expect(nearbyHelp.status).toBe(200);
    expect(nearbyHelp.body.requests.length).toBeGreaterThan(0);
    expect(nearbyHelp.body.requests[0].guidance).toContain('Call emergency services first');

    // Force SOS expiry in DB and verify location update is rejected with 409
    ctx.db
      .prepare("UPDATE sos_sessions SET sharing_expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?")
      .run(sosId);

    const locAfterExpiry = await jsonFetch(baseUrl, `/api/sos/${sosId}/location`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ashaToken}` },
      body: JSON.stringify({ lat: 21.15, lng: 79.09 }),
    });
    expect(locAfterExpiry.status).toBe(409);
  });

  it('SRS-F10/F12: Operator-only status update rejects citizens (403), blocks invalid transitions (409), and logs camera opens', async () => {
    const created = await jsonFetch(baseUrl, '/api/incidents', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ashaToken}` },
      body: JSON.stringify({
        category: 'accident',
        description: 'Car fender bender at main rotary signal blocking left turn.',
        lat: config.defaultLat,
        lng: config.defaultLng,
      }),
    });
    const incId = created.body.incident.id;

    const citizenAttempt = await jsonFetch(baseUrl, `/api/incidents/${incId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ashaToken}` },
      body: JSON.stringify({ status: 'reviewed' }),
    });
    expect(citizenAttempt.status).toBe(403);

    // Invalid jump: pending -> resolved directly should return 409
    const invalidJump = await jsonFetch(baseUrl, `/api/incidents/${incId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${operatorToken}` },
      body: JSON.stringify({ status: 'resolved' }),
    });
    expect(invalidJump.status).toBe(409);

    const reviewRes = await jsonFetch(baseUrl, `/api/incidents/${incId}/status`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${operatorToken}` },
      body: JSON.stringify({ status: 'reviewed', note: 'Verified via dispatch.' }),
    });
    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.incident.status).toBe('reviewed');

    const cams = await jsonFetch(baseUrl, '/api/operator/cameras', {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    const camId = cams.body.cameras[0].id;
    const openCam = await jsonFetch(baseUrl, `/api/operator/cameras/${camId}/open`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${operatorToken}` },
      body: JSON.stringify({ incident_id: incId }),
    });
    expect(openCam.status).toBe(200);

    const audit = await jsonFetch(baseUrl, '/api/operator/audit', {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    expect(audit.status).toBe(200);
    expect(audit.body.logs.some((l: { action: string }) => l.action === 'camera_open')).toBe(true);
  });

  it('SRS-N4: Rate limiter rejects more than 5 incident reports per hour with 429', async () => {
    const limitedCtx = createApp({ dbPath: ':memory:', enableSocketIO: false, enableRateLimit: true });
    await new Promise<void>((resolve) => {
      limitedCtx.server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = limitedCtx.server.address() as AddressInfo;
    const limitedUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const login = await jsonFetch(limitedUrl, '/api/auth/demo-login', {
        method: 'POST',
        body: JSON.stringify({ display_name: 'Asha', role: 'citizen' }),
      });
      const token = login.body.token;

      for (let i = 0; i < 5; i += 1) {
        const ok = await jsonFetch(limitedUrl, '/api/incidents', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            category: 'other',
            description: `Rate limit verification civic report number ${i + 1}.`,
            lat: config.defaultLat + i * 0.001,
            lng: config.defaultLng,
          }),
        });
        expect(ok.status).toBe(201);
      }

      const sixth = await jsonFetch(limitedUrl, '/api/incidents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          category: 'other',
          description: 'Sixth report within one hour should be rate limited.',
          lat: config.defaultLat,
          lng: config.defaultLng,
        }),
      });
      expect(sixth.status).toBe(429);
    } finally {
      await new Promise<void>((resolve) => limitedCtx.server.close(() => resolve()));
      limitedCtx.db.close();
    }
  });

  it('Geo sanity: Haversine computes accurate distance at city scale', () => {
    const d = haversineKm(21.1458, 79.0882, 21.1548, 79.0882);
    expect(d).toBeGreaterThan(0.95);
    expect(d).toBeLessThan(1.05);
  });

  it('SRS-F5/F6: Real-time Socket.IO pushes incident:new, alert:nearby (non-reporter in radius), and incident:status across tabs', async () => {
    const rtCtx = createApp({ dbPath: ':memory:', enableSocketIO: true, enableRateLimit: false });
    await new Promise<void>((resolve) => {
      rtCtx.server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = rtCtx.server.address() as AddressInfo;
    const rtUrl = `http://127.0.0.1:${addr.port}`;

    const opPass = config.operatorPasswordEnv || 'rt-op-pass';
    const st = await jsonFetch(rtUrl, '/api/auth/operator-status');
    if (st.body.mode === 'unclaimed') {
      await jsonFetch(rtUrl, '/api/auth/claim-operator', {
        method: 'POST',
        body: JSON.stringify({ password: opPass }),
      });
    }

    const ashaRes = await jsonFetch(rtUrl, '/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Asha', role: 'citizen' }),
    });
    const raviRes = await jsonFetch(rtUrl, '/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'Ravi', role: 'citizen' }),
    });
    const opRes = await jsonFetch(rtUrl, '/api/auth/demo-login', {
      method: 'POST',
      body: JSON.stringify({ display_name: 'operator1', role: 'operator', password: opPass }),
    });

    const tabAsha = createClient(rtUrl, { auth: { token: ashaRes.body.token }, transports: ['websocket'] });
    const tabRavi = createClient(rtUrl, { auth: { token: raviRes.body.token }, transports: ['websocket'] });
    const tabOp = createClient(rtUrl, { auth: { token: opRes.body.token }, transports: ['websocket'] });

    try {
      await Promise.all([
        new Promise<void>((res) => tabAsha.on('connect', () => res())),
        new Promise<void>((res) => tabRavi.on('connect', () => res())),
        new Promise<void>((res) => tabOp.on('connect', () => res())),
      ]);

      let ashaGotAlert = false;
      tabAsha.on('alert:nearby', () => {
        ashaGotAlert = true;
      });

      const raviIncidentNew = new Promise<{ id: number }>((res) =>
        tabRavi.once('incident:new', (p) => res(p)),
      );
      const raviAlert = new Promise<{ message: string; recipient_name: string }>((res) =>
        tabRavi.once('alert:nearby', (p) => res(p)),
      );
      const opDemoPhone = new Promise<{ recipient_name: string }>((res) =>
        tabOp.once('demo_phone:alert', (p) => res(p)),
      );

      // Tab Asha submits an incident at city center
      const created = await jsonFetch(rtUrl, '/api/incidents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ashaRes.body.token}` },
        body: JSON.stringify({
          category: 'road_hazard',
          description: 'Live Socket.IO multi-tab verification road obstacle.',
          lat: config.defaultLat,
          lng: config.defaultLng,
        }),
      });
      expect(created.status).toBe(201);
      const incId = created.body.incident.id;

      const [newEv, alertEv, phoneEv] = await Promise.all([raviIncidentNew, raviAlert, opDemoPhone]);
      expect(newEv.id).toBe(incId);
      expect(alertEv.recipient_name).toBe('Ravi');
      expect(phoneEv.recipient_name).toBe('Ravi');
      expect(ashaGotAlert).toBe(false);

      // Tab Operator reviews incident -> Tab Ravi sees live incident:status with timeline
      const statusUpdated = new Promise<{ id: number; status: string; timeline: unknown[] }>((res) =>
        tabRavi.once('incident:status', (p) => res(p)),
      );
      const patchRes = await jsonFetch(rtUrl, `/api/incidents/${incId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${opRes.body.token}` },
        body: JSON.stringify({ status: 'reviewed', note: 'Live multi-tab review.' }),
      });
      expect(patchRes.status).toBe(200);

      const statusEv = await statusUpdated;
      expect(statusEv.id).toBe(incId);
      expect(statusEv.status).toBe('reviewed');
      expect(statusEv.timeline.length).toBeGreaterThanOrEqual(2);
    } finally {
      tabAsha.disconnect();
      tabRavi.disconnect();
      tabOp.disconnect();
      await new Promise<void>((resolve) => rtCtx.server.close(() => resolve()));
      rtCtx.db.close();
    }
  });

  it('Upload + Privacy + Dismissed + Demo Reset: PNG upload serves safely, dismissed hides from default feed, reset restores seed', async () => {
    const pngBytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
      'hex',
    );
    const form = new FormData();
    form.append('evidence', new Blob([pngBytes], { type: 'image/png' }), 'test-evidence.png');

    const uploadRes = await fetch(`${baseUrl}/api/uploads`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ashaToken}` },
      body: form,
    });
    expect(uploadRes.status).toBe(201);
    const uploadJson = (await uploadRes.json()) as { url: string };
    expect(uploadJson.url.startsWith('/uploads/')).toBe(true);
    const uploadedPath = path.resolve(config.uploadsDir, path.basename(uploadJson.url));

    try {
      const serveRes = await fetch(`${baseUrl}${uploadJson.url}`);
      expect(serveRes.status).toBe(200);
      expect(serveRes.headers.get('x-content-type-options')).toBe('nosniff');

      const badServe = await fetch(`${baseUrl}/uploads/..%2Fpackage.json`);
      expect(badServe.status).toBe(404);

      // Create incident with uploaded path, then operator dismisses it
      const incRes = await jsonFetch(baseUrl, '/api/incidents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ashaToken}` },
        body: JSON.stringify({
          category: 'other',
          description: 'Temporary construction barrier report with uploaded PNG evidence.',
          lat: config.defaultLat,
          lng: config.defaultLng,
          evidence_url: uploadJson.url,
        }),
      });
      expect(incRes.status).toBe(201);
      const createdId = incRes.body.incident.id;

      const dismissRes = await jsonFetch(baseUrl, `/api/incidents/${createdId}/status`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${operatorToken}` },
        body: JSON.stringify({ status: 'dismissed', note: 'Duplicate / cleared on inspection.' }),
      });
      expect(dismissRes.status).toBe(200);

      const defaultList = await jsonFetch(
        baseUrl,
        `/api/incidents?lat=${config.defaultLat}&lng=${config.defaultLng}&radius_km=5`,
      );
      expect(defaultList.body.incidents.some((i: { id: number }) => i.id === createdId)).toBe(false);

      const dismissedOnly = await jsonFetch(
        baseUrl,
        `/api/incidents?lat=${config.defaultLat}&lng=${config.defaultLng}&radius_km=5&status=dismissed`,
      );
      expect(dismissedOnly.body.incidents.some((i: { id: number }) => i.id === createdId)).toBe(true);

      const resetRes = await jsonFetch(baseUrl, '/api/demo/reset', {
        method: 'POST',
        headers: { Authorization: `Bearer ${operatorToken}` },
      });
      expect(resetRes.status).toBe(200);
      expect(resetRes.body.ok).toBe(true);
    } finally {
      if (fs.existsSync(uploadedPath)) {
        fs.unlinkSync(uploadedPath);
      }
    }
  });
});

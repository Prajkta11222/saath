# ARCHITECTURE — SAATH

Built from PRD.md and TECH_STACK.md. SPEC.md is the build contract; this document explains how the parts fit.

## 1. High-level architecture

```
 Browser (HTML/CSS/JS + Leaflet)                    Flask app (single process)
┌────────────────────────────────┐   HTTPS/JSON   ┌─────────────────────────────────────┐
│ Pages: map, report, details,   │ ─────────────► │ routes/*  (thin controllers)        │
│ route, sos, help, operator     │                │   │ validate → call service → shape │
│                                │ ◄───────────── │   ▼                                 │
│ Socket.IO client               │   WebSocket    │ services/ (business logic)          │
│  - incident:new / status       │ ◄────────────► │   ai_triage · geo · routing · alerts│
│  - alert:nearby                │                │   │                                 │
│  - sos:notify / help:request   │                │   ▼                                 │
└────────────────────────────────┘                │ models.py (SQLAlchemy) ──► SQLite / │
                                                  │                             Postgres│
                                                  │ ai_triage ──► Gemini API (optional) │
                                                  └─────────────────────────────────────┘
```

**Layering rule:** routes never contain business logic; services never import Flask request objects; models contain no logic beyond simple helpers. Public responses are produced only by serializer functions (`to_public()`), which are allow-lists.

## 2. Project structure
See SPEC.md section 4. Responsibilities:

| Path | Responsibility |
|---|---|
| `app.py` | App factory, extensions, blueprint registration, SocketIO events |
| `config.py` | Env-based config, TTL table, radius defaults |
| `models.py` | Tables per DATABASE.md, `to_public()` / `to_operator()` serializers |
| `services/geo.py` | Haversine, bounding box, rounding for sensitive coords, freshness |
| `services/ai_triage.py` | Gemini call, JSON validation, rule fallback, duplicate flag helper |
| `services/alerts.py` | Find recipients in radius, write Alert rows, emit sockets |
| `services/routing.py` | Demo route generation and incident overlay |
| `routes/*.py` | One blueprint per area: auth, incidents, sos, help, routes_api, operator |
| `static/js/*` | One module per screen; `common.js` has fetch wrapper, escape helper, strings |
| `seed.py` | Idempotent demo data and reset |

## 3. Frontend / backend flow
1. Page loads static HTML from Flask templates.
2. JS calls `/api/me` (session check) and `/api/incidents?lat&lng&radius_km`.
3. JS renders markers and joins Socket.IO rooms.
4. User actions call REST endpoints; server responds with JSON; sockets push changes to others.
5. Every fetch goes through `common.js` which handles loading state, error toast, and 401 redirect.

## 4. Authentication and authorization flow
```
Login page ─► POST /api/auth/demo-login {display_name, role, password?}
   role=citizen  ─► create/find User, set session{user_id, role}
   role=operator ─► compare password to OPERATOR_PASSWORD (constant-time) ─► set session
Each request ─► decorator @login_required / @operator_required reads session
   operator endpoints: 403 if role != operator (server-side, never trust client)
Logout ─► clear session
```
Anonymous visitors can view the map and incident details (public, filtered). Reporting, confirming, SOS, help and settings require a session. *(Assumption: demo-grade; production would use real identity.)*

## 5. Data flow (key scenarios)

**Report to alert**
```
POST /api/incidents
  validate → rate-limit check → save Incident(pending)
  → ai_triage.triage() (Gemini or rules, 6 s timeout) → save ai_* fields
  → duplicate check (150 m, 2 h, same category) → flag
  → alerts.fanout(): users with alerts_opt_in within radius, not reporter, incident fresh
  → emit incident:new (public room) + alert:nearby (user rooms)
  → 201 with public incident JSON
```

**Operator status change**
```
PATCH /api/incidents/:id/status (operator)
  validate transition → update status → AuditLog(status_change, from, to, note)
  → emit incident:status → public timeline reads AuditLog
```

**SOS and help**
```
POST /api/sos → create SOS(active, expires +15 min) → notify contacts (emit sos:notify, simulated)
POST /api/sos/:id/location → reject if expired/cancelled → update location
POST /api/help-requests → round location ~300 m → select opted-in helpers within 2 km
  → emit help:request (limited payload)
POST /api/sos/:id/cancel → status cancelled/resolved → stop sharing
```

**Routes**
```
GET /api/routes → build Route A polyline → find fresh/aging incidents within 200 m
  → if any: shift waypoints perpendicular to build Route B → return both + overlay + is_demo:true
```

## 6. Status state machine
```
pending ──(2 confirmations)──► community_confirmed
pending / community_confirmed ──(operator)──► reviewed ──► resolved
any non-final ──(operator)──► dismissed
resolved, dismissed = final (no further changes)
```
Invalid transitions return 409.

## 7. Real-time design
Rooms: `public` (all map viewers), `user:<id>`, `operators`. Payloads are minimal and already sanitized. On reconnect the client refetches via REST (sockets are a hint, REST is the truth).

## 8. Key security risks and mitigations

| Risk | Mitigation |
|---|---|
| Reporter identity or contact leakage | Allow-list serializers; test that public JSON has no `reporter_id` |
| Exact location of sensitive incidents | Round on serialization; exact kept operator-only |
| Prompt injection via description | System instruction says treat text as data; validate output enum/length; AI cannot change status |
| XSS from user text | `textContent` rendering, escape helper, Jinja autoescape |
| Privilege escalation | Server-side role decorators; 403 tests |
| Abuse and spam (fake reports/SOS) | Rate limits, duplicate flag, operator dismissal, audit log |
| Secrets exposure | Env vars only; `.env` ignored by git |
| Unsafe uploads | Type/size checks, random names, no execution |
| CCTV misuse | Mock feeds only, access audit-logged, no face recognition |
| Panic or defamation through wording | Neutral AI summary, no area labeling, status always visible |

## 9. Key performance risks and mitigations

| Risk | Mitigation |
|---|---|
| Nearby query scans all rows | Bounding-box prefilter on indexed `lat`,`lng`, then Haversine on the small set |
| Slow Gemini call blocks request | 6 s timeout then fallback; optional async later |
| Socket fan-out on large radius | Cap radius at 5 km; recipients computed from opted-in users only |
| Map with too many pins | Limit 200 results per request; cluster later if needed |
| SQLite write contention | Fine for a demo; Postgres via `DATABASE_URL` for deployment scale |
| In-memory rate limits reset on restart | Acceptable for MVP; Redis later |

## 10. Error handling conventions
- All API errors: `{"error": "message", "code": "snake_case"}` with proper status (400, 401, 403, 404, 409, 429, 500).
- Frontend shows toast plus inline messages; every list has loading, empty and error states.
- Never expose stack traces; log server-side.

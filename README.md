# SAATH — Community Safety, Connected

SAATH is a civic transparency and public-information web application for local incident reporting, opt-in nearby awareness alerts, incident-aware demo route options, time-limited emergency SOS, opt-in helper coordination, and AI-assisted operator triage.

> **Disclaimer:** SAATH is a prototype. Alerts, routes, and camera feeds are simulated or informational only. SAATH does not predict crime, score neighborhoods, verify reports automatically, or replace emergency services (India: **112**).

## Quick Start

### Prerequisites
- Node.js **20.x LTS** or **22.x+**
- npm 10+

### Local Setup
```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

To run verification, tests, and production build:

```bash
npm test        # Run Vitest test suite (12 tests)
npm run lint    # Typecheck with TypeScript
npm run build   # Build production assets with Vite
npm start       # Run in production mode with static asset serving
```

### Docker Setup

You can build and run SAATH as a lightweight container:

```bash
# Build Docker image
docker build -t saath .

# Run container with persistent data volume
docker run -d -p 3000:3000 -v saath-data:/app/data --name saath saath
```

## Deployment

SAATH is container-ready and can be deployed to any platform supporting Node.js or Docker (e.g. Render, Railway, Fly.io, AWS ECS, Google Cloud Run, DigitalOcean, VPS).

- **Production Command:** `npm run build && npm start`
- **Port:** Configured via `PORT` (defaults to `3000`).
- **Data Persistence:** Persistent storage is recommended for `SQLITE_PATH` and `UPLOADS_DIR` when using container volumes or mounted disks.

## Environment Variables

Copy `.env.example` to `.env` (or configure secrets in your hosting environment):

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | Optional | `3000` | Port for the HTTP/WebSocket server. |
| `GEMINI_API_KEY` | Optional | — | Enables live Gemini triage (`gemini-4-hydrogen`). App falls back to deterministic keyword rules when unset. |
| `GEMINI_MODEL` | Optional | `gemini-4-hydrogen` | Gemini model alias for server-side triage. |
| `OPERATOR_PASSWORD` | Optional | — | Passcode for Operator Console access. If unset, the Login screen offers a one-time first-run passcode setup stored as an `scrypt` hash. |
| `DEFAULT_LAT` | Optional | `21.1458` | Default city center latitude (Nagpur, India). |
| `DEFAULT_LNG` | Optional | `79.0882` | Default city center longitude (Nagpur, India). |
| `SQLITE_PATH` | Optional | `./saath.db` | SQLite database file path. |
| `UPLOADS_DIR` | Optional | `./uploads` | Directory path for user evidence uploads. |

## What Is Simulated

- **Nearby Alerts & Demo Phones:** Alerts are persisted in SQLite (`alerts` table) and pushed over Socket.IO rather than real SMS/push/email gateways. The Operator Console includes a **Demo Phones Panel** showing seeded users (`Asha`, `Ravi`, `Meera`, `Karan`) lighting up based on opt-in and radius.
- **Trusted Contact SOS Notifications:** Triggering SOS writes an `sos_sessions` record with a 15-minute expiry and emits Socket.IO `sos:notify` events to the simulated Trusted Contact panel.
- **Incident-Aware Routes:** `GET /api/routes` generates demo polyline geometry (`is_demo: true`), shifting Route B perpendicularly away from fresh/aging reports within 200 m of direct Route A. It is not connected to road-network routing engines.
- **Mock CCTV References:** The Operator Console's camera panel plays an animated synthetic traffic canvas labeled `SIMULATED FEED — authorized demo only` and logs every feed open to `audit_logs`. No real cameras or face recognition exist.
- **Seed Data:** Seeded Nagpur incidents, citizens, trusted contacts, and mock camera references are synthetic demo records.

## Assumptions

- **Runtime Adaptation:** Executed on Node.js 22, Express, `better-sqlite3`, Socket.IO, React, TypeScript, and Leaflet (with `@google/genai` for Gemini triage) so the entire application builds and serves cleanly on port 3000 with full functional parity to `SPEC.md`.
- **Locale:** Default center is Nagpur, India (`21.1458, 79.0882`); English UI; emergency helpline `112`.
- **Auth:** Demo-grade in-memory Bearer token session per login, with server-side role enforcement (`operator` vs `citizen`).
- **Uploads:** Optional JPG/PNG evidence uploads up to 2 MB are stored locally under `./uploads` with randomized filenames and strict path-traversal confinement.

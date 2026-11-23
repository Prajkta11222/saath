# SRS — SAATH (Software Requirements Specification, concise)

## 1. Purpose and scope
Defines verifiable requirements for the SAATH hackathon MVP. Scope and features: PRD.md. Build instructions: SPEC.md. This SRS adds interfaces, measurable quality targets, constraints and a test mapping.

## 2. System context
Web application (Flask backend, browser frontend). External services: OpenStreetMap tiles (public CDN), Gemini API (optional). Everything else (SMS, push, CCTV, routing) is simulated.

## 3. User classes
Citizen (default), Operator (password-gated), Anonymous viewer (read-only public map and details).

## 4. Functional requirements (traceable)

| ID | Requirement | PRD | Verification |
|---|---|---|---|
| SRS-F1 | System shall accept an incident with category, description (10–500 chars), lat/lng, occurred_at and optional evidence, and store it as `pending`. | F1 | pytest: valid and invalid payloads |
| SRS-F2 | System shall run AI triage on each new incident and store category, priority, summary, triage suggestion, confidence, flags and source. | F2 | pytest: fallback shape; manual with key |
| SRS-F3 | If Gemini is unavailable, slow (> 6 s) or returns invalid output, system shall fall back to keyword rules without failing the request. | F2 | pytest: forced failure |
| SRS-F4 | System shall return incidents within a radius with distance, freshness and status, excluding stale reports unless requested. | F3 | pytest: radius, stale |
| SRS-F5 | System shall push new incidents and status changes to connected clients in real time. | F3 | manual: two tabs |
| SRS-F6 | System shall alert opted-in users within their radius (excluding the reporter) for fresh/aging incidents only. | F4 | pytest + manual |
| SRS-F7 | System shall return two route alternatives with an incident overlay and `is_demo: true`. | F5 | pytest: B differs from A when an incident lies on A |
| SRS-F8 | System shall create SOS sessions, accept location updates only while active and unexpired, and allow cancel/resolve. | F6 | pytest: expiry |
| SRS-F9 | System shall create help requests with location rounded to about 300 m and deliver limited payloads to opted-in helpers within 2 km. | F7 | pytest: payload fields |
| SRS-F10 | Only operators shall change incident status; each change shall be audit-logged and valid per the state machine. | F8 | pytest: 403, 409, audit row |
| SRS-F11 | Two distinct non-reporter confirmations shall set `community_confirmed`. | F9 | pytest |
| SRS-F12 | Operator opening a mock camera feed shall create an audit entry. | F8 | pytest |
| SRS-F13 | Demo reset shall restore seed data (operator only). | PRD FR-11 | manual |

## 5. Non-functional requirements

| ID | Category | Requirement |
|---|---|---|
| SRS-N1 | Performance | Nearby query returns in under 500 ms for 1,000 incidents on a dev machine; page interactive within 3 s |
| SRS-N2 | Reliability | App fully functional with no external key; Gemini failure never returns a 5xx to the user |
| SRS-N3 | Privacy | Public API never exposes reporter id, contacts or exact sensitive coordinates |
| SRS-N4 | Security | Server-side role checks, escaped output, rate limits, validated uploads, secrets in env |
| SRS-N5 | Usability | Mobile-first (360 px width), SOS button at least 56 px tall, high-contrast text, loading/empty/error states on every data view |
| SRS-N6 | Neutrality | UI and AI text avoid sensational or area-labeling wording; status always visible |
| SRS-N7 | Transparency | Every status change visible on a public timeline with timestamp |
| SRS-N8 | Honesty | Disclaimers present: not a safety guarantee, simulated alerts, call 112 |
| SRS-N9 | Portability | Runs locally with `pip install -r requirements.txt && python app.py`; deployable on Render/Railway |
| SRS-N10 | Maintainability | Layered structure per ARCHITECTURE.md; no business logic in routes |

## 6. External interfaces
- **UI:** screens listed in SPEC.md section 9.
- **REST API:** SPEC.md section 6; JSON; errors `{error, code}`.
- **WebSocket:** events in SPEC.md section 6.
- **Gemini API:** request with system instruction and user text; response parsed as JSON; 6 s timeout.
- **Map tiles:** OpenStreetMap standard tile server with attribution displayed.

## 7. Constraints
Hackathon timeline; free-tier hosting; originality (own code, no copied projects); no real emergency, police or CCTV integration; synthetic data for demo; legal/ethical limits in SPEC.md section 2.

## 8. Assumptions and dependencies
Same as PRD section 10. Browser supports Geolocation and WebSocket.

## 9. Acceptance
MVP is accepted when all SRS-F items pass verification, SRS-N items are demonstrably met, and the demo flow in SPEC.md section 14 runs without errors.

# PRD — SAATH (Community Safety, Connected)

**Status:** MVP for IDEA//FORGE Track 1 (Civic Pulse, Digital Governance & Public Information)
**Source of truth:** SAATH Project Blueprint. Anything not in the blueprint is marked *(Assumption)*.
**Companion docs:** SPEC.md (build instructions), SRS.md, TECH_STACK.md, ARCHITECTURE.md, DATABASE.md, AGENT_WORKFLOW.md

---

## 1. Problem

Local incident information is scattered across channels (messaging groups, social media, word of mouth). People nearby often do not receive timely, relevant updates, and help coordination during emergencies is fragmented. Citizens who report civic or safety issues rarely see what happened to their report, so trust and transparency suffer.

**Who is affected:** residents in a locality, commuters choosing routes, people who feel unsafe and need quick help, and municipal or community operators who receive reports with no triage.

**Why now / why AI:** one report can become a useful, neutral warning for others, but only if it is categorized, prioritized and reviewed quickly. AI assists that triage; humans keep every decision.

## 2. Product Vision and Core Objective

Turn scattered local incident reports into **timely, transparent, actionable community awareness**, without predicting crime, scoring neighborhoods, or guaranteeing anyone's safety.

**Track 1 framing:** a civic transparency and public-information tool. Every report carries a public status and an audit trail.

## 3. Target Users

| User | Needs | Notes |
|---|---|---|
| **Citizen reporter / resident** | Report quickly, see nearby reports, get relevant alerts, know report status | Primary user |
| **Commuter** | Route options that account for recent reports | Same account as citizen |
| **Person in distress** | One-tap SOS, notify trusted contacts, optionally ask nearby helpers | Needs clarity under stress |
| **Trusted contact** | Receive SOS with limited live location for a limited time | Simulated in MVP |
| **Opt-in nearby helper** | See limited-info help requests, guidance to stay safe | Never told to confront anyone |
| **Operator / moderator** | Review queue, AI suggestions, change status, audit trail, mock CCTV reference | Authorized role only |

*(Assumption)* Initial locale: Nagpur, India; English UI; emergency number 112.

## 4. Core Features (from blueprint)

| ID | Feature | Summary |
|---|---|---|
| F1 | Incident reporting | Category, description, approximate location, time, optional evidence, sensitive flag |
| F2 | AI triage | Classification, priority, neutral summary, triage suggestion; rule-based fallback; operator decides |
| F3 | Nearby incident map | Pins with category, time, distance, status, freshness; filters; real-time updates |
| F4 | Nearby alerts | Opt-in, configurable radius, neutral wording, no personal data |
| F5 | Incident-aware routes | Two demo route alternatives, recent-report overlay, "not a safety guarantee" caveat |
| F6 | Emergency SOS | Time-limited live location, trusted contacts notified (simulated), cancel/resolve |
| F7 | Nearby help request | Opt-in helpers see approximate area only, safe-distance guidance |
| F8 | Operator console | Review queue, status changes, audit trail, mock CCTV panel |
| F9 | Public transparency | Status timeline on each report; community confirmation |

## 5. User Stories and Acceptance Criteria

**F1 Reporting**
- As a resident, I want to submit a report with a location pin so that others nearby learn about it.
  - *Accept:* description 10 to 500 chars required; location required; saved as Unverified; marker appears for others within seconds.
- As a resident, I want to mark a report sensitive so that the exact location is protected.
  - *Accept:* public payload rounds location to about 500 m.

**F2 AI triage**
- As an operator, I want a suggested category, priority and summary so that I can review faster.
  - *Accept:* AI fields shown with label "AI suggestion — operator decides"; works with no API key via rules.

**F3 Map**
- As a resident, I want to see nearby reports with status and freshness so that I can judge relevance.
  - *Accept:* each popup shows category, time ago, distance, status badge, freshness chip; stale reports are greyed and hidden by default.

**F4 Alerts**
- As a resident, I want opt-in alerts within my radius so that I am informed without noise.
  - *Accept:* reporter does not alert self; users outside radius or opted out receive nothing; text contains no reporter details.

**F5 Routes**
- As a commuter, I want route options that avoid recent reports so that I can make informed choices.
  - *Accept:* two alternatives; Route B detours around fresh/aging reports near Route A; caveat always visible; marked demo.

**F6 SOS**
- As a person in distress, I want to start SOS and share my live location for a limited time so that trusted contacts can follow my status.
  - *Accept:* confirm step; sharing auto-stops at expiry (15 min); cancel/resolve works; disclaimer shown.

**F7 Help**
- As an opted-in helper, I want to see an approximate-area help request with safety guidance so that I can respond responsibly.
  - *Accept:* no name or exact location shown; guidance to call emergency services first and help only from a safe distance.

**F8 Operator**
- As an operator, I want to change a report's status and see who did what so that decisions are accountable.
  - *Accept:* only operators can change status; every change creates an audit entry; opening a mock feed creates an audit entry.

**F9 Transparency**
- As a reporter, I want to see my report's status history so that I know it was handled.
  - *Accept:* timeline shows reported, community-confirmed, reviewed, resolved or dismissed with timestamps.

## 6. Requirements

### Functional
- FR-1 Create, list (by proximity and filters), view, confirm and status-update incidents (F1, F3, F8, F9).
- FR-2 Compute freshness and expiry per category; exclude stale reports from alerts and route avoidance (F3, F4, F5).
- FR-3 Run AI triage on every new report with a rule-based fallback (F2).
- FR-4 Flag possible duplicates: same category within 150 m in the last 2 hours (F2).
- FR-5 Two distinct community confirmations set Community-confirmed; only operators set Reviewed, Resolved or Dismissed (F9).
- FR-6 Opt-in alerts by radius over WebSocket (F4).
- FR-7 Demo route alternatives with incident overlay (F5).
- FR-8 SOS lifecycle with expiry and simulated trusted-contact notification (F6).
- FR-9 Help requests to opted-in helpers with approximate location only (F7).
- FR-10 Operator console with queue, audit log, mock camera references (F8).
- FR-11 Demo seed and reset.

### Non-functional (summary; detail in SRS.md)
Neutral wording; privacy by default; mobile-first responsive UI; works offline of any third-party key; page loads under 3 s on a normal connection; honest-limit disclaimers present.

## 7. Edge Cases

| Case | Expected behavior |
|---|---|
| Location permission denied | Fall back to default city center; allow manual pin |
| Report description too short or too long | Inline validation error |
| Duplicate nearby report | Accept, flag `possible_duplicate`, show to operator |
| Rate limit exceeded (5 reports/hour) | Friendly message, no data loss in form |
| Gemini unavailable or invalid JSON | Rule-based fallback; `ai_source = rules` |
| Prompt injection in description | Treated as data; output validated against enum |
| Report expired while viewing | Shown as stale |
| User confirms same report twice | Rejected (unique constraint) |
| Reporter confirms own report | Rejected |
| SOS sharing expires | Updates rejected; state shows expired |
| SOS started twice | Second start returns the active SOS |
| No opted-in helpers nearby | Show "No nearby helpers available. Call 112." |
| Operator route called by citizen | 403 |
| Empty map / no data | Empty state with Report button |
| Socket disconnect | Client reconnects and refetches nearby incidents |
| Sensitive incident | Public location rounded; exact kept for operator only |
| Fake emergency abuse | Rate limits, audit log, operator dismissal |

## 8. MVP Scope

**In scope:** F1 to F9 as listed, demo auth, simulated notifications, mock routes, mock CCTV, seed data, honest-limit copy.
**Out of scope:** crime prediction or area safety scores, face recognition, real police/CCTV/SMS integrations, native apps, analytics dashboards, OAuth, multilingual UI, payments.

## 9. Success Criteria (hackathon)

- The 90 to 120 second demo flow runs end to end without errors.
- App works with zero API keys and with a Gemini key.
- No reporter identity or exact sensitive location leaks in public responses.
- Judges can see the AI role and the human-in-the-loop decision clearly.

## 10. Assumptions to Confirm (do not block the build)

1. Locale is Nagpur, English only.
2. Demo-grade login is acceptable.
3. All notifications are simulated.
4. Route data is generated demo geometry.
5. A simple rule-based fallback satisfies "meaningful AI" when Gemini is unavailable.

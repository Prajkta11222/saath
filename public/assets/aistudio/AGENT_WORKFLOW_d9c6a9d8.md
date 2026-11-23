# AGENT_WORKFLOW — How to build SAATH

You are the coding agent. Follow the project's disciplined cycle:
**IDEA → PRD → TECH STACK → ARCHITECTURE → DATABASE → BUILD one feature → TEST → REVIEW → DEBUG.**
Planning docs already exist. Your job starts at BUILD and repeats BUILD → TEST → REVIEW → DEBUG per feature.

## 1. Reading order (read all before writing code)
1. `SPEC.md` — the build contract (what and in which order)
2. `PRD.md` — why, users, stories, edge cases, MVP scope
3. `TECH_STACK.md` — fixed technology choices
4. `ARCHITECTURE.md` — structure, flows, risks
5. `DATABASE.md` — tables, constraints, indexes
6. `SRS.md` — measurable requirements and verification
7. This file — process and prompts

## 2. Precedence and clarifications
If documents conflict: **SPEC.md > DATABASE.md > ARCHITECTURE.md > PRD.md > SRS.md > TECH_STACK.md**. Clarifications that apply on top of SPEC.md:

- Use table names from DATABASE.md (`users`, `incidents`, `sos_sessions`, ...). SPEC.md's `SOS` entity maps to `sos_sessions`.
- No separate status-history table: the public timeline is derived from `audit_logs` (DATABASE.md section 5). Write an audit row with `actor_id = NULL` for automatic `community_confirmed`.
- Add `Flask-Limiter` for rate limits.
- A reporter cannot confirm their own incident. A user cannot have two active SOS sessions (return the existing one).
- Status transitions follow ARCHITECTURE.md section 6; invalid transitions return 409.
- Error format: `{"error": "...", "code": "snake_case"}`.
- Do not invent requirements. If something is unclear, choose the simplest option and leave `# ASSUMPTION:` in code plus one line in `README.md` under "Assumptions".

## 3. Rules of engagement
- Implement **one feature at a time**, in the phase order of SPEC.md section 12.
- Follow the existing architecture; do not modify unrelated code.
- Handle loading, errors, validation and edge cases for every feature (PRD section 7).
- Keep it simple; no frameworks, services or patterns that are not in TECH_STACK.md.
- Never expose reporter identity, contacts or exact sensitive coordinates in public responses.
- Never commit secrets. Provide `.env.example` only.
- After each feature: run tests, review, fix, then commit with a message like `feat(F3): nearby map with filters`.
- Don't rewrite working code unnecessarily.

## 4. Feature backlog (build in this order)

| # | Feature | SPEC phase | Done when |
|---|---|---|---|
| 1 | App skeleton, config, models, seed, map with seeded pins | 1 | Map shows seeded incidents |
| 2 | Create incident + validation + freshness + rate limit | 2 | POST works, bad input rejected |
| 3 | AI triage with fallback + duplicate flag | 2 | AI fields stored with no key |
| 4 | Report form, filters, popups, details page, confirmations | 3 | New pin appears; 2 confirms flip status |
| 5 | Demo login, `/api/me`, opt-ins, nearby alerts, Demo Phones | 4 | Alert only to opted-in users in radius |
| 6 | Routes with overlay and caveat | 5 | Route B differs when incident on A |
| 7 | SOS flow with expiry and trusted contacts | 6 | Expiry stops updates |
| 8 | Help requests and helper cards | 6 | No name or exact location leaked |
| 9 | Operator console, status changes, audit, timeline, mock CCTV | 7 | Status change updates public timeline live |
| 10 | Polish: states, reset, README, deploy files, test pass | 8 | Fresh clone runs in under 5 minutes |

## 5. Per-feature loop (prompt templates)

### 5.1 BUILD — one feature
```
Implement ONLY this feature: [FEATURE from backlog]

First explain:
1. Implementation plan
2. Files to create/change
3. Dependencies needed

Then write the code.

Follow the existing architecture (ARCHITECTURE.md) and schema (DATABASE.md).
Don't modify unrelated code.
Handle loading, errors, validation, and edge cases (PRD.md section 7).
```

### 5.2 TEST
```
Create tests for this feature: [FEATURE + CODE]

Cover:
- Happy path
- Invalid input
- Edge cases
- Errors
- Authentication / authorization
- API/database failures (including Gemini failure fallback)

Tell me which tests should be unit, integration, or end-to-end.
Then write the most important tests (pytest, Flask test client).
Map each test to the SRS-F / SRS-N ID it verifies.
```

### 5.3 REVIEW
```
Review this code as a senior engineer: [CODE]

Find:
- Bugs
- Security issues (privacy leaks, XSS, privilege checks, injection)
- Performance problems
- Bad architecture (logic in routes, layering violations)
- Duplicated logic

For each issue, explain: Problem → Why → Fix.
Don't rewrite everything unnecessarily.
```
Review checklist specific to SAATH:
- [ ] Public JSON has no `reporter_id`, `contact`, or exact sensitive coordinates
- [ ] Operator endpoints check role server-side
- [ ] User text rendered with `textContent`/escaping
- [ ] Stale incidents excluded from alerts and route avoidance
- [ ] AI output validated; AI never changes status
- [ ] Disclaimers and neutral wording present where specified
- [ ] Loading, empty and error states exist

### 5.4 DEBUG
```
Debug this issue:

Expected: [EXPECTED]
Actual: [ACTUAL]
Error: [ERROR]
Code: [CODE]

Don't guess.
Find the root cause, explain why it happens,
provide the smallest fix, and tell me how to verify it.
```
After a fix, add a regression test when practical.

## 6. Test strategy (summary)
- **Unit:** `geo` (haversine, rounding, freshness), `ai_triage` fallback and JSON validation, status transition rules.
- **Integration:** API endpoints with Flask test client and in-memory SQLite (permissions, payload shape, rate limits).
- **End-to-end (manual):** the 90 to 120 second demo flow in SPEC.md section 14 using multiple browser tabs.

## 7. Definition of done (project)
SPEC.md section 17 is satisfied, every backlog item passes its "Done when" check, tests pass, and `README.md` lists setup, env vars, deployment and everything that is simulated.

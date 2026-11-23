# TECH_STACK — SAATH

Priorities (in order): **simplicity, security, scalability**. Hackathon MVP; avoid anything that adds setup time.

| Area | Choice | Why | Rejected alternative |
|---|---|---|---|
| Frontend | HTML, CSS, vanilla JS, Leaflet, OpenStreetMap tiles | No build step, runs anywhere, fast to demo, blueprint-aligned | React/Vite: more setup, no demo benefit |
| Backend | Python 3.11, Flask 3 | Small, readable, blueprint-aligned, easy AI SDK use | Django: heavier; FastAPI: fine but not in blueprint |
| ORM | Flask-SQLAlchemy | Same models on SQLite and PostgreSQL, parameterized queries (SQL injection safe) | Raw SQL: more bugs |
| Database | SQLite default; PostgreSQL via `DATABASE_URL` | Zero setup locally, production path exists | PostGIS: unnecessary at demo scale; Haversine is enough |
| Geo | Haversine in `services/geo.py` plus bounding-box prefilter | Accurate enough at city scale, no extension needed | PostGIS (documented as future option) |
| Realtime | Flask-SocketIO | Live markers and simulated alerts for the demo | Polling: less impressive, more load |
| Authentication | Flask session cookie, demo login (name + role), operator password from env, server-side role checks | Enough to demonstrate roles and audit without OAuth time cost | OAuth/JWT: out of scope |
| AI | Gemini API (`google-generativeai`), JSON output, validated; rule-based fallback | Team already uses Gemini; fallback keeps the demo reliable | Local ML models: training/time cost |
| APIs | Internal REST (JSON). No external routing/SMS APIs in MVP | Fewer failure points in demo | OSRM/Twilio: future |
| Rate limiting | Flask-Limiter (memory storage) | Anti-abuse with one line per route | Custom code |
| Validation | Manual schema checks in a `validate.py` helper (or `marshmallow` if preferred) | Keeps dependencies small | — |
| Testing | pytest, Flask test client; manual demo run-through | Fast, covers critical API behavior | Selenium/Playwright: too heavy |
| Deployment | Render or Railway, `gunicorn` with `eventlet` worker, `Procfile` | Free tier, simple, supports WebSockets | Vercel: poor WebSocket fit |
| Config | `.env` plus `python-dotenv` | Keys never in code | — |

## Dependencies (`requirements.txt`)
```
Flask
Flask-SQLAlchemy
Flask-SocketIO
Flask-Limiter
python-dotenv
google-generativeai
eventlet
gunicorn
pytest
```
Pin versions after the first successful install.

## Security posture
- Secrets only in env vars; `.env` in `.gitignore`.
- Escape all user text on render (use `textContent`, never `innerHTML` with user data).
- Server-side role checks on every operator endpoint; session cookie `HttpOnly`, `SameSite=Lax`.
- File uploads: jpg/png only, 2 MB max, random filename, stored outside any executable path.
- AI output is validated against enums and length limits before saving.
- Public serializers are allow-lists (explicit fields), never "dump the model".

## Scalability notes (future, not built)
SQLite to PostgreSQL/PostGIS, Redis for Socket.IO message queue and rate limiting, background workers for notifications, real routing provider, object storage for media.

# LMS PWA — Handover Summary
**Date:** 2026-05-07  
**Branch:** main  
**Deployed to:** Cloudflare Pages (lms-pwa-v1.pages.dev)

---

## Project Overview

A "Last Man Standing" sports-picking elimination game as a PWA. Players pick a football team each round; anyone whose team loses is eliminated. Last player standing wins.

**Stack:**
- Vite + React + TypeScript, deployed to Cloudflare Pages
- Cloudflare Pages Functions (Hono) as the API layer (`/functions/api/`)
- Cloudflare D1 (SQLite) as source of truth — database ID: `d4599b40-f029-4552-bb12-27590e4e8eca`
- IndexedDB (via `idb`) as offline read cache only — populated by background sync
- Custom Web Crypto JWT (HS256 via `crypto.subtle`) — `JWT_SECRET` set as encrypted secret in Cloudflare dashboard

---

## Auth System

Three roles: `admin`, `manager`, `player`

- **Admin**: one-time setup at `/api/auth/setup`. Manages groups/teams.
- **Manager**: invited by admin via QR code. Manages players and their own games.
- **Player**: invited by manager via QR code. Sees only their own games.

Invite flow: admin → manager via `POST /auth/invite` → QR code → `?token=xxx` URL → `POST /auth/register`. Tokens are one-use, 24h expiry.

JWT stored in `localStorage` as `lms_token`. Expiry dispatches `auth:expired` event which clears auth state.

Background sync (`GET /api/sync`) uses `getBackground()` API variant — 401 fails silently to avoid logging users out during sync.

---

## Data Model (D1)

`groups` → `teams` (many, with `external_id` and `crest_url` for PL teams)  
`players` (shared pool)  
`games` (belongs to group, has manager_id)  
`participants` (player_name string, game_id)  
`rounds` (game_id, round_number, status: open/closed, fixture_ids: JSON array of fixture IDs)  
`picks` (game_id, round_id, player_name, team_name, result)  
`fixtures` (Premier League matches — id is football-data.org match id)

Notable: D1 uses integers for booleans (0/1); all boolean fields mapped in Worker helpers (`mapGame`, `mapParticipant`, `mapPick`, `mapRound`).

D1 enforces foreign keys. `picks.team_id` references `teams(id)` — delete team nulls picks first.

### Applied migrations
- `migration_002_auth.sql` — users, invite_tokens, manager_id on games/groups
- `migration_003_fixtures.sql` — fixtures table, external_id/crest_url on teams
- `migration_004_round_matchday.sql` — matchday INTEGER on rounds (unused, superseded)
- `migration_005_round_fixtures.sql` — fixture_ids TEXT on rounds

---

## Role-Based Access (Current State)

| Resource | Admin | Manager | Player |
|---|---|---|---|
| Groups (write) | ✓ | read-only | — |
| Teams (write) | ✓ | read-only | — |
| Players (write) | ✓ | ✓ | — |
| Games (see) | all | own (`manager_id`) | participant only |
| Game detail | any | own only | participant only |

**Guard rules:**
- Players/Teams cannot be deleted if they are in an active game (409 Conflict)
- Player picks enforced server-side: players can only submit their own pick

**Player view toggle:** Admin/Manager users have a "Player View" button in the header. When active, game queries switch to `?view=player` (participant-scoped), manager controls are hidden, and a single-game auto-redirect fires. Toggle resets to the games list.

---

## Key Files

```
functions/api/
  [[catchall]].ts       Entry point, auth middleware, SYNC_SECRET bypass
  routes/auth.ts        Login, setup, invite, register
  routes/data.ts        All data CRUD, role scoping, deletion guards
                        GET  /fixtures                — all fixtures sorted by date
                        POST /admin/sync-fixtures     — accepts SYNC_SECRET or admin JWT
                        POST /admin/import-teams      — accepts SYNC_SECRET or admin JWT
                        PATCH /rounds/:id/fixtures    — stores fixture_ids JSON on round
  middleware/auth.ts    authMiddleware, requireRole()
  lib/jwt.ts            Custom Web Crypto HS256 JWT
  lib/crypto.ts         PBKDF2 passcode hashing
  lib/types.ts          HonoEnv, Bindings, Variables

src/
  api/client.ts         Fetch wrapper, tokenStore, get/post/put/patch/delete
  contexts/AuthContext  user, isAdmin, isManager, isPlayer,
                        actingAsPlayer, viewMode, setViewMode
  hooks/useOnlineSync   Background sync on mount + reconnect
  db.ts                 All DB ops — online-first reads, IDB offline fallback
  components/
    auth/               SetupPage, LoginPage, RegisterPage, InviteQR
    SetupTab            Groups/Teams with crests, Players
    GamesListTab        Game list + create form; player view = card picker
    GameDetailTab       Fixture picker → picks → results flow
    ReportsTab          Read-only game/round/standings view
    ToolsTab            Backup/restore only (admin sync moved to curl scripts)

scripts/
  sync-fixtures.sh      Fetch PL fixtures from football-data.org → POST to API
  import-teams.sh       Fetch PL teams with crests → POST to API (one-off)
```

---

## Phase 4: Fixtures Sync — Complete

- `SYNC_SECRET` env var set in Cloudflare Pages dashboard
- `POST /api/admin/sync-fixtures` and `POST /api/admin/import-teams` accept `Authorization: Bearer <SYNC_SECRET>`
- `scripts/sync-fixtures.sh` — run locally or from Pi: `FOOTBALL_DATA_API_KEY=xxx SYNC_SECRET=yyy ./scripts/sync-fixtures.sh`
- `scripts/import-teams.sh` — one-off: `FOOTBALL_DATA_API_KEY=xxx SYNC_SECRET=yyy GROUP_ID=1 ./scripts/import-teams.sh`
- D1 has 380 fixtures for 2025/26 season and 20 PL teams with crests
- Pi cron planned for go-live: `0 6 * * * FOOTBALL_DATA_API_KEY=xxx SYNC_SECRET=yyy /path/to/sync-fixtures.sh`
- `sync-worker/` removed from repo — delete `lms-sync-worker` Worker in Cloudflare dashboard

---

## Phase 5: UI/UX — Complete

### Theme & Accessibility
- Dark pitch-green + gold theme (`--bg: #0b1d13`, `--accent: #f0c030`)
- 16px base font, 1.6 line-height, 0.02em letter-spacing (dyslexia-friendly)
- Win result button is blue not green (color-blind safe — blue/red vs green/red)
- WCAG AA contrast on all text; `focus-visible` gold ring on all interactive elements

### Team crests
- Teams imported via `import-teams.sh` show 22px crest inline in SetupTab
- API team queries return `crestUrl` and `externalId`

### Round-fixture linking
- Admin selects fixtures for a round from a scrollable picker (-2 weeks to +4 weeks window)
- Fixtures shown as: `Sat 5 Apr 15:00 · GW30 · Arsenal vs Wolves`
- Fixture IDs stored as JSON on `rounds.fixture_ids`
- Pick dropdown shows: `Arsenal (Home vs Wolves, Sat 5 Apr 15:00)` — team-first, fixture context in brackets
- Teams filtered to only those playing in the selected fixtures
- Auto-assign also restricted to matchday teams
- Results phase: per-fixture buttons (Arsenal Win / Draw / Wolves Win / Postponed) set both teams at once — prevents inconsistent entry
- Falls back to per-team buttons if no fixture data

---

## What's Not Done Yet

1. **Remove `/api/debug/env` endpoint** — remove before going public
2. **iOS/Safari PWA specifics (Phase 5 continued)** — UX vision not yet discussed
3. **Push notifications (Phase 6)** — Safari supports Web Push from iOS 16.4+; needs Worker endpoint for push subscriptions in D1
4. **Passkeys** — planned future replacement for passcode auth
5. **Automated testing** — no test suite yet; all testing manual

---

## Local Dev

User has no local Node/npm — all npm commands run via Docker:
```bash
docker run --rm -v "$(pwd)":/app -w /app node:20-alpine sh -c "npm run build"
docker run --rm -v "$(pwd)":/app -w /app node:20-alpine sh -c "npm install"
```
Deploy is automatic: push to `main` → Cloudflare Pages CI/CD builds and deploys.

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

`groups` → `teams` (many)  
`players` (shared pool)  
`games` (belongs to group, has manager_id)  
`participants` (player_name string, game_id)  
`rounds` (game_id, round_number, status: open/closed)  
`picks` (game_id, round_id, player_name, team_name, result)  
`fixtures` (Premier League matches — id is football-data.org match id)

Notable: D1 uses integers for booleans (0/1); all boolean fields mapped in Worker helpers (`mapGame`, `mapParticipant`, `mapPick`).

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
  [[catchall]].ts       Entry point, auth middleware wiring
  routes/auth.ts        Login, setup, invite, register
  routes/data.ts        All data CRUD, role scoping, deletion guards
                        Includes: POST /admin/import-teams
                                  POST /admin/sync-fixtures
  middleware/auth.ts    authMiddleware, requireRole()
  lib/jwt.ts            Custom Web Crypto HS256 JWT
  lib/crypto.ts         PBKDF2 passcode hashing
  lib/types.ts          HonoEnv, Bindings, Variables

src/
  api/client.ts         Fetch wrapper, tokenStore, getBackground()
  contexts/AuthContext  user, isAdmin, isManager, isPlayer,
                        actingAsPlayer, viewMode, setViewMode
  hooks/useOnlineSync   Background sync on mount + reconnect
  db.ts                 All DB ops — online-first reads, IDB offline fallback
  components/
    auth/               SetupPage, LoginPage, RegisterPage, InviteQR
    SetupTab            Groups/Teams (admin write), Players (manager write)
    GamesListTab        Game list + create form; player view = card picker
    GameDetailTab       Picks, results, round management
    ReportsTab          Read-only game/round/standings view
    ToolsTab            Backup/restore + admin: Sync Fixtures, Import PL Teams

```

---

## Phase 4: Fixtures Sync — Current State

### What's built
- `fixtures` D1 table (migration_003_fixtures.sql — already applied to production)
- `teams` table has new `external_id` and `crest_url` columns
- `POST /api/admin/sync-fixtures` — accepts a `{ matches: [] }` array, upserts into D1
- `POST /api/admin/import-teams` — fetches PL teams from football-data.org, upserts into a group
- Tools tab has **Sync Fixtures** and **Import PL Teams** admin buttons
- `sync-worker/` deployed to Cloudflare as `lms-sync-worker` (git-connected, auto-deploys)

### The problem: football-data.org free plan blocks Cloudflare IPs
- Cloudflare Workers → 522 (blocked)
- Cloudflare Pages Functions → 522 (blocked)
- Browser fetch (cross-origin from pages.dev) → 522 (also blocked)
- `curl` from a local/residential machine → works fine
- api-football.com free plan tried — blocks historical seasons, not useful
- api-sports.io (same API) free plan tried — same restriction

### Next step: Raspberry Pi sync
The Pi runs on a residential IP so football-data.org won't block it. Plan:
1. Add `SYNC_SECRET` env var to Cloudflare Pages (long-lived alternative to JWT)
2. Update `POST /api/admin/sync-fixtures` to accept `Authorization: Bearer <SYNC_SECRET>`
3. Pi runs a cron script (curl) that fetches from football-data.org and POSTs to the API
4. iOS users just read from D1 — they never touch the external API

`sync-worker/` has been removed from the repo. Also delete the `lms-sync-worker` Worker in the Cloudflare dashboard to stop any further builds.

---

## What's Not Done Yet

1. **Remove `/api/debug/env` endpoint** — remove before going public
2. **Raspberry Pi sync script** — see Phase 4 next step above
3. **iOS/Safari PWA specifics (Phase 5)** — user has a specific UX vision to discuss before building
4. **Push notifications (Phase 6)** — Safari supports Web Push from iOS 16.4+; needs Worker endpoint for push subscriptions in D1
5. **UI for fixtures** — fixtures table exists but nothing in the UI uses it yet (round scheduling TBC)
6. **Passkeys** — planned future replacement for passcode auth
7. **Automated testing** — no test suite yet; all testing manual

---

## Local Dev

User has no local Node/npm — all npm commands run via Docker:
```bash
docker run --rm -v "$(pwd)":/app -w /app node:20-alpine sh -c "npm run build"
docker run --rm -v "$(pwd)":/app -w /app node:20-alpine sh -c "npm install"
```
Deploy is automatic: push to `main` → Cloudflare Pages CI/CD builds and deploys.  

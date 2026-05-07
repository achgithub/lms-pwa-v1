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
`participants` (player_name string, game_id, user_id nullable FK to users)  
`rounds` (game_id, round_number, status: open/closed, fixture_ids: JSON array of fixture IDs)  
`picks` (game_id, round_id, player_name, team_name, result)  
`fixtures` (Premier League matches — id is football-data.org match id; includes status, home_score, away_score, winner)  
`push_subscriptions` (user_id, endpoint, p256dh, auth — Web Push subscriptions)  
`standings` (external_id, team_name, position, updated_at — PL league table, synced weekly)

Notable: D1 uses integers for booleans (0/1); all boolean fields mapped in Worker helpers (`mapGame`, `mapParticipant`, `mapPick`, `mapRound`).

D1 enforces foreign keys. `picks.team_id` references `teams(id)` — delete team nulls picks first.

`participants.user_id` is set automatically when a player subscribes to push notifications — links the player account to their participant rows by matching `users.name` against `participants.player_name` (COLLATE NOCASE).

### Applied migrations
- `migration_002_auth.sql` — users, invite_tokens, manager_id on games/groups
- `migration_003_fixtures.sql` — fixtures table, external_id/crest_url on teams
- `migration_004_round_matchday.sql` — matchday INTEGER on rounds (unused, superseded)
- `migration_005_round_fixtures.sql` — fixture_ids TEXT on rounds
- `migration_006_push_subscriptions.sql` — push_subscriptions table
- `migration_007_participants_user_id.sql` — user_id nullable FK on participants
- `migration_008_standings.sql` — standings table

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

**Player view toggle:** Admin/Manager users have a "Player View" button in the header. When active, game queries switch to `?view=player` (participant-scoped), manager controls are hidden, Setup/Tools tabs hidden, and a single-game auto-redirect fires. Toggle resets to the games list.

---

## Key Files

```
functions/api/
  [[catchall]].ts       Entry point, auth middleware, SYNC_SECRET bypass
                        SYNC_SECRET paths: sync-fixtures, import-teams, sync-standings
  routes/auth.ts        Login, setup, invite, register
  routes/data.ts        All data CRUD, role scoping, deletion guards
                        GET  /fixtures                — all fixtures sorted by date
                        GET  /standings               — league table sorted by position
                        POST /admin/sync-fixtures     — accepts SYNC_SECRET or admin JWT
                        POST /admin/import-teams      — accepts SYNC_SECRET or admin JWT
                        POST /admin/sync-standings    — accepts SYNC_SECRET or admin JWT
                        PATCH /rounds/:id/fixtures    — stores fixture_ids JSON on round
  routes/push.ts        Web Push: subscribe, unsubscribe, notify, vapid-public-key
  middleware/auth.ts    authMiddleware, requireRole()
  lib/jwt.ts            Custom Web Crypto HS256 JWT
  lib/webpush.ts        RFC 8291/8292 push encryption + VAPID JWT signing
                        VAPID sub claim must be a valid URL (Apple rejects bare domains)
  lib/crypto.ts         PBKDF2 passcode hashing
  lib/types.ts          HonoEnv, Bindings, Variables

src/
  api/client.ts         Fetch wrapper, tokenStore, get/post/put/patch/delete (delete supports body)
  contexts/AuthContext  user, isAdmin, isManager, isPlayer,
                        actingAsPlayer, viewMode, setViewMode
  hooks/useOnlineSync   Background sync on mount + reconnect
  hooks/usePushSubscription  Push subscription state + enable/disable (user-gesture triggered)
  db.ts                 All DB ops — online-first reads, IDB offline fallback
  gameLogic.ts          availableTeams, autoAssignTeams (standings-aware), computeEliminations
  components/
    auth/               SetupPage, LoginPage, RegisterPage, InviteQR
    SetupTab            Groups/Teams with crests, Players
    GamesListTab        Game list + create form; player view = card picker
    GameDetailTab       Fixture picker → picks → results flow
                        Picks phase: Save Picks (manual) + Finalise Picks (auto-assign + confirm)
                        Results phase: fixture score hint + win/draw/win buttons + Close Round
    ReportsTab          Read-only game/round/standings view
    ToolsTab            Backup/restore only (admin sync moved to curl scripts)

scripts/
  sync-fixtures.sh      Fetch PL fixtures from football-data.org → POST to API (daily cron)
  sync-standings.sh     Fetch PL standings → POST to API (twice weekly, Mon & Thu 07:00)
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
- App title hidden on mobile (<480px) to keep header clean

### Team crests
- Teams imported via `import-teams.sh` show 22px crest inline in SetupTab
- API team queries return `crestUrl` and `externalId`

### Round-fixture linking
- Admin selects fixtures for a round from a scrollable picker (-2 weeks to +4 weeks window)
- Fixtures shown as: `Sat 5 Apr 15:00 · GW30 · Arsenal vs Wolves`
- Fixture IDs stored as JSON on `rounds.fixture_ids`
- Pick dropdown shows: `Arsenal (Home vs Wolves, Sat 5 Apr 15:00)` — team-first, fixture context in brackets
- Teams filtered to only those playing in the selected fixtures
- Results phase: per-fixture buttons (Arsenal Win / Draw / Wolves Win / Postponed) set both teams at once — prevents inconsistent entry
- Results phase shows fixture score hint (from synced fixtures data) in gold when FINISHED, live score if IN_PLAY, "Awaiting result" otherwise
- Falls back to per-team buttons if no fixture data

---

## Phase 6: Push Notifications — Complete

- VAPID keys set as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY_JWK` in Cloudflare Pages dashboard
- `GET /api/push/vapid-public-key` — public key for browser subscription
- `POST /api/push/subscribe` — stores subscription + links `participants.user_id` by name match
- `DELETE /api/push/subscribe` — removes subscription
- `POST /api/push/notify` — manager/admin sends to active participants (or recently eliminated)
  - Notify types: `round-opened`, `closing-soon`, `eliminated`
  - Subscriber lookup via `participants.user_id` JOIN (not name string matching)
- VAPID JWT `sub` must be `https://lms-pwa-v1.pages.dev` — Apple rejects bare domains like `mailto:push@lms`
- Settings panel: ⚙ gear icon in header → enable/disable notifications (user-gesture triggered, works on iOS Safari)
- Notifications require PWA installed to home screen on iOS (not available in private browsing)
- Notify Players buttons use CSS grid — stack vertically on mobile

---

## Phase 7: Picks Flow & League Standings — Complete

### Picks flow (manager)
- **Save Picks**: saves manually entered picks only — no auto-assign, round stays in picks phase
- **Finalise Picks**: detects players without picks, auto-assigns using league standings (bottom of table first), shows confirmation card listing each assignment (player → team, position N, standings as at [date]) before saving. Manager can cancel.
- **Close Round & Advance**: only available after all picks are in (results phase). Saves win/draw/loss results, computes eliminations, advances or rolls over round.

### Auto-assign logic
- Teams sorted by league position descending (bottom of table = position 20 first)
- Each player is independent — multiple players can receive the same team if it's their lowest available
- A player's available teams = all teams minus those they've picked in previous closed rounds
- If no standings data, teams are unordered (fallback)
- Standings matched by team name (case-insensitive)

### League standings sync
- `migration_008_standings.sql` — standings table (external_id, team_name, position, updated_at)
- `scripts/sync-standings.sh` — `FOOTBALL_DATA_API_KEY=xxx SYNC_SECRET=yyy ./scripts/sync-standings.sh`
- Pi cron suggestion: `0 7 * * 1,4` (Mon & Thu 07:00 — twice weekly)
- `POST /api/admin/sync-standings` — upserts by external_id
- `GET /api/standings` — returns all standings ordered by position

### Service worker update banner
- Gold banner appears automatically when a new version is deployed and waiting
- Message: "New version available — close all app tabs and reopen to update"

---

## What's Not Done Yet

1. **Remove `/api/debug/env` endpoint** — remove before going public
2. **iOS/Safari PWA specifics** — UX vision not yet discussed
3. **Passkeys** — planned future replacement for passcode auth
4. **Automated testing** — no test suite yet; all testing manual

---

## Local Dev

User has no local Node/npm — all npm commands run via Docker:
```bash
docker run --rm -v "$(pwd)":/app -w /app node:20-alpine sh -c "npm run build"
docker run --rm -v "$(pwd)":/app -w /app node:20-alpine sh -c "npm install"
```
Deploy is automatic: push to `main` → Cloudflare Pages CI/CD builds and deploys.

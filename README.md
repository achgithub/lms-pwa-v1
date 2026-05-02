# lms-pwa-v1 — Last Man Standing

Single-user PWA for managing Last Man Standing football competitions. All state is stored in IndexedDB — no backend, no auth (Cloudflare Access handles that externally). Deployable to Cloudflare Pages as a static build.

---

## Local development

### Prerequisites

- Docker & Docker Compose, **or** Node 20+

### Hot-reload dev server (Docker)

```bash
docker compose up
```

Opens at **http://localhost:5173**. The `src/`, `public/`, `index.html`, and `vite.config.ts` are volume-mounted so edits are reflected immediately.

> Service workers are **not** active in Vite dev mode. Use the preview build to test PWA / offline behaviour.

### Hot-reload dev server (local Node)

```bash
npm install
npm run dev
```

---

## Test production PWA build locally

Service workers require HTTPS or localhost + a built/served output. Use the preview profile:

```bash
docker compose --profile preview up
```

Opens at **http://localhost:4173**. This builds the app with `vite build`, then serves it with `vite preview`. Service workers and offline caching are active.

Alternatively with local Node:

```bash
npm run build
npm run preview
```

---

## Deploy to Cloudflare Pages

```bash
npm run build   # outputs to dist/
```

Point Cloudflare Pages at the repo:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 20 |

Access control is handled externally by **Cloudflare Access** — no auth logic is needed in the app.

---

## Project structure

```
src/
  types.ts          — shared TypeScript interfaces
  db.ts             — IndexedDB service layer (idb wrapper, no raw IDB in components)
  gameLogic.ts      — pure TypeScript game rules
  App.tsx           — tab routing
  index.css         — dark theme, no CSS framework
  components/
    SetupTab.tsx    — manage groups, teams, players
    GamesListTab.tsx — create and list games
    GameDetailTab.tsx — run a game: assign picks, enter results, advance rounds
    ReportsTab.tsx  — per-game standings and round breakdown
```

---

## Game flow

1. **Setup** — create a group, add teams to it, add players to the pool.
2. **New Game** — pick a group (its teams are used for picks), select players, choose winner/rollover mode.
3. **Game Detail**:
   - **Assign Picks** — for the open round, each active player selects a team they haven't used before. "Finalize" auto-assigns any remaining.
   - **Enter Results** — set win/loss/draw/postponed per team. All players on the same team share the result.
   - **Close Round** — eliminates losers, advances to next round (or triggers rollover/game-over).
4. **Reports** — full standings, W/L/D/P per player, round-by-round team breakdown.

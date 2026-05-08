# LMS PWA — Complete UI Revamp (Frosted & Electric)

## Context

The app currently uses a dark forest-green/gold theme with a top-header tab navigation and a desktop-first layout (max-width 1100px). The design spec "Frosted & Electric" calls for a near-black background with indigo + emerald accents, a fixed bottom navigation bar, a mobile-first 430px layout, frosted glass cards, decorative blobs, and Inter web fonts. This plan replaces the full look and feel while preserving all existing functionality and data flows.

---

## Files to change

| File | Change |
|---|---|
| `package.json` | Add Tailwind v3, PostCSS, Autoprefixer |
| `tailwind.config.js` | Create — content paths + custom colours/fonts |
| `postcss.config.js` | Create — standard Tailwind PostCSS config |
| `index.html` | Fonts, Tabler Icons, viewport-fit=cover, theme-color, apple-touch-icon |
| `src/index.css` | Full rewrite — new tokens, Tailwind directives, all components |
| `src/App.tsx` | New layout: blobs + new header + bottom nav |
| `vite.config.ts` | Update theme_color + background_color, add apple-touch-icon to manifest |
| `public/icons/pwa-192x192.svg` | Redesign — near-black + indigo/emerald blobs + LMS text |
| `public/icons/pwa-512x512.svg` | Redesign — same, scaled |
| `public/icons/apple-touch-icon.svg` | Create — 180×180, edge-to-edge (no rounded corners, iOS masks automatically) |
| `src/components/GamesListTab.tsx` | Table → card list, new badges |
| `src/components/GameDetailTab.tsx` | Styling updates (inline styles → new tokens) |
| `src/components/ReportsTab.tsx` | Styling updates |
| `src/components/SetupTab.tsx` | Styling updates |
| `src/components/ToolsTab.tsx` | Styling updates |
| `src/components/auth/LoginPage.tsx` | Auth card updated |
| `src/components/auth/RegisterPage.tsx` | Auth card updated |
| `src/components/auth/SetupPage.tsx` | Auth card updated |

---

## Step 1 — Install Tailwind v3

```bash
npm install -D tailwindcss@^3 postcss autoprefixer
npx tailwindcss init -p
```

Creates `tailwind.config.js` and `postcss.config.js`.

---

## Step 2 — tailwind.config.js

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        indigo: { DEFAULT: '#818cf8', hover: '#6d79f5', dim: 'rgba(129,140,248,0.18)' },
        emerald: { DEFAULT: '#34d399', dim: 'rgba(52,211,153,0.12)' },
      },
      fontFamily: {
        sans: ['Inter', 'Atkinson Hyperlegible', 'system-ui', 'sans-serif'],
      },
      maxWidth: { app: '430px' },
    },
  },
  plugins: [],
}
```

---

## Step 3 — index.html

Add to `<head>`:
- Google Fonts: Inter (400,500,600,700,800) + Atkinson Hyperlegible (400,700)
- Tabler Icons webfont CDN
- Update `<meta name="viewport">` → add `viewport-fit=cover`
- Update `<meta name="theme-color">` → `#818cf8`
- Update `<meta name="apple-mobile-web-app-status-bar-style">` → `black-translucent` (already set)

---

## Step 4 — src/index.css (full rewrite)

Structure:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* 1. CSS custom properties (spec §3) */
:root { /* all tokens from spec */ }

/* 2. Base reset + body */

/* 3. @layer components — semantic classes using @apply */
/*    .card, .btn-primary, .btn-ghost, .btn-destructive */
/*    .badge (+ modifiers), .pill, .pill--active          */
/*    .field-label, .section-label                        */
/*    .bottom-nav, .nav-item, .nav-item--active           */
/*    .auth-page, .auth-card                              */
/*    .offline-banner                                     */
/*    .blob, .blob-indigo, .blob-emerald                  */
/*    .row--eliminated, .result-btn (+ active variants)  */
/*    .spinner                                            */
/*    .card-icon (+ --live, --done, --out modifiers)      */
/*    Entrance animations (card-in, fade-in, pulse)       */

/* 4. Retained utilities needed by existing JSX */
/*    .text-muted, .text-success, .text-danger, etc.     */
/*    .mt-4 through .mt-24, .flex, .gap-* etc.           */
/*    .table-wrap, table, th, td styles                  */
/*    .form-row, .form-group, .checkbox-row              */
/*    .empty-state, .section-header, .section-title      */
```

Key token changes from current to spec:
- `--bg: #0b1d13` → `--bg-base: #141414`
- `--surface: #112518` → `--bg-surface: rgba(255,255,255,0.06)`
- `--accent: #f0c030` → removed; replaced by `--indigo` + `--emerald`
- `--border: #274035` → `--border-default: rgba(255,255,255,0.09)`
- `--text-muted: #78987f` → `--text-secondary: rgba(255,255,255,0.45)`
- Add new: `--blob-indigo`, `--blob-emerald`, `--border-strong`, `--border-focus`, all radius tokens

---

## Step 5 — App.tsx restructure

### New layout skeleton

```tsx
<div style={{ background: 'var(--bg-base)', minHeight: '100dvh', position: 'relative' }}>
  {/* Decorative blobs */}
  <div className="blob blob-indigo" aria-hidden="true" />
  <div className="blob blob-emerald" aria-hidden="true" />

  {/* All content: z-index 1 */}
  <div style={{ position: 'relative', zIndex: 1, maxWidth: '430px', margin: '0 auto', minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>

    {/* Top bar (spec §7.1) */}
    <header>
      <span className="app-logo">Last<span style={{color:'var(--indigo)'}}>Man</span></span>
      {/* right: view toggle + sign out (ghost pills) + avatar */}
    </header>

    {/* Offline banner */}
    {(!isOnline || updateAvailable) && <div className="offline-banner">…</div>}

    {/* Page content — padding-bottom 80px for bottom nav */}
    <main style={{ flex: 1, overflowY: 'auto', paddingBottom: 80 }}>
      {/* tab content */}
    </main>

    {/* Bottom nav (spec §7.8) */}
    <nav className="bottom-nav" role="navigation" aria-label="Main navigation">
      {navItems.map(item => (
        <button key={item.id} className={`nav-item ${activeTab === item.id ? 'nav-item--active' : ''}`}
          aria-current={activeTab === item.id ? 'page' : undefined}
          onClick={() => setActiveTab(item.id)}>
          <i className={item.icon} aria-hidden="true" />
          {item.label}
        </button>
      ))}
    </nav>
  </div>
</div>
```

### Nav items (icons from Tabler Icons)
```ts
const navItems = [
  { id: 'games',   label: 'Games',   icon: 'ti ti-layout-grid' },
  { id: 'reports', label: 'Reports', icon: 'ti ti-chart-bar',   managerOnly: true },
  { id: 'setup',   label: 'Setup',   icon: 'ti ti-settings',    managerOnly: true },
  { id: 'tools',   label: 'Tools',   icon: 'ti ti-tool',        managerOnly: true },
]
```

### Tab type update
- Keep `Tab = 'setup' | 'games' | 'game-detail' | 'reports' | 'tools'`
- `game-detail` remains a sub-view of Games; Games nav item stays active when `activeTab === 'game-detail'`
- Remove the top `app-nav` element entirely
- SettingsPanel moves to within header (positioned relative to the avatar button)

### Avatar
Replace the gear icon + "Sign out" in header with:
- Initials avatar circle (30×30px, `background: rgba(255,255,255,0.09)`, white 11px/700 initials)
- Avatar click → settings dropdown (push notifications + sign out)
- Manager only: "Player view" ghost pill visible in header right

---

## Step 6 — GamesListTab.tsx

Change the games table to a card list (spec §7.3 frosted card pattern):

```tsx
{games.map(game => (
  <div key={game.id} className="card" onClick={() => onSelectGame(game.id)}>
    <div className={`card-icon card-icon--${game.status === 'active' ? 'live' : 'done'}`}>
      <i className={game.status === 'active' ? 'ti ti-flame' : 'ti ti-check'} aria-hidden="true" />
    </div>
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{game.name}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
        {game.groupName} · Round {game.currentRound}
      </div>
    </div>
    <span className={`badge badge-${game.status}`}>
      <i className="ti ti-check" aria-hidden="true" />
      <span className="sr-only">Status: </span>{game.status}
    </span>
  </div>
))}
```

Update badge class usage to match spec (icon+colour+border). Update inline styles referencing old `--accent`, `--surface`, `--card` tokens to new tokens.

---

## Step 7 — Other components

For each of GameDetailTab, ReportsTab, SetupTab, ToolsTab, and auth pages:
- Replace `var(--accent)` references → `var(--indigo)`
- Replace `var(--surface)`, `var(--card)` → `var(--bg-surface)`
- Replace `var(--border)` → `var(--border-default)`
- Replace `var(--text-muted)` → `var(--text-secondary)`
- Replace `var(--bg)` → `var(--bg-base)`
- Update `.badge-active/completed/open/closed` class names to match new spec badge modifiers
- The CSS classes themselves are redefined in index.css, so purely class-based styling auto-updates
- Only inline `style={}` props referencing old variables need JSX edits

---

## Step 8 — vite.config.ts

Update PWA manifest:
- `theme_color: '#818cf8'`
- `background_color: '#141414'`

---

## Step 9 — PWA Icons

### Design: "LMS text + indigo/emerald blobs"
All three icons share the same aesthetic — near-black background, indigo blob top-left, emerald blob bottom-right, bold white "LMS" text, indigo underline bar.

**`public/icons/pwa-192x192.svg`** (replace):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="32" fill="#141414"/>
  <circle cx="20" cy="20" r="70" fill="rgba(129,140,248,0.22)"/>
  <circle cx="172" cy="172" r="55" fill="rgba(52,211,153,0.16)"/>
  <text x="96" y="110" font-family="'Inter',system-ui,sans-serif" font-size="64"
        font-weight="800" text-anchor="middle" fill="#ffffff" letter-spacing="-2">LMS</text>
  <rect x="56" y="122" width="80" height="6" rx="3" fill="#818cf8"/>
</svg>
```

**`public/icons/pwa-512x512.svg`** (replace):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="86" fill="#141414"/>
  <circle cx="54" cy="54" r="186" fill="rgba(129,140,248,0.22)"/>
  <circle cx="458" cy="458" r="147" fill="rgba(52,211,153,0.16)"/>
  <text x="256" y="294" font-family="'Inter',system-ui,sans-serif" font-size="170"
        font-weight="800" text-anchor="middle" fill="#ffffff" letter-spacing="-5">LMS</text>
  <rect x="150" y="326" width="212" height="16" rx="8" fill="#818cf8"/>
</svg>
```

**`public/icons/apple-touch-icon.svg`** (create — 180×180, no rx, iOS applies mask):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
  <rect width="180" height="180" fill="#141414"/>
  <circle cx="18" cy="18" r="65" fill="rgba(129,140,248,0.22)"/>
  <circle cx="162" cy="162" r="52" fill="rgba(52,211,153,0.16)"/>
  <text x="90" y="103" font-family="'Inter',system-ui,sans-serif" font-size="60"
        font-weight="800" text-anchor="middle" fill="#ffffff" letter-spacing="-2">LMS</text>
  <rect x="52" y="115" width="76" height="6" rx="3" fill="#818cf8"/>
</svg>
```

### index.html addition
Add inside `<head>` (alongside the existing `<link rel="icon">`):
```html
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.svg">
```

### vite.config.ts manifest addition
Add to the `icons` array:
```js
{ src: 'icons/apple-touch-icon.svg', sizes: '180x180', type: 'image/svg+xml' }
```

> **Note:** SVG works on iOS 15+ Safari. If older iOS support is needed in future, generate a PNG from the SVG using a build script and reference that instead.

---

## Verification

1. `npm run dev` — app loads, no console errors
2. Visual checks:
   - Background is near-black `#141414` with two soft colour blobs visible
   - Bottom nav present with 4 items (or 1 in player view); active item is indigo
   - Logo reads "Last" (white) + "Man" (indigo)
   - Cards are frosted glass (semi-transparent with border)
   - Games list shows card rows not a table
   - Status badges have icon + colour + border
   - Buttons: primary is indigo fill, ghost is border-only
3. Mobile emulation (430px): layout fits, bottom nav safe-area aware, no content hidden behind nav
4. Player view: only Games tab visible in bottom nav
5. Auth pages (Login, Register, Setup): dark frosted card centred, Inter font rendered
6. Focus states visible (indigo ring) on all interactive elements
7. `npm run build` — no TS errors, build succeeds

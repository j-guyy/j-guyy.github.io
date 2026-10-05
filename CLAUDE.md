# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal portfolio and adventure/travel blog for Justin Guyette, hosted on GitHub Pages at `j-guyy.github.io`. The site tracks and visualizes outdoor adventures (mountaineering, ultrarunning, triathlon), US/world travel, and road trips through interactive maps and dashboards.

## Development Workflow

**No build process** — this is a plain static site with no npm, bundler, or compilation step. Edit files and push to deploy. (The only npm usage is the Capacitor Android shell — see "Android App" below — which does not affect the website.)

**Local development**: Open HTML files directly in a browser, or serve with any static file server:
```bash
python -m http.server 8000
# or
npx serve .
```

**Deployment**: Pushing to `main` auto-deploys via GitHub Pages.

**Tests**: only `/game/` has any (`game/tests/`, see its README). They need nothing installed — the unit layer imports the game's own modules under Node and runs in about a second; the browser layer drives the real page in Chromium and skips itself if Playwright is absent. Run them after touching anything under `/game/`:
```bash
cd game && npm run test:unit          # rules + data, ~1s
cd game && node --test "tests/*.test.mjs"   # everything, ~35s
```
`game/package.json` exists only to mark `game/js/**/*.js` as ES modules so Node can import them; there is still no build step. CI runs both layers on changes to `/game/` (`.github/workflows/game-tests.yml`).

**Cloudflare Worker**: The backend API lives in `worker.js` (ES module format), configured by `wrangler.toml` (name `strava-worker`, both KV bindings, the D1 binding). Bindings: `STRAVA_DATA` (KV), `STRAVA_KV` (KV), `MUSIC_DB` (D1); secrets `CLIENT_ID`, `CLIENT_SECRET`, `TRAVEL_PASSWORD` live in Cloudflare and survive deploys (never commit them). `MUSIC_SYNC_TOKEN` is the exception: the deploy workflow uploads it from the repository secret of the same name, so it is set in GitHub only.
- **Automatic deploy**: pushing a change to `worker.js` / `wrangler.toml` on `main` runs `.github/workflows/deploy-worker.yml`, which deploys with `cloudflare/wrangler-action`. Pull requests touching them only run a validation (`node --check` + `wrangler deploy --dry-run`); the deploy job never runs for PRs or forks.
- **One-time setup (owner)**: create a Cloudflare API token from the "Edit Cloudflare Workers" template, then add repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Settings → Secrets and variables → Actions). Never paste the token into chat or commit it. Fill the KV namespace and D1 database ids in `wrangler.toml` (the workflow refuses to deploy while `REPLACE_WITH_*` placeholders remain).
- **Keep `wrangler.toml` complete**: a wrangler deploy *replaces* bindings, cron triggers, routes and plain-text variables with what the config lists, so anything in the dashboard (Settings → Bindings / Triggers / Variables) must also be in the file.
- **Manual fallback**: paste `worker.js` into the dashboard editor (Workers & Pages → strava-worker → Edit code → Deploy). Note `npx wrangler deploy worker.js` on its own is *not* safe — without `wrangler.toml` it deploys without the KV bindings; use `npx wrangler deploy` from the repo root so the config is picked up.
- **Verify a deploy**: run the workflow manually (Actions → Deploy Worker → Run workflow) for the first automated deploy, then open `https://strava-worker.justinguyette.workers.dev/summary` and check it returns JSON.

**Android App (Capacitor remote shell)**: `/app/index.html` + `js/app.js` + `css/app.css` are a phone-optimized shell around the Strava page — every feature (dashboard, activity map, all hunters, and the StatsHunters embed) gets its own hash-routed screen (`#home`, `#county`, `#tiles`, …) reusing `js/strava.js` unmodified. Logic and UI are split along that line: `strava.js` owns all logic and renders shared components (`.section`, `.travel-table`, `.county-stats-bar`, `.filter-pill`, …) into the same mount-point element ids on both pages; `css/app.css` is the app's own design system (tokens + a reskin of every shared component, all scoped to `.app-page`), so the app's look can change freely without touching `strava.js`, and website styles are unaffected. Navigation: the bottom bar is Home · Dashboard · County · Metro · Map — the two most-opened hunters get their own tabs, every other hunter is a Home card, and StatsHunters is a Home card plus the last map layer (not a tab). A route is the hash text: a screen (`#county`) or a screen as a map layer (`#map` = Activity Map, `#map/county`, …). The Map tab is a layer switcher — a scrolling pill row built from `MAP_LAYERS` in `js/app.js` — that reuses each hunter's own screen in *map mode* (`body.app-map-mode`: the switcher replaces the app bar, mount points tagged `.app-detail` and the stat tiles are hidden while a hunter's map controls stay, and the map is sized by the screen's `--map-chrome`); it reopens the last layer viewed (`localStorage` `app_map_layer`) and a details icon jumps from a layer to its hunter's stats and tables. When adding a hunter, add it to `MAP_LAYERS`, tag its table mount points `.app-detail`, and set `--map-chrome` if it keeps controls around the map. Tab and layer switches replace rather than push history, so back stays one level deep. The APK (`/android`, `capacitor.config.json`, `package.json`) is a thin Capacitor WebView that loads `https://j-guyy.github.io/app/` remotely — site pushes update the app instantly with no rebuild. Rebuild the APK (only needed when `/android` or Capacitor config changes) via the manually-triggerable `.github/workflows/android.yml`, which uploads `app-debug.apk` as an artifact for sideloading. Debug APKs are signed with a per-run key: uninstall the old app before installing a new APK.

**Song leaderboard (`music.html`, unlinked test page)**: `scripts/ytmusic/sync_history.py` reads YouTube Music history via `ytmusicapi` `get_history()` and posts new plays to the worker, which stores them in the `MUSIC_DB` D1 (SQLite) database; `.github/workflows/ytmusic-sync.yml` runs it daily, and `js/music.js` renders the worker's `/music/leaderboard` (a SQL `GROUP BY` over plays). `get_history()` has no timestamps (only "Today"/"Yesterday"/… labels), lists each song once, and covers only the last ~200 songs, so plays are found by diffing against the previous run's snapshot (kept in D1, served by `/music/state`), not by copying the list (logic + tests in `scripts/ytmusic/`; `python3 -m unittest scripts/ytmusic/test_sync_history.py`). Auth is browser-header auth stored only in the `YTMUSIC_AUTH` Actions secret — either a `browse` request pasted as copied from DevTools — Chrome's "Copy as cURL (bash)" or the raw request headers (the sync converts both) or the JSON from the optional `scripts/ytmusic/setup_auth.py` — never commit `browser.json`. Writes need `MUSIC_SYNC_TOKEN`, set only as an Actions secret (the worker deploy uploads it to Cloudflare).

## Architecture

### Core Patterns

- **Vanilla JS + HTML Web Components** — no frameworks. The `<nav-bar>` element (`js/navbar-component.js`) is a custom element used on every page.
- **JSON-driven data** — adventure/travel/geographic content lives in `/data/*.json` and is fetched client-side with the Fetch API.
- **Cloudflare KV-backed API** — Strava activity data, geocoding cache, hunter feature state, and travel tracking are all persisted in Cloudflare Workers KV via `worker.js`.
- **Page-scoped JS files** — each major page has a corresponding JS file (e.g., `us-dashboard.html` → `js/dashboard.js`). Logic is typically wrapped in a class or IIFE loaded on `DOMContentLoaded`.

### Data Flow

- **Static pages**: HTML → `DOMContentLoaded` → fetch JSON from `/data/` → render into DOM → attach event listeners.
- **Strava page**: HTML → `DOMContentLoaded` → fetch activities + geo cache from Cloudflare Worker → render immediately → background sync with Strava API if cooldown expired → background geocoding of missing cells → background Mountain Hunter processing.

### Key Libraries (CDN-loaded, no npm)

- **Leaflet.js** `1.9.4` — interactive 2D maps (US map, world map, trip report maps, hunter maps). Still the current stable release; 2.0 is ESM-only with no global `L`, so it is not adoptable without a build step. Plugins: `leaflet.fullscreen@5.3.3` (exports `L.Control.FullScreen`, fires `enterFullscreen`/`exitFullscreen`, and has no `map.isFullscreen()`), `leaflet-gesture-handling@1.2.2`, `leaflet-draw@1.0.4`. **Pin every CDN URL to an exact version** — an unpinned unpkg URL silently follows upstream releases.
- **CARTO raster basemaps** (`dark_all` / `light_all` on `basemaps.cartocdn.com`) — CARTO now watermarks keyless tiles with "API KEY REQUIRED", so every CARTO tile URL carries `?key=`. It is a public browser-side tile key (like Thunderforest's `TF_KEY`), defined as `CARTO_KEY` in `setupStravaBasemaps()` (`js/strava.js`, which also serves `/app/`) and again in `js/us-ecoregions.js` — rotate it in both places. Attribution to OSM + CARTO must stay on the layers.
- **Cesium.js v1.124** — 3D globe on `about.html` (life journey visualization)
- **Google `<model-viewer>`** — 3D GLB model display on trip reports (e.g., Pico de Orizaba)

### CSS Architecture

Component-based CSS files in `/css/` using CSS custom properties for theming (primary green: `#4CAF50`). Base styles: `base.css`, `layout.css`, `responsive.css`. Page-specific files follow the naming convention of their HTML counterpart.

- `dashboard.css` — shared table styling (`.travel-table`, `.table-scroll-wrapper`, sortable headers) used by both travel dashboards and strava page
- `strava.css` — strava-page-specific styles, loaded after `dashboard.css`
- Site-wide design tokens (surfaces, borders, text sizes) live in `:root` in `base.css`, modelled on the app's `--app-*` tokens in `app.css`; prefer them over hard-coded colours.
- The window scrolls the page — `html`/`body` use `min-height`, and horizontal overflow is guarded with `overflow-x: hidden` on `html` / `clip` on `body`. Don't reintroduce `height: 100%` or `overflow-x: hidden` on `body`, which turns `body` into the scroll container.

Owner-only controls (dashboard Edit Mode / Export CSV, Strava Sync/Debug, "Edit peaks") are hidden until the 🔒 login succeeds against the worker's `/auth/check`. The dashboards use `TravelAdmin` in `js/travel-api.js`; the Strava page uses the admin helpers in `js/strava.js`. Both store the password under the same localStorage key (`strava_admin_pw`), so one login covers the site. The worker still enforces the real protection.

### Content Areas

| Directory | Purpose |
|-----------|---------|
| `/data/` | JSON data files for adventures, geography, travel stats |
| `/data/admin1/` | Per-country first-level region boundaries for the Strava regional breakdown maps (generated) |
| `/trip-reports/` | Individual HTML trip report pages |
| `/images/` | Photos organized by category (`/hiking`, `/cycling`) |
| `/css/` | Stylesheets |
| `/js/` | JavaScript files |

### Main Pages

| Page | Purpose |
|------|---------|
| `strava.html` | Strava activity dashboard with 5 hunter features + StatsHunters embed |
| `us-dashboard.html` | US travel tracking (metros, highpoints, parks, states) |
| `world-dashboard.html` | World travel tracking (countries by continent) |
| `us-map.html` | Interactive US map visualization |
| `world-map.html` | Interactive world map visualization |
| `adventures.html` | Adventure portfolio and trip reports |
| `family-travels.html` | Family travel tracking |
| `about.html` | About page with 3D Cesium globe |

### Strava Page Architecture (`js/strava.js`)

The strava page is the most complex, containing 5 "hunter" modules that share a common activity data pipeline:

1. **County Hunter** — tracks US counties visited via activity polylines
2. **City Hunter** — road/way completion tracking within selected cities
3. **Tile Hunter** — z14 map tile coverage tracking with cluster/square detection
4. **Trail Hunter** — trail completion for specific regions (Boulder County, RMNP)
5. **Mountain Hunter** — peak summit detection using OSM Overpass data (peaks + volcanoes)

The dashboard's Activities / Hours toggle (`dashboardMetric`, remembered in `localStorage` `strava_dashboard_metric`) switches the summary, By Country and Regions tables between activity count and total moving time; each slim activity carries `m` (moving time in seconds) from the worker, and every bucket keeps both (`b[col]` count, `b.sec[col]` seconds) — read them through `metricValue()`. Region "visited" logic stays count-based.

Below the hunters, `SUBDIVISION_CONFIG` drives a single **Regions** section (`#regions`) covering every country with first-level regions worth tracking (US states, Canadian provinces, Australian states, Mexican states, Chinese provinces, Spanish regions, Italian regions). A country picker (one pill per country with activities, showing its visited-region count; defaults to the busiest country) swaps which country's stats bar, map (visited regions filled green) and sortable activity table is shown; the map + table sit behind the section's "Show map" toggle. Boundaries come from `/data/admin1/<config id>.geojson` and are fetched per country the first time its map is shown. A region counts as visited when the geocoded subdivision name of an activity matches one of the aliases baked into its polygon; a name the aliases don't cover is resolved geometrically instead (point-in-polygon on an activity recorded under it), so a new spelling from Nominatim self-heals rather than leaving a hole. Regenerate the boundary files with `python3 scripts/build-admin1-regions.py` (needs `shapely`); adding a country means adding an entry to both `SUBDIVISION_CONFIG` and the script's `COUNTRIES`.

Last on the page is the **StatsHunters** section — the shared StatsHunters map (`https://statshunters.com/share/…`) in the same collapsible frame as the hunters. `toggleStatshunters()` sets the iframe `src` on first open, so the external embed costs nothing on load; `statshuntersFullscreen()` fullscreens the wrapper. `strava.html#statshunters` opens and scrolls to it (the old standalone `statshunters.html` is now just a redirect to that anchor).

Near the top of strava.html, an **overview grid** (`#strava-overview`, website only) has one card per section with its headline stat from `/summary`. `HUNTER_SECTIONS` in strava.js lists the sections, keyed by the same names as the app routes; every section has that id, so `strava.html#county`, `#tile`, `#regions`, `#statshunters`, … (and clicking a card) scroll to the section and open it through its existing toggle, never toggling an already-open one.

**Owner-only controls**: the admin login (🔒 in the controls bar, `isLoggedIn()`) gates Sync/Debug and every element with class `admin-only` (start them `hidden`; `applyAdminVisibility()` shows them after login and hides them on logout), e.g. Mountain Hunter's "Edit peaks" on both strava.html and the app.

**Shared infrastructure**:
- Polyline cache (`polylineCache`) — decoded once, reused by all hunters
- Activity pipeline (`runPipeline`) — loads activities, renders immediately, syncs in background
- Geocoding (`geocodeAndRender`) — renders with cached data first, geocodes missing cells in background
- All tables use `.travel-table` class with sortable headers and `.table-scroll-wrapper` for mobile

### Cloudflare Worker API (`worker.js`)

Base URL: `https://strava-worker.justinguyette.workers.dev`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/activities/all` | GET | Get all cached slim activities |
| `/activities/sync` | POST | Incremental sync from Strava API |
| `/activities/rebuild` | POST | Full re-sync (deletes + syncs) |
| `/activities/backfill-elev` | POST | Backfill ride high points (`elev_high`) one batch at a time via detail calls |
| `/geo/all`, `/geo/save`, `/geo/reset` | GET/POST | Geocoding cache |
| `/counties/all`, `/counties/save` | GET/POST | County Hunter state |
| `/tiles/all`, `/tiles/save` | GET/POST | Tile Hunter state |
| `/peaks/all`, `/peaks/save`, `/peaks/reset` | GET/POST | Mountain peak cell cache |
| `/summits/all`, `/summits/save`, `/summits/reset` | GET/POST | Summit detection cache |
| `/progress/all`, `/progress/save`, `/progress/reset` | GET/POST | City / Trail Hunter completion headline (per city / trail region: complete, partial, total, node-coverage %), saved by the page once it has computed coverage from Overpass / COTrex; `/progress/save` is validated + merged per key, `/reset` is admin-only |
| `/summary` | GET | Headline number per hunter (counties, parks, metros, tiles + max cluster/square, peaks, passes, activity total) derived at read time from the blobs above (tile max-cluster/square arrive precomputed with each `/tiles/save`, in `strava_tile_stats`, and are only computed at read time for tile data saved before that; city/trail come from `/progress/save`); feeds the app home grid and the strava.html overview. Clients fall back to `/counties/all` while an older worker without it is deployed |
| `/travel/*` | GET/POST | Travel dashboard data (toggle, seed) |
| `/music/leaderboard` | GET | Song play counts from D1 (`?limit=`, max 500) |
| `/music/state`, `/music/plays` | GET/POST | YouTube Music sync: last snapshot, and new plays (`X-Music-Token`) |

### Adding Content

- **New adventure category**: Add entries to `data/adventures.js`, create trip report HTML in `/trip-reports/`
- **New map data**: Add JSON to `/data/`, fetch and render in the relevant JS file
- **New page**: Create HTML file at root, link `js/navbar-component.js` and use `<nav-bar>` element, add corresponding CSS/JS files as needed
- **New hunter feature**: Add section to `strava.html`, implement in `js/strava.js`, add KV key + endpoints to `worker.js`; give the section an `id`, add it to `HUNTER_SECTIONS` (overview card + deep link) and, if it has a cheap headline number, derive it in the worker's `/summary` and `hunterStatText()`
- **New country regional breakdown**: Add an entry to `SUBDIVISION_CONFIG` in `js/strava.js` and to `COUNTRIES` in `scripts/build-admin1-regions.py`, then re-run that script to emit `/data/admin1/<id>.geojson`

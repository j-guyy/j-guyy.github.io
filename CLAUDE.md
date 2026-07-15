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

**Cloudflare Worker**: The backend API lives in `worker.js` (ES module format). Deploy with `npx wrangler deploy worker.js`. Secrets/bindings: `STRAVA_DATA` (KV), `STRAVA_KV` (KV), `CLIENT_ID`, `CLIENT_SECRET`, `TRAVEL_PASSWORD`.

**Android App (Capacitor remote shell)**: `/app/index.html` + `js/app.js` + `css/app.css` are a phone-optimized shell around the Strava page — every feature (dashboard, activity map, and all hunters) gets its own hash-routed screen (`#home`, `#county`, `#tiles`, …) reusing `js/strava.js` unmodified. The APK (`/android`, `capacitor.config.json`, `package.json`) is a thin Capacitor WebView that loads `https://j-guyy.github.io/app/` remotely — site pushes update the app instantly with no rebuild. Rebuild the APK (only needed when `/android` or Capacitor config changes) via the manually-triggerable `.github/workflows/android.yml`, which uploads `app-debug.apk` as an artifact for sideloading. Debug APKs are signed with a per-run key: uninstall the old app before installing a new APK.

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

- **Leaflet.js** — interactive 2D maps (US map, world map, trip report maps, hunter maps)
- **Cesium.js v1.124** — 3D globe on `about.html` (life journey visualization)
- **Google `<model-viewer>`** — 3D GLB model display on trip reports (e.g., Pico de Orizaba)

### CSS Architecture

Component-based CSS files in `/css/` using CSS custom properties for theming (primary green: `#4CAF50`). Base styles: `base.css`, `layout.css`, `responsive.css`. Page-specific files follow the naming convention of their HTML counterpart.

- `dashboard.css` — shared table styling (`.travel-table`, `.table-scroll-wrapper`, sortable headers) used by both travel dashboards and strava page
- `strava.css` — strava-page-specific styles, loaded after `dashboard.css`

### Content Areas

| Directory | Purpose |
|-----------|---------|
| `/data/` | JSON data files for adventures, geography, travel stats |
| `/trip-reports/` | Individual HTML trip report pages |
| `/images/` | Photos organized by category (`/hiking`, `/cycling`) |
| `/css/` | Stylesheets |
| `/js/` | JavaScript files |

### Main Pages

| Page | Purpose |
|------|---------|
| `strava.html` | Strava activity dashboard with 5 hunter features |
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
| `/travel/*` | GET/POST | Travel dashboard data (toggle, seed) |

### Adding Content

- **New adventure category**: Add entries to `data/adventures.js`, create trip report HTML in `/trip-reports/`
- **New map data**: Add JSON to `/data/`, fetch and render in the relevant JS file
- **New page**: Create HTML file at root, link `js/navbar-component.js` and use `<nav-bar>` element, add corresponding CSS/JS files as needed
- **New hunter feature**: Add section to `strava.html`, implement in `js/strava.js`, add KV key + endpoints to `worker.js`

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Personal portfolio and adventure/travel blog for Justin Guyette, hosted on GitHub Pages at `j-guyy.github.io`. The site tracks and visualizes outdoor adventures (mountaineering, ultrarunning, triathlon), US/world travel, and road trips through interactive maps and dashboards.

## Development Workflow

**No build process** — this is a plain static site with no npm, bundler, or compilation step. Edit files and push to deploy.

**Local development**: Open HTML files directly in a browser, or serve with any static file server:
```bash
python -m http.server 8000
# or
npx serve .
```

**Deployment**: Pushing to `main` auto-deploys via GitHub Pages.

## Architecture

### Core Patterns

- **Vanilla JS + HTML Web Components** — no frameworks. The `<nav-bar>` element (`js/navbar-component.js`) is a custom element used on every page.
- **JSON-driven data** — all adventure/travel/geographic content lives in `/data/*.json` and is fetched client-side with the Fetch API.
- **Page-scoped JS files** — each major page has a corresponding JS file (e.g., `us-dashboard.html` → `js/dashboard.js`). Logic is typically wrapped in a class or IIFE loaded on `DOMContentLoaded`.

### Data Flow

HTML page → `DOMContentLoaded` → fetch JSON from `/data/` → render into DOM → attach event listeners.

### Key Libraries (CDN-loaded, no npm)

- **Leaflet.js** — interactive 2D maps (US map, world map, trip report maps)
- **Cesium.js v1.124** — 3D globe on `about.html` (life journey visualization)
- **Google `<model-viewer>`** — 3D GLB model display on trip reports (e.g., Pico de Orizaba)

### CSS Architecture

Component-based CSS files in `/css/` using CSS custom properties for theming (primary green: `#4CAF50`). Base styles: `base.css`, `layout.css`, `responsive.css`. Page-specific files follow the naming convention of their HTML counterpart.

### Content Areas

| Directory | Purpose |
|-----------|---------|
| `/data/` | JSON data files for adventures, geography, travel stats |
| `/trip-reports/` | Individual HTML trip report pages (18 pages) |
| `/images/` | Photos organized by category (`/hiking`, `/cycling`) |
| `/css/` | Stylesheets |
| `/js/` | JavaScript files |

### Adding Content

- **New adventure category**: Add entries to `data/adventures.js`, create trip report HTML in `/trip-reports/`
- **New map data**: Add JSON to `/data/`, fetch and render in the relevant JS file
- **New page**: Create HTML file at root, link `js/navbar-component.js` and use `<nav-bar>` element, add corresponding CSS/JS files as needed

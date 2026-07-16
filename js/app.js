// App shell router for /app/ — the Android (Capacitor) wrapper page.
//
// strava.js runs unmodified underneath: it fetches the activity pipeline and
// renders into the same element ids used on strava.html. This file only
// decides which screen wrapper is visible, drives Android-style navigation
// via hash history, and fires each feature's existing lazy-init toggle the
// first time its screen is opened.

// Screens whose inner map section starts display:none get an `open` hook that
// calls the existing strava.js toggle exactly once (first entry). Mountain and
// Pass Hunter auto-init their tables after the pipeline, so they need no hook —
// their maps stay behind the same "Show map" buttons as on the website.
const SCREENS = {
    home: {},
    dashboard: {},
    map: { open: () => ensureOpen('map-section', () => toggleMap()) },
    county: { open: () => ensureOpen('county-section', () => toggleCountyMap()) },
    park: { open: () => ensureOpen('park-section', () => toggleParkMap()) },
    metro: { open: () => ensureOpen('metro-section', () => toggleMetroMap()) },
    tile: { open: () => ensureOpen('tile-section', () => toggleTileMap()) },
    city: { open: () => ensureOpen('city-section', () => toggleCityMap()) },
    mountain: {},
    pass: {},
    trail: { open: () => ensureOpen('trail-section', () => toggleTrailMap()) },
};

// Open a feature's inner section via its existing toggle, but only if it is
// still closed (the toggles flip open/closed, so calling again would hide it).
// The hunters need activity data; if the pipeline hasn't delivered yet, wait
// for it rather than initializing against an empty list.
let pendingOpen = null;
function ensureOpen(sectionId, toggleFn) {
    const section = document.getElementById(sectionId);
    if (!section || section.style.display !== 'none') return;

    if (currentSlim.length === 0) {
        pendingOpen = { sectionId, toggleFn };
        if (!ensureOpen._timer) {
            ensureOpen._timer = setInterval(() => {
                if (currentSlim.length === 0) return;
                clearInterval(ensureOpen._timer);
                ensureOpen._timer = null;
                const p = pendingOpen;
                pendingOpen = null;
                if (p) ensureOpen(p.sectionId, p.toggleFn);
            }, 300);
        }
        return;
    }
    toggleFn();
}

function currentScreenName() {
    const name = location.hash.replace(/^#/, '');
    return SCREENS[name] ? name : 'home';
}

function showScreen(name) {
    document.querySelectorAll('.app-screen').forEach(el => {
        el.hidden = true;
        el.classList.remove('screen-enter');
    });
    const target = document.getElementById(`screen-${name}`) || document.getElementById('screen-home');
    target.hidden = false;
    void target.offsetWidth; // restart the enter animation even on repeat visits
    target.classList.add('screen-enter');
    window.scrollTo(0, 0);
    pendingOpen = null; // navigating away cancels a queued auto-open
    SCREENS[name]?.open?.();
    // Any Leaflet map created or resized while its screen was hidden has a
    // stale size; Leaflet's trackResize listens on window resize.
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
}

window.addEventListener('hashchange', () => showScreen(currentScreenName()));

document.addEventListener('DOMContentLoaded', () => {
    if (!location.hash) history.replaceState(null, '', '#home');
    showScreen(currentScreenName());
    pollHomeStats();
});

// ── Home grid quick stats ────────────────────────────────────────────────────
function pollHomeStats() {
    const timer = setInterval(() => {
        if (typeof currentTotal === 'undefined' || currentTotal === 0) return;
        clearInterval(timer);
        const status = document.getElementById('home-status');
        if (status) status.textContent = '';
        setStat('stat-dashboard', `${currentTotal.toLocaleString()} activities`);
        setStat('stat-map', `${currentSlim.length.toLocaleString()} with GPS`);
    }, 400);

    // County count is one small worker read; the other hunters' state would
    // need multi-MB geojson to summarize, so their cards stay stat-less.
    fetch(`${WORKER_URL}/counties/all`)
        .then(r => r.json())
        .then(data => {
            const n = (data.fips || []).length;
            if (n > 0) setStat('stat-county', `${n.toLocaleString()} counties`);
        })
        .catch(() => {});
}

function setStat(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

// ── Android back button (Capacitor only) ────────────────────────────────────
// Registering a backButton listener disables Capacitor's default behavior, so
// both branches are handled here: back out of a feature screen to home, and
// exit the app from home. In a plain browser window.Capacitor is undefined and
// the browser's own back button drives hashchange instead.
const CapApp = window.Capacitor?.Plugins?.App;
if (CapApp?.addListener) {
    CapApp.addListener('backButton', () => {
        if (currentScreenName() !== 'home') history.back();
        else CapApp.exitApp();
    });
}

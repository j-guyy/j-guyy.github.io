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
    // StatsHunters is an external embed, so it needs no activity data and opens
    // straight away rather than waiting on the pipeline.
    statshunters: { open: () => openSection('statshunters-section', () => toggleStatshunters()) },
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
    openSection(sectionId, toggleFn);
}

// Fire a feature's toggle only while its section is still closed — the toggles
// flip open/closed, so calling one again would hide what we just revealed.
function openSection(sectionId, toggleFn) {
    const section = document.getElementById(sectionId);
    if (!section || section.style.display !== 'none') return;
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
    updateTabs(name);
    // Any Leaflet map created or resized while its screen was hidden has a
    // stale size; Leaflet's trackResize listens on window resize.
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
}

window.addEventListener('hashchange', e => {
    stampEntry(screenFromUrl(e.oldURL));
    showScreen(currentScreenName());
});

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

// ── Bottom tab bar ──────────────────────────────────────────────────────────
// Tabs are top-level destinations, so switching between them must not pile up
// hash history (the header back buttons and the Android back button both walk
// it). Each history entry is stamped with the screen it was opened from; a tab
// tap from home pushes (back returns home), a tap elsewhere replaces the
// current entry (keeping its stamp), and a tap on the screen underneath simply
// goes back. History therefore stays at most [home, screen].
const TAB_SCREENS = new Set(['home', 'dashboard', 'map', 'statshunters']);
let pendingFrom; // stamp carried across a location.replace()

function screenFromUrl(url) {
    const name = (url || '').split('#')[1] || '';
    return SCREENS[name] ? name : 'home';
}

// Record where a fresh entry came from. Entries revisited via back/forward
// already carry a state, so only brand-new ones (state null) are stamped.
function stampEntry(from) {
    if (history.state === null) {
        history.replaceState({ from: pendingFrom !== undefined ? pendingFrom : from }, '');
    }
    pendingFrom = undefined;
}

// Hunter screens live on the home grid, so they light up the Home tab.
function updateTabs(name) {
    const active = TAB_SCREENS.has(name) ? name : 'home';
    document.querySelectorAll('.app-tab').forEach(tab => {
        const on = tab.dataset.tab === active;
        tab.classList.toggle('active', on);
        if (on) tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
    });
}

function goTab(target) {
    const current = currentScreenName();
    if (target === current) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
        return;
    }
    if (current === 'home') {
        location.hash = target;
        return;
    }
    const from = history.state?.from ?? null;
    if (target === from) {
        history.back();
        return;
    }
    pendingFrom = from;
    location.replace(`#${target}`);
}

document.addEventListener('DOMContentLoaded', () => {
    // The entry the app was opened on has nothing underneath it.
    if (history.state === null) history.replaceState({ from: null }, '');
    document.querySelectorAll('.app-tab').forEach(tab => {
        tab.addEventListener('click', e => {
            e.preventDefault();
            goTab(tab.dataset.tab);
        });
    });
    updateTabs(currentScreenName());
});

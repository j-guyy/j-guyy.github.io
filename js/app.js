// App shell router for /app/ — the Android (Capacitor) wrapper page.
//
// strava.js runs unmodified underneath: it fetches the activity pipeline and
// renders into the same element ids used on strava.html. This file only
// decides which screen wrapper is visible, drives Android-style navigation
// via hash history, and fires each feature's existing lazy-init toggle the
// first time its screen is opened.

// A route is the hash without the "#": a screen name ("county") or a screen
// shown as a map layer ("map/county"; plain "map" is the Activity Map). The map
// form reuses the hunter's own screen — same DOM, same Leaflet instance — but
// css/app.css hides its tables and swaps its app bar for the layer switcher.
//
// Screens whose inner map section starts display:none get an `open` hook that
// calls the existing strava.js toggle exactly once (first entry). Mountain and
// Pass Hunter auto-init their tables after the pipeline, so on their own screens
// their maps stay behind the same "Show map" buttons as on the website; as a map
// layer the map is the point, so `openInMap` opens it once its data is ready.
const SCREENS = {
    home: {},
    travel: {},
    dashboard: {},
    map: { open: () => ensureOpen('map-section', () => toggleMap()) },
    county: { open: () => ensureOpen('county-section', () => toggleCountyMap()) },
    park: { open: () => ensureOpen('park-section', () => toggleParkMap()) },
    ecoregion: { open: () => ensureOpen('ecoregion-section', () => toggleEcoregionMap()) },
    metro: { open: () => ensureOpen('metro-section', () => toggleMetroMap()) },
    tile: { open: () => ensureOpen('tile-section', () => toggleTileMap()) },
    city: { open: () => ensureOpen('city-section', () => toggleCityMap()) },
    mountain: { openInMap: () => ensureOpen('mountain-map-section', () => toggleMountainMap(), () => mountainHunterReady) },
    pass: { openInMap: () => ensureOpen('pass-map-section', () => togglePassMap(), () => passHunterReady) },
    trail: { open: () => ensureOpen('trail-section', () => toggleTrailMap()) },
    // StatsHunters is an external embed, so it needs no activity data and opens
    // straight away rather than waiting on the pipeline.
    statshunters: { open: () => openSection('statshunters-section', () => toggleStatshunters()) },
};

// Open a feature's inner section via its existing toggle, but only if it is
// still closed (the toggles flip open/closed, so calling again would hide it).
// The hunters need activity data; if the pipeline hasn't delivered yet, wait
// for it rather than initializing against an empty list. Mountain and Pass map
// layers wait for their own detection to finish (`ready`), since their toggle
// leaves the panel open but empty if it fires early.
let pendingOpen = null;
const activitiesLoaded = () => currentSlim.length > 0;

function ensureOpen(sectionId, toggleFn, ready = activitiesLoaded) {
    const section = document.getElementById(sectionId);
    if (!section || section.style.display !== 'none') return;

    if (!ready()) {
        pendingOpen = { sectionId, toggleFn, ready };
        if (!ensureOpen._timer) {
            ensureOpen._timer = setInterval(() => {
                const p = pendingOpen;
                if (p && !p.ready()) return;
                clearInterval(ensureOpen._timer);
                ensureOpen._timer = null;
                pendingOpen = null;
                if (p) ensureOpen(p.sectionId, p.toggleFn, p.ready);
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

// Every map, in the order the layer switcher lists them (Home's hunter order,
// StatsHunters last). `detail: false` layers have no stats/tables screen to
// cross-link to. The layer key is also the screen it shows.
const MAP_LAYERS = [
    { key: 'map',          label: 'Activities', detail: false },
    { key: 'county',       label: 'County' },
    { key: 'metro',        label: 'Metro' },
    { key: 'city',         label: 'City' },
    { key: 'tile',         label: 'Tile' },
    { key: 'park',         label: 'Park' },
    { key: 'ecoregion',    label: 'Ecoregion' },
    { key: 'mountain',     label: 'Mountain' },
    { key: 'pass',         label: 'Pass' },
    { key: 'trail',        label: 'Trail' },
    { key: 'statshunters', label: 'StatsHunters', detail: false },
];
const layerRoute = key => (key === 'map' ? 'map' : `map/${key}`);
const isMapRoute = route => route === 'map' || route.startsWith('map/');
const screenOf = route => (isMapRoute(route) ? route.replace(/^map\/?/, '') || 'map' : route);

// Hash text → a known route; anything unrecognised falls back to Home (or, for
// a bad map layer, the Activity Map).
function normalizeRoute(raw) {
    const route = (raw || '').replace(/^#/, '');
    if (route.startsWith('map/')) return MAP_LAYERS.some(l => l.key !== 'map' && layerRoute(l.key) === route) ? route : 'map';
    return SCREENS[route] ? route : 'home';
}

function currentRoute() {
    return normalizeRoute(location.hash);
}

// The Activity Map card reopens whichever layer was viewed last.
const LAST_LAYER_KEY = 'app_map_layer';
function lastMapRoute() {
    try {
        const key = localStorage.getItem(LAST_LAYER_KEY);
        if (MAP_LAYERS.some(l => l.key === key)) return layerRoute(key);
    } catch { /* storage unavailable — default layer */ }
    return 'map';
}

function rememberMapRoute(route) {
    try { localStorage.setItem(LAST_LAYER_KEY, screenOf(route)); } catch { /* not critical */ }
}

function showScreen(route) {
    const name = screenOf(route);
    const mapMode = isMapRoute(route);
    document.querySelectorAll('.app-screen').forEach(el => {
        el.hidden = true;
        el.classList.remove('screen-enter');
    });
    const target = document.getElementById(`screen-${name}`) || document.getElementById('screen-home');
    target.hidden = false;
    void target.offsetWidth; // restart the enter animation even on repeat visits
    target.classList.add('screen-enter');
    document.body.classList.toggle('app-map-mode', mapMode);
    updateMapSwitcher(route);
    window.scrollTo(0, 0);
    pendingOpen = null; // navigating away cancels a queued auto-open
    SCREENS[name]?.open?.();
    if (mapMode) SCREENS[name]?.openInMap?.();
    updateTabs(route);
    // Any Leaflet map created or resized while its screen was hidden has a
    // stale size; Leaflet's trackResize listens on window resize.
    setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
}

window.addEventListener('hashchange', e => {
    stampEntry(routeFromUrl(e.oldURL));
    showScreen(currentRoute());
});

document.addEventListener('DOMContentLoaded', () => {
    if (!location.hash) history.replaceState(null, '', '#home');
    buildMapSwitcher();
    showScreen(currentRoute());
    pollHomeStats();
    loadTravelStats();
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

    // Every hunter's headline number comes from one small worker read,
    // /summary, derived server-side from the hunters' saved state (shared with
    // strava.html's overview via fetchHunterSummary/hunterStatText in
    // strava.js). Until the worker is redeployed with /summary, that helper
    // falls back to the county count alone; on a network error it resolves
    // null and the cards stay as they are.
    if (typeof fetchHunterSummary !== 'function') return;
    fetchHunterSummary().then(summary => {
        if (!summary) return;
        ['tile', 'county', 'city', 'metro', 'park', 'ecoregion', 'mountain', 'pass', 'trail']
            .forEach(key => setStat(`stat-${key}`, hunterStatText(key, summary)));
        // Travel's Ecoregions card (US Travel's Ecoregions table): Level III regions seen.
        if (summary.ecoregion?.l3Total) {
            setTravelStat('ecoregions', `${summary.ecoregion.l3Visited} / ${summary.ecoregion.l3Total} seen`);
        }
        // The pipeline's own count (above) wins once it lands.
        if (typeof currentTotal === 'undefined' || currentTotal === 0) {
            setStat('stat-dashboard', hunterStatText('dashboard', summary));
        }
    });
}

// Travel & Peaks cards open full site pages; their headline numbers come from
// the same worker lists those pages read. Each is independent, so one failing
// read just leaves its card blank.
const TRAVEL_WORKER = 'https://strava-worker.justinguyette.workers.dev';
function loadTravelStats() {
    const get = path => fetch(`${TRAVEL_WORKER}/travel/${path}`).then(r => (r.ok ? r.json() : null));
    get('visited-states').then(states => {
        if (!states) return;
        const done = Object.values(states).filter(Boolean).length;
        setTravelStat('us-travel', `${done} / ${Object.keys(states).length} states`);
    }).catch(() => {});
    get('countries').then(lists => {
        if (!lists) return;
        const done = Object.values(lists).flat().filter(c => c && c.visited).length;
        setTravelStat('world-travel', `${done} countries`);
    }).catch(() => {});
    get('highpoints').then(points => {
        if (!Array.isArray(points)) return;
        const done = points.filter(p => p.visited).length;
        setTravelStat('peaks', `${done} / ${points.length} high points`);
    }).catch(() => {});
}

// Travel cards appear on both Home and the Travel tab, so they're keyed by
// data-stat rather than an id.
function setTravelStat(key, text) {
    document.querySelectorAll(`[data-stat="${key}"]`).forEach(el => { el.textContent = text; });
}

// Empty text leaves the card's existing placeholder alone.
function setStat(id, text) {
    const el = document.getElementById(id);
    if (el && text) el.textContent = text;
}

// ── Android back button (Capacitor only) ────────────────────────────────────
// Registering a backButton listener disables Capacitor's default behavior, so
// both branches are handled here: back out of a feature screen to home, and
// exit the app from home. In a plain browser window.Capacitor is undefined and
// the browser's own back button drives hashchange instead.
const CapApp = window.Capacitor?.Plugins?.App;
if (CapApp?.addListener) {
    CapApp.addListener('backButton', () => {
        if (currentRoute() !== 'home') history.back();
        else CapApp.exitApp();
    });
}

// ── Navigation: bottom tab bar + map layer switcher ─────────────────────────
// Tabs and layers are top-level destinations, so switching between them must
// not pile up hash history (the header back buttons and the Android back button
// both walk it). Each history entry is stamped with the route it was opened
// from; going somewhere from home pushes (back returns home), going anywhere
// else replaces the current entry (keeping its stamp), and going to the route
// underneath simply goes back. History therefore stays at most [home, route].
//
// Tabs: Home, Dashboard, County, Metro, Travel. County and Metro are opened
// most, so they get their own tab; every other hunter is a Home card. Travel
// links out to the US Travel, World Travel and Peaks pages. Every other screen
// (the remaining hunters, the map layers, StatsHunters) lights Home.
const TAB_ROUTES = new Set(['home', 'dashboard', 'county', 'metro', 'travel']);
let pendingFrom; // stamp carried across a location.replace()

function routeFromUrl(url) {
    return normalizeRoute((url || '').split('#')[1]);
}

// Record where a fresh entry came from. Entries revisited via back/forward
// already carry a state, so only brand-new ones (state null) are stamped.
function stampEntry(from) {
    if (history.state === null) {
        history.replaceState({ from: pendingFrom !== undefined ? pendingFrom : from }, '');
    }
    pendingFrom = undefined;
}

function tabFor(route) {
    return TAB_ROUTES.has(route) ? route : 'home';
}

function updateTabs(route) {
    const active = tabFor(route);
    document.querySelectorAll('.app-tab').forEach(tab => {
        const on = tab.dataset.tab === active;
        tab.classList.toggle('active', on);
        if (on) tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
    });
    if (isMapRoute(route)) rememberMapRoute(route);
    const mapCard = document.querySelector('.home-card[href^="#map"]');
    if (mapCard) mapCard.setAttribute('href', `#${lastMapRoute()}`);
}

function goRoute(route) {
    const current = currentRoute();
    if (route === current) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
        return;
    }
    if (current === 'home') {
        location.hash = route;
        return;
    }
    const from = history.state?.from ?? null;
    if (route === from) {
        history.back();
        return;
    }
    pendingFrom = from;
    location.replace(`#${route}`);
}

// ── Map layer switcher ──────────────────────────────────────────────────────
function buildMapSwitcher() {
    const pills = document.getElementById('map-pills');
    if (!pills) return;
    pills.innerHTML = MAP_LAYERS.map(l =>
        `<a class="app-map-pill" href="#${layerRoute(l.key)}" data-route="${layerRoute(l.key)}">${l.label}</a>`
    ).join('');
}

function updateMapSwitcher(route) {
    const bar = document.getElementById('map-switcher');
    if (!bar) return;
    const mapMode = isMapRoute(route);
    bar.hidden = !mapMode;
    if (!mapMode) return;

    const key = screenOf(route);
    let active = null;
    bar.querySelectorAll('.app-map-pill').forEach(pill => {
        const on = pill.dataset.route === route;
        pill.classList.toggle('active', on);
        if (on) { active = pill; pill.setAttribute('aria-current', 'page'); }
        else pill.removeAttribute('aria-current');
    });

    // Cross-link to the hunter's full screen (stats + tables) for its layer.
    const layer = MAP_LAYERS.find(l => l.key === key);
    const detail = document.getElementById('map-detail');
    if (detail) {
        const hasDetail = layer && layer.detail !== false;
        detail.hidden = !hasDetail;
        if (hasDetail) {
            detail.setAttribute('href', `#${key}`);
            detail.dataset.route = key;
            detail.setAttribute('aria-label', `${layer.label} stats and tables`);
        }
    }

    // The pill row scrolls sideways, so bring the active pill into view.
    // Scroll the row itself — scrollIntoView could also move the page.
    if (active) {
        const row = active.parentElement;
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        row.scrollTo({
            left: active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2,
            behavior: reduce ? 'auto' : 'smooth',
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // The entry the app was opened on has nothing underneath it.
    if (history.state === null) history.replaceState({ from: null }, '');
    document.querySelectorAll('.app-tab').forEach(tab => {
        tab.addEventListener('click', e => {
            e.preventDefault();
            goRoute(tab.dataset.tab);
        });
    });
    // Pills and the details link both live in the switcher bar.
    document.getElementById('map-switcher')?.addEventListener('click', e => {
        const link = e.target.closest('[data-route]');
        if (!link) return;
        e.preventDefault();
        goRoute(link.dataset.route);
    });
    updateTabs(currentRoute());
});

// ── Home "Sync now" button ───────────────────────────────────────────────────
// A big button on Home for the same sync as the Dashboard's "Sync now":
// strava.js's runManualSync() starts the worker's background sync (or follows
// one already running) and refreshes every view when it lands. This only
// mirrors its state — strava.js fires 'stravasync' whenever login, progress or
// the result changes. States: logged out (offers the admin login), idle,
// syncing (progress bar + activities fetched), then done / failed for a few
// seconds (strava.js clears lastSyncResult after 8 s) before going idle again.
function renderHomeSync() {
    const btn = document.getElementById('home-sync-btn');
    if (!btn || typeof isLoggedIn !== 'function') return;
    const label = document.getElementById('home-sync-label');
    const meta = document.getElementById('home-sync-meta');
    const bar = document.getElementById('home-sync-bar');
    const fill = document.getElementById('home-sync-fill');
    const lastSync = lastSyncedAt ? `Last synced ${relativeTime(lastSyncedAt)}` : '';

    let state = 'idle';
    if (!isLoggedIn()) state = 'locked';
    else if (syncing) state = 'syncing';
    else if (lastSyncResult) state = /fail/i.test(lastSyncResult) ? 'error' : 'done';
    btn.dataset.state = state;
    btn.disabled = state === 'syncing';
    bar.hidden = state !== 'syncing';

    if (state === 'locked') {
        label.textContent = 'Log in to sync';
        meta.textContent = lastSync || 'Owner only';
    } else if (state === 'syncing') {
        const fetched = syncProgress?.fetched || 0;
        const pct = syncProgress?.pct || 0;
        label.textContent = 'Syncing…';
        meta.textContent = fetched
            ? `${fetched.toLocaleString()}${currentTotal ? ` of ~${currentTotal.toLocaleString()}` : ''} activities checked`
            : 'Contacting Strava…';
        fill.style.width = `${Math.max(pct, 4)}%`;
    } else if (state === 'done') {
        label.textContent = lastSyncResult === 'Up to date' ? '✓ Up to date' : `✓ ${lastSyncResult.replace(/^Synced — /, '')}`;
        meta.textContent = 'Synced just now';
    } else if (state === 'error') {
        label.textContent = 'Sync failed — tap to retry';
        meta.textContent = lastSyncResult.replace(/^Sync failed: /, '');
    } else {
        label.textContent = 'Sync now';
        meta.textContent = lastSync || 'Fetch new activities from Strava';
    }
}

function onHomeSyncTap() {
    if (typeof isLoggedIn !== 'function') return;
    if (!isLoggedIn()) { adminLogin(); return; } // a successful login fires 'stravasync'
    if (syncing) return;
    runManualSync();
}

document.addEventListener('stravasync', renderHomeSync);
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('home-sync-btn')?.addEventListener('click', onHomeSyncTap);
    renderHomeSync();
    setInterval(renderHomeSync, 60000); // keep "Last synced 5m ago" current
});

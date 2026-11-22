// Service worker for the app (/app/, the Android app's WebView and the iPhone
// Home Screen app). It makes the app open without signal, showing the last
// data it saw, and keeps the map tiles of places it has shown.
//
// Registered by js/offline.js with scope /app/, so it controls only the app
// page (the site pages the Travel tab opens are not controlled). Every request
// the app page makes passes through here, whatever its host:
//   - page      the /app/ page itself (any query: ?user=1&k=… is the same HTML)
//   - static    scripts, styles, data files, icons (site + CDN libraries)
//   - data      the worker's GET endpoints (activities, hunters, travel…)
//   - tile      basemap tiles
// All four are network first: online the app behaves exactly as without this
// file (site pushes still show at once), and each answer is copied into the
// cache. When the network fails, or a cached copy exists and the network
// hasn't answered within a few seconds (one bar of signal, nothing moving),
// the cached copy is served instead and the network answer, if it ever comes,
// still updates the cache. Data served from the cache carries `x-jg-cache: 1`
// and `x-jg-saved` (when it was stored), which js/offline.js reads to show the
// offline banner, turn Sync off and stop the page saving stale results.
// Everything else (POSTs, sync, Nominatim, Overpass, StatsHunters) passes
// straight through.
//
// Bump VERSION when this file's caching rules change; old caches are dropped
// on activate. The cached copies themselves don't need a bump: they are
// refreshed whenever the app is online.

const VERSION = 'v1';
const APP_CACHE = `jg-app-${VERSION}`;     // page + static + data
const TILE_CACHE = `jg-tiles-${VERSION}`;  // basemap tiles
const TILE_MAX = 6000;                     // ~100–250 MB; oldest-fetched tiles go first

const PAGE_KEY = '/app/';
const PAGE_TIMEOUT_MS = 4000;
const STATIC_TIMEOUT_MS = 4000;
const DATA_TIMEOUT_MS = 6000;
const TILE_TIMEOUT_MS = 3000;

const WORKER_HOSTS = new Set([
    'strava-worker.justinguyette.workers.dev',
    'user-strava.justinguyette.workers.dev',
]);
// Worker paths that must never come from a cache: syncing, auth, saves.
const WORKER_NO_CACHE = /\/(sync|status|auth|check|save|reset|import|delete|fetch|rebuild|backfill-elev|start|account|key)(\/|$)|^\/mcp/;
const CDN_HOSTS = new Set(['unpkg.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com']);
const STATIC_PATHS = /^\/(js|css|data|connect|images|app)\/|^\/favicon\.ico$/;
const TILE_HOSTS = /(^|\.)(basemaps\.cartocdn\.com|tile\.openstreetmap\.org|tile\.opentopomap\.org|tile\.thunderforest\.com|arcgisonline\.com|tile-cyclosm\.openstreetmap\.fr|tiles\.stadiamaps\.com)$/;

self.addEventListener('install', event => {
    self.skipWaiting();
    // The page is the one thing the app can't open without; the rest is
    // cached as the page loads it (js/offline.js also sends what it had
    // already loaded before this worker took over).
    event.waitUntil(caches.open(APP_CACHE).then(cache =>
        fetch(PAGE_KEY, { cache: 'no-cache' }).then(res => res.ok && cache.put(PAGE_KEY, res)).catch(() => {})));
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keep = new Set([APP_CACHE, TILE_CACHE]);
        for (const name of await caches.keys()) {
            if (name.startsWith('jg-') && !keep.has(name)) await caches.delete(name);
        }
        await self.clients.claim();
    })());
});

function kindOf(request) {
    if (request.method !== 'GET' || request.headers.has('range')) return null;
    const url = new URL(request.url);
    if (url.origin === self.location.origin) {
        if (request.mode === 'navigate') return url.pathname.startsWith('/app/') ? 'page' : null;
        if (url.pathname === '/app/sw.js') return null;
        return STATIC_PATHS.test(url.pathname) ? 'static' : null;
    }
    if (CDN_HOSTS.has(url.hostname)) return 'static';
    if (WORKER_HOSTS.has(url.hostname)) return WORKER_NO_CACHE.test(url.pathname) ? null : 'data';
    if (TILE_HOSTS.test(url.hostname)) return 'tile';
    return null;
}

self.addEventListener('fetch', event => {
    const kind = kindOf(event.request);
    if (!kind) return; // straight to the network, as without a service worker
    event.respondWith(handle(event, kind));
});

function cacheKey(request, kind) {
    return kind === 'page' ? PAGE_KEY : request.url;
}

// Tiles are refetched in CORS mode: the map's <img> asks without CORS, and an
// opaque answer can't be checked and counts as megabytes against the storage
// quota in Chrome. Every tile server above sends Access-Control-Allow-Origin;
// if one ever stops, the tile is still shown, just not kept.
function fromNetwork(request, kind) {
    if (kind === 'tile') {
        return fetch(request.url, { mode: 'cors', credentials: 'omit' })
            .catch(() => fetch(request));
    }
    return fetch(request);
}

async function store(request, kind, res) {
    if (!res || !res.ok || res.type === 'opaque') return;
    const cache = await caches.open(kind === 'tile' ? TILE_CACHE : APP_CACHE);
    const key = cacheKey(request, kind);
    if (kind === 'data') {
        // Note when it was saved, for the banner ("data from …").
        const headers = new Headers(res.headers);
        headers.set('x-jg-saved', String(Date.now()));
        const body = await res.blob();
        await cache.put(key, new Response(body, { status: res.status, statusText: res.statusText, headers }));
    } else {
        await cache.put(key, res);
    }
    if (kind === 'static' && new URL(key).search) dropOtherVersions(cache, key);
    if (kind === 'tile' && ++tilePuts % 100 === 0) await trimTiles(cache);
}

// A script's ?v= tag changes with each edit; keep only the newest copy.
async function dropOtherVersions(cache, key) {
    for (const old of await cache.keys(key, { ignoreSearch: true })) {
        if (old.url !== key) await cache.delete(old);
    }
}

let tilePuts = 0;
async function trimTiles(cache) {
    const keys = await cache.keys(); // oldest stored first (a refetch moves a tile to the end)
    const extra = keys.length - TILE_MAX;
    if (extra <= 0) return;
    for (const key of keys.slice(0, extra + Math.round(TILE_MAX * 0.05))) await cache.delete(key);
}

function markCached(res) {
    const headers = new Headers(res.headers);
    headers.set('x-jg-cache', '1');
    // The worker is another origin: the page sees these only when exposed.
    headers.set('access-control-expose-headers', 'x-jg-cache, x-jg-saved');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function handle(event, kind) {
    const request = event.request;
    const key = cacheKey(request, kind);
    const network = fromNetwork(request, kind);
    // Copy the answer into the cache whenever it arrives, even after the
    // cached copy was served.
    event.waitUntil(network.then(res => store(request, kind, res.clone())).catch(() => {}));

    const cached = await caches.match(key, { cacheName: kind === 'tile' ? TILE_CACHE : APP_CACHE });
    if (!cached) return network;

    const wait = { page: PAGE_TIMEOUT_MS, static: STATIC_TIMEOUT_MS, data: DATA_TIMEOUT_MS, tile: TILE_TIMEOUT_MS }[kind];
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), wait); });
    try {
        const res = await Promise.race([network, timeout]);
        // A worker or server error (or Capacitor's proxy failing offline)
        // is no better than no answer: the saved copy wins.
        if (res && (res.ok || res.type === 'opaque' || res.status === 304)) return res;
    } catch { /* offline: fall through to the cache */ } finally {
        clearTimeout(timer);
    }
    return kind === 'data' ? markCached(cached) : cached;
}

// js/offline.js sends the URLs the page loaded before this worker controlled
// it, so the very first visit already leaves a working offline copy. Fetched
// one at a time (mostly from the HTTP cache), skipping what's stored.
self.addEventListener('message', event => {
    if (event.data?.type !== 'warm' || !Array.isArray(event.data.urls)) return;
    event.waitUntil((async () => {
        const cache = await caches.open(APP_CACHE);
        for (const url of event.data.urls.slice(0, 300)) {
            try {
                const request = new Request(url, { mode: new URL(url).origin === self.location.origin ? 'same-origin' : 'cors', credentials: 'omit' });
                const kind = kindOf(request);
                if (!kind || kind === 'tile' || kind === 'page' || await cache.match(request.url)) continue;
                await store(request, kind, await fetch(request));
            } catch { /* skip this one */ }
        }
    })());
});

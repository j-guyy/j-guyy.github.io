// ── Cloudflare Worker for j-guyy.github.io ──────────────────────────────────
//
// KV-backed API for Strava activity data, geocoding cache, hunter features
// (counties, tiles, peaks, summits), and travel tracking; D1-backed YouTube
// Music song leaderboard.
//
// Deploy: wrangler deploy
// Bindings: STRAVA_DATA (KV), STRAVA_KV (KV), MUSIC_DB (D1), CLIENT_ID,
//           CLIENT_SECRET, TRAVEL_PASSWORD, MUSIC_SYNC_TOKEN (secrets)

const ALLOWED_ORIGIN = 'https://j-guyy.github.io';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
};

// ── Admin auth ───────────────────────────────────────────────────────────────
// Destructive / expensive endpoints (manual force-sync, rebuild, ride-elev
// backfill, and every hunter reset) require the admin password, supplied via the
// X-Admin-Password header. Same secret as travel edits (TRAVEL_PASSWORD).
// Read-only GETs and the incremental /save endpoints stay open so the page
// renders and persists visitor-driven detection without a login.
function isAdmin(request, env) {
    const pw = request.headers.get('X-Admin-Password');
    return Boolean(pw) && pw === env.TRAVEL_PASSWORD;
}

function unauthorized() {
    return json({ error: 'Unauthorized' }, 401);
}

// ── KV keys ──────────────────────────────────────────────────────────────────

const ACTIVITIES_KEY = 'strava_activities';
const GEO_KEY        = 'strava_geo';
const COUNTIES_KEY   = 'strava_counties';
const TILES_KEY      = 'strava_tiles';
const PEAKS_KEY      = 'strava_peaks';
const HIDDEN_PEAKS_KEY = 'strava_hidden_peaks';
const SUMMITS_KEY    = 'strava_summits';
const PARKS_KEY       = 'strava_parks';
const STATE_PARKS_KEY = 'strava_state_parks';
const METRO_HUNTER_KEY = 'strava_metro_hunter';
const PASSES_KEY      = 'strava_passes';
const TILE_STATS_KEY = 'strava_tile_stats';   // { visited, maxCluster, maxSquare } saved with the tiles
const PROGRESS_KEY   = 'strava_progress';     // City / Trail Hunter completion summaries

const TRAVEL_KEYS = {
    highpoints:    'travel_highpoints',
    metros:        'travel_metros',
    parks:         'travel_parks',
    countries:     'travel_countries',
    visitedStates: 'travel_visited_states',
    adk46ers:      'travel_adk46ers',
    colorado14ers: 'travel_colorado14ers',
};

// ── Router ───────────────────────────────────────────────────────────────────

export default {
    async fetch(request, env) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }

        const url = new URL(request.url);
        const path = url.pathname;

        try {
            // ── Admin auth check ──
            // Lets the client verify a password at login time without mutating
            // anything. Returns 200 if the header matches, 401 otherwise.
            if (path === '/auth/check' && request.method === 'POST') {
                return isAdmin(request, env) ? json({ ok: true }) : unauthorized();
            }

            // ── Travel data endpoints ──

            if (path === '/travel/highpoints')      return await handleTravelGet(env, 'highpoints');
            if (path === '/travel/metros')           return await handleTravelGet(env, 'metros');
            if (path === '/travel/parks')            return await handleTravelGet(env, 'parks');
            if (path === '/travel/countries')         return await handleTravelGet(env, 'countries');
            if (path === '/travel/visited-states')    return await handleTravelGet(env, 'visitedStates');
            if (path === '/travel/adk46ers')          return await handleTravelGet(env, 'adk46ers');
            if (path === '/travel/colorado14ers')     return await handleTravelGet(env, 'colorado14ers');

            if (path === '/travel/toggle' && request.method === 'POST') {
                return await handleTravelToggle(request, env);
            }
            if (path === '/travel/seed' && request.method === 'POST') {
                return await handleTravelSeed(request, env);
            }

            // ── Activity endpoints ──

            if (path === '/activities/all') {
                return await handleGetAll(env);
            }
            if (path === '/activities/sync' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                return handleSyncStream(env);
            }
            if (path === '/activities/rebuild' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(ACTIVITIES_KEY);
                return await handleSync(env);
            }
            if (path === '/activities/backfill-elev' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                return await handleBackfillElev(env);
            }
            if (path === '/polylines/all') {
                const stored = await env.STRAVA_DATA.get(ACTIVITIES_KEY, 'json');
                if (!stored) return json([]);
                return json((stored.slim || []).map(a => a.p || ''));
            }

            // ── Geocoding cache ──

            if (path === '/geo/all') {
                const geo = await env.STRAVA_DATA.get(GEO_KEY, 'json');
                return json(geo || {});
            }
            if (path === '/geo/save' && request.method === 'POST') {
                const geo = await request.json();
                await env.STRAVA_DATA.put(GEO_KEY, JSON.stringify(geo));
                return json({ ok: true, keys: Object.keys(geo).length });
            }
            if (path === '/geo/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(GEO_KEY);
                return json({ ok: true });
            }

            // ── County Hunter ──
            // Data: { fips: [...], processedIds: [...], discoveries: { fips: { actId, actName, date } } }

            if (path === '/counties/all') {
                const data = await env.STRAVA_DATA.get(COUNTIES_KEY, 'json');
                return json(data || { fips: [], processedIds: [], discoveries: {} });
            }
            if (path === '/counties/save' && request.method === 'POST') {
                const data = await request.json();
                await env.STRAVA_DATA.put(COUNTIES_KEY, JSON.stringify(data));
                return json({ ok: true, counties: (data.fips || []).length });
            }
            if (path === '/counties/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(COUNTIES_KEY);
                return json({ ok: true });
            }

            // ── Tile Hunter ──
            // Data: { tiles: [...], processedIds: [...] }

            if (path === '/tiles/all') {
                const data = await env.STRAVA_DATA.get(TILES_KEY, 'json');
                return json(data || { tiles: [], processedIds: [] });
            }
            if (path === '/tiles/save' && request.method === 'POST') {
                const data = await request.json();
                await env.STRAVA_DATA.put(TILES_KEY, JSON.stringify(data));
                // The page computes max cluster / square anyway, so it sends
                // them along and /summary never has to. A save without valid
                // stats (an older cached page) must drop the previous ones or
                // they would describe a tile list that no longer exists.
                const stats = cleanTileStats(data.stats, (data.tiles || []).length);
                if (stats) await env.STRAVA_DATA.put(TILE_STATS_KEY, JSON.stringify(stats));
                else await env.STRAVA_DATA.delete(TILE_STATS_KEY);
                return json({ ok: true, tiles: (data.tiles || []).length });
            }
            if (path === '/tiles/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(TILES_KEY);
                await env.STRAVA_DATA.delete(TILE_STATS_KEY);
                return json({ ok: true });
            }

            // ── City / Trail Hunter progress ──
            // Their completion is computed in the browser from Overpass / COTrex
            // data and never stored, so the page saves just a tiny summary per
            // city / trail region for /summary to surface.
            // Data: { city: { <configKey>: { name, complete, partial, total, pct, ts } }, trail: { … } }

            if (path === '/progress/all') {
                const data = await env.STRAVA_DATA.get(PROGRESS_KEY, 'json');
                return json(data || { city: {}, trail: {} });
            }
            if (path === '/progress/save' && request.method === 'POST') {
                return await handleProgressSave(request, env);
            }
            if (path === '/progress/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(PROGRESS_KEY);
                return json({ ok: true });
            }

            // ── Mountain Hunter — peak cell cache ──
            // Data: { cells: { "lat,lng": { peaks: [...], ts, failed? } } }

            if (path === '/peaks/all') {
                const data = await env.STRAVA_DATA.get(PEAKS_KEY, 'json');
                return json(data || { cells: {} });
            }
            if (path === '/peaks/save' && request.method === 'POST') {
                const data = await request.json();
                await env.STRAVA_DATA.put(PEAKS_KEY, JSON.stringify(data));
                return json({ ok: true, cells: Object.keys(data.cells || {}).length });
            }
            if (path === '/peaks/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(PEAKS_KEY);
                return json({ ok: true });
            }

            // ── Mountain Hunter — hidden (sub-peak) list ──
            // Data: { ids: [osmPeakId, ...] }

            if (path === '/peaks/hidden/all') {
                const data = await env.STRAVA_DATA.get(HIDDEN_PEAKS_KEY, 'json');
                return json(data || { ids: [] });
            }
            if (path === '/peaks/hidden/save' && request.method === 'POST') {
                // Hiding sub-peaks is an owner edit (Mountain Hunter edit mode),
                // unlike the detection caches above that any visitor's page saves.
                if (!isAdmin(request, env)) return unauthorized();
                const data = await request.json();
                await env.STRAVA_DATA.put(HIDDEN_PEAKS_KEY, JSON.stringify({ ids: data.ids || [] }));
                return json({ ok: true, count: (data.ids || []).length });
            }

            // ── Park Hunter ──
            // Data: { ids: [...], processedIds: [...], discoveries: { id: { actId, actName, date } } }

            if (path === '/parks/all') {
                const data = await env.STRAVA_DATA.get(PARKS_KEY, 'json');
                return json(data || { ids: [], processedIds: [], discoveries: {} });
            }
            if (path === '/parks/save' && request.method === 'POST') {
                const data = await request.json();
                await env.STRAVA_DATA.put(PARKS_KEY, JSON.stringify(data));
                return json({ ok: true, parks: (data.ids || []).length });
            }
            if (path === '/parks/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(PARKS_KEY);
                return json({ ok: true });
            }

            // ── State Park Hunter ──
            if (path === '/state-parks/all') {
                const data = await env.STRAVA_DATA.get(STATE_PARKS_KEY, 'json');
                return json(data || { ids: [], processedIds: [], discoveries: {} });
            }
            if (path === '/state-parks/save' && request.method === 'POST') {
                const data = await request.json();
                await env.STRAVA_DATA.put(STATE_PARKS_KEY, JSON.stringify(data));
                return json({ ok: true, parks: (data.ids || []).length });
            }
            if (path === '/state-parks/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(STATE_PARKS_KEY);
                return json({ ok: true });
            }

            // ── Metro Hunter ──
            // Data: { ids: [...], processedIds: [...], discoveries: { id: { actId, actName, date } } }

            if (path === '/metro-hunter/all') {
                const data = await env.STRAVA_DATA.get(METRO_HUNTER_KEY, 'json');
                return json(data || { ids: [], processedIds: [], discoveries: {} });
            }
            if (path === '/metro-hunter/save' && request.method === 'POST') {
                const data = await request.json();
                await env.STRAVA_DATA.put(METRO_HUNTER_KEY, JSON.stringify(data));
                return json({ ok: true, metros: (data.ids || []).length });
            }
            if (path === '/metro-hunter/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(METRO_HUNTER_KEY);
                return json({ ok: true });
            }

            // ── Pass Hunter — Colorado mountain pass crossings (cycling) ──
            // Data: { ids: [...], processedIds: [...], discoveries: { passId: { actId, actName, date } } }

            if (path === '/passes/all') {
                const data = await env.STRAVA_DATA.get(PASSES_KEY, 'json');
                return json(data || { ids: [], processedIds: [], discoveries: {} });
            }
            if (path === '/passes/save' && request.method === 'POST') {
                const data = await request.json();
                await env.STRAVA_DATA.put(PASSES_KEY, JSON.stringify(data));
                return json({ ok: true, passes: (data.ids || []).length });
            }
            if (path === '/passes/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(PASSES_KEY);
                return json({ ok: true });
            }

            // ── Mountain Hunter — summit detection cache ──
            // Data: { visits: { peakId: [{ actId, actName, actType, date }] }, processedIds: [...] }

            if (path === '/summits/all') {
                const data = await env.STRAVA_DATA.get(SUMMITS_KEY, 'json');
                return json(data || { visits: {}, processedIds: [] });
            }
            if (path === '/summits/save' && request.method === 'POST') {
                const data = await request.json();
                await env.STRAVA_DATA.put(SUMMITS_KEY, JSON.stringify(data));
                return json({ ok: true, peaks: Object.keys(data.visits || {}).length });
            }
            if (path === '/summits/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(SUMMITS_KEY);
                return json({ ok: true });
            }

            // ── Hunter summary ──
            // Headline numbers for every hunter, derived at read time from the
            // blobs above so the app home grid / strava.html overview can show
            // them without loading multi-MB geojson client-side. Public-read like
            // the other GETs.

            if (path === '/summary' && request.method === 'GET') {
                return await handleSummary(env);
            }

            // ── Music (YouTube Music song leaderboard) ──
            // The daily GitHub Action (scripts/ytmusic/sync_history.py) reads
            // /music/state, works out the plays since its last run, and posts
            // them to /music/plays. Both need MUSIC_SYNC_TOKEN (or the admin
            // password); the leaderboard itself is public-read.

            if (path === '/music/leaderboard' && request.method === 'GET') {
                return await handleMusicLeaderboard(url, env);
            }
            if (path === '/music/state' && request.method === 'GET') {
                if (!isMusicWriter(request, env)) return unauthorized();
                return await handleMusicState(env);
            }
            if (path === '/music/plays' && request.method === 'POST') {
                if (!isMusicWriter(request, env)) return unauthorized();
                return await handleMusicPlays(request, env);
            }

            // ── Mountain Hunter — server-side Overpass proxy ──
            // Fetches peaks for a 5°×5° cell from Overpass on behalf of the client,
            // avoiding browser IP rate-limits. Tries two mirrors with a short gap.

            if (path === '/peaks/fetch' && request.method === 'GET') {
                return await handlePeaksFetch(url);
            }

            // ── Legacy Strava proxy (keep for /athlete, /athlete/stats) ──

            const allowed = ['/athlete', '/athlete/stats'];
            if (!allowed.includes(path)) {
                return json({ error: 'Not found' }, 404);
            }

            const token = await getAccessToken(env);
            const params = url.searchParams.toString();
            const stravaUrl = `https://www.strava.com/api/v3${path}${params ? '?' + params : ''}`;
            const res = await fetch(stravaUrl, {
                headers: { Authorization: `Bearer ${token}` }
            });
            return json(await res.json());

        } catch (err) {
            return json({ error: err.message }, 500);
        }
    },

    // ── Scheduled (cron) automatic sync ──────────────────────────────────────
    // Keeps KV fresh server-side, independent of anyone loading the page. The
    // page no longer auto-syncs on load, so this is the sole automatic sync.
    // Configure the cadence as a Cron Trigger in the Cloudflare dashboard
    // (Workers → strava-worker → Settings → Triggers). Currently set to once
    // daily at 00:00 UTC: `0 0 * * *`.
    async scheduled(event, env, ctx) {
        ctx.waitUntil(
            syncActivities(env)
                .then(r => console.log(`scheduled sync: ${r.newActivities} new, ${r.updated} updated, ${r.removed} removed`))
                .catch(err => console.log(`scheduled sync failed: ${err.message}`))
        );
    },
};

// ── Hunter summary ───────────────────────────────────────────────────────────
//
// Response shape (any hunter whose blob is missing or unreadable is null; city
// and trail are null until the page has computed and saved their progress —
// see /progress/save):
//   { generatedAt,
//     activities: { total, syncedAt },
//     county:   { visited, total },
//     park:     { visited, total, stateParks, stateParksTotal },
//     metro:    { visited, total },
//     tile:     { visited, maxCluster, maxSquare },
//     mountain: { summited, summits },
//     pass:     { climbed, total },
//     city:  { key, name, pct, complete, partial, total, ts } | null,
//     trail: { … same … } | null }
//
// Totals mirror the constants in js/strava.js (county stats bar, FEDERAL_PARK_TOTAL,
// STATE_PARK_TOTAL, METRO_TOTAL); keep them in step.
const SUMMARY_TOTALS = { counties: 3233, parks: 897, stateParks: 5895, metros: 200 };

// Browsers/CDNs may reuse a summary for a few minutes — the numbers only move
// when someone opens a hunter and it saves new detections.
const SUMMARY_CACHE_SECONDS = 300;

async function handleSummary(env) {
    const kv = env.STRAVA_DATA;
    const [activitiesText, counties, parks, stateParks, metros, tileStats, summits, hidden, passes, progress] =
        await Promise.all([
            kv.get(ACTIVITIES_KEY, 'text'),
            kv.get(COUNTIES_KEY, 'json'),
            kv.get(PARKS_KEY, 'json'),
            kv.get(STATE_PARKS_KEY, 'json'),
            kv.get(METRO_HUNTER_KEY, 'json'),
            kv.get(TILE_STATS_KEY, 'json'),
            kv.get(SUMMITS_KEY, 'json'),
            kv.get(HIDDEN_PEAKS_KEY, 'json'),
            kv.get(PASSES_KEY, 'json'),
            kv.get(PROGRESS_KEY, 'json'),
        ]);

    // Each hunter is derived independently so one malformed blob can't blank
    // the whole summary.
    const safe = (fn) => { try { return fn(); } catch (e) { console.log(`summary: ${e.message}`); return null; } };
    const count = (arr) => (Array.isArray(arr) ? arr.length : 0);

    const summary = {
        generatedAt: Date.now(),
        activities: safe(() => summarizeActivities(activitiesText)),
        county: counties ? { visited: count(counties.fips), total: SUMMARY_TOTALS.counties } : null,
        park: (parks || stateParks) ? {
            visited: count(parks?.ids),
            total: SUMMARY_TOTALS.parks,
            stateParks: count(stateParks?.ids),
            stateParksTotal: SUMMARY_TOTALS.stateParks,
        } : null,
        metro: metros ? { visited: count(metros.ids), total: SUMMARY_TOTALS.metros } : null,
        tile: await safeAsync(() => summarizeTileStats(env, tileStats)),
        mountain: summits ? safe(() => summarizeSummits(summits, hidden)) : null,
        pass: passes ? {
            climbed: Object.keys(passes.discoveries || {}).length || count(passes.ids),
            total: count(passes.catalogIds) || null,
        } : null,
        city: safe(() => headlineProgress(progress?.city)),
        trail: safe(() => headlineProgress(progress?.trail)),
    };

    return json(summary, 200, { 'Cache-Control': `public, max-age=${SUMMARY_CACHE_SECONDS}` });
}

async function safeAsync(fn) {
    try { return await fn(); } catch (e) { console.log(`summary: ${e.message}`); return null; }
}

// Tile stats come precomputed from the page's last /tiles/save (a few bytes, no
// CPU). Only tile data saved before that existed falls back to the old
// read-time computation over the whole tile list, memoised per isolate.
async function summarizeTileStats(env, stats) {
    if (stats) return stats;
    const tiles = await env.STRAVA_DATA.get(TILES_KEY, 'json');
    return tiles ? summarizeTilesMemo(tiles.tiles || []) : null;
}

// Accepts { visited, maxCluster, maxSquare } only when they are sane integers
// and `visited` matches the tile count actually saved.
function cleanTileStats(stats, tileCount) {
    if (!stats || typeof stats !== 'object') return null;
    const { visited, maxCluster, maxSquare } = stats;
    const ok = (v) => Number.isInteger(v) && v >= 0 && v <= tileCount;
    if (visited !== tileCount || !ok(maxCluster) || !ok(maxSquare)) return null;
    return { visited, maxCluster, maxSquare };
}

// ── City / Trail Hunter progress ─────────────────────────────────────────────

const PROGRESS_KINDS = ['city', 'trail'];

// Merge one { kind, key, name, complete, partial, total, pct } report into the
// stored summaries. Public like the other /save endpoints, so every field is
// validated and the blob stays tiny (bounded number of short keys).
async function handleProgressSave(request, env) {
    const body = await request.json();
    const key = typeof body.key === 'string' && /^[a-z0-9-]{1,40}$/.test(body.key) ? body.key : null;
    const int = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e7 ? v : null);
    const complete = int(body.complete), partial = int(body.partial), total = int(body.total);
    const pct = Number(body.pct);
    if (!PROGRESS_KINDS.includes(body.kind) || !key || complete === null || partial === null ||
        total === null || !(pct >= 0 && pct <= 100)) {
        return json({ error: 'Invalid progress' }, 400);
    }
    const name = String(body.name || key).slice(0, 60);
    const stored = (await env.STRAVA_DATA.get(PROGRESS_KEY, 'json')) || {};
    const group = stored[body.kind] || {};
    if (!group[key] && Object.keys(group).length >= 20) return json({ error: 'Too many entries' }, 400);
    group[key] = { name, complete, partial, total, pct: Math.round(pct * 10) / 10, ts: Date.now() };
    stored[body.kind] = group;
    await env.STRAVA_DATA.put(PROGRESS_KEY, JSON.stringify(stored));
    return json({ ok: true });
}

// The card shows one entry per hunter: the most recently computed city / trail
// region (the one the owner last looked at).
function headlineProgress(group) {
    let best = null;
    for (const [key, v] of Object.entries(group || {})) {
        if (v && (!best || v.ts > best.ts)) best = { key, ...v };
    }
    return best;
}

// The activity store is several MB of polylines; parsing it all just for two
// numbers is wasteful. The record is written as { slim, total, lastActivityTime,
// syncedAt } (see syncActivities), so the counters sit at the tail.
function summarizeActivities(text) {
    if (!text) return null;
    const tail = text.slice(-400);
    const total = tail.match(/"total":(\d+)/);
    const synced = tail.match(/"syncedAt":(\d+)/);
    if (!total) return null;
    return { total: Number(total[1]), syncedAt: synced ? Number(synced[1]) : null };
}

// Same definitions as computeClusters / computeSquares in js/strava.js: a
// cluster tile has all 4 neighbours visited, clusters are its connected
// components, and the max square is the largest fully-visited N×N block.
// Tiles are "x,y" z14 keys; packed into one small integer (z14 has 2^14
// tiles per axis) so the set lookups stay cheap for tens of thousands of tiles.
function summarizeTiles(tileKeys) {
    const B = 14, M = (1 << B) - 1;   // pack (x, y) as x << 14 | y — a small int
    const set = new Set();
    for (const k of tileKeys) {
        const s = String(k), c = s.indexOf(',');
        const x = +s.slice(0, c), y = +s.slice(c + 1);
        if (c > 0 && x >= 0 && y >= 0 && x <= M && y <= M && (x | 0) === x && (y | 0) === y) {
            set.add((x << B) | y);
        }
    }

    // Neighbours are only looked up after an explicit edge check, so a packed
    // key never wraps into the next row.
    const interior = new Set();
    for (const v of set) {
        const x = v >> B, y = v & M;
        if (y > 0 && y < M && x > 0 && x < M &&
            set.has(v - 1) && set.has(v + 1) && set.has(v - (1 << B)) && set.has(v + (1 << B))) {
            interior.add(v);
        }
    }
    let maxCluster = 0;
    const seen = new Set();
    const queue = [];
    for (const start of interior) {
        if (seen.has(start)) continue;
        seen.add(start);
        queue.length = 0;
        queue.push(start);
        for (let head = 0; head < queue.length; head++) {
            const v = queue[head];
            const x = v >> B, y = v & M;
            // Interior tiles are never on the grid edge, so ±1 / ±row is safe.
            if (x < M) { const n = v + (1 << B); if (interior.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); } }
            if (x > 0) { const n = v - (1 << B); if (interior.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); } }
            if (y < M) { const n = v + 1;        if (interior.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); } }
            if (y > 0) { const n = v - 1;        if (interior.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); } }
        }
        if (queue.length > maxCluster) maxCluster = queue.length;
    }

    // Row-major (y, then x) so left/top/top-left are ready before each tile:
    // re-pack as y << 14 | x and let a native Int32Array sort order them.
    const rowMajor = new Int32Array(set.size);
    let i = 0;
    for (const v of set) rowMajor[i++] = ((v & M) << B) | (v >> B);
    rowMajor.sort();
    const dp = new Map();
    let maxSquare = 0;
    for (let j = 0; j < rowMajor.length; j++) {
        const k = rowMajor[j];
        const x = k & M, y = k >> B;
        const left    = x > 0 ? dp.get(k - 1) || 0 : 0;
        const top     = y > 0 ? dp.get(k - (1 << B)) || 0 : 0;
        const topLeft = x > 0 && y > 0 ? dp.get(k - (1 << B) - 1) || 0 : 0;
        const n = Math.min(left, top, topLeft) + 1;
        dp.set(k, n);
        if (n > maxSquare) maxSquare = n;
    }

    return { visited: set.size, maxCluster, maxSquare };
}

// The cluster/square pass is the only non-trivial work in /summary (~20ms for
// 30k tiles), so a warm isolate reuses the last result while the tile list is
// unchanged. Tiles are only ever appended (a reset deletes the key), so length
// plus the two end keys identify the list.
let tileSummaryMemo = null;
function summarizeTilesMemo(tileKeys) {
    const sig = `${tileKeys.length}|${tileKeys[0]}|${tileKeys[tileKeys.length - 1]}`;
    if (tileSummaryMemo?.sig !== sig) tileSummaryMemo = { sig, stats: summarizeTiles(tileKeys) };
    return tileSummaryMemo.stats;
}

// Summited = peaks with at least one recorded visit, minus the ones the owner
// has hidden as sub-peaks (the client's "Peaks Summited" stat does the same).
function summarizeSummits(summits, hidden) {
    const hiddenIds = new Set((hidden?.ids || []).map(Number));
    let summited = 0, total = 0;
    for (const [peakId, visits] of Object.entries(summits.visits || {})) {
        if (!Array.isArray(visits) || !visits.length || hiddenIds.has(Number(peakId))) continue;
        summited++;
        total += visits.length;
    }
    return { summited, summits: total };
}

// ── Mountain Hunter — Overpass proxy ─────────────────────────────────────────

async function tryOverpass(mirror, query, cell) {
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), 22000);
    try {
        const res = await fetch(`${mirror}?data=${encodeURIComponent(query)}`, {
            signal: controller.signal,
            headers: { 'User-Agent': 'MountainHunter/1.0 (j-guyy.github.io)' },
        });
        clearTimeout(abort);
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${mirror}`);
        const data = await res.json();
        if (data.remark) throw new Error(`remark from ${mirror}: ${data.remark}`);
        return { mirror, data };
    } catch (err) {
        clearTimeout(abort);
        // Re-throw with the mirror tagged for clean per-mirror logging in the caller.
        if (err.name === 'AbortError') throw new Error(`aborted (22s) from ${mirror}`);
        throw err;
    }
}

async function handlePeaksFetch(url) {
    const s = url.searchParams.get('south');
    const w = url.searchParams.get('west');
    const n = url.searchParams.get('north');
    const e = url.searchParams.get('east');
    if (!s || !w || !n || !e) return json({ error: 'missing bounds' }, 400);

    const cell = `(${s},${w},${n},${e})`;
    // Race both mirrors in parallel — first success wins. Wall clock max is one
    // attempt's worth (~22s), well under Cloudflare's 30s limit, and we get the
    // benefit of either mirror responding fast without random-mirror bad luck.
    const query = `[out:json][timeout:20];(node["natural"="peak"]["ele"](${s},${w},${n},${e});node["natural"="volcano"]["ele"](${s},${w},${n},${e}););out body;`;
    const mirrors = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
    ];

    let winner;
    try {
        winner = await Promise.any(mirrors.map(m => tryOverpass(m, query, cell)));
    } catch (err) {
        // AggregateError — every mirror failed. Log each so we know whether it
        // was rate-limit, timeout, or remark.
        for (const e of err.errors || [err]) {
            console.log(`peaks/fetch ${cell}: ${e.message}`);
        }
        return json({ peaks: [], failed: true });
    }

    const peaks = (winner.data.elements || [])
        .filter(el => {
            const v = parseFloat(el.tags?.ele);
            if (isNaN(v) || v <= 0) return false;
            const name = el.tags?.name || el.tags?.['name:en'] || '';
            return name !== '' && name !== 'Unnamed Peak';
        })
        .map(el => ({
            id:   el.id,
            name: el.tags?.name || el.tags?.['name:en'] || '',
            lat:  el.lat,
            lng:  el.lon,
            ele:  parseFloat(el.tags.ele),
        }));
    console.log(`peaks/fetch ${cell}: ${peaks.length} peaks from ${winner.mirror}`);
    return json({ peaks });
}

// ── Travel data handlers ─────────────────────────────────────────────────────

async function handleTravelGet(env, type) {
    const data = await env.STRAVA_DATA.get(TRAVEL_KEYS[type], 'json');
    return json(data || (type === 'visitedStates' ? {} : type === 'countries' ? {} : []));
}

async function handleTravelToggle(request, env) {
    const body = await request.json();
    const { password, type, key, continent } = body;

    if (!password || password !== env.TRAVEL_PASSWORD) {
        return json({ error: 'Invalid password' }, 401);
    }

    if (!type || !key || !TRAVEL_KEYS[type]) {
        return json({ error: 'Missing or invalid type/key' }, 400);
    }

    const kvKey = TRAVEL_KEYS[type];
    const data = await env.STRAVA_DATA.get(kvKey, 'json');
    if (!data) {
        return json({ error: 'No data found — run /travel/seed first' }, 404);
    }

    let toggled = false;

    if (type === 'visitedStates') {
        if (key in data) {
            data[key] = !data[key];
            toggled = true;
        }
    } else if (type === 'countries') {
        if (!continent) {
            return json({ error: 'continent is required for countries' }, 400);
        }
        const continentMap = {
            northAmerica: 'northAmericanCountries',
            southAmerica: 'southAmericanCountries',
            europe: 'europeanCountries',
            asia: 'asianCountries',
            africa: 'africanCountries',
            oceania: 'oceaniaCountries',
        };
        const arrayKey = continentMap[continent];
        if (!arrayKey || !data[arrayKey]) {
            return json({ error: 'Invalid continent' }, 400);
        }
        const item = data[arrayKey].find(c => c.name === key);
        if (item) {
            item.visited = !item.visited;
            toggled = true;
        }
    } else if (type === 'highpoints') {
        const item = data.find(p => p.state === key);
        if (item) {
            item.visited = !item.visited;
            toggled = true;
        }
    } else if (type === 'metros') {
        const rank = parseInt(key, 10);
        const item = data.find(m => m.rank === rank);
        if (item) {
            item.visited = !item.visited;
            toggled = true;
        }
    } else if (type === 'parks') {
        const item = data.find(p => p.name === key);
        if (item) {
            item.visited = !item.visited;
            toggled = true;
        }
    } else if (type === 'adk46ers' || type === 'colorado14ers') {
        // Peak lists use `climbed` rather than `visited` so the stored shape
        // matches the static /data JSON files that map/quest pages fall back to.
        const item = data.find(p => p.name === key);
        if (item) {
            item.climbed = !item.climbed;
            toggled = true;
        }
    }

    if (!toggled) {
        return json({ error: `Item not found: ${key}` }, 404);
    }

    await env.STRAVA_DATA.put(kvKey, JSON.stringify(data));
    return json({ ok: true, type, key, toggled: true });
}

async function handleTravelSeed(request, env) {
    const body = await request.json();
    const { password, type, data } = body;

    if (!password || password !== env.TRAVEL_PASSWORD) {
        return json({ error: 'Invalid password' }, 401);
    }

    if (!type || !data || !TRAVEL_KEYS[type]) {
        return json({ error: 'Missing or invalid type/data' }, 400);
    }

    await env.STRAVA_DATA.put(TRAVEL_KEYS[type], JSON.stringify(data));
    return json({ ok: true, type, seeded: true });
}

// ── Strava activity handlers ─────────────────────────────────────────────────

async function handleGetAll(env) {
    const stored = await env.STRAVA_DATA.get(ACTIVITIES_KEY, 'json');
    if (!stored) return json({ slim: [], total: 0, lastActivityTime: null });
    return json(stored);
}

// Full list refresh: re-fetch the athlete's entire activity list (200 per call,
// cheap) and rebuild the slim store from scratch. This captures edits — renames,
// corrected elevation, sport-type changes — and deletions on existing
// activities, not just brand-new ones, because we no longer rely on Strava's
// `after` filter or carry stale copies forward. The only enriched field is each
// ride's `eh` (elev_high), which isn't in the list payload — that costs one
// detail call per ride — so we preserve it by activity ID across the refresh.
// Core sync routine, shared by the JSON, streaming, and cron entry points.
// `onProgress(fetched, page)` (optional) is called after each page is fetched so
// callers can stream progress. Returns the stored record plus new/updated/removed
// tallies. Throws (without writing) on any list error so a partial fetch can
// never clobber good data.
async function syncActivities(env, onProgress) {
    const stored = await env.STRAVA_DATA.get(ACTIVITIES_KEY, 'json')
        || { slim: [], total: 0, lastActivityTime: null };

    const token = await getAccessToken(env);

    const all = [];
    let page = 1;
    while (true) {
        const params = new URLSearchParams({ per_page: '200', page: String(page) });
        const res = await fetch(`https://www.strava.com/api/v3/activities?${params}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`Strava list error ${res.status} on page ${page}`);
        const batch = await res.json();
        if (!Array.isArray(batch)) throw new Error(`Strava returned non-array on page ${page}`);
        if (batch.length === 0) break;
        all.push(...batch);
        if (onProgress) onProgress(all.length, page);
        if (batch.length < 200) break; // last (short) page — no need for one more call
        page++;
    }

    // Safety net: never let an unexpectedly empty response wipe a populated store.
    if (all.length === 0 && stored.slim.length > 0) {
        return { ...stored, newActivities: 0, updated: 0, removed: 0, skipped: 'empty response' };
    }

    const total = all.length;
    const slim = slimActivities(all);

    // Index the previous store by id to preserve each ride's backfilled high
    // point (re-deriving eh would mean a detail call per ride) and to tally what
    // changed for the post-sync summary.
    const prevById = new Map(stored.slim.map(a => [a.i, a]));
    for (const a of slim) {
        const prev = prevById.get(a.i);
        if (prev && prev.eh !== undefined) a.eh = prev.eh;
    }

    let newestTime = null;
    for (const a of all) {
        const ts = Math.floor(new Date(a.start_date).getTime() / 1000);
        if (ts && (!newestTime || ts > newestTime)) newestTime = ts;
    }

    let newActivities = 0, updated = 0;
    for (const a of slim) {
        const prev = prevById.get(a.i);
        if (!prev) newActivities++;
        else if (prev.n !== a.n || prev.e !== a.e || prev.t !== a.t) updated++;
    }
    const slimIds = new Set(slim.map(a => a.i));
    let removed = 0;
    for (const id of prevById.keys()) if (!slimIds.has(id)) removed++;

    const record = { slim, total, lastActivityTime: newestTime, syncedAt: Date.now() };
    await env.STRAVA_DATA.put(ACTIVITIES_KEY, JSON.stringify(record));

    // Keep hunter discovery attribution (the activity name shown for a county/
    // park/metro/pass discovery or peak summit) in step with renames. Best-effort
    // — never fail the sync over it.
    const nameById = new Map(slim.map(a => [a.i, a.n]));
    try {
        await refreshAttribution(env, nameById);
    } catch (e) {
        console.log(`attribution refresh failed: ${e.message}`);
    }

    return { ...record, newActivities, updated, removed };
}

// Non-streaming entry point (used by /activities/rebuild).
async function handleSync(env) {
    return json(await syncActivities(env));
}

// Streaming entry point for the manual force-sync: emits one NDJSON line per
// page fetched ({type:'progress', fetched}) so the client can drive a real
// progress bar, then a final {type:'done', …result} (or {type:'error'}).
function handleSyncStream(env) {
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const send = (obj) => writer.write(enc.encode(JSON.stringify(obj) + '\n')).catch(() => {});

    (async () => {
        try {
            const result = await syncActivities(env, (fetched) => send({ type: 'progress', fetched }));
            send({ type: 'done', ...result });
        } catch (e) {
            send({ type: 'error', error: e.message });
        } finally {
            await writer.close().catch(() => {});
        }
    })();

    return new Response(readable, {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/x-ndjson' },
    });
}

// Re-resolve the denormalized `actName` stored in each hunter's discovery blob
// against the freshly-synced activity names, keyed by activity id, and rewrite
// the blob only if something changed. This couples the worker to the discovery
// shapes the client writes:
//   counties/parks/state-parks/metro-hunter/passes → { discoveries: { key: { actId, actName, … } } }
//   summits → { visits: { peakId: [ { actId, actName, … } ] } }
async function refreshAttribution(env, nameById) {
    const apply = (entry) => {
        if (!entry || entry.actId == null) return false;
        const live = nameById.get(entry.actId);
        // Only overwrite with a real name; keep the existing label for deleted
        // activities (id no longer in the store) or blank names.
        if (live && live !== entry.actName) { entry.actName = live; return true; }
        return false;
    };

    const flatKeys = [COUNTIES_KEY, PARKS_KEY, STATE_PARKS_KEY, METRO_HUNTER_KEY, PASSES_KEY];
    for (const key of flatKeys) {
        const blob = await env.STRAVA_DATA.get(key, 'json');
        if (!blob || !blob.discoveries) continue;
        let changed = false;
        for (const d of Object.values(blob.discoveries)) {
            if (apply(d)) changed = true;
        }
        if (changed) await env.STRAVA_DATA.put(key, JSON.stringify(blob));
    }

    const summits = await env.STRAVA_DATA.get(SUMMITS_KEY, 'json');
    if (summits && summits.visits) {
        let changed = false;
        for (const visits of Object.values(summits.visits)) {
            if (!Array.isArray(visits)) continue;
            for (const v of visits) {
                if (apply(v)) changed = true;
            }
        }
        if (changed) await env.STRAVA_DATA.put(SUMMITS_KEY, JSON.stringify(summits));
    }
}

function slimActivities(activities) {
    return activities
        .filter(a => a.start_latlng?.length === 2)
        .map(a => ({
            l: a.start_latlng,
            t: a.sport_type || a.type || 'Other',
            p: a.map?.summary_polyline || '',
            n: a.name || '',
            d: a.start_date_local?.slice(0, 10) || '',
            i: a.id,
            e: a.total_elevation_gain ?? 0,
            m: a.moving_time ?? 0,   // seconds; feeds the dashboard's hours view
        }));
}

// Outdoor ride types whose high point (elev_high) we backfill for the Pass
// Hunter leaderboards. Mirrors PASS_ACTIVITY_TYPES on the client; VirtualRide
// is excluded since indoor rides have no real-world altitude.
const RIDE_TYPES = new Set(['Ride', 'GravelRide', 'EBikeRide', 'MountainBikeRide', 'Handcycle', 'Velomobile']);

// How many ride detail calls to make per backfill request. Kept well under the
// Workers subrequest cap (one Strava fetch each) and small enough that the
// client can pace calls to respect Strava's rate limit.
const ELEV_BACKFILL_BATCH = 20;

// The bulk activity list omits elev_high, so we fetch it per ride from the
// detail endpoint. Each slim ride gains an `eh` field: a number (high point in
// metres), or null once fetched with no elevation data — null is never retried.
// Rides with `eh === undefined` are still pending. Processes one batch per call
// and persists to KV so progress survives reloads; the client loops until done.
async function handleBackfillElev(env) {
    const stored = await env.STRAVA_DATA.get(ACTIVITIES_KEY, 'json');
    if (!stored || !Array.isArray(stored.slim)) {
        return json({ processed: 0, remaining: 0, rateLimited: false, updated: [] });
    }

    // Highest elevation-gain rides first: they're the ones most likely to top the
    // high-point leaderboard, so the visible top-25 stabilizes within a couple of
    // batches even when a full backfill of every ride would take many windows.
    const pending = stored.slim
        .filter(a => RIDE_TYPES.has(a.t) && a.i && a.eh === undefined)
        .sort((a, b) => (b.e || 0) - (a.e || 0));
    if (!pending.length) {
        return json({ processed: 0, remaining: 0, rateLimited: false, updated: [] });
    }

    const token = await getAccessToken(env);
    const byId = new Map(stored.slim.map(a => [a.i, a]));
    const batch = pending.slice(0, ELEV_BACKFILL_BATCH);
    const updated = [];
    let rateLimited = false;

    for (const ride of batch) {
        const res = await fetch(`https://www.strava.com/api/v3/activities/${ride.i}?include_all_efforts=false`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 429) { rateLimited = true; break; }

        // On any other failure (404/403/etc.) mark the ride as attempted (null)
        // so a permanently-unfetchable activity can't wedge the backfill loop.
        let eh = null;
        if (res.ok) {
            const detail = await res.json();
            if (typeof detail.elev_high === 'number') eh = detail.elev_high;
        }
        const slim = byId.get(ride.i);
        if (slim) { slim.eh = eh; updated.push({ i: ride.i, eh }); }
    }

    if (updated.length) {
        await env.STRAVA_DATA.put(ACTIVITIES_KEY, JSON.stringify(stored));
    }

    return json({
        processed: updated.length,
        remaining: pending.length - updated.length,
        rateLimited,
        updated,
    });
}

// ── Music — YouTube Music song leaderboard (D1) ──────────────────────────────
//
// Plays live in the MUSIC_DB D1 database (SQLite). The tables are created on
// first use, so a fresh, empty database bound as MUSIC_DB is all the setup
// needed. The sync script does the history diffing (get_history() has no
// timestamps, so new plays are found by comparing against the previous
// snapshot — see scripts/ytmusic/sync_history.py); the worker only stores.
//
//   songs(video_id PK, title, artists, album, duration_seconds, first_seen, last_seen)
//   plays(id, video_id, played_label, played_date, synced_at)
//   sync_state(key PK, value)  — 'snapshot' (JSON videoId list), 'last_sync'

const MUSIC_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS songs (
        video_id TEXT PRIMARY KEY, title TEXT NOT NULL, artists TEXT NOT NULL, album TEXT,
        duration_seconds INTEGER, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS plays (
        id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT NOT NULL REFERENCES songs(video_id),
        played_label TEXT, played_date TEXT, synced_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS plays_video_id ON plays(video_id)`,
    `CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

// D1 caps a statement at 100 bound parameters, so multi-row inserts are chunked.
const D1_MAX_PARAMS = 100;

let musicSchemaReady = false;

function isMusicWriter(request, env) {
    const token = request.headers.get('X-Music-Token');
    return (Boolean(token) && Boolean(env.MUSIC_SYNC_TOKEN) && token === env.MUSIC_SYNC_TOKEN)
        || isAdmin(request, env);
}

async function musicDb(env) {
    if (!env.MUSIC_DB) throw new Error('MUSIC_DB (D1) binding is not configured');
    if (!musicSchemaReady) {
        await env.MUSIC_DB.batch(MUSIC_SCHEMA.map(sql => env.MUSIC_DB.prepare(sql)));
        musicSchemaReady = true;
    }
    return env.MUSIC_DB;
}

async function musicState(db) {
    const { results } = await db.prepare('SELECT key, value FROM sync_state').all();
    const state = Object.fromEntries(results.map(r => [r.key, r.value]));
    return {
        snapshot: state.snapshot ? JSON.parse(state.snapshot) : [],
        last_sync: state.last_sync || null,
    };
}

async function handleMusicLeaderboard(url, env) {
    const db = await musicDb(env);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 100, 1), 500);
    const [board, totals, lastSync] = await db.batch([
        db.prepare(`
            SELECT s.title, s.artists, COUNT(*) AS plays,
                   MAX(COALESCE(p.played_date, substr(p.synced_at, 1, 10))) AS last_played
            FROM plays p JOIN songs s ON s.video_id = p.video_id
            GROUP BY p.video_id
            ORDER BY plays DESC, last_played DESC, s.title
            LIMIT ?`).bind(limit),
        db.prepare('SELECT COUNT(*) AS plays, COUNT(DISTINCT video_id) AS songs FROM plays'),
        db.prepare("SELECT value FROM sync_state WHERE key = 'last_sync'"),
    ]);
    return json({
        songs: board.results,
        total_plays: totals.results[0].plays,
        total_songs: totals.results[0].songs,
        last_sync: lastSync.results[0]?.value || null,
    }, 200, { 'Cache-Control': 'public, max-age=300' });
}

async function handleMusicState(env) {
    return json(await musicState(await musicDb(env)));
}

// Body: { expected_last_sync, synced_at, snapshot: [videoId],
//         songs: [{ video_id, title, artists, album, duration_seconds }],
//         plays: [{ video_id, played_label, played_date }]  (oldest first) }
// expected_last_sync must match the stored last_sync (null on the first run),
// so a sync computed against a stale snapshot is refused instead of
// double-counting. Everything is written in one batch, which D1 runs as a
// single transaction.
async function handleMusicPlays(request, env) {
    const db = await musicDb(env);
    const body = await request.json();
    const { synced_at, snapshot, songs = [], plays = [] } = body;
    if (!synced_at || !Array.isArray(snapshot) || !Array.isArray(songs) || !Array.isArray(plays)) {
        return json({ error: 'Expected synced_at, snapshot, songs and plays' }, 400);
    }
    const known = new Set(songs.map(s => s.video_id));
    if (plays.some(p => !known.has(p.video_id))) {
        return json({ error: 'Every play must reference a song in songs' }, 400);
    }

    const state = await musicState(db);
    if ((body.expected_last_sync ?? null) !== state.last_sync) {
        return json({ error: 'Stale snapshot', last_sync: state.last_sync }, 409);
    }

    const stmts = [];
    for (const chunk of chunked(songs, Math.floor(D1_MAX_PARAMS / 7))) {
        stmts.push(db.prepare(`
            INSERT INTO songs (video_id, title, artists, album, duration_seconds, first_seen, last_seen)
            VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}
            ON CONFLICT(video_id) DO UPDATE SET
                title = excluded.title,
                artists = excluded.artists,
                album = COALESCE(excluded.album, songs.album),
                duration_seconds = COALESCE(excluded.duration_seconds, songs.duration_seconds),
                last_seen = excluded.last_seen`)
            .bind(...chunk.flatMap(s => [s.video_id, s.title || '(unknown)', s.artists || '(unknown)',
                                         s.album ?? null, s.duration_seconds ?? null, synced_at, synced_at])));
    }
    for (const chunk of chunked(plays, Math.floor(D1_MAX_PARAMS / 4))) {
        stmts.push(db.prepare(`
            INSERT INTO plays (video_id, played_label, played_date, synced_at)
            VALUES ${chunk.map(() => '(?, ?, ?, ?)').join(', ')}`)
            .bind(...chunk.flatMap(p => [p.video_id, p.played_label ?? null, p.played_date ?? null, synced_at])));
    }
    stmts.push(db.prepare(`
        INSERT INTO sync_state (key, value) VALUES ('snapshot', ?), ('last_sync', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .bind(JSON.stringify(snapshot), synced_at));
    await db.batch(stmts);

    return json({ ok: true, songs: songs.length, plays: plays.length });
}

function chunked(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// ── Strava OAuth ─────────────────────────────────────────────────────────────

async function getAccessToken(env) {
    const cached = await env.STRAVA_KV.get('tokens', 'json');
    const now = Math.floor(Date.now() / 1000);

    if (cached?.access_token && cached.expires_at > now + 300) {
        return cached.access_token;
    }

    const res = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            client_id: env.CLIENT_ID,
            client_secret: env.CLIENT_SECRET,
            refresh_token: cached?.refresh_token,
            grant_type: 'refresh_token'
        })
    });

    const tokens = await res.json();
    if (!tokens.access_token) {
        throw new Error('Token refresh failed: ' + JSON.stringify(tokens));
    }

    await env.STRAVA_KV.put('tokens', JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: tokens.expires_at
    }));

    return tokens.access_token;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
    });
}

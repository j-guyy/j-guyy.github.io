// ── Cloudflare Worker for j-guyy.github.io ──────────────────────────────────
//
// KV-backed API for Strava activity data, geocoding cache, hunter features
// (counties, tiles, peaks, summits), and travel tracking; D1-backed YouTube
// Music song leaderboard; and an MCP server over all of it at /mcp.
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
const HR_KEY = 'strava_hr';   // per-activity heart rate histograms (see Heart rate zones)
const GEO_KEY        = 'strava_geo';
const COUNTIES_KEY   = 'strava_counties';
const TILES_KEY      = 'strava_tiles';
const PEAKS_KEY      = 'strava_peaks';
const HIDDEN_PEAKS_KEY = 'strava_hidden_peaks';
const PEAKS_META_KEY = 'strava_peaks_meta';   // { cells } of the last peak cache save
// Any visitor's page saves the Mountain Hunter caches, and a page whose load
// failed would save an almost empty copy over them (on 2026-10-22 one wiped
// 166 peak cells). A page only ever adds cells and summits, so a save holding
// far fewer than the stored copy is refused (409); /peaks/reset and
// /summits/reset clear the way for a deliberate fresh start.
const SHRINK_GUARD_RATIO = 0.9;
const SHRINK_GUARD_MIN = 10;
function shrinksTooMuch(stored, incoming) {
    return stored >= SHRINK_GUARD_MIN && incoming < stored * SHRINK_GUARD_RATIO;
}
const SUMMITS_KEY    = 'strava_summits';
const PARKS_KEY       = 'strava_parks';
const STATE_PARKS_KEY = 'strava_state_parks';
const METRO_HUNTER_KEY = 'strava_metro_hunter';
const ECOREGIONS_KEY  = 'strava_ecoregions';
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
    britishIsles:  'travel_british_isles',
    countryHighpoints: 'travel_country_highpoints',
    capitals:      'travel_capitals',
    worldCapitals: 'travel_world_capitals',
};

// Peak lists (Peaks dashboard): type → the field /travel/toggle matches `key`
// against. They store `climbed`, so the stored shape matches the static /data
// JSON files the map/quest pages fall back to. Country highpoints are keyed by
// country because one peak can top several (Everest, Mount Korab, …); a
// country whose mainland high point differs has a second row keyed
// "<country> (Mainland)" (Mulhacén next to Teide). State
// highpoints are a peak list too but predate these and keep their own
// `visited` branch, shared with the US dashboard.
const PEAK_LIST_KEYS = {
    adk46ers:          'name',
    colorado14ers:     'name',
    britishIsles:      'name',
    countryHighpoints: 'country',
};

// ── Router ───────────────────────────────────────────────────────────────────

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        // MCP clients connect from anywhere, so /mcp has its own CORS and
        // method handling (see handleMcp).
        if (path === '/mcp') {
            try {
                return await handleMcp(request, env);
            } catch (err) {
                return mcpJson(rpcError(null, -32603, err.message), 500);
            }
        }

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: CORS_HEADERS });
        }

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
            if (path === '/travel/british-isles')     return await handleTravelGet(env, 'britishIsles');
            if (path === '/travel/country-highpoints') return await handleTravelGet(env, 'countryHighpoints');
            if (path === '/travel/capitals')          return await handleTravelGet(env, 'capitals');
            if (path === '/travel/world-capitals')    return await handleTravelGet(env, 'worldCapitals');

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
                // The SyncRunner Durable Object runs the sync itself, so it
                // keeps going after the page that asked for it closes. Without
                // the binding (a dashboard paste), sync inside this request.
                if (!env.SYNC_RUNNER) return handleSyncStream(env);
                const join = url.searchParams.get('join') === '1';
                return await callSyncRunner(env, join ? '/sync?join=1' : '/sync');
            }
            if (path === '/activities/sync/status') {
                if (!isAdmin(request, env)) return unauthorized();
                if (!env.SYNC_RUNNER) return json({ state: 'idle', running: false });
                return await callSyncRunner(env, '/status');
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
            if (path === '/hr/all' && request.method === 'GET') {
                return await handleHrAll(env);
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
                const geo = mergeGeo(await env.STRAVA_DATA.get(GEO_KEY, 'json'), await request.json());
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
                // Passed through as stored: the blob holds ~190k peaks, and
                // parsing + re-serializing it costs the worker time and memory.
                const text = await env.STRAVA_DATA.get(PEAKS_KEY);
                return new Response(text || '{"cells":{}}', {
                    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
                });
            }
            if (path === '/peaks/save' && request.method === 'POST') {
                const data = await request.json();
                const cells = Object.keys(data.cells || {}).length;
                const meta = await env.STRAVA_DATA.get(PEAKS_META_KEY, 'json');
                if (shrinksTooMuch(meta?.cells || 0, cells)) {
                    return json({ ok: false, error: `refused: ${cells} cells would replace ${meta.cells}` }, 409);
                }
                await env.STRAVA_DATA.put(PEAKS_KEY, JSON.stringify(data));
                await env.STRAVA_DATA.put(PEAKS_META_KEY, JSON.stringify({ cells }));
                return json({ ok: true, cells });
            }
            if (path === '/peaks/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(PEAKS_KEY);
                await env.STRAVA_DATA.delete(PEAKS_META_KEY);
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

            // ── Ecoregion Hunter — EPA Level IV ecoregions ──
            // Data: { v, codes: [L4 code], processedIds: [...], discoveries: { code: { actId, actName, date } } }

            if (path === '/ecoregions/all') {
                const data = await env.STRAVA_DATA.get(ECOREGIONS_KEY, 'json');
                return json(data || { codes: [], processedIds: [], discoveries: {} });
            }
            if (path === '/ecoregions/save' && request.method === 'POST') {
                const data = await request.json();
                if (!data || !Array.isArray(data.codes) || !Array.isArray(data.processedIds)
                    || typeof data.discoveries !== 'object' || data.discoveries === null) {
                    return json({ error: 'Expected { codes: [], processedIds: [], discoveries: {} }' }, 400);
                }
                await env.STRAVA_DATA.put(ECOREGIONS_KEY, JSON.stringify(data));
                return json({ ok: true, ecoregions: data.codes.length });
            }
            if (path === '/ecoregions/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(ECOREGIONS_KEY);
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
                const stored = await env.STRAVA_DATA.get(SUMMITS_KEY, 'json');
                const before = Object.keys(stored?.visits || {}).length;
                const after = Object.keys(data.visits || {}).length;
                if (shrinksTooMuch(before, after)) {
                    return json({ ok: false, error: `refused: ${after} summited peaks would replace ${before}` }, 409);
                }
                await env.STRAVA_DATA.put(SUMMITS_KEY, JSON.stringify(data));
                return json({ ok: true, peaks: Object.keys(data.visits || {}).length });
            }
            if (path === '/summits/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(SUMMITS_KEY);
                return json({ ok: true });
            }

            // Summited peaks with their coordinates. The summit cache keys visits
            // by OSM id only, so this joins it with the peak cell cache for pages
            // outside strava.html (the Peaks dashboard) that match their own lists
            // against Strava without downloading every cached peak.
            if (path === '/summits/peaks' && request.method === 'GET') {
                return await handleSummitedPeaks(env);
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
            // One-off Google Takeout backfill (music.html's owner-only Import
            // button); admin password only.
            if (path === '/music/import' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                return await handleMusicImport(request, env);
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
        // The quarter-hourly cron only collects heart rate history (see Heart
        // rate zones); the nightly one syncs. The user worker runs its own
        // heart rate cron (USER_HR_CRON) itself and never passes it here.
        if (event?.cron === HR_CRON) {
            ctx.waitUntil(backfillHeartRate(env)
                .then(r => console.log(`heart rate backfill: ${JSON.stringify(r)}`))
                .catch(err => console.log(`heart rate backfill failed: ${err.message}`)));
            return;
        }
        // Through the SyncRunner when bound, so the cron and a manual "Sync
        // now" never run at the same time (a manual sync joins the cron's).
        if (env.SYNC_RUNNER) {
            ctx.waitUntil(callSyncRunner(env, '/start?geocode=1')
                .catch(err => console.log(`scheduled sync failed to start: ${err.message}`)));
            return;
        }
        ctx.waitUntil(
            syncActivities(env)
                .then(r => {
                    console.log(`scheduled sync: ${r.newActivities} new, ${r.updated} updated, ${r.removed} removed`);
                    return geocodeAfterSync(env, r.slim);
                })
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
//     ecoregion: { visited, total, l3Visited, l3Total },
//     tile:     { visited, maxCluster, maxSquare },
//     mountain: { summited, summits },
//     pass:     { climbed, total },
//     city:  { key, name, pct, complete, partial, total, ts } | null,
//     trail: { … same … } | null }
//
// Totals mirror the constants in js/strava.js (county stats bar, FEDERAL_PARK_TOTAL,
// STATE_PARK_TOTAL, METRO_TOTAL); keep them in step. Ecoregion totals are
// what the hunter counts from its boundary files: 967 lower-48 Level IV + 20
// Alaska regions, and 85 + 20 Level III.
const SUMMARY_TOTALS = { counties: 3233, parks: 897, stateParks: 5895, metros: 200, ecoL4: 987, ecoL3: 105 };

// Browsers/CDNs may reuse a summary for a few minutes — the numbers only move
// when someone opens a hunter and it saves new detections.
const SUMMARY_CACHE_SECONDS = 300;

async function handleSummary(env) {
    return json(await buildSummary(env), 200, { 'Cache-Control': `public, max-age=${SUMMARY_CACHE_SECONDS}` });
}

async function buildSummary(env) {
    const kv = env.STRAVA_DATA;
    const [activitiesText, counties, parks, stateParks, metros, tileStats, summits, hidden, passes, progress, ecoregions] =
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
            kv.get(ECOREGIONS_KEY, 'json'),
        ]);

    // Each hunter is derived independently so one malformed blob can't blank
    // the whole summary.
    const safe = (fn) => { try { return fn(); } catch (e) { console.log(`summary: ${e.message}`); return null; } };
    const count = (arr) => (Array.isArray(arr) ? arr.length : 0);

    return {
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
        ecoregion: ecoregions ? safe(() => summarizeEcoregions(ecoregions.codes)) : null,
        tile: await safeAsync(() => summarizeTileStats(env, tileStats)),
        mountain: summits ? safe(() => summarizeSummits(summits, hidden)) : null,
        pass: passes ? {
            climbed: Object.keys(passes.discoveries || {}).length || count(passes.ids),
            total: count(passes.catalogIds) || null,
        } : null,
        city: safe(() => headlineProgress(progress?.city)),
        trail: safe(() => headlineProgress(progress?.trail)),
    };
}

// Every Level IV code starts with its Level III code ("21a" → "21"), so the
// Level III count needs no boundary data.
function summarizeEcoregions(codes) {
    const l4 = Array.isArray(codes) ? codes.filter(c => typeof c === 'string') : [];
    const l3 = new Set(l4.map(c => (/^\d+/.exec(c) || [''])[0]).filter(Boolean));
    return { visited: l4.length, total: SUMMARY_TOTALS.ecoL4, l3Visited: l3.size, l3Total: SUMMARY_TOTALS.ecoL3 };
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

// Response: { peaks: [{ id, name, lat, lng, ele, activities, first, last }] }
// where first/last are { actId, actName, date } and activities counts distinct
// activities (a visit is one lap). Sub-peaks the owner hid are left out, like
// in summarizeSummits. A summited peak missing from the cell cache (its cell
// was reset) has no coordinates and is skipped until Mountain Hunter refetches it.
async function handleSummitedPeaks(env) {
    const peaks = await listSummitedPeaks(env);
    return json({ peaks }, 200, { 'Cache-Control': `public, max-age=${SUMMARY_CACHE_SECONDS}` });
}

async function listSummitedPeaks(env) {
    const [summits, peakCache, hidden] = await Promise.all([
        env.STRAVA_DATA.get(SUMMITS_KEY, 'json'),
        env.STRAVA_DATA.get(PEAKS_KEY, 'json'),
        env.STRAVA_DATA.get(HIDDEN_PEAKS_KEY, 'json'),
    ]);
    const visits = summits?.visits || {};
    const hiddenIds = new Set((hidden?.ids || []).map(Number));
    const peaks = [];
    const seen = new Set();
    // Hiker summits (data/hiker-summits.json) aren't in the cell cache; the
    // summit cache carries them as extraPeaks.
    const sources = Object.values(peakCache?.cells || {}).concat({ peaks: summits?.extraPeaks || [] });
    for (const cell of sources) {
        for (const p of cell.peaks || []) {
            const id = Number(p.id);
            const pvs = visits[id];
            if (!Array.isArray(pvs) || !pvs.length || hiddenIds.has(id) || seen.has(id)) continue;
            seen.add(id);
            const sorted = [...pvs].sort((a, b) => String(a.date).localeCompare(String(b.date))
                || (Number(a.actId) || 0) - (Number(b.actId) || 0));
            const brief = v => ({ actId: v.actId, actName: v.actName, date: v.date });
            peaks.push({
                id, name: p.name || '', lat: p.lat, lng: p.lng, ele: p.ele,
                activities: new Set(pvs.map(v => v.actId)).size,
                first: brief(sorted[0]),
                last: brief(sorted[sorted.length - 1]),
            });
        }
    }
    return peaks;
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
    // Race every mirror in parallel — first success wins. Wall clock max is one
    // attempt's worth (~22s), well under Cloudflare's 30s limit, and we get the
    // benefit of any mirror responding fast without random-mirror bad luck.
    // Only named peaks: unnamed ones are dropped below anyway, and leaving them
    // out keeps dense ranges (High Peaks, Lake District, Sawatch) within the
    // timeout instead of failing the whole cell.
    const query = `[out:json][timeout:20];(node["natural"="peak"]["ele"]["name"](${s},${w},${n},${e});node["natural"="volcano"]["ele"]["name"](${s},${w},${n},${e}););out body;`;
    const mirrors = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.private.coffee/api/interpreter',
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
        return json({ peaks: [], failed: true, errors: (err.errors || [err]).map(e => e.message) });
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
    } else if (type === 'highpoints' || type === 'capitals') {
        const item = data.find(p => p.state === key);
        if (item) {
            item.visited = !item.visited;
            toggled = true;
        }
    } else if (type === 'worldCapitals') {
        const item = data.find(c => c.country === key);
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
    } else if (PEAK_LIST_KEYS[type]) {
        const field = PEAK_LIST_KEYS[type];
        const item = data.find(p => p[field] === key);
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
        // An activity stored before distance was (no `di`) isn't an edit.
        else if (prev.n !== a.n || prev.e !== a.e || prev.t !== a.t ||
            (prev.di !== undefined && prev.di !== a.di)) updated++;
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

    // Bring the hunters up to date with the new activities, so they don't wait
    // for someone to open them on the site. Strava's full list is no longer
    // needed; drop it so detection has the isolate's memory to itself.
    all.length = 0;
    let hunters = null;
    try {
        hunters = await detectHuntersAfterSync(env, slim);
        console.log(`hunters after sync: ${JSON.stringify(hunters)}`);
    } catch (e) {
        console.log(`hunter detection failed: ${e.message}`);
    }

    return { ...record, newActivities, updated, removed, hunters };
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

// ── Background sync runner (Durable Object) ──────────────────────────────────
//
// A manual "Sync now" used to run inside the page's request, so leaving the
// page (or backgrounding the app) cancelled it part-way. The SyncRunner — one
// instance, named 'strava-sync' — runs the sync from an alarm instead, which
// lives on its own (up to 15 minutes) whoever is watching. Pages watch a run
// over an NDJSON stream: POST /sync starts a run (or joins the one already
// going) and streams {type:'progress', fetched} per Strava page, a
// {type:'ping'} every few seconds, and finally {type:'done', …result} or
// {type:'error'}. POST /sync?join=1 only joins: when nothing is running it
// answers with one {type:'idle', status} line, so a page that comes back
// after a run finished can pick up its result. The last run's status (no
// activity list — that is in KV) is kept in the object's storage for
// GET /status. Configured in wrangler.toml (binding SYNC_RUNNER + migration).

const SYNC_PING_MS = 5000;

async function callSyncRunner(env, path) {
    const stub = env.SYNC_RUNNER.get(env.SYNC_RUNNER.idFromName('strava-sync'));
    const res = await stub.fetch(`https://sync-runner${path}`, { method: 'POST' });
    return new Response(res.body, {
        status: res.status,
        headers: { ...CORS_HEADERS, 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
    });
}

export class SyncRunner {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        this.watchers = new Set(); // stream writers of the pages watching this run
        this.running = false;      // true while alarm() is syncing
        this.fetched = 0;          // activities fetched so far in this run
    }

    async getStatus() {
        return (await this.state.storage.get('status')) || { state: 'idle' };
    }

    // A run is going, or about to (the alarm is set but hasn't fired yet).
    async isRunning() {
        return this.running || (await this.state.storage.getAlarm()) !== null;
    }

    async fetch(request) {
        const url = new URL(request.url);
        const running = await this.isRunning();
        if (url.pathname === '/status') {
            const status = await this.getStatus();
            // Storage still saying 'running' with no run going means the run
            // was cut off (e.g. a deploy reset the object mid-sync).
            const state = !running && status.state === 'running' ? 'interrupted' : status.state;
            return json({ ...status, state, running, fetched: running ? this.fetched : status.fetched });
        }
        if (url.pathname === '/start' || url.pathname === '/sync') {
            if (!running) {
                if (url.searchParams.get('join') === '1') {
                    const status = await this.getStatus();
                    const state = status.state === 'running' ? 'interrupted' : status.state;
                    return ndjsonResponse(JSON.stringify({ type: 'idle', status: { ...status, state } }) + '\n');
                }
                const now = Date.now();
                this.fetched = 0;
                // The nightly run (?geocode=1) also looks up start places afterwards.
                const geocode = url.searchParams.get('geocode') === '1';
                await this.state.storage.put('status', { state: 'running', startedAt: now, updatedAt: now, fetched: 0, ...(geocode ? { geocode } : {}) });
                await this.state.storage.setAlarm(now);
            }
            if (url.pathname === '/start') return json({ ok: true, joined: running });
            return this.watch();
        }
        return json({ error: 'Not found' }, 404);
    }

    // A stream for one page; it starts with how far the run has got.
    watch() {
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        this.watchers.add(writer);
        this.send(writer, { type: 'progress', fetched: this.fetched });
        return ndjsonResponse(readable);
    }

    send(writer, obj) {
        // A page that went away fails the write; stop writing to it. The run
        // itself carries on.
        writer.write(new TextEncoder().encode(JSON.stringify(obj) + '\n'))
            .catch(() => this.watchers.delete(writer));
    }

    broadcast(obj) {
        for (const writer of this.watchers) this.send(writer, obj);
    }

    async alarm() {
        if (this.running) return;
        this.running = true;
        const { startedAt = Date.now(), geocode = false } = await this.getStatus();
        let synced = null;
        // Pings keep a watching page's stream visibly alive between pages, so
        // the page can tell a quiet stream from a dead one.
        const ping = setInterval(() => this.broadcast({ type: 'ping' }), SYNC_PING_MS);
        try {
            const result = await syncActivities(this.env, (fetched) => {
                this.fetched = fetched;
                this.broadcast({ type: 'progress', fetched });
                this.state.storage.put('status', { state: 'running', startedAt, updatedAt: Date.now(), fetched })
                    .catch(() => {});
            });
            const now = Date.now();
            await this.state.storage.put('status', {
                state: 'done', startedAt, updatedAt: now, finishedAt: now,
                fetched: result.total, total: result.total, syncedAt: result.syncedAt,
                newActivities: result.newActivities, updated: result.updated, removed: result.removed,
            });
            console.log(`sync: ${result.newActivities} new, ${result.updated} updated, ${result.removed} removed`);
            this.broadcast({ type: 'done', ...result });
            synced = result.slim;
        } catch (e) {
            const now = Date.now();
            await this.state.storage.put('status', {
                state: 'error', startedAt, updatedAt: now, finishedAt: now, fetched: this.fetched, error: e.message,
            }).catch(() => {});
            console.log(`sync failed: ${e.message}`);
            this.broadcast({ type: 'error', error: e.message });
        } finally {
            clearInterval(ping);
            this.running = false;
            for (const writer of this.watchers) writer.close().catch(() => {});
            this.watchers.clear();
        }
        // After the run is reported done, so no page waits on Nominatim.
        if (geocode && synced) await geocodeAfterSync(this.env, synced);
    }
}

function ndjsonResponse(body) {
    return new Response(body, { headers: { ...CORS_HEADERS, 'Content-Type': 'application/x-ndjson' } });
}

// Re-resolve the denormalized `actName` stored in each hunter's discovery blob
// against the freshly-synced activity names, keyed by activity id, and rewrite
// the blob only if something changed. This couples the worker to the discovery
// shapes the client writes:
//   counties/parks/state-parks/metro-hunter/ecoregions/passes → { discoveries: { key: { actId, actName, … } } }
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

    const flatKeys = [COUNTIES_KEY, PARKS_KEY, STATE_PARKS_KEY, METRO_HUNTER_KEY, ECOREGIONS_KEY, PASSES_KEY];
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

// ── Hunter detection after a sync ────────────────────────────────────────────
//
// County, Park (federal + state), Metro, Tile and Ecoregion Hunter used to
// update only when their map was opened on the site, so their results (and
// the MCP server's answers) lagged until then. Every sync — the nightly cron,
// "Sync now", rebuild, and each invited user's sync through user-worker.js —
// now runs the same detection here for activities a hunter hasn't processed
// yet, so they are current without a visit. The page still runs its own
// detection when a map opens; it finds nothing left to do.
//
// Each detector must match its counterpart in js/strava.js so both find the
// same places (change one, change the other):
//   polygon hunters  ↔ detectCountiesAsync / detectParksAsync / detectMetrosAsync
//   tiles            ↔ detectTilesAsync, plus computeClusters / computeSquares
//                      (summarizeTiles) for the stats saved with them
//   ecoregions       ↔ initEcoregionMap / detectEcoregionsAsync
//
// Detection is incremental (processedIds), so a run that stops early loses
// nothing: at most HUNTER_DETECT_MAX activities per hunter per sync, oldest
// first, which a hunter that has never run (a newly invited user) catches up
// on over a few syncs or a page visit. Results are merged into the latest
// stored copy (any visitor's page may have saved meanwhile) and never replace a
// stored first visit; a hunter reset meanwhile is left reset. A failure is
// logged and never fails the sync.

const HUNTER_DETECT_MAX = 500;

// Mirrors DISCOVERY_ORDER in js/strava.js: a hunter blob stamped with it has
// first visits picked in byStartTime order.
const DISCOVERY_ORDER = 1;

function byStartTime(a, b) {
    return (a.d || '').localeCompare(b.d || '')
        || ((a.s && b.s) ? a.s - b.s : 0)
        || (Number(a.i) || 0) - (Number(b.i) || 0);
}

function discoveryOrderStamp(slim) {
    return slim.some(a => a.s) ? DISCOVERY_ORDER : 0;
}

// decodePolyline in js/strava.js, as a flat [lat, lng, lat, lng, …] array.
function decodePolylineFlat(encoded) {
    const out = [];
    let index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        lat += (result & 1) ? ~(result >> 1) : (result >> 1);
        shift = 0; result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        lng += (result & 1) ? ~(result >> 1) : (result >> 1);
        out.push(lat / 1e5, lng / 1e5);
    }
    return Float64Array.from(out);
}

// Decoded once per sync and shared by every hunter.
function routePoints(act, cache) {
    let pts = cache.get(act.i);
    if (!pts) { pts = decodePolylineFlat(act.p); cache.set(act.i, pts); }
    return pts;
}

// pointInRing in js/strava.js, over a flat [lng, lat, …] ring.
function pointInFlatRing(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
        if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function flatRing(ring) {
    const out = new Float64Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) { out[2 * i] = ring[i][0]; out[2 * i + 1] = ring[i][1]; }
    return out;
}

function ringBox(ring, box) {
    for (let i = 0; i < ring.length; i += 2) {
        const x = ring[i], y = ring[i + 1];
        if (x < box.minLng) box.minLng = x;
        if (x > box.maxLng) box.maxLng = x;
        if (y < box.minLat) box.minLat = y;
        if (y > box.maxLat) box.maxLat = y;
    }
    return box;
}

const emptyBox = () => ({ minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity });

// buildSpatialIndex in js/strava.js: a 1° grid ("lng,lat" of the cell's floor)
// listing, in order, the entries whose box overlaps each cell.
function gridIndex(entries) {
    const index = new Map();
    for (const e of entries) {
        for (let x = Math.floor(e.minLng); x <= Math.floor(e.maxLng); x++) {
            for (let y = Math.floor(e.minLat); y <= Math.floor(e.maxLat); y++) {
                const key = `${x},${y}`;
                if (!index.has(key)) index.set(key, []);
                index.get(key).push(e);
            }
        }
    }
    return index;
}

// Boundary files are several MB, so unlike fetchSiteJson they aren't kept in
// the isolate between syncs; Cloudflare's cache still saves the download.
async function fetchBoundaryFile(path) {
    const res = await fetch(`${SITE_URL}/${path}`, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.json();
}

// Reads a hunter's blob and picks the activities it still has to process.
async function pendingFor(env, kvKey, slim, { sort = true } = {}) {
    const stored = await env.STRAVA_DATA.get(kvKey, 'json');
    const processed = new Set((stored?.processedIds || []).filter(Boolean));
    let pending = slim.filter(a => a.i && a.p && !processed.has(a.i));
    if (sort) pending.sort(byStartTime);
    const batch = pending.slice(0, HUNTER_DETECT_MAX);
    return { stored, batch, remaining: pending.length - batch.length };
}

function detectResult(batch, added, remaining) {
    return { processed: batch.length, added, ...(remaining > 0 ? { remaining } : {}) };
}

// ── County / Park / State Park / Metro ──

const POLYGON_HUNTERS = [
    { name: 'county',     kv: COUNTIES_KEY,     file: 'data/counties-us.json',     ids: 'fips', idOf: p => p.GEOID },
    { name: 'park',       kv: PARKS_KEY,        file: 'data/federal-lands.geojson', ids: 'ids',  idOf: p => p.id },
    { name: 'state_park', kv: STATE_PARKS_KEY,  file: 'data/state-parks.geojson',  ids: 'ids',  idOf: p => p.id },
    { name: 'metro',      kv: METRO_HUNTER_KEY, file: 'data/metro-areas.geojson',  ids: 'ids',  idOf: p => p.id },
];

// preprocessCounties / preprocessParks / preprocessMetros + computeFeatureBbox:
// each feature's outer rings (pointInFeature ignores holes) and a box over
// every ring.
function polygonEntries(geojson, idOf) {
    const entries = [];
    for (const feature of geojson.features || []) {
        const geom = feature.geometry;
        if (!geom) continue;
        const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
        const id = idOf(feature.properties || {});
        if (!id || !polys.length) continue;
        const box = emptyBox();
        for (const poly of polys) for (const ring of poly) ringBox(flatRing(ring), box);
        entries.push({ id, outer: polys.map(poly => flatRing(poly[0])), ...box });
    }
    return entries;
}

async function detectPolygonHunter(env, hunter, slim, cache) {
    const { stored, batch, remaining } = await pendingFor(env, hunter.kv, slim);
    const visited = new Set((stored?.[hunter.ids] || []).filter(Boolean));
    // Visits without first-visit history are rebuilt by the page's one-time
    // backfill, which only runs while the history is empty: leave them to it.
    if (visited.size && !Object.keys(stored?.discoveries || {}).length) return { skipped: 'awaiting page backfill' };
    if (!batch.length) return { processed: 0, added: 0 };

    const index = gridIndex(polygonEntries(await fetchBoundaryFile(hunter.file), hunter.idOf));
    const found = new Map();   // id → { actId, actName, date }
    for (const act of batch) {
        const pts = routePoints(act, cache);
        for (let k = 0; k < pts.length; k += 6) {   // every 3rd point
            const lat = pts[k], lng = pts[k + 1];
            const candidates = index.get(`${Math.floor(lng)},${Math.floor(lat)}`);
            if (!candidates) continue;
            for (const f of candidates) {
                if (visited.has(f.id) || found.has(f.id)) continue;
                if (lng < f.minLng || lng > f.maxLng || lat < f.minLat || lat > f.maxLat) continue;
                if (f.outer.some(ring => pointInFlatRing(lat, lng, ring))) {
                    found.set(f.id, { actId: act.i, actName: act.n || 'Untitled', date: act.d || '' });
                }
            }
        }
    }

    const latest = await env.STRAVA_DATA.get(hunter.kv, 'json');
    if (stored && !latest) return { skipped: 'reset during detection' };
    const ids = new Set((latest?.[hunter.ids] || []).filter(Boolean));
    const processedIds = new Set((latest?.processedIds || []).filter(Boolean));
    const discoveries = { ...(latest?.discoveries || {}) };
    for (const [id, d] of found) {
        ids.add(id);
        if (!discoveries[id]) discoveries[id] = d;
    }
    for (const a of batch) processedIds.add(a.i);
    const order = latest ? latest.order : discoveryOrderStamp(slim);
    await env.STRAVA_DATA.put(hunter.kv, JSON.stringify({
        ...(latest || {}),
        [hunter.ids]: [...ids],
        processedIds: [...processedIds],
        discoveries,
        ...(order !== undefined ? { order } : {}),
    }));
    return detectResult(batch, found.size, remaining);
}

// ── Tiles ──

const TILE_ZOOM = 14;
const TILE_SAMPLE_M = 200;

function tileKeyOf(lat, lng) {
    const n = Math.pow(2, TILE_ZOOM);
    const x = Math.floor((lng + 180) / 360 * n);
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return `${x},${y}`;
}

function metresApart(lat1, lng1, lat2, lng2) {
    const dlat = (lat2 - lat1) * 111320;
    const dlng = (lng2 - lng1) * 111320 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return Math.sqrt(dlat * dlat + dlng * dlng);
}

async function detectTiles(env, slim, cache) {
    // The page processes tiles in stored order; order can't change a tile set.
    const { stored, batch, remaining } = await pendingFor(env, TILES_KEY, slim, { sort: false });
    if (!batch.length) return { processed: 0, added: 0 };

    const found = new Set();
    for (const act of batch) {
        const pts = routePoints(act, cache);
        for (let k = 0; k < pts.length; k += 2) {
            const lat = pts[k], lng = pts[k + 1];
            found.add(tileKeyOf(lat, lng));
            if (k > 0) {   // addSegmentTiles: sample the segment every 200 m
                const lat1 = pts[k - 2], lng1 = pts[k - 1];
                const steps = Math.max(1, Math.ceil(metresApart(lat1, lng1, lat, lng) / TILE_SAMPLE_M));
                for (let s = 0; s <= steps; s++) {
                    const t = s / steps;
                    found.add(tileKeyOf(lat1 + (lat - lat1) * t, lng1 + (lng - lng1) * t));
                }
            }
        }
    }

    const latest = await env.STRAVA_DATA.get(TILES_KEY, 'json');
    if (stored && !latest) return { skipped: 'reset during detection' };
    const tiles = new Set((latest?.tiles || []).filter(Boolean));
    const before = tiles.size;
    for (const t of found) tiles.add(t);
    const processedIds = new Set((latest?.processedIds || []).filter(Boolean));
    for (const a of batch) processedIds.add(a.i);
    const tileList = [...tiles];
    await env.STRAVA_DATA.put(TILES_KEY, JSON.stringify({ ...(latest || {}), tiles: tileList, processedIds: [...processedIds] }));
    // The stats /summary shows, as the page's saveTilesToWorker sends them.
    await env.STRAVA_DATA.put(TILE_STATS_KEY, JSON.stringify(summarizeTiles(tileList)));
    return detectResult(batch, tiles.size - before, remaining);
}

// ── Ecoregions ──

const ECO_FILES = { topo: 'data/us-ecoregions.topojson', alaska: 'data/ak-ecoregions.geojson' };
const ECO_DETECT_VERSION = 2;    // ECO_DETECT_VERSION in js/strava.js
const ECO_CELL_PER_DEG = 1000;
const ECO_CELL_ROW = 720001;
const ECO_STEP_DEG = 0.002;
const ECO_MAX_GAP_DEG = 1;
const ECO_BOUNDS = [
    [24, -125.5, 50, -66.5],   // lower 48
    [51, -188, 72, -129.5],    // Alaska (western Aleutians as lng - 360)
];

// topojson.feature() (topojson-client 3.0.2) for the first object of a
// topology, polygons only, with each ring as a flat [lng, lat, …] array.
// Same arithmetic in the same order, so the coordinates match the page's.
function topojsonPolygons(topo) {
    const obj = topo.objects[Object.keys(topo.objects)[0]];
    const t = topo.transform;
    const kx = t ? t.scale[0] : 1, ky = t ? t.scale[1] : 1, dx = t ? t.translate[0] : 0, dy = t ? t.translate[1] : 0;
    // Each arc decoded once, as absolute coordinates.
    const arcs = topo.arcs.map(arc => {
        const out = new Float64Array(arc.length * 2);
        let x0 = 0, y0 = 0;
        for (let k = 0; k < arc.length; k++) {
            if (t) { out[2 * k] = (x0 += arc[k][0]) * kx + dx; out[2 * k + 1] = (y0 += arc[k][1]) * ky + dy; }
            else { out[2 * k] = arc[k][0]; out[2 * k + 1] = arc[k][1]; }
        }
        return out;
    });
    const ring = (arcIds) => {
        const pts = [];
        for (const i of arcIds) {
            if (pts.length) pts.length -= 2;              // drop the shared point
            const a = arcs[i < 0 ? ~i : i];
            const n = a.length / 2, start = pts.length;
            for (let k = 0; k < n; k++) pts.push(a[2 * k], a[2 * k + 1]);
            if (i < 0) {                                  // reverse the n points just added
                for (let lo = start, hi = pts.length - 2; lo < hi; lo += 2, hi -= 2) {
                    const x = pts[lo], y = pts[lo + 1];
                    pts[lo] = pts[hi]; pts[lo + 1] = pts[hi + 1];
                    pts[hi] = x; pts[hi + 1] = y;
                }
            }
        }
        if (pts.length < 4) pts.push(pts[0], pts[1]);     // line(): fewer than 2 points
        while (pts.length < 8) pts.push(pts[0], pts[1]);  // ring(): fewer than 4 points
        return Float64Array.from(pts);
    };
    return obj.geometries.map(g => ({
        properties: g.properties || {},
        polygons: g.type === 'Polygon' ? [g.arcs.map(ring)]
            : g.type === 'MultiPolygon' ? g.arcs.map(p => p.map(ring)) : null,
    }));
}

// initEcoregionMap's patch list: the TopoJSON features with a geometry, then
// the Alaska features, split into one entry per polygon (splitEcoPatches),
// each with its outer ring's box (preprocessEcoregions). The patch id is the
// index here, so the order must match the page's exactly.
function ecoPatches(topo, alaska) {
    const features = topojsonPolygons(topo).filter(f => f.polygons)
        .concat((alaska.features || []).filter(f => f.geometry).map(f => ({
            properties: f.properties || {},
            polygons: f.geometry.type === 'Polygon' ? [f.geometry.coordinates.map(flatRing)]
                : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map(p => p.map(flatRing)) : [],
        })));
    const patches = [];
    for (const f of features) {
        for (const rings of f.polygons) {
            if (!rings.length) continue;
            patches.push({ patch: patches.length, code: f.properties.US_L4CODE, rings, ...ringBox(rings[0], emptyBox()) });
        }
    }
    return patches;
}

// ecoPolyContains: inside the outer ring and in none of the holes.
function ecoContains(p, lat, lng) {
    if (lng < p.minLng || lng > p.maxLng || lat < p.minLat || lat > p.maxLat) return false;
    if (!pointInFlatRing(lat, lng, p.rings[0])) return false;
    for (let k = 1; k < p.rings.length; k++) if (pointInFlatRing(lat, lng, p.rings[k])) return false;
    return true;
}

async function detectEcoregions(env, slim, cache) {
    const { stored, batch, remaining } = await pendingFor(env, ECOREGIONS_KEY, slim);
    if (!batch.length) return { processed: 0, added: 0 };

    const [topo, alaska] = await Promise.all([fetchBoundaryFile(ECO_FILES.topo), fetchBoundaryFile(ECO_FILES.alaska)]);
    const patches = ecoPatches(topo, alaska);
    const usable = (blob) => blob && blob.v === ECO_DETECT_VERSION && blob.patchCount === patches.length
        && !((Number(blob.order) || 0) < DISCOVERY_ORDER && slim.some(a => a.s));
    // Saved under another detection version or boundary set: the page discards
    // it and rescans everything when Ecoregion Hunter opens. Leave that to it.
    if (stored && !usable(stored)) return { skipped: 'awaiting page rescan' };

    const knownCodes = new Set(patches.map(p => p.code));
    const visited = new Set((stored?.codes || []).filter(c => knownCodes.has(c)));
    const patchFirst = new Set(Object.keys(stored?.patches || {}).map(Number));
    const index = gridIndex(patches);

    // Distinct ~100 m cells, each with the first (oldest) activity reaching it.
    const firstAct = new Map();
    const addCell = (lat, lng, ai) => {
        if (!ECO_BOUNDS.some(([s, w, n, e]) => lat >= s && lat <= n && lng >= w && lng <= e)) return;
        const key = (Math.round(lat * ECO_CELL_PER_DEG) + 90 * ECO_CELL_PER_DEG) * ECO_CELL_ROW
                  + (Math.round(lng * ECO_CELL_PER_DEG) + 360 * ECO_CELL_PER_DEG);
        if (!firstAct.has(key)) firstAct.set(key, ai);
    };
    for (let ai = 0; ai < batch.length; ai++) {
        const pts = routePoints(batch[ai], cache);
        let prevLat = null, prevLng = null;
        for (let k = 0; k < pts.length; k += 2) {
            const lat = pts[k], rawLng = pts[k + 1];
            const lng = rawLng > 170 ? rawLng - 360 : rawLng;
            if (prevLat !== null) {
                const dLat = lat - prevLat, dLng = lng - prevLng;
                const span = Math.max(Math.abs(dLat), Math.abs(dLng));
                if (span > ECO_STEP_DEG && span < ECO_MAX_GAP_DEG) {
                    const steps = Math.ceil(span / ECO_STEP_DEG);
                    for (let s = 1; s < steps; s++) addCell(prevLat + dLat * s / steps, prevLng + dLng * s / steps, ai);
                }
            }
            addCell(lat, lng, ai);
            prevLat = lat;
            prevLng = lng;
        }
    }

    const newCodes = new Map();     // code → discovery
    const newPatches = new Map();   // patch id → first activity id
    let last = null;
    for (const [key, ai] of firstAct) {
        const lat = (Math.floor(key / ECO_CELL_ROW) - 90 * ECO_CELL_PER_DEG) / ECO_CELL_PER_DEG;
        const lng = ((key % ECO_CELL_ROW) - 360 * ECO_CELL_PER_DEG) / ECO_CELL_PER_DEG;
        let hit = null;
        if (last && ecoContains(last, lat, lng)) {
            hit = last;
        } else {
            const candidates = index.get(`${Math.floor(lng)},${Math.floor(lat)}`);
            if (candidates) hit = candidates.find(p => ecoContains(p, lat, lng)) || null;
        }
        if (!hit) continue;
        last = hit;
        const act = batch[ai];
        if (!patchFirst.has(hit.patch) && !newPatches.has(hit.patch)) newPatches.set(hit.patch, act.i);
        if (visited.has(hit.code) || newCodes.has(hit.code)) continue;
        newCodes.set(hit.code, { actId: act.i, actName: act.n || 'Untitled', date: act.d || '' });
    }

    const latest = await env.STRAVA_DATA.get(ECOREGIONS_KEY, 'json');
    if (stored && !latest) return { skipped: 'reset during detection' };
    if (latest && !usable(latest)) return { skipped: 'rescanned during detection' };
    const codes = new Set((latest?.codes || []).filter(c => knownCodes.has(c)));
    const discoveries = { ...(latest?.discoveries || {}) };
    for (const [code, d] of newCodes) {
        codes.add(code);
        if (!discoveries[code]) discoveries[code] = d;
    }
    const patchMap = { ...(latest?.patches || {}) };
    for (const [id, actId] of newPatches) if (patchMap[id] === undefined) patchMap[id] = actId;
    const processedIds = new Set((latest?.processedIds || []).filter(Boolean));
    for (const a of batch) processedIds.add(a.i);
    await env.STRAVA_DATA.put(ECOREGIONS_KEY, JSON.stringify({
        ...(latest || {}),
        v: ECO_DETECT_VERSION,
        patchCount: patches.length,
        patches: patchMap,
        codes: [...codes],
        processedIds: [...processedIds],
        discoveries,
        order: latest ? latest.order : discoveryOrderStamp(slim),
    }));
    return { ...detectResult(batch, newCodes.size, remaining), patches: newPatches.size };
}

// Runs every hunter in turn, one boundary file set in memory at a time.
// Returns { county: { processed, added, remaining? }, … }, or { error } /
// { skipped } per hunter.
async function detectHuntersAfterSync(env, slim) {
    const cache = new Map();   // activity id → decoded route, shared by the hunters
    const jobs = [
        ...POLYGON_HUNTERS.map(h => [h.name, () => detectPolygonHunter(env, h, slim, cache)]),
        ['tile', () => detectTiles(env, slim, cache)],
        ['ecoregion', () => detectEcoregions(env, slim, cache)],
    ];
    const results = {};
    for (const [name, run] of jobs) {
        try {
            results[name] = await run();
        } catch (e) {
            console.log(`${name} detection failed: ${e.message}`);
            results[name] = { error: e.message };
        }
    }
    return results;
}

// ── Start-place geocoding after sync ──
//
// The page names each activity's start cell (gridKey: lat/lng to 2 decimals)
// with Nominatim at 1.1 s per cell, which only runs while the page is open, so
// a new account waits days of visits for its older trips. After each sync the
// worker looks up up to GEOCODE_MAX_PER_SYNC cells the page hasn't: cells with
// no country first, then ones missing their region, then the ones the page
// placed provisionally from region boundaries (`b`, which can be off on a
// border). Results are merged into the latest stored cache, since a page may
// have saved meanwhile.
//
// Mirrors geocodeKey / needsSubdivision / isoSubdivision / cityAsSubdivision /
// cleanSubdivision in js/strava.js (change both).

const GEOCODE_MAX_PER_SYNC = 40;   // well under the Workers subrequest cap
const GEOCODE_GAP_MS = 1500;       // Nominatim allows 1 request a second
const GEOCODE_RETRY_MS = 30 * 86400 * 1000;   // a cell Nominatim can't place (open sea) waits this long

// SUBDIVISION_CONFIG names in js/strava.js: countries whose cells need a region.
const SUBDIVISION_COUNTRIES = new Set([
    'United States', 'United States of America', 'United States of America (the)',
    'Canada', 'Australia', 'Mexico', 'China', 'Hong Kong', 'Macau', 'Macao', 'Spain', 'Italy',
]);
const CHINA_NAMES = new Set(['China', 'Hong Kong', 'Macau', 'Macao']);

const GEO_REGION_BY_ISO = {
    'CN-BJ': 'Beijing', 'CN-SH': 'Shanghai', 'CN-TJ': 'Tianjin', 'CN-CQ': 'Chongqing',
    'CN-HK': 'Hong Kong', 'CN-MO': 'Macau', hk: 'Hong Kong', mo: 'Macau',
};

function geoGridKey(latlng) {
    return `${latlng[0].toFixed(2)},${latlng[1].toFixed(2)}`;
}

function geoNeedsSubdivision(v) {
    if (!SUBDIVISION_COUNTRIES.has(v.c)) return false;
    if (!v.s) return true;
    return CHINA_NAMES.has(v.c) && / (District|County)$/.test(v.s);
}

// 0 = no country yet, 1 = no region yet, 2 = placed from boundaries, null = done.
function geoCellPriority(v) {
    if (!v || !v.c || v.c === 'Unknown') return 0;
    if (geoNeedsSubdivision(v)) return 1;
    if (v.b) return 2;
    return null;
}

function geoSubdivision(addr) {
    const iso = GEO_REGION_BY_ISO[addr['ISO3166-2-lvl4']] || GEO_REGION_BY_ISO[addr['ISO3166-2-lvl3']]
        || GEO_REGION_BY_ISO[addr.country_code];
    const city = addr['ISO3166-2-lvl4'] ? (addr.city || addr.municipality || addr.county || '') : '';
    const raw = iso || addr.state || addr.territory || addr.province || city;
    return raw
        ? raw.replace(/ Province$/, '').replace(/ Autonomous Region$/, '').replace(/ Municipality$/, '')
            .replace(/ Special Administrative Region$/, '').trim()
        : '';
}

// One Nominatim lookup: { c, s }, or null when Nominatim refused (stop for
// now) — a cell it can't place comes back as country 'Unknown'.
async function geocodeCell(lat, lng) {
    const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en`,
        { headers: { 'User-Agent': 'j-guyy.github.io strava-worker', Referer: `${SITE_URL}/` } },
    );
    if (!res.ok) {
        console.log(`Nominatim HTTP ${res.status} for ${lat},${lng}`);
        return null;
    }
    const addr = (await res.json()).address || {};
    return { c: addr.country || 'Unknown', s: geoSubdivision(addr) };
}

// A page's /geo/save sends its whole cache, which can predate cells the worker
// looked up after a sync: keep a stored cell wherever the saved one is less
// complete (none < no region < placed from boundaries < geocoded).
const geoRank = v => { const p = geoCellPriority(v); return p === null ? 3 : p; };
function mergeGeo(stored, incoming) {
    const merged = { ...(stored || {}) };
    for (const [key, v] of Object.entries(incoming || {})) {
        if (geoRank(v) >= geoRank(merged[key])) merged[key] = v;
    }
    return merged;
}

// Never fails the sync it follows.
async function geocodeAfterSync(env, slim) {
    try {
        console.log(`geocoding after sync: ${JSON.stringify(await geocodeCellsAfterSync(env, slim))}`);
    } catch (e) {
        console.log(`geocoding after sync failed: ${e.message}`);
    }
}

async function geocodeCellsAfterSync(env, slim) {
    const stored = (await env.STRAVA_DATA.get(GEO_KEY, 'json')) || {};
    const todo = [];
    const seen = new Set();
    for (const a of slim) {
        if (!Array.isArray(a.l) || a.l.length < 2) continue;
        const key = geoGridKey(a.l);
        if (seen.has(key)) continue;
        seen.add(key);
        const v = stored[key];
        if (v?.t && Date.now() - v.t < GEOCODE_RETRY_MS) continue;   // Nominatim had nothing lately
        const priority = geoCellPriority(v);
        if (priority !== null) todo.push({ key, priority });
    }
    if (!todo.length) return { looked: 0, resolved: 0, remaining: 0 };
    todo.sort((x, y) => x.priority - y.priority);   // stable: newest activity first within a tier

    const found = {};
    let looked = 0;
    for (const { key } of todo.slice(0, GEOCODE_MAX_PER_SYNC)) {
        if (looked) await new Promise(r => setTimeout(r, GEOCODE_GAP_MS));
        const [lat, lng] = key.split(',').map(Number);
        let result;
        try { result = await geocodeCell(lat, lng); }
        catch (e) { console.log(`Nominatim error for ${key}: ${e.message}`); result = null; }
        looked++;
        if (!result) break;
        // Remember a miss so it doesn't take a place in every night's batch.
        found[key] = result.c === 'Unknown' ? { c: 'Unknown', s: '', t: Date.now() } : result;
    }

    const resolved = Object.values(found).filter(v => v.c !== 'Unknown').length;
    if (Object.keys(found).length) {
        const latest = (await env.STRAVA_DATA.get(GEO_KEY, 'json')) || {};
        for (const [key, v] of Object.entries(found)) {
            // Keep a cell the page geocoded meanwhile.
            if (geoCellPriority(latest[key]) === null) continue;
            latest[key] = v;
        }
        await env.STRAVA_DATA.put(GEO_KEY, JSON.stringify(latest));
    }
    return { looked, resolved, remaining: todo.length - looked };
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
            // Start time (epoch s): orders same-day activities, so a hunter's
            // first visit is the earliest activity that day, not the latest.
            s: Math.floor(Date.parse(a.start_date) / 1000) || 0,
            i: a.id,
            e: a.total_elevation_gain ?? 0,
            m: a.moving_time ?? 0,   // seconds; feeds the dashboard's hours view
            di: Math.round(a.distance ?? 0),   // metres; read by the MCP tools
            // Average / max heart rate (bpm), only on activities recorded with
            // a heart rate monitor. Time in each zone comes from /hr/all.
            ...(a.has_heartrate && a.average_heartrate
                ? { hr: Math.round(a.average_heartrate), hm: Math.round(a.max_heartrate || 0) }
                : {}),
        }));
}

// ── Heart rate zones ─────────────────────────────────────────────────────────
//
// Time in each heart rate zone needs the activity's heart rate stream, one
// Strava call per activity. Strava's read limit (about 100 per 15 min, 1,000 a
// day) is shared with the nightly sync and every invited user's sync, so the
// history fills in slowly: a quarter-hourly cron (HR_CRON, also listed in
// wrangler.toml) fetches up to HR_MAX_PER_RUN streams, newest activity first,
// and stops early once Strava's rate-limit headers say a share of the window
// is used up. New activities are picked up within 15 minutes of a sync.
//
// Each activity is stored as a histogram, not zone totals, so the Dashboard
// can apply any zone limits (Strava's, or its own from max HR) without
// refetching: seconds per HR_BIN bpm bin from HR_BASE bpm up.
//   strava_hr: { v, h: { <id>: [firstBin, sec, sec, …] | 0 (no stream) },
//                zones: [{min, max}, …] | null, zonesAt }
const HR_CRON = '7,22,37,52 * * * *';
const HR_BIN = 5;
const HR_BASE = 40;
const HR_MAX_PER_RUN = 40;          // under the Workers 50-subrequest cap
const HR_SHARE_15MIN = 0.5;         // leave half of each 15-min window to syncs
const HR_SHARE_DAY = 0.6;
const HR_GAP_CAP_S = 30;            // a longer gap between samples is a pause
const HR_ZONES_TTL_MS = 7 * 24 * 3600 * 1000;

async function handleHrAll(env) {
    const [stored, acts] = await Promise.all([
        env.STRAVA_DATA.get(HR_KEY, 'json'),
        env.STRAVA_DATA.get(ACTIVITIES_KEY, 'json'),
    ]);
    const h = stored?.h || {};
    const withHr = (acts?.slim || []).filter(a => a.hr);
    const pending = withHr.filter(a => !(a.i in h)).length;
    return json({
        bin: HR_BIN, base: HR_BASE,
        zones: stored?.zones || null,
        withHr: withHr.length, pending,
        h,
    }, 200, { 'Cache-Control': 'public, max-age=300' });
}

// Seconds per bin from Strava's heartrate + time streams.
function hrHistogram(hrData, timeData) {
    const bins = [];
    for (let k = 0; k < hrData.length; k++) {
        const bpm = hrData[k];
        if (!bpm) continue;
        const dt = k + 1 < timeData.length ? timeData[k + 1] - timeData[k] : 1;
        if (!(dt > 0)) continue;
        const b = Math.max(0, Math.floor((bpm - HR_BASE) / HR_BIN));
        bins[b] = (bins[b] || 0) + Math.min(dt, HR_GAP_CAP_S);
    }
    let first = bins.findIndex(v => v);
    if (first < 0) return 0;
    const out = [first];
    for (let b = first; b < bins.length; b++) out.push(bins[b] || 0);
    return out;
}

// "used15,usedDay" vs "limit15,limitDay" from a Strava response: true when
// the backfill should leave the rest of the window to the syncs.
function hrNearLimit(res) {
    const usage = (res.headers.get('X-ReadRateLimit-Usage') || res.headers.get('X-RateLimit-Usage') || '').split(',').map(Number);
    const limit = (res.headers.get('X-ReadRateLimit-Limit') || res.headers.get('X-RateLimit-Limit') || '').split(',').map(Number);
    if (usage.length < 2 || limit.length < 2 || !limit[0] || !limit[1]) return false;
    return usage[0] >= limit[0] * HR_SHARE_15MIN || usage[1] >= limit[1] * HR_SHARE_DAY;
}

export async function backfillHeartRate(env) {
    const acts = await env.STRAVA_DATA.get(ACTIVITIES_KEY, 'json');
    const slim = acts?.slim || [];
    const stored = (await env.STRAVA_DATA.get(HR_KEY, 'json')) || { v: 1, h: {}, zones: null, zonesAt: 0 };
    const h = stored.h || (stored.h = {});
    const pending = slim.filter(a => a.hr && a.i && !(a.i in h)).sort((a, b) => (b.s || 0) - (a.s || 0));
    const zonesStale = !stored.zonesAt || Date.now() - stored.zonesAt > HR_ZONES_TTL_MS;
    if (!pending.length && !zonesStale) return { fetched: 0, pending: 0 };

    const token = await getAccessToken(env);
    const auth = { headers: { Authorization: `Bearer ${token}` } };
    let changed = false, fetched = 0, stop = null;

    // The athlete's own zone limits (needs the profile:read_all scope; without
    // it the Dashboard falls back to zones from max HR).
    if (zonesStale) {
        stored.zonesAt = Date.now();
        changed = true;
        try {
            const res = await fetch('https://www.strava.com/api/v3/athlete/zones', auth);
            if (res.ok) {
                const z = (await res.json())?.heart_rate?.zones;
                if (Array.isArray(z) && z.length >= 3) stored.zones = z.map(({ min, max }) => ({ min, max }));
            }
            if (res.status === 429 || hrNearLimit(res)) stop = 'rate limit';
        } catch (e) { console.log(`hr zones: ${e.message}`); }
    }

    for (const a of pending.slice(0, stop ? 0 : HR_MAX_PER_RUN)) {
        const res = await fetch(`https://www.strava.com/api/v3/activities/${a.i}/streams?keys=heartrate,time&key_by_type=true`, auth);
        if (res.status === 429) { stop = 'rate limited'; break; }
        if (res.ok) {
            const st = await res.json();
            const hr = st?.heartrate?.data, time = st?.time?.data;
            h[a.i] = Array.isArray(hr) && Array.isArray(time) ? hrHistogram(hr, time) : 0;
        } else if (res.status === 404) {
            h[a.i] = 0;
        } else {
            stop = `HTTP ${res.status}`;
            break;
        }
        fetched++;
        changed = true;
        if (hrNearLimit(res)) { stop = 'rate limit'; break; }
    }

    if (changed) {
        // Drop activities deleted on Strava.
        const ids = new Set(slim.map(a => String(a.i)));
        for (const id of Object.keys(h)) if (!ids.has(id)) delete h[id];
        await env.STRAVA_DATA.put(HR_KEY, JSON.stringify(stored));
    }
    return { fetched, pending: pending.length - fetched, stop };
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
// Plays live in the MUSIC_DB D1 database (SQLite). The tables are created (and
// migrated) on first use, so a fresh, empty database bound as MUSIC_DB is all
// the setup needed. Plays come from two sources:
//   * 'sync'    — the daily sync (scripts/ytmusic/sync_history.py). get_history()
//                 has no timestamps, so the script finds new plays by diffing
//                 against the previous snapshot; the worker only stores them.
//                 played_at is NULL; synced_at is when the play was detected.
//   * 'takeout' — a one-off Google Takeout backfill (POST /music/import), with
//                 each play's real timestamp in played_at.
//
//   songs(video_id PK, title, artists, album, duration_seconds, first_seen, last_seen)
//   plays(id, video_id, played_label, played_date, synced_at, played_at, source)
//   sync_state(key PK, value)  — 'snapshot' (JSON videoId list), 'last_sync',
//                                'baseline_sync' (the first sync's synced_at),
//                                'takeout_import' (JSON summary of the last import)

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

// Columns added after the first release; musicDb() adds whichever are missing.
const MUSIC_PLAYS_COLUMNS = { played_at: 'TEXT', source: "TEXT NOT NULL DEFAULT 'sync'" };

// Rows per json_each() statement in /music/import, keeping each bound JSON
// string well under D1's 2 MB value limit.
const MUSIC_IMPORT_CHUNK = 2000;

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
        const db = env.MUSIC_DB;
        await db.batch(MUSIC_SCHEMA.map(sql => db.prepare(sql)));
        const { results } = await db.prepare('PRAGMA table_info(plays)').all();
        const have = new Set(results.map(c => c.name));
        const missing = Object.entries(MUSIC_PLAYS_COLUMNS).filter(([name]) => !have.has(name));
        if (missing.length) {
            await db.batch(missing.map(([name, type]) => db.prepare(`ALTER TABLE plays ADD COLUMN ${name} ${type}`)));
        }
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
        baseline_sync: state.baseline_sync || null,
        takeout_import: state.takeout_import ? JSON.parse(state.takeout_import) : null,
    };
}

async function handleMusicLeaderboard(url, env) {
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit'), 10) || 100, 1), 500);
    return json(await musicLeaderboard(env, limit), 200, { 'Cache-Control': 'public, max-age=300' });
}

async function musicLeaderboard(env, limit) {
    const db = await musicDb(env);
    const [board, totals, lastSync] = await db.batch([
        db.prepare(`
            SELECT s.title, s.artists, COUNT(*) AS plays,
                   MAX(COALESCE(substr(p.played_at, 1, 10), p.played_date, substr(p.synced_at, 1, 10))) AS last_played,
                   MAX(COALESCE(p.played_at, p.synced_at)) AS last_ts
            FROM plays p JOIN songs s ON s.video_id = p.video_id
            GROUP BY p.video_id
            ORDER BY plays DESC, last_ts DESC, s.title
            LIMIT ?`).bind(limit),
        db.prepare('SELECT COUNT(*) AS plays, COUNT(DISTINCT video_id) AS songs FROM plays'),
        db.prepare("SELECT value FROM sync_state WHERE key = 'last_sync'"),
    ]);
    return {
        songs: board.results.map(({ last_ts, ...song }) => song),
        total_plays: totals.results[0].plays,
        total_songs: totals.results[0].songs,
        last_sync: lastSync.results[0]?.value || null,
    };
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
            INSERT INTO plays (video_id, played_label, played_date, synced_at, source)
            VALUES ${chunk.map(() => "(?, ?, ?, ?, 'sync')").join(', ')}`)
            .bind(...chunk.flatMap(p => [p.video_id, p.played_label ?? null, p.played_date ?? null, synced_at])));
    }
    stmts.push(db.prepare(`
        INSERT INTO sync_state (key, value) VALUES ('snapshot', ?), ('last_sync', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .bind(JSON.stringify(snapshot), synced_at));
    if (state.last_sync === null) {
        // The first sync can't diff against anything, so it records every song
        // in the history once. /music/import replaces it with real counts.
        stmts.push(db.prepare("INSERT OR IGNORE INTO sync_state (key, value) VALUES ('baseline_sync', ?)")
            .bind(synced_at));
    }
    await db.batch(stmts);

    return json({ ok: true, songs: songs.length, plays: plays.length });
}

// Body: { plays: [[video_id, title, artist, played_at], ...] }, played_at an
// ISO-8601 UTC timestamp — the YouTube Music entries of a Takeout
// watch-history.json, parsed in the browser by js/music.js.
//
// Replaces, in one transaction, the sync plays the export makes redundant:
//   * the baseline sync (every song once — a placeholder, not real counts);
//   * every sync up to `cutoff`, the last sync at or before the export's newest
//     play. Takeout plays after `cutoff` are dropped instead: the next sync
//     after `cutoff` already counted them, by diffing against that snapshot.
// Previously imported Takeout plays are replaced too, so importing a newer
// export later is safe.
async function handleMusicImport(request, env) {
    const db = await musicDb(env);
    const { plays } = await request.json();
    const valid = Array.isArray(plays) && plays.length > 0 && plays.every(p =>
        Array.isArray(p) && p.length === 4 && p.every(v => typeof v === 'string' && v)
        && !Number.isNaN(Date.parse(p[3])));
    if (!valid) return json({ error: 'Expected plays: [[video_id, title, artist, played_at], ...]' }, 400);

    const rows = plays
        .map(([vid, title, artist, at]) => [vid, title, artist, new Date(at).toISOString()])
        .sort((a, b) => a[3].localeCompare(b[3]));  // ascending, so play ids follow time
    const newest = rows[rows.length - 1][3];

    const state = await musicState(db);
    const { results: syncs } = await db.prepare(
        "SELECT DISTINCT synced_at FROM plays WHERE source = 'sync' ORDER BY synced_at").all();
    const syncTimes = syncs.map(r => r.synced_at);
    // Older databases predate 'baseline_sync'; before any import their first
    // sync is the baseline.
    const baseline = state.baseline_sync || (state.takeout_import ? null : syncTimes[0] || null);
    const cutoffSync = syncTimes.filter(t => Date.parse(t) <= Date.parse(newest)).pop() || null;
    const cutoff = cutoffSync ? new Date(cutoffSync).toISOString() : null;
    const kept = cutoff ? rows.filter(r => r[3] <= cutoff) : rows;

    const stmts = [
        db.prepare("DELETE FROM plays WHERE source = 'takeout'"),
        db.prepare("DELETE FROM plays WHERE source = 'sync' AND (synced_at = ?1 OR synced_at <= ?2)")
            .bind(baseline, cutoffSync),
    ];
    const importedAt = new Date().toISOString();
    for (const chunk of chunked(kept, MUSIC_IMPORT_CHUNK)) {
        const data = JSON.stringify(chunk);
        // WHERE true: SQLite needs it to parse an upsert whose source is a SELECT.
        stmts.push(db.prepare(`
            INSERT INTO songs (video_id, title, artists, first_seen, last_seen)
            SELECT value->>0, value->>1, value->>2, value->>3, value->>3 FROM json_each(?) WHERE true
            ON CONFLICT(video_id) DO UPDATE SET
                first_seen = MIN(songs.first_seen, excluded.first_seen),
                last_seen = MAX(songs.last_seen, excluded.last_seen)`).bind(data));
        stmts.push(db.prepare(`
            INSERT INTO plays (video_id, played_date, played_at, synced_at, source)
            SELECT value->>0, substr(value->>3, 1, 10), value->>3, ?, 'takeout' FROM json_each(?)`)
            .bind(importedAt, data));
    }
    const summary = {
        imported_at: importedAt, plays: kept.length, dropped_after_cutoff: rows.length - kept.length,
        oldest: rows[0][3], newest, cutoff,
    };
    stmts.push(db.prepare(`
        INSERT INTO sync_state (key, value) VALUES ('takeout_import', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(summary)));

    const results = await db.batch(stmts);
    return json({ ok: true, ...summary, removed_sync_plays: results[1].meta.changes });
}

function chunked(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// ── MCP server (/mcp) ────────────────────────────────────────────────────────
//
// A Model Context Protocol server over the data above, so an AI assistant
// (a claude.ai custom connector, Claude Code, …) can answer questions about
// the activities, hunters, peak lists and travel tracking. It speaks the
// Streamable HTTP transport in its stateless form: each POST carries one
// JSON-RPC message (or a batch) and gets plain JSON back. There are no
// sessions and no server-sent events, so a GET answers 405. It is written by
// hand rather than with the MCP SDK so the worker stays one dependency-free
// file. Every tool is read-only and public, like the GET endpoints it mirrors.
//
// The hunters store ids only. data/hunter-names.json (scripts/
// build-hunter-names.py) maps them to names; it and the peak list files are
// fetched from the site and cached. Adding a tool: append it to MCP_TOOLS.

const SITE_URL = 'https://j-guyy.github.io';

// Newest first. A client asking for one of these gets it back; any other
// version gets the newest, and the client decides whether it can use it.
const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const MCP_SERVER_INFO = { name: 'j-guyy-adventures', title: 'j-guyy.github.io adventure trackers', version: '1.0.0' };

const MCP_INSTRUCTIONS = `Data behind Justin Guyette's adventure site, ${SITE_URL}.
- Activities are his Strava activities that have a GPS start point (indoor and manual entries aren't stored), refreshed nightly. Each has a sport type, date, distance, moving time, elevation gain and the country / state where it started. Strava links: https://www.strava.com/activities/<id>.
- The "hunters" on ${SITE_URL}/strava.html track what his GPS routes have reached: US counties, national parks and other federal lands, state parks, the 200 largest US metros, EPA ecoregions, Colorado mountain passes, map tiles, and mountain summits. Counties, parks, state parks, metros, ecoregions and map tiles are brought up to date at every Strava sync (nightly); summits and passes update when the site is opened, so they can lag the newest activities by a few days.
- The peak lists (Colorado 14ers, Adirondack 46ers, US state high points, …) and travel lists (countries, US states, metros, national parks) are kept by hand on the site; get_peak_list also says which peaks Strava confirms.
- Distances come in km and mi, elevations in m and ft. Use the units the user uses.
Start with get_overview for headline numbers.`;

const MCP_CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version',
};

class McpRpcError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

async function handleMcp(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: { ...MCP_CORS_HEADERS, Allow: 'POST, OPTIONS' } });
    }
    let body;
    try {
        body = await request.json();
    } catch {
        return mcpJson(rpcError(null, -32700, 'Parse error'), 400);
    }
    const batch = Array.isArray(body);
    const messages = batch ? body : [body];
    if (!messages.length) return mcpJson(rpcError(null, -32600, 'Invalid Request'), 400);

    const replies = [];
    for (const msg of messages) {
        const reply = await mcpDispatch(msg, env);
        if (reply) replies.push(reply);
    }
    // Only notifications (and responses): nothing to answer.
    if (!replies.length) return new Response(null, { status: 202, headers: MCP_CORS_HEADERS });
    return mcpJson(batch ? replies : replies[0]);
}

async function mcpDispatch(msg, env) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return rpcError(msg?.id ?? null, -32600, 'Invalid Request');
    const { id, method } = msg;
    if (typeof method !== 'string') return id === undefined ? rpcError(null, -32600, 'Invalid Request') : null;
    if (id === undefined || id === null) return null;   // a notification, e.g. notifications/initialized
    const params = msg.params || {};
    try {
        switch (method) {
            case 'initialize': {
                const asked = params.protocolVersion;
                return rpcResult(id, {
                    protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: MCP_SERVER_INFO,
                    instructions: MCP_INSTRUCTIONS,
                });
            }
            case 'ping':
                return rpcResult(id, {});
            case 'tools/list':
                return rpcResult(id, { tools: MCP_TOOLS.map(({ run, ...tool }) => tool) });
            case 'tools/call':
                return rpcResult(id, await mcpCallTool(params, env));
            default:
                return rpcError(id, -32601, `Method not found: ${method}`);
        }
    } catch (e) {
        return rpcError(id, e instanceof McpRpcError ? e.code : -32603, e.message);
    }
}

// A tool that fails returns isError with the reason (a bad argument, a
// missing KV blob), so the model can see it and retry; only an unknown tool
// is a protocol error.
async function mcpCallTool(params, env) {
    const tool = MCP_TOOLS.find(t => t.name === params.name);
    if (!tool) throw new McpRpcError(-32602, `Unknown tool: ${params.name}`);
    try {
        const result = await tool.run(params.arguments || {}, env);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) {
        return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true };
    }
}

function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

function mcpJson(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...MCP_CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}

// ── MCP — data access ──

// Site files (names, peak lists) change only on a push, so each isolate keeps
// them for an hour on top of Cloudflare's own cache.
const SITE_CACHE_MS = 60 * 60 * 1000;
const siteJsonCache = new Map();

async function fetchSiteJson(path) {
    const hit = siteJsonCache.get(path);
    if (hit && Date.now() - hit.at < SITE_CACHE_MS) return hit.data;
    const res = await fetch(`${SITE_URL}/${path}`, { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    const data = await res.json();
    siteJsonCache.set(path, { at: Date.now(), data });
    return data;
}

// Without the names file every tool still works and reports ids.
async function hunterNames() {
    try { return await fetchSiteJson('data/hunter-names.json'); } catch { return {}; }
}

async function loadActivities(env) {
    const [stored, geo] = await Promise.all([
        env.STRAVA_DATA.get(ACTIVITIES_KEY, 'json'),
        env.STRAVA_DATA.get(GEO_KEY, 'json'),
    ]);
    return { slim: stored?.slim || [], syncedAt: stored?.syncedAt || null, geo: geo || {} };
}

// Distance (`di`) was added to the stored activities after the rest; until
// the next sync rewrites them, older ones have none.
function distanceNote(slim) {
    const missing = slim.filter(a => typeof a.di !== 'number').length;
    return missing
        ? { note: `${missing} of ${slim.length} activities have no distance stored yet, so distance totals and filters skip them; the next nightly Strava sync fills it in.` }
        : {};
}

// The geocode cache is keyed by start point on a 0.01° grid (gridKey in
// js/strava.js); a few old entries are on the 0.1° grid.
function placeOf(geo, latlng) {
    if (!Array.isArray(latlng)) return null;
    const [lat, lng] = latlng;
    return geo[`${lat.toFixed(2)},${lng.toFixed(2)}`] || geo[`${lat.toFixed(1)},${lng.toFixed(1)}`] || null;
}

// ── MCP — argument helpers ──
// Bad arguments throw, and the message reaches the model (see mcpCallTool).

function argStr(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function argEnum(v, allowed, name, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    if (!allowed.includes(v)) throw new Error(`${name} must be one of: ${allowed.join(', ')}`);
    return v;
}

function argInt(v, name, fallback, min, max) {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
    return Math.min(Math.max(Math.round(n), min), max);
}

function argNum(v, name) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${name} must be a number`);
    return n;
}

// YYYY, YYYY-MM or YYYY-MM-DD. Dates are compared as strings: `after` as is
// (2024 sorts before 2024-01-01), `before` against the same-length prefix, so
// before=2024 includes all of 2024.
function argDate(v, name) {
    const s = argStr(v);
    if (s === null) return null;
    if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(s)) throw new Error(`${name} must be YYYY, YYYY-MM or YYYY-MM-DD`);
    return s;
}

function onOrAfter(date, after) { return !after || String(date || '') >= after; }
function onOrBefore(date, before) { return !before || String(date || '').slice(0, before.length) <= before; }

// Case- and accent-insensitive text for matching.
function fold(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const round1 = (x) => Math.round(x * 10) / 10;
const M_PER_MI = 1609.344;
const FT_PER_M = 3.28084;

function firstVisit(d) {
    return d ? { date: d.date || null, activity: d.actName || null, activity_id: d.actId ?? null } : null;
}

// ── MCP — activities ──

// Sport groups accepted by the sport filter, besides Strava's own types.
// Mirrors GROUPS in js/strava.js, plus the mountain bike types.
const SPORT_GROUPS = {
    foot:    ['Run', 'TrailRun', 'VirtualRun', 'Hike', 'Walk', 'Snowshoe'],
    running: ['Run', 'TrailRun', 'VirtualRun'],
    bike:    ['Ride', 'GravelRide', 'MountainBikeRide', 'EMountainBikeRide', 'EBikeRide', 'VirtualRide', 'Handcycle', 'Velomobile'],
    snow:    ['AlpineSki', 'BackcountrySki', 'NordicSki', 'Snowboard', 'Snowkite'],
    water:   ['Swim', 'OpenWaterSwim', 'Kayaking', 'Rowing', 'Surfing', 'Windsurf', 'Kitesurf', 'Canoeing', 'StandUpPaddling', 'Sail'],
};
SPORT_GROUPS.cycling = SPORT_GROUPS.bike;

// Nominatim's country names, as the geocode cache stores them.
const COUNTRY_ALIASES = {
    us: 'united states', usa: 'united states', 'united states of america': 'united states', america: 'united states',
    uk: 'united kingdom', 'great britain': 'united kingdom', britain: 'united kingdom',
};

const ACTIVITY_FILTER_PROPS = {
    sport: { type: 'string', description: 'Strava sport type (Run, TrailRun, Ride, GravelRide, Hike, Walk, AlpineSki, BackcountrySki, NordicSki, Swim, Kayaking, …) or a group: foot, running, bike (= cycling), snow, water. Comma-separate several.' },
    after: { type: 'string', description: 'Only activities on or after this date: YYYY, YYYY-MM or YYYY-MM-DD.' },
    before: { type: 'string', description: 'Only activities on or before this date: YYYY, YYYY-MM or YYYY-MM-DD (before=2024 includes all of 2024).' },
    country: { type: 'string', description: 'Country the activity started in, e.g. "United States", "Spain", "UK".' },
    region: { type: 'string', description: 'State / province / region it started in, e.g. "Colorado", "Catalonia".' },
    name: { type: 'string', description: 'Text the activity title contains (case-insensitive).' },
    min_distance_km: { type: 'number', description: 'Minimum distance in km (1 mi = 1.609 km).' },
    max_distance_km: { type: 'number', description: 'Maximum distance in km.' },
    min_elevation_gain_m: { type: 'number', description: 'Minimum elevation gain in metres (1000 ft = 305 m).' },
};

// Returns the matching slim activities, each with its start place as `place`.
function filterActivities(slim, geo, args) {
    let types = null;
    const sport = argStr(args.sport);
    if (sport) {
        const known = new Map(slim.map(a => [a.t.toLowerCase(), a.t]));
        types = new Set();
        for (const token of sport.split(',').map(s => s.trim()).filter(Boolean)) {
            const key = token.toLowerCase();
            if (SPORT_GROUPS[key]) SPORT_GROUPS[key].forEach(t => types.add(t));
            else if (known.has(key)) types.add(known.get(key));
            else throw new Error(`Unknown sport "${token}". Groups: ${Object.keys(SPORT_GROUPS).join(', ')}. Types recorded: ${[...new Set(slim.map(a => a.t))].sort().join(', ')}`);
        }
    }
    const after = argDate(args.after, 'after');
    const before = argDate(args.before, 'before');
    const countryArg = argStr(args.country) && fold(args.country);
    const country = countryArg && (COUNTRY_ALIASES[countryArg] || countryArg);
    const region = argStr(args.region) && fold(args.region);
    const name = argStr(args.name) && fold(args.name);
    const minKm = argNum(args.min_distance_km, 'min_distance_km');
    const maxKm = argNum(args.max_distance_km, 'max_distance_km');
    const minGain = argNum(args.min_elevation_gain_m, 'min_elevation_gain_m');

    // An exact country name wins ("Niger" isn't "Nigeria"); otherwise a part
    // of one ("Korea" → "South Korea").
    const countryExact = country && Object.values(geo).some(g => fold(g?.c) === country);

    const out = [];
    for (const a of slim) {
        if (types && !types.has(a.t)) continue;
        if (!onOrAfter(a.d, after) || !onOrBefore(a.d, before)) continue;
        if (name && !fold(a.n).includes(name)) continue;
        if (minKm !== null && !(a.di >= minKm * 1000)) continue;
        if (maxKm !== null && !(a.di <= maxKm * 1000)) continue;
        if (minGain !== null && !((a.e || 0) >= minGain)) continue;
        const place = placeOf(geo, a.l);
        if (country && (countryExact ? fold(place?.c) !== country : !fold(place?.c).includes(country))) continue;
        if (region && !fold(place?.s).includes(region)) continue;
        out.push({ ...a, place });
    }
    return out;
}

function activityTotals(list) {
    let metres = 0, seconds = 0, gain = 0, noDistance = 0;
    for (const a of list) {
        if (typeof a.di === 'number') metres += a.di; else noDistance++;
        seconds += a.m || 0;
        gain += a.e || 0;
    }
    const noneKnown = list.length > 0 && noDistance === list.length;
    const totals = {
        count: list.length,
        distance_km: noneKnown ? null : round1(metres / 1000),
        distance_mi: noneKnown ? null : round1(metres / M_PER_MI),
        moving_hours: round1(seconds / 3600),
        elevation_gain_m: Math.round(gain),
        elevation_gain_ft: Math.round(gain * FT_PER_M),
    };
    // Activities stored before distance was (it fills in at the next sync).
    if (noDistance) totals.without_distance = noDistance;
    return totals;
}

function hoursMinutes(seconds) {
    const m = Math.round((seconds || 0) / 60);
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

function activityOut(a) {
    return {
        id: a.i,
        name: a.n,
        date: a.d,
        sport: a.t,
        distance_km: typeof a.di === 'number' ? round1(a.di / 1000) : null,
        distance_mi: typeof a.di === 'number' ? round1(a.di / M_PER_MI) : null,
        moving_time: hoursMinutes(a.m),
        elevation_gain_m: Math.round(a.e || 0),
        elevation_gain_ft: Math.round((a.e || 0) * FT_PER_M),
        ...(a.eh != null ? { high_point_m: Math.round(a.eh) } : {}),
        country: a.place?.c || null,
        region: a.place?.s || null,
    };
}

const ACTIVITY_SORTS = {
    date: a => a.d || '',
    distance: a => a.di ?? -1,
    elevation_gain: a => a.e || 0,
    moving_time: a => a.m || 0,
};

async function mcpSearchActivities(args, env) {
    const { slim, geo, syncedAt } = await loadActivities(env);
    const sort = argEnum(args.sort, Object.keys(ACTIVITY_SORTS), 'sort', 'date');
    const order = argEnum(args.order, ['desc', 'asc'], 'order', 'desc');
    const limit = argInt(args.limit, 'limit', 20, 1, 100);
    const matched = filterActivities(slim, geo, args);
    const key = ACTIVITY_SORTS[sort];
    const dir = order === 'asc' ? 1 : -1;
    matched.sort((a, b) => {
        const x = key(a), y = key(b);
        return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
    return {
        totals: activityTotals(matched),
        showing: Math.min(limit, matched.length),
        activities: matched.slice(0, limit).map(activityOut),
        synced_at: syncedAt ? new Date(syncedAt).toISOString() : null,
        ...distanceNote(slim),
    };
}

const STAT_GROUPS = {
    year:    a => (a.d || '').slice(0, 4) || 'unknown',
    month:   a => (a.d || '').slice(0, 7) || 'unknown',
    sport:   a => a.t,
    country: a => a.place?.c || 'unknown',
    region:  a => (a.place ? `${a.place.s || 'unknown'}, ${a.place.c}` : 'unknown'),
    none:    () => 'all',
};

async function mcpActivityStats(args, env) {
    const { slim, geo, syncedAt } = await loadActivities(env);
    const groupBy = argEnum(args.group_by, Object.keys(STAT_GROUPS), 'group_by', 'year');
    const matched = filterActivities(slim, geo, args);
    const buckets = new Map();
    for (const a of matched) {
        const k = STAT_GROUPS[groupBy](a);
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k).push(a);
    }
    const groups = [...buckets].map(([key, list]) => {
        const longest = list.reduce((best, a) => ((a.di ?? -1) > (best?.di ?? -1) ? a : best), null);
        const biggestClimb = list.reduce((best, a) => ((a.e || 0) > (best?.e || 0) ? a : best), null);
        return {
            [groupBy]: key,
            ...activityTotals(list),
            longest: longest?.di ? { name: longest.n, date: longest.d, id: longest.i, distance_km: round1(longest.di / 1000) } : null,
            biggest_climb: biggestClimb?.e ? { name: biggestClimb.n, date: biggestClimb.d, id: biggestClimb.i, elevation_gain_m: Math.round(biggestClimb.e) } : null,
        };
    });
    // Time groups in order; the rest busiest first.
    if (groupBy === 'year' || groupBy === 'month') groups.sort((a, b) => String(a[groupBy]).localeCompare(String(b[groupBy])));
    else groups.sort((a, b) => b.count - a.count);
    return {
        totals: activityTotals(matched),
        groups,
        synced_at: syncedAt ? new Date(syncedAt).toISOString() : null,
        ...distanceNote(slim),
    };
}

// ── MCP — hunters ──

// names: the hunter-names.json section; describe: [name, extra] → fields.
const MCP_HUNTERS = {
    county: {
        kv: COUNTIES_KEY, ids: 'fips', names: 'counties', total: () => SUMMARY_TOTALS.counties,
        describe: ([name, state]) => ({ name, state }),
    },
    national_park: {
        kv: PARKS_KEY, ids: 'ids', names: 'parks', total: () => SUMMARY_TOTALS.parks,
        describe: ([name, type]) => ({ name, type }),
    },
    state_park: {
        kv: STATE_PARKS_KEY, ids: 'ids', names: 'stateParks', total: () => SUMMARY_TOTALS.stateParks,
        describe: ([name, state]) => ({ name, state }),
    },
    metro: {
        kv: METRO_HUNTER_KEY, ids: 'ids', names: 'metros', total: () => SUMMARY_TOTALS.metros,
        describe: ([name, state, rank]) => ({ name, state, rank }),
    },
    ecoregion: {
        kv: ECOREGIONS_KEY, ids: 'codes', names: 'ecoregions', total: () => SUMMARY_TOTALS.ecoL4,
        describe: ([name, l3], names) => ({ name, level3: names.ecoL3?.[l3] ? `${l3} ${names.ecoL3[l3]}` : l3 }),
    },
    pass: {
        kv: PASSES_KEY, ids: 'ids', names: 'passes', total: (blob) => (blob?.catalogIds || []).length || null,
        describe: ([name, eleFt]) => ({ name, elevation_ft: eleFt ?? null }),
    },
};

async function mcpGetHunter(args, env) {
    const hunterKey = argEnum(args.hunter, Object.keys(MCP_HUNTERS), 'hunter');
    if (!hunterKey) throw new Error(`hunter is required: ${Object.keys(MCP_HUNTERS).join(', ')}`);
    const cfg = MCP_HUNTERS[hunterKey];
    const status = argEnum(args.status, ['visited', 'unvisited'], 'status', 'visited');
    const state = argStr(args.state)?.toUpperCase() || null;
    const query = argStr(args.query) && fold(args.query);
    const since = argDate(args.since, 'since');
    const sort = argEnum(args.sort, ['recent', 'oldest', 'name'], 'sort', status === 'visited' ? 'recent' : 'name');
    const limit = argInt(args.limit, 'limit', 50, 1, 500);

    const [blob, names] = await Promise.all([env.STRAVA_DATA.get(cfg.kv, 'json'), hunterNames()]);
    const table = names[cfg.names] || {};
    const visited = new Set((blob?.[cfg.ids] || []).filter(Boolean));
    const discoveries = blob?.discoveries || {};

    if (status === 'unvisited' && !Object.keys(table).length) {
        throw new Error('The names file (data/hunter-names.json) is unavailable, so unvisited items cannot be listed right now');
    }
    const ids = status === 'visited' ? [...visited] : Object.keys(table).filter(id => !visited.has(id));
    let items = ids.map(id => {
        const entry = table[id];
        return {
            id,
            ...(entry ? cfg.describe(entry, names) : { name: id }),
            ...(status === 'visited' ? { first_visit: firstVisit(discoveries[id]) } : {}),
        };
    });
    if (state) items = items.filter(it => String(it.state || '').toUpperCase() === state);
    if (query) items = items.filter(it => fold(it.name).includes(query) || fold(it.id).includes(query) || fold(it.level3).includes(query));
    if (since) items = items.filter(it => onOrAfter(it.first_visit?.date, since));

    const byDate = (a, b) => String(a.first_visit?.date || '').localeCompare(String(b.first_visit?.date || ''));
    if (sort === 'name') items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    else if (sort === 'oldest') items.sort(byDate);
    else items.sort((a, b) => byDate(b, a));

    return {
        hunter: hunterKey,
        visited: visited.size,
        total: cfg.total(blob),
        status,
        matched: items.length,
        showing: Math.min(limit, items.length),
        items: items.slice(0, limit),
        ...(blob ? {} : { note: 'This hunter has not been run on the site yet.' }),
    };
}

// ── MCP — summits and peak lists ──

function peakOut(p) {
    return {
        name: p.name,
        elevation_m: p.ele != null ? Math.round(p.ele) : null,
        elevation_ft: p.ele != null ? Math.round(p.ele * FT_PER_M) : null,
        lat: p.lat,
        lng: p.lng,
        activities: p.activities,
        first: firstVisit(p.first),
        last: firstVisit(p.last),
        osm_id: p.id,
    };
}

async function mcpGetSummits(args, env) {
    const query = argStr(args.query) && fold(args.query);
    const minEle = argNum(args.min_elevation_m, 'min_elevation_m');
    const since = argDate(args.since, 'since');
    const sort = argEnum(args.sort, ['elevation', 'recent', 'first', 'count', 'name'], 'sort', 'elevation');
    const limit = argInt(args.limit, 'limit', 50, 1, 300);

    const all = await listSummitedPeaks(env);
    let peaks = all;
    if (query) peaks = peaks.filter(p => fold(p.name).includes(query));
    if (minEle !== null) peaks = peaks.filter(p => (p.ele || 0) >= minEle);
    if (since) peaks = peaks.filter(p => onOrAfter(p.last?.date, since));
    const sorters = {
        elevation: (a, b) => (b.ele || 0) - (a.ele || 0),
        recent: (a, b) => String(b.last?.date).localeCompare(String(a.last?.date)),
        first: (a, b) => String(a.first?.date).localeCompare(String(b.first?.date)),
        count: (a, b) => b.activities - a.activities || (b.ele || 0) - (a.ele || 0),
        name: (a, b) => String(a.name).localeCompare(String(b.name)),
    };
    peaks = [...peaks].sort(sorters[sort]);
    return {
        summited: all.length,
        matched: peaks.length,
        showing: Math.min(limit, peaks.length),
        peaks: peaks.slice(0, limit).map(peakOut),
    };
}

// Mirrors PEAK_LISTS in js/peaks-dashboard.js. type: the /travel KV type;
// key: the field identifying an entry; done: its completion flag; unit: the
// elevation unit in the file (feet unless noted).
const MCP_PEAK_LISTS = {
    colorado_14ers:          { type: 'colorado14ers',     file: 'data/colorado14ers.json',           key: 'name',    done: 'climbed' },
    adirondack_46ers:        { type: 'adk46ers',          file: 'data/adirondack46ers.json',         key: 'name',    done: 'climbed' },
    us_state_highpoints:     { type: 'highpoints',        file: 'data/highPoints.json',              key: 'state',   done: 'visited', region: 'state' },
    british_isles_high_five: { type: 'britishIsles',      file: 'data/british-isles-high-five.json', key: 'name',    done: 'climbed', region: 'country', unit: 'm' },
    country_highpoints:      { type: 'countryHighpoints', file: 'data/country-highpoints.json',      key: 'country', done: 'climbed', region: 'country' },
};

// Same rules as stravaMatches() in js/peaks-dashboard.js: a summited OSM peak
// within 400 m of a list peak is that peak, or within 3 km when the names
// agree; one summit confirms at most one list peak, name matches first.
const STRAVA_NEAR_M = 400;
const STRAVA_NAMED_M = 3000;
const NAME_STOPWORDS = new Set(['mount', 'mt', 'mont', 'monte', 'mountain', 'pico', 'pic', 'peak',
    'cerro', 'gora', 'volcan', 'nevado', 'the', 'de', 'del', 'la', 'jabal', 'jebel', 'hill', 'doi', 'bukit', 'puncak']);

function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180;
    const dl = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function peakNameKeys(name) {
    return String(name || '').split(/[\/();,]/)
        .map(part => fold(part).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
            .filter(w => w && !NAME_STOPWORDS.has(w)).join(' '))
        .filter(k => k.length >= 2);
}

function peakNamesAgree(a, b) {
    const ka = peakNameKeys(a), kb = peakNameKeys(b);
    return ka.some(x => kb.some(y => x === y ||
        (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))));
}

function matchPeakList(items, summited) {
    const pairs = [];
    for (const item of items) {
        if (!Array.isArray(item.coords)) continue;
        const [lng, lat] = item.coords;
        for (const peak of summited) {
            const d = haversineM(lat, lng, peak.lat, peak.lng);
            if (d > STRAVA_NAMED_M) continue;
            const named = peakNamesAgree(item.name, peak.name);
            if (named || d <= STRAVA_NEAR_M) pairs.push({ item, peak, d, named });
        }
    }
    pairs.sort((a, b) => (b.named - a.named) || (a.d - b.d));
    const matches = new Map();
    const used = new Set();
    for (const { item, peak } of pairs) {
        if (matches.has(item) || used.has(peak.id)) continue;
        matches.set(item, peak);
        used.add(peak.id);
    }
    return matches;
}

// The list as the Peaks dashboard shows it: KV once seeded, else the /data
// file; coordinates (and, for lists not keyed by name, names) always from the
// file, so a fixed coordinate or renamed peak shows up.
async function loadPeakList(cfg, env) {
    const [stored, file] = await Promise.all([
        env.STRAVA_DATA.get(TRAVEL_KEYS[cfg.type], 'json'),
        fetchSiteJson(cfg.file).catch(() => null),
    ]);
    if (!Array.isArray(stored) || !stored.length) {
        if (!file) throw new Error('Peak list unavailable');
        return file;
    }
    if (file) {
        const byKey = new Map(file.map(item => [item[cfg.key], item]));
        for (const item of stored) {
            const ref = byKey.get(item[cfg.key]);
            if (!ref) continue;
            if (Array.isArray(ref.coords)) item.coords = ref.coords;
            if (cfg.key !== 'name' && ref.name) item.name = ref.name;
        }
    }
    return stored;
}

async function mcpGetPeakList(args, env) {
    const listKey = argEnum(args.list, Object.keys(MCP_PEAK_LISTS), 'list');
    if (!listKey) throw new Error(`list is required: ${Object.keys(MCP_PEAK_LISTS).join(', ')}`);
    const cfg = MCP_PEAK_LISTS[listKey];
    const status = argEnum(args.status, ['all', 'climbed', 'not_climbed'], 'status', 'all');

    const [items, summited] = await Promise.all([loadPeakList(cfg, env), listSummitedPeaks(env)]);
    const matches = matchPeakList(items, summited);
    const rows = items.map(item => {
        const peak = matches.get(item);
        const ft = cfg.unit === 'm' ? Math.round(item.elevation * FT_PER_M) : item.elevation;
        return {
            name: item.name,
            ...(cfg.region ? { [cfg.region]: item[cfg.region] } : {}),
            ...(item.mainland ? { mainland: true } : {}),
            elevation_ft: ft ?? null,
            elevation_m: ft != null ? Math.round(ft / FT_PER_M) : null,
            climbed: Boolean(item[cfg.done]),
            strava_first_summit: peak ? firstVisit(peak.first) : null,
        };
    });
    const climbed = rows.filter(r => r.climbed).length;
    const confirmed = rows.filter(r => r.strava_first_summit).length;
    const disagree = rows.filter(r => r.climbed !== Boolean(r.strava_first_summit)).length;
    const shown = rows
        .filter(r => status === 'all' || (status === 'climbed') === r.climbed)
        .sort((a, b) => (b.elevation_ft || 0) - (a.elevation_ft || 0));
    return {
        list: listKey,
        climbed,
        total: rows.length,
        strava_confirmed: confirmed,
        // Rows where the hand-kept mark and Strava disagree: climbed before
        // GPS recording, or a summit Strava found that the list misses.
        disagreements: disagree,
        peaks: shown,
    };
}

// ── MCP — travel ──

const CONTINENT_LISTS = {
    northAmericanCountries: 'North America', southAmericanCountries: 'South America',
    europeanCountries: 'Europe', asianCountries: 'Asia', africanCountries: 'Africa', oceaniaCountries: 'Oceania',
};

async function mcpGetTravel(args, env) {
    const kind = argEnum(args.kind, ['countries', 'us_states', 'us_metros', 'us_capitals', 'world_capitals', 'national_parks'], 'kind');
    if (!kind) throw new Error('kind is required: countries, us_states, us_metros, us_capitals, world_capitals, national_parks');
    const status = argEnum(args.status, ['all', 'visited', 'unvisited'], 'status', 'visited');
    const kv = env.STRAVA_DATA;

    let items = [];
    let byContinent = null;
    if (kind === 'countries') {
        const data = (await kv.get(TRAVEL_KEYS.countries, 'json')) || await fetchSiteJson('data/countries.json');
        byContinent = {};
        for (const [listKey, continent] of Object.entries(CONTINENT_LISTS)) {
            const list = data[listKey] || [];
            byContinent[continent] = { visited: list.filter(c => c.visited).length, total: list.length };
            items.push(...list.map(c => ({ name: c.name, continent, visited: Boolean(c.visited) })));
        }
    } else if (kind === 'us_states') {
        const data = (await kv.get(TRAVEL_KEYS.visitedStates, 'json')) || await fetchSiteJson('data/visitedStates.json');
        items = Object.entries(data).map(([name, visited]) => ({ name, visited: Boolean(visited) }));
    } else if (kind === 'us_metros') {
        const data = (await kv.get(TRAVEL_KEYS.metros, 'json')) || await fetchSiteJson('data/metros.json');
        items = data.map(m => ({ rank: m.rank, name: m.name, state: m.state, population: m.population, visited: Boolean(m.visited) }));
    } else if (kind === 'us_capitals') {
        // Like TravelAPI.fetchCapitals: names come from the file, and the
        // file's flags stand in until the list is first saved.
        const [stored, file] = await Promise.all([
            kv.get(TRAVEL_KEYS.capitals, 'json'),
            fetchSiteJson('data/stateCapitals.json'),
        ]);
        const done = Array.isArray(stored) && stored.length
            ? new Map(stored.map(c => [c.state, Boolean(c.visited)])) : null;
        items = file.map(c => ({ name: c.name, state: c.state, visited: done ? Boolean(done.get(c.state)) : Boolean(c.visited) }));
    } else if (kind === 'world_capitals') {
        // Like TravelAPI.fetchWorldCapitals: one capital per country, names
        // from the file, visited flags from KV once the list is first saved.
        const [stored, file] = await Promise.all([
            kv.get(TRAVEL_KEYS.worldCapitals, 'json'),
            fetchSiteJson('data/worldCapitals.json'),
        ]);
        const done = Array.isArray(stored) && stored.length
            ? new Map(stored.map(c => [c.country, Boolean(c.visited)])) : null;
        items = file.map(c => ({ name: c.name, country: c.country, visited: done ? Boolean(done.get(c.country)) : Boolean(c.visited) }));
    } else {
        // Like TravelAPI.fetchNationalParks: parks added to the file since the
        // list was seeded are appended with the file's flag.
        const [stored, file] = await Promise.all([
            kv.get(TRAVEL_KEYS.parks, 'json'),
            fetchSiteJson('data/nationalParks.json').catch(() => []),
        ]);
        const parks = Array.isArray(stored) && stored.length ? stored : file;
        const have = new Set(parks.map(p => p.name));
        for (const p of file) if (!have.has(p.name)) parks.push(p);
        items = parks.map(p => ({ name: p.name, state: p.state, visited: Boolean(p.visited) }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    const visited = items.filter(i => i.visited).length;
    const shown = status === 'all' ? items : items.filter(i => i.visited === (status === 'visited'));
    return {
        kind,
        visited,
        total: items.length,
        ...(byContinent ? { by_continent: byContinent } : {}),
        status,
        items: status === 'all' ? shown : shown.map(({ visited: _, ...rest }) => rest),
    };
}

// ── MCP — overview and music ──

async function mcpGetOverview(args, env) {
    const [summary, progress, { slim, syncedAt }] = await Promise.all([
        buildSummary(env),
        env.STRAVA_DATA.get(PROGRESS_KEY, 'json'),
        loadActivities(env),
    ]);
    const bySport = {};
    for (const a of slim) (bySport[a.t] ||= []).push(a);
    const sports = Object.entries(bySport)
        .map(([sport, list]) => ({ sport, ...activityTotals(list) }))
        .sort((a, b) => b.count - a.count);
    const dates = slim.map(a => a.d).filter(Boolean).sort();
    // Every city / trail region computed so far, not just the latest.
    const coverage = (group) => Object.values(group || {}).map(({ ts, ...v }) => v);
    const { city, trail, generatedAt, activities, ...hunters } = summary;
    return {
        activities: {
            with_gps: slim.length,
            strava_total: activities?.total ?? null,
            first: dates[0] || null,
            latest: dates[dates.length - 1] || null,
            synced_at: syncedAt ? new Date(syncedAt).toISOString() : null,
            totals: activityTotals(slim),
            by_sport: sports,
            ...distanceNote(slim),
        },
        hunters,
        city_coverage: coverage(progress?.city),
        trail_coverage: coverage(progress?.trail),
        site: `${SITE_URL}/strava.html`,
    };
}

async function mcpGetTopSongs(args, env) {
    return musicLeaderboard(env, argInt(args.limit, 'limit', 25, 1, 200));
}

// ── MCP — tool list ──

const MCP_READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const MCP_TOOLS = [
    {
        name: 'get_overview',
        title: 'Overview',
        description: 'Headline numbers: activity totals (overall and per sport), every hunter\'s progress (counties, national parks, state parks, metros, ecoregions, map tiles incl. max cluster / square, peaks summited, Colorado passes) and city / trail coverage. Start here.',
        inputSchema: { type: 'object', properties: {} },
        annotations: MCP_READ_ONLY,
        run: mcpGetOverview,
    },
    {
        name: 'search_activities',
        title: 'Search activities',
        description: 'Find Strava activities by sport, date range, start country / region, title text, distance or climbing, sorted by date, distance, elevation gain or moving time. Returns totals over every match plus the top results.',
        inputSchema: {
            type: 'object',
            properties: {
                ...ACTIVITY_FILTER_PROPS,
                sort: { type: 'string', enum: Object.keys(ACTIVITY_SORTS), description: 'Default date.' },
                order: { type: 'string', enum: ['desc', 'asc'], description: 'Default desc (newest / biggest first).' },
                limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Activities to return (default 20).' },
            },
        },
        annotations: MCP_READ_ONLY,
        run: mcpSearchActivities,
    },
    {
        name: 'activity_stats',
        title: 'Activity statistics',
        description: 'Totals (count, distance, moving time, elevation gain, longest, biggest climb) grouped by year, month, sport, country or region, over activities matching the same filters as search_activities. E.g. running distance per year, or rides per country.',
        inputSchema: {
            type: 'object',
            properties: {
                group_by: { type: 'string', enum: Object.keys(STAT_GROUPS), description: 'Default year.' },
                ...ACTIVITY_FILTER_PROPS,
            },
        },
        annotations: MCP_READ_ONLY,
        run: mcpActivityStats,
    },
    {
        name: 'get_hunter',
        title: 'Hunter progress',
        description: 'Places a hunter has reached on GPS routes, each with the activity that first reached it — or, with status=unvisited, the ones still to go. Hunters: county (US counties), national_park (national parks, forests, wildlife refuges and other NPS / USFS / FWS lands), state_park, metro (200 largest US metros), ecoregion (EPA Level IV), pass (Colorado paved mountain passes, by bike).',
        inputSchema: {
            type: 'object',
            properties: {
                hunter: { type: 'string', enum: Object.keys(MCP_HUNTERS) },
                status: { type: 'string', enum: ['visited', 'unvisited'], description: 'Default visited.' },
                state: { type: 'string', description: 'Two-letter US state, e.g. CO (county, state_park, metro).' },
                query: { type: 'string', description: 'Text the name contains (for ecoregions also the Level III name).' },
                since: { type: 'string', description: 'Only first reached on or after this date (YYYY, YYYY-MM or YYYY-MM-DD).' },
                sort: { type: 'string', enum: ['recent', 'oldest', 'name'], description: 'Default recent (visited) / name (unvisited).' },
                limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Default 50.' },
            },
            required: ['hunter'],
        },
        annotations: MCP_READ_ONLY,
        run: mcpGetHunter,
    },
    {
        name: 'get_summits',
        title: 'Summits',
        description: 'Mountain summits reached on Strava activities (Mountain Hunter: named OpenStreetMap peaks within 50 m of a route), with elevation, how many activities reached each, and the first and latest visit. Use query to check a specific peak.',
        inputSchema: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Text the peak name contains, e.g. "Longs".' },
                min_elevation_m: { type: 'number', description: 'Minimum elevation in metres (14,000 ft = 4267 m).' },
                since: { type: 'string', description: 'Only peaks visited on or after this date.' },
                sort: { type: 'string', enum: ['elevation', 'recent', 'first', 'count', 'name'], description: 'Default elevation.' },
                limit: { type: 'integer', minimum: 1, maximum: 300, description: 'Default 50.' },
            },
        },
        annotations: MCP_READ_ONLY,
        run: mcpGetSummits,
    },
    {
        name: 'get_peak_list',
        title: 'Peak list',
        description: 'A peak-bagging list from the Peaks page: each peak\'s hand-kept climbed mark and the first Strava summit that confirms it (null when Strava has none — e.g. climbed before GPS recording).',
        inputSchema: {
            type: 'object',
            properties: {
                list: { type: 'string', enum: Object.keys(MCP_PEAK_LISTS) },
                status: { type: 'string', enum: ['all', 'climbed', 'not_climbed'], description: 'Default all.' },
            },
            required: ['list'],
        },
        annotations: MCP_READ_ONLY,
        run: mcpGetPeakList,
    },
    {
        name: 'get_travel',
        title: 'Travel lists',
        description: 'Hand-kept travel tracking from the US and World dashboards: countries visited (by continent), world capitals (one per country), US states, the 200 largest US metros, US state capitals, and US national parks.',
        inputSchema: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['countries', 'us_states', 'us_metros', 'us_capitals', 'world_capitals', 'national_parks'] },
                status: { type: 'string', enum: ['all', 'visited', 'unvisited'], description: 'Default visited.' },
            },
            required: ['kind'],
        },
        annotations: MCP_READ_ONLY,
        run: mcpGetTravel,
    },
    {
        name: 'get_top_songs',
        title: 'Top songs',
        description: 'Most-played songs on YouTube Music, counted from the daily history sync.',
        inputSchema: {
            type: 'object',
            properties: { limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 25.' } },
        },
        annotations: MCP_READ_ONLY,
        run: mcpGetTopSongs,
    },
];

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

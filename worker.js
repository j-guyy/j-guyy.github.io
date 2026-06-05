// ── Cloudflare Worker for j-guyy.github.io ──────────────────────────────────
//
// KV-backed API for Strava activity data, geocoding cache, hunter features
// (counties, tiles, peaks, summits), and travel tracking.
//
// Deploy: wrangler deploy
// Bindings: STRAVA_DATA (KV), STRAVA_KV (KV), CLIENT_ID, CLIENT_SECRET, TRAVEL_PASSWORD (secrets)

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

const TRAVEL_KEYS = {
    highpoints:    'travel_highpoints',
    metros:        'travel_metros',
    parks:         'travel_parks',
    countries:     'travel_countries',
    visitedStates: 'travel_visited_states',
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
                return await handleSync(env);
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
                return json({ ok: true, tiles: (data.tiles || []).length });
            }
            if (path === '/tiles/reset' && request.method === 'POST') {
                if (!isAdmin(request, env)) return unauthorized();
                await env.STRAVA_DATA.delete(TILES_KEY);
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
    // (Workers → strava-worker → Settings → Triggers), e.g. every 6 hours:
    // `0 */6 * * *`.
    async scheduled(event, env, ctx) {
        ctx.waitUntil(
            handleSync(env)
                .then(() => console.log('scheduled sync: done'))
                .catch(err => console.log(`scheduled sync failed: ${err.message}`))
        );
    },
};

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
async function handleSync(env) {
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
        // Bail on any error (rate limit, auth, transient) WITHOUT writing, so a
        // partial fetch can never clobber the good data already in KV.
        if (!res.ok) throw new Error(`Strava list error ${res.status} on page ${page}`);
        const batch = await res.json();
        if (!Array.isArray(batch)) throw new Error(`Strava returned non-array on page ${page}`);
        if (batch.length === 0) break;
        all.push(...batch);
        if (batch.length < 200) break; // last (short) page — no need for one more call
        page++;
    }

    // Safety net: never let an unexpectedly empty response wipe a populated store.
    if (all.length === 0 && stored.slim.length > 0) {
        return json({ ...stored, newActivities: 0, skipped: 'empty response' });
    }

    const total = all.length;
    const slim = slimActivities(all);

    // Preserve backfilled high points (and the "fetched, no data" null sentinel)
    // across the refresh — re-deriving eh would mean a detail call per ride.
    const prevEh = new Map(stored.slim.map(a => [a.i, a.eh]));
    for (const a of slim) {
        const eh = prevEh.get(a.i);
        if (eh !== undefined) a.eh = eh;
    }

    let newestTime = null;
    for (const a of all) {
        const ts = Math.floor(new Date(a.start_date).getTime() / 1000);
        if (ts && (!newestTime || ts > newestTime)) newestTime = ts;
    }

    // "New" = GPS activity IDs we hadn't stored before (drives the status message).
    const prevIds = new Set(stored.slim.map(a => a.i));
    const newActivities = slim.reduce((n, a) => n + (prevIds.has(a.i) ? 0 : 1), 0);

    const updated = { slim, total, lastActivityTime: newestTime, syncedAt: Date.now() };
    await env.STRAVA_DATA.put(ACTIVITIES_KEY, JSON.stringify(updated));

    return json({ ...updated, newActivities });
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

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
}

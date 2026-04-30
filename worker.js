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
    'Access-Control-Allow-Headers': 'Content-Type',
};

// ── KV keys ──────────────────────────────────────────────────────────────────

const ACTIVITIES_KEY = 'strava_activities';
const GEO_KEY        = 'strava_geo';
const COUNTIES_KEY   = 'strava_counties';
const TILES_KEY      = 'strava_tiles';
const PEAKS_KEY      = 'strava_peaks';
const SUMMITS_KEY    = 'strava_summits';

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
                return await handleSync(env);
            }
            if (path === '/activities/rebuild' && request.method === 'POST') {
                await env.STRAVA_DATA.delete(ACTIVITIES_KEY);
                return await handleSync(env);
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
                await env.STRAVA_DATA.delete(PEAKS_KEY);
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
                await env.STRAVA_DATA.delete(SUMMITS_KEY);
                return json({ ok: true });
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
    }
};

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

async function handleSync(env) {
    const stored = await env.STRAVA_DATA.get(ACTIVITIES_KEY, 'json')
        || { slim: [], total: 0, lastActivityTime: null };

    const token = await getAccessToken(env);

    let newSlim = [];
    let newTotal = 0;
    let newestTime = stored.lastActivityTime;
    let page = 1;

    while (true) {
        const params = new URLSearchParams({ per_page: '200', page: String(page) });
        if (stored.lastActivityTime) params.set('after', String(stored.lastActivityTime));

        const res = await fetch(`https://www.strava.com/api/v3/activities?${params}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        const batch = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;

        if (page === 1 && batch[0]?.start_date) {
            const ts = Math.floor(new Date(batch[0].start_date).getTime() / 1000);
            if (!newestTime || ts > newestTime) newestTime = ts;
        }

        newTotal += batch.length;
        newSlim = newSlim.concat(slimActivities(batch));
        page++;
    }

    // Deduplicate by activity ID — the `after` param is inclusive, so the
    // boundary activity can be re-fetched on every sync, inflating counts.
    const seenIds = new Set(newSlim.map(a => a.i));
    const deduped = [...newSlim, ...stored.slim.filter(a => !seenIds.has(a.i))];

    // Total = GPS activities we keep + non-GPS activities we counted but filtered.
    // non-GPS count = raw API results minus the GPS ones we kept from those results.
    const nonGpsCount = newTotal - newSlim.length;
    const storedNonGps = (stored.total || 0) - stored.slim.length;
    const total = deduped.length + storedNonGps + nonGpsCount;

    const updated = { slim: deduped, total, lastActivityTime: newestTime, syncedAt: Date.now() };

    await env.STRAVA_DATA.put(ACTIVITIES_KEY, JSON.stringify(updated));

    return json({ ...updated, newActivities: newTotal });
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

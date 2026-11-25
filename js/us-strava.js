// What Strava says about each US Travel list (js/dashboard.js): the first
// activity that reached a state, metro, national park, high point or capital,
// worked out from the hunters on strava.html, so the tables can show it beside
// the hand-kept ✅ and the comparison at the bottom of the page can list where
// the two disagree.
//   states     County Hunter (/counties/all): the first county reached in it
//   metros     Metro Hunter (/metro-hunter/all), ids as metroIdFromEntry in js/strava.js
//   parks      Park Hunter (/parks/all), the federal-lands.geojson National Park ids
//   highpoints Mountain Hunter's summits (/summits/peaks) matched by PeakMatch,
//              as on the Peaks dashboard
//   capitals   a route within CAPITAL_M of the capital (/activities/all), like
//              the World Travel page's world capitals; loaded on demand (2 MB)
// Each list's status is loading | ready | error, so a table can show "…".
const USStrava = (() => {
    const WORKER = typeof TRAVEL_WORKER_URL === 'string' ? TRAVEL_WORKER_URL : 'https://strava-worker.justinguyette.workers.dev';
    const CAPITAL_M = 2000;
    const LISTS = ['states', 'metros', 'parks', 'highpoints', 'capitals'];
    const status = Object.fromEntries(LISTS.map(l => [l, 'loading']));
    const listeners = [];
    let counties = null, metroHunter = null, parkHunter = null, summited = null, routes = null;
    let routesRequested = false;
    const peakMatches = new WeakMap();
    const capitalFirsts = new WeakMap();

    const getJson = path => fetch(`${WORKER}${path}`).then(res => {
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
        return res.json();
    });
    const changed = () => listeners.forEach(fn => fn());
    const loadInto = (lists, promise, set) => promise
        .then(data => { set(data); lists.forEach(l => { status[l] = 'ready'; }); })
        .catch(err => { console.warn('Strava data unavailable:', err); lists.forEach(l => { status[l] = 'error'; }); })
        .then(changed);

    function start() {
        loadInto(['states'], getJson('/counties/all'), d => { counties = d.discoveries || {}; });
        loadInto(['metros'], getJson('/metro-hunter/all'), d => { metroHunter = d.discoveries || {}; });
        loadInto(['parks'], getJson('/parks/all'), d => { parkHunter = d.discoveries || {}; });
        loadInto(['highpoints'], getJson('/summits/peaks'), d => { summited = d.peaks || []; });
    }

    // The capitals need every route: fetched the first time they're wanted.
    function wantRoutes() {
        if (routesRequested) return;
        routesRequested = true;
        loadInto(['capitals'], getJson('/activities/all'), d => { routes = d.slim || []; });
    }

    const earlier = (a, b) => (!b || (a && String(a.date) < String(b.date)) ? a : b);

    // metroIdFromEntry in js/strava.js.
    function metroId(m) {
        let slug = m.name.toLowerCase();
        for (const ch of [' ', '/', ',', "'", '.', '(', ')', '\\']) slug = slug.split(ch).join('-');
        while (slug.includes('--')) slug = slug.replace(/--/g, '-');
        return `metro-${slug.replace(/^-+|-+$/g, '')}-${m.state.toLowerCase()}`;
    }

    // The travel list's park names → data/federal-lands.geojson ids. A list
    // of ids counts the first one reached: North Cascades is run as one
    // complex with its two recreation areas, and the road in (Newhalem,
    // Diablo Lake) only crosses Ross Lake NRA.
    const PARK_IDS = {
        Chiricahua: 'nps-chiricahua-national-monument',
        'North Cascades': ['nps-north-cascades-national-park', 'nps-ross-lake-national-recreation-area',
            'nps-lake-chelan-national-recreation-area'],
        'Hawaii Volcanoes': 'nps-hawai-i-volcanoes-national-park',
        'New River Gorge': 'nps-new-river-gorge-national-park-and-preserve',
        'American Samoa': 'nps-national-park-of-american-samoa',
    };
    function parkId(p) {
        if (PARK_IDS[p.name]) return PARK_IDS[p.name];
        const slug = `${p.name} national park`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return `nps-${slug}`;
    }

    // Decodes a Google encoded polyline into [lat, lng, lat, lng, …].
    function decode(str) {
        const out = [];
        let i = 0, lat = 0, lng = 0;
        while (i < str.length) {
            for (const which of [0, 1]) {
                let shift = 0, result = 0, b;
                do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < str.length);
                const delta = result & 1 ? ~(result >> 1) : result >> 1;
                if (which) lng += delta; else lat += delta;
            }
            out.push(lat / 1e5, lng / 1e5);
        }
        return out;
    }

    function distM(lat1, lng1, lat2, lng2) {
        const x = (lng2 - lng1) * Math.cos((lat1 + lat2) * Math.PI / 360) * 111320;
        const y = (lat2 - lat1) * 110540;
        return Math.hypot(x, y);
    }

    // Each capital's first activity whose route passes within CAPITAL_M: the
    // capitals sit in a 0.1° grid, and every route point looks up its cell's
    // neighbours.
    function matchCapitals(capitals) {
        const grid = new Map();
        capitals.forEach(c => {
            if (!Array.isArray(c.coords)) return;
            const [lng, lat] = c.coords;
            const gx = Math.floor(lng * 10), gy = Math.floor(lat * 10);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                const k = `${gx + dx},${gy + dy}`;
                (grid.get(k) || grid.set(k, []).get(k)).push(c);
            }
        });
        const found = new Map();
        const ordered = [...routes].sort((a, b) => String(a.d).localeCompare(String(b.d)) || (a.s || 0) - (b.s || 0));
        for (const act of ordered) {
            if (!act.p || found.size === capitals.length) continue;
            const pts = decode(act.p);
            for (let k = 0; k < pts.length; k += 2) {
                const near = grid.get(`${Math.floor(pts[k + 1] * 10)},${Math.floor(pts[k] * 10)}`);
                if (!near) continue;
                near.forEach(c => {
                    if (found.has(c)) return;
                    if (distM(pts[k], pts[k + 1], c.coords[1], c.coords[0]) <= CAPITAL_M) {
                        found.set(c, { actId: act.i, actName: act.n, date: String(act.d || '').slice(0, 10) });
                    }
                });
            }
        }
        return found;
    }

    // The first Strava activity that reached the item, or null.
    // states: { abbr, fipsPrefix }.
    function first(list, item) {
        if (status[list] !== 'ready') return null;
        if (list === 'states') {
            let best = null;
            Object.entries(counties).forEach(([fips, d]) => {
                if (fips.startsWith(item.fipsPrefix)) best = earlier(d, best);
            });
            return best;
        }
        if (list === 'metros') return metroHunter[metroId(item)] || null;
        if (list === 'parks') {
            const ids = [].concat(parkId(item));
            return ids.reduce((best, id) => earlier(parkHunter[id] || null, best), null);
        }
        if (list === 'highpoints') {
            if (!peakMatches.has(item.__list)) peakMatches.set(item.__list, PeakMatch.match(item.__list, summited));
            const m = peakMatches.get(item.__list).get(item);
            return m ? m.peak.first || { date: '' } : null;
        }
        if (list === 'capitals') {
            if (!capitalFirsts.has(item.__list)) capitalFirsts.set(item.__list, matchCapitals(item.__list));
            return capitalFirsts.get(item.__list).get(item) || null;
        }
        return null;
    }

    // A list's items know their list (PeakMatch and the capital scan work on
    // the whole list at once, once).
    function tag(list) {
        list.forEach(item => Object.defineProperty(item, '__list', { value: list, configurable: true, writable: true }));
        return list;
    }

    // The table cell: the year of the first activity, linking to it.
    function cell(list, item) {
        const s = status[list];
        if (s === 'loading') return '<span class="state-progress-none" title="Loading Strava…">…</span>';
        if (s === 'error') return '<span class="state-progress-none" title="Strava data unavailable right now">—</span>';
        const f = first(list, item);
        if (!f) return '<span class="state-progress-none" title="No Strava activity reached it">—</span>';
        const year = String(f.date || '').slice(0, 4) || '✓';
        const title = `First on Strava: ${f.actName || 'Activity'}${f.date ? ` (${f.date})` : ''}`;
        return f.actId
            ? `<a class="strava-first" href="https://www.strava.com/activities/${encodeURIComponent(f.actId)}" target="_blank" rel="noopener" title="${escapeTitle(title)}">${year}</a>`
            : `<span class="strava-first" title="${escapeTitle(title)}">${year}</span>`;
    }

    const escapeTitle = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    return { start, wantRoutes, first, cell, tag, status, onChange: fn => listeners.push(fn), LISTS };
})();

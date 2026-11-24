// ── Travel for invited users (/app/?user=1) ──────────────────────────────
//
// The owner's Travel tab opens his hand-kept travel pages (US Travel, World
// Travel, Peaks). An invited person has no hand-kept lists, so their Travel
// tab is worked out from their own Strava activities instead:
//
//   US States  — a state counts once an activity starts in it (the geocoded
//                start cell, the same data as the Dashboard's Regions table).
//   Countries  — likewise for countries, out of the 195 in data/countries.json.
//   Peaks      — the site's peak lists (US state high points, Colorado 14ers,
//                Adirondack 46ers, British Isles High Five, country high
//                points) matched against Mountain Hunter's summits with the
//                Peaks dashboard's own matching (PeakMatch, js/peak-match.js).
//
// Each gets its own screen (#states, #countries, #peaks), opened from Home's
// Travel cards or the Travel tab. Everything is computed on the page from
// strava.js's globals (currentSlim, currentCache, mountainPeaks, …); strava.js
// calls renderUserTravel() whenever its activities or places change and when
// Mountain Hunter finishes a scan. Without ?user this file does nothing.

const UT_ENABLED = Boolean(window.STRAVA_USER);

const UT_STATE_ABBR = {
    Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
    Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA',
    Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
    Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
    Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
    'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
    Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
    'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
    Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};
const UT_ABBR_STATE = Object.fromEntries(Object.entries(UT_STATE_ABBR).map(([n, a]) => [a, n]));

// A tile-grid map of the states: each row lists its tiles from the left edge,
// '' for a gap.
const UT_STATE_GRID = [
    ['', '', '', '', '', '', '', '', '', '', '', 'ME'],
    ['AK', '', '', '', '', '', '', '', '', '', 'VT', 'NH'],
    ['', 'WA', 'ID', 'MT', 'ND', 'MN', 'IL', 'WI', 'MI', 'NY', 'RI', 'MA'],
    ['', 'OR', 'NV', 'WY', 'SD', 'IA', 'IN', 'OH', 'PA', 'NJ', 'CT'],
    ['', 'CA', 'UT', 'CO', 'NE', 'MO', 'KY', 'WV', 'VA', 'MD', 'DE'],
    ['', '', 'AZ', 'NM', 'KS', 'AR', 'TN', 'NC', 'SC', 'DC'],
    ['', '', '', '', 'OK', 'LA', 'MS', 'AL', 'GA'],
    ['HI', '', '', '', 'TX', '', '', '', '', 'FL'],
];

// Nominatim's English country names (and territories) → data/countries.json.
const UT_COUNTRY_ALIASES = {
    'United States': 'United States of America', 'Puerto Rico': 'United States of America',
    'United States Virgin Islands': 'United States of America', Guam: 'United States of America',
    'Northern Mariana Islands': 'United States of America', 'American Samoa': 'United States of America',
    Czechia: 'Czech Republic', 'Democratic Republic of the Congo': 'DR Congo',
    'Congo-Kinshasa': 'DR Congo', 'Congo-Brazzaville': 'Congo', 'Republic of the Congo': 'Congo',
    "Côte d'Ivoire": 'Ivory Coast', "Cote d'Ivoire": 'Ivory Coast', Türkiye: 'Turkey',
    'Cabo Verde': 'Cape Verde', 'Federated States of Micronesia': 'Micronesia',
    'Palestinian Territory': 'Palestine', 'Palestinian Territories': 'Palestine',
    'East Timor': 'Timor-Leste', 'The Bahamas': 'Bahamas', 'The Gambia': 'Gambia',
    'Holy See': 'Vatican City', 'Vatican': 'Vatican City', Burma: 'Myanmar',
    'Hong Kong': 'China', Macau: 'China', Macao: 'China', 'Republic of Korea': 'South Korea',
    "Democratic People's Republic of Korea": 'North Korea', 'Russian Federation': 'Russia',
    'Lao PDR': 'Laos', 'Viet Nam': 'Vietnam', 'Brunei Darussalam': 'Brunei',
    'Syrian Arab Republic': 'Syria', 'Republic of Moldova': 'Moldova', 'Macedonia': 'North Macedonia',
    'Greenland': 'Denmark', 'Faroe Islands': 'Denmark', 'Aruba': 'Netherlands', 'Curaçao': 'Netherlands',
    'Sint Maarten': 'Netherlands', 'Caribbean Netherlands': 'Netherlands',
    'French Polynesia': 'France', 'New Caledonia': 'France', 'Martinique': 'France',
    'Guadeloupe': 'France', 'Réunion': 'France', 'French Guiana': 'France', 'Mayotte': 'France',
    'Saint Martin': 'France', 'Saint Barthélemy': 'France',
    'Gibraltar': 'United Kingdom', 'Bermuda': 'United Kingdom', 'Cayman Islands': 'United Kingdom',
    'British Virgin Islands': 'United Kingdom', 'Turks and Caicos Islands': 'United Kingdom',
    'Isle of Man': 'United Kingdom', 'Jersey': 'United Kingdom', 'Guernsey': 'United Kingdom',
    'Christmas Island': 'Australia', 'Norfolk Island': 'Australia', 'Cook Islands': 'New Zealand',
};

const UT_CONTINENTS = [
    ['northAmericanCountries', 'North America'],
    ['southAmericanCountries', 'South America'],
    ['europeanCountries', 'Europe'],
    ['africanCountries', 'Africa'],
    ['asianCountries', 'Asia'],
    ['oceaniaCountries', 'Oceania'],
];

// The Peaks dashboard's lists (PEAK_LISTS in js/peaks-dashboard.js); only the
// reference data is used, never the owner's visited flags.
const UT_PEAK_LISTS = [
    { id: 'highpoints',        label: 'US State High Points',    url: '/data/highPoints.json',             region: p => UT_ABBR_STATE[p.state] || p.state },
    { id: 'colorado14ers',     label: 'Colorado 14ers',          url: '/data/colorado14ers.json' },
    { id: 'adk46ers',          label: 'Adirondack 46ers',        url: '/data/adirondack46ers.json' },
    { id: 'britishIsles',      label: 'British Isles High Five', url: '/data/british-isles-high-five.json', region: p => p.country, unit: 'm' },
    { id: 'countryHighpoints', label: 'Country High Points',     url: '/data/country-highpoints.json',     region: p => p.country },
];

const utRef = { countries: null, flags: null, peakLists: null, loading: null };
let utServerSummits = null;     // /summits/peaks, until Mountain Hunter has scanned on this page
const utOpen = new Set();       // peak list ids expanded on the Peaks screen

function utEsc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function utDate(d) {
    if (!d) return '';
    const date = new Date(`${String(d).slice(0, 10)}T12:00:00`);
    return isNaN(date) ? String(d) : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function utActLink(act) {
    if (!act?.actId && !act?.id) return '';
    const id = act.actId || act.id;
    const name = act.actName || act.name || 'Activity';
    return `<a href="https://www.strava.com/activities/${encodeURIComponent(id)}" target="_blank" rel="noopener">${utEsc(name)}</a>`;
}

function utLoadReference() {
    if (utRef.loading) return utRef.loading;
    const get = url => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null);
    utRef.loading = Promise.all([
        get('/data/countries.json'),
        get('/data/country-flags.json'),
        Promise.all(UT_PEAK_LISTS.map(l => get(l.url))),
    ]).then(([countries, flags, lists]) => {
        utRef.countries = countries;
        utRef.flags = flags || {};
        utRef.peakLists = lists.map(l => (Array.isArray(l) ? l : []));
        renderUserTravel();
    });
    return utRef.loading;
}

// ── Places from activities ──────────────────────────────────────────────────
//
// A state / country counts everywhere an activity's route passes, as on the
// World Travel page (js/world-map.js): each route is cut into the ~1 km cells
// it crosses and every cell is located in data/world-countries.geojson (and,
// inside the US, data/admin1/us.geojson). The activity's geocoded start place
// counts too, so an activity without a route (or one the outlines miss) still
// lands. Until the boundaries have loaded and routes are traced, only start
// places count. Traced results are kept per activity in localStorage
// (UT_TRACE_KEY), so a later open traces only new activities.

const UT_TRACE_KEY = 'user_travel_trace_v1';
const UT_FINE_SIZE = 0.1;  // features smaller than this (degrees) are tested exactly
const UT_COAST_SNAP = [0.01, 0.025].flatMap(d => [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [d, -d], [-d, d], [-d, -d]]);

const utTrace = {
    byId: new Map(),      // activity id → { c: [countries], s: [states] }
    state: 'idle',        // idle | loading | tracing | done | error
    done: 0, total: 0,
};
try {
    const saved = JSON.parse(localStorage.getItem(UT_TRACE_KEY) || 'null');
    if (saved?.v === 1 && saved.acts) {
        Object.entries(saved.acts).forEach(([id, v]) => {
            const [c, st] = String(v).split(';');
            utTrace.byId.set(id, { c: c ? c.split('|') : [], s: st ? st.split('|') : [] });
        });
    }
} catch { /* no saved traces */ }

function utSaveTraces() {
    const acts = {};
    utTrace.byId.forEach((v, id) => { acts[id] = `${v.c.join('|')};${v.s.join('|')}`; });
    try { localStorage.setItem(UT_TRACE_KEY, JSON.stringify({ v: 1, acts })); } catch { /* storage full or blocked */ }
}

// Point-in-polygon with each geometry's edges bucketed by latitude band, so a
// test only looks at the edges near the point (like world-map.js's bandIndex).
function utIndexGeometry(geometry) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity, edges = 0;
    polys.forEach(poly => poly.forEach(ring => ring.forEach(([x, y]) => {
        if (y < s) s = y; if (y > n) n = y; if (x < w) w = x; if (x > e) e = x;
        edges++;
    })));
    const count = Math.max(1, Math.min(512, Math.ceil(edges / 16)));
    const height = (n - s) / count || 1;
    const bands = Array.from({ length: count }, () => []);
    const rings = [];   // [polyIndex, ring]
    polys.forEach((poly, pi) => poly.forEach((ring, ri) => {
        const r = rings.length;
        rings.push({ pi, hole: ri > 0, ring });
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const y1 = ring[i][1], y2 = ring[j][1];
            const lo = Math.max(0, Math.floor((Math.min(y1, y2) - s) / height));
            const hi = Math.min(count - 1, Math.floor((Math.max(y1, y2) - s) / height));
            for (let b = lo; b <= hi; b++) bands[b].push(r, i, j);
        }
    }));
    return { s, n, w, e, count, height, bands, rings, polys: polys.length };
}

function utInside(idx, lng, lat) {
    if (lat < idx.s || lat > idx.n || lng < idx.w || lng > idx.e) return false;
    const band = idx.bands[Math.min(idx.count - 1, Math.floor((lat - idx.s) / idx.height))];
    const parity = new Uint8Array(idx.rings.length);
    for (let k = 0; k < band.length; k += 3) {
        const ring = idx.rings[band[k]].ring;
        const [xi, yi] = ring[band[k + 1]], [xj, yj] = ring[band[k + 2]];
        if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) parity[band[k]] ^= 1;
    }
    // Inside an outer ring and none of that polygon's holes.
    const inPoly = new Uint8Array(idx.polys), inHole = new Uint8Array(idx.polys);
    idx.rings.forEach((r, i) => { if (parity[i]) (r.hole ? inHole : inPoly)[r.pi] = 1; });
    for (let p = 0; p < idx.polys; p++) if (inPoly[p] && !inHole[p]) return true;
    return false;
}

// (lat, lng) → the name of the feature it's in, or null; a 1° grid of feature
// boxes keeps candidates few, and results are cached per ~1 km cell.
function utLocator(features, nameOf) {
    const grid = new Map();
    const fine = [];
    const items = features.map(f => ({ name: nameOf(f), idx: utIndexGeometry(f.geometry) }));
    items.forEach(it => {
        const b = it.idx;
        if (b.e - b.w < UT_FINE_SIZE && b.n - b.s < UT_FINE_SIZE) fine.push(it);
        for (let x = Math.floor(b.w); x <= Math.floor(b.e); x++) {
            for (let y = Math.floor(b.s); y <= Math.floor(b.n); y++) {
                const key = `${x},${y}`;
                if (!grid.has(key)) grid.set(key, []);
                grid.get(key).push(it);
            }
        }
    });
    const hitAt = (lat, lng) => {
        for (const it of grid.get(`${Math.floor(lng)},${Math.floor(lat)}`) || []) {
            if (utInside(it.idx, lng, lat)) return it.name;
        }
        return null;
    };
    const cache = new Map();
    const locate = (lat, lng) => {
        for (const it of fine) if (utInside(it.idx, lng, lat)) return it.name;
        const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
        if (cache.has(key)) return cache.get(key);
        let hit = hitAt(lat, lng);
        for (let i = 0; hit === null && i < UT_COAST_SNAP.length; i++) hit = hitAt(lat + UT_COAST_SNAP[i][0], lng + UT_COAST_SNAP[i][1]);
        cache.set(key, hit);
        return hit;
    };
    locate.near = (lat, lng) => fine.some(({ idx: b }) => lat >= b.s && lat <= b.n && lng >= b.w && lng <= b.e);
    return locate;
}

function utYield() {
    return new Promise(resolve => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => resolve();
        ch.port2.postMessage(null);
    });
}

let utLocators = null;
async function utLoadLocators() {
    if (utLocators) return utLocators;
    const get = url => fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
    const [world, us] = await Promise.all([get('/data/world-countries.geojson'), get('/data/admin1/us.geojson')]);
    await utLoadReference();
    const known = utCountryIndex();
    // Outlines are Natural Earth names; territories go to their sovereign
    // (Puerto Rico → the US) when that's the countries.json name.
    const countryName = f => {
        const { name, sov } = f.properties;
        if (known.has(name)) return name;
        if (known.has(UT_COUNTRY_ALIASES[name])) return UT_COUNTRY_ALIASES[name];
        if (known.has(sov)) return sov;
        return name;
    };
    utLocators = {
        country: utLocator(world.features, countryName),
        state: utLocator(us.features, f => f.properties.name),
    };
    return utLocators;
}

// Traces every activity not traced yet, in slices so the app stays usable.
async function utTraceRoutes() {
    if (utTrace.state === 'loading' || utTrace.state === 'tracing') return;
    const todo = currentSlim.filter(a => a.p && a.i != null && !utTrace.byId.has(String(a.i)));
    if (!todo.length) { utTrace.state = 'done'; return; }
    utTrace.state = 'loading';
    let loc;
    try {
        loc = await utLoadLocators();
    } catch (err) {
        console.warn('Route tracing unavailable:', err);
        utTrace.state = 'error';
        renderUserTravel();
        return;
    }
    utTrace.state = 'tracing';
    utTrace.done = 0;
    utTrace.total = todo.length;
    renderUserTravel();
    let sliceStart = performance.now(), lastPaint = sliceStart;
    for (const a of todo) {
        const countries = new Set(), states = new Set();
        let points = [];
        try { points = decodePolyline(a.p); } catch { /* bad polyline: start place only */ }
        const seen = new Set();
        points.forEach(([lat, lng]) => {
            const fine = loc.country.near(lat, lng);
            const key = fine ? `${lat.toFixed(4)},${lng.toFixed(4)}` : `${lat.toFixed(2)},${lng.toFixed(2)}`;
            if (seen.has(key)) return;
            seen.add(key);
            const c = loc.country(lat, lng);
            if (!c) return;
            countries.add(c);
            if (c === 'United States of America') {
                const st = loc.state(lat, lng);
                if (st) states.add(st);
            }
        });
        utTrace.byId.set(String(a.i), { c: [...countries], s: [...states] });
        utTrace.done++;
        if (performance.now() - sliceStart > 12) {
            await utYield();
            sliceStart = performance.now();
            if (sliceStart - lastPaint > 1500) { lastPaint = sliceStart; renderUserTravel(); }
        }
    }
    utTrace.state = 'done';
    utSaveTraces();
    renderUserTravel();
}

// Every place each activity reached, oldest activity first, so the first one
// seen in a state / country is its first visit.
function utPlaces() {
    if (typeof currentSlim === 'undefined' || !currentSlim.length) return null;
    const states = new Map();     // state name → { first, count, acts }
    const countries = new Map();  // countries.json name (or the outline's / geocoded name) → { first, count, acts }
    const add = (map, name, a) => {
        const e = map.get(name) || { first: a, count: 0, acts: [] };
        e.count++;
        e.acts.push(a);
        map.set(name, e);
    };
    [...currentSlim].sort(byStartTime).forEach(a => {
        const cs = new Set(), ss = new Set();
        const geo = Array.isArray(a.l) ? currentCache[gridKey(a.l)] : null;
        if (geo && geo.c && geo.c !== 'Unknown') {
            cs.add(UT_COUNTRY_ALIASES[geo.c] || geo.c);
            if (SUBDIVISION_BY_COUNTRY[geo.c]?.id === 'us' && UT_STATE_ABBR[geo.s]) ss.add(geo.s);
        }
        const traced = utTrace.byId.get(String(a.i));
        if (traced) {
            traced.c.forEach(c => cs.add(c));
            traced.s.forEach(st => ss.add(st));
        }
        cs.forEach(c => add(countries, c, a));
        ss.forEach(st => add(states, st, a));
    });
    return { states, countries };
}

function utTraceNote() {
    if (utTrace.state === 'tracing' || utTrace.state === 'loading') {
        const pct = utTrace.total ? Math.round((utTrace.done / utTrace.total) * 100) : 0;
        return `<p class="ut-note ut-tracing">Tracing your routes… ${pct}%</p>`;
    }
    if (utTrace.state === 'error') return '<p class="ut-note">Couldn’t load the map outlines, so only where activities start is counted for now.</p>';
    return '';
}

// countries.json name → { name, continent }
function utCountryIndex() {
    const map = new Map();
    if (!utRef.countries) return map;
    UT_CONTINENTS.forEach(([key, continent]) => {
        (utRef.countries[key] || []).forEach(c => map.set(c.name, { name: c.name, continent }));
    });
    return map;
}

function utFlag(name) {
    const code = utRef.flags?.[name];
    return code ? `<img class="ut-flag" src="/images/flags/${code}.png" alt="" loading="lazy">` : '<span class="ut-flag ut-flag-none" aria-hidden="true">🏳️</span>';
}

// ── Summits ─────────────────────────────────────────────────────────────────

// The person's summits in /summits/peaks form. Once Mountain Hunter has
// scanned on this page its in-memory result is newer than the saved one.
function utSummits() {
    if (typeof mountainHunterReady !== 'undefined' && mountainHunterReady && mountainPeaks.length) {
        const out = [];
        mountainPeaks.forEach(p => {
            const id = Number(p.id);
            const visits = mountainVisits.get(id);
            if (!visits?.length || hiddenPeakIds.has(id)) return;
            const first = [...visits].sort((a, b) => String(a.date).localeCompare(String(b.date))
                || (Number(a.actId) || 0) - (Number(b.actId) || 0))[0];
            out.push({ id, name: p.name || '', lat: p.lat, lng: p.lng, ele: p.ele, first });
        });
        return out;
    }
    return utServerSummits;
}

function utFetchServerSummits() {
    fetch(`${WORKER_URL}/summits/peaks`)
        .then(r => (r.ok ? r.json() : null))
        .then(data => {
            utServerSummits = data?.peaks || [];
            renderUserTravel();
        })
        .catch(() => { utServerSummits = []; renderUserTravel(); });
}

function utPeakResults() {
    const summits = utSummits();
    if (!utRef.peakLists || !summits || typeof PeakMatch === 'undefined') return null;
    return UT_PEAK_LISTS.map((cfg, i) => {
        const items = utRef.peakLists[i];
        const matches = PeakMatch.match(items, summits);
        return { cfg, items, matches };
    });
}

// ── Rendering ───────────────────────────────────────────────────────────────

function utStat(value, label) {
    return `<div class="county-stat-item"><span class="county-stat-number">${value}</span><span class="county-stat-label">${label}</span></div>`;
}

function utBar(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    return `<div class="ut-bar" role="presentation"><div class="ut-bar-fill" style="width:${pct}%"></div></div>`;
}

function utLoading(text) {
    return `<p class="no-location-note">${utEsc(text)}</p>`;
}

function renderStates(places) {
    const el = document.getElementById('ut-states');
    if (!el) return;
    if (!places) { el.innerHTML = utLoading('Loading activities…'); return; }
    const { states } = places;
    const fifty = [...states.keys()].filter(s => s !== 'District of Columbia').length;
    const recent = [...states.entries()].sort((a, b) => byStartTime(b[1].first, a[1].first))[0];

    const grid = UT_STATE_GRID.map(row => row.map(abbr => {
        if (!abbr) return '<span class="ut-tile ut-tile-gap"></span>';
        const name = UT_ABBR_STATE[abbr];
        const s = states.get(name);
        const title = s ? `${name}: first ${utDate(s.first.d)}` : `${name}: not yet`;
        return s
            ? `<button type="button" class="ut-tile ut-tile-done" data-place="state" data-name="${utEsc(name)}" title="${utEsc(title)}">${abbr}</button>`
            : `<span class="ut-tile" title="${utEsc(title)}">${abbr}</span>`;
    }).join('') + '<span class="ut-tile ut-tile-gap"></span>'.repeat(12 - row.length)).join('');

    const visited = [...states.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const remaining = Object.keys(UT_STATE_ABBR).filter(n => !states.has(n));

    el.innerHTML = `
        <div class="county-stats-bar">
            ${utStat(`${fifty} / 50`, 'States')}
            ${utStat(`${Math.round((fifty / 50) * 100)}%`, 'Done')}
            ${utStat(recent ? UT_STATE_ABBR[recent[0]] : '—', 'Newest')}
        </div>
        <div class="ut-state-grid" aria-label="US states map">${grid}</div>
        <p class="ut-note">A state counts once an activity passes through it. Tap a state for its activities.${states.has('District of Columbia') ? ' DC is on the map but not in the 50.' : ''}</p>
        ${utTraceNote()}
        <h3 class="ut-h">Visited <span>${visited.length}</span></h3>
        <ul class="ut-list">${visited.map(([name, s]) => `
            <li class="ut-tap" data-place="state" data-name="${utEsc(name)}" role="button" tabindex="0"><span class="ut-abbr">${UT_STATE_ABBR[name]}</span>
                <span class="ut-main"><strong>${utEsc(name)}</strong><small>First ${utDate(s.first.d)} · ${utEsc(s.first.n || 'Activity')}</small></span>
                <span class="ut-count">${s.count.toLocaleString()}</span><span class="ut-chev" aria-hidden="true">›</span></li>`).join('')}
        </ul>
        ${remaining.length ? `<h3 class="ut-h">Not yet <span>${remaining.length}</span></h3>
        <div class="ut-chips">${remaining.map(n => `<span class="ut-chip">${utEsc(n)}</span>`).join('')}</div>` : ''}`;
}

function renderCountries(places) {
    const el = document.getElementById('ut-countries');
    if (!el) return;
    if (!places || !utRef.countries) { el.innerHTML = utLoading('Loading activities…'); return; }
    const index = utCountryIndex();
    const total = index.size;
    const byContinent = new Map(UT_CONTINENTS.map(([, name]) => [name, []]));
    const other = [];
    places.countries.forEach((c, name) => {
        const ref = index.get(name);
        if (ref) byContinent.get(ref.continent).push([name, c]);
        else other.push([name, c]);
    });
    const counted = [...byContinent.values()].reduce((n, list) => n + list.length, 0);
    const continentsReached = [...byContinent.values()].filter(l => l.length).length;

    const row = ([name, c]) => `
        <li class="ut-tap" data-place="country" data-name="${utEsc(name)}" role="button" tabindex="0">${utFlag(name)}
            <span class="ut-main"><strong>${utEsc(name)}</strong><small>First ${utDate(c.first.d)} · ${utEsc(c.first.n || 'Activity')}</small></span>
            <span class="ut-count">${c.count.toLocaleString()}</span><span class="ut-chev" aria-hidden="true">›</span></li>`;

    const continentTotals = Object.fromEntries(UT_CONTINENTS.map(([key, name]) => [name, (utRef.countries[key] || []).length]));
    el.innerHTML = `
        <div class="county-stats-bar">
            ${utStat(`${counted} / ${total}`, 'Countries')}
            ${utStat(`${continentsReached} / 6`, 'Continents')}
            ${utStat(`${total ? Math.round((counted / total) * 100) : 0}%`, 'Of the world')}
        </div>
        <ul class="ut-progress">${[...byContinent.entries()].map(([name, list]) => `
            <li><span>${name}</span>${utBar(list.length, continentTotals[name])}<em>${list.length} / ${continentTotals[name]}</em></li>`).join('')}
        </ul>
        <p class="ut-note">A country counts once an activity passes through it; territories count for their country (Puerto Rico for the US, Hong Kong for China). Tap a country for its activities.</p>
        ${utTraceNote()}
        ${[...byContinent.entries()].filter(([, l]) => l.length).map(([name, list]) => `
            <h3 class="ut-h">${name} <span>${list.length}</span></h3>
            <ul class="ut-list">${list.sort((a, b) => a[0].localeCompare(b[0])).map(row).join('')}</ul>`).join('')}
        ${other.length ? `<h3 class="ut-h">Other places <span>${other.length}</span></h3>
            <ul class="ut-list">${other.map(row).join('')}</ul>` : ''}
        ${counted ? '' : '<p class="no-location-note">No countries yet — places fill in as your activities are located.</p>'}`;
}

function renderPeaks() {
    const el = document.getElementById('ut-peaks');
    if (!el) return;
    const results = utPeakResults();
    if (!results) { el.innerHTML = utLoading('Loading summits…'); return; }
    const summits = utSummits() || [];
    const listDone = results.reduce((n, r) => n + r.matches.size, 0);
    const hp = results.find(r => r.cfg.id === 'highpoints');

    el.innerHTML = `
        <div class="county-stats-bar">
            ${utStat(summits.length.toLocaleString(), 'Summits')}
            ${utStat(`${hp ? hp.matches.size : 0} / ${hp ? hp.items.length : 50}`, 'High points')}
            ${utStat(listDone.toLocaleString(), 'List peaks')}
        </div>
        <p class="ut-note">Peaks are confirmed from your Strava routes by Mountain Hunter${typeof mountainHunterReady !== 'undefined' && !mountainHunterReady ? ' (still scanning — this fills in as it goes)' : ''}.</p>
        ${results.map(({ cfg, items, matches }) => {
            const open = utOpen.has(cfg.id);
            const unit = cfg.unit || 'ft';
            const peakRow = (item, m) => `
                <li class="${m ? 'ut-done' : ''}">
                    <span class="ut-check" aria-hidden="true">${m ? '✓' : ''}</span>
                    <span class="ut-main"><strong>${utEsc(item.name)}</strong>
                        <small>${[cfg.region ? utEsc(cfg.region(item)) : '', item.elevation ? `${Number(item.elevation).toLocaleString()} ${unit}` : '',
                            m ? `${utDate(m.peak.first?.date)} · ${utActLink(m.peak.first)}` : ''].filter(Boolean).join(' · ')}</small></span></li>`;
            const sorted = [...items].sort((a, b) => (Boolean(matches.get(b)) - Boolean(matches.get(a)))
                || (Number(b.elevation) || 0) - (Number(a.elevation) || 0));
            return `
            <section class="ut-peak-list${open ? ' open' : ''}">
                <button type="button" class="ut-peak-head" data-list="${cfg.id}" aria-expanded="${open}">
                    <span class="ut-main"><strong>${cfg.label}</strong>${utBar(matches.size, items.length)}</span>
                    <em>${matches.size} / ${items.length}</em>
                    <span class="ut-chev" aria-hidden="true">›</span>
                </button>
                ${open ? `<ul class="ut-list ut-peak-items">${sorted.map(item => peakRow(item, matches.get(item))).join('')}</ul>` : ''}
            </section>`;
        }).join('')}`;
}

function setUserTravelStats(places) {
    const set = (key, text) => document.querySelectorAll(`[data-stat="${key}"]`).forEach(el => { if (text) el.textContent = text; });
    if (places) {
        const fifty = [...places.states.keys()].filter(s => s !== 'District of Columbia').length;
        set('u-states', `${fifty} / 50 states`);
        if (utRef.countries) {
            const index = utCountryIndex();
            const n = [...places.countries.keys()].filter(c => index.has(c)).length;
            set('u-countries', `${n} countr${n === 1 ? 'y' : 'ies'}`);
        }
    }
    const results = utPeakResults();
    const hp = results?.find(r => r.cfg.id === 'highpoints');
    if (hp) set('u-peaks', `${hp.matches.size} / ${hp.items.length} high points`);
}

// ── Activities pop-up (a state / country row or tile) ─────────────────────
// Like the World Travel Countries table's Strava pop-up: totals, the longest
// activity by moving time (so a long day on foot outranks a faster ride), the
// latest, then every activity there. Everything is already on the page.

const UT_SORTS = [
    { id: 'newest', label: 'Newest', cmp: (a, b) => byStartTime(b, a) },
    { id: 'longest', label: 'Longest', cmp: (a, b) => (b.m || 0) - (a.m || 0) },
    { id: 'distance', label: 'Farthest', cmp: (a, b) => (b.di || 0) - (a.di || 0) },
];
const UT_PAGE = 50;

function utDuration(sec) {
    const h = Math.floor((sec || 0) / 3600), m = Math.round(((sec || 0) % 3600) / 60);
    return h ? `${h.toLocaleString()}h ${m}m` : `${m}m`;
}
function utMiles(m) {
    const mi = (m || 0) / 1609.344;
    return `${mi >= 100 ? Math.round(mi).toLocaleString() : mi.toFixed(1)} mi`;
}
function utActStats(a) {
    const out = [utDuration(a.m)];
    if (a.di) out.push(utMiles(a.di));
    if (a.e) out.push(`${Math.round(a.e * 3.28084).toLocaleString()} ft`);
    return out.join(' · ');
}
const utActUrl = a => `https://www.strava.com/activities/${encodeURIComponent(a.i)}`;
const utSport = t => (typeof typeLabel === 'function' ? typeLabel(t) : t);

function utHighlight(label, a) {
    if (!a) return '';
    return `<a class="ut-hl" href="${utActUrl(a)}" target="_blank" rel="noopener">
        <span class="ut-hl-label">${label}</span>
        <strong>${utEsc(a.n || 'Activity')}</strong>
        <small>${utEsc(utSport(a.t))} · ${utDate(a.d)}</small>
        <small>${utActStats(a)}</small></a>`;
}

function utActRow(a) {
    return `<li><a class="ut-act" href="${utActUrl(a)}" target="_blank" rel="noopener">
        <span class="ut-main"><strong>${utEsc(a.n || 'Activity')}</strong><small>${utDate(a.d)} · ${utEsc(utSport(a.t))}</small></span>
        <span class="ut-act-stats">${utActStats(a)}</span></a></li>`;
}

let utLastPlaces = null;
function utOpenPlace(kind, name) {
    const entry = utLastPlaces?.[kind === 'state' ? 'states' : 'countries'].get(name);
    if (!entry) return;
    const acts = entry.acts;
    const sec = acts.reduce((n, a) => n + (a.m || 0), 0);
    const di = acts.reduce((n, a) => n + (a.di || 0), 0);
    const longest = acts.reduce((best, a) => ((a.m || 0) > (best?.m || 0) ? a : best), null);
    const latest = acts.reduce((best, a) => (!best || byStartTime(a, best) > 0 ? a : best), null);
    const title = kind === 'state' ? `<span class="ut-abbr">${UT_STATE_ABBR[name] || ''}</span> ${utEsc(name)}` : `${utFlag(name)} ${utEsc(name)}`;

    const dialog = document.createElement('dialog');
    dialog.className = 'ut-dialog';
    dialog.setAttribute('aria-label', `Activities in ${name}`);
    dialog.innerHTML = `
        <div class="ut-dialog-head"><h2>${title}</h2><button type="button" class="ut-dialog-close" aria-label="Close">×</button></div>
        <p class="ut-note">${acts.length.toLocaleString()} ${acts.length === 1 ? 'activity' : 'activities'} · ${utDuration(sec)} moving · ${utMiles(di)}</p>
        <div class="ut-hls">${utHighlight('Longest', longest)}${utHighlight('Latest', latest)}</div>
        <div class="ut-dialog-bar"><h3 class="ut-h">All activities</h3>
            <div class="ut-sorts" role="group" aria-label="Sort">${UT_SORTS.map((o, i) =>
                `<button type="button" class="filter-pill${i ? '' : ' active'}" data-sort="${o.id}" aria-pressed="${!i}">${o.label}</button>`).join('')}</div></div>
        <ul class="ut-list ut-acts"></ul>
        <button type="button" class="cache-refresh-btn ut-more" hidden>Show more</button>`;
    document.body.appendChild(dialog);
    const list = dialog.querySelector('.ut-acts');
    const more = dialog.querySelector('.ut-more');
    let rows = [], shown = 0;
    const render = (sortId, append) => {
        if (!append) {
            rows = [...acts].sort(UT_SORTS.find(o => o.id === sortId).cmp);
            shown = 0;
            list.innerHTML = '';
        }
        list.insertAdjacentHTML('beforeend', rows.slice(shown, shown + UT_PAGE).map(utActRow).join(''));
        shown = Math.min(rows.length, shown + UT_PAGE);
        more.hidden = shown >= rows.length;
        more.textContent = `Show more (${(rows.length - shown).toLocaleString()} left)`;
    };
    let sortId = 'newest';
    dialog.querySelectorAll('[data-sort]').forEach(btn => btn.addEventListener('click', () => {
        sortId = btn.dataset.sort;
        dialog.querySelectorAll('[data-sort]').forEach(b => {
            b.classList.toggle('active', b === btn);
            b.setAttribute('aria-pressed', String(b === btn));
        });
        render(sortId, false);
    }));
    more.addEventListener('click', () => render(sortId, true));
    dialog.querySelector('.ut-dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.remove());
    render(sortId, false);
    dialog.showModal();
    if (typeof closeDialogOnBack === 'function') closeDialogOnBack(dialog);
}

let utRenderQueued = false;
function renderUserTravel() {
    if (!UT_ENABLED || utRenderQueued) return;
    utRenderQueued = true;
    requestAnimationFrame(() => {
        utRenderQueued = false;
        const places = utPlaces();
        utLastPlaces = places;
        setUserTravelStats(places);
        // Trace routes (once per new activity) as soon as activities are in.
        if (places && (utTrace.state === 'idle' || (utTrace.state === 'done' && utTrace.slimLen !== currentSlim.length))) {
            utTrace.slimLen = currentSlim.length;
            utTraceRoutes();
        }
        // Only the screen on show is drawn; the others draw when opened.
        const shown = screen => !document.getElementById(`screen-${screen}`)?.hidden;
        if (shown('states')) renderStates(places);
        if (shown('countries')) renderCountries(places);
        if (shown('peaks')) renderPeaks();
    });
}

if (UT_ENABLED) {
    document.addEventListener('DOMContentLoaded', () => {
        utLoadReference();
        utFetchServerSummits();
        ['ut-states', 'ut-countries'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const open = e => {
                const hit = e.target.closest('[data-place]');
                if (hit) utOpenPlace(hit.dataset.place, hit.dataset.name);
            };
            el.addEventListener('click', open);
            el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
        });
        document.getElementById('ut-peaks')?.addEventListener('click', e => {
            const head = e.target.closest('.ut-peak-head');
            if (!head) return;
            const id = head.dataset.list;
            if (utOpen.has(id)) utOpen.delete(id); else utOpen.add(id);
            renderPeaks();
        });
    });
    window.addEventListener('hashchange', renderUserTravel);
    document.addEventListener('stravaload', renderUserTravel);
}

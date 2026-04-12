const WORKER_URL = 'https://strava-worker.justinguyette.workers.dev';
const GEO_CACHE_KEY = 'strava_geo_cache_v2'; // v2: stores {c, s} instead of string
const ACTIVITIES_CACHE_KEY = 'strava_activities_cache_v2'; // v2: adds lastActivityTime
const ACTIVITIES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const GEO_BATCH = 10;

const GROUPS = {
    'Foot Sports':  ['Run','TrailRun','VirtualRun','Hike','Walk','Snowshoe'],
    'Bike Sports':  ['Ride','EBikeRide','VirtualRide','Handcycle','Velomobile'],
    'Snow Sports':  ['AlpineSki','BackcountrySki','NordicSki','Snowboard','Snowkite'],
    'Water Sports': ['Swim','OpenWaterSwim','Kayaking','Rowing','Surfing','Windsurf','Kitesurf','Canoeing','StandUpPaddling','Sail']
};
const GROUP_ICONS = {
    'Foot Sports':  '🦶',
    'Bike Sports':  '🚴',
    'Snow Sports':  '⛷️',
    'Water Sports': '🏊',
    'Other':        '💪'
};
const GROUP_KEYS = [...Object.keys(GROUPS), 'Other'];

// Countries with regional breakdowns.
// `names` covers variations BigDataCloud may return for the same country.
const SUBDIVISION_CONFIG = [
    { id: 'us',        names: ['United States', 'United States of America'], flag: '🇺🇸', label: 'US States',           colLabel: 'State'    },
    { id: 'canada',    names: ['Canada'],                                    flag: '🇨🇦', label: 'Canadian Provinces',   colLabel: 'Province' },
    { id: 'australia', names: ['Australia'],                                 flag: '🇦🇺', label: 'Australian States',    colLabel: 'State'    },
    { id: 'mexico',    names: ['Mexico'],                                    flag: '🇲🇽', label: 'Mexican States',       colLabel: 'State'    },
    { id: 'china',     names: ['China'],                                     flag: '🇨🇳', label: 'Chinese Provinces',    colLabel: 'Province' },
    { id: 'spain',     names: ['Spain'],                                     flag: '🇪🇸', label: 'Spanish Regions',      colLabel: 'Region'   },
];

// Build a flat lookup: countryName → config entry
const SUBDIVISION_BY_COUNTRY = {};
SUBDIVISION_CONFIG.forEach(cfg => cfg.names.forEach(n => SUBDIVISION_BY_COUNTRY[n] = cfg));

function getGroup(type) {
    for (const [group, types] of Object.entries(GROUPS)) {
        if (types.includes(type)) return group;
    }
    return 'Other';
}

function gridKey(latlng) {
    return `${latlng[0].toFixed(1)},${latlng[1].toFixed(1)}`;
}

// ── Activity cache ────────────────────────────────────────────────────────────

function loadActivityCache() {
    try {
        const raw = localStorage.getItem(ACTIVITIES_CACHE_KEY);
        if (!raw) return null;
        const { fetchedAt, slim, total, lastActivityTime } = JSON.parse(raw);
        if (Date.now() - fetchedAt > ACTIVITIES_CACHE_TTL_MS) return null;
        return { slim, fetchedAt, total: total ?? slim.length, lastActivityTime: lastActivityTime ?? null };
    } catch { return null; }
}

function saveActivityCache(slim, total, lastActivityTime) {
    const fetchedAt = Date.now();
    try { localStorage.setItem(ACTIVITIES_CACHE_KEY, JSON.stringify({ fetchedAt, slim, total, lastActivityTime })); } catch {}
    return fetchedAt;
}

function clearActivityCache() {
    try { localStorage.removeItem(ACTIVITIES_CACHE_KEY); } catch {}
}

// Convert full Strava activity objects → slim objects we actually need
function slimActivities(activities) {
    return activities
        .filter(a => a.start_latlng?.length)
        .map(a => ({ l: a.start_latlng, t: a.sport_type || a.type || 'Other' }));
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

// Extract the newest activity's unix timestamp from a raw batch (Strava returns newest first)
function newestTimestamp(batch) {
    for (const a of batch) {
        if (a.start_date) return Math.floor(new Date(a.start_date).getTime() / 1000);
    }
    return null;
}

async function fetchAllActivities(forceRefresh = false) {
    const cached = loadActivityCache();

    if (!forceRefresh && cached) {
        const age = Math.round((Date.now() - cached.fetchedAt) / 60000);
        setStatus(`Loaded from cache (${age}m ago)`);
        setCacheInfo(cached.fetchedAt, cached.slim.length, cached.total);
        return { slim: cached.slim, total: cached.total };
    }

    // Smart refresh: only fetch activities newer than what we already have
    if (forceRefresh && cached?.lastActivityTime) {
        return await fetchNewActivities(cached);
    }

    // Full fetch from scratch
    return await fetchFullActivities();
}

async function fetchFullActivities() {
    let slim = [];
    let total = 0;
    let page = 1;
    let lastActivityTime = null;
    setStatus('Fetching activities…');

    while (true) {
        const res = await fetch(`${WORKER_URL}/activities?per_page=200&page=${page}`);
        const batch = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        // Capture timestamp of the very first (newest) activity
        if (page === 1) lastActivityTime = newestTimestamp(batch);
        total += batch.length;
        slim = slim.concat(slimActivities(batch));
        setStatus(`Fetching activities… ${total} loaded (${slim.length} with GPS)`);
        page++;
    }

    const fetchedAt = saveActivityCache(slim, total, lastActivityTime);
    setCacheInfo(fetchedAt, slim.length, total);
    return { slim, total };
}

async function fetchNewActivities(cached) {
    let newSlim = [];
    let newTotal = 0;
    let page = 1;
    let newestSeen = cached.lastActivityTime;
    setStatus('Checking for new activities…');

    while (true) {
        const res = await fetch(`${WORKER_URL}/activities?per_page=200&page=${page}&after=${cached.lastActivityTime}`);
        const batch = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        // The first batch's first activity is the newest new one
        if (page === 1) {
            const ts = newestTimestamp(batch);
            if (ts) newestSeen = ts;
        }
        newTotal += batch.length;
        newSlim = newSlim.concat(slimActivities(batch));
        setStatus(`Found ${newTotal} new activities…`);
        page++;
    }

    if (newTotal === 0) {
        // Nothing new — just bump fetchedAt so the TTL resets
        const fetchedAt = saveActivityCache(cached.slim, cached.total, cached.lastActivityTime);
        setCacheInfo(fetchedAt, cached.slim.length, cached.total);
        setStatus('Up to date — no new activities');
        return { slim: cached.slim, total: cached.total };
    }

    const merged = [...newSlim, ...cached.slim];
    const total = cached.total + newTotal;
    const fetchedAt = saveActivityCache(merged, total, newestSeen);
    setCacheInfo(fetchedAt, merged.length, total);
    setStatus(`Added ${newTotal} new ${newTotal === 1 ? 'activity' : 'activities'}`);
    return { slim: merged, total };
}

// ── Geocoding ─────────────────────────────────────────────────────────────────

async function geocodeKey(key) {
    const [lat, lng] = key.split(',').map(Number);
    try {
        const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
        );
        const data = await res.json();
        return {
            c: data.countryName || 'Unknown',
            s: data.principalSubdivision || ''
        };
    } catch {
        return { c: 'Unknown', s: '' };
    }
}

// Load geo cache, migrating v1 string-format entries to v2 {c,s} objects.
// This recovers valid country data even if the v2 cache is empty or corrupt,
// so we don't need to re-hit the geocoding API for data we already have.
function loadGeoCache() {
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); } catch {}

    // Count how many entries are already valid v2 objects
    const entries = Object.entries(cache);
    const validV2 = entries.filter(([, v]) => v && typeof v === 'object' && v.c && v.c !== 'Unknown').length;

    // If most entries are missing or 'Unknown', try migrating from v1
    if (validV2 < entries.length * 0.5) {
        let v1 = {};
        try { v1 = JSON.parse(localStorage.getItem('strava_geo_cache_v1') || '{}'); } catch {}

        Object.entries(v1).forEach(([key, val]) => {
            // Only use v1 entry if current v2 entry is missing or Unknown
            const existing = cache[key];
            const existingOk = existing && typeof existing === 'object' && existing.c && existing.c !== 'Unknown';
            if (!existingOk && typeof val === 'string' && val !== 'Unknown') {
                cache[key] = { c: val, s: '' };
            }
        });

        // Also convert any remaining raw string values
        Object.keys(cache).forEach(key => {
            if (typeof cache[key] === 'string') {
                cache[key] = { c: cache[key], s: '' };
            }
        });

        try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch {}
    }

    return cache;
}

async function geocodeAll(keys, cache) {
    // Treat missing entries AND 'Unknown' entries as needing a (re-)geocode
    const uncached = keys.filter(k => {
        const v = cache[k];
        return !v || !v.c || v.c === 'Unknown';
    });
    let done = 0;

    for (let i = 0; i < uncached.length; i += GEO_BATCH) {
        const batch = uncached.slice(i, i + GEO_BATCH);
        await Promise.all(batch.map(async key => {
            const result = await geocodeKey(key);
            // Only overwrite if we got a real answer — don't replace good data with Unknown
            if (result.c !== 'Unknown') cache[key] = result;
            done++;
            setStatus(`Geocoding locations… ${done} / ${uncached.length}`);
        }));
        // Small pause between batches to avoid rate-limiting
        if (i + GEO_BATCH < uncached.length) await new Promise(r => setTimeout(r, 150));
    }

    try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch {}
    return cache;
}

// ── Build data ────────────────────────────────────────────────────────────────

function newBucket() {
    const b = { total: 0 };
    GROUP_KEYS.forEach(g => b[g] = 0);
    return b;
}

// Returns { countries, subdivisions }
// subdivisions: { [configId]: { [regionName]: bucket } }
function buildData(slim, cache) {
    const countries = {};
    const subdivisions = {};
    SUBDIVISION_CONFIG.forEach(cfg => subdivisions[cfg.id] = {});

    slim.forEach(a => {
        const geo = cache[gridKey(a.l)] || { c: 'Unknown', s: '' };
        const country = geo.c;
        const group = getGroup(a.t);

        if (!countries[country]) countries[country] = newBucket();
        countries[country][group]++;
        countries[country].total++;

        const cfg = SUBDIVISION_BY_COUNTRY[country];
        if (cfg && geo.s) {
            if (!subdivisions[cfg.id][geo.s]) subdivisions[cfg.id][geo.s] = newBucket();
            subdivisions[cfg.id][geo.s][group]++;
            subdivisions[cfg.id][geo.s].total++;
        }
    });

    return { countries, subdivisions };
}

// ── Sort state ────────────────────────────────────────────────────────────────

const sortState = { col: 'total', dir: 'desc' };

// One sort state per subdivision config id, created lazily
const subdivisionSortStates = {};
function getSortState(id) {
    if (!subdivisionSortStates[id]) subdivisionSortStates[id] = { col: 'total', dir: 'desc' };
    return subdivisionSortStates[id];
}

function sortedEntries(data, state, nameCol) {
    return Object.entries(data).sort(([nameA], [nameB]) => {
        const col = state.col;
        if (col === nameCol) {
            const cmp = nameA.localeCompare(nameB);
            return state.dir === 'asc' ? cmp : -cmp;
        }
        const aVal = data[nameA][col] ?? 0;
        const bVal = data[nameB][col] ?? 0;
        return state.dir === 'asc' ? aVal - bVal : bVal - aVal;
    });
}

// ── Render helpers ────────────────────────────────────────────────────────────

function buildSortableTable(data, state, nameCol, onSort) {
    const headers = [
        { label: nameCol, col: nameCol.toLowerCase() },
        ...GROUP_KEYS.map(g => ({ label: `${GROUP_ICONS[g]} ${g}`, col: g })),
        { label: 'Total', col: 'total' }
    ];

    const table = document.createElement('table');
    table.className = 'travel-table';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach(({ label, col }) => {
        const th = document.createElement('th');
        const isActive = state.col === col;
        th.classList.add('sortable');
        if (isActive) th.classList.add('sort-active');

        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = isActive ? (state.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';

        th.appendChild(document.createTextNode(label));
        th.appendChild(indicator);
        th.addEventListener('click', () => {
            if (state.col === col) {
                state.dir = state.dir === 'asc' ? 'desc' : 'asc';
            } else {
                state.col = col;
                state.dir = col === nameCol.toLowerCase() ? 'asc' : 'desc';
            }
            onSort();
        });
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    sortedEntries(data, state, nameCol.toLowerCase()).forEach(([name, d]) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${name}</td>
            ${GROUP_KEYS.map(g => `<td style="text-align:center">${d[g] || 0}</td>`).join('')}
            <td style="text-align:center"><strong>${d.total}</strong></td>
        `;
        tbody.appendChild(row);
    });
    table.appendChild(tbody);
    return table;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderSummary(slim, countries, total) {
    const countryCount = Object.keys(countries).length;
    const groupTotals = {};
    GROUP_KEYS.forEach(g => {
        groupTotals[g] = Object.values(countries).reduce((s, c) => s + (c[g] || 0), 0);
    });

    document.getElementById('strava-summary').innerHTML = `
        <div class="summary-stats-container">
            <div class="summary-stat strava-total">
                <div class="stat-number-container">
                    <span class="stat-number">${total.toLocaleString()}</span>
                </div>
                <span class="stat-label">Total Activities</span>
            </div>
            <div class="other-stats strava-group-stats">
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${countryCount}</span>
                    </div>
                    <span class="stat-label">Countries</span>
                </div>
                ${GROUP_KEYS.map(g => `
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${(groupTotals[g] || 0).toLocaleString()}</span>
                    </div>
                    <span class="stat-label">${GROUP_ICONS[g]} ${g}</span>
                </div>`).join('')}
            </div>
        </div>
    `;
}

function renderTable(countries) {
    const container = document.getElementById('strava-table-container');
    container.innerHTML = '';
    container.appendChild(
        buildSortableTable(countries, sortState, 'Country', () => renderTable(countries))
    );
}

function renderSubdivisions(subdivisions) {
    const wrapper = document.getElementById('strava-subdivisions');
    if (!wrapper) return;
    wrapper.innerHTML = '';

    SUBDIVISION_CONFIG.forEach(cfg => {
        const data = subdivisions[cfg.id];
        if (!data || Object.keys(data).length === 0) return;

        const section = document.createElement('div');
        section.className = 'section';
        section.id = `subdivision-${cfg.id}`;

        const heading = document.createElement('h2');
        heading.textContent = `${cfg.flag} By ${cfg.label}`;
        section.appendChild(heading);

        const state = getSortState(cfg.id);
        const rerender = () => {
            const tableEl = section.querySelector('table');
            if (tableEl) tableEl.remove();
            section.appendChild(
                buildSortableTable(data, state, cfg.colLabel, rerender)
            );
        };
        section.appendChild(buildSortableTable(data, state, cfg.colLabel, rerender));
        wrapper.appendChild(section);
    });
}

// ── Status / cache helpers ────────────────────────────────────────────────────

function setStatus(msg) {
    const el = document.getElementById('loading-status');
    if (el) el.textContent = msg;
}

function hideLoader() {
    const el = document.getElementById('loading-section');
    if (el) el.style.display = 'none';
}

function setCacheInfo(fetchedAt, gpsCount, total) {
    const el = document.getElementById('cache-info');
    if (!el) return;
    const date = new Date(fetchedAt).toLocaleString();
    const gpsPct = total > 0 ? ` · ${gpsCount.toLocaleString()} with GPS` : '';
    el.innerHTML = `
        <span class="cache-meta">Cached ${date}${gpsPct}</span>
        <button class="cache-refresh-btn" id="refresh-btn">Refresh now</button>
        <button class="cache-refresh-btn" id="full-refresh-btn" style="margin-left:4px">Full re-fetch</button>
    `;
    document.getElementById('refresh-btn').addEventListener('click', () => runPipeline(true));
    document.getElementById('full-refresh-btn').addEventListener('click', () => {
        clearActivityCache();
        runPipeline(false);
    });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function runPipeline(forceRefresh = false) {
    try {
        const { slim, total } = await fetchAllActivities(forceRefresh);

        const cellKeys = [...new Set(slim.map(a => gridKey(a.l)))];

        // Load geo cache, migrating v1 data if needed
        let cache = loadGeoCache();

        // Geocode any cells not yet in cache
        cache = await geocodeAll(cellKeys, cache);

        hideLoader();

        const { countries, subdivisions } = buildData(slim, cache);
        renderSummary(slim, countries, total);
        renderTable(countries);
        renderSubdivisions(subdivisions);

    } catch (err) {
        setStatus('Error loading data: ' + err.message);
        console.error(err);
    }
}

document.addEventListener('DOMContentLoaded', () => runPipeline(false));

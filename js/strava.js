const WORKER_URL = 'https://strava-worker.justinguyette.workers.dev';
const GEO_CACHE_KEY = 'strava_geo_cache_v2'; // v2: stores {c, s} instead of string
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
    { id: 'us',        names: ['United States', 'United States of America', 'United States of America (the)'], flag: '🇺🇸', label: 'US States',           colLabel: 'State'    },
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

// ── Fetch ─────────────────────────────────────────────────────────────────────

// Load all stored activities from the worker (one fast KV read, no Strava call)
async function loadFromWorker() {
    setStatus('Loading activities…');
    dbg('GET /activities/all — reading from KV…');
    const t0 = Date.now();
    const res = await fetch(`${WORKER_URL}/activities/all`);
    if (!res.ok) throw new Error(`Worker error: ${res.status}`);
    const data = await res.json();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    dbg(`Worker responded in ${elapsed}s`, {
        total: data.total,
        slimCount: data.slim?.length ?? 0,
        lastActivityTime: data.lastActivityTime
            ? new Date(data.lastActivityTime * 1000).toLocaleString()
            : null,
    });
    return data;
}

// Tell the worker to fetch new activities from Strava and merge them into KV
async function syncWithWorker() {
    setStatus('Syncing new activities…');
    dbg('POST /activities/sync — fetching new from Strava…');
    const t0 = Date.now();
    const res = await fetch(`${WORKER_URL}/activities/sync`, { method: 'POST' });
    if (!res.ok) throw new Error(`Sync error: ${res.status}`);
    const data = await res.json();
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    dbg(`Sync complete in ${elapsed}s`, {
        newActivities: data.newActivities,
        total: data.total,
        slimCount: data.slim?.length ?? 0,
        lastActivityTime: data.lastActivityTime
            ? new Date(data.lastActivityTime * 1000).toLocaleString()
            : null,
    });
    if (data.newActivities === 0) {
        setStatus('Up to date — no new activities');
    } else {
        setStatus(`Synced ${data.newActivities} new ${data.newActivities === 1 ? 'activity' : 'activities'}`);
    }
    return data;
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
    // Pass 1: BigDataCloud — batch all cells missing country or subdivision
    const needGeo = keys.filter(k => {
        const v = cache[k];
        if (!v || !v.c || v.c === 'Unknown') return true;
        if (SUBDIVISION_BY_COUNTRY[v.c] && !v.s) return true;
        return false;
    });

    let done = 0;
    for (let i = 0; i < needGeo.length; i += GEO_BATCH) {
        const batch = needGeo.slice(i, i + GEO_BATCH);
        await Promise.all(batch.map(async key => {
            const result = await geocodeKey(key);
            if (result.c !== 'Unknown') cache[key] = result;
            done++;
            setStatus(`Geocoding locations… ${done} / ${needGeo.length}`);
        }));
        if (i + GEO_BATCH < needGeo.length) await new Promise(r => setTimeout(r, 150));
    }

    // Pass 2: Nominatim fallback — sequential, 1 req/sec, for any subdivision countries
    // where BigDataCloud returned empty subdivision (e.g. China)
    const needSubdiv = keys.filter(k => {
        const v = cache[k];
        return v && v.c && v.c !== 'Unknown' && SUBDIVISION_BY_COUNTRY[v.c] && !v.s;
    });

    if (needSubdiv.length > 0) {
        dbg(`Nominatim fallback for ${needSubdiv.length} cells (1 req/sec)…`);
        for (let i = 0; i < needSubdiv.length; i++) {
            const key = needSubdiv[i];
            const [lat, lng] = key.split(',').map(Number);
            setStatus(`Getting subdivision via Nominatim… ${i + 1} / ${needSubdiv.length}`);
            const s = await geocodeSubdivisionNominatim(lat, lng);
            if (s) cache[key] = { ...cache[key], s };
            if (i < needSubdiv.length - 1) await new Promise(r => setTimeout(r, 1100));
        }
        dbg(`Nominatim done`, needSubdiv.slice(0, 5).map(k => ({ key: k, s: cache[k]?.s || '(empty)' })));
    }

    try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch {}
    return cache;
}

// Strip common suffixes OSM appends to Chinese province names
function cleanSubdivision(s) {
    return s
        .replace(/ Province$/, '')
        .replace(/ Autonomous Region$/, '')
        .replace(/ Municipality$/, '')
        .replace(/ Special Administrative Region$/, '')
        .trim();
}

async function geocodeSubdivisionNominatim(lat, lng) {
    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en`,
            { headers: { 'User-Agent': 'j-guyy.github.io/strava-stats' } }
        );
        const data = await res.json();
        const raw = data.address?.state || data.address?.province || '';
        return raw ? cleanSubdivision(raw) : '';
    } catch {
        return '';
    }
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

// ── Debug log ─────────────────────────────────────────────────────────────────

const debugLog = [];

function dbg(msg, data = null) {
    const ts = new Date().toLocaleTimeString();
    const entry = { ts, msg, data };
    debugLog.push(entry);

    const list = document.getElementById('debug-log');
    if (!list) return;

    const li = document.createElement('li');
    li.innerHTML = `<span class="dbg-ts">${ts}</span> ${msg}`;
    if (data !== null) {
        const pre = document.createElement('pre');
        pre.className = 'dbg-data';
        pre.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        li.appendChild(pre);
    }
    list.appendChild(li);
    list.scrollTop = list.scrollHeight;
}

function toggleDebug() {
    const panel = document.getElementById('debug-panel');
    if (!panel) return;
    panel.hidden = !panel.hidden;
}

function renderDebugPanel() {
    const existing = document.getElementById('debug-panel');
    if (existing) return; // already rendered

    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.hidden = true;
    panel.innerHTML = `
        <div class="dbg-header">
            <strong>Debug Log</strong>
            <button class="dbg-clear" onclick="document.getElementById('debug-log').innerHTML=''">Clear</button>
        </div>
        <ul id="debug-log"></ul>
    `;
    document.body.appendChild(panel);
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

function setCacheInfo(gpsCount, total) {
    const el = document.getElementById('cache-info');
    if (!el) return;
    const gpsNote = total > 0 ? ` · ${gpsCount.toLocaleString()} with GPS` : '';
    el.innerHTML = `
        <span class="cache-meta">${total.toLocaleString()} activities${gpsNote}</span>
        <button class="cache-refresh-btn" id="refresh-btn">Sync new activities</button>
        <button class="cache-refresh-btn dbg-toggle-btn" onclick="toggleDebug()">Debug</button>
    `;
    document.getElementById('refresh-btn').addEventListener('click', () => runPipeline(true));
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function runPipeline(sync = false) {
    try {
        dbg(`Pipeline start — mode: ${sync ? 'sync' : 'load'}`);

        let { slim, total } = sync ? await syncWithWorker() : await loadFromWorker();

        // If KV is empty (first time), trigger an initial sync automatically
        if (!sync && slim.length === 0 && total === 0) {
            setStatus('No data yet — running initial sync…');
            dbg('KV empty — triggering initial sync');
            ({ slim, total } = await syncWithWorker());
        }

        setCacheInfo(slim.length, total);

        const cellKeys = [...new Set(slim.map(a => gridKey(a.l)))];
        dbg(`Unique grid cells: ${cellKeys.length} (from ${slim.length} GPS activities)`);

        let cache = loadGeoCache();

        // Break down what's in the cache for each cell key
        let hits = 0, needGeo = 0, needSubdiv = 0;
        const sampleMissing = [];
        cellKeys.forEach(k => {
            const v = cache[k];
            if (!v || !v.c || v.c === 'Unknown') {
                needGeo++;
                if (sampleMissing.length < 3) sampleMissing.push({ key: k, entry: v ?? null });
            } else if (SUBDIVISION_BY_COUNTRY[v.c] && !v.s) {
                needSubdiv++;
                if (sampleMissing.length < 3) sampleMissing.push({ key: k, entry: v, reason: 'missing subdivision' });
            } else {
                hits++;
            }
        });
        dbg(`Geo cache: ${hits} good, ${needGeo} missing country, ${needSubdiv} missing subdivision`, sampleMissing.length ? sampleMissing : null);

        cache = await geocodeAll(cellKeys, cache);

        // After geocoding, sample a few subdivision-country entries to verify state data
        const subdivSample = cellKeys
            .map(k => ({ k, v: cache[k] }))
            .filter(({ v }) => v && SUBDIVISION_BY_COUNTRY[v.c])
            .slice(0, 5)
            .map(({ k, v }) => ({ key: k, country: v.c, subdivision: v.s || '(empty)' }));
        dbg(`Post-geocode subdivision sample`, subdivSample.length ? subdivSample : 'none found');

        hideLoader();

        const { countries, subdivisions } = buildData(slim, cache);
        const subCounts = SUBDIVISION_CONFIG
            .filter(cfg => Object.keys(subdivisions[cfg.id] ?? {}).length > 0)
            .map(cfg => `${cfg.flag} ${Object.keys(subdivisions[cfg.id]).length}`);
        dbg(`Countries found: ${Object.keys(countries).sort().join(', ')}`);
        dbg(`Subdivisions: ${subCounts.join(', ') || 'none'}`);

        renderSummary(slim, countries, total);
        renderTable(countries);
        renderSubdivisions(subdivisions);
        dbg('Render complete');

    } catch (err) {
        dbg(`ERROR: ${err.message}`);
        setStatus('Error: ' + err.message);
        console.error(err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    renderDebugPanel();
    runPipeline(false);
});

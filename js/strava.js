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

// ── Fetch ─────────────────────────────────────────────────────────────────────

// Load all stored activities from the worker (one fast KV read, no Strava call)
async function loadFromWorker() {
    setStatus('Loading activities…');
    const res = await fetch(`${WORKER_URL}/activities/all`);
    if (!res.ok) throw new Error(`Worker error: ${res.status}`);
    return res.json(); // { slim, total, lastActivityTime }
}

// Tell the worker to fetch new activities from Strava and merge them into KV
async function syncWithWorker() {
    setStatus('Syncing new activities…');
    const res = await fetch(`${WORKER_URL}/activities/sync`, { method: 'POST' });
    if (!res.ok) throw new Error(`Sync error: ${res.status}`);
    const data = await res.json(); // { slim, total, lastActivityTime, newActivities }
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
    // Re-geocode if: missing, Unknown country, or country expects a subdivision but has none
    const uncached = keys.filter(k => {
        const v = cache[k];
        if (!v || !v.c || v.c === 'Unknown') return true;
        if (SUBDIVISION_BY_COUNTRY[v.c] && !v.s) return true;
        return false;
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

function setCacheInfo(gpsCount, total) {
    const el = document.getElementById('cache-info');
    if (!el) return;
    const gpsNote = total > 0 ? ` · ${gpsCount.toLocaleString()} with GPS` : '';
    el.innerHTML = `
        <span class="cache-meta">${total.toLocaleString()} activities${gpsNote}</span>
        <button class="cache-refresh-btn" id="refresh-btn">Sync new activities</button>
    `;
    document.getElementById('refresh-btn').addEventListener('click', () => runPipeline(true));
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function runPipeline(sync = false) {
    try {
        let { slim, total } = sync ? await syncWithWorker() : await loadFromWorker();

        // If KV is empty (first time), trigger an initial sync automatically
        if (!sync && slim.length === 0 && total === 0) {
            setStatus('No data yet — running initial sync…');
            ({ slim, total } = await syncWithWorker());
        }

        setCacheInfo(slim.length, total);

        const cellKeys = [...new Set(slim.map(a => gridKey(a.l)))];
        let cache = loadGeoCache();
        cache = await geocodeAll(cellKeys, cache);

        hideLoader();

        const { countries, subdivisions } = buildData(slim, cache);
        renderSummary(slim, countries, total);
        renderTable(countries);
        renderSubdivisions(subdivisions);

    } catch (err) {
        setStatus('Error: ' + err.message);
        console.error(err);
    }
}

document.addEventListener('DOMContentLoaded', () => runPipeline(false));

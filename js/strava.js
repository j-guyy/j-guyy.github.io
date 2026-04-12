const WORKER_URL = 'https://strava-worker.justinguyette.workers.dev';
const GEO_CACHE_KEY = 'strava_geo_cache_v2'; // v2: stores {c, s} instead of string
const ACTIVITIES_CACHE_KEY = 'strava_activities_cache_v1';
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
        const { fetchedAt, slim } = JSON.parse(raw);
        if (Date.now() - fetchedAt > ACTIVITIES_CACHE_TTL_MS) return null;
        return { slim, fetchedAt };
    } catch { return null; }
}

function saveActivityCache(slim) {
    const fetchedAt = Date.now();
    try { localStorage.setItem(ACTIVITIES_CACHE_KEY, JSON.stringify({ fetchedAt, slim })); } catch {}
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

async function fetchAllActivities(forceRefresh = false) {
    if (!forceRefresh) {
        const cached = loadActivityCache();
        if (cached) {
            const age = Math.round((Date.now() - cached.fetchedAt) / 60000);
            setStatus(`Loaded ${cached.slim.length} activities from cache (${age}m ago)`);
            setCacheInfo(cached.fetchedAt, cached.slim.length);
            return cached.slim;
        }
    }

    let slim = [];
    let page = 1;
    setStatus(`Fetching activities…`);

    while (true) {
        const res = await fetch(`${WORKER_URL}/activities?per_page=200&page=${page}`);
        const batch = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        slim = slim.concat(slimActivities(batch));
        setStatus(`Fetching activities… ${slim.length}+ with GPS loaded`);
        page++;
    }

    const fetchedAt = saveActivityCache(slim);
    setCacheInfo(fetchedAt, slim.length);
    return slim;
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

async function geocodeAll(keys, cache) {
    const uncached = keys.filter(k => !(k in cache));
    let done = 0;

    for (let i = 0; i < uncached.length; i += GEO_BATCH) {
        const batch = uncached.slice(i, i + GEO_BATCH);
        await Promise.all(batch.map(async key => {
            cache[key] = await geocodeKey(key);
            done++;
            setStatus(`Geocoding locations… ${done} / ${uncached.length}`);
        }));
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

function renderSummary(slim, countries) {
    const total = slim.length;
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
                <span class="stat-label">Total Activities (with GPS)</span>
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

function setCacheInfo(fetchedAt, count) {
    const el = document.getElementById('cache-info');
    if (!el) return;
    const date = new Date(fetchedAt).toLocaleString();
    el.innerHTML = `
        <span class="cache-meta">Data cached ${date} · ${count.toLocaleString()} GPS activities</span>
        <button class="cache-refresh-btn" id="refresh-btn">Refresh now</button>
    `;
    document.getElementById('refresh-btn').addEventListener('click', () => {
        clearActivityCache();
        location.reload();
    });
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function () {
    try {
        const slim = await fetchAllActivities();

        const cellKeys = [...new Set(slim.map(a => gridKey(a.l)))];

        let cache = {};
        try { cache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); } catch {}

        cache = await geocodeAll(cellKeys, cache);

        hideLoader();

        const { countries, subdivisions } = buildData(slim, cache);
        renderSummary(slim, countries);
        renderTable(countries);
        renderSubdivisions(subdivisions);

    } catch (err) {
        setStatus('Error loading data: ' + err.message);
        console.error(err);
    }
});

const WORKER_URL = 'https://strava-worker.justinguyette.workers.dev';
const GEO_CACHE_KEY = 'strava_geo_cache_v3'; // v3: 0.01° grid precision (was 0.1°)

const GROUPS = {
    'Foot Sports':  ['Run','TrailRun','VirtualRun','Hike','Walk','Snowshoe'],
    'Bike Sports':  ['Ride','GravelRide','EBikeRide','VirtualRide','Handcycle','Velomobile'],
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

// Friendly display names for Strava sport types
const TYPE_LABELS = {
    TrailRun: 'Trail Run', VirtualRun: 'Virtual Run', EBikeRide: 'E-Bike',
    VirtualRide: 'Virtual Ride', AlpineSki: 'Alpine Ski', BackcountrySki: 'Backcountry Ski',
    NordicSki: 'Nordic Ski', OpenWaterSwim: 'Open Water', StandUpPaddling: 'SUP',
};
function typeLabel(t) { return TYPE_LABELS[t] || t; }

// ── Filter state ──────────────────────────────────────────────────────────────
// Uses a deactivated set — new types default to active without needing initialization
const deactivatedTypes = new Set();
let currentSlim = [];
let currentTotal = 0;
let currentCache = {};

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
    return `${latlng[0].toFixed(2)},${latlng[1].toFixed(2)}`;
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

// Single geocoding function using Nominatim — returns both country and subdivision.
// Replaces BigDataCloud which proved unreliable for bulk requests.
async function geocodeKey(lat, lng) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            if (attempt > 0) {
                dbg(`Nominatim retry ${attempt} for ${lat},${lng}`);
                await new Promise(r => setTimeout(r, 2000 * attempt));
            }
            const res = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=en`,
                { headers: { 'User-Agent': 'j-guyy.github.io/strava-stats' } }
            );
            if (!res.ok) {
                dbg(`Nominatim HTTP ${res.status} for ${lat},${lng}`);
                continue;
            }
            const data = await res.json();
            const country = data.address?.country || 'Unknown';
            const rawSubdiv = data.address?.state || data.address?.territory || data.address?.province || '';
            return { c: country, s: rawSubdiv ? cleanSubdivision(rawSubdiv) : '' };
        } catch (err) {
            dbg(`Nominatim error for ${lat},${lng} (attempt ${attempt + 1}): ${err.message}`);
        }
    }
    return { c: 'Unknown', s: '' };
}

// Load geo cache — server (KV) is authoritative, localStorage is fallback
async function loadGeoCache() {
    try {
        const res = await fetch(`${WORKER_URL}/geo/all`);
        if (res.ok) {
            const serverCache = await res.json();
            if (Object.keys(serverCache).length > 0) {
                dbg(`Geo cache: ${Object.keys(serverCache).length} entries from server`);
                try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(serverCache)); } catch {}
                return serverCache;
            }
        }
    } catch {}

    // Fall back to localStorage (first-ever load, or server cache is empty/reset)
    let cache = {};
    try { cache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); } catch {}
    dbg(`Geo cache: ${Object.keys(cache).length} entries from localStorage (server was empty)`);
    return cache;
}

async function saveGeoToWorker(cache) {
    try {
        const res = await fetch(`${WORKER_URL}/geo/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cache)
        });
        const data = await res.json();
        dbg(`Geo cache saved to server (${data.keys} entries)`);
    } catch (err) {
        dbg(`Warning: failed to save geo cache to server — ${err.message}`);
    }
}

async function resetGeoCache() {
    if (!confirm('Clear all geocoded location data from the server? This will force a full re-geocode on next load.')) return;
    try {
        await fetch(`${WORKER_URL}/geo/reset`, { method: 'POST' });
        localStorage.removeItem(GEO_CACHE_KEY);
        dbg('Geo cache reset on server and locally. Reloading…');
        setTimeout(() => location.reload(), 800);
    } catch (err) {
        dbg(`Reset failed: ${err.message}`);
    }
}

async function geocodeAll(keys, cache) {
    // Single Nominatim pass — handles both country and subdivision in one call.
    // Sequential at 1.1s/cell to respect Nominatim's rate limit.
    // Server-cached after first run so this only ever runs once.
    const needGeo = keys.filter(k => {
        const v = cache[k];
        if (!v || !v.c || v.c === 'Unknown') return true;
        if (SUBDIVISION_BY_COUNTRY[v.c] && !v.s) return true;
        return false;
    });

    if (needGeo.length === 0) return { cache, modified: false };

    const estMins = Math.ceil(needGeo.length * 1.1 / 60);
    dbg(`Nominatim geocoding: ${needGeo.length} cells (~${estMins} min, one-time only)`);

    let succeeded = 0;
    for (let i = 0; i < needGeo.length; i++) {
        const key = needGeo[i];
        const [lat, lng] = key.split(',').map(Number);
        setStatus(`Geocoding… ${i + 1} / ${needGeo.length}`);

        const result = await geocodeKey(lat, lng);
        if (result.c !== 'Unknown') { cache[key] = result; succeeded++; }

        try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch {}

        // Checkpoint save to server every 25 calls
        if ((i + 1) % 25 === 0) {
            dbg(`Checkpoint ${i + 1} / ${needGeo.length} — ${succeeded} geocoded so far`);
            await saveGeoToWorker(cache);
        }

        if (i < needGeo.length - 1) await new Promise(r => setTimeout(r, 1100));
    }

    dbg(`Geocoding complete: ${succeeded} / ${needGeo.length} cells resolved`);
    try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch {}
    return { cache, modified: succeeded > 0 };
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

// ── Filters ───────────────────────────────────────────────────────────────────

function renderFilters() {
    const container = document.getElementById('strava-filters');
    if (!container) return;

    // Tally types from the full (unfiltered) slim list
    const typeCounts = {};
    currentSlim.forEach(a => { typeCounts[a.t] = (typeCounts[a.t] || 0) + 1; });
    const allTypes = Object.keys(typeCounts);
    if (allTypes.length === 0) { container.innerHTML = ''; return; }

    // Group types by sport category, preserving GROUP_KEYS order
    const grouped = {};
    allTypes.forEach(t => {
        const g = getGroup(t);
        if (!grouped[g]) grouped[g] = [];
        grouped[g].push(t);
    });

    let html = `<div class="filter-bar">
        <div class="filter-controls">
            <button class="filter-all-btn" onclick="setAllFilters(true)">All</button>
            <button class="filter-all-btn" onclick="setAllFilters(false)">None</button>
        </div>
        <div class="filter-groups">`;

    GROUP_KEYS.forEach(groupName => {
        const types = grouped[groupName];
        if (!types || types.length === 0) return;
        types.sort();
        // Group header is active if ALL types in the group are active
        const groupActive = types.every(t => !deactivatedTypes.has(t));
        html += `<div class="filter-group">
            <button class="filter-group-label${groupActive ? ' active' : ''}" onclick="toggleGroup('${groupName}')">${GROUP_ICONS[groupName]} ${groupName}</button>
            <div class="filter-pills">`;
        types.forEach(t => {
            const active = !deactivatedTypes.has(t);
            const label = typeLabel(t);
            const count = typeCounts[t];
            html += `<button class="filter-pill${active ? ' active' : ''}" onclick="toggleSportType('${t}')">${label} <span class="filter-pill-count">${count}</span></button>`;
        });
        html += `</div></div>`;
    });

    html += `</div></div>`;
    container.innerHTML = html;
}

function toggleGroup(groupName) {
    const typesInGroup = [...new Set(currentSlim.filter(a => getGroup(a.t) === groupName).map(a => a.t))];
    const allActive = typesInGroup.every(t => !deactivatedTypes.has(t));
    typesInGroup.forEach(t => allActive ? deactivatedTypes.add(t) : deactivatedTypes.delete(t));
    renderFilters();
    applyFilters();
    updateMapFilters();
}

function toggleSportType(type) {
    if (deactivatedTypes.has(type)) {
        deactivatedTypes.delete(type);
    } else {
        deactivatedTypes.add(type);
    }
    renderFilters();
    applyFilters();
    updateMapFilters();
}

function setAllFilters(enabled) {
    const typeCounts = {};
    currentSlim.forEach(a => { typeCounts[a.t] = 1; });
    if (enabled) {
        deactivatedTypes.clear();
    } else {
        Object.keys(typeCounts).forEach(t => deactivatedTypes.add(t));
    }
    renderFilters();
    applyFilters();
    updateMapFilters();
}

function applyFilters() {
    const filtered = deactivatedTypes.size === 0
        ? currentSlim
        : currentSlim.filter(a => !deactivatedTypes.has(a.t));

    // When all types are active, show the true KV total (includes non-GPS activities).
    // When filtering, show the filtered GPS count so the number matches what's displayed.
    const displayTotal = deactivatedTypes.size === 0 ? currentTotal : filtered.length;

    const { countries, subdivisions } = buildData(filtered, currentCache);
    renderSummary(filtered, countries, displayTotal);
    renderTable(countries);
    renderSubdivisions(subdivisions);
}

// ── Render helpers ────────────────────────────────────────────────────────────

function buildSortableTable(data, state, nameCol, onSort) {
    const headers = [
        { label: nameCol, col: nameCol.toLowerCase() },
        { label: 'Total', col: 'total' },
        ...GROUP_KEYS.map(g => ({ label: `${GROUP_ICONS[g]} ${g}`, col: g })),
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
            <td style="text-align:center"><strong>${d.total}</strong></td>
            ${GROUP_KEYS.map(g => `<td style="text-align:center">${d[g] || 0}</td>`).join('')}
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

// ── Map ───────────────────────────────────────────────────────────────────────

const GROUP_COLORS = {
    'Foot Sports':  '#4CAF50',
    'Bike Sports':  '#FF9800',
    'Snow Sports':  '#90CAF9',
    'Water Sports': '#42A5F5',
    'Other':        '#9E9E9E',
};

let stravaMap = null;
let mapInitialized = false;
// Each entry: { layer: L.polyline, type: string }
let mapLayers = [];

function toggleMap() {
    const section = document.getElementById('map-section');
    const btn = document.getElementById('map-toggle-btn');
    if (!section) return;

    const opening = section.style.display === 'none';
    section.style.display = opening ? 'block' : 'none';
    if (btn) btn.textContent = opening ? 'Hide map' : 'Show map';

    if (opening && !mapInitialized) {
        initMap();
    } else if (opening && stravaMap) {
        // Leaflet loses track of its size when hidden; recalculate on reveal
        setTimeout(() => stravaMap.invalidateSize(), 50);
    }
}

async function initMap() {
    const container = document.getElementById('strava-map');
    const statusEl = document.getElementById('map-status');
    if (!container) return;

    setMapStatus('Initializing map…');

    // Canvas renderer handles thousands of polylines far better than SVG
    stravaMap = L.map('strava-map', {
        renderer: L.canvas(),
        preferCanvas: true,
    }).setView([30, 0], 2);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(stravaMap);

    // Lazy-fetch polylines — separate from the stats payload
    setMapStatus('Fetching routes…');
    dbg('GET /polylines/all…');
    let polylines = [];
    try {
        const res = await fetch(`${WORKER_URL}/polylines/all`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        polylines = await res.json();
        dbg(`Polylines: ${polylines.length} total, ${polylines.filter(Boolean).length} with GPS`);
    } catch (err) {
        dbg(`Polylines fetch failed: ${err.message}`);
        setMapStatus('Failed to load routes.');
        return;
    }

    setMapStatus('Drawing routes…');

    mapLayers = [];
    const allPoints = [];

    polylines.forEach((encoded, i) => {
        if (!encoded) return;
        const slim = currentSlim[i];
        if (!slim) return;

        const points = decodePolyline(encoded);
        if (points.length === 0) return;

        const group = getGroup(slim.t);
        const color = GROUP_COLORS[group] || GROUP_COLORS['Other'];
        const visible = !deactivatedTypes.has(slim.t);

        const layer = L.polyline(points, {
            color,
            weight: 1.5,
            opacity: visible ? 0.55 : 0,
        }).addTo(stravaMap);

        mapLayers.push({ layer, type: slim.t });
        if (visible) points.forEach(p => allPoints.push(p));
    });

    if (allPoints.length > 0) {
        stravaMap.fitBounds(allPoints, { padding: [20, 20] });
    }

    renderMapLegend();
    mapInitialized = true;

    const drawn = mapLayers.length;
    setMapStatus(`${drawn.toLocaleString()} routes`);
    dbg(`Map rendered: ${drawn} polylines`);
}

// Show/hide polylines to match the current deactivatedTypes filter state
function updateMapFilters() {
    if (!mapInitialized) return;
    mapLayers.forEach(({ layer, type }) => {
        layer.setStyle({ opacity: deactivatedTypes.has(type) ? 0 : 0.55 });
    });
}

function renderMapLegend() {
    const el = document.getElementById('map-legend');
    if (!el) return;
    // Only show groups that have at least one drawn polyline
    const presentGroups = [...new Set(mapLayers.map(({ type }) => getGroup(type)))];
    el.innerHTML = GROUP_KEYS
        .filter(g => presentGroups.includes(g))
        .map(g => `<span class="map-legend-item">
            <span class="map-legend-dot" style="background:${GROUP_COLORS[g]}"></span>${g}
        </span>`)
        .join('');
}

function setMapStatus(msg) {
    const el = document.getElementById('map-status');
    if (el) el.textContent = msg;
}

// Google encoded polyline decoder (no library needed)
function decodePolyline(encoded) {
    const points = [];
    let index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        lat += (result & 1) ? ~(result >> 1) : (result >> 1);

        shift = 0; result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        lng += (result & 1) ? ~(result >> 1) : (result >> 1);

        points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
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
            <div style="display:flex;gap:6px">
                <button class="dbg-clear" onclick="resetGeoCache()" title="Clear geocoded location data from server and localStorage — forces full re-geocode">Reset geo cache</button>
                <button class="dbg-clear" onclick="document.getElementById('debug-log').innerHTML=''">Clear log</button>
            </div>
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

const SYNC_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

function relativeTime(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (mins > 0) return `${mins}m ago`;
    return 'just now';
}

function setCacheInfo(gpsCount, total, syncedAt) {
    const el = document.getElementById('cache-info');
    if (!el) return;
    const gpsNote = total > 0 ? ` · ${gpsCount.toLocaleString()} with GPS` : '';
    const syncNote = syncedAt ? `Synced ${relativeTime(syncedAt)}` : 'Never synced';
    el.innerHTML = `
        <span class="cache-meta">${total.toLocaleString()} activities${gpsNote} · ${syncNote}</span>
        <button class="cache-refresh-btn" id="refresh-btn">Sync now</button>
        <button class="cache-refresh-btn dbg-toggle-btn" onclick="toggleDebug()">Debug</button>
    `;
    document.getElementById('refresh-btn').addEventListener('click', () => runPipeline(true));
}

// ── Init ──────────────────────────────────────────────────────────────────────

// Geocode any new cells, save to server if needed, then render everything
async function geocodeAndRender(slim, total, syncedAt, cache) {
    setCacheInfo(slim.length, total, syncedAt);

    const cellKeys = [...new Set(slim.map(a => gridKey(a.l)))];
    dbg(`Unique grid cells: ${cellKeys.length} (from ${slim.length} GPS activities)`);

    let hits = 0, needCountry = 0, needSubdiv = 0;
    cellKeys.forEach(k => {
        const v = cache[k];
        if (!v || !v.c || v.c === 'Unknown') needCountry++;
        else if (SUBDIVISION_BY_COUNTRY[v.c] && !v.s) needSubdiv++;
        else hits++;
    });
    dbg(`Geo cache: ${hits} good, ${needCountry} need country, ${needSubdiv} need subdivision`);

    const { cache: updatedCache, modified } = await geocodeAll(cellKeys, cache);
    if (modified) await saveGeoToWorker(updatedCache);

    hideLoader();

    // Save to globals so filter re-renders can access them without refetching
    currentSlim = slim;
    currentTotal = total;
    currentCache = updatedCache;

    const { countries, subdivisions } = buildData(slim, updatedCache);
    const subCounts = SUBDIVISION_CONFIG
        .filter(cfg => Object.keys(subdivisions[cfg.id] ?? {}).length > 0)
        .map(cfg => `${cfg.flag} ${Object.keys(subdivisions[cfg.id]).length}`);
    dbg(`Countries: ${Object.keys(countries).sort().join(', ')}`);
    dbg(`Subdivisions: ${subCounts.join(', ') || 'none'}`);

    renderFilters();
    renderSummary(slim, countries, total);
    renderTable(countries);
    renderSubdivisions(subdivisions);
    dbg('Render complete');

    return updatedCache;
}

async function runPipeline(forceSync = false) {
    try {
        dbg(`Pipeline start — mode: ${forceSync ? 'force-sync' : 'load'}`);

        // Fetch activities + geo cache from the server in parallel
        const [activityData, geoCache] = await Promise.all([
            loadFromWorker(),
            loadGeoCache()
        ]);

        let { slim, total, syncedAt } = activityData;
        let cache = geoCache;

        // First-ever load: KV is empty, run initial sync before rendering
        if (slim.length === 0 && total === 0) {
            setStatus('No data yet — running initial sync…');
            dbg('KV empty — triggering initial sync');
            ({ slim, total, syncedAt } = await syncWithWorker());
        }

        // Render with current cached data immediately
        cache = await geocodeAndRender(slim, total, syncedAt, cache);

        // Auto-sync if cooldown expired, or always if forced by the button
        const cooldownExpired = !syncedAt || (Date.now() - syncedAt) > SYNC_COOLDOWN_MS;
        if (forceSync || cooldownExpired) {
            const reason = forceSync ? 'manual' : `last sync ${relativeTime(syncedAt)}`;
            dbg(`Syncing with Strava (${reason})…`);
            const result = await syncWithWorker();
            if (result.newActivities > 0) {
                dbg(`${result.newActivities} new activities — re-rendering`);
                cache = await geocodeAndRender(result.slim, result.total, result.syncedAt, cache);
            } else {
                // Update the sync timestamp in the bar even if no new activities
                setCacheInfo(slim.length, total, result.syncedAt);
            }
        } else {
            dbg(`Auto-sync skipped — last synced ${relativeTime(syncedAt)}, cooldown is ${SYNC_COOLDOWN_MS / 3600000}h`);
        }

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

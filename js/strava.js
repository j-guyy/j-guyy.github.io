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

async function resetCountyData() {
    if (!confirm('Clear all county detection data from the server? This will force a full re-detection on next county map open.')) return;
    try {
        await fetch(`${WORKER_URL}/counties/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fips: [], processedIds: [] }),
        });
        countyMapInitialized = false;
        visitedFips.clear();
        countyProcessedIds.clear();
        dbg('County data reset. Reopen the County Hunter map to re-detect.');
    } catch (err) {
        dbg(`County reset failed: ${err.message}`);
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

// ── County Hunter ─────────────────────────────────────────────────────────────

const LSAD_NAMES = {
    '06': 'County',        '07': 'city',          '11': 'Census Area',
    '12': 'Borough',       '13': 'City and Borough', '15': 'Parish',
    '25': 'city',
};

const STATE_ABBR = {
    '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT',
    '10':'DE','11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL',
    '18':'IN','19':'IA','20':'KS','21':'KY','22':'LA','23':'ME','24':'MD',
    '25':'MA','26':'MI','27':'MN','28':'MS','29':'MO','30':'MT','31':'NE',
    '32':'NV','33':'NH','34':'NJ','35':'NM','36':'NY','37':'NC','38':'ND',
    '39':'OH','40':'OK','41':'OR','42':'PA','44':'RI','45':'SC','46':'SD',
    '47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA','54':'WV',
    '55':'WI','56':'WY','72':'PR',
};

let countyMap = null;
let countyMapInitialized = false;
let visitedFips = new Set();
let countyProcessedIds = new Set();

function toggleCountyMap() {
    const section = document.getElementById('county-section');
    const btn = document.getElementById('county-toggle-btn');
    if (!section) return;

    const opening = section.style.display === 'none';
    section.style.display = opening ? 'block' : 'none';
    if (btn) btn.textContent = opening ? 'Hide map' : 'Show map';

    if (opening && !countyMapInitialized) {
        initCountyMap();
    } else if (opening && countyMap) {
        setTimeout(() => countyMap.invalidateSize(), 50);
    }
}

async function initCountyMap() {
    setCountyStatus('Loading county boundaries…');
    dbg('County map: loading GeoJSON + saved data…');

    let geojson, saved;
    try {
        [geojson, saved] = await Promise.all([
            fetch('/data/counties-us.json').then(r => r.json()),
            fetch(`${WORKER_URL}/counties/all`).then(r => r.json()),
        ]);
    } catch (err) {
        dbg(`County map load error: ${err.message}`);
        setCountyStatus('Failed to load county data.');
        return;
    }

    // Filter out nulls — NaN serialises to null in JSON, guard against corrupt saves
    visitedFips       = new Set((saved.fips         || []).filter(Boolean));
    countyProcessedIds = new Set((saved.processedIds || []).filter(Boolean));
    dbg(`County cache: ${visitedFips.size} counties, ${countyProcessedIds.size} processed activities`);

    // Only process activities with polylines not yet analysed
    const unprocessed = currentSlim.filter(a => a.i && a.p && !countyProcessedIds.has(a.i));
    dbg(`County detection: ${unprocessed.length} new activities to process`);

    if (unprocessed.length > 0) {
        const counties = preprocessCounties(geojson);
        const index = buildSpatialIndex(counties);
        const newFips = await detectCountiesAsync(unprocessed, counties, index);

        newFips.forEach(f => visitedFips.add(f));
        unprocessed.forEach(a => countyProcessedIds.add(a.i));

        dbg(`County detection done: +${newFips.size} new (${visitedFips.size} total)`);
        await saveCountiesToWorker();
    }

    // Build Leaflet map centred on the contiguous US
    // SVG renderer (default) — GeoJSON mouse events don't work reliably on canvas
    countyMap = L.map('county-map', {
        fullscreenControl: true,
        fullscreenControlOptions: { position: 'topleft' },
    }).setView([38, -96], 4);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 12,
    }).addTo(countyMap);

    renderCountyMap(geojson);
    renderCountyStats();

    setCountyStatus('Loading activity routes…');
    await addPolylineOverlay(countyMap, { interactive: true });

    countyMapInitialized = true;
    setCountyStatus('');
    dbg(`County map rendered: ${visitedFips.size} visited`);
}

// ── County detection helpers ──────────────────────────────────────────────────

function preprocessCounties(geojson) {
    return geojson.features.map(feature => ({
        fips: feature.properties.GEOID,   // 5-digit FIPS, e.g. "08013"
        feature,
        bbox: computeFeatureBbox(feature),
    }));
}

function computeFeatureBbox(feature) {
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    const scan = ring => ring.forEach(([lng, lat]) => {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    });
    const { type, coordinates } = feature.geometry;
    if (type === 'Polygon') coordinates.forEach(scan);
    else if (type === 'MultiPolygon') coordinates.forEach(poly => poly.forEach(scan));
    return { minLng, maxLng, minLat, maxLat };
}

// 1° × 1° spatial grid — each cell lists counties whose bbox overlaps it.
// Eliminates ~99% of county candidates per point before running ray casting.
function buildSpatialIndex(counties) {
    const index = {};
    counties.forEach(county => {
        const { minLng, maxLng, minLat, maxLat } = county.bbox;
        for (let lng = Math.floor(minLng); lng <= Math.floor(maxLng); lng++) {
            for (let lat = Math.floor(minLat); lat <= Math.floor(maxLat); lat++) {
                const key = `${lng},${lat}`;
                if (!index[key]) index[key] = [];
                index[key].push(county);
            }
        }
    });
    return index;
}

// Process activities in chunks, yielding to the browser every 50 to keep the UI
// responsive. Samples every 3rd decoded polyline point — accurate enough for
// county-level detection since summary polylines are already simplified.
async function detectCountiesAsync(activities, counties, index) {
    const newFips = new Set();
    for (let i = 0; i < activities.length; i++) {
        if (i % 50 === 0) {
            setCountyStatus(`Detecting counties… ${i} / ${activities.length}`);
            await new Promise(r => setTimeout(r, 0));
        }
        const points = decodePolyline(activities[i].p);
        for (let j = 0; j < points.length; j += 3) {
            const [lat, lng] = points[j];
            const candidates = index[`${Math.floor(lng)},${Math.floor(lat)}`];
            if (!candidates) continue;
            for (const county of candidates) {
                if (visitedFips.has(county.fips) || newFips.has(county.fips)) continue;
                const b = county.bbox;
                if (lng < b.minLng || lng > b.maxLng || lat < b.minLat || lat > b.maxLat) continue;
                if (pointInFeature(lat, lng, county.feature)) newFips.add(county.fips);
            }
        }
    }
    return newFips;
}

function pointInFeature(lat, lng, feature) {
    const { type, coordinates } = feature.geometry;
    if (type === 'Polygon') return pointInRing(lat, lng, coordinates[0]);
    if (type === 'MultiPolygon') return coordinates.some(poly => pointInRing(lat, lng, poly[0]));
    return false;
}

// Standard ray-casting point-in-polygon.
// GeoJSON rings use [longitude, latitude] order.
function pointInRing(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

// ── County rendering ──────────────────────────────────────────────────────────

function renderCountyMap(geojson) {
    L.geoJSON(geojson, {
        style: feature => {
            const visited = visitedFips.has(feature.properties.GEOID);
            return {
                fillColor:   visited ? '#4CAF50' : 'transparent',
                fillOpacity: visited ? 0.45 : 0,
                color:       visited ? '#4CAF50' : 'rgba(255,255,255,0.1)',
                weight:      visited ? 0.8 : 0.4,
            };
        },
        onEachFeature: (feature, layer) => {
            const { GEOID, STATEFP, NAME, LSAD } = feature.properties;
            const visited = visitedFips.has(GEOID);
            if (!visited) return;
            const state = STATE_ABBR[STATEFP] || STATEFP || '?';
            const lsad  = LSAD_NAMES[LSAD] || 'County';
            layer.bindPopup(`
                <div class="activity-popup-inner">
                    <div class="activity-popup-type" style="color:#4CAF50">${state}</div>
                    <div class="activity-popup-name">${NAME} ${lsad}</div>
                    <div class="activity-popup-date">FIPS ${GEOID}</div>
                </div>`, { className: 'activity-popup' });
            layer.on('mouseover', function () { this.setStyle({ fillOpacity: 0.72 }); });
            layer.on('mouseout',  function () { this.setStyle({ fillOpacity: 0.45 }); });
        },
    }).addTo(countyMap);
}

function renderCountyStats() {
    const el = document.getElementById('county-stats-bar');
    if (!el) return;
    const total = 3233;
    const pct = ((visitedFips.size / total) * 100).toFixed(1);
    el.innerHTML = `
        <div class="county-stat-item">
            <span class="county-stat-number">${visitedFips.size.toLocaleString()}</span>
            <span class="county-stat-label">Counties Visited</span>
        </div>
        <div class="county-stat-item">
            <span class="county-stat-number">${total.toLocaleString()}</span>
            <span class="county-stat-label">Total US Counties</span>
        </div>
        <div class="county-stat-item">
            <span class="county-stat-number">${pct}%</span>
            <span class="county-stat-label">Complete</span>
        </div>`;
}

async function saveCountiesToWorker() {
    try {
        const res = await fetch(`${WORKER_URL}/counties/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fips: [...visitedFips],
                processedIds: [...countyProcessedIds],
            }),
        });
        const data = await res.json();
        dbg(`County data saved: ${data.counties} counties`);
    } catch (err) {
        dbg(`County save failed: ${err.message}`);
    }
}

function setCountyStatus(msg) {
    const el = document.getElementById('county-status');
    if (el) el.textContent = msg;
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

// Shared polyline cache — fetched once, reused by Activity Map, County Hunter, Tile Hunter
let cachedPolylines = null;

async function loadPolylines() {
    if (cachedPolylines !== null) return cachedPolylines;
    dbg('GET /polylines/all…');
    const res = await fetch(`${WORKER_URL}/polylines/all`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    cachedPolylines = await res.json();
    dbg(`Polylines: ${cachedPolylines.length} total, ${cachedPolylines.filter(Boolean).length} with GPS`);
    return cachedPolylines;
}

// Draws all activity polylines onto any Leaflet map instance.
// Uses the shared cache so the fetch only ever happens once per page load.
// Options:
//   color       — fixed colour string; omit to use per-group colours
//   interactive — if true, adds popups + hover highlight (like Activity Map)
async function addPolylineOverlay(targetMap, { color = null, interactive = false } = {}) {
    let polylines;
    try { polylines = await loadPolylines(); }
    catch (err) { dbg(`Polyline overlay failed: ${err.message}`); return; }

    const renderer = L.canvas();
    polylines.forEach((encoded, i) => {
        if (!encoded) return;
        const slim = currentSlim[i];
        if (!slim) return;
        const points = decodePolyline(encoded);
        if (!points.length) return;
        const c = color || GROUP_COLORS[getGroup(slim.t)] || GROUP_COLORS['Other'];
        const layer = L.polyline(points, { color: c, weight: 1.2, opacity: 0.45, renderer })
            .addTo(targetMap);

        if (interactive) {
            layer.bindPopup(buildActivityPopup(slim), { className: 'activity-popup' });
            layer.on('mouseover', function () { this.setStyle({ opacity: 0.9, weight: 3 }); });
            layer.on('mouseout',  function () { this.setStyle({ opacity: 0.45, weight: 1.2 }); });
        }
    });
}

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
        fullscreenControl: true,
        fullscreenControlOptions: { position: 'topleft' },
    }).setView([30, 0], 2);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(stravaMap);

    // Lazy-fetch polylines via shared cache
    setMapStatus('Fetching routes…');
    let polylines;
    try {
        polylines = await loadPolylines();
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

        layer.bindPopup(buildActivityPopup(slim), { className: 'activity-popup' });
        layer.on('mouseover', function () { if (!deactivatedTypes.has(slim.t)) this.setStyle({ opacity: 0.9, weight: 3 }); });
        layer.on('mouseout',  function () { if (!deactivatedTypes.has(slim.t)) this.setStyle({ opacity: 0.55, weight: 1.5 }); });

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

function buildActivityPopup(slim) {
    const name = slim.n || 'Untitled Activity';
    const type = typeLabel(slim.t);
    const date = slim.d ? formatActivityDate(slim.d) : '';
    const group = getGroup(slim.t);
    const color = GROUP_COLORS[group] || GROUP_COLORS['Other'];
    const href = slim.i ? `https://www.strava.com/activities/${slim.i}` : null;
    const nameHtml = href
        ? `<a class="activity-popup-link" href="${href}" target="_blank" rel="noopener">${name}</a>`
        : name;
    return `
        <div class="activity-popup-inner">
            <div class="activity-popup-type" style="color:${color}">${type}</div>
            <div class="activity-popup-name">${nameHtml}</div>
            ${date ? `<div class="activity-popup-date">${date}</div>` : ''}
        </div>`;
}

function formatActivityDate(dateStr) {
    // dateStr is "YYYY-MM-DD" from start_date_local
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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

// ── City Hunter ───────────────────────────────────────────────────────────────
//
// Fetches the road/trail network for a configured city from OpenStreetMap via
// the Overpass API and determines which segments have been covered by activity
// polylines. OSM data is cached in localStorage (7-day TTL). Completion is
// derived from the shared polyline cache — no extra server storage needed.
//
// To add more cities later, add an entry to CITY_CONFIGS and update ACTIVE_CITY.

const CITY_CONFIGS = {
    'superior-co': {
        name: 'Superior, CO',
        bbox: [39.92, -105.20, 39.98, -105.08],  // [south, west, north, east]
        center: [39.955, -105.135],
        zoom: 14,
        boundaryName: 'Superior',           // OSM relation name for admin boundary
        boundaryAdminLevel: '8',            // US municipality = 8
        // OSM highway types to include — excludes motorways, trunk roads, service roads
        highways: 'residential|living_street|path|cycleway|pedestrian|track|unclassified|tertiary',
    },
};
const ACTIVE_CITY = 'superior-co';
const VISIT_THRESHOLD_M = 25; // a node is "visited" if any polyline point is within 25 m
const OVERPASS_MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

let cityMap = null;
let cityMapInitialized = false;
let cityNodeLayer = null;       // L.LayerGroup of unvisited node markers
let cityActivityLayer = null;   // L.LayerGroup of activity polylines
let cityNodesVisible = false;
let cityActivitiesVisible = false;

function toggleCityMap() {
    const section = document.getElementById('city-section');
    const btn = document.getElementById('city-toggle-btn');
    if (!section) return;
    const opening = section.style.display === 'none';
    section.style.display = opening ? 'block' : 'none';
    if (btn) btn.textContent = opening ? 'Hide map' : 'Show map';
    if (opening && !cityMapInitialized) {
        initCityMap();
    } else if (opening && cityMap) {
        setTimeout(() => cityMap.invalidateSize(), 50);
    }
}

async function initCityMap() {
    const cfg = CITY_CONFIGS[ACTIVE_CITY];
    setCityStatus('Loading road network…');
    dbg(`City Hunter: initialising for ${cfg.name}`);

    let ways, polylines;
    try {
        [ways, polylines] = await Promise.all([
            fetchCityRoads(cfg),
            loadPolylines(),
        ]);
    } catch (err) {
        dbg(`City Hunter error: ${err.message}`);
        setCityStatus('Failed to load city data.');
        return;
    }

    setCityStatus('Analysing coverage…');
    await new Promise(r => setTimeout(r, 0)); // yield before heavy computation

    const pointIndex = buildPointIndex(polylines);
    const completedWays = computeWayCompletion(ways, pointIndex);

    cityMap = L.map('city-map', {
        fullscreenControl: true,
        fullscreenControlOptions: { position: 'topleft' },
    }).setView(cfg.center, cfg.zoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(cityMap);

    renderCityMap(completedWays);
    renderCityStats(completedWays);

    // Draw city boundary (non-blocking — renders when ready)
    fetchCityBoundary(cfg).then(rings => {
        if (!rings || !rings.length) return;
        rings.forEach(ring => {
            L.polyline(ring, {
                color: '#ffffff',
                weight: 3,
                opacity: 0.85,
                dashArray: null,
                interactive: false,
            }).addTo(cityMap);
        });
        dbg(`City boundary: ${rings.length} ring(s) drawn`);
    }).catch(err => dbg(`City boundary fetch failed: ${err.message}`));

    cityMapInitialized = true;
    const done = completedWays.filter(w => w.pct === 1).length;
    setCityStatus('');
    dbg(`City Hunter: ${done}/${completedWays.length} ways complete`);
}

// ── OSM road data ─────────────────────────────────────────────────────────────

async function fetchCityRoads(cfg) {
    const cacheKey = `city_hunter_${ACTIVE_CITY}`;
    const TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

    try {
        const cached = JSON.parse(localStorage.getItem(cacheKey));
        if (cached && Date.now() - cached.ts < TTL) {
            dbg(`City roads: ${cached.ways.length} ways from localStorage cache`);
            return cached.ways;
        }
    } catch {}

    setCityStatus('Fetching road network from OpenStreetMap…');
    const [south, west, north, east] = cfg.bbox;
    const query = `[out:json][timeout:90];`
        + `(way["highway"~"^(${cfg.highways})$"](${south},${west},${north},${east}););`
        + `out body;>;out skel qt;`;

    dbg('Overpass API: fetching ways…');
    let res = null;
    for (const mirror of OVERPASS_MIRRORS) {
        try {
            res = await fetch(mirror, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'data=' + encodeURIComponent(query),
            });
            if (res.ok) break;
            dbg(`Overpass mirror ${mirror} returned ${res.status}, trying next…`);
        } catch (e) {
            dbg(`Overpass mirror ${mirror} failed: ${e.message}, trying next…`);
        }
    }
    if (!res || !res.ok) throw new Error(`All Overpass mirrors failed`);

    const data = await res.json();
    const ways = parseOverpassWays(data);
    dbg(`City roads: ${ways.length} ways fetched from Overpass`);

    try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), ways })); } catch {}
    return ways;
}

async function fetchCityBoundary(cfg) {
    if (!cfg.boundaryName) return null;
    const cacheKey = `city_boundary_${ACTIVE_CITY}`;
    const TTL = 30 * 24 * 60 * 60 * 1000; // 30 days — boundaries rarely change

    try {
        const cached = JSON.parse(localStorage.getItem(cacheKey));
        if (cached && Date.now() - cached.ts < TTL) return cached.rings;
    } catch {}

    const [south, west, north, east] = cfg.bbox;
    const query = `[out:json][timeout:30];`
        + `relation["name"="${cfg.boundaryName}"]["boundary"="administrative"]`
        + `["admin_level"="${cfg.boundaryAdminLevel}"](${south},${west},${north},${east});`
        + `out geom;`;

    let res = null;
    for (const mirror of OVERPASS_MIRRORS) {
        try {
            res = await fetch(mirror, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'data=' + encodeURIComponent(query),
            });
            if (res.ok) break;
        } catch {}
    }
    if (!res || !res.ok) throw new Error('Boundary fetch failed');

    const data = await res.json();
    // Each relation member of type 'way' with role 'outer' carries geometry
    const rings = [];
    data.elements.forEach(el => {
        if (el.type !== 'relation') return;
        (el.members || []).forEach(m => {
            if (m.type === 'way' && (m.role === 'outer' || m.role === '') && m.geometry) {
                rings.push(m.geometry.map(pt => [pt.lat, pt.lon]));
            }
        });
    });

    try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), rings })); } catch {}
    return rings;
}

function parseOverpassWays(data) {
    // Build node id → [lat, lon] lookup from the skel nodes
    const nodeMap = {};
    data.elements.forEach(el => {
        if (el.type === 'node') nodeMap[el.id] = [el.lat, el.lon];
    });

    return data.elements
        .filter(el => el.type === 'way' && el.tags?.highway)
        .map(way => ({
            id:      way.id,
            name:    way.tags.name || '',
            highway: way.tags.highway,
            coords:  (way.nodes || []).map(nid => nodeMap[nid]).filter(Boolean),
        }))
        .filter(way => way.coords.length >= 2);
}

// ── Coverage analysis ─────────────────────────────────────────────────────────

// Build a ~111 m grid of every decoded polyline point for fast proximity checks.
function buildPointIndex(polylines) {
    const G = 0.001;
    const index = {};
    polylines.forEach(encoded => {
        if (!encoded) return;
        for (const [lat, lng] of decodePolyline(encoded)) {
            const key = `${Math.floor(lat / G)},${Math.floor(lng / G)}`;
            if (!index[key]) index[key] = [];
            index[key].push([lat, lng]);
        }
    });
    return index;
}

function isNodeVisited(lat, lng, index) {
    const G = 0.001;
    const r = Math.floor(lat / G);
    const c = Math.floor(lng / G);
    for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
            const pts = index[`${r + dr},${c + dc}`];
            if (!pts) continue;
            for (const [plat, plng] of pts) {
                if (metresApart(lat, lng, plat, plng) <= VISIT_THRESHOLD_M) return true;
            }
        }
    }
    return false;
}

function metresApart(lat1, lng1, lat2, lng2) {
    const dlat = (lat2 - lat1) * 111320;
    const dlng = (lng2 - lng1) * 111320 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return Math.sqrt(dlat * dlat + dlng * dlng);
}

function computeWayCompletion(ways, pointIndex) {
    return ways.map(way => {
        let visited = 0;
        for (const [lat, lng] of way.coords) {
            if (isNodeVisited(lat, lng, pointIndex)) visited++;
        }
        const pct = way.coords.length > 0 ? visited / way.coords.length : 0;
        return { ...way, visited, total: way.coords.length, pct };
    });
}

// ── City rendering ────────────────────────────────────────────────────────────

function wayColor(pct) {
    if (pct === 1) return '#4CAF50';              // complete  — green
    if (pct > 0)   return '#FF9800';              // partial   — orange
    return 'rgba(255,255,255,0.25)';              // untouched — faint
}

function renderCityMap(completedWays) {
    const renderer = L.canvas();
    const unvisitedMarkers = [];

    completedWays.forEach(way => {
        const color       = wayColor(way.pct);
        const complete    = way.pct === 1;
        const baseOpacity = way.pct === 0 ? 0.35 : 0.9;
        const baseWeight  = complete ? 3 : 2;

        const layer = L.polyline(way.coords, {
            color,
            weight:  baseWeight,
            opacity: baseOpacity,
        }).addTo(cityMap);

        const pctLabel = (way.pct * 100).toFixed(0) + '%';
        const nameHtml = way.name
            ? way.name
            : `<em style="opacity:0.6">${way.highway}</em>`;
        layer.bindPopup(`
            <div class="activity-popup-inner">
                <div class="activity-popup-type" style="color:${color}">${way.highway}</div>
                <div class="activity-popup-name">${nameHtml}</div>
                <div class="activity-popup-date">${pctLabel} complete · ${way.visited} / ${way.total} nodes</div>
            </div>`, { className: 'activity-popup' });
        layer.on('mouseover', function () { this.setStyle({ opacity: 1, weight: baseWeight + 1.5 }); });
        layer.on('mouseout',  function () { this.setStyle({ opacity: baseOpacity, weight: baseWeight }); });

        // Collect nodes on incomplete ways for the "remaining" overlay
        if (way.pct < 1) {
            way.coords.forEach(coord => {
                unvisitedMarkers.push(L.circleMarker(coord, {
                    radius: 3,
                    color: '#FF4444',
                    fillColor: '#FF4444',
                    fillOpacity: 0.85,
                    weight: 0,
                    renderer,
                    interactive: false,
                }));
            });
        }
    });

    cityNodeLayer = L.layerGroup(unvisitedMarkers);
}

function renderCityStats(completedWays) {
    const el = document.getElementById('city-stats-bar');
    if (!el) return;
    const total   = completedWays.length;
    const done    = completedWays.filter(w => w.pct === 1).length;
    const partial = completedWays.filter(w => w.pct > 0 && w.pct < 1).length;
    const totalNodes   = completedWays.reduce((s, w) => s + w.total,   0);
    const visitedNodes = completedWays.reduce((s, w) => s + w.visited, 0);
    const remainingNodes = totalNodes - visitedNodes;
    const pct = totalNodes > 0 ? (visitedNodes / totalNodes * 100).toFixed(1) : '0.0';

    el.innerHTML = `
        <div class="county-stat-item">
            <span class="county-stat-number">${done.toLocaleString()}</span>
            <span class="county-stat-label">Complete</span>
        </div>
        <div class="county-stat-item">
            <span class="county-stat-number">${partial.toLocaleString()}</span>
            <span class="county-stat-label">Partial</span>
        </div>
        <div class="county-stat-item">
            <span class="county-stat-number">${total.toLocaleString()}</span>
            <span class="county-stat-label">Total Streets</span>
        </div>
        <div class="county-stat-item">
            <span class="county-stat-number">${pct}%</span>
            <span class="county-stat-label">Node Coverage</span>
        </div>
        <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="cache-refresh-btn" id="city-nodes-btn" onclick="toggleCityNodes()">
                Show remaining nodes
            </button>
            <button class="cache-refresh-btn" id="city-activities-btn" onclick="toggleCityActivities()">
                Show my activities
            </button>
        </div>`;
}

function toggleCityNodes() {
    if (!cityMap || !cityNodeLayer) return;
    cityNodesVisible = !cityNodesVisible;
    if (cityNodesVisible) {
        cityNodeLayer.addTo(cityMap);
    } else {
        cityNodeLayer.removeFrom(cityMap);
    }
    const btn = document.getElementById('city-nodes-btn');
    if (btn) btn.textContent = cityNodesVisible ? 'Hide remaining nodes' : 'Show remaining nodes';
}

async function toggleCityActivities() {
    if (!cityMap) return;
    cityActivitiesVisible = !cityActivitiesVisible;
    const btn = document.getElementById('city-activities-btn');

    if (!cityActivitiesVisible) {
        if (cityActivityLayer) cityActivityLayer.removeFrom(cityMap);
        if (btn) btn.textContent = 'Show my activities';
        return;
    }

    if (btn) btn.textContent = 'Hide my activities';

    // Build layer group on first show
    if (!cityActivityLayer) {
        const polylines = await loadPolylines();
        const renderer = L.canvas();
        const layers = [];
        polylines.forEach((encoded, i) => {
            if (!encoded) return;
            const slim = currentSlim[i];
            if (!slim) return;
            const points = decodePolyline(encoded);
            if (!points.length) return;
            const color = GROUP_COLORS[getGroup(slim.t)] || GROUP_COLORS['Other'];
            const layer = L.polyline(points, { color, weight: 1.5, opacity: 0.6, renderer });
            layer.bindPopup(buildActivityPopup(slim), { className: 'activity-popup' });
            layer.on('mouseover', function () { this.setStyle({ opacity: 0.95, weight: 3 }); });
            layer.on('mouseout',  function () { this.setStyle({ opacity: 0.6, weight: 1.5 }); });
            layers.push(layer);
        });
        cityActivityLayer = L.layerGroup(layers);
    }

    cityActivityLayer.addTo(cityMap);
}

async function resetCityData() {
    if (!confirm('Clear cached road network data? OSM data will be re-fetched on next open.')) return;
    localStorage.removeItem(`city_hunter_${ACTIVE_CITY}`);
    cityMapInitialized = false;
    cityNodeLayer = null;
    cityActivityLayer = null;
    cityNodesVisible = false;
    cityActivitiesVisible = false;
    if (cityMap) { cityMap.remove(); cityMap = null; }
    dbg('City road cache cleared. Reopen City Hunter to re-fetch from OSM.');
}

function setCityStatus(msg) {
    const el = document.getElementById('city-status');
    if (el) el.textContent = msg;
}

// ── Tile Hunter ───────────────────────────────────────────────────────────────
//
// Divides the world into 0.01° × 0.01° tiles (~1.1 km at equator, ~1 mi at
// mid-latitudes). A tile is "visited" when any decoded polyline point falls
// inside it — detection is pure floor-division, O(n) with no spatial index.

let tileMap = null;
let tileMapInitialized = false;
let visitedTiles = new Set();   // "latInt,lngInt" strings, e.g. "3991,-10523"
let tileProcessedIds = new Set();

function toggleTileMap() {
    const section = document.getElementById('tile-section');
    const btn = document.getElementById('tile-toggle-btn');
    if (!section) return;
    const opening = section.style.display === 'none';
    section.style.display = opening ? 'block' : 'none';
    if (btn) btn.textContent = opening ? 'Hide map' : 'Show map';
    if (opening && !tileMapInitialized) {
        initTileMap();
    } else if (opening && tileMap) {
        setTimeout(() => tileMap.invalidateSize(), 50);
    }
}

async function initTileMap() {
    setTileStatus('Loading saved tile data…');
    dbg('Tile map: loading saved data…');

    let saved;
    try {
        saved = await fetch(`${WORKER_URL}/tiles/all`).then(r => r.json());
    } catch (err) {
        dbg(`Tile load error: ${err.message}`);
        setTileStatus('Failed to load tile data.');
        return;
    }

    visitedTiles      = new Set((saved.tiles        || []).filter(Boolean));
    tileProcessedIds  = new Set((saved.processedIds || []).filter(Boolean));
    dbg(`Tile cache: ${visitedTiles.size} tiles, ${tileProcessedIds.size} processed activities`);

    const unprocessed = currentSlim.filter(a => a.i && a.p && !tileProcessedIds.has(a.i));
    dbg(`Tile detection: ${unprocessed.length} new activities to process`);

    if (unprocessed.length > 0) {
        const newTiles = await detectTilesAsync(unprocessed);
        newTiles.forEach(t => visitedTiles.add(t));
        unprocessed.forEach(a => tileProcessedIds.add(a.i));
        dbg(`Tile detection done: +${newTiles.size} new tiles (${visitedTiles.size} total)`);
        await saveTilesToWorker();
    }

    tileMap = L.map('tile-map', {
        fullscreenControl: true,
        fullscreenControlOptions: { position: 'topleft' },
    }).setView([38, -96], 4);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(tileMap);

    new TileHunterLayer(visitedTiles).addTo(tileMap);

    setTileStatus('Loading activity routes…');
    await addPolylineOverlay(tileMap, { color: '#ffffff', interactive: true });

    renderTileStats();
    tileMapInitialized = true;
    setTileStatus('');
    dbg(`Tile map rendered: ${visitedTiles.size} tiles`);
}

// ── Tile detection ────────────────────────────────────────────────────────────

// Walk all grid cells crossed by a line segment using a DDA grid traversal.
// This ensures tiles a polyline passes *through* are counted, not just tiles
// that happen to contain a decoded polyline point.
function addSegmentTiles(lat1, lng1, lat2, lng2, tileSet) {
    let r = Math.floor(lat1 * 100);
    let c = Math.floor(lng1 * 100);
    const endR = Math.floor(lat2 * 100);
    const endC = Math.floor(lng2 * 100);

    tileSet.add(`${r},${c}`);
    if (r === endR && c === endC) return;

    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;
    const stepR = dLat >= 0 ? 1 : -1;
    const stepC = dLng >= 0 ? 1 : -1;

    // Parametric t-step to cross one full grid cell in each axis
    const tDeltaR = dLat !== 0 ? Math.abs(0.01 / dLat) : Infinity;
    const tDeltaC = dLng !== 0 ? Math.abs(0.01 / dLng) : Infinity;

    // t at which the ray first crosses a grid boundary in each axis
    let tMaxR = dLat !== 0
        ? Math.abs(((stepR > 0 ? r + 1 : r) / 100 - lat1) / dLat)
        : Infinity;
    let tMaxC = dLng !== 0
        ? Math.abs(((stepC > 0 ? c + 1 : c) / 100 - lng1) / dLng)
        : Infinity;

    const limit = Math.abs(endR - r) + Math.abs(endC - c) + 1;
    for (let i = 0; i < limit; i++) {
        if (tMaxR < tMaxC) { r += stepR; tMaxR += tDeltaR; }
        else                { c += stepC; tMaxC += tDeltaC; }
        tileSet.add(`${r},${c}`);
        if (r === endR && c === endC) break;
    }
}

async function detectTilesAsync(activities) {
    const newTiles = new Set();
    for (let i = 0; i < activities.length; i++) {
        if (i % 100 === 0) {
            setTileStatus(`Detecting tiles… ${i} / ${activities.length}`);
            await new Promise(r => setTimeout(r, 0)); // yield to browser
        }
        if (!activities[i].p) continue;
        const points = decodePolyline(activities[i].p);
        for (let j = 0; j < points.length; j++) {
            const [lat, lng] = points[j];
            if (j === 0) {
                newTiles.add(`${Math.floor(lat * 100)},${Math.floor(lng * 100)}`);
            } else {
                const [prevLat, prevLng] = points[j - 1];
                addSegmentTiles(prevLat, prevLng, lat, lng, newTiles);
            }
        }
    }
    return newTiles;
}

// ── Tile canvas layer ─────────────────────────────────────────────────────────
//
// Renders visited tiles as filled rectangles on a canvas element in Leaflet's
// overlayPane. Canvas is repositioned via DomUtil.setPosition after each
// moveend/zoomend (same pattern as Leaflet's own SVG renderer) so it stays
// aligned with the basemap during smooth panning.

const TileHunterLayer = L.Layer.extend({
    initialize(tileKeys) {
        // Parse once — array of [latInt, lngInt] number pairs
        this._tiles = [...tileKeys].map(k => k.split(',').map(Number));
    },
    onAdd(map) {
        this._map = map;
        this._canvas = document.createElement('canvas');
        this._canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none';
        map.getPanes().overlayPane.appendChild(this._canvas);
        map.on('moveend zoomend resize', this._redraw, this);
        this._redraw();
    },
    onRemove(map) {
        this._canvas.remove();
        map.off('moveend zoomend resize', this._redraw, this);
    },
    _redraw() {
        const map = this._map;
        const size = map.getSize();
        const topLeft = map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);
        this._canvas.width  = size.x;
        this._canvas.height = size.y;

        const ctx = this._canvas.getContext('2d');
        ctx.fillStyle = 'rgba(76, 175, 80, 0.5)';

        for (const [latInt, lngInt] of this._tiles) {
            const sw = map.latLngToContainerPoint([latInt / 100,       lngInt / 100]);
            const ne = map.latLngToContainerPoint([(latInt + 1) / 100, (lngInt + 1) / 100]);
            const x = Math.min(sw.x, ne.x);
            const y = Math.min(sw.y, ne.y);
            const w = Math.max(Math.abs(ne.x - sw.x), 1);
            const h = Math.max(Math.abs(ne.y - sw.y), 1);
            // Skip tiles that are entirely off-screen
            if (x + w < 0 || y + h < 0 || x > size.x || y > size.y) continue;
            ctx.fillRect(x, y, w, h);
        }
    },
});

// ── Tile persistence ──────────────────────────────────────────────────────────

function renderTileStats() {
    const el = document.getElementById('tile-stats-bar');
    if (!el) return;
    el.innerHTML = `
        <div class="county-stat-item">
            <span class="county-stat-number">${visitedTiles.size.toLocaleString()}</span>
            <span class="county-stat-label">Tiles Visited</span>
        </div>`;
}

async function saveTilesToWorker() {
    try {
        const res = await fetch(`${WORKER_URL}/tiles/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tiles: [...visitedTiles],
                processedIds: [...tileProcessedIds],
            }),
        });
        const data = await res.json();
        dbg(`Tile data saved: ${data.tiles} tiles`);
    } catch (err) {
        dbg(`Tile save failed: ${err.message}`);
    }
}

async function resetTileData() {
    if (!confirm('Clear all tile detection data? Forces full re-detection on next open.')) return;
    try {
        await fetch(`${WORKER_URL}/tiles/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tiles: [], processedIds: [] }),
        });
        tileMapInitialized = false;
        visitedTiles.clear();
        tileProcessedIds.clear();
        dbg('Tile data reset. Reopen Tile Hunter to re-detect.');
    } catch (err) {
        dbg(`Tile reset failed: ${err.message}`);
    }
}

function setTileStatus(msg) {
    const el = document.getElementById('tile-status');
    if (el) el.textContent = msg;
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
                <button class="dbg-clear" onclick="resetGeoCache()" title="Clear geocoded location data — forces full re-geocode">Reset geo cache</button>
                <button class="dbg-clear" onclick="resetCountyData()" title="Clear county detection results — forces full re-detection">Reset counties</button>
                <button class="dbg-clear" onclick="resetTileData()" title="Clear tile detection results — forces full re-detection">Reset tiles</button>
                <button class="dbg-clear" onclick="resetCityData()" title="Clear city road cache from localStorage — forces fresh Overpass fetch">Reset city</button>
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

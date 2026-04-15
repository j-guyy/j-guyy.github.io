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

// Shortcut group buttons — toggle all types in the set at once
const QUICK_GROUPS = {
    'All Run':  ['Run', 'TrailRun', 'VirtualRun'],
    'All Ride': ['Ride', 'GravelRide', 'EBikeRide', 'VirtualRide', 'Handcycle', 'Velomobile'],
};

function renderFilters() {
    const container = document.getElementById('strava-filters');
    if (!container) return;

    const typeCounts = {};
    currentSlim.forEach(a => { typeCounts[a.t] = (typeCounts[a.t] || 0) + 1; });
    const allTypes = Object.keys(typeCounts);
    if (allTypes.length === 0) { container.innerHTML = ''; return; }

    // Sort types: respect GROUP_KEYS order within each group, then alphabetically
    const sortedTypes = [...allTypes].sort((a, b) => {
        const ga = GROUP_KEYS.indexOf(getGroup(a));
        const gb = GROUP_KEYS.indexOf(getGroup(b));
        return ga !== gb ? ga - gb : a.localeCompare(b);
    });

    // Quick-group button: active if every present type in the set is active
    const quickGroupHtml = Object.entries(QUICK_GROUPS).map(([label, types]) => {
        const present = types.filter(t => typeCounts[t]);
        if (!present.length) return '';
        const allActive = present.every(t => !deactivatedTypes.has(t));
        return `<button class="filter-all-btn${allActive ? ' active' : ''}" onclick="toggleQuickGroup(${JSON.stringify(types)})">${label}</button>`;
    }).join('');

    let pillsHtml = sortedTypes.map(t => {
        const active = !deactivatedTypes.has(t);
        const count  = typeCounts[t];
        return `<button class="filter-pill${active ? ' active' : ''}" onclick="toggleSportType('${t}')">${typeLabel(t)} <span class="filter-pill-count">${count}</span></button>`;
    }).join('');

    container.innerHTML = `
        <div class="filter-bar">
            <div class="filter-controls">
                <button class="filter-all-btn" onclick="setAllFilters(true)">All</button>
                <button class="filter-all-btn" onclick="setAllFilters(false)">None</button>
                ${quickGroupHtml}
            </div>
            <div class="filter-pills">${pillsHtml}</div>
        </div>`;
}

function toggleQuickGroup(types) {
    const present   = types.filter(t => currentSlim.some(a => a.t === t));
    const allActive = present.every(t => !deactivatedTypes.has(t));
    present.forEach(t => allActive ? deactivatedTypes.add(t) : deactivatedTypes.delete(t));
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
    new LocationControl().addTo(countyMap);

    setCountyStatus('Loading activity routes…');
    await addPolylineOverlay(countyMap, { interactive: true });

    renderCountyMap(geojson);
    renderCountyStats();

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
    new LocationControl().addTo(stravaMap);

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
        bbox: [39.92, -105.20, 39.98, -105.08],
        center: [39.955, -105.135],
        zoom: 14,
        boundaryName: 'Superior',
        boundaryAdminLevel: '8',
        highways: 'residential|living_street|path|cycleway|pedestrian|track|unclassified|tertiary',
    },
    'boulder-co': {
        name: 'Boulder, CO',
        bbox: [39.97, -105.35, 40.09, -105.17],
        center: [40.015, -105.27],
        zoom: 13,
        boundaryName: 'Boulder',
        boundaryAdminLevel: '8',
        highways: 'residential|living_street|path|cycleway|pedestrian|track|unclassified|tertiary',
    },
    'boulder-county-co': {
        name: 'Boulder County, CO',
        bbox: [39.95, -105.67, 40.27, -105.06],
        center: [40.11, -105.36],
        zoom: 11,
        geoid: '08013',   // fetches boundary from local counties-us.json instead of Overpass
        highways: 'residential|living_street|path|cycleway|pedestrian|track|unclassified|tertiary|secondary',
    },
};
let ACTIVE_CITY = 'superior-co';
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

function switchCity(cityKey) {
    if (!CITY_CONFIGS[cityKey] || cityKey === ACTIVE_CITY) return;
    ACTIVE_CITY = cityKey;

    // Tear down existing map and state
    if (cityMap) { cityMap.remove(); cityMap = null; }
    cityMapInitialized = false;
    cityNodeLayer = null;
    cityActivityLayer = null;
    cityNodesVisible = false;
    cityActivitiesVisible = false;

    // If the section is already open, kick off a fresh load
    const section = document.getElementById('city-section');
    if (section && section.style.display !== 'none') {
        initCityMap();
    }
}

async function initCityMap() {
    const cfg = CITY_CONFIGS[ACTIVE_CITY];
    setCityStatus('Loading road network…');
    dbg(`City Hunter: initialising for ${cfg.name}`);

    let ways, polylines, boundarySegments;
    try {
        [ways, polylines, boundarySegments] = await Promise.all([
            fetchCityRoads(cfg),
            loadPolylines(),
            fetchCityBoundary(cfg),
        ]);
    } catch (err) {
        dbg(`City Hunter error: ${err.message}`);
        setCityStatus('Failed to load city data.');
        return;
    }

    // Assemble raw boundary way-segments into closed polygon rings, then
    // clip every OSM way so only nodes inside the city limits are counted.
    const boundaryPolygons = boundarySegments && boundarySegments.length
        ? assembleRings(boundarySegments) : [];

    if (boundaryPolygons.length) {
        const before = ways.length;
        ways = ways
            .map(way => ({
                ...way,
                coords: way.coords.filter(([lat, lng]) =>
                    boundaryPolygons.some(ring => pointInPolygon(lat, lng, ring))
                ),
            }))
            .filter(way => way.coords.length >= 2);
        dbg(`City boundary: clipped ${before - ways.length} ways outside limits (${ways.length} remain)`);
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
    new LocationControl().addTo(cityMap);

    renderCityMap(completedWays);
    renderCityStats(completedWays);

    // Draw boundary on the now-ready map (data already in hand — no second fetch)
    if (boundaryPolygons.length) {
        boundaryPolygons.forEach(ring => {
            L.polyline(ring, {
                color: '#ffffff',
                weight: 3,
                opacity: 0.85,
                interactive: false,
            }).addTo(cityMap);
        });
        dbg(`City boundary: ${boundaryPolygons.length} polygon(s) drawn`);
    }

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

// Chain Overpass member-way segments into closed polygon rings.
// Segments arrive in arbitrary order and may need to be reversed to connect.
function assembleRings(segments) {
    const EPS = 0.00002; // ~2 m tolerance for endpoint matching
    const close = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

    const remaining = segments.map(s => s.slice()); // shallow-copy each ring
    const rings = [];

    while (remaining.length > 0) {
        const ring = remaining.shift().slice();
        let grew = true;
        while (grew) {
            grew = false;
            for (let i = 0; i < remaining.length; i++) {
                const seg = remaining[i];
                const head = ring[0], tail = ring[ring.length - 1];
                if (close(tail, seg[0])) {
                    ring.push(...seg.slice(1));
                } else if (close(tail, seg[seg.length - 1])) {
                    ring.push(...seg.slice(0, -1).reverse());
                } else if (close(head, seg[seg.length - 1])) {
                    ring.unshift(...seg.slice(0, -1));
                } else if (close(head, seg[0])) {
                    ring.unshift(...seg.slice(1).reverse());
                } else {
                    continue;
                }
                remaining.splice(i, 1);
                grew = true;
                break;
            }
        }
        rings.push(ring);
    }
    return rings;
}

// Standard ray-casting point-in-polygon. Coords are [lat, lng].
function pointInPolygon(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [lati, lngi] = ring[i];
        const [latj, lngj] = ring[j];
        if (((lngi > lng) !== (lngj > lng)) &&
            (lat < (latj - lati) * (lng - lngi) / (lngj - lngi) + lati)) {
            inside = !inside;
        }
    }
    return inside;
}

// If the config has a FIPS geoid, pull the boundary from our local county GeoJSON
// instead of making an Overpass request.
async function fetchCountyBoundary(geoid) {
    const cacheKey = `city_boundary_county_${geoid}`;
    const TTL = 30 * 24 * 60 * 60 * 1000;
    try {
        const cached = JSON.parse(localStorage.getItem(cacheKey));
        if (cached && Date.now() - cached.ts < TTL) return cached.rings;
    } catch {}

    const geojson = await fetch('/data/counties-us.json').then(r => r.json());
    const feature = geojson.features.find(f => f.properties.GEOID === geoid);
    if (!feature) { dbg(`County boundary: GEOID ${geoid} not found`); return null; }

    const rings = [];
    const geom  = feature.geometry;
    // GeoJSON coords are [lng, lat] — convert to [lat, lng] for Leaflet
    const toRing = coords => coords.map(([lng, lat]) => [lat, lng]);

    if (geom.type === 'Polygon') {
        rings.push(toRing(geom.coordinates[0])); // outer ring only
    } else if (geom.type === 'MultiPolygon') {
        geom.coordinates.forEach(poly => rings.push(toRing(poly[0])));
    }

    dbg(`County boundary: ${rings.length} ring(s) from local GeoJSON for GEOID ${geoid}`);
    try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), rings })); } catch {}
    return rings;
}

// cacheKey defaults to the city-scoped key; pass a custom key for Trail Hunter.
async function fetchCityBoundary(cfg, cacheKey = null) {
    if (cfg.geoid) return fetchCountyBoundary(cfg.geoid);
    if (!cfg.boundaryName) return null;
    const resolvedKey = cacheKey !== null ? cacheKey : `city_boundary_${ACTIVE_CITY}`;
    const TTL = 30 * 24 * 60 * 60 * 1000; // 30 days — boundaries rarely change

    try {
        const cached = JSON.parse(localStorage.getItem(resolvedKey));
        if (cached && Date.now() - cached.ts < TTL) return cached.rings;
    } catch {}

    const [south, west, north, east] = cfg.bbox;
    const boundaryType = cfg.boundaryType || 'administrative';
    let query;
    if (boundaryType === 'administrative') {
        query = `[out:json][timeout:30];`
            + `relation["name"="${cfg.boundaryName}"]["boundary"="administrative"]`
            + `["admin_level"="${cfg.boundaryAdminLevel}"](${south},${west},${north},${east});`
            + `out geom;`;
    } else {
        // Non-administrative boundary (e.g. protected_area for national parks)
        query = `[out:json][timeout:60];`
            + `relation["name"="${cfg.boundaryName}"]["boundary"="${boundaryType}"]`
            + `(${south},${west},${north},${east});`
            + `out geom;`;
    }

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

    try { localStorage.setItem(resolvedKey, JSON.stringify({ ts: Date.now(), rings })); } catch {}
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

// Interpolate extra points along a segment so no gap exceeds maxSpacingM.
// Strava summary_polyline is simplified — raw points can be 50–200 m apart,
// meaning a segment can visually cross a node with no stored point nearby.
function densifySegment(lat1, lng1, lat2, lng2, maxSpacingM, out) {
    const d = metresApart(lat1, lng1, lat2, lng2);
    if (d <= maxSpacingM) return;
    const steps = Math.ceil(d / maxSpacingM);
    for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push([lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t]);
    }
}

// Build a ~111 m grid of every decoded (and densified) polyline point for fast
// proximity checks. Grid cell = 0.001° ≈ 111 m; isNodeVisited searches 3×3 cells.
function buildPointIndex(polylines) {
    const G = 0.001;
    const MAX_SPACING_M = 15; // densify so no gap exceeds this
    const index = {};

    const addPt = (lat, lng) => {
        const key = `${Math.floor(lat / G)},${Math.floor(lng / G)}`;
        if (!index[key]) index[key] = [];
        index[key].push([lat, lng]);
    };

    polylines.forEach(encoded => {
        if (!encoded) return;
        const pts = decodePolyline(encoded);
        for (let i = 0; i < pts.length; i++) {
            const [lat, lng] = pts[i];
            addPt(lat, lng);
            if (i < pts.length - 1) {
                const [lat2, lng2] = pts[i + 1];
                const extra = [];
                densifySegment(lat, lng, lat2, lng2, MAX_SPACING_M, extra);
                extra.forEach(([a, b]) => addPt(a, b));
            }
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
        const visitedFlags = way.coords.map(([lat, lng]) => isNodeVisited(lat, lng, pointIndex));
        const visited = visitedFlags.filter(Boolean).length;
        const pct = way.coords.length > 0 ? visited / way.coords.length : 0;
        return { ...way, visited, total: way.coords.length, pct, visitedFlags };
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

        // Thin visible line — non-interactive so the hit target below captures events
        const visibleLayer = L.polyline(way.coords, {
            color, weight: baseWeight, opacity: baseOpacity, interactive: false,
        }).addTo(cityMap);

        // Wide transparent hit target — easy to tap on mobile
        const layer = L.polyline(way.coords, {
            color, weight: 20, opacity: 0.001,
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
        layer.on('mouseover', function () { visibleLayer.setStyle({ opacity: 1, weight: baseWeight + 1.5 }); });
        layer.on('mouseout',  function () { visibleLayer.setStyle({ opacity: baseOpacity, weight: baseWeight }); });

        // Collect only the truly unvisited nodes for the "remaining" overlay
        way.coords.forEach((coord, idx) => {
            if (!way.visitedFlags[idx]) {
                unvisitedMarkers.push(L.circleMarker(coord, {
                    radius: 3,
                    color: '#FF4444',
                    fillColor: '#FF4444',
                    fillOpacity: 0.85,
                    weight: 0,
                    renderer,
                    interactive: false,
                }));
            }
        });
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
        <div class="stats-bar-actions">
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
            const layer = L.polyline(points, { color: '#29B6F6', weight: 1.5, opacity: 0.6, renderer });
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
// Uses OpenStreetMap zoom-level 14 tiles — the same grid as Strava/VeloViewer.
// At 40°N (Colorado) each tile is ~1.5 km × ~1.5 km (~0.9 mi).
// Tile keys are stored as "x,y" integer pairs in the z14 tile coordinate system.

const TILE_ZOOM = 14;

// lat/lng → z14 tile [x, y]
function latLngToTileXY(lat, lng) {
    const z = TILE_ZOOM;
    const x = Math.floor((lng + 180) / 360 * Math.pow(2, z));
    const latRad = lat * Math.PI / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * Math.pow(2, z));
    return [x, y];
}

// z14 tile [x, y] → NW corner lat/lng
function tileXYToLatLng(x, y) {
    const z = TILE_ZOOM;
    const n = Math.pow(2, z);
    const lng = x / n * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
    return [latRad * 180 / Math.PI, lng];
}

let tileMap = null;
let tileMapInitialized = false;
let visitedTiles = new Set();   // "x,y" z14 tile coordinate strings
let tileProcessedIds = new Set();
let tileClusterMap      = null; // tile key → size of its connected cluster
let tileSquareMap       = null; // tile key → dp_br: largest square with tile as bottom-right
let tileSquareMembership = null;// tile key → largest square tile actually belongs to
let tileMaxCluster = 0;
let tileMaxSquare  = 0;
let tileGridLayer  = null;

const SQUARE_THRESHOLD = 10;   // only highlight squares ≥ this size

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
    }).setView([38, -96], 6);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(tileMap);
    new LocationControl().addTo(tileMap);

    setTileStatus('Computing clusters & squares…');
    await new Promise(r => setTimeout(r, 0));
    computeTileStats();

    new TileHunterLayer(visitedTiles).addTo(tileMap);

    // Click any visited tile → show cluster + square info
    tileMap.on('click', e => {
        const [tx, ty] = latLngToTileXY(e.latlng.lat, e.latlng.lng);
        const key = `${tx},${ty}`;
        if (!visitedTiles.has(key)) return;
        const cluster = tileClusterMap ? tileClusterMap.get(key) : '?';
        const square  = largestSquareContaining(tx, ty);
        L.popup({ className: 'activity-popup' })
            .setLatLng(e.latlng)
            .setContent(`<div class="activity-popup-inner">
                <div class="activity-popup-type" style="color:#4CAF50">z14 Tile ${tx}, ${ty}</div>
                <div class="activity-popup-name">Cluster: <strong>${cluster.toLocaleString()}</strong> tiles</div>
                <div class="activity-popup-date">Square: <strong>${square}×${square}</strong> (your max: ${tileMaxSquare}×${tileMaxSquare})</div>
            </div>`)
            .openOn(tileMap);
    });

    setTileStatus('Loading activity routes…');
    await addPolylineOverlay(tileMap, { color: '#ffffff', interactive: true });

    renderTileStats();
    tileMapInitialized = true;
    setTileStatus('');
    dbg(`Tile map rendered: ${visitedTiles.size} tiles, max cluster ${tileMaxCluster}, max square ${tileMaxSquare}×${tileMaxSquare}`);
}

// ── Tile detection ────────────────────────────────────────────────────────────

// Sample a segment every SAMPLE_M metres and collect the z14 tile for each sample.
// Strava z14 tiles are ~1500 m wide, so 200 m sampling never misses a crossed tile.
// Simpler and more reliable than a Mercator-space DDA.
const TILE_SAMPLE_M = 200;

function addSegmentTiles(lat1, lng1, lat2, lng2, tileSet) {
    const d = metresApart(lat1, lng1, lat2, lng2);
    const steps = Math.max(1, Math.ceil(d / TILE_SAMPLE_M));
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const lat = lat1 + (lat2 - lat1) * t;
        const lng = lng1 + (lng2 - lng1) * t;
        const [tx, ty] = latLngToTileXY(lat, lng);
        tileSet.add(`${tx},${ty}`);
    }
}

async function detectTilesAsync(activities) {
    const newTiles = new Set();
    for (let i = 0; i < activities.length; i++) {
        if (i % 25 === 0) {
            setTileStatus(`Detecting tiles… ${i} / ${activities.length}`);
            await new Promise(r => setTimeout(r, 0));
        }
        if (!activities[i].p) continue;
        const points = decodePolyline(activities[i].p);
        for (let j = 0; j < points.length; j++) {
            const [lat, lng] = points[j];
            const [tx, ty] = latLngToTileXY(lat, lng);
            newTiles.add(`${tx},${ty}`);
            if (j > 0) {
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
        // Parse once — array of [tileX, tileY] z14 integer pairs
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

        // Bucket tiles into five visual tiers (drawn lowest → highest priority)
        const buckets = { isolated: [], cluster: [], maxCluster: [], square: [], maxSquare: [] };

        for (const [tx, ty] of this._tiles) {
            const key = `${tx},${ty}`;
            const membership   = tileSquareMembership ? (tileSquareMembership.get(key) || 0) : 0;
            const clusterSize  = tileClusterMap       ? (tileClusterMap.get(key)        || 1) : 1;

            const isClusterTile = tileClusterMap && tileClusterMap.has(key);

            if      (membership >= tileMaxSquare && tileMaxSquare >= SQUARE_THRESHOLD)
                buckets.maxSquare.push([tx, ty]);
            else if (membership >= SQUARE_THRESHOLD)
                buckets.square.push([tx, ty]);
            else if (isClusterTile && clusterSize === tileMaxCluster)
                buckets.maxCluster.push([tx, ty]);
            else if (isClusterTile)
                buckets.cluster.push([tx, ty]);
            else
                buckets.isolated.push([tx, ty]);
        }

        const COLORS = {
            isolated:   'rgba(244, 67,  54,  0.55)',  // red        — lone tile
            cluster:    'rgba(129, 199, 132, 0.60)',  // light green — connected cluster
            maxCluster: 'rgba(46,  125, 50,  0.80)',  // dark green  — largest cluster
            square:     'rgba(100, 181, 246, 0.65)',  // light blue  — square ≥10×10
            maxSquare:  'rgba(21,  101, 192, 0.85)',  // dark blue   — max square
        };

        const drawRect = (tx, ty) => {
            const [nwLat, nwLng] = tileXYToLatLng(tx,     ty);
            const [seLat, seLng] = tileXYToLatLng(tx + 1, ty + 1);
            const nw = map.latLngToContainerPoint([nwLat, nwLng]);
            const se = map.latLngToContainerPoint([seLat, seLng]);
            const px = Math.min(nw.x, se.x);
            const py = Math.min(nw.y, se.y);
            const pw = Math.max(Math.abs(se.x - nw.x), 1);
            const ph = Math.max(Math.abs(se.y - nw.y), 1);
            if (px + pw < 0 || py + ph < 0 || px > size.x || py > size.y) return;
            ctx.fillRect(px, py, pw, ph);
        };

        for (const [tier, color] of Object.entries(COLORS)) {
            ctx.fillStyle = color;
            buckets[tier].forEach(([tx, ty]) => drawRect(tx, ty));
        }
    },
});

// ── Cluster & Square analysis ─────────────────────────────────────────────────

// A tile is a "cluster tile" only if all four cardinal neighbors are also visited.
// BFS then finds connected components among those interior tiles.
function computeClusters(tileSet) {
    // Step 1: qualify — must have all 4 neighbors visited
    const interior = new Set();
    for (const key of tileSet) {
        const [x, y] = key.split(',').map(Number);
        if (tileSet.has(`${x},${y-1}`) && tileSet.has(`${x},${y+1}`) &&
            tileSet.has(`${x-1},${y}`) && tileSet.has(`${x+1},${y}`)) {
            interior.add(key);
        }
    }

    // Step 2: BFS over interior tiles to find connected components
    const clusterOf = new Map(); // key → cluster size
    for (const key of interior) {
        if (clusterOf.has(key)) continue;
        const queue = [key];
        clusterOf.set(key, 0);
        let head = 0;
        while (head < queue.length) {
            const curr = queue[head++];
            const [x, y] = curr.split(',').map(Number);
            for (const nb of [`${x+1},${y}`, `${x-1},${y}`, `${x},${y+1}`, `${x},${y-1}`]) {
                if (interior.has(nb) && !clusterOf.has(nb)) {
                    clusterOf.set(nb, 0);
                    queue.push(nb);
                }
            }
        }
        const size = queue.length;
        for (const k of queue) clusterOf.set(k, size);
    }
    return clusterOf;
}

// Sparse DP for largest all-visited N×N square, processing tiles in (y, x) order
// so that dp[x-1,y], dp[x,y-1], dp[x-1,y-1] are always ready when we reach (x,y).
// dp[key] = N means (x,y) is the bottom-right of a fully-visited N×N square.
function computeSquares(tileSet) {
    const dp = new Map();
    const sorted = [...tileSet]
        .map(k => k.split(',').map(Number))
        .sort((a, b) => a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]);

    for (const [x, y] of sorted) {
        const left    = dp.get(`${x-1},${y}`)   || 0;
        const top     = dp.get(`${x},${y-1}`)   || 0;
        const topLeft = dp.get(`${x-1},${y-1}`) || 0;
        dp.set(`${x},${y}`, Math.min(left, top, topLeft) + 1);
    }
    return dp;
}

function computeTileStats() {
    tileClusterMap = computeClusters(visitedTiles);
    tileSquareMap  = computeSquares(visitedTiles);

    tileMaxCluster = 0;
    for (const v of tileClusterMap.values()) if (v > tileMaxCluster) tileMaxCluster = v;

    tileMaxSquare = 0;
    for (const v of tileSquareMap.values())  if (v > tileMaxSquare)  tileMaxSquare  = v;

    tileSquareMembership = new Map();

    // Pass 1: spread max-square tiles and record their footprint.
    const maxSquareFootprint = new Set();
    for (const [key, dp] of tileSquareMap) {
        if (dp < tileMaxSquare) continue;
        const [bx, by] = key.split(',').map(Number);
        for (let dx = 0; dx < dp; dx++) {
            for (let dy = 0; dy < dp; dy++) {
                const tk = `${bx - dx},${by - dy}`;
                maxSquareFootprint.add(tk);
                tileSquareMembership.set(tk, dp);
            }
        }
    }

    // Pass 2: spread other large squares (≥ SQUARE_THRESHOLD but < max).
    // Skip any square whose footprint touches the max-square region — those
    // tiles should fall through to cluster / tile coloring instead.
    for (const [key, dp] of tileSquareMap) {
        if (dp < SQUARE_THRESHOLD || dp >= tileMaxSquare) continue;
        const [bx, by] = key.split(',').map(Number);
        let overlaps = false;
        outer: for (let dx = 0; dx < dp; dx++) {
            for (let dy = 0; dy < dp; dy++) {
                if (maxSquareFootprint.has(`${bx - dx},${by - dy}`)) { overlaps = true; break outer; }
            }
        }
        if (overlaps) continue;
        for (let dx = 0; dx < dp; dx++) {
            for (let dy = 0; dy < dp; dy++) {
                const tk = `${bx - dx},${by - dy}`;
                if ((tileSquareMembership.get(tk) || 0) < dp) tileSquareMembership.set(tk, dp);
            }
        }
    }

    dbg(`Tile stats: max cluster ${tileMaxCluster} tiles, max square ${tileMaxSquare}×${tileMaxSquare}`);
}

// On-demand: find the largest square tile (tx,ty) is actually part of.
// Checks every possible bottom-right offset up to tileMaxSquare — fast at click time.
function largestSquareContaining(tx, ty) {
    if (!tileSquareMap) return 1;
    let best = 1;
    for (let i = 0; i <= tileMaxSquare; i++) {
        for (let j = 0; j <= tileMaxSquare; j++) {
            const dp = tileSquareMap.get(`${tx + i},${ty + j}`) || 0;
            // The square of size dp ending at (tx+i, ty+j) contains (tx,ty)
            // iff dp > i  (extends left enough) AND dp > j (extends up enough)
            if (dp > i && dp > j) best = Math.max(best, dp);
        }
    }
    return best;
}

// ── Tile grid layer ───────────────────────────────────────────────────────────
// Draws z14 tile boundary lines. Only renders when tiles are ≥ 8 px wide on
// screen (map zoom ≥ ~11); otherwise the lines would be sub-pixel noise.

const TileGridLayer = L.Layer.extend({
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
        const map  = this._map;
        const size = map.getSize();
        const topLeft = map.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);
        this._canvas.width  = size.x;
        this._canvas.height = size.y;

        // Tile pixel size at current zoom — skip if too small to see
        const tilePx = 256 * Math.pow(2, map.getZoom() - TILE_ZOOM);
        if (tilePx < 8) return;

        const ctx = this._canvas.getContext('2d');
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth   = 0.5;

        const bounds = map.getBounds();
        const [xMin, yMin] = latLngToTileXY(bounds.getNorth(), bounds.getWest());
        const [xMax, yMax] = latLngToTileXY(bounds.getSouth(), bounds.getEast());

        ctx.beginPath();
        for (let x = xMin; x <= xMax + 1; x++) {
            const [lat, lng] = tileXYToLatLng(x, yMin);
            const pt = map.latLngToContainerPoint([lat, lng]);
            ctx.moveTo(pt.x, 0);
            ctx.lineTo(pt.x, size.y);
        }
        for (let y = yMin; y <= yMax + 1; y++) {
            const [lat, lng] = tileXYToLatLng(xMin, y);
            const pt = map.latLngToContainerPoint([lat, lng]);
            ctx.moveTo(0, pt.y);
            ctx.lineTo(size.x, pt.y);
        }
        ctx.stroke();
    },
});

function toggleTileGrid(show) {
    if (!tileMap) return;
    if (show) {
        if (!tileGridLayer) tileGridLayer = new TileGridLayer();
        tileGridLayer.addTo(tileMap);
    } else {
        if (tileGridLayer) tileGridLayer.removeFrom(tileMap);
    }
}

// ── Tile persistence ──────────────────────────────────────────────────────────

function renderTileStats() {
    const el = document.getElementById('tile-stats-bar');
    if (!el) return;
    el.innerHTML = `
        <div class="county-stat-item">
            <span class="county-stat-number">${visitedTiles.size.toLocaleString()}</span>
            <span class="county-stat-label">Tiles Visited</span>
        </div>
        <div class="county-stat-item">
            <span class="county-stat-number">${tileMaxCluster.toLocaleString()}</span>
            <span class="county-stat-label">Max Cluster</span>
        </div>
        <div class="county-stat-item">
            <span class="county-stat-number">${tileMaxSquare}×${tileMaxSquare}</span>
            <span class="county-stat-label">Max Square</span>
        </div>
        <div class="stats-bar-actions" style="flex-direction:column;align-items:flex-end">
            <label style="display:flex;align-items:center;gap:6px;font-size:0.8rem;color:rgba(255,255,255,0.55);cursor:pointer;white-space:nowrap">
                <input type="checkbox" id="tile-grid-checkbox" onchange="toggleTileGrid(this.checked)" style="cursor:pointer;accent-color:var(--primary-color)">
                Gridlines
            </label>
            <div class="map-legend" style="margin:0">
                <span class="map-legend-item"><span class="map-legend-dot" style="background:rgba(244,67,54,0.8)"></span>Tile</span>
                <span class="map-legend-item"><span class="map-legend-dot" style="background:rgba(129,199,132,0.85)"></span>Cluster</span>
                <span class="map-legend-item"><span class="map-legend-dot" style="background:rgba(46,125,50,0.95)"></span>Max cluster</span>
                <span class="map-legend-item"><span class="map-legend-dot" style="background:rgba(100,181,246,0.85)"></span>Square ≥${SQUARE_THRESHOLD}×${SQUARE_THRESHOLD}</span>
                <span class="map-legend-item"><span class="map-legend-dot" style="background:rgba(21,101,192,0.95)"></span>Max square</span>
            </div>
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
        tileClusterMap       = null;
        tileSquareMap        = null;
        tileSquareMembership = null;
        tileMaxCluster = 0;
        tileMaxSquare  = 0;
        tileGridLayer  = null;
        if (tileMap) { tileMap.remove(); tileMap = null; }
        dbg('Tile data reset. Reopen Tile Hunter to re-detect.');
    } catch (err) {
        dbg(`Tile reset failed: ${err.message}`);
    }
}

function setTileStatus(msg) {
    const el = document.getElementById('tile-status');
    if (el) el.textContent = msg;
}

// ── Location Control ──────────────────────────────────────────────────────────
//
// Custom Leaflet control for real-time location tracking. Renders a crosshair
// button on the topright of any map. Clicking it opens a small panel with:
//   • "Current location" — fly the map to the user's GPS position
//   • "Show my location" — toggle a live dot that refreshes every 10 seconds
//
// Each map gets its own instance; state and intervals are fully self-contained
// and are cleaned up when the map is destroyed.

const LocationControl = L.Control.extend({
    options: { position: 'topright' },

    onAdd(map) {
        this._map     = map;
        this._watching  = false;
        this._marker    = null;
        this._ring      = null;   // accuracy circle
        this._intervalId = null;

        const wrap = L.DomUtil.create('div', 'leaflet-bar leaflet-control loc-control');
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.disableScrollPropagation(wrap);

        // ── Main button ──
        this._btn = L.DomUtil.create('a', 'loc-btn', wrap);
        this._btn.href  = '#';
        this._btn.title = 'My location';
        this._btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <line x1="12" y1="2"  x2="12" y2="7"/>
            <line x1="12" y1="17" x2="12" y2="22"/>
            <line x1="2"  y1="12" x2="7"  y2="12"/>
            <line x1="17" y1="12" x2="22" y2="12"/>
        </svg>`;
        L.DomEvent.on(this._btn, 'click', e => {
            L.DomEvent.preventDefault(e);
            this._panel.hidden = !this._panel.hidden;
        });

        // ── Dropdown panel ──
        this._panel = L.DomUtil.create('div', 'loc-panel', wrap);
        this._panel.hidden = true;

        // "Current location" button
        const gotoBtn = L.DomUtil.create('button', 'loc-panel-item', this._panel);
        gotoBtn.innerHTML = '<span class="loc-icon">⊕</span> Current location';
        L.DomEvent.on(gotoBtn, 'click', () => {
            this._gotoLocation();
            this._panel.hidden = true;
        });

        L.DomUtil.create('div', 'loc-panel-divider', this._panel);

        // "Show my location" toggle
        const toggleRow = L.DomUtil.create('label', 'loc-panel-item loc-panel-toggle', this._panel);
        const toggleSpan = L.DomUtil.create('span', '', toggleRow);
        toggleSpan.textContent = 'Show my location';
        this._checkbox = L.DomUtil.create('input', 'loc-checkbox', toggleRow);
        this._checkbox.type = 'checkbox';
        L.DomEvent.on(this._checkbox, 'change', () => this._setTracking(this._checkbox.checked));

        // Close panel when map body is clicked
        map.on('click', () => { this._panel.hidden = true; });

        return wrap;
    },

    onRemove() {
        this._stopTracking();
    },

    _gotoLocation() {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            pos => this._map.setView([pos.coords.latitude, pos.coords.longitude],
                                      Math.max(this._map.getZoom(), 16)),
            err => dbg(`Location error: ${err.message}`)
        );
    },

    _setTracking(enabled) {
        if (enabled) this._startTracking(); else this._stopTracking();
    },

    _startTracking() {
        if (this._watching) return;
        this._watching = true;
        this._updateLocation();
        this._intervalId = setInterval(() => this._updateLocation(), 10000);
    },

    _stopTracking() {
        this._watching = false;
        clearInterval(this._intervalId);
        this._intervalId = null;
        if (this._marker) { this._marker.remove(); this._marker = null; }
        if (this._ring)   { this._ring.remove();   this._ring   = null; }
        if (this._checkbox) this._checkbox.checked = false;
    },

    _updateLocation() {
        if (!this._watching || !navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(pos => {
            if (!this._watching) return;
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;
            if (this._marker) {
                this._marker.setLatLng([lat, lng]);
                this._ring.setLatLng([lat, lng]).setRadius(accuracy);
            } else {
                this._ring = L.circle([lat, lng], {
                    radius: accuracy,
                    color: '#29B6F6', fillColor: '#29B6F6',
                    fillOpacity: 0.10, weight: 1, interactive: false,
                }).addTo(this._map);
                this._marker = L.circleMarker([lat, lng], {
                    radius: 8,
                    color: '#fff', fillColor: '#29B6F6',
                    fillOpacity: 1, weight: 2.5, interactive: false,
                }).addTo(this._map);
            }
        },
        err => dbg(`Location update failed: ${err.message}`),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 });
    },
});

// ── Trail Hunter ─────────────────────────────────────────────────────────────
//
// Region-based trail tracker: fetches OSM path/footway/track ways for a configured
// area and measures node-level coverage against your Strava polylines, using the
// same buildPointIndex / computeWayCompletion machinery as City Hunter.

// COTrex ArcGIS MapServer — Colorado's official trail database
const COTREX_URL = 'https://gis.colorado.gov/public/rest/services/OIT/Colorado_State_Basemap/MapServer/40/query';

const TRAIL_CONFIGS = {
    'boulder-county': {
        name: 'Boulder County, CO',
        bbox: [39.95, -105.67, 40.27, -105.06],
        center: [40.11, -105.36],
        zoom: 11,
        geoid: '08013',       // boundary from local counties-us.json
        trailFilter: "hiking='yes'",
    },
    'rmnp': {
        name: 'Rocky Mountain National Park',
        bbox: [40.15, -105.90, 40.60, -105.45],
        center: [40.38, -105.68],
        zoom: 11,
        boundaryName: 'Rocky Mountain National Park',
        boundaryType: 'protected_area',
        trailFilter: "hiking='yes'",
    },
};
let ACTIVE_TRAIL = 'boulder-county';

let trailMap = null;
let trailMapInitialized = false;
let trailNodeLayers = [];      // [{group: L.layerGroup, surface}] — one per surface type
let trailActivityLayer = null;
let trailNodesVisible = false;
let trailActivitiesVisible = false;
let trailCompletedWays = [];   // full computed set, kept for filter re-renders
let trailWayLayers = [];       // [{layer, way}] — lets us show/hide without re-fetching
const deactivatedTrailSurfaces = new Set();

function toggleTrailMap() {
    const section = document.getElementById('trail-section');
    const btn = document.getElementById('trail-toggle-btn');
    if (!section) return;
    const opening = section.style.display === 'none';
    section.style.display = opening ? 'block' : 'none';
    if (btn) btn.textContent = opening ? 'Hide map' : 'Show map';
    if (opening && !trailMapInitialized) {
        initTrailMap();
    } else if (opening && trailMap) {
        setTimeout(() => trailMap.invalidateSize(), 50);
    }
}

function switchTrail(trailKey) {
    if (!TRAIL_CONFIGS[trailKey] || trailKey === ACTIVE_TRAIL) return;
    ACTIVE_TRAIL = trailKey;
    if (trailMap) { trailMap.remove(); trailMap = null; }
    trailMapInitialized = false;
    trailNodeLayers = [];
    trailActivityLayer = null;
    trailNodesVisible = false;
    trailActivitiesVisible = false;
    trailCompletedWays = [];
    trailWayLayers = [];
    deactivatedTrailSurfaces.clear();
    const section = document.getElementById('trail-section');
    if (section && section.style.display !== 'none') initTrailMap();
}

async function initTrailMap() {
    const cfg = TRAIL_CONFIGS[ACTIVE_TRAIL];
    setTrailStatus('Loading trail network…');
    dbg(`Trail Hunter: initialising for ${cfg.name}`);

    let ways, polylines, boundarySegments;
    try {
        [ways, polylines, boundarySegments] = await Promise.all([
            fetchCOTrexTrails(cfg),
            loadPolylines(),
            fetchCityBoundary(cfg, `trail_boundary_${ACTIVE_TRAIL}`),
        ]);
    } catch (err) {
        dbg(`Trail Hunter error: ${err.message}`);
        setTrailStatus('Failed to load trail data.');
        return;
    }

    const boundaryPolygons = boundarySegments && boundarySegments.length
        ? assembleRings(boundarySegments) : [];

    if (boundaryPolygons.length) {
        const before = ways.length;
        ways = ways
            .map(way => ({
                ...way,
                coords: way.coords.filter(([lat, lng]) =>
                    boundaryPolygons.some(ring => pointInPolygon(lat, lng, ring))
                ),
            }))
            .filter(way => way.coords.length >= 2);
        dbg(`Trail boundary: clipped ${before - ways.length} ways outside limits (${ways.length} remain)`);
    }

    setTrailStatus('Analysing coverage…');
    await new Promise(r => setTimeout(r, 0));

    const pointIndex = buildPointIndex(polylines);
    const completedWays = computeWayCompletion(ways, pointIndex);

    trailMap = L.map('trail-map', {
        fullscreenControl: true,
        fullscreenControlOptions: { position: 'topleft' },
    }).setView(cfg.center, cfg.zoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(trailMap);
    new LocationControl().addTo(trailMap);

    trailCompletedWays = completedWays;
    renderTrailMap(completedWays);
    renderTrailStats(completedWays);
    renderTrailSurfaceFilters();

    if (boundaryPolygons.length) {
        boundaryPolygons.forEach(ring => {
            L.polyline(ring, {
                color: '#ffffff',
                weight: 3,
                opacity: 0.85,
                interactive: false,
            }).addTo(trailMap);
        });
        dbg(`Trail boundary: ${boundaryPolygons.length} polygon(s) drawn`);
    }

    trailMapInitialized = true;
    const done = completedWays.filter(w => w.pct === 1).length;
    setTrailStatus('');
    dbg(`Trail Hunter: ${done}/${completedWays.length} trails complete`);
}

// Fetch hiking trails from the COTrex ArcGIS MapServer, paginating 2 000 records
// at a time (server max). Coordinates are requested in WGS84 (outSR=4326) and
// arrive as [lng, lat] path arrays — flipped to [lat, lng] for Leaflet.
async function fetchCOTrexTrails(cfg) {
    const cacheKey = `trail_hunter_${ACTIVE_TRAIL}`;
    const TTL = 7 * 24 * 60 * 60 * 1000;

    try {
        const cached = JSON.parse(localStorage.getItem(cacheKey));
        if (cached && Date.now() - cached.ts < TTL) {
            dbg(`COTrex cache: ${cached.ways.length} trail segments from localStorage`);
            return cached.ways;
        }
    } catch {}

    const [south, west, north, east] = cfg.bbox;
    const PAGE = 2000;
    const ways = [];
    let offset = 0;

    while (true) {
        setTrailStatus(`Fetching trails from COTrex… ${ways.length} so far`);
        await new Promise(r => setTimeout(r, 0)); // yield to browser

        const params = new URLSearchParams({
            where:        cfg.trailFilter || '1=1',
            geometry:     `${west},${south},${east},${north}`,
            geometryType: 'esriGeometryEnvelope',
            inSR:         '4326',
            spatialRel:   'esriSpatialRelIntersects',
            outFields:    'name,type,surface',
            outSR:        '4326',
            returnGeometry: 'true',
            resultOffset:      String(offset),
            resultRecordCount: String(PAGE),
            f: 'json',
        });

        let data;
        try {
            const res = await fetch(`${COTREX_URL}?${params}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            data = await res.json();
        } catch (e) {
            throw new Error(`COTrex fetch failed: ${e.message}`);
        }
        if (data.error) throw new Error(`COTrex error: ${data.error.message}`);

        for (const f of (data.features || [])) {
            const { name = '', type = 'trail', surface = '' } = f.attributes || {};
            for (const path of (f.geometry?.paths || [])) {
                if (path.length < 2) continue;
                ways.push({
                    id:      `${f.attributes?.OBJECTID ?? offset}_${ways.length}`,
                    name,
                    highway: type,
                    surface: surface.trim(),
                    // ArcGIS returns [lng, lat] — convert to Leaflet's [lat, lng]
                    coords:  path.map(([lng, lat]) => [lat, lng]),
                });
            }
        }

        if (!data.exceededTransferLimit) break;
        offset += PAGE;
    }

    dbg(`COTrex: ${ways.length} trail segments fetched`);
    try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), ways })); } catch {}
    return ways;
}

function renderTrailMap(completedWays) {
    const renderer = L.canvas();
    const markersBySurface = {};  // surface → [L.circleMarker, ...]
    trailWayLayers = [];

    completedWays.forEach(way => {
        const color       = wayColor(way.pct);
        const complete    = way.pct === 1;
        const baseOpacity = way.pct === 0 ? 0.35 : 0.9;
        const baseWeight  = complete ? 3 : 2;

        // Thin visible line — non-interactive
        const visibleLayer = L.polyline(way.coords, {
            color, weight: baseWeight, opacity: baseOpacity, interactive: false,
        }).addTo(trailMap);

        // Wide transparent hit target — easy to tap on mobile
        const hitLayer = L.polyline(way.coords, {
            color, weight: 20, opacity: 0.001,
        }).addTo(trailMap);

        const pctLabel = (way.pct * 100).toFixed(0) + '%';
        const nameHtml = way.name
            ? way.name
            : `<em style="opacity:0.6">${way.highway}</em>`;
        const surfaceNote = way.surface ? ` · ${way.surface}` : '';
        hitLayer.bindPopup(`
            <div class="activity-popup-inner">
                <div class="activity-popup-type" style="color:${color}">${way.highway}${surfaceNote}</div>
                <div class="activity-popup-name">${nameHtml}</div>
                <div class="activity-popup-date">${pctLabel} complete · ${way.visited} / ${way.total} nodes</div>
            </div>`, { className: 'activity-popup' });
        hitLayer.on('mouseover', function () {
            if (!deactivatedTrailSurfaces.has(way.surface)) visibleLayer.setStyle({ opacity: 1, weight: baseWeight + 1.5 });
        });
        hitLayer.on('mouseout', function () {
            if (!deactivatedTrailSurfaces.has(way.surface)) visibleLayer.setStyle({ opacity: baseOpacity, weight: baseWeight });
        });

        trailWayLayers.push({ visibleLayer, hitLayer, way, baseOpacity, baseWeight });

        // Collect unvisited nodes grouped by surface for filtered visibility
        const surface = way.surface || '';
        if (!markersBySurface[surface]) markersBySurface[surface] = [];
        way.coords.forEach((coord, idx) => {
            if (!way.visitedFlags[idx]) {
                markersBySurface[surface].push(L.circleMarker(coord, {
                    radius: 3,
                    color: '#FF4444',
                    fillColor: '#FF4444',
                    fillOpacity: 0.85,
                    weight: 0,
                    renderer,
                    interactive: false,
                }));
            }
        });
    });

    trailNodeLayers = Object.entries(markersBySurface).map(([surface, markers]) => ({
        group: L.layerGroup(markers),
        surface,
    }));
}

function renderTrailStats(completedWays) {
    const el = document.getElementById('trail-stats-bar');
    if (!el) return;
    const total        = completedWays.length;
    const done         = completedWays.filter(w => w.pct === 1).length;
    const partial      = completedWays.filter(w => w.pct > 0 && w.pct < 1).length;
    const totalNodes   = completedWays.reduce((s, w) => s + w.total,   0);
    const visitedNodes = completedWays.reduce((s, w) => s + w.visited, 0);
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
            <span class="county-stat-label">Total Trails</span>
        </div>
        <div class="county-stat-item">
            <span class="county-stat-number">${pct}%</span>
            <span class="county-stat-label">Node Coverage</span>
        </div>
        <div class="stats-bar-actions">
            <button class="cache-refresh-btn" id="trail-nodes-btn" onclick="toggleTrailNodes()">
                Show remaining nodes
            </button>
            <button class="cache-refresh-btn" id="trail-activities-btn" onclick="toggleTrailActivities()">
                Show my activities
            </button>
        </div>`;
}

function renderTrailSurfaceFilters() {
    const el = document.getElementById('trail-surface-filters');
    if (!el || !trailCompletedWays.length) return;

    const surfaceCounts = {};
    trailCompletedWays.forEach(w => {
        const s = w.surface || '';
        surfaceCounts[s] = (surfaceCounts[s] || 0) + 1;
    });

    const surfaces = Object.keys(surfaceCounts).sort((a, b) => {
        if (!a) return 1; if (!b) return -1;
        return a.localeCompare(b);
    });
    if (surfaces.length <= 1) { el.innerHTML = ''; return; }

    const pills = surfaces.map(s => {
        const active = !deactivatedTrailSurfaces.has(s);
        const label  = s || '(unknown)';
        return `<button class="filter-pill${active ? ' active' : ''}" onclick="toggleTrailSurface('${s.replace(/'/g, "\\'")}')">${label} <span class="filter-pill-count">${surfaceCounts[s]}</span></button>`;
    }).join('');

    el.innerHTML = `
        <div style="margin-bottom:8px;font-size:0.72rem;color:rgba(255,255,255,0.35);text-transform:uppercase;letter-spacing:0.05em">Surface filter</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <button class="filter-all-btn" onclick="setAllTrailSurfaces(true)">All</button>
            <button class="filter-all-btn" onclick="setAllTrailSurfaces(false)">None</button>
            <div class="filter-pills">${pills}</div>
        </div>`;
}

function toggleTrailSurface(surface) {
    if (deactivatedTrailSurfaces.has(surface)) {
        deactivatedTrailSurfaces.delete(surface);
    } else {
        deactivatedTrailSurfaces.add(surface);
    }
    applyTrailSurfaceFilter();
}

function setAllTrailSurfaces(enabled) {
    if (enabled) {
        deactivatedTrailSurfaces.clear();
    } else {
        trailCompletedWays.forEach(w => deactivatedTrailSurfaces.add(w.surface || ''));
    }
    applyTrailSurfaceFilter();
}

function applyTrailSurfaceFilter() {
    trailWayLayers.forEach(({ visibleLayer, hitLayer, way, baseOpacity }) => {
        const hidden = deactivatedTrailSurfaces.has(way.surface || '');
        visibleLayer.setStyle({ opacity: hidden ? 0 : baseOpacity });
        hitLayer.setStyle({ opacity: hidden ? 0 : 0.001 });
    });

    applyTrailNodeVisibility(); // keep node overlay in sync with surface filter

    const visibleWays = trailCompletedWays.filter(w => !deactivatedTrailSurfaces.has(w.surface || ''));
    renderTrailStats(visibleWays);
    renderTrailSurfaceFilters(); // re-render pills to update active state
}

function toggleTrailNodes() {
    if (!trailMap || !trailNodeLayers.length) return;
    trailNodesVisible = !trailNodesVisible;
    applyTrailNodeVisibility();
    const btn = document.getElementById('trail-nodes-btn');
    if (btn) btn.textContent = trailNodesVisible ? 'Hide remaining nodes' : 'Show remaining nodes';
}

// Show node groups that are both globally visible and not surface-filtered out.
function applyTrailNodeVisibility() {
    trailNodeLayers.forEach(({ group, surface }) => {
        const surfaceActive = !deactivatedTrailSurfaces.has(surface);
        if (trailNodesVisible && surfaceActive) {
            group.addTo(trailMap);
        } else {
            group.removeFrom(trailMap);
        }
    });
}

async function toggleTrailActivities() {
    if (!trailMap) return;
    trailActivitiesVisible = !trailActivitiesVisible;
    const btn = document.getElementById('trail-activities-btn');

    if (!trailActivitiesVisible) {
        if (trailActivityLayer) trailActivityLayer.removeFrom(trailMap);
        if (btn) btn.textContent = 'Show my activities';
        return;
    }

    if (btn) btn.textContent = 'Hide my activities';

    if (!trailActivityLayer) {
        const polylines = await loadPolylines();
        const renderer = L.canvas();
        const layers = [];
        polylines.forEach((encoded, i) => {
            if (!encoded) return;
            const slim = currentSlim[i];
            if (!slim) return;
            const points = decodePolyline(encoded);
            if (!points.length) return;
            const layer = L.polyline(points, { color: '#29B6F6', weight: 1.5, opacity: 0.6, renderer });
            layer.bindPopup(buildActivityPopup(slim), { className: 'activity-popup' });
            layer.on('mouseover', function () { this.setStyle({ opacity: 0.95, weight: 3 }); });
            layer.on('mouseout',  function () { this.setStyle({ opacity: 0.6, weight: 1.5 }); });
            layers.push(layer);
        });
        trailActivityLayer = L.layerGroup(layers);
    }

    trailActivityLayer.addTo(trailMap);
}

async function resetTrailData() {
    if (!confirm('Clear cached trail network data? It will be re-fetched from COTrex on next open.')) return;
    localStorage.removeItem(`trail_hunter_${ACTIVE_TRAIL}`);
    trailMapInitialized = false;
    trailNodeLayers = [];
    trailActivityLayer = null;
    trailNodesVisible = false;
    trailActivitiesVisible = false;
    trailCompletedWays = [];
    trailWayLayers = [];
    deactivatedTrailSurfaces.clear();
    if (trailMap) { trailMap.remove(); trailMap = null; }
    dbg('Trail cache cleared. Reopen Trail Hunter to re-fetch from COTrex.');
}

function setTrailStatus(msg) {
    const el = document.getElementById('trail-status');
    if (el) el.textContent = msg;
}

// ── Mountain Hunter ───────────────────────────────────────────────────────────
//
// Detects mountain summits reached by decoding activity polylines and checking
// proximity (≤300 m) against OSM natural=peak nodes fetched from Overpass.
// Elevation gain stats come directly from the `e` field in slim activity data.

const MOUNTAIN_ACTIVITY_TYPES = new Set(['Run', 'TrailRun', 'Hike', 'Walk', 'Snowshoe', 'BackcountrySki', 'AlpineSki', 'NordicSki']);
const ELEVATION_ACTIVITY_TYPES = new Set(['Run', 'TrailRun', 'Hike', 'Walk', 'Snowshoe']);
const SUMMIT_RADIUS_M = 300;
const MOUNTAIN_PEAK_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

let mountainPeaks = [];          // [{id, name, lat, lng, ele}]  — from OSM
let mountainVisits = new Map();  // peakId → [{actId, actName, actType, date}]
let mountainMapInstance = null;
let mountainMapInitialized = false;
let mountainHunterReady = false;

function mToFt(m) { return Math.round(m * 3.28084); }

function haversineM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const dφ = (lat2 - lat1) * Math.PI / 180;
    const dλ = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function toggleMountainMap() {
    const section = document.getElementById('mountain-map-section');
    const btn = document.getElementById('mountain-toggle-btn');
    if (!section) return;
    const opening = section.style.display === 'none';
    section.style.display = opening ? 'block' : 'none';
    if (btn) btn.textContent = opening ? 'Hide map' : 'Show map';
    if (opening && !mountainMapInitialized) {
        renderMountainMap();
    } else if (opening && mountainMapInstance) {
        setTimeout(() => mountainMapInstance.invalidateSize(), 50);
    }
}

async function fetchMountainPeaks(south, west, north, east) {
    const cacheKey = `mountain_peaks_${[south, north, west, east].map(v => v.toFixed(1)).join('_')}`;
    try {
        const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
        if (cached && Date.now() - cached.ts < MOUNTAIN_PEAK_CACHE_TTL) {
            dbg(`Mountain peaks: ${cached.peaks.length} from cache`);
            return cached.peaks;
        }
    } catch {}

    dbg(`Mountain peaks: querying Overpass bbox ${south.toFixed(2)},${west.toFixed(2)},${north.toFixed(2)},${east.toFixed(2)}`);
    const query = `[out:json][timeout:30];node["natural"="peak"]["ele"](${south},${west},${north},${east});out body;`;
    const res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const data = await res.json();

    const peaks = (data.elements || [])
        .filter(e => { const v = parseFloat(e.tags?.ele); return !isNaN(v) && v > 0; })
        .map(e => ({
            id: e.id,
            name: e.tags?.name || e.tags?.['name:en'] || 'Unnamed Peak',
            lat: e.lat,
            lng: e.lon,
            ele: parseFloat(e.tags.ele),
        }));

    dbg(`Mountain peaks: ${peaks.length} from Overpass`);
    try { localStorage.setItem(cacheKey, JSON.stringify({ peaks, ts: Date.now() })); } catch {}
    return peaks;
}

async function detectMountainSummits(peaks) {
    const acts = currentSlim.filter(a => MOUNTAIN_ACTIVITY_TYPES.has(a.t) && a.p);
    if (!acts.length || !peaks.length) return new Map();

    // 0.5° grid index for fast candidate lookup
    const index = {};
    for (const peak of peaks) {
        const key = `${Math.floor(peak.lat * 2)},${Math.floor(peak.lng * 2)}`;
        (index[key] = index[key] || []).push(peak);
    }

    const visits = new Map();

    for (let i = 0; i < acts.length; i++) {
        if (i % 25 === 0) {
            setMountainStatus(`Scanning routes… ${i} / ${acts.length}`);
            await new Promise(r => setTimeout(r, 0));
        }
        const act = acts[i];
        const points = decodePolyline(act.p);
        const hit = new Set();

        for (let j = 0; j < points.length; j += 4) {
            const [lat, lng] = points[j];
            const gr = Math.floor(lat * 2);
            const gc = Math.floor(lng * 2);

            for (let dl = -1; dl <= 1; dl++) {
                for (let dk = -1; dk <= 1; dk++) {
                    const candidates = index[`${gr + dl},${gc + dk}`] || [];
                    for (const peak of candidates) {
                        if (hit.has(peak.id)) continue;
                        if (Math.abs(lat - peak.lat) > 0.006 || Math.abs(lng - peak.lng) > 0.008) continue;
                        if (haversineM(lat, lng, peak.lat, peak.lng) <= SUMMIT_RADIUS_M) {
                            hit.add(peak.id);
                            if (!visits.has(peak.id)) visits.set(peak.id, []);
                            visits.get(peak.id).push({
                                actId:   act.i,
                                actName: act.n || 'Untitled',
                                actType: act.t,
                                date:    act.d || '',
                            });
                        }
                    }
                }
            }
        }
    }

    return visits;
}

// Renders elevation gain stat immediately (no Overpass needed) plus placeholder peak stats
function renderMountainQuickStats() {
    const el = document.getElementById('mountain-stats-bar');
    if (!el) return;

    const topGain = currentSlim
        .filter(a => ELEVATION_ACTIVITY_TYPES.has(a.t) && (a.e || 0) > 0)
        .reduce((best, a) => (!best || a.e > best.e) ? a : best, null);

    el.innerHTML = `
        <div class="county-stat-item" id="mh-peaks-stat">
            <span class="county-stat-number">…</span>
            <span class="county-stat-label">Peaks Summited</span>
        </div>
        <div class="county-stat-item" id="mh-tallest-stat">
            <span class="county-stat-number">…</span>
            <span class="county-stat-label">Tallest Peak</span>
        </div>
        <div class="county-stat-item" id="mh-most-climbed-stat">
            <span class="county-stat-number">…</span>
            <span class="county-stat-label">Most Climbed</span>
        </div>
        <div class="county-stat-item">
            <span class="county-stat-number">${topGain ? mToFt(topGain.e).toLocaleString() + ' ft' : '—'}</span>
            <span class="county-stat-label">Most Elev. Gain${topGain
                ? `<br><span class="mh-sublabel">${topGain.n || 'Untitled'}</span>`
                : ''}</span>
        </div>`;
}

function renderMountainStats() {
    if (!mountainHunterReady) return;

    let tallestPeak = null, mostClimbedPeak = null, mostClimbedCount = 0;
    for (const [peakId, pvs] of mountainVisits) {
        const peak = mountainPeaks.find(p => p.id === peakId);
        if (!peak) continue;
        if (!tallestPeak || peak.ele > tallestPeak.ele) tallestPeak = peak;
        if (pvs.length > mostClimbedCount) { mostClimbedCount = pvs.length; mostClimbedPeak = peak; }
    }

    const peaksEl = document.getElementById('mh-peaks-stat');
    if (peaksEl) peaksEl.querySelector('.county-stat-number').textContent = mountainVisits.size;

    const tallestEl = document.getElementById('mh-tallest-stat');
    if (tallestEl && tallestPeak) {
        tallestEl.querySelector('.county-stat-number').textContent = mToFt(tallestPeak.ele).toLocaleString() + ' ft';
        tallestEl.querySelector('.county-stat-label').innerHTML =
            `Tallest Peak<br><span class="mh-sublabel">${tallestPeak.name}</span>`;
    } else if (tallestEl) {
        tallestEl.querySelector('.county-stat-number').textContent = '—';
    }

    const mostEl = document.getElementById('mh-most-climbed-stat');
    if (mostEl && mostClimbedPeak) {
        mostEl.querySelector('.county-stat-number').textContent = mostClimbedCount + '×';
        mostEl.querySelector('.county-stat-label').innerHTML =
            `Most Climbed<br><span class="mh-sublabel">${mostClimbedPeak.name}</span>`;
    } else if (mostEl) {
        mostEl.querySelector('.county-stat-number').textContent = '—';
    }

    renderMountainTable();
}

function renderMountainTable() {
    const tableEl = document.getElementById('mountain-table');
    if (!tableEl || !mountainVisits.size) return;

    const rows = [...mountainVisits.entries()]
        .map(([id, pvs]) => ({ peak: mountainPeaks.find(p => p.id === id), pvs }))
        .filter(r => r.peak)
        .sort((a, b) => b.peak.ele - a.peak.ele);

    const table = document.createElement('table');
    table.className = 'travel-table';
    table.innerHTML = `
        <thead><tr>
            <th>Peak</th>
            <th>Elevation</th>
            <th style="text-align:center">Summits</th>
            <th>Last Summit</th>
        </tr></thead>`;

    const tbody = document.createElement('tbody');
    rows.forEach(({ peak, pvs }) => {
        const last = [...pvs].sort((a, b) => b.date.localeCompare(a.date))[0];
        const href = last.actId ? `https://www.strava.com/activities/${last.actId}` : null;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${peak.name}</td>
            <td>${mToFt(peak.ele).toLocaleString()} ft <span class="mh-ele-m">(${Math.round(peak.ele).toLocaleString()}m)</span></td>
            <td style="text-align:center">${pvs.length}</td>
            <td>${href
                ? `<a class="activity-popup-link" href="${href}" target="_blank" rel="noopener">${last.actName}</a>`
                : (last.actName || '—')}
                ${last.date ? `<div class="activity-popup-date">${formatActivityDate(last.date)}</div>` : ''}
            </td>`;
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableEl.innerHTML = '';
    tableEl.appendChild(table);
}

function renderMountainMap() {
    if (!mountainHunterReady) {
        setMountainStatus('Summit data not ready yet — try again in a moment.');
        return;
    }

    // Center on visited peaks, or foot activity centroid as fallback
    let clat, clng, czoom;
    if (mountainVisits.size > 0) {
        const vPeaks = [...mountainVisits.keys()].map(id => mountainPeaks.find(p => p.id === id)).filter(Boolean);
        clat  = vPeaks.reduce((s, p) => s + p.lat, 0) / vPeaks.length;
        clng  = vPeaks.reduce((s, p) => s + p.lng, 0) / vPeaks.length;
        czoom = 9;
    } else {
        const footActs = currentSlim.filter(a => MOUNTAIN_ACTIVITY_TYPES.has(a.t) && a.l);
        clat  = footActs.reduce((s, a) => s + a.l[0], 0) / footActs.length;
        clng  = footActs.reduce((s, a) => s + a.l[1], 0) / footActs.length;
        czoom = 8;
    }

    mountainMapInstance = L.map('mountain-map', { center: [clat, clng], zoom: czoom });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
    }).addTo(mountainMapInstance);
    new LocationControl().addTo(mountainMapInstance);

    for (const peak of mountainPeaks) {
        const pvs   = mountainVisits.get(peak.id);
        const visited = !!pvs;
        const last  = visited ? [...pvs].sort((a, b) => b.date.localeCompare(a.date))[0] : null;
        const href  = last?.actId ? `https://www.strava.com/activities/${last.actId}` : null;

        L.circleMarker([peak.lat, peak.lng], {
            radius:      visited ? 7 : 4,
            color:       visited ? '#4CAF50' : 'rgba(255,255,255,0.25)',
            fillColor:   visited ? '#4CAF50' : 'rgba(255,255,255,0.1)',
            fillOpacity: visited ? 0.85 : 0.35,
            weight:      visited ? 2 : 1,
        })
        .bindPopup(`
            <div class="activity-popup-inner">
                <div class="activity-popup-type" style="color:${visited ? '#4CAF50' : 'rgba(255,255,255,0.4)'}">
                    ▲ ${mToFt(peak.ele).toLocaleString()} ft (${Math.round(peak.ele).toLocaleString()}m)
                </div>
                <div class="activity-popup-name">${peak.name}</div>
                <div class="activity-popup-date">
                    ${visited
                        ? `Summited ${pvs.length}× · Last: ${last.date ? formatActivityDate(last.date) : '?'}
                           ${href ? `<br><a class="activity-popup-link" href="${href}" target="_blank" rel="noopener">${last.actName}</a>` : ''}`
                        : 'Not yet summited'}
                </div>
            </div>`, { className: 'activity-popup' })
        .addTo(mountainMapInstance);
    }

    mountainMapInitialized = true;
    setMountainStatus('');
}

function setMountainStatus(msg) {
    const el = document.getElementById('mountain-status');
    if (el) el.textContent = msg;
}

async function resetMountainData() {
    if (!confirm('Clear cached mountain peak data? Peaks will be re-fetched from OpenStreetMap.')) return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('mountain_peaks_')) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    mountainPeaks = [];
    mountainVisits = new Map();
    mountainHunterReady = false;
    mountainMapInitialized = false;
    if (mountainMapInstance) { mountainMapInstance.remove(); mountainMapInstance = null; }
    dbg('Mountain cache cleared — re-initialising…');
    initMountainHunter().catch(err => dbg(`Mountain reset error: ${err.message}`));
}

async function initMountainHunter() {
    if (!currentSlim.length) return;

    // Elevation gain stat is instant — show it right away
    renderMountainQuickStats();

    if (mountainHunterReady) {
        renderMountainStats();
        return;
    }

    const footActs = currentSlim.filter(a => MOUNTAIN_ACTIVITY_TYPES.has(a.t) && a.l);
    if (!footActs.length) {
        setMountainStatus('No hiking or running activities found.');
        return;
    }

    let south = 90, north = -90, west = 180, east = -180;
    for (const a of footActs) {
        south = Math.min(south, a.l[0]);
        north = Math.max(north, a.l[0]);
        west  = Math.min(west,  a.l[1]);
        east  = Math.max(east,  a.l[1]);
    }
    south -= 0.3; north += 0.3; west -= 0.3; east += 0.3;

    try {
        setMountainStatus('Fetching peaks from OpenStreetMap…');
        mountainPeaks = await fetchMountainPeaks(south, west, north, east);

        if (!mountainPeaks.length) {
            setMountainStatus('No named peaks found in your activity area.');
            return;
        }

        setMountainStatus(`Scanning ${footActs.length} activities for summits…`);
        mountainVisits = await detectMountainSummits(mountainPeaks);

        mountainHunterReady = true;
        setMountainStatus('');
        renderMountainStats();
        dbg(`Mountain Hunter: ${mountainVisits.size} peaks summited out of ${mountainPeaks.length} in region`);
    } catch (err) {
        setMountainStatus(`Error: ${err.message}`);
        dbg(`Mountain Hunter error: ${err.message}`);
    }
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

function toggleDebugExpand() {
    const log  = document.getElementById('debug-log');
    const btns = document.getElementById('dbg-action-btns');
    const lbl  = document.getElementById('dbg-expand-lbl');
    if (!log) return;
    const collapsed = log.style.display === 'none';
    log.style.display   = collapsed ? '' : 'none';
    if (btns) btns.style.display = collapsed ? 'flex' : 'none';
    if (lbl)  lbl.textContent    = collapsed ? '▾' : '▸';
}

function renderDebugPanel() {
    const existing = document.getElementById('debug-panel');
    if (existing) return; // already rendered

    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.hidden = true;
    panel.innerHTML = `
        <div class="dbg-header" onclick="toggleDebugExpand()" style="cursor:pointer" title="Click to expand / collapse">
            <strong>Debug Log <span id="dbg-expand-lbl">▸</span></strong>
            <div id="dbg-action-btns" style="display:none;gap:6px" onclick="event.stopPropagation()">
                <button class="dbg-clear" onclick="resetGeoCache()" title="Clear geocoded location data — forces full re-geocode">Reset geo cache</button>
                <button class="dbg-clear" onclick="resetCountyData()" title="Clear county detection results — forces full re-detection">Reset counties</button>
                <button class="dbg-clear" onclick="resetTileData()" title="Clear tile detection results — forces full re-detection">Reset tiles</button>
                <button class="dbg-clear" onclick="resetCityData()" title="Clear city road cache from localStorage — forces fresh Overpass fetch">Reset city</button>
                <button class="dbg-clear" onclick="resetTrailData()" title="Clear trail network cache from localStorage — forces fresh Overpass fetch">Reset trails</button>
                <button class="dbg-clear" onclick="resetMountainData()" title="Clear mountain peak cache from localStorage — forces fresh Overpass fetch">Reset mountains</button>
                <button class="dbg-clear" onclick="document.getElementById('debug-log').innerHTML=''">Clear log</button>
            </div>
        </div>
        <ul id="debug-log" style="display:none"></ul>
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

    // Mountain Hunter — runs in background; elevation gain stat is instant,
    // peak detection starts after a short yield so the main UI paints first
    setTimeout(() => initMountainHunter().catch(err => dbg(`Mountain Hunter bg error: ${err.message}`)), 400);

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

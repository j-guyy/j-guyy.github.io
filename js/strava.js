const WORKER_URL = 'https://strava-worker.justinguyette.workers.dev';
const GEO_CACHE_KEY = 'strava_geo_cache_v1';
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

async function fetchAllActivities() {
    let all = [];
    let page = 1;
    setStatus(`Fetching activities…`);

    while (true) {
        const res = await fetch(`${WORKER_URL}/activities?per_page=200&page=${page}`);
        const batch = await res.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        all = all.concat(batch);
        setStatus(`Fetching activities… ${all.length} loaded`);
        page++;
    }

    return all;
}

// ── Geocoding ─────────────────────────────────────────────────────────────────

async function geocodeKey(key) {
    const [lat, lng] = key.split(',').map(Number);
    try {
        const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
        );
        const data = await res.json();
        return data.countryName || 'Unknown';
    } catch {
        return 'Unknown';
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

    // Persist updated cache
    try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch {}
    return cache;
}

// ── Build country data ────────────────────────────────────────────────────────

function buildCountryData(activities, cache) {
    const countries = {};
    let noLocation = 0;

    activities.forEach(a => {
        if (!a.start_latlng?.length) { noLocation++; return; }
        const country = cache[gridKey(a.start_latlng)] || 'Unknown';
        if (!countries[country]) {
            countries[country] = { total: 0 };
            GROUP_KEYS.forEach(g => countries[country][g] = 0);
        }
        const group = getGroup(a.sport_type || a.type);
        countries[country][group]++;
        countries[country].total++;
    });

    return { countries, noLocation };
}

// ── Sort state ────────────────────────────────────────────────────────────────

const sortState = { col: 'total', dir: 'desc' };

function sortedCountries(countries) {
    return Object.entries(countries).sort(([, a], [, b]) => {
        const aVal = a[sortState.col] ?? 0;
        const bVal = b[sortState.col] ?? 0;
        if (typeof aVal === 'string') {
            const cmp = aVal.localeCompare(bVal);
            return sortState.dir === 'asc' ? cmp : -cmp;
        }
        return sortState.dir === 'asc' ? aVal - bVal : bVal - aVal;
    });
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderSummary(activities, countries, noLocation) {
    const total = activities.length;
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
        ${noLocation > 0 ? `<p class="no-location-note">${noLocation.toLocaleString()} activities had no GPS location and are excluded.</p>` : ''}
    `;
}

function renderTable(countries) {
    const container = document.getElementById('strava-table-container');
    container.innerHTML = '';

    const headers = [
        { label: 'Country', col: 'country' },
        ...GROUP_KEYS.map(g => ({ label: `${GROUP_ICONS[g]} ${g}`, col: g })),
        { label: 'Total', col: 'total' }
    ];

    const table = document.createElement('table');
    table.className = 'travel-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach(({ label, col }) => {
        const th = document.createElement('th');
        const isActive = sortState.col === col;
        th.classList.add('sortable');
        if (isActive) th.classList.add('sort-active');

        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = isActive ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';

        th.appendChild(document.createTextNode(label));
        th.appendChild(indicator);
        th.addEventListener('click', () => {
            if (sortState.col === col) {
                sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
            } else {
                sortState.col = col;
                sortState.dir = col === 'country' ? 'asc' : 'desc';
            }
            renderTable(countries);
        });
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    sortedCountries(countries).forEach(([country, data]) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${country}</td>
            ${GROUP_KEYS.map(g => `<td style="text-align:center">${data[g] || 0}</td>`).join('')}
            <td style="text-align:center"><strong>${data.total}</strong></td>
        `;
        tbody.appendChild(row);
    });
    table.appendChild(tbody);
    container.appendChild(table);
}

// ── Status helpers ────────────────────────────────────────────────────────────

function setStatus(msg) {
    const el = document.getElementById('loading-status');
    if (el) el.textContent = msg;
}

function hideLoader() {
    const el = document.getElementById('loading-section');
    if (el) el.style.display = 'none';
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function () {
    try {
        const activities = await fetchAllActivities();

        // Collect unique grid cells
        const cellKeys = [...new Set(
            activities
                .filter(a => a.start_latlng?.length)
                .map(a => gridKey(a.start_latlng))
        )];

        // Load geo cache from localStorage
        let cache = {};
        try { cache = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); } catch {}

        // Geocode any new cells
        cache = await geocodeAll(cellKeys, cache);

        hideLoader();

        const { countries, noLocation } = buildCountryData(activities, cache);
        renderSummary(activities, countries, noLocation);
        renderTable(countries);

    } catch (err) {
        setStatus('Error loading data: ' + err.message);
        console.error(err);
    }
});

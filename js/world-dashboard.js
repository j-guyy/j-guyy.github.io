let worldData;
let editMode = false;
let refreshOwnerUI = () => {};

// Countries tables ('world' = every country; the rest one continent each) open
// sorted by Core, so the countries furthest along come first.
const sortState = {
    world:        { col: 'progress', dir: 'desc' },
    northAmerica: { col: 'progress', dir: 'desc' },
    southAmerica: { col: 'progress', dir: 'desc' },
    europe:       { col: 'progress', dir: 'desc' },
    asia:         { col: 'progress', dir: 'desc' },
    africa:       { col: 'progress', dir: 'desc' },
    oceania:      { col: 'progress', dir: 'desc' },
    capitals:     { col: 'country',  dir: 'asc'  },
    // Bucket lists (js/bucket-lists.js)
    forbes100:           { col: 'rank', dir: 'asc' },
    sevenWonders:        { col: 'name', dir: 'asc' },
    sevenNaturalWonders: { col: 'name', dir: 'asc' },
    wonderNominees:      { col: 'name', dir: 'asc' }
};

// Forbes 100 / Seven Wonders lists, once loaded (js/bucket-lists.js).
let bucketLists = null;
let storedCountries = null; // countries as loaded, before live populations
// Country name → flag image code (data/country-flags.json, built with the
// images by scripts/build-flags.mjs). Rows render without flags until loaded.
let countryFlags = {};
// World capitals ({ capitals, stored }, TravelAPI.fetchWorldCapitals) and the
// country high points list (TravelAPI.fetchPeakList: { data, source, reason }).
let worldCapitals = null;
let countryHighpoints = null;
// The Regions bar (computeRegionProgress in js/world-map.js): null until
// computed, then { byCountry, capitalHints }. regionsState: idle | loading |
// ready | error.
let regionProgress = null;
let regionsState = 'idle';
const isBucketList = type => BUCKET_LISTS.some(l => l.id === type);
const isCountryTable = type => type === 'world' || Boolean(continentMap[type]);
const currentTable = () => document.getElementById('table-selector').value;

const continentMap = {
    northAmerica: 'northAmericanCountries',
    southAmerica: 'southAmericanCountries',
    europe:       'europeanCountries',
    asia:         'asianCountries',
    africa:       'africanCountries',
    oceania:      'oceaniaCountries'
};

const CONTINENT_LABELS = {
    northAmerica: 'North American', southAmerica: 'South American', europe: 'European',
    asia: 'Asian', africa: 'African', oceania: 'Oceania'
};

document.addEventListener('DOMContentLoaded', function () {
    const dataReady = loadCountriesWithPopulation(null, function (updatedData) {
        worldData = updatedData;
        displayWorldTravelSummary();
        renderPopulationSourceBadge();
        updateTable(currentTable());
    })
        .then(data => {
            worldData = data;
            storedCountries = JSON.parse(JSON.stringify(data));
            displayWorldTravelSummary();
            renderPopulationSourceBadge();
            updateTable(currentTable());
            setupEditMode();
            setupCsvExport();
        });
    dataReady.catch(error => console.error('Error loading the JSON file:', error));
    // Each of these fills in more of the Countries table as it lands.
    const rerender = () => {
        if (!worldData) return;
        displayWorldTravelSummary();
        updateTable(currentTable());
    };
    Promise.all([dataReady, fetch('data/country-flags.json').then(r => r.json())])
        .then(([, flags]) => { countryFlags = flags; rerender(); })
        .catch(err => console.warn('Flags unavailable:', err));
    loadBucketLists()
        .then(b => { bucketLists = b; displayBucketSummary(); rerender(); })
        .catch(error => console.error('Error loading the bucket lists:', error));
    TravelAPI.fetchWorldCapitals()
        .then(c => { worldCapitals = c; displayBucketSummary(); rerender(); })
        .catch(err => console.error('Error loading the world capitals:', err));
    loadCountryHighpoints()
        .then(list => { countryHighpoints = list; rerender(); })
        .catch(err => console.error('Error loading the country high points:', err));
    setupWorldViewSwitch(dataReady);
    dataReady.then(() => scheduleRegionProgress());
});

// The country high points list as the Peaks dashboard shows it: KV once
// seeded (else the /data file), with names and coordinates always from the
// file (the stored list keeps what it was seeded with).
async function loadCountryHighpoints() {
    const list = await TravelAPI.fetchPeakList('countryHighpoints', 'data/country-highpoints.json');
    if (list.source === 'cloudflare') {
        try {
            const ref = new Map((await fetch('data/country-highpoints.json').then(r => r.json())).map(p => [p.country, p]));
            list.data.forEach(p => {
                const r = ref.get(p.country);
                if (r) { p.name = r.name; p.coords = r.coords; p.elevationM = r.elevationM; p.elevation = r.elevation; }
            });
        } catch { /* keep the stored names */ }
    }
    return list;
}

// Map view (js/view-switch.js). Leaflet, its plugins and js/world-map.js load
// the first time the map is shown, so the Tables view never downloads them.
const WORLD_MAP_SCRIPTS = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'js/fluid-zoom.js?v=20261022',
    'js/map-fixes.js?v=20261025',
    'https://unpkg.com/leaflet-gesture-handling@1.2.2/dist/leaflet-gesture-handling.min.js',
    'https://unpkg.com/leaflet.fullscreen@5.3.3/dist/Control.FullScreen.umd.js',
    'js/map-controls.js?v=20261022',
    'js/world-map.js?v=20261025w'
];
let worldMap = null;          // { map, refresh } once built
let worldMapLoading = null;
let worldMapStale = false;    // an Edit Mode toggle since the map last drew

function setupWorldViewSwitch(dataReady) {
    setupViewSwitch({
        titles: { tables: 'World Travel — Justin Guyette', map: 'World Travel Map — Justin Guyette' },
        onShow: view => {
            if (view !== 'map') return;
            if (pendingMapBuild) { pendingMapBuild(); pendingMapBuild = null; }
            showWorldMap(dataReady);
        }
    });
}

function showWorldMap(dataReady) {
    if (worldMap) {
        worldMap.map.invalidateSize();  // the page may have resized while hidden
        if (worldMapStale) { worldMapStale = false; worldMap.refresh(worldData); }
        return;
    }
    if (worldMapLoading) return;
    const mapEl = document.getElementById('world-map');
    worldMapLoading = dataReady
        .then(() => loadScriptsInOrder(WORLD_MAP_SCRIPTS))
        // Build it only while it's on screen, so Leaflet measures a real size.
        .then(() => document.getElementById('map-view').hidden
            ? new Promise(resolve => { pendingMapBuild = resolve; })
            : null)
        .then(() => initWorldMap(worldData))
        .then(m => { worldMap = m; worldMapStale = false; })
        .catch(err => {
            console.error('Error loading the map:', err);
            worldMapLoading = null;
            mapEl.textContent = 'Error loading map. Please try again later.';
        });
}
let pendingMapBuild = null;

// ── Regions bar ──────────────────────────────────────────────────────────────
// How many of each country's states / provinces I've been to, by the World
// Map's Subregions rule: a place or a Strava route in it. It needs the map's
// helpers (js/world-map.js, loaded with Leaflet exactly as the Map view loads
// them, so opening the map later reuses them), every place file, the Strava
// routes and the admin-1 boundaries, so it runs once the table is up, and the
// last result is kept in localStorage to show at once on the next visit.
const REGIONS_CACHE_KEY = 'world_regions_v1';

function readRegionCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(REGIONS_CACHE_KEY));
        if (cached && cached.byCountry) return { byCountry: cached.byCountry, capitalHints: new Set(cached.capitalHints || []) };
    } catch { /* blocked storage or bad JSON: compute afresh */ }
    return null;
}

function scheduleRegionProgress() {
    if (regionsState !== 'idle') return;
    regionProgress = readRegionCache();
    if (regionProgress) updateTable(currentTable());
    regionsState = 'loading';
    // Let the page finish drawing first; the work below is a few seconds.
    const start = () => computeRegions().catch(err => {
        console.warn('Regions unavailable:', err);
        regionsState = 'error';
        updateTable(currentTable());
    });
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 2000 });
    else setTimeout(start, 500);
}

async function computeRegions() {
    await loadScriptsInOrder(WORLD_MAP_SCRIPTS);
    const [mapData, encoded, capitals] = await Promise.all([
        loadWorldMapData(),
        fetchStravaPolylines().catch(err => { console.warn('Strava routes unavailable:', err); return []; }),
        worldCapitalsReady(),
    ]);
    const countries = allCountries().map(c => c.name);
    const { byCountry, stravaCells } = await computeRegionProgress({ countries, encoded, ...mapData });
    // A capital not checked off with a Strava route through its ~1 km cell or
    // the ones around it: maybe visited without being marked.
    const cellKeys = new Set();
    stravaCells.forEach(cells => cells.forEach(([lat, lng]) => cellKeys.add(`${Math.round(lat * 100)},${Math.round(lng * 100)}`)));
    const nearRoute = ([lng, lat]) => {
        const y = Math.round(lat * 100), x = Math.round(lng * 100);
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (cellKeys.has(`${y + dy},${x + dx}`)) return true;
        return false;
    };
    const capitalHints = new Set(capitals ? capitals.capitals.filter(c => c.coords && nearRoute(c.coords)).map(c => c.country) : []);
    regionProgress = { byCountry, capitalHints };
    regionsState = 'ready';
    try {
        const slim = Object.fromEntries(Object.entries(byCountry).map(([k, v]) => [k, v]));
        localStorage.setItem(REGIONS_CACHE_KEY, JSON.stringify({ byCountry: slim, capitalHints: [...capitalHints] }));
    } catch { /* storage full or blocked: just don't remember */ }
    updateTable(currentTable());
}

// Resolves once the capitals have loaded (or failed to).
function worldCapitalsReady() {
    if (worldCapitals) return Promise.resolve(worldCapitals);
    return TravelAPI.fetchWorldCapitals().catch(() => null);
}

function allCountries() {
    return Object.values(continentMap).flatMap(key => worldData[key] || []);
}

// ── Countries table ──────────────────────────────────────────────────────────
// One row per country, rolled up from the other lists like the US dashboard's
// States table: the country itself, its capital, its Forbes 100 cities, the
// wonders in it (Seven Wonders, Seven Natural Wonders and the nominees, each
// counted in its main country) and its high point (plus its mainland high
// point where that's another peak). Core is the share of those done; Regions
// is the share of its states / provinces reached (see above).

// List spellings → countries.json names. Territories count for the country
// they belong to.
const COUNTRY_ALIASES = {
    'USA': 'United States of America', 'United States': 'United States of America',
    'Puerto Rico': 'United States of America', 'England': 'United Kingdom', 'Scotland': 'United Kingdom',
    'The Netherlands': 'Netherlands', 'Aruba': 'Netherlands', 'UAE': 'United Arab Emirates',
    'Christmas Island': 'Australia', 'Norfolk Island': 'Australia',
};
const countryKey = name => COUNTRY_ALIASES[name] || String(name || '').replace(/ \(Mainland\)$/, '');

const WONDER_LISTS = ['sevenWonders', 'sevenNaturalWonders', 'wonderNominees'];

function buildCountryRows(tableType) {
    const entries = tableType === 'world'
        ? Object.keys(continentMap).flatMap(k => worldData[continentMap[k]].map(c => [k, c]))
        : worldData[continentMap[tableType]].map(c => [tableType, c]);
    const rows = new Map();
    entries.forEach(([continent, country]) => rows.set(country.name, {
        country, continent, name: country.name, population: country.population, visited: Boolean(country.visited),
        capital: null, capVisited: false, highpoints: [], hpDone: 0,
        citiesVisited: 0, citiesTotal: 0, wondersVisited: 0, wondersTotal: 0, wonderNames: [],
        regions: null, regionPct: null,
    }));
    const rowFor = name => rows.get(countryKey(name));
    if (worldCapitals) worldCapitals.capitals.forEach(c => {
        const r = rowFor(c.country);
        if (r) { r.capital = c; r.capVisited = Boolean(c.visited); }
    });
    if (countryHighpoints) countryHighpoints.data.forEach(p => {
        const r = rowFor(p.country);
        if (!r) return;
        r.highpoints.push(p);
        if (p.climbed) r.hpDone++;
    });
    if (bucketLists) {
        bucketLists.lists.forbes100.rows.forEach(c => {
            const r = rowFor(c.country);
            if (!r) return;
            r.citiesTotal++;
            if (c.visited) r.citiesVisited++;
        });
        WONDER_LISTS.forEach(id => bucketLists.lists[id].rows.forEach(w => {
            const r = rowFor(w.country);
            if (!r) return;
            r.wondersTotal++;
            if (w.visited) r.wondersVisited++;
            r.wonderNames.push(`${w.name}: ${w.visited ? 'visited' : 'not yet'}`);
        }));
    }
    return [...rows.values()].map(r => {
        const total = 1 + (r.capital ? 1 : 0) + r.citiesTotal + r.wondersTotal + r.highpoints.length;
        const done = (r.visited ? 1 : 0) + (r.capVisited ? 1 : 0) + r.citiesVisited + r.wondersVisited + r.hpDone;
        r.done = done;
        r.total = total;
        r.progress = Math.round((done / total) * 100);
        r.hpSort = r.highpoints.length ? r.hpDone / r.highpoints.length : -1;
        const reg = regionProgress && regionProgress.byCountry[r.name];
        if (reg) {
            r.regions = reg;
            r.regionPct = Math.round((reg.done / reg.total) * 100);
        }
        return r;
    });
}

// A bar with its percentage inside, or a dash when there's no number yet.
function progressBar(pct, title, empty = '—') {
    if (pct == null) return `<span class="state-progress-none" title="${escapeAttr(title)}">${empty}</span>`;
    return `<span class="state-progress" title="${escapeAttr(title)}">
                <span class="state-progress-fill" style="width:${pct}%"></span>
                <span class="state-progress-pct">${pct}%</span>
            </span>`;
}

function escapeAttr(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function withCountryFlag(name, label = name) {
    const flag = countryFlags[name];
    return flag
        ? `<span class="flag-name"><img class="flag" src="images/flags/${flag}.png" alt="" width="21" height="14" loading="lazy"><span>${escapeAttr(label)}</span></span>`
        : escapeAttr(label);
}

// The Core bar's tooltip: each part of the score, done vs total.
function coreBreakdown(r) {
    const lines = [`Core: ${r.progress}% (${r.done} of ${r.total})`, `Country visited: ${r.visited ? 'yes' : 'no'}`];
    if (r.capital) lines.push(`Capital (${r.capital.name}): ${r.capVisited ? 'visited' : 'not yet'}`);
    lines.push(`Forbes 100 cities: ${r.citiesTotal ? `${r.citiesVisited}/${r.citiesTotal}` : 'none'}`);
    if (r.wondersTotal) lines.push(`Wonders: ${r.wondersVisited}/${r.wondersTotal}`, ...r.wonderNames.map(n => `  ${n}`));
    else lines.push('Wonders: none');
    r.highpoints.forEach(p => lines.push(`${p.mainland ? 'Mainland high point' : 'High point'} (${p.name}): ${p.climbed ? 'summited' : 'not yet'}`));
    return lines.join('\n');
}

function regionsTitle(r) {
    if (r.regions) {
        const lines = [`${r.regions.done} of ${r.regions.total} states / provinces reached (pins and Strava routes)`];
        if (r.regions.missing.length && r.regions.missing.length <= 20) lines.push(`Not yet: ${r.regions.missing.join(', ')}`);
        return lines.join('\n');
    }
    if (regionsState === 'loading') return 'Working out the regions reached…';
    if (regionsState === 'error') return 'Regions unavailable right now';
    return 'No region data for this country';
}

// "3/5", or a dash for a country with none on the list.
function fraction(done, total) {
    return total ? `${done}/${total}` : '—';
}

function setupEditMode() {
    const btn = document.getElementById('edit-mode-btn');
    // Edit Mode / Export CSV are owner-only; visitors just see the lock.
    refreshOwnerUI = TravelAdmin.initControls(
        document.getElementById('owner-login-btn'),
        loggedIn => { if (!loggedIn && editMode) setEditMode(false); }
    );
    btn.addEventListener('click', () => setEditMode(!editMode));
}

function setEditMode(on) {
    const btn = document.getElementById('edit-mode-btn');
    editMode = on;
    btn.classList.toggle('active', on);
    btn.textContent = on ? 'Exit Edit Mode' : 'Edit Mode';
    updateTable(currentTable());
}

function setupCsvExport() {
    document.getElementById('export-csv-btn').addEventListener('click', () => {
        const type = currentTable();
        const { col, dir } = sortState[type];
        if (isBucketList(type)) {
            if (!bucketLists) return;
            const rows = sortBucketRows(bucketLists.lists[type].rows, col, dir);
            const withRank = type === 'forbes100';
            const headers = (withRank ? ['Rank'] : []).concat(['Name', 'Country', 'Status']);
            downloadCsv(headers, rows.map(r => (withRank ? [r.rank] : []).concat(
                [r.name, r.country, r.visited ? 'Visited' : 'Not Visited'])),
                type.replace(/([A-Z0-9]+)/g, '-$1').toLowerCase() + '.csv');
            return;
        }
        if (type === 'capitals') {
            if (!worldCapitals) return;
            const rows = sortTableData(worldCapitals.capitals, col, dir);
            downloadCsv(['Capital', 'Country', 'Status', 'Strava Passes Nearby'], rows.map(c => [
                c.name, c.country, c.visited ? 'Visited' : 'Not Visited', capitalHint(c) ? 'Yes' : '',
            ]), 'world-capitals.csv');
            return;
        }
        const rows = sortTableData(buildCountryRows(type), col, dir);
        const headers = ['Country', 'Continent', 'Core %', 'Core Done', 'Core Total', 'Regions Reached', 'Regions Total',
            'Capital', 'Capital Status', 'Forbes Cities Visited', 'Forbes Cities Total', 'Wonders Visited', 'Wonders Total',
            'High Point', 'High Point Status', 'Population', 'Status'];
        downloadCsv(headers, rows.map(r => [
            r.name, CONTINENT_LABELS[r.continent], r.progress, r.done, r.total,
            r.regions ? r.regions.done : '', r.regions ? r.regions.total : '',
            r.capital ? r.capital.name : '', r.capital ? (r.capVisited ? 'Visited' : 'Not Visited') : '',
            r.citiesVisited, r.citiesTotal, r.wondersVisited, r.wondersTotal,
            r.highpoints.map(p => p.name).join(' / '), r.highpoints.map(p => (p.climbed ? 'Summited' : 'Not Yet')).join(' / '),
            r.population, r.visited ? 'Visited' : 'Not Visited',
        ]), type === 'world' ? 'countries.csv'
            : type.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '') + '-countries.csv');
    });
}

function downloadCsv(headers, rows, filename) {
    const escape = val => {
        const str = String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n')
            ? '"' + str.replace(/"/g, '""') + '"' : str;
    };
    const csv = [headers.map(escape).join(',')]
        .concat(rows.map(row => row.map(escape).join(',')))
        .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
}

// Edits save the whole list (TravelAPI.saveList explains why): the stored
// list as loaded, with the page's visited flags. Not worldData itself, whose
// populations the REST Countries API may have replaced on screen.
function countriesToSave() {
    const data = JSON.parse(JSON.stringify(storedCountries));
    Object.values(continentMap).forEach(key => {
        const visited = new Map((worldData[key] || []).map(c => [c.name, c.visited]));
        (data[key] || []).forEach(c => { if (visited.has(c.name)) c.visited = visited.get(c.name); });
    });
    return data;
}

// Flip a flag at once, save the list it belongs to, and undo the flip if the
// save fails.
function toggleAndSave(item, field, type, getData) {
    const password = TravelAdmin.getPassword();
    if (!password) return null;
    const flip = () => {
        item[field] = !item[field];
        displayWorldTravelSummary();
        displayBucketSummary();
        worldMapStale = true;
        updateTable(currentTable());
    };
    flip();
    const saved = TravelAPI.saveList(type, getData, password);
    saved.catch(err => {
        flip();
        alert('Save failed: ' + err.message);
        if (err.message.includes('Invalid password')) {
            TravelAdmin.logout();
            refreshOwnerUI();
            setEditMode(false);
        }
    });
    return saved;
}

function handleToggle(country) {
    toggleAndSave(country, 'visited', 'countries', countriesToSave);
}

// Capitals: the whole list, names from the file and the page's flags. A list
// the worker never answered for isn't saved, so it can't overwrite edits the
// page never loaded.
function handleCapitalToggle(capital) {
    if (!worldCapitals.stored) {
        alert('Cloudflare is unreachable — reload and try again');
        return;
    }
    toggleAndSave(capital, 'visited', 'worldCapitals', () => worldCapitals.capitals);
}

// Country high points are the Peaks dashboard's list; an unseeded one is
// seeded by its first edit, as there.
function handleHighpointToggle(peak) {
    const list = countryHighpoints;
    if (list.source !== 'cloudflare' && list.reason !== 'unseeded') {
        alert('Cloudflare is unreachable — reload and try again');
        return;
    }
    const saved = toggleAndSave(peak, 'climbed', 'countryHighpoints', () => list.data);
    if (saved) saved.then(() => { list.source = 'cloudflare'; delete list.reason; }).catch(() => {});
}

function capitalHint(capital) {
    return !capital.visited && Boolean(regionProgress) && regionProgress.capitalHints.has(capital.country);
}

// Done / total parts across a set of countries, as a whole-number percent.
function corePercent(rows) {
    const done = rows.reduce((n, r) => n + r.done, 0);
    const total = rows.reduce((n, r) => n + r.total, 0);
    return total ? Math.round((done / total) * 100) : 0;
}

function displayWorldTravelSummary() {
    const summaryContainer = document.getElementById('travel-summary');
    const tableSelector = document.getElementById('table-selector');

    const all = allCountries();
    const totalVisited = all.filter(c => c.visited).length;
    const allRows = buildCountryRows('world');
    const capitals = worldCapitals ? worldCapitals.capitals : null;
    const capitalsDone = capitals ? capitals.filter(c => c.visited).length : 0;
    const pct = (n, d) => (d ? ((n / d) * 100).toFixed(0) : 0);

    // Each card: countries visited, and a thin bar of the continent's Core
    // (every part of every country in it, done vs total).
    const cards = Object.keys(continentMap).map(type => {
        const list = worldData[continentMap[type]];
        const done = list.filter(c => c.visited).length;
        const core = corePercent(allRows.filter(r => r.continent === type));
        return `
                <button type="button" class="summary-stat bucket-card" data-list="${type}" title="Show the ${CONTINENT_LABELS[type]} Countries table">
                    <div class="stat-number-container">
                        <span class="stat-number">${done}</span>
                        <span class="stat-total">/${list.length}</span>
                        <span class="stat-percentage">(${pct(done, list.length)}%)</span>
                    </div>
                    <span class="stat-label">${CONTINENT_LABELS[type]} Countries</span>
                    ${coreMeter(core)}
                </button>`;
    }).join('');

    summaryContainer.innerHTML = `
        <div class="summary-stats-container">
            <div class="world-headline">
                <button type="button" class="summary-stat world-summary bucket-card" data-list="world" title="Show every country">
                    <div class="stat-number-container">
                        <span class="stat-number">${totalVisited}</span>
                        <span class="stat-total">/${all.length}</span>
                        <span class="stat-percentage">(${pct(totalVisited, all.length)}%)</span>
                    </div>
                    <span class="stat-label">Countries Visited</span>
                    ${coreMeter(corePercent(allRows))}
                </button>
                <button type="button" class="summary-stat world-summary bucket-card" data-list="capitals" title="Show the World Capitals table">
                    <div class="stat-number-container">
                        <span class="stat-number">${capitals ? capitalsDone : '…'}</span>
                        <span class="stat-total">/${capitals ? capitals.length : all.length}</span>
                        ${capitals ? `<span class="stat-percentage">(${pct(capitalsDone, capitals.length)}%)</span>` : ''}
                    </div>
                    <span class="stat-label">Capitals Visited</span>
                </button>
            </div>
            <div class="other-stats">${cards}</div>
        </div>
    `;

    bindTableCards(summaryContainer);

    if (!tableSelector.dataset.bound) {
        tableSelector.dataset.bound = 'true';
        tableSelector.addEventListener('change', function () {
            updateTable(this.value);
        });
    }
}

// A thin Core bar for a summary card.
function coreMeter(pct) {
    return `<span class="core-meter" title="Core: every country's visit, capital, Forbes cities, wonders and high points, done vs total">
                <span class="core-meter-bar"><span class="core-meter-fill" style="width:${pct}%"></span></span>
                <span class="core-meter-label">Core ${pct}%</span>
            </span>`;
}

function sortTableData(data, col, dir) {
    return [...data].sort((a, b) => {
        let aVal = a[col];
        let bVal = b[col];
        // No number yet (regions still loading) sorts below every number.
        if (aVal == null) aVal = -1;
        if (bVal == null) bVal = -1;

        if (typeof aVal === 'boolean') {
            aVal = aVal ? 1 : 0;
            bVal = bVal ? 1 : 0;
        }

        let primary;
        if (typeof aVal === 'string') {
            const cmp = aVal.localeCompare(bVal);
            primary = dir === 'asc' ? cmp : -cmp;
        } else {
            primary = dir === 'asc' ? aVal - bVal : bVal - aVal;
        }

        if (primary === 0 && col !== 'population' && a.population != null) {
            return b.population - a.population;
        }
        if (primary === 0 && a.name && b.name) return a.name.localeCompare(b.name);

        return primary;
    });
}

// Continent and list cards: a tap picks that table and scrolls to it.
function bindTableCards(container) {
    container.querySelectorAll('.bucket-card').forEach(card => card.addEventListener('click', () => {
        const selector = document.getElementById('table-selector');
        selector.value = card.dataset.list;
        if (worldData) updateTable(card.dataset.list);
        if (document.getElementById('tables-view').hidden) {
            document.querySelector('.view-switch-option[data-view="tables"]').click();
        }
        document.getElementById('tables-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
}

// Bucket list progress cards, under the continents.
function displayBucketSummary() {
    const container = document.getElementById('bucket-summary');
    if (!container || !bucketLists) return;
    const cards = BUCKET_LISTS.map(l => {
        const rows = bucketLists.lists[l.id].rows;
        const done = rows.filter(r => r.visited).length;
        const complete = done === rows.length;
        return `
            <button type="button" class="summary-stat bucket-card${complete ? ' completed-quest' : ''}" data-list="${l.id}" title="Show the ${l.label} table">
                <div class="stat-number-container">
                    <span class="stat-number">${done}</span>
                    <span class="stat-total">/${rows.length}</span>
                    <span class="stat-percentage">(${((done / rows.length) * 100).toFixed(0)}%)</span>
                    ${complete ? '<span class="completion-check">✅</span>' : ''}
                </div>
                <span class="stat-label">${l.label}</span>
            </button>`;
    }).join('');
    container.innerHTML = `
        <h3 class="bucket-summary-title">Bucket Lists</h3>
        <div class="summary-stats-container">
            <div class="other-stats other-stats-quad">${cards}</div>
        </div>`;
    bindTableCards(container);
}

function sortBucketRows(rows, col, dir) {
    return [...rows].sort((a, b) => {
        let aVal = a[col], bVal = b[col];
        if (typeof aVal === 'boolean') { aVal = aVal ? 1 : 0; bVal = bVal ? 1 : 0; }
        const primary = typeof aVal === 'string'
            ? aVal.localeCompare(bVal) * (dir === 'asc' ? 1 : -1)
            : (dir === 'asc' ? aVal - bVal : bVal - aVal);
        return primary || a.name.localeCompare(b.name);
    });
}

// Keys whose first click sorts high-to-low.
const DESC_FIRST = new Set(['visited', 'population', 'progress', 'regionPct', 'citiesVisited', 'wondersVisited', 'hpSort', 'capVisited']);

// A sortable header row. columns: [{ label | [long, short], key, cls, title }].
function sortableHeader(table, tableType, columns) {
    const { col, dir } = sortState[tableType];
    const headerRow = document.createElement('tr');
    columns.forEach(c => {
        const th = document.createElement('th');
        const isActive = col === c.key;
        th.classList.add('sortable', ...c.cls.split(' ').filter(Boolean));
        if (isActive) th.classList.add('sort-active');
        if (Array.isArray(c.label)) {
            th.title = c.title || c.label[0];
            th.insertAdjacentHTML('beforeend', `<span class="th-long">${c.label[0]}</span><span class="th-short">${c.label[1]}</span>`);
        } else {
            if (c.title) th.title = c.title;
            th.appendChild(document.createTextNode(c.label));
        }
        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';
        th.appendChild(indicator);
        th.addEventListener('click', () => {
            sortState[tableType] = isActive
                ? { col, dir: dir === 'asc' ? 'desc' : 'asc' }
                : { col: c.key, dir: DESC_FIRST.has(c.key) ? 'desc' : 'asc' };
            updateTable(tableType);
        });
        headerRow.appendChild(th);
    });
    const thead = document.createElement('thead');
    thead.appendChild(headerRow);
    table.appendChild(thead);
}

function updateTable(tableType) {
    const tableContainer = document.getElementById('travel-table-container');
    tableContainer.innerHTML = '';
    if (isBucketList(tableType)) {
        updateBucketTable(tableType, tableContainer);
        return;
    }
    if (tableType === 'capitals') {
        updateCapitalsTable(tableContainer);
        return;
    }

    const table = document.createElement('table');
    table.className = 'travel-table travel-table--fit';
    // [full, phone] labels keep the row on a phone screen, where the Cities
    // and Wonders columns (col-detail) are hidden; Core still counts them.
    // Population only breaks ties in the sort (and is in the CSV).
    sortableHeader(table, tableType, [
        { label: 'Country', key: 'name', cls: 'col-name' },
        { label: 'Core', key: 'progress', cls: 'col-progress', title: 'The country, its capital, Forbes 100 cities, wonders and high point' },
        { label: 'Regions', key: 'regionPct', cls: 'col-progress', title: 'States / provinces reached by a pin or a Strava route (as on the map\'s Subregions view)' },
        { label: 'Cities', key: 'citiesVisited', cls: 'col-num col-detail', title: 'Forbes 100 cities' },
        { label: 'Wonders', key: 'wondersVisited', cls: 'col-num col-detail', title: 'Seven Wonders, Seven Natural Wonders and nominees' },
        { label: ['High Point', 'HP'], key: 'hpSort', cls: 'col-status' },
        { label: ['Capital', 'Cap'], key: 'capVisited', cls: 'col-status' },
        { label: ['Status', '✓'], key: 'visited', cls: 'col-status' },
    ]);

    const { col, dir } = sortState[tableType];
    const rows = sortTableData(buildCountryRows(tableType), col, dir);
    const toggleCls = on => (on && editMode ? ' status-toggle' : '');
    const tbody = document.createElement('tbody');
    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.className = r.visited ? 'visited' : 'not-visited';
        const hps = r.highpoints.length
            ? r.highpoints.map((p, i) => `<span class="hp-icon${toggleCls(true)}" data-hp="${i}" title="${escapeAttr(`${p.mainland ? 'Mainland high point: ' : ''}${p.name} (${(p.elevationM || 0).toLocaleString()} m)`)}">${p.climbed ? '✅' : '⬜'}</span>`).join('')
            : '—';
        const cap = r.capital;
        const regionsPending = !r.regions && regionsState === 'loading';
        tr.innerHTML = `
            <td class="col-name">${withCountryFlag(r.name)}</td>
            <td class="col-progress">${progressBar(r.progress, coreBreakdown(r))}</td>
            <td class="col-progress">${progressBar(r.regionPct, regionsTitle(r), regionsPending ? '…' : '—')}</td>
            <td class="col-num col-detail">${fraction(r.citiesVisited, r.citiesTotal)}</td>
            <td class="col-num col-detail">${fraction(r.wondersVisited, r.wondersTotal)}</td>
            <td class="col-status">${hps}</td>
            <td class="col-status${toggleCls(Boolean(cap))}" data-toggle="cap" title="${escapeAttr(cap ? cap.name : '')}">${cap ? (r.capVisited ? '✅' : '⬜') : '—'}</td>
            <td class="col-status${toggleCls(true)}" data-toggle="country">${r.visited ? '✅' : '⬜'}</td>
        `;
        if (editMode) {
            // The country, its capital and its high point(s) all toggle from the row.
            tr.querySelector('[data-toggle="country"]').addEventListener('click', () => handleToggle(r.country));
            if (cap) tr.querySelector('[data-toggle="cap"]').addEventListener('click', () => handleCapitalToggle(cap));
            tr.querySelectorAll('[data-hp]').forEach(el => el.addEventListener('click', () => handleHighpointToggle(r.highpoints[+el.dataset.hp])));
        }
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    appendScrollableTable(tableContainer, table);
}

// World capitals, one per country. A capital not checked off with a Strava
// route passing near it gets a "check Strava" hint (only a hint; the owner
// decides).
function updateCapitalsTable(tableContainer) {
    if (!worldCapitals) {
        tableContainer.innerHTML = '<p class="map-description">Loading…</p>';
        return;
    }
    const table = document.createElement('table');
    table.className = 'travel-table travel-table--fit';
    sortableHeader(table, 'capitals', [
        { label: 'Capital', key: 'name', cls: 'col-name' },
        { label: 'Country', key: 'country', cls: 'col-name' },
        { label: ['Status', '✓'], key: 'visited', cls: 'col-status' },
    ]);
    const { col, dir } = sortState.capitals;
    const tbody = document.createElement('tbody');
    sortTableData(worldCapitals.capitals, col, dir).forEach(c => {
        const tr = document.createElement('tr');
        tr.className = c.visited ? 'visited' : 'not-visited';
        const hint = capitalHint(c)
            ? ` <span class="strava-hint" title="A Strava route passes near ${escapeAttr(c.name)}: check whether you were there">check Strava</span>`
            : '';
        tr.innerHTML = `
            <td class="col-name">${escapeAttr(c.name)}${hint}</td>
            <td>${withCountryFlag(c.country)}</td>
            <td class="col-status${editMode ? ' status-toggle' : ''}">${c.visited ? '✅' : '⬜'}</td>
        `;
        if (editMode) tr.querySelector('.col-status').addEventListener('click', () => handleCapitalToggle(c));
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    appendScrollableTable(tableContainer, table);
}

// A bucket list's table. Its visited flags live in data files (or follow the
// US metros), so Edit Mode has nothing to toggle here.
function updateBucketTable(listId, tableContainer) {
    if (!bucketLists) {
        tableContainer.innerHTML = '<p class="map-description">Loading…</p>';
        return;
    }
    const withRank = listId === 'forbes100';
    const columns = (withRank ? [{ label: '#', key: 'rank', cls: 'col-num' }] : []).concat([
        { label: listId === 'forbes100' ? 'City' : 'Name', key: 'name', cls: 'col-name' },
        { label: 'Country', key: 'country', cls: 'col-name' },
        { label: 'Status', key: 'visited', cls: 'col-status' },
    ]);
    const { col, dir } = sortState[listId];
    const rows = sortBucketRows(bucketLists.lists[listId].rows, col, dir);

    const table = document.createElement('table');
    table.className = 'travel-table travel-table--fit';
    const headerRow = document.createElement('tr');
    columns.forEach(c => {
        const th = document.createElement('th');
        const isActive = col === c.key;
        th.classList.add('sortable', c.cls);
        if (isActive) th.classList.add('sort-active');
        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';
        th.append(document.createTextNode(c.label), indicator);
        th.addEventListener('click', () => {
            sortState[listId] = col === c.key
                ? { col, dir: dir === 'asc' ? 'desc' : 'asc' }
                : { col: c.key, dir: c.key === 'visited' ? 'desc' : 'asc' };
            updateTable(listId);
        });
        headerRow.appendChild(th);
    });
    const thead = document.createElement('thead');
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach(r => {
        const tr = document.createElement('tr');
        tr.className = r.visited ? 'visited' : 'not-visited';
        const cells = (withRank ? [[r.rank, 'col-num']] : []).concat([
            [r.note ? `${r.name} (${r.note})` : r.name, 'col-name'],
            [r.country, 'col-name'],
            [r.visited ? '✅' : '⬜', 'col-status'],
        ]);
        cells.forEach(([text, cls]) => {
            const td = document.createElement('td');
            td.className = cls;
            td.textContent = text;
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    appendScrollableTable(tableContainer, table);
}

function appendScrollableTable(tableContainer, table) {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll-wrapper';
    wrapper.appendChild(table);
    tableContainer.appendChild(wrapper);

    function checkScroll() {
        const hasScroll = wrapper.scrollWidth > wrapper.clientWidth + 1;
        wrapper.classList.toggle('has-scroll', hasScroll);
        const atEnd = wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 1;
        wrapper.classList.toggle('scrolled-end', atEnd);
    }
    wrapper.addEventListener('scroll', checkScroll);
    checkScroll();
}

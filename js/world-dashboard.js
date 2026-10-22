let worldData;
let editMode = false;
let refreshOwnerUI = () => {};

const sortState = {
    northAmerica: { col: 'population', dir: 'desc' },
    southAmerica: { col: 'population', dir: 'desc' },
    europe:       { col: 'population', dir: 'desc' },
    asia:         { col: 'population', dir: 'desc' },
    africa:       { col: 'population', dir: 'desc' },
    oceania:      { col: 'population', dir: 'desc' },
    // Bucket lists (js/bucket-lists.js)
    forbes100:           { col: 'rank', dir: 'asc' },
    sevenWonders:        { col: 'name', dir: 'asc' },
    sevenNaturalWonders: { col: 'name', dir: 'asc' },
    wonderNominees:      { col: 'name', dir: 'asc' }
};

// Forbes 100 / Seven Wonders lists, once loaded (js/bucket-lists.js).
let bucketLists = null;
let storedCountries = null;
// Country name → flag image code (data/country-flags.json, built with the
// images by scripts/build-flags.mjs). Rows render without flags until loaded.
let countryFlags = {}; // countries as loaded, before live populations
const isBucketList = type => BUCKET_LISTS.some(l => l.id === type);

const continentMap = {
    northAmerica: 'northAmericanCountries',
    southAmerica: 'southAmericanCountries',
    europe:       'europeanCountries',
    asia:         'asianCountries',
    africa:       'africanCountries',
    oceania:      'oceaniaCountries'
};

document.addEventListener('DOMContentLoaded', function () {
    const dataReady = loadCountriesWithPopulation(null, function (updatedData) {
        worldData = updatedData;
        displayWorldTravelSummary();
        renderPopulationSourceBadge();
        updateTable(document.getElementById('table-selector').value);
    })
        .then(data => {
            worldData = data;
            storedCountries = JSON.parse(JSON.stringify(data));
            displayWorldTravelSummary();
            renderPopulationSourceBadge();
            updateTable('northAmerica');
            setupEditMode();
            setupCsvExport();
        });
    dataReady.catch(error => console.error('Error loading the JSON file:', error));
    Promise.all([dataReady, fetch('data/country-flags.json').then(r => r.json())])
        .then(([, flags]) => {
            countryFlags = flags;
            const type = document.getElementById('table-selector').value;
            if (!isBucketList(type)) updateTable(type);
        })
        .catch(err => console.warn('Flags unavailable:', err));
    loadBucketLists()
        .then(b => {
            bucketLists = b;
            displayBucketSummary();
            const selected = document.getElementById('table-selector').value;
            if (isBucketList(selected) && worldData) updateTable(selected);
        })
        .catch(error => console.error('Error loading the bucket lists:', error));
    setupWorldViewSwitch(dataReady);
});

// Map view (js/view-switch.js). Leaflet, its plugins and js/world-map.js load
// the first time the map is shown, so the Tables view never downloads them.
const WORLD_MAP_SCRIPTS = [
    'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    'js/fluid-zoom.js?v=20261022',
    'js/map-fixes.js?v=20261022',
    'https://unpkg.com/leaflet-gesture-handling@1.2.2/dist/leaflet-gesture-handling.min.js',
    'https://unpkg.com/leaflet.fullscreen@5.3.3/dist/Control.FullScreen.umd.js',
    'js/map-controls.js?v=20261022',
    'js/world-map.js?v=20261022b'
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
    updateTable(document.getElementById('table-selector').value);
}

function setupCsvExport() {
    document.getElementById('export-csv-btn').addEventListener('click', () => {
        const continentType = document.getElementById('table-selector').value;
        const { col, dir } = sortState[continentType];
        if (isBucketList(continentType)) {
            if (!bucketLists) return;
            const rows = sortBucketRows(bucketLists.lists[continentType].rows, col, dir);
            const withRank = continentType === 'forbes100';
            const headers = (withRank ? ['Rank'] : []).concat(['Name', 'Country', 'Status']);
            downloadCsv(headers, rows.map(r => (withRank ? [r.rank] : []).concat(
                [r.name, r.country, r.visited ? 'Visited' : 'Not Visited'])),
                continentType.replace(/([A-Z0-9]+)/g, '-$1').toLowerCase() + '.csv');
            return;
        }
        const rawData = worldData[continentMap[continentType]];
        const sorted = sortTableData(rawData, col, dir);

        const headers = ['Country', 'Population', 'Status'];
        const rows = sorted.map(c => [
            c.name, c.population, c.visited ? 'Visited' : 'Not Visited'
        ]);

        const filename = continentType.replace(/([A-Z])/g, '-$1').toLowerCase().replace(/^-/, '') + '-countries.csv';
        downloadCsv(headers, rows, filename);
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

function handleToggle(continentType, country) {
    const password = TravelAdmin.getPassword();
    if (!password) return;

    const flip = () => {
        country.visited = !country.visited;
        displayWorldTravelSummary();
        worldMapStale = true;
        updateTable(document.getElementById('table-selector').value);
    };

    // Show the change at once; undo it if the save fails.
    flip();
    TravelAPI.saveList('countries', countriesToSave, password)
        .catch(err => {
            flip();
            alert('Save failed: ' + err.message);
            if (err.message.includes('Invalid password')) {
                TravelAdmin.logout();
                refreshOwnerUI();
                setEditMode(false);
            }
        });
}

function displayWorldTravelSummary() {
    const summaryContainer = document.getElementById('travel-summary');
    const tableSelector = document.getElementById('table-selector');

    const northAmericaCount = worldData.northAmericanCountries.filter(country => country.visited).length;
    const northAmericaPercentage = ((northAmericaCount / worldData.northAmericanCountries.length) * 100).toFixed(0);

    const southAmericaCount = worldData.southAmericanCountries.filter(country => country.visited).length;
    const southAmericaPercentage = ((southAmericaCount / worldData.southAmericanCountries.length) * 100).toFixed(0);

    const europeCount = worldData.europeanCountries.filter(country => country.visited).length;
    const europePercentage = ((europeCount / worldData.europeanCountries.length) * 100).toFixed(0);

    const asiaCount = worldData.asianCountries.filter(country => country.visited).length;
    const asiaPercentage = ((asiaCount / worldData.asianCountries.length) * 100).toFixed(0);

    const africaCount = worldData.africanCountries.filter(country => country.visited).length;
    const africaPercentage = ((africaCount / worldData.africanCountries.length) * 100).toFixed(0);

    const oceaniaCount = worldData.oceaniaCountries.filter(country => country.visited).length;
    const oceaniaPercentage = ((oceaniaCount / worldData.oceaniaCountries.length) * 100).toFixed(0);

    const totalCountries = worldData.northAmericanCountries.length +
        worldData.southAmericanCountries.length +
        worldData.europeanCountries.length +
        worldData.asianCountries.length +
        worldData.africanCountries.length +
        worldData.oceaniaCountries.length;

    const totalVisited = northAmericaCount + southAmericaCount + europeCount +
        asiaCount + africaCount + oceaniaCount;

    const totalPercentage = ((totalVisited / totalCountries) * 100).toFixed(0);

    summaryContainer.innerHTML = `
        <div class="summary-stats-container">
            <div class="summary-stat world-summary">
                <div class="stat-number-container">
                    <span class="stat-number">${totalVisited}</span>
                    <span class="stat-total">/${totalCountries}</span>
                    <span class="stat-percentage">(${totalPercentage}%)</span>
                </div>
                <span class="stat-label">Countries Visited</span>
            </div>
            <div class="other-stats">
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${northAmericaCount}</span>
                        <span class="stat-total">/${worldData.northAmericanCountries.length}</span>
                        <span class="stat-percentage">(${northAmericaPercentage}%)</span>
                    </div>
                    <span class="stat-label">North American Countries</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${southAmericaCount}</span>
                        <span class="stat-total">/${worldData.southAmericanCountries.length}</span>
                        <span class="stat-percentage">(${southAmericaPercentage}%)</span>
                    </div>
                    <span class="stat-label">South American Countries</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${europeCount}</span>
                        <span class="stat-total">/${worldData.europeanCountries.length}</span>
                        <span class="stat-percentage">(${europePercentage}%)</span>
                    </div>
                    <span class="stat-label">European Countries</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${asiaCount}</span>
                        <span class="stat-total">/${worldData.asianCountries.length}</span>
                        <span class="stat-percentage">(${asiaPercentage}%)</span>
                    </div>
                    <span class="stat-label">Asian Countries</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${africaCount}</span>
                        <span class="stat-total">/${worldData.africanCountries.length}</span>
                        <span class="stat-percentage">(${africaPercentage}%)</span>
                    </div>
                    <span class="stat-label">African Countries</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${oceaniaCount}</span>
                        <span class="stat-total">/${worldData.oceaniaCountries.length}</span>
                        <span class="stat-percentage">(${oceaniaPercentage}%)</span>
                    </div>
                    <span class="stat-label">Oceania Countries</span>
                </div>
            </div>
        </div>
    `;

    if (!tableSelector.dataset.bound) {
        tableSelector.dataset.bound = 'true';
        tableSelector.addEventListener('change', function () {
            updateTable(this.value);
        });
    }
}

function sortTableData(data, col, dir) {
    return [...data].sort((a, b) => {
        let aVal = a[col];
        let bVal = b[col];

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

        if (primary === 0 && col !== 'population') {
            return b.population - a.population;
        }

        return primary;
    });
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

function updateTable(continentType) {
    const tableContainer = document.getElementById('travel-table-container');
    tableContainer.innerHTML = '';
    if (isBucketList(continentType)) {
        updateBucketTable(continentType, tableContainer);
        return;
    }

    const table = document.createElement('table');
    table.className = 'travel-table travel-table--fit';

    const tableHeaders = ['Country', 'Population', 'Status'];
    const sortKeys     = ['name', 'population', 'visited'];
    const colClasses   = ['col-name', 'col-num', 'col-status'];

    const rawData = worldData[continentMap[continentType]];
    const { col, dir } = sortState[continentType];
    const tableData = sortTableData(rawData, col, dir);

    // Create sortable table header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    tableHeaders.forEach((header, i) => {
        const th = document.createElement('th');
        const key = sortKeys[i];
        const isActive = col === key;

        th.classList.add('sortable', colClasses[i]);
        if (isActive) th.classList.add('sort-active');

        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';

        th.appendChild(document.createTextNode(header));
        th.appendChild(indicator);

        th.addEventListener('click', () => {
            const state = sortState[continentType];
            if (state.col === key) {
                sortState[continentType].dir = state.dir === 'asc' ? 'desc' : 'asc';
            } else {
                const defaultDir = (key === 'visited' || key === 'population') ? 'desc' : 'asc';
                sortState[continentType] = { col: key, dir: defaultDir };
            }
            updateTable(continentType);
        });

        headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement('tbody');
    tableData.forEach(country => {
        const row = document.createElement('tr');
        row.className = country.visited ? 'visited' : 'not-visited';

        const statusIcon = country.visited ? '✅' : '⬜';
        const statusClass = editMode ? 'status-toggle' : '';

        const flag = countryFlags[country.name];
        row.innerHTML = `
            <td class="col-name">${flag ? `<span class="flag-name"><img class="flag" src="images/flags/${flag}.png" alt="" width="21" height="14" loading="lazy"><span>${country.name}</span></span>` : country.name}</td>
            <td class="col-num">${country.population.toLocaleString()}</td>
            <td class="col-status ${statusClass}">${statusIcon}</td>
        `;

        if (editMode) {
            const statusCell = row.querySelector('.status-toggle');
            statusCell.addEventListener('click', () => handleToggle(continentType, country));
        }

        tbody.appendChild(row);
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

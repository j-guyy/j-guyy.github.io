let metros, highPoints, nationalParks, visitedStates, capitals;
// County Hunter's visited county FIPS codes (strava.html); null until loaded
// or if the worker can't be reached, which leaves the Counties column blank.
let visitedCountyFips = null;
let editMode = false;
let refreshOwnerUI = () => {};

const sortState = {
    states:     { col: 'name',      dir: 'asc'  },
    highpoints: { col: 'elevation', dir: 'desc' },
    capitals:   { col: 'stateName', dir: 'asc'  },
    metros:     { col: 'rank',      dir: 'asc'  },
    parks:      { col: 'name',      dir: 'asc'  }
};

document.addEventListener('DOMContentLoaded', function () {
    const dataReady = Promise.all([
        TravelAPI.fetchMetros(),
        TravelAPI.fetchHighPoints(),
        TravelAPI.fetchNationalParks(),
        TravelAPI.fetchVisitedStates(),
        TravelAPI.fetchCapitals()
    ])
        .then(([metrosData, highPointsData, nationalParksData, visitedStatesData, capitalsData]) => {
            metros = metrosData;
            highPoints = highPointsData;
            nationalParks = nationalParksData;
            visitedStates = visitedStatesData;
            capitals = capitalsData;
            // Full state names, so the Capitals table sorts like the States table.
            const names = Object.fromEntries(Object.entries(STATE_ABBRS).map(([n, a]) => [a, n]));
            capitals.forEach(c => { c.stateName = names[c.state] || c.state; });
            displayTravelSummary();
            updateTable(currentTable());
            setupEditMode();
            setupCsvExport();
        });
    dataReady.catch(error => console.error('Error loading the JSON files:', error));
    // Counties load alongside, without holding up the table.
    Promise.all([dataReady, TravelAPI.fetchVisitedCounties()])
        .then(([, fips]) => {
            visitedCountyFips = fips;
            if (currentTable() === 'states' || currentTable() === 'capitals') updateTable(currentTable());
        })
        .catch(err => console.warn('County data unavailable:', err));
    setupUSViewSwitch(dataReady);
});

// Tables | Map switch (js/view-switch.js). The map is only built the first
// time it is shown, and rebuilt after an edit.
let mapStale = true;

function currentTable() {
    return document.getElementById('table-selector').value;
}

// ── States table ────────────────────────────────────────────────────────────
// One row per state, rolled up from the other lists: the state itself, its
// metros (each counted once, in its main city's state, as the Metros table
// lists it, so Boston counts for MA but not NH), its
// national parks, its high point and its capital. Progress is the share of those items done.
const STATE_ABBRS = {
    Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA',
    Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA',
    Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA',
    Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
    Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
    Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
    'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH',
    Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT',
    Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY'
};

// State FIPS code → [abbreviation, county count], the same counties County
// Hunter counts (data/counties-us.json, which keeps Connecticut's 8 counties).
const STATE_COUNTIES = {
    '01': ['AL', 67], '02': ['AK', 29], '04': ['AZ', 15], '05': ['AR', 75], '06': ['CA', 58],
    '08': ['CO', 64], '09': ['CT', 8], '10': ['DE', 3], '12': ['FL', 67], '13': ['GA', 159],
    '15': ['HI', 5], '16': ['ID', 44], '17': ['IL', 102], '18': ['IN', 92], '19': ['IA', 99],
    '20': ['KS', 105], '21': ['KY', 120], '22': ['LA', 64], '23': ['ME', 16], '24': ['MD', 24],
    '25': ['MA', 14], '26': ['MI', 83], '27': ['MN', 87], '28': ['MS', 82], '29': ['MO', 115],
    '30': ['MT', 56], '31': ['NE', 93], '32': ['NV', 17], '33': ['NH', 10], '34': ['NJ', 21],
    '35': ['NM', 33], '36': ['NY', 62], '37': ['NC', 100], '38': ['ND', 53], '39': ['OH', 88],
    '40': ['OK', 77], '41': ['OR', 36], '42': ['PA', 67], '44': ['RI', 5], '45': ['SC', 46],
    '46': ['SD', 66], '47': ['TN', 95], '48': ['TX', 254], '49': ['UT', 29], '50': ['VT', 14],
    '51': ['VA', 133], '53': ['WA', 39], '54': ['WV', 55], '55': ['WI', 72], '56': ['WY', 23]
};

function buildStateRows() {
    const rows = {};
    Object.entries(STATE_ABBRS).forEach(([name, abbr]) => {
        rows[abbr] = {
            name, abbr, visited: Boolean(visitedStates[name]),
            metrosVisited: 0, metrosTotal: 0, parksVisited: 0, parksTotal: 0,
            highPoint: null, hpVisited: false, capital: null, capVisited: false,
            countiesVisited: 0, countiesTotal: 0, countyPct: null
        };
    });
    Object.values(STATE_COUNTIES).forEach(([abbr, total]) => { rows[abbr].countiesTotal = total; });
    if (visitedCountyFips) {
        new Set(visitedCountyFips).forEach(fips => {
            const state = STATE_COUNTIES[String(fips).slice(0, 2)];
            if (state) rows[state[0]].countiesVisited++;
        });
    }
    // Only the top 100 metros, the real goal (ranks 101-200 stay in the
    // Metros table and on the map).
    metros.forEach(m => {
        if (m.rank > 100) return;
        const r = rows[m.state];
        if (!r) return; // DC, Puerto Rico
        r.metrosTotal++;
        if (m.visited) r.metrosVisited++;
    });
    nationalParks.forEach(p => {
        const r = rows[p.state];
        if (!r) return; // American Samoa, Virgin Islands
        r.parksTotal++;
        if (p.visited) r.parksVisited++;
    });
    highPoints.forEach(h => {
        const r = rows[h.state];
        if (!r) return;
        r.highPoint = h;
        r.hpVisited = Boolean(h.visited);
    });
    capitals.forEach(c => {
        const r = rows[c.state];
        if (!r) return;
        r.capital = c;
        r.capVisited = Boolean(c.visited);
    });
    return Object.values(rows).map(r => {
        const total = 1 + r.metrosTotal + r.parksTotal + (r.highPoint ? 1 : 0) + (r.capital ? 1 : 0);
        const done = (r.visited ? 1 : 0) + r.metrosVisited + r.parksVisited + (r.hpVisited ? 1 : 0) + (r.capVisited ? 1 : 0);
        r.progress = Math.round((done / total) * 100);
        if (visitedCountyFips) r.countyPct = Math.round((r.countiesVisited / r.countiesTotal) * 100);
        return r;
    });
}

// A bar with its percentage inside, or a dash when there's no number yet.
function progressBar(pct, title) {
    if (pct == null) return '<span class="state-progress-none">—</span>';
    return `<span class="state-progress" title="${title}">
                <span class="state-progress-fill" style="width:${pct}%"></span>
                <span class="state-progress-pct">${pct}%</span>
            </span>`;
}

// A name with a small flag before it (images/flags/, built by
// scripts/build-flags.mjs). The pair stays together when a long name wraps.
function withFlag(code, name) {
    return `<span class="flag-name"><img class="flag" src="images/flags/${code}.png" alt="" width="21" height="14" loading="lazy"><span>${name}</span></span>`;
}

// The Core bar's tooltip: each part of the score, done vs total.
function coreBreakdown(r) {
    const lines = [`Core: ${r.progress}%`, `State visited: ${r.visited ? 'yes' : 'no'}`];
    lines.push(`Top 100 metros: ${r.metrosTotal ? `${r.metrosVisited}/${r.metrosTotal}` : 'none'}`);
    lines.push(`National parks: ${r.parksTotal ? `${r.parksVisited}/${r.parksTotal}` : 'none'}`);
    if (r.highPoint) lines.push(`High point (${r.highPoint.name}): ${r.hpVisited ? 'summited' : 'not yet'}`);
    if (r.capital) lines.push(`Capital (${r.capital.name}): ${r.capVisited ? 'visited' : 'not yet'}`);
    return lines.join('\n');
}

// "3/5", or a dash for a state with none on the list.
function fraction(done, total) {
    return total ? `${done}/${total}` : '—';
}

// A capital not checked off whose county Strava activities reach (County
// Hunter): maybe visited without being marked. Only a hint; the owner decides.
function stravaHint(capital) {
    return !capital.visited && Boolean(visitedCountyFips) && visitedCountyFips.includes(capital.fips);
}

function setupUSViewSwitch(dataReady) {
    setupViewSwitch({
        titles: { tables: 'US Travel — Justin Guyette', map: 'US Travel Map — Justin Guyette' },
        onShow: view => {
            if (view !== 'map' || !mapStale) return;
            mapStale = false;
            dataReady.then(() => USMap.render()).catch(() => { mapStale = true; });
        }
    });
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
    updateTable(document.getElementById('table-selector').value);
}

function setupCsvExport() {
    document.getElementById('export-csv-btn').addEventListener('click', () => {
        const tableType = document.getElementById('table-selector').value;
        const { col, dir } = sortState[tableType];
        let rows, headers, filename;

        if (tableType === 'states') {
            headers = ['State', 'Abbreviation', 'Status', 'Top 100 Metros Visited', 'Top 100 Metros Total',
                'Parks Visited', 'Parks Total', 'High Point', 'High Point Status', 'Capital', 'Capital Status',
                'Core Progress (%)',
                'Counties Visited', 'Counties Total', 'County Progress (%)'];
            const sorted = sortTableData(buildStateRows(), col, dir, tableType);
            rows = sorted.map(r => [
                r.name, r.abbr, r.visited ? 'Visited' : 'Not Visited',
                r.metrosVisited, r.metrosTotal, r.parksVisited, r.parksTotal,
                r.highPoint ? r.highPoint.name : '', r.hpVisited ? 'Summited' : 'Not Summited',
                r.capital ? r.capital.name : '', r.capVisited ? 'Visited' : 'Not Visited',
                r.progress,
                visitedCountyFips ? r.countiesVisited : '', r.countiesTotal,
                r.countyPct == null ? '' : r.countyPct
            ]);
            filename = 'states.csv';
        } else if (tableType === 'highpoints') {
            headers = ['Rank', 'Peak Name', 'State', 'Elevation (ft)', 'Status'];
            const sorted = sortTableData(highPoints, col, dir, tableType);
            rows = sorted.map((item, i) => [
                i + 1, item.name, item.state, item.elevation, item.visited ? 'Summited' : 'Not Summited'
            ]);
            filename = 'high-points.csv';
        } else if (tableType === 'capitals') {
            headers = ['Capital', 'State', 'County', 'Status', 'Strava Reaches County'];
            const sorted = sortTableData(capitals, col, dir, tableType);
            rows = sorted.map(item => [
                item.name, item.stateName, item.county, item.visited ? 'Visited' : 'Not Visited',
                visitedCountyFips ? (visitedCountyFips.includes(item.fips) ? 'Yes' : 'No') : ''
            ]);
            filename = 'state-capitals.csv';
        } else if (tableType === 'metros') {
            headers = ['Rank', 'Metro Area', 'State', 'Population', 'Status'];
            const sorted = sortTableData(metros, col, dir, tableType);
            rows = sorted.map(item => [
                item.rank, item.metro_name, item.state, item.population, item.visited ? 'Visited' : 'Not Visited'
            ]);
            filename = 'metros.csv';
        } else if (tableType === 'parks') {
            headers = ['National Park', 'State', 'Status'];
            const sorted = sortTableData(nationalParks, col, dir, tableType);
            rows = sorted.map(item => [
                item.name, item.state, item.visited ? 'Visited' : 'Not Visited'
            ]);
            filename = 'national-parks.csv';
        }

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

// Edits save the whole list (TravelAPI.saveList explains why).
const TRAVEL_LISTS = {
    visitedStates: () => visitedStates,
    highpoints: () => highPoints,
    capitals: () => capitals,
    metros: () => metros,
    parks: () => nationalParks
};

function handleToggle(tableType, item) {
    const password = TravelAdmin.getPassword();
    if (!password) return;

    const type = tableType === 'states' ? 'visitedStates' : tableType;
    const flip = () => {
        if (tableType === 'states') visitedStates[item.name] = !visitedStates[item.name];
        else item.visited = !item.visited;
        displayTravelSummary();
        mapStale = true;
        updateTable(currentTable());
    };

    // Show the change at once; undo it if the save fails.
    flip();
    TravelAPI.saveList(type, TRAVEL_LISTS[type], password)
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

function displayTravelSummary() {
    const summaryContainer = document.getElementById('travel-summary');
    const tableSelector = document.getElementById('table-selector');

    const stateCount = Object.values(visitedStates).filter(visited => visited).length;
    const statePercentage = ((stateCount / 50) * 100).toFixed(0);
    const top100Metros = metros.filter(city => city.rank <= 100);
    const metroCount = top100Metros.filter(city => city.visited).length;
    const metroPercentage = ((metroCount / 100) * 100).toFixed(0);
    const highPointCount = highPoints.filter(point => point.visited).length;
    const highPointPercentage = ((highPointCount / 50) * 100).toFixed(0);
    const parkCount = nationalParks.filter(park => park.visited).length;
    const parkPercentage = ((parkCount / nationalParks.length) * 100).toFixed(0);
    const capitalCount = capitals.filter(c => c.visited).length;
    const capitalPercentage = ((capitalCount / 50) * 100).toFixed(0);

    summaryContainer.innerHTML = `
        <div class="summary-stats-container">
            <div class="summary-stat states-summary">
                <div class="stat-number-container">
                    <span class="stat-number">${stateCount}</span>
                    <span class="stat-total">/50</span>
                    <span class="stat-percentage">(${statePercentage}%)</span>
                </div>
                <span class="stat-label">States Visited</span>
            </div>
            <div class="other-stats other-stats-quad">
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${metroCount}</span>
                        <span class="stat-total">/100</span>
                        <span class="stat-percentage">(${metroPercentage}%)</span>
                    </div>
                    <span class="stat-label">Largest Metros Visited</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${highPointCount}</span>
                        <span class="stat-total">/50</span>
                        <span class="stat-percentage">(${highPointPercentage}%)</span>
                    </div>
                    <span class="stat-label">High Points Summited</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${capitalCount}</span>
                        <span class="stat-total">/50</span>
                        <span class="stat-percentage">(${capitalPercentage}%)</span>
                    </div>
                    <span class="stat-label">State Capitals Visited</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${parkCount}</span>
                        <span class="stat-total">/${nationalParks.length}</span>
                        <span class="stat-percentage">(${parkPercentage}%)</span>
                    </div>
                    <span class="stat-label">National Parks Visited</span>
                </div>
            </div>
        </div>
    `;

    // Set up event listener for table selector (only once)
    if (!tableSelector.dataset.bound) {
        tableSelector.dataset.bound = 'true';
        tableSelector.addEventListener('change', function () {
            updateTable(this.value);
        });
    }
}

function sortTableData(data, col, dir, tableType) {
    return [...data].sort((a, b) => {
        let aVal = a[col];
        let bVal = b[col];

        if (col === 'population' && tableType === 'metros') {
            aVal = parseInt(String(aVal).replace(/,/g, ''), 10) || 0;
            bVal = parseInt(String(bVal).replace(/,/g, ''), 10) || 0;
        }

        // No number yet (counties still loading) sorts below every number.
        if (aVal == null) aVal = -1;
        if (bVal == null) bVal = -1;

        if (typeof aVal === 'boolean') {
            aVal = aVal ? 1 : 0;
            bVal = bVal ? 1 : 0;
        }

        if (typeof aVal === 'string') {
            const cmp = aVal.localeCompare(bVal);
            return dir === 'asc' ? cmp : -cmp;
        }

        return dir === 'asc' ? aVal - bVal : bVal - aVal;
    });
}

function updateTable(tableType) {
    const tableContainer = document.getElementById('travel-table-container');
    tableContainer.innerHTML = '';

    const table = document.createElement('table');
    // travel-table--fit: sized to fit a phone without horizontal scrolling
    // (Rank hidden, names wrap), so the Status column stays on screen.
    table.className = 'travel-table travel-table--fit';

    let tableHeaders, sortKeys, colClasses, rawData, headerTitles = [];

    if (tableType === 'states') {
        // [full, phone] labels keep the row on a phone screen, where the
        // Metros and Parks columns (col-detail) are hidden; Core still counts them.
        tableHeaders = ['State', 'Core', 'Counties', 'Metros', 'Parks', ['High Point', 'HP'], ['Capital', 'Cap'], ['Status', '✓']];
        sortKeys     = ['name', 'progress', 'countyPct', 'metrosVisited', 'parksVisited', 'hpVisited', 'capVisited', 'visited'];
        colClasses   = ['col-name', 'col-progress', 'col-progress', 'col-num col-detail', 'col-num col-detail', 'col-status', 'col-status', 'col-status'];
        headerTitles = [null, 'The state, its top-100 metros, national parks, high point and capital',
            'Counties reached by Strava activities (County Hunter)', 'Top 100 metros'];
        rawData      = buildStateRows();
    } else if (tableType === 'highpoints') {
        tableHeaders = ['Rank', 'Peak Name', 'State', 'Elevation (ft)', 'Status'];
        sortKeys     = ['elevation', 'name', 'state', 'elevation', 'visited'];
        colClasses   = ['col-rank', 'col-name', '', 'col-num', 'col-status'];
        rawData      = highPoints;
    } else if (tableType === 'capitals') {
        tableHeaders = ['Capital', 'State', 'Status'];
        sortKeys     = ['name', 'stateName', 'visited'];
        colClasses   = ['col-name', '', 'col-status'];
        rawData      = capitals;
    } else if (tableType === 'metros') {
        tableHeaders = ['Rank', 'Metro Area', 'State', 'Population', 'Status'];
        sortKeys     = ['rank', 'metro_name', 'state', 'population', 'visited'];
        colClasses   = ['col-rank', 'col-name', '', 'col-num', 'col-status'];
        rawData      = metros;
    } else if (tableType === 'parks') {
        tableHeaders = ['National Park', 'State', 'Status'];
        sortKeys     = ['name', 'state', 'visited'];
        colClasses   = ['col-name', '', 'col-status'];
        rawData      = nationalParks;
    }

    const { col, dir } = sortState[tableType];
    const tableData = sortTableData(rawData, col, dir, tableType);

    // Create sortable table header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    tableHeaders.forEach((header, i) => {
        const th = document.createElement('th');
        const key = sortKeys[i];
        const isActive = col === key;

        th.classList.add('sortable');
        if (colClasses[i]) th.classList.add(...colClasses[i].split(' '));
        if (headerTitles[i]) th.title = headerTitles[i];
        if (isActive) th.classList.add('sort-active');

        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';

        if (Array.isArray(header)) {
            th.title = header[0];
            th.insertAdjacentHTML('beforeend',
                `<span class="th-long">${header[0]}</span><span class="th-short">${header[1]}</span>`);
        } else {
            th.appendChild(document.createTextNode(header));
        }
        th.appendChild(indicator);

        th.addEventListener('click', () => {
            const state = sortState[tableType];
            if (state.col === key) {
                sortState[tableType].dir = state.dir === 'asc' ? 'desc' : 'asc';
            } else {
                const defaultDir = (key === 'visited' || key === 'hpVisited' || key === 'capVisited' || key === 'progress' || key === 'countyPct' ||
                    key === 'metrosVisited' || key === 'parksVisited' || key === 'elevation' || key === 'rank' || key === 'population') ? 'desc' : 'asc';
                sortState[tableType] = { col: key, dir: defaultDir };
            }
            updateTable(tableType);
        });

        headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement('tbody');
    tableData.forEach((item, index) => {
        const row = document.createElement('tr');
        row.className = item.visited ? 'visited' : 'not-visited';

        const statusIcon = item.visited ? '✅' : '⬜';
        const statusClass = editMode ? 'status-toggle' : '';

        if (tableType === 'states') {
            const hp = item.highPoint;
            const hpTitle = hp ? `${hp.name} (${hp.elevation.toLocaleString()} ft)` : '';
            const cap = item.capital;
            row.innerHTML = `
                <td class="col-name">${withFlag(`us-${item.abbr.toLowerCase()}`, item.name)}</td>
                <td class="col-progress">${progressBar(item.progress, coreBreakdown(item))}</td>
                <td class="col-progress">${progressBar(item.countyPct, `${item.countiesVisited} of ${item.countiesTotal} counties (from Strava)`)}</td>
                <td class="col-num col-detail">${fraction(item.metrosVisited, item.metrosTotal)}</td>
                <td class="col-num col-detail">${fraction(item.parksVisited, item.parksTotal)}</td>
                <td class="col-status ${hp && editMode ? 'status-toggle' : ''}" data-toggle="hp" title="${hpTitle}">${hp ? (item.hpVisited ? '✅' : '⬜') : '—'}</td>
                <td class="col-status ${cap && editMode ? 'status-toggle' : ''}" data-toggle="cap" title="${cap ? cap.name : ''}">${cap ? (item.capVisited ? '✅' : '⬜') : '—'}</td>
                <td class="col-status ${statusClass}" data-toggle="state">${statusIcon}</td>
            `;
        } else if (tableType === 'highpoints') {
            row.innerHTML = `
                <td class="col-rank">${index + 1}</td>
                <td class="col-name">${item.name}</td>
                <td>${item.state}</td>
                <td class="col-num">${item.elevation.toLocaleString()}</td>
                <td class="col-status ${statusClass}">${statusIcon}</td>
            `;
        } else if (tableType === 'capitals') {
            const hint = stravaHint(item)
                ? ` <span class="strava-hint" title="Strava activities reach ${item.county} County: check whether you were in ${item.name}">check Strava</span>`
                : '';
            row.innerHTML = `
                <td class="col-name">${item.name}${hint}</td>
                <td>${withFlag(`us-${item.state.toLowerCase()}`, item.stateName)}</td>
                <td class="col-status ${statusClass}">${statusIcon}</td>
            `;
        } else if (tableType === 'metros') {
            row.innerHTML = `
                <td class="col-rank">${item.rank}</td>
                <td class="col-name">${item.metro_name}</td>
                <td>${item.state}</td>
                <td class="col-num">${item.population}</td>
                <td class="col-status ${statusClass}">${statusIcon}</td>
            `;
        } else if (tableType === 'parks') {
            row.innerHTML = `
                <td class="col-name">${item.name}</td>
                <td>${item.state}</td>
                <td class="col-status ${statusClass}">${statusIcon}</td>
            `;
        }

        if (editMode && tableType === 'states') {
            // The state, its high point and its capital all toggle right from the row.
            row.querySelector('[data-toggle="state"]').addEventListener('click', () => handleToggle('states', item));
            if (item.highPoint) {
                row.querySelector('[data-toggle="hp"]').addEventListener('click', () => handleToggle('highpoints', item.highPoint));
            }
            if (item.capital) {
                row.querySelector('[data-toggle="cap"]').addEventListener('click', () => handleToggle('capitals', item.capital));
            }
        } else if (editMode) {
            const statusCell = row.querySelector('.status-toggle');
            statusCell.addEventListener('click', () => handleToggle(tableType, item));
        }

        tbody.appendChild(row);
    });

    table.appendChild(tbody);

    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll-wrapper';
    wrapper.appendChild(table);
    tableContainer.appendChild(wrapper);

    // Detect horizontal overflow and show/hide scroll hint
    function checkScroll() {
        const hasScroll = wrapper.scrollWidth > wrapper.clientWidth + 1;
        wrapper.classList.toggle('has-scroll', hasScroll);
        const atEnd = wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 1;
        wrapper.classList.toggle('scrolled-end', atEnd);
    }
    wrapper.addEventListener('scroll', checkScroll);
    checkScroll();
}

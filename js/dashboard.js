let metros, highPoints, nationalParks, visitedStates;
let editMode = false;
let refreshOwnerUI = () => {};

const sortState = {
    states:     { col: 'name',      dir: 'asc'  },
    highpoints: { col: 'elevation', dir: 'desc' },
    metros:     { col: 'rank',      dir: 'asc'  },
    parks:      { col: 'name',      dir: 'asc'  }
};

document.addEventListener('DOMContentLoaded', function () {
    const dataReady = Promise.all([
        TravelAPI.fetchMetros(),
        TravelAPI.fetchHighPoints(),
        TravelAPI.fetchNationalParks(),
        TravelAPI.fetchVisitedStates()
    ])
        .then(([metrosData, highPointsData, nationalParksData, visitedStatesData]) => {
            metros = metrosData;
            highPoints = highPointsData;
            nationalParks = nationalParksData;
            visitedStates = visitedStatesData;
            displayTravelSummary();
            updateTable(currentTable());
            setupEditMode();
            setupCsvExport();
        });
    dataReady.catch(error => console.error('Error loading the JSON files:', error));
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
// metros (every state a metro spans counts it, so NYC counts for NJ too), its
// national parks and its high point. Progress is the share of those items done.
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

function buildStateRows() {
    const rows = {};
    Object.entries(STATE_ABBRS).forEach(([name, abbr]) => {
        rows[abbr] = {
            name, abbr, visited: Boolean(visitedStates[name]),
            metrosVisited: 0, metrosTotal: 0, parksVisited: 0, parksTotal: 0,
            highPoint: null, hpVisited: false
        };
    });
    metros.forEach(m => {
        new Set(String(m.metro_state || m.state).split('-')).forEach(abbr => {
            const r = rows[abbr];
            if (!r) return; // DC, Puerto Rico
            r.metrosTotal++;
            if (m.visited) r.metrosVisited++;
        });
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
    return Object.values(rows).map(r => {
        const total = 1 + r.metrosTotal + r.parksTotal + (r.highPoint ? 1 : 0);
        const done = (r.visited ? 1 : 0) + r.metrosVisited + r.parksVisited + (r.hpVisited ? 1 : 0);
        r.progress = Math.round((done / total) * 100);
        return r;
    });
}

// "3/5", or a dash for a state with none on the list.
function fraction(done, total) {
    return total ? `${done}/${total}` : '—';
}

function setupUSViewSwitch(dataReady) {
    setupViewSwitch({
        titles: { tables: 'US Travel Dashboard — Justin Guyette', map: 'US Travel Map — Justin Guyette' },
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
            headers = ['State', 'Abbreviation', 'Status', 'Metros Visited', 'Metros Total',
                'Parks Visited', 'Parks Total', 'High Point', 'High Point Status', 'Progress (%)'];
            const sorted = sortTableData(buildStateRows(), col, dir, tableType);
            rows = sorted.map(r => [
                r.name, r.abbr, r.visited ? 'Visited' : 'Not Visited',
                r.metrosVisited, r.metrosTotal, r.parksVisited, r.parksTotal,
                r.highPoint ? r.highPoint.name : '', r.hpVisited ? 'Summited' : 'Not Summited',
                r.progress
            ]);
            filename = 'states.csv';
        } else if (tableType === 'highpoints') {
            headers = ['Rank', 'Peak Name', 'State', 'Elevation (ft)', 'Status'];
            const sorted = sortTableData(highPoints, col, dir, tableType);
            rows = sorted.map((item, i) => [
                i + 1, item.name, item.state, item.elevation, item.visited ? 'Summited' : 'Not Summited'
            ]);
            filename = 'high-points.csv';
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

async function handleToggle(tableType, item) {
    const password = TravelAdmin.getPassword();
    if (!password) return;

    let type, key;
    if (tableType === 'states') {
        type = 'visitedStates';
        key = item.name;
    } else if (tableType === 'highpoints') {
        type = 'highpoints';
        key = item.state;
    } else if (tableType === 'metros') {
        type = 'metros';
        key = String(item.rank);
    } else if (tableType === 'parks') {
        type = 'parks';
        key = item.name;
    }

    try {
        await TravelAPI.toggleVisited(type, key, password);
        if (tableType === 'states') visitedStates[key] = !visitedStates[key];
        else item.visited = !item.visited;
        displayTravelSummary();
        mapStale = true;
        updateTable(currentTable());
    } catch (err) {
        alert('Toggle failed: ' + err.message);
        if (err.message.includes('Invalid password')) {
            TravelAdmin.logout();
            refreshOwnerUI();
            setEditMode(false);
        }
    }
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
            <div class="other-stats other-stats-trio">
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

    let tableHeaders, sortKeys, colClasses, rawData;

    if (tableType === 'states') {
        // [full, phone] labels: the short ones keep all six columns on a phone.
        tableHeaders = ['State', ['Progress', '%'], 'Metros', 'Parks', ['High Point', 'HP'], 'Status'];
        sortKeys     = ['name', 'progress', 'metrosVisited', 'parksVisited', 'hpVisited', 'visited'];
        colClasses   = ['col-name', 'col-progress', 'col-num', 'col-num', 'col-status', 'col-status'];
        rawData      = buildStateRows();
    } else if (tableType === 'highpoints') {
        tableHeaders = ['Rank', 'Peak Name', 'State', 'Elevation (ft)', 'Status'];
        sortKeys     = ['elevation', 'name', 'state', 'elevation', 'visited'];
        colClasses   = ['col-rank', 'col-name', '', 'col-num', 'col-status'];
        rawData      = highPoints;
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
        if (colClasses[i]) th.classList.add(colClasses[i]);
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
                const defaultDir = (key === 'visited' || key === 'hpVisited' || key === 'progress' ||
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
            row.innerHTML = `
                <td class="col-name">${item.name}</td>
                <td class="col-progress">
                    <span class="state-progress" title="${item.progress}% of this state's list done">
                        <span class="state-progress-fill" style="width:${item.progress}%"></span>
                        <span class="state-progress-pct">${item.progress}%</span>
                    </span>
                </td>
                <td class="col-num">${fraction(item.metrosVisited, item.metrosTotal)}</td>
                <td class="col-num">${fraction(item.parksVisited, item.parksTotal)}</td>
                <td class="col-status ${hp && editMode ? 'status-toggle' : ''}" data-toggle="hp" title="${hpTitle}">${hp ? (item.hpVisited ? '✅' : '⬜') : '—'}</td>
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
            // Both the state and its high point toggle right from the row.
            row.querySelector('[data-toggle="state"]').addEventListener('click', () => handleToggle('states', item));
            if (item.highPoint) {
                row.querySelector('[data-toggle="hp"]').addEventListener('click', () => handleToggle('highpoints', item.highPoint));
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

let metros, highPoints, nationalParks, visitedStates;
let editMode = false;

const sortState = {
    highpoints: { col: 'elevation', dir: 'desc' },
    metros:     { col: 'rank',      dir: 'asc'  },
    parks:      { col: 'name',      dir: 'asc'  }
};

document.addEventListener('DOMContentLoaded', function () {
    Promise.all([
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
            updateTable('highpoints');
            setupEditMode();
            setupCsvExport();
        })
        .catch(error => console.error('Error loading the JSON files:', error));
});

function setupEditMode() {
    const btn = document.getElementById('edit-mode-btn');
    btn.addEventListener('click', () => {
        if (!editMode) {
            const stored = sessionStorage.getItem('travelPassword');
            if (stored) {
                editMode = true;
                btn.classList.add('active');
                btn.textContent = 'Exit Edit Mode';
                updateTable(document.getElementById('table-selector').value);
            } else {
                const pw = prompt('Enter travel password:');
                if (pw) {
                    sessionStorage.setItem('travelPassword', pw);
                    editMode = true;
                    btn.classList.add('active');
                    btn.textContent = 'Exit Edit Mode';
                    updateTable(document.getElementById('table-selector').value);
                }
            }
        } else {
            editMode = false;
            btn.classList.remove('active');
            btn.textContent = 'Edit Mode';
            updateTable(document.getElementById('table-selector').value);
        }
    });
}

function setupCsvExport() {
    document.getElementById('export-csv-btn').addEventListener('click', () => {
        const tableType = document.getElementById('table-selector').value;
        const { col, dir } = sortState[tableType];
        let rows, headers, filename;

        if (tableType === 'highpoints') {
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
    const password = sessionStorage.getItem('travelPassword');
    if (!password) return;

    let type, key;
    if (tableType === 'highpoints') {
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
        item.visited = !item.visited;
        displayTravelSummary();
        updateTable(tableType);
    } catch (err) {
        alert('Toggle failed: ' + err.message);
        if (err.message.includes('Invalid password')) {
            sessionStorage.removeItem('travelPassword');
            editMode = false;
            document.getElementById('edit-mode-btn').classList.remove('active');
            document.getElementById('edit-mode-btn').textContent = 'Edit Mode';
            updateTable(tableType);
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
    table.className = 'travel-table';

    let tableHeaders, sortKeys, rawData;

    if (tableType === 'highpoints') {
        tableHeaders = ['Rank', 'Peak Name', 'State', 'Elevation (ft)', 'Status'];
        sortKeys     = ['elevation', 'name', 'state', 'elevation', 'visited'];
        rawData      = highPoints;
    } else if (tableType === 'metros') {
        tableHeaders = ['Rank', 'Metro Area', 'State', 'Population', 'Status'];
        sortKeys     = ['rank', 'metro_name', 'state', 'population', 'visited'];
        rawData      = metros;
    } else if (tableType === 'parks') {
        tableHeaders = ['National Park', 'State', 'Status'];
        sortKeys     = ['name', 'state', 'visited'];
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
        if (isActive) th.classList.add('sort-active');

        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = isActive ? (dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';

        th.appendChild(document.createTextNode(header));
        th.appendChild(indicator);

        th.addEventListener('click', () => {
            const state = sortState[tableType];
            if (state.col === key) {
                sortState[tableType].dir = state.dir === 'asc' ? 'desc' : 'asc';
            } else {
                const defaultDir = (key === 'visited' || key === 'elevation' || key === 'rank' || key === 'population') ? 'desc' : 'asc';
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

        if (tableType === 'highpoints') {
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${item.name}</td>
                <td>${item.state}</td>
                <td>${item.elevation.toLocaleString()}</td>
                <td class="${statusClass}">${statusIcon}</td>
            `;
        } else if (tableType === 'metros') {
            row.innerHTML = `
                <td>${item.rank}</td>
                <td>${item.metro_name}</td>
                <td>${item.state}</td>
                <td>${item.population}</td>
                <td class="${statusClass}">${statusIcon}</td>
            `;
        } else if (tableType === 'parks') {
            row.innerHTML = `
                <td>${item.name}</td>
                <td>${item.state}</td>
                <td class="${statusClass}">${statusIcon}</td>
            `;
        }

        if (editMode) {
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

let worldData;
let editMode = false;

const sortState = {
    northAmerica: { col: 'population', dir: 'desc' },
    southAmerica: { col: 'population', dir: 'desc' },
    europe:       { col: 'population', dir: 'desc' },
    asia:         { col: 'population', dir: 'desc' },
    africa:       { col: 'population', dir: 'desc' },
    oceania:      { col: 'population', dir: 'desc' }
};

const continentMap = {
    northAmerica: 'northAmericanCountries',
    southAmerica: 'southAmericanCountries',
    europe:       'europeanCountries',
    asia:         'asianCountries',
    africa:       'africanCountries',
    oceania:      'oceaniaCountries'
};

document.addEventListener('DOMContentLoaded', function () {
    loadCountriesWithPopulation(null, function (updatedData) {
        worldData = updatedData;
        displayWorldTravelSummary();
        renderPopulationSourceBadge();
        updateTable(document.getElementById('table-selector').value);
    })
        .then(data => {
            worldData = data;
            displayWorldTravelSummary();
            renderPopulationSourceBadge();
            updateTable('northAmerica');
            setupEditMode();
            setupCsvExport();
        })
        .catch(error => console.error('Error loading the JSON file:', error));
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
        const continentType = document.getElementById('table-selector').value;
        const { col, dir } = sortState[continentType];
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

async function handleToggle(continentType, country) {
    const password = sessionStorage.getItem('travelPassword');
    if (!password) return;

    try {
        await TravelAPI.toggleVisited('countries', country.name, password, continentType);
        country.visited = !country.visited;
        displayWorldTravelSummary();
        updateTable(continentType);
    } catch (err) {
        alert('Toggle failed: ' + err.message);
        if (err.message.includes('Invalid password')) {
            sessionStorage.removeItem('travelPassword');
            editMode = false;
            document.getElementById('edit-mode-btn').classList.remove('active');
            document.getElementById('edit-mode-btn').textContent = 'Edit Mode';
            updateTable(continentType);
        }
    }
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

function updateTable(continentType) {
    const tableContainer = document.getElementById('travel-table-container');
    tableContainer.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'travel-table';

    const tableHeaders = ['Country', 'Population', 'Status'];
    const sortKeys     = ['name', 'population', 'visited'];

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

        th.classList.add('sortable');
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

        row.innerHTML = `
            <td>${country.name}</td>
            <td>${country.population.toLocaleString()}</td>
            <td class="${statusClass}">${statusIcon}</td>
        `;

        if (editMode) {
            const statusCell = row.querySelector('.status-toggle');
            statusCell.addEventListener('click', () => handleToggle(continentType, country));
        }

        tbody.appendChild(row);
    });

    table.appendChild(tbody);

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

let adk46ers, colorado14ers;
let editMode = false;

const sortState = {
    adk46ers:      { col: 'elevation', dir: 'desc' },
    colorado14ers: { col: 'elevation', dir: 'desc' }
};

const PEAK_LISTS = {
    adk46ers:      { label: 'Adirondack 46ers', csv: 'adirondack-46ers.csv' },
    colorado14ers: { label: 'Colorado 14ers',   csv: 'colorado-14ers.csv' }
};

document.addEventListener('DOMContentLoaded', function () {
    Promise.all([
        TravelAPI.fetchPeaksWithFallback('adk46ers', 'data/adirondack46ers.json'),
        TravelAPI.fetchPeaksWithFallback('colorado14ers', 'data/colorado14ers.json')
    ])
        .then(([adk46ersData, colorado14ersData]) => {
            adk46ers = adk46ersData;
            colorado14ers = colorado14ersData;
            displayPeaksSummary();
            updateTable('adk46ers');
            setupEditMode();
            setupCsvExport();
        })
        .catch(error => console.error('Error loading peak data:', error));
});

function peakData(tableType) {
    return tableType === 'adk46ers' ? adk46ers : colorado14ers;
}

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
        const headers = ['Rank', 'Peak Name', 'Elevation (ft)', 'Status'];
        const sorted = sortTableData(peakData(tableType), col, dir);
        const rows = sorted.map((item, i) => [
            i + 1, item.name, item.elevation, item.climbed ? 'Summited' : 'Not Summited'
        ]);
        downloadCsv(headers, rows, PEAK_LISTS[tableType].csv);
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

    try {
        await TravelAPI.toggleVisited(tableType, item.name, password);
        item.climbed = !item.climbed;
        displayPeaksSummary();
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

function displayPeaksSummary() {
    const summaryContainer = document.getElementById('travel-summary');
    const tableSelector = document.getElementById('table-selector');

    const adkCount = adk46ers.filter(peak => peak.climbed).length;
    const adkPercentage = ((adkCount / adk46ers.length) * 100).toFixed(0);
    const coCount = colorado14ers.filter(peak => peak.climbed).length;
    const coPercentage = ((coCount / colorado14ers.length) * 100).toFixed(0);

    summaryContainer.innerHTML = `
        <div class="summary-stats-container">
            <div class="other-stats other-stats-duo">
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${adkCount}</span>
                        <span class="stat-total">/${adk46ers.length}</span>
                        <span class="stat-percentage">(${adkPercentage}%)</span>
                    </div>
                    <span class="stat-label">Adirondack 46ers Summited</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${coCount}</span>
                        <span class="stat-total">/${colorado14ers.length}</span>
                        <span class="stat-percentage">(${coPercentage}%)</span>
                    </div>
                    <span class="stat-label">Colorado 14ers Summited</span>
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

function sortTableData(data, col, dir) {
    return [...data].sort((a, b) => {
        let aVal = a[col];
        let bVal = b[col];

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

    const tableHeaders = ['Rank', 'Peak Name', 'Elevation (ft)', 'Status'];
    const sortKeys     = ['elevation', 'name', 'elevation', 'climbed'];

    const { col, dir } = sortState[tableType];
    const tableData = sortTableData(peakData(tableType), col, dir);

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
                const defaultDir = (key === 'climbed' || key === 'elevation') ? 'desc' : 'asc';
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
        row.className = item.climbed ? 'visited' : 'not-visited';

        const statusIcon = item.climbed ? '✅' : '⬜';
        const statusClass = editMode ? 'status-toggle' : '';

        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${item.name}</td>
            <td>${item.elevation.toLocaleString()}</td>
            <td class="${statusClass}">${statusIcon}</td>
        `;

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

let metros, highPoints, nationalParks, visitedStates;

document.addEventListener('DOMContentLoaded', function () {
    Promise.all([
        fetch('/data/metros.json').then(response => response.json()),
        fetch('/data/highPoints.json').then(response => response.json()),
        fetch('/data/nationalParks.json').then(response => response.json()),
        fetch('/data/visitedStates.json').then(response => response.json())
    ])
        .then(([metrosData, highPointsData, nationalParksData, visitedStatesData]) => {
            metros = metrosData;
            highPoints = highPointsData;
            nationalParks = nationalParksData;
            visitedStates = visitedStatesData;
            displayTravelSummary();
            // Initialize with highpoints table
            updateTable('highpoints');
        })
        .catch(error => console.error('Error loading the JSON files:', error));
});

function displayTravelSummary() {
    const summaryContainer = document.getElementById('travel-summary');
    const tableContainer = document.getElementById('travel-table-container');
    const tableSelector = document.getElementById('table-selector');

    // Calculate summary statistics
    const stateCount = Object.values(visitedStates).filter(visited => visited).length;
    const statePercentage = ((stateCount / 50) * 100).toFixed(0);
    const top100Metros = metros.filter(city => city.rank <= 100);
    const metroCount = top100Metros.filter(city => city.visited).length;
    const metroPercentage = ((metroCount / 100) * 100).toFixed(0);
    const highPointCount = highPoints.filter(point => point.visited).length;
    const highPointPercentage = ((highPointCount / 50) * 100).toFixed(0);
    const parkCount = nationalParks.filter(park => park.visited).length;
    const parkPercentage = ((parkCount / nationalParks.length) * 100).toFixed(0);

    // Display summary statistics
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
            <div class="other-stats">
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

    // Set up event listener for table selector
    tableSelector.addEventListener('change', function () {
        updateTable(this.value);
    });
}

function updateTable(tableType) {
    const tableContainer = document.getElementById('travel-table-container');
    tableContainer.innerHTML = ''; // Clear previous table

    const table = document.createElement('table');
    table.className = 'travel-table';

    let tableData, tableHeaders;

    if (tableType === 'highpoints') {
        tableHeaders = ['Rank', 'Peak Name', 'State', 'Elevation (ft)', 'Status'];
        tableData = highPoints.sort((a, b) => b.elevation - a.elevation);
    } else if (tableType === 'metros') {
        tableHeaders = ['Rank', 'Metro Area', 'State', 'Population', 'Status'];
        tableData = metros.sort((a, b) => a.rank - b.rank);
    } else if (tableType === 'parks') {
        tableHeaders = ['National Park', 'State', 'Status'];
        tableData = nationalParks.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Create table header
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>${tableHeaders.map(header => `<th>${header}</th>`).join('')}</tr>`;
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement('tbody');
    tableData.forEach((item, index) => {
        const row = document.createElement('tr');
        row.className = item.visited ? 'visited' : 'not-visited';

        if (tableType === 'highpoints') {
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${item.name}</td>
                <td>${item.state}</td>
                <td>${item.elevation.toLocaleString()}</td>
                <td>${item.visited ? '✅' : '⬜'}</td>
            `;
        } else if (tableType === 'metros') {
            row.innerHTML = `
                <td>${item.rank}</td>
                <td>${item.metro_name}</td>
                <td>${item.state}</td>
                <td>${item.population}</td>
                <td>${item.visited ? '✅' : '⬜'}</td>
            `;
        } else if (tableType === 'parks') {
            row.innerHTML = `
                <td>${item.name}</td>
                <td>${item.state}</td>
                <td>${item.visited ? '✅' : '⬜'}</td>
            `;
        }

        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
}

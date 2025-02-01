document.addEventListener('DOMContentLoaded', function () {
    fetch('/data/countries.json')
        .then(response => response.json())
        .then(data => {
            worldData = data;
            displayWorldTravelSummary();
            updateTable('northAmerica');
        })
        .catch(error => console.error('Error loading the JSON file:', error));
});

function displayWorldTravelSummary() {
    const summaryContainer = document.getElementById('travel-summary');
    const tableContainer = document.getElementById('travel-table-container');
    const tableSelector = document.getElementById('table-selector');

    // Calculate summary statistics for each continent
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

    // Calculate total countries visited
    const totalCountries = worldData.northAmericanCountries.length +
        worldData.southAmericanCountries.length +
        worldData.europeanCountries.length +
        worldData.asianCountries.length +
        worldData.africanCountries.length +
        worldData.oceaniaCountries.length;

    const totalVisited = northAmericaCount + southAmericaCount + europeCount +
        asiaCount + africaCount + oceaniaCount;

    const totalPercentage = ((totalVisited / totalCountries) * 100).toFixed(0);

    // Display summary statistics
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

    // Set up event listener for table selector
    tableSelector.addEventListener('change', function () {
        updateTable(this.value);
    });
}

function updateTable(continentType) {
    const tableContainer = document.getElementById('travel-table-container');
    tableContainer.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'travel-table';

    const tableHeaders = ['Country', 'Population', 'Status'];
    let tableData;

    switch (continentType) {
        case 'northAmerica':
            tableData = worldData.northAmericanCountries.sort((a, b) => b.population - a.population);
            break;
        case 'southAmerica':
            tableData = worldData.southAmericanCountries.sort((a, b) => b.population - a.population);
            break;
        case 'europe':
            tableData = worldData.europeanCountries.sort((a, b) => b.population - a.population);
            break;
        case 'asia':
            tableData = worldData.asianCountries.sort((a, b) => b.population - a.population);
            break;
        case 'africa':
            tableData = worldData.africanCountries.sort((a, b) => b.population - a.population);
            break;
        case 'oceania':
            tableData = worldData.oceaniaCountries.sort((a, b) => b.population - a.population);
            break;
    }

    // Create table header
    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>${tableHeaders.map(header => `<th>${header}</th>`).join('')}</tr>`;
    table.appendChild(thead);

    // Create table body
    const tbody = document.createElement('tbody');
    tableData.forEach(country => {
        const row = document.createElement('tr');
        row.className = country.visited ? 'visited' : 'not-visited';
        row.innerHTML = `
            <td>${country.name}</td>
            <td>${country.population.toLocaleString()}</td>
            <td>${country.visited ? '✅' : '⬜'}</td>
        `;
        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableContainer.appendChild(table);
}

// World Quests JavaScript - handles Forbes 100 cities and Seven Wonders tracking

let forbes100Cities, metrosData, worldCitiesData, sevenWondersData;
let forbesMap, wondersMap;
let layerGroups = {};

document.addEventListener('DOMContentLoaded', function () {
    Promise.all([
        fetch('/data/forbes100cities.json').then(response => response.json()),
        fetch('/data/metros.json').then(response => response.json()),
        fetch('/data/worldCities.json').then(response => response.json()),
        fetch('/data/sevenWonders.json').then(response => response.json())
    ])
        .then(([forbesData, metros, worldCities, sevenWonders]) => {
            forbes100Cities = forbesData;
            metrosData = metros;
            worldCitiesData = worldCities.visitedCities;
            sevenWondersData = sevenWonders;

            displayQuestSummary();
            displayWondersSummary();
            initializeForbesMap();
            initializeWondersMap();
            setupWondersToggleControls();
        })
        .catch(error => console.error('Error loading data:', error));
});

function displayQuestSummary() {
    const summaryContainer = document.getElementById('quest-summary');

    // Calculate completion statistics by cross-referencing with metros and worldCities
    const completedCities = getCompletedForbesCities();
    const forbesTotal = forbes100Cities.length;
    const forbesPercentage = ((completedCities.length / forbesTotal) * 100).toFixed(0);
    const isCompleted = completedCities.length === forbesTotal;

    // Display completion cards using dashboard styling
    summaryContainer.innerHTML = `
        <div class="summary-stats-container">
            <div class="other-stats">
                <div class="summary-stat ${isCompleted ? 'completed-quest' : ''}">
                    <div class="stat-number-container">
                        <span class="stat-number">${completedCities.length}</span>
                        <span class="stat-total">/${forbesTotal}</span>
                        <span class="stat-percentage">(${forbesPercentage}%)</span>
                        ${isCompleted ? '<span class="completion-check">✅</span>' : ''}
                    </div>
                    <span class="stat-label">Forbes 100 Cities</span>
                </div>
            </div>
        </div>
    `;
}

function displayWondersSummary() {
    const summaryContainer = document.getElementById('wonders-summary');

    // Calculate Seven Wonders statistics
    const visitedSevenWonders = sevenWondersData.sevenWonders.filter(w => w.visited).length;
    const totalSevenWonders = sevenWondersData.sevenWonders.length;
    const sevenWondersPercentage = ((visitedSevenWonders / totalSevenWonders) * 100).toFixed(0);
    const sevenWondersCompleted = visitedSevenWonders === totalSevenWonders;

    // Calculate Natural Wonders statistics
    const visitedNaturalWonders = sevenWondersData.sevenNaturalWonders.filter(w => w.visited).length;
    const totalNaturalWonders = sevenWondersData.sevenNaturalWonders.length;
    const naturalWondersPercentage = ((visitedNaturalWonders / totalNaturalWonders) * 100).toFixed(0);
    const naturalWondersCompleted = visitedNaturalWonders === totalNaturalWonders;

    // Calculate Nominees statistics
    const visitedNominees = sevenWondersData.sevenNaturalWondersNominees.filter(w => w.visited).length;
    const totalNominees = sevenWondersData.sevenNaturalWondersNominees.length;
    const nomineesPercentage = ((visitedNominees / totalNominees) * 100).toFixed(0);

    summaryContainer.innerHTML = `
        <div class="summary-stats-container">
            <div class="other-stats">
                <div class="summary-stat ${sevenWondersCompleted ? 'completed-quest' : ''}">
                    <div class="stat-number-container">
                        <span class="stat-number">${visitedSevenWonders}</span>
                        <span class="stat-total">/${totalSevenWonders}</span>
                        <span class="stat-percentage">(${sevenWondersPercentage}%)</span>
                        ${sevenWondersCompleted ? '<span class="completion-check">✅</span>' : ''}
                    </div>
                    <span class="stat-label">Seven Wonders of the World</span>
                </div>
                <div class="summary-stat ${naturalWondersCompleted ? 'completed-quest' : ''}">
                    <div class="stat-number-container">
                        <span class="stat-number">${visitedNaturalWonders}</span>
                        <span class="stat-total">/${totalNaturalWonders}</span>
                        <span class="stat-percentage">(${naturalWondersPercentage}%)</span>
                        ${naturalWondersCompleted ? '<span class="completion-check">✅</span>' : ''}
                    </div>
                    <span class="stat-label">Seven Natural Wonders</span>
                </div>
                <div class="summary-stat">
                    <div class="stat-number-container">
                        <span class="stat-number">${visitedNominees}</span>
                        <span class="stat-total">/${totalNominees}</span>
                        <span class="stat-percentage">(${nomineesPercentage}%)</span>
                    </div>
                    <span class="stat-label">Natural Wonder Nominees</span>
                </div>
            </div>
        </div>
    `;
}

function getCompletedForbesCities() {
    const completed = [];

    forbes100Cities.forEach(forbesCity => {
        // Check if city exists in metros with visited: true
        // Handle naming variations for metros, but only for US cities
        const metroMatch = metrosData.find(metro => {
            if (!metro.visited) return false;

            // Only match metros for Forbes cities that are in USA
            if (forbesCity.country !== 'USA') return false;

            // Direct match
            if (metro.name === forbesCity.name) return true;

            // Handle Washington D.C. variations
            if (forbesCity.name === 'Washington, D.C.' && metro.name === 'Washington DC') return true;

            // Handle other common variations
            const forbesNormalized = forbesCity.name.toLowerCase().replace(/[.,]/g, '').trim();
            const metroNormalized = metro.name.toLowerCase().replace(/[.,]/g, '').trim();

            return forbesNormalized === metroNormalized;
        });

        // Check if city exists in worldCities (any city in worldCities is considered visited)
        const worldCityMatch = worldCitiesData.find(worldCity =>
            worldCity.name === forbesCity.name
        );

        if (metroMatch || worldCityMatch) {
            // Use coordinates from the matched data source, or fall back to Forbes data
            let coords;
            if (metroMatch && metroMatch.coords) {
                coords = metroMatch.coords;
            } else if (worldCityMatch) {
                coords = [worldCityMatch.longitude, worldCityMatch.latitude];
            } else if (forbesCity.coords) {
                coords = forbesCity.coords;
            }

            completed.push({
                ...forbesCity,
                source: metroMatch ? 'metros' : 'worldCities',
                coords: coords
            });
        }
    });

    return completed;
}

function initializeForbesMap() {
    // Initialize the Forbes cities map
    forbesMap = L.map('forbes-cities-map', {
        gestureHandling: true,
        fullscreenControl: true
    }).setView([20, 0], 2);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(forbesMap);

    // Add Forbes markers
    addForbesMarkers();

    // Add Forbes legend
    addForbesLegend();
}

function initializeWondersMap() {
    // Initialize the combined Wonders map
    wondersMap = L.map('wonders-map', {
        gestureHandling: true,
        fullscreenControl: true
    }).setView([20, 0], 2);

    // Add tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(wondersMap);

    // Initialize layer groups
    layerGroups.sevenWonders = L.layerGroup().addTo(wondersMap);
    layerGroups.naturalWonders = L.layerGroup().addTo(wondersMap);
    layerGroups.wonderNominees = L.layerGroup();

    // Add all wonder markers
    addSevenWondersMarkers();
    addNaturalWondersMarkers();
    addWonderNomineesMarkers();

    // Add combined legend
    addWondersLegend();
}

function addForbesMarkers() {
    const completedCities = getCompletedForbesCities();
    const incompleteCities = forbes100Cities.filter(forbesCity =>
        !completedCities.some(completed => completed.name === forbesCity.name)
    );

    // Add markers for completed cities (green)
    completedCities.forEach(city => {
        if (city.coords) {
            const marker = L.circleMarker([city.coords[1], city.coords[0]], {
                radius: 8,
                fillColor: '#4CAF50',
                color: '#2E7D32',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.8
            }).addTo(forbesMap);

            marker.bindPopup(`
                <div class="popup-content">
                    <h3>${city.name}</h3>
                    <p><strong>Country:</strong> ${city.country}</p>
                    <p><strong>Status:</strong> ✅ Visited</p>
                    <p><strong>Source:</strong> ${city.source === 'metros' ? 'US Metros' : 'World Cities'}</p>
                </div>
            `);
        }
    });

    // Add markers for incomplete cities (red)
    incompleteCities.forEach(city => {
        if (city.coords) {
            const marker = L.circleMarker([city.coords[1], city.coords[0]], {
                radius: 6,
                fillColor: '#f44336',
                color: '#c62828',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.7
            }).addTo(forbesMap);

            marker.bindPopup(`
                <div class="popup-content">
                    <h3>${city.name}</h3>
                    <p><strong>Country:</strong> ${city.country}</p>
                    <p><strong>Status:</strong> ❌ Not Visited</p>
                    <p><strong>Forbes Rank:</strong> Top 100 City</p>
                </div>
            `);
        }
    });
}

function addSevenWondersMarkers() {
    sevenWondersData.sevenWonders.forEach(wonder => {
        if (wonder.coordinates) {
            const marker = L.circleMarker([wonder.coordinates.lat, wonder.coordinates.lng], {
                radius: 12,
                fillColor: wonder.visited ? '#FFD700' : '#FFA000',
                color: '#FF8F00',
                weight: 3,
                opacity: 1,
                fillOpacity: wonder.visited ? 0.9 : 0.7
            });

            marker.bindPopup(`
                <div class="popup-content">
                    <h3>${wonder.name}</h3>
                    <p><strong>Location:</strong> ${wonder.location}</p>
                    <p><strong>Built:</strong> ${wonder.yearBuilt}</p>
                    <p><strong>Status:</strong> ${wonder.visited ? '✅ Visited' : '❌ Not Visited'}</p>
                    <p><strong>Type:</strong> Seven Wonder of the World ${wonder.status === 'honorary' ? '(Honorary)' : ''}</p>
                </div>
            `);

            layerGroups.sevenWonders.addLayer(marker);
        }
    });
}

function addNaturalWondersMarkers() {
    sevenWondersData.sevenNaturalWonders.forEach(wonder => {
        if (wonder.coordinates) {
            const marker = L.circleMarker([wonder.coordinates.lat, wonder.coordinates.lng], {
                radius: 10,
                fillColor: wonder.visited ? '#2196F3' : '#1976D2',
                color: '#0D47A1',
                weight: 2,
                opacity: 1,
                fillOpacity: wonder.visited ? 0.9 : 0.7
            });

            marker.bindPopup(`
                <div class="popup-content">
                    <h3>${wonder.name}</h3>
                    <p><strong>Countries:</strong> ${wonder.countries.join(', ')}</p>
                    <p><strong>Status:</strong> ${wonder.visited ? '✅ Visited' : '❌ Not Visited'}</p>
                    <p><strong>Type:</strong> Seven Natural Wonder</p>
                </div>
            `);

            layerGroups.naturalWonders.addLayer(marker);
        }
    });
}

function addWonderNomineesMarkers() {
    sevenWondersData.sevenNaturalWondersNominees.forEach(nominee => {
        if (nominee.coordinates) {
            const marker = L.circleMarker([nominee.coordinates.lat, nominee.coordinates.lng], {
                radius: 6,
                fillColor: nominee.visited ? '#9C27B0' : '#7B1FA2',
                color: '#4A148C',
                weight: 1,
                opacity: 1,
                fillOpacity: nominee.visited ? 0.8 : 0.6
            });

            marker.bindPopup(`
                <div class="popup-content">
                    <h3>${nominee.name}</h3>
                    <p><strong>Countries:</strong> ${nominee.countries.join(', ')}</p>
                    <p><strong>Status:</strong> ${nominee.visited ? '✅ Visited' : '❌ Not Visited'}</p>
                    <p><strong>Type:</strong> Natural Wonder Nominee</p>
                </div>
            `);

            layerGroups.wonderNominees.addLayer(marker);
        }
    });
}

function setupWondersToggleControls() {
    const toggles = {
        'toggle-seven-wonders': layerGroups.sevenWonders,
        'toggle-natural-wonders': layerGroups.naturalWonders,
        'toggle-wonder-nominees': layerGroups.wonderNominees
    };

    Object.keys(toggles).forEach(toggleId => {
        const checkbox = document.getElementById(toggleId);
        checkbox.addEventListener('change', function () {
            if (this.checked) {
                wondersMap.addLayer(toggles[toggleId]);
            } else {
                wondersMap.removeLayer(toggles[toggleId]);
            }
        });
    });
}

function addForbesLegend() {
    const legend = L.control({ position: 'bottomright' });

    legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'legend');
        div.innerHTML = `
            <div class="legend-item">
                <span class="legend-marker visited"></span>
                <span>Visited</span>
            </div>
            <div class="legend-item">
                <span class="legend-marker not-visited"></span>
                <span>Not Visited</span>
            </div>
        `;
        return div;
    };

    legend.addTo(forbesMap);
}

function addWondersLegend() {
    const legend = L.control({ position: 'bottomright' });

    legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'legend');
        div.innerHTML = `
            <div class="legend-item">
                <span class="legend-marker seven-wonder"></span>
                <span>Seven Wonder</span>
            </div>
            <div class="legend-item">
                <span class="legend-marker natural-wonder"></span>
                <span>Natural Wonder</span>
            </div>
            <div class="legend-item">
                <span class="legend-marker wonder-nominee"></span>
                <span>Wonder Nominee</span>
            </div>
        `;
        return div;
    };

    legend.addTo(wondersMap);
}

document.addEventListener('DOMContentLoaded', function () {

    Promise.all([
        fetch('data/countries.json').then(response => response.json()),
        fetch('data/worldCities.json').then(response => response.json()),
        fetch('data/metros.json').then(response => response.json()),
        fetch('data/worldHighPoints.json').then(response => response.json())
    ])
        .then(([worldData, citiesData, metrosData, highPointsData]) => {
            displayWorldTravelSummary(worldData);
            const worldBounds = L.latLngBounds(
                L.latLng(-60, -180),
                L.latLng(85, 180)
            );
            createWorldMap('world-map', worldData, citiesData, metrosData, highPointsData, 20, 0, 2, worldBounds);
        })
        .catch(error => console.error('Error loading data:', error));

});

function displayWorldTravelSummary(worldData) {
    const summaryContainer = document.getElementById('travel-summary');
    if (!summaryContainer) return;

    const continents = [
        { key: 'northAmericanCountries', label: 'North America' },
        { key: 'southAmericanCountries', label: 'South America' },
        { key: 'europeanCountries', label: 'Europe' },
        { key: 'asianCountries', label: 'Asia' },
        { key: 'africanCountries', label: 'Africa' },
        { key: 'oceaniaCountries', label: 'Oceania' }
    ];

    let totalCountries = 0;
    let totalVisited = 0;
    const stats = continents.map(c => {
        const countries = worldData[c.key];
        const visited = countries.filter(x => x.visited).length;
        totalCountries += countries.length;
        totalVisited += visited;
        return { label: c.label, visited, total: countries.length, pct: ((visited / countries.length) * 100).toFixed(0) };
    });

    const totalPct = ((totalVisited / totalCountries) * 100).toFixed(0);

    summaryContainer.innerHTML = `
        <div class="summary-stats-container">
            <div class="summary-stat world-summary">
                <div class="stat-number-container">
                    <span class="stat-number">${totalVisited}</span>
                    <span class="stat-total">/${totalCountries}</span>
                    <span class="stat-percentage">(${totalPct}%)</span>
                </div>
                <span class="stat-label">Countries Visited</span>
            </div>
            <div class="other-stats">
                ${stats.map(s => `
                    <div class="summary-stat">
                        <div class="stat-number-container">
                            <span class="stat-number">${s.visited}</span>
                            <span class="stat-total">/${s.total}</span>
                            <span class="stat-percentage">(${s.pct}%)</span>
                        </div>
                        <span class="stat-label">${s.label}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function createWorldMap(mapId, worldData, citiesData, metrosData, highPointsData, centerLat, centerLng, zoom, bounds) {
    const map = L.map(mapId, {
        center: [centerLat, centerLng],
        zoom: zoom,
        zoomSnap: 0.1,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 120,
        gestureHandling: true,
        fullscreenControl: true
    });

    // Disable gesture handling in fullscreen mode
    map.on('fullscreenchange', () => {
        if (map.isFullscreen()) {
            map.gestureHandling.disable();
        } else {
            map.gestureHandling.enable();
        }
    });

    // Use your existing tile layer
    L.tileLayer('https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=bc2ceac04cab454da559aaacefe3582f', {
        attribution: '&copy; <a href="http://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 22
    }).addTo(map);

    // Fetch GeoJSON from Natural Earth
    fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson')
        .then(response => response.json())
        .then(geojson => {
            L.geoJSON(geojson, {
                style: function (feature) {
                    const countryName = feature.properties.ADMIN;
                    const isHome = isHomeCountry(countryName);
                    const isVisited = isCountryVisited(countryName, worldData);

                    let fillColor;
                    if (isHome) {
                        fillColor = '#FFC107'; // Yellow for home country
                    } else if (isVisited) {
                        fillColor = '#4CAF50'; // Green for visited
                    } else {
                        fillColor = '#f44336'; // Red for not visited
                    }

                    return {
                        fillColor: fillColor,
                        weight: 1,
                        opacity: 1,
                        color: 'white',
                        fillOpacity: 0.7
                    };
                },
                onEachFeature: function (feature, layer) {
                    const countryName = feature.properties.ADMIN;
                    const countryData = getCountryData(countryName, worldData);
                    const isHome = isHomeCountry(countryName);

                    let status;
                    if (isHome) {
                        status = 'Home';
                    } else if (countryData && countryData.visited) {
                        status = 'Visited';
                    } else {
                        status = 'Not yet Visited';
                    }

                    layer.bindPopup(`
                        <strong>${countryName}</strong><br>
                        Population: ${countryData ? countryData.population.toLocaleString() : 'N/A'}<br>
                        Status: ${status}
                    `);
                }
            }).addTo(map);
        });

    // Add city markers
    addCityMarkers(map, citiesData);

    // Add metro markers (all visited metros)
    addMetroMarkers(map, metrosData);

    // Add high points markers
    addHighPointsMarkers(map, highPointsData);

    createWorldLegend(map);
}

function addCityMarkers(map, citiesData) {
    // Create a custom icon for cities
    const cityIcon = L.divIcon({
        className: 'city-marker',
        html: '<div class="city-marker-inner">●</div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -8]
    });

    citiesData.visitedCities.forEach(city => {
        const marker = L.marker([city.latitude, city.longitude], { icon: cityIcon })
            .addTo(map);

        marker.bindPopup(`
            <div class="city-popup">
                <h3>${city.name}</h3>
                <p><strong>Country:</strong> ${city.country}</p>
                <p><strong>Population:</strong> ${city.population.toLocaleString()}</p>
                <p>${city.description}</p>
            </div>
        `);
    });
}

function addMetroMarkers(map, metrosData) {
    // Use the same icon as cities (blue dots)
    const metroIcon = L.divIcon({
        className: 'city-marker',
        html: '<div class="city-marker-inner">●</div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -8]
    });

    // Filter to all visited metros
    const visitedMetros = metrosData
        .filter(metro => metro.visited)
        .sort((a, b) => a.rank - b.rank);

    visitedMetros.forEach(metro => {
        const marker = L.marker([metro.coords[1], metro.coords[0]], { icon: metroIcon })
            .addTo(map);

        marker.bindPopup(`
            <div class="city-popup">
                <h3>${metro.name}</h3>
                <p><strong>Metro Area:</strong> ${metro.metro_name}</p>
                <p><strong>Rank:</strong> #${metro.rank} in US</p>
                <p><strong>State:</strong> ${metro.state}</p>
                <p><strong>Population:</strong> ${metro.population}</p>
            </div>
        `);
    });
}

function addHighPointsMarkers(map, highPointsData) {
    // Create a custom triangle icon for high points
    const highPointIcon = L.divIcon({
        className: 'high-point-marker',
        html: '<div class="high-point-marker-inner">▲</div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -7]
    });

    highPointsData.countryHighPoints.forEach(highPoint => {
        const marker = L.marker([highPoint.latitude, highPoint.longitude], {
            icon: highPointIcon,
            zIndexOffset: 1000
        })
            .addTo(map);

        marker.bindPopup(`
            <div class="high-point-popup">
                <h3>${highPoint.name}</h3>
                <p><strong>Country:</strong> ${highPoint.country}</p>
                <p><strong>Elevation:</strong> ${highPoint.elevation.toLocaleString()} ${highPoint.elevationUnit}</p>
                <p>${highPoint.description}</p>
            </div>
        `);
    });
}

function createWorldLegend(map) {
    const legend = L.control({ position: 'bottomright' });

    legend.onAdd = function (map) {
        const div = L.DomUtil.create('div', 'info legend');
        div.innerHTML = `
            <div><span class="legend-swatch" style="background-color: rgba(255, 193, 7, 0.9);"></span> Home Country</div>
            <div><span class="legend-swatch" style="background-color: rgba(76, 175, 80, 0.9);"></span> Visited Countries</div>
            <div><span class="legend-swatch" style="background-color: rgba(244, 67, 54, 0.9);"></span> Not yet Visited</div>
            <div><span class="legend-symbol" style="color: #2196F3;">●</span> Visited Cities</div>
            <div><span class="legend-symbol" style="color: #9C27B0;">▲</span> Country High Points</div>
        `;
        return div;
    };

    legend.addTo(map);
}

function isHomeCountry(countryName) {
    // Define home country - can be easily modified if needed
    return countryName === 'United States of America';
}

function isCountryVisited(countryName, worldData) {
    const continents = ['northAmericanCountries', 'southAmericanCountries',
        'europeanCountries', 'africanCountries',
        'asianCountries', 'oceaniaCountries'];

    for (const continent of continents) {
        const country = worldData[continent].find(c => c.name === countryName);
        if (country && country.visited) return true;
    }
    return false;
}

function getCountryData(countryName, worldData) {
    const continents = ['northAmericanCountries', 'southAmericanCountries',
        'europeanCountries', 'africanCountries',
        'asianCountries', 'oceaniaCountries'];

    for (const continent of continents) {
        const country = worldData[continent].find(c => c.name === countryName);
        if (country) return country;
    }
    return null;
}

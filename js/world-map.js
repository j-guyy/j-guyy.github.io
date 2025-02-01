
document.addEventListener('DOMContentLoaded', function () {

    fetch('data/countries.json')
        .then(response => response.json())
        .then(worldData => {
            const worldBounds = L.latLngBounds(
                L.latLng(-60, -180),
                L.latLng(85, 180)
            );
            createWorldMap('world-map', worldData, 20, 0, 2, worldBounds);
        })
        .catch(error => console.error('Error loading countries data:', error));

});

function createWorldMap(mapId, worldData, centerLat, centerLng, zoom, bounds) {
    const map = L.map(mapId, {
        center: [centerLat, centerLng],
        zoom: zoom,
        minZoom: 2,
        maxZoom: 8,
        maxBounds: bounds,
        maxBoundsViscosity: 1.0,
        zoomSnap: 0.1,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 120
    });

    // Use your existing tile layer
    L.tileLayer('https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=bc2ceac04cab454da559aaacefe3582f', {
        attribution: '&copy; <a href="http://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 22,
        bounds: bounds
    }).addTo(map);

    // Fetch GeoJSON from Natural Earth
    fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson')
        .then(response => response.json())
        .then(geojson => {
            L.geoJSON(geojson, {
                style: function (feature) {
                    const countryName = feature.properties.ADMIN;
                    const isVisited = isCountryVisited(countryName, worldData);
                    return {
                        fillColor: isVisited ? '#4CAF50' : '#f44336',
                        weight: 1,
                        opacity: 1,
                        color: 'white',
                        fillOpacity: 0.7
                    };
                },
                onEachFeature: function (feature, layer) {
                    const countryName = feature.properties.ADMIN;
                    const countryData = getCountryData(countryName, worldData);

                    layer.bindPopup(`
                        <strong>${countryName}</strong><br>
                        Population: ${countryData ? countryData.population.toLocaleString() : 'N/A'}<br>
                        Status: ${countryData && countryData.visited ? 'Visited' : 'Not yet visited'}
                    `);
                }
            }).addTo(map);
        });

    createWorldLegend(map);
}

function createWorldLegend(map) {
    const legend = L.control({ position: 'bottomright' });

    legend.onAdd = function (map) {
        const div = L.DomUtil.create('div', 'info legend');
        div.innerHTML = `
            <div style="background-color: rgba(76, 175, 80, 0.7); padding: 5px;">Visited</div>
            <div style="background-color: rgba(244, 67, 54, 0.7); padding: 5px;">Not yet visited</div>
        `;
        return div;
    };

    legend.addTo(map);
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

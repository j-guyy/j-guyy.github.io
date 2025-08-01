document.addEventListener('DOMContentLoaded', function () {
    Promise.all([
        fetch('data/colorado14ers.json').then(response => response.json()),
        fetch('data/adirondack46ers.json').then(response => response.json()),
        fetch('data/british-isles-high-five.json').then(response => response.json())
    ])
        .then(([colorado14ers, adirondack46ers, britishIsles]) => {
            createLeafletMap('colorado-map', colorado14ers, 39.1178, -106.4454, 7);
            createLeafletMap('adirondack-map', adirondack46ers, 44.1436, -73.9867, 9.8);
            createBritishIslesMap('british-isles-map', britishIsles);
        })
        .catch(error => console.error('Error loading the JSON files:', error));
});

function createLeafletMap(mapId, peaks, centerLat, centerLng, zoom) {
    const map = L.map(mapId, {
        center: [centerLat, centerLng],
        zoom: zoom,
        minZoom: zoom,
        maxZoom: 18,
        maxBoundsViscosity: 1.0,
        zoomSnap: 0.1,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 120,
        gestureHandling: true // Enable gesture handling
    });

    // Add fullscreen control using Leaflet.fullscreen
    map.addControl(new L.Control.Fullscreen());

    // Disable gesture handling in fullscreen mode
    map.on('fullscreenchange', () => {
        if (map.isFullscreen()) {
            map.gestureHandling.disable();
        } else {
            map.gestureHandling.enable();
        }
    });

    // Thunderforest Outdoors layer
    L.tileLayer('https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=bc2ceac04cab454da559aaacefe3582f', {
        attribution: '&copy; <a href="http://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 22
    }).addTo(map);

    peaks.forEach(peak => {
        L.marker([peak.coords[1], peak.coords[0]], {
            icon: L.divIcon({
                className: `peak-marker ${peak.climbed ? 'climbed' : 'not-climbed'}`,
                html: '▲',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(map).bindPopup(`<strong>${peak.name}</strong><br>${peak.elevation} ft<br>${peak.climbed ? 'Climbed' : 'Not yet climbed'}`);
    });

    createLegend(map);

    // Fit the map to the peaks
    const group = new L.featureGroup(peaks.map(peak => L.marker([peak.coords[1], peak.coords[0]])));
    map.fitBounds(group.getBounds());
}

function createBritishIslesMap(mapId, peaks) {
    const map = L.map(mapId, {
        center: [54.5, -4.5], // Center on British Isles
        zoom: 6.5,
        minZoom: 4,
        maxZoom: 18,
        maxBoundsViscosity: 1.0,
        zoomSnap: 0.1,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 120,
        gestureHandling: true
    });

    // Add fullscreen control
    map.addControl(new L.Control.Fullscreen());

    // Disable gesture handling in fullscreen mode
    map.on('fullscreenchange', () => {
        if (map.isFullscreen()) {
            map.gestureHandling.disable();
        } else {
            map.gestureHandling.enable();
        }
    });

    // Thunderforest Outdoors layer
    L.tileLayer('https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=bc2ceac04cab454da559aaacefe3582f', {
        attribution: '&copy; <a href="http://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 22
    }).addTo(map);

    peaks.forEach(peak => {
        L.marker([peak.coords[1], peak.coords[0]], {
            icon: L.divIcon({
                className: `peak-marker ${peak.climbed ? 'climbed' : 'not-climbed'}`,
                html: '▲',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(map).bindPopup(`<strong>${peak.name}</strong><br>${peak.country}<br>${peak.elevation}m<br>${peak.climbed ? 'Climbed' : 'Not yet climbed'}`);
    });

    createLegend(map);
}

function createLegend(map) {
    const legend = L.control({ position: 'bottomright' });

    legend.onAdd = function (map) {
        const div = L.DomUtil.create('div', 'info legend');
        div.innerHTML = `
            <div><span style="color: #4CAF50;">▲</span> Climbed</div>
            <div><span style="color: #f44336;">▲</span> Not yet climbed</div>
        `;
        return div;
    };

    legend.addTo(map);
}

function addMapLayers(map) {
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    }).addTo(map);

    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri',
        opacity: 0.7
    }).addTo(map);

    L.tileLayer('https://stamen-tiles-{s}.a.ssl.fastly.net/terrain-labels/{z}/{x}/{y}{r}.png', {
        attribution: 'Map tiles by <a href="http://stamen.com">Stamen Design</a>, <a href="http://creativecommons.org/licenses/by/3.0">CC BY 3.0</a> &mdash; Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        subdomains: 'abcd',
        opacity: 0.7,
        minZoom: 0,
        maxZoom: 18
    }).addTo(map);
}

function addMarkers(map, peaks) {
    peaks.forEach(peak => {
        L.marker([peak.coords[1], peak.coords[0]], {
            icon: L.divIcon({
                className: `peak-marker ${peak.climbed ? 'climbed' : 'not-climbed'}`,
                html: '▲',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(map).bindPopup(`<strong>${peak.name}</strong><br>${peak.elevation} ft<br>${peak.climbed ? 'Climbed' : 'Not yet climbed'}`);
    });
}

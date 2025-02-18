document.addEventListener('DOMContentLoaded', function () {
    const coloradoBounds = L.latLngBounds(
        L.latLng(36.5, -110.0),  // Southwest corner
        L.latLng(41.0, -103.0)   // Northeast corner
    );

    const adirondackBounds = L.latLngBounds(
        L.latLng(43.9, -74.4),   // Southwest corner
        L.latLng(44.5, -73.4)    // Northeast corner
    );

    createLeafletMap('colorado-map', colorado14ers, 39.1178, -106.4454, 7, coloradoBounds);
    createLeafletMap('adirondack-map', adirondack46ers, 44.1436, -73.9867, 9.8, adirondackBounds);
});

const colorado14ers = [
    { name: "Mount Elbert", elevation: 14433, coords: [-106.44547, 39.11777], climbed: false },
    { name: "Mount Massive", elevation: 14421, coords: [-106.47518, 39.18753], climbed: false },
    { name: "Mount Harvard", elevation: 14420, coords: [-106.32123, 38.92458], climbed: false },
    { name: "Blanca Peak", elevation: 14345, coords: [-105.48569, 37.57753], climbed: false },
    { name: "La Plata Peak", elevation: 14336, coords: [-106.47317, 39.02949], climbed: false },
    { name: "Uncompahgre Peak", elevation: 14309, coords: [-107.46211, 38.07168], climbed: false },
    { name: "Crestone Peak", elevation: 14294, coords: [-105.58567, 37.96679], climbed: false },
    { name: "Mount Lincoln", elevation: 14286, coords: [-106.11156, 39.35154], climbed: true },
    { name: "Grays Peak", elevation: 14270, coords: [-105.81759, 39.63379], climbed: true },
    { name: "Mount Antero", elevation: 14269, coords: [-106.2462, 38.67414], climbed: false },
    { name: "Torreys Peak", elevation: 14267, coords: [-105.82111, 39.64277], climbed: true },
    { name: "Castle Peak", elevation: 14265, coords: [-106.86144, 39.00972], climbed: false },
    { name: "Quandary Peak", elevation: 14265, coords: [-106.10644, 39.39725], climbed: true },
    { name: "Mount Blue Sky", elevation: 14264, coords: [-105.64358, 39.58835], climbed: true },
    { name: "Longs Peak", elevation: 14255, coords: [-105.6153, 40.25455], climbed: false },
    { name: "Mount Wilson", elevation: 14246, coords: [-107.99176, 37.83912], climbed: false },
    { name: "Mount Shavano", elevation: 14229, coords: [-106.23938, 38.61926], climbed: false },
    { name: "Mount Princeton", elevation: 14197, coords: [-106.24249, 38.74919], climbed: true },
    { name: "Mount Belford", elevation: 14197, coords: [-106.36064, 38.96062], climbed: true },
    { name: "Crestone Needle", elevation: 14197, coords: [-105.57667, 37.96468], climbed: false },
    { name: "Mount Yale", elevation: 14196, coords: [-106.31381, 38.8442], climbed: false },
    { name: "Mount Bross", elevation: 14172, coords: [-106.10735, 39.33517], climbed: true },
    { name: "Kit Carson Peak", elevation: 14165, coords: [-105.60253, 37.97958], climbed: false },
    { name: "Maroon Peak", elevation: 14156, coords: [-106.98908, 39.07084], climbed: false },
    { name: "Tabeguache Peak", elevation: 14155, coords: [-106.25067, 38.62545], climbed: false },
    { name: "Mount Oxford", elevation: 14153, coords: [-106.33879, 38.96477], climbed: true },
    { name: "Mount Sneffels", elevation: 14150, coords: [-107.79239, 38.00358], climbed: false },
    { name: "Mount Democrat", elevation: 14148, coords: [-106.13989, 39.33969], climbed: true },
    { name: "Capitol Peak", elevation: 14130, coords: [-107.08293, 39.15026], climbed: false },
    { name: "Pikes Peak", elevation: 14110, coords: [-105.04212, 38.84058], climbed: false },
    { name: "Snowmass Mountain", elevation: 14092, coords: [-107.06619, 39.11876], climbed: false },
    { name: "Windom Peak", elevation: 14087, coords: [-107.59158, 37.62122], climbed: false },
    { name: "Mount Eolus", elevation: 14083, coords: [-107.62301, 37.62287], climbed: false },
    { name: "Challenger Point", elevation: 14081, coords: [-105.60603, 37.98035], climbed: false },
    { name: "Mount Columbia", elevation: 14073, coords: [-106.29758, 38.90368], climbed: false },
    { name: "Missouri Mountain", elevation: 14067, coords: [-106.37785, 38.9477], climbed: false },
    { name: "Humboldt Peak", elevation: 14064, coords: [-105.55518, 37.97625], climbed: false },
    { name: "Mount Bierstadt", elevation: 14060, coords: [-105.66874, 39.58252], climbed: true },
    { name: "Sunlight Peak", elevation: 14059, coords: [-107.59571, 37.62736], climbed: false },
    { name: "Handies Peak", elevation: 14048, coords: [-107.50439, 37.91297], climbed: false },
    { name: "Culebra Peak", elevation: 14047, coords: [-105.18569, 37.12237], climbed: true },
    { name: "Ellingwood Point", elevation: 14042, coords: [-105.49253, 37.58251], climbed: false },
    { name: "Mount Lindsey", elevation: 14042, coords: [-105.49717, 37.58389], climbed: false },
    { name: "Little Bear Peak", elevation: 14037, coords: [-105.49726, 37.56668], climbed: false },
    { name: "Mount Sherman", elevation: 14036, coords: [-106.16988, 39.22508], climbed: true },
    { name: "Redcloud Peak", elevation: 14034, coords: [-107.42169, 37.94088], climbed: false },
    { name: "Pyramid Peak", elevation: 14018, coords: [-106.95018, 39.07149], climbed: false },
    { name: "Wilson Peak", elevation: 14017, coords: [-107.98469, 37.86035], climbed: false },
    { name: "Wetterhorn Peak", elevation: 14015, coords: [-107.5109, 38.06068], climbed: false },
    { name: "San Luis Peak", elevation: 14014, coords: [-106.93118, 37.98683], climbed: false },
    { name: "Mount of the Holy Cross", elevation: 14005, coords: [-106.47946, 39.46771], climbed: false },
    { name: "Huron Peak", elevation: 14003, coords: [-106.4382, 38.94543], climbed: true },
    { name: "Sunshine Peak", elevation: 14001, coords: [-107.42548, 37.92268], climbed: false },
    { name: "Mount Cameron", elevation: 14238, coords: [-106.11852, 39.34687], climbed: true },
    { name: "El Diente Peak", elevation: 14159, coords: [-108.00531, 37.83927], climbed: false },
    { name: "Conundrum Peak", elevation: 14060, coords: [-106.86396, 39.01555], climbed: false },
    { name: "North Eolus", elevation: 14039, coords: [-107.62044, 37.62505], climbed: false },
    { name: "North Maroon Peak", elevation: 14014, coords: [-106.98724, 39.07605], climbed: false }
];



const adirondack46ers = [
    { name: "Mount Marcy", elevation: 5344, coords: [-73.924000, 44.113000], climbed: true },
    { name: "Algonquin Peak", elevation: 5114, coords: [-73.987000, 44.144000], climbed: true },
    { name: "Mount Haystack", elevation: 4960, coords: [-73.901000, 44.106000], climbed: true },
    { name: "Mount Skylight", elevation: 4926, coords: [-73.931000, 44.099000], climbed: false },
    { name: "Whiteface Mountain", elevation: 4867, coords: [-73.903000, 44.366000], climbed: false },
    { name: "Dix Mountain", elevation: 4857, coords: [-73.786700, 44.082400], climbed: false },
    { name: "Gray Peak", elevation: 4840, coords: [-73.935000, 44.111000], climbed: false },
    { name: "Iroquois Peak", elevation: 4840, coords: [-73.999000, 44.137000], climbed: false },
    { name: "Basin Mountain", elevation: 4827, coords: [-73.887000, 44.121000], climbed: true },
    { name: "Gothics", elevation: 4736, coords: [-73.858000, 44.128000], climbed: true },
    { name: "Mount Colden", elevation: 4714, coords: [-73.960000, 44.127000], climbed: false },
    { name: "Giant Mountain", elevation: 4627, coords: [-73.720400, 44.161300], climbed: true },
    { name: "Nippletop", elevation: 4620, coords: [-73.816000, 44.089000], climbed: false },
    { name: "Santanoni Peak", elevation: 4607, coords: [-74.131000, 44.082000], climbed: false },
    { name: "Mount Redfield", elevation: 4606, coords: [-73.950000, 44.095000], climbed: false },
    { name: "Wright Peak", elevation: 4580, coords: [-73.981000, 44.152000], climbed: true },
    { name: "Saddleback Mountain", elevation: 4515, coords: [-73.875000, 44.126000], climbed: true },
    { name: "Panther Peak", elevation: 4442, coords: [-74.133000, 44.098000], climbed: false },
    { name: "TableTop Mountain", elevation: 4427, coords: [-73.916400, 44.140600], climbed: false },
    { name: "Rocky Peak Ridge", elevation: 4420, coords: [-73.705500, 44.154400], climbed: true },
    { name: "Macomb Mountain", elevation: 4405, coords: [-73.781000, 44.052000], climbed: false },
    { name: "Armstrong Mountain", elevation: 4400, coords: [-73.849700, 44.134600], climbed: true },
    { name: "Hough Peak", elevation: 4400, coords: [-73.778000, 44.069000], climbed: false },
    { name: "Seward Mountain", elevation: 4361, coords: [-74.199300, 44.159800], climbed: false },
    { name: "Mount Marshall", elevation: 4360, coords: [-74.011800, 44.127600], climbed: false },
    { name: "Allen Mountain", elevation: 4340, coords: [-73.939900, 44.070900], climbed: false },
    { name: "Big Slide Mountain", elevation: 4240, coords: [-73.870400, 44.182300], climbed: false },
    { name: "Esther Mountain", elevation: 4240, coords: [-73.889900, 44.387200], climbed: false },
    { name: "Upper Wolfjaw Mountain", elevation: 4185, coords: [-73.845300, 44.140400], climbed: true },
    { name: "Lower Wolfjaw Mountain", elevation: 4175, coords: [-73.832600, 44.148400], climbed: true },
    { name: "Street Mountain", elevation: 4166, coords: [-74.026960, 44.179430], climbed: false },
    { name: "Phelps Mountain", elevation: 4161, coords: [-73.921000, 44.157000], climbed: false },
    { name: "Mount Donaldson", elevation: 4140, coords: [-74.211600, 44.154000], climbed: false },
    { name: "Seymour Mountain", elevation: 4120, coords: [-74.172600, 44.158000], climbed: false },
    { name: "Sawteeth", elevation: 4100, coords: [-73.850400, 44.113900], climbed: false },
    { name: "Cascade Mountain", elevation: 4098, coords: [-73.860100, 44.218700], climbed: false },
    { name: "South Dix", elevation: 4060, coords: [-73.774300, 44.060100], climbed: false },
    { name: "Porter Mountain", elevation: 4059, coords: [-73.853800, 44.212400], climbed: false },
    { name: "Mount Colvin", elevation: 4057, coords: [-73.834300, 44.093900], climbed: false },
    { name: "Mount Emmons", elevation: 4040, coords: [-74.214300, 44.143800], climbed: false },
    { name: "Dial Mountain", elevation: 4020, coords: [-73.796000, 44.105900], climbed: false },
    { name: "Grace Peak", elevation: 4012, coords: [-73.757400, 44.065300], climbed: false },
    { name: "Blake Peak", elevation: 3960, coords: [-73.844500, 44.081300], climbed: false },
    { name: "Cliff Mountain", elevation: 3960, coords: [-73.975100, 44.103100], climbed: false },
    { name: "Nye Mountain", elevation: 3895, coords: [-74.023840, 44.187200], climbed: false },
    { name: "Couchsachraga Peak", elevation: 3820, coords: [-74.160300, 44.095500], climbed: false }
];


function createLeafletMap(mapId, peaks, centerLat, centerLng, zoom, bounds) {
    const map = L.map(mapId, {
        center: [centerLat, centerLng],
        zoom: zoom,
        minZoom: zoom,
        maxZoom: 18,
        maxBounds: bounds,
        maxBoundsViscosity: 1.0,
        zoomSnap: 0.1,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 120
    });

    // Thunderforest Outdoors layer
    L.tileLayer('https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=bc2ceac04cab454da559aaacefe3582f', {
        attribution: '&copy; <a href="http://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 22,
        bounds: bounds
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

    // Fit the map to the bounds
    map.fitBounds(bounds);
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

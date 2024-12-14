document.addEventListener('DOMContentLoaded', function () {
    const highPoints = [
        { name: "Mount Everest", country: "Nepal/China", lat: 27.9881, lon: 86.9250, elevation: 8848, visited: true, visitDate: { year: "2018", month: "06", day: "15" }, description: "Summited the highest peak in the world.", image: "https://example.com/everest.jpg" },
        { name: "Aconcagua", country: "Argentina", lat: -32.6532, lon: -70.0110, elevation: 6962, visited: true, visitDate: { year: "2019", month: "01", day: "10" }, description: "Reached the summit of the highest peak in South America.", image: "https://example.com/aconcagua.jpg" },
        { name: "Denali", country: "United States", lat: 63.0692, lon: -151.0070, elevation: 6190, visited: false, image: "https://example.com/denali.jpg" },
        { name: "Kilimanjaro", country: "Tanzania", lat: -3.0674, lon: 37.3556, elevation: 5895, visited: true, visitDate: { year: "2020", month: "08", day: "22" }, description: "Climbed the highest mountain in Africa.", image: "https://example.com/kilimanjaro.jpg" },
        { name: "Mont Blanc", country: "France/Italy", lat: 45.8326, lon: 6.8652, elevation: 4810, visited: false, image: "https://example.com/montblanc.jpg" }
    ];

    // Initialize the map
    const map = L.map('highPointsMap').setView([20, 0], 2);

    // Add the OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Custom icon for visited high points
    const visitedIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    // Custom icon for unvisited high points
    const unvisitedIcon = L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
    });

    // Add markers for each high point
    const markers = highPoints.map(point => {
        const marker = L.marker([point.lat, point.lon], {
            icon: point.visited ? visitedIcon : unvisitedIcon
        }).addTo(map);

        marker.bindPopup(`
            <strong>${point.name}</strong><br>
            Country: ${point.country}<br>
            Elevation: ${point.elevation}m<br>
            Status: ${point.visited ? 'Visited' : 'Not visited yet'}
        `);

        return marker;
    });

    // Center map button functionality
    document.getElementById('centerMap').addEventListener('click', () => {
        map.setView([20, 0], 2);
    });

    // Toggle visited/unvisited button functionality
    let showingAll = true;
    document.getElementById('toggleVisited').addEventListener('click', () => {
        if (showingAll) {
            markers.forEach((marker, index) => {
                if (!highPoints[index].visited) {
                    map.removeLayer(marker);
                }
            });
            showingAll = false;
        } else {
            markers.forEach((marker, index) => {
                if (!highPoints[index].visited) {
                    marker.addTo(map);
                }
            });
            showingAll = true;
        }
    });

    // Timeline.js implementation
    const timelineData = {
        events: highPoints.filter(point => point.visited).map(point => ({
            start_date: point.visitDate,
            text: {
                headline: point.name,
                text: point.description
            },
            media: {
                url: point.image,
                caption: `Summit of ${point.name}`
            }
        }))
    };

    const timeline = new TL.Timeline('timeline-embed', timelineData);
});

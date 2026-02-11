document.addEventListener('DOMContentLoaded', function () {
    fetch('data/skiResorts.json')
        .then(response => response.json())
        .then(resorts => {
            displaySkiSummary(resorts);
            createSkiMap(resorts);
            renderResortList(resorts, 'all');
            setupFilters(resorts);
        })
        .catch(error => console.error('Error loading ski resort data:', error));
});

function displaySkiSummary(resorts) {
    const container = document.getElementById('ski-summary');
    if (!container) return;

    const total = resorts.length;
    const visited = resorts.filter(r => r.visited).length;
    const pct = ((visited / total) * 100).toFixed(0);

    const continents = [...new Set(resorts.map(r => r.continent))];
    const stats = continents.map(c => {
        const group = resorts.filter(r => r.continent === c);
        const v = group.filter(r => r.visited).length;
        return { label: c, visited: v, total: group.length, pct: group.length > 0 ? ((v / group.length) * 100).toFixed(0) : 0 };
    });

    container.innerHTML = `
        <div class="summary-stats-container">
            <div class="summary-stat world-summary">
                <div class="stat-number-container">
                    <span class="stat-number">${visited}</span>
                    <span class="stat-total">/${total}</span>
                    <span class="stat-percentage">(${pct}%)</span>
                </div>
                <span class="stat-label">Resorts Visited</span>
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

let skiMap = null;
let allMarkers = [];
let currentMinDrop = 0;

function createSkiMap(resorts) {
    skiMap = L.map('ski-map', {
        center: [30, 0],
        zoom: 2,
        zoomSnap: 0.1,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 120,
        gestureHandling: true,
        fullscreenControl: true
    });

    skiMap.on('fullscreenchange', () => {
        if (skiMap.isFullscreen()) {
            skiMap.gestureHandling.disable();
        } else {
            skiMap.gestureHandling.enable();
        }
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(skiMap);

    addResortMarkers(resorts);
    createSkiLegend();
}

function addResortMarkers(resorts) {
    allMarkers = [];

    resorts.forEach(resort => {
        const color = resort.visited ? '#4CAF50' : '#2196F3';
        const icon = L.divIcon({
            className: 'ski-marker',
            html: `<div class="ski-marker-inner" style="color: ${color};">⛷</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
            popupAnchor: [0, -10]
        });

        const marker = L.marker([resort.coords[1], resort.coords[0]], { icon: icon })
            .addTo(skiMap);

        marker.bindPopup(`
            <div class="ski-popup">
                <h3>${resort.name}</h3>
                <p><strong>Location:</strong> ${resort.location}</p>
                <p><strong>Vertical Drop:</strong> ${resort.verticalDrop.toLocaleString()} ft</p>
                <p><strong>Trails:</strong> ${resort.trails}</p>
                <p><strong>Status:</strong> ${resort.visited ? '✅ Visited' : '🎯 Bucket List'}</p>
            </div>
        `);

        allMarkers.push({ marker, resort });
    });
}

function createSkiLegend() {
    const legend = L.control({ position: 'bottomright' });

    legend.onAdd = function () {
        const div = L.DomUtil.create('div', 'info legend');
        div.innerHTML = `
            <div><span class="legend-symbol" style="color: #4CAF50;">⛷</span> Visited</div>
            <div><span class="legend-symbol" style="color: #2196F3;">⛷</span> Bucket List</div>
        `;
        return div;
    };

    legend.addTo(skiMap);
}

function setupFilters(resorts) {
    // Map filter buttons
    document.querySelectorAll('.ski-filter-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.ski-filter-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            applyMapFilters();
        });
    });

    // Continent filter buttons for the list
    document.querySelectorAll('.continent-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.continent-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            renderResortList(resorts, this.dataset.continent);
        });
    });

    // Vertical drop slider
    const slider = document.getElementById('drop-slider');
    const dropLabel = document.getElementById('drop-value');
    if (slider) {
        slider.addEventListener('input', function () {
            currentMinDrop = parseInt(this.value);
            dropLabel.textContent = currentMinDrop.toLocaleString();
            applyMapFilters();
            const activeContinent = document.querySelector('.continent-btn.active');
            renderResortList(resorts, activeContinent ? activeContinent.dataset.continent : 'all');
        });
    }
}

function applyMapFilters() {
    const filter = document.querySelector('.ski-filter-btn.active')?.dataset.filter || 'all';

    allMarkers.forEach(({ marker, resort }) => {
        const passesVisited = filter === 'all' ||
            (filter === 'visited' && resort.visited) ||
            (filter === 'not-visited' && !resort.visited);
        const passesDrop = resort.verticalDrop >= currentMinDrop;

        if (passesVisited && passesDrop) {
            marker.addTo(skiMap);
        } else {
            skiMap.removeLayer(marker);
        }
    });
}

function renderResortList(resorts, continent) {
    const container = document.getElementById('ski-resort-list');
    if (!container) return;

    let filtered = continent === 'all' ? resorts : resorts.filter(r => r.continent === continent);
    filtered = filtered.filter(r => r.verticalDrop >= currentMinDrop);
    const visited = filtered.filter(r => r.visited);
    const notVisited = filtered.filter(r => !r.visited);

    container.innerHTML = `
        <div class="resort-grid">
            ${[...visited, ...notVisited].map(resort => `
                <div class="resort-card ${resort.visited ? 'visited' : 'not-visited'}">
                    <div class="resort-status">${resort.visited ? '✅' : '🎯'}</div>
                    <div class="resort-info">
                        <h3>${resort.name}</h3>
                        <p class="resort-location">${resort.location}</p>
                        <div class="resort-stats">
                            <span>↕ ${resort.verticalDrop.toLocaleString()} ft</span>
                            <span>🎿 ${resort.trails} trails</span>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}
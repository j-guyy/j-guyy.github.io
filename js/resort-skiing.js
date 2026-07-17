// Resort Skiing page: visit log (by date / by location) + world resort map and list,
// all driven by data/skiResorts.json. Resorts with a `visits` array are the personal
// visit log; `visited: true` alone marks resorts skied but not logged.

// Flat visit log derived from the JSON: one entry per resort per year.
// repeat: true = this resort was visited in a prior year.
let visitLog = [];

// Total ski days per resort across all years
let visitCounts = {};

// Region display order for location view
const regionOrder = [
    "California",
    "Colorado",
    "Montana & Wyoming",
    "Northeast",
    "Pacific Northwest",
    "Utah",
    "Canada",
    "Alps",
];

document.addEventListener('DOMContentLoaded', function () {
    fetch('../data/skiResorts.json')
        .then(response => response.json())
        .then(resorts => {
            buildVisitLog(resorts);
            setView(currentView);
            displaySkiSummary(resorts);
            createSkiMap(resorts);
            renderResortList(resorts, 'all');
            setupFilters(resorts);
        })
        .catch(error => console.error('Error loading ski resort data:', error));
});

function buildVisitLog(resorts) {
    visitLog = [];
    visitCounts = {};
    resorts.forEach(resort => {
        if (!resort.visits) return;
        resort.visits.forEach((visit, i) => {
            visitLog.push({
                name: resort.name,
                year: visit.year,
                days: visit.days,
                location: resort.location,
                region: resort.region,
                repeat: i > 0
            });
        });
        visitCounts[resort.name] = resort.visits.reduce((sum, v) => sum + v.days, 0);
    });
}

// ---------- Visit log views ----------

// tokenDays: days to display in the circular token (show badge instead if <= 1)
function makeCard(resort, subtitleText, tokenDays) {
    const cardClass = resort.repeat ? 'repeat' : 'summited';
    const totalDays = visitCounts[resort.name];

    const tokenHtml = tokenDays > 1
        ? `<span class="visit-token">${tokenDays}</span>`
        : `<span class="peak-badge ${cardClass}">Visited</span>`;

    const totalHtml = totalDays > 1
        ? `<div class="visit-total">${totalDays} days total</div>`
        : '';

    return `
        <div class="peak-card ${cardClass}">
            <div class="peak-card-header">
                <h3>${resort.name}</h3>
                ${tokenHtml}
            </div>
            <div class="peak-date">${subtitleText}</div>
            ${totalHtml}
        </div>`;
}

function renderTally() {
    const unique    = Object.keys(visitCounts).length;
    const totalDays = Object.values(visitCounts).reduce((a, b) => a + b, 0);
    const top3      = Object.entries(visitCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

    return `<div class="tally-section">
        <div class="tally-stat"><strong>${unique}</strong> unique resorts</div>
        <div class="tally-stat"><strong>${totalDays}</strong> total days</div>
        <div class="tally-most-visited">
            <span class="tally-mv-label">Most Visited:</span>
            ${top3.map(([name, n]) => `<span class="tally-mv-tag">${name} ×${n}</span>`).join('')}
        </div>
    </div>`;
}

function renderByDate() {
    const byYear = {};
    visitLog.forEach(r => {
        if (!byYear[r.year]) byYear[r.year] = [];
        byYear[r.year].push(r);
    });
    const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);
    return years.map(year => {
        const items         = byYear[year];
        const newResorts    = items.filter(r => !r.repeat);
        const repeatResorts = items.filter(r =>  r.repeat);
        const subtitle      = r => `${r.year} — ${r.location}`;
        const cards         = group => group.map(r => makeCard(r, subtitle(r), r.days)).join('');

        if (newResorts.length === 0) {
            return `
                <div class="section-divider"><h2>${year}</h2></div>
                <div class="section-divider" style="margin-top:0"><h3>Repeat</h3></div>
                <div class="peaks-grid">${cards(repeatResorts)}</div>`;
        }
        if (repeatResorts.length === 0) {
            return `
                <div class="section-divider"><h2>${year}</h2></div>
                <div class="peaks-grid">${cards(newResorts)}</div>`;
        }
        return `
            <div class="section-divider"><h2>${year}</h2></div>
            <div class="section-divider" style="margin-top:0"><h3>New</h3></div>
            <div class="peaks-grid">${cards(newResorts)}</div>
            <div class="section-divider" style="margin-top:0"><h3>Repeat</h3></div>
            <div class="peaks-grid">${cards(repeatResorts)}</div>`;
    }).join('');
}

function renderByLocation() {
    const byRegion = {};
    visitLog.forEach(r => {
        if (!byRegion[r.region]) byRegion[r.region] = [];
        const already = byRegion[r.region].find(x => x.name === r.name);
        if (already) {
            already._years.push(r.year);
            already._totalDays += r.days;
            if (r.repeat) already.repeat = true;
        } else {
            byRegion[r.region].push({ ...r, _years: [r.year], _totalDays: r.days });
        }
    });
    return regionOrder
        .filter(reg => byRegion[reg])
        .map(reg => {
            const cards = byRegion[reg].map(r => {
                const subtitle = `${r._years.join(', ')} — ${r.location}`;
                return makeCard(r, subtitle, r._totalDays);
            }).join('');
            return `
                <div class="section-divider"><h2>${reg}</h2></div>
                <div class="peaks-grid">${cards}</div>`;
        }).join('');
}

let currentView = 'date';

function setView(view) {
    currentView = view;
    document.getElementById('tally').innerHTML = renderTally();
    document.getElementById('resort-sections').innerHTML =
        view === 'date' ? renderByDate() : renderByLocation();
    document.getElementById('btn-date').classList.toggle('active', view === 'date');
    document.getElementById('btn-location').classList.toggle('active', view === 'location');
}

// ---------- World resort map and list ----------

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
        tap: false,  // avoid Leaflet's synthetic-click delay, which breaks the fullscreen gesture on mobile
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

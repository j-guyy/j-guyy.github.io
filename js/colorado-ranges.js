// Region accent colors (CSS custom property injected per card)
const REGION_COLORS = {
    'Northwest Colorado':                    '#e67e22',
    'North-Central Colorado & Front Range':  '#3498db',
    'I-70 Corridor & Central Mountains':     '#f1c40f',
    'Sawatch Range & Central Colorado':      '#9b59b6',
    'South-Central Colorado':               '#1abc9c',
    'San Juan Mountains':                    '#e74c3c',
    'Southern Front Range & Foothills':      '#e91e8c'
};

let rangesData = [];
let map = null;
let markers = {}; // id → Leaflet marker
let activeRowId = null;

// Sort state for the table
const sortState = { col: 'name', dir: 'asc' };

document.addEventListener('DOMContentLoaded', function () {
    // Initialize the map canvas immediately — don't wait for data
    initMap();

    fetch('/data/coloradoRanges.json')
        .then(r => r.json())
        .then(data => {
            rangesData = data;
            document.getElementById('hero-subtitle').textContent =
                data.length + ' Ranges · Best Hike & Best Bike Ride';
            renderProgress();
            renderRegionStats();
            addMapMarkers();
            renderTable();
        })
        .catch(err => console.error('Error loading coloradoRanges.json:', err));

    // Region filter
    document.getElementById('region-filter').addEventListener('change', function () {
        closeDetail();
        renderTable();
    });
});

// ── Progress ──────────────────────────────────────────────────────────────────

function renderProgress() {
    const total     = rangesData.length;
    const explored  = rangesData.filter(r => r.explored).length;
    const remaining = total - explored;
    const pct       = total > 0 ? ((explored / total) * 100).toFixed(1) : 0;

    const bar = document.getElementById('progress-bar');
    bar.style.width = Math.max(pct, 2) + '%';
    bar.textContent = explored + ' / ' + total;

    document.getElementById('progress-stats').innerHTML =
        '<div><span>' + explored  + '</span> Explored</div>' +
        '<div><span>' + remaining + '</span> Remaining</div>' +
        '<div><span>' + pct + '%</span> Complete</div>';
}

// ── Region Stats ──────────────────────────────────────────────────────────────

function renderRegionStats() {
    const regions = {};
    rangesData.forEach(r => {
        if (!regions[r.region]) regions[r.region] = { total: 0, explored: 0 };
        regions[r.region].total++;
        if (r.explored) regions[r.region].explored++;
    });

    const grid = document.getElementById('region-stats');
    grid.innerHTML = Object.entries(regions).map(([name, counts]) => {
        const color = REGION_COLORS[name] || '#888';
        return `
            <div class="region-stat-card" style="--region-color: ${color}">
                <div class="region-stat-name">${name}</div>
                <div>
                    <span class="region-stat-count">${counts.explored}</span>
                    <span class="region-stat-total">/ ${counts.total}</span>
                </div>
            </div>`;
    }).join('');
}

// ── Map ───────────────────────────────────────────────────────────────────────

function initMap() {
    map = L.map('ranges-map', {
        center: [39.0, -106.0],
        zoom: 7,
        minZoom: 6,
        maxZoom: 18,
        gestureHandling: true
    });

    // Fullscreen control is optional — guard so a missing plugin doesn't abort init
    if (L.Control.Fullscreen) {
        map.addControl(new L.Control.Fullscreen());
        map.on('fullscreenchange', () => {
            if (map.isFullscreen()) {
                map.gestureHandling.disable();
            } else {
                map.gestureHandling.enable();
            }
        });
    }

    L.tileLayer('https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=bc2ceac04cab454da559aaacefe3582f', {
        attribution: '&copy; <a href="http://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 22
    }).addTo(map);
}

function addMapMarkers() {
    if (!map) return;

    rangesData.forEach(range => {
        const marker = L.circleMarker(
            [range.coords[1], range.coords[0]],
            {
                radius: 7,
                fillColor: range.explored ? '#4CAF50' : '#888',
                color: range.explored ? '#2E7D32' : '#555',
                weight: 2,
                opacity: 1,
                fillOpacity: 0.85
            }
        );

        marker.bindPopup(buildPopupHtml(range), { maxWidth: 280 });
        marker.on('click', () => openDetail(range.id, false));
        marker.addTo(map);
        markers[range.id] = marker;
    });
}

function buildPopupHtml(range) {
    return `
        <div class="popup-name">${range.name}</div>
        <div class="popup-region">${range.region}</div>
        <div class="popup-elevation">↑ ${range.elevation_low.toLocaleString()}–${range.elevation_high.toLocaleString()} ft</div>
        <div class="popup-elevation">Highpoint: ${range.highpoint}</div>
        <div class="popup-status ${range.explored ? 'explored' : 'not-explored'}">
            ${range.explored ? '✅ Explored' : '⬜ Not yet explored'}
        </div>`;
}

function flyToRange(range) {
    if (!map) return;
    map.flyTo([range.coords[1], range.coords[0]], 9, { duration: 0.8 });
    setTimeout(() => {
        if (markers[range.id]) markers[range.id].openPopup();
    }, 900);
}

// ── Table ─────────────────────────────────────────────────────────────────────

function filteredData() {
    const regionVal = document.getElementById('region-filter').value;
    return rangesData.filter(r => !regionVal || r.region === regionVal);
}

function sortedData(data) {
    const { col, dir } = sortState;
    return [...data].sort((a, b) => {
        let aVal = a[col];
        let bVal = b[col];

        if (typeof aVal === 'boolean') { aVal = aVal ? 1 : 0; bVal = bVal ? 1 : 0; }

        if (typeof aVal === 'string') {
            const cmp = aVal.localeCompare(bVal);
            return dir === 'asc' ? cmp : -cmp;
        }
        return dir === 'asc' ? aVal - bVal : bVal - aVal;
    });
}

const TABLE_HEADERS = [
    { label: 'Range',        key: 'name'            },
    { label: 'Region',       key: 'region'          },
    { label: 'Max Elev (ft)',key: 'elevation_high'  },
    { label: 'Highpoint',    key: 'highpoint'       },
    { label: 'Explored',     key: 'explored'        }
];

function renderTable() {
    const container = document.getElementById('table-container');
    container.innerHTML = '';

    const data = sortedData(filteredData());

    const table = document.createElement('table');
    table.className = 'travel-table';

    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');

    TABLE_HEADERS.forEach(({ label, key }) => {
        const th = document.createElement('th');
        const isActive = sortState.col === key;
        th.classList.add('sortable');
        if (isActive) th.classList.add('sort-active');

        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = isActive ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅';

        th.appendChild(document.createTextNode(label));
        th.appendChild(indicator);

        th.addEventListener('click', () => {
            if (sortState.col === key) {
                sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
            } else {
                const defaultDir = (key === 'explored' || key === 'elevation_high') ? 'desc' : 'asc';
                sortState.col = key;
                sortState.dir = defaultDir;
            }
            closeDetail();
            renderTable();
        });

        headerRow.appendChild(th);
    });

    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    data.forEach(range => {
        const row = document.createElement('tr');
        row.className = range.explored ? 'visited' : 'not-visited';
        if (range.id === activeRowId) row.classList.add('row-active');

        const regionColor = REGION_COLORS[range.region] || '#888';

        row.innerHTML = `
            <td style="border-left: 3px solid ${regionColor}; padding-left: 14px;">${range.name}</td>
            <td>${range.region}</td>
            <td>${range.elevation_high.toLocaleString()}</td>
            <td>${range.highpoint}</td>
            <td style="text-align:center">${range.explored ? '✅' : '⬜'}</td>
        `;

        row.style.cursor = 'pointer';
        row.addEventListener('click', () => openDetail(range.id, true));
        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    container.appendChild(table);
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function openDetail(id, panToMap) {
    const range = rangesData.find(r => r.id === id);
    if (!range) return;

    activeRowId = id;

    // Split best_hike and best_bike at ' — ' to separate name from description
    function splitActivity(text) {
        const sep = text.indexOf(' — ');
        if (sep === -1) return { name: text, desc: '' };
        return { name: text.slice(0, sep), desc: text.slice(sep + 3) };
    }

    const hike = splitActivity(range.best_hike);
    const bike = splitActivity(range.best_bike);

    const panel = document.getElementById('range-detail');
    panel.style.display = 'block';
    panel.innerHTML = `
        <div class="detail-header">
            <h3 class="detail-name">${range.name}</h3>
            <button class="detail-close" onclick="closeDetail()">✕ Close</button>
        </div>
        <div class="detail-meta">
            <div class="detail-meta-item"><strong>Region:</strong> ${range.region}</div>
            <div class="detail-meta-item"><strong>Highpoint:</strong> ${range.highpoint}</div>
            <div class="detail-meta-item"><strong>Elevation:</strong> ${range.elevation_low.toLocaleString()}–${range.elevation_high.toLocaleString()} ft</div>
            <div class="detail-meta-item"><strong>Status:</strong> ${range.explored ? '✅ Explored' : '⬜ Not yet'}</div>
        </div>
        <p class="detail-description">${range.description}</p>
        <div class="detail-activities">
            <div class="detail-activity">
                <div class="detail-activity-title">🥾 Best Hike</div>
                <div class="detail-activity-name">${hike.name}</div>
                ${hike.desc ? `<div class="detail-activity-desc">${hike.desc}</div>` : ''}
            </div>
            <div class="detail-activity">
                <div class="detail-activity-title">🚲 Best Bike Ride</div>
                <div class="detail-activity-name">${bike.name}</div>
                ${bike.desc ? `<div class="detail-activity-desc">${bike.desc}</div>` : ''}
            </div>
        </div>`;

    // Re-render table to update active highlight
    renderTable();

    if (panToMap) {
        flyToRange(range);
        document.getElementById('ranges-map').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function closeDetail() {
    activeRowId = null;
    const panel = document.getElementById('range-detail');
    panel.style.display = 'none';
    panel.innerHTML = '';
    renderTable();
}

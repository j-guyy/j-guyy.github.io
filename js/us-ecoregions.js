// US Ecoregions page — EPA Level IV polygons for the contiguous US.
// Loads TopoJSON (~430KB gzipped) for transfer efficiency, decodes to
// GeoJSON in-browser, and renders to an HTML5 canvas via Leaflet.
// Polygons are colored by Level III (US_L3CODE), legend is grouped by
// Level I biome (NA_L1NAME). Level IV detail surfaces in click popups.

const TOPOJSON_URL = '/data/us-ecoregions.topojson';
const CONUS_CENTER = [39.5, -98.5];
const CONUS_ZOOM = 4;

let map = null;
let ecoLayer = null;
let allFeatures = [];
let l3ColorMap = {};
let l1ColorMap = {};
let activeL3 = null;
let activeLayers = []; // layers currently highlighted by search/legend click

document.addEventListener('DOMContentLoaded', function () {
    initMap();
    loadData();

    document.getElementById('toggle-fill').addEventListener('change', e => {
        if (!ecoLayer) return;
        ecoLayer.eachLayer(l => {
            l.setStyle({ fillOpacity: e.target.checked ? 0.6 : 0 });
        });
    });

    document.getElementById('eco-search').addEventListener('input', e => {
        applySearch(e.target.value.trim().toLowerCase());
    });
});

function initMap() {
    map = L.map('eco-map', {
        center: CONUS_CENTER,
        zoom: CONUS_ZOOM,
        preferCanvas: true, // critical for 5,847 polygons
        gestureHandling: true,
        fullscreenControl: true,
        worldCopyJump: false
    });

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© OpenStreetMap contributors © CARTO',
        maxZoom: 18,
        subdomains: 'abcd'
    }).addTo(map);
}

function setStatus(msg) {
    const el = document.getElementById('eco-status');
    if (el) el.textContent = msg;
}

function loadData() {
    setStatus('Loading 5,847 polygons…');
    fetch(TOPOJSON_URL)
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(topo => {
            const objKey = Object.keys(topo.objects)[0];
            const geojson = topojson.feature(topo, topo.objects[objKey]);
            allFeatures = geojson.features;
            buildColorMaps(allFeatures);
            renderLayer(geojson);
            renderLegend();
            renderSummary();
            setStatus(allFeatures.length.toLocaleString() + ' polygons loaded');
        })
        .catch(err => {
            console.error('Could not load ecoregion data:', err);
            setStatus('Error loading data — see console.');
        });
}

// ── Color generation ────────────────────────────────────────────────────────
// Stable hash → HSL so the same code always gets the same hue across reloads.

function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function colorForKey(key, sat, light) {
    const hue = hashString(key) % 360;
    return `hsl(${hue}, ${sat}%, ${light}%)`;
}

function buildColorMaps(features) {
    features.forEach(f => {
        const p = f.properties;
        if (!l3ColorMap[p.US_L3CODE]) l3ColorMap[p.US_L3CODE] = colorForKey(p.US_L3CODE, 55, 60);
        if (!l1ColorMap[p.NA_L1CODE]) l1ColorMap[p.NA_L1CODE] = colorForKey(p.NA_L1CODE, 65, 40);
    });
}

// ── Map layer ───────────────────────────────────────────────────────────────

function renderLayer(geojson) {
    ecoLayer = L.geoJSON(geojson, {
        style: feature => baseStyle(feature),
        onEachFeature: (feature, layer) => {
            layer.bindPopup(buildPopup(feature.properties));
            layer.on('mouseover', () => {
                layer.setStyle({ weight: 1.5, color: '#222', fillOpacity: 0.8 });
                layer.bringToFront();
            });
            layer.on('mouseout', () => {
                applyStyleFor(layer);
            });
        }
    }).addTo(map);
}

function baseStyle(feature) {
    const p = feature.properties;
    return {
        fillColor: l3ColorMap[p.US_L3CODE] || '#cccccc',
        fillOpacity: 0.6,
        color: '#ffffff',
        weight: 0.3,
        opacity: 0.7
    };
}

function applyStyleFor(layer) {
    const p = layer.feature.properties;
    const isActive = activeL3 && p.US_L3CODE === activeL3;
    layer.setStyle(isActive ? {
        fillColor: l3ColorMap[p.US_L3CODE],
        fillOpacity: 0.85,
        color: '#222',
        weight: 1.2,
        opacity: 1
    } : baseStyle(layer.feature));
}

function buildPopup(props) {
    return `
        <div class="eco-popup-title">${escapeHtml(props.US_L4NAME || 'Unknown')}</div>
        <div class="eco-popup-row"><strong>L4 Code:</strong> ${escapeHtml(props.US_L4CODE || '—')}</div>
        <div class="eco-popup-row"><strong>L3:</strong> ${escapeHtml(props.US_L3NAME || '—')} (${escapeHtml(props.US_L3CODE || '—')})</div>
        <div class="eco-popup-row"><strong>Biome:</strong> ${escapeHtml(toTitleCase(props.NA_L1NAME || '—'))}</div>
    `;
}

function toTitleCase(s) {
    return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// ── Legend ──────────────────────────────────────────────────────────────────

function renderLegend() {
    // Group: L1 biome → set of L3s
    const groups = {}; // L1 code → { name, l3s: Map(L3code → L3name) }
    allFeatures.forEach(f => {
        const p = f.properties;
        if (!groups[p.NA_L1CODE]) {
            groups[p.NA_L1CODE] = { name: p.NA_L1NAME, l3s: new Map() };
        }
        if (!groups[p.NA_L1CODE].l3s.has(p.US_L3CODE)) {
            groups[p.NA_L1CODE].l3s.set(p.US_L3CODE, p.US_L3NAME);
        }
    });

    const sortedGroups = Object.entries(groups).sort((a, b) =>
        a[1].name.localeCompare(b[1].name)
    );

    const html = sortedGroups.map(([l1Code, g]) => {
        const l1Color = l1ColorMap[l1Code] || '#888';
        const l3Rows = Array.from(g.l3s.entries())
            .sort((a, b) => {
                // Sort numerically by L3 code (e.g., "5" before "23")
                const na = parseInt(a[0], 10), nb = parseInt(b[0], 10);
                if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
                return a[0].localeCompare(b[0]);
            })
            .map(([l3Code, l3Name]) => {
                const swatch = l3ColorMap[l3Code] || '#ccc';
                return `<div class="eco-legend-row" data-l3="${escapeHtml(l3Code)}">
                    <span class="eco-legend-swatch" style="background:${swatch}"></span>
                    <span class="l3-code">${escapeHtml(l3Code)}</span>
                    <span>${escapeHtml(l3Name)}</span>
                </div>`;
            }).join('');
        return `<div class="eco-legend-group" style="--l1-color:${l1Color}">
            <div class="eco-legend-group-title">${escapeHtml(toTitleCase(g.name))}</div>
            ${l3Rows}
        </div>`;
    }).join('');

    document.getElementById('eco-legend').innerHTML = html;

    document.querySelectorAll('.eco-legend-row').forEach(row => {
        row.addEventListener('click', () => {
            const l3Code = row.dataset.l3;
            if (activeL3 === l3Code) {
                clearActive();
            } else {
                setActiveL3(l3Code);
            }
        });
    });
}

function setActiveL3(l3Code) {
    clearActive();
    activeL3 = l3Code;
    document.querySelectorAll(`.eco-legend-row[data-l3="${CSS.escape(l3Code)}"]`)
        .forEach(r => r.classList.add('active'));

    let bounds = null;
    ecoLayer.eachLayer(layer => {
        if (layer.feature.properties.US_L3CODE === l3Code) {
            applyStyleFor(layer);
            layer.bringToFront();
            const b = layer.getBounds();
            bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
        } else {
            // Dim non-active polygons
            layer.setStyle({ fillOpacity: 0.15, opacity: 0.3 });
        }
    });
    if (bounds) map.fitBounds(bounds, { padding: [30, 30] });
}

function clearActive() {
    activeL3 = null;
    document.querySelectorAll('.eco-legend-row.active').forEach(r => r.classList.remove('active'));
    if (ecoLayer) ecoLayer.eachLayer(layer => layer.setStyle(baseStyle(layer.feature)));
}

// ── Search ──────────────────────────────────────────────────────────────────

function applySearch(query) {
    if (!ecoLayer) return;
    if (!query) {
        ecoLayer.eachLayer(layer => applyStyleFor(layer));
        return;
    }
    let matchBounds = null;
    ecoLayer.eachLayer(layer => {
        const p = layer.feature.properties;
        const hay = (p.US_L3NAME + ' ' + p.US_L4NAME + ' ' + p.US_L3CODE + ' ' + p.US_L4CODE).toLowerCase();
        if (hay.includes(query)) {
            layer.setStyle({
                fillColor: l3ColorMap[p.US_L3CODE],
                fillOpacity: 0.85,
                color: '#222',
                weight: 1,
                opacity: 1
            });
            layer.bringToFront();
            const b = layer.getBounds();
            matchBounds = matchBounds ? matchBounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
        } else {
            layer.setStyle({ fillOpacity: 0.1, opacity: 0.2, weight: 0.2 });
        }
    });
    if (matchBounds) map.fitBounds(matchBounds, { padding: [30, 30], maxZoom: 9 });
}

// ── Summary stats ───────────────────────────────────────────────────────────

function renderSummary() {
    const l1Set = new Set(), l3Set = new Set(), l4Set = new Set();
    allFeatures.forEach(f => {
        l1Set.add(f.properties.NA_L1CODE);
        l3Set.add(f.properties.US_L3CODE);
        l4Set.add(f.properties.US_L4CODE);
    });

    document.getElementById('eco-summary').innerHTML = `
        <div class="eco-summary-stat">
            <span class="stat-number">${allFeatures.length.toLocaleString()}</span>
            <span class="stat-label">Polygons</span>
        </div>
        <div class="eco-summary-stat">
            <span class="stat-number">${l4Set.size}</span>
            <span class="stat-label">Level IV ecoregions</span>
        </div>
        <div class="eco-summary-stat">
            <span class="stat-number">${l3Set.size}</span>
            <span class="stat-label">Level III ecoregions</span>
        </div>
        <div class="eco-summary-stat">
            <span class="stat-number">${l1Set.size}</span>
            <span class="stat-label">Level I biomes</span>
        </div>
    `;
}

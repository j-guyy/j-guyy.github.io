// Colorado Ecoregions test page
// Expects EPA Level IV ecoregion data at /data/colorado-ecoregions.geojson
// (already reprojected to WGS84). Field names follow EPA conventions:
//   US_L4CODE, US_L4NAME, US_L3CODE, US_L3NAME
// Falls back to NA_L4*/NA_L3* if present.

const GEOJSON_URL = '/data/colorado-ecoregions.geojson';
const COLORADO_CENTER = [39.0, -105.5];

let map = null;
let l4Layer = null;       // Level IV filled polygons
let l3OutlineLayer = null; // Level III boundaries on top
let allFeatures = [];
let l4ColorMap = {};
let l3ColorMap = {};

document.addEventListener('DOMContentLoaded', function () {
    initMap();
    loadData();

    document.getElementById('toggle-fill').addEventListener('change', e => {
        if (!l4Layer) return;
        if (e.target.checked) l4Layer.addTo(map);
        else map.removeLayer(l4Layer);
    });

    document.getElementById('toggle-l3-outlines').addEventListener('change', e => {
        if (!l3OutlineLayer) return;
        if (e.target.checked) l3OutlineLayer.addTo(map);
        else map.removeLayer(l3OutlineLayer);
    });
});

function initMap() {
    map = L.map('eco-map', {
        center: COLORADO_CENTER,
        zoom: 7,
        gestureHandling: true,
        fullscreenControl: true
    });

    L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap (CC-BY-SA), © OSM contributors',
        maxZoom: 17
    }).addTo(map);
}

function setStatus(msg) {
    const el = document.getElementById('eco-status');
    if (el) el.textContent = msg;
}

function loadData() {
    setStatus('Loading ecoregion data…');
    fetch(GEOJSON_URL)
        .then(r => {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(geojson => {
            if (!geojson.features || !geojson.features.length) {
                throw new Error('GeoJSON has no features');
            }
            allFeatures = geojson.features;
            buildColorMaps(allFeatures);
            renderLayers(geojson);
            renderLegend();
            renderSummary();
            setStatus(allFeatures.length + ' polygons loaded');
        })
        .catch(err => {
            console.error('Could not load ecoregion data:', err);
            document.getElementById('eco-setup').style.display = 'block';
            setStatus('Data file not found — see setup instructions below the map.');
        });
}

// ── Field accessors (defensive against EPA naming variants) ─────────────────

function l4Code(props) {
    return props.US_L4CODE || props.NA_L4CODE || props.L4_KEY || '';
}
function l4Name(props) {
    return props.US_L4NAME || props.NA_L4NAME || props.L4_NAME || 'Unknown L4';
}
function l3Code(props) {
    return props.US_L3CODE || props.NA_L3CODE || props.L3_KEY || '';
}
function l3Name(props) {
    return props.US_L3NAME || props.NA_L3NAME || props.L3_NAME || 'Unknown L3';
}

// ── Color generation ────────────────────────────────────────────────────────
// Hash a string to a stable HSL color so the same code always gets the same
// hue across page loads. Saturation/lightness picked for legibility on top of
// the OpenTopoMap basemap.

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
    l4ColorMap = {};
    l3ColorMap = {};
    features.forEach(f => {
        const l4 = l4Code(f.properties) || l4Name(f.properties);
        const l3 = l3Code(f.properties) || l3Name(f.properties);
        if (!l4ColorMap[l4]) l4ColorMap[l4] = colorForKey(l4, 55, 60);
        if (!l3ColorMap[l3]) l3ColorMap[l3] = colorForKey(l3, 70, 35);
    });
}

// ── Map layers ──────────────────────────────────────────────────────────────

function renderLayers(geojson) {
    l4Layer = L.geoJSON(geojson, {
        style: feature => {
            const l4 = l4Code(feature.properties) || l4Name(feature.properties);
            return {
                fillColor: l4ColorMap[l4] || '#cccccc',
                fillOpacity: 0.55,
                color: '#ffffff',
                weight: 0.5,
                opacity: 0.8
            };
        },
        onEachFeature: (feature, layer) => {
            layer.bindPopup(buildPopup(feature.properties));
            layer.on('mouseover', () => {
                layer.setStyle({ weight: 2, color: '#222', fillOpacity: 0.75 });
                layer.bringToFront();
            });
            layer.on('mouseout', () => {
                l4Layer.resetStyle(layer);
            });
        }
    }).addTo(map);

    l3OutlineLayer = L.geoJSON(geojson, {
        style: feature => ({
            color: l3ColorMap[l3Code(feature.properties) || l3Name(feature.properties)] || '#333',
            weight: 1.5,
            opacity: 0.85,
            fill: false
        }),
        interactive: false
    }).addTo(map);

    try {
        map.fitBounds(l4Layer.getBounds(), { padding: [10, 10] });
    } catch (_) {
        // bounds may be invalid for empty layers; ignore
    }
}

function buildPopup(props) {
    return `
        <div class="eco-popup-title">${escapeHtml(l4Name(props))}</div>
        <div class="eco-popup-row"><strong>L4 Code:</strong> ${escapeHtml(l4Code(props) || '—')}</div>
        <div class="eco-popup-row"><strong>L3:</strong> ${escapeHtml(l3Name(props))} (${escapeHtml(l3Code(props) || '—')})</div>
    `;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// ── Legend ──────────────────────────────────────────────────────────────────

function renderLegend() {
    const groups = {}; // l3Key → { name, code, l4s: Set }
    allFeatures.forEach(f => {
        const p = f.properties;
        const l3Key = l3Code(p) || l3Name(p);
        const l4Key = l4Code(p) || l4Name(p);
        if (!groups[l3Key]) {
            groups[l3Key] = { name: l3Name(p), code: l3Code(p), l4s: new Map() };
        }
        if (!groups[l3Key].l4s.has(l4Key)) {
            groups[l3Key].l4s.set(l4Key, { name: l4Name(p), code: l4Code(p) });
        }
    });

    const sortedGroups = Object.entries(groups).sort((a, b) =>
        (a[1].code || a[1].name).localeCompare(b[1].code || b[1].name)
    );

    const html = sortedGroups.map(([l3Key, g]) => {
        const l3Color = l3ColorMap[l3Key] || '#888';
        const l4Rows = Array.from(g.l4s.entries())
            .sort((a, b) => (a[1].code || a[1].name).localeCompare(b[1].code || b[1].name))
            .map(([l4Key, l4]) => {
                const swatch = l4ColorMap[l4Key] || '#ccc';
                return `<div class="eco-legend-row" data-l4="${escapeHtml(l4Key)}">
                    <span class="eco-legend-swatch" style="background:${swatch}"></span>
                    <span>${escapeHtml(l4.code || '')} ${escapeHtml(l4.name)}</span>
                </div>`;
            }).join('');
        return `<div class="eco-legend-group" style="--l3-color:${l3Color}">
            <div class="eco-legend-group-title">${escapeHtml(g.code || '')} ${escapeHtml(g.name)}</div>
            ${l4Rows}
        </div>`;
    }).join('');

    document.getElementById('eco-legend').innerHTML = html;

    // Click a legend row to zoom to that Level IV's combined bounds
    document.querySelectorAll('.eco-legend-row').forEach(row => {
        row.addEventListener('click', () => {
            const target = row.dataset.l4;
            zoomToL4(target);
        });
    });
}

function zoomToL4(l4Key) {
    if (!l4Layer) return;
    let bounds = null;
    l4Layer.eachLayer(layer => {
        const props = layer.feature.properties;
        const key = l4Code(props) || l4Name(props);
        if (key === l4Key) {
            const b = layer.getBounds();
            bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
        }
    });
    if (bounds) map.fitBounds(bounds, { padding: [20, 20] });
}

// ── Summary stats ───────────────────────────────────────────────────────────

function renderSummary() {
    const l3Set = new Set();
    const l4Set = new Set();
    allFeatures.forEach(f => {
        l3Set.add(l3Code(f.properties) || l3Name(f.properties));
        l4Set.add(l4Code(f.properties) || l4Name(f.properties));
    });

    document.getElementById('eco-summary').innerHTML = `
        <div class="eco-summary-stat">
            <span class="stat-number">${allFeatures.length}</span>
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
    `;
}

// US Ecoregions page — EPA Level IV polygons for the contiguous US.
// Loads TopoJSON (~430KB gzipped) for transfer efficiency, decodes to
// GeoJSON in-browser, and renders to an HTML5 canvas via Leaflet.
// Each Level III (US_L3CODE) has its own hue and its Level IVs are shades of
// it (js/eco-colors.js); the legend is grouped by Level I biome (NA_L1NAME)
// and expands a Level III into its Level IVs. Details surface in click popups.
// js/map-controls.js supplies the basemap switcher and live-location control
// shared with the Strava hunters.

const TOPOJSON_URL = '/data/us-ecoregions.topojson';
const CONUS_CENTER = [39.5, -98.5];
const CONUS_ZOOM = 4;

let map = null;
let ecoLayer = null;
let allFeatures = [];
let l3ColorMap = {};
let l4ColorMap = {};
let l1ColorMap = {};
// Selection state — styleFor() derives every polygon's style from these.
let activeL3 = null;     // Level III picked in the legend
let activeL4 = null;     // Level IV picked within it
let searchQuery = '';    // search box text (lower-cased); overrides the legend pick
let showFill = true;
let mapIsDark = false;   // active basemap is the dark one (highlight outlines flip to white)
let loadedMsg = '';

document.addEventListener('DOMContentLoaded', function () {
    initMap();
    loadData();

    document.getElementById('toggle-fill').addEventListener('change', e => {
        showFill = e.target.checked;
        restyleAll();
    });

    document.getElementById('eco-search').addEventListener('input', e => {
        applySearch(e.target.value.trim().toLowerCase());
    });
});

function initMap() {
    map = L.map('eco-map', {
        center: CONUS_CENTER,
        zoom: CONUS_ZOOM,
        // Canvas for 5,847 polygons. Leaflet's default canvas only extends 10%
        // past the viewport, so while dragging on desktop the polygons ended
        // at that edge and the map looked blank until the mouse was released.
        // Half a screen of padding keeps them drawn through a normal drag.
        renderer: L.canvas({ padding: 0.5 }),
        gestureHandling: true,
        tap: false,  // avoid Leaflet's synthetic-click delay, which breaks the fullscreen gesture on mobile
        fullscreenControl: true,
        worldCopyJump: false
    });

    // Light greyscale stays the default so the fills read as before; the other
    // basemaps are one click away in the layer control.
    mapIsDark = setupMapBasemaps(map, {
        defaultBasemap: 'greyscale',
        onThemeChange: isDark => { mapIsDark = isDark; restyleAll(); }
    }).isDark;

    new MapLocationControl({
        onLocate: onLocate,
        onStop: () => setStatus(loadedMsg),
        onError: msg => setStatus('Location: ' + msg)
    }).addTo(map);
}

// Outline for highlighted polygons — dark on light tiles, white on the dark one.
function hiStroke() { return mapIsDark ? '#ffffff' : '#222222'; }

// ── Where am I? ─────────────────────────────────────────────────────────────

function ringContains(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function polygonContains(rings, x, y) {
    if (!ringContains(rings[0], x, y)) return false;
    for (let i = 1; i < rings.length; i++) if (ringContains(rings[i], x, y)) return false; // hole
    return true;
}

// The Level IV feature containing a point, or null (outside the lower 48 / water).
function featureAt(lat, lng) {
    for (const f of allFeatures) {
        if (!f.geometry) continue;
        if (!f._bb) {
            let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
            const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
            polys.forEach(rings => rings[0].forEach(([x, y]) => {
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }));
            f._bb = [x0, y0, x1, y1];
        }
        const bb = f._bb;
        if (lng < bb[0] || lng > bb[2] || lat < bb[1] || lat > bb[3]) continue;
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        if (polys.some(rings => polygonContains(rings, lng, lat))) return f;
    }
    return null;
}

function onLocate({ lat, lng, source }) {
    const f = featureAt(lat, lng);
    if (!f) {
        setStatus('Your location is outside the mapped ecoregions');
        return;
    }
    const p = f.properties;
    setStatus(`You are in: ${p.US_L4NAME} (${p.US_L4CODE}) · ${p.US_L3NAME}`);
    if (source === 'goto') {
        ecoLayer.eachLayer(layer => {
            if (layer.feature === f) layer.openPopup([lat, lng]);
        });
    }
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
            loadedMsg = allFeatures.length.toLocaleString() + ' polygons loaded';
            setStatus(loadedMsg);
        })
        .catch(err => {
            console.error('Could not load ecoregion data:', err);
            setStatus('Error loading data — see console.');
        });
}

// ── Colors ──────────────────────────────────────────────────────────────────
// Level III hue + per-Level IV shade come from js/eco-colors.js (shared with the
// Colorado page). Level I biome accents only colour the legend headers.

function buildColorMaps(features) {
    features.forEach(f => {
        const p = f.properties;
        if (!l3ColorMap[p.US_L3CODE]) l3ColorMap[p.US_L3CODE] = ecoL3Color(p.US_L3CODE);
        if (!l4ColorMap[p.US_L4CODE]) l4ColorMap[p.US_L4CODE] = ecoL4Color(p.US_L4CODE, p.US_L3CODE);
        if (!l1ColorMap[p.NA_L1CODE]) l1ColorMap[p.NA_L1CODE] = ecoHsl(ecoHashString(p.NA_L1CODE) % 360, 55, 62);
    });
}

// ── Map layer ───────────────────────────────────────────────────────────────

function renderLayer(geojson) {
    ecoLayer = L.geoJSON(geojson, {
        style: feature => styleFor(feature),
        onEachFeature: (feature, layer) => {
            layer.bindPopup(buildPopup(feature.properties));
            layer.on('mouseover', () => {
                // Outline only: a polygon dimmed by the current selection stays
                // dimmed under the cursor instead of filling back in.
                const state = selectionState(feature.properties);
                const base = styleFor(feature);
                layer.setStyle({
                    weight: 2,
                    color: hiStroke(),
                    opacity: 1,
                    fillOpacity: state === 'none' && showFill ? 0.8 : base.fillOpacity
                });
                if (state !== 'dim') layer.bringToFront();
            });
            layer.on('mouseout', () => layer.setStyle(styleFor(feature)));
        }
    }).addTo(map);
}

// How the current selection (search text, else legend Level III / Level IV)
// treats a polygon: 'focus' (selected), 'context' (the rest of the selected
// Level IV's Level III), 'dim' (everything else), or 'none' (no selection).
function selectionState(p) {
    if (searchQuery) {
        const hay = (p.US_L3NAME + ' ' + p.US_L4NAME + ' ' + p.US_L3CODE + ' ' + p.US_L4CODE).toLowerCase();
        return hay.includes(searchQuery) ? 'focus' : 'dim';
    }
    if (activeL4) {
        if (p.US_L4CODE === activeL4) return 'focus';
        return p.US_L3CODE === activeL3 ? 'context' : 'dim';
    }
    if (activeL3) return p.US_L3CODE === activeL3 ? 'focus' : 'dim';
    return 'none';
}

// The one place a polygon's resting style is decided — every restyle, and
// every mouseout, goes through here so hover can't undo a selection.
function styleFor(feature) {
    const p = feature.properties;
    const fillColor = l4ColorMap[p.US_L4CODE] || '#cccccc';
    const fill = op => (showFill ? op : 0);
    switch (selectionState(p)) {
        case 'focus':
            return { fillColor, fillOpacity: fill(0.85), color: hiStroke(), weight: 1.2, opacity: 1 };
        case 'context':
            return { fillColor, fillOpacity: fill(0.45), color: hiStroke(), weight: 0.6, opacity: 0.5 };
        case 'dim':
            return { fillColor, fillOpacity: fill(0.12), color: '#ffffff', weight: 0.3, opacity: 0.25 };
        default:
            // With the fill off, outline in the Level III colour so regions still read.
            return showFill
                ? { fillColor, fillOpacity: 0.6, color: '#ffffff', weight: 0.3, opacity: 0.7 }
                : { fillColor, fillOpacity: 0, color: l3ColorMap[p.US_L3CODE], weight: 0.8, opacity: 0.9 };
    }
}

// Restyle every polygon from the current state and lift the selection above
// the dimmed polygons so its outlines aren't drawn over. Returns the selected
// polygons' bounds (null without a selection).
function restyleAll() {
    if (!ecoLayer) return null;
    const context = [], focus = [];
    ecoLayer.eachLayer(layer => {
        layer.setStyle(styleFor(layer.feature));
        const state = selectionState(layer.feature.properties);
        if (state === 'focus') focus.push(layer);
        else if (state === 'context') context.push(layer);
    });
    context.forEach(l => l.bringToFront());
    let bounds = null;
    focus.forEach(l => {
        l.bringToFront();
        const b = l.getBounds();
        bounds = bounds ? bounds.extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
    });
    renderSelectionChip();
    return bounds;
}

function buildPopup(props) {
    const swatch = l4ColorMap[props.US_L4CODE] || '#ccc';
    return `
        <div class="eco-popup-title"><span class="eco-popup-swatch" style="background:${swatch}"></span>${escapeHtml(props.US_L4NAME || 'Unknown')}</div>
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

// Sort EPA codes numerically, then by suffix: "5" < "23", "6z" < "6aa".
function compareCodes(a, b) {
    const ma = /^(\d+)([a-z]*)$/i.exec(a), mb = /^(\d+)([a-z]*)$/i.exec(b);
    if (!ma || !mb) return a.localeCompare(b);
    return (+ma[1] - +mb[1]) || (ma[2].length - mb[2].length) || ma[2].localeCompare(mb[2]);
}

// ── Legend ──────────────────────────────────────────────────────────────────
// Biome cards → Level III rows (strip of their Level IV shades) → clicking a
// row selects it on the map and expands its Level IV list; clicking a Level IV
// narrows the selection to it.

function renderLegend() {
    const groups = {}; // L1 code → { name, l3s: Map(L3 code → { name, l4s: Map(L4 code → name) }) }
    allFeatures.forEach(f => {
        const p = f.properties;
        const g = groups[p.NA_L1CODE] || (groups[p.NA_L1CODE] = { name: p.NA_L1NAME, l3s: new Map() });
        if (!g.l3s.has(p.US_L3CODE)) g.l3s.set(p.US_L3CODE, { name: p.US_L3NAME, l4s: new Map() });
        g.l3s.get(p.US_L3CODE).l4s.set(p.US_L4CODE, p.US_L4NAME);
    });

    const sortedGroups = Object.entries(groups).sort((a, b) => a[1].name.localeCompare(b[1].name));

    const html = sortedGroups.map(([l1Code, g]) => {
        const l3s = Array.from(g.l3s.entries()).sort((a, b) => compareCodes(a[0], b[0]));
        const l4Total = l3s.reduce((n, [, l3]) => n + l3.l4s.size, 0);

        const l3Rows = l3s.map(([l3Code, l3]) => {
            const l4s = Array.from(l3.l4s.entries()).sort((a, b) => compareCodes(a[0], b[0]));
            // Hard-stop gradient: one band per Level IV shade.
            const step = 100 / l4s.length;
            const strip = l4s.map(([c], i) =>
                `${l4ColorMap[c]} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`).join(', ');
            const l4Rows = l4s.map(([l4Code, l4Name]) => `
                <button type="button" class="eco-legend-l4" data-l4="${escapeHtml(l4Code)}">
                    <span class="eco-legend-swatch" style="background:${l4ColorMap[l4Code]}"></span>
                    <span class="eco-legend-code">${escapeHtml(l4Code)}</span>
                    <span class="eco-legend-name">${escapeHtml(l4Name)}</span>
                </button>`).join('');
            return `<div class="eco-legend-l3" data-l3="${escapeHtml(l3Code)}" style="--l3-color:${l3ColorMap[l3Code]}">
                <button type="button" class="eco-legend-row" aria-expanded="false">
                    <span class="eco-legend-strip" style="background:linear-gradient(90deg, ${strip})"></span>
                    <span class="eco-legend-code">${escapeHtml(l3Code)}</span>
                    <span class="eco-legend-name">${escapeHtml(l3.name)}</span>
                    <span class="eco-legend-count" title="${l4s.length} Level IV ecoregions">${l4s.length}</span>
                </button>
                <div class="eco-legend-l4list" hidden>${l4Rows}</div>
            </div>`;
        }).join('');

        return `<div class="eco-legend-group" data-rows="${l3s.length + 2}" style="--l1-color:${l1ColorMap[l1Code] || '#888'}">
            <div class="eco-legend-group-head">
                <span class="eco-legend-group-dot"></span>
                <span class="eco-legend-group-title">${escapeHtml(toTitleCase(g.name))}</span>
                <span class="eco-legend-group-meta">${l3s.length} L3 · ${l4Total} L4</span>
            </div>
            ${l3Rows}
        </div>`;
    }).join('');

    const legend = document.getElementById('eco-legend');
    legend.innerHTML = html;
    legendGroups = Array.from(legend.querySelectorAll('.eco-legend-group'));
    layoutLegend();
    window.addEventListener('resize', layoutLegend);

    legend.addEventListener('click', e => {
        const l4Btn = e.target.closest('.eco-legend-l4');
        if (l4Btn) {
            const l4Code = l4Btn.dataset.l4;
            if (activeL4 === l4Code) select(activeL3, null);
            else select(l4Btn.closest('.eco-legend-l3').dataset.l3, l4Code);
            return;
        }
        const row = e.target.closest('.eco-legend-row');
        if (row) {
            const l3Code = row.closest('.eco-legend-l3').dataset.l3;
            if (activeL3 === l3Code && !activeL4) select(null, null);
            else select(l3Code, null);
        }
    });
}

// Masonry: the biome cards differ a lot in height (1 to 33 rows), so a plain
// grid leaves big holes. Deal them, in order, into whichever column is shortest
// so far. Only redone when the column count changes, so expanding a Level III
// grows its own column without shuffling cards between columns.
let legendGroups = [];
let legendCols = 0;

function layoutLegend() {
    const legend = document.getElementById('eco-legend');
    const cols = Math.max(1, Math.floor((legend.clientWidth + 16) / (320 + 16)));
    if (cols === legendCols) return;
    legendCols = cols;
    const columns = Array.from({ length: cols }, () => {
        const el = document.createElement('div');
        el.className = 'eco-legend-col';
        return el;
    });
    const heights = new Array(cols).fill(0);
    legendGroups.forEach(g => {
        const i = heights.indexOf(Math.min(...heights));
        columns[i].appendChild(g);
        heights[i] += +g.dataset.rows;
    });
    legend.replaceChildren(...columns);
}

// Select a Level III (and optionally one of its Level IVs) from the legend,
// or clear with select(null, null). Clears any search text.
function select(l3Code, l4Code, fit = true) {
    activeL3 = l3Code;
    activeL4 = l3Code ? l4Code : null;
    if (searchQuery) {
        searchQuery = '';
        document.getElementById('eco-search').value = '';
    }
    syncLegend();
    const bounds = restyleAll();
    if (bounds && fit) map.fitBounds(bounds, { padding: [30, 30], maxZoom: activeL4 ? 10 : 9 });
}

function syncLegend() {
    document.querySelectorAll('.eco-legend-l3').forEach(el => {
        const open = el.dataset.l3 === activeL3;
        el.classList.toggle('active', open);
        el.querySelector('.eco-legend-row').setAttribute('aria-expanded', open ? 'true' : 'false');
        el.querySelector('.eco-legend-l4list').hidden = !open;
    });
    document.querySelectorAll('.eco-legend-l4').forEach(el => {
        el.classList.toggle('active', el.dataset.l4 === activeL4);
    });
}

// The "what's selected" chip next to the map controls, with a clear button,
// so the selection can be read and cleared without scrolling to the legend.
function renderSelectionChip() {
    const chip = document.getElementById('eco-selection');
    if (!chip) return;
    if (!activeL3 || searchQuery) {
        chip.hidden = true;
        chip.innerHTML = '';
        return;
    }
    let code = activeL3, name = '', color = l3ColorMap[activeL3];
    const f = allFeatures.find(feat => activeL4
        ? feat.properties.US_L4CODE === activeL4
        : feat.properties.US_L3CODE === activeL3);
    if (f) name = activeL4 ? f.properties.US_L4NAME : f.properties.US_L3NAME;
    if (activeL4) { code = activeL4; color = l4ColorMap[activeL4]; }
    chip.innerHTML = `<span class="eco-legend-swatch" style="background:${color}"></span>
        <span><strong>${escapeHtml(code)}</strong> ${escapeHtml(name)}</span>
        <button type="button" class="eco-selection-clear" aria-label="Clear selection" title="Clear selection">×</button>`;
    chip.hidden = false;
    chip.querySelector('.eco-selection-clear').addEventListener('click', () => select(null, null, false));
}

// ── Search ──────────────────────────────────────────────────────────────────

function applySearch(query, fit = true) {
    if (!ecoLayer) return;
    searchQuery = query;
    if (query && activeL3) {
        activeL3 = null;
        activeL4 = null;
        syncLegend();
    }
    const bounds = restyleAll();
    if (bounds && fit) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 9 });
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

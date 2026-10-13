// World Travel Map (world-map.html).
//
// One map of everywhere I've been, from three sources:
//   • countries — data/countries.json (via TravelAPI) fills the outlines in
//     data/world-countries.geojson (built by scripts/build-world-countries.py)
//   • places    — every visited/climbed point from the travel data files,
//     drawn as markers in toggleable category layers
//   • routes    — driven highway segments, plus every Strava route, fetched
//     lazily from the worker's /polylines/all (the same store strava.html uses)
//
// Three views share those sources: Countries (filled outlines), Footprint
// (a green wash within N km of every place and route) and Fog of War (the
// world fogged except there). Footprint and Fog are drawn by one canvas layer
// (FootprintLayer below) so thousands of Strava routes stay cheap to redraw.
//
// Basemap switcher + live location come from js/map-controls.js.

const WORLD_MAP_WORKER_URL = 'https://strava-worker.justinguyette.workers.dev';

const CONTINENT_KEYS = ['northAmericanCountries', 'southAmericanCountries', 'europeanCountries',
    'africanCountries', 'asianCountries', 'oceaniaCountries'];

const HOME_COUNTRY = 'United States of America';

// Marker categories, in chip order. `symbol`/`color` double as the legend.
const PLACE_CATEGORIES = [
    { id: 'cities',     label: 'Cities',              symbol: '●', color: '#2196F3', cls: 'city-marker',       size: 16, z: 0 },
    { id: 'highpoints', label: 'Country high points', symbol: '▲', color: '#9C27B0', cls: 'high-point-marker', size: 14, z: 1000 },
    { id: 'mountains',  label: 'Mountains',           symbol: '▲', color: '#FF9800', cls: 'mountain-marker',   size: 14, z: 900 },
    { id: 'parks',      label: 'Parks & landmarks',   symbol: '◆', color: '#00897B', cls: 'park-marker',       size: 14, z: 800 },
];
const STRAVA_LAYER = { id: 'strava', label: 'Strava routes', symbol: '〰', color: '#FC4C02' };

// Below this zoom, Footprint and Fog hide the place markers.
const OVERLAY_MARKER_ZOOM = 5;

const COUNTRY_COLORS = { home: '#FFC107', visited: '#4CAF50', strava: '#FC4C02' };

// How much of a visited country the Countries view fills (the detail toggle).
const DETAIL_LEVELS = ['countries', 'lands', 'subregions'];

// Countries with first-level regions in data/admin1/ (built by
// scripts/build-admin1-regions.py; the first seven are also the Strava page's
// Regions section). Covers every country I've visited — add a country's file
// here after its first trip.
const ADMIN1_FILES = {
    'United States of America': 'us', 'Canada': 'canada', 'Australia': 'australia',
    'Mexico': 'mexico', 'China': 'china', 'Spain': 'spain', 'Italy': 'italy',
    'Belgium': 'belgium', 'Belize': 'belize', 'Ecuador': 'ecuador', 'France': 'france',
    'Germany': 'germany', 'Greece': 'greece', 'Haiti': 'haiti', 'Iceland': 'iceland',
    'India': 'india', 'Ireland': 'ireland', 'Jamaica': 'jamaica', 'Japan': 'japan',
    'Netherlands': 'netherlands', 'New Zealand': 'new-zealand', 'Portugal': 'portugal',
    'South Korea': 'south-korea', 'Sweden': 'sweden', 'Switzerland': 'switzerland',
    'United Kingdom': 'uk',
};

const STORAGE = { mode: 'world_map_mode', detail: 'world_map_detail', layers: 'world_map_layers_off', radius: 'world_map_radius', route: 'world_map_route_radius' };

function wmStore(key, value) {
    try {
        if (value === undefined) return localStorage.getItem(key);
        localStorage.setItem(key, value);
    } catch (e) { /* private mode / blocked storage: just don't remember */ }
    return null;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.addEventListener('DOMContentLoaded', function () {

    Promise.all([
        loadCountriesWithPopulation(null, function (updatedData) {
            displayWorldTravelSummary(updatedData);
        }),
        fetch('data/worldCities.json').then(response => response.json()),
        TravelAPI.fetchMetros(),
        fetch('data/worldMountains.json').then(response => response.json()),
        fetch('data/familyTravels.json').then(response => response.json()),
        TravelAPI.fetchHighPoints(),
        TravelAPI.fetchNationalParks(),
        fetch('data/skiResorts.json').then(response => response.json()),
        fetch('data/sevenWonders.json').then(response => response.json()),
        TravelAPI.fetchPeaksWithFallback('britishIsles', 'data/british-isles-high-five.json'),
        TravelAPI.fetchPeaksWithFallback('adk46ers', 'data/adirondack46ers.json'),
        TravelAPI.fetchPeaksWithFallback('colorado14ers', 'data/colorado14ers.json'),
        TravelAPI.fetchPeaksWithFallback('countryHighpoints', 'data/country-highpoints.json'),
        fetch('data/forbes100cities.json').then(response => response.json()),
        fetch('data/interstateHighways.json').then(response => response.json()),
        fetch('data/highways.json').then(response => response.json()),
        fetch('data/world-countries.geojson').then(response => response.json()),
        // Fills Alaska / Hawaii. The worker (what the dashboards edit) is the
        // source of truth; the bundled JSON only covers it being unreachable.
        TravelAPI.fetchVisitedStates()
            .catch(() => fetch('data/visitedStates.json').then(response => response.json()))
            .catch(() => ({}))
    ])
        .then(([worldData, citiesData, metrosData, highPointsData, familyTravelsData, stateHighPointsData, nationalParksData, skiResortsData, sevenWondersData, britishIslesData, adk46ersData, colorado14ersData, countryHighpointsData, forbes100Data, interstateData, highwaysData, countriesGeojson, visitedStates]) => {
            displayWorldTravelSummary(worldData);
            createWorldMap('world-map', {
                worldData, countriesGeojson, visitedStates,
                places: collectPlaces({ citiesData, metrosData, highPointsData, familyTravelsData, stateHighPointsData, nationalParksData, skiResortsData, sevenWondersData, britishIslesData, adk46ersData, colorado14ersData, countryHighpointsData, forbes100Data }),
                drivenSegments: collectDrivenSegments(interstateData, highwaysData),
            });
        })
        .catch(error => console.error('Error loading data:', error));

});

function displayWorldTravelSummary(worldData) {
    const summaryContainer = document.getElementById('travel-summary');
    if (!summaryContainer) return;

    const continents = [
        { key: 'northAmericanCountries', label: 'North America' },
        { key: 'southAmericanCountries', label: 'South America' },
        { key: 'europeanCountries', label: 'Europe' },
        { key: 'asianCountries', label: 'Asia' },
        { key: 'africanCountries', label: 'Africa' },
        { key: 'oceaniaCountries', label: 'Oceania' }
    ];

    let totalCountries = 0;
    let totalVisited = 0;
    const stats = continents.map(c => {
        const countries = worldData[c.key];
        const visited = countries.filter(x => x.visited).length;
        totalCountries += countries.length;
        totalVisited += visited;
        return { label: c.label, visited, total: countries.length, pct: ((visited / countries.length) * 100).toFixed(0) };
    });

    const totalPct = ((totalVisited / totalCountries) * 100).toFixed(0);

    summaryContainer.innerHTML = `
        <div class="summary-stats-container">
            <div class="summary-stat world-summary">
                <div class="stat-number-container">
                    <span class="stat-number">${totalVisited}</span>
                    <span class="stat-total">/${totalCountries}</span>
                    <span class="stat-percentage">(${totalPct}%)</span>
                </div>
                <span class="stat-label">Countries Visited</span>
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

// ── Data → places / routes ────────────────────────────────────────────────────

// Every visited point, as { lat, lng, name, cat, html } where `cat` is a
// PLACE_CATEGORIES id and `html` the popup body. Duplicates within a category
// (same spot from two files) collapse into one marker.
function collectPlaces(d) {
    const places = [];
    const seen = new Set();
    function add(cat, lat, lng, name, detail, precision = 4) {
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        const key = `${cat}:${lat.toFixed(precision)},${lng.toFixed(precision)}`;
        if (seen.has(key)) return null;
        seen.add(key);
        const place = { lat, lng, name, cat, details: detail ? [detail] : [] };
        places.push(place);
        return place;
    }
    const row = (label, value) => `<p><strong>${label}:</strong> ${escapeHtml(value)}</p>`;

    // Cities: world cities, visited US metros, my own family-travels pins.
    d.citiesData.visitedCities.forEach(c => add('cities', c.latitude, c.longitude, c.name,
        row('Country', c.country) + row('Population', c.population.toLocaleString()) + `<p>${escapeHtml(c.description)}</p>`, 3));
    d.metrosData.filter(m => m.visited).sort((a, b) => a.rank - b.rank).forEach(m => add('cities', m.coords[1], m.coords[0], m.name,
        row('Metro Area', m.metro_name) + row('Rank', `#${m.rank} in US`) + row('State', m.state) + row('Population', m.population), 3));
    const mine = d.familyTravelsData.locations.filter(l => l.visitors.includes('person1'));
    const myCityByKey = new Map();
    mine.forEach(l => {
        const p = add('cities', l.lat, l.lng, l.name, row('Country', l.country), 3);
        if (p) myCityByKey.set(`${l.lat.toFixed(2)},${l.lng.toFixed(2)}`, p);
    });
    // Forbes 100 cities I've been to are already pinned above; just tag them.
    d.forbes100Data.forEach(c => {
        const p = myCityByKey.get(`${c.coords[1].toFixed(2)},${c.coords[0].toFixed(2)}`);
        if (p) p.details.push('<p><em>Forbes 100 Most Visited Cities</em></p>');
    });

    // Country high points (the Peaks dashboard list) + other notable mountains
    // (worldMountains.json).
    d.countryHighpointsData.filter(p => p.climbed).forEach(p => add('highpoints', p.coords[1], p.coords[0], p.name,
        row('Country', p.country) + row('Elevation', `${p.elevationM.toLocaleString()} m`)));
    const elev = m => row('Elevation', `${m.elevation.toLocaleString()} ${m.elevationUnit}`);
    (d.highPointsData.otherMountains || []).forEach(m => add('mountains', m.latitude, m.longitude, m.name,
        row('Country', m.country) + elev(m) + `<p>${escapeHtml(m.description)}</p>`));

    // Peak lists.
    d.stateHighPointsData.filter(p => p.visited).forEach(p => add('mountains', p.coords[1], p.coords[0], p.name,
        row('Type', 'US State High Point') + row('Elevation', `${p.elevation.toLocaleString()} ft`)));
    d.britishIslesData.filter(p => p.climbed).forEach(p => add('mountains', p.coords[1], p.coords[0], p.name,
        row('Type', 'British Isles High Five') + row('Country', p.country) + row('Elevation', `${p.elevation.toLocaleString()} m`)));
    d.adk46ersData.filter(p => p.climbed).forEach(p => add('mountains', p.coords[1], p.coords[0], p.name,
        row('Type', 'ADK 46er') + row('Elevation', `${p.elevation.toLocaleString()} ft`)));
    d.colorado14ersData.filter(p => p.climbed).forEach(p => add('mountains', p.coords[1], p.coords[0], p.name,
        row('Type', 'Colorado 14er') + row('Elevation', `${p.elevation.toLocaleString()} ft`)));

    // Parks & landmarks. The territory parks' coords in the data sit on the
    // mainland, so pin them where they actually are.
    const parkCoordOverrides = {
        'American Samoa': { lat: -14.2710, lng: -170.1322 },
        'Virgin Islands': { lat: 18.3358, lng: -64.8963 }
    };
    d.nationalParksData.filter(np => np.visited).forEach(np => {
        const o = parkCoordOverrides[np.name];
        add('parks', o ? o.lat : np.coords[1], o ? o.lng : np.coords[0], `${np.name} National Park`, row('Type', 'US National Park'));
    });
    [['sevenWonders', 'Seven Wonders of the World'], ['sevenNaturalWonders', 'Seven Natural Wonders'],
     ['sevenNaturalWondersNominees', 'Natural Wonders Nominee']].forEach(([key, type]) => {
        (d.sevenWondersData[key] || []).filter(w => w.visited).forEach(w => add('parks', w.coordinates.lat, w.coordinates.lng, w.name,
            row('Type', type) + row('Country', w.country || w.primaryCountry || '')));
    });
    d.skiResortsData.filter(r => r.visited).forEach(r => add('parks', r.coords[1], r.coords[0], r.name, row('Type', 'Ski Resort')));

    return places;
}

// Driven interstate / highway segments as [[lat, lng], …] waypoint lists.
function collectDrivenSegments(interstateData, highwaysData) {
    const segments = [];
    [[interstateData, 'interstates'], [highwaysData, 'highways']].forEach(([data, key]) => {
        ((data && data[key]) || []).forEach(road => road.routeSegments.forEach(seg => {
            if (Array.isArray(seg.drivenBy) && seg.drivenBy.includes('person1') && seg.waypoints && seg.waypoints.length >= 2) {
                segments.push(seg.waypoints);
            }
        }));
    });
    return segments;
}

// Google encoded polyline → [[lat, lng], …]
function decodeWorldPolyline(encoded) {
    const points = [];
    let index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
        let b, shift = 0, result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        lat += (result & 1) ? ~(result >> 1) : (result >> 1);
        shift = 0; result = 0;
        do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        lng += (result & 1) ? ~(result >> 1) : (result >> 1);
        points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
}

// Drop points closer than `step` degrees to the last kept one — plenty for a
// corridor kilometres wide, and keeps the fog redraw fast.
function thinPoints(points, step) {
    if (points.length <= 2) return points;
    const out = [points[0]];
    let [plat, plng] = points[0];
    for (let i = 1; i < points.length - 1; i++) {
        const [lat, lng] = points[i];
        if (Math.abs(lat - plat) >= step || Math.abs(lng - plng) >= step) {
            out.push(points[i]);
            plat = lat; plng = lng;
        }
    }
    out.push(points[points.length - 1]);
    return out;
}

// A route prepared for the canvas layers: copies thinned to a ladder of steps
// (coarse → fine, then the full points), its bounding box and middle latitude
// (for the corridor width). Drawing picks the coarsest copy that's still
// finer than a pixel (routes) or a fraction of the corridor (footprint).
const THIN_STEPS = [0.05, 0.015, 0.005, 0.0015, 0.0005];  // degrees; ~5.5 km … 55 m

function makeRoute(points) {
    let s = 90, n = -90, w = 180, e = -180;
    points.forEach(([lat, lng]) => {
        if (lat < s) s = lat; if (lat > n) n = lat;
        if (lng < w) w = lng; if (lng > e) e = lng;
    });
    const levels = THIN_STEPS.map(step => ({ step, pts: thinPoints(points, step) }));
    levels.push({ step: 0, pts: points });
    return { levels, s, n, w, e, midLat: (s + n) / 2 };
}

// The coarsest thinned copy of a route whose step is at most `maxStepDeg`.
function routePoints(route, maxStepDeg) {
    return route.levels.find(l => l.step <= maxStepDeg).pts;
}

// ── Point in country ──────────────────────────────────────────────────────────

function featureBBox(geometry) {
    let s = 90, n = -90, w = 180, e = -180;
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    polys.forEach(p => p[0].forEach(([lng, lat]) => {
        if (lat < s) s = lat; if (lat > n) n = lat;
        if (lng < w) w = lng; if (lng > e) e = lng;
    }));
    return { s, n, w, e };
}

function pointInRing(lng, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function pointInGeometry(lng, lat, geometry) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    return polys.some(rings => pointInRing(lng, lat, rings[0]) && !rings.slice(1).some(h => pointInRing(lng, lat, h)));
}

// A [lng, lat] inside a geometry's largest polygon (by bounding box): the
// midpoint of the first two crossings of a line through the middle of it.
function interiorPoint(geometry) {
    const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let best = null, bestArea = -1;
    polys.forEach(rings => {
        const b = featureBBox({ type: 'Polygon', coordinates: rings });
        const area = (b.n - b.s) * (b.e - b.w);
        if (area > bestArea) { bestArea = area; best = { ring: rings[0], b }; }
    });
    if (!best) return null;
    // Nudged off the middle so the line doesn't run exactly through a vertex.
    const lat = best.b.s + (best.b.n - best.b.s) * 0.5001;
    const xs = [];
    const ring = best.ring;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat)) xs.push((xj - xi) * (lat - yi) / (yj - yi) + xi);
    }
    if (xs.length < 2) return null;
    xs.sort((a, b) => a - b);
    return [(xs[0] + xs[1]) / 2, lat];
}

// Returns a lookup (lat, lng) → country feature or null, cached on a ~1 km grid.
function makeCountryLocator(features) {
    const boxed = features.map(f => ({ f, b: featureBBox(f.geometry) }));
    const cache = new Map();
    return function locate(lat, lng) {
        const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
        if (cache.has(key)) return cache.get(key);
        let hit = null;
        for (const { f, b } of boxed) {
            if (lat < b.s || lat > b.n || lng < b.w || lng > b.e) continue;
            if (pointInGeometry(lng, lat, f.geometry)) { hit = f; break; }
        }
        cache.set(key, hit);
        return hit;
    };
}

// ── Footprint / fog canvas layer ──────────────────────────────────────────────
//
// Draws a mask of everything within `pointKm` of a place and `routeKm` of a
// route, then either washes it green ('footprint') or punches it out of a dark
// fog ('fog'). The mask is drawn at half resolution and scaled up, which
// softens its edges for free (plus a real blur where canvas filters exist).
// The canvas covers the view plus half a screen on every side so a drag
// doesn't expose its edge before the redraw at moveend.

const MASK_SCALE = 0.5;
// At world zoom 100 km is ~3 px, so every shape gets a floor (in screen px)
// to keep a lone city or a short route visible on the overview.
const MIN_POINT_PX = 5;
const MIN_ROUTE_PX = 3;
const EARTH_CIRCUMFERENCE_M = 40075016.686;

// The smoke texture: SVG feTurbulence (what the old SVG fog filtered with),
// rendered once into a tileable 512px image. Loads asynchronously; until then
// the fog is drawn flat, and `onReady` asks for a redraw.
let fogTexture = null;
let fogTextureLoading = false;
function getFogTexture(onReady) {
    if (fogTexture || fogTextureLoading) return fogTexture;
    fogTextureLoading = true;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
        <filter id="f" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.0117" numOctaves="5" seed="3" stitchTiles="stitch"/>
            <feColorMatrix type="matrix" values="0 0 0 0 0.58  0 0 0 0 0.6  0 0 0 0 0.65  2.4 0 0 0 -1.05"/>
        </filter>
        <rect width="512" height="512" filter="url(#f)"/>
    </svg>`;
    const img = new Image();
    img.onload = () => { fogTexture = img; if (onReady) onReady(); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    return null;
}

// A canvas the size of the view plus half a screen on every side (so a drag
// doesn't expose its edge before the redraw at moveend), redrawn on every
// move/zoom and scaled during Leaflet's zoom animation. Subclasses implement
// _draw(frame); frame.project(scale) gives fast lat/lng → canvas-pixel
// functions (Spherical Mercator by hand, as L.CRS.EPSG3857 does — much faster
// than latLngToLayerPoint for hundreds of thousands of route points).
const CanvasOverlay = L.Layer.extend({
    options: { className: '', hiDPI: false },

    onAdd(map) {
        this._canvas = L.DomUtil.create('canvas', 'wm-canvas-overlay ' + this.options.className, this.getPane());
        if (map._zoomAnimated) L.DomUtil.addClass(this._canvas, 'leaflet-zoom-animated');
        this.redraw();
    },

    onRemove() {
        L.Util.cancelAnimFrame(this._frame);
        this._frame = null;
        L.DomUtil.remove(this._canvas);
        this._canvas = null;
    },

    getEvents() {
        // `zoom` fires on every frame of a pinch (touch, or a Safari trackpad
        // pinch), which moves the map without a zoom animation; follow it
        // the way Leaflet's own renderers do.
        const events = { moveend: this._redrawSoon, viewreset: this.redraw, resize: this.redraw, zoom: this._onZoom };
        if (this._map && this._map._zoomAnimated) events.zoomanim = this._animateZoom;
        return events;
    },

    _onZoom() {
        this._animateZoom({ zoom: this._map.getZoom(), center: this._map.getCenter() });
    },

    // While the wheel is still spinning, the next zoom step starts in the
    // frame after this one lands; skip the redraw then (the zoom animation
    // just scales the current canvas) and draw once the map comes to rest.
    _redrawSoon() {
        if (this._frame) return;
        this._frame = L.Util.requestAnimFrame(() => {
            this._frame = null;
            if (this._map && !this._map._animatingZoom) this.redraw();
        });
    },

    setOptions(options) {
        L.setOptions(this, options);
        return this.redraw();
    },

    _animateZoom(e) {
        if (!this._topLeftLatLng) return;
        const scale = this._map.getZoomScale(e.zoom, this._zoom);
        const offset = this._map._latLngToNewLayerPoint(this._topLeftLatLng, e.zoom, e.center);
        L.DomUtil.setTransform(this._canvas, offset, scale);
    },

    redraw() {
        const map = this._map;
        if (!map || !this._canvas) return this;
        const size = map.getSize();
        const pad = Math.round(Math.max(size.x, size.y) * 0.5);
        const w = size.x + pad * 2, h = size.y + pad * 2;
        const topLeft = map.containerPointToLayerPoint([-pad, -pad]);
        const zoom = map.getZoom();
        this._topLeftLatLng = map.layerPointToLatLng(topLeft);
        this._zoom = zoom;

        const dpr = this.options.hiDPI ? Math.min(2, window.devicePixelRatio || 1) : 1;
        const canvas = this._canvas;
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        L.DomUtil.setPosition(canvas, topLeft);

        const worldPx = 256 * Math.pow(2, zoom);
        const origin = map.getPixelOrigin();
        const ox = topLeft.x + origin.x, oy = topLeft.y + origin.y;
        const project = scale => ({
            px: lng => ((lng + 180) / 360 * worldPx - ox) * scale,
            py: lat => {
                const c = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
                return ((1 - Math.log(Math.tan(c) + 1 / Math.cos(c)) / Math.PI) / 2 * worldPx - oy) * scale;
            },
        });
        this._draw({
            canvas, w, h, dpr, zoom, worldPx, ox, oy, project,
            view: L.latLngBounds(this._topLeftLatLng, map.layerPointToLatLng(topLeft.add([w, h]))),
            // km → CSS pixels at a latitude.
            kmToPx: (km, lat) => km * 1000 / (EARTH_CIRCUMFERENCE_M * Math.cos(lat * Math.PI / 180) / worldPx),
        });
        return this;
    },
});

// Is a route (makeRoute()) at least partly inside `view`, padded by `marginDeg`?
function routeInView(r, view, marginDeg = 0) {
    return !(r.n < view.getSouth() - marginDeg || r.s > view.getNorth() + marginDeg ||
             r.e < view.getWest() - marginDeg || r.w > view.getEast() + marginDeg);
}

const FootprintLayer = CanvasOverlay.extend({
    options: { pane: 'footprintPane', className: 'wm-footprint-canvas', mode: 'footprint', pointKm: 100, routeKm: 50 },

    // getSources() → { points: [{lat, lng}], routes: [makeRoute()] }
    initialize(getSources, options) {
        this._getSources = getSources;
        L.setOptions(this, options);
        this._mask = document.createElement('canvas');
        this._blurred = document.createElement('canvas');
    },

    // The blurred mask recoloured to `color` (alpha where the mask is solid).
    _tinted(mask, color) {
        const t = this._tint || (this._tint = document.createElement('canvas'));
        t.width = mask.width; t.height = mask.height;
        const c = t.getContext('2d');
        c.drawImage(mask, 0, 0);
        c.globalCompositeOperation = 'source-in';
        c.fillStyle = color;
        c.fillRect(0, 0, t.width, t.height);
        return t;
    },

    _draw({ canvas, w, h, worldPx, ox, oy, project, view, kmToPx }) {
        const s = MASK_SCALE;
        const { px, py } = project(s);
        const mw = Math.ceil(w * s), mh = Math.ceil(h * s);
        const mask = this._mask;
        mask.width = mw; mask.height = mh;
        const m = mask.getContext('2d');
        m.fillStyle = m.strokeStyle = '#000';
        m.lineCap = m.lineJoin = 'round';

        const { points, routes } = this._getSources();
        let maxR = 0;
        m.beginPath();
        points.forEach(({ lat, lng }) => {
            const r = Math.max(MIN_POINT_PX, kmToPx(this.options.pointKm, lat)) * s;
            const x = px(lng), y = py(lat);
            if (x < -r || y < -r || x > mw + r || y > mh + r) return;
            if (r > maxR) maxR = r;
            m.moveTo(x + r, y);
            m.arc(x, y, r, 0, Math.PI * 2);
        });
        m.fill();

        // Routes: cull by bounding box against the canvas extent (plus the
        // corridor), then stroke a copy thinned to a third of the corridor
        // (or a pixel, if finer) with a corridor-wide pen. Routes whose pens
        // round to the same width share one path and one stroke.
        const pxDeg = 360 / worldPx;
        const maxStep = Math.max(this.options.routeKm / 3 / 111, pxDeg);
        const paths = new Map();  // rounded mask-px width → Path2D
        routes.forEach(r => {
            const width = Math.round(Math.max(MIN_ROUTE_PX, kmToPx(this.options.routeKm, r.midLat) * 2) * s);
            const marginDeg = this.options.routeKm / 111 / Math.max(0.1, Math.cos(r.midLat * Math.PI / 180));
            if (!routeInView(r, view, marginDeg)) return;
            const pts = routePoints(r, maxStep);
            let path = paths.get(width);
            if (!path) paths.set(width, path = new Path2D());
            path.moveTo(px(pts[0][1]), py(pts[0][0]));
            for (let i = 1; i < pts.length; i++) path.lineTo(px(pts[i][1]), py(pts[i][0]));
            if (pts.length === 1) path.lineTo(px(pts[0][1]) + 0.01, py(pts[0][0]));
            if (width / 2 > maxR) maxR = width / 2;
        });
        paths.forEach((path, width) => { m.lineWidth = Math.max(1, width); m.stroke(path); });

        // Soften the mask edge in proportion to its size (blur ≈ 8% of the
        // largest radius at full resolution, as the old SVG fog did).
        const blurred = this._blurred;
        blurred.width = mw; blurred.height = mh;
        const b = blurred.getContext('2d');
        if ('filter' in b) b.filter = `blur(${Math.max(0.5, Math.min(maxR * 0.08, 5))}px)`;
        b.drawImage(mask, 0, 0);

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, w, h);
        if (this.options.mode === 'fog') {
            ctx.fillStyle = 'rgba(15, 15, 18, 0.92)';
            ctx.fillRect(0, 0, w, h);
            // Anchor the smoke texture to the world, not the canvas, so it
            // doesn't jump on every redraw.
            const texture = getFogTexture(() => this.redraw());
            if (texture) {
                ctx.save();
                ctx.globalAlpha = 0.1;
                ctx.translate(-(ox % 512), -(oy % 512));
                ctx.fillStyle = ctx.createPattern(texture, 'repeat');
                ctx.fillRect(ox % 512, oy % 512, w, h);
                ctx.restore();
            }
            ctx.globalCompositeOperation = 'destination-out';
            ctx.drawImage(blurred, 0, 0, w, h);
            // On the dark basemap the cleared ground is nearly as dark as the
            // fog, so lift it with a faint wash to make the explored areas read.
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(this._tinted(blurred, 'rgba(190, 230, 190, 0.16)'), 0, 0, w, h);
        } else {
            ctx.drawImage(blurred, 0, 0, w, h);
            ctx.globalCompositeOperation = 'source-in';
            ctx.fillStyle = 'rgba(102, 187, 106, 0.5)';
            ctx.fillRect(0, 0, w, h);
        }
        ctx.globalCompositeOperation = 'source-over';
    },
});

// Every Strava route on one canvas. One L.polyline per route meant Leaflet
// re-projected, clipped and simplified every point of every route after each
// zoom — over a second per zoom step with a few thousand routes. Here routes
// outside the view are skipped and each zoom draws copies thinned to about a
// pixel, all in a single stroke. The routes aren't interactive, so nothing is
// lost by not being Leaflet paths.
const RoutesLayer = CanvasOverlay.extend({
    options: { className: 'wm-routes-canvas', hiDPI: true, color: '#FC4C02', weight: 1.4, opacity: 0.75 },

    // getRoutes() → [makeRoute()]
    initialize(getRoutes, options) {
        this._getRoutes = getRoutes;
        L.setOptions(this, options);
    },

    _draw({ canvas, dpr, worldPx, project, view }) {
        const { px, py } = project(dpr);
        const maxStep = 1.2 * 360 / worldPx;  // about a pixel
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = this.options.color;
        ctx.globalAlpha = this.options.opacity;
        ctx.lineWidth = this.options.weight * dpr;
        ctx.lineCap = ctx.lineJoin = 'round';
        ctx.beginPath();
        this._getRoutes().forEach(r => {
            if (!routeInView(r, view)) return;
            const pts = routePoints(r, maxStep);
            ctx.moveTo(px(pts[0][1]), py(pts[0][0]));
            for (let i = 1; i < pts.length; i++) ctx.lineTo(px(pts[i][1]), py(pts[i][0]));
        });
        ctx.stroke();
    },
});

// ── Wheel / trackpad zoom ─────────────────────────────────────────────────────
//
// Fluid zoom, the way Google Maps and MapLibre do it, instead of Leaflet's
// wheel handler — which turns each 40 ms batch of wheel input into a separate
// 250 ms zoom animation (and, in 1.9.4, divides the input by 3× the pixel
// ratio on a Mac, 2× elsewhere, so it crawled). Here every wheel event nudges
// a target zoom in proportion to how far it scrolled, and the map glides
// toward that target frame by frame, keeping the point under the cursor
// still. A mouse-wheel notch (≈100 px on every OS) is one level; a trackpad
// pinch or a free-spinning wheel streams small deltas that add up smoothly.
// Touch pinch is Leaflet's own TouchZoom and already follows the fingers.

const WHEEL_PX_PER_LEVEL = 100;            // one mouse-wheel notch ≈ one zoom level
const PINCH_PX_PER_LEVEL = 100 * Math.LN2; // Chrome/Edge/Firefox send a trackpad pinch as ctrl+wheel with deltaY = −100·ln(scale)
const WHEEL_EASE_MS = 60;                  // time constant of the glide: a notch lands in ~200 ms
const MAX_EVENT_LEVELS = 2;                // one event never moves the target further (accelerated wheels)

// How many zoom levels one wheel event asks for (+ = in).
function wheelZoomLevels(e) {
    if (!e.deltaY) return 0;  // horizontal scroll
    // Lines (Firefox's mouse wheel, 3 per notch) and pages to pixels.
    let px = e.deltaY * (e.deltaMode === 1 ? WHEEL_PX_PER_LEVEL / 3 : e.deltaMode === 2 ? 800 : 1);
    if (L.Browser.gecko && e.deltaMode === 0) px /= window.devicePixelRatio || 1;  // Firefox doubles them on Retina
    // A pinch arrives as ctrl+wheel with small fractional deltas; scale it so
    // the map follows the fingers.
    const pinch = e.ctrlKey && !Number.isInteger(px) && Math.abs(px) < 10;
    const levels = -px / (pinch ? PINCH_PX_PER_LEVEL : WHEEL_PX_PER_LEVEL);
    return Math.max(-MAX_EVENT_LEVELS, Math.min(MAX_EVENT_LEVELS, levels));
}

function tuneWheelZoom(map) {
    const wheel = map.scrollWheelZoom;
    // The glide in progress: target zoom, current zoom, and the spot that
    // stays under the cursor.
    let glide = null, glideFrame = 0, lastTime = 0;

    function step(now) {
        glideFrame = 0;
        // rAF stamps a frame with its start, which can be just before the
        // event that scheduled it.
        const dt = Math.max(4, Math.min(64, now - lastTime));
        lastTime = now;
        const g = glide;
        g.zoom += (g.target - g.zoom) * (1 - Math.exp(-dt / WHEEL_EASE_MS));
        const done = Math.abs(g.target - g.zoom) < 0.002;
        if (done) g.zoom = g.target;
        const offset = g.point.subtract(map.getSize().divideBy(2));
        let center = map.unproject(map.project(g.latlng, g.zoom).subtract(offset), g.zoom);
        if (map.options.maxBounds) center = map._limitCenter(center, g.zoom, map.options.maxBounds);
        if (done) {
            glide = null;
            map._move(center, g.zoom)._moveEnd(true);  // zoomend + moveend: tiles load, layers redraw
        } else {
            // `flyTo` is how Leaflet's own flyTo moves the map every frame:
            // tiles and vectors are scaled, not reloaded, until the end.
            map._move(center, g.zoom, { flyTo: true });
            glideFrame = L.Util.requestAnimFrame(step);
        }
    }

    // Stop gliding where the map is now (a drag, a button zoom, …).
    function stopGlide() {
        if (!glide) return;
        L.Util.cancelAnimFrame(glideFrame);
        glideFrame = 0;
        glide = null;
        map._moveEnd(true);
    }
    const leafletStop = map._stop;
    map._stop = function () {
        stopGlide();
        return leafletStop.apply(this, arguments);
    };

    wheel._onWheelScroll = function (e) {
        L.DomEvent.stop(e);
        const levels = wheelZoomLevels(e);
        if (!levels || map._animatingZoom) return;
        if (!glide) {
            map._stop();  // pan inertia, flyTo
            glide = { zoom: map.getZoom(), target: map.getZoom() };
            map._moveStart(true, false);
        }
        // Re-anchor on the cursor every event, so moving the mouse while
        // zooming zooms toward wherever it now points.
        glide.point = map.mouseEventToContainerPoint(e);
        glide.latlng = map.containerPointToLatLng(glide.point);
        glide.target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), glide.target + levels));
        if (!glideFrame) {
            lastTime = performance.now();
            glideFrame = L.Util.requestAnimFrame(step);
        }
    };

    // The handler bound its listener when it was enabled; rebind to the above.
    if (wheel.enabled()) { wheel.disable(); wheel.enable(); }

    // leaflet-gesture-handling switches wheel zoom on from inside the first
    // ctrl/⌘+wheel event, too late for that event to reach it, so the first
    // notch after scrolling the page did nothing. Switch it on one step
    // earlier, in the capture phase of the same event.
    map.getContainer().addEventListener('wheel', e => {
        if ((e.ctrlKey || e.metaKey) && !wheel.enabled()) wheel.enable();
    }, { capture: true, passive: true });

    // Safari on a Mac sends trackpad pinches as gesture events, not wheel
    // events, and Leaflet ignores them — the pinch zoomed the whole page.
    // Follow them the way Leaflet's TouchZoom follows a touch pinch: move the
    // map every frame around the point under the cursor, snap at the end.
    // Touch devices fire these alongside touch events, which TouchZoom handles
    // (L.Browser.touch is true for any pointer-events browser, desktop Safari
    // included, so test for real touch events).
    if (L.Browser.touchNative) return;
    const el = map.getContainer();
    let pinch = null, frame = 0;
    el.addEventListener('gesturestart', e => {
        e.preventDefault();
        map._stop();
        const pt = map.mouseEventToContainerPoint(e);
        pinch = { zoom: map.getZoom(), latlng: map.containerPointToLatLng(pt), center: map.getCenter(), at: map.getZoom() };
        map._moveStart(true, false);
    });
    el.addEventListener('gesturechange', e => {
        e.preventDefault();
        if (!pinch) return;
        const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), pinch.zoom + Math.log2(e.scale)));
        const offset = map.mouseEventToContainerPoint(e).subtract(map.getSize().divideBy(2));
        pinch.at = zoom;
        pinch.center = map.unproject(map.project(pinch.latlng, zoom).subtract(offset), zoom);
        L.Util.cancelAnimFrame(frame);
        frame = L.Util.requestAnimFrame(() => map._move(pinch.center, pinch.at, { pinch: true, round: false }), null, true);
    });
    el.addEventListener('gestureend', e => {
        e.preventDefault();
        if (!pinch) return;
        L.Util.cancelAnimFrame(frame);
        const { center, at, zoom } = pinch;
        pinch = null;
        if (at === zoom) { map._moveEnd(false); return; }  // fingers didn't move
        if (map._zoomAnimated) map._animateZoom(center, map._limitZoom(at), true, map.options.zoomSnap);
        else map._resetView(center, map._limitZoom(at));
    });
}

// ── The map ───────────────────────────────────────────────────────────────────

function createWorldMap(mapId, { worldData, countriesGeojson, visitedStates, places, drivenSegments }) {
    const container = document.getElementById(mapId);
    // The furthest out the map may zoom: where the world (256·2^z px tall)
    // still fills the map's height, so there's never grey above the Arctic or
    // below Antarctica — on a tall phone map that's past zoom 1.
    const fillZoom = () => Math.max(1, Math.ceil(Math.log2(map.getSize().y / 256) * 10) / 10);
    const narrow = container && container.clientWidth < 600;
    const map = L.map(mapId, {
        center: narrow ? [30, -40] : [25, 10],  // phones: the US and Europe
        zoom: narrow ? 1 : 2,
        minZoom: 1,
        maxBounds: [[-85.06, -540], [85.06, 540]],  // vertical clamp only; worldCopyJump wraps sideways
        maxBoundsViscosity: 1,
        zoomSnap: 0.1,
        zoomDelta: 1,  // +/− buttons, double-click / double-tap, keyboard: one level, as on other maps
        worldCopyJump: true,
        gestureHandling: true,
        tap: false,  // avoid Leaflet's synthetic-click delay, which breaks the fullscreen gesture on mobile
        fullscreenControl: true,
        fullscreenControlOptions: { position: 'topleft' },
    });

    // Gesture handling (two-finger / ctrl-scroll) only makes sense inline.
    map.on('enterFullscreen', () => map.gestureHandling.disable());
    map.on('exitFullscreen',  () => map.gestureHandling.enable());
    map.setMinZoom(fillZoom());
    if (map.getZoom() < map.getMinZoom()) map.setZoom(map.getMinZoom(), { animate: false });
    map.on('resize', () => map.setMinZoom(fillZoom()));  // fullscreen / rotation
    tuneWheelZoom(map);

    map.createPane('footprintPane').style.zIndex = 350;  // over the basemap, under routes and markers
    map.getPane('footprintPane').style.pointerEvents = 'none';
    map.createPane('regionPane').style.zIndex = 399;     // just under the country outlines and routes

    const state = {
        mode: ['countries', 'footprint', 'fog'].includes(wmStore(STORAGE.mode)) ? wmStore(STORAGE.mode) : 'countries',
        isDark: true,
        detail: DETAIL_LEVELS.includes(wmStore(STORAGE.detail)) ? wmStore(STORAGE.detail) : 'lands',
        stravaRoutes: [],           // makeRoute() per Strava activity, once loaded
        stravaStarts: [],           // [lat, lng] where each Strava activity starts
        stravaByPart: new Map(),    // outline feature → Strava activity count
    };

    // ── Layers ──
    const placeGroups = {};
    PLACE_CATEGORIES.forEach(cat => { placeGroups[cat.id] = L.layerGroup(); });
    // Light basemaps get a heavier, more opaque line so the routes stay punchy.
    const stravaStyle = () => ({ weight: state.isDark ? 1.4 : 2, opacity: state.isDark ? 0.75 : 0.9 });
    const stravaLayer = new RoutesLayer(() => state.stravaRoutes, { color: STRAVA_LAYER.color, ...stravaStyle() });
    const overlayLabel = c => `<span class="wm-layer-symbol" style="color:${c.color}">${c.symbol}</span> ${c.label}`;
    const overlays = {};
    PLACE_CATEGORIES.forEach(cat => { overlays[overlayLabel(cat)] = placeGroups[cat.id]; });
    overlays[overlayLabel(STRAVA_LAYER)] = stravaLayer;

    setupMapBasemaps(map, {
        overlays,
        defaultBasemap: 'dark',
        onThemeChange: isDark => { state.isDark = isDark; restyleCountries(); restyleStrava(); },
    });
    new MapLocationControl().addTo(map);

    // ── Countries ──
    // An outline is a country's core or one of its outlying parts (the Azores,
    // the Canaries, Hawaii, …; `part` names it). The detail toggle picks how
    // much of a visited country fills:
    //   countries   all of it, overseas parts included
    //   lands       its core, plus each outlying part I've been to
    //   subregions  each first-level region (state, province) I've been to, for
    //               the countries in ADMIN1_FILES; lands everywhere else
    // "Been to" is a place or a Strava route start inside it, or for Alaska /
    // Hawaii (and US states) the US dashboard marking the state visited.
    const locate = makeCountryLocator(countriesGeojson.features);
    const placesByPart = new Map();
    places.forEach(p => {
        const f = locate(p.lat, p.lng);
        if (f) placesByPart.set(f, (placesByPart.get(f) || 0) + 1);
    });
    const partsByCountry = new Map();
    countriesGeojson.features.forEach(f => {
        const name = f.properties.name;
        if (!partsByCountry.has(name)) partsByCountry.set(name, []);
        partsByCountry.get(name).push(f);
    });
    const listed = new Map();
    CONTINENT_KEYS.forEach(k => worldData[k].forEach(c => listed.set(c.name, c)));

    // Subregions (filled in by loadRegions below).
    const regionData = new Map();   // country name → { locate } once loaded
    const regionCovered = new Set();  // outline features the loaded regions cover
    const regionLoads = new Set();  // country names fetched or being fetched
    const placesByRegion = new Map();
    const stravaByRegion = new Map();

    const isVisitedCountry = name => name === HOME_COUNTRY || !!(listed.get(name) || {}).visited;
    const visitedColor = name => name === HOME_COUNTRY ? 'home' : 'visited';
    const lineColor = () => state.isDark ? 'rgba(255, 255, 255, 0.28)' : 'rgba(40, 40, 40, 0.35)';

    function beenToPart(f) {
        return placesByPart.get(f) || state.stravaByPart.get(f)
            || (f.properties.name === HOME_COUNTRY && visitedStates[f.properties.part] === true);
    }

    function countryStatus(feature) {
        const { name, part } = feature.properties;
        const scope = state.detail === 'countries' ? partsByCountry.get(name) : [feature];
        const been = scope.some(beenToPart);
        if (isVisitedCountry(name)) {
            // Outside the whole-country view, an outlying part fills only once
            // I've been to it.
            if (part && !been && state.detail !== 'countries') return 'none';
            return visitedColor(name);
        }
        // Territories aren't in countries.json: they count once I've a place
        // or a route inside them.
        if (!listed.has(name) && been) return 'visited';
        if (scope.some(f => state.stravaByPart.get(f))) return 'strava';
        return 'none';
    }

    // Subregions view: an outline whose regions are drawn keeps only its border.
    // Parts no region covers (Tokelau, the Dutch Caribbean) keep the lands fill.
    const regionsShown = f => state.detail === 'subregions' && regionCovered.has(f);

    function fillStyle(status) {
        if (status === 'none') {
            return { color: lineColor(), weight: 0.6, opacity: 1, fill: true, fillColor: state.isDark ? '#fff' : '#000', fillOpacity: 0.03 };
        }
        const color = COUNTRY_COLORS[status];
        return { color, weight: 1, opacity: 0.9, fill: true, fillColor: color, fillOpacity: status === 'strava' ? 0.3 : 0.5 };
    }

    function countryStyle(feature) {
        if (regionsShown(feature)) {
            // No fill, so clicks reach the regions underneath.
            return { color: state.isDark ? 'rgba(255, 255, 255, 0.55)' : 'rgba(40, 40, 40, 0.6)', weight: 1, opacity: 1, fill: false };
        }
        return fillStyle(countryStatus(feature));
    }

    function flagEmoji(iso) {
        if (!/^[A-Z]{2}$/.test(iso || '')) return '';
        return String.fromCodePoint(...[...iso].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
    }

    function countryPopup(feature) {
        const { name, iso, sov, part } = feature.properties;
        const entry = listed.get(name);
        const status = countryStatus(feature);
        const placeCount = placesByPart.get(feature) || 0;
        const stravaCount = state.stravaByPart.get(feature) || 0;
        const statusText = {
            home: 'Home', visited: 'Visited', none: 'Not yet visited',
            strava: 'Strava activity, not marked visited',
        }[status];
        const lines = [];
        if (part) lines.push(`Part of ${escapeHtml(name)}`);
        else if (!entry) lines.push(sov && sov !== name ? `Territory of ${escapeHtml(sov)}` : 'Not counted as a country');
        if (entry && entry.population && !part) lines.push(`Population ${entry.population.toLocaleString()}`);
        if (placeCount) lines.push(`${placeCount.toLocaleString()} place${placeCount === 1 ? '' : 's'} on the map`);
        if (stravaCount) lines.push(`${stravaCount.toLocaleString()} Strava ${stravaCount === 1 ? 'activity' : 'activities'}`);
        return `
            <div class="wm-popup">
                <h3>${flagEmoji(iso)} ${escapeHtml(part || name)}</h3>
                <div class="wm-popup-status wm-status-${status}">${statusText}</div>
                ${lines.map(l => `<p>${l}</p>`).join('')}
                ${entry ? '<p><a href="world-dashboard.html">See all countries →</a></p>' : ''}
            </div>`;
    }

    const countryLayer = L.geoJSON(countriesGeojson, {
        // Leaflet's default 10% renderer padding makes polygons vanish at the
        // leading edge while dragging; half a screen keeps them drawn.
        renderer: L.svg({ padding: 0.5 }),
        style: countryStyle,
        onEachFeature(feature, layer) {
            layer.bindPopup(() => countryPopup(feature), { maxWidth: 260 });
            layer.on('mouseover', () => layer.setStyle({ weight: 2, fillOpacity: Math.min(0.75, (countryStyle(feature).fillOpacity || 0) + 0.15) }));
            layer.on('mouseout', () => countryLayer.resetStyle(layer));
        },
    });

    function restyleCountries() {
        countryLayer.setStyle(countryStyle);
        regionLayer.setStyle(regionStyle);
    }

    // ── Subregions ──
    // Boundaries are fetched per country, the first time the Subregions view
    // needs them, and only for countries I've been to.

    function beenToRegion(f) {
        const { wmCountry, aliases } = f.properties;
        return placesByRegion.get(f) || stravaByRegion.get(f)
            || (wmCountry === HOME_COUNTRY && (aliases || [f.properties.name]).some(a => visitedStates[a] === true));
    }

    function regionStatus(f) {
        const country = f.properties.wmCountry;
        if (isVisitedCountry(country)) return beenToRegion(f) ? visitedColor(country) : 'none';
        return stravaByRegion.get(f) ? 'strava' : 'none';
    }

    function regionStyle(f) {
        const style = fillStyle(regionStatus(f));
        // Region borders are the fine ones; the country border sits on top.
        return regionStatus(f) === 'none' ? { ...style, weight: 0.4 } : { ...style, color: lineColor(), weight: 0.6 };
    }

    function regionPopup(f) {
        const { name, wmCountry, aliases } = f.properties;
        const status = regionStatus(f);
        const placeCount = placesByRegion.get(f) || 0;
        const stravaCount = stravaByRegion.get(f) || 0;
        const lines = [`Part of ${escapeHtml(wmCountry)}`];
        if (placeCount) lines.push(`${placeCount.toLocaleString()} place${placeCount === 1 ? '' : 's'} on the map`);
        if (stravaCount) lines.push(`${stravaCount.toLocaleString()} Strava ${stravaCount === 1 ? 'activity' : 'activities'}`);
        if (wmCountry === HOME_COUNTRY && (aliases || [name]).some(a => visitedStates[a] === true)) lines.push('Marked visited on the US dashboard');
        const statusText = { home: 'Visited', visited: 'Visited', none: 'Not yet visited', strava: 'Strava activity, country not marked visited' }[status];
        return `
            <div class="wm-popup">
                <h3>${escapeHtml(name)}</h3>
                <div class="wm-popup-status wm-status-${status}">${statusText}</div>
                ${lines.map(l => `<p>${l}</p>`).join('')}
            </div>`;
    }

    const regionLayer = L.geoJSON(null, {
        pane: 'regionPane',
        renderer: L.svg({ padding: 0.5, pane: 'regionPane' }),
        style: regionStyle,
        onEachFeature(feature, layer) {
            layer.bindPopup(() => regionPopup(feature), { maxWidth: 260 });
            layer.on('mouseover', () => layer.setStyle({ weight: 2, fillOpacity: Math.min(0.75, (regionStyle(feature).fillOpacity || 0) + 0.15) }));
            layer.on('mouseout', () => regionLayer.resetStyle(layer));
        },
    });

    function countRegions() {
        placesByRegion.clear();
        stravaByRegion.clear();
        const bump = (m, f) => { if (f) m.set(f, (m.get(f) || 0) + 1); };
        regionData.forEach(({ locate: locateRegion }) => {
            places.forEach(p => bump(placesByRegion, locateRegion(p.lat, p.lng)));
            state.stravaStarts.forEach(([lat, lng]) => bump(stravaByRegion, locateRegion(lat, lng)));
        });
    }

    function loadRegions() {
        Object.entries(ADMIN1_FILES).forEach(([name, file]) => {
            if (regionLoads.has(name)) return;
            const parts = partsByCountry.get(name) || [];
            if (!isVisitedCountry(name) && !parts.some(f => beenToPart(f))) return;
            regionLoads.add(name);
            fetch(`data/admin1/${file}.geojson`)
                .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
                .then(geojson => {
                    geojson.features.forEach(f => { f.properties.wmCountry = name; });
                    const locateRegion = makeCountryLocator(geojson.features);
                    regionData.set(name, { locate: locateRegion });
                    parts.forEach(f => {
                        const pt = interiorPoint(f.geometry);
                        if (pt && locateRegion(pt[1], pt[0])) regionCovered.add(f);
                    });
                    countRegions();
                    regionLayer.addData(geojson);
                    restyleCountries();
                    renderLegend();
                })
                .catch(err => {
                    // Without its regions the country just keeps its lands view.
                    console.warn(`Regions for ${name} unavailable:`, err);
                    regionLoads.delete(name);
                });
        });
    }

    function updateRegionLayer() {
        if (state.mode === 'countries' && state.detail === 'subregions') {
            loadRegions();
            regionLayer.addTo(map);
        } else {
            map.removeLayer(regionLayer);
        }
    }

    // ── Place markers ──
    const catById = Object.fromEntries(PLACE_CATEGORIES.map(c => [c.id, c]));
    const icons = Object.fromEntries(PLACE_CATEGORIES.map(c => [c.id, L.divIcon({
        className: c.cls,
        html: `<div class="${c.cls}-inner">${c.symbol}</div>`,
        iconSize: [c.size, c.size],
        iconAnchor: [c.size / 2, c.size / 2],
        popupAnchor: [0, -c.size / 2],
    })]));
    const placeCounts = {};
    places.forEach(p => {
        placeCounts[p.cat] = (placeCounts[p.cat] || 0) + 1;
        L.marker([p.lat, p.lng], { icon: icons[p.cat], zIndexOffset: catById[p.cat].z, title: p.name })
            .bindPopup(`<div class="${p.cat === 'cities' || p.cat === 'parks' ? 'city-popup' : 'high-point-popup'}"><h3>${escapeHtml(p.name)}</h3>${p.details.join('')}</div>`)
            .addTo(placeGroups[p.cat]);
    });

    // ── Strava routes ──
    // Fetched once, the first time the layer is switched on.
    let stravaStatus = 'idle';  // idle | loading | ready | error
    function restyleStrava() { stravaLayer.setOptions(stravaStyle()); }

    async function loadStrava() {
        if (stravaStatus !== 'idle') return;
        stravaStatus = 'loading';
        renderChips();
        try {
            const res = await fetch(`${WORLD_MAP_WORKER_URL}/polylines/all`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const encoded = await res.json();
            encoded.forEach(enc => {
                if (!enc) return;
                const points = decodeWorldPolyline(enc);
                if (!points.length) return;
                state.stravaRoutes.push(makeRoute(points));
                state.stravaStarts.push(points[0]);
                const f = locate(points[0][0], points[0][1]);
                if (f) state.stravaByPart.set(f, (state.stravaByPart.get(f) || 0) + 1);
            });
            stravaStatus = 'ready';
            stravaLayer.redraw();
            countRegions();
            if (state.mode === 'countries' && state.detail === 'subregions') loadRegions();
            restyleCountries();
            renderLegend();
            if (footprint && map.hasLayer(stravaLayer)) footprint.redraw();
        } catch (err) {
            console.warn('Strava routes unavailable:', err);
            stravaStatus = 'error';
            map.removeLayer(stravaLayer);
        }
        renderChips();
    }

    // ── Footprint / fog ──
    const highwayRoutes = drivenSegments.map(makeRoute);
    let footprint = null;
    const radiusSlider = document.getElementById('radius-slider');
    const routeSlider = document.getElementById('route-radius-slider');
    const footprintSources = () => ({
        points: places,
        routes: map.hasLayer(stravaLayer) ? highwayRoutes.concat(state.stravaRoutes) : highwayRoutes,
    });

    // ── Toolbar: view modes, sliders, layer chips ──
    const modeButtons = document.querySelectorAll('.view-mode-btn[data-mode]');
    const detailButtons = document.querySelectorAll('.view-mode-btn[data-detail]');
    const detailRow = document.getElementById('detail-control');
    const sliderRows = [document.getElementById('radius-control'), document.getElementById('route-radius-control')];
    const chipBar = document.getElementById('wm-layer-chips');

    function setMode(mode) {
        state.mode = mode;
        wmStore(STORAGE.mode, mode);
        modeButtons.forEach(b => {
            const on = b.dataset.mode === mode;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on);
        });
        sliderRows.forEach(r => { if (r) r.hidden = mode === 'countries'; });
        if (detailRow) detailRow.hidden = mode !== 'countries';
        updateMarkerVisibility();
        updateRegionLayer();
        if (mode === 'countries') {
            if (footprint) { map.removeLayer(footprint); footprint = null; }
            countryLayer.addTo(map);
        } else {
            map.removeLayer(countryLayer);
            const opts = { mode, pointKm: +radiusSlider.value, routeKm: +routeSlider.value };
            if (footprint) footprint.setOptions(opts);
            else footprint = new FootprintLayer(footprintSources, opts).addTo(map);
        }
        renderLegend();
    }

    // Footprint and Fog read best uncluttered: their overview hides the
    // markers, which come back once zoomed in far enough to tell them apart.
    function markersHidden() { return state.mode !== 'countries' && map.getZoom() < OVERLAY_MARKER_ZOOM; }
    function updateMarkerVisibility() {
        map.getContainer().classList.toggle('wm-hide-markers', markersHidden());
    }
    map.on('zoomend', () => { updateMarkerVisibility(); renderLegend(); });

    modeButtons.forEach(btn => btn.addEventListener('click', () => {
        if (btn.dataset.mode !== state.mode) setMode(btn.dataset.mode);
    }));

    function setDetail(detail) {
        state.detail = detail;
        wmStore(STORAGE.detail, detail);
        detailButtons.forEach(b => {
            const on = b.dataset.detail === detail;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on);
        });
        updateRegionLayer();
        restyleCountries();
        renderLegend();
    }

    detailButtons.forEach(btn => btn.addEventListener('click', () => {
        if (btn.dataset.detail !== state.detail) setDetail(btn.dataset.detail);
    }));

    [[radiusSlider, 'radius-value', STORAGE.radius, 'pointKm'], [routeSlider, 'route-radius-value', STORAGE.route, 'routeKm']]
        .forEach(([slider, labelId, key, opt]) => {
            if (!slider) return;
            const saved = Number(wmStore(key));
            if (saved >= +slider.min && saved <= +slider.max) slider.value = saved;
            const label = document.getElementById(labelId);
            label.textContent = slider.value;
            // Redraw at most once per frame while dragging.
            let pending = false;
            slider.addEventListener('input', () => {
                label.textContent = slider.value;
                wmStore(key, slider.value);
                if (!footprint || pending) return;
                pending = true;
                requestAnimationFrame(() => { pending = false; if (footprint) footprint.setOptions({ [opt]: +slider.value }); });
            });
        });

    const hiddenLayers = new Set((wmStore(STORAGE.layers) || '').split(',').filter(Boolean));
    const layerFor = id => id === STRAVA_LAYER.id ? stravaLayer : placeGroups[id];

    function renderChips() {
        if (!chipBar) return;
        const chips = PLACE_CATEGORIES.map(c => ({ ...c, count: (placeCounts[c.id] || 0).toLocaleString() }));
        const stravaCount = { idle: '', loading: '…', ready: state.stravaRoutes.length.toLocaleString(), error: 'unavailable' }[stravaStatus];
        chips.push({ ...STRAVA_LAYER, count: stravaCount });
        chipBar.innerHTML = chips.map(c => {
            const on = map.hasLayer(layerFor(c.id));
            const disabled = c.id === STRAVA_LAYER.id && stravaStatus === 'error';
            return `<button type="button" class="wm-chip${on ? ' active' : ''}" data-layer="${c.id}" aria-pressed="${on}"${disabled ? ' disabled' : ''}>
                <span class="wm-chip-symbol" style="color:${c.color}">${c.symbol}</span>${c.label}${c.count ? ` <span class="wm-chip-count">${c.count}</span>` : ''}
            </button>`;
        }).join('');
    }

    chipBar && chipBar.addEventListener('click', e => {
        const chip = e.target.closest('.wm-chip');
        if (!chip || chip.disabled) return;
        const layer = layerFor(chip.dataset.layer);
        if (map.hasLayer(layer)) map.removeLayer(layer); else map.addLayer(layer);
    });

    // Chips and the layer control's checkboxes both land here.
    map.on('layeradd layerremove', e => {
        const id = e.layer === stravaLayer ? STRAVA_LAYER.id
            : Object.keys(placeGroups).find(k => placeGroups[k] === e.layer);
        if (!id) return;
        // A failed Strava fetch switches the layer off; don't remember that as
        // a choice, or it would stay off after the worker recovers.
        if (!(id === STRAVA_LAYER.id && stravaStatus === 'error')) {
            if (e.type === 'layeradd') hiddenLayers.delete(id); else hiddenLayers.add(id);
            wmStore(STORAGE.layers, [...hiddenLayers].join(','));
        }
        if (id === STRAVA_LAYER.id) {
            if (e.type === 'layeradd') loadStrava();
            if (footprint) footprint.redraw();
        }
        renderChips();
    });

    // ── Legend ──
    const legend = L.control({ position: 'bottomright' });
    legend.onAdd = () => L.DomUtil.create('div', 'info legend wm-legend');
    legend.addTo(map);

    function renderLegend() {
        const el = legend.getContainer();
        if (!el) return;
        const swatch = (color, label, outline) => `<div><span class="legend-swatch" style="background:${outline ? 'transparent' : color};${outline ? `border-color:${color}` : ''}"></span> ${label}</div>`;
        if (state.mode === 'countries') {
            const anyStrava = [...state.stravaByPart.keys()].some(f => !regionsShown(f) && countryStatus(f) === 'strava')
                || (map.hasLayer(regionLayer) && [...stravaByRegion.keys()].some(f => regionStatus(f) === 'strava'));
            el.innerHTML = swatch(COUNTRY_COLORS.home, 'Home country')
                + swatch(COUNTRY_COLORS.visited, 'Visited')
                + (anyStrava ? swatch(COUNTRY_COLORS.strava, 'Strava only') : '')
                + swatch('rgba(255,255,255,0.5)', 'Not yet visited', true);
        } else {
            const routes = map.hasLayer(stravaLayer) && stravaStatus === 'ready' ? 'highways &amp; Strava routes' : 'driven highways';
            el.innerHTML = `<div class="wm-legend-note">${state.mode === 'fog' ? 'Cleared' : 'Green'}: within ${radiusSlider.value} km of a place, ${routeSlider.value} km of ${routes}</div>`
                + (markersHidden() ? '<div class="wm-legend-note wm-legend-hint">Zoom in to see the places</div>' : '');
        }
    }
    [radiusSlider, routeSlider].forEach(s => s && s.addEventListener('input', renderLegend));

    // ── Initial state ──
    PLACE_CATEGORIES.forEach(c => { if (!hiddenLayers.has(c.id)) placeGroups[c.id].addTo(map); });
    if (!hiddenLayers.has(STRAVA_LAYER.id)) stravaLayer.addTo(map);  // → loadStrava() via layeradd
    setDetail(state.detail);
    setMode(state.mode);
    renderChips();
}

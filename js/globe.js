// World Globe (globe.html): a concept page showing the World Travel map's data
// on a 3D MapLibre GL globe.
//
// The data and its rules come from js/world-map.js (loaded on the page without
// Leaflet): the same files and worker endpoints, collectPlaces() /
// collectTodoPlaces() / collectDrivenSegments() for the pins and highways, and
// makeCountryLocator() + routeCells() for which outlines and regions a Strava
// route passes through. Two fill levels, as on the map: Countries (its "Lands"
// level: a visited country's core, plus each outlying part with a place or
// route in it) and Subregions (each state / province with a place or route in
// it, from data/admin1/). Footprint and Fog of War are drawn on canvases
// projected onto the globe (see the Footprint / fog section below).

const GLOBE_WORKER_URL = 'https://strava-worker.justinguyette.workers.dev';

// Public browser-side tile key, same one js/strava.js and js/map-controls.js use.
const GLOBE_CARTO_KEY = 'cb1_43mc_1_257b4a4d0d9625f587e00261';

const GLOBE_COLORS = {
    home: '#FFC107', visited: '#4CAF50', strava: '#FC4C02',
    land: '#26313d', ocean: '#0d1b2a', highway: '#B388FF',
};

// How high a country rises in "Raised" mode, in metres. The globe is drawn at
// world scale, so it takes hundreds of kilometres to read from orbit.
const GLOBE_RAISE_M = { home: 140000, visited: 90000, strava: 35000 };

// Mapzen / AWS open terrain tiles, for hillshade and 3D terrain (no key).
const GLOBE_DEM = {
    type: 'raster-dem', tileSize: 256, maxzoom: 15, encoding: 'terrarium',
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    attribution: 'Terrain: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">Mapzen, AWS</a>',
};

const GLOBE_STORAGE = {
    basemap: 'globe_base', raise: 'globe_raised', off: 'globe_hidden', detail: 'globe_detail',
    mode: 'globe_mode', radius: 'globe_radius', route: 'globe_route_radius', tiles: 'globe_tiles',
};

// Region features get ids from here up, so a click can tell them from outlines.
const GLOBE_REGION_ID = 100000;

// Footprint / fog canvases (Spherical Mercator, which is how MapLibre maps a
// canvas onto the globe). The world canvas is always there; once zoomed in
// past GLOBE_DETAIL_ZOOM a sharper one covers the view and its surroundings.
const GLOBE_MERC_MAX_LAT = 85.0511;
const GLOBE_DETAIL_ZOOM = 3;

// Tile Hunter's z14 tiles (strava.html), with its colours and rules: a cluster
// tile has all four neighbours visited, and squares of SIZE ≥ 10 are shown.
const GLOBE_TILE_ZOOM = 14;
const GLOBE_SQUARE_THRESHOLD = 10;
const GLOBE_TILE_TIERS = [
    ['isolated',   'rgba(244, 67, 54, 0.55)',   'Tile'],
    ['cluster',    'rgba(129, 199, 132, 0.60)', 'Cluster'],
    ['maxCluster', 'rgba(46, 125, 50, 0.80)',   'Max cluster'],
    ['square',     'rgba(100, 181, 246, 0.65)', 'Square'],
    ['maxSquare',  'rgba(21, 101, 192, 0.85)',  'Max square'],
];

function globeStore(key, value) {
    try {
        if (value === undefined) return localStorage.getItem(key);
        localStorage.setItem(key, value);
    } catch (e) { /* private mode: just don't remember */ }
    return null;
}

document.addEventListener('DOMContentLoaded', () => {
    loadGlobeData()
        .then(buildGlobe)
        .catch(err => {
            console.error('Globe failed to load:', err);
            const msg = document.getElementById('globe-loading');
            msg.textContent = 'Could not load the globe. Please try again later.';
            msg.hidden = false;
        });
});

// The World Travel map's sources (initWorldMap in js/world-map.js), plus the
// countries list the dashboard loads for it.
function loadGlobeData() {
    const json = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`); return r.json(); });
    return Promise.all([
        TravelAPI.fetchCountries().catch(() => json('data/countries.json')),
        json('data/worldCities.json'),
        TravelAPI.fetchMetros(),
        json('data/worldMountains.json'),
        json('data/familyTravels.json'),
        TravelAPI.fetchHighPoints(),
        TravelAPI.fetchNationalParks(),
        json('data/skiResorts.json'),
        json('data/sevenWonders.json'),
        TravelAPI.fetchPeaksWithFallback('britishIsles', 'data/british-isles-high-five.json'),
        TravelAPI.fetchPeaksWithFallback('adk46ers', 'data/adirondack46ers.json'),
        TravelAPI.fetchPeaksWithFallback('colorado14ers', 'data/colorado14ers.json'),
        TravelAPI.fetchPeaksWithFallback('countryHighpoints', 'data/country-highpoints.json'),
        json('data/forbes100cities.json'),
        json('data/interstateHighways.json'),
        json('data/highways.json'),
        json('data/world-countries.geojson'),
        loadBucketLists().catch(err => { console.warn('Bucket lists unavailable:', err); return null; }),
        TravelAPI.fetchVisitedStates()
            .catch(() => json('data/visitedStates.json'))
            .catch(() => ({})),
    ]).then(([worldData, citiesData, metrosData, highPointsData, familyTravelsData, stateHighPointsData, nationalParksData, skiResortsData, sevenWondersData, britishIslesData, adk46ersData, colorado14ersData, countryHighpointsData, forbes100Data, interstateData, highwaysData, countriesGeojson, bucketLists, visitedStates]) => ({
        worldData, countriesGeojson, visitedStates,
        places: collectPlaces({ citiesData, metrosData, highPointsData, familyTravelsData, stateHighPointsData, nationalParksData, skiResortsData, sevenWondersData, britishIslesData, adk46ersData, colorado14ersData, countryHighpointsData, forbes100Data }),
        todoPlaces: collectTodoPlaces(bucketLists),
        drivenSegments: collectDrivenSegments(interstateData, highwaysData),
    }));
}

// Zoom at which the whole globe fits the map with a margin. At zoom z the globe
// is 512·2^z / π px across.
function globeFitZoom(el) {
    const px = Math.min(el.clientWidth, el.clientHeight) * 0.82;
    return Math.max(0, Math.log2(px * Math.PI / 512));
}

function buildGlobe({ worldData, countriesGeojson, visitedStates, places, todoPlaces, drivenSegments }) {
    const container = document.getElementById('globe');
    const narrow = container.clientWidth < 600;

    const state = {
        basemap: ['none', 'dark', 'satellite'].includes(globeStore(GLOBE_STORAGE.basemap)) ? globeStore(GLOBE_STORAGE.basemap) : 'dark',
        raise: globeStore(GLOBE_STORAGE.raise) === '1',
        off: new Set((globeStore(GLOBE_STORAGE.off) ?? 'todo,highways').split(',').filter(Boolean)),
        detail: globeStore(GLOBE_STORAGE.detail) === 'lands' ? 'lands' : 'subregions',
        mode: ['countries', 'footprint', 'fog'].includes(globeStore(GLOBE_STORAGE.mode)) ? globeStore(GLOBE_STORAGE.mode) : 'countries',
        pointKm: +globeStore(GLOBE_STORAGE.radius) || 100,
        routeKm: +globeStore(GLOBE_STORAGE.route) || 50,
        strava: 'idle',  // idle | loading | ready | error
        tilesOn: globeStore(GLOBE_STORAGE.tiles) === '1',
        tiles: 'idle',   // idle | loading | ready | error
        tileStats: null, // { visited, maxCluster, maxSquare }
        stravaRoutes: [],  // makeRoute() per activity
        stravaCells: [],   // routeCells() per activity
    };
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── Countries ──
    const listed = new Map();
    CONTINENT_KEYS.forEach(k => (worldData[k] || []).forEach(c => listed.set(c.name, c)));
    const countryFeatures = countriesGeojson.features;
    const locate = makeCountryLocator(countryFeatures);
    const bump = (m, f) => m.set(f, (m.get(f) || 0) + 1);
    const placesByPart = new Map();
    places.forEach(p => { const f = locate(p.lat, p.lng); if (f) bump(placesByPart, f); });
    const stravaByPart = new Map();
    const partsByCountry = new Map();
    countryFeatures.forEach(f => {
        const name = f.properties.name;
        if (!partsByCountry.has(name)) partsByCountry.set(name, []);
        partsByCountry.get(name).push(f);
    });

    const isVisited = name => name === HOME_COUNTRY || !!(listed.get(name) || {}).visited;
    const visitedStatus = name => name === HOME_COUNTRY ? 'home' : 'visited';
    const beenToPart = f => placesByPart.get(f) || stravaByPart.get(f)
        || (f.properties.name === HOME_COUNTRY && visitedStates[f.properties.part] === true);

    function countryStatus(f) {
        const { name, part } = f.properties;
        const been = beenToPart(f);
        if (isVisited(name)) return part && !been ? 'none' : visitedStatus(name);
        if (!listed.has(name) && been) return 'visited';
        return stravaByPart.get(f) ? 'strava' : 'none';
    }

    // ── Subregions ── (fetched once Strava has said which countries it reaches)
    let regionFeatures = [];
    const regionCovered = new Set();  // outlines whose regions are loaded
    const placesByRegion = new Map();
    const stravaByRegion = new Map();
    let regionsState = 'idle';  // idle | loading | ready

    function regionStatus(f) {
        const { wmCountry, aliases, name } = f.properties;
        const been = placesByRegion.get(f) || stravaByRegion.get(f)
            || (wmCountry === HOME_COUNTRY && (aliases || [name]).some(a => visitedStates[a] === true));
        if (isVisited(wmCountry)) return been ? visitedStatus(wmCountry) : 'none';
        return stravaByRegion.get(f) ? 'strava' : 'none';
    }

    async function loadRegions() {
        if (regionsState !== 'idle') return;
        regionsState = 'loading';
        renderLegend();
        const wanted = Object.entries(ADMIN1_FILES)
            .filter(([name]) => isVisited(name) || (partsByCountry.get(name) || []).some(beenToPart));
        const loaded = (await Promise.all(wanted.map(([name, file]) => fetch(`data/admin1/${file}.geojson`)
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then(geojson => ({ name, geojson }))
            .catch(err => { console.warn(`Regions for ${name} unavailable:`, err); return null; })))).filter(Boolean);
        const loadedNames = new Set(loaded.map(l => l.name));
        loaded.forEach(({ name, geojson }) => geojson.features.forEach(f => {
            f.properties.wmCountry = name;
            regionFeatures.push(f);
        }));
        // As on the map: other countries' outlines go in after the regions, so
        // a point in San Marino or the Vatican stops there rather than snapping
        // into the Italian region next door.
        const locateAny = makeCountryLocator(regionFeatures.concat(countryFeatures.filter(f => !loadedNames.has(f.properties.name))));
        const locateRegion = (lat, lng) => { const f = locateAny(lat, lng); return f && f.properties.wmCountry ? f : null; };
        loadedNames.forEach(name => (partsByCountry.get(name) || []).forEach(f => {
            const pt = interiorPoint(f.geometry);
            const hit = pt && locateRegion(pt[1], pt[0]);
            if (hit && hit.properties.wmCountry === name) regionCovered.add(f);
        }));
        places.forEach(p => { const f = locateRegion(p.lat, p.lng); if (f) bump(placesByRegion, f); });
        state.stravaCells.forEach(cells => featuresAlong(cells, locateRegion).forEach(f => bump(stravaByRegion, f)));
        regionsState = 'ready';
        refreshAreas();
        renderLegend();
    }

    // The filled areas: outlines, or in Subregions view the regions plus any
    // outline no loaded region covers (Tokelau, countries without admin-1 data).
    function areasData() {
        const regions = state.detail === 'subregions' && regionsState === 'ready';
        const features = [];
        const add = (id, geometry, kind, status) => features.push({
            type: 'Feature', id, geometry, properties: { kind, status, raise: GLOBE_RAISE_M[status] || 0 },
        });
        countryFeatures.forEach((f, i) => { if (!(regions && regionCovered.has(f))) add(i, f.geometry, 'country', countryStatus(f)); });
        if (regions) regionFeatures.forEach((f, j) => add(GLOBE_REGION_ID + j, f.geometry, 'region', regionStatus(f)));
        return { type: 'FeatureCollection', features };
    }

    // ── Places and routes ──
    const catById = Object.fromEntries(PLACE_CATEGORIES.map(c => [c.id, c]));
    const allPlaces = places.concat(todoPlaces);
    const placesData = {
        type: 'FeatureCollection',
        features: allPlaces.map((p, i) => ({
            type: 'Feature', id: i,
            geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
            properties: { cat: p.cat },
        })),
    };
    const lineFeature = pts => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts.map(([lat, lng]) => [lng, lat]) } });
    const highwayRoutes = drivenSegments.map(makeRoute);
    const highwaysData = { type: 'FeatureCollection', features: drivenSegments.map(lineFeature) };

    // ── Map ──
    const osm = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    const carto = `${osm} &copy; <a href="https://carto.com/attributions">CARTO</a>`;
    const cartoTiles = style => ['a', 'b', 'c', 'd'].map(s => `https://${s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}@2x.png?key=${GLOBE_CARTO_KEY}`);
    const statusColor = ['match', ['get', 'status'], 'home', GLOBE_COLORS.home, 'strava', GLOBE_COLORS.strava, GLOBE_COLORS.visited];
    const map = new maplibregl.Map({
        container,
        center: narrow ? [-40, 30] : [-30, 32],
        zoom: globeFitZoom(container),
        minZoom: 0,
        maxPitch: 80,
        attributionControl: { compact: true },
        cooperativeGestures: narrow,  // phones: one finger scrolls the page, two move the globe
        style: {
            version: 8,
            projection: { type: 'globe' },
            sky: {
                'sky-color': '#0b2340',
                'horizon-color': '#3b6fa0',
                'fog-color': '#7fa8cc',
                'sky-horizon-blend': 0.6,
                'horizon-fog-blend': 0.6,
                'fog-ground-blend': 0.8,
                'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
            },
            sources: {
                // CARTO's dark map in two halves, so the colours sit between
                // the land (with its borders) and the labels.
                dark: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: cartoTiles('dark_nolabels'), attribution: carto },
                labels: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: cartoTiles('dark_only_labels'), attribution: carto },
                satellite: {
                    type: 'raster', tileSize: 256, maxzoom: 19,
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
                },
                // (Two sources over the same tiles: MapLibre draws hillshade
                // poorly from the source terrain is using.)
                dem: { ...GLOBE_DEM },
                'dem-shade': { ...GLOBE_DEM },
                countries: { type: 'geojson', data: countriesGeojson },
                areas: { type: 'geojson', data: areasData() },
                highways: { type: 'geojson', data: highwaysData },
                strava: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
                places: { type: 'geojson', data: placesData },
                tiles: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
            },
            layers: [
                { id: 'ocean', type: 'background', paint: { 'background-color': GLOBE_COLORS.ocean } },
                { id: 'dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } },
                { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
                { id: 'areas-fill', type: 'fill', source: 'areas', paint: {} },
                // Over the fills, so it shades the colours too.
                { id: 'hillshade', type: 'hillshade', source: 'dem-shade', minzoom: 4,
                  paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#000', 'hillshade-highlight-color': '#fff' } },
                { id: 'areas-raised', type: 'fill-extrusion', source: 'areas', filter: ['>', ['get', 'raise'], 0],
                  maxzoom: 4.5,
                  paint: {
                      'fill-extrusion-color': statusColor,
                      // Raised from orbit, settling onto the globe as you zoom
                      // in, so they never hide the routes and pins up close.
                      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 2.5, ['get', 'raise'], 4.5, 0],
                      'fill-extrusion-opacity': 0.85,
                  } },
                { id: 'region-line', type: 'line', source: 'areas', filter: ['==', ['get', 'kind'], 'region'], minzoom: 2,
                  paint: { 'line-color': 'rgba(255,255,255,0.22)', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.3, 6, 0.8] } },
                { id: 'countries-line', type: 'line', source: 'countries',
                  paint: { 'line-color': 'rgba(255,255,255,0.35)', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1.3] } },
                // Tile Hunter's tiles, fetched the first time the chip is
                // switched on (loadTiles); under the labels.
                { id: 'tiles', type: 'fill', source: 'tiles', layout: { visibility: 'none' },
                  paint: {
                      'fill-color': ['match', ['get', 'tier'], ...GLOBE_TILE_TIERS.flatMap(([id, color]) => [id, color]), '#f44336'],
                      'fill-outline-color': 'rgba(0, 0, 0, 0.25)',
                  } },
                { id: 'labels', type: 'raster', source: 'labels' },
                { id: 'highways', type: 'line', source: 'highways', layout: { 'line-cap': 'round', 'line-join': 'round' },
                  paint: { 'line-color': GLOBE_COLORS.highway, 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1, 8, 2.5] } },
                { id: 'strava', type: 'line', source: 'strava', layout: { 'line-cap': 'round', 'line-join': 'round' },
                  paint: { 'line-color': STRAVA_LAYER.color, 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 0, 1.1, 4, 1.4, 8, 1.8, 14, 3] } },
                { id: 'places', type: 'circle', source: 'places',
                  paint: {
                      'circle-color': ['match', ['get', 'cat'], ...PLACE_CATEGORIES.flatMap(c => [c.id, c.color]), '#fff'],
                      'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 2.2, 4, 4, 10, 7],
                      'circle-stroke-color': '#fff',
                      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 0, 0.4, 6, 1.2],
                      'circle-pitch-alignment': 'viewport',
                  } },
            ],
        },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibregl.GlobeControl(), 'top-right');
    map.addControl(new maplibregl.TerrainControl({ source: 'dem', exaggeration: 1.5 }), 'top-right');
    const fullscreen = new maplibregl.FullscreenControl({ container: container.parentElement });
    map.addControl(fullscreen, 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    // Inline on a phone the globe would trap page scrolling; fullscreen it's the
    // page. (iPhone has no element fullscreen, so MapLibre pins the map over the
    // page instead; the body class lets it out from under the navbar.)
    fullscreen.on('fullscreenstart', () => {
        document.body.classList.add('globe-fullscreen');
        if (narrow) map.cooperativeGestures.disable();
    });
    fullscreen.on('fullscreenend', () => {
        document.body.classList.remove('globe-fullscreen');
        if (narrow) map.cooperativeGestures.enable();
    });
    // Terrain on: tilt to see it. Off: back to looking straight down.
    map.on('terrain', () => {
        map.easeTo({ pitch: map.getTerrain() ? Math.max(map.getPitch(), 60) : 0, duration: 800 });
    });

    function refreshAreas() {
        if (map.getSource('areas')) map.getSource('areas').setData(areasData());
    }

    // ── Styling ──
    function applyBasemap() {
        ['dark', 'satellite'].forEach(id => map.setLayoutProperty(id, 'visibility', state.basemap === id ? 'visible' : 'none'));
        const plain = state.basemap === 'none';
        map.setPaintProperty('hillshade', 'hillshade-exaggeration', state.basemap === 'satellite' ? 0.15 : 0.35);
        const byStatus = (none, strava, visited) => ['match', ['get', 'status'], 'none', none, 'strava', strava, visited];
        // Footprint and fog draw their own colour: the fills just give the
        // plain globe its land.
        if (state.mode !== 'countries') {
            map.setPaintProperty('areas-fill', 'fill-color', GLOBE_COLORS.land);
            map.setPaintProperty('areas-fill', 'fill-opacity', plain ? 1 : 0);
            setPressed('[data-basemap]', b => b.dataset.basemap === state.basemap);
            return;
        }
        // Over a basemap, unvisited land stays clear and visited land is a
        // wash, so the map's borders and labels show through.
        map.setPaintProperty('areas-fill', 'fill-color', ['match', ['get', 'status'],
            'home', GLOBE_COLORS.home, 'visited', GLOBE_COLORS.visited, 'strava', GLOBE_COLORS.strava,
            plain ? GLOBE_COLORS.land : '#ffffff']);
        // On the plain globe the fills fade as you zoom in, so the hillshade
        // and routes take over from the flat colour.
        map.setPaintProperty('areas-fill', 'fill-opacity', plain
            ? ['interpolate', ['linear'], ['zoom'], 4, byStatus(1, 0.6, 0.9), 8, byStatus(1, 0.35, 0.35)]
            : byStatus(0, 0.3, state.basemap === 'satellite' ? 0.35 : 0.45));
        setPressed('[data-basemap]', b => b.dataset.basemap === state.basemap);
    }

    function setPressed(selector, isOn) {
        document.querySelectorAll(selector).forEach(b => {
            const on = !!isOn(b);
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on);
        });
    }

    function applyRaise() {
        map.setLayoutProperty('areas-raised', 'visibility', state.raise && state.mode === 'countries' ? 'visible' : 'none');
        setPressed('#globe-raise', () => state.raise);
    }

    // ── Layer chips ──
    const chips = [
        ...PLACE_CATEGORIES.map(c => ({ id: c.id, label: c.label, symbol: c.symbol, color: c.color,
            count: allPlaces.filter(p => p.cat === c.id).length })),
        { id: 'highways', label: 'Highways driven', symbol: '〰', color: GLOBE_COLORS.highway, count: drivenSegments.length },
        { id: 'strava', label: STRAVA_LAYER.label, symbol: STRAVA_LAYER.symbol, color: STRAVA_LAYER.color },
        { id: 'tiles', label: 'Tiles', symbol: '▦', color: '#64B5F6' },
    ];
    // Tiles are off unless switched on (their own key, so they stay off for
    // anyone who had saved the other chips before they existed).
    const layerOn = id => id === 'tiles' ? state.tilesOn : !state.off.has(id);
    // Footprint and Fog read best uncluttered: their overview hides the pins,
    // which come back once zoomed in far enough to tell them apart (as on the map).
    const pinsHidden = () => state.mode !== 'countries' && map.getZoom() < OVERLAY_MARKER_ZOOM;
    function applyLayers() {
        const placeCats = PLACE_CATEGORIES.map(c => c.id).filter(id => !state.off.has(id));
        map.setFilter('places', ['in', ['get', 'cat'], ['literal', placeCats]]);
        map.setLayoutProperty('places', 'visibility', pinsHidden() ? 'none' : 'visible');
        ['highways', 'strava'].forEach(id => map.setLayoutProperty(id, 'visibility', state.off.has(id) ? 'none' : 'visible'));
        map.setLayoutProperty('tiles', 'visibility', state.tilesOn && state.tiles === 'ready' ? 'visible' : 'none');
        if (state.tilesOn) loadTiles();
    }
    function renderChips() {
        const bar = document.getElementById('globe-chips');
        bar.innerHTML = chips.map(c => {
            const on = layerOn(c.id);
            let count = c.count;
            if (c.id === 'strava') count = { idle: '', loading: '…', error: '!', ready: state.stravaRoutes.length }[state.strava];
            if (c.id === 'tiles') count = { idle: '', loading: '…', error: '!', ready: state.tileStats && state.tileStats.visited }[state.tiles];
            const failed = (c.id === 'strava' && state.strava === 'error') || (c.id === 'tiles' && state.tiles === 'error');
            return `<button class="wm-chip${on ? ' active' : ''}" data-layer="${c.id}" aria-pressed="${on}"
                ${failed ? `disabled title="${c.label} unavailable"` : ''}>
                <span class="wm-chip-symbol" style="color:${c.color}">${c.symbol}</span>${escapeHtml(c.label)}
                ${count !== '' && count !== undefined ? `<span class="wm-chip-count">${typeof count === 'number' ? count.toLocaleString() : count}</span>` : ''}
            </button>`;
        }).join('');
    }
    document.getElementById('globe-chips').addEventListener('click', e => {
        const btn = e.target.closest('[data-layer]');
        if (!btn) return;
        const id = btn.dataset.layer;
        if (id === 'tiles') {
            state.tilesOn = !state.tilesOn;
            globeStore(GLOBE_STORAGE.tiles, state.tilesOn ? '1' : '0');
            renderLegend();
        } else {
            if (state.off.has(id)) state.off.delete(id); else state.off.add(id);
            globeStore(GLOBE_STORAGE.off, [...state.off].join(','));
        }
        applyLayers();
        renderChips();
        // The footprint counts Strava routes only while they're shown.
        if (id === 'strava') fog.redraw();
    });

    // ── Stats + legend ──
    function renderStats() {
        let visited = 0, total = 0;
        listed.forEach(c => { total++; if (c.visited) visited++; });
        const stats = [
            [visited, `of ${total} countries`],
            [places.length, 'places'],
            [state.strava === 'ready' ? state.stravaRoutes.length : '…', 'Strava routes'],
        ];
        document.getElementById('globe-stats').innerHTML = stats.map(([n, label]) =>
            `<div class="globe-stat"><span class="globe-stat-num">${typeof n === 'number' ? n.toLocaleString() : n}</span><span class="globe-stat-label">${label}</span></div>`).join('');
    }
    function renderLegend() {
        const el = document.getElementById('globe-legend');
        if (state.mode !== 'countries') {
            const routes = state.off.has('strava') ? 'a driven highway' : 'a highway or Strava route';
            el.innerHTML = `<span>${state.mode === 'fog' ? 'Cleared' : 'Green'}: within ${state.pointKm} km of a place, ${state.routeKm} km of ${routes}</span>` + tileLegend();
            return;
        }
        const keys = [['home', 'Home'], ['visited', 'Visited'], ['strava', 'Strava activity, not marked visited']];
        let note = '';
        if (state.detail === 'subregions' && regionsState !== 'ready') note = '<span class="globe-legend-note">Loading states and provinces…</span>';
        el.innerHTML = keys.map(([k, label]) => `<span><i style="background:${GLOBE_COLORS[k]}"></i>${label}</span>`).join('') + note + tileLegend();
    }
    function tileLegend() {
        if (!state.tilesOn) return '';
        const t = state.tileStats;
        const label = { maxCluster: t ? `Max cluster (${t.maxCluster.toLocaleString()})` : 'Max cluster',
                        maxSquare: t ? `Max square (${t.maxSquare}×${t.maxSquare})` : 'Max square' };
        return '<span class="globe-legend-break"></span>' + GLOBE_TILE_TIERS.map(([id, color, name]) =>
            `<span><i style="background:${color}"></i>${label[id] || name}</span>`).join('');
    }

    // ── Tiles ──
    // Tile Hunter's visited tiles from the worker, coloured as on its map.
    async function loadTiles() {
        if (state.tiles !== 'idle') return;
        state.tiles = 'loading';
        renderChips();
        try {
            const res = await fetch(`${GLOBE_WORKER_URL}/tiles/all`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const { tiles = [] } = await res.json();
            const { features, stats } = buildTileFeatures(new Set(tiles));
            map.getSource('tiles').setData({ type: 'FeatureCollection', features });
            state.tileStats = stats;
            state.tiles = 'ready';
        } catch (err) {
            console.warn('Tiles unavailable:', err);
            state.tiles = 'error';
        }
        applyLayers();
        renderChips();
        renderLegend();
    }

    // ── Popups ──
    function flagEmoji(iso) {
        if (!/^[A-Z]{2}$/.test(iso || '')) return '';
        return String.fromCodePoint(...[...iso].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
    }
    const statusText = { home: 'Home', visited: 'Visited', none: 'Not yet visited', strava: 'Strava activity, not marked visited' };
    const countText = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
    function popupHtml(title, status, lines) {
        return `<div class="wm-popup"><h3>${title}</h3>
            <div class="wm-popup-status wm-status-${status}">${statusText[status]}</div>
            ${lines.map(l => `<p>${l}</p>`).join('')}</div>`;
    }
    function countryPopup(f) {
        const { name, iso, sov, part } = f.properties;
        const entry = listed.get(name);
        const lines = [];
        if (part) lines.push(`Part of ${escapeHtml(name)}`);
        else if (!entry) lines.push(sov && sov !== name ? `Territory of ${escapeHtml(sov)}` : 'Not counted as a country');
        if (placesByPart.get(f)) lines.push(countText(placesByPart.get(f), 'place', 'places') + ' on the globe');
        if (stravaByPart.get(f)) lines.push(countText(stravaByPart.get(f), 'Strava activity', 'Strava activities'));
        return popupHtml(`${flagEmoji(iso)} ${escapeHtml(part || name)}`, countryStatus(f), lines);
    }
    function regionPopup(f) {
        const { name, wmCountry, aliases } = f.properties;
        const lines = [`Part of ${escapeHtml(wmCountry)}`];
        if (placesByRegion.get(f)) lines.push(countText(placesByRegion.get(f), 'place', 'places') + ' on the globe');
        if (stravaByRegion.get(f)) lines.push(countText(stravaByRegion.get(f), 'Strava activity', 'Strava activities'));
        if (wmCountry === HOME_COUNTRY && (aliases || [name]).some(a => visitedStates[a] === true)) lines.push('Marked visited on the US dashboard');
        const status = regionStatus(f);
        return popupHtml(escapeHtml(name), status === 'home' ? 'visited' : status, lines);
    }
    const popup = new maplibregl.Popup({ maxWidth: narrow ? '230px' : '280px', className: 'globe-popup' });
    // A phone has no room beside an edge pin, so bring the spot to the middle.
    const showPopup = (lngLat, html) => {
        if (narrow) map.easeTo({ center: lngLat, duration: 400 });
        popup.setLngLat(lngLat).setHTML(html).addTo(map);
    };
    const tapPad = narrow ? 10 : 5;
    map.on('click', e => {
        const { x, y } = e.point;
        const hits = map.getLayoutProperty('places', 'visibility') === 'none' ? []
            : map.queryRenderedFeatures([[x - tapPad, y - tapPad], [x + tapPad, y + tapPad]], { layers: ['places'] });
        if (hits.length) {
            const p = allPlaces[hits[0].id];
            const cat = catById[p.cat];
            showPopup([p.lng, p.lat], `<div class="wm-popup city-popup"><h3>${escapeHtml(p.name)}</h3>${p.details.join('')}
                <p class="globe-popup-cat" style="color:${cat.color}">${cat.symbol} ${cat.label}</p></div>`);
            return;
        }
        const area = map.queryRenderedFeatures(e.point, { layers: ['areas-raised', 'areas-fill'] })[0];
        if (!area) return;
        showPopup(e.lngLat, area.id >= GLOBE_REGION_ID
            ? regionPopup(regionFeatures[area.id - GLOBE_REGION_ID])
            : countryPopup(countryFeatures[area.id]));
    });
    ['places', 'areas-fill', 'areas-raised'].forEach(id => {
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    });

    // ── Spin ──
    // Turns slowly while zoomed out, until someone grabs the globe.
    let spinning = !reduceMotion;
    function spinStep() {
        if (!spinning || map.getZoom() > 3.5 || map.isMoving()) return;
        const c = map.getCenter();
        c.lng -= 6;
        map.easeTo({ center: c, duration: 1000, easing: n => n });
    }
    function setSpin(on) {
        spinning = on;
        setPressed('#globe-spin', () => on);
        if (on) spinStep(); else map.stop();
    }
    map.on('moveend', spinStep);
    map.on('mousedown', () => setSpin(false));
    map.on('touchstart', () => setSpin(false));
    map.on('wheel', () => setSpin(false));
    document.getElementById('globe-spin').addEventListener('click', () => setSpin(!spinning));

    // ── Footprint / fog ──
    const fog = createGlobeFog(map, {
        narrow,
        getMode: () => state.mode,
        getRadii: () => ({ pointKm: state.pointKm, routeKm: state.routeKm }),
        getSources: () => ({
            points: places,
            routes: state.off.has('strava') ? highwayRoutes : highwayRoutes.concat(state.stravaRoutes),
        }),
    });

    // ── Toolbar ──
    const detailRow = document.getElementById('globe-detail');
    const sliderRows = [document.getElementById('globe-radius-control'), document.getElementById('globe-route-control')];
    function applyMode() {
        setPressed('[data-mode]', b => b.dataset.mode === state.mode);
        detailRow.hidden = state.mode !== 'countries';
        sliderRows.forEach(r => { r.hidden = state.mode === 'countries'; });
        applyBasemap();
        applyRaise();
        applyLayers();
        fog.redraw();
        renderLegend();
    }
    function applyDetail() {
        setPressed('[data-detail]', b => b.dataset.detail === state.detail);
        refreshAreas();
        renderLegend();
    }
    document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
        state.mode = b.dataset.mode;
        globeStore(GLOBE_STORAGE.mode, state.mode);
        applyMode();
    }));
    document.querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', () => {
        state.detail = b.dataset.detail;
        globeStore(GLOBE_STORAGE.detail, state.detail);
        applyDetail();
    }));
    [['globe-radius', 'globe-radius-value', 'pointKm', GLOBE_STORAGE.radius],
     ['globe-route-radius', 'globe-route-value', 'routeKm', GLOBE_STORAGE.route]].forEach(([id, labelId, key, storeKey]) => {
        const slider = document.getElementById(id);
        slider.value = state[key];
        document.getElementById(labelId).textContent = state[key];
        slider.addEventListener('input', () => {
            state[key] = +slider.value;
            document.getElementById(labelId).textContent = slider.value;
            renderLegend();
        });
        // Redraw once the slider is let go: the world canvas takes a moment.
        slider.addEventListener('change', () => {
            globeStore(storeKey, slider.value);
            fog.redraw();
        });
    });
    map.on('zoomend', () => {
        map.setLayoutProperty('places', 'visibility', pinsHidden() ? 'none' : 'visible');
    });

    document.querySelectorAll('[data-basemap]').forEach(b => b.addEventListener('click', () => {
        state.basemap = b.dataset.basemap;
        globeStore(GLOBE_STORAGE.basemap, state.basemap);
        applyBasemap();
    }));
    document.getElementById('globe-raise').addEventListener('click', () => {
        state.raise = !state.raise;
        globeStore(GLOBE_STORAGE.raise, state.raise ? '1' : '0');
        applyRaise();
    });

    // ── Strava routes ──
    // Fetched after the globe is up. Each route also marks the outlines (and
    // later the regions) it passes through, as on the World Travel map.
    async function loadStrava() {
        state.strava = 'loading';
        renderChips();
        try {
            const res = await fetch(`${GLOBE_WORKER_URL}/polylines/all`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const encoded = await res.json();
            const features = [];
            encoded.forEach(enc => {
                if (!enc) return;
                const points = decodeWorldPolyline(enc);
                if (!points.length) return;
                const route = makeRoute(points);
                state.stravaRoutes.push(route);
                const cells = routeCells(points, locate.near);
                state.stravaCells.push(cells);
                featuresAlong(cells, locate).forEach(f => bump(stravaByPart, f));
                // ~55 m steps: plenty on a globe, and a fraction of the points.
                features.push(lineFeature(routePoints(route, 0.0005)));
            });
            map.getSource('strava').setData({ type: 'FeatureCollection', features });
            state.strava = 'ready';
            refreshAreas();
            fog.redraw();
        } catch (err) {
            console.warn('Strava routes unavailable:', err);
            state.strava = 'error';
        }
        renderChips();
        renderStats();
    }

    renderChips();
    renderStats();
    setPressed('[data-detail]', b => b.dataset.detail === state.detail);
    map.on('load', () => {
        applyBasemap();
        applyMode();
        document.getElementById('globe-loading').hidden = true;
        setSpin(spinning);
        // Regions wait for Strava, which says which other countries to load.
        loadStrava().finally(loadRegions);
    });
    window.globeMap = map;  // handy from the console while this is a concept
}

// ── Footprint / fog ──────────────────────────────────────────────────────────
//
// The World Travel map's FootprintLayer, redone for the globe. A mask of
// everything within pointKm of a place and routeKm of a route is drawn on a
// canvas in Spherical Mercator, then either washed green ('footprint') or
// punched out of a dark fog ('fog'), and MapLibre drapes the canvas over the
// globe. One canvas covers the whole world (~10 km a pixel, sharp enough from
// orbit); zoomed in, a second covers the view and its surroundings at full
// detail and is redrawn as the map moves, with its patch cut out of the world
// canvas so the two never double up.
function createGlobeFog(map, { narrow, getMode, getRadii, getSources }) {
    const mercY = lat => Math.log(Math.tan(Math.PI / 4 + Math.max(-GLOBE_MERC_MAX_LAT, Math.min(GLOBE_MERC_MAX_LAT, lat)) * Math.PI / 360));
    const worldSize = narrow ? 2048 : 4096;
    const world = { w: -180, e: 180, s: -GLOBE_MERC_MAX_LAT, n: GLOBE_MERC_MAX_LAT, W: worldSize, H: worldSize };
    const worldBase = document.createElement('canvas');   // the world fog, drawn once per change
    const worldCanvas = document.createElement('canvas');  // what's shown: worldBase minus the detail patch
    const detailCanvas = document.createElement('canvas');
    const mask = document.createElement('canvas');
    const blurred = document.createElement('canvas');
    const tint = document.createElement('canvas');
    let added = false;
    let detail = null;  // the detail canvas's extent, while one is shown

    const corners = ext => [[ext.w, ext.n], [ext.e, ext.n], [ext.e, ext.s], [ext.w, ext.s]];

    function projector(ext) {
        const kx = ext.W / (ext.e - ext.w);
        const y0 = mercY(ext.n);
        const ky = ext.H / (y0 - mercY(ext.s));
        return {
            px: lng => (lng - ext.w) * kx,
            py: lat => (y0 - mercY(lat)) * ky,
            // Mercator is conformal: a km is as many px across as up.
            kmToPx: (km, lat) => km / (111.32 * Math.max(0.05, Math.cos(lat * Math.PI / 180))) * kx,
        };
    }

    function inExtent(r, ext, marginDeg) {
        return r.e >= ext.w - marginDeg && r.w <= ext.e + marginDeg && r.n >= ext.s - marginDeg && r.s <= ext.n + marginDeg;
    }

    // Draws the mask for `ext` into `mask`, blurs it into `blurred`, then
    // composes fog or footprint into `out`.
    function draw(out, ext) {
        const { pointKm, routeKm } = getRadii();
        const { points, routes } = getSources();
        const { px, py, kmToPx } = projector(ext);
        mask.width = ext.W; mask.height = ext.H;
        const m = mask.getContext('2d');
        m.fillStyle = m.strokeStyle = '#000';
        m.lineCap = m.lineJoin = 'round';
        let maxR = 0;
        m.beginPath();
        points.forEach(({ lat, lng }) => {
            const r = Math.max(2, kmToPx(pointKm, lat));
            const x = px(lng), y = py(lat);
            if (x < -r || y < -r || x > ext.W + r || y > ext.H + r) return;
            if (r > maxR) maxR = r;
            m.moveTo(x + r, y);
            m.arc(x, y, r, 0, Math.PI * 2);
        });
        m.fill();
        // Routes thinned to a third of the corridor (or a pixel, if finer),
        // grouped by pen width so each width is one stroke.
        const maxStep = Math.max(routeKm / 3 / 111, (ext.e - ext.w) / ext.W);
        const paths = new Map();
        routes.forEach(r => {
            const marginDeg = routeKm / 111 / Math.max(0.1, Math.cos(r.midLat * Math.PI / 180));
            if (!inExtent(r, ext, marginDeg)) return;
            const width = Math.max(2, Math.round(kmToPx(routeKm, r.midLat) * 2));
            const pts = routePoints(r, maxStep);
            let path = paths.get(width);
            if (!path) paths.set(width, path = new Path2D());
            path.moveTo(px(pts[0][1]), py(pts[0][0]));
            for (let i = 1; i < pts.length; i++) path.lineTo(px(pts[i][1]), py(pts[i][0]));
            if (pts.length === 1) path.lineTo(px(pts[0][1]) + 0.01, py(pts[0][0]));
            if (width / 2 > maxR) maxR = width / 2;
        });
        paths.forEach((path, width) => { m.lineWidth = width; m.stroke(path); });

        blurred.width = ext.W; blurred.height = ext.H;
        const b = blurred.getContext('2d');
        if ('filter' in b) b.filter = `blur(${Math.max(1, Math.min(maxR * 0.08, 6))}px)`;
        b.drawImage(mask, 0, 0);

        out.width = ext.W; out.height = ext.H;
        const ctx = out.getContext('2d');
        if (getMode() === 'fog') {
            ctx.fillStyle = 'rgba(15, 15, 18, 0.92)';
            ctx.fillRect(0, 0, ext.W, ext.H);
            const texture = getFogTexture(() => redraw());
            if (texture) {
                ctx.save();
                ctx.globalAlpha = 0.1;
                ctx.fillStyle = ctx.createPattern(texture, 'repeat');
                ctx.fillRect(0, 0, ext.W, ext.H);
                ctx.restore();
            }
            ctx.globalCompositeOperation = 'destination-out';
            ctx.drawImage(blurred, 0, 0);
            // A faint wash so the cleared ground reads against the fog.
            tint.width = ext.W; tint.height = ext.H;
            const t = tint.getContext('2d');
            t.drawImage(blurred, 0, 0);
            t.globalCompositeOperation = 'source-in';
            t.fillStyle = 'rgba(190, 230, 190, 0.16)';
            t.fillRect(0, 0, ext.W, ext.H);
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(tint, 0, 0);
        } else {
            ctx.drawImage(blurred, 0, 0);
            ctx.globalCompositeOperation = 'source-in';
            ctx.fillStyle = 'rgba(102, 187, 106, 0.5)';
            ctx.fillRect(0, 0, ext.W, ext.H);
        }
        ctx.globalCompositeOperation = 'source-over';
    }

    // The view plus half a view on every side, or null when zoomed out (or
    // when the view straddles the antimeridian, where the world canvas does).
    function detailExtent() {
        if (map.getZoom() < GLOBE_DETAIL_ZOOM) return null;
        const bounds = map.getBounds();
        let w = bounds.getWest(), e = bounds.getEast(), s = bounds.getSouth(), n = bounds.getNorth();
        if (!(e > w) || e - w > 180 || w < -180 || e > 180) return null;
        const dx = (e - w) / 2, dy = (n - s) / 2;
        w = Math.max(-180, w - dx); e = Math.min(180, e + dx);
        s = Math.max(-GLOBE_MERC_MAX_LAT, s - dy); n = Math.min(GLOBE_MERC_MAX_LAT, n + dy);
        const max = narrow ? 1536 : 2048;
        const aspect = (mercY(n) - mercY(s)) / ((e - w) * Math.PI / 180);  // height / width
        const W = Math.round(aspect > 1 ? max / aspect : max);
        const H = Math.round(aspect > 1 ? max : max * aspect);
        return { w, e, s, n, W: Math.max(16, W), H: Math.max(16, H) };
    }

    // worldCanvas = worldBase with the detail patch cleared (inset a pixel so
    // the seam overlaps rather than gaps).
    function composeWorld() {
        worldCanvas.width = world.W; worldCanvas.height = world.H;
        const c = worldCanvas.getContext('2d');
        c.drawImage(worldBase, 0, 0);
        if (detail) {
            const { px, py } = projector(world);
            const x0 = Math.ceil(px(detail.w)) + 1, x1 = Math.floor(px(detail.e)) - 1;
            const y0 = Math.ceil(py(detail.n)) + 1, y1 = Math.floor(py(detail.s)) - 1;
            if (x1 > x0 && y1 > y0) c.clearRect(x0, y0, x1 - x0, y1 - y0);
        }
    }

    // A canvas source only re-reads its canvas while playing.
    function upload(id) {
        const src = map.getSource(id);
        if (src) { src.play(); src.pause(); }
    }

    function ensureLayers() {
        if (added) return;
        added = true;
        worldCanvas.width = worldCanvas.height = 16;
        detailCanvas.width = detailCanvas.height = 16;
        map.addSource('fog-world', { type: 'canvas', canvas: worldCanvas, coordinates: corners(world), animate: false });
        map.addSource('fog-detail', { type: 'canvas', canvas: detailCanvas, coordinates: corners(world), animate: false });
        const paint = { 'raster-fade-duration': 0, 'raster-resampling': 'linear' };
        // Over the fills and labels, under the routes and pins.
        map.addLayer({ id: 'fog-world', type: 'raster', source: 'fog-world', paint }, 'highways');
        map.addLayer({ id: 'fog-detail', type: 'raster', source: 'fog-detail', paint }, 'highways');
    }

    function setVisible(on) {
        if (!added) return;
        ['fog-world', 'fog-detail'].forEach(id => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
    }

    function updateDetail() {
        if (getMode() === 'countries' || !added) return;
        const was = detail;
        detail = detailExtent();
        if (!detail && !was) return;  // zoomed out: the world canvas is already right
        if (detail) {
            draw(detailCanvas, detail);
            map.getSource('fog-detail').setCoordinates(corners(detail));
            upload('fog-detail');
        }
        map.setLayoutProperty('fog-detail', 'visibility', detail ? 'visible' : 'none');
        composeWorld();
        upload('fog-world');
    }

    function redraw() {
        if (getMode() === 'countries') { setVisible(false); return; }
        ensureLayers();
        setVisible(true);
        draw(worldBase, world);
        detail = null;
        composeWorld();
        upload('fog-world');
        updateDetail();
    }

    map.on('moveend', updateDetail);
    return { redraw };
}

// ── Tile Hunter ──────────────────────────────────────────────────────────────
//
// The same analysis as Tile Hunter in js/strava.js (computeClusters,
// computeSquares, computeTileStats): keep the rules in step with it. Squares
// are placed biggest first without overlapping, ties going to the one with
// the most visited tiles around it (strava.js breaks remaining ties by the
// latest activity, which this page doesn't load; it only picks between
// equal squares).

function globeTileBounds(x, y) {
    const n = 2 ** GLOBE_TILE_ZOOM;
    const lng = tx => tx / n * 360 - 180;
    const lat = ty => Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / n))) * 180 / Math.PI;
    return { w: lng(x), e: lng(x + 1), n: lat(y), s: lat(y + 1) };
}

// A tile is a cluster tile when all four neighbours are visited; connected
// cluster tiles form a cluster. Returns key → its cluster's size.
function globeTileClusters(tileSet) {
    const interior = new Set();
    for (const key of tileSet) {
        const [x, y] = key.split(',').map(Number);
        if (tileSet.has(`${x},${y - 1}`) && tileSet.has(`${x},${y + 1}`) &&
            tileSet.has(`${x - 1},${y}`) && tileSet.has(`${x + 1},${y}`)) interior.add(key);
    }
    const clusterOf = new Map();
    for (const key of interior) {
        if (clusterOf.has(key)) continue;
        const queue = [key];
        clusterOf.set(key, 0);
        for (let head = 0; head < queue.length; head++) {
            const [x, y] = queue[head].split(',').map(Number);
            for (const nb of [`${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`]) {
                if (interior.has(nb) && !clusterOf.has(nb)) { clusterOf.set(nb, 0); queue.push(nb); }
            }
        }
        queue.forEach(k => clusterOf.set(k, queue.length));
    }
    return clusterOf;
}

// key → size of the largest all-visited square with that tile as its
// bottom-right corner.
function globeTileSquares(tileSet) {
    const dp = new Map();
    [...tileSet].map(k => k.split(',').map(Number))
        .sort((a, b) => a[1] - b[1] || a[0] - b[0])
        .forEach(([x, y]) => dp.set(`${x},${y}`, Math.min(
            dp.get(`${x - 1},${y}`) || 0, dp.get(`${x},${y - 1}`) || 0, dp.get(`${x - 1},${y - 1}`) || 0) + 1));
    return dp;
}

// Visited tiles as GeoJSON squares tagged with their GLOBE_TILE_TIERS tier.
function buildTileFeatures(tileSet) {
    const clusters = globeTileClusters(tileSet);
    const squares = globeTileSquares(tileSet);
    let maxCluster = 0, maxSquare = 0;
    for (const v of clusters.values()) if (v > maxCluster) maxCluster = v;
    for (const v of squares.values()) if (v > maxSquare) maxSquare = v;

    // Non-overlapping squares ≥ the threshold: tile → its square's size.
    const membership = new Map();
    if (maxSquare >= GLOBE_SQUARE_THRESHOLD) {
        const candidates = [];
        for (const [key, size] of squares) {
            if (size < GLOBE_SQUARE_THRESHOLD) continue;
            const [bx, by] = key.split(',').map(Number);
            const x0 = bx - size + 1, y0 = by - size + 1;
            let perim = 0;
            for (let x = x0 - 1; x <= x0 + size; x++) {
                for (let y = y0 - 1; y <= y0 + size; y++) {
                    const inside = x >= x0 && x < x0 + size && y >= y0 && y < y0 + size;
                    if (!inside && tileSet.has(`${x},${y}`)) perim++;
                }
            }
            candidates.push({ x0, y0, size, perim });
        }
        candidates.sort((a, b) => b.size - a.size || b.perim - a.perim);
        for (const c of candidates) {
            let overlaps = false;
            for (let dx = 0; dx < c.size && !overlaps; dx++) {
                for (let dy = 0; dy < c.size; dy++) {
                    if (membership.has(`${c.x0 + dx},${c.y0 + dy}`)) { overlaps = true; break; }
                }
            }
            if (overlaps) continue;
            for (let dx = 0; dx < c.size; dx++) {
                for (let dy = 0; dy < c.size; dy++) membership.set(`${c.x0 + dx},${c.y0 + dy}`, c.size);
            }
        }
    }

    const features = [];
    for (const key of tileSet) {
        const [x, y] = key.split(',').map(Number);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const square = membership.get(key) || 0;
        const cluster = clusters.get(key);
        const tier = square >= maxSquare && maxSquare >= GLOBE_SQUARE_THRESHOLD ? 'maxSquare'
            : square >= GLOBE_SQUARE_THRESHOLD ? 'square'
            : cluster && cluster === maxCluster ? 'maxCluster'
            : cluster ? 'cluster' : 'isolated';
        const b = globeTileBounds(x, y);
        features.push({
            type: 'Feature', properties: { tier },
            geometry: { type: 'Polygon', coordinates: [[[b.w, b.n], [b.e, b.n], [b.e, b.s], [b.w, b.s], [b.w, b.n]]] },
        });
    }
    // Drawn lowest tier first, as on Tile Hunter's map.
    const order = Object.fromEntries(GLOBE_TILE_TIERS.map(([id], i) => [id, i]));
    features.sort((a, b) => order[a.properties.tier] - order[b.properties.tier]);
    return { features, stats: { visited: tileSet.size, maxCluster, maxSquare } };
}

// World Globe (globe.html): a concept page showing the World Travel map's data
// on a 3D MapLibre GL globe.
//
// The data and its rules come from js/world-map.js (loaded on the page without
// Leaflet): the same files and worker endpoints, collectPlaces() /
// collectTodoPlaces() / collectDrivenSegments() for the pins and highways, and
// makeCountryLocator() + routeCells() for which outlines a Strava route passes
// through. Countries fill at the map's default "Lands" level: a visited
// country's core, plus each outlying part (Hawaii, the Canaries, …) with a
// place or route in it.

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

const GLOBE_STORAGE = { basemap: 'globe_basemap', raise: 'globe_raise', off: 'globe_layers_off' };

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

    // ── Countries ──
    const listed = new Map();
    CONTINENT_KEYS.forEach(k => (worldData[k] || []).forEach(c => listed.set(c.name, c)));
    const locate = makeCountryLocator(countriesGeojson.features);
    const placesByPart = new Map();
    places.forEach(p => {
        const f = locate(p.lat, p.lng);
        if (f) placesByPart.set(f, (placesByPart.get(f) || 0) + 1);
    });
    const stravaByPart = new Map();

    const isVisited = name => name === HOME_COUNTRY || !!(listed.get(name) || {}).visited;
    function status(f) {
        const { name, part } = f.properties;
        const been = placesByPart.get(f) || stravaByPart.get(f)
            || (name === HOME_COUNTRY && visitedStates[part] === true);
        if (isVisited(name)) {
            if (part && !been) return 'none';
            return name === HOME_COUNTRY ? 'home' : 'visited';
        }
        if (!listed.has(name) && been) return 'visited';
        if (stravaByPart.get(f)) return 'strava';
        return 'none';
    }
    // Feature index → its source feature, for popups.
    const countryFeatures = countriesGeojson.features;
    const countriesData = () => ({
        type: 'FeatureCollection',
        features: countryFeatures.map((f, i) => ({
            type: 'Feature', id: i, geometry: f.geometry,
            properties: { status: status(f), raise: GLOBE_RAISE_M[status(f)] || 0 },
        })),
    });

    // ── Places ──
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
    const lineFeature = coords => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    const highwaysData = {
        type: 'FeatureCollection',
        features: drivenSegments.map(seg => lineFeature(seg.map(([lat, lng]) => [lng, lat]))),
    };

    // ── Map ──
    const basemapOk = id => ['none', 'dark', 'satellite'].includes(id);
    const state = {
        basemap: basemapOk(globeStore(GLOBE_STORAGE.basemap)) ? globeStore(GLOBE_STORAGE.basemap) : 'none',
        raise: globeStore(GLOBE_STORAGE.raise) !== '0',
        off: new Set((globeStore(GLOBE_STORAGE.off) || 'todo').split(',').filter(Boolean)),
        strava: 'idle',  // idle | loading | ready | error
        stravaCount: 0,
    };
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const osm = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
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
                dark: {
                    type: 'raster', tileSize: 256, maxzoom: 19,
                    tiles: ['a', 'b', 'c', 'd'].map(s => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png?key=${GLOBE_CARTO_KEY}`),
                    attribution: `${osm} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
                },
                satellite: {
                    type: 'raster', tileSize: 256, maxzoom: 19,
                    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
                },
                // (Two sources over the same tiles: MapLibre draws hillshade
                // poorly from the source terrain is using.)
                dem: { ...GLOBE_DEM },
                'dem-shade': { ...GLOBE_DEM },
                countries: { type: 'geojson', data: countriesData() },
                highways: { type: 'geojson', data: highwaysData },
                strava: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
                places: { type: 'geojson', data: placesData },
            },
            layers: [
                { id: 'ocean', type: 'background', paint: { 'background-color': GLOBE_COLORS.ocean } },
                { id: 'dark', type: 'raster', source: 'dark', layout: { visibility: 'none' } },
                { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
                { id: 'countries-fill', type: 'fill', source: 'countries', paint: {} },
                // Over the fills, so it shades the colours too.
                { id: 'hillshade', type: 'hillshade', source: 'dem-shade', minzoom: 4,
                  paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#000', 'hillshade-highlight-color': '#fff' } },
                { id: 'countries-raised', type: 'fill-extrusion', source: 'countries', filter: ['>', ['get', 'raise'], 0],
                  maxzoom: 4.5,
                  paint: {
                      'fill-extrusion-color': ['match', ['get', 'status'], 'home', GLOBE_COLORS.home, 'strava', GLOBE_COLORS.strava, GLOBE_COLORS.visited],
                      // Raised from orbit, settling onto the globe as you zoom
                      // in, so they never hide the routes and pins up close.
                      'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 2.5, ['get', 'raise'], 4.5, 0],
                      'fill-extrusion-opacity': 0.85,
                  } },
                { id: 'countries-line', type: 'line', source: 'countries',
                  paint: { 'line-color': 'rgba(255,255,255,0.3)', 'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.4, 6, 1.2] } },
                { id: 'highways', type: 'line', source: 'highways', layout: { 'line-cap': 'round', 'line-join': 'round' },
                  paint: { 'line-color': GLOBE_COLORS.highway, 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 8, 2.5] } },
                { id: 'strava', type: 'line', source: 'strava', layout: { 'line-cap': 'round', 'line-join': 'round' },
                  paint: { 'line-color': STRAVA_LAYER.color, 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.7, 8, 1.6, 14, 3] } },
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

    // ── Styling ──
    function applyBasemap() {
        ['dark', 'satellite'].forEach(id => map.setLayoutProperty(id, 'visibility', state.basemap === id ? 'visible' : 'none'));
        const plain = state.basemap === 'none';
        // Over a basemap, unvisited land is left clear and visited land is a wash.
        map.setPaintProperty('countries-fill', 'fill-color', ['match', ['get', 'status'],
            'home', GLOBE_COLORS.home, 'visited', GLOBE_COLORS.visited, 'strava', GLOBE_COLORS.strava,
            plain ? GLOBE_COLORS.land : '#ffffff']);
        // On the plain globe the fills fade as you zoom in, so the hillshade
        // and routes take over from the flat colour.
        const byStatus = (none, strava, visited) => ['match', ['get', 'status'], 'none', none, 'strava', strava, visited];
        map.setPaintProperty('countries-fill', 'fill-opacity', plain
            ? ['interpolate', ['linear'], ['zoom'], 4, byStatus(1, 0.6, 0.9), 8, byStatus(1, 0.35, 0.35)]
            : byStatus(0.02, 0.3, 0.4));
        map.setPaintProperty('hillshade', 'hillshade-exaggeration', state.basemap === 'satellite' ? 0.15 : 0.35);
        document.querySelectorAll('[data-basemap]').forEach(b => {
            const on = b.dataset.basemap === state.basemap;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on);
        });
    }

    function applyRaise() {
        map.setLayoutProperty('countries-raised', 'visibility', state.raise ? 'visible' : 'none');
        const btn = document.getElementById('globe-raise');
        btn.classList.toggle('active', state.raise);
        btn.setAttribute('aria-pressed', state.raise);
    }

    // ── Layer chips ──
    const chips = [
        ...PLACE_CATEGORIES.map(c => ({ id: c.id, label: c.label, symbol: c.symbol, color: c.color,
            count: allPlaces.filter(p => p.cat === c.id).length })),
        { id: 'highways', label: 'Highways driven', symbol: '〰', color: GLOBE_COLORS.highway, count: drivenSegments.length },
        { id: 'strava', label: STRAVA_LAYER.label, symbol: STRAVA_LAYER.symbol, color: STRAVA_LAYER.color },
    ];
    function applyLayers() {
        const placeCats = PLACE_CATEGORIES.map(c => c.id).filter(id => !state.off.has(id));
        map.setFilter('places', ['in', ['get', 'cat'], ['literal', placeCats]]);
        ['highways', 'strava'].forEach(id => map.setLayoutProperty(id, 'visibility', state.off.has(id) ? 'none' : 'visible'));
    }
    function renderChips() {
        const bar = document.getElementById('globe-chips');
        bar.innerHTML = chips.map(c => {
            const on = !state.off.has(c.id);
            let count = c.count;
            if (c.id === 'strava') count = { idle: '', loading: '…', error: '!', ready: state.stravaCount }[state.strava];
            return `<button class="wm-chip${on ? ' active' : ''}" data-layer="${c.id}" aria-pressed="${on}"
                ${c.id === 'strava' && state.strava === 'error' ? 'disabled title="Strava routes unavailable"' : ''}>
                <span class="wm-chip-symbol" style="color:${c.color}">${c.symbol}</span>${escapeHtml(c.label)}
                ${count !== '' && count !== undefined ? `<span class="wm-chip-count">${typeof count === 'number' ? count.toLocaleString() : count}</span>` : ''}
            </button>`;
        }).join('');
    }
    document.getElementById('globe-chips').addEventListener('click', e => {
        const btn = e.target.closest('[data-layer]');
        if (!btn) return;
        const id = btn.dataset.layer;
        if (state.off.has(id)) state.off.delete(id); else state.off.add(id);
        globeStore(GLOBE_STORAGE.off, [...state.off].join(','));
        applyLayers();
        renderChips();
    });

    // ── Stats + legend ──
    function renderStats() {
        let visited = 0, total = 0;
        listed.forEach(c => { total++; if (c.visited) visited++; });
        const stats = [
            [visited, `of ${total} countries`],
            [places.length, 'places'],
            [state.strava === 'ready' ? state.stravaCount : '…', 'Strava routes'],
        ];
        document.getElementById('globe-stats').innerHTML = stats.map(([n, label]) =>
            `<div class="globe-stat"><span class="globe-stat-num">${typeof n === 'number' ? n.toLocaleString() : n}</span><span class="globe-stat-label">${label}</span></div>`).join('');
    }
    document.getElementById('globe-legend').innerHTML = [
        ['home', 'Home'], ['visited', 'Visited'], ['strava', 'Strava activity, not marked visited'],
    ].map(([k, label]) => `<span><i style="background:${GLOBE_COLORS[k]}"></i>${label}</span>`).join('');

    // ── Popups ──
    function flagEmoji(iso) {
        if (!/^[A-Z]{2}$/.test(iso || '')) return '';
        return String.fromCodePoint(...[...iso].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
    }
    function countryPopup(f) {
        const { name, iso, sov, part } = f.properties;
        const entry = listed.get(name);
        const st = status(f);
        const lines = [];
        if (part) lines.push(`Part of ${escapeHtml(name)}`);
        else if (!entry) lines.push(sov && sov !== name ? `Territory of ${escapeHtml(sov)}` : 'Not counted as a country');
        const placeCount = placesByPart.get(f) || 0;
        const stravaCount = stravaByPart.get(f) || 0;
        if (placeCount) lines.push(`${placeCount.toLocaleString()} place${placeCount === 1 ? '' : 's'} on the globe`);
        if (stravaCount) lines.push(`${stravaCount.toLocaleString()} Strava ${stravaCount === 1 ? 'activity' : 'activities'}`);
        const text = { home: 'Home', visited: 'Visited', none: 'Not yet visited', strava: 'Strava activity, not marked visited' }[st];
        return `<div class="wm-popup"><h3>${flagEmoji(iso)} ${escapeHtml(part || name)}</h3>
            <div class="wm-popup-status wm-status-${st}">${text}</div>
            ${lines.map(l => `<p>${l}</p>`).join('')}</div>`;
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
        const hits = map.queryRenderedFeatures([[x - tapPad, y - tapPad], [x + tapPad, y + tapPad]], { layers: ['places'] });
        if (hits.length) {
            const p = allPlaces[hits[0].id];
            showPopup([p.lng, p.lat], `<div class="wm-popup city-popup"><h3>${escapeHtml(p.name)}</h3>${p.details.join('')}
                <p class="globe-popup-cat" style="color:${catById[p.cat].color}">${catById[p.cat].symbol} ${catById[p.cat].label}</p></div>`);
            return;
        }
        const country = map.queryRenderedFeatures(e.point, { layers: ['countries-raised', 'countries-fill'] })[0];
        if (country) showPopup(e.lngLat, countryPopup(countryFeatures[country.id]));
    });
    ['places', 'countries-fill', 'countries-raised'].forEach(id => {
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    });

    // ── Spin ──
    // Turns slowly while zoomed out, until someone grabs the globe.
    let spinning = !reduceMotion;
    const spinBtn = document.getElementById('globe-spin');
    function spinStep() {
        if (!spinning || map.getZoom() > 3.5 || map.isMoving()) return;
        const c = map.getCenter();
        c.lng -= 6;
        map.easeTo({ center: c, duration: 1000, easing: n => n });
    }
    function setSpin(on) {
        spinning = on;
        spinBtn.classList.toggle('active', on);
        spinBtn.setAttribute('aria-pressed', on);
        if (on) spinStep(); else map.stop();
    }
    map.on('moveend', spinStep);
    map.on('mousedown', () => setSpin(false));
    map.on('touchstart', () => setSpin(false));
    map.on('wheel', () => setSpin(false));
    spinBtn.addEventListener('click', () => setSpin(!spinning));

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
    // Fetched after the globe is up. Each route also marks the outlines it
    // passes through, as on the World Travel map.
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
                featuresAlong(routeCells(points, locate.near), locate)
                    .forEach(f => stravaByPart.set(f, (stravaByPart.get(f) || 0) + 1));
                // ~30 m steps: plenty on a globe, and a fraction of the points.
                features.push(lineFeature(thinPoints(points, 0.0003).map(([lat, lng]) => [lng, lat])));
            });
            state.stravaCount = features.length;
            map.getSource('strava').setData({ type: 'FeatureCollection', features });
            map.getSource('countries').setData(countriesData());
            state.strava = 'ready';
        } catch (err) {
            console.warn('Strava routes unavailable:', err);
            state.strava = 'error';
        }
        renderChips();
        renderStats();
    }

    renderChips();
    renderStats();
    map.on('load', () => {
        applyBasemap();
        applyRaise();
        applyLayers();
        document.getElementById('globe-loading').hidden = true;
        spinStep();
        setSpin(spinning);
        loadStrava();
    });
    window.globeMap = map;  // handy from the console while this is a concept
}

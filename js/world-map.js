
document.addEventListener('DOMContentLoaded', function () {

    Promise.all([
        loadCountriesWithPopulation('data/countries.json', function (updatedData) {
            displayWorldTravelSummary(updatedData);
            renderPopulationSourceBadge();
        }),
        fetch('data/worldCities.json').then(response => response.json()),
        fetch('data/metros.json').then(response => response.json()),
        fetch('data/worldMountains.json').then(response => response.json()),
        fetch('data/familyTravels.json').then(response => response.json()),
        fetch('data/highPoints.json').then(response => response.json()),
        fetch('data/nationalParks.json').then(response => response.json()),
        fetch('data/skiResorts.json').then(response => response.json()),
        fetch('data/sevenWonders.json').then(response => response.json()),
        fetch('data/british-isles-high-five.json').then(response => response.json()),
        fetch('data/adirondack46ers.json').then(response => response.json()),
        fetch('data/colorado14ers.json').then(response => response.json()),
        fetch('data/forbes100cities.json').then(response => response.json()),
        fetch('data/interstateHighways.json').then(response => response.json()),
        fetch('data/highways.json').then(response => response.json())
    ])
        .then(([worldData, citiesData, metrosData, highPointsData, familyTravelsData, stateHighPointsData, nationalParksData, skiResortsData, sevenWondersData, britishIslesData, adk46ersData, colorado14ersData, forbes100Data, interstateData, highwaysData]) => {
            displayWorldTravelSummary(worldData);
            renderPopulationSourceBadge();
            const worldBounds = L.latLngBounds(
                L.latLng(-60, -180),
                L.latLng(85, 180)
            );
            createWorldMap('world-map', worldData, citiesData, metrosData, highPointsData, familyTravelsData, stateHighPointsData, nationalParksData, skiResortsData, sevenWondersData, britishIslesData, adk46ersData, colorado14ersData, forbes100Data, interstateData, highwaysData, 20, 0, 2, worldBounds);
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

function createWorldMap(mapId, worldData, citiesData, metrosData, highPointsData, familyTravelsData, stateHighPointsData, nationalParksData, skiResortsData, sevenWondersData, britishIslesData, adk46ersData, colorado14ersData, forbes100Data, interstateData, highwaysData, centerLat, centerLng, zoom, bounds) {
    const map = L.map(mapId, {
        center: [centerLat, centerLng],
        zoom: zoom,
        zoomSnap: 0.1,
        zoomDelta: 0.5,
        wheelPxPerZoomLevel: 120,
        gestureHandling: true,
        fullscreenControl: true
    });

    // Disable gesture handling in fullscreen mode
    map.on('fullscreenchange', () => {
        if (map.isFullscreen()) {
            map.gestureHandling.disable();
        } else {
            map.gestureHandling.enable();
        }
    });

    // Use OpenStreetMap tiles (no API key needed)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    // Layer groups for toggling
    let countryLayer = null;
    let radiusLayer = L.layerGroup();
    let fogOverlay = null;
    let currentMode = 'country'; // 'country' | 'radius' | 'fog'

    // Store all marker layers so we can hide/show them in fog mode
    const allMarkerLayers = [];

    // Collect all visited pin locations
    const visitedPins = [];
    const pinSet = new Set();

    function addPin(lat, lng, name) {
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        if (!pinSet.has(key)) {
            pinSet.add(key);
            visitedPins.push({ lat, lng, name });
        }
    }

    citiesData.visitedCities.forEach(city => {
        addPin(city.latitude, city.longitude, city.name);
    });
    metrosData.filter(m => m.visited).forEach(metro => {
        addPin(metro.coords[1], metro.coords[0], metro.name);
    });
    highPointsData.countryHighPoints.forEach(hp => {
        addPin(hp.latitude, hp.longitude, hp.name);
    });
    (highPointsData.otherMountains || []).forEach(hp => {
        addPin(hp.latitude, hp.longitude, hp.name);
    });
    // Add person1 (Justin) pins from family travels
    familyTravelsData.locations
        .filter(loc => loc.visitors.includes('person1'))
        .forEach(loc => {
            addPin(loc.lat, loc.lng, loc.name);
        });
    // Add visited state high points
    stateHighPointsData.filter(hp => hp.visited).forEach(hp => {
        addPin(hp.coords[1], hp.coords[0], hp.name);
    });
    // Add visited national parks (correct coords for territories)
    const parkCoordOverrides = {
        'American Samoa': { lat: -14.2710, lng: -170.1322 },
        'Virgin Islands': { lat: 18.3358, lng: -64.8963 }
    };
    nationalParksData.filter(np => np.visited).forEach(np => {
        const override = parkCoordOverrides[np.name];
        if (override) {
            addPin(override.lat, override.lng, np.name + ' NP');
        } else {
            addPin(np.coords[1], np.coords[0], np.name + ' NP');
        }
    });
    // Add visited ski resorts
    skiResortsData.filter(sr => sr.visited).forEach(sr => {
        addPin(sr.coords[1], sr.coords[0], sr.name);
    });

    // Add visited Seven Wonders (modern + natural + nominees)
    sevenWondersData.sevenWonders.filter(w => w.visited).forEach(w => {
        addPin(w.coordinates.lat, w.coordinates.lng, w.name);
    });
    sevenWondersData.sevenNaturalWonders.filter(w => w.visited).forEach(w => {
        addPin(w.coordinates.lat, w.coordinates.lng, w.name);
    });
    sevenWondersData.sevenNaturalWondersNominees.filter(w => w.visited).forEach(w => {
        addPin(w.coordinates.lat, w.coordinates.lng, w.name);
    });

    // Add climbed British Isles High Five peaks
    britishIslesData.filter(p => p.climbed).forEach(p => {
        addPin(p.coords[1], p.coords[0], p.name);
    });

    // Add climbed ADK 46ers
    adk46ersData.filter(p => p.climbed).forEach(p => {
        addPin(p.coords[1], p.coords[0], p.name);
    });

    // Add climbed Colorado 14ers
    colorado14ersData.filter(p => p.climbed).forEach(p => {
        addPin(p.coords[1], p.coords[0], p.name);
    });

    // Add Forbes 100 cities — cross-reference with person1 familyTravels locations
    const person1Coords = new Set();
    familyTravelsData.locations
        .filter(loc => loc.visitors.includes('person1'))
        .forEach(loc => {
            person1Coords.add(`${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}`);
        });
    forbes100Data.forEach(city => {
        const key = `${city.coords[1].toFixed(2)},${city.coords[0].toFixed(2)}`;
        if (person1Coords.has(key)) {
            addPin(city.coords[1], city.coords[0], city.name);
        }
    });

    // Collect driven highway segments for fog of war
    const drivenSegments = [];
    if (interstateData && interstateData.interstates) {
        interstateData.interstates.forEach(interstate => {
            interstate.routeSegments.forEach(seg => {
                if (seg.driven && seg.waypoints && seg.waypoints.length >= 2) {
                    drivenSegments.push(seg.waypoints);
                }
            });
        });
    }
    if (highwaysData && highwaysData.highways) {
        highwaysData.highways.forEach(highway => {
            highway.routeSegments.forEach(seg => {
                if (seg.driven && seg.waypoints && seg.waypoints.length >= 2) {
                    drivenSegments.push(seg.waypoints);
                }
            });
        });
    }

    // Shared canvas renderer for radius circles — overlapping circles
    // blend naturally without expensive geometric union operations
    const radiusRenderer = L.canvas({ padding: 0.5, interactive: false });

    function drawRadiusCircles(radiusKm, highwayRadiusKm) {
        radiusLayer.clearLayers();
        visitedPins.forEach(pin => {
            L.circle([pin.lat, pin.lng], {
                radius: radiusKm * 1000,
                color: 'transparent',
                fillColor: '#4CAF50',
                fillOpacity: 0.35,
                weight: 0,
                interactive: false,
                renderer: radiusRenderer
            }).addTo(radiusLayer);
        });

        // Draw highway corridor circles along driven segments
        const hwRadius = highwayRadiusKm || parseInt(highwaySlider ? highwaySlider.value : 50);
        const stepKm = Math.max(hwRadius * 0.4, 5);
        drivenSegments.forEach(waypoints => {
            for (let i = 0; i < waypoints.length - 1; i++) {
                const from = L.latLng(waypoints[i][0], waypoints[i][1]);
                const to = L.latLng(waypoints[i + 1][0], waypoints[i + 1][1]);
                const segDist = from.distanceTo(to) / 1000;
                const steps = Math.max(1, Math.ceil(segDist / stepKm));
                for (let s = 0; s <= steps; s++) {
                    const t = s / steps;
                    const lat = from.lat + (to.lat - from.lat) * t;
                    const lng = from.lng + (to.lng - from.lng) * t;
                    L.circle([lat, lng], {
                        radius: hwRadius * 1000,
                        color: 'transparent',
                        fillColor: '#4CAF50',
                        fillOpacity: 0.35,
                        weight: 0,
                        interactive: false,
                        renderer: radiusRenderer
                    }).addTo(radiusLayer);
                }
            }
        });
    }

    // Fetch GeoJSON from Natural Earth
    fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson')
        .then(response => response.json())
        .then(geojson => {
            countryLayer = L.geoJSON(geojson, {
                style: function (feature) {
                    const countryName = feature.properties.ADMIN;
                    const isHome = isHomeCountry(countryName);
                    const isVisited = isCountryVisited(countryName, worldData);

                    let fillColor;
                    if (isHome) {
                        fillColor = '#FFC107';
                    } else if (isVisited) {
                        fillColor = '#4CAF50';
                    } else {
                        fillColor = '#f44336';
                    }

                    return {
                        fillColor: fillColor,
                        weight: 1,
                        opacity: 1,
                        color: 'white',
                        fillOpacity: 0.7
                    };
                },
                onEachFeature: function (feature, layer) {
                    const countryName = feature.properties.ADMIN;
                    const countryData = getCountryData(countryName, worldData);
                    const isHome = isHomeCountry(countryName);

                    let status;
                    if (isHome) {
                        status = 'Home';
                    } else if (countryData && countryData.visited) {
                        status = 'Visited';
                    } else {
                        status = 'Not yet Visited';
                    }

                    layer.bindPopup(`
                        <strong>${countryName}</strong><br>
                        Population: ${countryData ? countryData.population.toLocaleString() : 'N/A'}<br>
                        Status: ${status}
                    `);
                }
            }).addTo(map);

            // Store a red-only version style function for radius mode
            window._worldMapCountryLayer = countryLayer;
            window._worldMapGeojson = geojson;
        });

    function enableRadiusMode(radiusKm) {
        if (countryLayer) map.removeLayer(countryLayer);
        removeFogOverlay();
        showAllMarkers();
        const hwKm = parseInt(highwaySlider ? highwaySlider.value : 50);
        drawRadiusCircles(radiusKm, hwKm);
        radiusLayer.addTo(map);
        map.gestureHandling.disable();
        currentMode = 'radius';
    }

    function disableRadiusMode() {
        map.removeLayer(radiusLayer);
        if (countryLayer) countryLayer.addTo(map);
        if (!map.isFullscreen()) map.gestureHandling.enable();
        currentMode = 'country';
    }

    // --- Fog of War ---
    // Uses an SVG overlay that covers the world in a dark mask,
    // with circular cutouts at each visited pin location.

    function createFogOverlay(pointRadiusKm, highwayRadiusKm) {
        removeFogOverlay();

        const FogLayer = L.Layer.extend({
            onAdd: function (map) {
                this._map = map;
                const pane = map.getPane('overlayPane');
                this._container = L.DomUtil.create('div', 'fog-of-war-container', pane);
                this._container.style.pointerEvents = 'none';
                this._svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                this._svg.setAttribute('class', 'fog-of-war-svg');
                this._container.appendChild(this._svg);
                map.on('moveend zoomend resize', this._update, this);
                this._pointRadiusKm = pointRadiusKm;
                this._highwayRadiusKm = highwayRadiusKm;
                this._update();
            },
            onRemove: function (map) {
                map.off('moveend zoomend resize', this._update, this);
                if (this._container && this._container.parentNode) {
                    this._container.parentNode.removeChild(this._container);
                }
            },
            setPointRadius: function (km) {
                this._pointRadiusKm = km;
                this._update();
            },
            setHighwayRadius: function (km) {
                this._highwayRadiusKm = km;
                this._update();
            },
            _update: function () {
                if (!this._map) return;
                const map = this._map;
                const size = map.getSize();
                // Expand SVG well beyond viewport so panning doesn't reveal edges
                const pad = Math.max(size.x, size.y) * 2;
                const origin = map.getPixelOrigin();
                const topLeft = map.containerPointToLayerPoint([-pad, -pad]);
                const w = size.x + pad * 2;
                const h = size.y + pad * 2;

                const svg = this._svg;
                svg.setAttribute('width', w);
                svg.setAttribute('height', h);
                svg.style.width = w + 'px';
                svg.style.height = h + 'px';
                L.DomUtil.setPosition(this._container, topLeft);

                // Build mask: white = fogged, black = clear
                // All cutouts are solid black — a single blur on the mask
                // softens every edge uniformly, so overlapping circles merge cleanly.
                let cutouts = '';
                let maxR = 0;
                visitedPins.forEach(pin => {
                    const pt = map.latLngToLayerPoint([pin.lat, pin.lng]);
                    const cx = pt.x - topLeft.x;
                    const cy = pt.y - topLeft.y;
                    const dest = L.latLng(pin.lat, pin.lng);
                    const bearing = dest.toBounds(this._pointRadiusKm * 2000);
                    const east = L.latLng(pin.lat, bearing.getEast());
                    const ptEdge = map.latLngToLayerPoint(east);
                    const r = Math.abs(ptEdge.x - pt.x);
                    if (r > maxR) maxR = r;
                    cutouts += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="black"/>`;
                });

                // Draw driven highway segments as thick black paths in the mask
                // Stroke width uses the highway-specific radius
                drivenSegments.forEach(waypoints => {
                    let d = '';
                    waypoints.forEach((wp, i) => {
                        const pt = map.latLngToLayerPoint([wp[0], wp[1]]);
                        const px = pt.x - topLeft.x;
                        const py = pt.y - topLeft.y;
                        d += (i === 0 ? `M${px},${py}` : ` L${px},${py}`);
                    });
                    // Use the midpoint latitude to calculate stroke width
                    const midWp = waypoints[Math.floor(waypoints.length / 2)];
                    const midLatLng = L.latLng(midWp[0], midWp[1]);
                    const bounds = midLatLng.toBounds(this._highwayRadiusKm * 2000);
                    const midPt = map.latLngToLayerPoint(midLatLng);
                    const eastPt = map.latLngToLayerPoint(L.latLng(midWp[0], bounds.getEast()));
                    const strokeW = Math.abs(eastPt.x - midPt.x) * 2;
                    cutouts += `<path d="${d}" fill="none" stroke="black" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>`;
                });

                // Scale blur to ~8% of circle radius so edges stay soft
                // but circles remain clearly visible at any zoom
                const blurSigma = Math.max(2, Math.min(maxR * 0.08, 20));

                svg.innerHTML = `
                    <defs>
                        <filter id="mask-blur">
                            <feGaussianBlur stdDeviation="${blurSigma}"/>
                        </filter>
                        <mask id="fog-mask">
                            <g filter="url(#mask-blur)">
                                <rect x="0" y="0" width="${w}" height="${h}" fill="white"/>
                                ${cutouts}
                            </g>
                        </mask>
                        <filter id="fog-smoke" x="-20%" y="-20%" width="140%" height="140%">
                            <feTurbulence type="fractalNoise" baseFrequency="0.015 0.012"
                                          numOctaves="5" seed="3" stitchTiles="stitch" result="noise"/>
                            <feColorMatrix type="saturate" values="0" in="noise" result="grayNoise"/>
                            <feComponentTransfer in="grayNoise" result="contrastNoise">
                                <feFuncR type="linear" slope="1.8" intercept="-0.3"/>
                                <feFuncG type="linear" slope="1.8" intercept="-0.3"/>
                                <feFuncB type="linear" slope="1.8" intercept="-0.3"/>
                            </feComponentTransfer>
                            <feGaussianBlur stdDeviation="3" in="contrastNoise" result="softNoise"/>
                            <feFlood flood-color="#1a1a1e" flood-opacity="1" result="fogColor"/>
                            <feBlend mode="multiply" in="fogColor" in2="softNoise" result="texturedFog"/>
                            <feComposite operator="in" in="texturedFog" in2="SourceGraphic"/>
                        </filter>
                    </defs>
                    <g mask="url(#fog-mask)">
                        <rect x="0" y="0" width="${w}" height="${h}"
                              fill="rgba(15,15,18,0.92)" filter="url(#fog-smoke)"/>
                        <rect x="0" y="0" width="${w}" height="${h}"
                              fill="rgba(140,145,155,0.08)" filter="url(#fog-smoke)"
                              style="mix-blend-mode: screen;"/>
                    </g>
                `;
            }
        });

        fogOverlay = new FogLayer();
        fogOverlay.addTo(map);
    }

    function removeFogOverlay() {
        if (fogOverlay) {
            fogOverlay.remove();
            fogOverlay = null;
        }
    }

    function hideAllMarkers() {
        map.eachLayer(function (layer) {
            if (layer instanceof L.Marker) {
                allMarkerLayers.push(layer);
                map.removeLayer(layer);
            }
        });
    }

    function showAllMarkers() {
        allMarkerLayers.forEach(function (layer) {
            layer.addTo(map);
        });
        allMarkerLayers.length = 0;
    }

    function enableFogMode(pointRadiusKm, highwayRadiusKm) {
        if (countryLayer) map.removeLayer(countryLayer);
        map.removeLayer(radiusLayer);
        hideAllMarkers();
        createFogOverlay(pointRadiusKm, highwayRadiusKm);
        map.gestureHandling.disable();
        currentMode = 'fog';
    }

    function enableCountryMode() {
        map.removeLayer(radiusLayer);
        removeFogOverlay();
        showAllMarkers();
        if (countryLayer) countryLayer.addTo(map);
        if (!map.isFullscreen()) map.gestureHandling.enable();
        currentMode = 'country';
    }

    // Wire up mode buttons and sliders
    const modeButtons = document.querySelectorAll('.view-mode-btn');
    const slider = document.getElementById('radius-slider');
    const radiusValue = document.getElementById('radius-value');
    const radiusControl = document.getElementById('radius-control');
    const highwaySlider = document.getElementById('highway-radius-slider');
    const highwayRadiusValue = document.getElementById('highway-radius-value');
    const highwayRadiusControl = document.getElementById('highway-radius-control');

    modeButtons.forEach(btn => {
        btn.addEventListener('click', function () {
            const mode = this.dataset.mode;
            if (mode === currentMode) return;
            modeButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');

            if (mode === 'country') {
                radiusControl.style.display = 'none';
                highwayRadiusControl.style.display = 'none';
                enableCountryMode();
            } else if (mode === 'radius') {
                radiusControl.style.display = 'flex';
                highwayRadiusControl.style.display = 'flex';
                enableRadiusMode(parseInt(slider.value));
            } else if (mode === 'fog') {
                radiusControl.style.display = 'flex';
                highwayRadiusControl.style.display = 'flex';
                enableFogMode(parseInt(slider.value), parseInt(highwaySlider.value));
            }
        });
    });

    if (slider) {
        slider.addEventListener('input', function () {
            radiusValue.textContent = this.value;
            const km = parseInt(this.value);
            if (currentMode === 'radius') {
                const hwKm = parseInt(highwaySlider ? highwaySlider.value : 50);
                drawRadiusCircles(km, hwKm);
            } else if (currentMode === 'fog' && fogOverlay) {
                fogOverlay.setPointRadius(km);
            }
        });
    }

    if (highwaySlider) {
        highwaySlider.addEventListener('input', function () {
            highwayRadiusValue.textContent = this.value;
            const km = parseInt(this.value);
            if (currentMode === 'fog' && fogOverlay) {
                fogOverlay.setHighwayRadius(km);
            } else if (currentMode === 'radius') {
                drawRadiusCircles(parseInt(slider.value), km);
            }
        });
    }

    // Add city markers (worldCities + metros + Forbes matches + familyTravels person1 cities)
    addCityMarkers(map, citiesData, metrosData, familyTravelsData, forbes100Data);

    // Add world high points and other mountains markers (worldMountains — purple/orange triangles)
    addHighPointsMarkers(map, highPointsData);

    // Add mountain markers (state high points, British Isles, ADK 46ers, CO 14ers — orange triangles)
    addMountainMarkers(map, stateHighPointsData, britishIslesData, adk46ersData, colorado14ersData);

    // Add park & landmark markers (national parks, seven wonders, ski resorts — teal diamonds)
    addParkMarkers(map, nationalParksData, sevenWondersData, skiResortsData);

    createWorldLegend(map);
}

function addCityMarkers(map, citiesData, metrosData, familyTravelsData, forbes100Data) {
    const cityIcon = L.divIcon({
        className: 'city-marker',
        html: '<div class="city-marker-inner">●</div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8],
        popupAnchor: [0, -8]
    });

    const addedCoords = new Set();
    function addCity(lat, lng, popupHtml) {
        const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
        if (addedCoords.has(key)) return;
        addedCoords.add(key);
        L.marker([lat, lng], { icon: cityIcon }).addTo(map).bindPopup(popupHtml);
    }

    // World cities
    citiesData.visitedCities.forEach(city => {
        addCity(city.latitude, city.longitude, `
            <div class="city-popup">
                <h3>${city.name}</h3>
                <p><strong>Country:</strong> ${city.country}</p>
                <p><strong>Population:</strong> ${city.population.toLocaleString()}</p>
                <p>${city.description}</p>
            </div>
        `);
    });

    // Metros
    metrosData.filter(m => m.visited).sort((a, b) => a.rank - b.rank).forEach(metro => {
        addCity(metro.coords[1], metro.coords[0], `
            <div class="city-popup">
                <h3>${metro.name}</h3>
                <p><strong>Metro Area:</strong> ${metro.metro_name}</p>
                <p><strong>Rank:</strong> #${metro.rank} in US</p>
                <p><strong>State:</strong> ${metro.state}</p>
                <p><strong>Population:</strong> ${metro.population}</p>
            </div>
        `);
    });

    // Person1 familyTravels locations (cities/general locations)
    familyTravelsData.locations
        .filter(loc => loc.visitors.includes('person1'))
        .forEach(loc => {
            addCity(loc.lat, loc.lng, `
                <div class="city-popup">
                    <h3>${loc.name}</h3>
                    <p><strong>Country:</strong> ${loc.country}</p>
                </div>
            `);
        });

    // Forbes 100 cities (cross-referenced with person1 locations)
    const person1Coords = new Set();
    familyTravelsData.locations
        .filter(loc => loc.visitors.includes('person1'))
        .forEach(loc => {
            person1Coords.add(`${loc.lat.toFixed(2)},${loc.lng.toFixed(2)}`);
        });
    forbes100Data.forEach(city => {
        const key = `${city.coords[1].toFixed(2)},${city.coords[0].toFixed(2)}`;
        if (person1Coords.has(key)) {
            addCity(city.coords[1], city.coords[0], `
                <div class="city-popup">
                    <h3>${city.name}</h3>
                    <p><strong>Country:</strong> ${city.country}</p>
                    <p><em>Forbes 100 Most Visited Cities</em></p>
                </div>
            `);
        }
    });
}

function addHighPointsMarkers(map, highPointsData) {
    const highPointIcon = L.divIcon({
        className: 'high-point-marker',
        html: '<div class="high-point-marker-inner">▲</div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -7]
    });

    const otherMountainIcon = L.divIcon({
        className: 'mountain-marker',
        html: '<div class="mountain-marker-inner">▲</div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -7]
    });

    highPointsData.countryHighPoints.forEach(hp => {
        L.marker([hp.latitude, hp.longitude], { icon: highPointIcon, zIndexOffset: 1000 })
            .addTo(map)
            .bindPopup(`
                <div class="high-point-popup">
                    <h3>${hp.name}</h3>
                    <p><strong>Country:</strong> ${hp.country}</p>
                    <p><strong>Elevation:</strong> ${hp.elevation.toLocaleString()} ${hp.elevationUnit}</p>
                    <p>${hp.description}</p>
                </div>
            `);
    });

    (highPointsData.otherMountains || []).forEach(hp => {
        L.marker([hp.latitude, hp.longitude], { icon: otherMountainIcon, zIndexOffset: 950 })
            .addTo(map)
            .bindPopup(`
                <div class="high-point-popup">
                    <h3>${hp.name}</h3>
                    <p><strong>Country:</strong> ${hp.country}</p>
                    <p><strong>Elevation:</strong> ${hp.elevation.toLocaleString()} ${hp.elevationUnit}</p>
                    <p>${hp.description}</p>
                </div>
            `);
    });
}

function addMountainMarkers(map, stateHighPointsData, britishIslesData, adk46ersData, colorado14ersData) {
    const mountainIcon = L.divIcon({
        className: 'mountain-marker',
        html: '<div class="mountain-marker-inner">▲</div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -7]
    });

    const addedCoords = new Set();
    function addMountain(lat, lng, name, detail) {
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        if (addedCoords.has(key)) return;
        addedCoords.add(key);
        L.marker([lat, lng], { icon: mountainIcon, zIndexOffset: 900 })
            .addTo(map)
            .bindPopup(`<div class="high-point-popup"><h3>${name}</h3>${detail}</div>`);
    }

    // State high points (visited)
    stateHighPointsData.filter(hp => hp.visited).forEach(hp => {
        addMountain(hp.coords[1], hp.coords[0], hp.name,
            `<p><strong>Type:</strong> US State High Point</p><p><strong>Elevation:</strong> ${hp.elevation.toLocaleString()} ft</p>`);
    });

    // British Isles High Five (climbed)
    britishIslesData.filter(p => p.climbed).forEach(p => {
        addMountain(p.coords[1], p.coords[0], p.name,
            `<p><strong>Type:</strong> British Isles High Five</p><p><strong>Country:</strong> ${p.country}</p><p><strong>Elevation:</strong> ${p.elevation.toLocaleString()} m</p>`);
    });

    // ADK 46ers (climbed)
    adk46ersData.filter(p => p.climbed).forEach(p => {
        addMountain(p.coords[1], p.coords[0], p.name,
            `<p><strong>Type:</strong> ADK 46er</p><p><strong>Elevation:</strong> ${p.elevation.toLocaleString()} ft</p>`);
    });

    // Colorado 14ers (climbed)
    colorado14ersData.filter(p => p.climbed).forEach(p => {
        addMountain(p.coords[1], p.coords[0], p.name,
            `<p><strong>Type:</strong> Colorado 14er</p><p><strong>Elevation:</strong> ${p.elevation.toLocaleString()} ft</p>`);
    });
}

function addParkMarkers(map, nationalParksData, sevenWondersData, skiResortsData) {
    const parkIcon = L.divIcon({
        className: 'park-marker',
        html: '<div class="park-marker-inner">◆</div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
        popupAnchor: [0, -7]
    });

    const parkCoordOverrides = {
        'American Samoa': { lat: -14.2710, lng: -170.1322 },
        'Virgin Islands': { lat: 18.3358, lng: -64.8963 }
    };

    const addedCoords = new Set();
    function addPark(lat, lng, name, detail) {
        const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
        if (addedCoords.has(key)) return;
        addedCoords.add(key);
        L.marker([lat, lng], { icon: parkIcon, zIndexOffset: 800 })
            .addTo(map)
            .bindPopup(`<div class="city-popup"><h3>${name}</h3>${detail}</div>`);
    }

    // National parks (visited)
    nationalParksData.filter(np => np.visited).forEach(np => {
        const override = parkCoordOverrides[np.name];
        const lat = override ? override.lat : np.coords[1];
        const lng = override ? override.lng : np.coords[0];
        addPark(lat, lng, np.name + ' National Park',
            `<p><strong>Type:</strong> US National Park</p>`);
    });

    // Seven Wonders (all three arrays, visited)
    ['sevenWonders', 'sevenNaturalWonders', 'sevenNaturalWondersNominees'].forEach(key => {
        (sevenWondersData[key] || []).filter(w => w.visited).forEach(w => {
            const type = key === 'sevenWonders' ? 'Seven Wonders of the World'
                : key === 'sevenNaturalWonders' ? 'Seven Natural Wonders'
                    : 'Natural Wonders Nominee';
            addPark(w.coordinates.lat, w.coordinates.lng, w.name,
                `<p><strong>Type:</strong> ${type}</p><p><strong>Country:</strong> ${w.country || w.primaryCountry || ''}</p>`);
        });
    });

    // Ski resorts (visited)
    skiResortsData.filter(sr => sr.visited).forEach(sr => {
        addPark(sr.coords[1], sr.coords[0], sr.name,
            `<p><strong>Type:</strong> Ski Resort</p>`);
    });
}

function createWorldLegend(map) {
    const legend = L.control({ position: 'bottomright' });

    legend.onAdd = function (map) {
        const div = L.DomUtil.create('div', 'info legend');
        div.innerHTML = `
            <div><span class="legend-swatch" style="background-color: rgba(255, 193, 7, 0.9);"></span> Home Country</div>
            <div><span class="legend-swatch" style="background-color: rgba(76, 175, 80, 0.9);"></span> Visited Countries</div>
            <div><span class="legend-swatch" style="background-color: rgba(244, 67, 54, 0.9);"></span> Not yet Visited</div>
            <div><span class="legend-symbol" style="color: #2196F3;">●</span> Cities</div>
            <div><span class="legend-symbol" style="color: #9C27B0;">▲</span> Country High Points</div>
            <div><span class="legend-symbol" style="color: #FF9800;">▲</span> Mountains</div>
            <div><span class="legend-symbol" style="color: #00897B;">◆</span> Parks & Landmarks</div>
        `;
        return div;
    };

    legend.addTo(map);
}

function isHomeCountry(countryName) {
    // Define home country - can be easily modified if needed
    return countryName === 'United States of America';
}

function isCountryVisited(countryName, worldData) {
    const continents = ['northAmericanCountries', 'southAmericanCountries',
        'europeanCountries', 'africanCountries',
        'asianCountries', 'oceaniaCountries'];

    for (const continent of continents) {
        const country = worldData[continent].find(c => c.name === countryName);
        if (country && country.visited) return true;
    }
    return false;
}

function getCountryData(countryName, worldData) {
    const continents = ['northAmericanCountries', 'southAmericanCountries',
        'europeanCountries', 'africanCountries',
        'asianCountries', 'oceaniaCountries'];

    for (const continent of continents) {
        const country = worldData[continent].find(c => c.name === countryName);
        if (country) return country;
    }
    return null;
}

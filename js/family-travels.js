// Family Travels Map JavaScript

let map;
let markers = [];
let currentFilter = 'all';
let familyTravelsData = null;
let countryLayer = null;
let mapMode = 'country'; // 'country' or 'proximity' or 'radius' or 'fog'
let proximityCircles = [];
let voronoiLayer = null;
let landGeoJSON = null;
let showPins = true;
let fogOverlay = null;
let fogMarkerCache = [];
// Lazy cache for stripe patterns — only created when needed
const createdPatterns = new Set();
let patternDefs = null;

// Person colors — single source of truth (matches CSS custom properties)
const PERSON_COLORS = {
    person1: '#9b59b6',
    person2: '#27ae60',
    person3: '#f1c40f',
    person4: '#e91e63',
    person5: '#2196F3',
    person6: '#FF69B4'
};

// Person initials for colorblind-friendly pins
const PERSON_INITIALS = {};

// Get color for person
function getSiblingColor(personId) {
    return PERSON_COLORS[personId] || '#888888';
}

// Get initials for person (first letter of name)
function getPersonInitial(personId) {
    return PERSON_INITIALS[personId] || '?';
}

// Initialize the map
async function initMap() {
    const loadingEl = document.getElementById('map-loading');
    const errorEl = document.getElementById('map-error');
    const controlsEl = document.getElementById('controls-panel');
    const statsEl = document.getElementById('stats-panel');
    const personStatsEl = document.getElementById('person-stats-panel');
    const searchEl = document.getElementById('location-search');

    try {
        const response = await fetch('data/familyTravels.json');
        familyTravelsData = await response.json();

        // Build initials map from data
        Object.entries(familyTravelsData.persons).forEach(([id, name]) => {
            PERSON_INITIALS[id] = name.charAt(0).toUpperCase();
        });

        // Load metros.json and merge person1's US cities
        const metrosResponse = await fetch('data/metros.json');
        const metrosData = await metrosResponse.json();

        metrosData.forEach(metro => {
            if (metro.visited) {
                const existingLocation = familyTravelsData.locations.find(loc =>
                    loc.name === metro.name && loc.country === 'United States'
                );
                if (existingLocation) {
                    if (!existingLocation.visitors.includes('person1')) {
                        existingLocation.visitors.push('person1');
                    }
                } else {
                    familyTravelsData.locations.push({
                        name: metro.name,
                        country: 'United States',
                        lat: metro.coords[1],
                        lng: metro.coords[0],
                        visitors: ['person1']
                    });
                }
            }
        });

        // Merge all additional person1 data sources so both pages share the same pins
        await mergeAdditionalPerson1Data(familyTravelsData);

    } catch (error) {
        console.error('Error loading family travels data:', error);
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorEl) errorEl.style.display = 'block';
        return;
    }

    // Generate traveler toggles from data
    generateTravelerToggles();

    map = L.map('family-map', {
        gestureHandling: true,
        fullscreenControl: true
    }).setView([20, 0], 2);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
    }).addTo(map);

    map.on('fullscreenchange', () => {
        if (map.isFullscreen()) {
            map.gestureHandling.disable();
        } else {
            map.gestureHandling.enable();
        }
    });

    // Setup the lazy pattern SVG container
    setupPatternContainer();

    await loadCountries();

    renderMarkers();
    updateStats();
    setupEventListeners();
    setupSearch();

    // Hide loading, show controls
    if (loadingEl) loadingEl.style.display = 'none';
    if (controlsEl) controlsEl.style.display = '';
    if (statsEl) statsEl.style.display = '';
    if (personStatsEl) personStatsEl.style.display = '';
    if (searchEl) searchEl.style.display = '';
}

// Generate traveler toggle checkboxes from data
function generateTravelerToggles() {
    const container = document.getElementById('traveler-toggles');
    if (!container || !familyTravelsData) return;

    const personIds = Object.keys(familyTravelsData.persons);
    container.innerHTML = personIds.map(id => {
        const name = familyTravelsData.persons[id];
        const num = id.replace('person', '');
        return `
            <label class="traveler-toggle">
                <input type="checkbox" id="toggle-${id}" checked aria-label="Show locations for ${name}">
                <span class="toggle-label person${num}-color">${name}</span>
            </label>
        `;
    }).join('');
}

// Setup lazy pattern container (no upfront generation of all 63 combos)
function setupPatternContainer() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.position = 'absolute';
    svg.style.width = '0';
    svg.style.height = '0';
    svg.setAttribute('aria-hidden', 'true');
    patternDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    svg.appendChild(patternDefs);
    document.body.appendChild(svg);
}

// Lazily create a stripe pattern only when needed
function ensureStripePattern(personIds) {
    const sorted = [...personIds].sort();
    const patternId = `stripe-${sorted.join('-')}`;
    if (createdPatterns.has(patternId)) return patternId;

    const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
    pattern.setAttribute('id', patternId);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', sorted.length * 10);
    pattern.setAttribute('height', sorted.length * 10);
    pattern.setAttribute('patternTransform', 'rotate(45)');

    sorted.forEach((person, index) => {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', index * 10);
        rect.setAttribute('y', '0');
        rect.setAttribute('width', '10');
        rect.setAttribute('height', sorted.length * 10);
        rect.setAttribute('fill', getSiblingColor(person));
        pattern.appendChild(rect);
    });

    patternDefs.appendChild(pattern);
    createdPatterns.add(patternId);
    return patternId;
}

// Create special rainbow pin for locations visited by all people
function createRainbowPinSVG() {
    const personIds = Object.keys(familyTravelsData.persons);
    const colors = personIds.map(id => getSiblingColor(id));

    let stripes = '';
    const stripeHeight = 25 / colors.length;
    colors.forEach((color, index) => {
        stripes += `<rect x="23" y="${10 + (index * stripeHeight)}" width="4" height="${stripeHeight}" fill="${color}"/>`;
    });

    let circleSegments = '';
    const anglePerSegment = 360 / colors.length;
    colors.forEach((color, index) => {
        const startAngle = index * anglePerSegment - 90;
        const endAngle = (index + 1) * anglePerSegment - 90;
        const startRad = (startAngle * Math.PI) / 180;
        const endRad = (endAngle * Math.PI) / 180;
        const x1 = 25 + 8 * Math.cos(startRad);
        const y1 = 10 + 8 * Math.sin(startRad);
        const x2 = 25 + 8 * Math.cos(endRad);
        const y2 = 10 + 8 * Math.sin(endRad);
        circleSegments += `<path d="M 25 10 L ${x1} ${y1} A 8 8 0 0 1 ${x2} ${y2} Z" fill="${color}" stroke="rgba(255,255,255,0.9)" stroke-width="0.5"/>`;
    });

    return `
        <svg width="60" height="50" viewBox="0 0 60 50" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="All family members visited">
            <defs>
                <filter id="rainbow-shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="1.5"/>
                    <feOffset dx="0" dy="2" result="offsetblur"/>
                    <feComponentTransfer><feFuncA type="linear" slope="0.4"/></feComponentTransfer>
                    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
            </defs>
            <g filter="url(#rainbow-shadow)" transform="translate(5, 5)">
                ${stripes}
                ${circleSegments}
                <circle cx="25" cy="10" r="8" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/>
            </g>
        </svg>
    `;
}

// Create combined SVG for all lollipops at a location — with initials for colorblind accessibility
function createCombinedLollipopSVG(visitors) {
    const totalPersons = Object.keys(familyTravelsData.persons).length;
    const total = visitors.length;

    if (total === totalPersons) {
        return createRainbowPinSVG();
    }

    let lollipops = '';
    visitors.forEach((visitor, index) => {
        const color = getSiblingColor(visitor);
        const initial = getPersonInitial(visitor);
        let lineX1 = 25, lineY1 = 35;
        let lineX2 = 25, lineY2 = 10;

        if (total === 1) { lineX2 = 25; lineY2 = 10; }
        else if (total === 2) { lineX2 = index === 0 ? 19 : 31; lineY2 = 10; }
        else if (total === 3) { lineX2 = [13, 25, 37][index]; lineY2 = 10; }
        else if (total === 4) {
            lineX2 = [19, 31, 19, 31][index];
            lineY2 = [7, 7, 19, 19][index];
        } else if (total === 5) {
            lineX2 = [16, 34, 16, 34, 25][index];
            lineY2 = [7, 7, 19, 19, 13][index];
        }

        if (Math.abs(lineX2 - lineX1) < 0.5) {
            const rectWidth = 3;
            const rectHeight = lineY1 - lineY2;
            lollipops += `<rect x="${lineX1 - rectWidth / 2}" y="${lineY2}" width="${rectWidth}" height="${rectHeight}" fill="${color}" rx="1.5"/>`;
        } else {
            lollipops += `<line x1="${lineX1}" y1="${lineY1}" x2="${lineX2}" y2="${lineY2}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;
        }

        lollipops += `<circle cx="${lineX2}" cy="${lineY2}" r="6" fill="${color}" stroke="rgba(255,255,255,0.9)" stroke-width="1.5"/>`;
        // Add initial letter for colorblind accessibility
        lollipops += `<text x="${lineX2}" y="${lineY2 + 3.5}" text-anchor="middle" font-size="7" font-weight="bold" fill="white" style="pointer-events:none">${initial}</text>`;
    });

    const label = visitors.map(v => familyTravelsData.persons[v]).join(', ');
    return `
        <svg width="50" height="40" viewBox="0 0 50 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Visited by ${label}">
            <defs>
                <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="1"/>
                    <feOffset dx="0" dy="1" result="offsetblur"/>
                    <feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
                    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
            </defs>
            <g filter="url(#shadow)">${lollipops}</g>
        </svg>
    `;
}

// Get currently visible persons based on checkboxes
function getVisibleSiblings() {
    const visible = [];
    Object.keys(familyTravelsData.persons).forEach(id => {
        const el = document.getElementById(`toggle-${id}`);
        if (el && el.checked) visible.push(id);
    });
    return visible;
}

// Render all markers
function renderMarkers() {
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];

    if (!showPins) return;

    const visibleSiblings = getVisibleSiblings();
    const allPersonIds = Object.keys(familyTravelsData.persons);

    familyTravelsData.locations.forEach(location => {
        const visibleVisitors = location.visitors.filter(v => visibleSiblings.includes(v));
        if (visibleVisitors.length === 0) return;
        if (currentFilter === 'shared' && visibleVisitors.length < 2) return;

        const combinedSVG = createCombinedLollipopSVG(visibleVisitors);
        const totalPersons = allPersonIds.length;
        const isRainbowPin = visibleVisitors.length === totalPersons;
        const iconSize = isRainbowPin ? [60, 50] : [50, 40];
        const iconAnchor = isRainbowPin ? [30, 45] : [25, 35];
        const popupAnchor = isRainbowPin ? [0, -45] : [0, -35];

        const icon = L.divIcon({
            className: 'pin-marker-group',
            html: combinedSVG,
            iconSize: iconSize,
            iconAnchor: iconAnchor,
            popupAnchor: popupAnchor
        });

        const marker = L.marker([location.lat, location.lng], { icon: icon });
        const popupContent = createPopupContent(location, visibleVisitors);
        marker.bindPopup(popupContent);
        marker.addTo(map);
        markers.push(marker);
    });
}

// Create popup content — now includes "not visited by" info
function createPopupContent(location, visitors) {
    const allPersonIds = Object.keys(familyTravelsData.persons);
    const visitorTags = visitors.map(v => {
        return `<span class="popup-visitor ${v}">${familyTravelsData.persons[v]}</span>`;
    }).join('');

    const notVisited = allPersonIds.filter(id => !location.visitors.includes(id));
    const notVisitedText = notVisited.length > 0 && notVisited.length < allPersonIds.length
        ? `<div class="popup-not-visited">Not yet: ${notVisited.map(v => familyTravelsData.persons[v]).join(', ')}</div>`
        : '';

    return `
        <div class="popup-location-name">${location.name}</div>
        <div class="popup-visitors">
            <strong>Visited by:</strong><br>
            ${visitorTags}
        </div>
        ${notVisitedText}
    `;
}

// Update statistics — including per-person counts
function updateStats() {
    const visibleSiblings = getVisibleSiblings();

    const visibleLocations = familyTravelsData.locations.filter(loc => {
        const visibleVisitors = loc.visitors.filter(v => visibleSiblings.includes(v));
        return visibleVisitors.length > 0;
    });

    const totalLocations = visibleLocations.length;
    const sharedLocations = visibleLocations.filter(loc => {
        const visibleVisitors = loc.visitors.filter(v => visibleSiblings.includes(v));
        return visibleVisitors.length >= 2;
    }).length;

    const overlapPercent = totalLocations > 0
        ? Math.round((sharedLocations / totalLocations) * 100)
        : 0;

    document.getElementById('total-locations').textContent = totalLocations;
    document.getElementById('shared-locations').textContent = sharedLocations;
    document.getElementById('overlap-percent').textContent = overlapPercent + '%';

    // Per-person stats
    const personStatsEl = document.getElementById('person-stats-panel');
    if (personStatsEl) {
        const personIds = Object.keys(familyTravelsData.persons);
        personStatsEl.innerHTML = personIds.map(id => {
            const name = familyTravelsData.persons[id];
            const color = getSiblingColor(id);
            const count = familyTravelsData.locations.filter(loc => loc.visitors.includes(id)).length;
            const isVisible = visibleSiblings.includes(id);
            return `
                <div class="person-stat" style="opacity: ${isVisible ? 1 : 0.4}">
                    <span class="person-stat-dot" style="background-color: ${color}"></span>
                    <span class="person-stat-name">${name}:</span>
                    <span class="person-stat-count">${count}</span>
                </div>
            `;
        }).join('');
    }
}

// Setup event listeners
function setupEventListeners() {
    Object.keys(familyTravelsData.persons).forEach(person => {
        document.getElementById(`toggle-${person}`).addEventListener('change', () => {
            refreshMap();
        });
    });

    const showAllBtn = document.getElementById('show-all');
    const showSharedBtn = document.getElementById('show-shared');

    showAllBtn.addEventListener('click', () => {
        currentFilter = 'all';
        showAllBtn.classList.add('active');
        showAllBtn.setAttribute('aria-pressed', 'true');
        showSharedBtn.classList.remove('active');
        showSharedBtn.setAttribute('aria-pressed', 'false');
        refreshMap();
    });

    showSharedBtn.addEventListener('click', () => {
        currentFilter = 'shared';
        showSharedBtn.classList.add('active');
        showSharedBtn.setAttribute('aria-pressed', 'true');
        showAllBtn.classList.remove('active');
        showAllBtn.setAttribute('aria-pressed', 'false');
        refreshMap();
    });

    document.getElementById('toggle-pins').addEventListener('click', (e) => {
        showPins = !showPins;
        e.target.textContent = showPins ? 'Hide Pins' : 'Show Pins';
        e.target.setAttribute('aria-pressed', !showPins);
        renderMarkers();
    });

    document.querySelectorAll('input[name="map-mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            mapMode = e.target.value;
            refreshMap();
        });
    });

    // Fog of War radius slider
    const fogSlider = document.getElementById('fog-radius-slider');
    const fogRadiusValue = document.getElementById('fog-radius-value');
    if (fogSlider) {
        fogSlider.addEventListener('input', function () {
            fogRadiusValue.textContent = this.value;
            if (mapMode === 'fog' && fogOverlay) {
                fogOverlay.setRadius(parseInt(this.value));
            }
        });
    }
}

// Location search functionality
function setupSearch() {
    const input = document.getElementById('search-input');
    const resultsContainer = document.getElementById('search-results');
    if (!input || !resultsContainer) return;

    let debounceTimer;
    input.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            const query = input.value.trim().toLowerCase();
            if (query.length < 2) {
                resultsContainer.classList.remove('visible');
                resultsContainer.innerHTML = '';
                return;
            }

            const matches = familyTravelsData.locations
                .filter(loc => loc.name.toLowerCase().includes(query) || loc.country.toLowerCase().includes(query))
                .slice(0, 15);

            if (matches.length === 0) {
                resultsContainer.classList.remove('visible');
                resultsContainer.innerHTML = '';
                return;
            }

            resultsContainer.innerHTML = matches.map((loc, i) => {
                const dots = loc.visitors.map(v =>
                    `<span class="search-result-dot" style="background-color:${getSiblingColor(v)}" title="${familyTravelsData.persons[v]}"></span>`
                ).join('');
                return `
                    <div class="search-result-item" role="option" tabindex="0" data-index="${i}" data-lat="${loc.lat}" data-lng="${loc.lng}">
                        <div>
                            <span class="search-result-name">${loc.name}</span>
                            <span class="search-result-country"> — ${loc.country}</span>
                        </div>
                        <div class="search-result-visitors">${dots}</div>
                    </div>
                `;
            }).join('');
            resultsContainer.classList.add('visible');

            // Attach click handlers
            resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
                const handler = () => {
                    const lat = parseFloat(item.dataset.lat);
                    const lng = parseFloat(item.dataset.lng);
                    map.setView([lat, lng], 10);
                    // Open the popup for the matching marker
                    markers.forEach(m => {
                        const pos = m.getLatLng();
                        if (Math.abs(pos.lat - lat) < 0.001 && Math.abs(pos.lng - lng) < 0.001) {
                            m.openPopup();
                        }
                    });
                    resultsContainer.classList.remove('visible');
                    input.value = '';
                };
                item.addEventListener('click', handler);
                item.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') handler();
                });
            });
        }, 200);
    });

    // Close search results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.location-search')) {
            resultsContainer.classList.remove('visible');
        }
    });
}

// --- Highway data for fog of war ---
let fogHighwayData = null;
let fogInterstateData = null;

async function loadHighwayDataForFog() {
    if (fogHighwayData && fogInterstateData) return;
    try {
        const [hwResp, intResp] = await Promise.all([
            fetch('data/highways.json'),
            fetch('data/interstateHighways.json')
        ]);
        fogHighwayData = await hwResp.json();
        fogInterstateData = await intResp.json();
    } catch (e) {
        console.error('Error loading highway data for fog:', e);
    }
}

function getDrivenSegmentsForPersons(personIds) {
    const segments = [];
    const collectFrom = (routes) => {
        if (!routes) return;
        routes.forEach(route => {
            if (!route.routeSegments) return;
            route.routeSegments.forEach(seg => {
                if (!seg.waypoints || seg.waypoints.length < 2) return;
                // Check drivenBy array first, fall back to legacy 'driven' for person1
                let isDriven = false;
                if (seg.drivenBy && Array.isArray(seg.drivenBy)) {
                    isDriven = personIds.some(p => seg.drivenBy.includes(p));
                }
                if (isDriven) segments.push(seg.waypoints);
            });
        });
    };
    if (fogInterstateData) collectFrom(fogInterstateData.interstates);
    if (fogHighwayData) collectFrom(fogHighwayData.highways);
    return segments;
}

// --- Fog of War ---

function getFogPins() {
    const visibleSiblings = getVisibleSiblings();
    const pins = [];
    const pinSet = new Set();
    familyTravelsData.locations.forEach(loc => {
        const visibleVisitors = loc.visitors.filter(v => visibleSiblings.includes(v));
        if (visibleVisitors.length === 0) return;
        if (currentFilter === 'shared' && visibleVisitors.length < 2) return;
        const key = `${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`;
        if (!pinSet.has(key)) {
            pinSet.add(key);
            pins.push({ lat: loc.lat, lng: loc.lng, name: loc.name });
        }
    });
    return pins;
}

function createFamilyFogOverlay(radiusKm) {
    removeFamilyFogOverlay();

    const visiblePersons = getVisibleSiblings();
    const drivenSegments = getDrivenSegmentsForPersons(visiblePersons);

    const FogLayer = L.Layer.extend({
        onAdd: function (m) {
            this._map = m;
            const pane = m.getPane('overlayPane');
            this._container = L.DomUtil.create('div', 'fog-of-war-container', pane);
            this._container.style.pointerEvents = 'none';
            this._svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            this._svg.setAttribute('class', 'fog-of-war-svg');
            this._container.appendChild(this._svg);
            m.on('moveend zoomend resize', this._update, this);
            this._radiusKm = radiusKm;
            this._drivenSegments = drivenSegments;
            this._update();
        },
        onRemove: function (m) {
            m.off('moveend zoomend resize', this._update, this);
            if (this._container && this._container.parentNode) {
                this._container.parentNode.removeChild(this._container);
            }
        },
        setRadius: function (km) {
            this._radiusKm = km;
            this._update();
        },
        refreshPins: function () {
            this._drivenSegments = getDrivenSegmentsForPersons(getVisibleSiblings());
            this._update();
        },
        _update: function () {
            if (!this._map) return;
            const m = this._map;
            const size = m.getSize();
            const pad = Math.max(size.x, size.y) * 2;
            const topLeft = m.containerPointToLayerPoint([-pad, -pad]);
            const w = size.x + pad * 2;
            const h = size.y + pad * 2;

            const svg = this._svg;
            svg.setAttribute('width', w);
            svg.setAttribute('height', h);
            svg.style.width = w + 'px';
            svg.style.height = h + 'px';
            L.DomUtil.setPosition(this._container, topLeft);

            const fogPins = getFogPins();
            let cutouts = '';
            let maxR = 0;
            fogPins.forEach(pin => {
                const pt = m.latLngToLayerPoint([pin.lat, pin.lng]);
                const cx = pt.x - topLeft.x;
                const cy = pt.y - topLeft.y;
                const dest = L.latLng(pin.lat, pin.lng);
                const bearing = dest.toBounds(this._radiusKm * 2000);
                const east = L.latLng(pin.lat, bearing.getEast());
                const ptEdge = m.latLngToLayerPoint(east);
                const r = Math.abs(ptEdge.x - pt.x);
                if (r > maxR) maxR = r;
                cutouts += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="black"/>`;
            });

            // Draw driven highway corridors as thick paths in the mask
            const hwRadiusKm = Math.max(this._radiusKm * 0.5, 30);
            (this._drivenSegments || []).forEach(waypoints => {
                let d = '';
                waypoints.forEach((wp, i) => {
                    const pt = m.latLngToLayerPoint([wp[0], wp[1]]);
                    const px = pt.x - topLeft.x;
                    const py = pt.y - topLeft.y;
                    d += (i === 0 ? `M${px},${py}` : ` L${px},${py}`);
                });
                const midWp = waypoints[Math.floor(waypoints.length / 2)];
                const midLatLng = L.latLng(midWp[0], midWp[1]);
                const bounds = midLatLng.toBounds(hwRadiusKm * 2000);
                const midPt = m.latLngToLayerPoint(midLatLng);
                const eastPt = m.latLngToLayerPoint(L.latLng(midWp[0], bounds.getEast()));
                const strokeW = Math.abs(eastPt.x - midPt.x) * 2;
                cutouts += `<path d="${d}" fill="none" stroke="black" stroke-width="${strokeW}" stroke-linecap="round" stroke-linejoin="round"/>`;
            });

            const blurSigma = Math.max(2, Math.min(maxR * 0.08, 20));

            svg.innerHTML = `
                <defs>
                    <filter id="ft-mask-blur">
                        <feGaussianBlur stdDeviation="${blurSigma}"/>
                    </filter>
                    <mask id="ft-fog-mask">
                        <g filter="url(#ft-mask-blur)">
                            <rect x="0" y="0" width="${w}" height="${h}" fill="white"/>
                            ${cutouts}
                        </g>
                    </mask>
                    <filter id="ft-fog-smoke" x="-20%" y="-20%" width="140%" height="140%">
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
                <g mask="url(#ft-fog-mask)">
                    <rect x="0" y="0" width="${w}" height="${h}"
                          fill="rgba(15,15,18,0.92)" filter="url(#ft-fog-smoke)"/>
                    <rect x="0" y="0" width="${w}" height="${h}"
                          fill="rgba(140,145,155,0.08)" filter="url(#ft-fog-smoke)"
                          style="mix-blend-mode: screen;"/>
                </g>
            `;
        }
    });

    fogOverlay = new FogLayer();
    fogOverlay.addTo(map);
}

function removeFamilyFogOverlay() {
    if (fogOverlay) {
        fogOverlay.remove();
        fogOverlay = null;
    }
}

function hideFamilyMarkers() {
    markers.forEach(m => map.removeLayer(m));
    fogMarkerCache = [...markers];
    markers = [];
}

function restoreFamilyMarkers() {
    fogMarkerCache.forEach(m => m.addTo(map));
    markers = [...fogMarkerCache];
    fogMarkerCache = [];
}

async function enableFamilyFogMode(radiusKm) {
    if (voronoiLayer) { map.removeLayer(voronoiLayer); voronoiLayer = null; }
    clearProximityCircles();
    if (countryLayer) { countryLayer.setStyle({ fillOpacity: 0, opacity: 0.1, weight: 0.5 }); }
    hideFamilyMarkers();
    await loadHighwayDataForFog();
    createFamilyFogOverlay(radiusKm);
}

function disableFamilyFogMode() {
    removeFamilyFogOverlay();
    restoreFamilyMarkers();
}

// Refresh the entire map based on current settings
async function refreshMap() {
    const fogRadiusControl = document.getElementById('fog-radius-control');

    if (mapMode === 'fog') {
        if (fogRadiusControl) fogRadiusControl.style.display = 'flex';
        const radiusKm = parseInt(document.getElementById('fog-radius-slider').value);
        await enableFamilyFogMode(radiusKm);
    } else {
        if (fogRadiusControl) fogRadiusControl.style.display = 'none';
        disableFamilyFogMode();

        if (mapMode === 'country') {
            if (voronoiLayer) { map.removeLayer(voronoiLayer); voronoiLayer = null; }
            if (countryLayer) { countryLayer.setStyle(feature => styleCountry(feature)); }
            clearProximityCircles();
        } else if (mapMode === 'proximity') {
            if (voronoiLayer) { map.removeLayer(voronoiLayer); voronoiLayer = null; }
            if (countryLayer) { countryLayer.setStyle(feature => styleCountry(feature)); }
            applyProximityColoring();
        } else if (mapMode === 'radius') {
            applyRadiusColoring();
        }
        renderMarkers();
    }
    updateStats();
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initMap);

// Load and render countries with visitor coloring
// Using 110m resolution for faster loading (was 50m)
async function loadCountries() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson');
        const geojson = await response.json();
        landGeoJSON = geojson;

        countryLayer = L.geoJSON(geojson, {
            style: feature => styleCountry(feature),
            onEachFeature: (feature, layer) => {
                const countryName = feature.properties.ADMIN;
                const visitors = getCountryVisitors(countryName);

                if (visitors.length > 0) {
                    const visibleVisitors = visitors.filter(v => getVisibleSiblings().includes(v));
                    const names = visibleVisitors.map(v => familyTravelsData.persons[v]).join(', ');
                    layer.bindPopup(`
                        <div class="popup-location-name">${countryName}</div>
                        <div class="popup-visitors">
                            <strong>Visited by:</strong><br>
                            ${names || 'None (filtered out)'}
                        </div>
                    `);
                }
            }
        }).addTo(map);
    } catch (error) {
        console.error('Error loading countries:', error);
    }
}

// Get visitors for a country
function getCountryVisitors(countryName) {
    const visitors = new Set();
    const normalizedName = normalizeCountryName(countryName);

    familyTravelsData.locations.forEach(location => {
        const locationCountry = normalizeCountryName(location.country);
        if (locationCountry === normalizedName) {
            location.visitors.forEach(v => visitors.add(v));
        }
    });

    return Array.from(visitors);
}

// Normalize country names for matching between GeoJSON and our data
function normalizeCountryName(name) {
    const mappings = {
        'United States of America': 'United States',
        'USA': 'United States',
        'United Kingdom': 'United Kingdom',
        'UK': 'United Kingdom'
    };
    return mappings[name] || name;
}

// Style a country based on visitors — uses lazy pattern creation
function styleCountry(feature) {
    const countryName = feature.properties.ADMIN;
    const allVisitors = getCountryVisitors(countryName);
    const visibleSiblings = getVisibleSiblings();
    const visibleVisitors = allVisitors.filter(v => visibleSiblings.includes(v));

    if (visibleVisitors.length === 0) {
        return { fillColor: '#e0e0e0', weight: 1, opacity: 1, color: 'white', fillOpacity: 0.2 };
    } else if (visibleVisitors.length === 1) {
        return { fillColor: getSiblingColor(visibleVisitors[0]), weight: 1, opacity: 1, color: 'white', fillOpacity: 0.3 };
    } else {
        const patternId = ensureStripePattern(visibleVisitors);
        return { fillColor: `url(#${patternId})`, weight: 1, opacity: 1, color: 'white', fillOpacity: 0.3 };
    }
}

// Clear proximity circles
function clearProximityCircles() {
    proximityCircles.forEach(circle => map.removeLayer(circle));
    proximityCircles = [];
}

// Apply proximity-based coloring
function applyProximityColoring() {
    clearProximityCircles();

    const visibleSiblings = getVisibleSiblings();

    const visibleLocations = familyTravelsData.locations.filter(loc => {
        const visibleVisitors = loc.visitors.filter(v => visibleSiblings.includes(v));
        if (currentFilter === 'shared') return visibleVisitors.length >= 2;
        return visibleVisitors.length > 0;
    });

    if (countryLayer) {
        countryLayer.setStyle(feature => {
            const countryCenter = getCountryCenter(feature);
            if (!countryCenter) {
                return { fillColor: '#e0e0e0', weight: 1, opacity: 1, color: 'white', fillOpacity: 0.2 };
            }

            let closestLocation = null;
            let minDistance = Infinity;
            visibleLocations.forEach(loc => {
                const distance = calculateDistance(countryCenter.lat, countryCenter.lng, loc.lat, loc.lng);
                if (distance < minDistance) { minDistance = distance; closestLocation = loc; }
            });

            if (!closestLocation) {
                return { fillColor: '#e0e0e0', weight: 1, opacity: 1, color: 'white', fillOpacity: 0.2 };
            }

            const visibleVisitors = closestLocation.visitors.filter(v => visibleSiblings.includes(v));
            if (visibleVisitors.length === 1) {
                return { fillColor: getSiblingColor(visibleVisitors[0]), weight: 1, opacity: 1, color: 'white', fillOpacity: 0.3 };
            } else {
                const patternId = ensureStripePattern(visibleVisitors);
                return { fillColor: `url(#${patternId})`, weight: 1, opacity: 1, color: 'white', fillOpacity: 0.3 };
            }
        });
    }

    visibleLocations.forEach(loc => {
        const visibleVisitors = loc.visitors.filter(v => visibleSiblings.includes(v));
        if (visibleVisitors.length >= 2) {
            const circle = L.circle([loc.lat, loc.lng], {
                radius: 160934,
                fillColor: getSiblingColor(visibleVisitors[0]),
                fillOpacity: 0.4,
                color: 'white',
                weight: 2,
                className: 'proximity-circle'
            });

            if (visibleVisitors.length > 1) {
                visibleVisitors.slice(1).forEach(visitor => {
                    const overlayCircle = L.circle([loc.lat, loc.lng], {
                        radius: 160934,
                        fillColor: getSiblingColor(visitor),
                        fillOpacity: 0.2,
                        color: 'transparent',
                        weight: 0,
                        className: 'proximity-circle-overlay'
                    });
                    overlayCircle.addTo(map);
                    proximityCircles.push(overlayCircle);
                });
            }

            circle.bindPopup(`
                <div class="popup-location-name">${loc.name}</div>
                <div class="popup-visitors">
                    <strong>100-mile radius</strong><br>
                    Shared by: ${visibleVisitors.map(v => familyTravelsData.persons[v]).join(', ')}
                </div>
            `);
            circle.addTo(map);
            proximityCircles.push(circle);
        }
    });
}

// Geo utility functions

function getCountryCenter(feature) {
    if (!feature.geometry) return null;
    if (feature.geometry.type === 'Polygon') {
        return calculateCentroid(feature.geometry.coordinates[0]);
    } else if (feature.geometry.type === 'MultiPolygon') {
        let largestPolygon = feature.geometry.coordinates[0][0];
        let maxArea = 0;
        feature.geometry.coordinates.forEach(polygon => {
            const area = calculatePolygonArea(polygon[0]);
            if (area > maxArea) { maxArea = area; largestPolygon = polygon[0]; }
        });
        return calculateCentroid(largestPolygon);
    }
    return null;
}

function calculateCentroid(coords) {
    let latSum = 0, lngSum = 0;
    const count = coords.length;
    coords.forEach(coord => { lngSum += coord[0]; latSum += coord[1]; });
    return { lat: latSum / count, lng: lngSum / count };
}

function calculatePolygonArea(coords) {
    let area = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        area += coords[i][0] * coords[i + 1][1];
        area -= coords[i + 1][0] * coords[i][1];
    }
    return Math.abs(area / 2);
}

function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(degrees) {
    return degrees * (Math.PI / 180);
}

// Style country by radius (checking multiple points within the country)
function styleCountryByRadius(feature, visibleLocations, visibleSiblings) {
    if (!feature.geometry || visibleLocations.length === 0) {
        return { fillColor: '#e0e0e0', weight: 1, opacity: 1, color: 'white', fillOpacity: 0.2 };
    }

    const samplePoints = getSamplePointsFromGeometry(feature.geometry);
    if (samplePoints.length === 0) {
        return { fillColor: '#e0e0e0', weight: 1, opacity: 1, color: 'white', fillOpacity: 0.2 };
    }

    const closestLocations = samplePoints.map(point => {
        let closestLoc = null, minDistance = Infinity;
        visibleLocations.forEach(loc => {
            const distance = calculateDistance(point.lat, point.lng, loc.lat, loc.lng);
            if (distance < minDistance) { minDistance = distance; closestLoc = loc; }
        });
        return closestLoc;
    });

    const locationCounts = {};
    closestLocations.forEach(loc => {
        if (loc) {
            const key = `${loc.lat},${loc.lng}`;
            locationCounts[key] = (locationCounts[key] || 0) + 1;
        }
    });

    let dominantLocation = null, maxCount = 0;
    Object.keys(locationCounts).forEach(key => {
        if (locationCounts[key] > maxCount) {
            maxCount = locationCounts[key];
            const [lat, lng] = key.split(',').map(Number);
            dominantLocation = visibleLocations.find(loc => loc.lat === lat && loc.lng === lng);
        }
    });

    if (!dominantLocation) {
        return { fillColor: '#e0e0e0', weight: 1, opacity: 1, color: 'white', fillOpacity: 0.2 };
    }

    const visibleVisitors = dominantLocation.visitors.filter(v => visibleSiblings.includes(v));
    if (visibleVisitors.length === 1) {
        return { fillColor: getSiblingColor(visibleVisitors[0]), weight: 1, opacity: 1, color: 'white', fillOpacity: 0.35 };
    } else {
        const patternId = ensureStripePattern(visibleVisitors);
        return { fillColor: `url(#${patternId})`, weight: 1, opacity: 1, color: 'white', fillOpacity: 0.35 };
    }
}

function getSamplePointsFromGeometry(geometry) {
    const points = [];
    if (geometry.type === 'Polygon') {
        points.push(...samplePolygon(geometry.coordinates[0]));
    } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(polygon => points.push(...samplePolygon(polygon[0])));
    }
    return points;
}

function samplePolygon(coords) {
    const points = [];
    const centroid = calculateCentroid(coords);
    points.push(centroid);

    const step = Math.max(1, Math.floor(coords.length / 10));
    for (let i = 0; i < coords.length; i += step) {
        points.push({ lat: coords[i][1], lng: coords[i][0] });
    }

    const midStep = Math.max(1, Math.floor(coords.length / 5));
    for (let i = 0; i < coords.length; i += midStep) {
        points.push({ lat: (centroid.lat + coords[i][1]) / 2, lng: (centroid.lng + coords[i][0]) / 2 });
    }
    return points;
}

// Merge additional person1 data sources into familyTravelsData
// This ensures both family-travels and world-map pages show the same pins
async function mergeAdditionalPerson1Data(ftData) {
    const coordKey = (lat, lng) => `${lat.toFixed(4)},${lng.toFixed(4)}`;

    // Build set of existing person1 coords for dedup
    const existingCoords = new Set();
    ftData.locations.forEach(loc => {
        if (loc.visitors.includes('person1')) {
            existingCoords.add(coordKey(loc.lat, loc.lng));
        }
    });

    function addIfNew(lat, lng, name, country) {
        const key = coordKey(lat, lng);
        if (!existingCoords.has(key)) {
            existingCoords.add(key);
            ftData.locations.push({ name, country: country || 'Unknown', lat, lng, visitors: ['person1'] });
        }
    }

    const [worldCities, highPoints, stateHighPoints, nationalParks, skiResorts, sevenWonders, britishIsles, adk46ers, colorado14ers] = await Promise.all([
        fetch('data/worldCities.json').then(r => r.json()),
        fetch('data/worldMountains.json').then(r => r.json()),
        fetch('data/highPoints.json').then(r => r.json()),
        fetch('data/nationalParks.json').then(r => r.json()),
        fetch('data/skiResorts.json').then(r => r.json()),
        fetch('data/sevenWonders.json').then(r => r.json()),
        fetch('data/british-isles-high-five.json').then(r => r.json()),
        fetch('data/adirondack46ers.json').then(r => r.json()),
        fetch('data/colorado14ers.json').then(r => r.json())
    ]);

    // World cities (all are visited)
    worldCities.visitedCities.forEach(c => addIfNew(c.latitude, c.longitude, c.name, c.country));

    // World high points (all are visited/climbed)
    highPoints.countryHighPoints.forEach(hp => addIfNew(hp.latitude, hp.longitude, hp.name, hp.country));

    // US state high points (visited only)
    stateHighPoints.filter(hp => hp.visited).forEach(hp => addIfNew(hp.coords[1], hp.coords[0], hp.name, 'United States'));

    // National parks (visited only, with coord overrides for territories)
    const parkCoordOverrides = {
        'American Samoa': { lat: -14.2710, lng: -170.1322 },
        'Virgin Islands': { lat: 18.3358, lng: -64.8963 }
    };
    nationalParks.filter(np => np.visited).forEach(np => {
        const override = parkCoordOverrides[np.name];
        if (override) {
            addIfNew(override.lat, override.lng, np.name + ' NP', 'United States');
        } else {
            addIfNew(np.coords[1], np.coords[0], np.name + ' NP', 'United States');
        }
    });

    // Ski resorts (visited only)
    skiResorts.filter(sr => sr.visited).forEach(sr => addIfNew(sr.coords[1], sr.coords[0], sr.name, sr.country || 'United States'));

    // Seven Wonders (all three arrays, visited only)
    ['sevenWonders', 'sevenNaturalWonders', 'sevenNaturalWondersNominees'].forEach(key => {
        (sevenWonders[key] || []).filter(w => w.visited).forEach(w => {
            addIfNew(w.coordinates.lat, w.coordinates.lng, w.name, w.country || w.primaryCountry || 'Unknown');
        });
    });

    // British Isles High Five (climbed only)
    britishIsles.filter(p => p.climbed).forEach(p => addIfNew(p.coords[1], p.coords[0], p.name, p.country));

    // ADK 46ers (climbed only)
    adk46ers.filter(p => p.climbed).forEach(p => addIfNew(p.coords[1], p.coords[0], p.name, 'United States'));

    // Colorado 14ers (climbed only)
    colorado14ers.filter(p => p.climbed).forEach(p => addIfNew(p.coords[1], p.coords[0], p.name, 'United States'));
}

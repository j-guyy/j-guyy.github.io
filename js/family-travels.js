// Family Travels Map JavaScript

let map;
let markers = [];
let currentFilter = 'all';
let familyTravelsData = null;
let countryLayer = null;

// Initialize the map
async function initMap() {
    // Load the data
    try {
        const response = await fetch('data/familyTravels.json');
        familyTravelsData = await response.json();
    } catch (error) {
        console.error('Error loading family travels data:', error);
        return;
    }

    map = L.map('family-map').setView([20, 0], 2); // World view

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
    }).addTo(map);

    // Load and render countries
    await loadCountries();

    renderMarkers();
    updateStats();
    setupEventListeners();
}

// Create combined SVG for all lollipops at a location
function createCombinedLollipopSVG(visitors) {
    const total = visitors.length;
    let lollipops = '';

    visitors.forEach((visitor, index) => {
        const color = getSiblingColor(visitor);
        let lineX1 = 25, lineY1 = 35;
        let lineX2 = 25, lineY2 = 10;

        if (total === 1) {
            lineX2 = 25;
            lineY2 = 10;
        } else if (total === 2) {
            if (index === 0) {
                lineX2 = 19;
                lineY2 = 10;
            } else {
                lineX2 = 31;
                lineY2 = 10;
            }
        } else if (total === 3) {
            if (index === 0) {
                lineX2 = 13;
                lineY2 = 10;
            } else if (index === 1) {
                lineX2 = 25;
                lineY2 = 10;
            } else {
                lineX2 = 37;
                lineY2 = 10;
            }
        }

        // Use rect for vertical lines to ensure consistent width
        if (Math.abs(lineX2 - lineX1) < 0.5) {
            const rectWidth = 3;
            const rectHeight = lineY1 - lineY2;
            lollipops += `
                <rect x="${lineX1 - rectWidth / 2}" y="${lineY2}" 
                      width="${rectWidth}" height="${rectHeight}" 
                      fill="${color}" rx="1.5"/>
            `;
        } else {
            lollipops += `
                <line x1="${lineX1}" y1="${lineY1}" x2="${lineX2}" y2="${lineY2}" 
                      stroke="${color}" stroke-width="3" stroke-linecap="round"/>
            `;
        }

        lollipops += `
            <circle cx="${lineX2}" cy="${lineY2}" r="6" 
                    fill="${color}" 
                    stroke="rgba(255,255,255,0.9)" 
                    stroke-width="1.5"/>
        `;
    });

    return `
        <svg width="50" height="40" viewBox="0 0 50 40" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="1"/>
                    <feOffset dx="0" dy="1" result="offsetblur"/>
                    <feComponentTransfer>
                        <feFuncA type="linear" slope="0.3"/>
                    </feComponentTransfer>
                    <feMerge>
                        <feMergeNode/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
            <g filter="url(#shadow)">
                ${lollipops}
            </g>
        </svg>
    `;
}

// Get color for sibling
function getSiblingColor(siblingId) {
    const colors = {
        sibling1: '#9b59b6',
        sibling2: '#27ae60',
        sibling3: '#f1c40f'
    };
    return colors[siblingId] || '#888888';
}

// Calculate pin offset for multiple pins at same location
function calculatePinOffset(index, total) {
    // All pins anchor at the same point - no offset needed
    return [0, 0];
}

// Render all markers
function renderMarkers() {
    // Clear existing markers
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];

    const visibleSiblings = getVisibleSiblings();

    familyTravelsData.locations.forEach(location => {
        // Filter visitors based on visible siblings
        const visibleVisitors = location.visitors.filter(v => visibleSiblings.includes(v));

        // Skip if no visible visitors or if filtering for shared only
        if (visibleVisitors.length === 0) return;
        if (currentFilter === 'shared' && visibleVisitors.length < 2) return;

        // Create a single combined icon for all visitors at this location
        const combinedSVG = createCombinedLollipopSVG(visibleVisitors);

        const icon = L.divIcon({
            className: 'pin-marker-group',
            html: combinedSVG,
            iconSize: [50, 40],
            iconAnchor: [25, 35],
            popupAnchor: [0, -35]
        });

        const marker = L.marker([location.lat, location.lng], { icon: icon });

        const popupContent = createPopupContent(location, visibleVisitors);
        marker.bindPopup(popupContent);

        marker.addTo(map);
        markers.push(marker);
    });
}

// Create popup content
function createPopupContent(location, visitors) {
    const siblingNames = visitors.map(v => familyTravelsData.siblings[v]);
    const visitorTags = visitors.map(v => {
        const name = familyTravelsData.siblings[v];
        return `<span class="popup-visitor ${v}">${name}</span>`;
    }).join('');

    return `
        <div class="popup-location-name">${location.name}</div>
        <div class="popup-visitors">
            <strong>Visited by:</strong><br>
            ${visitorTags}
        </div>
    `;
}

// Get currently visible siblings based on checkboxes
function getVisibleSiblings() {
    const visible = [];
    if (document.getElementById('toggle-sibling1').checked) visible.push('sibling1');
    if (document.getElementById('toggle-sibling2').checked) visible.push('sibling2');
    if (document.getElementById('toggle-sibling3').checked) visible.push('sibling3');
    return visible;
}

// Update statistics
function updateStats() {
    const visibleSiblings = getVisibleSiblings();

    // Filter locations based on visible siblings
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
}

// Setup event listeners
function setupEventListeners() {
    // Toggle checkboxes
    ['sibling1', 'sibling2', 'sibling3'].forEach(sibling => {
        document.getElementById(`toggle-${sibling}`).addEventListener('change', () => {
            refreshCountries();
            renderMarkers();
            updateStats();
        });
    });

    // Show all button
    document.getElementById('show-all').addEventListener('click', () => {
        currentFilter = 'all';
        refreshCountries();
        renderMarkers();
        updateStats();
    });

    // Show shared only button
    document.getElementById('show-shared').addEventListener('click', () => {
        currentFilter = 'shared';
        refreshCountries();
        renderMarkers();
        updateStats();
    });
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initMap);

// Load and render countries with visitor coloring
async function loadCountries() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson');
        const geojson = await response.json();

        // Create SVG patterns for striped fills
        createStripePatterns();

        countryLayer = L.geoJSON(geojson, {
            style: feature => styleCountry(feature),
            onEachFeature: (feature, layer) => {
                const countryName = feature.properties.ADMIN;
                const visitors = getCountryVisitors(countryName);

                if (visitors.length > 0) {
                    const visibleVisitors = visitors.filter(v => getVisibleSiblings().includes(v));
                    const names = visibleVisitors.map(v => familyTravelsData.siblings[v]).join(', ');
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

// Create SVG stripe patterns for country fills
function createStripePatterns() {
    // Create a hidden SVG element to hold pattern definitions
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.position = 'absolute';
    svg.style.width = '0';
    svg.style.height = '0';

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // Create patterns for all possible sibling combinations
    const siblings = ['sibling1', 'sibling2', 'sibling3'];
    const combinations = [
        ['sibling1'],
        ['sibling2'],
        ['sibling3'],
        ['sibling1', 'sibling2'],
        ['sibling1', 'sibling3'],
        ['sibling2', 'sibling3'],
        ['sibling1', 'sibling2', 'sibling3']
    ];

    combinations.forEach(combo => {
        const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
        const patternId = `stripe-${combo.join('-')}`;
        pattern.setAttribute('id', patternId);
        pattern.setAttribute('patternUnits', 'userSpaceOnUse');
        pattern.setAttribute('width', combo.length * 10);
        pattern.setAttribute('height', combo.length * 10);
        pattern.setAttribute('patternTransform', 'rotate(45)');

        combo.forEach((sibling, index) => {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', index * 10);
            rect.setAttribute('y', '0');
            rect.setAttribute('width', '10');
            rect.setAttribute('height', combo.length * 10);
            rect.setAttribute('fill', getSiblingColor(sibling));
            pattern.appendChild(rect);
        });

        defs.appendChild(pattern);
    });

    svg.appendChild(defs);
    document.body.appendChild(svg);
}

// Get visitors for a country
function getCountryVisitors(countryName) {
    const visitors = new Set();

    // Normalize country name for matching
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

// Style a country based on visitors
function styleCountry(feature) {
    const countryName = feature.properties.ADMIN;
    const allVisitors = getCountryVisitors(countryName);
    const visibleSiblings = getVisibleSiblings();
    const visibleVisitors = allVisitors.filter(v => visibleSiblings.includes(v));

    if (visibleVisitors.length === 0) {
        // Not visited or all visitors filtered out
        return {
            fillColor: '#e0e0e0',
            weight: 1,
            opacity: 1,
            color: 'white',
            fillOpacity: 0.2
        };
    } else if (visibleVisitors.length === 1) {
        // Single visitor - solid color
        return {
            fillColor: getSiblingColor(visibleVisitors[0]),
            weight: 1,
            opacity: 1,
            color: 'white',
            fillOpacity: 0.3
        };
    } else {
        // Multiple visitors - use striped pattern
        const patternId = `stripe-${visibleVisitors.sort().join('-')}`;
        return {
            fillColor: `url(#${patternId})`,
            weight: 1,
            opacity: 1,
            color: 'white',
            fillOpacity: 0.3
        };
    }
}

// Refresh country colors when filters change
function refreshCountries() {
    if (countryLayer) {
        countryLayer.setStyle(feature => styleCountry(feature));
    }
}

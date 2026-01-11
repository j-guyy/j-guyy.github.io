// Family Travels Map JavaScript

let map;
let markers = [];
let currentFilter = 'all';
let familyTravelsData = null;
let countryLayer = null;
let mapMode = 'country'; // 'country' or 'proximity' or 'radius'
let proximityCircles = [];
let voronoiLayer = null;
let landGeoJSON = null;
let showPins = true; // Toggle for showing/hiding pins

// Initialize the map
async function initMap() {
    // Load the data
    try {
        const response = await fetch('data/familyTravels.json');
        familyTravelsData = await response.json();

        // Load metros.json and merge person1's US cities
        const metrosResponse = await fetch('data/metros.json');
        const metrosData = await metrosResponse.json();

        // Add all visited metros to person1's locations
        metrosData.forEach(metro => {
            if (metro.visited) {
                // Check if this location already exists
                const existingLocation = familyTravelsData.locations.find(loc =>
                    loc.name === metro.name && loc.country === 'United States'
                );

                if (existingLocation) {
                    // Add person1 if not already in visitors
                    if (!existingLocation.visitors.includes('person1')) {
                        existingLocation.visitors.push('person1');
                    }
                } else {
                    // Add new location for person1
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
    } catch (error) {
        console.error('Error loading family travels data:', error);
        return;
    }

    map = L.map('family-map', {
        gestureHandling: true,
        fullscreenControl: true
    }).setView([20, 0], 2); // World view

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
    }).addTo(map);

    // Disable gesture handling in fullscreen mode
    map.on('fullscreenchange', () => {
        if (map.isFullscreen()) {
            map.gestureHandling.disable();
        } else {
            map.gestureHandling.enable();
        }
    });

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
        } else if (total === 4) {
            // Four circles in a square pattern
            if (index === 0) {
                lineX2 = 19;
                lineY2 = 7;
            } else if (index === 1) {
                lineX2 = 31;
                lineY2 = 7;
            } else if (index === 2) {
                lineX2 = 19;
                lineY2 = 19;
            } else {
                lineX2 = 31;
                lineY2 = 19;
            }
        } else if (total === 5) {
            // Five circles: four corners + one center
            if (index === 0) {
                lineX2 = 16;
                lineY2 = 7;
            } else if (index === 1) {
                lineX2 = 34;
                lineY2 = 7;
            } else if (index === 2) {
                lineX2 = 16;
                lineY2 = 19;
            } else if (index === 3) {
                lineX2 = 34;
                lineY2 = 19;
            } else {
                lineX2 = 25;
                lineY2 = 13;
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

// Get color for person
function getSiblingColor(personId) {
    const colors = {
        person1: '#9b59b6',
        person2: '#27ae60',
        person3: '#f1c40f',
        person4: '#e91e63',
        person5: '#2196F3'
    };
    return colors[personId] || '#888888';
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

    // If pins are hidden, don't render any markers
    if (!showPins) return;

    const visibleSiblings = getVisibleSiblings();

    familyTravelsData.locations.forEach(location => {
        // Filter visitors based on visible persons
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
    const personNames = visitors.map(v => familyTravelsData.persons[v]);
    const visitorTags = visitors.map(v => {
        const name = familyTravelsData.persons[v];
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

// Get currently visible persons based on checkboxes
function getVisibleSiblings() {
    const visible = [];
    if (document.getElementById('toggle-person1').checked) visible.push('person1');
    if (document.getElementById('toggle-person2').checked) visible.push('person2');
    if (document.getElementById('toggle-person3').checked) visible.push('person3');
    if (document.getElementById('toggle-person4').checked) visible.push('person4');
    if (document.getElementById('toggle-person5').checked) visible.push('person5');
    return visible;
}

// Update statistics
function updateStats() {
    const visibleSiblings = getVisibleSiblings();

    // Filter locations based on visible persons
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
    ['person1', 'person2', 'person3', 'person4', 'person5'].forEach(person => {
        document.getElementById(`toggle-${person}`).addEventListener('change', () => {
            refreshMap();
        });
    });

    // Show all button
    document.getElementById('show-all').addEventListener('click', () => {
        currentFilter = 'all';
        refreshMap();
    });

    // Show shared only button
    document.getElementById('show-shared').addEventListener('click', () => {
        currentFilter = 'shared';
        refreshMap();
    });

    // Toggle pins button
    document.getElementById('toggle-pins').addEventListener('click', (e) => {
        showPins = !showPins;
        e.target.textContent = showPins ? 'Hide Pins' : 'Show Pins';
        renderMarkers();
    });

    // Map mode toggle
    document.querySelectorAll('input[name="map-mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            mapMode = e.target.value;
            refreshMap();
        });
    });
}

// Refresh the entire map based on current settings
function refreshMap() {
    if (mapMode === 'country') {
        // Remove Voronoi layer if it exists
        if (voronoiLayer) {
            map.removeLayer(voronoiLayer);
            voronoiLayer = null;
        }
        // Restore country layer visibility
        if (countryLayer) {
            countryLayer.setStyle(feature => styleCountry(feature));
        }
        clearProximityCircles();
    } else if (mapMode === 'proximity') {
        // Remove Voronoi layer if it exists
        if (voronoiLayer) {
            map.removeLayer(voronoiLayer);
            voronoiLayer = null;
        }
        // Restore country layer visibility
        if (countryLayer) {
            countryLayer.setStyle(feature => styleCountry(feature));
        }
        applyProximityColoring();
    } else if (mapMode === 'radius') {
        applyRadiusColoring();
    }
    renderMarkers();
    updateStats();
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', initMap);

// Load and render countries with visitor coloring
async function loadCountries() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson');
        const geojson = await response.json();
        landGeoJSON = geojson; // Store for Voronoi calculations

        // Create SVG patterns for striped fills
        createStripePatterns();

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

// Create SVG stripe patterns for country fills
function createStripePatterns() {
    // Create a hidden SVG element to hold pattern definitions
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.style.position = 'absolute';
    svg.style.width = '0';
    svg.style.height = '0';

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    // Create patterns for all possible person combinations
    const persons = ['person1', 'person2', 'person3', 'person4', 'person5'];
    const combinations = [
        ['person1'],
        ['person2'],
        ['person3'],
        ['person4'],
        ['person5'],
        ['person1', 'person2'],
        ['person1', 'person3'],
        ['person1', 'person4'],
        ['person1', 'person5'],
        ['person2', 'person3'],
        ['person2', 'person4'],
        ['person2', 'person5'],
        ['person3', 'person4'],
        ['person3', 'person5'],
        ['person4', 'person5'],
        ['person1', 'person2', 'person3'],
        ['person1', 'person2', 'person4'],
        ['person1', 'person2', 'person5'],
        ['person1', 'person3', 'person4'],
        ['person1', 'person3', 'person5'],
        ['person1', 'person4', 'person5'],
        ['person2', 'person3', 'person4'],
        ['person2', 'person3', 'person5'],
        ['person2', 'person4', 'person5'],
        ['person3', 'person4', 'person5'],
        ['person1', 'person2', 'person3', 'person4'],
        ['person1', 'person2', 'person3', 'person5'],
        ['person1', 'person2', 'person4', 'person5'],
        ['person1', 'person3', 'person4', 'person5'],
        ['person2', 'person3', 'person4', 'person5'],
        ['person1', 'person2', 'person3', 'person4', 'person5']
    ];

    combinations.forEach(combo => {
        const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
        const patternId = `stripe-${combo.join('-')}`;
        pattern.setAttribute('id', patternId);
        pattern.setAttribute('patternUnits', 'userSpaceOnUse');
        pattern.setAttribute('width', combo.length * 10);
        pattern.setAttribute('height', combo.length * 10);
        pattern.setAttribute('patternTransform', 'rotate(45)');

        combo.forEach((person, index) => {
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', index * 10);
            rect.setAttribute('y', '0');
            rect.setAttribute('width', '10');
            rect.setAttribute('height', combo.length * 10);
            rect.setAttribute('fill', getSiblingColor(person));
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

// Clear proximity circles
function clearProximityCircles() {
    proximityCircles.forEach(circle => map.removeLayer(circle));
    proximityCircles = [];
}

// Apply proximity-based coloring
function applyProximityColoring() {
    clearProximityCircles();

    const visibleSiblings = getVisibleSiblings();

    // Get all visible locations
    const visibleLocations = familyTravelsData.locations.filter(loc => {
        const visibleVisitors = loc.visitors.filter(v => visibleSiblings.includes(v));
        if (currentFilter === 'shared') {
            return visibleVisitors.length >= 2;
        }
        return visibleVisitors.length > 0;
    });

    // Color countries based on closest pin
    if (countryLayer) {
        countryLayer.setStyle(feature => {
            const countryCenter = getCountryCenter(feature);
            if (!countryCenter) {
                return {
                    fillColor: '#e0e0e0',
                    weight: 1,
                    opacity: 1,
                    color: 'white',
                    fillOpacity: 0.2
                };
            }

            // Find closest location
            let closestLocation = null;
            let minDistance = Infinity;

            visibleLocations.forEach(loc => {
                const distance = calculateDistance(
                    countryCenter.lat, countryCenter.lng,
                    loc.lat, loc.lng
                );
                if (distance < minDistance) {
                    minDistance = distance;
                    closestLocation = loc;
                }
            });

            if (!closestLocation) {
                return {
                    fillColor: '#e0e0e0',
                    weight: 1,
                    opacity: 1,
                    color: 'white',
                    fillOpacity: 0.2
                };
            }

            const visibleVisitors = closestLocation.visitors.filter(v => visibleSiblings.includes(v));

            if (visibleVisitors.length === 1) {
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
        });
    }

    // Add circles for locations with multiple visitors
    visibleLocations.forEach(loc => {
        const visibleVisitors = loc.visitors.filter(v => visibleSiblings.includes(v));

        if (visibleVisitors.length >= 2) {
            // Create striped pattern for circle
            const patternId = `stripe-${visibleVisitors.sort().join('-')}`;

            // 100 miles = approximately 160934 meters
            const circle = L.circle([loc.lat, loc.lng], {
                radius: 160934, // 100 miles in meters
                fillColor: getSiblingColor(visibleVisitors[0]),
                fillOpacity: 0.4,
                color: 'white',
                weight: 2,
                className: 'proximity-circle'
            });

            // For multiple visitors, we need to create a custom styled circle
            if (visibleVisitors.length > 1) {
                circle.setStyle({
                    fillColor: getSiblingColor(visibleVisitors[0]),
                    fillOpacity: 0.4,
                    color: 'white',
                    weight: 2
                });

                // Add a second circle with different color for striped effect
                visibleVisitors.slice(1).forEach((visitor, index) => {
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

// Get the center point of a country (using centroid)
function getCountryCenter(feature) {
    if (!feature.geometry) return null;

    // For polygons, calculate centroid
    if (feature.geometry.type === 'Polygon') {
        const coords = feature.geometry.coordinates[0];
        return calculateCentroid(coords);
    } else if (feature.geometry.type === 'MultiPolygon') {
        // For multipolygon, use the largest polygon
        let largestPolygon = feature.geometry.coordinates[0][0];
        let maxArea = 0;

        feature.geometry.coordinates.forEach(polygon => {
            const area = calculatePolygonArea(polygon[0]);
            if (area > maxArea) {
                maxArea = area;
                largestPolygon = polygon[0];
            }
        });

        return calculateCentroid(largestPolygon);
    }

    return null;
}

// Calculate centroid of a polygon
function calculateCentroid(coords) {
    let latSum = 0;
    let lngSum = 0;
    let count = coords.length;

    coords.forEach(coord => {
        lngSum += coord[0];
        latSum += coord[1];
    });

    return {
        lat: latSum / count,
        lng: lngSum / count
    };
}

// Calculate approximate area of a polygon (for finding largest in multipolygon)
function calculatePolygonArea(coords) {
    let area = 0;
    for (let i = 0; i < coords.length - 1; i++) {
        area += coords[i][0] * coords[i + 1][1];
        area -= coords[i + 1][0] * coords[i][1];
    }
    return Math.abs(area / 2);
}

// Calculate distance between two points using Haversine formula
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRad(degrees) {
    return degrees * (Math.PI / 180);
}


// Apply radius-based coloring (Voronoi-style)
function applyRadiusColoring() {
    clearProximityCircles();

    const visibleSiblings = getVisibleSiblings();

    // Get all visible locations
    const visibleLocations = familyTravelsData.locations.filter(loc => {
        const visibleVisitors = loc.visitors.filter(v => visibleSiblings.includes(v));
        if (currentFilter === 'shared') {
            return visibleVisitors.length >= 2;
        }
        return visibleVisitors.length > 0;
    });

    // Color countries based on closest pin to each point
    if (countryLayer) {
        countryLayer.setStyle(feature => styleCountryByRadius(feature, visibleLocations, visibleSiblings));
    }

    // Add circles for locations with multiple visitors
    visibleLocations.forEach(loc => {
        const visibleVisitors = loc.visitors.filter(v => visibleSiblings.includes(v));

        if (visibleVisitors.length >= 2) {
            // 100 miles = approximately 160934 meters
            const circle = L.circle([loc.lat, loc.lng], {
                radius: 160934, // 100 miles in meters
                fillColor: getSiblingColor(visibleVisitors[0]),
                fillOpacity: 0.4,
                color: 'white',
                weight: 2,
                className: 'proximity-circle'
            });

            // For multiple visitors, add overlay circles
            if (visibleVisitors.length > 1) {
                circle.setStyle({
                    fillColor: getSiblingColor(visibleVisitors[0]),
                    fillOpacity: 0.4,
                    color: 'white',
                    weight: 2
                });

                visibleVisitors.slice(1).forEach((visitor, index) => {
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

// Style country by radius (checking multiple points within the country)
function styleCountryByRadius(feature, visibleLocations, visibleSiblings) {
    if (!feature.geometry || visibleLocations.length === 0) {
        return {
            fillColor: '#e0e0e0',
            weight: 1,
            opacity: 1,
            color: 'white',
            fillOpacity: 0.2
        };
    }

    // Sample multiple points within the country to determine dominant color
    const samplePoints = getSamplePointsFromGeometry(feature.geometry);

    if (samplePoints.length === 0) {
        return {
            fillColor: '#e0e0e0',
            weight: 1,
            opacity: 1,
            color: 'white',
            fillOpacity: 0.2
        };
    }

    // For each sample point, find the closest location
    const closestLocations = samplePoints.map(point => {
        let closestLoc = null;
        let minDistance = Infinity;

        visibleLocations.forEach(loc => {
            const distance = calculateDistance(
                point.lat, point.lng,
                loc.lat, loc.lng
            );
            if (distance < minDistance) {
                minDistance = distance;
                closestLoc = loc;
            }
        });

        return closestLoc;
    });

    // Count which location is closest most often
    const locationCounts = {};
    closestLocations.forEach(loc => {
        if (loc) {
            const key = `${loc.lat},${loc.lng}`;
            locationCounts[key] = (locationCounts[key] || 0) + 1;
        }
    });

    // Find the most common closest location
    let dominantLocation = null;
    let maxCount = 0;
    Object.keys(locationCounts).forEach(key => {
        if (locationCounts[key] > maxCount) {
            maxCount = locationCounts[key];
            const [lat, lng] = key.split(',').map(Number);
            dominantLocation = visibleLocations.find(loc =>
                loc.lat === lat && loc.lng === lng
            );
        }
    });

    if (!dominantLocation) {
        return {
            fillColor: '#e0e0e0',
            weight: 1,
            opacity: 1,
            color: 'white',
            fillOpacity: 0.2
        };
    }

    const visibleVisitors = dominantLocation.visitors.filter(v => visibleSiblings.includes(v));

    if (visibleVisitors.length === 1) {
        return {
            fillColor: getSiblingColor(visibleVisitors[0]),
            weight: 1,
            opacity: 1,
            color: 'white',
            fillOpacity: 0.35
        };
    } else {
        // Multiple visitors - use striped pattern
        const patternId = `stripe-${visibleVisitors.sort().join('-')}`;
        return {
            fillColor: `url(#${patternId})`,
            weight: 1,
            opacity: 1,
            color: 'white',
            fillOpacity: 0.35
        };
    }
}

// Get sample points from a geometry (for radius coloring)
function getSamplePointsFromGeometry(geometry) {
    const points = [];

    if (geometry.type === 'Polygon') {
        points.push(...samplePolygon(geometry.coordinates[0]));
    } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(polygon => {
            points.push(...samplePolygon(polygon[0]));
        });
    }

    return points;
}

// Sample points from a polygon (get centroid and boundary points)
function samplePolygon(coords) {
    const points = [];

    // Add centroid
    const centroid = calculateCentroid(coords);
    points.push(centroid);

    // Add some boundary points (every 10th point to avoid too many samples)
    const step = Math.max(1, Math.floor(coords.length / 10));
    for (let i = 0; i < coords.length; i += step) {
        points.push({
            lat: coords[i][1],
            lng: coords[i][0]
        });
    }

    // Add midpoints between centroid and boundary
    const midStep = Math.max(1, Math.floor(coords.length / 5));
    for (let i = 0; i < coords.length; i += midStep) {
        points.push({
            lat: (centroid.lat + coords[i][1]) / 2,
            lng: (centroid.lng + coords[i][0]) / 2
        });
    }

    return points;
}

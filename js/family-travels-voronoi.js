// Optimized Voronoi coloring implementation for family travels
// No land filtering for maximum performance
// Only single-visitor locations are used for Voronoi calculation
// Shared locations are ignored

// Apply radius-based coloring (True Voronoi-style using canvas)
function applyRadiusColoring() {
    clearProximityCircles();

    // Remove old Voronoi layer if it exists
    if (voronoiLayer) {
        map.removeLayer(voronoiLayer);
        voronoiLayer = null;
    }

    const visibleSiblings = getVisibleSiblings();

    // Get all visible locations
    const allVisibleLocations = familyTravelsData.locations.filter(loc => {
        const visibleVisitors = loc.visitors.filter(v => visibleSiblings.includes(v));
        if (currentFilter === 'shared') {
            return visibleVisitors.length >= 2;
        }
        return visibleVisitors.length > 0;
    });

    // Filter to only single-visitor locations for Voronoi calculation
    const voronoiLocations = allVisibleLocations.filter(loc => {
        const visibleVisitors = loc.visitors.filter(v => visibleSiblings.includes(v));
        return visibleVisitors.length === 1;
    });

    if (voronoiLocations.length === 0) {
        return;
    }

    // Hide the country layer
    if (countryLayer) {
        countryLayer.setStyle({
            fillOpacity: 0,
            opacity: 0.1,
            weight: 0.5
        });
    }

    // Create a custom canvas layer for Voronoi coloring
    const VoronoiLayer = L.GridLayer.extend({
        createTile: function (coords) {
            const tile = document.createElement('canvas');
            const tileSize = this.getTileSize();
            tile.width = tileSize.x;
            tile.height = tileSize.y;

            const ctx = tile.getContext('2d');

            // Get tile bounds
            const tileBounds = this._tileCoordsToBounds(coords);

            // Fine pixel step for smooth Voronoi boundaries
            const pixelStep = 3;

            for (let x = 0; x < tileSize.x; x += pixelStep) {
                for (let y = 0; y < tileSize.y; y += pixelStep) {
                    // Convert pixel to lat/lng
                    const point = L.point(x, y);
                    const latLng = this._map.unproject(
                        this._map.project(tileBounds.getNorthWest(), coords.z)
                            .add(point),
                        coords.z
                    );

                    // Find closest single-visitor location
                    let closestLoc = null;
                    let minDistance = Infinity;

                    voronoiLocations.forEach(loc => {
                        const distance = calculateDistance(
                            latLng.lat, latLng.lng,
                            loc.lat, loc.lng
                        );
                        if (distance < minDistance) {
                            minDistance = distance;
                            closestLoc = loc;
                        }
                    });

                    if (closestLoc) {
                        const visibleVisitors = closestLoc.visitors.filter(v => visibleSiblings.includes(v));

                        // Get color for this location (should only be one visitor)
                        const color = getSiblingColor(visibleVisitors[0]);

                        // Draw a filled rectangle for this pixel group
                        ctx.fillStyle = color;
                        ctx.globalAlpha = 0.45;
                        ctx.fillRect(x, y, pixelStep, pixelStep);
                    }
                }
            }

            return tile;
        }
    });

    voronoiLayer = new VoronoiLayer({
        opacity: 1,
        zIndex: 400
    });
    voronoiLayer.addTo(map);
}

class PolygonEditor {
    constructor() {
        this.map = null;
        this.mountainRanges = null;
        this.polygons = new Map(); // Store polygons for each range
        this.selectedPolygon = null;
        this.selectedRangeKey = null;
        this.drawnItems = null;
        this.regionColors = {
            'northern': '#4A90E2',
            'central': '#4CAF50',
            'southern': '#FF6B6B'
        };

        this.init();
    }

    async init() {
        await this.loadMountainData();
        this.initializeMap();
        this.setupControls();
        this.loadAllPolygons();
    }

    async loadMountainData() {
        try {
            const response = await fetch('data/mountainRanges.json');
            this.mountainRanges = await response.json();
            this.updateStatus('Mountain ranges data loaded successfully');
        } catch (error) {
            console.error('Error loading mountain ranges:', error);
            this.updateStatus('Error loading mountain ranges data');
        }
    }

    initializeMap() {
        // Initialize map centered on Rocky Mountains
        this.map = L.map('map').setView([44.0, -110.0], 4);

        // Define available tile layers
        this.tileLayers = {
            opentopomap: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)',
                maxZoom: 17
            }),
            arcgis: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles © Esri — Esri, DeLorme, NAVTEQ, TomTom, Intermap, iPC, USGS, FAO, NPS, NRCAN, GeoBase, Kadaster NL, Ordnance Survey, Esri Japan, METI, Esri China (Hong Kong), and the GIS User Community',
                maxZoom: 18
            })
        };

        // Add default layer (OpenTopoMap)
        this.currentLayer = this.tileLayers.opentopomap;
        this.currentLayer.addTo(this.map);

        // Initialize the FeatureGroup to store editable layers
        this.drawnItems = new L.FeatureGroup();
        this.map.addLayer(this.drawnItems);
    }

    loadAllPolygons() {
        if (!this.mountainRanges) return;

        // Clear existing polygons
        this.drawnItems.clearLayers();
        this.polygons.clear();

        // Load all mountain ranges
        Object.entries(this.mountainRanges).forEach(([region, ranges]) => {
            ranges.forEach(range => {
                this.createPolygonForRange(region, range);
            });
        });

        this.updateStatus(`Loaded ${this.polygons.size} mountain ranges. Click any polygon to select and edit it.`);
        this.updateButtons();
    }

    createPolygonForRange(region, range) {
        const key = `${region}:${range.name}`;
        const color = this.regionColors[region] || '#9B59B6';

        let polygon;

        if (range.polygon && range.polygon.length > 0) {
            // Create polygon from existing data
            polygon = L.polygon(range.polygon, {
                color: '#fff',
                fillColor: color,
                weight: 2,
                opacity: 1,
                fillOpacity: 0.6
            });
        } else {
            // Create a small circle around the center point as placeholder
            const radius = 0.5; // degrees
            const circlePoints = [];
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * 2 * Math.PI;
                const lat = range.lat + radius * Math.cos(angle);
                const lng = range.lng + radius * Math.sin(angle);
                circlePoints.push([lat, lng]);
            }

            polygon = L.polygon(circlePoints, {
                color: '#fff',
                fillColor: color,
                weight: 2,
                opacity: 1,
                fillOpacity: 0.4
            });
        }

        // Add metadata to polygon
        polygon.rangeKey = key;
        polygon.region = region;
        polygon.range = range;

        // Create popup content
        const popupContent = this.createPopupContent(range);
        polygon.bindPopup(popupContent);

        // Add click handler for selection
        polygon.on('click', (e) => {
            this.selectPolygon(polygon);
            L.DomEvent.stopPropagation(e);
        });

        // Add to map and store reference
        this.drawnItems.addLayer(polygon);
        this.polygons.set(key, polygon);
    }

    selectPolygon(polygon) {
        // Deselect previous polygon
        if (this.selectedPolygon) {
            this.selectedPolygon.setStyle({
                color: '#fff',
                weight: 2
            });
        }

        // Select new polygon
        this.selectedPolygon = polygon;
        this.selectedRangeKey = polygon.rangeKey;

        // Highlight selected polygon
        polygon.setStyle({
            color: '#ff0000',
            weight: 4
        });

        // Enable editing for this polygon
        polygon.editing.enable();

        // Update UI
        this.updateStatus(`Selected: ${polygon.range.name} - Drag the points to edit the polygon shape`);
        this.updateButtons();

        // Center map on selected polygon
        this.map.fitBounds(polygon.getBounds(), { padding: [20, 20] });
    }

    setupControls() {
        const mapLayerSelect = document.getElementById('mapLayerSelect');
        const showAllBtn = document.getElementById('showAllBtn');
        const newPolygonBtn = document.getElementById('newPolygonBtn');
        const deleteBtn = document.getElementById('deleteBtn');
        const exportBtn = document.getElementById('exportBtn');
        const exportAllBtn = document.getElementById('exportAllBtn');

        if (mapLayerSelect) {
            mapLayerSelect.addEventListener('change', (e) => {
                this.switchMapLayer(e.target.value);
            });
        }

        if (showAllBtn) {
            showAllBtn.addEventListener('click', () => {
                this.showAllRanges();
            });
        }

        if (newPolygonBtn) {
            newPolygonBtn.addEventListener('click', () => {
                this.startNewPolygon();
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                this.deleteSelectedPolygon();
            });
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                this.exportSelectedRange();
            });
        }

        if (exportAllBtn) {
            exportAllBtn.addEventListener('click', () => {
                this.exportAllRanges();
            });
        }

        // Click on map to deselect
        this.map.on('click', () => {
            this.deselectPolygon();
        });
    }

    switchMapLayer(layerKey) {
        if (this.tileLayers[layerKey] && this.tileLayers[layerKey] !== this.currentLayer) {
            // Remove current layer
            this.map.removeLayer(this.currentLayer);

            // Add new layer
            this.currentLayer = this.tileLayers[layerKey];
            this.currentLayer.addTo(this.map);

            // Update status
            const layerNames = {
                opentopomap: 'OpenTopoMap',
                arcgis: 'ArcGIS World Topo'
            };
            this.updateStatus(`Switched to ${layerNames[layerKey]} layer`);
        }
    }

    showAllRanges() {
        // Fit map to show all polygons
        if (this.polygons.size > 0) {
            const group = new L.featureGroup(Array.from(this.polygons.values()));
            this.map.fitBounds(group.getBounds(), { padding: [20, 20] });
        }
        this.updateStatus('Showing all mountain ranges');
    }

    startNewPolygon() {
        if (!this.selectedPolygon) {
            alert('Please select a mountain range first');
            return;
        }

        // Clear the selected polygon and create a new editable one
        const polygon = this.selectedPolygon;
        const center = polygon.range;

        // Create a small editable polygon at the center
        const newCoords = [
            [center.lat + 0.2, center.lng - 0.2],
            [center.lat + 0.2, center.lng + 0.2],
            [center.lat - 0.2, center.lng + 0.2],
            [center.lat - 0.2, center.lng - 0.2],
            [center.lat + 0.2, center.lng - 0.2]
        ];

        polygon.setLatLngs(newCoords);
        polygon.editing.enable();

        this.updateStatus(`New polygon created for ${polygon.range.name} - Drag the points to shape it`);
    }

    deleteSelectedPolygon() {
        if (!this.selectedPolygon) {
            alert('Please select a polygon first');
            return;
        }

        if (confirm(`Delete polygon for ${this.selectedPolygon.range.name}?`)) {
            // Reset to center point placeholder
            this.drawnItems.removeLayer(this.selectedPolygon);
            this.polygons.delete(this.selectedRangeKey);

            // Recreate as placeholder
            this.createPolygonForRange(this.selectedPolygon.region, this.selectedPolygon.range);

            this.deselectPolygon();
            this.updateStatus('Polygon deleted and reset to placeholder');
        }
    }

    deselectPolygon() {
        if (this.selectedPolygon) {
            // Disable editing
            this.selectedPolygon.editing.disable();

            // Reset style
            this.selectedPolygon.setStyle({
                color: '#fff',
                weight: 2
            });

            this.selectedPolygon = null;
            this.selectedRangeKey = null;
        }

        this.updateStatus('Click any polygon to select and edit it');
        this.updateButtons();
    }

    exportSelectedRange() {
        if (!this.selectedPolygon) {
            alert('Please select a polygon first');
            return;
        }

        const coordinates = this.extractCoordinates(this.selectedPolygon);
        const exportData = {
            name: this.selectedPolygon.range.name,
            region: this.selectedPolygon.region,
            polygon: coordinates
        };

        this.showExport(JSON.stringify(exportData, null, 2));
    }

    exportAllRanges() {
        const exportData = JSON.parse(JSON.stringify(this.mountainRanges)); // Deep clone

        // Update polygon data for each range
        Object.entries(exportData).forEach(([region, ranges]) => {
            ranges.forEach(range => {
                const key = `${region}:${range.name}`;
                if (this.polygons.has(key)) {
                    const polygon = this.polygons.get(key);
                    range.polygon = this.extractCoordinates(polygon);
                }
            });
        });

        this.showExport(JSON.stringify(exportData, null, 2));
    }

    extractCoordinates(polygon) {
        const latLngs = polygon.getLatLngs()[0]; // Get outer ring
        return latLngs.map(latLng => [latLng.lat, latLng.lng]);
    }

    createPopupContent(range) {
        return `
            <div class="mountain-popup">
                <h3>${range.name}</h3>
                <p><strong>Highest Point:</strong> ${range.elevation}</p>
                <p><strong>Description:</strong> ${range.description}</p>
                <p><strong>Notable Peaks:</strong></p>
                <ul>
                    ${range.peaks.map(peak => `<li>${peak}</li>`).join('')}
                </ul>
                <p><em>Click polygon to select and edit</em></p>
            </div>
        `;
    }

    showExport(jsonData) {
        document.getElementById('exportText').value = jsonData;
        document.getElementById('overlay').style.display = 'block';
        document.getElementById('exportArea').style.display = 'block';
    }

    updateButtons() {
        const hasSelection = !!this.selectedPolygon;
        const hasPolygons = this.polygons.size > 0;

        const newPolygonBtn = document.getElementById('newPolygonBtn');
        const deleteBtn = document.getElementById('deleteBtn');
        const exportBtn = document.getElementById('exportBtn');
        const exportAllBtn = document.getElementById('exportAllBtn');

        if (newPolygonBtn) newPolygonBtn.disabled = !hasSelection;
        if (deleteBtn) deleteBtn.disabled = !hasSelection;
        if (exportBtn) exportBtn.disabled = !hasSelection;
        if (exportAllBtn) exportAllBtn.disabled = !hasPolygons;
    }

    updateStatus(message) {
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = message;
        }
    }
}

// Global functions for export modal
function copyToClipboard() {
    const textarea = document.getElementById('exportText');
    textarea.select();
    navigator.clipboard.writeText(textarea.value).then(() => {
        alert('JSON copied to clipboard!');
    }).catch(() => {
        // Fallback for older browsers
        document.execCommand('copy');
        alert('JSON copied to clipboard!');
    });
}

function closeExport() {
    document.getElementById('overlay').style.display = 'none';
    document.getElementById('exportArea').style.display = 'none';
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new PolygonEditor();
});

// Close export modal when clicking overlay
document.getElementById('overlay').addEventListener('click', closeExport);
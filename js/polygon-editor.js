class PolygonEditor {
    constructor() {
        this.map = null;
        this.mountainRanges = null;
        this.polygons = new Map(); // Store polygons for each range
        this.selectedPolygon = null;
        this.selectedRangeKey = null;
        this.drawnItems = null;
        this.polygonCounter = 0; // Counter for new polygons
        this.isDrawing = false; // Track if we're in drawing mode
        this.drawingVertices = []; // Store vertices being drawn
        this.drawingMarkers = []; // Store markers for vertices
        this.drawingPolyline = null; // Temporary polyline showing the shape
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
            if (this.selectedPolygon.editing) {
                this.selectedPolygon.editing.disable();
            }
        }

        // Select new polygon
        this.selectedPolygon = polygon;
        this.selectedRangeKey = polygon.rangeKey;

        // Highlight selected polygon
        polygon.setStyle({
            color: '#ff0000',
            weight: 4
        });

        // Enable editing for this polygon (vertex dragging)
        polygon.editing.enable();

        // Update UI
        const rangeName = polygon.range ? polygon.range.name : polygon.customName;
        this.updateStatus(`Selected: ${rangeName} - Drag vertices to reshape the polygon`);
        this.updateButtons();

        // Center map on selected polygon
        this.map.fitBounds(polygon.getBounds(), { padding: [20, 20] });
    }

    setupControls() {
        const mapLayerSelect = document.getElementById('mapLayerSelect');
        const showAllBtn = document.getElementById('showAllBtn');
        const addPolygonBtn = document.getElementById('addPolygonBtn');
        const doneAddingBtn = document.getElementById('doneAddingBtn');
        const cancelDrawingBtn = document.getElementById('cancelDrawingBtn');
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

        if (addPolygonBtn) {
            addPolygonBtn.addEventListener('click', () => {
                this.startDrawingPolygon();
            });
        }

        if (doneAddingBtn) {
            doneAddingBtn.addEventListener('click', () => {
                this.finishDrawingPolygon();
            });
        }

        if (cancelDrawingBtn) {
            cancelDrawingBtn.addEventListener('click', () => {
                this.cancelDrawingPolygon();
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

        // Click on map to deselect (only when not drawing)
        this.map.on('click', (e) => {
            if (this.isDrawing) {
                this.addVertex(e.latlng);
            } else {
                this.deselectPolygon();
            }
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

    startDrawingPolygon() {
        // Deselect any selected polygon
        this.deselectPolygon();

        // Enter drawing mode
        this.isDrawing = true;
        this.drawingVertices = [];
        this.drawingMarkers = [];

        // Pan to Wyoming
        this.map.setView([43.0, -107.5], 6);

        this.updateStatus('Click on the map to place vertices. Need at least 3 vertices to complete.');
        this.updateButtons();
    }

    addVertex(latlng) {
        // Add vertex to array
        this.drawingVertices.push(latlng);

        // Create draggable marker for this vertex
        const marker = L.marker(latlng, {
            draggable: true,
            icon: L.icon({
                iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
                iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
                shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41]
            })
        });

        const vertexIndex = this.drawingVertices.length - 1;

        // Update vertex position when marker is dragged
        marker.on('drag', () => {
            this.drawingVertices[vertexIndex] = marker.getLatLng();
            this.updateDrawingPolyline();
        });

        marker.addTo(this.map);
        this.drawingMarkers.push(marker);

        // Update the polyline
        this.updateDrawingPolyline();

        // Update status
        const vertexCount = this.drawingVertices.length;
        if (vertexCount < 3) {
            this.updateStatus(`${vertexCount} vertex placed. Need ${3 - vertexCount} more to complete.`);
        } else {
            this.updateStatus(`${vertexCount} vertices placed. Click "Done Adding" to finish, or keep adding more vertices.`);
        }

        this.updateButtons();
    }

    updateDrawingPolyline() {
        // Remove old polyline
        if (this.drawingPolyline) {
            this.map.removeLayer(this.drawingPolyline);
        }

        // Create new polyline if we have at least 2 vertices
        if (this.drawingVertices.length >= 2) {
            // Close the shape if we have 3+ vertices
            const coords = this.drawingVertices.length >= 3
                ? [...this.drawingVertices, this.drawingVertices[0]]
                : this.drawingVertices;

            this.drawingPolyline = L.polyline(coords, {
                color: '#ff0000',
                weight: 2,
                opacity: 0.8,
                dashArray: '5, 5'
            });
            this.drawingPolyline.addTo(this.map);
        }
    }

    finishDrawingPolygon() {
        if (this.drawingVertices.length < 3) {
            alert('Need at least 3 vertices to create a polygon');
            return;
        }

        // Create the polygon
        const polygon = L.polygon(this.drawingVertices, {
            color: '#ff0000',
            fillColor: '#9B59B6',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.6
        });

        // Generate unique key and name
        this.polygonCounter++;
        const key = `custom:new_polygon_${this.polygonCounter}`;
        const customName = `NEW_POLYGON_${this.polygonCounter}`;

        // Add metadata to polygon
        polygon.rangeKey = key;
        polygon.customName = customName;
        polygon.isCustom = true;

        // Create popup content
        const popupContent = `
            <div class="mountain-popup">
                <h3>${customName}</h3>
                <p><em>New custom polygon - rename when adding to dataset</em></p>
                <p>Click to select and edit</p>
            </div>
        `;
        polygon.bindPopup(popupContent);

        // Add click handler for selection
        polygon.on('click', (e) => {
            this.selectPolygon(polygon);
            L.DomEvent.stopPropagation(e);
        });

        // Add to map and store reference
        this.drawnItems.addLayer(polygon);
        this.polygons.set(key, polygon);

        // Clean up drawing mode
        this.cleanupDrawing();

        // Automatically select the new polygon
        this.selectPolygon(polygon);

        this.updateStatus(`Polygon created: ${customName} - Drag vertices to reshape the polygon`);
    }

    cancelDrawingPolygon() {
        this.cleanupDrawing();
        this.updateStatus('Polygon creation cancelled');
    }

    cleanupDrawing() {
        // Remove markers
        this.drawingMarkers.forEach(marker => this.map.removeLayer(marker));
        this.drawingMarkers = [];

        // Remove polyline
        if (this.drawingPolyline) {
            this.map.removeLayer(this.drawingPolyline);
            this.drawingPolyline = null;
        }

        // Reset drawing state
        this.isDrawing = false;
        this.drawingVertices = [];

        this.updateButtons();
    }

    deleteSelectedPolygon() {
        if (!this.selectedPolygon) {
            alert('Please select a polygon first');
            return;
        }

        const polygonName = this.selectedPolygon.range ? this.selectedPolygon.range.name : this.selectedPolygon.customName;

        if (confirm(`Delete polygon: ${polygonName}?`)) {
            // Remove from map and storage
            this.drawnItems.removeLayer(this.selectedPolygon);
            this.polygons.delete(this.selectedRangeKey);

            // If it's a mountain range (not custom), recreate as placeholder
            if (this.selectedPolygon.range) {
                this.createPolygonForRange(this.selectedPolygon.region, this.selectedPolygon.range);
            }

            this.deselectPolygon();
            this.updateStatus('Polygon deleted');
        }
    }

    deselectPolygon() {
        if (this.selectedPolygon) {
            // Disable editing
            if (this.selectedPolygon.editing) {
                this.selectedPolygon.editing.disable();
            }

            // Reset style
            this.selectedPolygon.setStyle({
                color: '#fff',
                weight: 2
            });

            this.selectedPolygon = null;
            this.selectedRangeKey = null;
        }

        this.updateStatus('Click any polygon to select and edit it, or click "Add Polygon" to create a new one');
        this.updateButtons();
    }

    exportSelectedRange() {
        if (!this.selectedPolygon) {
            alert('Please select a polygon first');
            return;
        }

        const coordinates = this.extractCoordinates(this.selectedPolygon);

        let exportData;
        if (this.selectedPolygon.isCustom) {
            // Calculate center point from polygon
            const bounds = this.selectedPolygon.getBounds();
            const center = bounds.getCenter();

            // Export custom polygon with all required fields and placeholder values
            exportData = {
                name: this.selectedPolygon.customName,
                lat: Math.round(center.lat * 10) / 10,
                lng: Math.round(center.lng * 10) / 10,
                description: "DESCRIPTION_NEEDED",
                peaks: ["PEAK_1", "PEAK_2", "PEAK_3"],
                elevation: "ELEVATION_NEEDED",
                polygon: coordinates
            };
        } else {
            // Export existing mountain range with all fields
            exportData = {
                name: this.selectedPolygon.range.name,
                lat: this.selectedPolygon.range.lat,
                lng: this.selectedPolygon.range.lng,
                description: this.selectedPolygon.range.description,
                peaks: this.selectedPolygon.range.peaks,
                elevation: this.selectedPolygon.range.elevation,
                polygon: coordinates
            };
        }

        // Add trailing comma for easy copy-paste into arrays
        this.showExport(JSON.stringify(exportData, null, 2) + ',');
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
        const canFinishDrawing = this.isDrawing && this.drawingVertices.length >= 3;

        const addPolygonBtn = document.getElementById('addPolygonBtn');
        const doneAddingBtn = document.getElementById('doneAddingBtn');
        const cancelDrawingBtn = document.getElementById('cancelDrawingBtn');
        const deleteBtn = document.getElementById('deleteBtn');
        const exportBtn = document.getElementById('exportBtn');
        const exportAllBtn = document.getElementById('exportAllBtn');

        // Show/hide drawing buttons
        if (addPolygonBtn) addPolygonBtn.style.display = this.isDrawing ? 'none' : 'inline-block';
        if (doneAddingBtn) {
            doneAddingBtn.style.display = this.isDrawing ? 'inline-block' : 'none';
            doneAddingBtn.disabled = !canFinishDrawing;
        }
        if (cancelDrawingBtn) {
            cancelDrawingBtn.style.display = this.isDrawing ? 'inline-block' : 'none';
        }

        // Disable other buttons while drawing
        if (deleteBtn) deleteBtn.disabled = this.isDrawing || !hasSelection;
        if (exportBtn) exportBtn.disabled = this.isDrawing || !hasSelection;
        if (exportAllBtn) exportAllBtn.disabled = this.isDrawing || !hasPolygons;
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
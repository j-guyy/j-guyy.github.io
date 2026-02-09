// Rocky Mountain Sub-Ranges Data and Mapping
class MountainRangeMapper {
    constructor() {
        this.mountainRanges = null;
        this.loadMountainData();
    }

    async loadMountainData() {
        try {
            const response = await fetch('data/mountainRanges.json');
            this.mountainRanges = await response.json();
            this.createOverviewMap();
        } catch (error) {
            console.error('Error loading mountain ranges data:', error);
            this.showErrorMessage();
        }
    }

    showErrorMessage() {
        const mapContainer = document.getElementById('rocky-mountains-map');
        if (mapContainer) {
            mapContainer.innerHTML = `
                <div class="error-message">
                    <p>Error loading mountain ranges data. Please try refreshing the page.</p>
                </div>
            `;
        }
    }

    createOverviewMap() {
        const mapContainer = document.getElementById('rocky-mountains-map');
        if (!mapContainer) return;

        const map = L.map('rocky-mountains-map', {
            gestureHandling: true,
            fullscreenControl: true
        }).setView([44.0, -110.0], 4);

        // Disable gesture handling in fullscreen mode
        map.on('fullscreenchange', () => {
            if (map.isFullscreen()) {
                map.gestureHandling.disable();
            } else {
                map.gestureHandling.enable();
            }
        });

        // Add topographic tile layer
        L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)',
            maxZoom: 17
        }).addTo(map);

        // Add all mountain ranges to overview map
        const allRanges = [
            ...this.mountainRanges.northern,
            ...this.mountainRanges.central,
            ...this.mountainRanges.southern
        ];

        allRanges.forEach(range => {
            const color = this.getRegionColor(range);

            if (range.polygon) {
                // Create polygon for mountain range
                const polygon = L.polygon(range.polygon, {
                    fillColor: color,
                    color: '#fff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.6
                }).addTo(map);

                const popupContent = this.createPopupContent(range);
                polygon.bindPopup(popupContent);
            } else {
                // Fallback to circle marker if no polygon data
                const marker = L.circleMarker([range.lat, range.lng], {
                    radius: 8,
                    fillColor: color,
                    color: '#fff',
                    weight: 2,
                    opacity: 1,
                    fillOpacity: 0.8
                }).addTo(map);

                const popupContent = this.createPopupContent(range);
                marker.bindPopup(popupContent);
            }
        });

    }

    getRegionColor(range) {
        // Color code by region
        if (this.mountainRanges.northern.includes(range)) return '#4A90E2'; // Blue
        if (this.mountainRanges.central.includes(range)) return '#4CAF50'; // Green
        if (this.mountainRanges.southern.includes(range)) return '#FF6B6B'; // Red
        return '#9B59B6'; // Purple fallback
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
            </div>
        `;
    }


}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
    new MountainRangeMapper();
});

// Add custom CSS for mountain popups
const style = document.createElement('style');
style.textContent = `
    .mountain-popup {
        max-width: 300px;
    }
    
    .mountain-popup h3 {
        margin: 0 0 10px 0;
        color: var(--primary-color);
        font-size: 1.2em;
    }
    
    .mountain-popup p {
        margin: 5px 0;
        font-size: 0.9em;
    }
    
    .mountain-popup ul {
        margin: 5px 0;
        padding-left: 20px;
    }
    
    .mountain-popup li {
        font-size: 0.85em;
        margin: 2px 0;
    }

    .error-message {
        text-align: center;
        padding: 20px;
        background: rgba(255, 0, 0, 0.1);
        border: 1px solid rgba(255, 0, 0, 0.3);
        border-radius: 8px;
        color: #ff6b6b;
    }
`;
document.head.appendChild(style);
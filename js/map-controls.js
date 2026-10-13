// Shared Leaflet map controls for the ecoregion pages: the same basemap switcher
// and live-location control the Strava hunters use (setupStravaBasemaps /
// LocationControl in js/strava.js). strava.js is a page-scoped script that
// can't be loaded on its own, so the ecoregion pages carry this standalone copy.
// Needs Leaflet 1.9.4 and css/map-controls.css.

// ── Basemap switcher ──────────────────────────────────────────────────────────
//
// Adds the Dark / OSM / Greyscale / OpenTopoMap / OpenCycleMap / Outdoors layer
// control. `defaultBasemap` picks which one starts selected. `onThemeChange`
// receives true when the active basemap is the dark one so callers can restyle
// outlines that only read on light tiles. Returns { layers, isDark }.
function setupMapBasemaps(map, { overlays = null, onThemeChange = null, defaultBasemap = 'greyscale' } = {}) {
    // CARTO stamps keyless raster tiles with an "API KEY REQUIRED" watermark.
    // Public browser-side tile keys, same ones js/strava.js uses — rotate together.
    const CARTO_KEY = 'cb1_43mc_1_257b4a4d0d9625f587e00261';
    const TF_KEY = 'bc2ceac04cab454da559aaacefe3582f';
    const osm = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    const carto = osm + ' &copy; <a href="https://carto.com/attributions">CARTO</a>';
    const tf = 'Maps &copy; <a href="https://www.thunderforest.com/">Thunderforest</a>, Data &copy; OSM contributors';

    const layers = {
        dark: L.tileLayer(`https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
            { attribution: carto, subdomains: 'abcd', maxZoom: 19 }),
        osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            { attribution: osm, maxZoom: 19 }),
        greyscale: L.tileLayer(`https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=${CARTO_KEY}`,
            { attribution: carto, subdomains: 'abcd', maxZoom: 19 }),
        topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
            { attribution: 'Map data: &copy; OSM contributors, SRTM | Style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)', maxZoom: 17 }),
        cycle: L.tileLayer(`https://tile.thunderforest.com/cycle/{z}/{x}/{y}.png?apikey=${TF_KEY}`,
            { attribution: tf, maxZoom: 22 }),
        outdoors: L.tileLayer(`https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=${TF_KEY}`,
            { attribution: tf, maxZoom: 22 }),
    };
    if (!layers[defaultBasemap]) defaultBasemap = 'greyscale';
    layers[defaultBasemap].addTo(map);

    L.control.layers({
        'Dark':                      layers.dark,
        'OpenStreetMap':             layers.osm,
        'OpenStreetMap (Greyscale)': layers.greyscale,
        'OpenTopoMap':               layers.topo,
        'OpenCycleMap':              layers.cycle,
        'Outdoors':                  layers.outdoors,
    }, overlays, { position: 'topright', collapsed: true }).addTo(map);

    if (onThemeChange) {
        map.on('baselayerchange', e => onThemeChange(e.layer === layers.dark));
    }

    // Leaflet only re-measures its container on a window resize, which entering
    // fullscreen doesn't always fire (e.g. inside a WebView).
    map.on('enterFullscreen exitFullscreen', () => {
        const refresh = () => map.invalidateSize();
        refresh();
        setTimeout(refresh, 200);
        setTimeout(refresh, 600);
    });

    return { layers, isDark: defaultBasemap === 'dark' };
}

// ── Location control ──────────────────────────────────────────────────────────
//
// Crosshair button that opens a small panel with "Current location" (fly to the
// GPS fix) and "Show my location" (a live dot refreshed every 10 seconds).
// `onLocate({lat, lng, accuracy, source})` fires on every fix (`source` is 'goto' for
// the one-off button, 'live' for the refreshing dot); `onStop()` when the live
// dot is switched off; `onError(message)` on a geolocation failure.

const MapLocationControl = L.Control.extend({
    options: { position: 'topright', onLocate: null, onStop: null, onError: null },

    onAdd(map) {
        this._map = map;
        this._watching = false;
        this._marker = null;
        this._ring = null;
        this._intervalId = null;

        // The dot gets its own pane above the overlay pane. In the shared one it
        // sits in the same canvas/SVG as the ecoregion polygons, and every
        // bringToFront() on a polygon (selection, search, hover) drew over it.
        if (!map.getPane('locationPane')) {
            const pane = map.createPane('locationPane');
            pane.style.zIndex = 450;            // overlays are 400, markers 600
            pane.style.pointerEvents = 'none';  // clicks fall through to the polygons
        }

        const wrap = L.DomUtil.create('div', 'leaflet-bar leaflet-control loc-control');
        L.DomEvent.disableClickPropagation(wrap);
        L.DomEvent.disableScrollPropagation(wrap);

        this._btn = L.DomUtil.create('a', 'loc-btn', wrap);
        this._btn.href = '#';
        this._btn.title = 'My location';
        this._btn.setAttribute('role', 'button');
        this._btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <line x1="12" y1="2"  x2="12" y2="7"/>
            <line x1="12" y1="17" x2="12" y2="22"/>
            <line x1="2"  y1="12" x2="7"  y2="12"/>
            <line x1="17" y1="12" x2="22" y2="12"/>
        </svg>`;
        L.DomEvent.on(this._btn, 'click', e => {
            L.DomEvent.preventDefault(e);
            this._panel.hidden = !this._panel.hidden;
        });

        this._panel = L.DomUtil.create('div', 'loc-panel', wrap);
        this._panel.hidden = true;

        const gotoBtn = L.DomUtil.create('button', 'loc-panel-item', this._panel);
        gotoBtn.type = 'button';
        gotoBtn.innerHTML = '<span class="loc-icon">⊕</span> Current location';
        L.DomEvent.on(gotoBtn, 'click', () => {
            this._gotoLocation();
            this._panel.hidden = true;
        });

        L.DomUtil.create('div', 'loc-panel-divider', this._panel);

        const toggleRow = L.DomUtil.create('label', 'loc-panel-item loc-panel-toggle', this._panel);
        L.DomUtil.create('span', '', toggleRow).textContent = 'Show my location';
        this._checkbox = L.DomUtil.create('input', 'loc-checkbox', toggleRow);
        this._checkbox.type = 'checkbox';
        L.DomEvent.on(this._checkbox, 'change', () => {
            if (this._checkbox.checked) this._startTracking(); else this._stopTracking();
        });

        map.on('click', () => { this._panel.hidden = true; });
        return wrap;
    },

    onRemove() {
        this._stopTracking();
    },

    _fail(err) {
        if (this.options.onError) this.options.onError(err && err.message ? err.message : 'Location unavailable');
    },

    _gotoLocation() {
        if (!navigator.geolocation) return this._fail({ message: 'Geolocation is not supported here' });
        navigator.geolocation.getCurrentPosition(pos => {
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;
            this._map.setView([lat, lng], Math.max(this._map.getZoom(), 9));
            if (this.options.onLocate) this.options.onLocate({ lat, lng, accuracy, source: 'goto' });
        }, err => this._fail(err), { enableHighAccuracy: true, timeout: 10000 });
    },

    _startTracking() {
        if (this._watching) return;
        if (!navigator.geolocation) {
            this._checkbox.checked = false;
            return this._fail({ message: 'Geolocation is not supported here' });
        }
        this._watching = true;
        this._updateLocation();
        this._intervalId = setInterval(() => this._updateLocation(), 10000);
    },

    _stopTracking() {
        const wasWatching = this._watching;
        this._watching = false;
        clearInterval(this._intervalId);
        this._intervalId = null;
        if (this._marker) { this._marker.remove(); this._marker = null; }
        if (this._ring) { this._ring.remove(); this._ring = null; }
        if (this._checkbox) this._checkbox.checked = false;
        if (wasWatching && this.options.onStop) this.options.onStop();
    },

    _updateLocation() {
        if (!this._watching || !navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(pos => {
            if (!this._watching) return;
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;
            if (this._marker) {
                this._marker.setLatLng([lat, lng]);
                this._ring.setLatLng([lat, lng]).setRadius(accuracy);
            } else {
                this._ring = L.circle([lat, lng], {
                    radius: accuracy, color: '#29B6F6', fillColor: '#29B6F6',
                    fillOpacity: 0.10, weight: 1, interactive: false, pane: 'locationPane',
                }).addTo(this._map);
                this._marker = L.circleMarker([lat, lng], {
                    radius: 8, color: '#fff', fillColor: '#29B6F6',
                    fillOpacity: 1, weight: 2.5, interactive: false, pane: 'locationPane',
                }).addTo(this._map);
            }
            if (this.options.onLocate) this.options.onLocate({ lat, lng, accuracy, source: 'live' });
        },
        err => {
            this._fail(err);
            // Permission denied won't recover on its own — drop the live dot.
            if (err && err.code === 1) this._stopTracking();
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 });
    },
});

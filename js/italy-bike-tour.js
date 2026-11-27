// Route map for trip-reports/italy-bike-tour.html.
// Draws the 14 "Italy by Bike" Strava rides from data/italy-bike-tour.json
// (reduced polylines, decoded once into [lat, lng] pairs), coloured by leg,
// with a popup per day and markers for the two family hometowns.

(function () {
    const LEG_COLORS = {
        'Ligurian Coast': '#2f9bd6',
        'Tuscany Hills': '#e0a526',
        'Umbria Valleys': '#4CAF50',
        'Abruzzo & Apennines': '#d9534f'
    };

    const PLACES = [
        { name: 'Zoagli', note: "My great-grandfather's birthplace (left for the US in 1914)", at: [44.3355, 9.2695] },
        { name: 'Torricella Peligna', note: "Monica's great-grandparents' hometown (left for the US in 1928)", at: [42.0227, 14.2606] },
        { name: 'Genoa', note: 'Start · Aug 28', at: [44.4148, 8.9242] },
        { name: 'Pescara', note: 'Finish on the Adriatic · Sep 10', at: [42.4648, 14.2129] }
    ];

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[ch]));
    }

    function fmt(n, digits) {
        return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
    }

    function legend(map) {
        const control = L.control({ position: 'topright' });
        control.onAdd = function () {
            const div = L.DomUtil.create('div', 'italy-legend');
            div.innerHTML = Object.entries(LEG_COLORS).map(([leg, color]) =>
                `<div><span style="background:${color}"></span>${escapeHtml(leg)}</div>`).join('');
            return div;
        };
        control.addTo(map);
    }

    function init() {
        const el = document.getElementById('italy-map');
        if (!el || typeof L === 'undefined') return;

        const map = L.map(el, {
            zoomDelta: 1,          // +/− buttons, double-click; wheel zoom is js/fluid-zoom.js
            gestureHandling: true,
            tap: false
        });
        map.addControl(new L.Control.FullScreen());

        L.tileLayer('https://tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey=bc2ceac04cab454da559aaacefe3582f', {
            attribution: '&copy; <a href="http://www.thunderforest.com/">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 22
        }).addTo(map);

        fetch('../data/italy-bike-tour.json?v=20261127a')
            .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
            .then(data => {
                const all = L.featureGroup();
                data.rides.forEach(ride => {
                    const color = LEG_COLORS[ride.leg] || '#4CAF50';
                    // A wide transparent line underneath makes the route easy to tap.
                    const hit = L.polyline(ride.route, { color, weight: 14, opacity: 0 });
                    const line = L.polyline(ride.route, { color, weight: 4, opacity: 0.9 });
                    const popup = `<strong>Day ${ride.day}: ${escapeHtml(ride.stage)}</strong><br>` +
                        `${fmt(ride.mi, 1)} mi · ${fmt(ride.ft, 0)} ft<br>` +
                        `<a href="https://www.strava.com/activities/${encodeURIComponent(ride.id)}" target="_blank" rel="noopener">View on Strava</a>`;
                    [hit, line].forEach(l => {
                        l.bindPopup(popup);
                        l.on('mouseover', () => line.setStyle({ weight: 7 }));
                        l.on('mouseout', () => line.setStyle({ weight: 4 }));
                        all.addLayer(l);
                    });
                });

                // Set the view before adding layers: Leaflet can't draw a path on a map without one.
                map.fitBounds(all.getBounds(), { padding: [20, 20] });
                all.addTo(map);

                PLACES.forEach(p => {
                    L.circleMarker(p.at, {
                        radius: 7, color: '#fff', weight: 2, fillColor: '#111', fillOpacity: 0.9
                    }).addTo(map).bindPopup(`<strong>${escapeHtml(p.name)}</strong><br>${escapeHtml(p.note)}`);
                });

                legend(map);
            })
            .catch(err => {
                console.error('Italy route map:', err);
                el.hidden = true;
            });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();

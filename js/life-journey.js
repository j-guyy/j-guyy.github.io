// Life journey on about.html: a Cesium globe pinned behind a column of cards,
// one per place I've lived. As a card reaches the middle of the screen the
// camera flies there (a chase cam along the great circle, with a glowing arc
// in the sky) and slowly circles the place. The last card pulls back to show
// the whole route.
//
// 3D buildings and terrain are Google Photorealistic 3D Tiles. The Google key
// isn't in the repo: the worker hands it out from its GOOGLE_MAPS_KEY secret
// (/maps/key). Google only accepts it from j-guyy.github.io and localhost:8000,
// only for the Map Tiles API, and caps it at 30 page loads a day (each visit
// that opens the globe uses one). When the tiles can't load (no key, cap
// reached, error, low-memory phone) the page falls back to a flat satellite
// globe with the same camera moves.
(function () {
    'use strict';

    const KEY_URL = 'https://strava-worker.justinguyette.workers.dev/maps/key';
    const CESIUM_URL = 'https://cesium.com/downloads/cesiumjs/releases/1.124/Build/Cesium/Cesium.js';

    // Each place: the landmark the camera circles, how far away (m) and how
    // steep (deg), the circling speed (deg/s), and the ground height there (m).
    // `label` moves a label left, right or below where places sit close together.
    // Superior circles the town center, never the house.
    const STOPS = [
        { name: 'Rochester, NY', lat: 43.1590, lon: -77.6150, elev: 160, label: 'left',
          range: 3200, pitch: -25, speed: 10 },
        { name: 'Albany, NY', lat: 42.6510, lon: -73.7590, elev: 60, label: 'right',
          range: 3000, pitch: -24, speed: 10 },
        { name: 'Newark, DE', lat: 39.6780, lon: -75.7510, elev: 35, label: 'below',
          range: 2400, pitch: -26, speed: 10 },
        { name: 'Houston, TX', lat: 29.7580, lon: -95.3670, elev: 15,
          range: 3600, pitch: -20, speed: 12 },
        { name: 'Richland, WA', lat: 46.2790, lon: -119.2760, elev: 110,
          range: 5000, pitch: -18, speed: 9 },
        { name: 'Boulder, CO', lat: 40.0035, lon: -105.2790, elev: 1650, label: 'left',
          range: 4200, pitch: -22, speed: 12 },
        { name: 'Superior, CO', lat: 39.9528, lon: -105.1686, elev: 1700, label: 'right',
          range: 2600, pitch: -20, speed: 8 }
    ];
    // Camera poses for the first and last cards: what we look at, from where
    const INTRO = { lat: 39, lon: -96, ground: 0, heading: 0, pitch: -89, range: 10000000 };
    // (centered west of the route so it clears the card on the left)
    const OVERVIEW = { lat: 39.5, lon: -104, ground: 0, heading: 0, pitch: -72, range: 4900000 };

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowMemory = navigator.deviceMemory !== undefined && navigator.deviceMemory < 4;

    let Cesium = null;
    let viewer = null;
    let tileset = null;   // Google's 3D tiles, when they loaded
    let ready = false;    // the camera has its first pose; until then cards only update `wanted`
    let flat = false;     // true when showing the flat satellite globe instead of 3D tiles
    let pose = null;      // where the camera is now (see setPose)
    let job = 0;          // bumped on every card change; running moves stop when it changes
    let wanted = 'intro'; // the card in the middle of the screen
    let overviewLayer = null;

    // ---- Small maths helpers ----
    const D = deg => deg * Math.PI / 180;
    const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    // Quick start, long gentle finish: the last stretch of a flight drifts in
    // slowly so the city's tiles stream in before the camera settles.
    // (Quadratic over the first 40%, cubic over the rest, joined smoothly.)
    const arrive = t => t < 0.4 ? 0.5 * (t / 0.4) * (t / 0.4) : 1 - 0.5 * Math.pow((1 - t) / 0.6, 3);
    const smooth = t => t * t * (3 - 2 * t);
    const lerp = (a, b, t) => a + (b - a) * t;
    const lerpAngle = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

    // Compass bearing (deg) from a to b along the great circle
    function bearing(a, b) {
        const p1 = D(a.lat), p2 = D(b.lat), dl = D(b.lon - a.lon);
        const y = Math.sin(dl) * Math.cos(p2);
        const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }
    // Direction of travel on arriving at b from a
    const arrivalBearing = (a, b) => (bearing(b, a) + 180) % 360;

    // The Google key, from the worker (gives up after 5 s)
    async function fetchGoogleKey() {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        try {
            const res = await fetch(KEY_URL, { signal: ctrl.signal });
            if (!res.ok) throw new Error('Key request failed: ' + res.status);
            const { key } = await res.json();
            if (!key) throw new Error('No key in response');
            return key;
        } finally {
            clearTimeout(timer);
        }
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = () => reject(new Error('Could not load ' + src));
            document.head.appendChild(s);
        });
    }

    // ---- Camera ----
    // A pose is the point we look at (lat, lon, ground height) plus heading,
    // pitch and distance. Every move goes through here, so a move interrupted
    // by the next card can start from wherever the camera is.
    function setPose(p) {
        pose = p;
        viewer.camera.lookAt(
            Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.ground),
            new Cesium.HeadingPitchRange(D(p.heading), D(p.pitch), p.range));
    }

    function poseFor(step, from) {
        if (step === 'intro') return Object.assign({}, INTRO);
        if (step === 'overview') {
            // A tall phone screen shows less width: centre the route and pull back
            if (window.innerWidth < window.innerHeight) {
                return Object.assign({}, OVERVIEW, { lon: -93, lat: 38, pitch: -80,
                    range: OVERVIEW.range * Math.min(2.0, 0.95 * window.innerHeight / window.innerWidth) });
            }
            return Object.assign({}, OVERVIEW);
        }
        const s = STOPS[step];
        const far = from && surfaceDistance(from, s) > 20000;
        return {
            lat: s.lat, lon: s.lon, ground: flat ? 0 : s.elev, stop: step,
            // Arrive facing the way we travelled; a short hop keeps its heading
            heading: far ? arrivalBearing(from, s) : (from ? from.heading : 200),
            pitch: s.pitch, range: s.range
        };
    }

    function surfaceDistance(a, b) {
        if (a.lat === b.lat && a.lon === b.lon) return 0;
        return new Cesium.EllipsoidGeodesic(
            Cesium.Cartographic.fromDegrees(a.lon, a.lat),
            Cesium.Cartographic.fromDegrees(b.lon, b.lat)).surfaceDistance;
    }

    // Run fn(t) each frame for `seconds`, t from 0 to 1. Resolves true when it
    // finished, false when a newer card took over first.
    function animate(seconds, myJob, fn) {
        return new Promise(resolve => {
            if (seconds <= 0) { fn(1); resolve(true); return; }
            const start = performance.now();
            function tick() {
                if (myJob !== job) { resolve(false); return; }
                const t = Math.min((performance.now() - start) / (seconds * 1000), 1);
                fn(t);
                if (t < 1) requestAnimationFrame(tick); else resolve(true);
            }
            requestAnimationFrame(tick);
        });
    }

    // Chase-cam flight from pose a to pose b: the point we look at slides along
    // the great circle while the camera pulls back and tilts down mid-way,
    // turning to face the direction of travel and then the arrival view.
    // A long hop climbs high enough to see the curve of the earth; a short one
    // (Boulder → Superior) stays a low glide.
    function travel(a, b, myJob) {
        const dist = surfaceDistance(a, b);
        const far = dist > 20000, near = dist < 50000;
        const seconds = reduceMotion ? 0 : near ? 6 : Math.min(3.5 + dist / 450000, 9);
        const lift = near ? 1800
            : Math.max(0, Math.min(Math.max(dist * 0.55, 1800), 1400000) - Math.max(a.range, b.range));
        const tilt = near ? 8 : 30;
        const dep = far ? bearing(a, b) : 0, arr = far ? arrivalBearing(a, b) : 0;
        const geo = dist > 0 ? new Cesium.EllipsoidGeodesic(
            Cesium.Cartographic.fromDegrees(a.lon, a.lat),
            Cesium.Cartographic.fromDegrees(b.lon, b.lat)) : null;
        const arc = (a.stop !== undefined && b.stop !== undefined && dist > 0) ? drawArc(a, b) : null;

        return animate(seconds, myJob, t => {
            const e = (b.stop !== undefined ? arrive : ease)(t), bump = Math.sin(Math.PI * e);
            let lat = a.lat, lon = a.lon;
            if (geo) {
                const c = geo.interpolateUsingFraction(e);
                lat = Cesium.Math.toDegrees(c.latitude);
                lon = Cesium.Math.toDegrees(c.longitude);
            }
            let heading;
            if (!far) heading = lerpAngle(a.heading, b.heading, e);
            else if (e < 0.2) heading = lerpAngle(a.heading, dep, smooth(e / 0.2));
            else if (e > 0.8) heading = lerpAngle(arr, b.heading, smooth((e - 0.8) / 0.2));
            else heading = lerpAngle(dep, arr, (e - 0.2) / 0.6);
            setPose({
                lat, lon, ground: lerp(a.ground, b.ground, e), stop: e === 1 ? b.stop : undefined,
                heading,
                pitch: Math.max(-89, lerp(a.pitch, b.pitch, e) - bump * tilt),
                // Distance changes on a log scale so a dive from space feels even
                range: Math.exp(lerp(Math.log(a.range), Math.log(b.range), e)) + bump * lift
            });
            if (arc) arc.progress(Math.min(e * 1.15 + 0.02, 1));
        }).then(done => {
            if (arc) arc.remove();
            return done;
        });
    }

    // Circle the current place until the next card takes over. The loop stops
    // while the section is off screen (the render loop is off then) and the
    // observer in startGlobe() starts it again through resumeCircle.
    let resumeCircle = null;
    function circle(speed, myJob) {
        if (reduceMotion) return;
        const start = performance.now();
        let last = start;
        function tick(now) {
            if (myJob !== job) return;
            if (!viewer.useDefaultRenderLoop) {
                resumeCircle = () => { last = performance.now(); requestAnimationFrame(tick); };
                return;
            }
            const ramp = Math.min((now - start) / 1500, 1); // ease into the turn
            pose.heading += speed * ramp * (now - last) / 1000;
            last = now;
            setPose(pose);
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    // ---- Route arcs and labels ----
    function arcPoints(a, b, progress) {
        const g = new Cesium.EllipsoidGeodesic(
            Cesium.Cartographic.fromDegrees(a.lon, a.lat),
            Cesium.Cartographic.fromDegrees(b.lon, b.lat));
        const peak = Math.max(g.surfaceDistance * 0.12, 1200);
        const n = 64, last = Math.max(1, Math.round(n * progress)), pts = [];
        for (let i = 0; i <= last; i++) {
            const f = i / n;
            const c = g.interpolateUsingFraction(f);
            pts.push(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude,
                lerp(a.ground, b.ground, f) + Math.sin(Math.PI * f) * peak));
        }
        return pts;
    }

    function arcLine(positions) {
        return {
            polyline: {
                positions, width: 5, arcType: Cesium.ArcType.NONE,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.2, color: Cesium.Color.fromCssColorString('#4CAF50')
                })
            }
        };
    }

    // The arc drawn during a flight, growing as `progress` goes 0 → 1
    function drawArc(a, b) {
        let p = 0;
        const entity = viewer.entities.add(arcLine(
            new Cesium.CallbackProperty(() => arcPoints(a, b, p), false)));
        return {
            progress(v) { p = v; },
            remove() { viewer.entities.remove(entity); }
        };
    }

    // The whole route with labels, shown only on the last card (labels draw
    // over everything, so they'd float over the city views)
    function showOverview(show) {
        if (show && !overviewLayer) {
            overviewLayer = new Cesium.CustomDataSource('route');
            const green = Cesium.Color.fromCssColorString('#4CAF50');
            const phone = window.matchMedia('(max-width: 768px)').matches;
            STOPS.forEach((s, i) => {
                const here = { lat: s.lat, lon: s.lon, ground: flat ? 0 : s.elev };
                const next = STOPS[i + 1];
                if (next) {
                    overviewLayer.entities.add(arcLine(arcPoints(here,
                        { lat: next.lat, lon: next.lon, ground: flat ? 0 : next.elev }, 1)));
                }
                const side = s.label === 'left' ? -1 : s.label === 'right' ? 1 : 0;
                const below = s.label === 'below';
                overviewLayer.entities.add({
                    position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, here.ground),
                    point: {
                        pixelSize: 9, color: green, outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
                        disableDepthTestDistance: Number.POSITIVE_INFINITY
                    },
                    label: {
                        text: s.name, font: (phone ? '12px' : '14px') + ' system-ui, sans-serif',
                        fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2,
                        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                        verticalOrigin: below ? Cesium.VerticalOrigin.TOP : Cesium.VerticalOrigin.BOTTOM,
                        horizontalOrigin: side < 0 ? Cesium.HorizontalOrigin.RIGHT
                            : side > 0 ? Cesium.HorizontalOrigin.LEFT : Cesium.HorizontalOrigin.CENTER,
                        pixelOffset: new Cesium.Cartesian2(side * 4, below ? 12 : -12),
                        showBackground: true, backgroundColor: new Cesium.Color(0, 0, 0, 0.6),
                        disableDepthTestDistance: Number.POSITIVE_INFINITY
                    }
                });
            });
            viewer.dataSources.add(overviewLayer);
        }
        if (overviewLayer) overviewLayer.show = show;
    }

    // ---- Cards ----
    async function goTo(step) {
        const myJob = ++job;
        const started = performance.now();
        showOverview(step === 'overview');
        const target = poseFor(step, pose);
        const done = await travel(pose, target, myJob);
        if (done && typeof step === 'number') {
            circle(STOPS[step].speed, myJob);
            if (timings) timeTiles(step, started, myJob);
        }
    }

    // ?journeyDebug: record how long each place takes to look sharp, in
    // window.journeyTimings (seconds: flight, then arrival → all tiles loaded)
    const timings = /[?&]journeyDebug\b/.test(location.search) ? [] : null;
    if (timings) window.journeyTimings = timings;
    function timeTiles(step, started, myJob) {
        if (!tileset) return;
        const arrived = performance.now();
        const remove = viewer.scene.postRender.addEventListener(() => {
            const now = performance.now();
            if (myJob !== job || tileset.tilesLoaded || now - arrived > 60000) {
                remove();
                timings.push({
                    place: STOPS[step].name, interrupted: myJob !== job,
                    flight: +((arrived - started) / 1000).toFixed(1),
                    sharp: +((now - arrived) / 1000).toFixed(1),
                    total: +((now - started) / 1000).toFixed(1)
                });
            }
        });
    }

    function parseStep(el) {
        const v = el.dataset.step;
        return v === 'intro' || v === 'overview' ? v : Number(v);
    }

    function updateDots(step) {
        const idx = step === 'intro' ? -1 : step === 'overview' ? STOPS.length : step;
        document.querySelectorAll('.journey-dot').forEach((dot, i) => {
            dot.className = 'journey-dot' + (i === idx ? ' active' : i < idx ? ' visited' : '');
        });
    }

    function watchCards() {
        const steps = document.querySelectorAll('.journey-step');
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                steps.forEach(s => s.classList.toggle('is-active', s === entry.target));
                const step = parseStep(entry.target);
                if (step === wanted) return;
                wanted = step;
                updateDots(step);
                if (ready) goTo(step);
            });
        }, { rootMargin: '-45% 0px -45% 0px' }); // a card is "on" when it crosses the middle band
        steps.forEach(s => observer.observe(s));
    }

    // ---- Setup ----
    async function startGlobe(stage) {
        const status = stage.querySelector('.journey-status');
        status.hidden = false;
        status.textContent = 'Loading globe…';
        // Ask for the key while Cesium downloads (not at all on low-memory phones)
        const keyPromise = lowMemory ? null : fetchGoogleKey();
        if (keyPromise) keyPromise.catch(() => {}); // handled where it's awaited
        try {
            await loadScript(CESIUM_URL);
            Cesium = window.Cesium;
            Cesium.Ion.defaultAccessToken = '';
            viewer = new Cesium.Viewer('life-journey-globe', {
                baseLayer: false, baseLayerPicker: false, geocoder: false, homeButton: false,
                sceneModePicker: false, selectionIndicator: false, navigationHelpButton: false,
                animation: false, timeline: false, fullscreenButton: false, infoBox: false,
                skyBox: false, scene3DOnly: true
            });
        } catch (e) {
            console.error('Life journey globe failed to start', e);
            status.textContent = 'The 3D globe could not load in this browser.';
            return;
        }
        const scene = viewer.scene;
        scene.backgroundColor = Cesium.Color.BLACK;
        scene.skyAtmosphere.show = true;
        const ctrl = scene.screenSpaceCameraController;
        ctrl.enableInputs = false; // the page scroll drives the camera

        let tiles = null;
        if (!lowMemory) {
            try {
                Cesium.GoogleMaps.defaultApiKey = await keyPromise;
                tiles = await Cesium.createGooglePhotorealistic3DTileset(undefined, {
                    showCreditsOnScreen: true,
                    maximumScreenSpaceError: window.matchMedia('(max-width: 768px)').matches ? 24 : 16,
                    // Keep downloading while the camera flies (Cesium's default
                    // pauses requests during fast moves, so a city only started
                    // loading once we arrived)
                    cullRequestsWhileMoving: false,
                    // Jump towards full detail instead of sharpening one level
                    // at a time
                    skipLevelOfDetail: true,
                    baseScreenSpaceError: 1024,
                    skipScreenSpaceErrorFactor: 16,
                    skipLevels: 1,
                    loadSiblings: false
                });
                scene.primitives.add(tiles);
                tileset = tiles;
                scene.globe.show = false; // the tiles include the ground
            } catch (e) {
                console.warn('Google 3D tiles unavailable, using the flat globe', e);
                tiles = null;
            }
        }
        if (!tiles) {
            flat = true;
            viewer.imageryLayers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({
                url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                maximumLevel: 19,
                credit: new Cesium.Credit('Esri, Maxar, Earthstar Geographics')
            }));
            scene.globe.baseColor = Cesium.Color.fromCssColorString('#1a1a2e');
        }
        status.hidden = true;

        // Stop drawing while the section is off screen
        new IntersectionObserver(entries => {
            viewer.useDefaultRenderLoop = entries[0].isIntersecting;
            if (entries[0].isIntersecting && resumeCircle) {
                const resume = resumeCircle;
                resumeCircle = null;
                resume();
            }
        }).observe(stage);

        setPose(Object.assign({}, INTRO));
        ready = true;
        if (wanted !== 'intro') goTo(wanted);
    }

    function init() {
        const section = document.getElementById('journey');
        if (!section) return;
        const stage = section.querySelector('.journey-stage');

        const dots = section.querySelector('.journey-progress');
        STOPS.forEach(() => {
            const dot = document.createElement('div');
            dot.className = 'journey-dot';
            dots.appendChild(dot);
        });

        watchCards();

        // Start the globe (and use one of the day's Google tile loads) only
        // when the section is about to come into view
        const starter = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting) {
                starter.disconnect();
                startGlobe(stage);
            }
        }, { rootMargin: '600px 0px' });
        starter.observe(section);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

(function () {
    'use strict';

    const LOCATIONS = [
        { name: 'Rochester, NY', detail: 'Born', lat: 43.1566, lon: -77.6088, years: '1998' },
        { name: 'Albany, NY', detail: 'Childhood', lat: 42.6526, lon: -73.7562, years: '2001–2016' },
        { name: 'Newark, DE', detail: 'University of Delaware · Electrical Engineering', lat: 39.6837, lon: -75.7497, years: '2016–2020' },
        { name: 'Houston, TX', detail: 'ExxonMobil Field Engineering', lat: 29.7604, lon: -95.3698, years: '2020–2021' },
        { name: 'Richland, WA', detail: 'AWS Controls Engineering', lat: 46.2856, lon: -119.2845, years: '2021–2022' },
        { name: 'Boulder, CO', detail: 'AWS Systems Development Engineering', lat: 40.0150, lon: -105.2705, years: '2022–2026' },
        { name: 'Superior, CO', detail: 'Purchased a house · AWS Systems Development Engineering', lat: 39.9528, lon: -105.1686, years: '2026–Present' }
    ];

    const FLIGHT_DURATION = 2.5;
    const PAUSE_DURATION = 2500;
    const ZOOM_HEIGHT = 80000;
    const OVERVIEW_HEIGHT = 15000000;

    let viewer = null;
    let animationRunning = false;
    let skipRequested = false;
    let entities = [];

    function initGlobe() {
        const container = document.getElementById('life-journey-globe');
        if (!container) return;

        if (typeof Cesium === 'undefined') {
            container.innerHTML = '<p style="color:#aaa;text-align:center;padding:40px;">Failed to load 3D globe library.</p>';
            return;
        }

        try {
            // Hide the scroll hint
            const hint = container.querySelector('.journey-scroll-hint');
            if (hint) hint.style.display = 'none';

            // Prevent Cesium from trying to reach Ion at all
            Cesium.Ion.defaultAccessToken = '';

            // Create the viewer with NO default imagery (we add our own after)
            viewer = new Cesium.Viewer('life-journey-globe', {
                baseLayer: false,  // no default layer — we add OSM manually
                terrain: Cesium.Terrain.fromWorldTerrain ? undefined : undefined,
                baseLayerPicker: false,
                geocoder: false,
                homeButton: false,
                sceneModePicker: false,
                selectionIndicator: false,
                navigationHelpButton: false,
                animation: false,
                timeline: false,
                fullscreenButton: false,
                infoBox: false,
                creditContainer: document.createElement('div'),
                skyBox: false,
                scene3DOnly: true,
                requestRenderMode: false,
                maximumRenderTimeChange: Infinity
            });

            // Add ESRI World Imagery (satellite) tiles
            viewer.imageryLayers.addImageryProvider(
                new Cesium.UrlTemplateImageryProvider({
                    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                    maximumLevel: 19,
                    credit: new Cesium.Credit('Esri, Maxar, Earthstar Geographics')
                })
            );

            // Style the scene
            viewer.scene.backgroundColor = Cesium.Color.BLACK;
            viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#1a1a2e');
            viewer.scene.globe.enableLighting = false;
            viewer.scene.globe.showGroundAtmosphere = true;

            // Add atmosphere
            if (viewer.scene.skyAtmosphere) {
                viewer.scene.skyAtmosphere.show = true;
            }

            // Force a render to make sure the globe appears
            viewer.scene.requestRender();

            // Add a transparent overlay that lets wheel events scroll the page.
            // Clicking the overlay removes it so the user can interact with the globe.
            const scrollGuard = document.createElement('div');
            scrollGuard.className = 'journey-scroll-guard';
            scrollGuard.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;cursor:grab;';
            container.style.position = 'relative';
            container.appendChild(scrollGuard);

            // "Click to interact" prompt on the guard
            const guardPrompt = document.createElement('div');
            const isMobile = window.matchMedia('(max-width: 768px)').matches;
            guardPrompt.textContent = isMobile ? 'Tap to interact' : 'Click to interact';
            guardPrompt.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
                'color:rgba(255,255,255,0.8);font-size:1.2em;background:rgba(0,0,0,0.5);' +
                'padding:10px 22px;border-radius:20px;pointer-events:none;opacity:0;transition:opacity 0.3s ease;';
            scrollGuard.appendChild(guardPrompt);

            let guardPromptTimeout = null;
            function showGuardPrompt() {
                if (animationRunning) return;
                guardPrompt.style.opacity = '1';
                clearTimeout(guardPromptTimeout);
                guardPromptTimeout = setTimeout(() => { guardPrompt.style.opacity = '0'; }, 1500);
            }

            scrollGuard.addEventListener('wheel', showGuardPrompt, { passive: true });
            scrollGuard.addEventListener('mousemove', showGuardPrompt);

            scrollGuard.addEventListener('click', function () {
                scrollGuard.style.pointerEvents = 'none';
                guardPrompt.style.opacity = '0';
            });

            // Re-enable guard when mouse leaves the container
            container.addEventListener('mouseleave', function () {
                if (!animationRunning) {
                    scrollGuard.style.pointerEvents = 'auto';
                }
            });

        } catch (e) {
            console.error('Cesium Viewer init failed:', e);
            container.innerHTML = '<p style="color:#f66;text-align:center;padding:40px;">Error initializing 3D globe. Check console.</p>';
            return;
        }

        setInteraction(false);
        addLocationPins();
        buildProgressDots();
        startJourney();
    }

    function setInteraction(enabled) {
        const ctrl = viewer.scene.screenSpaceCameraController;
        ctrl.enableRotate = enabled;
        ctrl.enableTranslate = enabled;
        ctrl.enableTilt = enabled;
        ctrl.enableLook = enabled;
        ctrl.enableZoom = enabled;
    }

    function addLocationPins() {
        LOCATIONS.forEach((loc, i) => {
            // Offset nearby labels so they don't overlap
            let labelPixelOffset = new Cesium.Cartesian2(0, -15);
            let labelHAlign = Cesium.HorizontalOrigin.CENTER;
            if (loc.name === 'Rochester, NY') {
                labelPixelOffset = new Cesium.Cartesian2(-1, -15);
                labelHAlign = Cesium.HorizontalOrigin.RIGHT;
            } else if (loc.name === 'Albany, NY') {
                labelPixelOffset = new Cesium.Cartesian2(1, -15);
                labelHAlign = Cesium.HorizontalOrigin.LEFT;
            } else if (loc.name === 'Boulder, CO') {
                labelPixelOffset = new Cesium.Cartesian2(-6, -15);
                labelHAlign = Cesium.HorizontalOrigin.RIGHT;
            } else if (loc.name === 'Superior, CO') {
                labelPixelOffset = new Cesium.Cartesian2(6, -15);
                labelHAlign = Cesium.HorizontalOrigin.LEFT;
            }

            const entity = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat),
                point: {
                    pixelSize: 0,
                    color: Cesium.Color.fromCssColorString('#4CAF50'),
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    eyeOffset: new Cesium.Cartesian3(0, 0, -1) // behind labels
                },
                label: {
                    text: '',
                    font: '14px Arial',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    horizontalOrigin: labelHAlign,
                    pixelOffset: labelPixelOffset,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    eyeOffset: new Cesium.Cartesian3(0, 0, -2), // in front of pins
                    showBackground: true,
                    backgroundColor: new Cesium.Color(0, 0, 0, 0.7),
                    backgroundPadding: new Cesium.Cartesian2(8, 5),
                    show: false
                }
            });
            entities.push(entity);
        });
    }

    function revealPin(index) {
        const entity = entities[index];
        const loc = LOCATIONS[index];
        entity.point.pixelSize = 10;
        entity.label.text = loc.name;
        entity.label.show = true;
    }

    function addArcLine(fromIndex, toIndex) {
        const from = LOCATIONS[fromIndex];
        const to = LOCATIONS[toIndex];
        // Static line (used for ensure-all-visible at the end)
        viewer.entities.add({
            polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray([
                    from.lon, from.lat, to.lon, to.lat
                ]),
                width: 2,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.15,
                    color: Cesium.Color.fromCssColorString('#4CAF50').withAlpha(0.6)
                }),
                clampToGround: true
            }
        });
    }

    function animateArcLine(fromIndex, toIndex, durationMs) {
        return new Promise((resolve) => {
            const from = LOCATIONS[fromIndex];
            const to = LOCATIONS[toIndex];
            const startTime = performance.now();
            let entity = null;

            function interpolate(t) {
                const lon = from.lon + (to.lon - from.lon) * t;
                const lat = from.lat + (to.lat - from.lat) * t;
                return [lon, lat];
            }

            // Use a CallbackProperty so the line grows each frame
            let progress = 0;
            entity = viewer.entities.add({
                polyline: {
                    positions: new Cesium.CallbackProperty(() => {
                        const steps = Math.max(2, Math.floor(progress * 20) + 2);
                        const coords = [];
                        for (let s = 0; s <= steps - 1; s++) {
                            const t = (s / (steps - 1)) * progress;
                            const [lon, lat] = interpolate(t);
                            coords.push(lon, lat);
                        }
                        return Cesium.Cartesian3.fromDegreesArray(coords);
                    }, false),
                    width: 2,
                    material: new Cesium.PolylineGlowMaterialProperty({
                        glowPower: 0.15,
                        color: Cesium.Color.fromCssColorString('#4CAF50').withAlpha(0.6)
                    }),
                    clampToGround: true
                }
            });

            function tick() {
                const elapsed = performance.now() - startTime;
                progress = Math.min(elapsed / durationMs, 1);
                if (progress < 1 && !skipRequested) {
                    requestAnimationFrame(tick);
                } else {
                    // Replace with a static line so CallbackProperty stops
                    viewer.entities.remove(entity);
                    addArcLine(fromIndex, toIndex);
                    resolve();
                }
            }
            requestAnimationFrame(tick);
        });
    }

    function buildProgressDots() {
        const container = document.querySelector('.journey-progress');
        if (!container) return;
        container.innerHTML = '';
        LOCATIONS.forEach((loc) => {
            const dot = document.createElement('div');
            dot.className = 'journey-dot';
            dot.title = loc.name;
            container.appendChild(dot);
        });
    }

    function updateProgressDot(index) {
        document.querySelectorAll('.journey-dot').forEach((dot, i) => {
            if (i < index) dot.className = 'journey-dot visited';
            else if (i === index) dot.className = 'journey-dot active';
            else dot.className = 'journey-dot';
        });
    }

    function updateOverlay(index) {
        const nameEl = document.querySelector('.journey-location-name');
        const detailEl = document.querySelector('.journey-location-detail');
        const overlay = document.querySelector('.journey-overlay');
        if (!nameEl || !overlay) return;
        overlay.classList.remove('hidden');
        const loc = LOCATIONS[index];
        nameEl.textContent = loc.name;
        detailEl.textContent = loc.detail + ' · ' + loc.years;
    }

    function hideOverlay() {
        const overlay = document.querySelector('.journey-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    function flyTo(lat, lon, height, duration) {
        return new Promise((resolve) => {
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
                orientation: {
                    heading: Cesium.Math.toRadians(0),
                    pitch: Cesium.Math.toRadians(-90),
                    roll: 0
                },
                duration: duration,
                complete: resolve,
                cancel: resolve
            });
        });
    }

    function wait(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function spinGlobe(durationMs) {
        return new Promise((resolve) => {
            const startTime = performance.now();
            const startLon = -98; // start over the US
            const lat = 40;
            const height = 12000000;

            function tick() {
                if (skipRequested) { resolve(); return; }
                const elapsed = performance.now() - startTime;
                const progress = Math.min(elapsed / durationMs, 1);
                // Ease in-out for smooth start/stop
                const eased = progress < 0.5
                    ? 2 * progress * progress
                    : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                const lon = startLon - 360 * eased;

                viewer.camera.setView({
                    destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
                    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 }
                });

                if (progress < 1) {
                    requestAnimationFrame(tick);
                } else {
                    resolve();
                }
            }
            requestAnimationFrame(tick);
        });
    }

    async function startJourney() {
        animationRunning = true;
        skipRequested = false;

        const skipBtn = document.querySelector('.journey-skip-btn');
        const replayBtn = document.querySelector('.journey-replay-btn');
        if (skipBtn) skipBtn.classList.remove('hidden');
        if (replayBtn) replayBtn.style.display = 'none';

        // Reset pins
        entities.forEach((e) => {
            e.point.pixelSize = 0;
            e.label.show = false;
        });

        // Remove old arc lines
        const toRemove = [];
        viewer.entities.values.forEach(e => { if (e.polyline) toRemove.push(e); });
        toRemove.forEach(e => viewer.entities.remove(e));

        // Start zoomed out with Earth visible, tilted at an angle
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(-75, 0, 25000000),
            orientation: {
                heading: Cesium.Math.toRadians(350),
                pitch: Cesium.Math.toRadians(-80),
                roll: 0
            }
        });

        await wait(600);

        // Slow cinematic dive into Rochester, straightening out as we descend
        if (!skipRequested) {
            await new Promise((resolve) => {
                viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(
                        LOCATIONS[0].lon, LOCATIONS[0].lat, ZOOM_HEIGHT
                    ),
                    orientation: {
                        heading: Cesium.Math.toRadians(0),
                        pitch: Cesium.Math.toRadians(-90),
                        roll: 0
                    },
                    duration: 5,
                    complete: resolve,
                    cancel: resolve
                });
            });
        }

        // Reveal first pin and pause
        if (!skipRequested) {
            revealPin(0);
            updateProgressDot(0);
            updateOverlay(0);
            await wait(skipRequested ? 300 : PAUSE_DURATION);
        }

        // Continue with remaining locations (start from index 1)
        for (let i = 1; i < LOCATIONS.length; i++) {
            if (skipRequested) break;
            const loc = LOCATIONS[i];
            hideOverlay();
            await flyTo(loc.lat, loc.lon, ZOOM_HEIGHT, skipRequested ? 0.3 : FLIGHT_DURATION);
            if (skipRequested) break;
            revealPin(i);
            updateProgressDot(i);
            updateOverlay(i);
            // Show the arc line from previous location
            addArcLine(i - 1, i);
            await wait(skipRequested ? 300 : PAUSE_DURATION);
        }

        // Ensure all pins visible
        LOCATIONS.forEach((_, i) => {
            revealPin(i);
            if (i > 0) addArcLine(i - 1, i);
        });
        updateProgressDot(LOCATIONS.length - 1);

        hideOverlay();
        await flyTo(39, -98, OVERVIEW_HEIGHT, skipRequested ? 0.5 : 3);

        document.querySelectorAll('.journey-dot').forEach(d => d.className = 'journey-dot visited');

        setInteraction(true);
        animationRunning = false;

        if (skipBtn) skipBtn.classList.add('hidden');
        if (replayBtn) replayBtn.style.display = 'block';
    }

    function skipAnimation() { skipRequested = true; }

    function replayAnimation() {
        if (animationRunning) return;
        setInteraction(false);
        // Re-enable the scroll guard so "click to interact" is required again after replay
        const guard = document.querySelector('.journey-scroll-guard');
        if (guard) guard.style.pointerEvents = 'auto';
        startJourney();
    }

    function init() {
        const section = document.querySelector('.life-journey-section');
        if (!section) return;

        const skipBtn = document.querySelector('.journey-skip-btn');
        const replayBtn = document.querySelector('.journey-replay-btn');
        if (skipBtn) {
            skipBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                skipAnimation();
            });
        }
        if (replayBtn) {
            replayBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                replayAnimation();
            });
        }

        // Place a sentinel element right after the globe container (not inside it,
        // since the globe has overflow:hidden). When this 1px element scrolls into
        // view, the full globe container is visible and we start the animation.
        const sentinel = document.createElement('div');
        sentinel.style.height = '1px';
        sentinel.style.width = '100%';
        sentinel.style.pointerEvents = 'none';
        const globeEl = document.getElementById('life-journey-globe');
        if (globeEl && globeEl.parentNode) {
            globeEl.parentNode.insertBefore(sentinel, globeEl.nextSibling);
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !viewer) {
                    initGlobe();
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 1.0 });

        observer.observe(sentinel);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

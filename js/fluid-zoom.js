// Fluid wheel / trackpad zoom for every Leaflet map on the site.
//
// Load right after leaflet.js; every map created afterwards gets it through an
// init hook (opt out with `L.map(el, { fluidZoom: false })`).
//
// Leaflet's own wheel handler turns each 40 ms batch of wheel input into a
// separate 250 ms zoom animation, so zoom arrives as jumps, and Leaflet 1.9.4
// divides the input by 3× the pixel ratio on a Mac (2× elsewhere), so it
// crawls. This replaces it with the glide Google Maps and MapLibre use: every
// wheel event nudges a target zoom in proportion to how far it scrolled, and
// the map eases toward that target frame by frame, keeping the point under the
// cursor still. A mouse-wheel notch (≈100 px on every OS) is one level; a
// trackpad pinch or a free-spinning wheel streams small deltas that add up
// smoothly. Don't classify events into "notches": touchpads and hi-res mice mix
// small and large deltas, and treating the large ones as whole levels made
// zoom stutter.
//
// Also here:
//   • leaflet-gesture-handling (ctrl/⌘ + scroll to zoom) switches wheel zoom on
//     too late for the first ctrl/⌘+wheel event; that's fixed.
//   • Safari sends trackpad pinches as gesture* events, which Leaflet ignores
//     (the pinch zoomed the page); they're followed like a touch pinch.
//   • L.ZoomFollower keeps a hand-drawn overlay (a canvas or SVG that redraws
//     on moveend) glued to the map while it zooms.
// Touch pinch is Leaflet's own TouchZoom and already follows the fingers.

(function () {
    const WHEEL_PX_PER_LEVEL = 100;            // one mouse-wheel notch ≈ one zoom level
    const PINCH_PX_PER_LEVEL = 100 * Math.LN2; // Chrome/Edge/Firefox send a trackpad pinch as ctrl+wheel with deltaY = −100·ln(scale)
    const WHEEL_EASE_MS = 60;                  // time constant of the glide: a notch lands in ~200 ms
    const MAX_EVENT_LEVELS = 2;                // one event never moves the target further (accelerated wheels)
    const SETTLE_SNAP = 0.1;                   // glides end on tenths of a level
    const SNAP_AFTER_MS = 250;                 // input quiet this long → settle onto the map's zoomSnap (a pinch streams events far faster)

    // How many zoom levels one wheel event asks for (+ = in).
    function wheelZoomLevels(e) {
        if (!e.deltaY) return 0;  // horizontal scroll
        // Lines (Firefox's mouse wheel, 3 per notch) and pages to pixels.
        let px = e.deltaY * (e.deltaMode === 1 ? WHEEL_PX_PER_LEVEL / 3 : e.deltaMode === 2 ? 800 : 1);
        if (L.Browser.gecko && e.deltaMode === 0) px /= window.devicePixelRatio || 1;  // Firefox doubles them on Retina
        // A pinch arrives as ctrl+wheel with small fractional deltas; scale it
        // so the map follows the fingers.
        const pinch = e.ctrlKey && !Number.isInteger(px) && Math.abs(px) < 10;
        const levels = -px / (pinch ? PINCH_PX_PER_LEVEL : WHEEL_PX_PER_LEVEL);
        return Math.max(-MAX_EVENT_LEVELS, Math.min(MAX_EVENT_LEVELS, levels));
    }

    function enableFluidZoom(map) {
        const wheel = map.scrollWheelZoom;
        if (!wheel) return;
        // Unbind Leaflet's own listener before swapping the method: disable()
        // removes whatever `_onWheelScroll` is at the time, so swapping first
        // would leave Leaflet's handler bound and every notch would zoom twice.
        const wasEnabled = wheel.enabled();
        if (wasEnabled) wheel.disable();
        // The glide in progress: target zoom, current zoom, and the spot that
        // stays under the cursor.
        let glide = null, glideFrame = 0, lastTime = 0;

        // Where the glide settles once the wheel has gone quiet: the target,
        // rounded to a tenth of a level (or the map's zoomSnap, if finer) —
        // close enough to where the fingers stopped that the settle is
        // invisible, unlike snapping a whole-level map back by up to half a
        // level. The map's own zoomSnap still governs buttons and fitBounds.
        // The target itself is left alone, so input that resumes after a
        // pause adds to what was asked.
        function settleZoom(g, now) {
            const snap = Math.min(map.options.zoomSnap || 0, SETTLE_SNAP) || 0;
            if (!snap || now - g.lastInput < SNAP_AFTER_MS) return g.target;
            const z = Math.round(g.target / snap) * snap;
            return Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), z));
        }

        function step(now) {
            glideFrame = 0;
            // rAF stamps a frame with its start, which can be just before the
            // event that scheduled it.
            const dt = Math.max(4, Math.min(64, now - lastTime));
            lastTime = now;
            const g = glide;
            const clock = performance.now();
            const goal = settleZoom(g, clock);
            g.zoom += (goal - g.zoom) * (1 - Math.exp(-dt / WHEEL_EASE_MS));
            const done = clock - g.lastInput >= SNAP_AFTER_MS && Math.abs(goal - g.zoom) < 0.002;
            if (done) g.zoom = goal;
            const offset = g.point.subtract(map.getSize().divideBy(2));
            let center = map.unproject(map.project(g.latlng, g.zoom).subtract(offset), g.zoom);
            if (map.options.maxBounds) center = map._limitCenter(center, g.zoom, map.options.maxBounds);
            if (done) {
                glide = null;
                map._move(center, g.zoom)._moveEnd(true);  // zoomend + moveend: tiles load, layers redraw
            } else {
                // `flyTo` is how Leaflet's own flyTo moves the map every frame:
                // tiles and vectors are scaled, not reloaded, until the end.
                map._move(center, g.zoom, { flyTo: true });
                glideFrame = L.Util.requestAnimFrame(step);
            }
        }

        // Stop gliding where the map is now (a drag, a button zoom, …).
        function stopGlide() {
            if (!glide) return;
            L.Util.cancelAnimFrame(glideFrame);
            glideFrame = 0;
            glide = null;
            map._moveEnd(true);
        }
        const leafletStop = map._stop;
        map._stop = function () {
            stopGlide();
            return leafletStop.apply(this, arguments);
        };

        wheel._onWheelScroll = function (e) {
            L.DomEvent.stop(e);
            const levels = wheelZoomLevels(e);
            if (!levels || map._animatingZoom) return;
            if (!glide) {
                map._stop();  // pan inertia, flyTo
                glide = { zoom: map.getZoom(), target: map.getZoom() };
                map._moveStart(true, false);
            }
            // Re-anchor on the cursor every event, so moving the mouse while
            // zooming zooms toward wherever it now points.
            glide.point = map.options.scrollWheelZoom === 'center'
                ? map.getSize().divideBy(2) : map.mouseEventToContainerPoint(e);
            glide.latlng = map.containerPointToLatLng(glide.point);
            glide.target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), glide.target + levels));
            glide.lastInput = performance.now();
            if (!glideFrame) {
                lastTime = performance.now();
                glideFrame = L.Util.requestAnimFrame(step);
            }
        };

        if (wasEnabled) wheel.enable();  // binds the method above

        // leaflet-gesture-handling switches wheel zoom on from inside the first
        // ctrl/⌘+wheel event, too late for that event to reach it, so the first
        // notch after scrolling the page did nothing. Switch it on one step
        // earlier, in the capture phase of the same event.
        if (map.options.gestureHandling) {
            map.getContainer().addEventListener('wheel', e => {
                if ((e.ctrlKey || e.metaKey) && !wheel.enabled()) wheel.enable();
            }, { capture: true, passive: true });
        }

        // Safari on a Mac sends trackpad pinches as gesture events, not wheel
        // events, and Leaflet ignores them — the pinch zoomed the whole page.
        // Follow them the way Leaflet's TouchZoom follows a touch pinch: move
        // the map every frame around the point under the cursor, snap at the
        // end. Touch devices fire these alongside touch events, which TouchZoom
        // handles (L.Browser.touch is true for any pointer-events browser,
        // desktop Safari included, so test for real touch events).
        if (L.Browser.touchNative || map.options.scrollWheelZoom === false) return;
        const el = map.getContainer();
        let pinch = null, frame = 0;
        el.addEventListener('gesturestart', e => {
            e.preventDefault();
            map._stop();
            const pt = map.mouseEventToContainerPoint(e);
            pinch = { zoom: map.getZoom(), latlng: map.containerPointToLatLng(pt), center: map.getCenter(), at: map.getZoom() };
            map._moveStart(true, false);
        });
        el.addEventListener('gesturechange', e => {
            e.preventDefault();
            if (!pinch) return;
            const zoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), pinch.zoom + Math.log2(e.scale)));
            const offset = map.mouseEventToContainerPoint(e).subtract(map.getSize().divideBy(2));
            pinch.at = zoom;
            pinch.center = map.unproject(map.project(pinch.latlng, zoom).subtract(offset), zoom);
            L.Util.cancelAnimFrame(frame);
            frame = L.Util.requestAnimFrame(() => map._move(pinch.center, pinch.at, { pinch: true, round: false }), null, true);
        });
        el.addEventListener('gestureend', e => {
            e.preventDefault();
            if (!pinch) return;
            L.Util.cancelAnimFrame(frame);
            const { center, at, zoom } = pinch;
            pinch = null;
            if (at === zoom) { map._moveEnd(false); return; }  // fingers didn't move
            if (map._zoomAnimated) map._animateZoom(center, map._limitZoom(at), true, map.options.zoomSnap);
            else map._resetView(center, map._limitZoom(at));
        });
    }

    L.Map.mergeOptions({ fluidZoom: true });
    L.Map.addInitHook(function () {
        if (this.options.fluidZoom) enableFluidZoom(this);
    });

    // Keeps a hand-drawn overlay element glued to the map while it zooms — a
    // wheel glide, a pinch, or Leaflet's zoom animation — for layers that only
    // redraw on moveend/zoomend. Call drawn() after every redraw, once the
    // element has been positioned with L.DomUtil.setPosition (which also clears
    // the zoom transform).
    //
    //     this._follow = new L.ZoomFollower(this._canvas).addTo(map);   // onAdd
    //     this._follow.remove();                                        // onRemove
    //     this._follow.drawn();                                         // end of redraw
    //
    // `{ composite: true }` promotes the element to its own compositor layer
    // so scaling it doesn't re-render it every frame (heavy SVG filters).
    L.ZoomFollower = L.Class.extend({
        options: { composite: false },
        initialize(el, options) {
            this._el = el;
            L.setOptions(this, options);
        },
        addTo(map) {
            this._map = map;
            if (map._zoomAnimated) L.DomUtil.addClass(this._el, 'leaflet-zoom-animated');
            if (this.options.composite) this._el.style.willChange = 'transform';
            map.on('zoom', this._onZoom, this);
            map.on('zoomanim', this._onZoomAnim, this);
            return this;
        },
        remove() {
            if (!this._map) return this;
            this._map.off('zoom', this._onZoom, this);
            this._map.off('zoomanim', this._onZoomAnim, this);
            this._map = null;
            return this;
        },
        drawn() {
            const map = this._map;
            if (!map) return;
            this._zoom = map.getZoom();
            this._topLeft = map.layerPointToLatLng(L.DomUtil.getPosition(this._el));
        },
        _onZoom() {
            this._transform(this._map.getZoom(), this._map.getCenter());
        },
        _onZoomAnim(e) {
            this._transform(e.zoom, e.center);
        },
        _transform(zoom, center) {
            if (!this._topLeft) return;
            const map = this._map;
            const scale = map.getZoomScale(zoom, this._zoom);
            const offset = map._latLngToNewLayerPoint(this._topLeft, zoom, center);
            L.DomUtil.setTransform(this._el, offset, scale);
        },
    });
})();

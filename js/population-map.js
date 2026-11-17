// World Population Map (population-map.html) — every GeoNames place of 500+
// people as a bubble whose area is proportional to its population.
//
// Data: data/population/tier-{0,1,2}.txt, built by
// scripts/build-world-population.py (100k+, 10k–100k, 500–10k people; rows
// biggest first, `name|countryIdx|regionIdx|lat|lng|pop`) plus places.json
// (country / region name tables). Tier 0 and 1 load at once; tier 2 (~145k
// villages, ~2.5 MB gzipped) only once the map is zoomed in far enough for
// them to be visible, or when the search box is used.
//
// The Cities | Metro areas switch swaps in data/population/metros.txt (GHSL
// Functional Urban Areas: 9,031 metro areas = urban centre + commuting zone,
// `name|countryIdx|altName|lat|lng|pop|urbanCentrePop`), loaded on first use.
// Each view is its own store (CITY / METRO); `P` points at the one shown, so
// drawing, hit-testing, search and the In View panel all follow the switch.
//
// Rendering: one canvas overlay (BubbleLayer, same pattern as the World Travel
// Map's CanvasOverlay) redrawn at each moveend and scaled by Leaflet's zoom
// animation in between. Points are stored pre-projected (Web Mercator 0..1)
// in typed arrays, so a redraw is a multiply and a bounds check per place.
// Bubbles grow by 2^(0.55·zoom) — slower than the map's 2^zoom, so a city
// doesn't swallow the screen — and a place is skipped while its bubble is
// under half a pixel, which is why the towns appear as you zoom in.
// Hover / tap hit-testing goes through a screen-space grid built during the
// draw; the smallest bubble under the pointer wins.

(function () {
    const TIERS = ['data/population/tier-0.txt', 'data/population/tier-1.txt', 'data/population/tier-2.txt'];
    const METROS = 'data/population/metros.txt';
    const MODE_KEY = 'population_map_mode';
    const TIER2_ZOOM = 4.4;          // below this every tier-2 place (<10k) is < ~1 px
    const R_K = 0.004;               // 1M people → 4 px at zoom 2
    const R_GROWTH = 0.55;           // bubble growth per zoom level (log2)
    const R_MIN = 0.45, R_MAX = 170;
    const GRID = 32;                 // hit-test grid cell, px
    const CAP = 200000;

    // One hue per theme, small → large (sequential: dim → bright on the dark
    // basemap, light → dark on the light ones).
    const RAMP_DARK = ['#8a4a12', '#a85d14', '#c77518', '#e08f22', '#f3aa3c', '#fcc565', '#ffe09a'];
    const RAMP_LIGHT = ['#f4a96a', '#ec8d45', '#de722b', '#c95d1b', '#ab4813', '#8a370d', '#6b2809'];
    const LOG_LO = 2.7, LOG_HI = 7.4;  // log10 of 500 and ~25M

    // ── Place store ─────────────────────────────────────────────────────────
    function makeStore(kind, cap) {
        return {
            kind, n: 0,
            name: [], alt: [], country: new Uint16Array(cap), region: new Uint16Array(cap),
            lat: new Float32Array(cap), lng: new Float32Array(cap),
            mx: new Float64Array(cap), my: new Float64Array(cap),
            pop: new Uint32Array(cap), core: new Uint32Array(kind === 'metros' ? cap : 0),
            bucket: new Uint8Array(cap),
            keys: [],  // normalised names for search, filled lazily
        };
    }
    const CITY = makeStore('cities', CAP);
    const METRO = makeStore('metros', 10000);
    let P = CITY;
    let tables = { countries: [], regions: [] };
    const tierState = [null, null, null];   // null | 'loading' | 'done'
    let metroState = null;

    let map, layer, highlight, mapIsDark = true;
    let pinned = -1;   // place whose tip is pinned by a tap / search pick

    const fmt = new Intl.NumberFormat('en-US');
    const fmtCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

    function radius(pop, zoom) {
        return R_K * Math.sqrt(pop) * Math.pow(2, R_GROWTH * (zoom - 2));
    }

    function bucketOf(pop) {
        const t = (Math.log10(pop) - LOG_LO) / (LOG_HI - LOG_LO);
        return Math.max(0, Math.min(RAMP_DARK.length - 1, Math.floor(t * RAMP_DARK.length)));
    }

    function ramp() { return mapIsDark ? RAMP_DARK : RAMP_LIGHT; }

    function normalise(s) {
        return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    }

    function placeLabel(i) {
        const country = tables.countries[P.country[i]];
        if (P.kind === 'metros') return P.alt[i] ? `${country} · incl. ${P.alt[i]}` : country;
        return [tables.regions[P.region[i]], country].filter(Boolean).join(', ');
    }

    const noun = (n) => P.kind === 'metros' ? (n === 1 ? 'metro area' : 'metro areas') : (n === 1 ? 'place' : 'places');

    function addRows(S, text) {
        const metro = S.kind === 'metros';
        for (const line of text.split('\n')) {
            if (!line) continue;
            const f = line.split('|');
            const i = S.n++;
            const lat = +f[3], lng = +f[4], pop = +f[5];
            S.name[i] = f[0];
            S.country[i] = +f[1];
            if (metro) { S.alt[i] = f[2]; S.core[i] = +f[6]; }
            else S.region[i] = +f[2];
            S.lat[i] = lat; S.lng[i] = lng;
            S.pop[i] = pop;
            S.bucket[i] = bucketOf(pop);
            S.mx[i] = (lng + 180) / 360;
            const c = Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI / 180;
            S.my[i] = (1 - Math.log(Math.tan(c) + 1 / Math.cos(c)) / Math.PI) / 2;
        }
    }

    function fetchText(url) {
        return fetch(url).then(r => {
            if (!r.ok) throw new Error(r.status);
            return r.text();
        });
    }

    let tablesLoaded = null;
    function loadTables() {
        return tablesLoaded ||= fetch('data/population/places.json').then(r => r.json()).then(t => { tables = t; });
    }

    function loadMetros() {
        if (metroState) return Promise.resolve();
        metroState = 'loading';
        updateStatus();
        return Promise.all([loadTables(), fetchText(METROS)]).then(([, text]) => {
            addRows(METRO, text);
            metroState = 'done';
            layer && layer.redraw();
        }).catch(err => {
            metroState = null;
            setStatus('Couldn\u2019t load metro areas (' + err.message + ') \u2014 try reloading.');
        });
    }

    // Tiers must land in order (indices are population ranks), so each waits
    // for the one before it.
    let loadChain = Promise.resolve();
    function loadTier(t) {
        if (tierState[t]) return loadChain;
        tierState[t] = 'loading';
        updateStatus();
        const fetched = fetchText(TIERS[t]);
        loadChain = loadChain.then(() => fetched).then(text => {
            addRows(CITY, text);
            tierState[t] = 'done';
            if (layer && P === CITY) layer.redraw();
            updateStatus();
        }).catch(err => {
            tierState[t] = null;
            setStatus('Couldn’t load places (' + err.message + ') — try reloading.');
        });
        return loadChain;
    }

    // ── Canvas overlay ──────────────────────────────────────────────────────
    const BubbleLayer = L.Layer.extend({
        options: { pad: 0.5 },

        onAdd(map) {
            this._canvas = L.DomUtil.create('canvas', 'pop-canvas', this.getPane());
            if (map._zoomAnimated) L.DomUtil.addClass(this._canvas, 'leaflet-zoom-animated');
            this.redraw();
        },

        onRemove() {
            L.Util.cancelAnimFrame(this._frame);
            L.DomUtil.remove(this._canvas);
            this._canvas = null;
        },

        getEvents() {
            const ev = { moveend: this._redrawSoon, viewreset: this.redraw, resize: this.redraw, zoom: this._onZoom };
            if (this._map && this._map._zoomAnimated) ev.zoomanim = this._animateZoom;
            return ev;
        },

        _onZoom() { this._animateZoom({ zoom: this._map.getZoom(), center: this._map.getCenter() }); },

        _redrawSoon() {
            if (this._frame) return;
            this._frame = L.Util.requestAnimFrame(() => {
                this._frame = null;
                if (this._map && !this._map._animatingZoom) this.redraw();
            });
        },

        _animateZoom(e) {
            if (!this._topLeftLatLng) return;
            const scale = this._map.getZoomScale(e.zoom, this._zoom);
            const offset = this._map._latLngToNewLayerPoint(this._topLeftLatLng, e.zoom, e.center);
            L.DomUtil.setTransform(this._canvas, offset, scale);
        },

        redraw() {
            const map = this._map;
            if (!map || !this._canvas) return this;
            const size = map.getSize();
            const pad = Math.round(Math.max(size.x, size.y) * this.options.pad);
            const w = size.x + pad * 2, h = size.y + pad * 2;
            const topLeft = map.containerPointToLayerPoint([-pad, -pad]);
            const zoom = map.getZoom();
            this._topLeftLatLng = map.layerPointToLatLng(topLeft);
            this._topLeft = topLeft;
            this._zoom = zoom;
            this._padPx = pad;

            const dpr = Math.min(2, window.devicePixelRatio || 1);
            const canvas = this._canvas;
            const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
            if (canvas.width !== cw || canvas.height !== ch) {
                canvas.width = cw; canvas.height = ch;
                canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
            }
            L.DomUtil.setPosition(canvas, topLeft);
            this._draw(canvas, w, h, dpr, zoom, pad, size);
            onDrawn(this, zoom);
            return this;
        },

        _draw(canvas, w, h, dpr, zoom, pad, size) {
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            const worldPx = 256 * Math.pow(2, zoom);
            const origin = this._map.getPixelOrigin();
            const ox = this._topLeft.x + origin.x, oy = this._topLeft.y + origin.y;
            const rScale = R_K * Math.pow(2, R_GROWTH * (zoom - 2));
            const colors = ramp();
            const nb = colors.length;

            // Hit-test structures + in-view stats, rebuilt every draw.
            const grid = new Map();
            const big = [];
            const hits = this._hits = { idx: [], x: [], y: [], r: [], grid, big };
            let people = 0, places = 0;
            const top = [];
            const vx0 = pad, vy0 = pad, vx1 = pad + size.x, vy1 = pad + size.y;

            const paths = [];
            for (let b = 0; b < nb; b++) paths.push(new Path2D());

            for (let i = 0; i < P.n; i++) {
                let r = rScale * Math.sqrt(P.pop[i]);
                if (r < R_MIN) continue;
                if (r > R_MAX) r = R_MAX;
                const x = P.mx[i] * worldPx - ox, y = P.my[i] * worldPx - oy;
                if (x < -r || y < -r || x > w + r || y > h + r) continue;
                const path = paths[P.bucket[i]];
                if (r < 1.5) {
                    const s = Math.max(r, 0.6);
                    path.rect(x - s, y - s, s * 2, s * 2);
                } else {
                    path.moveTo(x + r, y);
                    path.arc(x, y, r, 0, Math.PI * 2);
                }
                const k = hits.idx.length;
                hits.idx.push(i); hits.x.push(x); hits.y.push(y); hits.r.push(r);
                if (r > GRID / 2) big.push(k);
                const key = Math.floor(x / GRID) * 65536 + Math.floor(y / GRID);
                const cell = grid.get(key);
                if (cell) cell.push(k); else grid.set(key, [k]);

                if (x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1) {
                    people += P.pop[i];
                    places++;
                    if (top.length < 10) top.push(i);
                }
            }

            // Biggest first so towns sit on top of the cities they ring.
            ctx.globalCompositeOperation = mapIsDark ? 'lighter' : 'source-over';
            for (let b = nb - 1; b >= 0; b--) {
                ctx.fillStyle = colors[b];
                ctx.globalAlpha = mapIsDark ? (zoom < 4 ? 0.34 : 0.42) : 0.5;
                ctx.fill(paths[b]);
                if (zoom >= 3) {
                    ctx.strokeStyle = colors[b];
                    ctx.globalAlpha = mapIsDark ? 0.7 : 0.85;
                    ctx.lineWidth = 1;
                    ctx.stroke(paths[b]);
                }
            }
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            this._stats = { people, places, top };
        },

        // Smallest drawn bubble under a layer point, or -1.
        hitTest(layerPoint) {
            const hits = this._hits;
            if (!hits || !this._topLeft) return -1;
            const px = layerPoint.x - this._topLeft.x, py = layerPoint.y - this._topLeft.y;
            const gx = Math.floor(px / GRID), gy = Math.floor(py / GRID);
            let best = -1, bestR = Infinity, bestD = Infinity;
            const test = k => {
                const dx = hits.x[k] - px, dy = hits.y[k] - py;
                const d = Math.sqrt(dx * dx + dy * dy);
                const r = hits.r[k];
                if (d > Math.max(r, 6)) return;
                if (r < bestR || (r === bestR && d < bestD)) { best = k; bestR = r; bestD = d; }
            };
            for (let ix = gx - 1; ix <= gx + 1; ix++) {
                for (let iy = gy - 1; iy <= gy + 1; iy++) {
                    const cell = hits.grid.get(ix * 65536 + iy);
                    if (cell) cell.forEach(test);
                }
            }
            hits.big.forEach(test);
            return best < 0 ? -1 : hits.idx[best];
        },

        drawnRadius(i) {
            return Math.min(R_MAX, radius(P.pop[i], this._zoom ?? this._map.getZoom()));
        },
    });

    // ── Page wiring ─────────────────────────────────────────────────────────
    function setStatus(text) { document.getElementById('pop-status').textContent = text; }

    function updateStatus() {
        if (P === METRO) {
            if (metroState !== 'done') return setStatus('Loading metro areas…');
            const shown = layer && layer._hits ? layer._hits.idx.length : 0;
            return setStatus(fmt.format(shown) + ' of ' + fmt.format(METRO.n) + ' metro areas drawn');
        }
        if (!tierState[0] || tierState[0] === 'loading') return setStatus('Loading cities…');
        if (tierState[2] === 'loading') return setStatus('Loading towns and villages…');
        const shown = layer && layer._hits ? layer._hits.idx.length : 0;
        if (tierState[2] === 'done') {
            setStatus(fmt.format(shown) + ' places drawn' + (map.getZoom() < 9 ? ' · zoom in for more' : ''));
        } else {
            setStatus(fmt.format(shown) + ' places drawn · zoom in for smaller towns');
        }
    }

    function onDrawn(drawn, zoom) {
        layer = drawn;
        if (P === CITY && zoom >= TIER2_ZOOM && P.n) loadTier(2);
        const s = drawn._stats;
        if (s) {
            document.getElementById('stat-people').textContent = fmtCompact.format(s.people);
            document.getElementById('stat-places').textContent = fmt.format(s.places);
            renderTop(s.top);
        }
        document.getElementById('stat-loaded').textContent = P.n ? fmt.format(P.n) : '–';
        renderLegend(zoom);
        updateStatus();
        if (pinned >= 0) showTip(pinned, true);
    }

    function renderTop(top) {
        const ol = document.getElementById('pop-top');
        ol.innerHTML = '';
        if (!top.length) {
            ol.innerHTML = `<li class="pop-top-empty">No ${noun(2)} in view — try zooming out.</li>`;
            return;
        }
        const max = P.pop[top[0]];
        for (const i of top) {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'pop-top-item';
            btn.innerHTML = `<span class="pop-top-name"></span><span class="pop-top-where"></span>
                <span class="pop-top-bar"><span style="width:${(P.pop[i] / max * 100).toFixed(1)}%"></span></span>
                <span class="pop-top-pop">${fmt.format(P.pop[i])}</span>`;
            btn.querySelector('.pop-top-name').textContent = P.name[i];
            btn.querySelector('.pop-top-where').textContent = placeLabel(i);
            btn.addEventListener('click', () => goTo(i));
            li.appendChild(btn);
            ol.appendChild(li);
        }
    }

    // Nested circles for a few round populations at the current zoom.
    function renderLegend(zoom) {
        const svg = document.getElementById('pop-legend-svg');
        const steps = [1e3, 1e4, 1e5, 1e6, 1e7]
            .map(v => ({ v, r: radius(v, zoom) }))
            .filter(s => s.r >= 3 && s.r <= 46)
            .slice(-3)
            // Each label sits at its circle's top; drop steps that would crowd the next one up.
            .filter((s, k, all) => k === all.length - 1 || all[all.length - 1].r * 2 - s.r * 2 >= 13 && (k + 1 >= all.length || all[k + 1].r - s.r >= 6.5));
        const maxR = steps.length ? steps[steps.length - 1].r : 10;
        const W = maxR * 2 + 58, H = maxR * 2 + 4;
        const cx = maxR + 2, base = H - 2;
        const colors = ramp();
        let out = '';
        for (let k = steps.length - 1; k >= 0; k--) {
            const { v, r } = steps[k];
            const cy = base - r;
            const col = colors[bucketOf(v)];
            out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${col}" fill-opacity="0.25" stroke="${col}" stroke-width="1.2"/>`;
            out += `<line x1="${cx}" y1="${base - 2 * r}" x2="${cx + maxR + 6}" y2="${base - 2 * r}" class="pop-legend-tick"/>`;
            out += `<text x="${cx + maxR + 9}" y="${base - 2 * r + 4}" class="pop-legend-label">${fmtCompact.format(v)}</text>`;
        }
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        svg.setAttribute('aria-label', 'Bubble sizes: ' + steps.map(s => fmtCompact.format(s.v)).join(', ') + ' people');
        svg.innerHTML = out;
    }

    // ── Tooltip + highlight ─────────────────────────────────────────────────
    const tip = () => document.getElementById('pop-tip');

    function showTip(i, isPinned) {
        const el = tip();
        const ll = L.latLng(P.lat[i], P.lng[i]);
        const pt = map.latLngToContainerPoint(ll);
        const size = map.getSize();
        if (pt.x < 0 || pt.y < 0 || pt.x > size.x || pt.y > size.y) { hideTip(); return; }
        el.innerHTML = '<div class="pop-tip-name"></div><div class="pop-tip-where"></div>' +
            `<div class="pop-tip-pop">${fmt.format(P.pop[i])} <span>people</span></div>` +
            (P.kind === 'metros' && P.core[i] ? `<div class="pop-tip-rank">${fmt.format(P.core[i])} in the urban core</div>` : '') +
            `<div class="pop-tip-rank">#${fmt.format(i + 1)} of ${fmt.format(P.n)} ${noun(2)}${P.kind === 'metros' ? ' · 2015' : ' loaded'}</div>`;
        el.querySelector('.pop-tip-name').textContent = P.name[i];
        el.querySelector('.pop-tip-where').textContent = placeLabel(i);
        el.hidden = false;
        const r = layer.drawnRadius(i);
        // Above the bubble when there's room, otherwise below it.
        const tw = el.offsetWidth, th = el.offsetHeight;
        let left = Math.max(6, Math.min(size.x - tw - 6, pt.x - tw / 2));
        let top = pt.y - r - th - 10;
        if (top < 6) top = pt.y + r + 10;
        el.style.left = left + 'px';
        el.style.top = Math.min(size.y - th - 6, top) + 'px';
        el.classList.toggle('pinned', !!isPinned);

        highlight.setLatLng(ll).setRadius(Math.max(r, 3) + 2);
        if (!map.hasLayer(highlight)) highlight.addTo(map);
    }

    function hideTip() {
        tip().hidden = true;
        if (map.hasLayer(highlight)) highlight.remove();
    }

    function goTo(i) {
        pinned = i;
        const p = P.pop[i];
        const zoom = P.kind === 'metros' ? (p >= 5e6 ? 7 : p >= 5e5 ? 8 : 9)
            : p >= 2e6 ? 8 : p >= 2e5 ? 10 : p >= 2e4 ? 11 : 12;
        hideTip();
        map.flyTo([P.lat[i], P.lng[i]], Math.max(zoom, Math.min(map.getZoom(), 13)), { duration: 1.4 });
        document.getElementById('pop-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // ── Search ──────────────────────────────────────────────────────────────
    function setupSearch() {
        const input = document.getElementById('pop-search');
        const list = document.getElementById('pop-results');
        let results = [], active = -1;

        const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; };
        const render = () => {
            list.innerHTML = '';
            results.forEach((i, k) => {
                const li = document.createElement('li');
                li.setAttribute('role', 'option');
                li.id = 'pop-opt-' + k;
                li.className = 'pop-result' + (k === active ? ' active' : '');
                li.innerHTML = '<span class="pop-result-name"></span><span class="pop-result-where"></span>' +
                    `<span class="pop-result-pop">${fmtCompact.format(P.pop[i])}</span>`;
                li.querySelector('.pop-result-name').textContent = P.name[i];
                li.querySelector('.pop-result-where').textContent = placeLabel(i);
                li.addEventListener('mousedown', e => { e.preventDefault(); pick(i); });
                list.appendChild(li);
            });
            list.hidden = !results.length;
            input.setAttribute('aria-expanded', String(!!results.length));
            if (active >= 0) input.setAttribute('aria-activedescendant', 'pop-opt-' + active);
            else input.removeAttribute('aria-activedescendant');
        };
        const pick = i => { input.value = P.name[i]; close(); goTo(i); };

        const search = () => {
            const q = normalise(input.value.trim());
            if (q.length < 2) { results = []; render(); return; }
            for (let i = P.keys.length; i < P.n; i++) P.keys[i] = normalise(P.alt[i] ? P.name[i] + ' ' + P.alt[i] : P.name[i]);
            const starts = [], words = [];
            const sq = ' ' + q;
            for (let i = 0; i < P.n && starts.length < 8; i++) {
                const k = P.keys[i];
                if (k.startsWith(q)) starts.push(i);
                else if (words.length < 8 && k.includes(sq)) words.push(i);
            }
            results = starts.concat(words).slice(0, 8);
            active = results.length ? 0 : -1;
            render();
        };

        input.addEventListener('focus', () => (P === CITY ? loadTier(2) : loadMetros()).then(() => { if (input.value) search(); }));
        document.addEventListener('pop-mode', () => { input.value = ''; results = []; render(); });
        input.addEventListener('input', search);
        input.addEventListener('blur', close);
        input.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown' && results.length) { active = (active + 1) % results.length; render(); e.preventDefault(); }
            else if (e.key === 'ArrowUp' && results.length) { active = (active - 1 + results.length) % results.length; render(); e.preventDefault(); }
            else if (e.key === 'Enter' && active >= 0) { pick(results[active]); e.preventDefault(); }
            else if (e.key === 'Escape') close();
        });
    }

    // ── Cities | Metro areas ────────────────────────────────────────────────
    // `#metros` in the URL (or the last choice, remembered per browser) opens
    // on metro areas.
    function initialMode() {
        if (location.hash === '#metros') return 'metros';
        if (location.hash === '#cities') return 'cities';
        try { return localStorage.getItem(MODE_KEY) === 'metros' ? 'metros' : 'cities'; } catch (e) { return 'cities'; }
    }

    function applyModeText() {
        const metro = P === METRO;
        document.querySelectorAll('.pop-mode-btn').forEach(b => {
            const on = b.dataset.mode === P.kind;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', String(on));
        });
        document.getElementById('pop-search').placeholder = metro ? 'Search a metro area…' : 'Search a city or town…';
        document.getElementById('stat-places-label').textContent = metro ? 'metro areas in view' : 'places in view';
        document.getElementById('stat-loaded-label').textContent = metro ? 'metro areas worldwide' : 'places loaded';
        document.getElementById('stat-people-label').textContent = metro ? 'people in metro areas shown' : 'people in places shown';
        document.getElementById('pop-top-title').textContent = metro ? 'Biggest metro areas in view' : 'Biggest places in view';
        document.getElementById('pop-mode-note').hidden = !metro;
    }

    function setMode(mode) {
        const next = mode === 'metros' ? METRO : CITY;
        if (next === P) return;
        P = next;
        pinned = -1;
        hideTip();
        try { localStorage.setItem(MODE_KEY, P.kind); } catch (e) { /* private mode */ }
        history.replaceState(null, '', '#' + P.kind);
        applyModeText();
        document.dispatchEvent(new Event('pop-mode'));
        if (P === METRO) loadMetros();
        layer.redraw();
    }

    function setupModeSwitch() {
        document.querySelectorAll('.pop-mode-btn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
        applyModeText();
    }

    // ── Init ────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        P = initialMode() === 'metros' ? METRO : CITY;
        map = L.map('pop-map', {
            center: [25, 15],
            zoom: 2.4,
            minZoom: 2,
            maxZoom: 14,
            maxBounds: [[-85, -200], [85, 200]],
            maxBoundsViscosity: 0.8,
            gestureHandling: true,
            tap: false,
            fullscreenControl: true,
            worldCopyJump: false,
        });
        mapIsDark = setupMapBasemaps(map, {
            defaultBasemap: 'dark',
            onThemeChange: isDark => { mapIsDark = isDark; layer.redraw(); },
        }).isDark;
        new MapLocationControl({}).addTo(map);

        const hiPane = map.createPane('popHighlight');
        hiPane.style.zIndex = 460;
        hiPane.style.pointerEvents = 'none';
        highlight = L.circleMarker([0, 0], {
            pane: 'popHighlight', radius: 6, interactive: false, fill: false,
            color: '#ffffff', weight: 2, opacity: 0.95, className: 'pop-highlight',
        });
        window.popMap = map;  // handy from the console
        layer = new BubbleLayer().addTo(map);
        // Inside the map container so they come along into fullscreen.
        map.getContainer().appendChild(tip());
        map.getContainer().appendChild(document.querySelector('.pop-legend'));

        let hoverFrame = null, lastHover = -1;
        map.on('mousemove', e => {
            if (hoverFrame) return;
            hoverFrame = requestAnimationFrame(() => {
                hoverFrame = null;
                if (map._animatingZoom) return;
                const i = layer.hitTest(e.layerPoint);
                map.getContainer().style.cursor = i >= 0 ? 'pointer' : '';
                if (i === lastHover) return;
                lastHover = i;
                if (i >= 0) showTip(i, false);
                else if (pinned >= 0) showTip(pinned, true);
                else hideTip();
            });
        });
        map.on('mouseout', () => { lastHover = -1; pinned >= 0 ? showTip(pinned, true) : hideTip(); });
        map.on('click', e => {
            const i = layer.hitTest(e.layerPoint);
            pinned = i;
            lastHover = i;
            i >= 0 ? showTip(i, true) : hideTip();
        });
        map.on('movestart zoomstart', () => { tip().hidden = true; if (map.hasLayer(highlight)) highlight.remove(); });

        setupSearch();
        setupModeSwitch();
        if (P === METRO) loadMetros();
        loadTables()
            .then(() => loadTier(0))
            .then(() => loadTier(1))
            .catch(err => setStatus('Couldn’t load places (' + err.message + ') — try reloading.'));
    });
})();

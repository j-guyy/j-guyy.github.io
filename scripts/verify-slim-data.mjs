#!/usr/bin/env node
/**
 * Proves scripts/slim-data-files.py did not change what the site detects.
 *
 * It lifts the REAL detection functions out of js/strava.js (decodePolyline,
 * preprocess*, buildSpatialIndex, pointInFeature/pointInRing and the
 * detectCounties/Parks/MetrosAsync loops) and runs them against the "before"
 * and "after" data sets, then compares the results.
 *
 * Usage:
 *   node scripts/verify-slim-data.mjs <before-dir> <after-dir> [--n 150000]
 *
 * Probes (every one lies on the 1e-5 grid, because Strava polylines do):
 *   - uniform random points over the contiguous US
 *   - "boundary" probes: 7x7 grid neighbourhood (+-3e-5 deg ~ +-3 m) around
 *     sampled vertices and edge midpoints of the ORIGINAL outer rings --
 *     the points most likely to flip if a boundary moved
 * Two comparisons per data set:
 *   1. per-point: the set of feature ids containing each probe
 *   2. per-activity: probes packed into encoded polylines and run through the
 *      real detect*Async functions; visited sets + discovering activity compared
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'js', 'strava.js'), 'utf8');
const [beforeDir, afterDir] = process.argv.slice(2, 4);
const N = +(process.argv[process.argv.indexOf('--n') + 1] || 150000);
if (!beforeDir || !afterDir) { console.error('usage: verify-slim-data.mjs <before> <after>'); process.exit(1); }

// ── lift real functions out of strava.js ──────────────────────────────────────
function lift(name) {
    const m = new RegExp(`(async )?function ${name}\\(`).exec(src);
    if (!m) throw new Error('not found: ' + name);
    let i = src.indexOf('{', src.indexOf(')', m.index));
    let depth = 0, j = i;
    for (; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) break;
    }
    return src.slice(m.index, j + 1);
}
const NAMES = ['decodePolyline', 'computeFeatureBbox', 'buildSpatialIndex', 'pointInFeature', 'pointInRing',
    'preprocessCounties', 'preprocessParks', 'preprocessMetros',
    'detectCountiesAsync', 'detectParksAsync', 'detectMetrosAsync'];
const code = `
let visitedFips = new Set(), visitedMetroIds = new Set();
const setCountyStatus = () => {}, setParkStatus = () => {}, setMetroStatus = () => {};
${NAMES.map(lift).join('\n')}
({ decodePolyline, preprocessCounties, preprocessParks, preprocessMetros, buildSpatialIndex, pointInFeature,
   detectCountiesAsync, detectParksAsync, detectMetrosAsync });
`;
const api = vm.runInNewContext(code, { setTimeout, Set, Math, Object, Infinity });

// ── helpers ───────────────────────────────────────────────────────────────────
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const g5 = v => Math.round(v * 1e5) / 1e5;

function encodePolyline(points) {           // [lat,lng][] -> Google polyline (1e5)
    let out = '', pLat = 0, pLng = 0;
    const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
    for (const [lat, lng] of points) {
        const la = Math.round(lat * 1e5), ln = Math.round(lng * 1e5);
        out += enc(la - pLat) + enc(ln - pLng); pLat = la; pLng = ln;
    }
    return out;
}
const load = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const outerRings = f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map(p => p[0]);

function boundaryProbes(features, budget) {
    const rings = features.flatMap(outerRings);
    const total = rings.reduce((s, r) => s + r.length, 0);
    const stride = Math.max(1, Math.floor(total * 49 / budget));
    const pts = []; let k = 0;
    for (const ring of rings) for (let i = 0; i < ring.length - 1; i++, k++) {
        if (k % stride) continue;
        const [x, y] = ring[i], [x2, y2] = ring[i + 1];
        for (const [cx, cy] of [[x, y], [(x + x2) / 2, (y + y2) / 2]])
            for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++)
                pts.push([g5(cy + dy * 1e-5), g5(cx + dx * 1e-5)]);
    }
    return pts;
}
function randomProbes(n) {
    const pts = [];
    while (pts.length < n) pts.push([g5(24.5 + rnd() * 25), g5(-125 + rnd() * 58.5)]);
    return pts;
}
function toActivities(probes) {            // detection samples every 3rd point -> triple each probe
    const acts = [];
    for (let i = 0; i < probes.length; i += 60) {
        const pts = probes.slice(i, i + 60).flatMap(p => [p, p, p]);
        acts.push({ i: acts.length + 1, n: 'a' + i, d: '2024-01-01', p: encodePolyline(pts) });
    }
    return acts;
}
function perPoint(parsed, index, probes) {  // real index + bbox + pointInFeature, all containing ids
    const idKey = parsed[0].fips ? 'fips' : 'id';
    return probes.map(([lat, lng]) => {
        const hit = [];
        for (const c of index[`${Math.floor(lng)},${Math.floor(lat)}`] || []) {
            const b = c.bbox;
            if (lng < b.minLng || lng > b.maxLng || lat < b.minLat || lat > b.maxLat) continue;
            if (api.pointInFeature(lat, lng, c.feature)) hit.push(c[idKey]);
        }
        return hit.sort().join('|');
    });
}

// ── run ───────────────────────────────────────────────────────────────────────
const SETS = [
    { label: 'counties-us.json',        file: 'counties-us.json',        pre: 'preprocessCounties', det: 'detectCountiesAsync', kind: 'county' },
    { label: 'federal-lands.geojson',   file: 'federal-lands.geojson',   pre: 'preprocessParks',    det: 'detectParksAsync',    kind: 'park' },
    { label: 'state-parks.geojson',     file: 'state-parks.geojson',     pre: 'preprocessParks',    det: 'detectParksAsync',    kind: 'park' },
    { label: 'metro-areas.geojson',     file: 'metro-areas.geojson',     pre: 'preprocessMetros',   det: 'detectMetrosAsync',   kind: 'metro' },
];
const rand = randomProbes(N);
let failed = false;
console.log('dataset                    probes(rand+bound)  containment-diffs  visited before/after (rand)  visited before/after (bound)  discovery-diffs');
for (const s of SETS) {
    const gb = load(beforeDir, s.file), ga = load(afterDir, s.file);
    const pb = api[s.pre](gb), pa = api[s.pre](ga);
    const ib = api.buildSpatialIndex(pb), ia = api.buildSpatialIndex(pa);
    const bound = boundaryProbes(gb.features, N);
    const res = {};
    let diffs = 0, discDiffs = 0;
    for (const [name, probes] of [['rand', rand], ['bound', bound]]) {
        const A = perPoint(pb, ib, probes), B = perPoint(pa, ia, probes);
        for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) { diffs++; if (diffs <= 3) console.log('  DIFF', s.label, probes[i], A[i] || '-', '->', B[i] || '-'); }
        const acts = toActivities(probes);
        const run = async (parsed, index) => {
            const empty = new Set();
            const r = await api[s.det](acts, parsed, index, empty);
            return r;
        };
        // county/metro detectors read globals (visited*), which start empty; park detector takes a set
        const rb = await run(pb, ib), ra = await run(pa, ia);
        const key = rb.newFips ? 'newFips' : 'newIds';
        const dkey = 'newDiscoveries';
        const setB = [...rb[key]].sort(), setA = [...ra[key]].sort();
        const onlyB = setB.filter(x => !ra[key].has(x)), onlyA = setA.filter(x => !rb[key].has(x));
        for (const id of setB) if (ra[dkey][id] && ra[dkey][id].actId !== rb[dkey][id].actId) discDiffs++;
        res[name] = `${setB.length}/${setA.length}` + (onlyB.length || onlyA.length ? ` (lost ${onlyB.join(',') || '-'}; gained ${onlyA.join(',') || '-'})` : '');
        if (onlyB.length || onlyA.length) failed = true;
    }
    if (discDiffs) failed = true;
    console.log(`${s.label.padEnd(26)} ${String(rand.length + bound.length).padStart(10)} ${String(diffs).padStart(18)}  ${res.rand.padStart(26)}  ${res.bound.padStart(28)}  ${String(discDiffs).padStart(14)}`);
}
console.log(failed ? '\nRESULT: visited sets DIFFER' : '\nRESULT: visited sets and discovering activities identical');

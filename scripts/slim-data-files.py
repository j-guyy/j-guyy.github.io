#!/usr/bin/env python3
"""
Shrink the big map data files in /data without changing what the site computes
from them. File names and JSON/GeoJSON schemas are kept.

Stage A ("lossless-ish", the default):
  * coordinates rounded to 5 decimal places (~1 m), consecutive duplicate
    vertices created by the rounding removed (rings stay closed)
  * properties nothing reads dropped (counties-us.json only)
  * JSON minified (no whitespace)
Stage B (--stage b, opt-in): Douglas-Peucker ring simplification
  (topology-preserving, shapely) with --tolerance degrees, applied ONLY to
  the display-only GeoJSON files. Files used to detect visits (counties,
  parks, federal lands, metros) are never simplified.

What reads each file (see js/strava.js, js/*.js, *.html):
  state-parks.geojson, federal-lands.geojson  Park Hunter; reads properties
      id/name/agency/type; detection is ray-casting on each polygon's OUTER
      ring only (pointInFeature); holes are drawn by Leaflet so they stay.
  counties-us.json    County Hunter + Trail/City Hunter boundary; reads
      GEOID/STATEFP/NAME/LSAD only.
  metro-areas.geojson Metro Hunter (already 5 dp) -- left alone.
  interstateHighways.json, highways.json, uscities.json   plain JSON, read
      whole by highways.html / family-travels.js / world-map.js /
      test-osm-highways.html -- minified only, values untouched.
  us-ecoregions.topojson  already quantized + minified, every property read
      by js/us-ecoregions.js -- left alone.

Dependencies: Python 3.8+; shapely only for --stage b (pip install shapely).

Usage:
    python3 scripts/slim-data-files.py [--src DIR] [--out DIR] [--stage a|b]
                                       [--tolerance DEG]
--src defaults to data/ and --out to --src (in-place). The script is
idempotent. Originals stay in git history (git show <commit>:data/<file>).
"""

import argparse
import gzip
import json
import os

DECIMALS = 5

# Files slimmed in stage A: name -> kind
GEOJSON_FILES = ['state-parks.geojson', 'federal-lands.geojson']
COUNTY_FILE = 'counties-us.json'
PLAIN_JSON_FILES = ['interstateHighways.json', 'highways.json', 'uscities.json']

# Properties the site reads from counties-us.json (js/strava.js)
COUNTY_KEEP = ('STATEFP', 'GEOID', 'NAME', 'LSAD')


def round_ring(ring):
    out = []
    for x, y in ring:
        p = [round(x, DECIMALS), round(y, DECIMALS)]
        if not out or p != out[-1]:
            out.append(p)
    if len(out) < 4:                       # never let a ring collapse
        out = [[round(x, DECIMALS), round(y, DECIMALS)] for x, y in ring]
    return out


def simplify_ring(ring, tol):
    from shapely.geometry import LinearRing
    if len(ring) <= 5 or tol <= 0:
        return ring
    s = LinearRing(ring).simplify(tol, preserve_topology=True)
    pts = [[round(x, DECIMALS), round(y, DECIMALS)] for x, y in s.coords]
    return pts if len(pts) >= 4 else ring


def slim_geometry(geom, tol=0):
    def do(ring):
        r = round_ring(ring)
        return simplify_ring(r, tol) if tol else r
    if geom['type'] == 'Polygon':
        geom['coordinates'] = [do(r) for r in geom['coordinates']]
    elif geom['type'] == 'MultiPolygon':
        geom['coordinates'] = [[do(r) for r in p] for p in geom['coordinates']]
    return geom


def dump(obj, path):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)


def sizes(path):
    with open(path, 'rb') as f:
        raw = f.read()
    return len(raw), len(gzip.compress(raw, 9))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--src', default=os.path.join(os.path.dirname(__file__), '..', 'data'))
    ap.add_argument('--out', default=None)
    ap.add_argument('--stage', choices=['a', 'b'], default='a')
    ap.add_argument('--tolerance', type=float, default=0.00003,
                    help='stage b Douglas-Peucker tolerance in degrees (default 0.00003 ~ 3 m)')
    a = ap.parse_args()
    src = a.src
    out = a.out or src
    os.makedirs(out, exist_ok=True)
    tol = a.tolerance if a.stage == 'b' else 0

    rows = []

    def record(name):
        rows.append((name, *sizes(os.path.join(src, name)), *sizes(os.path.join(out, name))))

    for name in GEOJSON_FILES:
        with open(os.path.join(src, name), encoding='utf-8') as f:
            d = json.load(f)
        for ft in d['features']:
            # Park detection is exact-boundary; only simplify if explicitly asked
            slim_geometry(ft['geometry'], tol)
        dump(d, os.path.join(out, name))
        record(name)

    with open(os.path.join(src, COUNTY_FILE), encoding='utf-8') as f:
        d = json.load(f)
    d = {'type': d['type'], 'features': d['features']}      # drop crs/name (unread)
    for ft in d['features']:
        ft['properties'] = {k: ft['properties'][k] for k in COUNTY_KEEP}
        slim_geometry(ft['geometry'], tol)
    dump(d, os.path.join(out, COUNTY_FILE))
    record(COUNTY_FILE)

    for name in PLAIN_JSON_FILES:
        with open(os.path.join(src, name), encoding='utf-8') as f:
            d = json.load(f)
        dump(d, os.path.join(out, name))
        record(name)

    print(f'{"file":28}{"raw before":>12}{"gz before":>12}{"raw after":>12}{"gz after":>12}')
    for n, rb, gb, ra, ga in rows:
        print(f'{n:28}{rb:>12,}{gb:>12,}{ra:>12,}{ga:>12,}')
    tot = [sum(r[i] for r in rows) for i in range(1, 5)]
    print(f'{"TOTAL":28}{tot[0]:>12,}{tot[1]:>12,}{tot[2]:>12,}{tot[3]:>12,}')


if __name__ == '__main__':
    main()

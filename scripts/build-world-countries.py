#!/usr/bin/env python3
"""
Build data/world-countries.geojson — the country outlines the World Travel Map
(world-map.html / js/world-map.js) fills by visited status.

Source: Natural Earth 1:50m admin-0 countries (public domain).
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson

The page used to download that file (3 MB, every property Natural Earth has,
from an unpinned branch) on every visit. This keeps a slim copy in the repo:
coordinates rounded to 3 decimals (~100 m), consecutive duplicates dropped, and
three properties per feature:

    name   the country name as data/countries.json spells it (Natural Earth's
           ADMIN name, renamed through ALIASES where the two disagree), so the
           page can look a feature up by name
    iso    ISO 3166-1 alpha-2 code (Natural Earth's ISO_A2_EH), "" if none
    sov    the sovereign state's name, renamed the same way — for dependent
           territories (Puerto Rico, Greenland, …) that are not in
           countries.json, the page reads this to label them

Usage:
    python3 scripts/build-world-countries.py [path/to/ne_50m_admin_0_countries.geojson]

Downloads the source into a temp file when no path is given. Needs no
third-party packages.
"""

import json
import os
import sys
import tempfile
import urllib.request

NE_URL = ('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/'
          'master/geojson/ne_50m_admin_0_countries.geojson')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'world-countries.geojson')
COUNTRIES = os.path.join(ROOT, 'data', 'countries.json')

# Natural Earth ADMIN / SOVEREIGNT name → data/countries.json name.
ALIASES = {
    'The Bahamas': 'Bahamas',
    'Czechia': 'Czech Republic',
    'Republic of Serbia': 'Serbia',
    'Vatican': 'Vatican City',
    'Cabo Verde': 'Cape Verde',
    'Republic of the Congo': 'Congo',
    'Democratic Republic of the Congo': 'DR Congo',
    'United Republic of Tanzania': 'Tanzania',
    'Federated States of Micronesia': 'Micronesia',
    'East Timor': 'Timor-Leste',
}

PRECISION = 3


def ring(coords):
    out = []
    for lng, lat in coords:
        pt = [round(lng, PRECISION), round(lat, PRECISION)]
        if not out or out[-1] != pt:
            out.append(pt)
    if out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else None


def polygon(rings):
    outer = ring(rings[0])
    # A polygon whose outer ring collapsed is dropped (its holes with it).
    if not outer:
        return None
    return [outer] + [h for h in (ring(r) for r in rings[1:]) if h]


def geometry(geom):
    if geom['type'] == 'Polygon':
        polys = [polygon(geom['coordinates'])]
    else:
        polys = [polygon(p) for p in geom['coordinates']]
    polys = [p for p in polys if p]
    if not polys:
        return None
    if len(polys) == 1:
        return {'type': 'Polygon', 'coordinates': polys[0]}
    return {'type': 'MultiPolygon', 'coordinates': polys}


def main():
    if len(sys.argv) > 1:
        src = sys.argv[1]
    else:
        src = os.path.join(tempfile.mkdtemp(), 'ne_50m_admin_0_countries.geojson')
        print(f'Downloading {NE_URL}')
        urllib.request.urlretrieve(NE_URL, src)

    with open(src, encoding='utf-8') as f:
        ne = json.load(f)
    with open(COUNTRIES, encoding='utf-8') as f:
        listed = {c['name'] for group in json.load(f).values() for c in group}

    features = []
    for feat in ne['features']:
        p = feat['properties']
        name = ALIASES.get(p['ADMIN'], p['ADMIN'])
        geom = geometry(feat['geometry'])
        if geom is None:
            continue
        iso = p.get('ISO_A2_EH') or ''
        features.append({
            'type': 'Feature',
            'properties': {
                'name': name,
                'iso': '' if iso == '-99' else iso,
                'sov': ALIASES.get(p['SOVEREIGNT'], p['SOVEREIGNT']),
            },
            'geometry': geom,
        })
    features.sort(key=lambda f: f['properties']['name'])

    names = {f['properties']['name'] for f in features}
    missing = sorted(listed - names)
    if missing:
        print('countries.json names with no outline (add to ALIASES?):', ', '.join(missing))

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': features}, f,
                  ensure_ascii=False, separators=(',', ':'))
    print(f'Wrote {len(features)} countries to {os.path.relpath(OUT, ROOT)} '
          f'({os.path.getsize(OUT) / 1e6:.2f} MB)')


if __name__ == '__main__':
    main()

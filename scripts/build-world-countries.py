#!/usr/bin/env python3
"""
Build data/world-countries.geojson — the country outlines the World Travel Map
(world-map.html / js/world-map.js) fills by visited status.

Sources: Natural Earth 1:50m admin-0 map subunits and countries (public domain).
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_map_subunits.geojson
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson

A country is split into its map subunits — the Azores and Madeira apart from
Portugal, the Canaries from Spain, Réunion / French Guiana / … from France,
Hawaii and Alaska from the lower 48 — so the page can fill only the bodies of
land I've actually been to. The largest subunit is the country's core, which
fills whenever the country is marked visited; every other subunit fills only
once a place or route lies inside it. Countries in KEEP_WHOLE (subunits that
are internal divisions, not outlying land) keep their single outline from the
countries file.

The page used to download that file (3 MB, every property Natural Earth has,
from an unpinned branch) on every visit. This keeps a slim copy in the repo:
coordinates rounded to 3 decimals (~100 m), consecutive duplicates dropped, and
four properties per feature:

    name   the country name as data/countries.json spells it (Natural Earth's
           ADMIN name, renamed through ALIASES where the two disagree), so the
           page can look a feature up by name
    iso    ISO 3166-1 alpha-2 code (Natural Earth's ISO_A2_EH), "" if none
    sov    the sovereign state's name, renamed the same way — for dependent
           territories (Puerto Rico, Greenland, …) that are not in
           countries.json, the page reads this to label them
    part   the subunit's name for an outlying part ("Azores", "Hawaii"), ""
           for the country's core

Usage:
    python3 scripts/build-world-countries.py [path/to/ne_50m_admin_0_map_subunits.geojson path/to/ne_50m_admin_0_countries.geojson]

Downloads the sources into a temp dir when no paths are given. Needs no
third-party packages.
"""

import json
import math
import os
import sys
import tempfile
import urllib.request

NE_BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
NE_FILES = ['ne_50m_admin_0_map_subunits.geojson', 'ne_50m_admin_0_countries.geojson']

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

# Countries whose subunits are internal divisions (UK nations, Belgian regions,
# …) or disputed areas rather than outlying land: drawn as one outline.
KEEP_WHOLE = {
    'United Kingdom', 'Belgium', 'Republic of Serbia', 'Bosnia and Herzegovina',
    'Palestine', 'Russia', 'Antarctica',
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


def area(geom):
    """Rough area in square degrees, scaled by cos(latitude) — only compared
    between subunits of one country to pick its core."""
    polys = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
    total = 0.0
    for poly in polys:
        pts = poly[0]
        k = math.cos(math.radians(sum(lat for _, lat in pts) / len(pts)))
        total += abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(pts, pts[1:]))) / 2 * k
    return total


def main():
    if len(sys.argv) > 2:
        subunits_src, countries_src = sys.argv[1:3]
    else:
        tmp = tempfile.mkdtemp()
        subunits_src, countries_src = (os.path.join(tmp, n) for n in NE_FILES)
        for name, dest in zip(NE_FILES, (subunits_src, countries_src)):
            print(f'Downloading {NE_BASE + name}')
            urllib.request.urlretrieve(NE_BASE + name, dest)

    with open(subunits_src, encoding='utf-8') as f:
        subunits = json.load(f)['features']
    with open(countries_src, encoding='utf-8') as f:
        whole = json.load(f)['features']
    with open(COUNTRIES, encoding='utf-8') as f:
        listed = {c['name'] for group in json.load(f).values() for c in group}

    # ADMIN → [(subunit name, properties, geometry)]
    parts = {}
    for feat in whole:
        p = feat['properties']
        if p['ADMIN'] in KEEP_WHOLE:
            parts.setdefault(p['ADMIN'], []).append(('', p, geometry(feat['geometry'])))
    for feat in subunits:
        p = feat['properties']
        if p['ADMIN'] not in KEEP_WHOLE:
            parts.setdefault(p['ADMIN'], []).append((p['SUBUNIT'], p, geometry(feat['geometry'])))

    features = []
    for admin, units in parts.items():
        units = [u for u in units if u[2] is not None]
        if not units:
            continue
        core = max(units, key=lambda u: area(u[2]))
        for unit in units:
            subunit, p, geom = unit
            if subunit == admin:  # Japan's leftover small islands share its name
                subunit = f'{subunit} (other islands)'
            iso = p.get('ISO_A2_EH') or ''
            features.append({
                'type': 'Feature',
                'properties': {
                    'name': ALIASES.get(admin, admin),
                    'iso': '' if iso == '-99' else iso,
                    'sov': ALIASES.get(p['SOVEREIGNT'], p['SOVEREIGNT']),
                    'part': '' if unit is core else subunit,
                },
                'geometry': geom,
            })
    features.sort(key=lambda f: (f['properties']['name'], f['properties']['part']))

    names = {f['properties']['name'] for f in features}
    missing = sorted(listed - names)
    if missing:
        print('countries.json names with no outline (add to ALIASES?):', ', '.join(missing))

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'type': 'FeatureCollection', 'features': features}, f,
                  ensure_ascii=False, separators=(',', ':'))
    print(f'Wrote {len(features)} outlines ({len(parts)} countries) to {os.path.relpath(OUT, ROOT)} '
          f'({os.path.getsize(OUT) / 1e6:.2f} MB)')


if __name__ == '__main__':
    main()

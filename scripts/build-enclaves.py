#!/usr/bin/env python3
"""
Build scripts/enclaves.json — the real outlines of the countries Natural Earth
gets wrong that sit wholly inside another one, shared by
build-world-countries.py (the World Travel Map's country outlines) and
build-admin1-regions.py (the regions of the country around them), so both
files draw exactly the same border.

    Vatican     Natural Earth's 1:50m outline sits ~1 km west of the real one,
                in the Gianicolo, and its 1:10m one is only the basilica, so a
                walk into St Peter's Square counted as Italy.
    San Marino  Natural Earth's 1:50m outline is a 7-point shape 12% too big,
                and its 1:10m Italian regions overlap a third of it.

Source: geoBoundaries ADM0 (https://www.geoboundaries.org). The Vatican's is
public domain; San Marino's is from OpenStreetMap (© OpenStreetMap
contributors, ODbL 1.0). Each is simplified to ~15 m and rounded to 4 decimals
(~10 m), the admin-1 files' precision, so a ring's vertices survive both build
scripts' rounding unchanged.

Each entry, keyed by Natural Earth's ADMIN name:
    host    the Natural Earth ADMIN name of the country around it
    source  where the outline came from
    ring    the outer ring, counter-clockwise, closed

Usage:
    python3 scripts/build-enclaves.py

Needs shapely, like build-admin1-regions.py.
"""

import json
import os
import urllib.request

from shapely.geometry import Polygon, shape
from shapely.geometry.polygon import orient

GB = 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/gbOpen/{0}/ADM0/geoBoundaries-{0}-ADM0.geojson'

ENCLAVES = {
    'Vatican': {'host': 'Italy', 'iso3': 'VAT', 'license': 'public domain'},
    'San Marino': {'host': 'Italy', 'iso3': 'SMR', 'license': '© OpenStreetMap contributors, ODbL 1.0'},
}

TOLERANCE = 15 / 111000   # degrees
PRECISION = 4

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'enclaves.json')


def main():
    out = {}
    for admin, cfg in ENCLAVES.items():
        url = GB.format(cfg['iso3'])
        print(f'Downloading {url}')
        with urllib.request.urlopen(url) as res:
            geom = shape(json.load(res)['features'][0]['geometry'])
        if geom.geom_type != 'Polygon':
            geom = max(geom.geoms, key=lambda g: g.area)
        geom = Polygon(geom.exterior).simplify(TOLERANCE, preserve_topology=True)
        ring = []
        for x, y in geom.exterior.coords:
            pt = [round(x, PRECISION), round(y, PRECISION)]
            if not ring or ring[-1] != pt:
                ring.append(pt)
        poly = orient(Polygon(ring))
        if not poly.is_valid:
            raise SystemExit(f'{admin}: ring is invalid after rounding')
        out[admin] = {
            'host': cfg['host'],
            'source': f"geoBoundaries {cfg['iso3']} ADM0 ({cfg['license']}), simplified to ~15 m",
            'ring': [[x, y] for x, y in poly.exterior.coords],
        }
        print(f'  {admin}: {len(out[admin]["ring"])} points')
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'Wrote {os.path.relpath(OUT)}')


if __name__ == '__main__':
    main()

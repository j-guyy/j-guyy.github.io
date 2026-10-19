#!/usr/bin/env python3
"""
Build data/ak-ecoregions.geojson — EPA Level III ecoregions of Alaska for the
Strava page's Ecoregion Hunter, which loads it next to the lower-48 Level IV
file (data/us-ecoregions.topojson).

Source: EPA Level III ecoregions of Alaska (public domain), a shapefile in
NAD83 Alaska Albers:
    https://dmap-prod-oms-edc.s3.us-east-1.amazonaws.com/ORD/Ecoregions/ak/ak_eco_l3.zip

The EPA has no Level IV for Alaska, so each Level III is written as its own
single "Level IV" (US_L4CODE = US_L3CODE) in the same property schema as the
lower-48 file, plus L3_ONLY: true. The hunter then counts an Alaska region in
both its Level IV and Level III totals with no special cases.

Processing:
  * records are dissolved per Level III (the shapefile has one record per
    polygon part);
  * the dissolved regions are simplified together as a coverage
    (shapely.coverage_simplify) in Albers metres, so neighbouring regions keep
    sharing their borders instead of opening gaps / overlaps;
  * islets under MIN_PART_KM2 are dropped (mostly Aleutian rocks);
  * coordinates are projected to WGS84 and rounded to 4 decimals (~10 m).

The western Aleutians cross the antimeridian (Attu is at 172.9°E). Positive
longitudes are written as lng - 360 (e.g. -187.1) so the chain is one
continuous outline for Leaflet and point-in-polygon tests; the hunter shifts
route points the same way.

Usage:
    pip install shapely pyproj pyshp
    python3 scripts/build-ak-ecoregions.py [path/to/ak_eco_l3.zip]
With no argument the zip is downloaded.
"""

import io
import json
import os
import sys
import tempfile
import urllib.request
import zipfile

import numpy as np
import shapefile                      # pyshp
import shapely
from pyproj import CRS, Transformer
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

SOURCE_URL = 'https://dmap-prod-oms-edc.s3.us-east-1.amazonaws.com/ORD/Ecoregions/ak/ak_eco_l3.zip'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'ak-ecoregions.geojson')

SIMPLIFY_M = 300        # coverage simplification tolerance, metres
MIN_PART_KM2 = 1.0      # drop polygon parts smaller than this
DECIMALS = 4


def load_zip(arg):
    if arg:
        with open(arg, 'rb') as f:
            return f.read()
    print(f'Downloading {SOURCE_URL}…')
    with urllib.request.urlopen(SOURCE_URL) as r:
        return r.read()


def read_shapefile(data):
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(tmp)
    shp = next(os.path.join(root, f) for root, _, files in os.walk(tmp) for f in files if f.endswith('.shp'))
    base = shp[:-4]
    with open(base + '.prj') as f:
        crs = CRS.from_wkt(f.read())
    reader = shapefile.Reader(base)
    rows = [(rec.as_dict(), shape(shp_.__geo_interface__)) for rec, shp_ in zip(reader.records(), reader.shapes())]
    return crs, rows


def polygon_parts(geom):
    if isinstance(geom, Polygon):
        return [geom]
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, 'geoms', []) if isinstance(g, Polygon)]


def main():
    crs, rows = read_shapefile(load_zip(sys.argv[1] if len(sys.argv) > 1 else None))

    regions = {}   # L3 code → { props, parts: [geom] }
    for props, geom in rows:
        code = str(props['US_L3CODE']).strip()
        r = regions.setdefault(code, {'props': props, 'parts': []})
        r['parts'].append(geom.buffer(0) if not geom.is_valid else geom)

    codes = sorted(regions, key=lambda c: int(c))
    dissolved = [unary_union(regions[c]['parts']) for c in codes]
    simplified = shapely.coverage_simplify(dissolved, SIMPLIFY_M)

    to_wgs84 = Transformer.from_crs(crs, 'EPSG:4326', always_xy=True)

    def project(coords):
        lng, lat = to_wgs84.transform(coords[:, 0], coords[:, 1])
        lng = np.where(lng > 0, lng - 360, lng)   # west of the antimeridian → keep it continuous
        return np.column_stack([np.round(lng, DECIMALS), np.round(lat, DECIMALS)])

    features = []
    total_parts = total_verts = 0
    for code, geom in zip(codes, simplified):
        parts = [p for p in polygon_parts(geom) if p.area >= MIN_PART_KM2 * 1e6]
        if not parts:
            continue
        wgs = shapely.transform(MultiPolygon(parts), project)
        wgs = wgs.buffer(0) if not wgs.is_valid else wgs
        polys = polygon_parts(wgs)
        total_parts += len(polys)
        total_verts += sum(len(p.exterior.coords) + sum(len(i.coords) for i in p.interiors) for p in polys)
        p = regions[code]['props']
        name = str(p['US_L3NAME']).strip()
        features.append({
            'type': 'Feature',
            'properties': {
                'US_L4CODE': code,
                'US_L4NAME': name,
                'US_L3CODE': code,
                'US_L3NAME': name,
                'NA_L1CODE': str(p['NA_L1CODE']).strip(),
                'NA_L1NAME': str(p['NA_L1NAME']).strip(),
                'STATE': 'AK',
                'L3_ONLY': True,
            },
            'geometry': mapping(MultiPolygon(polys) if len(polys) > 1 else polys[0]),
        })

    out = {'type': 'FeatureCollection', 'features': features}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    size = os.path.getsize(OUT)
    print(f'Wrote {os.path.relpath(OUT)}: {len(features)} regions, {total_parts} parts, '
          f'{total_verts} vertices, {size / 1024:.0f} KB')


if __name__ == '__main__':
    main()

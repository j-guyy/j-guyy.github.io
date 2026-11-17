#!/usr/bin/env python3
"""Build the World Population map's data files from GeoNames.

Downloads GeoNames' cities500 dump (every populated place of 500+ people, plus
seats of government; CC BY 4.0, https://www.geonames.org) and writes three tiers
to data/population/, so the page can paint the big cities at once and load the
towns only when someone zooms in:

    tier-0.txt   100,000+ people
    tier-1.txt   10,000 – 99,999
    tier-2.txt   500 – 9,999

Each file is plain text, one place per line, `|`-separated:

    name|countryIdx|regionIdx|lat|lng|population

with lat/lng at 3 decimals (~100 m). countryIdx / regionIdx index into
data/population/places.json ({"countries": [...], "regions": [...]}), shared by
all tiers. Rows are sorted biggest first.

Neighbourhoods (PPLX) and historical / abandoned / destroyed places are left out
so a big city's districts don't pile bubbles on top of the city itself.

It also writes metros.txt for the page's "Metro areas" view, from the EU Joint
Research Centre's GHSL Functional Urban Areas (GHS-FUA R2019A, CC BY 4.0): 9,031
metro areas worldwide — an urban centre plus its commuting zone, defined the same
way everywhere from satellite-derived population grids (2015 populations). The
file has no centre points, so each one is the area-weighted centroid of its
outline, computed in the file's own equal-area Mollweide projection (ESRI:54009)
and projected back to lat/lng by hand — no GIS libraries needed. One row each:

    name|countryIdx|altName|lat|lng|population|urbanCentrePopulation

A name like "Quezon City [Manila]" becomes name "Manila", altName "Quezon City".

    python3 scripts/build-world-population.py [--cache DIR]
"""
import argparse, io, json, math, os, re, sqlite3, struct, sys, urllib.request, zipfile

BASE = 'https://download.geonames.org/export/dump/'
SKIP_CODES = {'PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH'}
TIERS = [(100_000, 'tier-0.txt'), (10_000, 'tier-1.txt'), (500, 'tier-2.txt')]
FUA_URL = ('https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_FUA_UCDB2015_GLOBE_R2019A/V1-0/'
           'GHS_FUA_UCDB2015_GLOBE_R2019A_54009_1K_V1_0.zip')
MOLL_R = 6378137.0  # ESRI:54009 is spherical Mollweide on the WGS84 semi-major axis
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'population')


def fetch(name, cache):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        print('downloading', name, file=sys.stderr)
        urllib.request.urlretrieve(BASE + name, path)
    return path


def gpkg_rings(blob):
    """Rings of a GeoPackage (Multi)Polygon blob, as lists of (x, y)."""
    flags = blob[3]
    env = {0: 0, 1: 32, 2: 48, 3: 48, 4: 64}[(flags >> 1) & 7]
    buf, off = blob, 8 + env

    def read(fmt):
        nonlocal off
        v = struct.unpack_from(fmt, buf, off)
        off += struct.calcsize(fmt)
        return v

    polys = []
    def geom():
        bo = '<' if read('B')[0] == 1 else '>'
        gtype = read(bo + 'I')[0] % 1000
        if gtype == 6:
            for _ in range(read(bo + 'I')[0]):
                geom()
        elif gtype == 3:
            rings = []
            for _ in range(read(bo + 'I')[0]):
                n = read(bo + 'I')[0]
                pts = struct.unpack_from(bo + 'd' * (2 * n), buf, off)
                off_add(16 * n)
                rings.append(list(zip(pts[0::2], pts[1::2])))
            polys.append(rings)
        else:
            raise ValueError(f'unexpected geometry type {gtype}')
    def off_add(n):
        nonlocal off
        off += n
    geom()
    return polys


def centroid(polys):
    """Area-weighted centroid (x, y) of polygons with holes, in projected units."""
    A = cx = cy = 0.0
    for rings in polys:
        pa = px = py = 0.0
        for k, ring in enumerate(rings):
            a = x = y = 0.0
            for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
                c = x0 * y1 - x1 * y0
                a += c; x += (x0 + x1) * c; y += (y0 + y1) * c
            # Outer ring adds, holes subtract, whatever their winding.
            sign = 1 if k == 0 else -1
            if a < 0:
                a, x, y = -a, -x, -y
            pa += sign * a / 2; px += sign * x / 6; py += sign * y / 6
        A += pa; cx += px; cy += py
    return cx / A, cy / A


def mollweide_inverse(x, y):
    theta = math.asin(max(-1, min(1, y / (MOLL_R * math.sqrt(2)))))
    lat = math.asin(max(-1, min(1, (2 * theta + math.sin(2 * theta)) / math.pi)))
    lng = math.pi * x / (2 * MOLL_R * math.sqrt(2) * math.cos(theta))
    return math.degrees(lat), math.degrees(lng)


def build_metros(cache, iso3_names, country_idx):
    path = os.path.join(cache, os.path.basename(FUA_URL))
    if not os.path.exists(path):
        print('downloading', os.path.basename(FUA_URL), file=sys.stderr)
        urllib.request.urlretrieve(FUA_URL, path)
    gpkg = os.path.join(cache, 'fua.gpkg')
    if not os.path.exists(gpkg):
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.endswith('.gpkg'))
            with open(gpkg, 'wb') as f:
                f.write(z.read(name))
    db = sqlite3.connect(gpkg)
    table = db.execute('select table_name from gpkg_contents').fetchone()[0]
    rows = []
    for blob, name, iso, cname, pop, uc_pop in db.execute(
            f'select geom, eFUA_name, Cntry_ISO, Cntry_name, FUA_p_2015, UC_p_2015 from "{table}"'):
        x, y = centroid(gpkg_rings(blob))
        lat, lng = mollweide_inverse(x, y)
        alt = ''
        m = re.fullmatch(r'(.*?)\s*\[(.*)\]', name.strip())
        if m:
            name, alt = m.group(2), m.group(1)
        country = iso3_names.get(iso) or re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', cname)
        rows.append((round(pop), name.replace('|', '/'), country, alt.replace('|', '/'), lat, lng, round(uc_pop or 0)))
    rows.sort(key=lambda r: -r[0])
    with open(os.path.join(OUT, 'metros.txt'), 'w', encoding='utf-8') as f:
        for pop, name, country, alt, lat, lng, uc in rows:
            f.write(f'{name}|{country_idx(country)}|{alt}|{lat:.3f}|{lng:.3f}|{pop}|{uc}\n')
    print(f'metros.txt: {len(rows):,} metro areas', file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(ROOT, '.geonames-cache'),
                    help='where to keep the downloads (default: .geonames-cache, git-ignored)')
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    countries, iso3 = {}, {}
    with open(fetch('countryInfo.txt', args.cache), encoding='utf-8') as f:
        for line in f:
            if line.startswith('#') or not line.strip():
                continue
            p = line.rstrip('\n').split('\t')
            countries[p[0]] = p[4]
            iso3[p[1]] = p[4]

    regions = {}
    with open(fetch('admin1CodesASCII.txt', args.cache), encoding='utf-8') as f:
        for line in f:
            p = line.rstrip('\n').split('\t')
            if len(p) >= 2:
                regions[p[0]] = p[1]

    with zipfile.ZipFile(fetch('cities500.zip', args.cache)) as z:
        text = io.TextIOWrapper(z.open('cities500.txt'), encoding='utf-8')
        rows = []
        for line in text:
            p = line.rstrip('\n').split('\t')
            if p[7] in SKIP_CODES:
                continue
            pop = int(p[14] or 0)
            if pop < 500:
                continue
            name = p[1].replace('|', '/')
            cc = p[8]
            region = regions.get(f'{cc}.{p[10]}', '')
            rows.append((pop, name, countries.get(cc, cc), region, float(p[4]), float(p[5])))

    rows.sort(key=lambda r: -r[0])
    c_idx, r_idx = {}, {}
    def idx(table, key):
        if key not in table:
            table[key] = len(table)
        return table[key]

    os.makedirs(OUT, exist_ok=True)
    lines = {f: [] for _, f in TIERS}
    for pop, name, country, region, lat, lng in rows:
        fname = next(f for floor, f in TIERS if pop >= floor)
        lines[fname].append(f'{name}|{idx(c_idx, country)}|{idx(r_idx, region)}|{lat:.3f}|{lng:.3f}|{pop}')

    for fname, ls in lines.items():
        with open(os.path.join(OUT, fname), 'w', encoding='utf-8') as f:
            f.write('\n'.join(ls) + '\n')
        print(f'{fname}: {len(ls):,} places', file=sys.stderr)
    build_metros(args.cache, iso3, lambda c: idx(c_idx, c))
    with open(os.path.join(OUT, 'places.json'), 'w', encoding='utf-8') as f:
        json.dump({'countries': list(c_idx), 'regions': list(r_idx),
                   'source': 'GeoNames cities500 (CC BY 4.0); GHSL GHS-FUA R2019A (CC BY 4.0)'}, f, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()

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

    python3 scripts/build-world-population.py [--cache DIR]
"""
import argparse, io, json, os, sys, urllib.request, zipfile

BASE = 'https://download.geonames.org/export/dump/'
SKIP_CODES = {'PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH'}
TIERS = [(100_000, 'tier-0.txt'), (10_000, 'tier-1.txt'), (500, 'tier-2.txt')]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'population')


def fetch(name, cache):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        print('downloading', name, file=sys.stderr)
        urllib.request.urlretrieve(BASE + name, path)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(ROOT, '.geonames-cache'),
                    help='where to keep the downloads (default: .geonames-cache, git-ignored)')
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    countries = {}
    with open(fetch('countryInfo.txt', args.cache), encoding='utf-8') as f:
        for line in f:
            if line.startswith('#') or not line.strip():
                continue
            p = line.rstrip('\n').split('\t')
            countries[p[0]] = p[4]

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
    with open(os.path.join(OUT, 'places.json'), 'w', encoding='utf-8') as f:
        json.dump({'countries': list(c_idx), 'regions': list(r_idx),
                   'source': 'GeoNames cities500 (CC BY 4.0)'}, f, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()

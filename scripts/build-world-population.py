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

It also writes metros.txt for the page's "Metro areas" view, from the UN's World
Urbanization Prospects 2025 (WUP2025 file F21, CC BY 3.0 IGO): the 2025 population
of every city of 50,000+ people (~12,100 of them), each drawn the same way in every
country by the Degree of Urbanisation — a contiguous patch of 1 km² grid cells of
1,500+ people per km², from satellite-derived population grids. That consistent
boundary is why Jakarta (~42 M) and Dhaka (~37 M) outrank Tokyo (~33 M). Points are
the UN's population-weighted centres. One row each, biggest first:

    name|countryIdx|altName|lat|lng|population

A name like "Tōkyō (Tokyo)" becomes name "Tokyo", altName "Tōkyō"; one like
"Minneapolis [Saint Paul]" becomes name "Minneapolis", altName "incl. Saint Paul".
The xlsx is parsed with the standard library (zipfile + regex), no Excel libraries.

    python3 scripts/build-world-population.py [--cache DIR] [--metros-only]

--metros-only rewrites just metros.txt, keeping the country table in places.json
(new countries are appended), so the city tiers needn't be rebuilt.
"""
import argparse, html, io, json, os, re, sys, urllib.request, zipfile

BASE = 'https://download.geonames.org/export/dump/'
SKIP_CODES = {'PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH'}
TIERS = [(100_000, 'tier-0.txt'), (10_000, 'tier-1.txt'), (500, 'tier-2.txt')]
WUP_URL = 'https://population.un.org/wup/assets/Download/Cities/WUP2025-F21-DEGURBA-Cities_Pop.xlsx'
WUP_YEAR = '2025'
SOURCE = ('GeoNames cities500 (CC BY 4.0); UN DESA World Urbanization Prospects 2025, '
          'F21 city populations (CC BY 3.0 IGO)')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'population')


def fetch(name, cache):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        print('downloading', name, file=sys.stderr)
        urllib.request.urlretrieve(BASE + name, path)
    return path


def xlsx_rows(path, sheet_name):
    """Rows of one sheet of an .xlsx as {column letters: value}, standard library only."""
    with zipfile.ZipFile(path) as z:
        wb = z.read('xl/workbook.xml').decode('utf-8')
        rels = z.read('xl/_rels/workbook.xml.rels').decode('utf-8')
        rid = re.search(r'<sheet [^>]*name="%s"[^>]*r:id="([^"]+)"' % re.escape(sheet_name), wb).group(1)
        target = re.search(r'<Relationship [^>]*Id="%s"[^>]*Target="([^"]+)"' % rid, rels)
        if not target:  # attribute order varies
            target = re.search(r'<Relationship [^>]*Target="([^"]+)"[^>]*Id="%s"' % rid, rels)
        target = target.group(1).lstrip('/')
        sheet = target if target.startswith('xl/') else 'xl/' + target
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            sst = z.read('xl/sharedStrings.xml').decode('utf-8')
            for si in re.findall(r'<si>(.*?)</si>', sst, re.S):
                text = ''.join(re.findall(r'<t[^>]*>(.*?)</t>', si, re.S))
                strings.append(html.unescape(text))
        data = z.read(sheet).decode('utf-8')
    cell = re.compile(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(?:<f[^>]*>[^<]*</f>|<f[^>]*/>)?(?:<v>([^<]*)</v>)?</c>)')
    for row in re.findall(r'<row[^>]*>(.*?)</row>', data, re.S):
        out = {}
        for col, attrs, v in cell.findall(row):
            if v == '':
                continue
            out[col] = strings[int(v)] if 't="s"' in attrs else html.unescape(v)
        yield out


def split_wup_name(name):
    """('Tokyo', 'Tōkyō') from 'Tōkyō (Tokyo)'; ('Minneapolis', 'incl. Saint Paul') from 'Minneapolis [Saint Paul]'."""
    name = name.strip()
    m = re.fullmatch(r'(.*?)\s*\(([^()]*)\)', name)
    if m:
        return m.group(2), m.group(1)
    m = re.fullmatch(r'(.*?)\s*\[([^\[\]]*)\]', name)
    if m:
        return m.group(1), 'incl. ' + m.group(2)
    return name, ''


def build_metros(cache, iso3_names, country_idx):
    path = os.path.join(cache, os.path.basename(WUP_URL))
    if not os.path.exists(path):
        print('downloading', os.path.basename(WUP_URL), file=sys.stderr)
        urllib.request.urlretrieve(WUP_URL, path)
    rows_in = xlsx_rows(path, 'Data')
    header = next(rows_in)
    col = {v: k for k, v in header.items()}
    c_name, c_iso, c_lng, c_lat, c_pop = (col[k] for k in ('City_Name', 'ISO3_Code', 'PWCent_Longitude', 'PWCent_Latitude', WUP_YEAR))
    rows, missing = [], set()
    for r in rows_in:
        if c_name not in r or c_pop not in r:
            continue  # no city by that year (under 50,000 people)
        pop = round(float(r[c_pop]) * 1000)  # the file is in thousands
        if pop <= 0:
            continue
        iso = r[c_iso]
        country = iso3_names.get(iso)
        if not country:
            missing.add(iso)
            country = iso
        name, alt = split_wup_name(r[c_name])
        rows.append((pop, name.replace('|', '/'), country, alt.replace('|', '/'), float(r[c_lat]), float(r[c_lng])))
    if missing:
        print('no GeoNames country name for', sorted(missing), file=sys.stderr)
    rows.sort(key=lambda r: -r[0])
    with open(os.path.join(OUT, 'metros.txt'), 'w', encoding='utf-8') as f:
        for pop, name, country, alt, lat, lng in rows:
            f.write(f'{name}|{country_idx(country)}|{alt}|{lat:.3f}|{lng:.3f}|{pop}\n')
    print(f'metros.txt: {len(rows):,} cities ({WUP_YEAR})', file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(ROOT, '.geonames-cache'),
                    help='where to keep the downloads (default: .geonames-cache, git-ignored)')
    ap.add_argument('--metros-only', action='store_true',
                    help="rewrite only metros.txt, keeping places.json's country table")
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

    if args.metros_only:
        with open(os.path.join(OUT, 'places.json'), encoding='utf-8') as f:
            places = json.load(f)
        c_idx = {c: i for i, c in enumerate(places['countries'])}
        def cidx(c):
            if c not in c_idx:
                c_idx[c] = len(c_idx)
            return c_idx[c]
        build_metros(args.cache, iso3, cidx)
        places.update(countries=list(c_idx), source=SOURCE)
        with open(os.path.join(OUT, 'places.json'), 'w', encoding='utf-8') as f:
            json.dump(places, f, ensure_ascii=False, separators=(',', ':'))
        return

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
                   'source': SOURCE}, f, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    main()

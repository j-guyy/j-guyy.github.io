#!/usr/bin/env python3
"""
Build data/admin1/<country>.geojson — first-level administrative regions for
the countries the Strava page breaks activities down by (see
SUBDIVISION_CONFIG in js/strava.js) and the World Travel Map's Subregions view
(ADMIN1_FILES in js/world-map.js), which covers every country I've visited.
One file per country so a region map only downloads the boundaries it draws.

Source: Natural Earth 10m admin-1 states/provinces (public domain).
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson

Natural Earth splits Italy and Spain into provinces, not the regions /
autonomous communities that Nominatim reports as `address.state`, so those two
are dissolved up a level using Natural Earth's own `region` field. So are
France (departments → regions) and the UK (councils → England's regions plus
Scotland, Wales and Northern Ireland).

Each output feature carries:
    id       stable region key, e.g. "IT-52"
    country  SUBDIVISION_CONFIG id, e.g. "italy"
    name     display name
    aliases  every spelling we accept when matching a geocoded subdivision
             name to this polygon (Nominatim's English names, native names,
             Natural Earth's names)

Usage:
    python3 scripts/build-admin1-regions.py [path/to/ne_10m_admin_1_states_provinces.geojson]

Downloads the source into a temp file when no path is given.
"""

import json
import os
import sys
import tempfile
import unicodedata
import urllib.request

from shapely.geometry import MultiPolygon, Point, Polygon, shape, mapping
from shapely.ops import unary_union

NE_URL = ('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/'
          'master/geojson/ne_10m_admin_1_states_provinces.geojson')

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'admin1')

# Countries wholly inside another (the Vatican, San Marino) — Natural Earth's
# regions leave the wrong hole for them, so each is cut out of the regions
# around it along its real outline (build-enclaves.py, shared with the World
# Travel Map's country outlines), keyed by Natural Earth ADMIN name.
ENCLAVES = os.path.join(os.path.dirname(__file__), 'enclaves.json')

# How far (degrees, ~5 km) around an enclave a region counts as its neighbour
# and a gap as its own — Natural Earth's San Marino hole sits up to 2.5 km west
# of the real border.
ENCLAVE_NEAR = 0.05

# Simplification tolerance in degrees (~1.1 km). These maps are viewed at
# country scale, so this keeps shapes faithful while cutting the file ~20x.
TOLERANCE = 0.01

# Drop polygon parts smaller than this (deg²) — offshore rocks and sliver
# artefacts that are invisible at country zoom but cost a lot of vertices.
MIN_PART_AREA = 0.0004

# country config id → how to pull its regions out of Natural Earth.
#   admin     Natural Earth `admin` value
#   group_by  property whose value identifies one output region
#   id_from   property used for the id (falls back to a generated key)
#   dissolve  True when Natural Earth is a level finer than the region we want,
#             so the grouped features' own names are province names and must
#             not be used as aliases for the region they sit in
#   regroup   grouped value → the region it belongs to, for Natural Earth
#             features that are a piece of a region (Dublin's four councils,
#             Scotland's and Wales's statistical regions)
#   fold_in   other Natural Earth `admin` values to add as one region each,
#             mapped to (region name, id). Natural Earth files Hong Kong and
#             Macau as their own countries, split into districts, but Nominatim
#             reports them as regions of China (ISO 3166-2 CN-HK / CN-MO)
COUNTRIES = [
    {'id': 'us',        'admin': 'United States of America', 'group_by': 'name',       'id_from': 'iso_3166_2'},
    {'id': 'canada',    'admin': 'Canada',                   'group_by': 'name_en',    'id_from': 'iso_3166_2'},
    {'id': 'australia', 'admin': 'Australia',                'group_by': 'iso_3166_2', 'id_from': 'iso_3166_2'},
    {'id': 'mexico',    'admin': 'Mexico',                   'group_by': 'name_en',    'id_from': 'iso_3166_2'},
    {'id': 'china',     'admin': 'China',                    'group_by': 'name_en',    'id_from': 'iso_3166_2',
     'fold_in': {'Hong Kong S.A.R.': ('Hong Kong', 'CN-HK'), 'Macau S.A.R': ('Macau', 'CN-MO')}},
    {'id': 'spain',     'admin': 'Spain',                    'group_by': 'region',     'id_from': None,         'dissolve': True},
    {'id': 'italy',     'admin': 'Italy',                    'group_by': 'region',     'id_from': 'region_cod', 'dissolve': True},
    # World Travel Map only (not in SUBDIVISION_CONFIG).
    {'id': 'belgium',     'admin': 'Belgium',        'group_by': 'name_en', 'id_from': 'iso_3166_2'},
    {'id': 'belize',      'admin': 'Belize',         'group_by': 'name',    'id_from': 'iso_3166_2'},
    {'id': 'ecuador',     'admin': 'Ecuador',        'group_by': 'name_en', 'id_from': 'iso_3166_2'},
    {'id': 'france',      'admin': 'France',         'group_by': 'region',  'id_from': None,         'dissolve': True},
    {'id': 'germany',     'admin': 'Germany',        'group_by': 'name_en', 'id_from': 'iso_3166_2'},
    {'id': 'greece',      'admin': 'Greece',         'group_by': 'name_en', 'id_from': 'iso_3166_2'},
    {'id': 'haiti',       'admin': 'Haiti',          'group_by': 'name_en', 'id_from': 'iso_3166_2'},
    {'id': 'iceland',     'admin': 'Iceland',        'group_by': 'name_en', 'id_from': 'iso_3166_2',
     'regroup': {'Reykjavík': 'Capital'}},
    {'id': 'india',       'admin': 'India',          'group_by': 'name_en', 'id_from': 'iso_3166_2'},
    {'id': 'ireland',     'admin': 'Ireland',        'group_by': 'name_en', 'id_from': 'iso_3166_2', 'dissolve': True,
     'regroup': {'Dún Laoghaire–Rathdown': 'Dublin', 'Fingal': 'Dublin', 'South Dublin': 'Dublin'}},
    {'id': 'jamaica',     'admin': 'Jamaica',        'group_by': 'name',    'id_from': 'iso_3166_2'},
    {'id': 'japan',       'admin': 'Japan',          'group_by': 'name',    'id_from': 'iso_3166_2'},
    {'id': 'netherlands', 'admin': 'Netherlands',    'group_by': 'name_en', 'id_from': 'iso_3166_2'},
    {'id': 'new-zealand', 'admin': 'New Zealand',    'group_by': 'name_en', 'id_from': 'iso_3166_2'},
    {'id': 'portugal',    'admin': 'Portugal',       'group_by': 'name_en', 'id_from': 'iso_3166_2'},
    {'id': 'south-korea', 'admin': 'South Korea',    'group_by': 'name_en', 'id_from': 'iso_3166_2'},
    {'id': 'sweden',      'admin': 'Sweden',         'group_by': 'name_en', 'id_from': 'iso_3166_2'},
    {'id': 'switzerland', 'admin': 'Switzerland',    'group_by': 'name_en', 'id_from': 'iso_3166_2'},
    {'id': 'uk',          'admin': 'United Kingdom', 'group_by': 'region',  'id_from': None,         'dissolve': True,
     'regroup': {'Highlands and Islands': 'Scotland', 'North Eastern': 'Scotland', 'Eastern': 'Scotland',
                 'South Western': 'Scotland', 'West Wales and the Valleys': 'Wales', 'East Wales': 'Wales'}},
]

# Display-name overrides, keyed by (country id, grouped value).
DISPLAY_NAMES = {
    ('mexico', 'Mexico'): 'Ciudad de México',
    ('mexico', 'State of Mexico'): 'México',
    ('spain', 'Canary Is.'): 'Canarias',
    ('spain', 'Foral de Navarra'): 'Navarra',
    ('spain', 'Valenciana'): 'Comunidad Valenciana',
    ('italy', 'Sicily'): 'Sicilia',
    ('italy', 'Apulia'): 'Puglia',
    ('belgium', 'Brussels Capital'): 'Brussels',
    ('france', 'Guyane française'): 'French Guiana',
    ('germany', 'Free Hanseatic Bremen'): 'Bremen',
    ('greece', 'Centre Macedonia'): 'Central Macedonia',
    ('iceland', 'Capital'): 'Capital Region',
    ('iceland', 'Southern'): 'Southern Region',
    ('iceland', 'Western'): 'Western Region',
    ('iceland', 'Northwestern'): 'Northwestern Region',
    ('iceland', 'Northeastern'): 'Northeastern Region',
    ('iceland', 'Austurland'): 'Eastern Region',
    ('uk', 'East'): 'East of England',
    ('uk', 'Greater London'): 'London',
}

# Extra spellings accepted when matching a geocoded name to a polygon, keyed by
# (country id, grouped value). Nominatim is queried with accept-language=en, so
# these are mostly its English renderings plus the native forms; strava.js
# normalises case, accents and punctuation before comparing, so only genuinely
# different words need listing here.
ALIASES = {
    # ── Canada ──
    ('canada', 'Quebec'): ['Québec'],

    # ── Australia ──
    ('australia', 'AU-ACT'): ['Australian Capital Territory', 'Jervis Bay Territory'],

    # ── Mexico ── (Nominatim returns the official Spanish names)
    ('mexico', 'Mexico'): ['Ciudad de México', 'Mexico City', 'Distrito Federal', 'CDMX'],
    ('mexico', 'State of Mexico'): ['México', 'Estado de México'],
    ('mexico', 'Coahuila'): ['Coahuila de Zaragoza'],
    ('mexico', 'Michoacán'): ['Michoacán de Ocampo'],
    ('mexico', 'Veracruz'): ['Veracruz de Ignacio de la Llave'],
    ('mexico', 'Querétaro'): ['Querétaro de Arteaga'],

    # ── China ── (strava.js strips " Province" / " Autonomous Region" etc.
    # first, so the leftovers are what we alias)
    ('china', 'Tibet'): ['Xizang', 'Tibet Autonomous', 'Xizang Zizhiqu'],
    ('china', 'Inner Mongolia'): ['Inner Mongol', 'Nei Mongol', 'Inner Mongolia Autonomous'],
    ('china', 'Xinjiang'): ['Xinjiang Uygur', 'Xinjiang Uyghur'],
    ('china', 'Guangxi'): ['Guangxi Zhuang'],
    ('china', 'Ningxia'): ['Ningxia Hui'],
    ('china', 'Hong Kong'): ['Hong Kong SAR', 'HKSAR', 'Xianggang'],
    ('china', 'Macau'): ['Macao', 'Macau SAR', 'Macao SAR', 'Aomen'],

    # ── Spain ── (Nominatim's English names for the autonomous communities)
    ('spain', 'Andalucía'): ['Andalusia'],
    ('spain', 'Aragón'): ['Aragon'],
    ('spain', 'Asturias'): ['Principality of Asturias', 'Principado de Asturias'],
    ('spain', 'Canary Is.'): ['Canary Islands', 'Canarias', 'Islas Canarias'],
    ('spain', 'Castilla y León'): ['Castile and León', 'Castile and Leon'],
    ('spain', 'Castilla-La Mancha'): ['Castile-La Mancha'],
    ('spain', 'Cataluña'): ['Catalonia', 'Catalunya'],
    ('spain', 'Foral de Navarra'): ['Navarre', 'Navarra', 'Chartered Community of Navarre',
                                    'Comunidad Foral de Navarra'],
    ('spain', 'Islas Baleares'): ['Balearic Islands', 'Illes Balears', 'Baleares'],
    ('spain', 'Madrid'): ['Community of Madrid', 'Comunidad de Madrid'],
    ('spain', 'Murcia'): ['Region of Murcia', 'Región de Murcia'],
    ('spain', 'País Vasco'): ['Basque Country', 'Euskadi'],
    ('spain', 'Valenciana'): ['Valencian Community', 'Comunidad Valenciana',
                              'Comunitat Valenciana', 'Valencia'],

    # ── Italy ── (Nominatim's English names for the 20 regions)
    ('italy', 'Apulia'): ['Puglia'],
    ('italy', 'Emilia-Romagna'): ['Emilia Romagna'],
    ('italy', 'Friuli-Venezia Giulia'): ['Friuli Venezia Giulia', 'Friuli'],
    ('italy', 'Lombardia'): ['Lombardy'],
    ('italy', 'Piemonte'): ['Piedmont'],
    ('italy', 'Sardegna'): ['Sardinia'],
    ('italy', 'Sicily'): ['Sicilia'],
    ('italy', 'Toscana'): ['Tuscany'],
    ('italy', 'Trentino-Alto Adige'): ['Trentino-South Tyrol', 'Trentino Alto Adige',
                                       'Trentino-Alto Adige/Südtirol', 'South Tyrol'],
    ('italy', "Valle d'Aosta"): ['Aosta Valley', "Vallée d'Aoste", 'Aosta'],

    # ── World Travel Map countries ── (English and native names, for a later
    # SUBDIVISION_CONFIG entry; the world map itself matches by geometry)
    ('france', 'Bretagne'): ['Brittany'],
    ('france', 'Normandie'): ['Normandy'],
    ('france', 'Corse'): ['Corsica'],
    ('france', 'Bourgogne-Franche-Comté'): ['Burgundy-Franche-Comté'],
    ('france', 'Centre-Val de Loire'): ['Centre-Loire Valley'],
    ("france", "Provence-Alpes-Côte-d'Azur"): ["Provence-Alpes-Côte d'Azur", 'PACA'],
    ('france', 'Guyane française'): ['Guyane', 'French Guiana'],
    ('france', 'Réunion'): ['La Réunion'],
    ('iceland', 'Capital'): ['Höfuðborgarsvæðið', 'Höfuðborgarsvæði', 'Reykjavík'],
    ('ireland', 'Dublin'): ['County Dublin'],
    ('uk', 'East'): ['East of England'],
    ('uk', 'Greater London'): ['London'],
    ('uk', 'Yorkshire and the Humber'): ['Yorkshire'],
}

# Names Natural Earth attaches to a region that actually belong to another one
# in the same country — dropped so a geocoded name can't match two polygons.
DROP_ALIASES = {
    ('us', 'District of Columbia'): ['Washington'],   # its name_local; Washington state owns it
    ('mexico', 'Mexico'): ['Mexico'],                 # bare "Mexico" is the state, not the city
}

# Natural Earth entries that are not real first-level regions (disputed claims,
# uninhabited outliers) — dropped so the "N regions" totals stay honest.
SKIP_ISO = {'CN-X01~', 'MX-X01~', 'AU-X02~', 'AU-X03~',
            # New Zealand's uninhabited outlying islands, and Tokelau
            'NZ-X01~', 'NZ-X03~', 'NZ-X04~', 'NZ-X05~', 'NZ-X06~', 'NZ-X07~', 'TK-X01~',
            # Saba / Sint Eustatius: Caribbean special municipalities, not provinces
            'NL-BQ2', 'NL-BQ3'}


def norm(s):
    """Match strava.js's normRegionName(): accent-free, lowercase, alnum words."""
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    out = []
    for ch in s.lower():
        out.append(ch if ch.isalnum() and ch.isascii() else ' ')
    return ' '.join(''.join(out).split())


def clean_geometry(geom):
    """Simplify, then drop parts too small to see at country zoom."""
    geom = geom.buffer(0).simplify(TOLERANCE, preserve_topology=True)
    if geom.geom_type == 'MultiPolygon':
        parts = [p for p in geom.geoms if p.area >= MIN_PART_AREA]
        if not parts:                      # tiny region — keep its largest part
            parts = [max(geom.geoms, key=lambda p: p.area)]
        geom = unary_union(parts)
    return geom


def cut_enclaves(admin, geoms, enclaves):
    """Cuts each enclave in `admin` out of the regions around it, hands them any
    gap left between them and its border, and moves the points where a region's
    border meets the enclave onto the enclave's own vertices — so each region
    and the enclave share exactly the same border, vertex for vertex."""
    for name, enclave in enclaves.items():
        if enclave['host'] != admin:
            continue
        e = Polygon(enclave['ring'])
        near = [i for i, g in enumerate(geoms) if g.distance(e) < ENCLAVE_NEAR]
        if not near:
            raise SystemExit(f'{name}: no region of {admin} near it')
        for i in near:
            geoms[i] = geoms[i].difference(e)
        # Where Natural Earth's hole was bigger than the real outline. Only gaps
        # enclosed by the regions — a sliver between two regions that runs on
        # past the neighbourhood is their mismatch, not the enclave's.
        area = e.buffer(ENCLAVE_NEAR)
        gap = area.difference(unary_union([geoms[i] for i in near] + [e]))
        for piece in getattr(gap, 'geoms', [gap]):
            if piece.is_empty or piece.distance(e) > 1e-9 or piece.distance(area.exterior) < 1e-9:
                continue
            best = max(near, key=lambda i: piece.boundary.intersection(geoms[i].buffer(1e-7)).length)
            geoms[best] = geoms[best].union(piece)
        vertices = list(e.exterior.coords)[:-1]
        for i in near:
            geoms[i] = snap_to_ring(geoms[i], e.exterior, vertices)
            if not geoms[i].is_valid:
                raise SystemExit(f'{name}: cutting it out left an invalid region')
    return geoms


def snap_to_ring(geom, ring, vertices):
    """Moves every vertex of `geom` that lies on `ring` but isn't one of its
    vertices (where a region's own border crosses it) to the nearest one."""
    def fix(coords):
        out = []
        for x, y in coords:
            if (x, y) not in vertices and ring.distance(Point(x, y)) < 1e-9:
                x, y = min(vertices, key=lambda v: (v[0] - x) ** 2 + (v[1] - y) ** 2)
            if not out or out[-1] != (x, y):
                out.append((x, y))
        return out
    polys = geom.geoms if geom.geom_type == 'MultiPolygon' else [geom]
    polys = [Polygon(fix(p.exterior.coords), [fix(h.coords) for h in p.interiors]) for p in polys]
    return polys[0] if len(polys) == 1 else MultiPolygon(polys)


def round_coords(obj, nd=4):
    """~11 m precision — plenty for country-scale maps, and halves the file."""
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(c), nd) for c in obj]
        return [round_coords(o, nd) for o in obj]
    return obj


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else None
    if not src:
        src = os.path.join(tempfile.gettempdir(), 'ne_10m_admin_1_states_provinces.geojson')
        if not os.path.exists(src):
            print(f'Downloading {NE_URL} …')
            urllib.request.urlretrieve(NE_URL, src)

    with open(src) as fh:
        ne = json.load(fh)

    with open(ENCLAVES, encoding='utf-8') as fh:
        enclaves = json.load(fh)

    os.makedirs(OUT_DIR, exist_ok=True)
    for cfg in COUNTRIES:
        out_features = []
        groups = {}                                    # grouped value → list of parts
        fold_in = cfg.get('fold_in') or {}
        folded_ids = {name: rid for name, rid in fold_in.values()}
        for f in ne['features']:
            p = f['properties']
            if p.get('admin') in fold_in:
                groups.setdefault(fold_in[p['admin']][0], []).append((shape(f['geometry']), p))
                continue
            if p.get('admin') != cfg['admin']:
                continue
            if p.get('iso_3166_2') in SKIP_ISO:
                continue
            key = p.get(cfg['group_by'])
            key = (cfg.get('regroup') or {}).get(key, key)
            if not key:
                print(f"  ! {cfg['id']}: feature with no {cfg['group_by']} — skipped")
                continue
            groups.setdefault(key, []).append((shape(f['geometry']), p))

        for key, parts in sorted(groups.items()):
            # The mainland/largest part names the region — for a grouped state
            # like NSW that's the mainland, not Lord Howe Island.
            p = max(parts, key=lambda t: t[0].area)[1]
            # The grouped value is already a name everywhere except Australia,
            # which is grouped by ISO code to fold its islands into their state.
            name = (DISPLAY_NAMES.get((cfg['id'], key))
                    or (p.get('name_en') if cfg['group_by'] == 'iso_3166_2' else key)
                    or key)
            rid = folded_ids.get(key) or (p.get(cfg['id_from']) if cfg.get('id_from') else None) or f"{cfg['id']}-{norm(key).replace(' ', '-')}"

            # Only trust Natural Earth's own names where its features already
            # are the region; when dissolving they are provinces inside it.
            # A folded-in region is dissolved from districts, so the same applies.
            ne_names = [] if cfg.get('dissolve') or key in folded_ids else [p.get('name'), p.get('name_en'), p.get('name_local')]
            dropped = {norm(a) for a in DROP_ALIASES.get((cfg['id'], key)) or []}
            aliases, seen = [], set()
            # `key` is only worth keeping when it's a name — for countries
            # grouped by ISO code it is the id, which nothing geocodes to.
            for cand in [name, (None if key == rid else key), *ne_names,
                         *(ALIASES.get((cfg['id'], key)) or [])]:
                n = norm(cand or '')
                if n in dropped:
                    continue
                if n and n not in seen:
                    seen.add(n)
                    aliases.append(cand)

            out_features.append({
                'type': 'Feature',
                'properties': {'id': rid, 'country': cfg['id'], 'name': name, 'aliases': aliases},
                'geometry': clean_geometry(unary_union([g for g, _ in parts])),
            })

        geoms = cut_enclaves(cfg['admin'], [f['geometry'] for f in out_features], enclaves)
        for f, geom in zip(out_features, geoms):
            f['geometry'] = {'type': geom.geom_type, 'coordinates': round_coords(mapping(geom)['coordinates'])}

        # Guard against a source change silently merging two regions into one.
        seen = {}
        for f in out_features:
            for a in f['properties']['aliases']:
                n = norm(a)
                if n in seen and seen[n] != f['properties']['id']:
                    print(f"  ! {cfg['id']}: alias {a!r} is ambiguous "
                          f"({seen[n]} vs {f['properties']['id']})")
                seen[n] = f['properties']['id']

        out = {'type': 'FeatureCollection',
               'features': sorted(out_features, key=lambda f: f['properties']['name'])}
        path = os.path.join(OUT_DIR, f"{cfg['id']}.geojson")
        with open(path, 'w') as fh:
            json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)
        print(f"  {cfg['id']:10s} {len(out_features):3d} regions  "
              f"{os.path.getsize(path) / 1e6:.2f} MB")


if __name__ == '__main__':
    main()

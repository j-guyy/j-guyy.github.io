#!/usr/bin/env python3
"""
Build data/admin1/<country>.geojson — first-level administrative regions for
the countries the Strava page breaks activities down by (see
SUBDIVISION_CONFIG in js/strava.js). One file per country so a region map only
downloads the boundaries it draws.

Source: Natural Earth 10m admin-1 states/provinces (public domain).
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson

Natural Earth splits Italy and Spain into provinces, not the regions /
autonomous communities that Nominatim reports as `address.state`, so those two
are dissolved up a level using Natural Earth's own `region` field.

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

from shapely.geometry import shape, mapping
from shapely.ops import unary_union

NE_URL = ('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/'
          'master/geojson/ne_10m_admin_1_states_provinces.geojson')

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'admin1')

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
COUNTRIES = [
    {'id': 'us',        'admin': 'United States of America', 'group_by': 'name',       'id_from': 'iso_3166_2'},
    {'id': 'canada',    'admin': 'Canada',                   'group_by': 'name_en',    'id_from': 'iso_3166_2'},
    {'id': 'australia', 'admin': 'Australia',                'group_by': 'iso_3166_2', 'id_from': 'iso_3166_2'},
    {'id': 'mexico',    'admin': 'Mexico',                   'group_by': 'name_en',    'id_from': 'iso_3166_2'},
    {'id': 'china',     'admin': 'China',                    'group_by': 'name_en',    'id_from': 'iso_3166_2'},
    {'id': 'spain',     'admin': 'Spain',                    'group_by': 'region',     'id_from': None,         'dissolve': True},
    {'id': 'italy',     'admin': 'Italy',                    'group_by': 'region',     'id_from': 'region_cod', 'dissolve': True},
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
}

# Names Natural Earth attaches to a region that actually belong to another one
# in the same country — dropped so a geocoded name can't match two polygons.
DROP_ALIASES = {
    ('us', 'District of Columbia'): ['Washington'],   # its name_local; Washington state owns it
    ('mexico', 'Mexico'): ['Mexico'],                 # bare "Mexico" is the state, not the city
}

# Natural Earth entries that are not real first-level regions (disputed claims,
# uninhabited outliers) — dropped so the "N regions" totals stay honest.
SKIP_ISO = {'CN-X01~', 'MX-X01~', 'AU-X02~', 'AU-X03~'}


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

    os.makedirs(OUT_DIR, exist_ok=True)
    for cfg in COUNTRIES:
        out_features = []
        groups = {}                                    # grouped value → list of parts
        for f in ne['features']:
            p = f['properties']
            if p.get('admin') != cfg['admin']:
                continue
            if p.get('iso_3166_2') in SKIP_ISO:
                continue
            key = p.get(cfg['group_by'])
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
            rid = (p.get(cfg['id_from']) if cfg.get('id_from') else None) or f"{cfg['id']}-{norm(key).replace(' ', '-')}"

            # Only trust Natural Earth's own names where its features already
            # are the region; when dissolving they are provinces inside it.
            ne_names = [] if cfg.get('dissolve') else [p.get('name'), p.get('name_en'), p.get('name_local')]
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

            geom = clean_geometry(unary_union([g for g, _ in parts]))
            out_features.append({
                'type': 'Feature',
                'properties': {'id': rid, 'country': cfg['id'], 'name': name, 'aliases': aliases},
                'geometry': {'type': geom.geom_type, 'coordinates': round_coords(mapping(geom)['coordinates'])},
            })

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

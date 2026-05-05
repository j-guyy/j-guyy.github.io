import fiona
import json
import re
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform as shp_transform

GDB    = r"C:\Users\justi\Downloads\PADUS4_1Geodatabase\PADUS4_1Geodatabase.gdb"
LAYER  = 'PADUS4_1Fee'
OUTPUT = r"C:\Users\justi\OneDrive\Documents\Code_Repository\Workspace\j-guyy.github.io\data\state-parks.geojson"

# Reproject from PAD-US native CRS to WGS84
transformer = Transformer.from_crs("ESRI:102039", "EPSG:4326", always_xy=True)

def slugify(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

def reproject_and_simplify(geom_dict):
    geom = shape(geom_dict)
    geom = shp_transform(transformer.transform, geom)
    geom = geom.simplify(0.001)  # ~100m in degrees
    return mapping(geom)

features = []
seen_ids = set()

print(f"Opening {LAYER}...")
with fiona.open(GDB, layer=LAYER) as src:
    total = len(src)
    print(f"Total features in layer: {total}")
    for i, feat in enumerate(src):
        p = feat['properties']
        if p.get('Own_Type') != 'STAT' or p.get('Des_Tp') != 'SP':
            continue
        if i % 1000 == 0:
            print(f"  Scanning {i}/{total} — {len(features)} parks found so far...")

        name  = (p.get('Unit_Nm') or '').strip()
        state = (p.get('State_Nm') or '').strip()
        label = (p.get('Loc_Ds') or 'State Park').strip()
        if not name or not feat['geometry']:
            continue

        # Unique slug ID
        base = f"sp-{slugify(state)}-{slugify(name)}"
        uid, n = base, 1
        while uid in seen_ids:
            uid = f"{base}-{n}"
            n += 1
        seen_ids.add(uid)

        try:
            geom = reproject_and_simplify(feat['geometry'])
        except Exception as e:
            print(f"  Skipping '{name}' ({state}): {e}")
            continue

        features.append({
            'type': 'Feature',
            'properties': {
                'id':     uid,
                'name':   name,
                'state':  state,
                'agency': 'STATE',
                'type':   label,
            },
            'geometry': geom,
        })

print(f"\nWriting {len(features)} state parks to GeoJSON...")
with open(OUTPUT, 'w') as f:
    json.dump({'type': 'FeatureCollection', 'features': features}, f, separators=(',', ':'))

size_mb = len(json.dumps({'type': 'FeatureCollection', 'features': features})) / 1_000_000
print(f"Done! Output: {OUTPUT}")
print(f"File size: ~{size_mb:.1f} MB, Features: {len(features)}")

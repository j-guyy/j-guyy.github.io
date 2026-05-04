"""
build-federal-lands.py
Download USA Federal Lands from the public ArcGIS REST service and convert to
a compact GeoJSON suitable for client-side point-in-polygon detection.

Agencies included:
  - National Park Service (all units)
  - Forest Service (National Forests + National Grasslands)
  - Fish and Wildlife Service (National Wildlife Refuges only)

Output: data/federal-lands.geojson
Run:    py scripts/build-federal-lands.py
"""

import json
import sys
import time
import urllib.request
import urllib.parse
from collections import defaultdict

# ── Config ────────────────────────────────────────────────────────────────────

SERVICE = (
    "https://services5.arcgis.com/7weheFjxuNkGGiZi/arcgis/rest"
    "/services/USA_Federal_Lands_2025/FeatureServer/0"
)

OUT_PATH = r"C:\Users\justi\OneDrive\Documents\Code_Repository\Workspace\j-guyy.github.io\data\federal-lands.geojson"

# Douglas-Peucker tolerance in degrees (~0.005° ≈ 500 m)
SIMPLIFY_TOL = 0.005

# Agency name in service → short code used in output
AGENCIES = {
    "National Park Service":    "NPS",
    "Forest Service":           "USFS",
    "Fish and Wildlife Service":"USFWS",
}

# For USFWS only keep units whose name contains one of these strings
USFWS_KEEP = ["National Wildlife Refuge", "National Fish Hatchery"]

PAGE_SIZE = 1000

# ── HTTP helper ───────────────────────────────────────────────────────────────

def fetch_json(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"    retry ({e})…", end=" ", flush=True)
            time.sleep(2)

def query_page(where, offset):
    params = urllib.parse.urlencode({
        "where":             where,
        "outFields":         "Agency,Unit_Name",
        "returnGeometry":    "true",
        "outSR":             "4326",
        "f":                 "geojson",
        "resultRecordCount": PAGE_SIZE,
        "resultOffset":      offset,
    })
    return fetch_json(f"{SERVICE}/query?{params}")

def fetch_all_features(agency_name):
    where = f"Agency='{agency_name}'"
    features, offset = [], 0
    while True:
        print(f"    offset {offset:>6}… ", end="", flush=True)
        data = query_page(where, offset)
        batch = data.get("features", [])
        print(f"{len(batch)} features")
        features.extend(batch)
        # Stop when we get fewer than a full page
        if len(batch) < PAGE_SIZE:
            break
        offset += len(batch)
        time.sleep(0.15)   # be polite to the server
    return features

# ── Geometry ──────────────────────────────────────────────────────────────────

def _perp_dist(pt, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = dx*dx + dy*dy
    if L == 0:
        return ((pt[0]-a[0])**2 + (pt[1]-a[1])**2) ** 0.5
    return abs((pt[1]-a[1])*dx - (pt[0]-a[0])*dy) / L**0.5

def _dp(pts, tol):
    if len(pts) <= 2:
        return pts
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        d = _perp_dist(pts[i], pts[0], pts[-1])
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        l = _dp(pts[:idx+1], tol)
        r = _dp(pts[idx:],   tol)
        return l[:-1] + r
    return [pts[0], pts[-1]]

def simplify_ring(ring, tol):
    """Return simplified + rounded ring, or None if degenerate."""
    pts = _dp(ring, tol)
    # close the ring
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    if len(pts) < 4:          # need at least 3 unique vertices + close
        return None
    return [[round(c, 5) for c in p] for p in pts]

def extract_poly_rings(geom):
    """Yield each polygon's ring-list from a Polygon or MultiPolygon geometry."""
    if not geom:
        return
    gtype = geom.get("type")
    coords = geom.get("coordinates", [])
    if gtype == "Polygon":
        yield coords          # [ [exterior], [hole], … ]
    elif gtype == "MultiPolygon":
        for poly_rings in coords:
            yield poly_rings  # each element is [ [exterior], [hole], … ]

# ── Type inference ────────────────────────────────────────────────────────────

TYPE_MAP = [
    ("national park",            "National Park"),
    ("national monument",        "National Monument"),
    ("national forest",          "National Forest"),
    ("national grassland",       "National Grassland"),
    ("national recreation area", "National Recreation Area"),
    ("national seashore",        "National Seashore"),
    ("national lakeshore",       "National Lakeshore"),
    ("national riverway",        "National Riverway"),
    ("national river",           "National River"),
    ("national scenic trail",    "National Scenic Trail"),
    ("national memorial",        "National Memorial"),
    ("national historic",        "National Historic Site"),
    ("national battlefield",     "National Battlefield"),
    ("national parkway",         "National Parkway"),
    ("parkway",                  "National Parkway"),
    ("national wildlife refuge", "National Wildlife Refuge"),
    ("fish hatchery",            "National Fish Hatchery"),
    ("wilderness",               "Wilderness Area"),
]

def infer_type(unit_name):
    n = unit_name.lower()
    for fragment, label in TYPE_MAP:
        if fragment in n:
            return label
    return "Federal Land"

def unit_id(abbr, unit_name):
    slug = unit_name.lower()
    for ch in " /,'.()\\":
        slug = slug.replace(ch, "-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return f"{abbr.lower()}-{slug.strip('-')}"

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    # unit_polys: (abbr, unit_name) → list of polygon ring-lists (each item is one polygon)
    unit_polys = defaultdict(list)

    for agency_name, abbr in AGENCIES.items():
        print(f"\n{'─'*60}")
        print(f"  {agency_name} ({abbr})")
        print(f"{'─'*60}")

        features = fetch_all_features(agency_name)

        kept = skipped = 0
        for feat in features:
            props = feat.get("properties") or {}
            unit  = (props.get("Unit_Name") or "").strip()
            if not unit:
                skipped += 1
                continue

            # Filter USFWS to named refuge/hatchery units only
            if abbr == "USFWS":
                if not any(kw.lower() in unit.lower() for kw in USFWS_KEEP):
                    skipped += 1
                    continue

            geom = feat.get("geometry")
            for poly_rings in extract_poly_rings(geom):
                simplified = [simplify_ring(r, SIMPLIFY_TOL) for r in poly_rings]
                simplified = [r for r in simplified if r]
                if simplified:
                    unit_polys[(abbr, unit)].append(simplified)
                    kept += 1

        unique = sum(1 for k in unit_polys if k[0] == abbr)
        print(f"\n  → {unique} unique units  ({kept} polys kept, {skipped} skipped)")

    # ── Build output GeoJSON ──────────────────────────────────────────────────
    print(f"\n{'─'*60}")
    print(f"  Building output GeoJSON…")

    out_features = []
    for (abbr, unit_name), polys in sorted(unit_polys.items(), key=lambda x: x[0][1]):
        out_features.append({
            "type": "Feature",
            "properties": {
                "id":     unit_id(abbr, unit_name),
                "name":   unit_name,
                "agency": abbr,
                "type":   infer_type(unit_name),
            },
            "geometry": {
                "type":        "MultiPolygon",
                "coordinates": polys,
            },
        })

    output = {"type": "FeatureCollection", "features": out_features}

    compact = json.dumps(output, separators=(",", ":"))
    size_mb = len(compact.encode("utf-8")) / 1_000_000

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(compact)

    print(f"\n✓  {OUT_PATH}")
    print(f"   {len(out_features)} units  |  {size_mb:.1f} MB")

    # Quick breakdown by type
    by_type = defaultdict(int)
    for feat in out_features:
        by_type[feat["properties"]["type"]] += 1
    print("\n  By type:")
    for t, n in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"    {t:<35} {n}")

if __name__ == "__main__":
    main()

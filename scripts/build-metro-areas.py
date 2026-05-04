"""
build-metro-areas.py
Match metros.json entries to Census TIGERweb MSA boundaries via spatial query
(point-in-polygon on each metro's lat/lng), then download and simplify the
matched polygons.

Output: data/metro-areas.geojson
Run:    py scripts/build-metro-areas.py
"""

import json
import time
import urllib.request
import urllib.parse
from collections import defaultdict

TIGERWEB = (
    "https://tigerweb.geo.census.gov/arcgis/rest"
    "/services/TIGERweb/tigerWMS_Current/MapServer/93"
)

METROS_PATH = r"C:\Users\justi\OneDrive\Documents\Code_Repository\Workspace\j-guyy.github.io\data\metros.json"
OUT_PATH    = r"C:\Users\justi\OneDrive\Documents\Code_Repository\Workspace\j-guyy.github.io\data\metro-areas.geojson"

SIMPLIFY_TOL = 0.01   # degrees — county lines are already simple, 0.01 ~ 1 km

# ── HTTP ──────────────────────────────────────────────────────────────────────

def fetch_json(url, retries=3):
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if attempt == retries - 1:
                raise
            print(f"    retry ({e})...", flush=True)
            time.sleep(2)

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
        return _dp(pts[:idx+1], tol)[:-1] + _dp(pts[idx:], tol)
    return [pts[0], pts[-1]]

def simplify_ring(ring, tol):
    pts = _dp(ring, tol)
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    if len(pts) < 4:
        return None
    return [[round(c, 5) for c in p] for p in pts]

def extract_polys(geom, tol):
    """Return list of polygon ring-lists from a GeoJSON geometry, simplified."""
    if not geom:
        return []
    gtype = geom.get("type")
    coords = geom.get("coordinates", [])
    result = []
    if gtype == "Polygon":
        rings = [simplify_ring(r, tol) for r in coords]
        rings = [r for r in rings if r]
        if rings:
            result.append(rings)
    elif gtype == "MultiPolygon":
        for poly_rings in coords:
            rings = [simplify_ring(r, tol) for r in poly_rings]
            rings = [r for r in rings if r]
            if rings:
                result.append(rings)
    return result

# ── Step 1: spatial match ─────────────────────────────────────────────────────

def point_in_msa(lng, lat):
    """Ask TIGERweb which MSA contains this point. Returns attributes or None."""
    params = urllib.parse.urlencode({
        "geometry":      f"{lng},{lat}",
        "geometryType":  "esriGeometryPoint",
        "inSR":          "4326",
        "spatialRel":    "esriSpatialRelIntersects",
        "outFields":     "GEOID,CBSA,BASENAME,NAME",
        "returnGeometry":"false",
        "f":             "json",
    })
    data = fetch_json(f"{TIGERWEB}/query?{params}")
    features = data.get("features", [])
    return features[0]["attributes"] if features else None

# ── Step 2: geometry download ─────────────────────────────────────────────────

def fetch_geometries(geoids, batch_size=40):
    """Download simplified geometries for a list of CBSA GEOIDs."""
    all_features = []
    for i in range(0, len(geoids), batch_size):
        batch = geoids[i:i+batch_size]
        ids_sql = ",".join(f"'{g}'" for g in batch)
        params = urllib.parse.urlencode({
            "where":          f"GEOID IN ({ids_sql})",
            "outFields":      "GEOID,BASENAME",
            "outSR":          "4326",
            "returnGeometry": "true",
            "f":              "geojson",
        })
        data = fetch_json(f"{TIGERWEB}/query?{params}")
        all_features.extend(data.get("features", []))
        print(f"    batch {i//batch_size + 1}: got {len(data.get('features',[]))} features", flush=True)
        time.sleep(0.3)
    return {"type": "FeatureCollection", "features": all_features}

# ── Main ──────────────────────────────────────────────────────────────────────

def metro_id(metro):
    slug = metro["name"].lower()
    for ch in " /,'.()\\":
        slug = slug.replace(ch, "-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return f"metro-{slug.strip('-')}-{metro['state'].lower()}"

def main():
    metros = json.load(open(METROS_PATH, encoding="utf-8"))
    print(f"Loaded {len(metros)} metros\n")

    # ── Phase 1: spatial match each metro to a Census CBSA ───────────────────
    print("=" * 62)
    print("  Phase 1: matching metros to Census MSAs via spatial query")
    print("=" * 62)

    matched    = []   # list of { metro, geoid, census_name }
    duplicates = []   # (metro_a, metro_b, geoid, census_name)
    no_match   = []   # metros with no containing MSA

    geoid_to_first_metro = {}  # geoid -> first metro that claimed it

    for m in metros:
        lng, lat = m["coords"]
        result = point_in_msa(lng, lat)
        time.sleep(0.12)   # ~8 req/s, well within limits

        if result:
            geoid       = result["GEOID"]
            census_name = result["BASENAME"]

            if geoid in geoid_to_first_metro:
                # Two metros resolved to the same MSA
                duplicates.append((geoid_to_first_metro[geoid], m, geoid, census_name))
                print(f"  DUP  {m['name']:<22} -> {census_name}  [same as #{geoid_to_first_metro[geoid]['rank']} {geoid_to_first_metro[geoid]['name']}]")
            else:
                geoid_to_first_metro[geoid] = m
                print(f"  OK   {m['name']:<22} -> {census_name}")

            matched.append({"metro": m, "geoid": geoid, "census_name": census_name})
        else:
            no_match.append(m)
            print(f"  MISS {m['name']:<22} -> no MSA found at {lat:.4f},{lng:.4f}")

    # ── Phase 1 report ────────────────────────────────────────────────────────
    print(f"\n{'=' * 62}")
    print(f"  Results: {len(matched) - len(duplicates)} unique MSAs matched")
    print(f"           {len([d for d in matched if d['geoid']])} total match entries")

    if duplicates:
        print(f"\n  *** DUPLICATES ({len(duplicates)}) — two metros share one MSA ***")
        for a, b, geoid, name in duplicates:
            print(f"      #{a['rank']} {a['name']}  +  #{b['rank']} {b['name']}  ->  {name} ({geoid})")
        print("  Both cities will use the same polygon.")

    if no_match:
        print(f"\n  *** NO MATCH ({len(no_match)}) ***")
        for m in no_match:
            print(f"      #{m['rank']} {m['name']} ({m['metro_state']}) at {m['coords']}")

    # ── Phase 2: download geometry for unique GEOIDs ──────────────────────────
    unique_geoids = list(geoid_to_first_metro.keys())
    print(f"\n{'=' * 62}")
    print(f"  Phase 2: downloading geometry for {len(unique_geoids)} unique MSAs")
    print("=" * 62)

    raw = fetch_geometries(unique_geoids)
    geom_by_geoid = {}
    for feat in raw.get("features", []):
        gid  = feat["properties"]["GEOID"]
        geom = feat.get("geometry")
        polys = extract_polys(geom, SIMPLIFY_TOL)
        if polys:
            geom_by_geoid[gid] = polys

    print(f"  Received geometry for {len(geom_by_geoid)} / {len(unique_geoids)} GEOIDs")

    missing_geom = [g for g in unique_geoids if g not in geom_by_geoid]
    if missing_geom:
        print(f"  WARNING: no geometry for GEOIDs: {missing_geom}")

    # ── Phase 3: build output GeoJSON ─────────────────────────────────────────
    print(f"\n{'=' * 62}")
    print("  Phase 3: building output GeoJSON")
    print("=" * 62)

    # Build geoid -> list of metros (for duplicates, both entries get the polygon)
    geoid_to_metros = defaultdict(list)
    for entry in matched:
        if entry["geoid"]:
            geoid_to_metros[entry["geoid"]].append(entry)

    out_features = []
    skipped = 0

    # Output one feature per metro (duplicates share same polygon but get separate entries)
    seen_metros = set()
    for geoid, entries in geoid_to_metros.items():
        polys = geom_by_geoid.get(geoid)
        if not polys:
            skipped += len(entries)
            continue
        for entry in entries:
            m = entry["metro"]
            mid = metro_id(m)
            if mid in seen_metros:
                continue
            seen_metros.add(mid)
            out_features.append({
                "type": "Feature",
                "properties": {
                    "id":          mid,
                    "rank":        m["rank"],
                    "name":        m["name"],
                    "metro_name":  m["metro_name"],
                    "state":       m["state"],
                    "metro_state": m.get("metro_state", m["state"]),
                    "population":  m.get("population", ""),
                    "geoid":       geoid,
                    "census_name": entry["census_name"],
                },
                "geometry": {
                    "type":        "MultiPolygon",
                    "coordinates": polys,
                },
            })

    # Sort by rank
    out_features.sort(key=lambda f: f["properties"]["rank"])

    output  = {"type": "FeatureCollection", "features": out_features}
    compact = json.dumps(output, separators=(",", ":"))
    size_mb = len(compact.encode("utf-8")) / 1_000_000

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(compact)

    print(f"\n  Written: {OUT_PATH}")
    print(f"  {len(out_features)} metro features  |  {size_mb:.1f} MB")
    if skipped:
        print(f"  {skipped} entries skipped (no geometry returned)")
    if no_match:
        print(f"\n  NOTE: {len(no_match)} metros had no Census MSA match:")
        for m in no_match:
            print(f"    #{m['rank']} {m['name']} -- consider adding a manual override above")

if __name__ == "__main__":
    main()

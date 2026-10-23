#!/usr/bin/env python3
"""Snap the highway map's segment lines onto the real roads.

Each segment in data/interstateHighways.json and data/highways.json is a
hand-placed polyline (`waypoints`) between `from` and `to`. Many drift off
the road. This routes every segment along the road network with OSRM and
keeps the result only when it checks out:

  - most of the routed distance is on a road whose ref carries the
    highway's number (I 94, US 101, A-42, ...),
  - the routed line stays close to the old one (no wrong turn onto a
    parallel road), and
  - it is not much longer than the old line (no U-turn loops).

Two attempts per segment: from -> to alone, then from -> to through a few
of the old waypoints. A segment that fails both keeps its old line and is
listed in the report for review.

Responses are cached (default scripts/.osrm-cache/, gitignored) so a run can
be stopped and resumed. The public OSRM demo server asks for at most one
request a second; --osrm points at another server.

    python3 scripts/snap-highways.py                  # both files
    python3 scripts/snap-highways.py --only I-94      # one highway
    python3 scripts/snap-highways.py --dry-run        # report only
"""
import argparse
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [('data/interstateHighways.json', 'interstates'), ('data/highways.json', 'highways')]

MIN_MATCH = 0.85        # share of routed distance on the right highway
MIN_MATCH_CLOSE = 0.7   # the same when the new line stays within CLOSE_KM of the old
CLOSE_KM = 1.5
MAX_DEVIATION_KM = 2.0  # how far an old waypoint may sit from the new line
MAX_LENGTH_RATIO = 1.25 # new length / old length
REPAIR_DEVIATION_KM = 8 # the same for a repaired route
SIMPLIFY_M = 25         # Douglas-Peucker tolerance for the stored line
VIA_SPACING_KM = 25     # spacing of via points on the second attempt
ROADS_SPACING_KM = 2    # spacing of old points the last-resort route goes through
ROADS_DEVIATION_KM = 1  # and how close it must stay to them


def hav_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(min(1, math.sqrt(h)))


def line_km(pts):
    return sum(hav_km(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def to_xy(p, lat0):
    return (p[1] * 111.32 * math.cos(math.radians(lat0)), p[0] * 110.574)


def point_seg_km(p, a, b):
    lat0 = p[0]
    px, py = to_xy(p, lat0)
    ax, ay = to_xy(a, lat0)
    bx, by = to_xy(b, lat0)
    dx, dy = bx - ax, by - ay
    t = 0 if dx == dy == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - ax - t * dx, py - ay - t * dy)


def max_deviation_km(old, new):
    """Largest distance from an old waypoint to the new line."""
    worst = 0
    for p in old:
        best = min(point_seg_km(p, new[i], new[i + 1]) for i in range(len(new) - 1)) if len(new) > 1 else hav_km(p, new[0])
        worst = max(worst, best)
    return worst


def simplify(pts, tol_m):
    """Douglas-Peucker, iterative."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    tol = tol_m / 1000
    while stack:
        i, j = stack.pop()
        best, idx = 0, -1
        for k in range(i + 1, j):
            d = point_seg_km(pts[k], pts[i], pts[j])
            if d > best:
                best, idx = d, k
        if best > tol:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(pts, keep) if k]


def target_numbers(number):
    """Route numbers a step's ref may carry for this highway.

    'I-94' -> {'94'}, 'US-2-WA' -> {'2'}, 'N1-N12-N2-ZA' -> {'1','12','2'},
    'A-4/A-44-ES' -> {'4','44'}, 'TCH-1' -> {'1'}, 'MONARO-AU' -> set().
    """
    core = re.sub(r'\s*\(.*\)', '', number)
    core = re.sub(r'-(IE|NI|ES|AU|ZA|NAM|WA|MT)$', '', core)
    core = re.sub(r' [A-Z][A-Za-z]+$', '', core)  # 'I-195 NJ', 'I-495 Boston'
    return set(re.findall(r'(\d+)[A-Za-z]?', core)) | {'ref:' + a for a in REF_ALIASES.get(number, [])}


# Highways the map files under a number OSM doesn't carry yet: the
# eastern I-86 is still signed NY 17 for most of its length.
REF_ALIASES = {
    'I-86E': ['NY 17'],
}


def step_matches(ref, nums, prefix_required):
    """Whether a step's ref carries the highway. `nums` holds its route
    numbers plus 'ref:<alias>' entries from REF_ALIASES."""
    if not ref:
        return False
    toks = [t.strip() for t in re.split(r'[;,/]', ref)]
    if any(n.startswith('ref:') and n[4:] in toks for n in nums):
        return True
    if not nums:
        return False
    for tok in re.split(r'[;,/]', ref):
        tok = tok.strip()
        m = re.match(r'^([A-Za-z]*)[\s-]*(\d+)', tok)
        if not m:
            continue
        prefix, digits = m.group(1).upper(), m.group(2)
        if digits in nums and (not prefix_required or prefix == prefix_required):
            return True
    return False


class Osrm:
    def __init__(self, base, cache_dir, gap):
        self.base, self.cache_dir, self.gap = base.rstrip('/'), cache_dir, gap
        self.last = 0
        os.makedirs(cache_dir, exist_ok=True)

    def route(self, pts, bearings=None, overview=True):
        coords = ';'.join(f'{p[1]:.5f},{p[0]:.5f}' for p in pts)
        url = (f'{self.base}/route/v1/driving/{coords}?'
               + ('overview=full&geometries=geojson' if overview else 'overview=false')
               + '&steps=true&continue_straight=true')
        if bearings:
            url += '&bearings=' + ';'.join('' if b is None else f'{round(b) % 360},60' for b in bearings)
        key = hashlib.sha1(url.encode()).hexdigest()
        path = os.path.join(self.cache_dir, key + '.json')
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
        for attempt in range(5):
            wait = self.gap - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'j-guyy.github.io highway snapper'})
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = json.load(r)
                break
            except Exception as e:  # noqa: BLE001 - network: back off and retry
                if attempt == 4:
                    print(f'  OSRM failed: {e}', file=sys.stderr)
                    return None
                time.sleep(2 ** attempt * 2)
        with open(path, 'w') as f:
            json.dump(data, f)
        return data


MAX_TRIM_KM = 3         # lead-in / lead-out off the highway that may be cut
MAX_TRIM_END_KM = 15    # the same at a highway's open end ('to Vancouver' downtown)
SKELETON_KM = 8         # spacing of the points the repair pins to the highway
PROBE_OFFSETS_KM = [0] + [d * sgn for d in (0.3, 0.7, 1.2, 2, 3, 4.5) for sgn in (1, -1)]


def bearing(a, b):
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    y = math.sin(dl) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl)
    return math.degrees(math.atan2(y, x)) % 360


def offset(p, brg, km):
    """Point km away from p on bearing brg (flat-earth, fine for a few km)."""
    r = math.radians(brg)
    return [p[0] + km * math.cos(r) / 110.574, p[1] + km * math.sin(r) / (111.32 * math.cos(math.radians(p[0])))]


def along(pts, every_km):
    """Points every `every_km` along a line, with the local bearing."""
    out = [(pts[0], bearing(pts[0], pts[1]))]
    since = 0
    for i in range(1, len(pts)):
        since += hav_km(pts[i - 1], pts[i])
        if since >= every_km and i < len(pts) - 1:
            out.append((pts[i], bearing(pts[i - 1], pts[i + 1])))
            since = 0
    out.append((pts[-1], bearing(pts[-2], pts[-1])))
    return out


def first_step_on(resp, nums, interstate):
    if not resp or resp.get('code') != 'Ok' or not resp.get('routes'):
        return None
    for leg in resp['routes'][0]['legs']:
        for st in leg['steps']:
            if st['distance'] > 0:
                if step_matches(st.get('ref'), nums, interstate):
                    lng, lat = resp['waypoints'][0]['location']
                    return [lat, lng]
                return None
    return None


def pin_to_highway(osrm, p, brg, nums, interstate, reverse=False):
    """An on-highway point near p heading along brg, probing sideways."""
    side = brg + 90
    for d in PROBE_OFFSETS_KM:
        q = offset(p, side, d)
        if reverse:  # end point: test the road arriving there
            a, b = offset(q, brg, -1.5), q
            resp = osrm.route([a, b], [brg, brg], overview=False)
            if resp and resp.get('code') == 'Ok':
                steps = [s for leg in resp['routes'][0]['legs'] for s in leg['steps'] if s['distance'] > 0]
                if steps and step_matches(steps[-1].get('ref'), nums, interstate):
                    lng, lat = resp['waypoints'][1]['location']
                    return [lat, lng]
            continue
        hit = first_step_on(osrm.route([q, offset(q, brg, 1.5)], [brg, brg], overview=False), nums, interstate)
        if hit:
            return hit
    return None


def repair(osrm, old, nums, interstate, a=None, b=None):
    """Pin points along the old line to the highway, route through them.

    `a` / `b` are start / end points already known to be on the highway
    (a neighbouring segment's snapped end); otherwise the ends are pinned too.
    """
    if line_km(old) < SKELETON_KM / 2:
        return None
    skel = along(old, SKELETON_KM)
    pins, brgs = [], []
    for k, (p, brg) in enumerate(skel):
        fixed = a if k == 0 else b if k == len(skel) - 1 else None
        q = fixed or pin_to_highway(osrm, p, brg, nums, interstate, reverse=(k == len(skel) - 1))
        if q is None:
            if k in (0, len(skel) - 1):
                return None
            continue  # an interior point we can't pin is simply dropped
        pins.append(q)
        brgs.append(None if fixed else brg)
    if len(pins) < 2:
        return None
    return osrm.route(pins, brgs)


def leading_on_highway(resp, nums, interstate):
    """Geometry of the route's opening steps that are on the highway."""
    if not resp or resp.get('code') != 'Ok' or not resp.get('routes'):
        return []
    pts = []
    for leg in resp['routes'][0]['legs']:
        for st in leg['steps']:
            if st['distance'] == 0:
                continue
            if not step_matches(st.get('ref'), nums, interstate):
                return pts
            for lng, lat in st['geometry']['coordinates']:
                q = [round(lat, 5), round(lng, 5)]
                if not pts or pts[-1] != q:
                    pts.append(q)
    return pts


def trace(osrm, start, end, nums, interstate, max_requests=60):
    """Follow the highway from `start` (on it) towards `end`.

    For when the fastest route leaves the highway (a parallel toll road, a
    shortcut): route on, keep only the stretch still on the highway, and
    when a route leaves it at once, aim a few km ahead to either side
    instead, so the next request carries on along it.
    """
    pts, p = [start], start
    brg = bearing(start, end)
    requests = 0
    while hav_km(p, end) > 0.5 and requests < max_requests:
        best = None
        aims = [offset(p, brg + da, d) for d in (5, 12, 25) for da in (0, -30, 30, -60, 60, -90, 90)]
        for t in [end] + aims:
            if best and best[0] >= 3:
                break  # good enough: carry on from there
            requests += 1
            geom = leading_on_highway(osrm.route([p, t], [brg, None]), nums, interstate)
            if len(geom) < 2:
                continue
            gain = hav_km(p, end) - hav_km(geom[-1], end)
            if gain > 0.5 and (not best or gain > best[0]):
                best = (gain, geom)
                if t is end:
                    break  # the route to the end itself keeps to the highway
        if not best:
            break
        geom = best[1]
        # Restart a little before the stretch's end: its last vertex is where
        # the route turned off, and a route starting there snaps to the ramp.
        k, back = len(geom) - 1, 0
        while k > 1 and back < 0.3:
            back += hav_km(geom[k - 1], geom[k])
            k -= 1
        pts += geom[1:k + 1]
        p = geom[k]
        brg = bearing(geom[k - 1], geom[k])
    if hav_km(p, end) > MAX_TRIM_KM:
        return None
    return {'pts': [[round(a, 4), round(b, 4)] for a, b in pts], 'match': 1.0, 'trimmed_km': 0}


def evaluate(resp, nums, interstate, trim=True, max_trim_km=None):
    """Routed line trimmed to the highway, its match share, or None."""
    if not resp or resp.get('code') != 'Ok' or not resp.get('routes'):
        return None
    steps = [s for leg in resp['routes'][0]['legs'] for s in leg['steps'] if s['distance'] > 0]
    if not steps:
        return None
    flags = [step_matches(s.get('ref'), nums, interstate) for s in steps]
    if not any(flags):
        return None
    # Trim lead-in / lead-out off the highway (endpoints placed beside it).
    first = flags.index(True) if trim else 0
    last = len(flags) - 1 - flags[::-1].index(True) if trim else len(flags) - 1
    kept = steps[first:last + 1]
    total = sum(s['distance'] for s in kept)
    on = sum(s['distance'] for s, f in zip(kept, flags[first:last + 1]) if f)
    pts = []
    for s in kept:
        for lng, lat in s['geometry']['coordinates']:
            p = [round(lat, 4), round(lng, 4)]
            if not pts or pts[-1] != p:
                pts.append(p)
    trimmed = sum(s['distance'] for s in steps) - total
    if trimmed / 1000 > (MAX_TRIM_KM if max_trim_km is None else max_trim_km):
        return None  # an endpoint sits on another road: leave it to the repair
    return {'pts': pts, 'match': on / total if total else 0, 'trimmed_km': trimmed / 1000}


def via_points(seg):
    w = seg['waypoints'] or [seg['from'], seg['to']]
    out, since = [w[0]], 0
    for i in range(1, len(w) - 1):
        since += hav_km(w[i - 1], w[i])
        if since >= VIA_SPACING_KM:
            out.append(w[i])
            since = 0
    out.append(w[-1])
    return out


def old_line(seg):
    return seg['waypoints'] if len(seg.get('waypoints') or []) >= 2 else [seg['from'], seg['to']]


def check(r, old, max_dev):
    """Why a routed result is rejected ([] when it is accepted)."""
    old_len = line_km(old)
    r['deviation'] = max_deviation_km(old, r['pts'])
    r['ratio'] = line_km(r['pts']) / old_len if old_len else 1
    why = []
    # A line that stays right by the old one may carry a little more
    # approach road (short city segments, unsigned concurrencies).
    min_match = MIN_MATCH_CLOSE if r['deviation'] <= CLOSE_KM else MIN_MATCH
    if r['match'] < min_match:
        why.append(f"only {r['match']:.0%} on the highway")
    if r['deviation'] > max_dev:
        why.append(f"{r['deviation']:.1f} km from the old line")
    if r['ratio'] > MAX_LENGTH_RATIO:
        why.append(f"{r['ratio']:.2f}x the old length")
    return why


def load_manual_vias():
    path = os.path.join(ROOT, 'scripts', 'highway-vias.json')
    if not os.path.exists(path):
        return {}
    with open(path) as f:
        return json.load(f)


MANUAL_VIAS = load_manual_vias()


def snap_segment(osrm, seg, nums, interstate, number=None):
    """Route one segment on its own: from -> to, then through its waypoints."""
    old = old_line(seg)
    attempts = [('direct', lambda: osrm.route([old[0], old[-1]]))]
    manual = MANUAL_VIAS.get(number, {}).get(seg['description'])
    if manual:
        # Points on the highway picked by hand where the fastest route
        # takes another road (e.g. the I-90 toll road instead of I-94).
        attempts.insert(0, ('manual', lambda: osrm.route([old[0]] + manual + [old[-1]])))
    vias = via_points(seg)
    if len(vias) > 2:
        attempts.append(('vias', lambda: osrm.route(vias)))
    reasons = []
    for name, run in attempts:
        r = evaluate(run(), nums, interstate)
        if not r:
            reasons.append(f'{name}: no route on the highway')
            continue
        why = check(r, old, REPAIR_DEVIATION_KM if name == 'manual' else MAX_DEVIATION_KM)
        if not why:
            r['method'] = name
            return r, reasons
        reasons.append(f"{name}: {', '.join(why)}")
    return None, reasons


def nearest_index(pts, p, start):
    best, idx = None, start
    for k in range(start, len(pts)):
        d = hav_km(pts[k], p)
        if best is None or d < best:
            best, idx = d, k
    return idx


def snap_run(osrm, segs, a, b, nums, interstate):
    """Route a run of segments that failed on their own as one line.

    `a` / `b` are the neighbouring good segments' ends (on the highway), or
    None at the end of a highway. The result is cut back into segments at
    the points nearest the old segment boundaries.
    """
    old = [p for seg in segs for p in old_line(seg)]
    start, end = a or old[0], b or old[-1]
    vias = [start] + [p for p in via_points({'waypoints': old, 'from': old[0], 'to': old[-1]})[1:-1]] + [end]
    attempts = [('run', lambda: osrm.route([start, end]))]
    if len(vias) > 2:
        attempts.append(('run+vias', lambda: osrm.route(vias)))
    attempts.append(('run+pins', lambda: repair(osrm, old, nums, interstate, a, b)))

    def traced():
        s0 = a or pin_to_highway(osrm, old[0], bearing(old[0], old[1]), nums, interstate)
        return s0 and trace(osrm, s0, end, nums, interstate)
    attempts.append(('trace', traced))
    reasons = []
    for name, run in attempts:
        # Only trim at an end that isn't anchored on a good neighbour.
        res = run()
        r = res if name == 'trace' else evaluate(res, nums, interstate, trim=not (a and b), max_trim_km=MAX_TRIM_END_KM)
        if not r:
            reasons.append(f'{name}: no route on the highway')
            continue
        why = check(r, old, REPAIR_DEVIATION_KM)
        if why:
            reasons.append(f"{name}: {', '.join(why)}")
            continue
        pts, out, k0 = r['pts'], [], 0
        for i, seg in enumerate(segs):
            k1 = len(pts) - 1 if i == len(segs) - 1 else nearest_index(pts, old_line(seg)[-1], k0)
            part = pts[k0:k1 + 1]
            if len(part) < 2:
                part = [pts[k0], pts[min(k0 + 1, len(pts) - 1)]]
            out.append({'pts': part, 'method': name, 'match': r['match'],
                        'deviation': max_deviation_km(old_line(seg), part), 'trimmed_km': r['trimmed_km']})
            k0 = k1
        return out, reasons
    return None, reasons


def chains(segs):
    """Index runs of segments that join end to start (within 1 km)."""
    if not segs:
        return []
    out, cur = [], [0]
    for i in range(1, len(segs)):
        if hav_km(segs[i - 1]['to'], segs[i]['from']) > 1:
            out.append(cur)
            cur = []
        cur.append(i)
    out.append(cur)
    return out


def process_highway(osrm, route, interstate):
    nums = target_numbers(route['number'])
    segs = route['routeSegments']
    results, reasons = [None] * len(segs), [[] for _ in segs]
    for i, seg in enumerate(segs):
        results[i], reasons[i] = snap_segment(osrm, seg, nums, interstate, route['number'])
    for chain in chains(segs):
        k = 0
        while k < len(chain):
            if results[chain[k]]:
                k += 1
                continue
            j = k
            while j + 1 < len(chain) and not results[chain[j + 1]]:
                j += 1
            run = chain[k:j + 1]
            a = results[chain[k - 1]]['pts'][-1] if k > 0 else None
            b = results[chain[j + 1]]['pts'][0] if j + 1 < len(chain) else None
            out, why = snap_run(osrm, [segs[i] for i in run], a, b, nums, interstate)
            for n, i in enumerate(run):
                if out:
                    results[i] = out[n]
                reasons[i] += why
            k = j + 1
    # Last resort, no highway check: route through the old points themselves
    # and keep it only if it stays right by the old line. This puts the line
    # on a road where the highway number can't be confirmed (road-trip
    # entries that string several roads together, refs OSM lacks).
    for i, seg in enumerate(segs):
        if results[i]:
            continue
        r, why = snap_to_roads(osrm, seg)
        if r:
            results[i] = r
        else:
            reasons[i].append(why)
    return results, reasons


def snap_to_roads(osrm, seg):
    old = old_line(seg)
    spacing = max(ROADS_SPACING_KM, line_km(old) / 90)  # stay under OSRM's coordinate limit
    pts, since = [old[0]], 0
    for i in range(1, len(old) - 1):
        since += hav_km(old[i - 1], old[i])
        if since >= spacing:
            pts.append(old[i])
            since = 0
    pts.append(old[-1])
    resp = osrm.route(pts)
    if not resp or resp.get('code') != 'Ok' or not resp.get('routes'):
        return None, 'roads: no route'
    line = []
    for lng, lat in resp['routes'][0]['geometry']['coordinates']:
        q = [round(lat, 4), round(lng, 4)]
        if not line or line[-1] != q:
            line.append(q)
    if len(line) < 2:
        return None, 'roads: no route'
    dev = max_deviation_km(old, line)
    ratio = line_km(line) / (line_km(old) or 1)
    if dev > ROADS_DEVIATION_KM or ratio > MAX_LENGTH_RATIO:
        return None, f'roads: {dev:.1f} km from the old line, {ratio:.2f}x its length'
    return {'pts': line, 'method': 'roads', 'match': None, 'deviation': dev, 'trimmed_km': 0}, None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--osrm', default='https://router.project-osrm.org')
    ap.add_argument('--cache', default=os.path.join(ROOT, 'scripts', '.osrm-cache'))
    ap.add_argument('--gap', type=float, default=1.1, help='seconds between OSRM requests')
    ap.add_argument('--only', action='append', help='highway number(s) to process')
    ap.add_argument('--file', choices=[f for f, _ in FILES], help='just this data file')
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--report', default=os.path.join(ROOT, 'scripts', 'snap-highways-report.json'))
    args = ap.parse_args()

    osrm = Osrm(args.osrm, args.cache, args.gap)
    report = []
    for rel, key in FILES:
        if args.file and rel != args.file:
            continue
        path = os.path.join(ROOT, rel)
        with open(path) as f:
            data = json.load(f)
        changed = 0
        for route in data[key]:
            num = route['number']
            if args.only and num not in args.only:
                continue
            # The ref prefix a step must carry: 'I 94' for I-94, 'US 2' for
            # US-2 (not 'WI 2'); other systems' prefixes vary, so any.
            interstate = 'I' if key == 'interstates' or num.startswith('I-') else 'US' if num.startswith('US-') else None
            results, reasons = process_highway(osrm, route, interstate)
            for i, (seg, best) in enumerate(zip(route['routeSegments'], results)):
                entry = {'file': rel, 'number': num, 'index': i, 'description': seg['description'],
                         'old': old_line(seg)}
                if best:
                    pts = simplify(best['pts'], SIMPLIFY_M)
                    entry.update(status='snapped', method=best['method'], old_off_km=round(best['deviation'], 2),
                                 match=best['match'] and round(best['match'], 3), new=pts)
                    if not args.dry_run:
                        seg['waypoints'] = pts
                        seg['from'], seg['to'] = list(pts[0]), list(pts[-1])
                    changed += 1
                else:
                    entry.update(status='kept', reasons=reasons[i])
                report.append(entry)
                print(f"{entry['status']:8} {num:10} {i:3} {seg['description']}"
                      + (f"  ({best['method']}, old line up to {entry['old_off_km']} km off)" if best
                         else f"  [{'; '.join(reasons[i])}]"), flush=True)
        if changed and not args.dry_run:
            with open(path, 'w') as f:
                f.write(json.dumps(data, indent=4))
    with open(args.report, 'w') as f:
        json.dump(report, f)
    snapped = sum(1 for e in report if e['status'] == 'snapped')
    print(f'\n{snapped}/{len(report)} segments snapped; report in {os.path.relpath(args.report, ROOT)}')


if __name__ == '__main__':
    main()

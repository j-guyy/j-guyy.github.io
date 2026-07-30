#!/usr/bin/env python3
"""Procedural GBA-style pixel-art sprite generator for Creature Quest.

Draws each of the 19 species in game/data/creatures.json as a distinct
creature silhouette (body archetype + ears/tail/wings/etc. per species),
using the real Pokemon-style type-color palette plus each species' own
`accent` color for markings. Everything is drawn on a 64x64 logical grid
(no anti-aliasing) and then nearest-neighbor upscaled 3x to 192x192 to match
CREATURE_PX in js/engine/assets.js, keeping the flat/limited-palette/
hard-pixel-edge look the site's placeholder sprites already use.

This is still procedural (not hand-painted) art, but aims for real body
plans (head/ears/limbs/tail/wings) instead of the old circle+glyph shapes.

Run: python3 game/tools/gen_sprites.py
Output: game/images/creatures/<species-id>.png (192x192 RGBA)
"""
import json
import math
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
GAME_DIR = os.path.dirname(HERE)
DATA_PATH = os.path.join(GAME_DIR, "data", "creatures.json")
OUT_DIR = os.path.join(GAME_DIR, "images", "creatures")

GRID = 64
SCALE = 3
OUT_PX = GRID * SCALE  # 192, matches CREATURE_PX

OUTLINE = (26, 20, 24, 255)

TYPE_COLORS = {
    "Normal": "#A8A878",
    "Fire": "#F08030",
    "Water": "#6890F0",
    "Electric": "#F8D030",
    "Grass": "#78C850",
    "Ice": "#98D8D8",
    "Fighting": "#C03028",
    "Poison": "#A040A0",
    "Ground": "#E0C068",
    "Flying": "#A890F0",
    "Psychic": "#F85888",
    "Bug": "#A8B820",
    "Rock": "#B8A038",
    "Ghost": "#705898",
    "Dragon": "#7038F8",
    "Dark": "#705848",
    "Steel": "#B8B8D0",
    "Fairy": "#EE99AC",
}


def hex2rgb(h):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def shade(rgb, amt):
    return tuple(max(0, min(255, c + amt)) for c in rgb)


# ---- grid-space drawing helpers -------------------------------------------

class G:
    """Wraps a 64x64 RGBA canvas; every shape gets an auto outline ring."""

    def __init__(self):
        self.img = Image.new("RGBA", (GRID, GRID), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    def ellipse(self, cx, cy, rx, ry, fill, outline=OUTLINE, ow=1.4):
        self.d.ellipse([cx - rx - ow, cy - ry - ow, cx + rx + ow, cy + ry + ow], fill=outline)
        self.d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=fill)

    def polygon(self, pts, fill, outline=OUTLINE, ow=1.4):
        cx = sum(p[0] for p in pts) / len(pts)
        cy = sum(p[1] for p in pts) / len(pts)

        def push(p, amt):
            dx, dy = p[0] - cx, p[1] - cy
            length = math.hypot(dx, dy) or 1
            return (p[0] + dx / length * amt, p[1] + dy / length * amt)

        self.d.polygon([push(p, ow) for p in pts], fill=outline)
        self.d.polygon(pts, fill=fill)

    def rect(self, x0, y0, x1, y1, fill, outline=OUTLINE, ow=1.4):
        self.d.rectangle([x0 - ow, y0 - ow, x1 + ow, y1 + ow], fill=outline)
        self.d.rectangle([x0, y0, x1, y1], fill=fill)

    def dot(self, x, y, r, fill):
        self.d.ellipse([x - r, y - r, x + r, y + r], fill=fill)

    def line(self, pts, fill, w=1):
        self.d.line(pts, fill=fill, width=w, joint="curve")

    def export(self, path):
        big = self.img.resize((OUT_PX, OUT_PX), Image.NEAREST)
        big.save(path)


def shadow(g, cx, y, rx):
    g.d.ellipse([cx - rx, y - 3, cx + rx, y + 3], fill=(0, 0, 0, 70))


def eyes(g, cx, cy, gap, r=2.6, color=(20, 16, 18, 255)):
    for sx in (-1, 1):
        ex = cx + sx * gap
        g.dot(ex, cy, r, color)
        g.dot(ex - sx * 0.9, cy - 0.9, 0.9, (255, 255, 255, 255))


class Pal:
    """Per-creature color palette derived from type(s) + species accent."""

    def __init__(self, types, accent_hex):
        base = hex2rgb(TYPE_COLORS.get(types[0], "#888888"))
        self.base = base + (255,)
        self.light = shade(base, 40) + (255,)
        self.dark = shade(base, -50) + (255,)
        self.accent = hex2rgb(accent_hex) + (255,)
        second = types[1] if len(types) > 1 else None
        self.mark = (hex2rgb(TYPE_COLORS[second]) + (255,)) if second else shade(base, -20) + (255,)


# ---- body archetypes --------------------------------------------------------
# Each takes a fresh G(), a Pal, and species-specific kwargs, and returns G.

def blob(pal, size=1.0, leaf=False, tuft=False, facing="front"):
    g = G()
    cx, cy = 32, 38
    rx, ry = 19 * size, 17 * size
    shadow(g, cx, 57, 17 * size)
    # stub feet
    for sx in (-1, 1):
        g.ellipse(cx + sx * 11 * size, cy + ry - 3, 5 * size, 4 * size, pal.dark)
    # stub arms
    for sx in (-1, 1):
        g.ellipse(cx + sx * (rx - 2), cy + 2, 5 * size, 7 * size, pal.base)
    # body
    g.ellipse(cx, cy, rx, ry, pal.base)
    g.ellipse(cx - rx * 0.35, cy - ry * 0.4, rx * 0.32, ry * 0.28, pal.light, outline=None)
    if facing == "front":
        # belly patch (not visible from behind)
        g.ellipse(cx, cy + ry * 0.42, rx * 0.55, ry * 0.4, pal.accent, outline=None)
    else:
        # back-of-body spine stripe stands in for the belly marking
        g.rect(cx - 2 * size, cy - ry * 0.5, cx + 2 * size, cy + ry * 0.6, pal.accent, outline=None)
    if leaf:
        stem = (cx, cy - ry + 3)
        g.polygon([stem, (cx - 9 * size, cy - ry - 4 * size), (cx - 2 * size, cy - ry - 2 * size)], pal.mark)
        g.polygon([stem, (cx + 9 * size, cy - ry - 4 * size), (cx + 2 * size, cy - ry - 2 * size)], pal.mark)
        g.polygon([stem, (cx - 3 * size, cy - ry - 13 * size), (cx + 3 * size, cy - ry - 13 * size)], pal.mark)
    if tuft:
        g.polygon([(cx, cy - ry - 9 * size), (cx - 4 * size, cy - ry + 1), (cx + 4 * size, cy - ry + 1)], pal.mark)
    if facing == "front":
        eyes(g, cx, cy - 2, 7 * size)
    return g


def quadruped(pal, size=1.0, ears="round", tail="flame", mane=False, claws=False, horn=False, fangs=False, low=False, ridge=False, facing="front"):
    g = G()
    hy = 22 if not low else 27
    ty = 40 if not low else 44
    cx = 32
    shadow(g, cx, 58, 20 * size)
    # legs
    leg_y = ty + 11 * size
    for sx, dx in ((-1, -11), (-1, 3), (1, -3), (1, 11)):
        g.rect(cx + sx * abs(dx) - 3 * size, ty, cx + sx * abs(dx) + 3 * size, leg_y, pal.dark, outline=OUTLINE, ow=1.2)
    # tail
    if tail == "flame":
        g.polygon([(cx + 17 * size, ty - 2), (cx + 30 * size, ty - 16 * size), (cx + 24 * size, ty - 2),
                    (cx + 30 * size, ty + 6), (cx + 17 * size, ty + 8)], pal.mark)
        g.polygon([(cx + 20 * size, ty - 4), (cx + 27 * size, ty - 12 * size), (cx + 24 * size, ty + 2)], pal.light)
    elif tail == "fin":
        g.polygon([(cx + 16 * size, ty - 4), (cx + 30 * size, ty - 9 * size), (cx + 30 * size, ty + 9 * size),
                    (cx + 16 * size, ty + 4)], pal.mark)
    elif tail == "spark":
        g.polygon([(cx + 16 * size, ty - 2), (cx + 26 * size, ty - 14 * size), (cx + 22 * size, ty - 4),
                    (cx + 30 * size, ty - 10 * size), (cx + 20 * size, ty + 2), (cx + 26 * size, ty - 2),
                    (cx + 16 * size, ty + 8)], pal.mark)
    else:  # plain fur tail
        g.ellipse(cx + 22 * size, ty, 8 * size, 5 * size, pal.dark)
    # torso
    trx, try_ = 16 * size, 11 * size
    g.ellipse(cx, ty, trx, try_, pal.base)
    if facing == "front":
        g.ellipse(cx, ty + try_ * 0.5, trx * 0.6, try_ * 0.45, pal.accent, outline=None)
    else:
        g.rect(cx - 2 * size, ty - try_ * 0.7, cx + 2 * size, ty + try_ * 0.5, pal.accent, outline=None)
    if ridge:
        for i in range(3):
            rx = cx - trx * 0.4 + i * trx * 0.4
            g.polygon([(rx - 3 * size, ty - try_ * 0.75), (rx, ty - try_ * 1.6), (rx + 3 * size, ty - try_ * 0.75)], pal.mark)
    # head
    hr = 12 * size
    hx = cx - trx * 0.55
    if mane:
        anchor = (hx + hr * 0.2, hy - hr * 0.65)
        for i in range(5):
            ang = -math.pi / 2 - 0.85 + i * 0.42
            mx = anchor[0] + math.cos(ang) * 10 * size
            my = anchor[1] + math.sin(ang) * 10 * size
            g.polygon([anchor, (mx, my), (mx - 2.5 * size, my + 2 * size)], pal.mark)
    if ears == "round":
        for sx in (-1, 1):
            g.ellipse(hx + sx * hr * 0.75, hy - hr * 0.85, 4.5 * size, 5.5 * size, pal.base)
            g.ellipse(hx + sx * hr * 0.75, hy - hr * 0.75, 2.2 * size, 2.8 * size, pal.dark, outline=None)
    elif ears == "fox":
        for sx in (-1, 1):
            g.polygon([(hx + sx * hr * 0.55, hy - hr * 0.4), (hx + sx * hr * 1.5, hy - hr * 2.1),
                        (hx + sx * hr * 1.15, hy - hr * 0.1)], pal.base)
            g.polygon([(hx + sx * hr * 0.7, hy - hr * 0.5), (hx + sx * hr * 1.25, hy - hr * 1.7),
                        (hx + sx * hr * 1.0, hy - hr * 0.25)], pal.dark, outline=None)
    elif ears == "point":
        for sx in (-1, 1):
            g.polygon([(hx + sx * hr * 0.5, hy - hr * 0.5), (hx + sx * hr * 1.1, hy - hr * 1.9),
                        (hx + sx * hr * 1.3, hy - hr * 0.15)], pal.base)
    if horn:
        g.polygon([(hx - 3 * size, hy - hr * 1.1), (hx, hy - hr * 2.3), (hx + 3 * size, hy - hr * 1.1)], pal.mark)
    g.ellipse(hx, hy, hr, hr * 0.92, pal.base)
    g.ellipse(hx - hr * 0.3, hy - hr * 0.3, hr * 0.3, hr * 0.25, pal.light, outline=None)
    if facing == "front":
        # muzzle
        g.ellipse(hx - hr * 0.55, hy + hr * 0.25, hr * 0.42, hr * 0.32, pal.accent, outline=None)
        if fangs:
            g.polygon([(hx - hr * 0.7, hy + hr * 0.35), (hx - hr * 0.62, hy + hr * 0.7), (hx - hr * 0.5, hy + hr * 0.35)], (245, 245, 240, 255))
    if claws:
        for sx, dx in ((-1, -11), (1, 11)):
            g.polygon([(cx + sx * abs(dx) - 2 * size, leg_y), (cx + sx * abs(dx), leg_y + 3 * size),
                        (cx + sx * abs(dx) + 2 * size, leg_y)], (245, 245, 240, 255), ow=0.6)
    if facing == "front":
        eyes(g, hx + hr * 0.05, hy - hr * 0.05, hr * 0.42)
    return g


def giant(pal, size=1.15, facing="front"):
    g = G()
    cx, base_y = 32, 56
    shadow(g, cx, base_y, 22 * size)
    # legs
    for sx in (-1, 1):
        g.rect(cx + sx * 10 * size - 4 * size, 42, cx + sx * 10 * size + 4 * size, base_y - 2, pal.dark)
    # trunk/torso
    g.polygon([(cx - 17 * size, 44), (cx - 20 * size, 18), (cx + 20 * size, 18), (cx + 17 * size, 44)], pal.base)
    g.rect(cx - 6 * size, 8, cx + 6 * size, 22, pal.base)
    # canopy/head
    g.ellipse(cx, 12, 17 * size, 13 * size, pal.mark)
    g.ellipse(cx - 6 * size, 7, 6 * size, 5 * size, pal.light, outline=None)
    # arms
    for sx in (-1, 1):
        g.ellipse(cx + sx * 20 * size, 30, 5 * size, 10 * size, pal.base)
    # moss/flower accents
    for i, (dx, dy) in enumerate([(-9, 30), (8, 26), (0, 36), (-4, 40)]):
        g.dot(cx + dx * size, dy, 2.6 * size, pal.accent)
    if facing == "front":
        eyes(g, cx, 26, 7 * size, r=3)
    return g


def serpent(pal, size=1.0, shell=False, horn=False, big_fin=False, facing="front"):
    g = G()
    cx, cy = 32, 40
    shadow(g, cx, 58, 19 * size)
    # curved tail
    g.polygon([(cx + 6 * size, cy + 10), (cx + 22 * size, cy + 20), (cx + 26 * size, cy + 8),
                (cx + 14 * size, cy + 4)], pal.base, ow=1.2)
    if big_fin:
        g.polygon([(cx + 20 * size, cy + 6), (cx + 32 * size, cy - 6 * size), (cx + 26 * size, cy + 14)], pal.mark)
    # body coils
    g.ellipse(cx, cy + 6, 15 * size, 12 * size, pal.base)
    g.ellipse(cx - 10 * size, cy - 8 * size, 12 * size, 11 * size, pal.base)
    if shell:
        g.ellipse(cx - 2 * size, cy + 4, 10 * size, 8 * size, pal.mark, outline=None)
        g.line([(cx - 8 * size, cy + 2), (cx + 4 * size, cy + 2)], pal.dark[:3] + (255,), w=1)
    # head
    hx, hy = cx - 20 * size, cy - 14 * size
    g.ellipse(hx, hy, 9 * size, 8 * size, pal.base)
    g.ellipse(hx - 2 * size, hy - 2 * size, 3 * size, 2.6 * size, pal.light, outline=None)
    if horn:
        for sx in (-1, 1):
            g.polygon([(hx + sx * 3 * size, hy - 6 * size), (hx + sx * 6 * size, hy - 13 * size),
                        (hx + sx * 6.5 * size, hy - 5 * size)], pal.mark)
    if facing == "front":
        g.ellipse(hx - 7 * size, hy + 2, 3 * size, 2.2 * size, pal.accent, outline=None)
        eyes(g, hx + 1 * size, hy - 1, 3.6 * size, r=2.2)
    else:
        g.rect(hx - 3 * size, hy - 1, hx + 3 * size, hy + 5 * size, pal.accent, outline=None)
    return g


def shell_creature(pal, size=1.0, armored=False, facing="front"):
    g = G()
    cx, cy = 32, 38
    shadow(g, cx, 57, 19 * size)
    r = 18 * size
    # feet peeking out
    for sx in (-1, 1):
        g.ellipse(cx + sx * 12 * size, cy + r - 4, 4.5 * size, 4 * size, pal.dark)
    if facing == "front":
        # head
        g.ellipse(cx - r + 3 * size, cy - 2, 6.5 * size, 6 * size, pal.dark)
        eyes(g, cx - r + 4 * size, cy - 3, 2.6 * size, r=1.8)
    # shell
    g.ellipse(cx, cy, r, r * 0.92, pal.mark)
    g.ellipse(cx - r * 0.3, cy - r * 0.35, r * 0.3, r * 0.26, pal.light, outline=None)
    if armored:
        for i in range(3):
            ang = -0.7 + i * 0.7
            px = cx + math.cos(ang) * r * 0.55
            py = cy + math.sin(ang) * r * 0.55
            g.polygon([(px, py - 4 * size), (px - 4 * size, py + 3 * size), (px + 4 * size, py + 3 * size)], pal.base, ow=0.8)
    else:
        for i in range(2):
            rr = r * (0.65 - i * 0.28)
            g.d.arc([cx - rr, cy - rr, cx + rr, cy + rr], 200, 340, fill=pal.accent[:3] + (255,), width=2)
    return g


def toad(pal, size=1.0, facing="front"):
    g = G()
    cx, cy = 32, 42
    shadow(g, cx, 58, 20 * size)
    # broad feet
    for sx in (-1, 1):
        g.ellipse(cx + sx * 15 * size, cy + 12 * size, 7 * size, 4 * size, pal.dark)
    # body
    g.ellipse(cx, cy, 19 * size, 13 * size, pal.base)
    # eye domes on top
    for sx in (-1, 1):
        g.ellipse(cx + sx * 8 * size, cy - 12 * size, 5.5 * size, 5.5 * size, pal.base)
    if facing == "front":
        g.ellipse(cx, cy + 6 * size, 12 * size, 6 * size, pal.accent, outline=None)
        eyes(g, cx - 0.5, cy - 12 * size, 8 * size, r=2.4)
        g.line([(cx - 6 * size, cy + 2), (cx + 6 * size, cy + 2)], pal.dark[:3] + (255,), w=1)
    else:
        g.rect(cx - 3 * size, cy - 10 * size, cx + 3 * size, cy + 8 * size, pal.accent, outline=None)
    return g


def moth(pal, size=1.0, facing="front"):
    g = G()
    cx, cy = 32, 34
    shadow(g, cx, 55, 17 * size)
    # wings (back pair first, under body)
    for sx in (-1, 1):
        g.polygon([(cx + sx * 3 * size, cy - 2), (cx + sx * 24 * size, cy - 4 * size),
                    (cx + sx * 20 * size, cy + 16 * size), (cx + sx * 4 * size, cy + 10 * size)], pal.mark)
        g.dot(cx + sx * 15 * size, cy + 3 * size, 2.6 * size, pal.accent)
    # antennae
    for sx in (-1, 1):
        g.line([(cx + sx * 2, cy - 12 * size), (cx + sx * 6 * size, cy - 19 * size)], pal.dark[:3] + (255,), w=1)
    # body
    g.ellipse(cx, cy, 5.5 * size, 15 * size, pal.base)
    g.ellipse(cx, cy - 10 * size, 5.5 * size, 5.2 * size, pal.base)
    if facing == "front":
        eyes(g, cx, cy - 10 * size, 2.4 * size, r=1.6)
    return g


ARCHETYPES = {
    "blob": blob,
    "quadruped": quadruped,
    "giant": giant,
    "serpent": serpent,
    "shell": shell_creature,
    "toad": toad,
    "moth": moth,
}

# species id -> (archetype key, kwargs)
DESIGN = {
    "emberling":  ("quadruped", dict(size=0.85, ears="round", tail="flame")),
    "emberclaw":  ("quadruped", dict(size=1.0, ears="round", tail="flame", claws=True)),
    "infernyx":   ("quadruped", dict(size=1.15, ears="round", tail="flame", claws=True, mane=True)),
    "dripling":   ("blob", dict(size=0.85, tuft=True)),
    "torrentail": ("serpent", dict(size=1.0, big_fin=True)),
    "maelstrode": ("serpent", dict(size=1.2, shell=True, horn=True, big_fin=True)),
    "sproutle":   ("blob", dict(size=0.9, leaf=True)),
    "bramblore":  ("quadruped", dict(size=1.05, ears="point", tail="plain", mane=True, low=True)),
    "verdantitan": ("giant", dict(size=1.15)),
    "pyrokit":    ("quadruped", dict(size=0.8, ears="fox", tail="flame")),
    "pyrevulp":   ("quadruped", dict(size=1.0, ears="fox", tail="flame", claws=True)),
    "cindermoth": ("moth", dict(size=0.9)),
    "tidewhirl":  ("shell", dict(size=0.95, armored=False)),
    "gyreshell":  ("shell", dict(size=1.15, armored=True)),
    "mudpad":     ("toad", dict(size=1.0)),
    "thornback":  ("quadruped", dict(size=1.0, ears="round", tail="plain", low=True, horn=True, ridge=True)),
    "voltpup":    ("quadruped", dict(size=0.85, ears="point", tail="spark")),
    "volthound":  ("quadruped", dict(size=1.05, ears="point", tail="spark", mane=True, claws=True)),
    "zaptooth":   ("quadruped", dict(size=0.95, ears="point", tail="spark", fangs=True)),
}


def main():
    with open(DATA_PATH) as f:
        creatures = json.load(f)["creatures"]
    os.makedirs(OUT_DIR, exist_ok=True)

    missing = set(creatures) - set(DESIGN)
    if missing:
        raise SystemExit(f"No sprite design for: {sorted(missing)}")

    for species_id, c in creatures.items():
        archetype, kwargs = DESIGN[species_id]
        pal = Pal(c["types"], c.get("accent", "#cccccc"))
        for facing, suffix in (("front", ""), ("back", "_back")):
            g = ARCHETYPES[archetype](pal, facing=facing, **kwargs)
            out_path = os.path.join(OUT_DIR, f"{species_id}{suffix}.png")
            g.export(out_path)
            print(f"wrote {out_path}")


if __name__ == "__main__":
    main()

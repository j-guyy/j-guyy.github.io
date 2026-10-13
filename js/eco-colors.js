// Ecoregion colours shared by us-ecoregions.html and colorado-ecoregions.html.
//
// Each Level III ecoregion gets its own hue, and its Level IV ecoregions are
// slight variations of that hue (lighter / darker, a few degrees warmer /
// cooler). The parent reads as one colour family on the map while neighbouring
// Level IVs inside it stay distinguishable. Colours depend only on the EPA
// codes, so a region looks the same on both pages.

// Consecutive Level III codes are often neighbours on the ground (18, 19, 20 …),
// so step hues by the golden angle: codes next to each other land far apart
// on the colour wheel.
const ECO_GOLDEN_ANGLE = 137.508;

function ecoHashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function ecoHsl(h, s, l) {
    return `hsl(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}

function ecoL3Hue(l3Code) {
    const n = parseInt(l3Code, 10);
    return isNaN(n) ? ecoHashString(String(l3Code)) % 360 : n * ECO_GOLDEN_ANGLE;
}

// The Level III's own colour: the middle of its Level IV range (legend swatches).
function ecoL3Color(l3Code) {
    return ecoHsl(ecoL3Hue(l3Code), 58, 55);
}

// A darker, more saturated version for Level III outlines drawn over the fills.
function ecoL3OutlineColor(l3Code) {
    return ecoHsl(ecoL3Hue(l3Code), 70, 30);
}

// Position of a Level IV within its Level III, from the letter suffix of its
// code: "21a" → 0, "21b" → 1, … "21z" → 25, "6aa" → 26. -1 if unparseable.
function ecoL4Index(l4Code) {
    const m = /([a-z]+)$/i.exec(String(l4Code || ''));
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1].toLowerCase()) n = n * 26 + (ch.charCodeAt(0) - 96);
    return n - 1;
}

// Level IV shade: walk a low-discrepancy (R2) sequence by letter index, so
// a, b, c … — usually adjacent on the ground — get clearly different shades
// even in a Level III with 40+ subregions. Lightness spans 38–72%, hue drifts
// ±12° and saturation ±8% around the parent. The first Level IV ("a") gets the
// parent colour itself.
function ecoL4Color(l4Code, l3Code) {
    let i = ecoL4Index(l4Code);
    if (i < 0) i = ecoHashString(String(l4Code)) % 64;
    const t = (0.5 + i * 0.7548776662) % 1;
    const u = (0.5 + i * 0.5698402910) % 1;
    return ecoHsl(ecoL3Hue(l3Code) + (u - 0.5) * 24, 58 + (u - 0.5) * 16, 38 + t * 34);
}

// assets.js — Sprite/asset abstraction.
//
// The engine never draws a rectangle "inline". Everything visual is a Sprite:
// an object with a native pixel size and a draw(ctx, dx, dy, dw, dh) method.
// The concrete sprites are procedurally-generated placeholder shapes
// pre-rendered onto offscreen canvases at their exact target resolution.
// Phase 1.5 bumped every native dimension 3x from the original GBA baseline
// (creatures 64->192, tiles 16->48, overworld actors 16x32->48x96) for a
// higher-fidelity pixel-art look while keeping the same flat/limited-palette
// aesthetic and nearest-neighbor scaling. Dropping in real pixel-art later
// means swapping the placeholder factories for ones that blit from a loaded
// sprite-sheet Image — the draw() signature and all engine call sites stay
// identical.

export const CREATURE_PX = 192; // creature sprite native size (was 64)
export const TILE_PX = 48; // overworld tile native size (was 16)
export const ACTOR_W = 48; // overworld actor native width (was 16)
export const ACTOR_H = 96; // overworld actor native height, taller than a tile (was 32)

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// A Sprite backed by an offscreen canvas (or, later, an Image sub-rect).
export class Sprite {
  constructor(source, sx = 0, sy = 0, sw = source.width, sh = source.height) {
    this.source = source;
    this.sx = sx;
    this.sy = sy;
    this.sw = sw;
    this.sh = sh;
  }
  draw(ctx, dx, dy, dw = this.sw, dh = this.sh) {
    ctx.drawImage(this.source, this.sx, this.sy, this.sw, this.sh, dx, dy, dw, dh);
  }
}

// ---- Placeholder renderers (Phase 1 art) --------------------------------

function shadeColor(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 0xff;
  let g = (n >> 8) & 0xff;
  let b = n & 0xff;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `rgb(${r},${g},${b})`;
}

// Tile placeholder: flat fill + subtle texture, drawn at 48x48 (Phase 1.5).
// Coordinates scaled up 3x from the 16x16 original with a little extra texture
// density to fill the added pixel real estate — same flat, hard-edged language.
export function makeTileSprite(def) {
  const S = TILE_PX; // 48
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = def.color;
  g.fillRect(0, 0, S, S);

  if (def.texture === 'grass') {
    g.fillStyle = shadeColor(def.color, -18);
    for (let i = 0; i < 14; i++) {
      const x = (i * 15 + 6) % S;
      g.fillRect(x, 12 + (i % 4) * 9, 3, 7);
    }
    g.fillStyle = shadeColor(def.color, 16);
    for (let i = 0; i < 8; i++) g.fillRect((i * 19 + 4) % S, 6 + (i % 3) * 11, 2, 4);
  } else if (def.texture === 'tallgrass') {
    g.fillStyle = shadeColor(def.color, -30);
    for (let x = 3; x < S; x += 8) {
      g.fillRect(x, 16, 3, 26);
      g.fillRect(x + 3, 26, 3, 16);
    }
    g.fillStyle = shadeColor(def.color, 22);
    for (let x = 6; x < S; x += 11) g.fillRect(x, 6, 3, 12);
  } else if (def.texture === 'water') {
    g.fillStyle = shadeColor(def.color, 24);
    g.fillRect(6, 12, 18, 3);
    g.fillRect(27, 27, 15, 3);
    g.fillRect(12, 36, 12, 3);
    g.fillStyle = shadeColor(def.color, -18);
    g.fillRect(30, 15, 12, 2);
    g.fillRect(6, 30, 10, 2);
  } else if (def.texture === 'tree') {
    g.fillStyle = shadeColor(def.color, 22);
    g.beginPath();
    g.arc(24, 21, 18, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = shadeColor(def.color, 40);
    g.beginPath();
    g.arc(18, 15, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = shadeColor(def.color, -30);
    g.fillRect(21, 36, 6, 12);
  } else if (def.texture === 'roof') {
    g.fillStyle = shadeColor(def.color, -28);
    for (let y = 9; y < S; y += 15) g.fillRect(0, y, S, 3);
    g.fillStyle = shadeColor(def.color, 20);
    for (let y = 3; y < S; y += 15) g.fillRect(0, y, S, 2);
  } else if (def.texture === 'wall') {
    g.fillStyle = shadeColor(def.color, -22);
    g.fillRect(0, 24, S, 3);
    for (let x = 0; x < S; x += 15) g.fillRect(x, 0, 3, S);
  } else if (def.texture === 'door') {
    g.fillStyle = shadeColor(def.color, 40);
    g.fillRect(15, 9, 18, 39);
    g.fillStyle = shadeColor(def.color, -20);
    g.fillRect(27, 27, 4, 6);
  } else if (def.texture === 'path') {
    g.fillStyle = shadeColor(def.color, -12);
    g.fillRect(9, 15, 6, 6);
    g.fillRect(30, 33, 6, 6);
    g.fillRect(33, 12, 4, 4);
  } else if (def.texture === 'fence') {
    g.fillStyle = def.under || '#7bbf5a';
    g.fillRect(0, 0, S, S);
    g.fillStyle = def.color;
    g.fillRect(0, 18, S, 6);
    for (let x = 6; x < S; x += 18) g.fillRect(x, 6, 6, 30);
  } else if (def.texture === 'flower') {
    g.fillStyle = def.under || '#7bbf5a';
    g.fillRect(0, 0, S, S);
    const petals = ['#ff6b8a', '#ffd23a', '#7ec8ff'];
    for (let i = 0; i < 3; i++) {
      const fx = 10 + i * 12, fy = 13 + (i % 2) * 15;
      g.fillStyle = petals[i];
      g.fillRect(fx, fy - 3, 3, 3);
      g.fillRect(fx - 3, fy, 3, 3);
      g.fillRect(fx + 3, fy, 3, 3);
      g.fillRect(fx, fy + 3, 3, 3);
      g.fillStyle = '#fff3c0';
      g.fillRect(fx, fy, 3, 3);
    }
  }

  // inner border for grid readability
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, S - 1, S - 1);
  return new Sprite(c);
}

// Overworld actor placeholder (player / NPC): 48x96, 4 facings baked
// side-by-side (Phase 1.5, 3x the original 16x32). Returns { get(facing) -> Sprite }.
export function makeActorSprite(opts) {
  const facings = ['down', 'up', 'left', 'right'];
  const W = ACTOR_W, H = ACTOR_H; // 48 x 96
  const sheet = makeCanvas(W * 4, H);
  const g = sheet.getContext('2d');
  const body = opts.color || '#d94f4f';
  const head = opts.head || shadeColor(body, 30);

  facings.forEach((facing, i) => {
    const ox = i * W;
    // soft oval shadow at the feet
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.ellipse(ox + W / 2, H - 7, 15, 5, 0, 0, Math.PI * 2);
    g.fill();
    // body
    g.fillStyle = body;
    g.fillRect(ox + 9, 42, 30, 45);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 2;
    g.strokeRect(ox + 10, 43, 28, 43);
    // arm shading
    g.fillStyle = shadeColor(body, -25);
    g.fillRect(ox + 9, 48, 4, 24);
    g.fillRect(ox + 35, 48, 4, 24);
    // feet
    g.fillStyle = shadeColor(body, -45);
    g.fillRect(ox + 11, 80, 10, 7);
    g.fillRect(ox + 27, 80, 10, 7);
    // head
    g.fillStyle = head;
    g.fillRect(ox + 9, 9, 30, 33);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.strokeRect(ox + 10, 10, 28, 32);
    // hat/accent (hair band across top of head)
    g.fillStyle = opts.accent || shadeColor(body, -40);
    g.fillRect(ox + 9, 6, 30, 9);
    // face direction indicator (eyes / back of head)
    g.fillStyle = '#1a1a1a';
    if (facing === 'down') {
      g.fillRect(ox + 15, 24, 5, 6);
      g.fillRect(ox + 28, 24, 5, 6);
    } else if (facing === 'up') {
      g.fillStyle = shadeColor(head, -30);
      g.fillRect(ox + 12, 15, 24, 12);
    } else if (facing === 'left') {
      g.fillRect(ox + 12, 24, 5, 6);
    } else if (facing === 'right') {
      g.fillRect(ox + 31, 24, 5, 6);
    }
  });

  const sprites = {};
  facings.forEach((facing, i) => {
    sprites[facing] = new Sprite(sheet, i * W, 0, W, H);
  });
  return { get: (facing) => sprites[facing] || sprites.down };
}

// Creature placeholder: 192x192 colored silhouette with shape + glyph
// (Phase 1.5, 3x the original 64x64). Extra highlight + rim detail fills the
// added real estate; same flat, limited-palette look.
export function makeCreatureSprite(creature, typeColor) {
  const S = CREATURE_PX; // 192
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const base = typeColor || '#888';
  const accent = creature.accent || shadeColor(base, 40);
  const cx = S / 2;
  const cy = S / 2 + 6;
  const r = 66;

  // soft ground shadow
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.beginPath();
  g.ellipse(cx, S - 21, 60, 16, 0, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = base;
  g.strokeStyle = shadeColor(base, -55);
  g.lineWidth = 6;

  const shape = creature.shape || 'circle';
  if (shape === 'square') {
    g.beginPath();
    g.rect(cx - r, cy - r, r * 2, r * 2);
    g.fill();
    g.stroke();
  } else if (shape === 'triangle') {
    g.beginPath();
    g.moveTo(cx, cy - r - 6);
    g.lineTo(cx + r + 6, cy + r);
    g.lineTo(cx - r - 6, cy + r);
    g.closePath();
    g.fill();
    g.stroke();
  } else {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }

  // top-left highlight sheen
  g.fillStyle = shadeColor(base, 34);
  g.beginPath();
  g.arc(cx - 22, cy - 26, 15, 0, Math.PI * 2);
  g.fill();

  // accent belly
  g.fillStyle = accent;
  g.beginPath();
  g.arc(cx, cy + 24, 27, 0, Math.PI * 2);
  g.fill();

  // eyes
  g.fillStyle = '#1a1a1a';
  g.beginPath();
  g.arc(cx - 24, cy - 18, 9, 0, Math.PI * 2);
  g.arc(cx + 24, cy - 18, 9, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.fillRect(cx - 28, cy - 24, 4, 4);
  g.fillRect(cx + 20, cy - 24, 4, 4);

  // glyph badge
  if (creature.glyph) {
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillRect(cx - 28, S - 60, 56, 42);
    g.fillStyle = '#fff';
    g.font = 'bold 32px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(creature.glyph, cx, S - 37);
  }

  return new Sprite(c);
}

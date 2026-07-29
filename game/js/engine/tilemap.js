// tilemap.js — tile definitions, map loading, collision, encounter + warp lookup.

import { makeTileSprite, TILE_PX } from './assets.js';

// Tile id -> properties. walkable/encounter drive gameplay; the rest is art.
export const TILE_DEFS = {
  0:  { name: 'grass',     walkable: true,  color: '#7bbf5a', texture: 'grass' },
  1:  { name: 'tree',      walkable: false, color: '#2f6d3a', texture: 'tree' },
  2:  { name: 'water',     walkable: false, color: '#3a7fd0', texture: 'water' },
  3:  { name: 'tallgrass', walkable: true,  encounter: true, color: '#4f9a44', texture: 'tallgrass' },
  4:  { name: 'path',      walkable: true,  color: '#cbb083', texture: 'path' },
  5:  { name: 'wall',      walkable: false, color: '#b9a07c', texture: 'wall' },
  6:  { name: 'roof',      walkable: false, color: '#c05a4a', texture: 'roof' },
  7:  { name: 'door',      walkable: true,  color: '#8a6b4a', texture: 'door' },
  8:  { name: 'fence',     walkable: false, color: '#8a5a3a', texture: 'fence', under: '#7bbf5a' },
  10: { name: 'flower',    walkable: true,  color: '#7bbf5a', texture: 'flower', under: '#7bbf5a' },
};

function defFor(id) {
  return TILE_DEFS[id] || TILE_DEFS[0];
}

export class GameMap {
  constructor(json) {
    this.id = json.id;
    this.name = json.name;
    this.width = json.width;
    this.height = json.height;
    // Pixel size per tile is an engine rendering concern, not logical map data.
    // Derive it from TILE_PX so world pixel dimensions (and camera clamping)
    // stay in sync with the renderer's tile size — the JSON's `tileSize` hint
    // (16, from the Phase 1 baseline) is ignored on purpose so map files need
    // no edits for the Phase 1.5 resolution bump.
    this.tileSize = TILE_PX;
    this.tiles = json.tiles;
    this.playerStart = json.playerStart;
    this.encounter = json.encounter || { rate: 0, table: [] };
    // Per-patch encounter zones: rects with their own rate + table. A grass
    // tile inside a zone uses that zone; otherwise the map default applies.
    this.zones = (json.zones || []).map((z) => ({ ...z }));
    this.npcs = (json.npcs || []).map((n) => ({ ...n }));
    this.warps = json.warps || [];

    // pre-render one Sprite per distinct tile id used
    this.tileSprites = {};
    for (const row of this.tiles) {
      for (const id of row) {
        if (!(id in this.tileSprites)) {
          this.tileSprites[id] = makeTileSprite(defFor(id));
        }
      }
    }
  }

  get pixelWidth() { return this.width * this.tileSize; }
  get pixelHeight() { return this.height * this.tileSize; }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  tileAt(x, y) {
    if (!this.inBounds(x, y)) return 1; // treat out-of-bounds as wall
    return this.tiles[y][x];
  }

  defAt(x, y) {
    return defFor(this.tileAt(x, y));
  }

  npcAt(x, y) {
    return this.npcs.find((n) => n.x === x && n.y === y) || null;
  }

  // Blocked by terrain or by an NPC standing on the tile.
  isBlocked(x, y) {
    if (!this.inBounds(x, y)) return true;
    if (!this.defAt(x, y).walkable) return true;
    if (this.npcAt(x, y)) return true;
    return false;
  }

  isEncounterTile(x, y) {
    return !!this.defAt(x, y).encounter;
  }

  warpAt(x, y) {
    return this.warps.find((w) => w.x === x && w.y === y) || null;
  }

  // The encounter config governing tile (x,y): a zone containing it, else the
  // map-wide default.
  encounterAt(x, y) {
    for (const z of this.zones) {
      if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) return z;
    }
    return this.encounter;
  }

  // Weighted random pick from an encounter config -> { species, level } or null.
  static rollFrom(enc) {
    const table = (enc && enc.table) || [];
    if (!table.length) return null;
    const total = table.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * total;
    for (const e of table) {
      r -= e.weight;
      if (r <= 0) {
        const level = e.min + Math.floor(Math.random() * (e.max - e.min + 1));
        return { species: e.species, level };
      }
    }
    return null;
  }

  // Back-compat: roll from the map-wide default table.
  rollEncounter() {
    return GameMap.rollFrom(this.encounter);
  }
}

// The route editor (/game/route-editor.html) can store a bundle of full map
// JSONs in localStorage; when a map id is present there it takes precedence
// over the file, so edited routes are playable immediately without touching
// the repo. Shape: { "<mapId>": <map json>, ... }.
export const MAPS_OVERRIDE_KEY = 'jg_creature_game_maps_override';

export function loadMapOverrides() {
  try {
    const raw = localStorage.getItem(MAPS_OVERRIDE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch {
    /* corrupt override — ignore, fall back to files */
  }
  return {};
}

export async function loadMap(id) {
  const overrides = loadMapOverrides();
  if (overrides[id] && overrides[id].tiles) {
    return new GameMap(overrides[id]);
  }
  const res = await fetch(`data/maps/${id}.json`);
  if (!res.ok) throw new Error(`Failed to load map ${id}`);
  return new GameMap(await res.json());
}

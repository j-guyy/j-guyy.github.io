// data.test.mjs — integrity of the JSON the game is built out of.
//
// The Creature Editor and Route Editor both write this data, and it is also
// hand-edited, so these are the guards against shipping a file that boots into
// a crash, strands the player, or defines content nothing can ever reach.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData, readJson, readAllMaps, listMapIds } from './helpers/load.mjs';

const { dex } = loadGameData();          // Dex's constructor runs the game's own validator
const maps = readAllMaps();
const items = readJson('data/items.json').items;
const machines = readJson('data/machines.json').machines;
const moves = readJson('data/moves.json').moves;
const creatures = readJson('data/creatures.json').creatures;

const TILE_WALKABLE = new Set([0, 3, 4, 7, 10]); // mirrors TILE_DEFS in tilemap.js

function tileAt(map, x, y) {
  if (y < 0 || x < 0 || y >= map.height || x >= map.width) return null;
  return map.tiles[y][x];
}

test('every species loads and keeps a usable moveset at every level', () => {
  for (const id of dex.order) {
    for (let level = 1; level <= 50; level++) {
      const known = dex.movesAtLevel(id, level);
      assert.ok(known.length > 0, `${id} knows no moves at level ${level}`);
      // A creature whose four slots are all status moves can only Struggle,
      // which reads as a broken creature rather than a design choice.
      const canAttack = known.some(
        (m) => m.category !== 'status' && ((m.power || 0) > 0 || m.ohko || m.fixedDamage != null),
      );
      assert.ok(canAttack, `${id} has a status-only moveset at level ${level}: ${known.map((m) => m.id)}`);
    }
  }
});

test('learnsets are ordered, start at level 1, and reference real moves', () => {
  for (const [id, c] of Object.entries(creatures)) {
    const levels = c.learnset.map((e) => e.level);
    assert.deepEqual(levels, [...levels].sort((a, b) => a - b), `${id} learnset is out of order`);
    assert.ok(levels.some((l) => l <= 1), `${id} has no level-1 move`);
    for (const entry of c.learnset) {
      assert.ok(moves[entry.move], `${id} learns unknown move ${entry.move}`);
    }
  }
});

test('evolutions point forward at real species', () => {
  for (const [id, c] of Object.entries(creatures)) {
    if (!c.evolvesTo) continue;
    assert.ok(creatures[c.evolvesTo.species], `${id} evolves into unknown ${c.evolvesTo.species}`);
    assert.ok(c.evolvesTo.level > 1, `${id} evolves at level ${c.evolvesTo.level}`);
    assert.notEqual(c.evolvesTo.species, id, `${id} evolves into itself`);
  }
});

test('at least one starter exists and every starter is a first stage', () => {
  const starters = dex.starters();
  assert.ok(starters.length >= 1, 'no starter creatures');
  const evolvedForms = new Set(
    Object.values(creatures).filter((c) => c.evolvesTo).map((c) => c.evolvesTo.species),
  );
  for (const id of starters) {
    assert.ok(!evolvedForms.has(id), `starter ${id} is something else's evolved form`);
  }
});

test('machines teach real moves and every one can be obtained', () => {
  // Sources: the New Game kit, trainer rewards, and shop stock.
  const obtainable = new Set(['TM01', 'HM01']); // STARTING_MACHINES in save.js
  for (const map of Object.values(maps)) {
    for (const npc of map.npcs || []) {
      const reward = (npc.trainer || {}).reward || {};
      if (reward.machine) obtainable.add(reward.machine);
      for (const id of npc.shop || []) if (machines[id]) obtainable.add(id);
    }
  }
  for (const [id, m] of Object.entries(machines)) {
    assert.ok(moves[m.move], `${id} teaches unknown move ${m.move}`);
    assert.ok(obtainable.has(id), `${id} is defined but cannot be obtained anywhere`);
  }
});

test('machine moves are teachable to at least one species', () => {
  for (const [id, m] of Object.entries(machines)) {
    const learners = dex.order.filter((c) => dex.canTeach(c, m.move));
    assert.ok(learners.length > 0, `${id} (${m.move}) is teachable to nobody`);
  }
});

test('shops sell real items or machines, and everything sold has a price', () => {
  for (const map of Object.values(maps)) {
    for (const npc of map.npcs || []) {
      for (const id of npc.shop || []) {
        const def = items[id] || machines[id];
        assert.ok(def, `${map.id}/${npc.name} sells unknown "${id}"`);
        assert.ok(def.price > 0, `${map.id}/${npc.name} sells ${id} with no price`);
      }
    }
  }
});

test('trainers field real creatures and pay real rewards', () => {
  for (const map of Object.values(maps)) {
    for (const npc of map.npcs || []) {
      const t = npc.trainer;
      if (!t) continue;
      const where = `${map.id}/${npc.name}`;
      assert.ok(t.defeatFlag, `${where} has no defeatFlag, so it would rebattle forever`);
      assert.ok((t.party || []).length > 0 || t.rival, `${where} has an empty party`);
      for (const member of t.party || []) {
        assert.ok(creatures[member.species], `${where} fields unknown ${member.species}`);
        assert.ok(member.level >= 1, `${where} fields ${member.species} at level ${member.level}`);
      }
      if (t.rivalLead) assert.ok(creatures[t.rivalLead], `${where} leads with unknown ${t.rivalLead}`);
      const reward = t.reward || {};
      if (reward.item) assert.ok(items[reward.item], `${where} rewards unknown item ${reward.item}`);
      if (reward.machine) assert.ok(machines[reward.machine], `${where} rewards unknown machine ${reward.machine}`);
    }
  }
});

test('encounter tables are rollable and reference real creatures', () => {
  for (const map of Object.values(maps)) {
    const tables = [map.encounter, ...(map.zones || [])].filter(Boolean);
    for (const table of tables) {
      for (const entry of table.table || []) {
        assert.ok(creatures[entry.species], `${map.id} can roll unknown ${entry.species}`);
        assert.ok(entry.min <= entry.max, `${map.id}/${entry.species} has min > max`);
        assert.ok(entry.min >= 1, `${map.id}/${entry.species} rolls below level 1`);
        assert.ok(entry.weight > 0, `${map.id}/${entry.species} has weight ${entry.weight}`);
      }
      if ((table.table || []).length) {
        assert.ok(table.rate > 0, `${map.id} has an encounter table but a rate of ${table.rate}`);
      }
    }
    // A grass tile outside every zone falls back to the map default, so a map
    // with encounter tiles and no default table has silent dead grass.
    const hasGrass = map.tiles.some((row) => row.includes(3));
    if (hasGrass) {
      const hasAnyTable = (map.encounter?.table || []).length > 0 || (map.zones || []).length > 0;
      assert.ok(hasAnyTable, `${map.id} has tall grass but no encounter table`);
    }
  }
});

test('encounter zones sit inside the map', () => {
  for (const map of Object.values(maps)) {
    for (const z of map.zones || []) {
      assert.ok(z.x >= 0 && z.y >= 0, `${map.id} zone starts off-map`);
      assert.ok(z.x + z.w <= map.width && z.y + z.h <= map.height, `${map.id} zone runs off-map`);
    }
  }
});

test('warps land on a walkable tile of a map that exists', () => {
  for (const map of Object.values(maps)) {
    for (const warp of map.warps || []) {
      const dest = maps[warp.toMap];
      assert.ok(dest, `${map.id} warps to unknown map ${warp.toMap}`);
      assert.equal(typeof tileAt(map, warp.x, warp.y), 'number', `${map.id} warp sits off-map`);
      const landing = tileAt(dest, warp.toX, warp.toY);
      assert.equal(typeof landing, 'number', `${map.id} -> ${warp.toMap} lands off-map`);
      assert.ok(
        TILE_WALKABLE.has(landing),
        `${map.id} -> ${warp.toMap} lands on impassable tile ${landing} at (${warp.toX},${warp.toY})`,
      );
      // An NPC standing on the landing tile blocks it (GameMap.isBlocked).
      const blocker = (dest.npcs || []).find((n) => n.x === warp.toX && n.y === warp.toY);
      assert.ok(!blocker, `${map.id} -> ${warp.toMap} lands on top of ${blocker?.name}`);
    }
  }
});

test('player starts and NPCs stand on walkable, unblocked tiles', () => {
  for (const map of Object.values(maps)) {
    const start = map.playerStart;
    assert.ok(start, `${map.id} has no playerStart`);
    const startTile = tileAt(map, start.x, start.y);
    assert.ok(TILE_WALKABLE.has(startTile), `${map.id} starts the player on impassable tile ${startTile}`);
    for (const npc of map.npcs || []) {
      const tile = tileAt(map, npc.x, npc.y);
      assert.equal(typeof tile, 'number', `${map.id}/${npc.name} stands off-map`);
      // NPCs block their tile, so one parked on a warp seals that exit.
      const onWarp = (map.warps || []).some((w) => w.x === npc.x && w.y === npc.y);
      assert.ok(!onWarp, `${map.id}/${npc.name} stands on a warp tile and blocks it`);
    }
  }
});

test('every map is reachable from the village', () => {
  const seen = new Set(['village']);
  const queue = ['village'];
  while (queue.length) {
    const id = queue.shift();
    for (const warp of maps[id].warps || []) {
      if (!seen.has(warp.toMap)) {
        seen.add(warp.toMap);
        queue.push(warp.toMap);
      }
    }
  }
  const unreachable = listMapIds().filter((id) => !seen.has(id));
  assert.deepEqual(unreachable, [], `unreachable maps: ${unreachable.join(', ')}`);
});

test('maps/index.json matches the map files on disk', () => {
  const listed = [...readJson('data/maps/index.json').maps].sort();
  assert.deepEqual(listed, listMapIds());
});

test('items declare a kind the game knows how to use', () => {
  const KINDS = new Set(['catch', 'heal', 'cure', 'revive']);
  for (const [id, item] of Object.entries(items)) {
    assert.ok(KINDS.has(item.kind), `item ${id} has unhandled kind "${item.kind}"`);
    assert.ok(item.name && item.desc, `item ${id} is missing name or desc`);
    if (item.kind === 'heal') assert.ok(item.heal > 0, `${id} heals ${item.heal}`);
  }
});

test('abilities declare a kind the battle engine implements', () => {
  // Kinds handled in battle.js; a typo here is a silently inert ability.
  const KINDS = new Set([
    'pinch_boost', 'guts', 'status_immunity', 'contact_status', 'type_immunity', 'sturdy',
  ]);
  for (const id of dex.abilityIds()) {
    const ability = dex.ability(id);
    assert.ok(KINDS.has(ability.kind), `ability ${id} has unimplemented kind "${ability.kind}"`);
  }
  for (const [id, c] of Object.entries(creatures)) {
    assert.ok(c.ability, `${id} has no ability`);
  }
});

test('moves are internally consistent', () => {
  for (const [id, m] of Object.entries(moves)) {
    assert.ok(['physical', 'special', 'status'].includes(m.category), `${id} has category "${m.category}"`);
    assert.ok(m.pp > 0, `${id} has ${m.pp} PP`);
    assert.ok(m.accuracy > 0 && m.accuracy <= 100, `${id} has accuracy ${m.accuracy}`);
    if (m.category === 'status') {
      assert.ok(!m.power, `status move ${id} has power ${m.power}`);
      // A status move with no effect payload burns a turn doing nothing, which
      // is a data mistake unless it is the joke move it is meant to be — those
      // say so with `noop`, rather than leaving it to be inferred from flavor.
      assert.ok(m.effect || m.protect || m.noop, `status move ${id} has no effect`);
    } else {
      const dealsDamage = (m.power || 0) > 0 || m.ohko || m.fixedDamage != null;
      assert.ok(dealsDamage, `${m.category} move ${id} deals no damage`);
    }
  }
});

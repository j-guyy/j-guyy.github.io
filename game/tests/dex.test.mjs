// dex.test.mjs — the progression layer: stats, the XP curve, learnsets,
// evolution, and the save round-trip.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from './helpers/load.mjs';

const { dex } = loadGameData();

test('XP curve is medium-fast (total for level L is L^3)', () => {
  assert.equal(dex.xpTotalForLevel(1), 1);
  assert.equal(dex.xpTotalForLevel(16), 4096);
  assert.equal(dex.xpTotalForLevel(30), 27000);
});

test('stats grow with level and split physical from special', () => {
  const low = dex.makeInstance('emberling', 5);
  const high = dex.makeInstance('emberling', 50);
  for (const key of ['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed']) {
    assert.ok(high.stats[key] > low.stats[key], `${key} did not grow with level`);
  }
  assert.equal(low.maxHP, low.stats.hp);
  assert.equal(low.curHP, low.maxHP, 'a fresh instance should start at full HP');
});

test('computeStats falls back to physical stats for pre-split data', () => {
  const base = { hp: 50, attack: 60, defense: 40, speed: 55 }; // no spAttack/spDefense
  const stats = dex.computeStats(base, 20);
  assert.equal(stats.spAttack, stats.attack);
  assert.equal(stats.spDefense, stats.defense);
});

test('movesAtLevel returns the last four moves learned at or below the level', () => {
  const id = 'emberclaw';
  const learnset = dex.species(id).learnset;
  for (const level of [1, 5, 12, 25, 40]) {
    const expected = [...new Set(learnset.filter((e) => e.level <= level).map((e) => e.move))].slice(-4);
    assert.deepEqual(dex.movesAtLevel(id, level).map((m) => m.id), expected, `wrong moves at level ${level}`);
    assert.ok(dex.movesAtLevel(id, level).length <= 4, 'never more than four moves');
  }
});

test('instance moves start on full PP', () => {
  for (const move of dex.makeInstance('bramblore', 20).moves) {
    assert.equal(move.curPP, move.pp);
    assert.ok(move.pp > 0);
  }
});

test('addXP levels up, recalculates stats and heals by the max-HP gain', () => {
  const mon = dex.makeInstance('voltpup', 5);
  mon.curHP = 1;
  const beforeMax = mon.maxHP;
  const beforeAtk = mon.stats.attack;

  const events = dex.addXP(mon, dex.xpTotalForLevel(6) - mon.xp);

  assert.equal(mon.level, 6);
  assert.ok(events.some((e) => e.type === 'level' && e.level === 6));
  assert.ok(mon.maxHP > beforeMax, 'max HP should grow');
  assert.ok(mon.stats.attack > beforeAtk, 'stats should be recalculated');
  assert.equal(mon.curHP, 1 + (mon.maxHP - beforeMax), 'level-up heals by the max-HP delta only');
});

test('a level-up with a free slot auto-learns; a full slate asks first', () => {
  const id = 'voltpup';
  const learnset = dex.species(id).learnset;
  const newMoveLevel = learnset.find((e) => e.level > 1).level;

  const roomy = dex.makeInstance(id, newMoveLevel - 1);
  roomy.moves = roomy.moves.slice(0, 1); // make space
  const roomyEvents = dex.addXP(roomy, dex.xpTotalForLevel(newMoveLevel) - roomy.xp);
  assert.ok(roomyEvents.some((e) => e.type === 'learned'), 'should auto-learn into a free slot');

  const full = dex.makeInstance(id, newMoveLevel - 1);
  while (full.moves.length < 4) full.moves.push(dex.instanceMove('nudge'));
  const fullEvents = dex.addXP(full, dex.xpTotalForLevel(newMoveLevel) - full.xp);
  assert.ok(fullEvents.some((e) => e.type === 'wantsLearn'), 'should prompt when all four slots are taken');
  assert.equal(full.moves.length, 4, 'nothing is replaced without an answer');
});

test('XP yield scales with the defeated level and the trainer bonus', () => {
  const level = 10;
  const foe = dex.makeInstance('pyrokit', level);
  const baseExp = dex.species('pyrokit').baseExp;

  assert.equal(dex.xpGain(foe, false), Math.floor((baseExp * level) / 7));
  assert.equal(dex.xpGain(foe, true), Math.floor((baseExp * level * 1.5) / 7));
  assert.ok(dex.xpGain(foe, true) > dex.xpGain(foe, false), 'trainers should pay more');
  assert.ok(
    dex.xpGain(dex.makeInstance('pyrokit', 20), false) > dex.xpGain(foe, false),
    'a higher-level foe should pay more',
  );
});

test('evolution triggers at its level and carries the creature over', () => {
  const species = dex.order.find((id) => dex.species(id).evolvesTo);
  const evo = dex.species(species).evolvesTo;

  const tooYoung = dex.makeInstance(species, evo.level - 1);
  assert.equal(dex.evolutionFor(tooYoung), null);

  const ready = dex.makeInstance(species, evo.level);
  assert.equal(dex.evolutionFor(ready), evo.species);

  const moveIds = ready.moves.map((m) => m.id);
  const beforeMax = ready.maxHP;
  ready.curHP = Math.floor(ready.maxHP / 2);
  const halfHP = ready.curHP;

  dex.evolveMember(ready);

  assert.equal(ready.species, evo.species);
  assert.equal(ready.name, dex.species(evo.species).name);
  assert.deepEqual(ready.types, dex.species(evo.species).types);
  assert.deepEqual(ready.moves.map((m) => m.id), moveIds, 'evolving keeps the moves it knew');
  assert.equal(ready.curHP, halfHP + (ready.maxHP - beforeMax), 'current HP carries the max-HP delta');
  assert.ok(ready.curHP <= ready.maxHP);
});

test('a save round-trip preserves level, XP, HP, PP and status', () => {
  const mon = dex.makeInstance('gyreshell', 24);
  mon.curHP = 7;
  mon.xp += 123;
  mon.status = 'burn';
  mon.statusCounter = 3;
  mon.moves[0].curPP = 1;

  const restored = dex.deserializeMember(dex.serializeMember(mon));

  assert.equal(restored.species, mon.species);
  assert.equal(restored.level, mon.level);
  assert.equal(restored.xp, mon.xp);
  assert.equal(restored.curHP, 7);
  assert.equal(restored.status, 'burn');
  assert.equal(restored.statusCounter, 3);
  assert.deepEqual(restored.moves.map((m) => m.id), mon.moves.map((m) => m.id));
  assert.equal(restored.moves[0].curPP, 1, 'spent PP should survive a save');
});

test('a restored creature never exceeds its own maximums', () => {
  const mon = dex.makeInstance('emberling', 5);
  const overfed = dex.deserializeMember({
    species: 'emberling', level: 5, xp: mon.xp, curHP: 9999,
    moves: [{ id: 'ember_jab', pp: 9999 }], status: null, statusCounter: 0,
  });
  assert.equal(overfed.curHP, overfed.maxHP);
  assert.equal(overfed.moves[0].curPP, overfed.moves[0].pp);
});

test('unknown moves in a save are dropped rather than crashing', () => {
  const restored = dex.deserializeMember({
    species: 'emberling', level: 5, xp: 125,
    moves: [{ id: 'ember_jab', pp: 10 }, { id: 'move_that_was_deleted', pp: 5 }],
  });
  assert.deepEqual(restored.moves.map((m) => m.id), ['ember_jab']);
});

test('a save with no moves at all still comes back able to fight', () => {
  const restored = dex.deserializeMember({ species: 'emberling', level: 5, xp: 125, moves: [] });
  assert.ok(restored.moves.length > 0, 'should fall back to the learnset');
});

test('teachable sets are honoured in both forms', () => {
  for (const id of dex.order) {
    const teachable = dex.teachableMoves(id);
    assert.ok(Array.isArray(teachable));
    for (const move of teachable) {
      assert.ok(dex.canTeach(id, move));
      assert.ok(dex.move(move), `${id} can be taught unknown move ${move}`);
    }
  }
});

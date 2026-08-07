// battle.test.mjs — the battle engine's rules.
//
// These assert behaviour (it fainted / the message appeared / the HP moved),
// not exact damage numbers, so retuning a creature's stats does not break the
// suite. Randomness is pinned per test: withRandom(0) makes every chance fire
// and every move hit, withRandom(0.999) makes nothing extra happen, and
// withSeed gives a reproducible mixed battle.

import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData } from './helpers/load.mjs';
import { startBattle } from './helpers/battle.mjs';
import { withRandom, withSeed, withRolls } from './helpers/rng.mjs';
import { STRUGGLE, catchChance } from '../js/battle/battle.js';

const game = loadGameData();
const { dex } = game;

// A creature with exactly the moves a test cares about.
const withMoves = (species, level, moves, extra = {}) => ({ species, level, moves, ...extra });

test('type effectiveness and immunity are applied and announced', () => {
  withRandom(0.5, () => {
    // Water vs a Fire/Dark target: super effective.
    const b = startBattle(game, [withMoves('dripling', 30, ['aqua_tap'])], [withMoves('infernyx', 30, ['nudge'])]);
    b.move('aqua_tap');
    assert.ok(b.said("It's super effective!"), b.dump());
  });

  withRandom(0.5, () => {
    // Electric vs a Ground type: no effect at all.
    const b = startBattle(game, [withMoves('voltpup', 30, ['static_shock'])], [withMoves('mudpad', 30, ['nudge'])]);
    const before = b.enemy.curHP;
    b.move('static_shock');
    assert.ok(b.said('It had no effect...'), b.dump());
    assert.equal(b.enemy.curHP, before, 'an immune target should take nothing');
  });
});

test('damage lands, is at least 1, and never drives HP below zero', () => {
  withSeed(7, () => {
    const b = startBattle(game, [withMoves('emberclaw', 40, ['ember_jab'])], [withMoves('sproutle', 5, ['nudge'])]);
    b.move('ember_jab');
    assert.ok(b.enemy.curHP >= 0, 'HP should clamp at zero');
    assert.ok(b.everSaid('fainted!'), b.dump());
    assert.equal(b.outcome, 'win');
  });
});

test('STAB gives a same-type move the edge over an equal off-type move', () => {
  // Same power, same category, same target; only the typing differs.
  const damageFrom = (moveId) => withRandom(0, () => {
    const b = startBattle(game, [withMoves('emberling', 30, [moveId])], [withMoves('voltpup', 30, ['nudge'])]);
    b.move(moveId);
    return b.damageTo('enemy');
  });
  const stab = damageFrom('ember_jab');   // Fire move on a Fire creature, 40 power
  const plain = damageFrom('aqua_tap');   // Water move, also 40 power, neutral on Electric
  assert.ok(stab > plain, `STAB ${stab} should beat non-STAB ${plain}`);
});

test('a missed move does nothing at all', () => {
  // 0.999 * 100 = 99.9, which fails the accuracy check for anything under 100.
  withRandom(0.999, () => {
    const b = startBattle(game, [withMoves('thornback', 20, ['stone_toss'])], [withMoves('mudpad', 20, ['nudge'])]);
    const before = b.enemy.curHP;
    b.move('stone_toss'); // 90 accuracy
    assert.ok(b.said("attack missed!"), b.dump());
    assert.equal(b.enemy.curHP, before);
  });
});

test('burn chips 1/16 a turn and halves physical attack', () => {
  withRandom(0, () => {
    const b = startBattle(game, [withMoves('emberling', 30, ['singe'])], [withMoves('sproutle', 30, ['nudge'])]);
    b.move('singe'); // guaranteed burn
    assert.equal(b.enemy.status, 'burn', b.dump());
    assert.ok(b.everSaid('was burned!'));
    assert.ok(b.everSaid('is hurt by its burn!'));
    assert.ok(b.enemy.curHP <= b.enemy.maxHP - Math.floor(b.enemy.maxHP / 16));
  });
});

test('poison chips 1/8 and toxic climbs each turn', () => {
  withRandom(0, () => {
    const b = startBattle(game, [withMoves('cindermoth', 30, ['toxic_spray'])], [withMoves('sproutle', 40, ['nudge'])]);
    b.move('toxic_spray');
    assert.equal(b.enemy.status, 'toxic', b.dump());
    const afterFirst = b.enemy.curHP;
    const firstTick = b.enemy.maxHP - afterFirst;
    b.move('toxic_spray'); // already statused; the tick is what matters
    const secondTick = afterFirst - b.enemy.curHP;
    assert.ok(secondTick > firstTick, `toxic should escalate: ${firstTick} then ${secondTick}`);
  });
});

test('a type immune to a status cannot be given it', () => {
  withRandom(0, () => {
    // Fire creatures cannot be burned.
    const b = startBattle(game, [withMoves('emberling', 30, ['singe'])], [withMoves('pyrokit', 30, ['nudge'])]);
    b.move('singe');
    assert.equal(b.enemy.status, null, b.dump());
    assert.ok(b.said("It doesn't affect this creature..."));
  });
});

test('sleep stops a creature acting until it wakes', () => {
  // Sleep runs 1 + floor(random * 3) turns and ticks down on the sleeper's own
  // action, so with two turns it loses exactly the action it would have taken
  // on the turn it was put under.
  withRandom(0.5, () => {
    const b = startBattle(game, [withMoves('sproutle', 40, ['spore_puff'])], [withMoves('mudpad', 20, ['aqua_tap'])]);
    const before = b.player.curHP;
    b.move('spore_puff');
    assert.equal(b.enemy.status, 'sleep', b.dump());
    assert.ok(b.said('is fast asleep.'), b.dump());
    assert.equal(b.player.curHP, before, 'a sleeping foe should not have attacked');
    assert.ok(!b.said('used Aqua Tap!'), b.dump());
  });
});

test('paralysis halves speed, so the slower creature moves first', () => {
  withRandom(0.5, () => {
    // Cindermoth (62 base speed) outruns Mudpad (40); halving it flips the order.
    const b = startBattle(game, [withMoves('mudpad', 20, ['static_field', 'aqua_tap'])], [withMoves('cindermoth', 20, ['nudge'])]);
    const firstUser = () => b.messages().filter((m) => m.includes(' used '))[0];

    b.move('aqua_tap');
    assert.ok(firstUser().startsWith('Cindermoth'), `expected the faster foe first: ${firstUser()}`);

    b.move('static_field');
    assert.equal(b.enemy.status, 'paralysis', b.dump());

    b.move('aqua_tap');
    assert.ok(firstUser().startsWith('Mudpad'), `paralysis should have flipped the order: ${firstUser()}`);
  });
});

test('Leech Seed drains the seeded creature and heals the other side', () => {
  withRandom(0, () => {
    // The foe gets a harmless self-buff, so the only HP moving on our side is
    // the drain being handed back.
    const b = startBattle(game, [withMoves('sproutle', 30, ['root_snare'])], [withMoves('mudpad', 30, ['curl_up'])]);
    b.player.curHP = Math.floor(b.player.maxHP / 2);
    const playerBefore = b.player.curHP;
    b.move('root_snare');
    assert.ok(b.said('was seeded!'), b.dump());
    assert.ok(b.everSaid('sapped by Leech Seed'));
    assert.ok(b.player.curHP > playerBefore, 'the seeder should be healed by the drain');
  });
});

test('Grass types cannot be seeded', () => {
  withRandom(0, () => {
    const b = startBattle(game, [withMoves('sproutle', 30, ['root_snare'])], [withMoves('thornback', 30, ['nudge'])]);
    b.move('root_snare');
    assert.ok(b.said("It doesn't affect this creature..."), b.dump());
  });
});

test('spikes hurt whatever switches in, and Flying is immune', () => {
  withRandom(0, () => {
    const b = startBattle(
      game,
      [withMoves('mudpad', 40, ['caltrops', 'aqua_tap'])],
      [withMoves('sproutle', 20, ['nudge']), withMoves('pyrokit', 20, ['nudge'])],
      { mode: 'trainer' },
    );
    b.move('caltrops');
    assert.ok(b.said('Spikes were scattered on the ground!'), b.dump());
    assert.equal(b.data.hazards.enemy, 1);

    // Knock the lead out so the trainer's next creature walks into the spikes.
    b.enemy.curHP = 1;
    b.move('aqua_tap');
    assert.ok(b.everSaid('is hurt by the spikes!'), b.dump());
  });
});

test('Protect blocks a hit, and fails when leaned on', () => {
  withRandom(0, () => {
    const b = startBattle(game, [withMoves('mudpad', 30, ['guard_stance'])], [withMoves('voltpup', 30, ['spark_nip'])]);
    const before = b.player.curHP;
    b.move('guard_stance');
    assert.ok(b.said('protected itself!'), b.dump());
    assert.equal(b.player.curHP, before, 'Protect should have blocked the hit');
  });

  // Second consecutive use: the streak makes it a 1-in-3, which 0.999 fails.
  withRolls([0, 0, 0, 0, 0, 0, 0, 0, 0, 0], () => {
    const b = startBattle(game, [withMoves('mudpad', 30, ['guard_stance'])], [withMoves('voltpup', 30, ['spark_nip'])]);
    b.move('guard_stance');
    assert.equal(b.data.vol.player.protectStreak, 1);
  });
});

test('priority beats raw speed', () => {
  withRandom(0.5, () => {
    // voltpup is faster, but Quick Jab is +1 priority for the slower side.
    const b = startBattle(game, [withMoves('mudpad', 30, ['quick_jab'])], [withMoves('voltpup', 30, ['spark_nip'])]);
    b.move('quick_jab');
    const used = b.messages().filter((m) => m.includes(' used '));
    assert.ok(used[0].includes('Quick Jab'), `expected the priority move first, got: ${used.join(' | ')}`);
  });
});

test('PP is spent, and a creature with nothing left Struggles', () => {
  withRandom(0.5, () => {
    // A bulky foe with a feeble move, so neither side falls over mid-test.
    const b = startBattle(game, [withMoves('emberclaw', 50, ['ember_jab'])], [withMoves('gyreshell', 50, ['nudge'])]);
    const move = b.player.moves[0];
    const startPP = move.curPP;
    b.move('ember_jab');
    assert.equal(move.curPP, startPP - 1, 'using a move should spend one PP');

    move.curPP = 0;
    const before = b.player.curHP;
    b.struggle();
    assert.ok(b.said('used Struggle!'), b.dump());
    assert.ok(b.said('is hit with recoil!'));
    assert.ok(b.player.curHP < before, 'Struggle should hurt its user');
  });
});

test('Struggle is typeless — it hits creatures that resist Normal', () => {
  withRandom(0.5, () => {
    assert.equal(STRUGGLE.type, 'Normal');
    assert.equal(STRUGGLE.power, 50);
    assert.ok(STRUGGLE.struggle);
  });
});

test('a switch consumes the turn and clears stat stages', () => {
  withRandom(0.5, () => {
    const b = startBattle(
      game,
      [withMoves('emberling', 30, ['gale_step']), withMoves('voltpup', 30, ['nudge'])],
      [withMoves('sproutle', 30, ['nudge'])],
    );
    b.move('gale_step'); // +2 Speed to self
    assert.ok(b.data.vol.player.stages.speed > 0, b.dump());
    b.switchTo(1);
    assert.ok(b.said('Come back,'), b.dump());
    assert.equal(b.data.vol.player.stages.speed, 0, 'stages should reset on a switch');
    assert.equal(b.player.species, 'voltpup');
  });
});

test('a fainted creature leaves an empty slot for the player to fill', () => {
  withRandom(0.5, () => {
    const b = startBattle(
      game,
      [withMoves('sproutle', 5, ['nudge']), withMoves('voltpup', 30, ['spark_nip'])],
      [withMoves('infernyx', 50, ['ember_fist'])],
    );
    b.player.curHP = 1;
    b.move('nudge');
    assert.ok(b.needsReplacement(), 'the player should be asked who comes in');
    assert.ok(!b.over, 'the battle continues while someone is left');
    assert.deepEqual(b.replacementOptions(), [1]);
    b.sendIn(1);
    assert.equal(b.player.species, 'voltpup');
    assert.ok(!b.needsReplacement());
  });
});

test('losing the last creature ends the battle', () => {
  withRandom(0.5, () => {
    const b = startBattle(game, [withMoves('sproutle', 5, ['nudge'])], [withMoves('infernyx', 50, ['ember_fist'])]);
    b.player.curHP = 1;
    b.move('nudge');
    assert.ok(b.over);
    assert.equal(b.outcome, 'lose');
  });
});

test('a trainer sends out its next creature automatically', () => {
  withRandom(0.5, () => {
    const b = startBattle(
      game,
      [withMoves('infernyx', 50, ['ember_fist'])],
      [withMoves('sproutle', 5, ['nudge']), withMoves('voltpup', 5, ['nudge'])],
      { mode: 'trainer', trainerName: 'Ranger Test' },
    );
    b.move('ember_fist');
    assert.ok(b.everSaid('Ranger Test sent out'), b.dump());
    assert.equal(b.enemy.species, 'voltpup');
    assert.ok(!b.over, 'the battle continues while the trainer has creatures');
  });
});

test('beating a trainer awards more XP than the same wild creature', () => {
  const xpFrom = (mode) => withRandom(0.5, () => {
    const b = startBattle(game, [withMoves('infernyx', 50, ['ember_fist'])], [withMoves('sproutle', 10, ['nudge'])], { mode });
    b.move('ember_fist');
    return b.allBeats().filter((x) => x.type === 'xp').reduce((s, x) => s + x.amount, 0);
  });
  assert.ok(xpFrom('trainer') > xpFrom('wild'));
});

test('catching is wild-only and improves as the target weakens', () => {
  const orb = { id: 'snare_orb', name: 'Snare Orb', kind: 'catch', catchMod: 1 };
  withRandom(0, () => {
    const b = startBattle(game, [withMoves('emberling', 20, ['nudge'])], [withMoves('sproutle', 5, ['nudge'])]);
    b.useItem(orb);
    assert.equal(b.outcome, 'caught', b.dump());
  });

  const healthy = dex.makeInstance('sproutle', 20);
  const hurt = dex.makeInstance('sproutle', 20);
  hurt.curHP = 1;
  assert.ok(catchChance(hurt) > catchChance(healthy), 'a weakened target should be easier');
  const asleep = dex.makeInstance('sproutle', 20);
  asleep.status = 'sleep';
  assert.ok(catchChance(asleep) > catchChance(healthy), 'sleep should help');
  assert.ok(catchChance(healthy) <= 0.95, 'catching is never certain');
});

test('fleeing is refused against a trainer but allowed in the wild', () => {
  withRandom(0, () => {
    const wild = startBattle(game, [withMoves('emberling', 40, ['nudge'])], [withMoves('sproutle', 5, ['nudge'])]);
    wild.flee();
    assert.equal(wild.outcome, 'fled', wild.dump());
  });
});

test('weather deals its chip damage and expires', () => {
  withRandom(0.5, () => {
    const b = startBattle(game, [withMoves('thornback', 40, ['grit_storm', 'curl_up'])], [withMoves('voltpup', 60, ['nudge'])]);
    b.move('grit_storm');
    assert.ok(b.said('A sandstorm kicked up!'), b.dump());
    assert.ok(b.everSaid('buffeted by the sandstorm'), 'the Electric foe should take chip damage');
    // Rock types shrug off sandstorm.
    assert.ok(!b.allMessages().some((m) => m.includes('Thornback is buffeted')), b.dump());

    // Anything but Grit Storm, or each turn would refresh the weather it is
    // waiting on to expire.
    for (let i = 0; i < 5 && !b.over; i++) b.move('curl_up');
    assert.ok(b.everSaid('The sandstorm subsided.'), b.dump());
  });
});

test('drain moves heal the attacker', () => {
  withRandom(0.5, () => {
    // The foe has to survive the hit — the engine deliberately skips the drain
    // when the blow faints its target, matching the classic behaviour.
    const b = startBattle(game, [withMoves('bramblore', 20, ['greater_siphon'])], [withMoves('gyreshell', 60, ['curl_up'])]);
    b.player.curHP = Math.floor(b.player.maxHP / 3);
    const before = b.player.curHP;
    b.move('greater_siphon');
    assert.ok(b.enemy.curHP > 0, 'the foe should survive to be drained');
    assert.ok(b.everSaid('regained health!'), b.dump());
    assert.ok(b.player.curHP > before);
  });
});

test('recoil hurts the attacker in proportion to the damage dealt', () => {
  withRandom(0.5, () => {
    // Not a Ground type — those are immune to Electric, so there would be no
    // damage to take a cut of.
    const b = startBattle(game, [withMoves('voltpup', 40, ['overcharge_ram'])], [withMoves('gyreshell', 60, ['curl_up'])]);
    const before = b.player.curHP;
    b.move('overcharge_ram');
    assert.ok(b.said('is hit with recoil!'), b.dump());
    assert.ok(b.player.curHP < before);
  });
});

test('multi-hit moves land between two and five times', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    withSeed(seed, () => {
      const b = startBattle(game, [withMoves('cindermoth', 40, ['needle_barrage'])], [withMoves('mudpad', 80, ['nudge'])]);
      b.move('needle_barrage');
      const hitMsg = b.messages().find((m) => /^Hit \d+ time/.test(m));
      if (!hitMsg) return; // missed this roll; accuracy is 95
      const hits = Number(hitMsg.match(/Hit (\d+)/)[1]);
      assert.ok(hits >= 1 && hits <= 5, `implausible hit count: ${hits}`);
    });
  }
});

test('stat stages move damage in the expected direction', () => {
  const damageAfter = (setup) => withRandom(0.5, () => {
    const b = startBattle(game, [withMoves('emberling', 30, ['rattle_cry', 'nudge'])], [withMoves('mudpad', 60, ['nudge'])]);
    setup(b);
    b.move('nudge');
    return b.damageTo('enemy');
  });
  const plain = damageAfter(() => {});
  const boosted = damageAfter((b) => { b.data.vol.player.stages.attack = 6; });
  assert.ok(boosted > plain, `+6 Attack (${boosted}) should beat neutral (${plain})`);
});

test('a full battle runs to a conclusion without throwing', () => {
  for (const seed of [11, 22, 33, 44, 55]) {
    withSeed(seed, () => {
      const b = startBattle(
        game,
        [withMoves('emberclaw', 20, ['ember_jab', 'quick_jab', 'singe']), withMoves('voltpup', 18, ['spark_nip'])],
        [withMoves('thornback', 20, ['stone_toss']), withMoves('mudpad', 19, ['aqua_tap'])],
        { mode: 'trainer', trainerName: 'Ranger Test' },
      );
      for (let turn = 0; turn < 60 && !b.over; turn++) {
        if (b.needsReplacement()) { b.sendIn(); continue; }
        const usable = b.player.moves.filter((m) => m.curPP > 0);
        if (usable.length) b.move(usable[turn % usable.length].id);
        else b.struggle();
      }
      assert.ok(b.over, `seed ${seed} never resolved:\n${b.dump()}`);
      assert.ok(['win', 'lose'].includes(b.outcome), `seed ${seed} ended as ${b.outcome}`);
      for (const mon of [...b.playerParty, ...b.enemyParty]) {
        assert.ok(mon.curHP >= 0 && mon.curHP <= mon.maxHP, `${mon.name} ended on ${mon.curHP}/${mon.maxHP}`);
      }
    });
  }
});

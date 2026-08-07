// battle.mjs — a scripted driver for battle.js.
//
// The engine returns "beats" (msg / damage / faint / xp / switch / caught /
// fled) that the game plays back as animation. Tests care about what happened,
// not how it looked, so this wraps a battle and exposes the beats as searchable
// text plus the live creature objects.
//
//   const b = startBattle(data, ['sproutle:20'], ['mudpad:10']);
//   b.move('root_snare');
//   assert.ok(b.said('was seeded'));
//
// Creature specs are 'species:level' strings, or objects for finer control:
//   { species, level, moves: ['ember_jab'], curHP: 5, status: 'burn' }

import {
  createBattle, resolveTurn, activePlayer, activeEnemy,
  needsReplacement, replacementOptions, sendInReplacement,
} from '../../js/battle/battle.js';

function makeMember(dex, spec) {
  if (typeof spec === 'string') {
    const [species, level] = spec.split(':');
    return dex.makeInstance(species, Number(level || 5));
  }
  const { species, level = 5, ...opts } = spec;
  return dex.makeInstance(species, level, opts);
}

export function startBattle({ dex, typeChart }, playerSpecs, enemySpecs, opts = {}) {
  const playerParty = playerSpecs.map((s) => makeMember(dex, s));
  const enemyParty = enemySpecs.map((s) => makeMember(dex, s));
  const data = createBattle(playerParty, enemyParty, {
    mode: opts.mode || 'wild',
    trainerName: opts.trainerName || 'Tester',
  });
  const ctx = { typeChart, dex, ...(opts.ctx || {}) };
  const log = [];      // every beat, across every turn
  let lastBeats = [];

  const record = (beats) => {
    lastBeats = beats;
    log.push(...beats);
    return beats;
  };

  const api = {
    data,
    ctx,
    get player() { return activePlayer(data); },
    get enemy() { return activeEnemy(data); },
    get playerParty() { return playerParty; },
    get enemyParty() { return enemyParty; },
    get outcome() { return data.outcome; },
    get over() { return data.over; },

    // --- actions -----------------------------------------------------------
    act(action) { return record(resolveTurn(data, action, ctx).beats); },
    move(moveId) { return api.act({ type: 'move', moveId }); },
    struggle() { return api.act({ type: 'move', moveId: '__struggle' }); },
    switchTo(index) { return api.act({ type: 'switch', index }); },
    useItem(item) { return api.act({ type: 'item', item }); },
    flee() { return api.act({ type: 'flee' }); },

    // Fill the empty slot left by a faint (what main.js's 'replace' phase does).
    sendIn(index) {
      if (index == null) index = replacementOptions(data)[0];
      return record(sendInReplacement(data, index, ctx).beats);
    },
    needsReplacement: () => needsReplacement(data),
    replacementOptions: () => replacementOptions(data),

    // --- inspection --------------------------------------------------------
    beats: () => lastBeats,
    allBeats: () => log,
    messages: () => lastBeats.filter((b) => b.type === 'msg').map((b) => b.text),
    allMessages: () => log.filter((b) => b.type === 'msg').map((b) => b.text),
    // Did any message this turn contain `text`?
    said: (text) => api.messages().some((m) => m.includes(text)),
    everSaid: (text) => api.allMessages().some((m) => m.includes(text)),
    beatsOfType: (type) => lastBeats.filter((b) => b.type === type),
    // Total HP removed from one side this turn (heals count negative).
    damageTo(side) {
      return lastBeats
        .filter((b) => b.type === 'damage' && b.target === side)
        .reduce((sum, b) => sum + (b.from - b.to), 0);
    },
    dump: () => api.allMessages().join('\n'),
  };
  return api;
}

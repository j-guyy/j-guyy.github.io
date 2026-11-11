// save.test.mjs — save.js: migrations and rejection of unreadable saves.
//
// save.js talks to the global localStorage at call time, so this installs its
// own in-memory one (rather than relying on whichever Node build provides).

import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  },
});

const { hasSave, loadSave, writeSave, SAVE_VERSION, STARTING_KIT, STARTING_MACHINES, STARTING_MONEY } =
  await import('../js/save.js');

const KEY = 'jg_creature_game_save_v1';
const put = (obj) => store.set(KEY, typeof obj === 'string' ? obj : JSON.stringify(obj));

const member = (extra = {}) => ({
  species: 'emberling', level: 5, xp: 125, curHP: 12,
  moves: [{ id: 'ember_jab', pp: 10 }], status: null, statusCounter: 0, ...extra,
});
const state = (extra = {}) => ({
  starterChosen: 'emberling',
  player: { map: 'village', x: 3, y: 4, facing: 'down' },
  party: [member()],
  storage: [],
  money: 120,
  inventory: { potion: 1 },
  machines: {},
  dexState: { seen: ['emberling'], caught: ['emberling'] },
  flags: {},
  ...extra,
});

test('no save loads as null', () => {
  store.clear();
  assert.equal(hasSave(), false);
  assert.equal(loadSave(), null);
});

test('a written save loads back', () => {
  store.clear();
  assert.equal(writeSave(state()), true);
  const data = loadSave();
  assert.equal(data.version, SAVE_VERSION);
  assert.equal(data.player.map, 'village');
  assert.equal(data.party[0].species, 'emberling');
  assert.equal(data.money, 120);
});

test('a v1 save migrates all the way to the current version', () => {
  store.clear();
  put({
    version: 1,
    starterChosen: 'emberling',
    player: { map: 'village', x: 3, y: 4, facing: 'down' },
    party: [{ species: 'emberling', level: 5, curHP: 12 }],
    flags: {},
  });
  const data = loadSave();
  assert.equal(data.version, SAVE_VERSION);
  assert.deepEqual(data.inventory, STARTING_KIT);
  assert.deepEqual(data.machines, STARTING_MACHINES);
  assert.equal(data.money, STARTING_MONEY);
  assert.deepEqual(data.dexState, { seen: [], caught: [] });
  assert.deepEqual(data.storage, []);
  assert.deepEqual(data.party[0].moves, []);
});

test('a v3 save has its move ids turned into {id, pp}', () => {
  store.clear();
  put({
    version: 3,
    player: { map: 'village', x: 1, y: 1 },
    party: [{ species: 'emberling', level: 5, moves: ['ember_jab'] }],
  });
  const data = loadSave();
  assert.deepEqual(data.party[0].moves, [{ id: 'ember_jab', pp: null }]);
});

test('unreadable saves load as null and are left in storage', () => {
  const v = SAVE_VERSION;
  const bad = {
    'corrupt JSON': '{not json',
    'JSON null': 'null',
    'a future version': { ...state(), version: v + 1 },
    'no party': { ...state({ party: undefined }), version: v },
    'an empty party': { ...state({ party: [] }), version: v },
    'party is not an array': { ...state({ party: {} }), version: v },
    'a member with no species': { ...state({ party: [member({ species: undefined })] }), version: v },
    'a member with no level': { ...state({ party: [member({ level: undefined })] }), version: v },
    'a null member': { ...state({ party: [null] }), version: v },
    'storage is not an array': { ...state({ storage: 'x' }), version: v },
    'no player': { ...state({ player: undefined }), version: v },
    'no map id': { ...state({ player: { x: 1, y: 1 } }), version: v },
    'no coordinates': { ...state({ player: { map: 'village' } }), version: v },
  };
  for (const [label, value] of Object.entries(bad)) {
    store.clear();
    put(value);
    const raw = store.get(KEY);
    assert.equal(loadSave(), null, label);
    assert.equal(store.get(KEY), raw, `${label}: the bad save must not be deleted or rewritten`);
    assert.equal(hasSave(), true, label);
  }
});

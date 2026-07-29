// save.js — localStorage persistence with a version tag and migrations.
// v2 (Phase 2): party members gain xp + moves; save gains inventory + dexState.
// v3 (Phase 2.6): save gains `machines` (owned TMs/HMs).
// v4 (Phase 4/5): member moves become [{id, pp}] (PP tracking); save gains
//                 `money` and `storage` (PC box for creatures beyond the party).

const KEY = 'jg_creature_game_save_v1';
export const SAVE_VERSION = 4;

export const STARTING_KIT = { snare_orb: 5, potion: 3, remedy_leaf: 1 };
// A TM (single-use) and an HM (reusable) so the teaching flow is testable from
// a fresh save.
export const STARTING_MACHINES = { TM01: 1, HM01: 1 };
export const STARTING_MONEY = 500;

export function hasSave() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

// v1 -> v2: XP and moves are omitted per member (deserializeMember derives them
// from level/learnset); grant the default starting kit and an empty dex.
function migrateV1(d) {
  return {
    ...d,
    version: 2,
    inventory: { ...STARTING_KIT },
    dexState: { seen: [], caught: [] },
  };
}

// v2 -> v3: grant the starting machines so existing saves can try TMs/HMs.
function migrateV2(d) {
  return {
    ...d,
    version: 3,
    machines: { ...STARTING_MACHINES },
  };
}

// v3 -> v4: member move ids become {id, pp:null} (deserialize fills full PP);
// grant starting money and an empty storage box.
function memberMovesToV4(m) {
  return {
    ...m,
    moves: (m.moves || []).map((mv) => (typeof mv === 'string' ? { id: mv, pp: null } : mv)),
  };
}
function migrateV3(d) {
  return {
    ...d,
    version: 4,
    party: (d.party || []).map(memberMovesToV4),
    storage: (d.storage || []).map(memberMovesToV4),
    money: d.money != null ? d.money : STARTING_MONEY,
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    let data = JSON.parse(raw);
    if (data.version === 1) data = migrateV1(data);
    if (data.version === 2) data = migrateV2(data);
    if (data.version === 3) data = migrateV3(data);
    if (data.version !== SAVE_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

// state: { starterChosen, player:{map,x,y,facing},
//          party:[{species,level,xp,curHP,moves:[{id,pp}],status,statusCounter}],
//          storage:[same shape], money,
//          inventory:{itemId:qty}, machines:{machineId:qty},
//          dexState:{seen:[],caught:[]}, flags }
export function writeSave(state) {
  const data = {
    version: SAVE_VERSION,
    hasSaved: true,
    savedAt: Date.now(),
    starterChosen: state.starterChosen,
    player: state.player,
    party: state.party,
    storage: state.storage || [],
    money: state.money != null ? state.money : 0,
    inventory: state.inventory || {},
    machines: state.machines || {},
    dexState: state.dexState || { seen: [], caught: [] },
    flags: state.flags || {},
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error('Save failed', e);
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

// sets.js — the simulator's "set" layer: everything that turns a species into a
// specific, buildable creature (level, nature, IVs/EVs, ability, four moves).
//
// The main game has no natures/IVs/EVs — Dex.computeStats() is base stats +
// level and nothing else. The simulator wants the mainline knobs, so it
// computes its own stat block here and overwrites the one Dex.makeInstance()
// produced. That works because the battle engine only ever *reads* inst.stats /
// inst.maxHP; it never recomputes them mid-battle (only Dex.addXP does, and the
// simulator never awards XP). So this file is a pure additive layer — the
// overworld game is completely untouched by it.

export const STAT_KEYS = ['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed'];

export const STAT_LABEL = {
  hp: 'HP', attack: 'Atk', defense: 'Def', spAttack: 'SpA', spDefense: 'SpD', speed: 'Spe',
};

export const STAT_LONG = {
  hp: 'HP', attack: 'Attack', defense: 'Defense',
  spAttack: 'Sp. Attack', spDefense: 'Sp. Defense', speed: 'Speed',
};

// The 25 mainline natures: +10% to one stat, -10% to another (five are neutral).
export const NATURES = {
  hardy:   { name: 'Hardy',   plus: null,        minus: null },
  lonely:  { name: 'Lonely',  plus: 'attack',    minus: 'defense' },
  brave:   { name: 'Brave',   plus: 'attack',    minus: 'speed' },
  adamant: { name: 'Adamant', plus: 'attack',    minus: 'spAttack' },
  naughty: { name: 'Naughty', plus: 'attack',    minus: 'spDefense' },
  bold:    { name: 'Bold',    plus: 'defense',   minus: 'attack' },
  docile:  { name: 'Docile',  plus: null,        minus: null },
  relaxed: { name: 'Relaxed', plus: 'defense',   minus: 'speed' },
  impish:  { name: 'Impish',  plus: 'defense',   minus: 'spAttack' },
  lax:     { name: 'Lax',     plus: 'defense',   minus: 'spDefense' },
  timid:   { name: 'Timid',   plus: 'speed',     minus: 'attack' },
  hasty:   { name: 'Hasty',   plus: 'speed',     minus: 'defense' },
  serious: { name: 'Serious', plus: null,        minus: null },
  jolly:   { name: 'Jolly',   plus: 'speed',     minus: 'spAttack' },
  naive:   { name: 'Naive',   plus: 'speed',     minus: 'spDefense' },
  modest:  { name: 'Modest',  plus: 'spAttack',  minus: 'attack' },
  mild:    { name: 'Mild',    plus: 'spAttack',  minus: 'defense' },
  quiet:   { name: 'Quiet',   plus: 'spAttack',  minus: 'speed' },
  bashful: { name: 'Bashful', plus: null,        minus: null },
  rash:    { name: 'Rash',    plus: 'spAttack',  minus: 'spDefense' },
  calm:    { name: 'Calm',    plus: 'spDefense', minus: 'attack' },
  gentle:  { name: 'Gentle',  plus: 'spDefense', minus: 'defense' },
  sassy:   { name: 'Sassy',   plus: 'spDefense', minus: 'speed' },
  careful: { name: 'Careful', plus: 'spDefense', minus: 'spAttack' },
  quirky:  { name: 'Quirky',  plus: null,        minus: null },
};

export const MAX_IV = 31;
export const MAX_EV_PER_STAT = 252;
export const MAX_EV_TOTAL = 510;
export const TEAM_SIZE = 6;

// ---- Formats ---------------------------------------------------------------
// A format is the rule set the builder validates against. "Standard" keeps a
// creature to what it could genuinely have in the overworld game — its own
// learnset plus the TM/HM moves it's allowed, and its own ability. "Anything
// Goes" opens the whole 378-move pool and every ability, which is the only way
// to actually explore the move list: species learnsets are 4-7 moves each, so
// legal teams are near-identical without it.

export const FORMATS = {
  standard: {
    id: 'standard',
    name: 'Standard',
    movePool: 'legal',
    abilityPool: 'species',
    desc: 'Learnset + TM moves only, species ability. What a creature could really have.',
  },
  open: {
    id: 'open',
    name: 'Anything Goes',
    movePool: 'open',
    abilityPool: 'open',
    desc: 'Any move, any ability. Sandbox mode for the full move pool.',
  },
};

export function getFormat(id) {
  return FORMATS[id] || FORMATS.standard;
}

// ---- Legality --------------------------------------------------------------

// Every move `speciesId` may run at `level` under `format`: its learnset up to
// that level, plus the TM/HM moves Dex says it can be taught.
export function legalMoves(dex, speciesId, level, format) {
  if (format.movePool === 'open') return Object.keys(dex.moves);
  const species = dex.species(speciesId);
  const out = [];
  for (const entry of species.learnset) {
    if (entry.level <= level && !out.includes(entry.move)) out.push(entry.move);
  }
  for (const id of dex.teachableMoves(speciesId)) {
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export function legalAbilities(dex, speciesId, format) {
  if (format.abilityPool === 'open') return dex.abilityIds();
  const species = dex.species(speciesId);
  return species.ability ? [species.ability] : dex.abilityIds();
}

// ---- Stats -----------------------------------------------------------------

export function natureMultiplier(natureId, stat) {
  const nature = NATURES[natureId];
  if (!nature || stat === 'hp') return 1;
  if (nature.plus === stat) return 1.1;
  if (nature.minus === stat) return 0.9;
  return 1;
}

// Mainline (Gen 3+) stat formula. HP has its own shape; every other stat takes
// the nature multiplier last, floored.
export function computeSimStats(base, level, ivs, evs, natureId) {
  const out = {};
  for (const key of STAT_KEYS) {
    const b = base[key] != null ? base[key] : (key === 'spAttack' ? base.attack : key === 'spDefense' ? base.defense : 0);
    const iv = clamp(ivs && ivs[key] != null ? ivs[key] : MAX_IV, 0, MAX_IV);
    const ev = clamp(evs && evs[key] != null ? evs[key] : 0, 0, MAX_EV_PER_STAT);
    const core = Math.floor(((2 * b + iv + Math.floor(ev / 4)) * level) / 100);
    out[key] = key === 'hp'
      ? core + level + 10
      : Math.floor((core + 5) * natureMultiplier(natureId, key));
  }
  return out;
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function totalEVs(evs) {
  return STAT_KEYS.reduce((sum, key) => sum + (evs[key] || 0), 0);
}

// ---- Sets ------------------------------------------------------------------

let setSeq = 0;

function emptyEVs() {
  const evs = {};
  for (const key of STAT_KEYS) evs[key] = 0;
  return evs;
}

function perfectIVs() {
  const ivs = {};
  for (const key of STAT_KEYS) ivs[key] = MAX_IV;
  return ivs;
}

// A fresh set for `speciesId`: level 50 (the simulator's default, same as
// Showdown), perfect IVs, no EVs, neutral nature, and the four highest-level
// moves it knows — i.e. exactly what the overworld game would hand you.
export function makeSet(dex, speciesId, format, level = 50) {
  const species = dex.species(speciesId);
  const pool = legalMoves(dex, speciesId, level, format);
  const learned = species.learnset
    .filter((e) => e.level <= level)
    .map((e) => e.move)
    .filter((id, i, arr) => arr.indexOf(id) === i);
  const moves = (learned.length ? learned.slice(-4) : pool.slice(0, 4)).slice(0, 4);
  return {
    uid: `set${++setSeq}`,
    species: speciesId,
    nickname: '',
    level,
    nature: 'serious',
    ability: legalAbilities(dex, speciesId, format)[0] || species.ability || null,
    ivs: perfectIVs(),
    evs: emptyEVs(),
    moves,
  };
}

export function cloneSet(set) {
  return {
    ...set,
    uid: `set${++setSeq}`,
    ivs: { ...set.ivs },
    evs: { ...set.evs },
    moves: set.moves.slice(),
  };
}

// Normalize anything set-shaped (an import, a preset, an old localStorage
// entry) into a complete, valid-enough set. Unknown species returns null.
export function normalizeSet(dex, raw, format) {
  if (!raw || !dex.creatures[raw.species]) return null;
  const level = clamp(Math.round(raw.level || 50), 1, 100);
  const base = makeSet(dex, raw.species, format, level);
  const set = {
    ...base,
    nickname: typeof raw.nickname === 'string' ? raw.nickname.slice(0, 16) : '',
    nature: NATURES[raw.nature] ? raw.nature : 'serious',
  };
  const abilities = legalAbilities(dex, raw.species, format);
  if (raw.ability && abilities.includes(raw.ability)) set.ability = raw.ability;
  for (const key of STAT_KEYS) {
    if (raw.ivs && raw.ivs[key] != null) set.ivs[key] = clamp(Math.round(raw.ivs[key]), 0, MAX_IV);
    if (raw.evs && raw.evs[key] != null) set.evs[key] = clamp(Math.round(raw.evs[key]), 0, MAX_EV_PER_STAT);
  }
  if (Array.isArray(raw.moves)) {
    const pool = legalMoves(dex, raw.species, level, format);
    const picked = raw.moves.filter((id) => dex.moves[id] && pool.includes(id)).slice(0, 4);
    if (picked.length) set.moves = picked;
  }
  return set;
}

// Problems that should stop a set from battling (`errors`) and things worth
// warning about but not blocking (`warnings`).
export function validateSet(dex, set, format) {
  const errors = [];
  const warnings = [];
  const species = dex.species(set.species);
  const label = set.nickname || species.name;
  if (!set.moves.length) errors.push(`${label} has no moves.`);
  const pool = legalMoves(dex, set.species, set.level, format);
  for (const id of set.moves) {
    if (!dex.moves[id]) errors.push(`${label} has an unknown move '${id}'.`);
    else if (!pool.includes(id)) errors.push(`${label} can't learn ${dex.moves[id].name} at level ${set.level}.`);
  }
  if (new Set(set.moves).size !== set.moves.length) errors.push(`${label} has a duplicate move.`);
  const abilities = legalAbilities(dex, set.species, format);
  if (set.ability && !abilities.includes(set.ability)) {
    errors.push(`${label} can't have ${dex.ability(set.ability).name}.`);
  }
  const evTotal = totalEVs(set.evs);
  if (evTotal > MAX_EV_TOTAL) errors.push(`${label} has ${evTotal} EVs (max ${MAX_EV_TOTAL}).`);
  if (set.moves.length < 4) warnings.push(`${label} has only ${set.moves.length} move${set.moves.length === 1 ? '' : 's'}.`);
  if (set.moves.every((id) => dex.moves[id] && dex.moves[id].category === 'status')) {
    warnings.push(`${label} has no damaging moves.`);
  }
  return { errors, warnings };
}

export function validateTeam(dex, team, format) {
  const errors = [];
  const warnings = [];
  if (!team.length) errors.push('Your team is empty.');
  if (team.length > TEAM_SIZE) errors.push(`A team can hold at most ${TEAM_SIZE} creatures.`);
  for (const set of team) {
    const res = validateSet(dex, set, format);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
  }
  return { errors, warnings, ok: errors.length === 0 };
}

// ---- Instances -------------------------------------------------------------

// Turn a set into the battle-ready instance the engine expects. Dex builds the
// base object (sprites, move objects with PP, types); we then swap in the
// simulator's stat block and any set-level overrides.
export function buildInstance(dex, set) {
  const inst = dex.makeInstance(set.species, set.level, { moves: set.moves.slice() });
  const stats = computeSimStats(dex.species(set.species).baseStats, set.level, set.ivs, set.evs, set.nature);
  inst.stats = stats;
  inst.maxHP = stats.hp;
  inst.curHP = stats.hp;
  inst.ability = set.ability || inst.ability;
  inst.status = null;
  inst.statusCounter = 0;
  if (set.nickname) inst.name = set.nickname;
  // Kept so the battle UI can show the set behind a creature (nature, spread,
  // the species name when a nickname hides it) without re-deriving it.
  inst.set = set;
  inst.speciesName = dex.species(set.species).name;
  inst.nature = set.nature;
  return inst;
}

export function buildParty(dex, team) {
  return team.map((set) => buildInstance(dex, set));
}

// ---- Random sets -----------------------------------------------------------

function pickRandom(arr, rng = Math.random) {
  return arr[Math.floor(rng() * arr.length)];
}

// A serviceable random set: up to three damaging moves (STAB preferred) plus
// one status move if the species has one, a nature that matches whichever
// attacking stat is higher, and a 252/252/4 spread on its two best stats.
export function randomSet(dex, speciesId, level, format, rng = Math.random) {
  const set = makeSet(dex, speciesId, format, level);
  const pool = legalMoves(dex, speciesId, level, format).map((id) => dex.move(id));
  const species = dex.species(speciesId);

  const damaging = pool.filter((m) => m.category !== 'status' && (m.power > 0 || m.ohko || m.fixedDamage != null));
  const status = pool.filter((m) => m.category === 'status');
  const stab = damaging.filter((m) => species.types.includes(m.type));
  const chosen = [];
  const take = (list) => {
    const options = list.filter((m) => !chosen.includes(m.id));
    if (options.length) chosen.push(pickRandom(options, rng).id);
  };
  take(stab.length ? stab : damaging);
  take(damaging);
  take(damaging);
  if (status.length && rng() < 0.7) take(status);
  else take(damaging);
  set.moves = chosen.filter(Boolean).slice(0, 4);
  if (!set.moves.length) set.moves = pool.slice(0, 4).map((m) => m.id);

  const physical = set.moves.filter((id) => dex.moves[id].category === 'physical').length;
  const special = set.moves.filter((id) => dex.moves[id].category === 'special').length;
  const offense = physical >= special ? 'attack' : 'spAttack';
  set.nature = offense === 'attack'
    ? pickRandom(['adamant', 'jolly', 'careful', 'impish'], rng)
    : pickRandom(['modest', 'timid', 'calm', 'bold'], rng);
  set.evs[offense] = 252;
  set.evs.speed = 252;
  set.evs.hp = 4;
  return set;
}

export function randomTeam(dex, size, level, format, rng = Math.random) {
  const ids = dex.order.slice();
  const team = [];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  for (const id of ids.slice(0, clamp(size, 1, TEAM_SIZE))) {
    team.push(randomSet(dex, id, level, format, rng));
  }
  return team;
}

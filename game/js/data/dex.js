// dex.js — loads + validates creatures.json, moves.json, and items.json, and
// builds live creature instances (stats computed from base stats + level,
// sprites attached). Phase 2 adds XP/leveling, learnsets, and evolutions.
// NOTE: this module consolidates the scaffold's separate creatures.js/moves.js
// loaders into one small data layer — see report for the deviation rationale.

import { makeCreatureSprite } from '../engine/assets.js';

export class Dex {
  constructor(creaturesJson, movesJson, itemsJson, machinesJson, abilitiesJson, typeChart) {
    this.creatures = creaturesJson.creatures;
    this.moves = movesJson.moves;
    this.items = itemsJson.items;
    this.machines = (machinesJson && machinesJson.machines) || {};
    this.abilities = (abilitiesJson && abilitiesJson.abilities) || {};
    this.typeChart = typeChart;
    this.order = Object.keys(this.creatures); // Pokédex numbering order
    this._spriteCache = {};
    this._validate();
  }

  _validate() {
    for (const [id, c] of Object.entries(this.creatures)) {
      if (!Array.isArray(c.types) || c.types.length < 1 || c.types.length > 2 || !c.baseStats) {
        throw new Error(`Creature ${id} needs 1-2 types and baseStats`);
      }
      for (const t of c.types) {
        if (!this.typeChart.types.includes(t)) throw new Error(`Creature ${id} has unknown type '${t}'`);
      }
      if (!Array.isArray(c.learnset) || !c.learnset.length) {
        throw new Error(`Creature ${id} missing learnset`);
      }
      for (const e of c.learnset) {
        if (!this.moves[e.move]) throw new Error(`Creature ${id} references unknown move '${e.move}'`);
      }
      if (!c.learnset.some((e) => e.level <= 1)) {
        throw new Error(`Creature ${id} has no level-1 move`);
      }
      if (Array.isArray(c.teachable)) {
        for (const m of c.teachable) {
          if (!this.moves[m]) throw new Error(`Creature ${id} teachable references unknown move '${m}'`);
        }
      }
      if (c.evolvesTo && !this.creatures[c.evolvesTo.species]) {
        throw new Error(`Creature ${id} evolves into unknown species '${c.evolvesTo.species}'`);
      }
      if (c.ability && !this.abilities[c.ability]) {
        throw new Error(`Creature ${id} has unknown ability '${c.ability}'`);
      }
    }
    for (const [mid, mc] of Object.entries(this.machines)) {
      if (!this.moves[mc.move]) throw new Error(`Machine ${mid} references unknown move '${mc.move}'`);
    }
  }

  species(id) {
    const s = this.creatures[id];
    if (!s) throw new Error(`Unknown species '${id}'`);
    return s;
  }

  starters() {
    return Object.entries(this.creatures)
      .filter(([, c]) => c.starter)
      .map(([id]) => id);
  }

  move(id) {
    return { id, ...this.moves[id] };
  }

  // A move attached to a creature instance: def + current PP (mv.pp is the max).
  instanceMove(id, curPP) {
    const def = this.move(id);
    const max = def.pp != null ? def.pp : 20;
    return { ...def, pp: max, curPP: curPP != null ? Math.max(0, Math.min(curPP, max)) : max };
  }

  item(id) {
    const it = this.items[id];
    if (!it) throw new Error(`Unknown item '${id}'`);
    return { id, ...it };
  }

  itemIds() {
    return Object.keys(this.items);
  }

  // ---- Machines (TMs / HMs) ------------------------------------------------

  machine(id) {
    const m = this.machines[id];
    if (!m) throw new Error(`Unknown machine '${id}'`);
    return { id, ...m };
  }

  machineIds() {
    return Object.keys(this.machines);
  }

  ability(id) {
    const a = this.abilities[id];
    if (!a) throw new Error(`Unknown ability '${id}'`);
    return { id, ...a };
  }

  abilityIds() {
    return Object.keys(this.abilities);
  }

  // The set of TM/HM move ids a species is allowed to learn. Explicit
  // `teachable` on the species wins; otherwise a sensible default: any machine
  // move whose type is Normal or matches one of the species' types.
  teachableMoves(speciesId) {
    const s = this.species(speciesId);
    if (Array.isArray(s.teachable)) return s.teachable.slice();
    const out = [];
    for (const mid of this.machineIds()) {
      const mv = this.moves[this.machines[mid].move];
      if (mv.type === 'Normal' || s.types.includes(mv.type)) out.push(this.machines[mid].move);
    }
    return [...new Set(out)];
  }

  // Can this species learn `moveId` from a TM/HM?
  canTeach(speciesId, moveId) {
    return this.teachableMoves(speciesId).includes(moveId);
  }

  spriteFor(speciesId) {
    if (!this._spriteCache[speciesId]) {
      const s = this.species(speciesId);
      this._spriteCache[speciesId] = makeCreatureSprite(s, this.typeChart.color(s.types[0]));
    }
    return this._spriteCache[speciesId];
  }

  // Compute a live stat block from base stats + level (simplified Gen formula).
  // Special stats fall back to their physical counterpart if a species predates
  // the special split (so older data still loads).
  computeStats(base, level) {
    const spa = base.spAttack != null ? base.spAttack : base.attack;
    const spd = base.spDefense != null ? base.spDefense : base.defense;
    return {
      hp: Math.floor((2 * base.hp * level) / 100) + level + 10,
      attack: Math.floor((2 * base.attack * level) / 100) + 5,
      defense: Math.floor((2 * base.defense * level) / 100) + 5,
      spAttack: Math.floor((2 * spa * level) / 100) + 5,
      spDefense: Math.floor((2 * spd * level) / 100) + 5,
      speed: Math.floor((2 * base.speed * level) / 100) + 5,
    };
  }

  // ---- XP curve (medium-fast: total XP for level L = L^3) ------------------

  xpTotalForLevel(level) {
    return level * level * level;
  }

  // XP yield for defeating an enemy instance (classic baseExp * level / 7).
  xpGain(enemyInst, isTrainer) {
    const base = this.species(enemyInst.species).baseExp || 50;
    const mult = isTrainer ? 1.5 : 1;
    return Math.max(1, Math.floor((base * enemyInst.level * mult) / 7));
  }

  // The last 4 moves a species knows at-or-below `level` (learnset order).
  movesAtLevel(speciesId, level) {
    const s = this.species(speciesId);
    const known = s.learnset.filter((e) => e.level <= level).map((e) => e.move);
    const dedup = [...new Set(known)];
    return dedup.slice(-4).map((m) => this.instanceMove(m));
  }

  // Apply XP to an instance, leveling up as needed. Returns an ordered event
  // list for the battle log:
  //   {type:'level', level}      — leveled up (stats already recalculated)
  //   {type:'learned', move}     — auto-learned into a free slot
  //   {type:'wantsLearn', move}  — knows 4 moves; caller must prompt to forget
  addXP(inst, amount) {
    const events = [];
    inst.xp += amount;
    while (inst.level < 100 && inst.xp >= this.xpTotalForLevel(inst.level + 1)) {
      inst.level++;
      const oldMax = inst.maxHP;
      inst.stats = this.computeStats(this.species(inst.species).baseStats, inst.level);
      inst.maxHP = inst.stats.hp;
      inst.curHP = Math.min(inst.maxHP, inst.curHP + (inst.maxHP - oldMax));
      events.push({ type: 'level', level: inst.level });
      for (const e of this.species(inst.species).learnset) {
        if (e.level !== inst.level) continue;
        if (inst.moves.some((m) => m.id === e.move)) continue;
        if (inst.moves.length < 4) {
          inst.moves.push(this.instanceMove(e.move));
          events.push({ type: 'learned', move: e.move });
        } else {
          events.push({ type: 'wantsLearn', move: e.move });
        }
      }
    }
    return events;
  }

  // ---- Evolution -----------------------------------------------------------

  // Species id this instance should evolve into right now, or null.
  evolutionFor(inst) {
    const ev = this.species(inst.species).evolvesTo;
    return ev && inst.level >= ev.level ? ev.species : null;
  }

  // Evolve an instance in place: swap species/name/type/sprite, recalc stats
  // (curHP gains the max-HP delta, classic style). Moves are kept.
  evolveMember(inst) {
    const to = this.species(inst.species).evolvesTo.species;
    const s = this.species(to);
    const oldMax = inst.maxHP;
    inst.species = to;
    inst.name = s.name;
    inst.types = s.types.slice();
    inst.ability = s.ability || null;
    inst.stats = this.computeStats(s.baseStats, inst.level);
    inst.maxHP = inst.stats.hp;
    inst.curHP = Math.min(inst.maxHP, Math.max(1, inst.curHP + (inst.maxHP - oldMax)));
    inst.sprite = this.spriteFor(to);
    return inst;
  }

  // ---- Instances -----------------------------------------------------------

  // Build a battle-ready creature instance.
  // opts: curHP (restore), xp (restore), moves (restore: array of move ids or
  // {id, pp} objects from a save), status/statusCounter (restore).
  makeInstance(speciesId, level, opts = {}) {
    const s = this.species(speciesId);
    const stats = this.computeStats(s.baseStats, level);
    const moves =
      Array.isArray(opts.moves) && opts.moves.length
        ? opts.moves
            .map((m) => (typeof m === 'string' ? { id: m, pp: null } : m))
            .filter((m) => this.moves[m.id])
            .map((m) => this.instanceMove(m.id, m.pp))
        : this.movesAtLevel(speciesId, level);
    return {
      species: speciesId,
      name: s.name,
      types: s.types.slice(),
      ability: s.ability || null,
      level,
      xp: opts.xp != null ? opts.xp : this.xpTotalForLevel(level),
      stats,
      maxHP: stats.hp,
      curHP: opts.curHP != null ? Math.max(0, Math.min(opts.curHP, stats.hp)) : stats.hp,
      // Non-volatile status persists in and out of battle (cured by a full heal).
      status: opts.status || null,
      statusCounter: opts.statusCounter || 0,
      moves: moves.length ? moves : [this.instanceMove(s.learnset[0].move)],
      sprite: this.spriteFor(speciesId),
    };
  }

  // Serialize a party member to the minimal saved form.
  serializeMember(inst) {
    return {
      species: inst.species,
      level: inst.level,
      xp: inst.xp,
      curHP: inst.curHP,
      moves: inst.moves.map((m) => ({ id: m.id, pp: m.curPP })),
      status: inst.status || null,
      statusCounter: inst.statusCounter || 0,
    };
  }

  // Rehydrate from saved form (older saves lack xp/moves/status; defaults cover them).
  deserializeMember(saved) {
    return this.makeInstance(saved.species, saved.level, {
      curHP: saved.curHP,
      xp: saved.xp,
      moves: saved.moves,
      status: saved.status,
      statusCounter: saved.statusCounter,
    });
  }
}

// The creature editor (/game/editor.html) can store a full creatures.json
// override in localStorage; when present it takes precedence over the file so
// edits are playable immediately without touching the repo.
export const CREATURES_OVERRIDE_KEY = 'jg_creature_game_creatures_override';

async function loadCreaturesJson() {
  try {
    const raw = localStorage.getItem(CREATURES_OVERRIDE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.creatures) return parsed;
    }
  } catch {
    /* corrupt override — fall through to the file */
  }
  const res = await fetch('data/creatures.json');
  if (!res.ok) throw new Error('Failed to load creatures.json');
  return res.json();
}

export async function loadDex(typeChart) {
  const [creatures, mRes, iRes, machRes, abRes] = await Promise.all([
    loadCreaturesJson(),
    fetch('data/moves.json'),
    fetch('data/items.json'),
    fetch('data/machines.json'),
    fetch('data/abilities.json'),
  ]);
  if (!mRes.ok) throw new Error('Failed to load moves.json');
  if (!iRes.ok) throw new Error('Failed to load items.json');
  if (!machRes.ok) throw new Error('Failed to load machines.json');
  if (!abRes.ok) throw new Error('Failed to load abilities.json');
  return new Dex(creatures, await mRes.json(), await iRes.json(), await machRes.json(), await abRes.json(), typeChart);
}

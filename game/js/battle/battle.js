// battle.js — turn-based battle logic for wild AND trainer battles.
//
// Phase 3: physical/special split, non-volatile statuses, abilities.
// Phase 4: PP + Struggle, critical hits, stat stages (±6, real multipliers),
//          volatile statuses (confusion, flinch), move priority, manual
//          switching (consumes the turn), and damage-aware enemy AI.
//
// resolveTurn() mutates battle state and returns ordered "beats" the scene
// plays back: msg / damage / faint / xp / switch / caught / fled. Damage beats
// carry `eff` (type multiplier) so the scene can flavor the presentation.
//
// Battle-scoped volatile state (stat stages, confusion, flinch) lives in
// battle.vol per side and resets whenever that side's active creature changes.

export const STATUS_INFO = {
  burn:      { abbr: 'BRN', noun: 'burn' },
  poison:    { abbr: 'PSN', noun: 'poison' },
  toxic:     { abbr: 'TOX', noun: 'bad poison' },
  paralysis: { abbr: 'PAR', noun: 'paralysis' },
  sleep:     { abbr: 'SLP', noun: 'sleep' },
  freeze:    { abbr: 'FRZ', noun: 'freeze' },
};

export const STRUGGLE = {
  id: '__struggle', name: 'Struggle', type: 'Normal', category: 'physical',
  power: 50, accuracy: 100, pp: 1, struggle: true,
};

const STAGE_STATS = ['attack', 'defense', 'spAttack', 'spDefense', 'speed', 'accuracy', 'evasion'];
const STAT_LABEL = {
  attack: 'Attack', defense: 'Defense', spAttack: 'Sp. Atk', spDefense: 'Sp. Def',
  speed: 'Speed', accuracy: 'accuracy', evasion: 'evasiveness',
};

function mkVol() {
  const stages = {};
  for (const s of STAGE_STATS) stages[s] = 0;
  return { stages, confusion: 0, flinch: false, protecting: false, protectStreak: 0, trapped: false };
}

export function createBattle(playerParty, enemyParty, opts = {}) {
  let playerIndex = playerParty.findIndex((m) => m.curHP > 0);
  if (playerIndex < 0) playerIndex = 0;
  return {
    mode: opts.mode || 'wild', // 'wild' | 'trainer'
    trainerName: opts.trainerName || null,
    playerParty,
    enemyParty,
    playerIndex,
    enemyIndex: 0,
    vol: { player: mkVol(), enemy: mkVol() },
    // Entry hazards live on the field itself, not per-creature, so they
    // persist across switches on that side for the rest of the battle.
    hazards: { player: 0, enemy: 0 },
    over: false,
    outcome: null, // 'win' | 'lose' | 'caught' | 'fled'
  };
}

export function activePlayer(battle) {
  return battle.playerParty[battle.playerIndex];
}

export function activeEnemy(battle) {
  return battle.enemyParty[battle.enemyIndex];
}

// ---- Stage math ------------------------------------------------------------

// Regular stats: x2/2, x3/2 ... ; negative: x2/3, x2/4 ...
function stageMult(n) {
  return n >= 0 ? (2 + n) / 2 : 2 / (2 - n);
}
// Accuracy/evasion use the 3-based table.
function accStageMult(n) {
  return n >= 0 ? (3 + n) / 3 : 3 / (3 - n);
}
function clampStage(n) {
  return Math.max(-6, Math.min(6, n));
}

// ---- Abilities -------------------------------------------------------------

function abilityOf(inst, ctx) {
  if (!inst.ability || !ctx.dex) return null;
  try {
    return ctx.dex.ability(inst.ability);
  } catch {
    return null;
  }
}

// ---- Status ----------------------------------------------------------------

function typeImmuneToStatus(inst, status) {
  const t = inst.types || [];
  if (status === 'burn') return t.includes('Fire');
  if (status === 'freeze') return t.includes('Ice');
  if (status === 'paralysis') return t.includes('Electric');
  if (status === 'poison' || status === 'toxic') return t.includes('Poison') || t.includes('Steel');
  return false;
}

function statusInflictedMsg(inst, status) {
  switch (status) {
    case 'burn': return `${inst.name} was burned!`;
    case 'poison': return `${inst.name} was poisoned!`;
    case 'toxic': return `${inst.name} was badly poisoned!`;
    case 'paralysis': return `${inst.name} is paralyzed! It may be unable to move!`;
    case 'sleep': return `${inst.name} fell asleep!`;
    case 'freeze': return `${inst.name} was frozen solid!`;
    default: return '';
  }
}

function applyStatus(target, status, ctx, beats, announceBlocked) {
  if (!status) return false;
  if (target.curHP <= 0) return false;
  if (target.status) {
    if (announceBlocked) beats.push({ type: 'msg', text: `${target.name} already has a status condition.` });
    return false;
  }
  const ab = abilityOf(target, ctx);
  if (ab && ab.kind === 'status_immunity' &&
      (ab.status === status || (ab.status === 'poison' && status === 'toxic'))) {
    beats.push({ type: 'msg', text: `${target.name}'s ${ab.name} prevents the ${STATUS_INFO[status].noun}!` });
    return false;
  }
  if (typeImmuneToStatus(target, status)) {
    if (announceBlocked) beats.push({ type: 'msg', text: "It doesn't affect this creature..." });
    return false;
  }
  target.status = status;
  if (status === 'sleep') target.statusCounter = 1 + Math.floor(Math.random() * 3); // 1-3 turns
  else if (status === 'toxic') target.statusCounter = 1;
  else target.statusCounter = 0;
  beats.push({ type: 'msg', text: statusInflictedMsg(target, status) });
  return true;
}

// ---- Volatile effects ------------------------------------------------------

function applyVolatile(battle, target, side, volatileKind, beats, announceBlocked) {
  const vol = battle.vol[side];
  if (target.curHP <= 0) return false;
  if (volatileKind === 'confusion') {
    if (vol.confusion > 0) {
      if (announceBlocked) beats.push({ type: 'msg', text: `${target.name} is already confused!` });
      return false;
    }
    // Counter counts down on each action attempt; snapping out happens when it
    // hits 0, so 2-5 here yields the mainline 1-4 turns of actually-confused.
    vol.confusion = 2 + Math.floor(Math.random() * 4);
    beats.push({ type: 'msg', text: `${target.name} became confused!` });
    return true;
  }
  if (volatileKind === 'flinch') {
    // Only matters if the target hasn't moved yet this turn; cleared each turn.
    vol.flinch = true;
    return true;
  }
  return false;
}

// Self-heal (Recover/Rest-style moves). effect.heal is a fraction of max HP
// (1 = fully heal). A move that also carries a status (e.g. Rest) clears
// whatever status the target already had first, so the new one can land.
// Returns true if the heal (and thus any status riding along with it, e.g.
// Rest's sleep) actually took effect.
function applyHeal(target, side, effect, beats) {
  if (target.curHP <= 0) return false;
  if (target.curHP >= target.maxHP) {
    beats.push({ type: 'msg', text: `${target.name}'s HP is already full!` });
    return false;
  }
  if (effect.status) {
    target.status = null;
    target.statusCounter = 0;
  }
  const from = target.curHP;
  target.curHP = Math.min(target.maxHP, target.curHP + Math.floor(target.maxHP * effect.heal));
  beats.push({ type: 'damage', target: side, from, to: target.curHP, eff: 1 });
  beats.push({ type: 'msg', text: `${target.name} regained health!` });
  return true;
}

function applyStages(target, side, battle, stages, beats) {
  const vol = battle.vol[side];
  for (const [stat, delta] of Object.entries(stages)) {
    if (!STAGE_STATS.includes(stat) || !delta) continue;
    const cur = vol.stages[stat];
    const next = clampStage(cur + delta);
    const label = STAT_LABEL[stat];
    if (next === cur) {
      beats.push({ type: 'msg', text: `${target.name}'s ${label} won't go any ${delta > 0 ? 'higher' : 'lower'}!` });
      continue;
    }
    vol.stages[stat] = next;
    const size = Math.abs(next - cur);
    const verb = delta > 0 ? (size >= 2 ? 'rose sharply!' : 'rose!') : (size >= 2 ? 'fell sharply!' : 'fell!');
    beats.push({ type: 'msg', text: `${target.name}'s ${label} ${verb}` });
  }
}

// Cures every party member's non-volatile status (Heal Bell-style), not just
// the active one — status lives on each instance and persists whether or not
// that member is currently out, so this just sweeps the whole array.
function applyCureParty(battle, side, move, beats) {
  const party = side === 'player' ? battle.playerParty : battle.enemyParty;
  let curedAny = false;
  for (const member of party) {
    if (member.status) {
      member.status = null;
      member.statusCounter = 0;
      curedAny = true;
    }
  }
  beats.push({ type: 'msg', text: curedAny ? `${move.name} rings out, curing the whole party's status!` : 'But nothing happened.' });
}

// Pain Split: pools both sides' current HP and splits it evenly, each side
// capped at its own max HP (so it can't overflow onto the other side, and —
// since both HP totals are always >= 1 while a creature is active — it can
// never bring either side down to 0).
function applyPainSplit(attacker, atkSide, defender, defSide, beats) {
  const share = Math.max(1, Math.floor((attacker.curHP + defender.curHP) / 2));
  const newAtkHP = Math.min(attacker.maxHP, share);
  const newDefHP = Math.min(defender.maxHP, share);
  const atkFrom = attacker.curHP;
  const defFrom = defender.curHP;
  attacker.curHP = newAtkHP;
  defender.curHP = newDefHP;
  beats.push({ type: 'msg', text: "The combined HP was split evenly between them!" });
  if (newAtkHP !== atkFrom) beats.push({ type: 'damage', target: atkSide, from: atkFrom, to: newAtkHP, eff: 1 });
  if (newDefHP !== defFrom) beats.push({ type: 'damage', target: defSide, from: defFrom, to: newDefHP, eff: 1 });
}

// Trapping (Mean Look/Spider Web-style): the target's side can't switch or
// flee until that creature leaves the field. It's stored on battle.vol, so
// mkVol() naturally clears it the moment that side's active creature changes
// (faint or switch) — matching the mainline rule that trapping only lasts as
// long as the trapped creature itself stays out.
function applyTrap(target, side, battle, beats) {
  if (target.curHP <= 0) return;
  const vol = battle.vol[side];
  if (vol.trapped) {
    beats.push({ type: 'msg', text: `${target.name} is already unable to escape!` });
    return;
  }
  vol.trapped = true;
  beats.push({ type: 'msg', text: `${target.name} can no longer escape!` });
}

// Entry hazards (Spikes-style): live on the field itself rather than a
// creature, so they hit whoever switches in on that side later — see
// applyHazardDamage, called from every switch-in point. Stacks to 3 layers;
// Flying-types are immune, same as the mainline games.
function applyHazard(battle, side, kind, beats) {
  if (kind !== 'spikes') return;
  const cur = battle.hazards[side] || 0;
  if (cur >= 3) {
    beats.push({ type: 'msg', text: 'But it failed!' });
    return;
  }
  battle.hazards[side] = cur + 1;
  beats.push({ type: 'msg', text: 'Spikes were scattered on the ground!' });
}

// Shared handler for a move's effect payload on its target.
function applyMoveEffect(battle, move, attacker, atkSide, defender, defSide, ctx, beats, guaranteed) {
  const effect = move.effect;
  if (!effect) return;
  const chance = effect.chance != null ? effect.chance : 100;
  if (!guaranteed && Math.random() * 100 >= chance) return;
  if (effect.painSplit) {
    applyPainSplit(attacker, atkSide, defender, defSide, beats);
    return;
  }
  const targetSelf = effect.target === 'self';
  const target = targetSelf ? attacker : defender;
  const side = targetSelf ? atkSide : defSide;
  const healOk = effect.heal ? applyHeal(target, side, effect, beats) : true;
  if (effect.status && healOk) applyStatus(target, effect.status, ctx, beats, guaranteed);
  if (effect.volatile) applyVolatile(battle, target, side, effect.volatile, beats, guaranteed);
  if (effect.stages) applyStages(target, side, battle, effect.stages, beats);
  if (effect.cureParty) applyCureParty(battle, side, move, beats);
  if (effect.trap) applyTrap(target, side, battle, beats);
  if (effect.hazard) applyHazard(battle, side, effect.hazard, beats);
}

// ---- Effective stats -------------------------------------------------------

function effSpeed(battle, inst, side) {
  let s = Math.floor(inst.stats.speed * stageMult(battle.vol[side].stages.speed));
  if (inst.status === 'paralysis') s = Math.floor(s / 2);
  return s;
}

function attackStat(battle, attacker, atkSide, move, ctx) {
  const special = move.category === 'special';
  const key = special ? 'spAttack' : 'attack';
  let stat = Math.floor(attacker.stats[key] * stageMult(battle.vol[atkSide].stages[key]));
  const ab = abilityOf(attacker, ctx);
  if (ab && ab.kind === 'guts' && attacker.status) {
    stat = Math.floor(stat * 1.5); // Guts: boost, and ignore burn's drop
  } else if (!special && attacker.status === 'burn') {
    stat = Math.floor(stat * 0.5);
  }
  return Math.max(1, stat);
}

function defenseStat(battle, defender, defSide, move) {
  const key = move.category === 'special' ? 'spDefense' : 'defense';
  return Math.max(1, Math.floor(defender.stats[key] * stageMult(battle.vol[defSide].stages[key])));
}

// ---- Damage ----------------------------------------------------------------

function calcDamage(battle, attacker, atkSide, defender, defSide, move, ctx) {
  const mult = ctx.typeChart.multiplier(move.type, defender.types);
  if (mult === 0) return { dmg: 0, mult: 0, crit: false };
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const atk = attackStat(battle, attacker, atkSide, move, ctx);
  const def = defenseStat(battle, defender, defSide, move);
  const level = attacker.level;
  const base =
    Math.floor((Math.floor(((2 * level) / 5 + 2) * move.power * atk) / def) / 50) + 2;
  const rand = 0.85 + Math.random() * 0.15;
  const crit = Math.random() < 1 / 16;
  let abilityMult = 1;
  const ab = abilityOf(attacker, ctx);
  if (ab && ab.kind === 'pinch_boost' && move.type === ab.moveType && attacker.curHP <= attacker.maxHP / 3) {
    abilityMult = ab.factor;
  }
  const dmg = Math.max(1, Math.floor(base * mult * stab * rand * abilityMult * (crit ? 1.5 : 1)));
  return { dmg, mult, crit };
}

function effectivenessLine(mult) {
  if (mult === 0) return "It had no effect...";
  if (mult >= 2) return "It's super effective!";
  if (mult > 0 && mult < 1) return "It's not very effective...";
  return null;
}

// Deal damage to `target` on `side` with faint handling deferred to caller.
function dealDamage(target, side, amount, beats, eff = 1) {
  const from = target.curHP;
  target.curHP = Math.max(0, target.curHP - amount);
  beats.push({ type: 'damage', target: side, from, to: target.curHP, eff });
  if (target.curHP <= 0) {
    beats.push({ type: 'msg', text: `${target.name} fainted!` });
    beats.push({ type: 'faint', target: side });
    return true;
  }
  return false;
}

// Multi-hit moves (move.multiHit = [minHits, maxHits]) roll their hit count
// once up front — fixed count when min === max (e.g. Twineedle-style 2-hit
// moves) — then re-roll damage/crit per hit against the same defender.
// Mirrors the mainline 2/3/4/5-hit odds (37.5/37.5/12.5/12.5%).
function rollMultiHitCount() {
  const r = Math.random() * 100;
  if (r < 37.5) return 2;
  if (r < 75) return 3;
  if (r < 87.5) return 4;
  return 5;
}

// Runs a multi-hit move's full hit sequence, stopping early if the defender
// faints or turns out to be immune. The secondary effect (if any) and the
// "Hit N times!" + effectiveness summary are left to the caller — this just
// deals the damage and reports back how many hits actually landed.
function performMultiHit(battle, attacker, atkSide, defender, defSide, move, ctx, defAb, beats) {
  const [minHits, maxHits] = move.multiHit;
  const hitCount = minHits === maxHits ? minHits : rollMultiHitCount();
  let hits = 0;
  let lastMult = 1;
  let sturdyTriggered = false;
  let defenderFainted = false;
  for (let i = 0; i < hitCount; i++) {
    if (defender.curHP <= 0) break;
    const { dmg, mult, crit } = calcDamage(battle, attacker, atkSide, defender, defSide, move, ctx);
    if (mult === 0) {
      if (hits === 0) beats.push({ type: 'msg', text: "It had no effect..." });
      break;
    }
    lastMult = mult;
    let finalDmg = dmg;
    if (defAb && defAb.kind === 'sturdy' && defender.curHP === defender.maxHP && dmg >= defender.curHP) {
      finalDmg = defender.curHP - 1;
      sturdyTriggered = true;
    }
    hits += 1;
    defenderFainted = dealDamage(defender, defSide, finalDmg, beats, mult);
    if (crit) beats.push({ type: 'msg', text: 'A critical hit!' });
    if (defenderFainted) break;
  }
  if (hits > 0) {
    beats.push({ type: 'msg', text: `Hit ${hits} time${hits === 1 ? '' : 's'}!` });
    const eff = effectivenessLine(lastMult);
    if (eff) beats.push({ type: 'msg', text: eff });
  }
  if (sturdyTriggered) beats.push({ type: 'msg', text: `${defender.name} held on with Sturdy!` });
  return { defenderFainted, hits };
}

// One creature using one move on another. Returns true if the DEFENDER fainted.
// (Attacker self-KO from Struggle recoil is handled via the returned object.)
function performMove(battle, attacker, atkSide, defender, defSide, move, ctx, beats) {
  beats.push({ type: 'msg', text: `${attacker.name} used ${move.name}!`, actor: atkSide });

  const isDamaging = move.category !== 'status' && move.power > 0;

  // Protect/Detect: blocks anything that would actually reach the defender
  // (damage, or a status effect aimed at the foe). A self-targeted buff never
  // touches the defender anyway, so it's untouched by this check. Hazards
  // target the field, not the defending creature, so — same as mainline —
  // they go through even against a protecting target.
  const targetsDefender = isDamaging || (move.effect && move.effect.target !== 'self' && !move.effect.hazard);
  if (targetsDefender && battle.vol[defSide].protecting) {
    beats.push({ type: 'msg', text: `${defender.name} protected itself!` });
    return { defenderFainted: false, attackerFainted: false };
  }

  const defAb = abilityOf(defender, ctx);

  if (isDamaging && defAb && defAb.kind === 'type_immunity' && move.type === defAb.type) {
    beats.push({ type: 'msg', text: `${defender.name}'s ${defAb.name} makes it immune!` });
    return { defenderFainted: false, attackerFainted: false };
  }

  // Accuracy (self-targeted moves never miss; stages modify the roll).
  const selfTarget = move.effect && move.effect.target === 'self';
  if (!selfTarget) {
    const acc = move.accuracy != null ? move.accuracy : 100;
    const stageB = clampStage(battle.vol[atkSide].stages.accuracy - battle.vol[defSide].stages.evasion);
    if (Math.random() * 100 >= acc * accStageMult(stageB)) {
      beats.push({ type: 'msg', text: `${attacker.name}'s attack missed!` });
      return { defenderFainted: false, attackerFainted: false };
    }
  }

  if (!isDamaging) {
    if (move.effect) {
      applyMoveEffect(battle, move, attacker, atkSide, defender, defSide, ctx, beats, true);
    } else {
      beats.push({ type: 'msg', text: 'But nothing happened.' });
    }
    return { defenderFainted: false, attackerFainted: false };
  }

  let defenderFainted;
  let finalDmg = 0; // only meaningful for the single-hit path (Struggle recoil below)

  if (move.multiHit) {
    const result = performMultiHit(battle, attacker, atkSide, defender, defSide, move, ctx, defAb, beats);
    if (result.hits === 0) return { defenderFainted: false, attackerFainted: false };
    defenderFainted = result.defenderFainted;
  } else {
    const { dmg, mult, crit } = calcDamage(battle, attacker, atkSide, defender, defSide, move, ctx);
    if (mult === 0) {
      beats.push({ type: 'msg', text: "It had no effect..." });
      return { defenderFainted: false, attackerFainted: false };
    }

    // Sturdy: survive a full-HP one-hit KO with 1 HP.
    let sturdy = false;
    finalDmg = dmg;
    if (defAb && defAb.kind === 'sturdy' && defender.curHP === defender.maxHP && dmg >= defender.curHP) {
      finalDmg = defender.curHP - 1;
      sturdy = true;
    }

    defenderFainted = dealDamage(defender, defSide, finalDmg, beats, mult);
    if (crit) beats.push({ type: 'msg', text: 'A critical hit!' });
    const eff = effectivenessLine(mult);
    if (eff) beats.push({ type: 'msg', text: eff });
    if (sturdy) beats.push({ type: 'msg', text: `${defender.name} held on with Sturdy!` });
  }

  let attackerFainted = false;

  if (!defenderFainted && move.effect) {
    applyMoveEffect(battle, move, attacker, atkSide, defender, defSide, ctx, beats, false);
  }

  // Contact ability: a physical hit may status the attacker.
  if (move.category === 'physical' && defAb && defAb.kind === 'contact_status' && attacker.curHP > 0) {
    if (Math.random() * 100 < (defAb.chance || 0)) applyStatus(attacker, defAb.status, ctx, beats, false);
  }

  // Struggle recoil: Gen 1's original formula — 1/4 of the damage just dealt
  // (not 1/4 of max HP, which is the Gen 5+ rule).
  if (move.struggle && attacker.curHP > 0) {
    beats.push({ type: 'msg', text: `${attacker.name} is hit with recoil!` });
    attackerFainted = dealDamage(attacker, atkSide, Math.max(1, Math.floor(finalDmg / 4)), beats);
  }

  return { defenderFainted, attackerFainted };
}

// ---- Enemy AI --------------------------------------------------------------

function usableMoves(inst) {
  return inst.moves.filter((m) => (m.curPP != null ? m.curPP : 1) > 0);
}

// Prefer the highest expected damage; status moves score situationally.
// 15% of the time picks randomly among usable moves so battles stay varied.
function enemyChooseMove(battle, ctx) {
  const enemy = activeEnemy(battle);
  const player = activePlayer(battle);
  const usable = usableMoves(enemy);
  if (!usable.length) return STRUGGLE;
  if (Math.random() < 0.15) return usable[Math.floor(Math.random() * usable.length)];

  let best = usable[0];
  let bestScore = -1;
  for (const mv of usable) {
    let score;
    if (mv.category !== 'status' && mv.power > 0) {
      const mult = ctx.typeChart.multiplier(mv.type, player.types);
      const stab = enemy.types.includes(mv.type) ? 1.5 : 1;
      // Multi-hit moves deal their power per hit; score the expected total
      // (fixed hit count, or the mainline 2/3/4/5-hit average of 3.166).
      const avgHits = mv.multiHit ? (mv.multiHit[0] === mv.multiHit[1] ? mv.multiHit[0] : 3.166) : 1;
      score = mv.power * avgHits * mult * stab * ((mv.accuracy != null ? mv.accuracy : 100) / 100);
    } else if (mv.effect && mv.effect.status) {
      score = player.status ? 0 : 55; // roughly a mid-power hit, useless if already statused
    } else if (mv.effect && mv.effect.stages) {
      const vol = battle.vol[mv.effect.target === 'self' ? 'enemy' : 'player'];
      const already = Object.keys(mv.effect.stages).every((s) => Math.abs(vol.stages[s]) >= 4);
      score = already ? 0 : 35;
    } else {
      score = 10;
    }
    if (score > bestScore) { bestScore = score; best = mv; }
  }
  return best;
}

function spendPP(move) {
  if (move.struggle) return;
  if (move.curPP != null) move.curPP = Math.max(0, move.curPP - 1);
}

function catchChance(enemy, catchMod = 1) {
  const p = (3 * enemy.maxHP - 2 * enemy.curHP) / (3 * enemy.maxHP);
  const statusBonus = enemy.status === 'sleep' || enemy.status === 'freeze' ? 2 : enemy.status ? 1.5 : 1;
  return Math.min(0.95, p * 0.85 * catchMod * statusBonus);
}

// ---- Faint handling --------------------------------------------------------

// Entry-hazard damage on switch-in. Lives here (rather than inlined at every
// switch site) so it applies uniformly to manual switches AND forced
// switches after a faint — and, via the mutual recursion with
// handleEnemyFaint/handlePlayerFaint below, correctly chains if the hazard
// itself KOs the incoming creature.
function applyHazardDamage(battle, side, ctx, beats) {
  const layers = battle.hazards[side];
  if (!layers) return;
  const inst = side === 'player' ? activePlayer(battle) : activeEnemy(battle);
  if (inst.types.includes('Flying')) return;
  const frac = layers === 1 ? 8 : layers === 2 ? 6 : 4; // 1/8, 1/6, 1/4 max HP
  const dmg = Math.max(1, Math.floor(inst.maxHP / frac));
  beats.push({ type: 'msg', text: `${inst.name} is hurt by the spikes!` });
  const fainted = dealDamage(inst, side, dmg, beats);
  if (fainted) {
    if (side === 'enemy') handleEnemyFaint(battle, ctx, beats);
    else handlePlayerFaint(battle, ctx, beats);
  }
}

function handleEnemyFaint(battle, ctx, beats) {
  const enemy = activeEnemy(battle);
  beats.push({ type: 'xp', amount: ctx.dex.xpGain(enemy, battle.mode === 'trainer') });
  const nextIdx = battle.enemyParty.findIndex((m) => m.curHP > 0);
  if (battle.mode === 'trainer' && nextIdx !== -1) {
    battle.enemyIndex = nextIdx;
    battle.vol.enemy = mkVol();
    const next = battle.enemyParty[nextIdx];
    beats.push({ type: 'switch', side: 'enemy', index: nextIdx });
    beats.push({ type: 'msg', text: `${battle.trainerName} sent out ${next.name}!` });
    applyHazardDamage(battle, 'enemy', ctx, beats);
    return;
  }
  battle.over = true;
  battle.outcome = 'win';
}

function handlePlayerFaint(battle, ctx, beats) {
  const nextIdx = battle.playerParty.findIndex((m) => m.curHP > 0);
  if (nextIdx !== -1) {
    battle.playerIndex = nextIdx;
    battle.vol.player = mkVol();
    const next = battle.playerParty[nextIdx];
    beats.push({ type: 'switch', side: 'player', index: nextIdx });
    beats.push({ type: 'msg', text: `Go, ${next.name}!` });
    applyHazardDamage(battle, 'player', ctx, beats);
    return;
  }
  battle.over = true;
  battle.outcome = 'lose';
}

function handleFaints(battle, ctx, beats, result, atkSide, defSide) {
  if (result.defenderFainted) {
    if (defSide === 'enemy') handleEnemyFaint(battle, ctx, beats);
    else handlePlayerFaint(battle, ctx, beats);
  }
  if (result.attackerFainted && !battle.over) {
    if (atkSide === 'enemy') handleEnemyFaint(battle, ctx, beats);
    else handlePlayerFaint(battle, ctx, beats);
  }
}

// ---- Acting gate (status + volatiles) --------------------------------------

// Order: freeze/sleep -> flinch -> confusion (may self-hit) -> paralysis.
// Returns true if the creature acts this turn.
function canAct(battle, actor, side, ctx, beats) {
  const vol = battle.vol[side];

  if (actor.status === 'freeze') {
    if (Math.random() < 0.2) {
      actor.status = null;
      beats.push({ type: 'msg', text: `${actor.name} thawed out!` });
    } else {
      beats.push({ type: 'msg', text: `${actor.name} is frozen solid!` });
      return false;
    }
  } else if (actor.status === 'sleep') {
    actor.statusCounter -= 1;
    if (actor.statusCounter <= 0) {
      actor.status = null;
      actor.statusCounter = 0;
      beats.push({ type: 'msg', text: `${actor.name} woke up!` });
    } else {
      beats.push({ type: 'msg', text: `${actor.name} is fast asleep.` });
      return false;
    }
  }

  if (vol.flinch) {
    beats.push({ type: 'msg', text: `${actor.name} flinched and couldn't move!` });
    return false;
  }

  if (vol.confusion > 0) {
    vol.confusion -= 1;
    if (vol.confusion <= 0) {
      beats.push({ type: 'msg', text: `${actor.name} snapped out of confusion!` });
    } else {
      beats.push({ type: 'msg', text: `${actor.name} is confused!` });
      if (Math.random() < 0.5) {
        beats.push({ type: 'msg', text: 'It hurt itself in its confusion!' });
        // 40-power typeless physical self-hit (own Attack vs own Defense).
        const atk = Math.max(1, Math.floor(actor.stats.attack * stageMult(vol.stages.attack)));
        const def = Math.max(1, Math.floor(actor.stats.defense * stageMult(vol.stages.defense)));
        const base = Math.floor((Math.floor(((2 * actor.level) / 5 + 2) * 40 * atk) / def) / 50) + 2;
        const dmg = Math.max(1, Math.floor(base * (0.85 + Math.random() * 0.15)));
        const fainted = dealDamage(actor, side, dmg, beats);
        if (fainted) {
          if (side === 'enemy') handleEnemyFaint(battle, ctx, beats);
          else handlePlayerFaint(battle, ctx, beats);
        }
        return false;
      }
    }
  }

  if (actor.status === 'paralysis' && Math.random() < 0.25) {
    beats.push({ type: 'msg', text: `${actor.name} is paralyzed! It can't move!` });
    return false;
  }
  return true;
}

// Protect/Detect: success chance shrinks with each consecutive use (100%,
// 33%, 11%, ...), same shape as the mainline games, so it can't be spammed
// as a free block every turn. Any other move resets the streak (see below).
function handleProtect(battle, atk, atkSide, move, beats) {
  const vol = battle.vol[atkSide];
  const streak = vol.protectStreak || 0;
  const chance = Math.pow(1 / 3, streak);
  beats.push({ type: 'msg', text: `${atk.name} used ${move.name}!`, actor: atkSide });
  if (Math.random() < chance) {
    vol.protecting = true;
    vol.protectStreak = streak + 1;
    beats.push({ type: 'msg', text: `${atk.name} protected itself!` });
  } else {
    vol.protectStreak = 0;
    beats.push({ type: 'msg', text: 'But it failed!' });
  }
}

// Perform one side's action with the pre-move gate + faint handling.
function actorMove(battle, atk, atkSide, move, ctx, beats) {
  if (battle.over || atk.curHP <= 0) return;
  if (!canAct(battle, atk, atkSide, ctx, beats)) return;
  const defSide = atkSide === 'player' ? 'enemy' : 'player';
  const def = defSide === 'enemy' ? activeEnemy(battle) : activePlayer(battle);
  spendPP(move);
  if (move.protect) {
    handleProtect(battle, atk, atkSide, move, beats);
    return;
  }
  battle.vol[atkSide].protectStreak = 0;
  const result = performMove(battle, atk, atkSide, def, defSide, move, ctx, beats);
  handleFaints(battle, ctx, beats, result, atkSide, defSide);
}

function enemyTurn(battle, ctx, beats) {
  if (battle.over) return;
  actorMove(battle, activeEnemy(battle), 'enemy', enemyChooseMove(battle, ctx), ctx, beats);
}

// ---- End of turn -----------------------------------------------------------

function residualDamage(inst) {
  if (inst.status === 'burn') return Math.max(1, Math.floor(inst.maxHP / 16));
  if (inst.status === 'poison') return Math.max(1, Math.floor(inst.maxHP / 8));
  if (inst.status === 'toxic') return Math.max(1, Math.floor((inst.maxHP * inst.statusCounter) / 16));
  return 0;
}

function applyResidual(battle, inst, side, ctx, beats) {
  if (inst.curHP <= 0 || !inst.status) return;
  const dmg = residualDamage(inst);
  if (dmg <= 0) return;
  const label = inst.status === 'burn' ? 'burn' : 'poison';
  beats.push({ type: 'msg', text: `${inst.name} is hurt by its ${label}!` });
  const fainted = dealDamage(inst, side, dmg, beats);
  if (inst.status === 'toxic') inst.statusCounter += 1;
  if (fainted) {
    if (side === 'enemy') handleEnemyFaint(battle, ctx, beats);
    else handlePlayerFaint(battle, ctx, beats);
  }
}

function endOfTurn(battle, ctx, beats) {
  battle.vol.player.flinch = false;
  battle.vol.enemy.flinch = false;
  battle.vol.player.protecting = false;
  battle.vol.enemy.protecting = false;
  if (battle.over) return;
  const order = effSpeed(battle, activePlayer(battle), 'player') >= effSpeed(battle, activeEnemy(battle), 'enemy')
    ? ['player', 'enemy'] : ['enemy', 'player'];
  for (const side of order) {
    if (battle.over) break;
    const inst = side === 'player' ? activePlayer(battle) : activeEnemy(battle);
    applyResidual(battle, inst, side, ctx, beats);
  }
}

// ---- Turn resolution -------------------------------------------------------

// action: { type:'move', moveId }   ('__struggle' forces Struggle)
//       | { type:'switch', index }  (manual switch; consumes the turn)
//       | { type:'item', item }
//       | { type:'flee' }
// ctx: { typeChart, dex }
export function resolveTurn(battle, action, ctx) {
  const beats = [];
  const player = activePlayer(battle);
  const enemy = activeEnemy(battle);

  if (action.type === 'switch') {
    if (battle.vol.player.trapped) {
      beats.push({ type: 'msg', text: `${player.name} can't escape!` });
      enemyTurn(battle, ctx, beats);
      endOfTurn(battle, ctx, beats);
      return { beats, outcome: battle.outcome };
    }
    const next = battle.playerParty[action.index];
    beats.push({ type: 'msg', text: `Come back, ${player.name}!` });
    battle.playerIndex = action.index;
    battle.vol.player = mkVol();
    beats.push({ type: 'switch', side: 'player', index: action.index });
    beats.push({ type: 'msg', text: `Go, ${next.name}!` });
    applyHazardDamage(battle, 'player', ctx, beats);
    if (battle.over) return { beats, outcome: battle.outcome };
    enemyTurn(battle, ctx, beats);
    endOfTurn(battle, ctx, beats);
    return { beats, outcome: battle.outcome };
  }

  if (action.type === 'item') {
    const item = action.item;
    if (item.kind === 'catch') {
      beats.push({ type: 'msg', text: `You lobbed a ${item.name}!` });
      beats.push({ type: 'orb' });
      if (Math.random() < catchChance(enemy, item.catchMod || 1)) {
        beats.push({ type: 'caught', target: 'enemy' });
        beats.push({ type: 'msg', text: `Gotcha! ${enemy.name} was caught!` });
        battle.over = true;
        battle.outcome = 'caught';
        return { beats, outcome: 'caught' };
      }
      beats.push({ type: 'msg', text: `Argh! ${enemy.name} broke free!` });
      enemyTurn(battle, ctx, beats);
      endOfTurn(battle, ctx, beats);
      return { beats, outcome: battle.outcome };
    }
    if (item.kind === 'heal') {
      const from = player.curHP;
      player.curHP = Math.min(player.maxHP, player.curHP + (item.heal || 0));
      beats.push({ type: 'msg', text: `You used a ${item.name}!` });
      beats.push({ type: 'damage', target: 'player', from, to: player.curHP, eff: 1 });
      beats.push({ type: 'msg', text: `${player.name} recovered ${player.curHP - from} HP!` });
      enemyTurn(battle, ctx, beats);
      endOfTurn(battle, ctx, beats);
      return { beats, outcome: battle.outcome };
    }
    if (item.kind === 'cure') {
      const cured = STATUS_INFO[player.status] ? STATUS_INFO[player.status].noun : 'status';
      player.status = null;
      player.statusCounter = 0;
      beats.push({ type: 'msg', text: `You used a ${item.name}!` });
      beats.push({ type: 'msg', text: `${player.name}'s ${cured} was cured!` });
      enemyTurn(battle, ctx, beats);
      endOfTurn(battle, ctx, beats);
      return { beats, outcome: battle.outcome };
    }
    beats.push({ type: 'msg', text: "It won't have any effect here." });
    return { beats, outcome: battle.outcome };
  }

  if (action.type === 'flee') {
    beats.push({ type: 'msg', text: 'You tried to flee...' });
    if (battle.vol.player.trapped) {
      beats.push({ type: 'msg', text: "Couldn't get away!" });
      enemyTurn(battle, ctx, beats);
      endOfTurn(battle, ctx, beats);
      return { beats, outcome: battle.outcome };
    }
    const escaped = Math.random() < 0.6 || effSpeed(battle, player, 'player') >= effSpeed(battle, enemy, 'enemy');
    if (escaped) {
      beats.push({ type: 'msg', text: 'Got away safely!' });
      beats.push({ type: 'fled' });
      battle.over = true;
      battle.outcome = 'fled';
      return { beats, outcome: 'fled' };
    }
    beats.push({ type: 'msg', text: "Couldn't get away!" });
    enemyTurn(battle, ctx, beats);
    endOfTurn(battle, ctx, beats);
    return { beats, outcome: battle.outcome };
  }

  // action.type === 'move'
  let playerMove;
  if (action.moveId === '__struggle') {
    playerMove = STRUGGLE;
  } else {
    playerMove = player.moves.find((m) => m.id === action.moveId) || player.moves[0];
    if (!usableMoves(player).length) playerMove = STRUGGLE;
  }
  const enemyMove = enemyChooseMove(battle, ctx);

  // Priority first, then effective speed, then coin flip.
  const pPrio = playerMove.priority || 0;
  const ePrio = enemyMove.priority || 0;
  let playerFirst;
  if (pPrio !== ePrio) playerFirst = pPrio > ePrio;
  else {
    const ps = effSpeed(battle, player, 'player');
    const es = effSpeed(battle, enemy, 'enemy');
    playerFirst = ps !== es ? ps > es : Math.random() < 0.5;
  }

  const order = playerFirst
    ? [{ atk: player, side: 'player', move: playerMove }, { atk: enemy, side: 'enemy', move: enemyMove }]
    : [{ atk: enemy, side: 'enemy', move: enemyMove }, { atk: player, side: 'player', move: playerMove }];

  actorMove(battle, order[0].atk, order[0].side, order[0].move, ctx, beats);
  if (!battle.over && order[1].atk.curHP > 0) {
    actorMove(battle, order[1].atk, order[1].side, order[1].move, ctx, beats);
  }

  endOfTurn(battle, ctx, beats);
  return { beats, outcome: battle.outcome };
}

export { catchChance };

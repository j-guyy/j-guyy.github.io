// agents.js — who decides the opposing side's move.
//
// The battle engine resolves a whole turn synchronously, and it has to know
// both sides' moves before either acts (turn order depends on priority and
// speed). So an "agent" is just:
//
//   { name, chooseMove(battle, ctx) -> move object | null }
//
// and it must answer synchronously. battle.js honours ctx.enemyAgent and falls
// back to its own built-in AI when there isn't one, so this is the single seam
// the simulator drives the opponent through.
//
// That shape is what makes multiplayer a drop-in later: a networked opponent is
// an agent whose chooseMove() returns a move the remote player already
// committed to (the UI awaits the socket message, stashes the choice, and then
// calls resolveTurn) — see makeScriptedAgent below, which is exactly that
// pattern with a local queue standing in for the socket.

import { STRUGGLE } from '../battle/battle.js';

export const DIFFICULTIES = {
  rookie: { id: 'rookie', name: 'Rookie', desc: 'Picks moves at random. Good for testing a team.' },
  trainer: { id: 'trainer', name: 'Trainer', desc: 'Goes for the best expected damage, with the odd off-read.' },
  ace: { id: 'ace', name: 'Ace', desc: 'Plays for the KO, times its status and setup, never misreads a type.' },
};

function usableMoves(inst) {
  return inst.moves.filter((m) => (m.curPP != null ? m.curPP : 1) > 0);
}

function isDamaging(move) {
  return move.category !== 'status' && (move.power > 0 || move.ohko || move.fixedDamage != null);
}

function stageMult(n) {
  return n >= 0 ? (2 + n) / 2 : 2 / (2 - n);
}

// Rough expected damage for scoring. Deliberately cheaper and more forgiving
// than calcDamage(): no crit roll, no random spread, average multi-hit count —
// the AI is picking between moves, not simulating the turn.
function expectedDamage(battle, attacker, atkSide, defender, defSide, move, ctx) {
  const mult = ctx.typeChart.multiplier(move.type, defender.types);
  if (mult === 0) return 0;
  if (move.ohko) return defender.curHP;
  if (move.fixedDamage === 'level') return attacker.level;
  if (move.fixedDamage === 'halfHP') return Math.floor(defender.curHP / 2);
  if (typeof move.fixedDamage === 'number') return move.fixedDamage;

  const special = move.category === 'special';
  const atkKey = special ? 'spAttack' : 'attack';
  const defKey = special ? 'spDefense' : 'defense';
  let atk = attacker.stats[atkKey] * stageMult(battle.vol[atkSide].stages[atkKey]);
  if (!special && attacker.status === 'burn') atk *= 0.5;
  const def = Math.max(1, defender.stats[defKey] * stageMult(battle.vol[defSide].stages[defKey]));
  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const hits = move.multiHit ? (move.multiHit[0] === move.multiHit[1] ? move.multiHit[0] : 3.166) : 1;
  const base = Math.floor((Math.floor(((2 * attacker.level) / 5 + 2) * move.power * atk) / def) / 50) + 2;
  return base * mult * stab * 0.925 * hits;
}

// Score a move in HP-equivalent terms so damage and utility are comparable.
// A guaranteed KO outranks everything; status/setup are worth a fraction of the
// target's health, scaled down when they'd be wasted (already statused, stats
// already maxed, hazards already stacked).
function scoreMove(battle, move, ctx, opts) {
  const attacker = battle.enemyParty[battle.enemyIndex];
  const defender = battle.playerParty[battle.playerIndex];
  const accuracy = (move.accuracy != null ? move.accuracy : 100) / 100;

  if (isDamaging(move)) {
    const dmg = expectedDamage(battle, attacker, 'enemy', defender, 'player', move, ctx);
    if (dmg <= 0) return 0;
    let score = Math.min(dmg, defender.curHP) * accuracy;
    // Sealing the KO this turn is worth more than the raw damage suggests.
    if (dmg >= defender.curHP) score *= opts.koBonus;
    if (move.priority > 0 && dmg >= defender.curHP) score *= 1.15;
    if (move.recoil) score *= 0.9;
    if (move.selfKO) score *= attacker.curHP <= attacker.maxHP * 0.35 ? 1.0 : 0.5;
    return score;
  }

  const effect = move.effect || {};
  const foeHP = defender.maxHP;
  let score = 0;

  if (effect.status) score += defender.status ? 0 : foeHP * 0.3;
  if (effect.volatile === 'confusion') score += battle.vol.player.confusion > 0 ? 0 : foeHP * 0.18;
  if (effect.volatile === 'seed') score += battle.vol.player.seeded ? 0 : foeHP * 0.22;
  if (effect.heal) {
    const missing = attacker.maxHP - attacker.curHP;
    score += Math.min(missing, attacker.maxHP * effect.heal) * 0.85;
  }
  if (effect.stages) {
    const side = effect.target === 'self' ? 'enemy' : 'player';
    const stages = battle.vol[side].stages;
    for (const [stat, delta] of Object.entries(effect.stages)) {
      const cur = stages[stat] || 0;
      const headroom = delta > 0 ? 6 - cur : 6 + cur;
      if (headroom <= 0) continue;
      score += foeHP * 0.09 * Math.min(Math.abs(delta), headroom);
    }
    // Setting up is only worth it with health to spare and a game left to play.
    if (effect.target === 'self') score *= attacker.curHP > attacker.maxHP * 0.6 ? 1 : 0.4;
  }
  if (effect.hazard) score += battle.hazards.player >= 3 ? 0 : foeHP * 0.15;
  if (effect.clearHazards) score += battle.hazards.enemy ? foeHP * 0.12 : 0;
  if (effect.weather) score += battle.weather.kind === effect.weather ? 0 : foeHP * 0.1;
  if (effect.screen) score += battle.screens.enemy[effect.screen] > 0 ? 0 : foeHP * 0.14;
  if (effect.cureParty) score += battle.enemyParty.some((m) => m.status) ? foeHP * 0.15 : 0;
  if (effect.trap) score += battle.vol.player.trapped ? 0 : foeHP * 0.1;
  if (move.protect) score += foeHP * 0.08;
  if (!score) score = foeHP * 0.05; // unknown utility move — better than nothing

  return score * accuracy;
}

export function makeAIAgent(difficulty = 'trainer') {
  const tier = DIFFICULTIES[difficulty] ? difficulty : 'trainer';
  const opts = tier === 'ace'
    ? { koBonus: 2.2, noise: 0 }
    : { koBonus: 1.5, noise: 0.15 };

  return {
    name: DIFFICULTIES[tier].name,
    difficulty: tier,
    chooseMove(battle, ctx) {
      const enemy = battle.enemyParty[battle.enemyIndex];
      const usable = usableMoves(enemy);
      if (!usable.length) return STRUGGLE;
      if (tier === 'rookie') return usable[Math.floor(Math.random() * usable.length)];
      if (opts.noise && Math.random() < opts.noise) {
        return usable[Math.floor(Math.random() * usable.length)];
      }
      let best = usable[0];
      let bestScore = -Infinity;
      for (const move of usable) {
        const score = scoreMove(battle, move, ctx, opts);
        if (score > bestScore) {
          bestScore = score;
          best = move;
        }
      }
      return best;
    },
  };
}

// An agent that plays a queue of pre-committed choices. This is the shape a
// networked opponent takes: push the remote player's move id in as it arrives
// over the wire, then resolve the turn. Falls back to the AI when the queue is
// empty so a dropped connection doesn't hang the battle.
export function makeScriptedAgent(fallback = makeAIAgent('trainer')) {
  const queue = [];
  return {
    name: 'Scripted',
    push(moveId) {
      queue.push(moveId);
    },
    get pending() {
      return queue.length;
    },
    chooseMove(battle, ctx) {
      const moveId = queue.shift();
      if (!moveId) return fallback.chooseMove(battle, ctx);
      const enemy = battle.enemyParty[battle.enemyIndex];
      return enemy.moves.find((m) => m.id === moveId) || fallback.chooseMove(battle, ctx);
    },
  };
}

// battle-ui.js — the battle screen: a DOM front-end over the game's existing
// battle engine (js/battle/battle.js), rendered Showdown-style rather than on
// the overworld canvas.
//
// The engine resolves an entire turn in one synchronous call and hands back an
// ordered list of "beats". By the time we get them, battle state is already at
// its end-of-turn values — so the screen can't just render live state, or every
// hit would land before its message. Instead:
//
//   * HP and the active slot are driven purely by the beats (damage beats carry
//     both `from` and `to`, so a switch-in's HP is recoverable by looking ahead).
//   * Everything else — status, stat stages, weather, hazards, screens — is
//     re-read from live state after each message beat. Status is always applied
//     immediately before its own message, so re-reading there shows a change on
//     the same beat that announces it, never earlier.
//
// When your active creature faints, the engine leaves the slot empty and sets
// needsReplacement(); this screen then shows a forced switch panel and answers
// with sendInReplacement(). Hazards can KO the creature that just came in, so
// that's a loop, not a single prompt.

import {
  createBattle, resolveTurn, activePlayer, activeEnemy, STATUS_INFO,
  needsReplacement, replacementOptions, sendInReplacement,
} from '../battle/battle.js';
import { buildParty, STAT_LABEL } from './sets.js';
import { makeAIAgent, DIFFICULTIES } from './agents.js';
import { el, clear, spriteEl, typeBadge, categoryBadge, hpClass, effectivenessLabel, moveSummary, sleep } from './ui.js';

const SPEEDS = {
  instant: { name: 'Instant', delay: 0 },
  fast: { name: 'Fast', delay: 260 },
  normal: { name: 'Normal', delay: 560 },
  slow: { name: 'Slow', delay: 950 },
};
const SPEED_KEY = 'jg_creature_sim_speed';

const STAGE_ORDER = ['attack', 'defense', 'spAttack', 'spDefense', 'speed', 'accuracy', 'evasion'];
const STAGE_LABEL = { ...STAT_LABEL, accuracy: 'Acc', evasion: 'Eva' };

export class BattleScreen {
  constructor(dex, typeChart, opts = {}) {
    this.dex = dex;
    this.typeChart = typeChart;
    this.onExit = opts.onExit || (() => {});
    this.onRematch = opts.onRematch || (() => {});
    this.speed = localStorage.getItem(SPEED_KEY) || 'fast';
    if (!SPEEDS[this.speed]) this.speed = 'fast';
  }

  // config: { playerTeam, playerName, opponent: { name, team, difficulty } }
  start(root, config) {
    this.config = config;
    this.busy = false;
    this.ended = false;
    this.turn = 0;
    this.revealed = new Set([0]);

    const playerParty = buildParty(this.dex, config.playerTeam);
    const enemyParty = buildParty(this.dex, config.opponent.team);
    this.battle = createBattle(playerParty, enemyParty, {
      mode: 'trainer', // no fleeing, no catching, and the foe sends out its next creature
      trainerName: config.opponent.name,
    });
    this.agent = makeAIAgent(config.opponent.difficulty);
    this.ctx = { typeChart: this.typeChart, dex: this.dex, enemyAgent: this.agent };

    this.view = {
      player: { index: this.battle.playerIndex, hp: activePlayer(this.battle).curHP },
      enemy: { index: 0, hp: activeEnemy(this.battle).curHP },
      partyHP: {
        player: playerParty.map((m) => m.curHP),
        enemy: enemyParty.map((m) => m.curHP),
      },
    };

    this.mount(root);
    this.log(`${config.opponent.name} wants to battle!`, 'log-head');
    this.log(`${config.opponent.name} sent out ${activeEnemy(this.battle).name}!`);
    this.log(`Go, ${activePlayer(this.battle).name}!`);
    this.updateAll();
  }

  // ---- Layout --------------------------------------------------------------

  mount(root) {
    clear(root);
    this.els = {};

    const speedSelect = el('select.select.select-sm', {
      onchange: (e) => {
        this.speed = e.target.value;
        localStorage.setItem(SPEED_KEY, this.speed);
      },
    }, Object.entries(SPEEDS).map(([id, s]) => el('option', { value: id, text: s.name })));
    speedSelect.value = this.speed;

    const bar = el('header.battle-bar', {}, [
      el('div.bar-group', {}, [
        el('button.btn.btn-ghost', { onclick: () => this.exit() }, '← Team Builder'),
        el('span.vs-line', {}, [
          el('strong', { text: this.config.playerName || 'You' }),
          el('span.vs', { text: 'vs' }),
          el('strong', { text: this.config.opponent.name }),
          el('span.diff-tag', { text: DIFFICULTIES[this.agent.difficulty].name }),
        ]),
      ]),
      el('div.bar-group', {}, [
        el('label.field.field-inline', {}, [el('span.field-label', { text: 'Speed' }), speedSelect]),
        el('button.btn.btn-ghost', { onclick: () => this.forfeit() }, 'Forfeit'),
      ]),
    ]);

    this.els.foeTeam = el('div.team-bar');
    this.els.youTeam = el('div.team-bar');
    this.els.conditions = el('div.field-conditions');
    this.els.log = el('div.battle-log', { 'aria-live': 'polite' });
    this.els.controls = el('div.battle-controls');

    const field = el('div.battle-field', {}, [
      el('div.field-row.row-foe', {}, [
        this.buildNameplate('enemy'),
        el('div.sprite-slot.slot-foe', {}, [this.els.enemySprite = el('div.sprite-holder')]),
      ]),
      this.els.conditions,
      el('div.field-row.row-you', {}, [
        el('div.sprite-slot.slot-you', {}, [this.els.playerSprite = el('div.sprite-holder')]),
        this.buildNameplate('player'),
      ]),
    ]);

    root.appendChild(
      el('div.battle-screen', {}, [
        bar,
        el('div.battle-main', {}, [
          el('div.battle-stage', {}, [this.els.foeTeam, field, this.els.youTeam]),
          el('div.battle-side', {}, [this.els.log, this.els.controls]),
        ]),
      ])
    );
  }

  buildNameplate(side) {
    const refs = {};
    const node = el(`div.nameplate.plate-${side}`, {}, [
      el('div.plate-top', {}, [
        refs.name = el('strong.plate-name'),
        refs.level = el('span.plate-level'),
        refs.status = el('span.status-chip'),
      ]),
      el('div.hp-bar', {}, [refs.hpFill = el('div.hp-fill')]),
      el('div.plate-bottom', {}, [refs.hpText = el('span.hp-text'), refs.stages = el('span.stage-chips')]),
    ]);
    this.els[`${side}Plate`] = refs;
    return node;
  }

  // ---- Rendering -----------------------------------------------------------

  updateAll() {
    this.updateSide('player');
    this.updateSide('enemy');
    this.updateTeamBars();
    this.updateConditions();
    this.renderControls();
  }

  activeFor(side) {
    const party = side === 'player' ? this.battle.playerParty : this.battle.enemyParty;
    return party[this.view[side].index];
  }

  updateSide(side) {
    const inst = this.activeFor(side);
    const refs = this.els[`${side}Plate`];
    const holder = side === 'player' ? this.els.playerSprite : this.els.enemySprite;
    const hp = this.view[side].hp;
    const fraction = inst.maxHP ? hp / inst.maxHP : 0;

    refs.name.textContent = inst.name;
    refs.name.title = inst.name === inst.speciesName ? inst.speciesName : `${inst.name} (${inst.speciesName})`;
    refs.level.textContent = `Lv ${inst.level}`;
    refs.hpFill.style.width = `${Math.max(0, fraction * 100)}%`;
    refs.hpFill.className = `hp-fill ${hpClass(fraction)}`;
    // Your own creature shows exact HP; the foe shows a percentage, same as
    // Showdown — you shouldn't get to read the opponent's exact roll.
    refs.hpText.textContent = side === 'player'
      ? `${hp} / ${inst.maxHP}`
      : `${Math.ceil(Math.max(0, fraction) * 100)}%`;

    const status = inst.status;
    refs.status.textContent = status ? STATUS_INFO[status].abbr : '';
    refs.status.className = `status-chip${status ? ` status-${status} is-on` : ''}`;

    clear(refs.stages);
    const vol = this.battle.vol[side];
    for (const stat of STAGE_ORDER) {
      const n = vol.stages[stat];
      if (!n) continue;
      refs.stages.appendChild(el(`span.stage-chip.${n > 0 ? 'stage-up' : 'stage-down'}`, {
        text: `${STAGE_LABEL[stat]} ${n > 0 ? '+' : ''}${n}`,
      }));
    }
    for (const [flag, label] of [['confusion', 'Confused'], ['seeded', 'Seeded'], ['trapped', 'Trapped']]) {
      const on = flag === 'confusion' ? vol.confusion > 0 : vol[flag];
      if (on) refs.stages.appendChild(el('span.stage-chip.stage-vol', { text: label }));
    }

    if (holder.dataset.species !== inst.species) {
      clear(holder);
      const sprite = side === 'player' ? this.dex.spriteBackFor(inst.species) : this.dex.spriteFor(inst.species);
      holder.appendChild(spriteEl(sprite, `battle-sprite sprite-${side}`));
      holder.dataset.species = inst.species;
    }
    holder.classList.toggle('is-fainted', hp <= 0);
  }

  updateTeamBars() {
    for (const [side, container] of [['enemy', this.els.foeTeam], ['player', this.els.youTeam]]) {
      const party = side === 'player' ? this.battle.playerParty : this.battle.enemyParty;
      clear(container);
      container.appendChild(el('span.team-bar-label', { text: side === 'player' ? 'Your team' : 'Foe' }));
      party.forEach((member, i) => {
        // The foe's team is fogged until each creature has actually been out,
        // so you scout it over the course of the battle rather than up front.
        const hidden = side === 'enemy' && !this.revealed.has(i);
        const hp = this.view.partyHP[side][i];
        const fainted = hp <= 0;
        container.appendChild(
          el(`span.team-pip${fainted ? '.is-fainted' : ''}${hidden ? '.is-hidden' : ''}${i === this.view[side].index ? '.is-active' : ''}`, {
            title: hidden ? 'Not yet revealed' : `${member.name} — ${fainted ? 'fainted' : `${Math.ceil((hp / member.maxHP) * 100)}%`}`,
          }, hidden ? [el('span.pip-unknown', { text: '?' })] : [spriteEl(this.dex.spriteFor(member.species), 'pip-sprite')])
        );
      });
    }
  }

  updateConditions() {
    const b = this.battle;
    clear(this.els.conditions);
    const chips = [];
    if (b.weather.kind && b.weather.turns > 0) {
      chips.push(el(`span.cond-chip.cond-${b.weather.kind}`, {
        text: `${b.weather.kind[0].toUpperCase()}${b.weather.kind.slice(1)} · ${b.weather.turns}`,
      }));
    }
    for (const [side, label] of [['player', 'Your side'], ['enemy', "Foe's side"]]) {
      if (b.hazards[side]) chips.push(el('span.cond-chip.cond-hazard', { text: `${label}: Spikes ×${b.hazards[side]}` }));
      if (b.screens[side].reflect > 0) chips.push(el('span.cond-chip.cond-screen', { text: `${label}: Reflect · ${b.screens[side].reflect}` }));
      if (b.screens[side].lightScreen > 0) chips.push(el('span.cond-chip.cond-screen', { text: `${label}: Light Screen · ${b.screens[side].lightScreen}` }));
    }
    if (!chips.length) chips.push(el('span.cond-chip.cond-clear', { text: 'No field effects' }));
    for (const chip of chips) this.els.conditions.appendChild(chip);
  }

  // ---- Controls ------------------------------------------------------------

  renderControls() {
    clear(this.els.controls);
    if (this.battle.over) return this.renderResult();
    if (this.busy) {
      this.els.controls.appendChild(el('div.control-wait', { text: 'Resolving turn…' }));
      return;
    }
    if (needsReplacement(this.battle)) return this.renderReplacePanel();

    const me = activePlayer(this.battle);
    const foe = activeEnemy(this.battle);
    const usable = me.moves.filter((m) => (m.curPP != null ? m.curPP : 1) > 0);

    const grid = el('div.move-grid');
    if (!usable.length) {
      grid.appendChild(el('button.move-btn.move-struggle', {
        onclick: () => this.takeTurn({ type: 'move', moveId: '__struggle' }),
      }, [
        el('span.move-btn-name', { text: 'Struggle' }),
        el('span.move-btn-meta', { text: 'No PP left — 50 power, recoil' }),
      ]));
    } else {
      for (const move of me.moves) {
        const out = (move.curPP != null ? move.curPP : 1) <= 0;
        const mult = this.typeChart.multiplier(move.type, foe.types);
        const eff = move.category === 'status' ? null : effectivenessLabel(mult);
        const info = moveSummary(move);
        grid.appendChild(
          el(`button.move-btn${out ? '.is-out' : ''}`, {
            disabled: out,
            style: { borderColor: this.typeChart.color(move.type) },
            title: move.flavor || '',
            onclick: () => this.takeTurn({ type: 'move', moveId: move.id }),
          }, [
            el('span.move-btn-name', {}, [move.name, eff ? el('span.eff-tag', { class: eff.cls, text: eff.text }) : null]),
            el('span.move-btn-meta', {}, [
              typeBadge(this.typeChart, move.type),
              categoryBadge(move.category),
              el('span.move-num', { text: info.power === '—' ? '—' : `${info.power} pow` }),
              el('span.move-pp', { text: `${move.curPP}/${move.pp} PP` }),
            ]),
          ])
        );
      }
    }

    this.els.controls.appendChild(grid);
    this.els.controls.appendChild(
      el('div.control-row', {}, [
        el('button.btn', { onclick: () => this.renderSwitchPanel() }, 'Switch'),
      ])
    );
  }

  // Shared by the voluntary switch panel and the forced post-faint one.
  // `activeIndex` is null in the forced case — the slot is empty, so no row is
  // "already out" and every healthy creature is a legal answer.
  partyList(activeIndex, onPick) {
    const list = el('div.switch-list');
    this.battle.playerParty.forEach((member, i) => {
      const isActive = i === activeIndex;
      const fainted = member.curHP <= 0;
      const fraction = member.curHP / member.maxHP;
      list.appendChild(
        el(`button.switch-row${isActive ? '.is-active' : ''}${fainted ? '.is-fainted' : ''}`, {
          disabled: isActive || fainted,
          onclick: () => onPick(i),
        }, [
          spriteEl(this.dex.spriteFor(member.species), 'switch-sprite'),
          el('span.switch-info', {}, [
            el('strong', { text: member.name }),
            el('span.switch-meta', { text: `Lv ${member.level} · ${member.curHP}/${member.maxHP} HP${member.status ? ` · ${STATUS_INFO[member.status].abbr}` : ''}` }),
          ]),
          el('span.switch-bar', {}, [el('span.switch-fill', { class: hpClass(fraction), style: { width: `${Math.max(0, fraction * 100)}%` } })]),
          isActive ? el('span.switch-tag', { text: 'Out' }) : fainted ? el('span.switch-tag', { text: 'Fainted' }) : null,
        ])
      );
    });
    return list;
  }

  renderSwitchPanel() {
    clear(this.els.controls);
    if (this.battle.vol.player.trapped) {
      this.els.controls.appendChild(el('p.note.note-warn', {
        text: `${activePlayer(this.battle).name} is trapped and can't switch out — the attempt will waste the turn.`,
      }));
    }
    this.els.controls.appendChild(
      this.partyList(this.battle.playerIndex, (i) => this.takeTurn({ type: 'switch', index: i }))
    );
    this.els.controls.appendChild(
      el('div.control-row', {}, [el('button.btn.btn-ghost', { onclick: () => this.renderControls() }, '← Back')])
    );
  }

  // Forced switch after a faint. No Back button — the slot has to be filled
  // before anything else happens — and it costs no turn.
  renderReplacePanel() {
    const downed = this.battle.playerParty[this.view.player.index];
    this.els.controls.appendChild(el('div.replace-head', {}, [
      el('strong', { text: `${downed.name} fainted!` }),
      el('span', { text: 'Send out which creature?' }),
    ]));
    this.els.controls.appendChild(this.partyList(null, (i) => this.doReplacement(i)));
  }

  renderResult() {
    const outcome = this.battle.outcome;
    const won = outcome === 'win';
    const survivors = this.battle.playerParty.filter((m) => m.curHP > 0).length;
    this.els.controls.appendChild(
      el(`div.result-panel.${won ? 'result-win' : 'result-lose'}`, {}, [
        el('h2', { text: won ? 'You win!' : outcome === 'lose' ? 'You lost.' : 'Battle over' }),
        el('p', {
          text: won
            ? `${this.config.opponent.name} is out of usable creatures. You finished with ${survivors} standing.`
            : `${this.config.opponent.name} swept your team in ${this.turn} turn${this.turn === 1 ? '' : 's'}.`,
        }),
        el('div.control-row', {}, [
          el('button.btn.btn-primary', { onclick: () => this.onRematch() }, 'Rematch'),
          el('button.btn', { onclick: () => this.exit() }, 'Team Builder'),
        ]),
      ])
    );
  }

  // ---- Turn flow -----------------------------------------------------------

  async takeTurn(action) {
    if (this.busy || this.battle.over) return;
    this.busy = true;
    this.turn += 1;
    this.log(`Turn ${this.turn}`, 'log-turn');
    this.renderControls();

    const { beats } = resolveTurn(this.battle, action, this.ctx);
    await this.playBeats(beats);

    // Re-sync to authoritative state: playback tracks HP and the active slot
    // itself, and any drift (a beat shape this screen doesn't model) would
    // otherwise persist into the next turn.
    this.view.player.index = this.battle.playerIndex;
    this.view.enemy.index = this.battle.enemyIndex;
    this.view.player.hp = activePlayer(this.battle).curHP;
    this.view.enemy.hp = activeEnemy(this.battle).curHP;
    this.view.partyHP.player = this.battle.playerParty.map((m) => m.curHP);
    this.view.partyHP.enemy = this.battle.enemyParty.map((m) => m.curHP);

    this.busy = false;
    this.updateAll();
    this.announceEnd();
  }

  // Answering the forced post-faint prompt. Costs no turn, so there's no turn
  // counter bump and no log separator — but hazards on the way in can KO the
  // creature that just landed, in which case updateAll() puts the prompt
  // straight back up.
  async doReplacement(index) {
    if (this.busy || this.battle.over || !needsReplacement(this.battle)) return;
    this.busy = true;
    this.renderControls();

    const { beats } = sendInReplacement(this.battle, index, this.ctx);
    await this.playBeats(beats);

    this.view.player.index = this.battle.playerIndex;
    this.view.player.hp = activePlayer(this.battle).curHP;
    this.view.partyHP.player = this.battle.playerParty.map((m) => m.curHP);

    this.busy = false;
    this.updateAll();
    this.announceEnd();
  }

  announceEnd() {
    if (!this.battle.over || this.ended) return;
    this.ended = true;
    this.log(this.battle.outcome === 'win' ? 'You win!' : 'You are out of usable creatures.', 'log-head');
  }

  async playBeats(beats) {
    const delay = SPEEDS[this.speed].delay;
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      switch (beat.type) {
        case 'msg':
          this.log(beat.text);
          // Status/stages/field are applied to live state right before their
          // own message, so refreshing here keeps them in step with the text.
          this.updateSide('player');
          this.updateSide('enemy');
          this.updateConditions();
          if (delay) await sleep(delay);
          break;
        case 'damage': {
          const side = beat.target;
          this.view[side].hp = beat.to;
          this.view.partyHP[side][this.view[side].index] = beat.to;
          this.updateSide(side);
          this.updateTeamBars();
          if (beat.to < beat.from) this.flash(side, beat.eff);
          if (delay) await sleep(Math.round(delay * 0.55));
          break;
        }
        case 'switch': {
          const side = beat.side;
          this.view[side].index = beat.index;
          this.view[side].hp = this.hpOnSwitch(beats, i, side, beat.index);
          this.view.partyHP[side][beat.index] = this.view[side].hp;
          if (side === 'enemy') this.revealed.add(beat.index);
          this.updateSide(side);
          this.updateTeamBars();
          if (delay) await sleep(Math.round(delay * 0.6));
          break;
        }
        case 'faint':
          this.updateSide(beat.target);
          this.updateTeamBars();
          if (delay) await sleep(Math.round(delay * 0.8));
          break;
        default:
          break; // 'xp', 'orb', 'caught', 'fled' — not reachable in a sim battle
      }
    }
  }

  // A switch beat doesn't carry the incoming creature's HP, and live state is
  // already at end-of-turn values. The next damage beat on that side starts
  // from the HP it had on entry, so look ahead for it; if the creature isn't
  // touched again this turn, live state is correct as-is.
  hpOnSwitch(beats, from, side, index) {
    for (let i = from + 1; i < beats.length; i++) {
      const beat = beats[i];
      if (beat.type === 'switch' && beat.side === side) break;
      if (beat.type === 'damage' && beat.target === side) return beat.from;
    }
    const party = side === 'player' ? this.battle.playerParty : this.battle.enemyParty;
    return party[index].curHP;
  }

  flash(side, eff) {
    const holder = side === 'player' ? this.els.playerSprite : this.els.enemySprite;
    const cls = eff >= 2 ? 'hit-super' : eff > 0 && eff < 1 ? 'hit-weak' : 'hit-normal';
    holder.classList.remove('hit-super', 'hit-weak', 'hit-normal');
    // Force a reflow so the animation restarts even on back-to-back hits
    // (a multi-hit move fires several damage beats in a row).
    void holder.offsetWidth;
    holder.classList.add(cls);
    setTimeout(() => holder.classList.remove(cls), 400);
  }

  // ---- Log -----------------------------------------------------------------

  log(text, cls = '') {
    const line = el(`div.log-line${cls ? '.' + cls : ''}`, { text });
    this.els.log.appendChild(line);
    this.els.log.scrollTop = this.els.log.scrollHeight;
  }

  forfeit() {
    if (this.battle.over || !confirm('Forfeit this battle?')) return;
    this.battle.over = true;
    this.battle.outcome = 'lose';
    this.ended = true;
    this.log('You forfeited the battle.', 'log-head');
    this.busy = false;
    this.updateAll();
  }

  exit() {
    if (!this.battle.over && this.turn > 0 && !confirm('Leave this battle and go back to the team builder?')) return;
    this.onExit();
  }
}

// main.js — battle simulator bootstrap. Loads the same dex/type chart the
// overworld game uses, then swaps between the team builder and the battle
// screen.

import { loadTypes } from '../battle/typechart.js';
import { loadDex } from '../data/dex.js';
import { preloadCreatureArt } from '../engine/assets.js';
import { TeamBuilder, openModal } from './builder.js';
import { BattleScreen } from './battle-ui.js';
import { PRESET_TRAINERS, getPreset, buildTrainerTeam } from './trainers.js';
import { DIFFICULTIES } from './agents.js';
import { cloneSet, clamp } from './sets.js';
import { el, clear } from './ui.js';

const OPPONENT_KEY = 'jg_creature_sim_opponent';

async function boot() {
  const root = document.getElementById('sim-root');
  const builderRoot = document.getElementById('screen-builder');
  const battleRoot = document.getElementById('screen-battle');

  let dex;
  let typeChart;
  try {
    typeChart = await loadTypes();
    dex = await loadDex(typeChart);
    // Baked PNG art is a synchronous cache read after this resolves; without
    // the await every sprite would fall back to the procedural placeholder.
    await preloadCreatureArt(dex.order);
  } catch (err) {
    clear(root);
    root.appendChild(el('div.fatal', {}, [
      el('h1', { text: 'Could not load the creature data' }),
      el('p', { text: String(err && err.message ? err.message : err) }),
      el('p', { text: 'Open this page through a web server (not file://) so the JSON files can be fetched.' }),
    ]));
    return;
  }

  let battle = null;

  const showBuilder = () => {
    battleRoot.hidden = true;
    builderRoot.hidden = false;
    clear(battleRoot);
    battle = null;
  };

  const startBattle = (config) => {
    builderRoot.hidden = true;
    battleRoot.hidden = false;
    battle = new BattleScreen(dex, typeChart, {
      onExit: showBuilder,
      onRematch: () => startBattle(config),
    });
    battle.start(battleRoot, config);
  };

  const builder = new TeamBuilder(dex, typeChart, {
    onBattle: (payload) => openOpponentDialog(dex, payload, startBattle),
  });
  builder.mount(builderRoot);
  showBuilder();
}

// Opponent picker: which NPC, how well it plays, and at what level. Level
// defaults to your team's average so a Level 50 team meets a Level 50 foe.
function openOpponentDialog(dex, payload, onStart) {
  const { team, format, name } = payload;
  const avgLevel = Math.round(team.reduce((sum, s) => sum + s.level, 0) / team.length);
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(OPPONENT_KEY)) || {}; } catch { return {}; }
  })();

  const state = {
    presetId: PRESET_TRAINERS.some((p) => p.id === saved.presetId) ? saved.presetId : 'random',
    mirror: !!saved.mirror,
    difficulty: DIFFICULTIES[saved.difficulty] ? saved.difficulty : null, // null = the preset's own
    level: avgLevel,
  };

  const blurb = el('p.note');
  const presetList = el('div.opponent-list');

  const render = () => {
    clear(presetList);
    const options = [
      ...PRESET_TRAINERS.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb, mirror: false })),
      { id: 'mirror', name: 'Mirror Match', blurb: 'The NPC runs an exact copy of your own team.', mirror: true },
    ];
    for (const option of options) {
      const chosen = option.mirror ? state.mirror : (!state.mirror && state.presetId === option.id);
      presetList.appendChild(
        el(`button.opponent-card${chosen ? '.is-chosen' : ''}`, {
          onclick: () => {
            state.mirror = option.mirror;
            if (!option.mirror) state.presetId = option.id;
            render();
          },
        }, [
          el('strong', { text: option.name }),
          el('span.opponent-blurb', { text: option.blurb }),
          option.mirror ? null : el('span.opponent-tag', { text: DIFFICULTIES[getPreset(option.id).difficulty].name }),
        ])
      );
    }
    const effective = state.difficulty || (state.mirror ? 'trainer' : getPreset(state.presetId).difficulty);
    blurb.textContent = DIFFICULTIES[effective].desc;
  };

  const difficultySelect = el('select.select', {
    onchange: (e) => { state.difficulty = e.target.value || null; render(); },
  }, [
    el('option', { value: '', text: "Preset's own" }),
    ...Object.values(DIFFICULTIES).map((d) => el('option', { value: d.id, text: d.name })),
  ]);
  difficultySelect.value = state.difficulty || '';

  const levelInput = el('input.input.input-num', {
    type: 'number', min: '1', max: '100', value: String(state.level),
    onchange: (e) => { state.level = clamp(parseInt(e.target.value, 10) || avgLevel, 1, 100); },
  });

  const close = openModal('Choose your opponent', [
    presetList,
    el('div.editor-row', {}, [
      el('label.field', {}, [el('span.field-label', { text: 'Difficulty' }), difficultySelect]),
      el('label.field', {}, [el('span.field-label', { text: 'Opponent level' }), levelInput]),
    ]),
    blurb,
    el('div.modal-actions', {}, [
      el('button.btn.btn-primary', {
        onclick: () => {
          const preset = getPreset(state.presetId);
          const opponentTeam = state.mirror
            ? team.map(cloneSet)
            : buildTrainerTeam(dex, preset, state.level, format);
          if (!opponentTeam.length) {
            alert('That opponent has no usable creatures.');
            return;
          }
          try {
            localStorage.setItem(OPPONENT_KEY, JSON.stringify({
              presetId: state.presetId, mirror: state.mirror, difficulty: state.difficulty,
            }));
          } catch { /* storage unavailable — the choice just won't persist */ }
          close();
          onStart({
            playerTeam: team,
            playerName: name,
            opponent: {
              name: state.mirror ? 'Mirror' : preset.name,
              team: opponentTeam,
              difficulty: state.difficulty || (state.mirror ? 'trainer' : preset.difficulty),
            },
          });
        },
      }, 'Start battle'),
    ]),
  ], 'modal-wide');

  render();
}

boot();

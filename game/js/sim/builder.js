// builder.js — the team builder screen.
//
// Left column picks a species, middle column holds the six-slot team, right
// column edits the selected set (nickname, level, ability, nature, IVs/EVs and
// four moves). Everything writes straight into plain set objects from sets.js;
// nothing here knows about the battle engine.

import {
  FORMATS, getFormat, NATURES, STAT_KEYS, STAT_LABEL, STAT_LONG, TEAM_SIZE,
  MAX_IV, MAX_EV_PER_STAT, MAX_EV_TOTAL,
  makeSet, cloneSet, normalizeSet, legalMoves, legalAbilities,
  computeSimStats, natureMultiplier, totalEVs, validateTeam, randomTeam, clamp,
} from './sets.js';
import { loadTeams, upsertTeam, deleteTeam, exportTeam, importTeam } from './teams.js';
import { el, clear, spriteEl, typeBadges, typeBadge, categoryBadge, moveSummary } from './ui.js';

// The highest base stat in the dex, used to scale the stat bars so they read
// comparably across every creature rather than each maxing out its own bar.
const STAT_BAR_MAX = 400;

export class TeamBuilder {
  constructor(dex, typeChart, opts = {}) {
    this.dex = dex;
    this.typeChart = typeChart;
    this.onBattle = opts.onBattle || (() => {});
    this.formatId = 'standard';
    this.teamName = 'My Team';
    this.team = [];
    this.selected = 0;
    this.rosterFilter = '';
  }

  get format() {
    return getFormat(this.formatId);
  }

  mount(root) {
    this.root = root;
    clear(root);
    this.rosterEl = el('div.roster-grid');
    this.teamEl = el('div.team-slots');
    this.editorEl = el('div.set-editor');
    this.statusEl = el('div.builder-status');

    root.appendChild(this.renderToolbar());
    root.appendChild(
      el('div.builder-body', {}, [
        el('section.builder-col.col-roster', {}, [
          el('div.col-head', {}, [
            el('h2', { text: 'Creatures' }),
            el('input.roster-search', {
              type: 'search',
              placeholder: 'Search…',
              oninput: (e) => {
                this.rosterFilter = e.target.value.toLowerCase();
                this.renderRoster();
              },
            }),
          ]),
          this.rosterEl,
        ]),
        el('section.builder-col.col-team', {}, [
          el('div.col-head', {}, [el('h2', { text: 'Your Team' }), el('span.slot-count#slot-count')]),
          this.teamEl,
          this.statusEl,
        ]),
        el('section.builder-col.col-set', {}, [this.editorEl]),
      ])
    );

    this.renderAll();
  }

  renderToolbar() {
    const formatSelect = el('select.select', {
      onchange: (e) => {
        this.formatId = e.target.value;
        // Re-normalizing drops anything the new format makes illegal (an open
        // move on a set moving back to Standard) instead of leaving the team in
        // a state that can't battle.
        this.team = this.team.map((set) => normalizeSet(this.dex, set, this.format) || set);
        this.renderAll();
      },
    }, Object.values(FORMATS).map((f) => el('option', { value: f.id, text: f.name })));
    formatSelect.value = this.formatId;

    this.nameInput = el('input.team-name', {
      value: this.teamName,
      'aria-label': 'Team name',
      oninput: (e) => { this.teamName = e.target.value; },
    });

    return el('header.builder-bar', {}, [
      el('div.bar-group', {}, [
        el('label.field', {}, [el('span.field-label', { text: 'Team' }), this.nameInput]),
        el('label.field', {}, [
          el('span.field-label', { text: 'Format' }),
          formatSelect,
        ]),
      ]),
      el('div.bar-group.bar-actions', {}, [
        el('button.btn', { onclick: () => this.randomize(), title: 'Fill the team with random legal sets' }, 'Random Team'),
        el('button.btn', { onclick: () => this.openTeamsDialog() }, 'Saved Teams'),
        el('button.btn', { onclick: () => this.openImportDialog() }, 'Import / Export'),
        el('button.btn.btn-ghost', { onclick: () => this.clearTeam() }, 'Clear'),
        el('button.btn.btn-primary', { onclick: () => this.startBattle() }, 'Battle ▶'),
      ]),
      el('p.format-desc', { text: this.format.desc }),
    ]);
  }

  renderAll() {
    this.renderRoster();
    this.renderTeam();
    this.renderEditor();
    const desc = this.root.querySelector('.format-desc');
    if (desc) desc.textContent = this.format.desc;
  }

  // ---- Roster --------------------------------------------------------------

  renderRoster() {
    clear(this.rosterEl);
    for (const id of this.dex.order) {
      const species = this.dex.species(id);
      if (this.rosterFilter && !species.name.toLowerCase().includes(this.rosterFilter)
          && !species.types.some((t) => t.toLowerCase().includes(this.rosterFilter))) {
        continue;
      }
      const count = this.team.filter((s) => s.species === id).length;
      this.rosterEl.appendChild(
        el('button.roster-card', {
          onclick: () => this.addSpecies(id),
          title: `${species.name} — ${species.types.join(' / ')}\n${species.flavor || ''}`,
          disabled: this.team.length >= TEAM_SIZE,
        }, [
          spriteEl(this.dex.spriteFor(id), 'roster-sprite'),
          el('span.roster-name', { text: species.name }),
          typeBadges(this.typeChart, species.types),
          count ? el('span.roster-count', { text: `×${count}` }) : null,
        ])
      );
    }
    if (!this.rosterEl.children.length) {
      this.rosterEl.appendChild(el('p.empty-note', { text: 'No creatures match that search.' }));
    }
  }

  addSpecies(id) {
    if (this.team.length >= TEAM_SIZE) return;
    this.team.push(makeSet(this.dex, id, this.format));
    this.selected = this.team.length - 1;
    this.renderAll();
  }

  // ---- Team slots ----------------------------------------------------------

  renderTeam() {
    clear(this.teamEl);
    this.team.forEach((set, index) => {
      const species = this.dex.species(set.species);
      const stats = computeSimStats(species.baseStats, set.level, set.ivs, set.evs, set.nature);
      this.teamEl.appendChild(
        el(`div.team-slot${index === this.selected ? '.is-selected' : ''}`, {
          onclick: () => { this.selected = index; this.renderAll(); },
          tabindex: '0',
          onkeydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.selected = index; this.renderAll(); }
          },
        }, [
          spriteEl(this.dex.spriteFor(set.species), 'slot-sprite'),
          el('div.slot-info', {}, [
            el('div.slot-title', {}, [
              el('strong', { text: set.nickname || species.name }),
              el('span.slot-level', { text: `Lv ${set.level}` }),
            ]),
            set.nickname ? el('div.slot-species', { text: species.name }) : null,
            typeBadges(this.typeChart, species.types),
            el('div.slot-moves', {},
              set.moves.length
                ? set.moves.map((mid) => el('span.slot-move', { text: this.dex.moves[mid].name }))
                : [el('span.slot-move.slot-move-empty', { text: 'No moves' })]),
            el('div.slot-stat-line', { text: `${NATURES[set.nature].name} · ${stats.hp} HP` }),
          ]),
          el('div.slot-tools', {}, [
            el('button.icon-btn', {
              title: 'Duplicate',
              onclick: (e) => { e.stopPropagation(); this.duplicate(index); },
            }, '⧉'),
            el('button.icon-btn', {
              title: 'Move up',
              disabled: index === 0,
              onclick: (e) => { e.stopPropagation(); this.reorder(index, index - 1); },
            }, '▲'),
            el('button.icon-btn', {
              title: 'Move down',
              disabled: index === this.team.length - 1,
              onclick: (e) => { e.stopPropagation(); this.reorder(index, index + 1); },
            }, '▼'),
            el('button.icon-btn.icon-danger', {
              title: 'Remove',
              onclick: (e) => { e.stopPropagation(); this.remove(index); },
            }, '✕'),
          ]),
        ])
      );
    });

    for (let i = this.team.length; i < TEAM_SIZE; i++) {
      this.teamEl.appendChild(el('div.team-slot.slot-empty', { text: `Slot ${i + 1} — pick a creature` }));
    }

    const count = document.getElementById('slot-count');
    if (count) count.textContent = `${this.team.length} / ${TEAM_SIZE}`;
    this.renderStatus();
  }

  renderStatus() {
    clear(this.statusEl);
    const { errors, warnings } = validateTeam(this.dex, this.team, this.format);
    if (!this.team.length) {
      this.statusEl.appendChild(el('p.note', { text: 'Add up to six creatures, then hit Battle.' }));
      return;
    }
    for (const msg of errors) this.statusEl.appendChild(el('p.note.note-error', { text: msg }));
    for (const msg of warnings) this.statusEl.appendChild(el('p.note.note-warn', { text: msg }));
    if (!errors.length && !warnings.length) {
      this.statusEl.appendChild(el('p.note.note-ok', { text: 'Team is legal and ready to battle.' }));
    }
  }

  duplicate(index) {
    if (this.team.length >= TEAM_SIZE) return;
    this.team.splice(index + 1, 0, cloneSet(this.team[index]));
    this.selected = index + 1;
    this.renderAll();
  }

  reorder(from, to) {
    if (to < 0 || to >= this.team.length) return;
    const [set] = this.team.splice(from, 1);
    this.team.splice(to, 0, set);
    this.selected = to;
    this.renderAll();
  }

  remove(index) {
    this.team.splice(index, 1);
    this.selected = clamp(this.selected, 0, Math.max(0, this.team.length - 1));
    this.renderAll();
  }

  clearTeam() {
    if (this.team.length && !confirm('Clear the whole team?')) return;
    this.team = [];
    this.selected = 0;
    this.renderAll();
  }

  randomize() {
    const level = this.team.length ? Math.round(this.team.reduce((s, m) => s + m.level, 0) / this.team.length) : 50;
    this.team = randomTeam(this.dex, TEAM_SIZE, level, this.format);
    this.selected = 0;
    this.renderAll();
  }

  // ---- Set editor ----------------------------------------------------------

  renderEditor() {
    clear(this.editorEl);
    const set = this.team[this.selected];
    if (!set) {
      this.editorEl.appendChild(el('div.editor-empty', {}, [
        el('h2', { text: 'Set Editor' }),
        el('p', { text: 'Select a creature from your team to edit its level, nature, ability, EVs/IVs and moves.' }),
      ]));
      return;
    }
    const species = this.dex.species(set.species);
    const update = () => { this.renderTeam(); this.renderEditor(); };

    this.editorEl.appendChild(el('div.editor-head', {}, [
      spriteEl(this.dex.spriteFor(set.species), 'editor-sprite'),
      el('div.editor-title', {}, [
        el('h2', { text: species.name }),
        typeBadges(this.typeChart, species.types),
        el('p.editor-flavor', { text: species.flavor || '' }),
      ]),
    ]));

    // Identity row: nickname + level.
    this.editorEl.appendChild(el('div.editor-row', {}, [
      el('label.field', {}, [
        el('span.field-label', { text: 'Nickname' }),
        el('input.input', {
          value: set.nickname,
          maxlength: '16',
          placeholder: species.name,
          oninput: (e) => { set.nickname = e.target.value; this.renderTeam(); },
        }),
      ]),
      el('label.field', {}, [
        el('span.field-label', { text: 'Level' }),
        el('input.input.input-num', {
          type: 'number', min: '1', max: '100', value: String(set.level),
          onchange: (e) => {
            set.level = clamp(parseInt(e.target.value, 10) || 50, 1, 100);
            // Dropping the level can make a high-level move illegal; prune so
            // the team never silently carries an unusable move into battle.
            const pool = legalMoves(this.dex, set.species, set.level, this.format);
            set.moves = set.moves.filter((id) => pool.includes(id));
            update();
          },
        }),
      ]),
    ]));

    // Ability + nature.
    const abilities = legalAbilities(this.dex, set.species, this.format);
    const abilitySelect = el('select.select', {
      disabled: abilities.length <= 1,
      onchange: (e) => { set.ability = e.target.value; update(); },
    }, abilities.map((id) => el('option', { value: id, text: this.dex.ability(id).name })));
    abilitySelect.value = set.ability || abilities[0];

    const natureSelect = el('select.select', {
      onchange: (e) => { set.nature = e.target.value; update(); },
    }, Object.entries(NATURES).map(([id, n]) => el('option', {
      value: id,
      text: n.plus ? `${n.name} (+${STAT_LABEL[n.plus]}, −${STAT_LABEL[n.minus]})` : `${n.name} (neutral)`,
    })));
    natureSelect.value = set.nature;

    this.editorEl.appendChild(el('div.editor-row', {}, [
      el('label.field', {}, [el('span.field-label', { text: 'Ability' }), abilitySelect]),
      el('label.field', {}, [el('span.field-label', { text: 'Nature' }), natureSelect]),
    ]));
    if (set.ability) {
      this.editorEl.appendChild(el('p.ability-desc', { text: this.dex.ability(set.ability).desc || '' }));
    }

    this.editorEl.appendChild(this.renderMoveEditor(set, update));
    this.editorEl.appendChild(this.renderStatEditor(set, update));
  }

  renderMoveEditor(set, update) {
    const pool = legalMoves(this.dex, set.species, set.level, this.format);
    const slots = el('div.move-slots');
    for (let i = 0; i < 4; i++) {
      const moveId = set.moves[i];
      const move = moveId ? this.dex.move(moveId) : null;
      slots.appendChild(
        el(`button.move-slot${move ? '' : '.move-slot-empty'}`, {
          onclick: () => this.openMovePicker(set, i, update),
          style: move ? { borderLeftColor: this.typeChart.color(move.type) } : {},
        }, move ? [
          el('span.move-slot-name', { text: move.name }),
          el('span.move-slot-meta', {}, [
            typeBadge(this.typeChart, move.type),
            categoryBadge(move.category),
            el('span.move-num', { text: `${moveSummary(move).power} / ${moveSummary(move).acc} / ${moveSummary(move).pp}pp` }),
          ]),
        ] : [el('span.move-slot-name', { text: `+ Move ${i + 1}` })])
      );
    }
    return el('div.editor-section', {}, [
      el('div.section-head', {}, [
        el('h3', { text: 'Moves' }),
        el('span.section-note', { text: `${pool.length} legal` }),
        set.moves.length ? el('button.link-btn', {
          onclick: () => { set.moves = []; update(); },
        }, 'clear') : null,
      ]),
      slots,
    ]);
  }

  renderStatEditor(set, update) {
    const species = this.dex.species(set.species);
    const stats = computeSimStats(species.baseStats, set.level, set.ivs, set.evs, set.nature);
    const spent = totalEVs(set.evs);
    const rows = STAT_KEYS.map((key) => {
      const base = species.baseStats[key] != null
        ? species.baseStats[key]
        : (key === 'spAttack' ? species.baseStats.attack : species.baseStats.defense);
      const mult = natureMultiplier(set.nature, key);
      const evInput = el('input.ev-slider', {
        type: 'range', min: '0', max: String(MAX_EV_PER_STAT), step: '4', value: String(set.evs[key]),
        oninput: (e) => {
          const want = clamp(parseInt(e.target.value, 10) || 0, 0, MAX_EV_PER_STAT);
          // Hard-cap at the 510 budget: give the stat whatever's left rather
          // than letting the slider run past a spread that can't be used.
          const headroom = MAX_EV_TOTAL - (spent - set.evs[key]);
          set.evs[key] = Math.min(want, headroom);
          update();
        },
      });
      return el('div.stat-row', {}, [
        el('span.stat-name', {
          class: mult > 1 ? 'stat-up' : mult < 1 ? 'stat-down' : '',
          text: STAT_LABEL[key],
          title: STAT_LONG[key],
        }),
        el('span.stat-base', { text: String(base), title: 'Base stat' }),
        el('div.stat-bar', {}, [
          el('div.stat-bar-fill', { style: { width: `${clamp((stats[key] / STAT_BAR_MAX) * 100, 2, 100)}%` } }),
        ]),
        el('span.stat-total', { text: String(stats[key]) }),
        evInput,
        el('input.input.input-tiny', {
          type: 'number', min: '0', max: String(MAX_EV_PER_STAT), value: String(set.evs[key]),
          title: 'EVs',
          onchange: (e) => {
            const want = clamp(parseInt(e.target.value, 10) || 0, 0, MAX_EV_PER_STAT);
            set.evs[key] = Math.min(want, MAX_EV_TOTAL - (spent - set.evs[key]));
            update();
          },
        }),
        el('input.input.input-tiny', {
          type: 'number', min: '0', max: String(MAX_IV), value: String(set.ivs[key]),
          title: 'IVs',
          onchange: (e) => { set.ivs[key] = clamp(parseInt(e.target.value, 10) || 0, 0, MAX_IV); update(); },
        }),
      ]);
    });

    return el('div.editor-section', {}, [
      el('div.section-head', {}, [
        el('h3', { text: 'Stats' }),
        el('span.section-note', {
          class: spent > MAX_EV_TOTAL ? 'note-error' : '',
          text: `${spent} / ${MAX_EV_TOTAL} EVs`,
        }),
        el('button.link-btn', {
          onclick: () => { for (const k of STAT_KEYS) set.evs[k] = 0; update(); },
        }, 'reset EVs'),
      ]),
      el('div.stat-legend', {}, [
        el('span', { text: 'Stat' }), el('span', { text: 'Base' }), el('span', { text: '' }),
        el('span', { text: 'Total' }), el('span', { text: 'EVs' }), el('span', { text: '' }), el('span', { text: 'IVs' }),
      ]),
      ...rows,
    ]);
  }

  // ---- Move picker ---------------------------------------------------------

  openMovePicker(set, slot, update) {
    const pool = legalMoves(this.dex, set.species, set.level, this.format).map((id) => this.dex.move(id));
    const species = this.dex.species(set.species);
    const list = el('div.picker-list');
    const state = { query: '', type: 'all', category: 'all', sort: 'power' };

    const render = () => {
      clear(list);
      const shown = pool
        .filter((m) => (state.type === 'all' || m.type === state.type))
        .filter((m) => (state.category === 'all' || m.category === state.category))
        .filter((m) => !state.query || m.name.toLowerCase().includes(state.query))
        .sort((a, b) => (state.sort === 'name'
          ? a.name.localeCompare(b.name)
          : (b.power || 0) - (a.power || 0) || a.name.localeCompare(b.name)));
      if (!shown.length) {
        list.appendChild(el('p.empty-note', { text: 'No moves match those filters.' }));
        return;
      }
      for (const move of shown) {
        const info = moveSummary(move);
        const isStab = species.types.includes(move.type);
        const chosenAt = set.moves.indexOf(move.id);
        list.appendChild(
          el(`button.picker-row${chosenAt >= 0 ? '.is-chosen' : ''}`, {
            style: { borderLeftColor: this.typeChart.color(move.type) },
            onclick: () => {
              // Picking a move already in another slot swaps the two, so you
              // can reorder moves without clearing a slot first.
              if (chosenAt >= 0 && chosenAt !== slot) {
                const existing = set.moves[slot];
                if (existing) set.moves[chosenAt] = existing;
                else set.moves.splice(chosenAt, 1);
              }
              set.moves[slot] = move.id;
              set.moves = set.moves.filter(Boolean);
              close();
              update();
            },
          }, [
            el('span.picker-name', {}, [move.name, isStab ? el('span.stab-tag', { text: 'STAB' }) : null]),
            typeBadge(this.typeChart, move.type),
            categoryBadge(move.category),
            el('span.picker-num', { text: info.power }),
            el('span.picker-num', { text: info.acc }),
            el('span.picker-num', { text: `${info.pp}pp` }),
            el('span.picker-flavor', { text: move.flavor || '' }),
          ])
        );
      }
    };

    const typeSelect = el('select.select', {
      onchange: (e) => { state.type = e.target.value; render(); },
    }, [el('option', { value: 'all', text: 'All types' }),
        ...this.typeChart.types.map((t) => el('option', { value: t, text: t }))]);
    const catSelect = el('select.select', {
      onchange: (e) => { state.category = e.target.value; render(); },
    }, [
      el('option', { value: 'all', text: 'All categories' }),
      el('option', { value: 'physical', text: 'Physical' }),
      el('option', { value: 'special', text: 'Special' }),
      el('option', { value: 'status', text: 'Status' }),
    ]);
    const sortSelect = el('select.select', {
      onchange: (e) => { state.sort = e.target.value; render(); },
    }, [el('option', { value: 'power', text: 'Sort by power' }), el('option', { value: 'name', text: 'Sort by name' })]);
    const search = el('input.input', {
      type: 'search', placeholder: 'Search moves…',
      oninput: (e) => { state.query = e.target.value.toLowerCase(); render(); },
    });

    const close = openModal(`Moves for ${set.nickname || species.name} — slot ${slot + 1}`, [
      el('div.picker-filters', {}, [search, typeSelect, catSelect, sortSelect]),
      list,
      set.moves[slot] ? el('button.btn.btn-ghost', {
        onclick: () => { set.moves.splice(slot, 1); close(); update(); },
      }, 'Clear this slot') : null,
    ], 'modal-wide');
    render();
    search.focus();
  }

  // ---- Saved teams / import-export -----------------------------------------

  openTeamsDialog() {
    const list = el('div.team-list');
    const render = () => {
      clear(list);
      const saved = loadTeams();
      if (!saved.length) {
        list.appendChild(el('p.empty-note', { text: 'No saved teams yet. Save the current one below.' }));
        return;
      }
      for (const record of saved) {
        list.appendChild(el('div.saved-team', {}, [
          el('div.saved-info', {}, [
            el('strong', { text: record.name }),
            el('span.saved-meta', {
              text: `${getFormat(record.format).name} · ${record.team.length} creature${record.team.length === 1 ? '' : 's'}`,
            }),
            el('span.saved-members', {
              text: record.team.map((s) => this.dex.creatures[s.species] ? this.dex.species(s.species).name : '?').join(', '),
            }),
          ]),
          el('div.saved-actions', {}, [
            el('button.btn', {
              onclick: () => {
                this.formatId = getFormat(record.format).id;
                this.team = record.team
                  .map((s) => normalizeSet(this.dex, s, this.format))
                  .filter(Boolean);
                this.teamName = record.name;
                this.nameInput.value = record.name;
                this.selected = 0;
                close();
                this.mount(this.root); // toolbar carries the format select, so re-mount
              },
            }, 'Load'),
            el('button.btn.btn-ghost', {
              onclick: () => { if (confirm(`Delete "${record.name}"?`)) { deleteTeam(record.name); render(); } },
            }, 'Delete'),
          ]),
        ]));
      }
    };

    const close = openModal('Saved Teams', [
      list,
      el('div.modal-actions', {}, [
        el('button.btn.btn-primary', {
          onclick: () => {
            if (!this.team.length) { alert('Nothing to save — the team is empty.'); return; }
            const name = (this.nameInput.value || 'Untitled').trim();
            this.teamName = name;
            upsertTeam(name, this.formatId, this.team);
            render();
          },
        }, `Save current team`),
      ]),
    ]);
    render();
  }

  openImportDialog() {
    const area = el('textarea.import-area', {
      spellcheck: 'false',
      value: this.team.length ? exportTeam(this.dex, this.team) : '',
      placeholder: 'Paste a team here, or copy the exported text out.',
    });
    const feedback = el('div.import-feedback');

    const close = openModal('Import / Export', [
      el('p.note', { text: 'Showdown-style text. Only the species line is required; level, ability, nature, EVs, IVs and moves all fall back to defaults.' }),
      area,
      feedback,
      el('div.modal-actions', {}, [
        el('button.btn', {
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(area.value);
              feedback.textContent = 'Copied to clipboard.';
              feedback.className = 'import-feedback note-ok';
            } catch {
              area.select();
              feedback.textContent = 'Clipboard blocked — the text is selected, press Ctrl/Cmd+C.';
              feedback.className = 'import-feedback note-warn';
            }
          },
        }, 'Copy'),
        el('button.btn.btn-primary', {
          onclick: () => {
            const { team, errors } = importTeam(this.dex, area.value, this.format);
            if (!team.length) {
              feedback.textContent = errors.join(' ') || 'Nothing to import.';
              feedback.className = 'import-feedback note-error';
              return;
            }
            this.team = team;
            this.selected = 0;
            close();
            this.renderAll();
            if (errors.length) alert(`Imported with issues:\n\n${errors.join('\n')}`);
          },
        }, 'Import'),
      ]),
    ]);
  }

  // ---- Battle --------------------------------------------------------------

  startBattle() {
    const { errors, ok } = validateTeam(this.dex, this.team, this.format);
    if (!ok) {
      alert(`This team can't battle yet:\n\n${errors.join('\n')}`);
      return;
    }
    this.onBattle({ team: this.team.map(cloneSet), format: this.format, name: this.teamName });
  }
}

// ---- Modal -----------------------------------------------------------------

// Returns a close() function. Esc, the backdrop and the ✕ all close it; only
// one modal is ever open at a time so a plain module-level reference is enough.
export function openModal(title, children, extraClass = '') {
  const existing = document.querySelector('.modal-backdrop');
  if (existing) existing.remove();

  const body = el('div.modal-body', {}, children);
  const backdrop = el('div.modal-backdrop', {
    onclick: (e) => { if (e.target === backdrop) close(); },
  }, [
    el(`div.modal${extraClass ? '.' + extraClass : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('div.modal-head', {}, [
        el('h2', { text: title }),
        el('button.icon-btn', { onclick: () => close(), 'aria-label': 'Close' }, '✕'),
      ]),
      body,
    ]),
  ]);

  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  function close() {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  }
  document.addEventListener('keydown', onKey);
  document.body.appendChild(backdrop);
  return close;
}

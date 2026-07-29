// editor.js — standalone creature-editor tool (loaded by /game/editor.html).
//
// Edits the full roster: stats, types, learnsets, evolutions, placeholder
// sprite parameters, and text. Persistence model (no build step on this site):
//   - "Save to Browser": stores the whole creatures.json shape in localStorage
//     under CREATURES_OVERRIDE_KEY; the game's dex loader prefers it over the
//     repo file, so edits are playable immediately on the next game reload.
//   - "Download creatures.json": exports the file to commit into the repo,
//     which makes edits permanent for every visitor.
//   - "Reset to Repo File": drops the override.

import { makeCreatureSprite } from './engine/assets.js';
import { CREATURES_OVERRIDE_KEY } from './data/dex.js';

const state = {
  types: null, // types.json
  moves: null, // moves.json .moves
  machines: null, // machines.json .machines
  abilities: null, // abilities.json .abilities
  creatures: null, // { id: def }
  fileComment: '',
  selectedId: null,
  dirty: false,
  overrideActive: false,
};

const $ = (id) => document.getElementById(id);

// ---- Load ----------------------------------------------------------------

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

async function load() {
  const [typesJson, movesJson, machinesJson, abilitiesJson] = await Promise.all([
    fetchJson('data/types.json'),
    fetchJson('data/moves.json'),
    fetchJson('data/machines.json'),
    fetchJson('data/abilities.json'),
  ]);
  state.types = typesJson;
  state.moves = movesJson.moves;
  state.machines = machinesJson.machines;
  state.abilities = abilitiesJson.abilities;

  let creaturesJson = null;
  try {
    const raw = localStorage.getItem(CREATURES_OVERRIDE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.creatures) {
        creaturesJson = parsed;
        state.overrideActive = true;
      }
    }
  } catch { /* fall through to file */ }
  if (!creaturesJson) creaturesJson = await fetchJson('data/creatures.json');

  state.creatures = creaturesJson.creatures;
  state.fileComment = creaturesJson._comment || '';
  state.selectedId = Object.keys(state.creatures)[0] || null;

  buildStaticSelects();
  renderList();
  renderForm();
  updateBadges();
  $('form-empty').hidden = true;
}

// ---- Validation (mirrors the game's dex._validate, plus editor niceties) ---

function validateCreature(id, c) {
  const problems = [];
  if (!c.name || !c.name.trim()) problems.push('Name is empty.');
  if (!Array.isArray(c.types) || c.types.length < 1 || c.types.length > 2) {
    problems.push('Needs 1-2 types.');
  } else {
    for (const t of c.types) if (!state.types.types.includes(t)) problems.push(`Unknown type '${t}'.`);
    if (c.types.length === 2 && c.types[0] === c.types[1]) problems.push('Primary and secondary type are the same.');
  }
  for (const k of ['hp', 'attack', 'defense', 'spAttack', 'spDefense', 'speed']) {
    const v = c.baseStats ? c.baseStats[k] : null;
    if (!Number.isFinite(v) || v < 1 || v > 255) problems.push(`Base ${k} must be 1-255.`);
  }
  if (c.ability && !state.abilities[c.ability]) problems.push(`Unknown ability '${c.ability}'.`);
  if (!Number.isFinite(c.baseExp) || c.baseExp < 1) problems.push('Base EXP must be at least 1.');
  if (!Array.isArray(c.learnset) || !c.learnset.length) {
    problems.push('Learnset is empty.');
  } else {
    for (const e of c.learnset) {
      if (!state.moves[e.move]) problems.push(`Unknown move '${e.move}'.`);
      if (!Number.isFinite(e.level) || e.level < 1 || e.level > 100) problems.push('Learnset levels must be 1-100.');
    }
    if (!c.learnset.some((e) => e.level <= 1)) problems.push('Needs at least one level-1 move (wild low-level creatures would know nothing).');
  }
  if (c.evolvesTo) {
    if (!state.creatures[c.evolvesTo.species]) problems.push(`Evolution target '${c.evolvesTo.species}' does not exist.`);
    if (c.evolvesTo.species === id) problems.push('A creature cannot evolve into itself.');
    if (!Number.isFinite(c.evolvesTo.level) || c.evolvesTo.level < 2 || c.evolvesTo.level > 100) {
      problems.push('Evolution level must be 2-100.');
    }
  }
  if (Array.isArray(c.teachable)) {
    for (const mv of c.teachable) if (!state.moves[mv]) problems.push(`Teachable move '${mv}' is unknown.`);
  }
  return problems;
}

// Effective teachable set: an explicit list wins; otherwise the same
// type-matched default the game computes (machine moves whose type is Normal
// or matches one of the creature's types).
function computedTeachable(c) {
  const out = [];
  for (const mid of Object.keys(state.machines)) {
    const mv = state.moves[state.machines[mid].move];
    if (!mv) continue;
    if (mv.type === 'Normal' || (c.types || []).includes(mv.type)) out.push(state.machines[mid].move);
  }
  return [...new Set(out)];
}

function effectiveTeachable(c) {
  return Array.isArray(c.teachable) ? c.teachable.slice() : computedTeachable(c);
}

function validateAll() {
  const all = [];
  for (const [id, c] of Object.entries(state.creatures)) {
    for (const p of validateCreature(id, c)) all.push(`${c.name || id}: ${p}`);
  }
  if (!Object.values(state.creatures).some((c) => c.starter)) {
    all.push('No creature is marked as a starter — New Game would have nothing to offer.');
  }
  return all;
}

// ---- Sidebar list --------------------------------------------------------

function spriteThumb(def, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const color = state.types.colors[(def.types && def.types[0])] || '#888';
  try {
    const sprite = makeCreatureSprite(def, color);
    sprite.draw(canvas.getContext('2d'), 0, 0, size, size);
  } catch { /* leave blank on bad data */ }
  return canvas;
}

function renderList() {
  const ul = $('creature-list');
  ul.innerHTML = '';
  Object.entries(state.creatures).forEach(([id, c], i) => {
    const li = document.createElement('li');
    li.className = id === state.selectedId ? 'selected' : '';
    li.appendChild(spriteThumb(c, 36));
    const txt = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'li-name';
    name.textContent = `#${String(i + 1).padStart(2, '0')} ${c.name || id}`;
    const sub = document.createElement('div');
    sub.className = 'li-sub';
    sub.textContent = (c.types || []).join('/') + (c.starter ? ' · starter' : '');
    txt.appendChild(name);
    txt.appendChild(sub);
    li.appendChild(txt);
    li.addEventListener('click', () => {
      state.selectedId = id;
      renderList();
      renderForm();
    });
    ul.appendChild(li);
  });
}

// ---- Form ----------------------------------------------------------------

function option(value, label, selected) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  o.selected = !!selected;
  return o;
}

function buildStaticSelects() {
  const t1 = $('f-type1');
  t1.innerHTML = '';
  for (const t of state.types.types) t1.appendChild(option(t, t));
  const t2 = $('f-type2');
  t2.innerHTML = '';
  t2.appendChild(option('', '— none —'));
  for (const t of state.types.types) t2.appendChild(option(t, t));
  const ab = $('f-ability');
  ab.innerHTML = '';
  ab.appendChild(option('', '— none —'));
  for (const id of Object.keys(state.abilities)) ab.appendChild(option(id, state.abilities[id].name));
}

function cur() {
  return state.creatures[state.selectedId];
}

function markDirty() {
  state.dirty = true;
  updateBadges();
}

function refreshAfterEdit({ list = false, preview = false } = {}) {
  markDirty();
  if (list) renderList();
  if (preview) drawPreview();
  renderWarnings();
}

function drawPreview() {
  const c = cur();
  const canvas = $('sprite-preview');
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  const color = state.types.colors[(c.types && c.types[0])] || '#888';
  try {
    makeCreatureSprite(c, color).draw(g, 0, 0, 192, 192);
  } catch { /* bad data mid-edit */ }
}

function renderEvoSelect() {
  const c = cur();
  const sel = $('f-evo');
  sel.innerHTML = '';
  sel.appendChild(option('', '— none —', !c.evolvesTo));
  for (const [id, other] of Object.entries(state.creatures)) {
    if (id === state.selectedId) continue;
    sel.appendChild(option(id, other.name || id, c.evolvesTo && c.evolvesTo.species === id));
  }
  $('f-evolevel').value = c.evolvesTo ? c.evolvesTo.level : '';
  $('f-evolevel').disabled = !c.evolvesTo;
}

function renderLearnset() {
  const c = cur();
  const body = $('learnset-body');
  body.innerHTML = '';
  c.learnset.forEach((entry, idx) => {
    const tr = document.createElement('tr');

    const tdLevel = document.createElement('td');
    const lvl = document.createElement('input');
    lvl.type = 'number';
    lvl.min = 1;
    lvl.max = 100;
    lvl.value = entry.level;
    lvl.addEventListener('change', () => {
      entry.level = Math.max(1, Math.min(100, Number(lvl.value) || 1));
      c.learnset.sort((a, b) => a.level - b.level);
      renderLearnset();
      refreshAfterEdit({});
    });
    tdLevel.appendChild(lvl);

    const tdMove = document.createElement('td');
    const sel = document.createElement('select');
    for (const [mid, mv] of Object.entries(state.moves)) {
      sel.appendChild(option(mid, mv.name, mid === entry.move));
    }
    sel.addEventListener('change', () => {
      entry.move = sel.value;
      renderLearnset();
      refreshAfterEdit({});
    });
    tdMove.appendChild(sel);

    const mv = state.moves[entry.move] || {};
    const tdType = document.createElement('td');
    tdType.className = 'mv-type';
    tdType.textContent = mv.type || '?';
    tdType.style.color = state.types.colors[mv.type] || '#8a93a6';
    const tdPwr = document.createElement('td');
    tdPwr.className = 'mv-pwr';
    tdPwr.textContent = mv.power != null ? mv.power : '—';

    const tdDel = document.createElement('td');
    const del = document.createElement('button');
    del.textContent = 'remove';
    del.addEventListener('click', () => {
      c.learnset.splice(idx, 1);
      renderLearnset();
      refreshAfterEdit({});
    });
    tdDel.appendChild(del);

    tr.appendChild(tdLevel);
    tr.appendChild(tdMove);
    tr.appendChild(tdType);
    tr.appendChild(tdPwr);
    tr.appendChild(tdDel);
    body.appendChild(tr);
  });
}

function renderTeachable() {
  const c = cur();
  const note = $('teachable-note');
  note.textContent = Array.isArray(c.teachable)
    ? 'Custom compatibility list.'
    : 'Using the type-matched default — toggle any box to start a custom list.';
  const div = $('teachable-list');
  div.innerHTML = '';
  const eff = new Set(effectiveTeachable(c));
  const orderedMoves = [...new Set(Object.values(state.machines).map((m) => m.move))];
  for (const mid of Object.keys(state.machines)) {
    const mach = state.machines[mid];
    const mv = state.moves[mach.move] || {};
    const label = document.createElement('label');
    label.className = 'teachable-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = eff.has(mach.move);
    cb.addEventListener('change', () => {
      const set = new Set(effectiveTeachable(c));
      if (cb.checked) set.add(mach.move);
      else set.delete(mach.move);
      c.teachable = orderedMoves.filter((mvId) => set.has(mvId)); // materialize explicit list
      refreshAfterEdit({});
      renderTeachable();
    });
    const span = document.createElement('span');
    span.textContent = `${mach.name} `;
    const em = document.createElement('em');
    em.textContent = mv.type || '?';
    em.style.color = state.types.colors[mv.type] || '#8a93a6';
    span.appendChild(em);
    label.appendChild(cb);
    label.appendChild(span);
    div.appendChild(label);
  }
}

function renderWarnings() {
  const div = $('form-warnings');
  div.innerHTML = '';
  for (const p of validateCreature(state.selectedId, cur())) {
    const w = document.createElement('div');
    w.className = 'warning';
    w.textContent = p;
    div.appendChild(w);
  }
}

function renderForm() {
  const c = cur();
  if (!c) { $('form').hidden = true; return; }
  $('form').hidden = false;

  $('f-id').value = state.selectedId;
  $('f-name').value = c.name || '';
  $('f-starter').checked = !!c.starter;
  $('f-type1').value = c.types[0] || 'Normal';
  $('f-type2').value = c.types[1] || '';
  $('f-ability').value = c.ability || '';
  $('ability-desc').textContent = c.ability && state.abilities[c.ability] ? state.abilities[c.ability].desc : '';
  $('f-hp').value = c.baseStats.hp;
  $('f-attack').value = c.baseStats.attack;
  $('f-defense').value = c.baseStats.defense;
  $('f-spattack').value = c.baseStats.spAttack;
  $('f-spdefense').value = c.baseStats.spDefense;
  $('f-speed').value = c.baseStats.speed;
  $('f-baseexp').value = c.baseExp;
  $('f-shape').value = c.shape || 'circle';
  $('f-glyph').value = c.glyph || '';
  $('f-accent').value = /^#[0-9a-fA-F]{6}$/.test(c.accent || '') ? c.accent : '#888888';
  $('f-flavor').value = c.flavor || '';
  $('f-entry').value = c.entry || '';

  renderEvoSelect();
  renderLearnset();
  renderTeachable();
  drawPreview();
  renderWarnings();
}

// ---- Field wiring --------------------------------------------------------

function wireForm() {
  $('f-name').addEventListener('input', () => { cur().name = $('f-name').value; refreshAfterEdit({ list: true }); });
  $('f-starter').addEventListener('change', () => {
    if ($('f-starter').checked) cur().starter = true;
    else delete cur().starter;
    refreshAfterEdit({ list: true });
  });
  $('f-type1').addEventListener('change', () => {
    const c = cur();
    c.types[0] = $('f-type1').value;
    refreshAfterEdit({ list: true, preview: true });
  });
  $('f-type2').addEventListener('change', () => {
    const c = cur();
    const v = $('f-type2').value;
    if (v) c.types = [c.types[0], v];
    else c.types = [c.types[0]];
    refreshAfterEdit({ list: true });
  });
  for (const [fid, key] of [['f-hp', 'hp'], ['f-attack', 'attack'], ['f-defense', 'defense'], ['f-spattack', 'spAttack'], ['f-spdefense', 'spDefense'], ['f-speed', 'speed']]) {
    $(fid).addEventListener('change', () => {
      cur().baseStats[key] = Number($(fid).value) || 1;
      refreshAfterEdit({});
    });
  }
  $('f-ability').addEventListener('change', () => {
    const v = $('f-ability').value;
    if (v) cur().ability = v;
    else delete cur().ability;
    $('ability-desc').textContent = v && state.abilities[v] ? state.abilities[v].desc : '';
    refreshAfterEdit({});
  });
  $('f-baseexp').addEventListener('change', () => { cur().baseExp = Number($('f-baseexp').value) || 1; refreshAfterEdit({}); });
  $('f-shape').addEventListener('change', () => { cur().shape = $('f-shape').value; refreshAfterEdit({ list: true, preview: true }); });
  $('f-glyph').addEventListener('input', () => { cur().glyph = $('f-glyph').value; refreshAfterEdit({ list: true, preview: true }); });
  $('f-accent').addEventListener('input', () => { cur().accent = $('f-accent').value; refreshAfterEdit({ list: true, preview: true }); });
  $('f-flavor').addEventListener('input', () => { cur().flavor = $('f-flavor').value; refreshAfterEdit({}); });
  $('f-entry').addEventListener('input', () => { cur().entry = $('f-entry').value; refreshAfterEdit({}); });

  $('f-evo').addEventListener('change', () => {
    const c = cur();
    const v = $('f-evo').value;
    if (v) c.evolvesTo = { species: v, level: c.evolvesTo ? c.evolvesTo.level : 16 };
    else delete c.evolvesTo;
    renderEvoSelect();
    refreshAfterEdit({});
  });
  $('f-evolevel').addEventListener('change', () => {
    const c = cur();
    if (c.evolvesTo) c.evolvesTo.level = Math.max(2, Math.min(100, Number($('f-evolevel').value) || 16));
    refreshAfterEdit({});
  });

  $('btn-add-move').addEventListener('click', () => {
    const c = cur();
    const firstMove = Object.keys(state.moves)[0];
    c.learnset.push({ level: 1, move: firstMove });
    c.learnset.sort((a, b) => a.level - b.level);
    renderLearnset();
    refreshAfterEdit({});
  });
}

// ---- Top bar actions -----------------------------------------------------

function creaturesFileShape() {
  return { _comment: state.fileComment, creatures: state.creatures };
}

function wireTopbar() {
  $('btn-save').addEventListener('click', () => {
    const problems = validateAll();
    if (problems.length) {
      alert('Fix these before saving:\n\n' + problems.join('\n'));
      return;
    }
    localStorage.setItem(CREATURES_OVERRIDE_KEY, JSON.stringify(creaturesFileShape()));
    state.dirty = false;
    state.overrideActive = true;
    updateBadges();
  });

  $('btn-download').addEventListener('click', () => {
    const problems = validateAll();
    if (problems.length && !confirm('There are validation problems:\n\n' + problems.join('\n') + '\n\nDownload anyway?')) {
      return;
    }
    const blob = new Blob([JSON.stringify(creaturesFileShape(), null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'creatures.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('btn-reset').addEventListener('click', async () => {
    if (!confirm('Discard the browser override and reload the repo file? Unsaved edits are lost.')) return;
    localStorage.removeItem(CREATURES_OVERRIDE_KEY);
    state.overrideActive = false;
    state.dirty = false;
    const fileJson = await fetchJson('data/creatures.json');
    state.creatures = fileJson.creatures;
    state.fileComment = fileJson._comment || '';
    if (!state.creatures[state.selectedId]) state.selectedId = Object.keys(state.creatures)[0];
    renderList();
    renderForm();
    updateBadges();
  });

  $('btn-new').addEventListener('click', () => {
    const id = promptForId('New creature id (lowercase letters/underscores, e.g. "glimmerfox"):');
    if (!id) return;
    state.creatures[id] = {
      name: id.charAt(0).toUpperCase() + id.slice(1),
      types: ['Normal'],
      baseStats: { hp: 50, attack: 50, defense: 50, spAttack: 50, spDefense: 50, speed: 50 },
      baseExp: 60,
      learnset: [{ level: 1, move: Object.keys(state.moves)[0] }],
      shape: 'circle',
      glyph: id.charAt(0).toUpperCase(),
      accent: '#cccccc',
      flavor: '',
      entry: '',
    };
    state.selectedId = id;
    renderList();
    renderForm();
    markDirty();
  });

  $('btn-dupe').addEventListener('click', () => {
    const id = promptForId(`Duplicate '${state.selectedId}' as (new id):`);
    if (!id) return;
    state.creatures[id] = JSON.parse(JSON.stringify(cur()));
    state.creatures[id].name += ' Copy';
    delete state.creatures[id].starter;
    state.selectedId = id;
    renderList();
    renderForm();
    markDirty();
  });

  $('btn-delete').addEventListener('click', () => {
    const id = state.selectedId;
    const referencedBy = Object.entries(state.creatures)
      .filter(([oid, c]) => oid !== id && c.evolvesTo && c.evolvesTo.species === id)
      .map(([, c]) => c.name);
    if (referencedBy.length) {
      alert(`Can't delete: ${referencedBy.join(', ')} evolve(s) into this creature. Change their evolution first.`);
      return;
    }
    if (!confirm(`Delete '${cur().name}'?\n\nNote: if any map encounter table or trainer party in data/maps/*.json references '${id}', the game will error — check those files too.`)) {
      return;
    }
    delete state.creatures[id];
    state.selectedId = Object.keys(state.creatures)[0] || null;
    renderList();
    renderForm();
    markDirty();
  });
}

function promptForId(message) {
  const raw = prompt(message);
  if (raw == null) return null;
  const id = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,30}$/.test(id)) {
    alert('Invalid id: use lowercase letters, digits, underscores; start with a letter.');
    return null;
  }
  if (state.creatures[id]) {
    alert(`'${id}' already exists.`);
    return null;
  }
  return id;
}

function updateBadges() {
  $('override-badge').hidden = !state.overrideActive;
  $('dirty-badge').hidden = !state.dirty;
}

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

// ---- Go ------------------------------------------------------------------

wireForm();
wireTopbar();
load().catch((e) => {
  $('form-empty').textContent = `Failed to load: ${e.message} (serve over http://, not file://)`;
});

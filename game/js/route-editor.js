// route-editor.js — standalone map/route editor (loaded by route-editor.html).
//
// Edits each shipped map: tile layout (paint), player start, wild-encounter
// table, NPCs/trainers, and warps. Persistence mirrors the creature editor:
//   - "Save to Browser": writes all working maps to MAPS_OVERRIDE_KEY; the
//     game's loadMap() prefers the override so edited routes are playable now.
//   - "Download this map": exports one map's JSON to commit into the repo.
//   - "Reset to Repo Files": drops the override.
//
// Encounter model (baseline): every tall-grass tile on a map shares that map's
// single weighted table. Per-patch tables are a planned next step.

import { makeTileSprite } from './engine/assets.js';
import { TILE_DEFS, MAPS_OVERRIDE_KEY, loadMapOverrides } from './engine/tilemap.js';
import { CREATURES_OVERRIDE_KEY } from './data/dex.js';

const TILE_RENDER = 26; // px per tile in the editor grid

const state = {
  creatures: null, // { id: def }
  items: null, // { id: def }
  machines: null, // { id: def }
  mapIds: [],
  maps: {}, // id -> working copy of map json
  currentId: null,
  selectedTile: 3, // palette selection (default tall grass)
  painting: false,
  dirty: false,
  overrideActive: false,
};

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));

async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

// ---- Load ----------------------------------------------------------------

async function loadCreatures() {
  try {
    const raw = localStorage.getItem(CREATURES_OVERRIDE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.creatures) return parsed.creatures;
    }
  } catch { /* fall through */ }
  return (await fetchJson('data/creatures.json')).creatures;
}

async function load() {
  const [creatures, itemsJson, machinesJson, indexJson] = await Promise.all([
    loadCreatures(),
    fetchJson('data/items.json'),
    fetchJson('data/machines.json'),
    fetchJson('data/maps/index.json'),
  ]);
  state.creatures = creatures;
  state.items = itemsJson.items;
  state.machines = machinesJson.machines;
  state.mapIds = indexJson.maps;

  const overrides = loadMapOverrides();
  state.overrideActive = Object.keys(overrides).length > 0;
  // Maps created in the editor exist only in the override — include them.
  for (const oid of Object.keys(overrides)) {
    if (!state.mapIds.includes(oid) && overrides[oid] && overrides[oid].tiles) state.mapIds.push(oid);
  }
  for (const id of state.mapIds) {
    if (overrides[id] && overrides[id].tiles) state.maps[id] = clone(overrides[id]);
    else state.maps[id] = await fetchJson(`data/maps/${id}.json`);
  }
  state.currentId = state.mapIds[0];

  buildPalette();
  buildMapSelect();
  renderAll();
  updateBadges();
  $('form-empty').hidden = true;
  $('form').hidden = false;
}

// ---- Tile sprites / palette ----------------------------------------------

const _tileSpriteCache = {};
function tileSprite(id) {
  if (!(id in _tileSpriteCache)) {
    _tileSpriteCache[id] = makeTileSprite(TILE_DEFS[id] || TILE_DEFS[0]);
  }
  return _tileSpriteCache[id];
}

function tileSwatch(id, size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  tileSprite(id).draw(c.getContext('2d'), 0, 0, size, size);
  return c;
}

function buildPalette() {
  const wrap = $('palette');
  wrap.innerHTML = '';
  for (const id of Object.keys(TILE_DEFS)) {
    const def = TILE_DEFS[id];
    const el = document.createElement('div');
    el.className = 'palette-tile' + (Number(id) === state.selectedTile ? ' selected' : '');
    el.appendChild(tileSwatch(Number(id), 24));
    const txt = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'pt-name';
    name.textContent = def.name;
    const flag = document.createElement('div');
    flag.className = 'pt-flag';
    flag.textContent = (def.walkable ? 'walk' : 'solid') + (def.encounter ? ' · grass' : '');
    txt.appendChild(name);
    txt.appendChild(flag);
    el.appendChild(txt);
    el.addEventListener('click', () => {
      state.selectedTile = Number(id);
      buildPalette();
      $('palette-selected').textContent = `Painting: ${def.name}`;
    });
    wrap.appendChild(el);
  }
  const cur = TILE_DEFS[state.selectedTile];
  $('palette-selected').textContent = cur ? `Painting: ${cur.name}` : '';
}

function buildMapSelect() {
  const sel = $('map-select');
  sel.innerHTML = '';
  for (const id of state.mapIds) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = `${id} — ${state.maps[id].name || ''}`;
    o.selected = id === state.currentId;
    sel.appendChild(o);
  }
  sel.onchange = () => {
    state.currentId = sel.value;
    renderAll();
  };
}

// ---- Current map accessors -----------------------------------------------

function map() {
  return state.maps[state.currentId];
}

function markDirty() {
  state.dirty = true;
  updateBadges();
}

// ---- Grid rendering + painting -------------------------------------------

function drawGrid() {
  const m = map();
  const canvas = $('grid');
  canvas.width = m.width * TILE_RENDER;
  canvas.height = m.height * TILE_RENDER;
  const g = canvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      const id = m.tiles[y][x];
      tileSprite(id).draw(g, x * TILE_RENDER, y * TILE_RENDER, TILE_RENDER, TILE_RENDER);
    }
  }
  // overlays
  g.font = `bold ${Math.floor(TILE_RENDER * 0.6)}px monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const marker = (x, y, ch, color) => {
    const cx = x * TILE_RENDER + TILE_RENDER / 2;
    const cy = y * TILE_RENDER + TILE_RENDER / 2;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillText(ch, cx + 1, cy + 1);
    g.fillStyle = color;
    g.fillText(ch, cx, cy);
  };
  for (const w of m.warps || []) marker(w.x, w.y, 'W', '#7ec8ff');
  for (const n of m.npcs || []) marker(n.x, n.y, n.trainer ? 'T' : 'N', n.trainer ? '#ff8a5c' : '#ffe08a');
  if (m.playerStart) marker(m.playerStart.x, m.playerStart.y, '★', '#7dff9e');
  // grid lines
  g.strokeStyle = 'rgba(0,0,0,0.15)';
  g.lineWidth = 1;
  for (let x = 0; x <= m.width; x++) { g.beginPath(); g.moveTo(x * TILE_RENDER, 0); g.lineTo(x * TILE_RENDER, canvas.height); g.stroke(); }
  for (let y = 0; y <= m.height; y++) { g.beginPath(); g.moveTo(0, y * TILE_RENDER); g.lineTo(canvas.width, y * TILE_RENDER); g.stroke(); }
}

function paintAt(clientX, clientY) {
  const canvas = $('grid');
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.floor(((clientX - rect.left) * scaleX) / TILE_RENDER);
  const y = Math.floor(((clientY - rect.top) * scaleY) / TILE_RENDER);
  const m = map();
  if (x < 0 || y < 0 || x >= m.width || y >= m.height) return;
  if (m.tiles[y][x] === state.selectedTile) return;
  m.tiles[y][x] = state.selectedTile;
  markDirty();
  drawGrid();
  renderWarnings();
}

function wireGrid() {
  const canvas = $('grid');
  canvas.addEventListener('mousedown', (e) => { state.painting = true; paintAt(e.clientX, e.clientY); });
  canvas.addEventListener('mousemove', (e) => { if (state.painting) paintAt(e.clientX, e.clientY); });
  window.addEventListener('mouseup', () => { state.painting = false; });
  canvas.addEventListener('mouseleave', () => { state.painting = false; });
}

// ---- Dimension resizing --------------------------------------------------

function resizeMap(newW, newH) {
  const m = map();
  newW = Math.max(3, Math.min(40, newW));
  newH = Math.max(3, Math.min(40, newH));
  const tiles = [];
  for (let y = 0; y < newH; y++) {
    const row = [];
    for (let x = 0; x < newW; x++) {
      row.push(y < m.height && x < m.width ? m.tiles[y][x] : 0);
    }
    tiles.push(row);
  }
  m.tiles = tiles;
  m.width = newW;
  m.height = newH;
  if (m.playerStart) {
    m.playerStart.x = Math.min(m.playerStart.x, newW - 1);
    m.playerStart.y = Math.min(m.playerStart.y, newH - 1);
  }
  markDirty();
}

// ---- Small builders ------------------------------------------------------

function option(value, label, selected) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  o.selected = !!selected;
  return o;
}

function speciesSelect(selected, onChange) {
  const sel = document.createElement('select');
  for (const id of Object.keys(state.creatures)) {
    sel.appendChild(option(id, state.creatures[id].name || id, id === selected));
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function numInput(value, { min, max, step, width } = {}, onChange) {
  const inp = document.createElement('input');
  inp.type = 'number';
  if (min != null) inp.min = min;
  if (max != null) inp.max = max;
  if (step != null) inp.step = step;
  if (width) inp.style.width = width;
  inp.value = value;
  inp.addEventListener('change', () => onChange(Number(inp.value)));
  return inp;
}

// ---- Identity + player start ---------------------------------------------

function renderIdentity() {
  const m = map();
  $('f-id').value = state.currentId;
  $('f-name').value = m.name || '';
  $('f-width').value = m.width;
  $('f-height').value = m.height;
  $('f-startx').value = m.playerStart ? m.playerStart.x : 0;
  $('f-starty').value = m.playerStart ? m.playerStart.y : 0;
  $('f-startfacing').value = m.playerStart ? (m.playerStart.facing || 'down') : 'down';
}

// ---- Encounters ----------------------------------------------------------

function renderEncounters() {
  const m = map();
  if (!m.encounter) m.encounter = { rate: 0, table: [] };
  $('f-rate').value = m.encounter.rate || 0;
  const body = $('enc-body');
  body.innerHTML = '';
  const table = m.encounter.table || (m.encounter.table = []);
  const total = table.reduce((s, e) => s + (e.weight || 0), 0) || 1;
  table.forEach((entry, idx) => {
    const tr = document.createElement('tr');

    const tdSpecies = document.createElement('td');
    tdSpecies.appendChild(speciesSelect(entry.species, (v) => { entry.species = v; markDirty(); renderWarnings(); drawGrid(); }));
    tr.appendChild(tdSpecies);

    const tdMin = document.createElement('td');
    tdMin.appendChild(numInput(entry.min, { min: 1, max: 100 }, (v) => { entry.min = v; markDirty(); }));
    tr.appendChild(tdMin);

    const tdMax = document.createElement('td');
    tdMax.appendChild(numInput(entry.max, { min: 1, max: 100 }, (v) => { entry.max = v; markDirty(); }));
    tr.appendChild(tdMax);

    const tdWeight = document.createElement('td');
    tdWeight.appendChild(numInput(entry.weight, { min: 0, max: 999 }, (v) => { entry.weight = v; markDirty(); renderEncounters(); }));
    tr.appendChild(tdWeight);

    const tdChance = document.createElement('td');
    tdChance.className = 'enc-chance';
    tdChance.textContent = `${Math.round(((entry.weight || 0) / total) * 100)}%`;
    tr.appendChild(tdChance);

    const tdDel = document.createElement('td');
    const del = document.createElement('button');
    del.textContent = 'remove';
    del.addEventListener('click', () => { table.splice(idx, 1); markDirty(); renderEncounters(); renderWarnings(); });
    tdDel.appendChild(del);
    tr.appendChild(tdDel);

    body.appendChild(tr);
  });
}

// ---- Encounter zones (per-patch tables) ------------------------------------

// Small reusable encounter-table editor bound to `table` (array of entries).
function encTableEl(table, onChanged) {
  const wrap = document.createElement('div');
  const tbl = document.createElement('table');
  tbl.className = 'zone-enc';
  tbl.style.borderCollapse = 'collapse';
  const body = document.createElement('tbody');
  const total = table.reduce((s, e) => s + (e.weight || 0), 0) || 1;
  table.forEach((entry, idx) => {
    const tr = document.createElement('tr');
    const cell = (child) => { const td = document.createElement('td'); td.style.padding = '2px 8px 2px 0'; td.appendChild(child); tr.appendChild(td); };
    cell(speciesSelect(entry.species, (v) => { entry.species = v; onChanged(); }));
    cell(numInput(entry.min, { min: 1, max: 100 }, (v) => { entry.min = v; onChanged(); }));
    cell(numInput(entry.max, { min: 1, max: 100 }, (v) => { entry.max = v; onChanged(); }));
    cell(numInput(entry.weight, { min: 0, max: 999 }, (v) => { entry.weight = v; onChanged(true); }));
    const pct = document.createElement('span');
    pct.className = 'enc-chance';
    pct.textContent = `${Math.round(((entry.weight || 0) / total) * 100)}%`;
    cell(pct);
    const del = document.createElement('button');
    del.textContent = 'remove';
    del.addEventListener('click', () => { table.splice(idx, 1); onChanged(true); });
    cell(del);
    body.appendChild(tr);
  });
  tbl.appendChild(body);
  wrap.appendChild(tbl);
  const add = document.createElement('button');
  add.textContent = '+ Add creature';
  add.addEventListener('click', () => {
    table.push({ species: Object.keys(state.creatures)[0], min: 2, max: 4, weight: 10 });
    onChanged(true);
  });
  wrap.appendChild(add);
  return wrap;
}

function renderZones() {
  const m = map();
  if (!m.zones) m.zones = [];
  const wrap = $('zone-list');
  wrap.innerHTML = '';
  m.zones.forEach((zone, idx) => {
    const card = document.createElement('div');
    card.className = 'npc-card';
    const head = document.createElement('div');
    head.className = 'npc-head';
    const title = document.createElement('strong');
    title.textContent = `Zone ${idx + 1}`;
    head.appendChild(title);
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'delete zone';
    del.addEventListener('click', () => { m.zones.splice(idx, 1); markDirty(); renderZones(); renderWarnings(); });
    head.appendChild(del);
    card.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'grid';
    const bind = (label, key, opts) => {
      const l = document.createElement('label');
      l.textContent = label;
      l.appendChild(numInput(zone[key], opts, (v) => { zone[key] = v; markDirty(); renderWarnings(); }));
      grid.appendChild(l);
    };
    bind('X', 'x', { min: 0 });
    bind('Y', 'y', { min: 0 });
    bind('W', 'w', { min: 1 });
    bind('H', 'h', { min: 1 });
    bind('Rate', 'rate', { min: 0, max: 1, step: 0.01 });
    card.appendChild(grid);

    if (!zone.table) zone.table = [];
    card.appendChild(encTableEl(zone.table, (rerender) => { markDirty(); renderWarnings(); if (rerender) renderZones(); }));
    wrap.appendChild(card);
  });
}

// ---- NPCs / trainers -----------------------------------------------------

function renderNpcs() {
  const m = map();
  if (!m.npcs) m.npcs = [];
  const wrap = $('npc-list');
  wrap.innerHTML = '';
  m.npcs.forEach((npc, idx) => wrap.appendChild(npcCard(npc, idx)));
}

function labeledInput(labelText, value, oninput, opts = {}) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const inp = document.createElement('input');
  inp.type = opts.type || 'text';
  if (opts.min != null) inp.min = opts.min;
  inp.value = value != null ? value : '';
  inp.addEventListener('input', () => oninput(opts.type === 'number' ? Number(inp.value) : inp.value));
  label.appendChild(inp);
  return label;
}

function linesTextarea(labelText, arr, onchange) {
  const label = document.createElement('label');
  label.className = 'wide';
  label.textContent = labelText;
  const ta = document.createElement('textarea');
  ta.className = 'lines';
  ta.rows = Math.max(2, (arr || []).length);
  ta.value = (arr || []).join('\n');
  ta.addEventListener('change', () => onchange(ta.value.split('\n').map((s) => s.trim()).filter(Boolean)));
  label.appendChild(ta);
  return label;
}

function npcCard(npc, idx) {
  const m = map();
  const card = document.createElement('div');
  card.className = 'npc-card';

  const head = document.createElement('div');
  head.className = 'npc-head';
  const title = document.createElement('strong');
  title.textContent = `${npc.trainer ? 'Trainer' : 'NPC'}: ${npc.name || npc.id || '(unnamed)'}`;
  head.appendChild(title);
  const del = document.createElement('button');
  del.className = 'danger';
  del.textContent = 'delete NPC';
  del.addEventListener('click', () => { m.npcs.splice(idx, 1); markDirty(); renderNpcs(); drawGrid(); });
  head.appendChild(del);
  card.appendChild(head);

  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.appendChild(labeledInput('Name', npc.name, (v) => { npc.name = v; markDirty(); renderNpcs(); drawGrid(); }));
  grid.appendChild(labeledInput('Sprite', npc.sprite, (v) => { npc.sprite = v; markDirty(); }));
  grid.appendChild(labeledInput('X', npc.x, (v) => { npc.x = v; markDirty(); drawGrid(); }, { type: 'number', min: 0 }));
  grid.appendChild(labeledInput('Y', npc.y, (v) => { npc.y = v; markDirty(); drawGrid(); }, { type: 'number', min: 0 }));
  const facing = document.createElement('label');
  facing.textContent = 'Facing';
  const fsel = document.createElement('select');
  for (const f of ['down', 'up', 'left', 'right']) fsel.appendChild(option(f, f, (npc.facing || 'down') === f));
  fsel.addEventListener('change', () => { npc.facing = fsel.value; markDirty(); });
  facing.appendChild(fsel);
  grid.appendChild(facing);
  card.appendChild(grid);

  card.appendChild(linesTextarea('Dialogue (one line per row)', npc.dialogue, (lines) => { npc.dialogue = lines; markDirty(); }));

  const healLabel = document.createElement('label');
  healLabel.className = 'check';
  const healCb = document.createElement('input');
  healCb.type = 'checkbox';
  healCb.checked = !!npc.healsParty;
  healCb.addEventListener('change', () => { if (healCb.checked) npc.healsParty = true; else delete npc.healsParty; markDirty(); });
  healLabel.appendChild(healCb);
  healLabel.appendChild(document.createTextNode(' Heals party on talk'));
  card.appendChild(healLabel);

  const storageLabel = document.createElement('label');
  storageLabel.className = 'check';
  const storageCb = document.createElement('input');
  storageCb.type = 'checkbox';
  storageCb.checked = !!npc.storage;
  storageCb.addEventListener('change', () => { if (storageCb.checked) npc.storage = true; else delete npc.storage; markDirty(); });
  storageLabel.appendChild(storageCb);
  storageLabel.appendChild(document.createTextNode(' Opens creature storage (PC box) after dialogue'));
  card.appendChild(storageLabel);

  const shopLabel = document.createElement('label');
  shopLabel.className = 'check';
  const shopCb = document.createElement('input');
  shopCb.type = 'checkbox';
  shopCb.checked = Array.isArray(npc.shop);
  shopCb.addEventListener('change', () => {
    if (shopCb.checked) npc.shop = Object.keys(state.items);
    else delete npc.shop;
    markDirty();
    renderNpcs();
  });
  shopLabel.appendChild(shopCb);
  shopLabel.appendChild(document.createTextNode(' Runs a shop after dialogue'));
  card.appendChild(shopLabel);
  if (Array.isArray(npc.shop)) {
    const shopGrid = document.createElement('div');
    shopGrid.className = 'grid';
    shopGrid.style.marginLeft = '24px';
    for (const itemId of Object.keys(state.items)) {
      const l = document.createElement('label');
      l.className = 'check';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = npc.shop.includes(itemId);
      cb.addEventListener('change', () => {
        if (cb.checked) npc.shop = [...new Set([...npc.shop, itemId])];
        else npc.shop = npc.shop.filter((i) => i !== itemId);
        markDirty();
      });
      l.appendChild(cb);
      l.appendChild(document.createTextNode(` ${state.items[itemId].name} (${state.items[itemId].price}c)`));
      shopGrid.appendChild(l);
    }
    card.appendChild(shopGrid);
  }

  const trainerLabel = document.createElement('label');
  trainerLabel.className = 'check';
  const trainerCb = document.createElement('input');
  trainerCb.type = 'checkbox';
  trainerCb.checked = !!npc.trainer;
  trainerCb.addEventListener('change', () => {
    if (trainerCb.checked) {
      npc.trainer = { defeatFlag: `defeated_${npc.id || 'trainer'}`, party: [{ species: Object.keys(state.creatures)[0], level: 5 }], reward: { item: Object.keys(state.items)[0], qty: 1 }, outro: [], postDialogue: [] };
    } else delete npc.trainer;
    markDirty();
    renderNpcs();
    drawGrid();
  });
  trainerLabel.appendChild(trainerCb);
  trainerLabel.appendChild(document.createTextNode(' Is a trainer (battles on talk)'));
  card.appendChild(trainerLabel);

  if (npc.trainer) card.appendChild(trainerBlock(npc));
  return card;
}

function trainerBlock(npc) {
  const t = npc.trainer;
  const block = document.createElement('div');
  block.className = 'npc-trainer-block';
  const h = document.createElement('h4');
  h.textContent = 'Trainer battle';
  block.appendChild(h);

  const idGrid = document.createElement('div');
  idGrid.className = 'grid';
  idGrid.appendChild(labeledInput('Defeat flag', t.defeatFlag, (v) => { t.defeatFlag = v; markDirty(); }));
  idGrid.appendChild(labeledInput('Badge (blank = none)', t.badge || '', (v) => { if (v) t.badge = v; else delete t.badge; markDirty(); }));
  block.appendChild(idGrid);

  const rivalLabel = document.createElement('label');
  rivalLabel.className = 'check';
  const rivalCb = document.createElement('input');
  rivalCb.type = 'checkbox';
  rivalCb.checked = !!t.rival;
  rivalCb.addEventListener('change', () => {
    if (rivalCb.checked) { t.rival = true; if (!t.rivalLevel) t.rivalLevel = 9; }
    else { delete t.rival; delete t.rivalLevel; }
    markDirty();
    renderNpcs();
  });
  rivalLabel.appendChild(rivalCb);
  rivalLabel.appendChild(document.createTextNode(' Rival (party auto-counters the player’s starter)'));
  block.appendChild(rivalLabel);
  if (t.rival) {
    const lvlGrid = document.createElement('div');
    lvlGrid.className = 'grid';
    const l = document.createElement('label');
    l.textContent = 'Rival level';
    l.appendChild(numInput(t.rivalLevel || 9, { min: 1, max: 100 }, (v) => { t.rivalLevel = v; markDirty(); }));
    lvlGrid.appendChild(l);
    block.appendChild(lvlGrid);
  }

  const partyLabel = document.createElement('div');
  partyLabel.className = 'hint';
  partyLabel.textContent = 'Party (sent out in order):';
  block.appendChild(partyLabel);
  if (!t.party) t.party = [];
  t.party.forEach((member, i) => {
    const row = document.createElement('div');
    row.className = 'party-row';
    row.appendChild(speciesSelect(member.species, (v) => { member.species = v; markDirty(); }));
    row.appendChild(numInput(member.level, { min: 1, max: 100 }, (v) => { member.level = v; markDirty(); }));
    const del = document.createElement('button');
    del.textContent = 'remove';
    del.addEventListener('click', () => { t.party.splice(i, 1); markDirty(); renderNpcs(); });
    row.appendChild(del);
    block.appendChild(row);
  });
  const addMon = document.createElement('button');
  addMon.textContent = '+ Add creature';
  addMon.addEventListener('click', () => { t.party.push({ species: Object.keys(state.creatures)[0], level: 5 }); markDirty(); renderNpcs(); });
  block.appendChild(addMon);

  // Reward
  if (!t.reward) t.reward = {};
  const rewardGrid = document.createElement('div');
  rewardGrid.className = 'grid';
  rewardGrid.style.marginTop = '10px';
  const itemLabel = document.createElement('label');
  itemLabel.textContent = 'Reward item';
  const itemSel = document.createElement('select');
  itemSel.appendChild(option('', '— none —', !t.reward.item));
  for (const id of Object.keys(state.items)) itemSel.appendChild(option(id, state.items[id].name, t.reward.item === id));
  itemSel.addEventListener('change', () => { if (itemSel.value) t.reward.item = itemSel.value; else delete t.reward.item; markDirty(); });
  itemLabel.appendChild(itemSel);
  rewardGrid.appendChild(itemLabel);
  rewardGrid.appendChild(numInput(t.reward.qty || 1, { min: 1, max: 99 }, (v) => { t.reward.qty = v; markDirty(); }));
  const machLabel = document.createElement('label');
  machLabel.textContent = 'Reward TM/HM';
  const machSel = document.createElement('select');
  machSel.appendChild(option('', '— none —', !t.reward.machine));
  for (const id of Object.keys(state.machines)) machSel.appendChild(option(id, state.machines[id].name, t.reward.machine === id));
  machSel.addEventListener('change', () => { if (machSel.value) t.reward.machine = machSel.value; else delete t.reward.machine; markDirty(); });
  machLabel.appendChild(machSel);
  rewardGrid.appendChild(machLabel);
  const moneyLabel = document.createElement('label');
  moneyLabel.textContent = 'Money payout';
  moneyLabel.appendChild(numInput(t.reward.money != null ? t.reward.money : 0, { min: 0, max: 99999 }, (v) => { t.reward.money = v; markDirty(); }));
  rewardGrid.appendChild(moneyLabel);
  block.appendChild(rewardGrid);

  block.appendChild(linesTextarea('Outro (said after you win)', t.outro, (lines) => { t.outro = lines; markDirty(); }));
  block.appendChild(linesTextarea('Post-defeat dialogue (later talks)', t.postDialogue, (lines) => { t.postDialogue = lines; markDirty(); }));
  return block;
}

// ---- Warps ---------------------------------------------------------------

function renderWarps() {
  const m = map();
  if (!m.warps) m.warps = [];
  const body = $('warp-body');
  body.innerHTML = '';
  m.warps.forEach((w, idx) => {
    const tr = document.createElement('tr');
    const cell = (child) => { const td = document.createElement('td'); td.appendChild(child); tr.appendChild(td); };
    cell(numInput(w.x, { min: 0 }, (v) => { w.x = v; markDirty(); drawGrid(); }));
    cell(numInput(w.y, { min: 0 }, (v) => { w.y = v; markDirty(); drawGrid(); }));
    const toSel = document.createElement('select');
    for (const id of state.mapIds) toSel.appendChild(option(id, id, w.toMap === id));
    toSel.addEventListener('change', () => { w.toMap = toSel.value; markDirty(); renderWarnings(); });
    cell(toSel);
    cell(numInput(w.toX, { min: 0 }, (v) => { w.toX = v; markDirty(); }));
    cell(numInput(w.toY, { min: 0 }, (v) => { w.toY = v; markDirty(); }));
    const fsel = document.createElement('select');
    for (const f of ['down', 'up', 'left', 'right']) fsel.appendChild(option(f, f, (w.toFacing || 'down') === f));
    fsel.addEventListener('change', () => { w.toFacing = fsel.value; markDirty(); });
    cell(fsel);
    const del = document.createElement('button');
    del.textContent = 'remove';
    del.addEventListener('click', () => { m.warps.splice(idx, 1); markDirty(); renderWarps(); drawGrid(); });
    cell(del);
    body.appendChild(tr);
  });
}

// ---- Validation ----------------------------------------------------------

function validateMap(id) {
  const m = state.maps[id];
  const problems = [];
  if (!Array.isArray(m.tiles) || m.tiles.length !== m.height || m.tiles.some((r) => r.length !== m.width)) {
    problems.push('Tile grid does not match width/height.');
  }
  const ps = m.playerStart;
  if (!ps || ps.x < 0 || ps.y < 0 || ps.x >= m.width || ps.y >= m.height) {
    problems.push('Player start is outside the map.');
  } else if (!(TILE_DEFS[m.tiles[ps.y][ps.x]] || {}).walkable) {
    problems.push('Player start is on a non-walkable tile.');
  }
  for (const e of (m.encounter && m.encounter.table) || []) {
    if (!state.creatures[e.species]) problems.push(`Encounter references unknown creature '${e.species}'.`);
    if (e.min > e.max) problems.push(`Encounter for '${e.species}': min level exceeds max.`);
  }
  (m.zones || []).forEach((z, i) => {
    if (z.x < 0 || z.y < 0 || z.x + z.w > m.width || z.y + z.h > m.height) {
      problems.push(`Zone ${i + 1} extends outside the map.`);
    }
    if (!(z.table || []).length) problems.push(`Zone ${i + 1} has an empty creature table.`);
    for (const e of z.table || []) {
      if (!state.creatures[e.species]) problems.push(`Zone ${i + 1} references unknown creature '${e.species}'.`);
      if (e.min > e.max) problems.push(`Zone ${i + 1} '${e.species}': min level exceeds max.`);
    }
  });
  const anyGrass = m.tiles.some((row) => row.some((t) => (TILE_DEFS[t] || {}).encounter));
  if (anyGrass && (!m.encounter || !(m.encounter.table || []).length)) {
    problems.push('Map has tall grass but no encounter table — stepping in it does nothing.');
  }
  if (anyGrass && m.encounter && !m.encounter.rate) {
    problems.push('Encounter rate is 0 — wild creatures will never appear.');
  }
  for (const n of m.npcs || []) {
    if (n.x < 0 || n.y < 0 || n.x >= m.width || n.y >= m.height) problems.push(`NPC '${n.name || n.id}' is outside the map.`);
    if (n.trainer) {
      if (!n.trainer.party || !n.trainer.party.length) problems.push(`Trainer '${n.name}' has no party.`);
      for (const mem of n.trainer.party || []) if (!state.creatures[mem.species]) problems.push(`Trainer '${n.name}' party has unknown creature '${mem.species}'.`);
    }
  }
  for (const w of m.warps || []) {
    if (!state.mapIds.includes(w.toMap)) problems.push(`Warp targets unknown map '${w.toMap}'.`);
  }
  return problems;
}

function renderWarnings() {
  const div = $('form-warnings');
  div.innerHTML = '';
  for (const p of validateMap(state.currentId)) {
    const w = document.createElement('div');
    w.className = 'warning';
    w.textContent = p;
    div.appendChild(w);
  }
}

function validateAll() {
  const all = [];
  for (const id of state.mapIds) {
    for (const p of validateMap(id)) all.push(`${id}: ${p}`);
  }
  return all;
}

// ---- Render all ----------------------------------------------------------

function renderAll() {
  buildMapSelect();
  renderIdentity();
  drawGrid();
  renderEncounters();
  renderZones();
  renderNpcs();
  renderWarps();
  renderWarnings();
}

// ---- Wiring --------------------------------------------------------------

function wireForm() {
  $('f-name').addEventListener('input', () => { map().name = $('f-name').value; markDirty(); buildMapSelect(); });
  $('f-width').addEventListener('change', () => { resizeMap(Number($('f-width').value), map().height); renderAll(); });
  $('f-height').addEventListener('change', () => { resizeMap(map().width, Number($('f-height').value)); renderAll(); });
  $('f-startx').addEventListener('change', () => { ensureStart().x = Number($('f-startx').value); markDirty(); drawGrid(); renderWarnings(); });
  $('f-starty').addEventListener('change', () => { ensureStart().y = Number($('f-starty').value); markDirty(); drawGrid(); renderWarnings(); });
  $('f-startfacing').addEventListener('change', () => { ensureStart().facing = $('f-startfacing').value; markDirty(); });
  $('f-rate').addEventListener('change', () => { if (!map().encounter) map().encounter = { rate: 0, table: [] }; map().encounter.rate = Number($('f-rate').value); markDirty(); renderWarnings(); });

  $('btn-add-enc').addEventListener('click', () => {
    if (!map().encounter) map().encounter = { rate: 0.1, table: [] };
    map().encounter.table.push({ species: Object.keys(state.creatures)[0], min: 2, max: 4, weight: 10 });
    markDirty();
    renderEncounters();
    renderWarnings();
  });
  $('btn-add-npc').addEventListener('click', () => {
    if (!map().npcs) map().npcs = [];
    const n = map().npcs.length + 1;
    map().npcs.push({ id: `npc${n}`, name: `NPC ${n}`, x: 1, y: 1, facing: 'down', sprite: 'elder', dialogue: ['...'] });
    markDirty();
    renderNpcs();
    drawGrid();
  });
  $('btn-add-warp').addEventListener('click', () => {
    if (!map().warps) map().warps = [];
    map().warps.push({ x: 0, y: 0, toMap: state.mapIds[0], toX: 1, toY: 1, toFacing: 'down' });
    markDirty();
    renderWarps();
    drawGrid();
  });
  $('btn-add-zone').addEventListener('click', () => {
    if (!map().zones) map().zones = [];
    map().zones.push({
      x: 1, y: 1, w: 3, h: 3, rate: 0.15,
      table: [{ species: Object.keys(state.creatures)[0], min: 2, max: 4, weight: 10 }],
    });
    markDirty();
    renderZones();
    renderWarnings();
  });
  $('btn-new-map').addEventListener('click', () => {
    const raw = prompt('New map id (lowercase letters/digits/underscores):');
    if (raw == null) return;
    const id = raw.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(id)) { alert('Invalid id.'); return; }
    if (state.mapIds.includes(id)) { alert(`'${id}' already exists.`); return; }
    const W = 15, H = 12;
    const tiles = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) row.push(y === 0 || y === H - 1 || x === 0 || x === W - 1 ? 1 : 0);
      tiles.push(row);
    }
    state.maps[id] = {
      id, name: id, width: W, height: H, tiles,
      playerStart: { x: 2, y: 2, facing: 'down' },
      encounter: { rate: 0, table: [] }, zones: [], npcs: [], warps: [],
    };
    state.mapIds.push(id);
    state.currentId = id;
    markDirty();
    renderAll();
    alert('New maps live in the browser override once you Save to Browser. To ship it in the repo: Download this map, commit it to data/maps/, and add the id to data/maps/index.json.');
  });
}

function ensureStart() {
  const m = map();
  if (!m.playerStart) m.playerStart = { x: 1, y: 1, facing: 'down' };
  return m.playerStart;
}

function wireTopbar() {
  $('btn-save').addEventListener('click', () => {
    const problems = validateAll();
    if (problems.length) {
      alert('Fix these before saving (the game would error otherwise):\n\n' + problems.join('\n'));
      return;
    }
    localStorage.setItem(MAPS_OVERRIDE_KEY, JSON.stringify(state.maps));
    state.dirty = false;
    state.overrideActive = true;
    updateBadges();
  });

  $('btn-download').addEventListener('click', () => {
    const problems = validateMap(state.currentId);
    if (problems.length && !confirm('This map has problems:\n\n' + problems.join('\n') + '\n\nDownload anyway?')) return;
    const blob = new Blob([JSON.stringify(map(), null, 2) + '\n'], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.currentId}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('btn-reset').addEventListener('click', async () => {
    if (!confirm('Discard the browser override and reload the repo map files? Unsaved edits are lost.')) return;
    localStorage.removeItem(MAPS_OVERRIDE_KEY);
    state.overrideActive = false;
    state.dirty = false;
    for (const id of state.mapIds) state.maps[id] = await fetchJson(`data/maps/${id}.json`);
    renderAll();
    updateBadges();
  });
}

function updateBadges() {
  $('override-badge').hidden = !state.overrideActive;
  $('dirty-badge').hidden = !state.dirty;
}

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) e.preventDefault();
});

// ---- Go ------------------------------------------------------------------

wireGrid();
wireForm();
wireTopbar();
load().catch((e) => {
  $('form-empty').textContent = `Failed to load: ${e.message} (serve over http://, not file://)`;
});

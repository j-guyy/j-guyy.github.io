// main.js — boot, top-level state machine, game loop, and all scenes.
//
// States: LOADING, TITLE, STARTER, OVERWORLD, DIALOGUE, MENU, BATTLE, EVOLVE.
// Everything is drawn on the fixed 720x480 canvas and driven by keyboard only.
//
// Phase 2 additions: XP/leveling (applied via 'xp' battle beats), learnsets
// with the forget-a-move prompt (battle 'learn' phase), evolutions (EVOLVE
// state after battle), CreatureDex seen/caught tracking + menu views, trainer
// battles (started from dialogue; fleeing/catching blocked), and an inventory
// (menu Items view + battle Item command).

import { Renderer, VIEW_W, VIEW_H, TILE } from './engine/renderer.js';
import { Input } from './engine/input.js';
import { loadMap, GameMap } from './engine/tilemap.js';
import { makeActorSprite, preloadCreatureArt } from './engine/assets.js';
import { loadTypes } from './battle/typechart.js';
import { loadDex } from './data/dex.js';
import {
  createBattle, resolveTurn, activePlayer, activeEnemy, STATUS_INFO,
  needsReplacement, replacementOptions, sendInReplacement,
} from './battle/battle.js';
import { hasSave, loadSave, writeSave, clearSave, STARTING_KIT, STARTING_MACHINES, STARTING_MONEY } from './save.js';
import { initAudio, playMusic, playSfx, toggleMute } from './engine/audio.js';

const STEP_MS = 140; // per-tile walk duration
const PARTY_CAP = 6;
// Visible-row budgets for the scrolling lists. Each is how many rows fit
// between that panel's header and whatever is drawn under the list
// (description text, hint line) — exceeding one used to draw rows straight
// through the text below it.
const DEX_ROWS = 10; // visible rows in the CreatureDex list
const ITEM_ROWS = 5; // pause-menu Items list
const MACHINE_ROWS = 6; // pause-menu TMs & HMs list
const SHOP_ROWS = 6; // shop buy list
const BATTLE_ITEM_ROWS = 2; // battle Item grid, 2 columns per row

// Slide a scroll offset so `index` stays inside a window of `rows` entries.
function scrollWindow(index, scroll, rows, count) {
  if (count <= rows) return 0;
  let s = Math.min(scroll, count - rows);
  if (index < s) s = index;
  if (index >= s + rows) s = index - rows + 1;
  return Math.max(0, s);
}
const DIRS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const game = {
  renderer: null,
  input: null,
  typeChart: null,
  dex: null,
  state: 'LOADING',
  mapCache: {},
  map: null,
  player: null, // { tx, ty, facing, px, py, moving, fromPx, toPx, t }
  party: [],
  storage: [], // PC box: creatures beyond the 6-member party
  money: 0,
  inventory: {}, // itemId -> qty
  machines: {}, // machineId -> qty (HMs stay at 1; TMs decrement)
  dexData: { seen: new Set(), caught: new Set() },
  starterChosen: null,
  flags: {},
  sprites: {},
  // scene-scoped holders
  title: { index: 0, hasSave: false },
  starter: { index: 0, ids: [] },
  dialogue: null,
  menu: null,
  battle: null,
  evolve: null, // { q:[{mon,oldName}], i, step, after }
  shop: null, // { npc, items, index, message }
  storageUI: null, // { pane, index, scroll, message }
  banner: null, // { text, t }
};

// ---- Boot ----------------------------------------------------------------

async function boot() {
  const canvas = document.getElementById('game-canvas');
  game.renderer = new Renderer(canvas);
  game.input = new Input();

  game.sprites.player = makeActorSprite({ color: '#3f6fd0', accent: '#27408a', head: '#f0c090' });
  game.sprites.elder = makeActorSprite({ color: '#8a6fd0', accent: '#5a3f9a', head: '#e8c090' });
  game.sprites.ranger = makeActorSprite({ color: '#c9803a', accent: '#7a4a20', head: '#e8b890' });
  game.sprites.rival = makeActorSprite({ color: '#d04a4a', accent: '#7a2020', head: '#f0c090' });
  game.sprites.leader = makeActorSprite({ color: '#3a8a4a', accent: '#1f5a2a', head: '#e8c090' });
  game.sprites.keeper = makeActorSprite({ color: '#8a8a94', accent: '#55555f', head: '#e8c090' });
  game.sprites.shopkeep = makeActorSprite({ color: '#4aa0b8', accent: '#28687a', head: '#f0c090' });
  game.sprites.healer = makeActorSprite({ color: '#e8a0b8', accent: '#a86078', head: '#f0d0a8' });
  game.sprites.scout = makeActorSprite({ color: '#b8a04a', accent: '#7a6a28', head: '#e8b890' });

  game.typeChart = await loadTypes();
  game.dex = await loadDex(game.typeChart);
  await preloadCreatureArt(Object.keys(game.dex.creatures));

  game.title.hasSave = hasSave();
  game.title.index = game.title.hasSave ? 1 : 0;
  game.state = 'TITLE';
  game.input.flush();

  // Audio starts on the first user gesture (browser autoplay policy); M mutes.
  const audioKick = () => {
    initAudio();
    window.removeEventListener('keydown', audioKick);
    window.removeEventListener('pointerdown', audioKick);
  };
  window.addEventListener('keydown', audioKick);
  window.addEventListener('pointerdown', audioKick);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyM') showBanner(toggleMute() ? 'Sound: OFF' : 'Sound: ON');
  });
  playMusic('title');

  // On-screen controls for touch devices (or force with ?touch=1).
  const touchEl = document.getElementById('touch-controls');
  const wantTouch = window.matchMedia('(pointer: coarse)').matches
    || new URLSearchParams(location.search).has('touch');
  if (wantTouch && touchEl) {
    touchEl.hidden = false;
    game.input.bindTouch(touchEl);
    // Keyboard hints + editor links sit right under the d-pad on a phone, where
    // they're useless and easy to tap by accident — drop them in touch mode.
    document.body.classList.add('touch-mode');
  }

  requestAnimationFrame(loop);
}

let lastT = 0;
function loop(now) {
  const dt = Math.min(50, now - lastT) || 16;
  lastT = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function setState(s) {
  game.state = s;
  game.input.flush();
  if (s === 'TITLE' || s === 'STARTER') playMusic('title');
  else if (s === 'BATTLE') playMusic('battle');
  else if (s === 'EVOLVE') playMusic('evolve');
  else playMusic('overworld'); // OVERWORLD / DIALOGUE / MENU / SHOP / STORAGE
}

// ---- Map / world helpers -------------------------------------------------

async function getMap(id) {
  if (!game.mapCache[id]) {
    game.mapCache[id] = await loadMap(id);
  }
  return game.mapCache[id];
}

function actorSpriteFor(spriteName) {
  return game.sprites[spriteName] || game.sprites.player;
}

async function placePlayer(mapId, tx, ty, facing) {
  const map = await getMap(mapId);
  game.map = map;
  game.player = {
    tx, ty, facing,
    px: tx * TILE, py: ty * TILE,
    moving: false, fromPx: null, toPx: null, t: 0, targetTile: null,
  };
  showBanner(map.name);
}

function showBanner(text) {
  game.banner = { text, t: 2000 };
}

// ---- Dex / inventory helpers ---------------------------------------------

function markSeen(speciesId) {
  game.dexData.seen.add(speciesId);
}

function markCaught(speciesId) {
  game.dexData.seen.add(speciesId);
  game.dexData.caught.add(speciesId);
}

function addItem(id, qty = 1) {
  game.inventory[id] = (game.inventory[id] || 0) + qty;
}

function removeItem(id, qty = 1) {
  const n = (game.inventory[id] || 0) - qty;
  if (n > 0) game.inventory[id] = n;
  else delete game.inventory[id];
}

// Inventory as an ordered list of { id, def, qty } (items.json order).
function invEntries() {
  return game.dex
    .itemIds()
    .filter((id) => game.inventory[id] > 0)
    .map((id) => ({ id, def: game.dex.item(id), qty: game.inventory[id] }));
}

// Owned machines (TMs/HMs) as an ordered list (machines.json order).
function machineEntries() {
  return game.dex
    .machineIds()
    .filter((id) => game.machines[id] > 0)
    .map((id) => ({ id, def: game.dex.machine(id), qty: game.machines[id] }));
}

function addMachine(id, qty = 1) {
  game.machines[id] = (game.machines[id] || 0) + qty;
}

// TMs are single-use (consumed on teach); HMs are reusable (never consumed).
function consumeMachineIfTM(machineId) {
  if (game.dex.machine(machineId).kind !== 'tm') return;
  const n = (game.machines[machineId] || 0) - 1;
  if (n > 0) game.machines[machineId] = n;
  else delete game.machines[machineId];
}

// ---- New game / continue -------------------------------------------------

function beginStarterSelect() {
  game.starter.ids = game.dex.starters();
  game.starter.index = 0;
  setState('STARTER');
}

async function startNewGame(starterId) {
  clearSave();
  game.starterChosen = starterId;
  game.party = [game.dex.makeInstance(starterId, 5)];
  game.storage = [];
  game.money = STARTING_MONEY;
  game.inventory = { ...STARTING_KIT };
  game.machines = { ...STARTING_MACHINES };
  game.dexData = { seen: new Set(), caught: new Set() };
  markCaught(starterId);
  game.flags = {};
  const start = (await getMap('village')).playerStart;
  await placePlayer('village', start.x, start.y, start.facing || 'down');
  setState('OVERWORLD');
}

async function continueGame() {
  const data = loadSave();
  if (!data) return;
  game.starterChosen = data.starterChosen;
  game.flags = data.flags || {};
  game.party = data.party.map((m) => game.dex.deserializeMember(m));
  game.storage = (data.storage || []).map((m) => game.dex.deserializeMember(m));
  game.money = data.money != null ? data.money : STARTING_MONEY;
  game.inventory = data.inventory ? { ...data.inventory } : { ...STARTING_KIT };
  game.machines = data.machines ? { ...data.machines } : { ...STARTING_MACHINES };
  const ds = data.dexState || { seen: [], caught: [] };
  game.dexData = { seen: new Set(ds.seen), caught: new Set(ds.caught) };
  // Migration safety: everything in the party is by definition caught.
  for (const m of game.party) markCaught(m.species);
  const p = data.player;
  await placePlayer(p.map, p.x, p.y, p.facing || 'down');
  setState('OVERWORLD');
}

function snapshotState() {
  return {
    starterChosen: game.starterChosen,
    player: { map: game.map.id, x: game.player.tx, y: game.player.ty, facing: game.player.facing },
    party: game.party.map((m) => game.dex.serializeMember(m)),
    storage: game.storage.map((m) => game.dex.serializeMember(m)),
    money: game.money,
    inventory: { ...game.inventory },
    machines: { ...game.machines },
    dexState: { seen: [...game.dexData.seen], caught: [...game.dexData.caught] },
    flags: game.flags,
  };
}

function healParty() {
  for (const m of game.party) {
    m.curHP = m.maxHP;
    m.status = null; // a full rest also cures status conditions
    m.statusCounter = 0;
    for (const mv of m.moves) mv.curPP = mv.pp; // and restores PP
  }
}

// Status-condition badge colors (keyed by status id).
const STATUS_COLORS = {
  burn: '#e0603a', poison: '#a040a0', toxic: '#803080',
  paralysis: '#d8b020', sleep: '#8a8aa0', freeze: '#5aa0d0',
};

function drawStatusBadge(r, x, y, status) {
  const info = STATUS_INFO[status];
  if (!info) return;
  r.fillRect(x, y, 54, 24, STATUS_COLORS[status] || '#888');
  r.text(info.abbr, x + 27, y + 3, { align: 'center', size: 18, bold: true, color: '#fff' });
}

// ---- Update dispatch -----------------------------------------------------

function update(dt) {
  if (game.banner) {
    game.banner.t -= dt;
    if (game.banner.t <= 0) game.banner = null;
  }
  switch (game.state) {
    case 'TITLE': updateTitle(); break;
    case 'STARTER': updateStarter(); break;
    case 'OVERWORLD': updateOverworld(dt); break;
    case 'DIALOGUE': updateDialogue(); break;
    case 'MENU': updateMenu(); break;
    case 'BATTLE': updateBattle(dt); break;
    case 'EVOLVE': updateEvolve(); break;
    case 'SHOP': updateShop(); break;
    case 'STORAGE': updateStorage(); break;
  }
}

// ---- Title ---------------------------------------------------------------

function updateTitle() {
  const t = game.title;
  const options = ['New Game', 'Continue'];
  if (game.input.consume('up')) t.index = (t.index + options.length - 1) % options.length;
  if (game.input.consume('down')) t.index = (t.index + 1) % options.length;
  if (game.input.consume('confirm')) {
    if (t.index === 0) beginStarterSelect();
    else if (t.index === 1 && t.hasSave) continueGame();
  }
}

// ---- Starter select ------------------------------------------------------

function updateStarter() {
  const s = game.starter;
  if (game.input.consume('left')) s.index = (s.index + s.ids.length - 1) % s.ids.length;
  if (game.input.consume('right')) s.index = (s.index + 1) % s.ids.length;
  if (game.input.consume('confirm')) startNewGame(s.ids[s.index]);
  if (game.input.consume('cancel')) setState('TITLE');
}

// ---- Overworld -----------------------------------------------------------

function updateOverworld(dt) {
  const p = game.player;

  // open menu
  if (!p.moving && game.input.consume('cancel')) {
    openMenu();
    return;
  }
  // interact with NPC in front
  if (!p.moving && game.input.consume('confirm')) {
    const d = DIRS[p.facing];
    const npc = game.map.npcAt(p.tx + d.dx, p.ty + d.dy);
    if (npc) {
      startDialogue(npc);
      return;
    }
  }

  if (p.moving) {
    p.t += dt;
    const frac = Math.min(1, p.t / STEP_MS);
    p.px = p.fromPx.x + (p.toPx.x - p.fromPx.x) * frac;
    p.py = p.fromPx.y + (p.toPx.y - p.fromPx.y) * frac;
    if (frac >= 1) {
      p.moving = false;
      p.px = p.toPx.x;
      p.py = p.toPx.y;
      onArriveTile();
    }
    return;
  }

  // held direction -> walk; a brief tap with nothing held -> just turn to face
  const dir = game.input.heldDirection();
  if (dir) {
    p.facing = dir;
    game.input.consume(dir); // drain the matching edge press
    const d = DIRS[dir];
    const ntx = p.tx + d.dx;
    const nty = p.ty + d.dy;
    if (!game.map.isBlocked(ntx, nty)) {
      p.tx = ntx;
      p.ty = nty;
      p.fromPx = { x: p.px, y: p.py };
      p.toPx = { x: ntx * TILE, y: nty * TILE };
      p.t = 0;
      p.moving = true;
    }
  } else {
    for (const d of ['up', 'down', 'left', 'right']) {
      if (game.input.consume(d)) { p.facing = d; break; }
    }
  }
}

async function onArriveTile() {
  const p = game.player;
  // warp first (so doors don't roll encounters)
  const warp = game.map.warpAt(p.tx, p.ty);
  if (warp) {
    await placePlayer(warp.toMap, warp.toX, warp.toY, warp.toFacing || p.facing);
    return;
  }
  // random encounter on grass (per-patch zones override the map default)
  if (game.map.isEncounterTile(p.tx, p.ty)) {
    const enc = game.map.encounterAt(p.tx, p.ty);
    if (Math.random() < (enc.rate || 0)) {
      startEncounter(enc);
    }
  }
}

// ---- Dialogue ------------------------------------------------------------

function startDialogue(npc) {
  let lines = npc.dialogue || [];
  let startBattle = false;
  if (npc.trainer) {
    if (game.flags[npc.trainer.defeatFlag]) {
      lines = npc.trainer.postDialogue || lines;
    } else {
      startBattle = true; // intro dialogue, then battle
    }
  }
  game.dialogue = { npc, lines: lines.slice(), index: 0, page: 0, startBattle };
  setState('DIALOGUE');
}

// The dialogue box fits exactly two rows of wrapped text. A line longer than
// that used to lose everything past row two; now it pages, so a writer can put
// as much text in one `dialogue` entry as they like.
const DIALOGUE_ROWS = 2;

function dialoguePages(text) {
  const wrapped = game.renderer.wrapText(text || '', VIEW_W - 84, 24);
  const pages = [];
  for (let i = 0; i < wrapped.length; i += DIALOGUE_ROWS) {
    pages.push(wrapped.slice(i, i + DIALOGUE_ROWS));
  }
  return pages.length ? pages : [['']];
}

function updateDialogue() {
  const d = game.dialogue;
  if (game.input.consume('confirm') || game.input.consume('cancel')) {
    // Walk the current line's pages before moving to the next line.
    if (d.page + 1 < dialoguePages(d.lines[d.index]).length) {
      d.page++;
      return;
    }
    d.index++;
    d.page = 0;
    if (d.index >= d.lines.length) {
      if (d.npc.healsParty) { healParty(); playSfx('heal'); }
      game.dialogue = null;
      if (d.startBattle) {
        startTrainerBattle(d.npc);
        return;
      }
      if (d.npc.shop) {
        openShop(d.npc);
        return;
      }
      if (d.npc.storage) {
        openStorage();
        return;
      }
      setState('OVERWORLD');
    }
  }
}

// ---- Shop ------------------------------------------------------------------

// A shop row is either an item id or a machine id — both carry name/price/desc,
// so the shop screen resolves them to one shape and doesn't care which it got.
function shopEntryFor(id) {
  const def = game.dex.hasItem(id) ? game.dex.item(id) : game.dex.machine(id);
  return { id, def, isMachine: !game.dex.hasItem(id), price: def.price || 0 };
}

function openShop(npc) {
  game.shop = { npc, items: npc.shop.slice(), index: 0, scroll: 0, message: null };
  setState('SHOP');
}

function updateShop() {
  const s = game.shop;
  const n = s.items.length;
  if (game.input.consume('up')) { s.index = (s.index + n - 1) % n; s.message = null; }
  if (game.input.consume('down')) { s.index = (s.index + 1) % n; s.message = null; }
  s.scroll = scrollWindow(s.index, s.scroll, SHOP_ROWS, n);
  if (game.input.consume('cancel')) {
    game.shop = null;
    setState('OVERWORLD');
    return;
  }
  if (game.input.consume('confirm')) {
    const entry = shopEntryFor(s.items[s.index]);
    if (entry.isMachine && entry.def.kind === 'hm' && game.machines[entry.id] > 0) {
      // HMs are reusable, so a second copy would do nothing but cost coins.
      s.message = `You already own ${entry.def.name}.`;
    } else if (game.money < entry.price) {
      s.message = 'Not enough coins!';
    } else {
      game.money -= entry.price;
      if (entry.isMachine) addMachine(entry.id, 1);
      else addItem(entry.id, 1);
      s.message = `Bought ${entry.isMachine ? '' : 'a '}${entry.def.name}!`;
    }
  }
}

function renderShop() {
  const r = game.renderer;
  const s = game.shop;
  r.fillRect(0, 0, VIEW_W, VIEW_H, 'rgba(0,0,0,0.35)');
  const w = 540, x = (VIEW_W - w) / 2, y = 48;
  r.panel(x, y, w, 384);
  r.text('SHOP', x + 24, y + 18, { size: 27, bold: true });
  r.text(`${game.money}c`, x + w - 24, y + 21, { align: 'right', size: 22, color: '#8a6a2a' });
  for (let row = 0; row < SHOP_ROWS; row++) {
    const i = s.scroll + row;
    if (i >= s.items.length) break;
    const entry = shopEntryFor(s.items[i]);
    const oy = y + 66 + row * 36;
    if (i === s.index) r.cursor(x + 18, oy + 3);
    const owned = entry.isMachine && entry.def.kind === 'hm' && game.machines[entry.id] > 0;
    r.text(entry.def.name, x + 42, oy, { size: 24, color: owned ? '#999' : undefined });
    r.text(`${entry.price}c`, x + w - 42, oy, { align: 'right', size: 22, color: '#666' });
  }
  if (s.scroll > 0) r.text('▲', x + w - 24, y + 66, { size: 18, color: '#888' });
  if (s.scroll + SHOP_ROWS < s.items.length) r.text('▼', x + w - 24, y + 66 + (SHOP_ROWS - 1) * 36, { size: 18, color: '#888' });
  const sel = shopEntryFor(s.items[s.index]).def;
  r.wrapClamped(sel.desc, w - 84, 20, 2)
    .forEach((ln, i) => r.text(ln, x + 42, y + 288 + i * 26, { size: 20, color: '#555' }));
  if (s.message) r.text(s.message, x + 42, y + 336, { size: 21, color: s.message.startsWith('Bought') ? '#2a7a2a' : '#a04030' });
  r.text('Z: buy   X: leave', x + w / 2, y + 360, { align: 'center', size: 21, color: '#666' });
}

// ---- Storage (PC box) ------------------------------------------------------

const STORAGE_ROWS = 8;

function openStorage() {
  game.storageUI = { pane: 'party', index: 0, scroll: 0, message: null };
  setState('STORAGE');
}

function updateStorage() {
  const ui = game.storageUI;
  const list = ui.pane === 'party' ? game.party : game.storage;
  if (game.input.consume('left') || game.input.consume('right')) {
    ui.pane = ui.pane === 'party' ? 'box' : 'party';
    ui.index = 0;
    ui.scroll = 0;
    ui.message = null;
    return;
  }
  if (list.length) {
    if (game.input.consume('up')) ui.index = (ui.index + list.length - 1) % list.length;
    if (game.input.consume('down')) ui.index = (ui.index + 1) % list.length;
    if (ui.index < ui.scroll) ui.scroll = ui.index;
    if (ui.index >= ui.scroll + STORAGE_ROWS) ui.scroll = ui.index - STORAGE_ROWS + 1;
  }
  if (game.input.consume('cancel')) {
    game.storageUI = null;
    setState('OVERWORLD');
    return;
  }
  if (game.input.consume('confirm')) {
    if (ui.pane === 'party') {
      if (game.party.length <= 1) {
        ui.message = 'Keep at least one creature with you!';
      } else {
        const [mon] = game.party.splice(ui.index, 1);
        game.storage.push(mon);
        ui.message = `${mon.name} was deposited.`;
        ui.index = Math.min(ui.index, game.party.length - 1);
      }
    } else {
      if (!game.storage.length) return;
      if (game.party.length >= PARTY_CAP) {
        ui.message = 'Your party is full!';
      } else {
        const [mon] = game.storage.splice(ui.index, 1);
        game.party.push(mon);
        ui.message = `${mon.name} joined the party!`;
        ui.index = Math.max(0, Math.min(ui.index, game.storage.length - 1));
        ui.scroll = Math.min(ui.scroll, Math.max(0, game.storage.length - STORAGE_ROWS));
      }
    }
  }
}

function renderStorage() {
  const r = game.renderer;
  const ui = game.storageUI;
  r.fillRect(0, 0, VIEW_W, VIEW_H, 'rgba(0,0,0,0.35)');
  r.panel(18, 18, VIEW_W - 36, VIEW_H - 36);
  r.text('CREATURE STORAGE', 42, 36, { size: 27, bold: true });
  r.text('◄ ► to switch panes', VIEW_W - 42, 40, { align: 'right', size: 19, color: '#666' });

  const paneW = (VIEW_W - 36 - 48) / 2;
  const drawPane = (x0, title, list, isActive, scroll) => {
    r.text(title, x0 + 12, 72, { size: 22, bold: true, color: isActive ? '#8a6a2a' : '#666' });
    if (isActive) r.fillRect(x0, 96, paneW, 2, '#e8b23a');
    if (!list.length) {
      r.text('— empty —', x0 + 24, 120, { size: 20, color: '#999' });
      return;
    }
    for (let row = 0; row < STORAGE_ROWS; row++) {
      const i = scroll + row;
      if (i >= list.length) break;
      const mon = list[i];
      const oy = 112 + row * 36;
      if (isActive && i === ui.index) r.fillRect(x0, oy - 4, paneW, 32, 'rgba(232,178,58,0.25)');
      mon.sprite.draw(r.ctx, x0 + 6, oy - 2, 27, 27);
      r.text(`${mon.name} Lv${mon.level}`, x0 + 42, oy, { size: 20 });
      if (mon.status) drawStatusBadge(r, x0 + paneW - 60, oy - 2, mon.status);
    }
    if (scroll > 0) r.text('▲', x0 + paneW - 18, 112, { size: 18, color: '#888' });
    if (scroll + STORAGE_ROWS < list.length) r.text('▼', x0 + paneW - 18, 112 + (STORAGE_ROWS - 1) * 36, { size: 18, color: '#888' });
  };

  drawPane(42, `PARTY (${game.party.length}/${PARTY_CAP})`, game.party, ui.pane === 'party', ui.pane === 'party' ? ui.scroll : 0);
  drawPane(42 + paneW + 24, `STORAGE (${game.storage.length})`, game.storage, ui.pane === 'box', ui.pane === 'box' ? ui.scroll : 0);

  if (ui.message) r.text(ui.message, VIEW_W / 2, VIEW_H - 72, { align: 'center', size: 21, color: '#2a7a2a' });
  r.text('Z: deposit / withdraw   X: done', VIEW_W / 2, VIEW_H - 44, { align: 'center', size: 21, color: '#666' });
}

// ---- Pause menu ----------------------------------------------------------

function openMenu() {
  game.menu = {
    view: 'root', index: 0, message: null,
    partyIndex: 0, dexIndex: 0, dexScroll: 0, detailId: null,
    itemIndex: 0, itemScroll: 0, targetIndex: 0, pendingItem: null,
    machineIndex: 0, machineScroll: 0, machineTargetIndex: 0, machineLearnIndex: 0, teach: null,
  };
  setState('MENU');
}

const ROOT_MENU_OPTS = ['Party', 'CreatureDex', 'Items', 'TMs & HMs', 'Save', 'Quit to Title', 'Close'];

// Teach the pending machine's move to party[monIndex]; sets m.message and the
// next view. When the target already knows 4 moves, routes to the replace
// prompt instead of teaching directly.
function attemptTeach(m, monIndex) {
  const mon = game.party[monIndex];
  const move = m.teach.move;
  const moveName = game.dex.move(move).name;
  if (!game.dex.canTeach(mon.species, move)) {
    m.message = `${mon.name} can't learn ${moveName}.`;
    return;
  }
  if (mon.moves.some((mv) => mv.id === move)) {
    m.message = `${mon.name} already knows ${moveName}.`;
    return;
  }
  if (mon.moves.length < 4) {
    mon.moves.push(game.dex.move(move));
    consumeMachineIfTM(m.teach.machineId);
    m.message = `${mon.name} learned ${moveName}!`;
    m.view = 'machines';
    return;
  }
  // 4 moves already — prompt to replace one.
  m.teach.monIndex = monIndex;
  m.machineLearnIndex = 0;
  m.message = null;
  m.view = 'machineLearn';
}

function updateMenu() {
  const m = game.menu;

  if (m.view === 'root') {
    const opts = ROOT_MENU_OPTS;
    if (game.input.consume('up')) m.index = (m.index + opts.length - 1) % opts.length;
    if (game.input.consume('down')) m.index = (m.index + 1) % opts.length;
    if (game.input.consume('cancel')) { closeMenu(); return; }
    if (game.input.consume('confirm')) {
      m.message = null;
      const sel = opts[m.index];
      if (sel === 'Party') { m.view = 'party'; m.partyIndex = 0; }
      else if (sel === 'CreatureDex') { m.view = 'dex'; m.dexIndex = 0; m.dexScroll = 0; }
      else if (sel === 'Items') { m.view = 'items'; m.itemIndex = 0; m.itemScroll = 0; }
      else if (sel === 'TMs & HMs') { m.view = 'machines'; m.machineIndex = 0; m.machineScroll = 0; }
      else if (sel === 'Save') {
        const ok = writeSave(snapshotState());
        game.title.hasSave = true;
        m.message = ok ? 'Game saved!' : 'Save failed.';
      } else if (sel === 'Quit to Title') {
        game.title.hasSave = hasSave();
        game.title.index = game.title.hasSave ? 1 : 0;
        game.menu = null;
        setState('TITLE');
      } else if (sel === 'Close') {
        closeMenu();
      }
    }
    return;
  }

  if (m.view === 'party') {
    if (game.input.consume('up')) m.partyIndex = (m.partyIndex + game.party.length - 1) % game.party.length;
    if (game.input.consume('down')) m.partyIndex = (m.partyIndex + 1) % game.party.length;
    if (game.input.consume('cancel') || game.input.consume('confirm')) m.view = 'root';
    return;
  }

  if (m.view === 'dex') {
    const n = game.dex.order.length;
    if (game.input.consume('up')) m.dexIndex = (m.dexIndex + n - 1) % n;
    if (game.input.consume('down')) m.dexIndex = (m.dexIndex + 1) % n;
    if (m.dexIndex < m.dexScroll) m.dexScroll = m.dexIndex;
    if (m.dexIndex >= m.dexScroll + DEX_ROWS) m.dexScroll = m.dexIndex - DEX_ROWS + 1;
    if (game.input.consume('cancel')) { m.view = 'root'; return; }
    if (game.input.consume('confirm')) {
      const id = game.dex.order[m.dexIndex];
      if (game.dexData.seen.has(id)) { m.view = 'dexDetail'; m.detailId = id; }
    }
    return;
  }

  if (m.view === 'dexDetail') {
    if (game.input.consume('cancel') || game.input.consume('confirm')) m.view = 'dex';
    return;
  }

  if (m.view === 'items') {
    const list = invEntries();
    if (!list.length) {
      if (game.input.consume('cancel') || game.input.consume('confirm')) m.view = 'root';
      return;
    }
    if (m.itemIndex >= list.length) m.itemIndex = list.length - 1;
    if (game.input.consume('up')) m.itemIndex = (m.itemIndex + list.length - 1) % list.length;
    if (game.input.consume('down')) m.itemIndex = (m.itemIndex + 1) % list.length;
    m.itemScroll = scrollWindow(m.itemIndex, m.itemScroll, ITEM_ROWS, list.length);
    if (game.input.consume('cancel')) { m.view = 'root'; return; }
    if (game.input.consume('confirm')) {
      const entry = list[m.itemIndex];
      if (entry.def.kind === 'heal' || entry.def.kind === 'cure' || entry.def.kind === 'revive') {
        m.view = 'itemTarget';
        m.pendingItem = entry.id;
        m.targetIndex = 0;
        m.message = null;
      } else {
        m.message = 'Orbs are best saved for battle.';
      }
    }
    return;
  }

  if (m.view === 'itemTarget') {
    if (game.input.consume('up')) m.targetIndex = (m.targetIndex + game.party.length - 1) % game.party.length;
    if (game.input.consume('down')) m.targetIndex = (m.targetIndex + 1) % game.party.length;
    if (game.input.consume('cancel')) { m.view = 'items'; return; }
    if (game.input.consume('confirm')) {
      const def = game.dex.item(m.pendingItem);
      const target = game.party[m.targetIndex];
      if (def.kind === 'revive') {
        if (target.curHP > 0) {
          m.message = `${target.name} is still full of fight!`;
        } else {
          target.curHP = Math.max(1, Math.floor(target.maxHP * (def.fraction || 0.5)));
          target.status = null;
          target.statusCounter = 0;
          removeItem(m.pendingItem, 1);
          m.message = `${target.name} was revived!`;
          m.view = 'items';
        }
      } else if (def.kind === 'cure') {
        if (target.curHP <= 0) {
          m.message = "It won't work on a fainted creature!";
        } else if (!target.status) {
          m.message = `${target.name} has no status condition!`;
        } else {
          const noun = STATUS_INFO[target.status].noun;
          target.status = null;
          target.statusCounter = 0;
          removeItem(m.pendingItem, 1);
          m.message = `${target.name}'s ${noun} was cured!`;
          m.view = 'items';
        }
      } else if (target.curHP <= 0) {
        m.message = "It won't work on a fainted creature!";
      } else if (target.curHP >= target.maxHP) {
        m.message = 'HP is already full!';
      } else {
        const healed = Math.min(target.maxHP, target.curHP + def.heal) - target.curHP;
        target.curHP += healed;
        removeItem(m.pendingItem, 1);
        m.message = `${target.name} recovered ${healed} HP!`;
        m.view = 'items';
      }
    }
    return;
  }

  if (m.view === 'machines') {
    const list = machineEntries();
    if (!list.length) {
      if (game.input.consume('cancel') || game.input.consume('confirm')) { m.view = 'root'; m.message = null; }
      return;
    }
    if (m.machineIndex >= list.length) m.machineIndex = list.length - 1;
    if (game.input.consume('up')) m.machineIndex = (m.machineIndex + list.length - 1) % list.length;
    if (game.input.consume('down')) m.machineIndex = (m.machineIndex + 1) % list.length;
    m.machineScroll = scrollWindow(m.machineIndex, m.machineScroll, MACHINE_ROWS, list.length);
    if (game.input.consume('cancel')) { m.view = 'root'; m.message = null; return; }
    if (game.input.consume('confirm')) {
      const entry = list[m.machineIndex];
      m.teach = { machineId: entry.id, move: entry.def.move };
      m.machineTargetIndex = 0;
      m.message = null;
      m.view = 'machineTarget';
    }
    return;
  }

  if (m.view === 'machineTarget') {
    if (game.input.consume('up')) m.machineTargetIndex = (m.machineTargetIndex + game.party.length - 1) % game.party.length;
    if (game.input.consume('down')) m.machineTargetIndex = (m.machineTargetIndex + 1) % game.party.length;
    if (game.input.consume('cancel')) { m.view = 'machines'; m.message = null; return; }
    if (game.input.consume('confirm')) attemptTeach(m, m.machineTargetIndex);
    return;
  }

  if (m.view === 'machineLearn') {
    const mon = game.party[m.teach.monIndex];
    const optCount = mon.moves.length + 1; // 4 moves + "Cancel"
    if (game.input.consume('up')) m.machineLearnIndex = (m.machineLearnIndex + optCount - 1) % optCount;
    if (game.input.consume('down')) m.machineLearnIndex = (m.machineLearnIndex + 1) % optCount;
    if (game.input.consume('cancel')) { m.view = 'machineTarget'; m.message = null; return; }
    if (game.input.consume('confirm')) {
      const moveName = game.dex.move(m.teach.move).name;
      if (m.machineLearnIndex < mon.moves.length) {
        const forgot = mon.moves[m.machineLearnIndex].name;
        mon.moves[m.machineLearnIndex] = game.dex.move(m.teach.move);
        consumeMachineIfTM(m.teach.machineId);
        m.message = `${mon.name} forgot ${forgot} and learned ${moveName}!`;
        m.view = 'machines';
      } else {
        m.message = `${mon.name} did not learn ${moveName}.`;
        m.view = 'machineTarget';
      }
    }
    return;
  }
}

function closeMenu() {
  game.menu = null;
  setState('OVERWORLD');
}

// ---- Battle --------------------------------------------------------------

function makeBattleScene(data, introBeats, trainerNpc = null) {
  const playerMon = activePlayer(data);
  const enemy = activeEnemy(data);
  game.battle = {
    data,
    playerMon,
    enemy,
    trainerNpc,
    phase: 'resolve', // resolve | menu | move | item | party | learn
    menuIndex: 0,
    moveIndex: 0,
    lastMoveIndex: 0, // remembers the last move used, so Fight defaults to it
    itemIndex: 0,
    itemScroll: 0, // in rows of 2, for the battle Item grid
    partyIndex: 0,
    learnIndex: 0,
    beats: introBeats,
    beatIndex: 0,
    msg: '',
    waitConfirm: false,
    hpAnim: null,
    pendingLearns: [], // [{ mon, move }]
    displayHP: { player: playerMon.curHP, enemy: enemy.curHP },
    // presentation effects (all timers in ms)
    fx: {
      shakeT: 0,
      flash: { player: 0, enemy: 0 },
      lunge: { player: 0, enemy: 0 },
      downed: { player: false, enemy: false },
      faintAnim: null, // { side, t }
    },
  };
  primeBeat();
  setState('BATTLE');
}

// The top-level battle command options (2-column grid: Fight/Party top row,
// Item/Run bottom). Run is only offered against wild creatures.
function battleMenuOpts(b) {
  return b.data.mode === 'trainer' ? ['Fight', 'Party', 'Item'] : ['Fight', 'Party', 'Item', 'Run'];
}

// Change battle phase and drop any queued key presses. Input that piled up
// during message playback (e.g. a direction tapped while text scrolled) would
// otherwise leak into the next menu on its first frame and knock the cursor off
// its intended default — that was the "command menu keeps starting on Item/Run"
// bug. Flushing on every phase entry keeps each selection screen deterministic.
function setBattlePhase(phase) {
  game.battle.phase = phase;
  game.input.flush();
}

function startEncounter(enc) {
  const roll = GameMap.rollFrom(enc || game.map.encounter);
  if (!roll) return;
  const enemy = game.dex.makeInstance(roll.species, roll.level);
  markSeen(enemy.species);
  if (!game.party.some((m) => m.curHP > 0)) healParty(); // safety net
  const data = createBattle(game.party, [enemy], { mode: 'wild' });
  makeBattleScene(data, [
    { type: 'msg', text: `A wild ${enemy.name} appeared!` },
    { type: 'msg', text: `Go, ${activePlayer(data).name}!` },
  ]);
}

function startTrainerBattle(npc) {
  // A rival leads with a fixed creature and closes with an ace chosen to
  // counter the player's starter, so the matchup is always uphill at the end.
  let partyDef = npc.trainer.party;
  if (npc.trainer.rival) {
    const counter = { emberling: 'dripling', dripling: 'sproutle', sproutle: 'emberling' }[game.starterChosen] || 'dripling';
    const level = npc.trainer.rivalLevel || 9;
    partyDef = [
      { species: npc.trainer.rivalLead || 'zaptooth', level: Math.max(2, level - 2) },
      { species: counter, level },
    ];
  }
  const enemies = partyDef.map((e) => game.dex.makeInstance(e.species, e.level));
  markSeen(enemies[0].species);
  if (!game.party.some((m) => m.curHP > 0)) healParty(); // safety net
  const data = createBattle(game.party, enemies, { mode: 'trainer', trainerName: npc.name });
  makeBattleScene(data, [
    { type: 'msg', text: `${npc.name} wants to battle!` },
    { type: 'msg', text: `${npc.name} sent out ${enemies[0].name}!` },
    { type: 'msg', text: `Go, ${activePlayer(data).name}!` },
  ], npc);
}

function primeBeat() {
  const b = game.battle;
  if (b.beatIndex >= b.beats.length) {
    b.msg = '';
    b.waitConfirm = false;
    return;
  }
  const beat = b.beats[b.beatIndex];
  if (beat.type === 'msg') {
    b.msg = beat.text;
    b.waitConfirm = true;
    b.beatTimer = 0;
    if (beat.actor) b.fx.lunge[beat.actor] = 220; // attacker lunge
    if (/grew to Lv/.test(beat.text)) playSfx('level');
  } else if (beat.type === 'damage') {
    b.hpAnim = { side: beat.target, from: beat.from, to: beat.to, t: 0, dur: 400 };
    b.waitConfirm = false;
    if (beat.to < beat.from) { // damage, not a heal
      b.fx.flash[beat.target] = 320;
      const eff = beat.eff != null ? beat.eff : 1;
      if (eff >= 2) { b.fx.shakeT = 260; playSfx('superhit'); }
      else if (eff < 1) playSfx('weakhit');
      else playSfx('hit');
    } else {
      playSfx('heal');
    }
  } else if (beat.type === 'faint') {
    b.waitConfirm = false;
    b.beatTimer = 350; // brief pause; sprite slides down during it
    b.fx.faintAnim = { side: beat.target, t: 350 };
    b.fx.downed[beat.target] = true;
    playSfx('faint');
  } else if (beat.type === 'orb') {
    // Thrown-orb arc animation (during catch attempts).
    b.waitConfirm = false;
    b.beatTimer = 700;
    playSfx('catch');
  } else if (beat.type === 'caught') {
    playSfx('caught');
    b.waitConfirm = false;
    b.beatTimer = 0;
  } else if (beat.type === 'xp') {
    // Apply XP to the active creature; splice resulting messages into the
    // stream. Level-ups recalc stats in place (max-HP gains heal by the delta).
    const mon = b.playerMon;
    // A fainted creature earns nothing — and must not, since a level-up's
    // max-HP delta heals from current HP and would quietly revive it. Reachable
    // when your creature faints and the foe then goes down to end-of-turn
    // damage in the same turn, with your slot still empty.
    if (mon.curHP <= 0) {
      b.waitConfirm = false;
      b.beatTimer = 0;
      return;
    }
    const msgs = [{ type: 'msg', text: `${mon.name} gained ${beat.amount} EXP!` }];
    const events = game.dex.addXP(mon, beat.amount);
    for (const ev of events) {
      if (ev.type === 'level') {
        msgs.push({ type: 'msg', text: `${mon.name} grew to Lv${ev.level}!` });
      } else if (ev.type === 'learned') {
        msgs.push({ type: 'msg', text: `${mon.name} learned ${game.dex.move(ev.move).name}!` });
      } else if (ev.type === 'wantsLearn') {
        b.pendingLearns.push({ mon, move: ev.move });
      }
    }
    b.displayHP.player = mon.curHP;
    b.beats.splice(b.beatIndex + 1, 0, ...msgs);
    b.waitConfirm = false;
    b.beatTimer = 0;
  } else if (beat.type === 'switch') {
    // Active creature changed (faint replacement / trainer's next send / manual).
    if (beat.side === 'enemy') {
      b.enemy = b.data.enemyParty[beat.index];
      b.displayHP.enemy = b.enemy.curHP;
      markSeen(b.enemy.species);
    } else {
      b.playerMon = b.data.playerParty[beat.index];
      b.displayHP.player = b.playerMon.curHP;
    }
    b.fx.downed[beat.side] = false; // fresh creature on the field
    b.waitConfirm = false;
    b.beatTimer = 0;
  } else {
    // marker beats (caught/fled): skip instantly
    b.waitConfirm = false;
    b.beatTimer = 0;
  }
}

function advanceBeat() {
  const b = game.battle;
  b.beatIndex++;
  if (b.beatIndex >= b.beats.length) {
    finishBeats();
  } else {
    primeBeat();
  }
}

function finishBeats() {
  const b = game.battle;
  b.msg = '';
  b.waitConfirm = false;
  b.hpAnim = null;

  // Pending move-learn prompts run before anything else (even battle end).
  if (b.pendingLearns.length) {
    b.learnIndex = 0;
    setBattlePhase('learn');
    return;
  }
  if (b.data.over) {
    endBattle();
    return;
  }
  // Your creature fainted and the slot is still empty — pick who comes in
  // before the command menu comes back. Can't be cancelled out of.
  if (needsReplacement(b.data)) {
    b.partyIndex = replacementOptions(b.data)[0];
    setBattlePhase('replace');
    return;
  }
  b.menuIndex = 0; // always default the command menu to Fight
  setBattlePhase('menu');
}

// Show a one-off message and return to the command menu (no turn consumed).
function transientBattleMsg(text) {
  const b = game.battle;
  b.beats = [{ type: 'msg', text }];
  b.beatIndex = 0;
  setBattlePhase('resolve');
  primeBeat();
}

function updateBattle(dt) {
  const b = game.battle;

  // decay presentation-effect timers
  const fx = b.fx;
  fx.shakeT = Math.max(0, fx.shakeT - dt);
  for (const s of ['player', 'enemy']) {
    fx.flash[s] = Math.max(0, fx.flash[s] - dt);
    fx.lunge[s] = Math.max(0, fx.lunge[s] - dt);
  }
  if (fx.faintAnim) {
    fx.faintAnim.t -= dt;
    if (fx.faintAnim.t <= 0) fx.faintAnim = null;
  }

  if (b.phase === 'resolve') {
    const beat = b.beats[b.beatIndex];
    if (!beat) { finishBeats(); return; }

    if (beat.type === 'msg') {
      b.beatTimer += dt;
      if (b.beatTimer > 180 && (game.input.consume('confirm') || game.input.consume('cancel'))) {
        advanceBeat();
      }
    } else if (beat.type === 'damage') {
      const a = b.hpAnim;
      a.t += dt;
      const frac = Math.min(1, a.t / a.dur);
      const cur = Math.round(a.from + (a.to - a.from) * frac);
      b.displayHP[a.side] = cur;
      if (frac >= 1) {
        b.displayHP[a.side] = a.to;
        advanceBeat();
      }
    } else if (beat.type === 'faint' || beat.type === 'orb') {
      b.beatTimer -= dt;
      if (b.beatTimer <= 0) advanceBeat();
    } else {
      advanceBeat();
    }
    return;
  }

  if (b.phase === 'menu') {
    // 2-column grid matching the on-screen layout: [Fight Party / Item Run]
    // (Run is omitted in trainer battles, so the grid shrinks to 3 cells).
    // right/left move within a row, down/up between rows.
    const opts = battleMenuOpts(b);
    const n = opts.length;
    let i = b.menuIndex;
    if (game.input.consume('right') && i % 2 === 0 && i + 1 < n) i += 1;
    if (game.input.consume('left') && i % 2 === 1) i -= 1;
    if (game.input.consume('down') && i + 2 < n) i += 2;
    if (game.input.consume('up') && i - 2 >= 0) i -= 2;
    b.menuIndex = i;
    if (game.input.consume('confirm')) {
      const sel = opts[b.menuIndex];
      if (sel === 'Fight') {
        if (!b.playerMon.moves.some((mv) => mv.curPP > 0)) {
          // Out of PP everywhere — Struggle.
          doTurn({ type: 'move', moveId: '__struggle' });
          return;
        }
        // default the move cursor to the last move used this battle
        b.moveIndex = Math.min(b.lastMoveIndex, b.playerMon.moves.length - 1);
        setBattlePhase('move');
      } else if (sel === 'Party') {
        if (b.data.vol.player.trapped) { transientBattleMsg(`${b.playerMon.name} can't escape!`); return; }
        b.partyIndex = 0;
        setBattlePhase('party');
      } else if (sel === 'Item') {
        if (!invEntries().length) transientBattleMsg('You have no items!');
        else { b.itemIndex = 0; b.itemScroll = 0; setBattlePhase('item'); }
      } else if (sel === 'Run') {
        doTurn({ type: 'flee' });
      }
    }
    return;
  }

  if (b.phase === 'move') {
    // 2-column grid, row-major: [0 1 / 2 3]. left/right move within a row,
    // up/down move between rows.
    const moves = b.playerMon.moves;
    const n = moves.length;
    let i = b.moveIndex;
    if (game.input.consume('right') && i % 2 === 0 && i + 1 < n) i += 1;
    if (game.input.consume('left') && i % 2 === 1) i -= 1;
    if (game.input.consume('down') && i + 2 < n) i += 2;
    if (game.input.consume('up') && i - 2 >= 0) i -= 2;
    b.moveIndex = i;
    if (game.input.consume('cancel')) { b.menuIndex = 0; setBattlePhase('menu'); return; }
    if (game.input.consume('confirm')) {
      if (moves[b.moveIndex].curPP <= 0) {
        transientBattleMsg("There's no PP left for this move!");
        return;
      }
      b.lastMoveIndex = b.moveIndex;
      doTurn({ type: 'move', moveId: moves[b.moveIndex].id });
    }
    return;
  }

  if (b.phase === 'party') {
    if (game.input.consume('up')) b.partyIndex = (b.partyIndex + game.party.length - 1) % game.party.length;
    if (game.input.consume('down')) b.partyIndex = (b.partyIndex + 1) % game.party.length;
    if (game.input.consume('cancel')) { b.menuIndex = 0; setBattlePhase('menu'); return; }
    if (game.input.consume('confirm')) {
      const idx = b.partyIndex;
      const target = game.party[idx];
      if (idx === b.data.playerIndex) transientBattleMsg(`${target.name} is already in battle!`);
      else if (target.curHP <= 0) transientBattleMsg(`${target.name} has no energy left to battle!`);
      else doTurn({ type: 'switch', index: idx });
    }
    return;
  }

  if (b.phase === 'replace') {
    // Same list as 'party', minus the escape hatch — something has to come out.
    if (game.input.consume('up')) b.partyIndex = (b.partyIndex + game.party.length - 1) % game.party.length;
    if (game.input.consume('down')) b.partyIndex = (b.partyIndex + 1) % game.party.length;
    if (game.input.consume('confirm')) {
      const target = game.party[b.partyIndex];
      if (target.curHP <= 0) transientBattleMsg(`${target.name} has no energy left to battle!`);
      else doReplacement(b.partyIndex);
    }
    return;
  }

  if (b.phase === 'item') {
    // 2-column grid, row-major — same navigation as the move grid, since it's
    // the same on-screen layout. (Up/down used to step one entry, which read as
    // moving sideways.) Only BATTLE_ITEM_ROWS rows fit in the message panel, so
    // the list scrolls a row at a time past that.
    const list = invEntries();
    if (!list.length) { b.menuIndex = 0; setBattlePhase('menu'); return; }
    const n = list.length;
    if (b.itemIndex >= n) b.itemIndex = n - 1;
    let i = b.itemIndex;
    if (game.input.consume('right') && i % 2 === 0 && i + 1 < n) i += 1;
    if (game.input.consume('left') && i % 2 === 1) i -= 1;
    if (game.input.consume('down') && i + 2 < n) i += 2;
    if (game.input.consume('up') && i - 2 >= 0) i -= 2;
    b.itemIndex = i;
    b.itemScroll = scrollWindow(
      Math.floor(i / 2), b.itemScroll, BATTLE_ITEM_ROWS, Math.ceil(n / 2)
    );
    if (game.input.consume('cancel')) { b.menuIndex = 0; setBattlePhase('menu'); return; }
    if (game.input.consume('confirm')) useBattleItem(list[b.itemIndex]);
    return;
  }

  if (b.phase === 'learn') {
    const pl = b.pendingLearns[0];
    const optCount = pl.mon.moves.length + 1; // 4 moves + "Give up"
    if (game.input.consume('up')) b.learnIndex = (b.learnIndex + optCount - 1) % optCount;
    if (game.input.consume('down')) b.learnIndex = (b.learnIndex + 1) % optCount;
    if (game.input.consume('cancel')) { b.learnIndex = optCount - 1; } // jump to "Give up"
    if (game.input.consume('confirm')) {
      const moveName = game.dex.move(pl.move).name;
      let msgs;
      if (b.learnIndex < pl.mon.moves.length) {
        const forgot = pl.mon.moves[b.learnIndex].name;
        pl.mon.moves[b.learnIndex] = game.dex.move(pl.move);
        msgs = [
          { type: 'msg', text: `${pl.mon.name} forgot ${forgot}...` },
          { type: 'msg', text: `And learned ${moveName}!` },
        ];
      } else {
        msgs = [{ type: 'msg', text: `${pl.mon.name} gave up learning ${moveName}.` }];
      }
      b.pendingLearns.shift();
      b.beats = msgs;
      b.beatIndex = 0;
      setBattlePhase('resolve');
      primeBeat();
    }
    return;
  }
}

function useBattleItem(entry) {
  const b = game.battle;
  const def = entry.def;
  if (def.kind === 'catch') {
    if (b.data.mode === 'trainer') {
      transientBattleMsg("You can't catch another ranger's creature!");
      return;
    }
    // Party full is fine — the catch overflows to storage (see endBattle).
  } else if (def.kind === 'heal') {
    if (b.playerMon.curHP >= b.playerMon.maxHP) {
      transientBattleMsg(`${b.playerMon.name}'s HP is already full!`);
      return;
    }
  } else if (def.kind === 'cure') {
    if (!b.playerMon.status) {
      transientBattleMsg(`${b.playerMon.name} has no status condition!`);
      return;
    }
  } else if (def.kind === 'revive') {
    transientBattleMsg('Too potent to use mid-battle!');
    return;
  }
  removeItem(entry.id, 1);
  doTurn({ type: 'item', item: def });
}

function doTurn(action) {
  const b = game.battle;
  const { beats } = resolveTurn(b.data, action, { typeChart: game.typeChart, dex: game.dex });
  b.beats = beats;
  b.beatIndex = 0;
  setBattlePhase('resolve');
  primeBeat();
}

// Fill the empty slot left by a faint. Doesn't consume a turn — and if hazards
// KO whoever came in, finishBeats() lands back on the 'replace' phase.
function doReplacement(index) {
  const b = game.battle;
  const { beats } = sendInReplacement(b.data, index, { typeChart: game.typeChart, dex: game.dex });
  b.beats = beats;
  b.beatIndex = 0;
  setBattlePhase('resolve');
  primeBeat();
}

async function endBattle() {
  const b = game.battle;
  const outcome = b.data.outcome;
  const trainerNpc = b.trainerNpc;
  const caughtMon = b.enemy;

  let sentToStorage = false;
  if (outcome === 'caught') {
    markCaught(caughtMon.species);
    if (game.party.length < PARTY_CAP) {
      game.party.push(caughtMon);
    } else {
      game.storage.push(caughtMon);
      sentToStorage = true;
    }
  }

  // Leave BATTLE before any async work. The current map/player are still valid
  // to render as OVERWORLD; nulling battle while state==='BATTLE' across an
  // await would let a frame render a null battle.
  game.battle = null;
  setState('OVERWORLD');
  if (sentToStorage) showBanner(`${caughtMon.name} was sent to storage.`);

  if (outcome === 'lose') {
    healParty();
    const start = (await getMap('village')).playerStart;
    await placePlayer('village', start.x, start.y, start.facing || 'down');
    showBanner('You scurried back to Meadowfen...');
    return;
  }

  // After evolutions (if any), a beaten trainer pays out + says their piece.
  const after = () => {
    if (outcome === 'win' && trainerNpc) {
      const t = trainerNpc.trainer;
      game.flags[t.defeatFlag] = true;
      const lines = [...(t.outro || [])];
      const reward = t.reward || {};
      const topLevel = Math.max(...(t.party || [{ level: 5 }]).map((m) => m.level || 5));
      const payout = reward.money != null ? reward.money : topLevel * 30;
      if (payout > 0) {
        game.money += payout;
        lines.push(`You got ${payout}c for winning!`);
      }
      if (reward.item) {
        addItem(reward.item, reward.qty || 1);
        lines.push(`You received ${reward.qty || 1}x ${game.dex.item(reward.item).name}!`);
      }
      if (reward.machine) {
        addMachine(reward.machine, reward.machineQty || 1);
        lines.push(`You received ${game.dex.machine(reward.machine).name}!`);
      }
      if (t.badge) {
        game.flags['badge_' + t.badge.toLowerCase().replace(/\W+/g, '_')] = true;
        lines.push(`You earned the ${t.badge}!`);
      }
      game.dialogue = { npc: { name: trainerNpc.name }, lines, index: 0, page: 0, startBattle: false };
      setState('DIALOGUE');
    }
  };
  queueEvolutions(after);
}

// ---- Evolution -----------------------------------------------------------

function queueEvolutions(afterFn) {
  const q = [];
  for (const mon of game.party) {
    if (game.dex.evolutionFor(mon)) q.push({ mon, oldName: mon.name });
  }
  if (!q.length) {
    afterFn();
    return;
  }
  game.evolve = { q, i: 0, step: 0, after: afterFn };
  setState('EVOLVE');
}

function updateEvolve() {
  const e = game.evolve;
  if (!(game.input.consume('confirm') || game.input.consume('cancel'))) return;
  const item = e.q[e.i];
  if (e.step === 0) {
    item.oldName = item.mon.name;
    game.dex.evolveMember(item.mon);
    markCaught(item.mon.species);
    e.step = 1;
  } else {
    e.i++;
    e.step = 0;
    if (e.i >= e.q.length) {
      const after = e.after;
      game.evolve = null;
      setState('OVERWORLD');
      after();
    }
  }
}

// ---- Render dispatch -----------------------------------------------------

function render() {
  const r = game.renderer;
  switch (game.state) {
    case 'LOADING': r.clear('#000'); r.text('Loading...', VIEW_W / 2, VIEW_H / 2, { align: 'center', size: 24, color: '#fff' }); break;
    case 'TITLE': renderTitle(); break;
    case 'STARTER': renderStarter(); break;
    case 'OVERWORLD': renderWorld(); renderBanner(); break;
    case 'DIALOGUE': renderWorld(); renderDialogue(); break;
    case 'MENU': renderWorld(); renderMenu(); break;
    case 'BATTLE': renderBattle(); break;
    case 'EVOLVE': renderEvolve(); break;
    case 'SHOP': renderWorld(); renderShop(); break;
    case 'STORAGE': renderWorld(); renderStorage(); break;
  }
}

function renderTitle() {
  const r = game.renderer;
  r.clear('#20304a');
  r.fillRect(0, 0, VIEW_W, 180, '#2b4066');
  r.fillRect(0, 180, VIEW_W, 4, '#16223a');
  r.text('CREATURE', VIEW_W / 2, 48, { align: 'center', size: 60, bold: true, color: '#ffe08a', shadow: '#000' });
  r.text('QUEST', VIEW_W / 2, 110, { align: 'center', size: 48, bold: true, color: '#fff', shadow: '#000' });
  r.text('a phase-6 prototype', VIEW_W / 2, 172, { align: 'center', size: 24, color: '#9fb4d8' });

  const opts = ['New Game', 'Continue'];
  const y0 = 280;
  opts.forEach((o, i) => {
    const disabled = i === 1 && !game.title.hasSave;
    const y = y0 + i * 52;
    if (i === game.title.index) {
      r.fillRect(VIEW_W / 2 - 174, y - 8, 348, 46, 'rgba(255,224,138,0.16)');
      r.cursor(VIEW_W / 2 - 156, y + 4, '#ffe08a');
    }
    r.text(o, VIEW_W / 2 - 126, y, { size: 30, color: disabled ? '#6b7a94' : (i === game.title.index ? '#ffe08a' : '#fff') });
  });
  r.text('Arrows/WASD move   Z/Enter confirm   X/Esc back', VIEW_W / 2, VIEW_H - 40, { align: 'center', size: 21, color: '#9fb4d8' });
}

function renderStarter() {
  const r = game.renderer;
  r.clear('#243a2a');
  r.text('Choose your first partner', VIEW_W / 2, 26, { align: 'center', size: 27, bold: true, color: '#fff', shadow: '#000' });

  const ids = game.starter.ids;
  const boxW = 162, gap = 24;
  const spriteSize = 132;
  const totalW = ids.length * boxW + (ids.length - 1) * gap;
  const x0 = (VIEW_W - totalW) / 2;
  ids.forEach((id, i) => {
    const sp = game.species(id);
    const x = x0 + i * (boxW + gap);
    const selected = i === game.starter.index;
    r.panel(x, 72, boxW, 186, { fill: selected ? '#fdf6dc' : '#e6e0c8', border: selected ? '#e8b23a' : '#2b2b3a' });
    game.dex.spriteFor(id).draw(r.ctx, x + (boxW - spriteSize) / 2, 78, spriteSize, spriteSize);
    r.text(sp.name, x + boxW / 2, 216, { align: 'center', size: 24, bold: true });
  });

  // details of selected. The rows above the flavor text are packed a little
  // tighter than they used to be to make room for a second flavor line —
  // every starter's blurb wraps to two, and only the first was being drawn.
  const sel = game.species(ids[game.starter.index]);
  const bs = sel.baseStats;
  r.panel(60, 288, VIEW_W - 120, 156);
  r.text(`${sel.name}   [${sel.types.join('/')}]`, 84, 298, { size: 25, bold: true, color: game.typeChart.color(sel.types[0]) });
  if (sel.ability) r.text(`Ability: ${game.dex.ability(sel.ability).name}`, 84, 326, { size: 20, color: '#3a5fa8' });
  r.text(`HP ${bs.hp}   ATK ${bs.attack}   DEF ${bs.defense}`, 84, 348, { size: 21 });
  r.text(`SpA ${bs.spAttack}   SpD ${bs.spDefense}   SPD ${bs.speed}`, 84, 370, { size: 21 });
  r.wrapClamped(sel.flavor, VIEW_W - 168, 19, 2)
    .forEach((ln, i) => r.text(ln, 84, 394 + i * 22, { size: 19, color: '#444' }));
  r.text('<  Left / Right to choose  >    Z select    X back', VIEW_W / 2, VIEW_H - 26, { align: 'center', size: 21, color: '#cfe0b8' });
}

// convenience
game.species = (id) => game.dex.species(id);

function renderWorld() {
  const r = game.renderer;
  const map = game.map;
  const p = game.player;
  const pcx = p.px + TILE / 2;
  const pcy = p.py + TILE / 2;
  r.centerCamera(pcx, pcy, map.pixelWidth, map.pixelHeight);
  r.clear('#101418');

  const cam = r.camera;
  const startCol = Math.max(0, Math.floor(cam.x / TILE));
  const endCol = Math.min(map.width - 1, Math.floor((cam.x + VIEW_W) / TILE));
  const startRow = Math.max(0, Math.floor(cam.y / TILE));
  const endRow = Math.min(map.height - 1, Math.floor((cam.y + VIEW_H) / TILE));

  for (let ty = startRow; ty <= endRow; ty++) {
    for (let tx = startCol; tx <= endCol; tx++) {
      const id = map.tileAt(tx, ty);
      const sprite = map.tileSprites[id];
      if (sprite) r.drawWorldSprite(sprite, tx * TILE, ty * TILE, TILE, TILE);
    }
  }

  // Actors (player + NPCs) are drawn feet-first, sorted by base Y so an actor
  // lower on screen overlaps one above it — standing directly behind an NPC
  // puts your body behind their head rather than in front of it. Sprites are
  // 1x2 tiles, so they're offset up one tile from their feet.
  const actors = map.npcs.map((npc) => ({
    baseY: npc.y * TILE,
    px: npc.x * TILE,
    py: npc.y * TILE,
    sprite: actorSpriteFor(npc.sprite).get(npc.facing || 'down'),
  }));
  actors.push({ baseY: p.py, px: p.px, py: p.py, sprite: game.sprites.player.get(p.facing) });
  actors.sort((a, b) => a.baseY - b.baseY);
  for (const a of actors) {
    r.drawWorldSprite(a.sprite, a.px, a.py - TILE, TILE, TILE * 2);
  }
}

function renderBanner() {
  if (!game.banner) return;
  const r = game.renderer;
  r.ctx.font = '24px monospace';
  const w = Math.min(VIEW_W - 24, r.ctx.measureText(game.banner.text).width + 48);
  r.panel(12, 12, w, 48, { fill: 'rgba(20,20,30,0.85)', border: '#fff', borderInner: '#888' });
  r.text(game.banner.text, 36, 27, { size: 24, color: '#fff' });
}

function renderDialogue() {
  const r = game.renderer;
  const d = game.dialogue;
  const y = VIEW_H - 132;
  r.panel(12, y, VIEW_W - 24, 120);
  r.text(d.npc.name, 36, y + 15, { size: 24, bold: true, color: '#3a5fa8' });
  const pages = dialoguePages(d.lines[d.index]);
  const page = pages[Math.min(d.page, pages.length - 1)];
  page.forEach((ln, i) => r.text(ln, 36, y + 51 + i * 30, { size: 24 }));
  r.text('▼', VIEW_W - 48, y + 90, { size: 24, color: '#888' });
}

// Shared party-row list (pause menu Party view + item targeting).
function renderPartyList(r, title, selIndex, hint) {
  r.panel(18, 18, VIEW_W - 36, VIEW_H - 36);
  r.text(title, 42, 36, { size: 27, bold: true });
  game.party.forEach((mon, i) => {
    const y = 84 + i * 60;
    const selected = i === selIndex;
    if (selected) r.fillRect(30, y - 6, VIEW_W - 60, 54, 'rgba(232,178,58,0.25)');
    mon.sprite.draw(r.ctx, 36, y - 3, 48, 48);
    r.text(`${mon.name}  Lv${mon.level}`, 96, y, { size: 24, color: game.typeChart.color(mon.types[0]) });
    if (mon.status) drawStatusBadge(r, 390, y - 2, mon.status);
    const toNext = mon.level >= 100 ? null : game.dex.xpTotalForLevel(mon.level + 1) - mon.xp;
    const sub = `[${mon.types.join('/')}]  HP ${mon.curHP}/${mon.maxHP}` + (toNext != null ? `  Next Lv in ${toNext} EXP` : '');
    r.text(sub, 96, y + 27, { size: 21, color: '#444' });
    r.bar(456, y + 6, 210, 18, mon.curHP / mon.maxHP, hpColor(mon.curHP / mon.maxHP));
  });
  r.text(hint, VIEW_W / 2, VIEW_H - 42, { align: 'center', size: 21, color: '#666' });
}

function renderMenu() {
  const r = game.renderer;
  const m = game.menu;
  // dim
  r.fillRect(0, 0, VIEW_W, VIEW_H, 'rgba(0,0,0,0.35)');

  if (m.view === 'root') {
    const opts = ROOT_MENU_OPTS;
    const w = 300, x = VIEW_W - w - 18, y = 18;
    const badges = Object.keys(game.flags).filter((f) => f.startsWith('badge_')).length;
    r.panel(x, y, w, 54 + opts.length * 36 + (m.message ? 36 : 0));
    r.text('MENU', x + 24, y + 18, { size: 24, bold: true });
    r.text(`${game.money}c · ${badges}★`, x + w - 24, y + 21, { align: 'right', size: 20, color: '#8a6a2a' });
    opts.forEach((o, i) => {
      const oy = y + 54 + i * 36;
      if (i === m.index) r.cursor(x + 18, oy + 3);
      r.text(o, x + 42, oy, { size: 24 });
    });
    if (m.message) r.text(m.message, x + 24, y + 54 + opts.length * 36, { size: 21, color: '#2a7a2a' });
    return;
  }

  if (m.view === 'party') {
    renderPartyList(r, 'PARTY', m.partyIndex, 'X / Z to go back');
    return;
  }

  if (m.view === 'dex') {
    r.panel(18, 18, VIEW_W - 36, VIEW_H - 36);
    r.text('CREATURE DEX', 42, 36, { size: 27, bold: true });
    r.text(`Seen ${game.dexData.seen.size} · Caught ${game.dexData.caught.size}`, VIEW_W - 42, 40, { align: 'right', size: 21, color: '#666' });
    const order = game.dex.order;
    for (let row = 0; row < DEX_ROWS; row++) {
      const i = m.dexScroll + row;
      if (i >= order.length) break;
      const id = order[i];
      const y = 84 + row * 33;
      const seen = game.dexData.seen.has(id);
      const caught = game.dexData.caught.has(id);
      if (i === m.dexIndex) r.fillRect(30, y - 4, VIEW_W - 60, 30, 'rgba(232,178,58,0.25)');
      r.text(`#${String(i + 1).padStart(2, '0')}`, 48, y, { size: 24, color: '#888' });
      r.text(seen ? game.species(id).name : '???', 120, y, { size: 24, color: seen ? '#2b2b3a' : '#999' });
      if (caught) r.text('●', VIEW_W - 66, y, { size: 24, color: '#4caf50' });
    }
    if (m.dexScroll > 0) r.text('▲', VIEW_W - 42, 84, { size: 21, color: '#888' });
    if (m.dexScroll + DEX_ROWS < order.length) r.text('▼', VIEW_W - 42, 84 + (DEX_ROWS - 1) * 33, { size: 21, color: '#888' });
    r.text('Z: entry (if seen)   X: back', VIEW_W / 2, VIEW_H - 42, { align: 'center', size: 21, color: '#666' });
    return;
  }

  if (m.view === 'dexDetail') {
    const id = m.detailId;
    const sp = game.species(id);
    const caught = game.dexData.caught.has(id);
    r.panel(18, 18, VIEW_W - 36, VIEW_H - 36);
    const num = game.dex.order.indexOf(id) + 1;
    r.text(`#${String(num).padStart(2, '0')}  ${sp.name}`, 42, 36, { size: 27, bold: true });
    r.text(caught ? 'CAUGHT' : 'SEEN', VIEW_W - 42, 40, { align: 'right', size: 21, color: caught ? '#4caf50' : '#888' });
    game.dex.spriteFor(id).draw(r.ctx, 48, 90, 192, 192);
    r.text(`[${sp.types.join('/')}]`, 144, 292, { align: 'center', size: 23, bold: true, color: game.typeChart.color(sp.types[0]) });
    if (sp.ability) r.text(`Ability: ${game.dex.ability(sp.ability).name}`, 144, 320, { align: 'center', size: 19, color: '#3a5fa8' });
    const entryLines = r.wrapText(sp.entry || sp.flavor, VIEW_W - 330, 21);
    entryLines.slice(0, 8).forEach((ln, i) => r.text(ln, 270, 96 + i * 30, { size: 21 }));
    const bs = sp.baseStats;
    r.text(`HP ${bs.hp}  ATK ${bs.attack}  DEF ${bs.defense}  SpA ${bs.spAttack}  SpD ${bs.spDefense}  SPD ${bs.speed}`, 252, VIEW_H - 78, { size: 16, color: '#555' });
    r.text('X / Z to go back', VIEW_W / 2, VIEW_H - 42, { align: 'center', size: 21, color: '#666' });
    return;
  }

  if (m.view === 'items') {
    const list = invEntries();
    const w = 480, x = (VIEW_W - w) / 2, y = 60;
    r.panel(x, y, w, 360);
    r.text('ITEMS', x + 24, y + 18, { size: 27, bold: true });
    if (!list.length) {
      r.text('No items.', x + 42, y + 66, { size: 24, color: '#666' });
    } else {
      for (let row = 0; row < ITEM_ROWS; row++) {
        const i = m.itemScroll + row;
        if (i >= list.length) break;
        const entry = list[i];
        const oy = y + 66 + row * 36;
        if (i === m.itemIndex) r.cursor(x + 18, oy + 3);
        r.text(entry.def.name, x + 42, oy, { size: 24 });
        r.text(`x${entry.qty}`, x + w - 42, oy, { align: 'right', size: 24, color: '#666' });
      }
      if (m.itemScroll > 0) r.text('▲', x + w - 24, y + 66, { size: 18, color: '#888' });
      if (m.itemScroll + ITEM_ROWS < list.length) r.text('▼', x + w - 24, y + 66 + (ITEM_ROWS - 1) * 36, { size: 18, color: '#888' });
      const sel = list[Math.min(m.itemIndex, list.length - 1)];
      r.wrapClamped(sel.def.desc, w - 84, 21, 2)
        .forEach((ln, i) => r.text(ln, x + 42, y + 246 + i * 27, { size: 21, color: '#555' }));
    }
    if (m.message) r.text(m.message, x + 42, y + 300, { size: 21, color: '#2a7a2a' });
    r.text('Z: use   X: back', x + w / 2, y + 330, { align: 'center', size: 21, color: '#666' });
    return;
  }

  if (m.view === 'itemTarget') {
    renderPartyList(r, `Use ${game.dex.item(m.pendingItem).name} on which creature?`, m.targetIndex, 'Z: use here   X: back');
    if (m.message) r.text(m.message, VIEW_W / 2, VIEW_H - 72, { align: 'center', size: 21, color: '#a04030' });
    return;
  }

  if (m.view === 'machines') {
    const list = machineEntries();
    const w = 540, x = (VIEW_W - w) / 2, y = 48;
    r.panel(x, y, w, 384);
    r.text('TMs & HMs', x + 24, y + 18, { size: 27, bold: true });
    if (!list.length) {
      r.text('No machines. Beat trainers to earn more!', x + 42, y + 66, { size: 22, color: '#666' });
    } else {
      for (let row = 0; row < MACHINE_ROWS; row++) {
        const i = m.machineScroll + row;
        if (i >= list.length) break;
        const entry = list[i];
        const oy = y + 66 + row * 34;
        if (i === m.machineIndex) r.cursor(x + 18, oy + 3);
        const mv = game.dex.move(entry.def.move);
        r.text(entry.def.name, x + 42, oy, { size: 22, color: game.typeChart.color(mv.type) });
        r.text(entry.def.kind === 'hm' ? 'reusable' : `x${entry.qty}`, x + w - 42, oy, { align: 'right', size: 21, color: '#666' });
      }
      if (m.machineScroll > 0) r.text('▲', x + w - 24, y + 66, { size: 18, color: '#888' });
      if (m.machineScroll + MACHINE_ROWS < list.length) r.text('▼', x + w - 24, y + 66 + (MACHINE_ROWS - 1) * 34, { size: 18, color: '#888' });
      const sel = list[Math.min(m.machineIndex, list.length - 1)];
      r.wrapClamped(sel.def.desc, w - 84, 21, 2)
        .forEach((ln, i) => r.text(ln, x + 42, y + 276 + i * 27, { size: 21, color: '#555' }));
    }
    if (m.message) r.text(m.message, x + 42, y + 336, { size: 21, color: '#2a7a2a' });
    r.text('Z: teach   X: back', x + w / 2, y + 360, { align: 'center', size: 21, color: '#666' });
    return;
  }

  if (m.view === 'machineTarget') {
    const move = m.teach.move;
    const moveName = game.dex.move(move).name;
    r.panel(18, 18, VIEW_W - 36, VIEW_H - 36);
    r.text(`Teach ${moveName} to which creature?`, 42, 36, { size: 24, bold: true });
    game.party.forEach((mon, i) => {
      const y = 84 + i * 60;
      const selected = i === m.machineTargetIndex;
      const knows = mon.moves.some((mv) => mv.id === move);
      const can = game.dex.canTeach(mon.species, move);
      if (selected) r.fillRect(30, y - 6, VIEW_W - 60, 54, 'rgba(232,178,58,0.25)');
      mon.sprite.draw(r.ctx, 36, y - 3, 48, 48);
      r.text(`${mon.name}  Lv${mon.level}`, 96, y, { size: 24, color: can ? game.typeChart.color(mon.types[0]) : '#999' });
      const status = knows ? 'already knows it' : (can ? 'can learn' : "can't learn");
      r.text(status, 96, y + 27, { size: 20, color: knows ? '#8a7a2a' : (can ? '#2a7a2a' : '#a04030') });
      r.text(mon.moves.map((mv) => mv.name).join(', '), 372, y + 12, { size: 18, color: '#555' });
    });
    if (m.message) r.text(m.message, VIEW_W / 2, VIEW_H - 72, { align: 'center', size: 21, color: '#a04030' });
    r.text('Z: teach here   X: back', VIEW_W / 2, VIEW_H - 42, { align: 'center', size: 21, color: '#666' });
    return;
  }

  if (m.view === 'machineLearn') {
    const mon = game.party[m.teach.monIndex];
    const moveName = game.dex.move(m.teach.move).name;
    const opts = [...mon.moves.map((mv) => mv.name), 'Cancel'];
    const w = 448, x = (VIEW_W - w) / 2, y = 96;
    r.panel(x, y, w, 132 + opts.length * 36);
    r.text(`${mon.name} wants to learn ${moveName}.`, x + 24, y + 18, { size: 21, bold: true });
    r.text('Forget which move?', x + 24, y + 54, { size: 21, color: '#555' });
    opts.forEach((o, i) => {
      const oy = y + 96 + i * 36;
      if (i === m.machineLearnIndex) r.cursor(x + 18, oy + 3);
      r.text(o, x + 42, oy, { size: 24, color: i === opts.length - 1 ? '#a04030' : '#2b2b3a' });
    });
    return;
  }
}

function hpColor(pct) {
  if (pct > 0.5) return '#4caf50';
  if (pct > 0.2) return '#e8c93a';
  return '#e0503a';
}

function renderBattle() {
  const r = game.renderer;
  const b = game.battle;
  if (!b) return; // battle just ended mid-frame; overworld will render next frame
  // screen shake on big hits
  const fx = b.fx;
  const sx = fx.shakeT > 0 ? (Math.random() * 8 - 4) : 0;
  const sy = fx.shakeT > 0 ? (Math.random() * 6 - 3) : 0;
  r.ctx.save();
  r.ctx.translate(sx, sy);

  // background
  r.clear('#8fd0e8');
  r.fillRect(0, VIEW_H - 180, VIEW_W, 180, '#c8e89a');
  r.fillRect(0, VIEW_H - 192, VIEW_W, 12, '#a8c87a');

  // enemy (top-right), player (bottom-left) with lunge/flash/faint effects
  const enemy = b.enemy;
  const player = b.playerMon;
  r.fillRect(462, 186, 168, 30, 'rgba(255,255,255,0.25)'); // platform hint
  const drawMon = (mon, side, x, y, size) => {
    if (fx.downed[side] && !(fx.faintAnim && fx.faintAnim.side === side)) return;
    let dx = x, dy = y;
    if (fx.lunge[side] > 0) {
      const amt = Math.sin((1 - fx.lunge[side] / 220) * Math.PI) * 18;
      dx += side === 'player' ? amt : -amt;
    }
    if (fx.faintAnim && fx.faintAnim.side === side) {
      dy += (1 - fx.faintAnim.t / 350) * 80;
    }
    if (fx.flash[side] > 0 && Math.floor(fx.flash[side] / 55) % 2 === 0) return; // blink
    // Classic style: the player's own creature is seen from behind; the
    // opponent is seen face-on.
    const sprite = side === 'player' ? mon.spriteBack || mon.sprite : mon.sprite;
    sprite.draw(r.ctx, dx, dy, size, size);
  };
  drawMon(enemy, 'enemy', 468, 48, 144);
  drawMon(player, 'player', 72, 150, 168);

  // thrown orb arc during catch attempts
  const curBeat = b.beats[b.beatIndex];
  if (curBeat && curBeat.type === 'orb') {
    const t = 1 - Math.max(0, b.beatTimer) / 700;
    const ox = 150 + 380 * t;
    const oy = 250 - 120 * t - Math.sin(Math.PI * t) * 90;
    r.ctx.fillStyle = '#d84040';
    r.ctx.beginPath();
    r.ctx.arc(ox, oy, 13, 0, Math.PI * 2);
    r.ctx.fill();
    r.ctx.fillStyle = '#f5f0e0';
    r.ctx.beginPath();
    r.ctx.arc(ox, oy, 13, 0, Math.PI, false);
    r.ctx.fill();
    r.ctx.strokeStyle = '#2b2b3a';
    r.ctx.lineWidth = 2;
    r.ctx.beginPath();
    r.ctx.arc(ox, oy, 13, 0, Math.PI * 2);
    r.ctx.stroke();
  }

  r.ctx.restore();

  // enemy HP box (top-left); trainer battles also show their remaining party
  drawHPBox(r, 24, 24, enemy, b.displayHP.enemy, false);
  if (b.data.mode === 'trainer') {
    const total = b.data.enemyParty.length;
    const left = b.data.enemyParty.filter((m) => m.curHP > 0).length;
    r.text(`${b.data.trainerName}: ${left}/${total} left`, 24, 96, { size: 21, color: '#2b2b3a' });
  }
  // player HP box (bottom-right, above message area) with XP bar
  drawHPBox(r, VIEW_W - 324, VIEW_H - 240, player, b.displayHP.player, true);

  // message / command area
  const my = VIEW_H - 132;
  r.panel(12, my, VIEW_W - 24, 120);

  if (b.phase === 'resolve') {
    r.text(b.msg || '', 36, my + 30, { size: 24 });
    const beat = b.beats[b.beatIndex];
    if (beat && beat.type === 'msg' && b.beatTimer > 180) r.text('▼', VIEW_W - 48, my + 84, { size: 24, color: '#888' });
  } else if (b.phase === 'menu') {
    r.text(`What will ${player.name} do?`, 36, my + 30, { size: 24 });
    const opts = battleMenuOpts(b);
    const trapped = b.data.vol.player.trapped;
    opts.forEach((o, i) => {
      const ox = 396 + (i % 2) * 156;
      const oy = my + 30 + Math.floor(i / 2) * 42;
      if (i === b.menuIndex) r.cursor(ox - 24, oy + 3);
      // Party/Run are grayed out (not disabled outright for Run — attempting
      // to flee while trapped still costs a turn, same as any failed flee).
      const dimmed = trapped && (o === 'Party' || o === 'Run');
      r.text(o, ox, oy, { size: 24, color: dimmed ? '#999' : undefined });
    });
  } else if (b.phase === 'move') {
    const moves = player.moves;
    moves.forEach((mv, i) => {
      const ox = 42 + (i % 2) * 330;
      const oy = my + 24 + Math.floor(i / 2) * 42;
      if (i === b.moveIndex) r.cursor(ox - 24, oy + 3);
      const out = mv.curPP <= 0;
      r.text(mv.name, ox, oy, { size: 24, color: out ? '#999' : game.typeChart.color(mv.type) });
      r.text(`${mv.curPP}/${mv.pp}`, ox + 276, oy + 4, { align: 'right', size: 18, color: out ? '#b06a5a' : '#777' });
    });
    const sel = moves[b.moveIndex];
    r.text(`${sel.type}   ${sel.category}   PWR ${sel.power || '—'}   ACC ${sel.accuracy}   PP ${sel.curPP}/${sel.pp}`, VIEW_W - 24, my + 96, { align: 'right', size: 19, color: '#555' });
  } else if (b.phase === 'party') {
    renderPartyList(r, 'Switch to which creature?', b.partyIndex, 'Z: switch in (uses the turn)   X: back');
  } else if (b.phase === 'replace') {
    // No name in the title — renderPartyList doesn't wrap, and a long one runs
    // off the panel. The fainted creature is the 0 HP row in the list anyway.
    renderPartyList(r, 'Send out which creature?', b.partyIndex, 'Z: send in');
  } else if (b.phase === 'item') {
    const list = invEntries();
    const rows = Math.ceil(list.length / 2);
    for (let row = 0; row < BATTLE_ITEM_ROWS; row++) {
      for (let col = 0; col < 2; col++) {
        const i = (b.itemScroll + row) * 2 + col;
        if (i >= list.length) break;
        const entry = list[i];
        const ox = 42 + col * 330;
        const oy = my + 24 + row * 42;
        if (i === b.itemIndex) r.cursor(ox - 24, oy + 3);
        r.text(entry.def.name, ox, oy, { size: 24 });
        r.text(`x${entry.qty}`, ox + 252, oy, { align: 'right', size: 21, color: '#666' });
      }
    }
    if (rows > BATTLE_ITEM_ROWS) {
      const more = `${b.itemScroll > 0 ? '▲' : ' '}${b.itemScroll + BATTLE_ITEM_ROWS < rows ? '▼' : ' '}`;
      r.text(more, 36, my + 96, { size: 21, color: '#888' });
    }
    r.text('X: back', VIEW_W - 24, my + 96, { align: 'right', size: 21, color: '#555' });
  } else if (b.phase === 'learn') {
    const pl = b.pendingLearns[0];
    const moveName = game.dex.move(pl.move).name;
    const opts = [...pl.mon.moves.map((mv) => mv.name), 'Give up'];
    const w = 420, x = (VIEW_W - w) / 2, y = 84;
    r.panel(x, y, w, 132 + opts.length * 36);
    r.text(`${pl.mon.name} wants to learn ${moveName}!`, x + 24, y + 18, { size: 22, bold: true });
    r.text('Forget which move?', x + 24, y + 54, { size: 21, color: '#555' });
    opts.forEach((o, i) => {
      const oy = y + 96 + i * 36;
      if (i === b.learnIndex) r.cursor(x + 18, oy + 3);
      r.text(o, x + 42, oy, { size: 24, color: i === opts.length - 1 ? '#a04030' : '#2b2b3a' });
    });
  }
}

function drawHPBox(r, x, y, mon, shownHP, isPlayer) {
  r.panel(x, y, 300, isPlayer ? 108 : 66, { fill: '#f7f4e9' });
  r.text(`${mon.name}`, x + 18, y + 12, { size: 24, bold: true });
  if (mon.status) drawStatusBadge(r, x + 174, y + 9, mon.status);
  r.text(`Lv${mon.level}`, x + 282, y + 12, { align: 'right', size: 21 });
  const pct = shownHP / mon.maxHP;
  r.text('HP', x + 18, y + 45, { size: 18, color: '#c07a00' });
  r.bar(x + 54, y + 45, 222, 15, pct, hpColor(pct));
  if (isPlayer) {
    r.text(`${Math.max(0, shownHP)}/${mon.maxHP}`, x + 282, y + 66, { align: 'right', size: 21 });
    const lo = game.dex.xpTotalForLevel(mon.level);
    const hi = game.dex.xpTotalForLevel(mon.level + 1);
    const xpPct = mon.level >= 100 ? 1 : Math.max(0, Math.min(1, (mon.xp - lo) / (hi - lo)));
    r.text('EXP', x + 18, y + 90, { size: 15, color: '#3a5fa8' });
    r.bar(x + 54, y + 90, 222, 9, xpPct, '#3a8fe8');
  }
}

function renderEvolve() {
  const r = game.renderer;
  const e = game.evolve;
  const item = e.q[e.i];
  const mon = item.mon;
  r.clear('#181028');
  r.fillRect(0, 0, VIEW_W, 6, '#3a2a6a');
  r.fillRect(0, VIEW_H - 6, VIEW_W, 6, '#3a2a6a');
  mon.sprite.draw(r.ctx, VIEW_W / 2 - 120, 72, 240, 240);
  const y = VIEW_H - 132;
  r.panel(12, y, VIEW_W - 24, 120);
  const msg = e.step === 0
    ? `What? ${mon.name} is evolving!`
    : `${item.oldName} evolved into ${mon.name}!`;
  r.text(msg, 36, y + 42, { size: 24 });
  r.text('▼', VIEW_W - 48, y + 90, { size: 24, color: '#888' });
}

// ---- Go ------------------------------------------------------------------

boot().catch((e) => {
  console.error(e);
  const c = document.getElementById('game-canvas');
  if (c) {
    const g = c.getContext('2d');
    g.fillStyle = '#300';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.font = '24px monospace';
    g.fillText('Boot error: ' + e.message, 24, 48);
    g.fillText('Serve over http:// (not file://).', 24, 84);
  }
});

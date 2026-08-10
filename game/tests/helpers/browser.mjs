// browser.mjs — drives the real game in a real browser.
//
// Playwright is not a dependency of this repo (there is no build step and
// nothing to install), so this looks for it and reports back rather than
// failing: `available` is false when it cannot be found, and the browser tests
// skip themselves. Point PLAYWRIGHT_MODULE at an install to override.
//
// The game reads *held* keys for walking and edge presses for menus, so this
// exposes both: `press` for menu input, `walk` for a tile of movement.

import path from 'node:path';
import { startServer } from './server.mjs';
import { recorderScript, auditDraws, describeViolations } from './draw-audit.mjs';

const STEP_MS = 140; // must match STEP_MS in js/main.js

async function importPlaywright() {
  const globalModules = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules');
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    path.join(globalModules, 'playwright', 'index.mjs'),
    path.join(globalModules, 'playwright-core', 'index.mjs'),
  ].filter(Boolean);
  for (const specifier of candidates) {
    try {
      return await import(specifier);
    } catch {
      /* try the next one */
    }
  }
  return null;
}

const playwright = await importPlaywright();
export const available = playwright !== null;
export const unavailableReason =
  'playwright not found — install it, or set PLAYWRIGHT_MODULE, to run the browser tests';

// Opens /game/ in a fresh page. `save` (optional) is written to localStorage
// before the game boots, so a test can start from any point in the game
// without playing through to it.
export async function openGame({ save = null, query = '', audit = false } = {}) {
  if (!available) throw new Error(unavailableReason);
  const server = await startServer();
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });

  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  if (save) {
    await page.addInitScript((data) => {
      localStorage.setItem('jg_creature_game_save_v1', JSON.stringify(data));
    }, save);
  }
  // Must be installed before the game's first frame, so it patches the context
  // ahead of any drawing.
  if (audit) await page.addInitScript(recorderScript);

  await page.goto(`${server.url}/game/index.html${query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000); // boot: data fetch + sprite preload

  const api = {
    page,
    errors,

    // Menu-style input: one edge press.
    async press(key, times = 1, settle = 160) {
      for (let i = 0; i < times; i++) {
        await page.keyboard.press(key);
        await page.waitForTimeout(settle);
      }
    },
    // Overworld movement reads held keys, so hold one long enough for a tile.
    async walk(key, tiles = 1) {
      for (let i = 0; i < tiles; i++) {
        await page.keyboard.down(key);
        await page.waitForTimeout(STEP_MS + 10);
        await page.keyboard.up(key);
        await page.waitForTimeout(120);
      }
    },
    async screenshot(file) {
      await page.locator('#game-canvas').screenshot({ path: file });
    },
    // Sample a canvas pixel — the cheapest way to tell scenes apart from
    // outside the game, since its state lives in a module closure.
    pixel(x, y) {
      return page.evaluate(([px, py]) => {
        const d = document.getElementById('game-canvas').getContext('2d').getImageData(px, py, 1, 1).data;
        return [d[0], d[1], d[2]];
      }, [x, y]);
    },
    // The battle scene paints its sky (#8fd0e8) across the top of the canvas.
    async inBattle() {
      const [r, g, b] = await api.pixel(8, 8);
      return Math.abs(r - 143) < 12 && Math.abs(g - 208) < 12 && Math.abs(b - 232) < 12;
    },
    // Step around in grass until a wild encounter fires. Returns false if none
    // did within `tries` steps (encounter rates are ~16%, so this is generous).
    async findEncounter(tries = 40) {
      for (let i = 0; i < tries; i++) {
        await api.walk(i % 2 ? 'ArrowUp' : 'ArrowDown', 1);
        if (await api.inBattle()) return true;
      }
      return false;
    },
    // --- layout audit (requires openGame({ audit: true })) ------------------

    // Throw away everything drawn so far, so a check covers one screen only.
    async resetDraws() {
      await page.evaluate(() => { window.__drawLog = []; });
    },
    async draws() {
      return page.evaluate(() => window.__drawLog || []);
    },
    // Every text draw since the last reset, checked against the canvas and
    // against the panel it sits in. Returns a description, or '' if clean.
    async auditLayout(label = '') {
      const records = await api.draws();
      const violations = auditDraws(records, { width: 720, height: 480 });
      if (!violations.length) return '';
      return `${label ? `${label}: ` : ''}${violations.length} layout violation(s)\n`
        + describeViolations(violations);
    },

    async close() {
      await browser.close();
      await server.close();
    },
  };
  return api;
}

// A minimal valid save (v4) that tests can spread into and adjust.
export function makeSave(overrides = {}) {
  return {
    version: 4,
    hasSaved: true,
    savedAt: Date.now(),
    starterChosen: 'emberling',
    player: { map: 'village', x: 6, y: 7, facing: 'down' },
    party: [{
      species: 'emberclaw', level: 18, xp: 18 ** 3, curHP: 49,
      moves: null, status: null, statusCounter: 0,
    }],
    storage: [],
    money: 2000,
    inventory: { snare_orb: 5, potion: 3 },
    machines: { TM01: 1, HM01: 1 },
    dexState: { seen: ['emberclaw'], caught: ['emberclaw'] },
    flags: {},
    ...overrides,
  };
}

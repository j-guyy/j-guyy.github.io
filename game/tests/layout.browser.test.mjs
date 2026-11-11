// layout.browser.test.mjs — no text may draw outside its box, on any screen.
//
// This is the call-site half of the layout guard: renderer.test.mjs proves the
// wrapping helpers keep text inside a width, and this proves the screens
// actually route their text through them. Every check walks to a screen,
// clears the draw log, lets a frame render, and audits what was drawn — so a
// panel that grows, a string that gets longer, or a box that forgets to wrap
// shows up as a failure naming the offending text.
//
// See helpers/draw-audit.mjs for the two rules and how panels are recognised.

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, unavailableReason, openGame, makeSave } from './helpers/browser.mjs';
import { horizontalExtent } from './helpers/draw-audit.mjs';

const opts = available ? {} : { skip: unavailableReason };

// Give the game a frame or two to draw the screen we just navigated to.
async function settle(game) {
  await game.page.waitForTimeout(220);
}

// Clear the log, redraw, and assert nothing escaped.
async function check(game, label) {
  await game.resetDraws();
  await settle(game);
  const problems = await game.auditLayout(label);
  assert.equal(problems, '', problems);
}

test('title, starter select and the overworld keep their text in bounds', opts, async () => {
  const game = await openGame({ audit: true });
  try {
    await check(game, 'title');

    await game.press('ArrowDown');            // Continue, with no save to continue
    await game.press('KeyZ');
    await check(game, 'title with the "No save yet." message');
    assert.ok((await game.draws()).some((d) => d.text === 'No save yet.'), 'the message should show after the press');
    await game.press('ArrowUp');
    // The message belongs to the press that caused it: moving the cursor clears it.
    await game.resetDraws();
    await settle(game);
    assert.ok(!(await game.draws()).some((d) => d.text === 'No save yet.'), 'the message should clear when the cursor moves');

    await game.press('KeyZ');                 // New Game -> starter select
    for (const starter of ['first', 'second', 'third']) {
      await check(game, `starter select (${starter})`);
      await game.press('ArrowRight');
    }

    await game.press('KeyZ');                 // into the world
    await game.page.waitForTimeout(500);
    await check(game, 'overworld with the map-name banner');
  } finally {
    await game.close();
  }
});

test('touch mode keeps the title and starter hints in bounds', opts, async () => {
  // ?touch=1 forces the on-screen pad, which swaps every key hint for the
  // pad's labels (A / B / D-pad) — different strings, same boxes.
  const game = await openGame({ audit: true, query: '?touch=1' });
  try {
    await check(game, 'title (touch)');
    // Use the on-screen A button, not a key: a real game key switches the
    // hints to keyboard names (see the hardware-keyboard test below).
    await game.page.locator('#touch-controls [data-act="confirm"]').click();
    await game.page.waitForTimeout(160);
    await check(game, 'starter select (touch)');
    assert.ok((await game.draws()).some((d) => /A select\s+B back/.test(d.text)), 'starter hint should name the pad buttons');
    assert.deepEqual(game.errors, [], game.errors.join('\n'));
  } finally {
    await game.close();
  }
});

test('touch mode switches its hints to keyboard names after a game key', opts, async () => {
  // A tablet with a hardware keyboard: touch hints until the first game key.
  const game = await openGame({ audit: true, query: '?touch=1' });
  try {
    await check(game, 'title (touch)');
    assert.ok((await game.draws()).some((d) => (d.text || '').includes('D-pad')), 'touch hints before any key');
    await game.press('ArrowDown');
    await check(game, 'title (touch, after a key press)');
    const texts = (await game.draws()).map((d) => d.text || '');
    assert.ok(texts.some((t) => t.includes('Arrows')), 'keyboard hints after a game key');
    assert.ok(!texts.some((t) => t.includes('D-pad')), 'no pad names after a game key');
    assert.ok(await game.page.locator('#touch-controls').isVisible(), 'the pad stays on screen');
    assert.deepEqual(game.errors, [], game.errors.join('\n'));
  } finally {
    await game.close();
  }
});

test('every pause-menu screen keeps its text in bounds', opts, async () => {
  const game = await openGame({
    audit: true,
    save: makeSave({
      money: 4321,
      // A full spread of items and machines, so the lists are at their longest.
      inventory: { snare_orb: 5, great_orb: 2, potion: 3, super_potion: 2, remedy_leaf: 1, revive_seed: 1 },
      machines: { TM01: 1, TM02: 1, TM03: 1, TM04: 1, TM05: 1, TM06: 1, TM07: 1, HM01: 1, HM02: 1 },
      party: [
        { species: 'emberclaw', level: 21, xp: 21 ** 3 + 400, curHP: 41, moves: null, status: 'burn', statusCounter: 0 },
        { species: 'verdantitan', level: 34, xp: 34 ** 3, curHP: 90, moves: null, status: null, statusCounter: 0 },
        { species: 'gyreshell', level: 24, xp: 24 ** 3, curHP: 70, moves: null, status: 'toxic', statusCounter: 2 },
      ],
    }),
  });
  try {
    await game.press('KeyZ');
    await game.page.waitForTimeout(500);
    await game.press('KeyX');
    await check(game, 'pause menu root');

    await game.press('KeyZ');                 // Party
    await check(game, 'party list');
    await game.press('KeyZ');                 // summary
    for (const which of [0, 1, 2]) {
      await check(game, `creature summary ${which}`);
      await game.press('ArrowDown');
    }
    await game.press('KeyX');
    await game.press('KeyX');

    await game.press('KeyX');
    await game.press('ArrowDown');
    await game.press('KeyZ');                 // CreatureDex
    await check(game, 'creature dex list');
    await game.press('KeyZ');                 // a dex entry
    await check(game, 'creature dex entry');
    await game.press('KeyX');
    await game.press('KeyX');
    await game.press('KeyX');

    await game.press('KeyX');
    await game.press('ArrowDown', 2);
    await game.press('KeyZ');                 // Items
    await check(game, 'items list');
    await game.press('ArrowDown', 5);
    await check(game, 'items list scrolled');
    await game.press('KeyZ');                 // choose a target
    await check(game, 'item target');
    await game.press('KeyX');
    await game.press('KeyX');

    await game.press('KeyX');
    await game.press('ArrowDown', 3);
    await game.press('KeyZ');                 // TMs & HMs
    await check(game, 'machines list');
    await game.press('ArrowDown', 8);
    await check(game, 'machines list scrolled');
    await game.press('KeyZ');                 // teach to whom
    await check(game, 'machine target');
    await game.press('KeyX');
    await game.press('KeyX');

    await game.press('KeyX');
    await game.press('ArrowDown', 5);
    await game.press('KeyZ');                 // Quit to Title -> confirmation
    await check(game, 'quit confirmation');
  } finally {
    await game.close();
  }
});

test('battle screens keep their text in bounds', opts, async () => {
  const game = await openGame({
    audit: true,
    save: makeSave({
      player: { map: 'route1', x: 3, y: 1, facing: 'down' },
      inventory: { snare_orb: 5, great_orb: 2, potion: 3, super_potion: 2, remedy_leaf: 1, revive_seed: 1 },
      party: [
        { species: 'verdantitan', level: 34, xp: 34 ** 3, curHP: 90, moves: null, status: 'toxic', statusCounter: 2 },
        { species: 'voltpup', level: 12, xp: 12 ** 3, curHP: 30, moves: null, status: null, statusCounter: 0 },
      ],
    }),
  });
  try {
    await game.press('KeyZ');
    await game.page.waitForTimeout(500);
    assert.ok(await game.findEncounter(), 'no wild encounter after 40 steps in grass');

    await check(game, 'battle intro message');
    await game.press('KeyZ', 2);
    await check(game, 'battle command menu');

    await game.press('KeyZ');                 // Fight
    await check(game, 'move grid');
    await game.press('KeyX');

    await game.press('ArrowDown');            // Item
    await game.press('KeyZ');
    await check(game, 'battle item grid');
    await game.press('ArrowDown', 2);
    await check(game, 'battle item grid scrolled');
    await game.press('KeyX');

    await game.press('ArrowRight');           // Party
    await game.press('KeyZ');
    await check(game, 'battle party switch');
    await game.press('KeyX');
  } finally {
    await game.close();
  }
});

test('shop, storage and dialogue keep their text in bounds', opts, async () => {
  const game = await openGame({
    audit: true,
    save: makeSave({ player: { map: 'town2', x: 9, y: 4, facing: 'up' }, money: 4000 }),
  });
  try {
    await game.press('KeyZ');
    await game.page.waitForTimeout(500);
    await game.walk('ArrowUp', 1);            // into the Machine Works
    await game.page.waitForTimeout(500);
    await game.walk('ArrowUp', 2);
    await game.press('KeyZ');                 // Tinker Sable's dialogue
    await check(game, 'dialogue');
    await game.press('KeyZ');
    await check(game, 'dialogue page 2');
    await game.press('KeyZ', 3);              // through into the shop
    await check(game, 'shop list');
    await game.press('ArrowDown', 6);
    await check(game, 'shop list scrolled');
    await game.press('KeyZ');                 // buy, so the message line shows
    await check(game, 'shop after buying');
  } finally {
    await game.close();
  }
});

test('the black-out banner stays on the canvas', opts, async () => {
  // The banner that reported this bug in the first place: long enough to run
  // off the right edge before it wrapped.
  const game = await openGame({
    audit: true,
    save: makeSave({
      player: { map: 'route1', x: 3, y: 1, facing: 'down' },
      party: [{
        species: 'sproutle', level: 3, xp: 27, curHP: 1,
        moves: [{ id: 'nudge', pp: 35 }], status: null, statusCounter: 0,
      }],
      money: 901,
      inventory: {},
    }),
  });
  try {
    await game.press('KeyZ');
    await game.page.waitForTimeout(500);
    assert.ok(await game.findEncounter(), 'no wild encounter after 40 steps in grass');

    await game.press('KeyZ', 2);
    for (let i = 0; i < 14; i++) {
      await game.press('KeyZ');
      if (!(await game.inBattle())) break;
    }
    await game.page.waitForTimeout(600);
    assert.ok(!(await game.inBattle()), 'should be back in the overworld after blacking out');
    await check(game, 'black-out payout banner');
  } finally {
    await game.close();
  }
});

test('the longest move name does not run into its PP count', opts, async () => {
  // "Falling Star Fist" (17 characters) at the grid's 22px overlapped the PP
  // text; the cell now steps the font down (Renderer.fitText) to keep a gap.
  const game = await openGame({
    audit: true,
    save: makeSave({
      player: { map: 'route1', x: 3, y: 1, facing: 'down' },
      party: [{
        species: 'verdantitan', level: 34, xp: 34 ** 3, curHP: 90, status: null, statusCounter: 0,
        moves: [
          { id: 'falling_star_fist', pp: 10 }, { id: 'ice_lance_volley', pp: 5 },
          { id: 'soothing_bouquet', pp: 5 }, { id: 'cataclysm_flame', pp: 5 },
        ],
      }],
    }),
  });
  try {
    await game.press('KeyZ');
    await game.page.waitForTimeout(500);
    assert.ok(await game.findEncounter(), 'no wild encounter after 40 steps in grass');
    await game.press('KeyZ', 2);
    await game.press('KeyZ');                 // Fight
    await check(game, 'move grid with the longest names');

    const draws = (await game.draws()).filter((d) => d.kind === 'text');
    const name = draws.find((d) => d.text.startsWith('Falling Star'));
    assert.ok(name, 'the move name should be drawn');
    assert.ok(name.size >= 16 && name.size <= 22, `name drawn at ${name.size}px`);
    // Its PP count: right-aligned, same cell (the first one to its right, same row).
    const pp = draws.find((d) => d.align === 'right' && /^\d+\/\d+$/.test(d.text)
      && Math.abs(d.y - name.y) < 12 && d.x > name.x && d.x - name.x < 300);
    assert.ok(pp, 'the PP count should be drawn beside the name');
    const nameRight = horizontalExtent(name)[1];
    const ppLeft = horizontalExtent(pp)[0];
    assert.ok(nameRight <= ppLeft, `name ends at ${nameRight}, PP starts at ${ppLeft}`);
  } finally {
    await game.close();
  }
});

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

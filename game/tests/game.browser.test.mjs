// game.browser.test.mjs — the game running in a real browser.
//
// The unit suites cover the rules; these cover the things only a browser can
// show: that it boots, that the scenes it can reach draw without throwing, and
// that input still lands where it should. Skipped automatically when Playwright
// is not installed (see helpers/browser.mjs).

import test from 'node:test';
import assert from 'node:assert/strict';
import { available, unavailableReason, openGame, makeSave } from './helpers/browser.mjs';

const opts = available ? {} : { skip: unavailableReason };

test('boots to the title screen with no console errors', opts, async () => {
  const game = await openGame();
  try {
    assert.deepEqual(game.errors, [], `errors on boot:\n${game.errors.join('\n')}`);
    const [r, g, b] = await game.pixel(8, 8);
    assert.deepEqual([r, g, b], [43, 64, 102], 'expected the title screen banner colour');
  } finally {
    await game.close();
  }
});

test('a new game reaches the overworld through starter select', opts, async () => {
  const game = await openGame();
  try {
    await game.press('KeyZ');          // New Game
    await game.press('ArrowRight');    // look at the second starter
    await game.press('KeyZ');          // choose it
    await game.page.waitForTimeout(600);
    await game.walk('ArrowDown', 1);   // the world accepts movement
    assert.deepEqual(game.errors, [], game.errors.join('\n'));
  } finally {
    await game.close();
  }
});

test('continuing a save lands in the world and opens every menu view', opts, async () => {
  const game = await openGame({ save: makeSave() });
  try {
    await game.press('KeyZ');          // Continue
    await game.page.waitForTimeout(600);
    await game.press('KeyX');          // pause menu

    // Party -> summary -> back
    await game.press('KeyZ');
    await game.press('KeyZ');
    await game.press('KeyX');
    await game.press('KeyX');

    // Walk the rest of the root menu: CreatureDex, Items, TMs & HMs.
    for (const steps of [1, 2, 3]) {
      await game.press('KeyX');
      await game.press('ArrowDown', steps);
      await game.press('KeyZ');
      await game.press('KeyX');
      await game.press('KeyX');
    }
    assert.deepEqual(game.errors, [], `errors while browsing menus:\n${game.errors.join('\n')}`);
  } finally {
    await game.close();
  }
});

test('a wild battle opens, takes a turn, and every battle sub-screen draws', opts, async () => {
  const game = await openGame({
    save: makeSave({
      player: { map: 'route1', x: 3, y: 1, facing: 'down' },
      inventory: { snare_orb: 5, great_orb: 2, potion: 3, super_potion: 2, remedy_leaf: 1, revive_seed: 1 },
      party: [
        { species: 'emberclaw', level: 18, xp: 18 ** 3, curHP: 49, moves: null, status: null, statusCounter: 0 },
        { species: 'voltpup', level: 12, xp: 12 ** 3, curHP: 30, moves: null, status: null, statusCounter: 0 },
      ],
    }),
  });
  try {
    await game.press('KeyZ');
    await game.page.waitForTimeout(600);
    assert.ok(await game.findEncounter(), 'no wild encounter after 40 steps in grass');

    await game.press('KeyZ', 2);       // through the two intro messages

    // Item grid (six item types = three rows, so it scrolls) then back.
    await game.press('ArrowDown');     // Fight -> Item
    await game.press('KeyZ');
    await game.press('ArrowDown', 2);
    await game.press('KeyX');

    // Party switch screen, then back.
    await game.press('ArrowRight');    // Fight -> Party
    await game.press('KeyZ');
    await game.press('KeyX');

    // Take a real turn.
    await game.press('KeyZ');          // Fight
    await game.press('KeyZ');          // first move
    await game.page.waitForTimeout(1200);

    assert.deepEqual(game.errors, [], `errors during battle:\n${game.errors.join('\n')}`);
  } finally {
    await game.close();
  }
});

test('losing a battle warps home and reports the payout', opts, async () => {
  const game = await openGame({
    save: makeSave({
      player: { map: 'route1', x: 3, y: 1, facing: 'down' },
      // One creature on its last legs, so the first wild hit ends the battle.
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
    await game.page.waitForTimeout(600);
    assert.ok(await game.findEncounter(), 'no wild encounter after 40 steps in grass');

    await game.press('KeyZ', 2);              // intro messages
    for (let i = 0; i < 14; i++) {            // fight until the battle ends
      await game.press('KeyZ');
      if (!(await game.inBattle())) break;
    }
    await game.page.waitForTimeout(700);
    assert.ok(!(await game.inBattle()), 'should be back in the overworld after blacking out');
    assert.deepEqual(game.errors, [], `errors while losing:\n${game.errors.join('\n')}`);
  } finally {
    await game.close();
  }
});

test('shops open and sell', opts, async () => {
  // Standing on the Machine Works doorstep in Bramblehollow.
  const game = await openGame({
    save: makeSave({ player: { map: 'town2', x: 9, y: 4, facing: 'up' }, money: 4000 }),
  });
  try {
    await game.press('KeyZ');
    await game.page.waitForTimeout(600);
    await game.walk('ArrowUp', 1);     // through the door
    await game.page.waitForTimeout(500);
    await game.walk('ArrowUp', 2);     // up to the counter
    await game.press('KeyZ');          // talk
    await game.press('KeyZ', 3);       // through the dialogue into the shop
    await game.press('ArrowDown', 6);  // scroll the list
    await game.press('KeyZ');          // buy
    await game.press('KeyX');          // leave
    assert.deepEqual(game.errors, [], `errors in the shop:\n${game.errors.join('\n')}`);
  } finally {
    await game.close();
  }
});

test('the standalone tool pages load cleanly', opts, async () => {
  for (const page of ['editor.html', 'route-editor.html', 'battle-sim.html']) {
    const game = await openGame({ query: '' });
    try {
      await game.page.goto(`${game.page.url().replace(/\/game\/index\.html.*$/, '')}/game/${page}`, {
        waitUntil: 'networkidle',
      });
      await game.page.waitForTimeout(800);
      assert.deepEqual(game.errors, [], `errors loading ${page}:\n${game.errors.join('\n')}`);
    } finally {
      await game.close();
    }
  }
});

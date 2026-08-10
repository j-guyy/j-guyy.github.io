// renderer.test.mjs — the text-fitting primitives every UI panel draws through.
//
// Each of these underpins a fixed-width box somewhere on screen (dialogue,
// item and machine descriptions, the starter blurb, the top-left banner), so a
// line that comes back wider than it asked for is text running off the panel —
// or, in the banner's case, off the canvas entirely.
//
// The DOM stub measures text at a flat 8px per character, so widths here are
// exact and the assertions do not depend on a real font.

import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/dom-stub.mjs';
import { Renderer } from '../js/engine/renderer.js';

const CHAR_PX = 8; // must match measureText in helpers/dom-stub.mjs
const r = new Renderer(document.createElement('canvas'));
const widthOf = (line) => line.length * CHAR_PX;

test('wrapText keeps every line inside the width it was given', () => {
  const text = 'Emberling naps curled around warm stones and wakes in a puff of sparks.';
  for (const maxWidth of [80, 160, 240, 400, 640]) {
    for (const line of r.wrapText(text, maxWidth, 24)) {
      assert.ok(widthOf(line) <= maxWidth, `"${line}" is ${widthOf(line)}px in a ${maxWidth}px box`);
    }
  }
});

test('wrapText keeps all the words, in order', () => {
  const text = 'You scurried back to Meadowfen... and dropped 450c.';
  assert.equal(r.wrapText(text, 200, 24).join(' '), text);
});

test('wrapClamped never exceeds its line budget', () => {
  const text = 'A very long description that will certainly not fit inside two short lines of text.';
  for (const maxLines of [1, 2, 3]) {
    assert.ok(r.wrapClamped(text, 120, 21, maxLines).length <= maxLines);
  }
});

test('wrapClamped keeps every line inside the width, ellipsis included', () => {
  // The ellipsis is the easy thing to get wrong: appending it after fitting the
  // line is what would push the last row past the edge.
  const text = 'Revives a fainted creature to half HP. Too potent to use in the middle of a battle.';
  for (const maxWidth of [96, 120, 200, 320]) {
    const lines = r.wrapClamped(text, maxWidth, 21, 2);
    for (const line of lines) {
      assert.ok(widthOf(line) <= maxWidth, `"${line}" is ${widthOf(line)}px in a ${maxWidth}px box`);
    }
  }
});

test('wrapClamped marks text it had to cut, and leaves the rest alone', () => {
  const long = r.wrapClamped('one two three four five six seven eight nine ten', 80, 21, 2);
  assert.ok(long.at(-1).endsWith('...'), `expected a truncation marker, got "${long.at(-1)}"`);

  const short = r.wrapClamped('all good', 800, 21, 2);
  assert.deepEqual(short, ['all good'], 'text that fits should come back untouched');
});

test('wrapClamped survives empty and missing text', () => {
  assert.deepEqual(r.wrapClamped('', 200, 21, 2), ['']);
  assert.deepEqual(r.wrapClamped(undefined, 200, 21, 2), ['']);
  assert.deepEqual(r.wrapClamped(null, 200, 21, 2), ['']);
});

test('a single unbreakable word is truncated rather than left overflowing', () => {
  const lines = r.wrapClamped('Supercalifragilisticexpialidocious', 80, 21, 1);
  assert.equal(lines.length, 1);
  assert.ok(widthOf(lines[0]) <= 80, `"${lines[0]}" is ${widthOf(lines[0])}px in an 80px box`);
});

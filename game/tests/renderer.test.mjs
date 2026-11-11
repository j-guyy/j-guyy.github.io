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

test('the longest battle messages fit the two-line battle message box', () => {
  // main.js draws a battle message through wrapClamped(msg, 648, 24, 2). At
  // 24px a monospace glyph is about 14.4px, so 648px holds 45 characters; the
  // stub measures 8px a glyph, so the same 45-character budget is 360px here.
  const budget = 45 * CHAR_PX;
  const messages = [
    'Verdantitan cut its own HP and maximized its Attack!',
    'A shimmering wall of light cuts down physical damage!',
    "Falling Star Fist rings out, curing the whole party's status!",
  ];
  for (const msg of messages) {
    assert.ok(widthOf(msg) > budget, `"${msg}" should need a second line`);
    const lines = r.wrapClamped(msg, budget, 24, 2);
    assert.equal(lines.length, 2);
    assert.equal(lines.join(' '), msg, 'nothing may be cut off');
    for (const line of lines) assert.ok(widthOf(line) <= budget, `"${line}" overflows`);
  }
});

// fitText picks a font size, so it needs a context whose measureText follows
// the font (the DOM stub's flat 8px does not). Monospace is ~0.6em a glyph.
function sizedRenderer() {
  const ctx = {
    font: '',
    measureText(text) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)[1]);
      return { width: String(text).length * size * 0.6 };
    },
  };
  const proto = Renderer.prototype;
  return { ctx, textWidth: proto.textWidth, fitText: proto.fitText, wrapText: proto.wrapText, wrapClamped: proto.wrapClamped };
}

test('fitText leaves text that fits at full size', () => {
  const fit = sizedRenderer().fitText('Ember', 200, 22, 16);
  assert.deepEqual(fit, { text: 'Ember', size: 22 });
});

test('fitText steps the font down before it cuts anything', () => {
  // The battle move grid: 276px cell, less a "10/10" PP count at 18px (54px),
  // an 8px gap and the 17px type swatch, leaves 197px for the name.
  const sr = sizedRenderer();
  const fit = sr.fitText('Falling Star Fist', 197, 22, 16);
  assert.equal(fit.text, 'Falling Star Fist', 'the whole name survives');
  assert.ok(fit.size < 22 && fit.size >= 16, `drawn at ${fit.size}px`);
  assert.ok(sr.textWidth(fit.text, fit.size) <= 197);
  assert.ok(sr.textWidth(fit.text, fit.size + 1) > 197, 'the largest size that fits is used');
});

test('fitText clamps with an ellipsis at the floor size', () => {
  const sr = sizedRenderer();
  const fit = sr.fitText('An Absurdly Long Editor Authored Move Name', 197, 22, 16);
  assert.equal(fit.size, 16);
  assert.ok(fit.text.endsWith('...'), `"${fit.text}" should end in an ellipsis`);
  assert.ok(sr.textWidth(fit.text, 16) <= 197, `"${fit.text}" overflows`);
});

test('every move name in the data fits the battle grid cell uncut', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = JSON.parse(await readFile(new URL('../data/moves.json', import.meta.url), 'utf8'));
  const moves = Object.values(raw.moves || raw).filter((m) => m && typeof m === 'object' && m.name);
  assert.ok(moves.length > 0, 'no moves found');
  const sr = sizedRenderer();
  for (const mv of moves) {
    const pp = `${mv.pp}/${mv.pp}`;
    const room = 276 - sr.textWidth(pp, 18) - 8 - 17;
    const fit = sr.fitText(mv.name, room, 22, 16);
    assert.equal(fit.text, mv.name, `"${mv.name}" was cut`);
  }
});

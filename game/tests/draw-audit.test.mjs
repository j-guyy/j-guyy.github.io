// draw-audit.test.mjs — the layout auditor's own rules.
//
// The auditor is what lets the browser suite assert "no text drew outside its
// box" across every screen at once, so it has to be trustworthy on its own:
// it must flag the shapes that are really wrong and stay quiet about the ones
// that are fine.

import test from 'node:test';
import assert from 'node:assert/strict';
import { auditDraws, horizontalExtent, verticalExtent } from './helpers/draw-audit.mjs';

const CANVAS = { width: 720, height: 480 };

// Renderer.panel(x, y, w, h) emits these two strokes; the auditor recognises a
// panel by the second being inset 4px on every side.
const panel = (x, y, w, h) => ([
  { kind: 'stroke', x: x + 1, y: y + 1, w: w - 2, h: h - 2 },
  { kind: 'stroke', x: x + 5, y: y + 5, w: w - 10, h: h - 10 },
]);

const text = (str, x, y, { width = str.length * 14.4, size = 24, align = 'left', baseline = 'top' } = {}) =>
  ({ kind: 'text', text: str, x, y, width, size, align, baseline });

test('clean draws produce no violations', () => {
  const records = [...panel(12, 12, 400, 60), text('Meadowfen Village', 36, 27)];
  assert.deepEqual(auditDraws(records, CANVAS), []);
});

test('text running off the right of the canvas is caught', () => {
  // The black-out banner bug: the panel was clamped to the canvas but the text
  // was drawn at full length regardless, so it ran off the edge.
  const long = 'You scurried back to Meadowfen... and dropped 450c.';
  const records = [...panel(12, 12, 696, 48), text(long, 36, 27)];

  const violations = auditDraws(records, CANVAS);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'canvas');
  assert.match(violations[0].detail, /dropped 450c/);
});

test('text overflowing its panel is caught even while on the canvas', () => {
  // The quit-confirm warning: comfortably inside the canvas, but past the
  // panel border it was supposed to sit in.
  // Panel spans x 132..588; the text runs to 606 — past the panel, but still
  // 114px clear of the canvas edge, so only the panel rule should fire.
  const records = [
    ...panel(132, 156, 456, 168),
    text('Progress since your last save will be lost.', 156, 214, { width: 450 }),
  ];
  const violations = auditDraws(records, CANVAS);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'panel');
});

test('text below its panel is caught', () => {
  const records = [...panel(100, 100, 300, 60), text('spilling downward', 120, 150)];
  const violations = auditDraws(records, CANVAS);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'panel');
});

test('a violation is reported once, not once per rule', () => {
  const records = [...panel(600, 12, 100, 40), text('far too long to fit anywhere', 620, 20)];
  assert.equal(auditDraws(records, CANVAS).length, 1);
});

test('right- and centre-aligned text is measured from the correct edge', () => {
  // Right-aligned: x is where the text ends, so it may sit at the canvas edge.
  const fine = [text('120/120', 700, 30, { align: 'right', width: 100 })];
  assert.deepEqual(auditDraws(fine, CANVAS), []);

  // ...but the same call near the left edge runs off it.
  const off = [text('120/120', 40, 30, { align: 'right', width: 100 })];
  assert.equal(auditDraws(off, CANVAS).length, 1);

  const centred = [text('CREATURE QUEST', 360, 40, { align: 'center', width: 300 })];
  assert.deepEqual(auditDraws(centred, CANVAS), []);

  const centredTooWide = [text('CREATURE QUEST', 360, 40, { align: 'center', width: 800 })];
  assert.equal(auditDraws(centredTooWide, CANVAS).length, 1);
});

test('text outside every panel is still held to the canvas', () => {
  const records = [text('a title with no panel behind it', 600, 40, { width: 400 })];
  const violations = auditDraws(records, CANVAS);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'canvas');
});

test('the innermost panel wins when panels overlap', () => {
  // A prompt drawn over a full-screen menu: the text belongs to the prompt.
  const records = [
    ...panel(18, 18, 684, 444),   // the menu behind
    ...panel(150, 96, 420, 120),  // the prompt on top
    text('Forget which move?', 174, 150, { width: 400 }),
  ];
  const violations = auditDraws(records, CANVAS);
  assert.equal(violations.length, 1, 'should be judged against the prompt, not the menu');
  assert.equal(violations[0].rule, 'panel');
});

test('a panel drawn after the text does not claim it', () => {
  // Draw order matters: the battle HP boxes are drawn and filled before the
  // message panel below them exists.
  const records = [
    ...panel(24, 24, 300, 66),
    text('Emberclaw', 42, 36, { width: 200 }),
    ...panel(12, 348, 696, 120),
  ];
  assert.deepEqual(auditDraws(records, CANVAS), []);
});

test('bars and cursors are not mistaken for panels', () => {
  // Renderer.bar() emits a single strokeRect; two in a row must not look like
  // a panel and start swallowing text.
  const records = [
    { kind: 'stroke', x: 55, y: 46, w: 220, h: 13 }, // HP bar
    { kind: 'stroke', x: 55, y: 91, w: 220, h: 7 },  // EXP bar
    text('this text belongs to no panel', 36, 400, { width: 600 }),
  ];
  assert.deepEqual(auditDraws(records, CANVAS), []);
});

test('empty and whitespace draws are ignored', () => {
  const records = [...panel(12, 12, 100, 40), text('', 36, 27, { width: 0 }), text('   ', 36, 27, { width: 40 })];
  assert.deepEqual(auditDraws(records, CANVAS), []);
});

test('extent helpers agree with the alignment and baseline used', () => {
  assert.deepEqual(horizontalExtent({ x: 100, width: 50, align: 'left' }), [100, 150]);
  assert.deepEqual(horizontalExtent({ x: 100, width: 50, align: 'right' }), [50, 100]);
  assert.deepEqual(horizontalExtent({ x: 100, width: 50, align: 'center' }), [75, 125]);
  assert.deepEqual(verticalExtent({ y: 40, size: 24, baseline: 'top' }), [40, 64]);
  assert.deepEqual(verticalExtent({ y: 40, size: 24, baseline: 'middle' }), [28, 52]);
  assert.deepEqual(verticalExtent({ y: 40, size: 24, baseline: 'alphabetic' }), [16, 40]);
});

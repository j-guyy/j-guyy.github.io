// ui.js — small DOM helpers shared by the team builder and the battle screen.

import { CREATURE_PX } from '../engine/assets.js';

// el('div.foo#bar', { onclick }, ['text', childNode]) — the tag string carries
// classes and an optional id so markup stays readable inline.
export function el(spec, props = {}, children = []) {
  const [head, ...classes] = spec.split('.');
  const [tag, id] = head.split('#');
  const node = document.createElement(tag || 'div');
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = [node.className, value].filter(Boolean).join(' ');
    // Must be the property, not the attribute: a <textarea>'s value comes from
    // its text content, so setAttribute('value') silently does nothing.
    else if (key === 'value') node.value = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// Sprites are canvas/Image-backed engine objects, so the simplest way to show
// one in the DOM is to blit it onto its own canvas at native resolution and let
// CSS scale it (image-rendering: pixelated keeps it crisp).
export function spriteEl(sprite, className = '') {
  const canvas = el('canvas', { class: `sim-sprite ${className}`.trim(), width: CREATURE_PX, height: CREATURE_PX });
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  sprite.draw(ctx, 0, 0, CREATURE_PX, CREATURE_PX);
  return canvas;
}

export function typeBadge(typeChart, type, extraClass = '') {
  return el(`span.type-badge${extraClass ? '.' + extraClass : ''}`, {
    text: type,
    style: { background: typeChart.color(type) },
  });
}

export function typeBadges(typeChart, types) {
  return el('span.type-badges', {}, types.map((t) => typeBadge(typeChart, t)));
}

export function categoryBadge(category) {
  const short = { physical: 'PHY', special: 'SPE', status: 'STA' }[category] || '?';
  return el(`span.cat-badge.cat-${category}`, { text: short, title: category });
}

// Green above 50%, amber above 20%, red below — the classic HP bar ramp.
export function hpClass(fraction) {
  if (fraction > 0.5) return 'hp-high';
  if (fraction > 0.2) return 'hp-mid';
  return 'hp-low';
}

export function effectivenessLabel(mult) {
  if (mult === 0) return { text: 'Immune', cls: 'eff-none' };
  if (mult >= 4) return { text: '4x', cls: 'eff-super' };
  if (mult >= 2) return { text: '2x', cls: 'eff-super' };
  if (mult <= 0.25) return { text: '¼x', cls: 'eff-weak' };
  if (mult < 1) return { text: '½x', cls: 'eff-weak' };
  return null;
}

export function moveSummary(move) {
  const power = move.ohko ? 'OHKO' : move.fixedDamage != null ? 'Fixed' : move.power ? String(move.power) : '—';
  const acc = move.accuracy != null ? `${move.accuracy}%` : '—';
  return { power, acc, pp: move.pp != null ? move.pp : 20 };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

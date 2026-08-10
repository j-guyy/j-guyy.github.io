// rng.mjs — control over the randomness the battle engine draws on.
//
// battle.js calls the global Math.random directly for damage spread, accuracy,
// crits, secondary-effect chances, sleep length and turn order, so swapping the
// global is enough to make a battle reproducible. Each helper restores the real
// Math.random afterwards, including when the body throws.
//
// Prefer `withSeed` and assert on behaviour ("it fainted", "the message
// appeared") rather than exact damage. Reach for `withRandom(0)` /
// `withRandom(0.999)` when a test needs every chance to fire or none to, and
// for `withRolls` only where the sequence of draws is short and obvious.

function restoring(fn, replacement) {
  const original = Math.random;
  Math.random = replacement;
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

// Small deterministic PRNG (mulberry32) — same seed, same battle, every run.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function withSeed(seed, fn) {
  return restoring(fn, mulberry32(seed));
}

// A constant (or any custom function) for every draw.
//   0     -> every chance fires, every move hits, damage rolls its minimum
//   0.999 -> nothing extra fires
export function withRandom(value, fn) {
  const next = typeof value === 'function' ? value : () => value;
  return restoring(fn, next);
}

// Feed an exact sequence of draws; once it runs out, fall back to `then`.
export function withRolls(values, fn, then = 0.5) {
  const queue = [...values];
  return restoring(fn, () => (queue.length ? queue.shift() : then));
}

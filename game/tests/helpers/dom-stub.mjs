// dom-stub.mjs — the minimum browser surface the game's modules touch, so they
// can be imported and exercised under plain Node.
//
// Only the drawing layer needs this: assets.js pre-renders every sprite onto an
// offscreen canvas, and Dex.makeInstance() attaches sprites to each creature
// instance. Nothing under test cares what those draw calls produce, so the 2D
// context is a no-op that records property writes and answers any method call.
//
// Import this before anything that reaches into game/js. Importing it twice is
// harmless — it never overwrites a real browser global.

function stubContext() {
  const props = {};
  const answers = {
    measureText: (text) => ({ width: String(text).length * 8 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createPattern: () => null,
  };
  return new Proxy(props, {
    get(target, prop) {
      if (prop in answers) return answers[prop];
      if (prop in target) return target[prop];
      return () => {}; // any drawing call: accepted, ignored
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

function stubCanvas() {
  const ctx = stubContext();
  return { width: 0, height: 0, getContext: () => ctx };
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') return stubCanvas();
      return { tagName: String(tag).toUpperCase(), style: {}, setAttribute() {}, appendChild() {} };
    },
    getElementById: () => null,
  };
}

if (typeof globalThis.Image === 'undefined') {
  // Baked creature PNGs never load under Node; assets.js treats a failed load as
  // "no baked art for this species" and falls back to the procedural sprite,
  // which is exactly what we want here.
  globalThis.Image = class {
    set src(_value) {
      if (typeof this.onerror === 'function') queueMicrotask(() => this.onerror());
    }
  };
}

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

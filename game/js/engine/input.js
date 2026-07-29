// input.js — keyboard -> intent. Keyboard only for Phase 1.
// Exposes both held state (isDown) for continuous movement and edge-triggered
// presses (consume) for menus/confirm/cancel.

const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'confirm', Enter: 'confirm', Space: 'confirm',
  KeyX: 'cancel', Escape: 'cancel', Backspace: 'cancel',
};

export class Input {
  constructor() {
    this.down = new Set(); // actions currently held
    this.pressQueue = []; // edge-triggered presses awaiting consumption

    window.addEventListener('keydown', (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      // prevent page scroll / back-navigation on game keys
      e.preventDefault();
      if (!this.down.has(action)) {
        this.pressQueue.push(action);
      }
      this.down.add(action);
    });

    window.addEventListener('keyup', (e) => {
      const action = KEYMAP[e.code];
      if (!action) return;
      this.down.delete(action);
    });

    // release everything if the tab loses focus
    window.addEventListener('blur', () => {
      this.down.clear();
    });
  }

  isDown(action) {
    return this.down.has(action);
  }

  // First held direction, priority order — for overworld walking.
  heldDirection() {
    for (const d of ['up', 'down', 'left', 'right']) {
      if (this.down.has(d)) return d;
    }
    return null;
  }

  // Consume one edge-press of `action`; returns true once per physical press.
  consume(action) {
    const i = this.pressQueue.indexOf(action);
    if (i === -1) return false;
    this.pressQueue.splice(i, 1);
    return true;
  }

  // Consume any queued press, returning its action name (or null).
  consumeAny() {
    return this.pressQueue.shift() || null;
  }

  // Drop all pending edge presses (call on scene transitions).
  flush() {
    this.pressQueue.length = 0;
  }

  // Wire an on-screen touch control container: every child with a data-act
  // attribute ("up"/"down"/"left"/"right"/"confirm"/"cancel") behaves like a
  // held key while pressed.
  bindTouch(container) {
    if (!container) return;
    for (const btn of container.querySelectorAll('[data-act]')) {
      const action = btn.getAttribute('data-act');
      const press = (e) => {
        e.preventDefault();
        if (!this.down.has(action)) this.pressQueue.push(action);
        this.down.add(action);
        btn.classList.add('pressed');
      };
      const release = (e) => {
        if (e) e.preventDefault();
        this.down.delete(action);
        btn.classList.remove('pressed');
      };
      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }
}

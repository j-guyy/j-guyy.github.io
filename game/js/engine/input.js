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
  //
  // A finger may slide between buttons without lifting (hold DOWN, drag onto
  // LEFT and keep walking left): while a pointer is down we track which button
  // it is over and swap the held action as it moves. Sliding is confined to the
  // group the gesture started in (the d-pad or the A/B cluster), so dragging
  // off the d-pad can never fire a stray confirm/cancel. Targets are picked by
  // nearest-rect rather than exact hit-testing so the seams between buttons
  // aren't dead zones.
  bindTouch(container) {
    if (!container) return;
    const buttons = [...container.querySelectorAll('[data-act]')];
    if (!buttons.length) return;

    const SLOP = 20; // px of grace around a button before it counts as "off"
    const active = new Map(); // pointerId -> { btn, group, rects }
    const holds = new Map(); // action -> how many pointers hold it

    const actionOf = (btn) => btn.getAttribute('data-act');
    const heldElsewhere = (btn) => {
      for (const p of active.values()) if (p.btn === btn) return true;
      return false;
    };

    const acquire = (btn) => {
      const action = actionOf(btn);
      const n = (holds.get(action) || 0) + 1;
      holds.set(action, n);
      if (!this.down.has(action)) this.pressQueue.push(action);
      this.down.add(action);
      btn.classList.add('pressed');
    };

    const release = (btn) => {
      const action = actionOf(btn);
      const n = (holds.get(action) || 1) - 1;
      if (n > 0) holds.set(action, n);
      else {
        holds.delete(action);
        this.down.delete(action);
      }
      if (!heldElsewhere(btn)) btn.classList.remove('pressed');
    };

    // Move a pointer onto `btn` (or off the controls entirely when null).
    const moveTo = (pointerId, btn) => {
      const p = active.get(pointerId);
      const prev = p ? p.btn : null;
      if (prev === btn) return;
      if (p) p.btn = btn;
      if (prev) release(prev);
      if (btn) acquire(btn);
    };

    // Rects are measured once per gesture — the pad doesn't move mid-drag.
    const measure = (group) =>
      [...group.querySelectorAll('[data-act]')].map((b) => ({ btn: b, r: b.getBoundingClientRect() }));

    const nearest = (rects, x, y) => {
      let best = null;
      let bestD = Infinity;
      for (const { btn, r } of rects) {
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        const d = Math.hypot(dx, dy);
        if (d < bestD) {
          bestD = d;
          best = btn;
        }
      }
      return bestD <= SLOP ? best : null;
    };

    container.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest?.('[data-act]');
      if (!btn || !container.contains(btn)) return;
      e.preventDefault();
      // Touch pointers are implicitly captured by the target element; drop that
      // so the pointer can be tracked across sibling buttons.
      if (btn.hasPointerCapture?.(e.pointerId)) btn.releasePointerCapture(e.pointerId);
      const group = btn.parentElement || container;
      active.set(e.pointerId, { btn: null, group, rects: measure(group) });
      moveTo(e.pointerId, btn);
    });

    const onMove = (e) => {
      const p = active.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      moveTo(e.pointerId, nearest(p.rects, e.clientX, e.clientY));
    };

    const onEnd = (e) => {
      if (!active.has(e.pointerId)) return;
      moveTo(e.pointerId, null);
      active.delete(e.pointerId);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    container.addEventListener('contextmenu', (e) => e.preventDefault());
  }
}

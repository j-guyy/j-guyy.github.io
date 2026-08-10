// draw-audit.mjs — catch text that draws outside the box it belongs to.
//
// The layout lives in main.js as coordinates passed to Renderer.text() and
// Renderer.panel(), so there is nothing to assert on directly. Instead the
// browser records every text and panel draw off the canvas, and `auditDraws`
// — a pure function, unit-tested on its own — decides whether any of it
// escaped. That covers every call site at once, including ones nobody thought
// to write a test for.
//
// Two rules:
//   canvas  no text may extend past the edge of the canvas
//   panel   text starting inside a panel must finish inside that panel

// ---- Recording (runs in the browser) ---------------------------------------

// Injected before the game boots. Patches the 2D context so every fillText and
// strokeRect on the visible canvas is logged. Offscreen canvases are ignored —
// the sprite factories draw glyphs onto their own, and those are not layout.
export function recorderScript() {
  window.__drawLog = [];
  const proto = CanvasRenderingContext2D.prototype;
  const onGameCanvas = (ctx) => ctx.canvas && ctx.canvas.id === 'game-canvas';

  const originalFillText = proto.fillText;
  proto.fillText = function fillText(text, x, y, ...rest) {
    if (onGameCanvas(this)) {
      const size = /(\d+(?:\.\d+)?)px/.exec(this.font || '');
      window.__drawLog.push({
        kind: 'text',
        text: String(text),
        x,
        y,
        width: this.measureText(String(text)).width,
        size: size ? Number(size[1]) : 10,
        align: this.textAlign || 'left',
        baseline: this.textBaseline || 'alphabetic',
      });
    }
    return originalFillText.call(this, text, x, y, ...rest);
  };

  const originalStrokeRect = proto.strokeRect;
  proto.strokeRect = function strokeRect(x, y, w, h) {
    if (onGameCanvas(this)) window.__drawLog.push({ kind: 'stroke', x, y, w, h });
    return originalStrokeRect.call(this, x, y, w, h);
  };
}

// ---- Analysis (pure) --------------------------------------------------------

// Renderer.panel() draws its fill, then strokeRect(x+1, y+1, w-2, h-2), then
// strokeRect(x+5, y+5, w-10, h-10). That second inset is the signature: no
// other primitive draws two strokes in that relationship.
function panelFromStrokePair(outer, inner) {
  if (!outer || outer.kind !== 'stroke' || inner.kind !== 'stroke') return null;
  const matches =
    inner.x === outer.x + 4 && inner.y === outer.y + 4 &&
    inner.w === outer.w - 8 && inner.h === outer.h - 8;
  if (!matches) return null;
  return { x: outer.x - 1, y: outer.y - 1, w: outer.w + 2, h: outer.h + 2 };
}

export function horizontalExtent(record) {
  const { x, width, align } = record;
  if (align === 'right') return [x - width, x];
  if (align === 'center') return [x - width / 2, x + width / 2];
  return [x, x + width];
}

export function verticalExtent(record) {
  const { y, size, baseline } = record;
  if (baseline === 'top') return [y, y + size];
  if (baseline === 'middle') return [y - size / 2, y + size / 2];
  return [y - size, y]; // alphabetic
}

// records: what recorderScript collected. Returns one entry per violation.
export function auditDraws(records, { width, height, tolerance = 1.5 } = {}) {
  const violations = [];
  const panels = []; // { at, x, y, w, h } in draw order

  records.forEach((record, i) => {
    if (record.kind === 'stroke') {
      const panel = panelFromStrokePair(records[i - 1], record);
      if (panel) panels.push({ at: i, ...panel });
      return;
    }
    if (record.kind !== 'text' || !record.text.trim()) return;

    const [left, right] = horizontalExtent(record);
    const [top, bottom] = verticalExtent(record);

    if (left < -tolerance || right > width + tolerance
        || top < -tolerance || bottom > height + tolerance) {
      violations.push({
        rule: 'canvas', text: record.text,
        box: { left, right, top, bottom }, bounds: { width, height },
        detail: `"${record.text}" spans x ${left.toFixed(0)}..${right.toFixed(0)}, `
          + `y ${top.toFixed(0)}..${bottom.toFixed(0)} on a ${width}x${height} canvas`,
      });
      return; // already off-screen; the panel rule adds nothing
    }

    // The panel it sits in is the most recent one drawn that contains where the
    // text starts. Text outside every panel (title screens, overlays) is only
    // held to the canvas rule above.
    const panel = panels
      .filter((p) => p.at < i && left >= p.x && left <= p.x + p.w && top >= p.y && top <= p.y + p.h)
      .pop();
    if (!panel) return;

    if (right > panel.x + panel.w + tolerance || bottom > panel.y + panel.h + tolerance) {
      violations.push({
        rule: 'panel', text: record.text,
        box: { left, right, top, bottom }, panel,
        detail: `"${record.text}" spans x ${left.toFixed(0)}..${right.toFixed(0)}, `
          + `y ${top.toFixed(0)}..${bottom.toFixed(0)} outside its panel at `
          + `(${panel.x}, ${panel.y}) ${panel.w}x${panel.h}`,
      });
    }
  });

  // The game redraws every frame, so a log covering a fraction of a second
  // repeats each violation several times. Report each distinct one once.
  const seen = new Set();
  return violations.filter((v) => {
    const key = `${v.rule}|${v.text}|${Math.round(v.box.left)}|${Math.round(v.box.top)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function describeViolations(violations) {
  return violations.map((v) => `  [${v.rule}] ${v.detail}`).join('\n');
}

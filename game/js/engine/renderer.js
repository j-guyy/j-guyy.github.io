// renderer.js — canvas setup, camera, and low-level draw primitives.
// Fixed logical resolution (Phase 1.5: 720x480, 3x the original GBA-native
// 240x160), integer-scaled to the window with pixelated rendering so
// placeholder art stays crisp. Because both the canvas and the tile size grew
// exactly 3x, the on-screen tile count is unchanged (15x10) — camera/viewport
// math is identical, just at a higher pixel density.

import { TILE_PX } from './assets.js';

export const VIEW_W = 720;
export const VIEW_H = 480;
export const TILE = TILE_PX; // 48
export const COLS = VIEW_W / TILE; // 15
export const ROWS = VIEW_H / TILE; // 10

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.canvas.width = VIEW_W;
    this.canvas.height = VIEW_H;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.camera = { x: 0, y: 0 };
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const pad = 24;
    const maxW = window.innerWidth - pad;
    const maxH = window.innerHeight - pad;
    const rawScale = Math.min(maxW / VIEW_W, maxH / VIEW_H);
    // Integer-scale when the viewport is roomy enough (keeps pixel art crisp),
    // but fall back to a fractional scale on small/mobile screens so the
    // canvas shrinks to fit instead of overflowing the viewport width.
    const scale = rawScale >= 1 ? Math.floor(rawScale) : rawScale;
    this.scale = scale;
    this.canvas.style.width = VIEW_W * scale + 'px';
    this.canvas.style.height = VIEW_H * scale + 'px';
  }

  clear(color = '#000') {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }

  // Center camera (in world pixels) on a point, clamped to map bounds.
  centerCamera(worldX, worldY, mapW, mapH) {
    let cx = Math.round(worldX - VIEW_W / 2);
    let cy = Math.round(worldY - VIEW_H / 2);
    const maxX = Math.max(0, mapW - VIEW_W);
    const maxY = Math.max(0, mapH - VIEW_H);
    this.camera.x = Math.max(0, Math.min(maxX, cx));
    this.camera.y = Math.max(0, Math.min(maxY, cy));
  }

  // Draw a Sprite positioned in world space (applies camera offset).
  drawWorldSprite(sprite, worldX, worldY, w, h) {
    const dx = Math.round(worldX - this.camera.x);
    const dy = Math.round(worldY - this.camera.y);
    if (dx + w < 0 || dy + h < 0 || dx > VIEW_W || dy > VIEW_H) return;
    sprite.draw(this.ctx, dx, dy, w, h);
  }

  // ---- Screen-space UI primitives ----------------------------------------

  panel(x, y, w, h, opts = {}) {
    const g = this.ctx;
    g.fillStyle = opts.fill || '#f7f4e9';
    g.fillRect(x, y, w, h);
    // Double border, thickened for the 3x resolution so chrome reads at a
    // proportional weight instead of a hairline.
    g.lineWidth = 2;
    g.strokeStyle = opts.border || '#2b2b3a';
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    g.strokeStyle = opts.borderInner || '#6b6b8a';
    g.strokeRect(x + 5, y + 5, w - 10, h - 10);
  }

  text(str, x, y, opts = {}) {
    const g = this.ctx;
    g.font = (opts.bold ? 'bold ' : '') + (opts.size || 8) + 'px monospace';
    g.textAlign = opts.align || 'left';
    g.textBaseline = opts.baseline || 'top';
    if (opts.shadow) {
      g.fillStyle = opts.shadow;
      g.fillText(str, x + 1, y + 1);
    }
    g.fillStyle = opts.color || '#2b2b3a';
    g.fillText(str, x, y);
  }

  // measured wrap: returns array of lines fitting maxWidth
  wrapText(str, maxWidth, size = 8) {
    const g = this.ctx;
    g.font = size + 'px monospace';
    const words = str.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (g.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  bar(x, y, w, h, pct, color, bg = '#3a3a4a') {
    const g = this.ctx;
    pct = Math.max(0, Math.min(1, pct));
    g.fillStyle = bg;
    g.fillRect(x, y, w, h);
    g.fillStyle = color;
    g.fillRect(x, y, Math.round(w * pct), h);
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  fillRect(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  // selection cursor triangle (with an outline so it reads on any background)
  cursor(x, y, color = '#2b2b3a') {
    const g = this.ctx;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 13, y + 9.5);
    g.lineTo(x, y + 19);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.stroke();
  }
}

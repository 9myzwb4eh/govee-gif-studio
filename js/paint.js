// Painting primitives. A stroke accumulates a coverage mask over the untouched base buffer,
// so overlapping dabs in one stroke never build up darker than the chosen opacity.

import { WORK_W, WORK_H } from './raster.js';

const smooth = (t) => t * t * (3 - 2 * t);

export class Stroke {
  constructor(target, { color = [255, 255, 255], opacity = 1, erase = false, mirrorX = false, mirrorY = false, clip = null, w = WORK_W, h = WORK_H } = {}) {
    this.target = target;
    this.base = target.slice();
    this.mask = new Float32Array(w * h);
    this.w = w; this.h = h;
    this.color = color; this.opacity = opacity; this.erase = erase;
    this.mirrorX = mirrorX; this.mirrorY = mirrorY;
    this.clip = clip; // optional {x, y, w, h} in cells
  }

  reset() {
    this.mask.fill(0);
    this.target.set(this.base);
  }

  // Raise coverage of one cell. Coverage is combined with max so repeated dabs don't accumulate.
  cover(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || c <= 0) return;
    const cl = this.clip;
    if (cl && (x < cl.x || y < cl.y || x >= cl.x + cl.w || y >= cl.y + cl.h)) return;
    const i = y * this.w + x;
    if (c > this.mask[i]) { this.mask[i] = Math.min(1, c); this.apply(i); }
  }

  apply(i) {
    const p = i * 4, b = this.base, t = this.target, m = this.mask[i] * this.opacity;
    if (this.erase) { t[p + 3] = b[p + 3] * (1 - m); return; }
    const ba = b[p + 3] / 255, oa = m + ba * (1 - m);
    if (oa <= 0) return;
    for (let c = 0; c < 3; c++) t[p + c] = (this.color[c] * m + b[p + c] * ba * (1 - m)) / oa;
    t[p + 3] = oa * 255;
  }

  points(x, y) {
    const pts = [[x, y]];
    if (this.mirrorX) pts.push([this.w - x, y]);
    if (this.mirrorY) pts.push([x, this.h - y]);
    if (this.mirrorX && this.mirrorY) pts.push([this.w - x, this.h - y]);
    return pts;
  }

  // Round dab centred at continuous coords (x, y). size = diameter in cells. hardness 0..1.
  dab(x, y, size, hardness = 1) {
    for (const [px, py] of this.points(x, y)) this._dab(px, py, size, hardness);
  }

  _dab(x, y, size, hardness) {
    if (size <= 1) { this.cover(Math.floor(x), Math.floor(y), 1); return; }
    const r = size / 2, inner = r * hardness;
    const x0 = Math.floor(x - r), x1 = Math.ceil(x + r), y0 = Math.floor(y - r), y1 = Math.ceil(y + r);
    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) {
        const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y);
        let c;
        if (hardness >= 0.99) c = Math.max(0, Math.min(1, r - d + 0.5)); // anti-aliased hard edge
        else c = d <= inner ? 1 : d >= r ? 0 : 1 - smooth((d - inner) / (r - inner));
        this.cover(cx, cy, c);
      }
    }
  }

  // Dabs along a segment with spacing proportional to brush size.
  segment(x0, y0, x1, y1, size, hardness) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(0.3, size * 0.2);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= n; i++) this.dab(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, size, hardness);
  }

  // Pixel-exact line for the 1-cell pencil (Bresenham), with mirroring.
  pixelLine(x0, y0, x1, y1) {
    x0 = Math.floor(x0); y0 = Math.floor(y0); x1 = Math.floor(x1); y1 = Math.floor(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      for (const [px, py] of this.points(x0 + 0.5, y0 + 0.5)) this.cover(Math.floor(px), Math.floor(py), 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // Filled shape from a signed distance function (negative inside), anti-aliased over `feather` cells.
  fillSdf(sdf, bounds, feather = 1) {
    const f = Math.max(0.5, feather);
    for (const [ox, oy] of this.mirrorOffsets()) {
      for (let y = Math.max(0, Math.floor(bounds.y0 - f)); y < Math.min(this.h, Math.ceil(bounds.y1 + f)); y++) {
        for (let x = Math.max(0, Math.floor(bounds.x0 - f)); x < Math.min(this.w, Math.ceil(bounds.x1 + f)); x++) {
          const sx = ox ? this.w - (x + 0.5) : x + 0.5, sy = oy ? this.h - (y + 0.5) : y + 0.5;
          const d = sdf(sx, sy);
          const c = f <= 0.5 ? Math.max(0, Math.min(1, 0.5 - d)) : 1 - smooth(Math.max(0, Math.min(1, (d + f / 2) / f)));
          this.cover(x, y, c);
        }
      }
    }
  }

  mirrorOffsets() {
    const list = [[0, 0]];
    if (this.mirrorX) list.push([1, 0]);
    if (this.mirrorY) list.push([0, 1]);
    if (this.mirrorX && this.mirrorY) list.push([1, 1]);
    return list;
  }
}

// ---------- shapes ----------

export function rectBounds(x0, y0, x1, y1) {
  return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}

export function drawRect(stroke, a, b, { filled, size, hardness }) {
  const r = rectBounds(Math.floor(a[0]), Math.floor(a[1]), Math.floor(b[0]) + 1, Math.floor(b[1]) + 1);
  if (filled) {
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2, hw = (r.x1 - r.x0) / 2, hh = (r.y1 - r.y0) / 2;
    stroke.fillSdf((x, y) => Math.max(Math.abs(x - cx) - hw, Math.abs(y - cy) - hh), r, featherFor(size, hardness));
    return;
  }
  const off = size <= 1 ? 0.5 : size / 2;
  const pts = [[r.x0 + off, r.y0 + off], [r.x1 - off, r.y0 + off], [r.x1 - off, r.y1 - off], [r.x0 + off, r.y1 - off]];
  for (let i = 0; i < 4; i++) {
    const p = pts[i], q = pts[(i + 1) % 4];
    if (size <= 1) stroke.pixelLine(p[0], p[1], q[0], q[1]);
    else stroke.segment(p[0], p[1], q[0], q[1], size, hardness);
  }
}

export function drawEllipse(stroke, a, b, { filled, size, hardness }) {
  const r = rectBounds(a[0], a[1], b[0], b[1]);
  const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
  const rx = Math.max(0.5, (r.x1 - r.x0) / 2), ry = Math.max(0.5, (r.y1 - r.y0) / 2);
  // Approximate distance to an ellipse: scale the normalized radius by the smaller axis.
  const sdf = (x, y) => (Math.hypot((x - cx) / rx, (y - cy) / ry) - 1) * Math.min(rx, ry);
  if (filled) { stroke.fillSdf(sdf, r, featherFor(size, hardness)); return; }
  const width = Math.max(1, size);
  stroke.fillSdf((x, y) => Math.abs(sdf(x, y) + width / 2) - width / 2, r, featherFor(size, hardness));
}

export function drawLine(stroke, a, b, { size, hardness }) {
  if (size <= 1) stroke.pixelLine(a[0], a[1], b[0], b[1]);
  else stroke.segment(a[0], a[1], b[0], b[1], size, hardness);
}

function featherFor(size, hardness) {
  return Math.max(0.5, (1 - hardness) * Math.max(2, size));
}

// ---------- flood fill ----------

export function floodRegion(buf, x, y, tolerance = 0, w = WORK_W, h = WORK_H) {
  const region = new Uint8Array(w * h);
  if (x < 0 || y < 0 || x >= w || y >= h) return region;
  const p0 = (y * w + x) * 4;
  const ref = [buf[p0], buf[p0 + 1], buf[p0 + 2], buf[p0 + 3]];
  const tol = tolerance * tolerance * 4;
  const match = (i) => {
    const p = i * 4;
    if (ref[3] === 0 && buf[p + 3] === 0) return true;
    const d = (buf[p] - ref[0]) ** 2 + (buf[p + 1] - ref[1]) ** 2 + (buf[p + 2] - ref[2]) ** 2 + (buf[p + 3] - ref[3]) ** 2;
    return d <= tol;
  };
  const stack = [y * w + x];
  region[y * w + x] = 1;
  while (stack.length) {
    const i = stack.pop(), cx = i % w, cy = (i - cx) / w;
    const nb = [cx > 0 && i - 1, cx < w - 1 && i + 1, cy > 0 && i - w, cy < h - 1 && i + w];
    for (const n of nb) {
      if (n === false || region[n]) continue;
      if (match(n)) { region[n] = 1; stack.push(n); }
    }
  }
  return region;
}

export function fillRegion(stroke, region) {
  for (let i = 0; i < region.length; i++) if (region[i]) stroke.cover(i % stroke.w, Math.floor(i / stroke.w), 1);
}

// ---------- gradients ----------

// Linear or radial gradient from colorA to colorB (or to transparent). Returns a new RGBA buffer.
export function gradientBuffer(a, b, { colorA, colorB, toTransparent = false, radial = false, w = WORK_W, h = WORK_H, clip = null }) {
  const out = new Uint8ClampedArray(w * h * 4);
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1, len = Math.sqrt(len2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (clip && (x < clip.x || y < clip.y || x >= clip.x + clip.w || y >= clip.y + clip.h)) continue;
      const px = x + 0.5 - a[0], py = y + 0.5 - a[1];
      let t = radial ? Math.sqrt(px * px + py * py) / len : (px * dx + py * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const p = (y * w + x) * 4;
      if (toTransparent) {
        out[p] = colorA[0]; out[p + 1] = colorA[1]; out[p + 2] = colorA[2];
        out[p + 3] = 255 * (1 - (radial ? smooth(t) : t));
      } else {
        for (let c = 0; c < 3; c++) out[p + c] = colorA[c] + (colorB[c] - colorA[c]) * t;
        out[p + 3] = 255;
      }
    }
  }
  return out;
}

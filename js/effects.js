// Generators and frame effects: tweening, twinkle, fire, glow, trails, text.

import { WORK_W, WORK_H, SCALE, PANEL_W, PANEL_H, newBuffer, transformBuffer, mixBuffers, blurBuffer, blendOver, isEmpty } from './raster.js';
import { createFrame, createLayer, MAX_LAYERS, newId } from './model.js';
import { layoutText } from './font.js';

export const EASINGS = {
  linear: (t) => t,
  'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  'ease-in': (t) => t * t,
  'ease-out': (t) => 1 - (1 - t) * (1 - t),
  bounce: (t) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

// ---------- helpers ----------

export function ensureLayer(project, name, { blend = 'normal', opacity = 1, below = null } = {}) {
  let layer = project.layers.find((l) => l.name === name);
  if (layer) return layer;
  if (project.layers.length >= MAX_LAYERS) throw new Error(`The panel allows ${MAX_LAYERS} layers at most. Delete or merge a layer first.`);
  layer = { ...createLayer(name), blend, opacity };
  const idx = below ? project.layers.findIndex((l) => l.id === below) : -1;
  if (idx >= 0) project.layers.splice(idx, 0, layer); else project.layers.push(layer);
  for (const f of project.frames) f.cels[layer.id] = null;
  return layer;
}

// Run 2D canvas drawing at work resolution and return the result as a cel buffer.
export function celFromCanvas(draw) {
  const c = document.createElement('canvas');
  c.width = WORK_W; c.height = WORK_H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  draw(ctx, WORK_W, WORK_H);
  return new Uint8ClampedArray(ctx.getImageData(0, 0, WORK_W, WORK_H).data);
}

// Make sure the project has at least n frames (copies the last frame's cels).
export function ensureFrames(project, n, duration) {
  while (project.frames.length < n) {
    const last = project.frames[project.frames.length - 1];
    const f = createFrame(project.layers, duration ?? last.duration);
    f.cels = { ...last.cels };
    project.frames.push(f);
  }
}

// Periodic smooth noise: integer temporal frequencies make it loop seamlessly over t in [0, 1).
export function makeLoopNoise(seed = 1, terms = 6) {
  const rnd = mulberry(seed), waves = [];
  for (let i = 0; i < terms; i++) {
    waves.push({ ax: (rnd() - 0.5) * 0.9, ay: (rnd() - 0.5) * 0.9, m: 1 + Math.floor(rnd() * 3), ph: rnd() * Math.PI * 2, amp: 1 / (i + 1) });
  }
  const norm = waves.reduce((s, w) => s + w.amp, 0);
  return (x, y, t) => {
    let v = 0;
    for (const w of waves) v += w.amp * Math.sin(w.ax * x + w.ay * y + Math.PI * 2 * w.m * t + w.ph);
    return v / norm; // -1..1
  };
}

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function regionCrop(buf, sel) {
  if (!sel) return buf.slice();
  const out = newBuffer();
  for (let y = sel.y; y < sel.y + sel.h; y++) {
    for (let x = sel.x; x < sel.x + sel.w; x++) {
      if (x < 0 || y < 0 || x >= WORK_W || y >= WORK_H) continue;
      const p = (y * WORK_W + x) * 4;
      out[p] = buf[p]; out[p + 1] = buf[p + 1]; out[p + 2] = buf[p + 2]; out[p + 3] = buf[p + 3];
    }
  }
  return out;
}

function clearRegion(buf, sel) {
  const out = buf.slice();
  if (!sel) { out.fill(0); return out; }
  for (let y = Math.max(0, sel.y); y < Math.min(WORK_H, sel.y + sel.h); y++) out.fill(0, (y * WORK_W + Math.max(0, sel.x)) * 4, (y * WORK_W + Math.min(WORK_W, sel.x + sel.w)) * 4);
  return out;
}

export function centroid(buf) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < WORK_H; y++) for (let x = 0; x < WORK_W; x++) {
    const a = buf[(y * WORK_W + x) * 4 + 3];
    if (a) { sx += (x + 0.5) * a; sy += (y + 0.5) * a; n += a; }
  }
  return n ? [sx / n, sy / n] : null;
}

// ---------- tween ----------

// Insert `steps` in-between frames after frame `startIndex`.
// mode 'move': the start frame's layer content (or selection) moves/scales/rotates/fades to the end state.
//   If `auto` is set, the offset is taken from the centroid difference between the start and end frames.
// mode 'fade': cross-fade the layer from the start frame to the end frame.
export function tween(project, opts) {
  const { layerId, startIndex, endIndex, steps, mode = 'move', easing = 'ease-in-out', selection = null } = opts;
  const A = project.frames[startIndex], B = project.frames[endIndex];
  if (!A || !B || startIndex === endIndex) throw new Error('Pick two different frames.');
  const ease = EASINGS[easing] || EASINGS.linear;
  const srcA = A.cels[layerId] || newBuffer();
  const srcB = B.cels[layerId] || newBuffer();
  let { dx = 0, dy = 0 } = opts;
  const piece = regionCrop(srcA, selection);
  const rest = selection ? clearRegion(srcA, selection) : null;
  if (mode === 'move' && opts.auto) {
    const ca = centroid(piece), cb = centroid(selection ? regionCrop(srcB, null) : srcB);
    if (ca && cb) { dx = cb[0] - ca[0]; dy = cb[1] - ca[1]; } else { dx = 0; dy = 0; }
  }
  const c0 = centroid(piece) || [WORK_W / 2, WORK_H / 2];
  const frames = [];
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / (steps + 1));
    let cel;
    if (mode === 'fade') cel = mixBuffers(srcA, srcB, t);
    else {
      const moved = transformBuffer(piece, WORK_W, WORK_H, {
        dx: dx * t, dy: dy * t,
        scale: 1 + ((opts.scale ?? 1) - 1) * t,
        rotate: (((opts.rotate || 0) * Math.PI) / 180) * t,
        opacity: (opts.opacityFrom ?? 1) + ((opts.opacityTo ?? 1) - (opts.opacityFrom ?? 1)) * t,
        cx: c0[0], cy: c0[1],
      });
      cel = rest ? blendOver(rest.slice(), moved) : moved;
    }
    const f = createFrame(project.layers, A.duration);
    f.cels = { ...A.cels, [layerId]: isEmpty(cel) ? null : cel };
    frames.push(f);
  }
  const at = Math.min(startIndex, endIndex) + 1;
  project.frames.splice(at, 0, ...(startIndex < endIndex ? frames : frames.reverse()));
  return frames.length;
}

// ---------- twinkle ----------

export function twinkle(project, { density = 0.15, speed = 1, colors = ['#ffffff', '#fff3b0', '#b8d4ff'], seed = 7, frames = null, size = 1, avoidLayers = true } = {}) {
  if (frames) ensureFrames(project, frames);
  const layer = ensureLayer(project, 'Stars', { below: project.layers[1]?.id });
  const rnd = mulberry(seed), n = project.frames.length;
  const stars = [];
  for (let y = 0; y < PANEL_H; y++) for (let x = 0; x < PANEL_W; x++) {
    if (rnd() < density) stars.push({ x, y, ph: rnd(), cyc: Math.max(1, Math.round(speed * (1 + Math.floor(rnd() * 2)))), col: hex(colors[Math.floor(rnd() * colors.length)]), peak: 0.5 + rnd() * 0.5 });
  }
  void avoidLayers;
  project.frames.forEach((f, i) => {
    const buf = newBuffer(), t = i / n;
    for (const s of stars) {
      const v = Math.max(0, Math.sin(Math.PI * 2 * (s.cyc * t + s.ph)));
      const a = Math.pow(v, 2.2) * s.peak;
      if (a < 0.02) continue;
      softDot(buf, (s.x + 0.5) * SCALE, (s.y + 0.5) * SCALE, SCALE * size, s.col, a);
    }
    f.cels[layer.id] = isEmpty(buf) ? null : buf;
  });
  return layer;
}

// Soft round dot with gaussian falloff, straight alpha, "lighten" style write.
export function softDot(buf, cx, cy, diameter, col, alpha = 1) {
  const r = diameter / 2;
  for (let y = Math.floor(cy - r * 1.5); y < Math.ceil(cy + r * 1.5); y++) for (let x = Math.floor(cx - r * 1.5); x < Math.ceil(cx + r * 1.5); x++) {
    if (x < 0 || y < 0 || x >= WORK_W || y >= WORK_H) continue;
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
    const a = alpha * Math.exp(-d * d * 1.6) * 255;
    const p = (y * WORK_W + x) * 4;
    if (a > buf[p + 3]) { buf[p] = col[0]; buf[p + 1] = col[1]; buf[p + 2] = col[2]; buf[p + 3] = a; }
  }
}

function hex(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------- fire ----------

const FIRE = [[0, 0, 0, 0], [90, 0, 10, 120], [200, 20, 0, 220], [255, 90, 0, 255], [255, 170, 20, 255], [255, 235, 140, 255], [255, 255, 230, 255]];

function fireColor(v) {
  v = Math.max(0, Math.min(0.9999, v)) * (FIRE.length - 1);
  const i = Math.floor(v), t = v - i, a = FIRE[i], b = FIRE[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

// Looping flames along the bottom. height is a fraction of the panel.
export function fire(project, { height = 0.45, intensity = 1, frames = 24, seed = 3, layerName = 'Fire' } = {}) {
  ensureFrames(project, frames);
  const layer = ensureLayer(project, layerName);
  const n1 = makeLoopNoise(seed, 7), n2 = makeLoopNoise(seed + 9, 5), n = project.frames.length;
  const top = WORK_H * (1 - height);
  project.frames.forEach((f, i) => {
    const buf = newBuffer(), t = i / n;
    for (let y = Math.floor(top - 20); y < WORK_H; y++) for (let x = 0; x < WORK_W; x++) {
      const h = (y - top) / (WORK_H - top); // 0 at top of fire, 1 at bottom
      const turb = n1(x * 0.35, y * 0.25, t) * 0.5 + n2(x * 0.9, y * 0.6, t) * 0.25;
      const v = (h + turb * 0.6) * intensity;
      if (v <= 0.05) continue;
      const c = fireColor(v), p = (y * WORK_W + x) * 4;
      buf[p] = c[0]; buf[p + 1] = c[1]; buf[p + 2] = c[2]; buf[p + 3] = c[3];
    }
    f.cels[layer.id] = buf;
  });
  return layer;
}

// ---------- glow ----------

// Adds an additive glow layer above the source layer, built from a blurred copy on every frame.
export function glow(project, { layerId, radius = 6, strength = 0.8 } = {}) {
  const src = project.layers.find((l) => l.id === layerId);
  if (!src) throw new Error('Pick a layer to glow.');
  const name = `${src.name} glow`;
  let layer = project.layers.find((l) => l.name === name);
  if (!layer) {
    if (project.layers.length >= MAX_LAYERS) throw new Error(`The panel allows ${MAX_LAYERS} layers at most.`);
    layer = { ...createLayer(name), blend: 'add', opacity: strength };
    project.layers.splice(project.layers.indexOf(src) + 1, 0, layer);
  }
  layer.opacity = strength;
  const cache = new Map();
  for (const f of project.frames) {
    const c = f.cels[layerId];
    if (!c) { f.cels[layer.id] = null; continue; }
    if (!cache.has(c)) cache.set(c, blurBuffer(c, WORK_W, WORK_H, radius));
    f.cels[layer.id] = cache.get(c);
  }
  return layer;
}

// ---------- trails ----------

export function trail(project, { layerId, length = 3, decay = 0.5 } = {}) {
  const src = project.layers.find((l) => l.id === layerId);
  if (!src) throw new Error('Pick a layer for the trail.');
  const name = `${src.name} trail`;
  let layer = project.layers.find((l) => l.name === name);
  if (!layer) {
    if (project.layers.length >= MAX_LAYERS) throw new Error(`The panel allows ${MAX_LAYERS} layers at most.`);
    layer = { ...createLayer(name), blend: 'normal', opacity: 1 };
    project.layers.splice(project.layers.indexOf(src), 0, layer);
  }
  const n = project.frames.length;
  project.frames.forEach((f, i) => {
    const out = newBuffer();
    for (let k = length; k >= 1; k--) {
      const prev = project.frames[(i - k + n * 10) % n].cels[layerId];
      if (prev) blendOver(out, prev, Math.pow(decay, k));
    }
    f.cels[layer.id] = isEmpty(out) ? null : out;
  });
  return layer;
}

// ---------- text ----------

// Draws text where each font pixel is exactly one LED. scroll: 'none' | 'left' | 'up'.
// Scrolling moves in fractional LED steps so letters glide smoothly between beads.
export function text(project, { value = 'BOO', color = '#ff6a00', x = null, y = null, scroll = 'none', speed = 0.5, frameIndex = 0, layerName = 'Text', duration = 70 } = {}) {
  const layout = layoutText(value, project.font);
  const layer = ensureLayer(project, layerName);
  const col = hex(color);
  const big = new Uint8ClampedArray((layout.width + 2) * SCALE * (layout.height + 2) * SCALE * 4);
  const bw = (layout.width + 2) * SCALE, bh = (layout.height + 2) * SCALE;
  for (const [cx, cy] of layout.cells) {
    for (let yy = 0; yy < SCALE; yy++) for (let xx = 0; xx < SCALE; xx++) {
      const p = (((cy + 1) * SCALE + yy) * bw + (cx + 1) * SCALE + xx) * 4;
      big[p] = col[0]; big[p + 1] = col[1]; big[p + 2] = col[2]; big[p + 3] = 255;
    }
  }
  const px = x ?? Math.floor((PANEL_W - layout.width) / 2);
  const py = y ?? Math.floor((PANEL_H - layout.height) / 2);
  const place = (ox, oy) => {
    const buf = newBuffer();
    // ox, oy in panel pixels (may be fractional)
    const tmp = [0, 0, 0, 0];
    for (let y2 = 0; y2 < WORK_H; y2++) for (let x2 = 0; x2 < WORK_W; x2++) {
      const sx = x2 + 0.5 - (ox - 1) * SCALE, sy = y2 + 0.5 - (oy - 1) * SCALE;
      if (sx < -1 || sy < -1 || sx > bw + 1 || sy > bh + 1) continue;
      sampleInto(big, bw, bh, sx, sy, tmp);
      if (tmp[3] <= 0) continue;
      const p = (y2 * WORK_W + x2) * 4;
      buf[p] = tmp[0]; buf[p + 1] = tmp[1]; buf[p + 2] = tmp[2]; buf[p + 3] = tmp[3];
    }
    return buf;
  };
  if (scroll === 'none') {
    const f = project.frames[frameIndex];
    f.cels[layer.id] = blendOver(f.cels[layer.id] ? f.cels[layer.id].slice() : newBuffer(), place(px, py));
    return { layer, frames: 0 };
  }
  const dist = scroll === 'left' ? PANEL_W + layout.width : PANEL_H + layout.height;
  const count = Math.min(400, Math.ceil(dist / speed));
  ensureFrames(project, frameIndex + count, duration);
  for (let i = 0; i < count; i++) {
    const f = project.frames[frameIndex + i];
    const pos = i * speed;
    const buf = scroll === 'left' ? place(PANEL_W - pos, py) : place(px, PANEL_H - pos);
    f.cels[layer.id] = isEmpty(buf) ? null : buf;
  }
  return { layer, frames: count };
}

function sampleInto(buf, w, h, x, y, out) {
  x -= 0.5; y -= 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
    const xx = x0 + i, yy = y0 + j;
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    const wgt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy), p = (yy * w + xx) * 4, al = buf[p + 3] * wgt;
    r += buf[p] * al; g += buf[p + 1] * al; b += buf[p + 2] * al; a += al;
  }
  if (a > 0) { out[0] = r / a; out[1] = g / a; out[2] = b / a; }
  out[3] = a;
}

// ---------- frame-wide fades ----------

export function fadeLayer(project, { layerId, from = 0, to = 1, start = 0, end = null, easing = 'ease-in-out' } = {}) {
  const e = end ?? project.frames.length - 1, ease = EASINGS[easing] || EASINGS.linear;
  for (let i = start; i <= e; i++) {
    const f = project.frames[i], c = f.cels[layerId];
    if (!c) continue;
    const t = e === start ? 1 : ease((i - start) / (e - start));
    const k = from + (to - from) * t, out = c.slice();
    for (let p = 3; p < out.length; p += 4) out[p] = c[p] * k;
    f.cels[layerId] = out;
  }
}

export { newId };

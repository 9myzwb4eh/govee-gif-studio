// Scenes: a small JSON description of an animation (background + elements) and its renderer.
// The text scene builder and the AI mode both produce this format, so everything ends up as
// ordinary, editable layers and frames.
//
// Coordinates in a scene are in LEDs: x 0..20, y 0..26 (fractions allowed). Time t runs 0..1 and loops.

import { createProject, createLayer, createFrame, MAX_LAYERS } from './model.js';
import { celFromCanvas, twinkle, fire, mulberry, EASINGS } from './effects.js';
import { isEmpty, SCALE } from './raster.js';
import { layoutText, DEFAULT_FONT } from './font.js';
import { drawBat, drawGhost, drawWitch, radial, linear } from './templates.js';
import { FESTIVE_PAINT, FESTIVE_SUBJECTS, FESTIVE_MAINS, FESTIVE_ORDER, FESTIVALS, festivalVersion } from './festive.js';

const TAU = Math.PI * 2;
const S = SCALE;

export const COLORS = {
  orange: '#ff6a00', purple: '#9b30ff', violet: '#9b30ff', green: '#3ddc4a', lime: '#9dff2a', red: '#ff1a2a',
  blue: '#2a6bff', white: '#ffffff', pink: '#ff4fa8', yellow: '#ffd21f', gold: '#ffb21f', teal: '#19e0d0',
  cyan: '#19e0d0', aqua: '#19e0d0', magenta: '#ff2adf', black: '#000000', silver: '#c8d0e0',
};

export const ELEMENT_TYPES = ['stars', 'moon', 'pumpkin', 'ghost', 'bats', 'spider', 'witch', 'lightning', 'rain', 'snow', 'fire', 'eyes', 'skull', 'heart', ...Object.keys(FESTIVE_PAINT), 'text', 'shape'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = EASINGS['ease-in-out'];

function hexA(hex, a) {
  const n = parseInt(String(hex || '#ffffff').replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function glowOn(ctx, color, amount) {
  if (!amount) return;
  ctx.shadowColor = color;
  ctx.shadowBlur = amount * S;
}

// ---------- element painters: (ctx, t, frameIndex, el, spec) ----------

const PAINT = {
  moon(ctx, t, i, el) {
    const x = (el.x ?? 13) * S, y = (el.y ?? 7) * S, r = (el.r ?? 4.5) * S, c = el.color || '#ffe9a8';
    ctx.fillStyle = radial(ctx, x, y, r * (2.3 + 0.15 * Math.sin(TAU * t)), [[0, hexA(c, 0.45)], [1, hexA(c, 0)]]);
    ctx.fillRect(0, 0, 100, 130);
    ctx.fillStyle = radial(ctx, x - r * 0.3, y - r * 0.3, r * 1.4, [[0, '#ffffff'], [0.5, c], [1, c]]);
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    // Craters give it a surface instead of a flat disc.
    ctx.fillStyle = 'rgba(150,120,70,0.35)';
    for (const [dx, dy, cr] of [[-0.35, -0.1, 0.22], [0.3, 0.3, 0.17], [0.15, -0.4, 0.12], [-0.1, 0.45, 0.1]]) {
      ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, cr * r, 0, TAU); ctx.fill();
    }
  },

  pumpkin(ctx, t, i, el) {
    const x = (el.x ?? 10) * S, y = (el.y ?? 14) * S, s = el.scale ?? 1;
    const L = 0.75 + 0.25 * Math.sin(TAU * t * 3) * Math.sin(TAU * t * 5 + 1);
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    for (const [ox, rx, ry] of [[0, 44, 36], [-20, 24, 32], [20, 24, 32], [0, 20, 35]]) {
      ctx.fillStyle = radial(ctx, ox - rx * 0.2, -ry * 0.35, Math.max(rx, ry) * 1.15, [[0, el.color || '#e86e10'], [0.6, '#b83e00'], [1, '#4a1200']]);
      ctx.beginPath(); ctx.ellipse(ox, 0, rx, ry, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#3a7a1a';
    ctx.fillRect(-4, -46, 8, 12);
    ctx.fillStyle = `rgba(255,${200 + 50 * L},${60 + 120 * L},${0.6 + 0.4 * L})`;
    glowOn(ctx, '#ffb000', 2 * L);
    ctx.beginPath();
    ctx.moveTo(-23, -8); ctx.lineTo(-9, -8); ctx.lineTo(-16, -20); ctx.closePath();
    ctx.moveTo(9, -8); ctx.lineTo(23, -8); ctx.lineTo(16, -20); ctx.closePath();
    ctx.moveTo(-28, 6); ctx.quadraticCurveTo(0, 22, 28, 6);
    ctx.lineTo(22, 18); ctx.lineTo(12, 13); ctx.lineTo(4, 22); ctx.lineTo(-4, 14); ctx.lineTo(-12, 22); ctx.lineTo(-22, 17); ctx.closePath();
    ctx.fill();
    ctx.restore();
  },

  ghost(ctx, t, i, el) {
    const m = el.motion || 'rise', n = clamp(el.count ?? 1, 1, 6);
    const s = (el.scale ?? 1) * (n > 1 ? Math.max(0.42, 0.75 - n * 0.05) : 1);
    for (let k = 0; k < n; k++) {
      // Several ghosts share one loop, offset in time and spread over the panel so they don't overlap.
      const off = n > 1 ? k / n : 0, u = (t + off) % 1, lane = n > 1 ? (k + 0.5) / n : 0.5;
      let x = n > 1 ? (m === 'float' ? lane * 100 : 50) : (el.x ?? 10) * S, y = (el.y ?? 13) * S, a = 1;
      if (m === 'rise') {
        if (n > 1) x = 18 + (((k * 2) % n) + 0.5) / n * 64;
        y = 160 - ease(u) * 130; a = Math.min(1, u / 0.15) * Math.min(1, (1 - u) / 0.2); x += Math.sin(TAU * (u * 2 + off)) * 6;
      } else if (m === 'cross') {
        if (n > 1) y = 22 + lane * 86;
        const dir = n > 1 && k % 2 ? -1 : 1;
        x = dir > 0 ? -30 + u * 160 : 130 - u * 160; y += Math.sin(TAU * (t * 2 + off)) * 6;
      } else { y += Math.sin(TAU * (t + off)) * 8; x += Math.sin(TAU * (t * 2 + off)) * 3; }
      ctx.save();
      glowOn(ctx, el.color || '#9fd8ff', 2.5);
      ctx.translate(x, y); ctx.scale(s, s);
      drawGhost(ctx, 0, 0, a, TAU * (t * 4 + off));
      ctx.restore();
    }
  },

  bats(ctx, t, i, el) {
    const n = clamp(el.count ?? 3, 1, 8), rnd = mulberry(el.seed ?? 3);
    for (let k = 0; k < n; k++) {
      const off = k / n + rnd() * 0.1, by = 20 + ((k * 37) % 90), sc = 1.2 + rnd() * 0.6;
      const u = (t + off) % 1, x = -32 + u * 164, y = by + Math.sin(TAU * (t * 2 + off)) * 6;
      ctx.save();
      drawBat(ctx, x, y, sc, Math.sin(TAU * (t * 4 + off)));
      if (el.color && el.color !== '#000000') {
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = el.color; ctx.fillRect(x - 40, y - 40, 80, 80);
      }
      ctx.restore();
    }
  },

  spider(ctx, t) {
    const y = t < 0.55 ? 18 + 64 * EASINGS.bounce(t / 0.55) : 82 - 64 * EASINGS['ease-in-out']((t - 0.55) / 0.45);
    ctx.strokeStyle = 'rgba(230,230,255,0.85)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(50, 0); ctx.lineTo(50, y - 8); ctx.stroke();
    const wig = Math.sin(TAU * t * 6);
    ctx.save(); ctx.translate(50, y);
    ctx.strokeStyle = '#b06bff'; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
      const a = -0.9 + k * 0.6 + wig * 0.12 * (k % 2 ? 1 : -1);
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(side * (10 + k), 2 + Math.sin(a) * 12 - 6); ctx.lineTo(side * (17 + k * 2), 2 + Math.sin(a) * 16 + 2); ctx.stroke();
    }
    ctx.fillStyle = '#5a1a9a';
    ctx.beginPath(); ctx.ellipse(0, 6, 8, 9, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -4, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff2030'; glowOn(ctx, '#ff2030', 1);
    ctx.beginPath(); ctx.arc(-2, -4, 1.6, 0, TAU); ctx.arc(2, -4, 1.6, 0, TAU); ctx.fill();
    ctx.restore();
  },

  witch(ctx, t, i, el) {
    const x = -55 + t * 210, y = (el.y ?? 12) * S + Math.sin(TAU * t) * 8;
    // The template draws her as a black silhouette against the moon; a scene may have no moon, so
    // give her a lit color unless one was asked for.
    if (el.color !== '#000000') {
      ctx.save(); glowOn(ctx, el.color || '#b06bff', 1.5); drawWitch(ctx, x, y, t);
      ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = el.color || '#b06bff'; ctx.fillRect(0, 0, 100, 130); ctx.restore();
    } else drawWitch(ctx, x, y, t);
  },

  lightning(ctx, t, i, el, spec) {
    const n = spec.frames, at = [Math.floor(n * 0.2), Math.floor(n * 0.62)];
    let b = 0, which = 0;
    at.forEach((f, k) => { const d = i - f; if (d >= 0 && d < 4) { b = [1, 0.4, 0.9, 0.3][d]; which = k; } });
    if (!b) return;
    ctx.fillStyle = hexA(el.color || '#b4a8ff', 0.35 * b);
    ctx.fillRect(0, 0, 100, 130);
    let seed = which ? 17 : 3;
    const r = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const pts = [[40 + r() * 20, 0]];
    let x = pts[0][0];
    for (let y = 0; y < 128; y += 9 + r() * 8) { x += (r() - 0.5) * 22; pts.push([x, y]); }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [w, a] of [[8, 0.35], [4, 0.8], [2, 1]]) {
      ctx.strokeStyle = w === 2 ? `rgba(255,255,255,${b})` : hexA(el.color || '#b4a8ff', a * b);
      ctx.lineWidth = w;
      ctx.beginPath(); pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
    }
  },

  rain(ctx, t, i, el) {
    ctx.strokeStyle = hexA(el.color || '#7aa0ff', 0.7); ctx.lineWidth = 1.4;
    for (let k = 0; k < 24; k++) {
      const sp = 1 + (k % 2), y = (((k * 53) % 130) + t * 130 * sp) % 150 - 10, x = ((k * 37) % 110) - (y / 130) * 10;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + 9); ctx.stroke();
    }
  },

  snow(ctx, t, i, el) {
    // Two depths: small dim flakes drift slowly behind, bigger bright ones fall faster in front.
    const c = el.color || '#ffffff';
    for (const [n, speed, size, alpha, seed] of [[18, 1, 1.4, 0.45, 47], [11, 2, 2.4, 1, 29]]) {
      ctx.fillStyle = hexA(c, alpha);
      if (alpha === 1) glowOn(ctx, c, 0.6);
      for (let k = 0; k < n; k++) {
        const y = (((k * seed) % 130) + t * 140 * speed) % 140 - 5, x = ((k * (seed + 12)) % 100) + Math.sin(TAU * (t * speed + k * 0.37)) * (3 + size);
        ctx.beginPath(); ctx.arc(x, y, size + (k % 3) * 0.4, 0, TAU); ctx.fill();
      }
    }
  },

  eyes(ctx, t, i, el) {
    const n = clamp(el.count ?? 3, 1, 6), rnd = mulberry(el.seed ?? 9), c = el.color || '#ffd21f';
    for (let k = 0; k < n; k++) {
      const x = 15 + rnd() * 70, y = 15 + rnd() * 100, ph = rnd();
      const local = (t + ph) % 1;
      const open = local < 0.06 || (local > 0.5 && local < 0.53) ? 0.1 : 1;
      const fade = clamp(Math.sin(TAU * ((t + ph) % 1)) * 2 + 1, 0, 1);
      if (fade <= 0) continue;
      ctx.fillStyle = hexA(c, fade); glowOn(ctx, c, 1.5);
      for (const dx of [-5, 5]) { ctx.beginPath(); ctx.ellipse(x + dx, y, 3, 2.4 * open, 0, 0, TAU); ctx.fill(); }
    }
  },

  skull(ctx, t, i, el) {
    const x = (el.x ?? 10) * S, y = (el.y ?? 12) * S, s = (el.scale ?? 1) * (1 + Math.sin(TAU * t * 2) * 0.03);
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = el.color || '#f2f0e6'; glowOn(ctx, '#ffffff', 1);
    ctx.beginPath(); ctx.arc(0, -6, 26, Math.PI * 0.85, Math.PI * 2.15); ctx.lineTo(14, 26); ctx.lineTo(-14, 26); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath(); ctx.ellipse(-10, -4, 7, 8, 0, 0, TAU); ctx.ellipse(10, -4, 7, 8, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, 6); ctx.lineTo(-4, 13); ctx.lineTo(4, 13); ctx.fill();
    for (let k = -2; k <= 2; k++) ctx.fillRect(k * 5 - 1, 18, 2, 8);
    ctx.globalCompositeOperation = 'source-over';
    const L = 0.5 + 0.5 * Math.sin(TAU * t * 2);
    ctx.fillStyle = `rgba(255,30,40,${L})`; glowOn(ctx, '#ff2030', 1.5);
    ctx.beginPath(); ctx.arc(-10, -3, 3, 0, TAU); ctx.arc(10, -3, 3, 0, TAU); ctx.fill();
    ctx.restore();
  },

  heart(ctx, t, i, el) {
    const x = (el.x ?? 10) * S, y = (el.y ?? 13) * S;
    const beat = 1 + 0.12 * Math.max(0, Math.sin(TAU * t * 2)) ** 6 + 0.06 * Math.max(0, Math.sin(TAU * t * 2 - 0.9)) ** 6;
    const s = (el.scale ?? 1) * beat, c = el.color || '#ff1a4a';
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = radial(ctx, -10, -12, 50, [[0, '#ffb0c0'], [0.35, c], [1, c]]); glowOn(ctx, c, 2);
    ctx.beginPath(); ctx.moveTo(0, 30);
    ctx.bezierCurveTo(-40, 4, -32, -30, 0, -14);
    ctx.bezierCurveTo(32, -30, 40, 4, 0, 30); ctx.fill();
    ctx.restore();
  },

  text(ctx, t, i, el) {
    const layout = layoutText(el.text || 'BOO', el.font || DEFAULT_FONT);
    const c = el.color || '#ff6a00';
    const m = el.motion || (layout.width > 20 ? 'scroll' : 'still');
    let ox = (20 - layout.width) / 2, oy = el.y ?? (26 - layout.height) / 2;
    if (m === 'scroll') ox = 20 - t * (20 + layout.width + 1);
    if (m === 'still') ox = Math.round(ox);
    oy = Math.round(oy);
    let a = 1;
    if (m === 'pulse') a = 0.55 + 0.45 * Math.sin(TAU * t * 2);
    ctx.fillStyle = hexA(c, a);
    glowOn(ctx, c, el.glow ?? 1.2);
    for (const [cx, cy] of layout.cells) ctx.fillRect((ox + cx) * S, (oy + cy) * S, S, S);
    // A highlight sweeps across the letters, like light catching metal.
    if (el.shine !== false && m !== 'pulse') {
      const sx = (-0.3 + ((t * 2) % 1) * 1.6) * 100;
      ctx.shadowBlur = 0; ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = linear(ctx, sx - 14, 0, sx + 14, 0, [[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']]);
      ctx.fillRect(0, oy * S - S, 100, (layout.height + 2) * S);
      ctx.globalCompositeOperation = 'source-over';
    }
  },

  // Generic shape for the AI mode: points in LEDs, keyframed motion.
  shape(ctx, t, i, el) {
    const k = keyframeAt(el.keyframes, t);
    ctx.save();
    ctx.globalAlpha = clamp(k.opacity ?? 1, 0, 1);
    ctx.translate((k.x ?? 0) * S, (k.y ?? 0) * S);
    ctx.rotate(((k.rotate ?? 0) * Math.PI) / 180);
    ctx.scale(k.scale ?? 1, k.scale ?? 1);
    const c = el.color || '#ffffff';
    ctx.fillStyle = el.gradient ? radial(ctx, 0, 0, (el.r ?? el.w ?? 4) * S, [[0, el.gradient], [1, c]]) : c;
    ctx.strokeStyle = c;
    ctx.lineWidth = (el.lineWidth ?? 1) * S;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    glowOn(ctx, c, el.glow ?? 0);
    ctx.beginPath();
    const P = (el.points || []).map(([px, py]) => [px * S, py * S]);
    switch (el.shape) {
      case 'circle': ctx.arc(0, 0, (el.r ?? 2) * S, 0, TAU); break;
      case 'ellipse': ctx.ellipse(0, 0, (el.rx ?? 3) * S, (el.ry ?? 2) * S, 0, 0, TAU); break;
      case 'rect': ctx.rect((-(el.w ?? 4) / 2) * S, (-(el.h ?? 4) / 2) * S, (el.w ?? 4) * S, (el.h ?? 4) * S); break;
      case 'line':
      case 'polygon':
      case 'path':
        P.forEach(([px, py], n) => (n ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
        if (el.shape === 'polygon') ctx.closePath();
        break;
      default: ctx.arc(0, 0, 2 * S, 0, TAU);
    }
    if (el.shape === 'line' || el.shape === 'path' || el.fill === false) ctx.stroke(); else ctx.fill();
    ctx.restore();
  },
};
Object.assign(PAINT, FESTIVE_PAINT);


function keyframeAt(kfs, t) {
  if (!Array.isArray(kfs) || !kfs.length) return { x: 10, y: 13 };
  const list = [...kfs].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  if (t <= (list[0].t ?? 0)) return list[0];
  for (let n = 0; n < list.length - 1; n++) {
    const a = list[n], b = list[n + 1], ta = a.t ?? 0, tb = b.t ?? 1;
    if (t >= ta && t <= tb) {
      const u = ease(tb === ta ? 1 : (t - ta) / (tb - ta)), out = {};
      for (const key of ['x', 'y', 'scale', 'rotate', 'opacity']) {
        const va = a[key] ?? (key === 'scale' || key === 'opacity' ? 1 : key === 'rotate' ? 0 : undefined);
        const vb = b[key] ?? va;
        out[key] = va === undefined ? undefined : va + (vb - va) * u;
      }
      return out;
    }
  }
  return list[list.length - 1];
}

// ---------- render a scene into a project ----------

export function sanitizeScene(spec) {
  const s = typeof spec === 'object' && spec ? spec : {};
  const els = (Array.isArray(s.elements) ? s.elements : []).filter((e) => e && ELEMENT_TYPES.includes(e.type)).slice(0, 24);
  return {
    name: String(s.name || 'Scene').slice(0, 40),
    frames: clamp(Math.round(s.frames || 32), 2, 100),
    frameMs: clamp(Math.round(s.frameMs || 70), 30, 500),
    background: { top: s.background?.top || '#000000', bottom: s.background?.bottom || s.background?.top || '#000000' },
    elements: els,
  };
}

// Subjects that the painters draw once; a count draws several copies, each shrunk into its own cell
// and offset in time so they don't move in lockstep. Bats, eyes and ghosts handle counts themselves.
const COPIES = { moon: 'grid', pumpkin: 'grid', skull: 'grid', heart: 'grid', witch: 'rows', spider: 'cols', ...Object.fromEntries(FESTIVE_MAINS.map((k) => [k, 'grid'])) };

function copyCells(el, n) {
  const out = [];
  if (COPIES[el.type] === 'rows') {
    const s = Math.min(1, 1.5 / n);
    for (let k = 0; k < n; k++) out.push({ x: 50, y: ((k + 0.5) / n) * 130, s, ax: 50, ay: (el.y ?? 12) * S, dt: k / n, el: {} });
    return out;
  }
  if (COPIES[el.type] === 'cols') {
    const s = Math.min(1, 1.6 / n);
    for (let k = 0; k < n; k++) out.push({ x: ((k + 0.5) / n) * 100, y: 0, s, ax: 50, ay: 0, dt: k / n, el: {} });
    return out;
  }
  // Still subjects fill the band the layout gave them (the whole panel when they're alone).
  const sc = el.scale ?? 1, h = Math.min(130, 130 * sc), cy = el.y != null ? el.y * S : 65, w = 100;
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols), size = Math.min(w / cols, h / rows);
    const score = size * (rows === 1 ? 1.3 : 1); // a single row reads better than a lopsided grid
    if (!best || score > best.score) best = { cols, rows, size, score };
  }
  const { cols, rows, size } = best, s = (size / 100) * 1.05;
  for (let k = 0; k < n; k++) {
    const r = Math.floor(k / cols), inRow = r === rows - 1 ? n - r * cols : cols, c = k % cols;
    out.push({ x: 50 + (c - (inRow - 1) / 2) * (w / cols), y: cy + (r - (rows - 1) / 2) * (h / rows), s, ax: 50, ay: 65, dt: k / n * 0.37, el: { x: 10, y: 13, scale: 1, r: 4.5 } });
  }
  return out;
}

export function renderScene(input) {
  const spec = sanitizeScene(input);
  const p = createProject(spec.name);
  const layerFor = (name, blend = 'normal') => ({ ...createLayer(name), blend, opacity: 1 });
  const bgBlack = spec.background.top === '#000000' && spec.background.bottom === '#000000';
  p.layers = [layerFor('Background')];
  p.frames = Array.from({ length: spec.frames }, () => createFrame(p.layers, spec.frameMs));
  const setCel = (layer, buf, f) => { f.cels[layer.id] = buf && !isEmpty(buf) ? buf : null; };

  if (!bgBlack) {
    const bg = celFromCanvas((ctx, W, H) => { ctx.fillStyle = linear(ctx, 0, 0, 0, H, [[0, spec.background.top], [1, spec.background.bottom]]); ctx.fillRect(0, 0, W, H); });
    p.frames.forEach((f) => setCel(p.layers[0], bg, f));
  }

  for (const el of spec.elements) {
    if (el.type === 'stars') {
      twinkle(p, { density: clamp(el.density ?? 0.08, 0.01, 0.4), speed: 1, seed: el.seed ?? 7, colors: el.colors });
      continue;
    }
    if (el.type === 'fire') {
      if (p.layers.length < MAX_LAYERS) fire(p, { height: clamp(el.h ? el.h / 26 : 0.4, 0.15, 1), frames: spec.frames });
      continue;
    }
    let layer;
    if (p.layers.length < MAX_LAYERS) {
      layer = layerFor(el.type === 'text' ? `Text ${el.text || ''}`.trim() : el.type[0].toUpperCase() + el.type.slice(1));
      p.layers.push(layer);
      for (const f of p.frames) f.cels[layer.id] = null;
    } else layer = p.layers[p.layers.length - 1];
    const paint = PAINT[el.type];
    p.frames.forEach((f, i) => {
      const t = i / spec.frames;
      const prev = f.cels[layer.id];
      const buf = celFromCanvas((ctx) => {
        if (prev) { const img = new ImageData(new Uint8ClampedArray(prev), 100, 130); ctx.putImageData(img, 0, 0); }
        const n = COPIES[el.type] ? clamp(Math.round(el.count ?? 1), 1, 6) : 1;
        if (n === 1) { ctx.save(); paint(ctx, t, i, { ...el, font: p.font }, spec); ctx.restore(); }
        else for (const c of copyCells(el, n)) {
          ctx.save(); ctx.translate(c.x, c.y); ctx.scale(c.s, c.s); ctx.translate(-c.ax, -c.ay);
          paint(ctx, (t + c.dt) % 1, i, { ...el, ...c.el, font: p.font }, spec); ctx.restore();
        }
      });
      setCel(layer, buf, f);
    });
  }
  return p;
}

// ---------- text → scene ----------

const NUMBERS = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const SUBJECTS = {
  pumpkin: ['pumpkin', 'pumpkins', 'jack-o-lantern', 'jack'],
  ghost: ['ghost', 'ghosts', 'spirit', 'spook', 'boo-ghost'],
  bats: ['bat', 'bats'],
  spider: ['spider', 'spiders', 'web'],
  witch: ['witch', 'witches', 'broom'],
  moon: ['moon', 'full moon', 'moonlight'],
  stars: ['star', 'stars', 'starry', 'twinkle', 'twinkling'],
  lightning: ['lightning', 'thunder', 'storm', 'stormy'],
  rain: ['rain', 'raining', 'rainy'],
  snow: ['snow', 'snowing', 'snowflakes', 'snowy'],
  fire: ['fire', 'flames', 'flame', 'burning', 'campfire', 'bonfire'],
  eyes: ['eyes', 'eye', 'glowing eyes', 'watching'],
  skull: ['skull', 'skulls', 'skeleton'],
  heart: ['heart', 'hearts', 'love'],
  ...FESTIVE_SUBJECTS,
};
const BACKGROUNDS = {
  sunset: { top: '#14062e', bottom: '#c2381a' }, dusk: { top: '#14062e', bottom: '#8a2a60' },
  night: { top: '#000000', bottom: '#0a0620' }, dark: { top: '#000000', bottom: '#000000' },
};

// Turns a short description into a scene. Returns { scene, understood: [labels] }.
// version picks among a festival's scenes and reshuffles random layouts (the "Try another" button).
export function sceneFromText(input, { version = 0 } = {}) {
  const raw = String(input || '').trim();
  const lower = raw.toLowerCase();
  // Commas and "and"/"with" split the description into clauses; colors and counts only apply within a clause.
  const words = lower.replace(/[,;.]/g, ' | ').replace(/[^\w\s'"“”|-]/g, ' ').split(/\s+/).filter(Boolean)
    .map((w) => (w === 'and' || w === 'with' ? '|' : w));
  const understood = [];
  const elements = [];
  const has = (list) => list.some((w) => (w.includes(' ') ? lower.includes(w) : words.includes(w)));
  const indexOf = (list) => { for (let k = 0; k < words.length; k++) if (list.includes(words[k])) return k; return -1; };
  const colorNear = (k) => {
    for (let d = 1; d <= 3; d++) { const w = words[k - d]; if (!w || w === '|') break; if (COLORS[w]) return COLORS[w]; }
    return null;
  };
  const countNear = (k) => {
    for (let d = 1; d <= 3; d++) { const w = words[k - d]; if (!w || w === '|') break; if (/^\d+$/.test(w)) return Number(w); if (NUMBERS[w]) return NUMBERS[w]; }
    return null;
  };
  const near = (k, list) => [1, 2, 3, -1, -2].some((d) => list.includes(words[k + d]));

  let frameMs = 70;
  if (has(['slow', 'slowly', 'gentle', 'calm'])) frameMs = 100;
  if (has(['fast', 'quick', 'quickly', 'rapid'])) frameMs = 50;

  // Quoted text, "say X", or ALL-CAPS words become lettering.
  let lettering = null;
  const q = raw.match(/["“”']([^"“”']{1,40})["“”']/);
  if (q) lettering = q[1];
  else {
    const say = raw.match(/\b(?:say|says|saying|text|write|spell|message)\s+([A-Za-z0-9!?.\- ]{1,30}?)(?:$|,|\bwith\b|\band\b)/i);
    if (say) lettering = say[1].trim();
    else {
      const caps = raw.match(/\b[A-Z0-9!?]{2,12}\b/g);
      if (caps) lettering = caps.join(' ');
    }
  }

  let background = { top: '#000000', bottom: '#000000' };
  for (const [k, v] of Object.entries(BACKGROUNDS)) if (words.includes(k)) background = v;
  const sky = words.indexOf('sky');
  if (sky > 0 && COLORS[words[sky - 1]]) background = { top: '#000000', bottom: COLORS[words[sky - 1]] + '' };

  const mains = [];
  const addElement = (el) => {
    const { type, color } = el;
    if (['pumpkin', 'skull', 'heart', ...FESTIVE_MAINS].includes(type) || (type === 'ghost' && el.motion === 'float' && !(el.count > 1))) mains.push(el);
    elements.push(el);
    const cname = color ? Object.keys(COLORS).find((n) => COLORS[n] === color) : null;
    understood.push(`${el.count > 1 ? el.count + ' ' : ''}${cname ? cname + ' ' : ''}${type}${type === 'ghost' ? ' (' + el.motion + ')' : ''}`);
  };
  for (const [type, list] of Object.entries(SUBJECTS)) {
    if (!has(list)) continue;
    const k = indexOf(list.filter((w) => !w.includes(' ')));
    const color = k >= 0 ? colorNear(k) : null;
    const el = { type };
    if (color) el.color = color;
    if (!['stars', 'rain', 'snow', 'fire', 'lightning'].includes(type)) { const n = k >= 0 ? countNear(k) : null; if (n) el.count = n; }
    if (type === 'ghost' && k >= 0) {
      if (near(k, ['floating', 'float', 'hovering', 'bobbing'])) el.motion = 'float';
      else if (near(k, ['flying', 'fly', 'flies', 'crossing', 'across', 'drifting', 'flying across'])) el.motion = 'cross';
      else el.motion = 'rise';
    }
    addElement(el);
  }

  // A festival name fills in a themed scene: its pieces when no main subject was named, and its greeting
  // when there's no lettering.
  let letteringColor = null;
  const fest = FESTIVALS.find((f) => has(f.words) && !(f.skipWhen && has(f.skipWhen)));
  if (fest) {
    understood.push(fest.label);
    const fv = festivalVersion(fest, lower, version);
    if (!mains.length) for (const e of fv.els) if (!elements.some((x) => x.type === e.type)) addElement({ ...e });
    if (!lettering && fv.text) lettering = fv.text;
    letteringColor = fest.color;
  }

  // Lay out the still subjects (and lettering) down the narrow panel.
  const slots = mains.length + (lettering ? 1 : 0);
  // Two slots with lettering give the picture most of the panel and the text a strip at the bottom.
  const pictureAndText = slots === 2 && lettering;
  const ys = slots <= 1 ? [13] : pictureAndText ? [10, 22] : slots === 2 ? [9, 20] : [6, 13, 21];
  mains.forEach((el, n) => { el.y = ys[n]; el.scale = slots >= 3 ? 0.45 : pictureAndText ? 0.76 : slots === 2 ? 0.62 : 1; });
  if (lettering) {
    const el = { type: 'text', text: lettering.toUpperCase() };
    const qi = words.findIndex((w) => lettering.toLowerCase().split(/\s+/)[0] === w.replace(/["“”']/g, ''));
    const c = qi > 0 ? colorNear(qi) : null;
    el.color = c || letteringColor || (elements.find((e) => e.type === 'pumpkin') ? '#ffd21f' : '#ff6a00');
    if (has(['pulse', 'pulsing', 'flash', 'flashing', 'blink', 'blinking'])) el.motion = 'pulse';
    if (has(['scroll', 'scrolling', 'marquee'])) el.motion = 'scroll';
    if (slots > 1) el.y = ys[slots - 1] - 2;
    else if (elements.some((e) => e.type === 'baubles' || e.type === 'witch')) el.y = 21; // keep clear of things crossing the middle
    elements.push(el);
    understood.push(`text "${el.text}"`);
  }

  // Order back to front: sky things, weather, subjects, lettering.
  const order = ['stars', ...FESTIVE_ORDER.back, 'moon', 'lightning', 'rain', 'snow', 'witch', 'bats', 'spider', 'eyes', 'fire', 'pumpkin', 'skull', 'heart', ...FESTIVE_MAINS, 'ghost', ...FESTIVE_ORDER.front, 'text'];
  elements.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

  if (!elements.length && raw) {
    elements.push({ type: 'text', text: raw.toUpperCase().slice(0, 40), color: '#ff6a00' });
    understood.push(`text "${raw.toUpperCase().slice(0, 40)}"`);
  }

  // Scrolling text needs enough frames to cross the panel smoothly (about half an LED per frame).
  let frames = 32;
  const txt = elements.find((e) => e.type === 'text');
  if (txt) {
    const w = layoutText(txt.text, DEFAULT_FONT).width;
    if ((txt.motion || (w > 20 ? 'scroll' : 'still')) === 'scroll') frames = clamp(Math.ceil((w + 21) / 0.5), 32, 100);
  }
  if (elements.some((e) => ['witch', 'bats', 'fireworks', 'balloons', 'powder'].includes(e.type))) frames = Math.max(frames, 48);

  if (version) elements.forEach((e, k) => { e.seed = 3 + version * 13 + k * 7; });
  const name = raw ? raw.replace(/["“”]/g, '').slice(0, 32) : 'Scene';
  return { scene: { name, frames, frameMs, background, elements }, understood };
}

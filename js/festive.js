// Festival elements for scenes: Christmas, New Year, Diwali, Easter, Eid, Hanukkah, Lunar New Year,
// Holi, birthdays and more. Same painter shape as scene.js: (ctx, t, frameIndex, el), drawing on the
// 100 x 130 work canvas, with el.x / el.y in LEDs and t running 0..1 around the loop.

import { mulberry, EASINGS } from './effects.js';
import { SCALE } from './raster.js';
import { radial, linear } from './templates.js';

const TAU = Math.PI * 2;
const S = SCALE;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PARTY = ['#ff1a2a', '#ffd21f', '#3ddc4a', '#2a6bff', '#ff4fa8', '#19e0d0', '#ff6a00', '#9b30ff'];

function glow(ctx, color, amount) { ctx.shadowColor = color; ctx.shadowBlur = amount * S; }
function noGlow(ctx) { ctx.shadowBlur = 0; }
function at(ctx, el, dx = 10, dy = 13) {
  ctx.translate((el.x ?? dx) * S, (el.y ?? dy) * S);
  const s = el.scale ?? 1; ctx.scale(s, s);
}
function palette(el) { return Array.isArray(el.colors) && el.colors.length ? el.colors : el.color ? [el.color] : PARTY; }
function star5(ctx, r, inner = 0.45) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * inner : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
}
function flame(ctx, x, y, h, t, seed = 0) {
  const f = 1 + 0.18 * Math.sin(TAU * (t * 7 + seed)) * Math.sin(TAU * (t * 3 + seed * 1.7));
  const hh = h * f;
  ctx.save();
  glow(ctx, '#ff9a1f', 2.2);
  ctx.fillStyle = radial(ctx, x, y - hh * 0.25, hh * 0.9, [[0, '#ffffff'], [0.3, '#ffe36a'], [0.75, '#ff8a00'], [1, 'rgba(255,90,0,0)']]);
  ctx.beginPath();
  ctx.moveTo(x, y - hh);
  ctx.quadraticCurveTo(x + hh * 0.45, y - hh * 0.25, x, y + hh * 0.12);
  ctx.quadraticCurveTo(x - hh * 0.45, y - hh * 0.25, x, y - hh);
  ctx.fill();
  ctx.restore();
}

export const FESTIVE_PAINT = {
  tree(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 14);
    ctx.fillStyle = '#7a4318'; ctx.fillRect(-7, 38, 14, 14);
    const green = el.color || '#1fb83a';
    // Four layered tiers with shaded edges and snow-dusted tips.
    for (const [y, w, h] of [[-36, 18, 22], [-20, 28, 26], [-2, 38, 30], [16, 48, 30]]) {
      ctx.fillStyle = linear(ctx, -w, 0, w, 0, [[0, '#0a5a1a'], [0.45, green], [0.6, '#6cff7c'], [1, '#0a5a1a']]);
      ctx.beginPath(); ctx.moveTo(0, y - h / 2 - 4);
      ctx.quadraticCurveTo(w * 0.4, y + h * 0.4, w, y + h);
      ctx.quadraticCurveTo(0, y + h - 6, -w, y + h);
      ctx.quadraticCurveTo(-w * 0.4, y + h * 0.4, 0, y - h / 2 - 4); ctx.fill();
      ctx.fillStyle = 'rgba(235,245,255,0.85)';
      ctx.beginPath(); ctx.ellipse(-w + 3, y + h - 2, 4, 2, 0, 0, TAU); ctx.ellipse(w - 3, y + h - 2, 4, 2, 0, 0, TAU); ctx.fill();
    }
    // A garland of lights spirals down the tree; the colours chase along it.
    const N = 26;
    for (let k = 0; k < N; k++) {
      const f = k / N, yy = -42 + f * 88, half = 8 + f * 40, x = Math.sin(f * TAU * 2.2 + 0.6) * half * 0.8;
      const front = Math.cos(f * TAU * 2.2 + 0.6) > -0.2;
      if (!front) continue;
      const phase = (t * 3 - f * 2) % 1, on = 0.4 + 0.6 * (phase < 0.5 ? 1 : 0.2);
      const c = PARTY[(k + Math.floor(t * 6)) % 6];
      ctx.globalAlpha = on; glow(ctx, c, 1.6); ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, yy, 3, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Glowing star with slowly turning rays.
    ctx.save(); ctx.translate(0, -50);
    ctx.rotate(t * TAU / 4);
    ctx.strokeStyle = 'rgba(255,230,140,0.55)'; ctx.lineWidth = 2;
    for (let r = 0; r < 4; r++) { ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(-17, 0); ctx.lineTo(17, 0); ctx.stroke(); }
    ctx.restore();
    const p = 1 + 0.15 * Math.sin(TAU * t * 2);
    glow(ctx, '#ffd21f', 3); ctx.fillStyle = '#ffe36a';
    ctx.translate(0, -50); ctx.scale(p, p); star5(ctx, 10); ctx.fill();
    ctx.restore();
  },

  snowman(ctx, t, i, el) {
    // A wide, overlapping body with a big face, buttons and a hat, so it reads as a snowman even at
    // curtain size: at 20 x 26 LEDs, separate round balls and dangling bits look like something else.
    ctx.save(); at(ctx, el, 10, 14);
    ctx.translate(0, Math.sin(TAU * t * 2) * 1.2);
    const snow = (x, y, rx, ry) => {
      ctx.fillStyle = radial(ctx, x - rx * 0.3, y - ry * 0.4, Math.max(rx, ry) * 1.5, [[0, '#ffffff'], [0.75, '#e4ecff'], [1, '#a8bcff']]);
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
    };
    glow(ctx, '#cfe0ff', 0.6);
    snow(0, 28, 28, 22);
    snow(0, 4, 21, 17);
    snow(0, -22, 17, 15);
    noGlow(ctx);
    // Arms reach up and out, waving.
    const wave = Math.sin(TAU * t * 2) * 5;
    ctx.strokeStyle = '#b07a3a'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-19, 2); ctx.lineTo(-40, -14 + wave); ctx.moveTo(-33, -9 + wave * 0.7); ctx.lineTo(-38, -2 + wave * 0.7);
    ctx.moveTo(19, 2); ctx.lineTo(40, -14 - wave); ctx.moveTo(33, -9 - wave * 0.7); ctx.lineTo(38, -2 - wave * 0.7);
    ctx.stroke();
    // Scarf round the neck only.
    ctx.fillStyle = '#ff1a2a'; ctx.beginPath(); ctx.ellipse(0, -9, 17, 4.5, 0, 0, TAU); ctx.fill();
    // Face: eyes, carrot nose pointing sideways, smile.
    ctx.fillStyle = '#1a1a2a';
    ctx.beginPath(); ctx.arc(-6, -26, 2.6, 0, TAU); ctx.arc(6, -26, 2.6, 0, TAU); ctx.fill();
    for (const [x, y] of [[-7, -16], [-3.5, -14.5], [0, -14], [3.5, -14.5], [7, -16]]) { ctx.beginPath(); ctx.arc(x, y, 1.3, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#ff7a00'; ctx.beginPath(); ctx.moveTo(-1, -23); ctx.lineTo(13, -20); ctx.lineTo(-1, -18); ctx.fill();
    // Coal buttons down the middle.
    ctx.fillStyle = '#1a1a2a';
    for (const y of [-1, 8, 22, 34]) { ctx.beginPath(); ctx.arc(0, y, 2.6, 0, TAU); ctx.fill(); }
    // Top hat with a red band, edged so it shows against black.
    ctx.fillStyle = '#2a2a44'; ctx.strokeStyle = '#8a8ab0'; ctx.lineWidth = 1.5;
    ctx.fillRect(-17, -37, 34, 5); ctx.strokeRect(-17, -37, 34, 5);
    ctx.fillRect(-11, -56, 22, 20); ctx.strokeRect(-11, -56, 22, 20);
    ctx.fillStyle = '#ff1a2a'; ctx.fillRect(-11, -42, 22, 4);
    ctx.restore();
  },

  gift(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 15);
    const c = el.color || '#ff1a2a', hop = Math.max(0, Math.sin(TAU * t * 2)) ** 3 * 8;
    ctx.fillStyle = linear(ctx, -30, 0, 30, 0, [[0, c], [0.5, '#ffffff'], [0.55, c], [1, c]]);
    ctx.fillStyle = c; ctx.fillRect(-28, -10, 56, 42);
    ctx.fillStyle = '#ffd21f'; ctx.fillRect(-5, -10, 10, 42);
    ctx.translate(0, -hop);
    ctx.fillStyle = c; ctx.fillRect(-32, -22, 64, 13);
    ctx.fillStyle = '#ffd21f'; ctx.fillRect(-5, -22, 10, 13);
    glow(ctx, '#ffd21f', 1.2);
    ctx.beginPath(); ctx.ellipse(-11, -28, 11, 6, -0.4, 0, TAU); ctx.ellipse(11, -28, 11, 6, 0.4, 0, TAU); ctx.fill();
    ctx.restore();
  },

  fireworks(ctx, t, i, el) {
    // Each rocket climbs with a sparkling tail, bursts with a white flash, then its sparks streak out,
    // droop under gravity, shift from white-hot to colour and crackle as they fade. Bursts alternate
    // between round peonies, drooping willows and two-tone rings.
    const n = clamp(el.count ?? 3, 1, 6), rnd = mulberry(el.seed ?? 11), cols = palette(el);
    const hash = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
    for (let k = 0; k < n; k++) {
      const u = (t + k / n) % 1, bx = 20 + rnd() * 60, by = el.y != null ? el.y * S + (rnd() - 0.5) * 24 : 16 + rnd() * 36;
      const c = cols[(k * 3) % cols.length], c2 = cols[(k * 3 + 2) % cols.length], kind = k % 3, R = (34 + rnd() * 12) * (el.scale ?? 1);
      ctx.save();
      if (u < 0.18) {
        const v = EASINGS['ease-out'](u / 0.18), y = 135 - (135 - by) * v, x = bx + (1 - v) * (k % 2 ? 6 : -6);
        for (let s = 1; s <= 5; s++) {
          ctx.globalAlpha = (1 - s / 6) * 0.8; ctx.fillStyle = s < 2 ? '#fff2c0' : '#ffaa40';
          ctx.beginPath(); ctx.arc(x + Math.sin(s * 2.1 + u * 40) * 1.5, y + s * 5, 2.2 - s * 0.25, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1; glow(ctx, '#ffe0a0', 1.5); ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fill();
        ctx.restore();
        continue;
      }
      const v = (u - 0.18) / 0.82, fade = Math.min(1, 1.25 * Math.max(0, 1 - v) ** 0.9);
      if (v < 0.1) {
        glow(ctx, '#ffffff', 4); ctx.fillStyle = `rgba(255,250,235,${1 - v / 0.1})`;
        ctx.beginPath(); ctx.arc(bx, by, 6 + 60 * v, 0, TAU); ctx.fill();
      }
      const sparks = kind === 1 ? 22 : 30, drop = kind === 1 ? 46 : 16;
      const pos = (p, vv) => {
        // Alternate sparks belong to an inner shell, which fills the burst instead of leaving a thin ring.
        const a = (p / sparks) * TAU + k * 0.7 + (hash(p, k) - 0.5) * 0.18, rr = R * (p % 2 && kind !== 2 ? 0.55 : 0.85 + hash(k, p) * 0.3);
        const r = rr * EASINGS['ease-out'](Math.min(1, vv * 1.5));
        return [bx + Math.cos(a) * r, by + Math.sin(a) * r + vv * vv * drop];
      };
      ctx.lineCap = 'round';
      for (let p = 0; p < sparks; p++) {
        const col = kind === 2 && p % 2 ? c2 : c;
        const hot = Math.max(0, 1 - v / 0.25);
        const [x, y] = pos(p, v), [px, py] = pos(p, Math.max(0, v - (kind === 1 ? 0.2 : 0.13)));
        const crackle = v > 0.55 ? (hash(p + k * 31, Math.floor(t * 48)) > 0.45 ? 1 : 0.25) : 1;
        ctx.globalAlpha = fade * 0.7 * crackle;
        ctx.strokeStyle = col; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(x, y); ctx.stroke();
        ctx.globalAlpha = fade * crackle; glow(ctx, col, 1.4);
        ctx.fillStyle = hot > 0 ? '#ffffff' : col;
        ctx.beginPath(); ctx.arc(x, y, 2.6 * (1 - v * 0.4), 0, TAU); ctx.fill();
        if (hot > 0) { ctx.globalAlpha = fade * (1 - hot); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fill(); }
      }
      ctx.restore();
    }
  },

  confetti(ctx, t, i, el) {
    const n = clamp(el.count ?? 40, 5, 80), rnd = mulberry(el.seed ?? 21), cols = palette(el);
    for (let k = 0; k < n; k++) {
      const x0 = rnd() * 100, y0 = rnd(), sp = 1 + Math.floor(rnd() * 2), ph = rnd();
      const y = ((y0 + t * sp) % 1) * 150 - 10, x = x0 + Math.sin(TAU * (t * sp * 2 + ph)) * 6;
      ctx.save(); ctx.translate(x, y); ctx.rotate(TAU * (t * sp * 2 + ph));
      ctx.fillStyle = cols[k % cols.length]; glow(ctx, cols[k % cols.length], 0.6);
      ctx.fillRect(-3.5, -1.5 * Math.abs(Math.cos(TAU * (t * sp * 3 + ph))) - 0.6, 7, 3 * Math.abs(Math.cos(TAU * (t * sp * 3 + ph))) + 1.2);
      ctx.restore();
    }
  },

  balloons(ctx, t, i, el) {
    const n = clamp(el.count ?? 4, 1, 6), cols = palette(el);
    for (let k = 0; k < n; k++) {
      const u = (t + k / n) % 1, x = ((k * 2 + 1) / (n * 2)) * 80 + 10 + Math.sin(TAU * (u * 2 + k * 0.3)) * 6, y = 165 - u * 210;
      const c = cols[(k * 3) % cols.length];
      ctx.save();
      ctx.strokeStyle = 'rgba(230,230,255,0.7)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, y + 16); ctx.quadraticCurveTo(x - 5, y + 28, x + 2, y + 40); ctx.stroke();
      glow(ctx, c, 1.2);
      ctx.fillStyle = radial(ctx, x - 5, y - 6, 22, [[0, '#ffffff'], [0.25, c], [1, c]]);
      ctx.beginPath(); ctx.ellipse(x, y, 12, 15, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x - 3, y + 17); ctx.lineTo(x + 3, y + 17); ctx.lineTo(x, y + 13); ctx.fill();
      ctx.restore();
    }
  },

  diya(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 16);
    const L = 0.8 + 0.2 * Math.sin(TAU * (t * 5 + (el.seed ?? 0) * 0.37));
    ctx.fillStyle = radial(ctx, 6, -16, 40, [[0, `rgba(255,170,40,${0.45 * L})`], [1, 'rgba(255,120,0,0)']]);
    ctx.fillRect(-44, -60, 100, 90);
    ctx.save(); glow(ctx, '#ff8a00', 1);
    ctx.fillStyle = linear(ctx, 0, 0, 0, 22, [[0, el.color || '#ff8a2a'], [1, '#7a2a00']]);
    ctx.beginPath(); ctx.moveTo(-34, 0); ctx.quadraticCurveTo(0, 40, 34, 0); ctx.quadraticCurveTo(40, -4, 26, -4); ctx.lineTo(-26, -4); ctx.quadraticCurveTo(-40, -4, -34, 0); ctx.fill();
    ctx.fillStyle = '#ffd21f'; ctx.fillRect(-24, 4, 48, 3);
    ctx.fillStyle = '#ff2adf'; for (const x of [-16, 0, 16]) { ctx.beginPath(); ctx.arc(x, 12, 2.6, 0, TAU); ctx.fill(); }
    ctx.restore();
    flame(ctx, 6, -4, 36, t, (el.seed ?? 0) * 0.37);
    ctx.restore();
  },

  lantern(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 12);
    ctx.translate(0, -40); ctx.rotate(Math.sin(TAU * t) * 0.12); ctx.translate(0, 40);
    const c = el.color || '#ff1a2a', L = 0.85 + 0.15 * Math.sin(TAU * t * 3);
    ctx.strokeStyle = '#ffd21f'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, -62); ctx.lineTo(0, -34); ctx.stroke();
    glow(ctx, c, 2.5 * L);
    ctx.fillStyle = radial(ctx, 0, 0, 40, [[0, '#ffe08a'], [0.35, c], [1, c]]);
    ctx.beginPath(); ctx.ellipse(0, 0, 30, 28, 0, 0, TAU); ctx.fill();
    noGlow(ctx);
    ctx.strokeStyle = 'rgba(120,10,0,0.6)'; ctx.lineWidth = 1.5;
    for (const rx of [10, 20]) { ctx.beginPath(); ctx.ellipse(0, 0, rx, 28, 0, 0, TAU); ctx.stroke(); }
    ctx.fillStyle = '#ffd21f'; ctx.fillRect(-14, -34, 28, 7); ctx.fillRect(-14, 27, 28, 7);
    ctx.fillRect(-2, 34, 4, 8);
    ctx.fillStyle = '#ff6a00'; ctx.beginPath(); ctx.moveTo(-5, 42); ctx.lineTo(5, 42); ctx.lineTo(3, 56); ctx.lineTo(-3, 56); ctx.fill();
    ctx.restore();
  },

  egg(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 14);
    ctx.rotate(Math.sin(TAU * t * 2) * 0.15);
    const c = el.color || '#ff4fa8', bands = ['#ffd21f', '#19e0d0', '#ffffff'];
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, 0, 26, 34, 0, 0, TAU); ctx.clip();
    ctx.fillStyle = radial(ctx, -8, -12, 46, [[0, '#ffffff'], [0.25, c], [1, c]]); ctx.fillRect(-30, -40, 60, 80);
    ctx.fillStyle = bands[0]; ctx.fillRect(-30, -12, 60, 7);
    ctx.fillStyle = bands[1];
    ctx.beginPath(); ctx.moveTo(-30, 8);
    for (let x = -30; x <= 30; x += 8) ctx.lineTo(x + 4, (x / 8) % 2 ? 2 : 14);
    ctx.lineTo(30, 18); ctx.lineTo(-30, 18); ctx.fill();
    ctx.fillStyle = bands[2];
    for (const x of [-14, 0, 14]) { ctx.beginPath(); ctx.arc(x, -24, 3, 0, TAU); ctx.fill(); }
    ctx.restore();
    ctx.restore();
  },

  bunny(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 15);
    const hop = Math.abs(Math.sin(TAU * t * 2)) * 10;
    ctx.translate(0, -hop);
    const c = el.color || '#ffffff';
    glow(ctx, '#ffffff', 0.8); ctx.fillStyle = c;
    for (const s of [-1, 1]) {
      ctx.save(); ctx.translate(s * 10, -26); ctx.rotate(s * (0.15 + Math.sin(TAU * t * 2) * 0.08));
      ctx.beginPath(); ctx.ellipse(0, -14, 7, 20, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ff8ac0'; ctx.beginPath(); ctx.ellipse(0, -14, 3.5, 14, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU); ctx.fill();
    noGlow(ctx);
    ctx.fillStyle = '#2a1a4a'; ctx.beginPath(); ctx.arc(-9, -4, 3.5, 0, TAU); ctx.arc(9, -4, 3.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff4fa8'; ctx.beginPath(); ctx.moveTo(-4, 5); ctx.lineTo(4, 5); ctx.lineTo(0, 10); ctx.fill();
    ctx.fillStyle = '#ffb0d0'; ctx.beginPath(); ctx.arc(-14, 8, 4, 0, TAU); ctx.arc(14, 8, 4, 0, TAU); ctx.fill();
    ctx.restore();
  },

  crescent(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 12);
    const c = el.color || '#ffd21f';
    ctx.save();
    glow(ctx, c, 2.5);
    ctx.fillStyle = radial(ctx, -10, -10, 50, [[0, '#ffffff'], [0.4, c], [1, c]]);
    ctx.beginPath(); ctx.arc(0, 0, 32, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'destination-out'; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(15, -9, 27, 0, TAU); ctx.fill();
    ctx.restore();
    const tw = 0.8 + 0.25 * Math.sin(TAU * t * 2);
    ctx.translate(20, -2); ctx.scale(tw, tw); ctx.rotate(t * TAU * 0.2);
    glow(ctx, '#ffffff', 2); ctx.fillStyle = '#fff6c0'; star5(ctx, 10); ctx.fill();
    ctx.restore();
  },

  menorah(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 16);
    const gold = el.color || '#ffc21f';
    ctx.fillStyle = gold; glow(ctx, gold, 0.6);
    ctx.fillRect(-4, -4, 8, 36); ctx.fillRect(-22, 32, 44, 6);
    ctx.fillRect(-48, -6, 96, 5);
    // Candles light one by one through the loop, then all burn together before it starts over.
    const lit = Math.min(9, Math.floor(t * 12) + 1);
    for (let k = 0; k < 9; k++) {
      const x = -44 + k * 11, h = k === 4 ? 22 : 12, top = -6 - h;
      ctx.fillStyle = '#4f8bff'; noGlow(ctx); ctx.fillRect(x - 2.5, top, 5, h);
      const order = k === 4 ? 0 : k < 4 ? 8 - k : 9 - k;
      if (order < lit) flame(ctx, x, top - 1, 24, t, k * 0.21);
    }
    ctx.restore();
  },

  shamrock(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 13);
    ctx.rotate(Math.sin(TAU * t) * 0.12);
    const c = el.color || '#2adf4a';
    ctx.strokeStyle = '#1a8a2a'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, 6); ctx.quadraticCurveTo(4, 26, 14, 40); ctx.stroke();
    glow(ctx, c, 1.5);
    for (let k = 0; k < 3; k++) {
      ctx.save(); ctx.rotate(-Math.PI / 2 + (k * TAU) / 3 + Math.PI / 2 - TAU / 3 + Math.PI / 6);
      ctx.fillStyle = radial(ctx, 0, -18, 26, [[0, '#b8ffb0'], [0.4, c], [1, '#0f7a20']]);
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-26, -14, -16, -38, 0, -24); ctx.bezierCurveTo(16, -38, 26, -14, 0, 0); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  },

  cake(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 16);
    const c = el.color || '#ff4fa8';
    ctx.fillStyle = '#ffe9f2'; ctx.fillRect(-36, 4, 72, 26);
    ctx.fillStyle = c; ctx.fillRect(-36, 4, 72, 6);
    for (let x = -32; x <= 32; x += 8) { ctx.beginPath(); ctx.arc(x, 10, 4, 0, Math.PI); ctx.fill(); }
    ctx.fillStyle = c; ctx.fillRect(-24, -16, 48, 20);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(-24, -16, 48, 4);
    ctx.fillStyle = '#c8d0e0'; ctx.fillRect(-42, 30, 84, 4);
    for (const [k, x] of [-14, 0, 14].entries()) {
      ctx.fillStyle = PARTY[k * 2 + 1]; ctx.fillRect(x - 2, -30, 4, 14);
      flame(ctx, x, -31, 10, t, k * 0.3);
    }
    ctx.restore();
  },

  flower(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 12);
    const c = el.color || '#ff4fa8';
    ctx.strokeStyle = '#2a9a3a'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 10); ctx.quadraticCurveTo(-6, 34, 0, 60); ctx.stroke();
    ctx.fillStyle = '#2adf4a'; ctx.beginPath(); ctx.ellipse(-12, 40, 12, 5, -0.5, 0, TAU); ctx.fill();
    const bloom = 0.85 + 0.15 * Math.sin(TAU * t), spin = t * TAU / 6;
    glow(ctx, c, 1.5);
    for (let k = 0; k < 6; k++) {
      ctx.save(); ctx.rotate(spin + (k * TAU) / 6);
      ctx.fillStyle = radial(ctx, 0, -16, 22, [[0, '#ffffff'], [0.4, c], [1, c]]);
      ctx.beginPath(); ctx.ellipse(0, -16 * bloom, 9, 16 * bloom, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#ffd21f'; glow(ctx, '#ffd21f', 1); ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill();
    ctx.restore();
  },

  rangoli(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 13);
    const cols = el.color ? [el.color, '#ffd21f', '#ffffff'] : ['#ff2adf', '#ffd21f', '#19e0d0', '#ff6a00'];
    ctx.rotate(t * TAU / 4);
    for (const [ring, petals, r, len, w] of [[0, 12, 30, 12, 6], [1, 8, 18, 12, 6], [2, 6, 7, 8, 5]]) {
      const c = cols[(ring + Math.floor(t * 4)) % cols.length];
      ctx.fillStyle = c; glow(ctx, c, 1.2);
      for (let k = 0; k < petals; k++) {
        ctx.save(); ctx.rotate((k * TAU) / petals + (ring % 2 ? -1 : 1) * t * TAU / 8);
        ctx.beginPath(); ctx.ellipse(0, -r, w, len, 0, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.fill();
    ctx.restore();
  },

  powder(ctx, t, i, el) {
    const n = clamp(el.count ?? 5, 1, 8), rnd = mulberry(el.seed ?? 5), cols = el.color ? [el.color] : ['#ff2adf', '#ffd21f', '#3ddc4a', '#2a6bff', '#ff6a00', '#19e0d0'];
    for (let k = 0; k < n; k++) {
      const u = (t + k / n) % 1, x = 15 + rnd() * 70, y = 15 + rnd() * 100, c = cols[k % cols.length];
      const r = 10 + 34 * EASINGS['ease-out'](u), a = Math.max(0, 1 - u) ** 0.8;
      ctx.save(); ctx.globalAlpha = a;
      ctx.fillStyle = radial(ctx, x, y, r, [[0, c], [0.55, c], [1, 'rgba(0,0,0,0)']]);
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.restore();
    }
  },

  leaves(ctx, t, i, el) {
    const n = clamp(el.count ?? 10, 1, 24), rnd = mulberry(el.seed ?? 17), cols = el.color ? [el.color] : ['#ff6a00', '#ffb21f', '#ff1a2a', '#c2381a'];
    for (let k = 0; k < n; k++) {
      const x0 = rnd() * 100, y0 = rnd(), ph = rnd();
      const y = ((y0 + t) % 1) * 160 - 15, x = x0 + Math.sin(TAU * (t * 2 + ph)) * 10;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(TAU * (t * 2 + ph)) * 0.9);
      const c = cols[k % cols.length]; ctx.fillStyle = c; glow(ctx, c, 0.6);
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.quadraticCurveTo(8, 0, 0, 8); ctx.quadraticCurveTo(-8, 0, 0, -8); ctx.fill();
      ctx.restore();
    }
  },

  sparkles(ctx, t, i, el) {
    const n = clamp(el.count ?? 12, 1, 30), rnd = mulberry(el.seed ?? 31), cols = el.color ? [el.color] : ['#ffffff', '#ffd21f', '#ffe9a8'];
    for (let k = 0; k < n; k++) {
      const x = rnd() * 100, y = rnd() * 130, ph = rnd(), sp = 1 + Math.floor(rnd() * 2);
      const v = Math.max(0, Math.sin(TAU * (t * sp + ph))) ** 3;
      if (v < 0.02) continue;
      const c = cols[k % cols.length];
      ctx.save(); ctx.translate(x, y); ctx.scale(v, v); ctx.globalAlpha = v;
      glow(ctx, c, 1.5); ctx.fillStyle = c; star5(ctx, 6, 0.3); ctx.fill();
      ctx.restore();
    }
  },

  santa(ctx, t, i, el) {
    // Sleigh and two reindeer flying across the top, lit so they show on black.
    const x = -80 + t * 230, y = (el.y ?? 6) * S + Math.sin(TAU * t * 2) * 5, s = el.scale ?? 1;
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    const deer = (dx, dy, lead) => {
      ctx.save(); ctx.translate(dx, dy);
      const leg = Math.sin(TAU * t * 8 + dx) * 4;
      ctx.fillStyle = '#d08a4a'; glow(ctx, '#ffb070', 0.6);
      ctx.beginPath(); ctx.ellipse(0, 0, 11, 5.5, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(11, -7, 4.5, 3.5, -0.4, 0, TAU); ctx.fill();
      ctx.fillRect(7, -6, 4, 6);
      ctx.strokeStyle = '#d08a4a'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-7, 3); ctx.lineTo(-10 - leg, 11); ctx.moveTo(6, 3); ctx.lineTo(9 + leg, 11); ctx.stroke();
      ctx.strokeStyle = '#f2d2a0'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(10, -10); ctx.lineTo(8, -17); ctx.lineTo(5, -19); ctx.moveTo(8, -15); ctx.lineTo(12, -18); ctx.stroke();
      if (lead) { ctx.fillStyle = '#ff2030'; glow(ctx, '#ff2030', 2); ctx.beginPath(); ctx.arc(15.5, -6, 2.4, 0, TAU); ctx.fill(); }
      ctx.restore();
    };
    deer(40, 0, false); deer(68, -3, true);
    ctx.strokeStyle = '#ffd21f'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(12, 2); ctx.lineTo(70, -2); ctx.stroke();
    // Sleigh
    glow(ctx, '#ff1a2a', 1.2);
    ctx.fillStyle = '#e8102a';
    ctx.beginPath(); ctx.moveTo(-22, -4); ctx.lineTo(14, -4); ctx.quadraticCurveTo(18, 4, 10, 8); ctx.lineTo(-18, 8); ctx.quadraticCurveTo(-26, 2, -22, -4); ctx.fill();
    ctx.strokeStyle = '#ffd21f'; ctx.lineWidth = 2; noGlow(ctx);
    ctx.beginPath(); ctx.moveTo(-22, 12); ctx.lineTo(14, 12); ctx.quadraticCurveTo(20, 12, 20, 6); ctx.stroke();
    // Santa
    ctx.fillStyle = '#ff2a3a'; ctx.beginPath(); ctx.ellipse(-6, -10, 8, 8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffe0c8'; ctx.beginPath(); ctx.arc(-4, -21, 4.5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff'; glow(ctx, '#ffffff', 0.8); ctx.beginPath(); ctx.arc(-3, -16, 5, 0, Math.PI); ctx.fill();
    ctx.fillStyle = '#ff2a3a'; noGlow(ctx); ctx.beginPath(); ctx.moveTo(-9, -24); ctx.lineTo(1, -24); ctx.lineTo(-10, -32); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(-10, -32, 2.2, 0, TAU); ctx.fill();
    // Sack of presents
    ctx.fillStyle = '#8a5a2a'; ctx.beginPath(); ctx.ellipse(-17, -9, 6, 7, 0, 0, TAU); ctx.fill();
    ctx.restore();
  },

  wreath(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 13);
    const g = el.color || '#1fb83a';
    ctx.strokeStyle = g; ctx.lineWidth = 14; glow(ctx, g, 1);
    ctx.beginPath(); ctx.arc(0, 0, 28, 0, TAU); ctx.stroke();
    ctx.strokeStyle = '#0d7a22'; ctx.lineWidth = 3; noGlow(ctx);
    for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; ctx.beginPath(); ctx.arc(Math.cos(a) * 28, Math.sin(a) * 28, 5, a, a + 2); ctx.stroke(); }
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TAU + 0.2, on = 0.35 + 0.65 * Math.max(0, Math.sin(TAU * (t * 2 - k / 12)));
      const c = k % 2 ? '#ffd21f' : '#ff1a2a';
      ctx.globalAlpha = on; ctx.fillStyle = c; glow(ctx, c, 1.3);
      ctx.beginPath(); ctx.arc(Math.cos(a) * 28, Math.sin(a) * 28, 3.4, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1; ctx.fillStyle = '#ff1a2a'; glow(ctx, '#ff1a2a', 1);
    ctx.beginPath(); ctx.moveTo(0, 30); ctx.lineTo(-16, 22); ctx.lineTo(-16, 38); ctx.closePath(); ctx.moveTo(0, 30); ctx.lineTo(16, 22); ctx.lineTo(16, 38); ctx.closePath(); ctx.fill();
    ctx.fillRect(-6, 30, 4, 14); ctx.fillRect(2, 30, 4, 14);
    ctx.restore();
  },

  baubles(ctx, t, i, el) {
    const n = clamp(el.count ?? 3, 1, 5), cols = el.color ? [el.color] : ['#ff1a2a', '#ffd21f', '#2a8bff', '#ff2adf', '#3ddc4a'];
    for (let k = 0; k < n; k++) {
      const x0 = ((k + 0.5) / n) * 100, len = 30 + ((k * 37) % 3) * 16, sw = Math.sin(TAU * (t + k / n)) * 0.18;
      const bx = x0 + Math.sin(sw) * len, by = Math.cos(sw) * len, c = cols[k % cols.length], r = 12;
      ctx.save();
      ctx.strokeStyle = 'rgba(230,220,180,0.75)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(bx, by - r); ctx.stroke();
      ctx.fillStyle = '#ffd21f'; ctx.fillRect(bx - 3.5, by - r - 4, 7, 5);
      glow(ctx, c, 1.6);
      ctx.fillStyle = radial(ctx, bx - 4, by - 4, r * 1.6, [[0, '#ffffff'], [0.3, c], [1, c]]);
      ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU); ctx.fill();
      ctx.restore();
    }
  },

  candycane(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 13);
    ctx.rotate(Math.sin(TAU * t) * 0.08);
    const path = () => { ctx.beginPath(); ctx.moveTo(6, 44); ctx.lineTo(6, -22); ctx.arc(-8, -22, 14, 0, Math.PI, true); ctx.lineTo(-22, -12); };
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 11; glow(ctx, '#ffffff', 1); path(); ctx.stroke();
    // Stripes march along the cane.
    ctx.strokeStyle = el.color || '#ff1a2a'; ctx.lineWidth = 11; noGlow(ctx); ctx.lineCap = 'butt';
    ctx.setLineDash([7, 7]); ctx.lineDashOffset = -t * 28; path(); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  },

  bells(ctx, t, i, el) {
    ctx.save(); at(ctx, el, 10, 13);
    ctx.scale(1.4, 1.4);
    const c = el.color || '#ffc21f';
    for (const side of [-1, 1]) {
      ctx.save(); ctx.translate(side * 10, -14); ctx.rotate(side * 0.25 + Math.sin(TAU * t * 2 + (side > 0 ? Math.PI : 0)) * 0.35);
      glow(ctx, c, 1.5);
      ctx.fillStyle = radial(ctx, -5, 10, 30, [[0, '#fff3c0'], [0.4, c], [1, '#a06a00']]);
      ctx.beginPath(); ctx.moveTo(-6, 4); ctx.quadraticCurveTo(-8, 22, -18, 32); ctx.lineTo(18, 32); ctx.quadraticCurveTo(8, 22, 6, 4); ctx.quadraticCurveTo(0, -2, -6, 4); ctx.fill();
      ctx.fillStyle = '#fff3c0'; ctx.beginPath(); ctx.arc(0, 34, 4, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#ff1a2a'; glow(ctx, '#ff1a2a', 1);
    ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(-16, -26); ctx.lineTo(-16, -8); ctx.closePath(); ctx.moveTo(0, -16); ctx.lineTo(16, -26); ctx.lineTo(16, -8); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -16, 4, 0, TAU); ctx.fill();
    ctx.restore();
  },
};

// Words that name each element in the text scene builder.
export const FESTIVE_SUBJECTS = {
  tree: ['tree', 'trees', 'christmas tree', 'xmas tree', 'pine'],
  snowman: ['snowman', 'snowmen', 'frosty'],
  gift: ['gift', 'gifts', 'present', 'presents', 'box', 'boxes'],
  fireworks: ['firework', 'fireworks', 'rocket', 'rockets', 'explosion', 'burst', 'bursts'],
  confetti: ['confetti', 'party', 'celebration', 'celebrate'],
  balloons: ['balloon', 'balloons'],
  diya: ['diya', 'diyas', 'lamp', 'lamps', 'oil lamp', 'candle', 'candles', 'deepam'],
  lantern: ['lantern', 'lanterns', 'paper lantern', 'kandil'],
  egg: ['egg', 'eggs', 'easter egg'],
  bunny: ['bunny', 'bunnies', 'rabbit', 'rabbits', 'hare'],
  crescent: ['crescent', 'hilal'],
  menorah: ['menorah', 'hanukkiah'],
  shamrock: ['shamrock', 'shamrocks', 'clover', 'four leaf clover'],
  cake: ['cake', 'cakes', 'cupcake'],
  flower: ['flower', 'flowers', 'blossom', 'blossoms', 'rose', 'roses', 'tulip', 'tulips', 'bloom', 'blooming'],
  rangoli: ['rangoli', 'kolam', 'mandala'],
  powder: ['powder', 'gulal', 'color splash', 'colour splash', 'paint splash', 'splash', 'splashes'],
  leaves: ['leaf', 'leaves', 'autumn', 'fall leaves'],
  sparkles: ['sparkle', 'sparkles', 'sparkling', 'glitter', 'shimmer', 'magic'],
  santa: ['santa', 'sleigh', 'reindeer', 'rudolph', 'father christmas', 'st nick'],
  wreath: ['wreath', 'wreaths'],
  baubles: ['bauble', 'baubles', 'ornament', 'ornaments', 'decorations'],
  candycane: ['candy cane', 'candy canes', 'candycane', 'candycanes'],
  bells: ['bell', 'bells', 'jingle'],
};

// Still subjects that take a slot in the layout; the rest move across the whole panel.
export const FESTIVE_MAINS = ['wreath', 'candycane', 'bells', 'tree', 'snowman', 'gift', 'diya', 'lantern', 'egg', 'bunny', 'crescent', 'menorah', 'shamrock', 'cake', 'flower', 'rangoli'];

// Draw order back to front.
export const FESTIVE_ORDER = { back: ['sparkles', 'fireworks', 'powder', 'leaves', 'balloons'], front: ['baubles', 'santa', 'confetti'] };

// A festival name alone builds a whole scene. Elements are added only when the description names
// no subjects of its own; the greeting is used only when there's no lettering.
function nextYear() {
  const d = new Date();
  return d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear();
}
export const FESTIVALS = [
  { words: ['halloween', 'spooky', 'trick or treat'], label: 'Halloween', more: [{ els: [{ type: 'bats', count: 4 }, { type: 'ghost', motion: 'rise' }], text: 'BOO' }, { els: [{ type: 'stars' }, { type: 'moon' }, { type: 'witch' }], text: 'HAPPY HALLOWEEN' }, { els: [{ type: 'eyes', count: 4 }, { type: 'skull' }], text: 'TRICK OR TREAT' }, { els: [{ type: 'spider', count: 2 }, { type: 'pumpkin', count: 2 }], text: 'SPOOKY' }], els: [{ type: 'moon', x: 15.5, y: 4, r: 3.2 }, { type: 'bats', count: 3 }, { type: 'pumpkin' }], text: 'BOO', color: '#ff6a00' },
  { words: ['christmas', 'xmas', 'santa', 'noel', 'yuletide'], label: 'Christmas', more: [{ els: [{ type: 'stars' }, { type: 'snow' }, { type: 'santa' }], text: 'HO HO HO' }, { els: [{ type: 'sparkles' }, { type: 'baubles', count: 3 }], text: 'MERRY XMAS' }, { els: [{ type: 'snow' }, { type: 'snowman' }], text: 'LET IT SNOW' }, { els: [{ type: 'sparkles' }, { type: 'wreath' }], text: 'JOY' }, { els: [{ type: 'snow' }, { type: 'bells' }], text: 'JINGLE BELLS' }, { els: [{ type: 'snow' }, { type: 'candycane', count: 2 }], text: 'SEASONS GREETINGS' }, { els: [{ type: 'sparkles' }, { type: 'gift', count: 3 }], text: 'MERRY CHRISTMAS' }], els: [{ type: 'snow' }, { type: 'tree' }], text: 'MERRY CHRISTMAS', color: '#ff1a2a' },
  { words: ['new year', 'newyear', 'nye', "new year's", 'countdown'], label: 'New Year', more: [{ els: [{ type: 'balloons', count: 5 }, { type: 'confetti', count: 24 }], text: 'CHEERS' }, { els: [{ type: 'fireworks', count: 6, colors: ['#ffd21f', '#ffffff', '#ffb21f'] }], text: () => `HELLO ${nextYear()}` }, { els: [{ type: 'sparkles', count: 20 }, { type: 'bells' }], text: 'HAPPY NEW YEAR' }], els: [{ type: 'fireworks', count: 4 }, { type: 'sparkles' }], text: () => `HAPPY ${nextYear()}`, color: '#ffd21f', skipWhen: ['lunar', 'chinese'] },
  { words: ['lunar new year', 'chinese new year', 'spring festival', 'tet', 'seollal'], label: 'Lunar New Year', more: [{ els: [{ type: 'sparkles', color: '#ffd21f' }, { type: 'lantern', count: 2 }], text: 'GONG XI FA CAI' }, { els: [{ type: 'fireworks', count: 5, colors: ['#ff1a2a', '#ffd21f'] }], text: 'HAPPY NEW YEAR' }], els: [{ type: 'fireworks', count: 3, color: '#ffd21f' }, { type: 'lantern' }], text: 'HAPPY NEW YEAR', color: '#ffd21f' },
  { words: ['diwali', 'deepavali', 'dipawali', 'deepawali'], label: 'Diwali', more: [{ els: [{ type: 'sparkles', color: '#ffd21f' }, { type: 'rangoli' }], text: 'SHUBH DIWALI' }, { els: [{ type: 'fireworks', count: 2 }, { type: 'diya', count: 3 }], text: 'HAPPY DIWALI' }, { els: [{ type: 'fireworks', count: 6 }, { type: 'sparkles' }], text: 'HAPPY DIWALI' }, { els: [{ type: 'sparkles', color: '#ffb21f' }, { type: 'lantern', color: '#ff6a00' }], text: 'DEEPAVALI' }], els: [{ type: 'fireworks', count: 3, y: 5, scale: 0.7 }, { type: 'diya' }], text: 'HAPPY DIWALI', color: '#ffb21f' },
  { words: ['easter'], label: 'Easter', more: [{ els: [{ type: 'sparkles' }, { type: 'egg', count: 4 }], text: 'HAPPY EASTER' }, { els: [{ type: 'flower', count: 3 }], text: 'SPRING' }, { els: [{ type: 'bunny' }], text: 'HOP HOP' }], els: [{ type: 'bunny' }, { type: 'egg', count: 3 }], text: 'HAPPY EASTER', color: '#ff4fa8' },
  { words: ['eid', 'ramadan', 'ramzan', 'mubarak'], label: 'Eid', more: [{ els: [{ type: 'sparkles', color: '#ffd21f' }, { type: 'lantern', color: '#ffb21f', count: 2 }] }, { els: [{ type: 'fireworks', count: 3, colors: ['#ffd21f', '#3ddc4a', '#ffffff'] }, { type: 'crescent' }] }], els: [{ type: 'sparkles' }, { type: 'crescent' }], text: () => null, color: '#ffd21f' },
  { words: ['hanukkah', 'chanukah', 'hanukah'], label: 'Hanukkah', more: [{ els: [{ type: 'sparkles', color: '#ffffff', count: 20 }, { type: 'menorah', color: '#c8d0e0' }], text: 'CHAG SAMEACH' }], els: [{ type: 'sparkles', color: '#4f8bff' }, { type: 'menorah' }], text: 'HAPPY HANUKKAH', color: '#4f8bff' },
  { words: ['holi'], label: 'Holi', more: [{ els: [{ type: 'powder', count: 8 }, { type: 'confetti', count: 16 }], text: 'BURA NA MANO HOLI HAI' }], els: [{ type: 'powder', count: 6 }], text: 'HAPPY HOLI', color: '#ff2adf' },
  { words: ['valentine', 'valentines', "valentine's"], label: "Valentine's", more: [{ els: [{ type: 'sparkles', color: '#ff4fa8' }, { type: 'heart', count: 3 }], text: 'BE MINE' }, { els: [{ type: 'flower', color: '#ff1a2a', count: 2 }], text: 'I LOVE YOU' }], els: [{ type: 'sparkles', color: '#ff4fa8' }, { type: 'heart' }], text: 'LOVE', color: '#ff4fa8' },
  { words: ['patrick', "patrick's", 'patricks', 'paddy', 'paddys', "paddy's"], label: "St Patrick's", els: [{ type: 'sparkles', color: '#3ddc4a' }, { type: 'shamrock' }], text: 'LUCKY', color: '#3ddc4a' },
  { words: ['thanksgiving'], label: 'Thanksgiving', more: [{ els: [{ type: 'leaves', count: 16 }], text: 'GIVE THANKS' }], els: [{ type: 'leaves' }, { type: 'pumpkin' }], text: 'THANKS', color: '#ffb21f' },
  { words: ['birthday', 'bday', 'b-day'], label: 'Birthday', more: [{ els: [{ type: 'balloons', count: 6 }], text: 'HAPPY BDAY' }, { els: [{ type: 'fireworks', count: 3 }, { type: 'confetti', count: 20 }], text: 'PARTY TIME' }, { els: [{ type: 'sparkles' }, { type: 'cake' }], text: 'MAKE A WISH' }], els: [{ type: 'balloons' }, { type: 'confetti', count: 18 }, { type: 'cake' }], text: 'HAPPY BIRTHDAY', color: '#ff4fa8' },
  { words: ['july', 'independence'], label: 'Independence Day', more: [{ els: [{ type: 'confetti', count: 20, colors: ['#ff1a2a', '#ffffff', '#2a6bff'] }, { type: 'fireworks', count: 3, colors: ['#ff1a2a', '#ffffff', '#2a6bff'] }], text: 'HAPPY 4TH' }], els: [{ type: 'stars' }, { type: 'fireworks', count: 4, colors: ['#ff1a2a', '#ffffff', '#2a6bff'] }], text: 'USA', color: '#ff1a2a' },
  { words: ['wedding', 'anniversary', 'engagement'], label: 'Wedding', els: [{ type: 'sparkles' }, { type: 'heart', count: 2 }], text: 'LOVE', color: '#ffd9e6' },
  { words: ['mothers', "mother's", 'mom', 'mum', 'mama'], label: "Mother's Day", els: [{ type: 'flower', count: 3 }], text: 'LOVE MOM', color: '#ff4fa8' },
  { words: ['navratri', 'garba', 'dussehra', 'durga', 'pongal', 'onam', 'ganesh', 'ganpati'], label: 'Indian festival', els: [{ type: 'sparkles', color: '#ffd21f' }, { type: 'rangoli' }], text: null, color: '#ffb21f' },
  { words: ['spring', 'nowruz', 'vaisakhi', 'baisakhi'], label: 'Spring', els: [{ type: 'sparkles' }, { type: 'flower', count: 3 }], text: null, color: '#3ddc4a' },
  { words: ['winter', 'snowy night', 'holidays', 'holiday'], label: 'Winter', els: [{ type: 'snow' }, { type: 'snowman' }], text: null, color: '#19e0d0' },
];

// Festivals come in several versions; "Try another" steps through them. Version 0 is the main one.
export function festivalVersions(f) {
  return [{ els: f.els, text: f.text }, ...(f.more || [])];
}

export function festivalVersion(f, lower, n = 0) {
  const all = festivalVersions(f), v = all[((n % all.length) + all.length) % all.length];
  // Eid's greeting follows which word was used.
  let text = typeof v.text === 'function' ? v.text() : v.text;
  if (f.label === 'Eid') text = /ramadan|ramzan/.test(lower) ? 'RAMADAN KAREEM' : 'EID MUBARAK';
  return { els: v.els, text };
}

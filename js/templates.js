// Six starter animations. Everything is drawn into ordinary layers and frames, so all of it stays editable.

import { createProject, createLayer, createFrame } from './model.js';
import { celFromCanvas, makeLoopNoise, twinkle, EASINGS } from './effects.js';
import { isEmpty } from './raster.js';

const TAU = Math.PI * 2;

function setup(name, layerNames, frameCount, duration) {
  const p = createProject(name);
  p.layers = layerNames.map((n) => {
    const [label, blend = 'normal', opacity = 1] = Array.isArray(n) ? n : [n];
    return { ...createLayer(label), blend, opacity };
  });
  p.frames = [];
  for (let i = 0; i < frameCount; i++) p.frames.push(createFrame(p.layers, duration));
  return p;
}

// Draw into one layer on every frame; draw(ctx, t, i, W, H). Identical results share a buffer.
function paint(p, layerIndex, draw, { once = false } = {}) {
  const id = p.layers[layerIndex].id, n = p.frames.length;
  let shared = null;
  p.frames.forEach((f, i) => {
    if (once && shared) { f.cels[id] = shared; return; }
    const buf = celFromCanvas((ctx, W, H) => draw(ctx, i / n, i, W, H));
    f.cels[id] = isEmpty(buf) ? null : buf;
    if (once) shared = f.cels[id];
  });
}

function radial(ctx, x, y, r, stops) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

// ---------- 1. Pumpkin flicker ----------

function pumpkin() {
  const p = setup('Pumpkin flicker', ['Night', 'Pumpkin', 'Candle light', ['Glow', 'add', 0.9]], 24, 70);
  const flick = makeLoopNoise(11, 6), flick2 = makeLoopNoise(23, 4);
  const level = (t) => 0.72 + 0.28 * (0.6 * flick(0, 0, t) + 0.4 * flick2(3, 1, t));
  const face = (ctx) => {
    ctx.beginPath();
    ctx.moveTo(27, 74); ctx.lineTo(41, 74); ctx.lineTo(34, 62); ctx.closePath(); // left eye
    ctx.moveTo(59, 74); ctx.lineTo(73, 74); ctx.lineTo(66, 62); ctx.closePath(); // right eye
    ctx.moveTo(46, 83); ctx.lineTo(54, 83); ctx.lineTo(50, 77); ctx.closePath(); // nose
    // jagged grin
    ctx.moveTo(22, 90);
    ctx.quadraticCurveTo(50, 104, 78, 90);
    ctx.lineTo(75, 101); ctx.lineTo(68, 97); ctx.lineTo(62, 106); ctx.lineTo(55, 100); ctx.lineTo(50, 108);
    ctx.lineTo(45, 100); ctx.lineTo(38, 106); ctx.lineTo(32, 97); ctx.lineTo(25, 101); ctx.closePath();
  };
  paint(p, 0, (ctx, t, i, W, H) => {
    ctx.fillStyle = linear(ctx, 0, 0, 0, H, [[0, '#1a0633'], [0.6, '#0a0418'], [1, '#000000']]);
    ctx.fillRect(0, 0, W, H);
  }, { once: true });
  paint(p, 1, (ctx) => {
    const ribs = [[50, 82, 46, 38], [30, 84, 24, 34], [70, 84, 24, 34], [50, 84, 20, 37]];
    ribs.forEach(([x, y, rx, ry], k) => {
      ctx.fillStyle = radial(ctx, x - rx * 0.2, y - ry * 0.35, Math.max(rx, ry) * 1.15, [[0, k === 3 ? '#f07a18' : '#e06a10'], [0.6, '#b83e00'], [1, '#5a1600']]);
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
    });
    ctx.fillStyle = linear(ctx, 44, 38, 56, 50, [[0, '#4a8a2a'], [1, '#2a5a12']]);
    ctx.beginPath(); ctx.moveTo(45, 50); ctx.quadraticCurveTo(44, 40, 52, 35); ctx.lineTo(56, 38); ctx.quadraticCurveTo(51, 42, 55, 50); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#2a0800'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    face(ctx); ctx.stroke();
    ctx.globalCompositeOperation = 'destination-out';
    face(ctx); ctx.fill();
  }, { once: true });
  paint(p, 2, (ctx, t) => {
    const L = level(t);
    ctx.fillStyle = radial(ctx, 50, 86, 40, [[0, `rgba(255,${235 + 20 * L},${120 + 100 * L},1)`], [0.6, `rgba(255,${200 + 40 * L},${40 * L},1)`], [1, `rgba(255,${150 + 40 * L},0,1)`]]);
    ctx.globalAlpha = 0.55 + 0.45 * L;
    face(ctx); ctx.fill();
  });
  paint(p, 3, (ctx, t) => {
    const L = level(t);
    ctx.fillStyle = radial(ctx, 50, 86, 62, [[0, `rgba(255,140,20,${0.45 * L})`], [0.55, `rgba(255,80,0,${0.18 * L})`], [1, 'rgba(255,60,0,0)']]);
    ctx.fillRect(0, 0, 100, 130);
  });
  return p;
}

// ---------- 2. Bats crossing ----------

function drawBat(ctx, x, y, s, flap) {
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  const lift = flap * 9;
  ctx.fillStyle = '#050208';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, -1);
    ctx.quadraticCurveTo(side * 8, -6 - lift, side * 17, -3 - lift * 1.2);
    ctx.lineTo(side * 14, 1 - lift * 0.5);
    ctx.quadraticCurveTo(side * 11, -1 - lift * 0.3, side * 9, 3 - lift * 0.2);
    ctx.quadraticCurveTo(side * 6, 1, side * 4, 4);
    ctx.lineTo(0, 3);
    ctx.closePath(); ctx.fill();
  }
  ctx.beginPath(); ctx.ellipse(0, 1, 3, 4.5, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-2.5, -3); ctx.lineTo(-2, -7.5); ctx.lineTo(-0.5, -4); ctx.lineTo(0.5, -4); ctx.lineTo(2, -7.5); ctx.lineTo(2.5, -3); ctx.fill();
  ctx.restore();
}

function bats() {
  const p = setup('Bats crossing', ['Dusk sky', ['Moon', 'normal', 1], 'Bats'], 32, 60);
  paint(p, 0, (ctx, t, i, W, H) => {
    ctx.fillStyle = linear(ctx, 0, 0, 0, H, [[0, '#14062e'], [0.45, '#4a1260'], [0.8, '#c2381a'], [1, '#ff7a10']]);
    ctx.fillRect(0, 0, W, H);
  }, { once: true });
  paint(p, 1, (ctx) => {
    ctx.fillStyle = radial(ctx, 68, 34, 34, [[0, 'rgba(255,240,200,0.5)'], [1, 'rgba(255,200,150,0)']]);
    ctx.fillRect(0, 0, 100, 130);
    ctx.fillStyle = radial(ctx, 64, 30, 18, [[0, '#fffbe8'], [0.8, '#ffe6a0'], [1, '#f4c870']]);
    ctx.beginPath(); ctx.arc(68, 34, 15, 0, TAU); ctx.fill();
  }, { once: true });
  const flock = [
    { y: 42, amp: 6, s: 1.7, off: 0.0, flaps: 4, speed: 1 },
    { y: 72, amp: 5, s: 1.3, off: 0.45, flaps: 5, speed: 1 },
    { y: 100, amp: 6, s: 1.5, off: 0.75, flaps: 4, speed: 1 },
  ];
  paint(p, 2, (ctx, t) => {
    for (const b of flock) {
      const u = (t * b.speed + b.off) % 1;
      const x = -32 + u * 164, y = b.y + Math.sin(TAU * (t * 2 + b.off)) * b.amp;
      drawBat(ctx, x, y, b.s, Math.sin(TAU * (t * b.flaps + b.off)));
    }
  });
  return p;
}

// ---------- 3. Ghost rising ----------

function drawGhost(ctx, x, y, alpha, wave) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = linear(ctx, 0, -26, 0, 28, [[0, '#ffffff'], [0.7, '#dfe8ff'], [1, '#9fb4ff']]);
  ctx.beginPath();
  ctx.moveTo(-20, 0);
  ctx.bezierCurveTo(-20, -34, 20, -34, 20, 0);
  ctx.lineTo(20, 22);
  for (let k = 0; k <= 4; k++) {
    const xx = 20 - k * 10, yy = 22 + Math.sin(wave + k * 1.7) * 3;
    ctx.quadraticCurveTo(xx - 5, yy + 6, xx - 10, yy);
  }
  ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath(); ctx.ellipse(-8, -6, 4.5, 6.5, 0, 0, TAU); ctx.ellipse(8, -6, 4.5, 6.5, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(0, 9, 4, 5, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

function ghost() {
  const p = setup('Ghost rising', ['Graveyard', ['Ghost glow', 'add', 0.8], 'Ghost'], 36, 70);
  const pos = (t) => {
    const e = EASINGS['ease-out'](t);
    return { x: 50 + Math.sin(TAU * t * 2) * 6, y: 150 - e * 110, a: Math.min(1, t / 0.15) * Math.min(1, (1 - t) / 0.25), wave: TAU * t * 4 };
  };
  paint(p, 0, (ctx, t, i, W, H) => {
    ctx.fillStyle = linear(ctx, 0, 0, 0, H, [[0, '#050818'], [0.75, '#16103a'], [1, '#1d1240']]);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#0b2a14';
    ctx.beginPath(); ctx.moveTo(0, 118); ctx.quadraticCurveTo(50, 104, 100, 116); ctx.lineTo(100, 130); ctx.lineTo(0, 130); ctx.fill();
    ctx.fillStyle = linear(ctx, 0, 92, 0, 120, [[0, '#6a6480'], [1, '#2a2638']]);
    const stone = (x, w, h) => { ctx.beginPath(); ctx.moveTo(x - w / 2, 120); ctx.lineTo(x - w / 2, 120 - h + w / 2); ctx.arc(x, 120 - h + w / 2, w / 2, Math.PI, 0); ctx.lineTo(x + w / 2, 120); ctx.fill(); };
    stone(16, 16, 26); stone(84, 14, 22);
  }, { once: true });
  paint(p, 1, (ctx, t) => {
    const g = pos(t);
    ctx.fillStyle = radial(ctx, g.x, g.y, 42, [[0, `rgba(120,200,255,${0.55 * g.a})`], [1, 'rgba(80,140,255,0)']]);
    ctx.fillRect(0, 0, 100, 130);
  });
  paint(p, 2, (ctx, t) => { const g = pos(t); drawGhost(ctx, g.x, g.y, g.a, g.wave); });
  return p;
}

// ---------- 4. Spider descending ----------

function spider() {
  const p = setup('Spider descending', ['Moon night', 'Web', 'Thread', 'Spider'], 32, 70);
  const yAt = (t) => (t < 0.55 ? 18 + 64 * EASINGS.bounce(t / 0.55) : 82 - 64 * EASINGS['ease-in-out']((t - 0.55) / 0.45));
  paint(p, 0, (ctx, t, i, W, H) => {
    ctx.fillStyle = linear(ctx, 0, 0, 0, H, [[0, '#06041a'], [1, '#1a0a33']]);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = radial(ctx, 50, 80, 55, [[0, 'rgba(180,255,120,0.35)'], [1, 'rgba(60,220,80,0)']]);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = radial(ctx, 44, 74, 34, [[0, '#f4ffd8'], [0.7, '#c8f08a'], [1, '#8ad04a']]);
    ctx.beginPath(); ctx.arc(50, 80, 32, 0, TAU); ctx.fill();
  }, { once: true });
  paint(p, 1, (ctx) => {
    ctx.strokeStyle = 'rgba(200,200,230,0.75)'; ctx.lineWidth = 1.6;
    for (let k = 0; k < 5; k++) { const a = (k / 4) * (Math.PI / 2); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 38, Math.sin(a) * 38); ctx.stroke(); }
    for (const r of [12, 22, 32]) { ctx.beginPath(); for (let k = 0; k <= 4; k++) { const a = (k / 4) * (Math.PI / 2); const px = Math.cos(a) * r, py = Math.sin(a) * r; k ? ctx.quadraticCurveTo(Math.cos(a - 0.2) * r * 0.85, Math.sin(a - 0.2) * r * 0.85, px, py) : ctx.moveTo(px, py); } ctx.stroke(); }
  }, { once: true });
  paint(p, 2, (ctx, t) => {
    ctx.strokeStyle = 'rgba(230,230,255,0.8)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(50, 0); ctx.lineTo(50, yAt(t) - 8); ctx.stroke();
  });
  paint(p, 3, (ctx, t) => {
    const y = yAt(t), wig = Math.sin(TAU * t * 6);
    ctx.save(); ctx.translate(50, y);
    ctx.strokeStyle = '#0a0410'; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const side of [-1, 1]) for (let k = 0; k < 4; k++) {
      const a = -0.9 + k * 0.6 + wig * 0.12 * (k % 2 ? 1 : -1);
      ctx.beginPath(); ctx.moveTo(0, 2);
      ctx.lineTo(side * (10 + k), 2 + Math.sin(a) * 12 - 6);
      ctx.lineTo(side * (17 + k * 2), 2 + Math.sin(a) * 16 + 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#0a0410';
    ctx.beginPath(); ctx.ellipse(0, 6, 8, 9, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -4, 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff2030';
    ctx.beginPath(); ctx.arc(-2, -4, 1.6, 0, TAU); ctx.arc(2, -4, 1.6, 0, TAU); ctx.fill();
    ctx.restore();
  });
  return p;
}

// ---------- 5. Lightning storm ----------

function storm() {
  const p = setup('Lightning storm', ['Sky', 'Clouds', ['Bolt', 'add', 1], 'Rain'], 40, 60);
  const flashAt = { 8: 1, 9: 0.35, 10: 0.9, 11: 0.5, 12: 0.25, 13: 0.1, 27: 0.85, 28: 0.4, 29: 0.15 };
  const boltOn = { 8: 1, 10: 1, 11: 0.6, 12: 0.25, 27: 1, 28: 0.5, 29: 0.2 };
  paint(p, 0, (ctx, t, i, W, H) => {
    const f = flashAt[i] || 0;
    const mix = (a, b) => a.map((v, k) => Math.round(v + (b[k] - v) * f));
    const top = mix([8, 8, 26], [170, 160, 230]), bot = mix([4, 4, 14], [70, 60, 120]);
    ctx.fillStyle = linear(ctx, 0, 0, 0, H, [[0, `rgb(${top})`], [1, `rgb(${bot})`]]);
    ctx.fillRect(0, 0, W, H);
  });
  const noise = makeLoopNoise(5, 5);
  paint(p, 1, (ctx, t, i) => {
    const f = flashAt[i] || 0;
    const puffs = [[8, 6, 26], [30, 16, 22], [52, 4, 28], [74, 18, 22], [96, 6, 26], [118, 16, 22], [-14, 16, 22]];
    for (const [x, y, r] of puffs) {
      const px = ((x + t * 125) % 125) - 12, py = y + noise(x, y, t) * 2;
      const shade = Math.round(34 + 140 * f);
      ctx.fillStyle = radial(ctx, px, py - r * 0.3, r, [[0, `rgba(${shade + 30},${shade + 28},${shade + 55},1)`], [0.6, `rgba(${shade},${shade},${shade + 28},0.9)`], [1, 'rgba(20,20,40,0)']]);
      ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
    }
  });
  const boltPath = (seed) => {
    let s = seed; const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    const pts = [[45 + r() * 20, 18]]; let x = pts[0][0];
    for (let y = 18; y < 128; y += 9 + r() * 8) { x += (r() - 0.5) * 22; pts.push([x, y]); }
    return pts;
  };
  paint(p, 2, (ctx, t, i) => {
    const b = boltOn[i];
    if (!b) return;
    const pts = boltPath(i < 20 ? 3 : 17);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    for (const [w, col] of [[9, `rgba(120,140,255,${0.35 * b})`], [4.5, `rgba(190,200,255,${0.8 * b})`], [2, `rgba(255,255,255,${b})`]]) {
      ctx.strokeStyle = col; ctx.lineWidth = w;
      ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    }
  });
  const drops = Array.from({ length: 22 }, (_, k) => ({ x: (k * 37) % 110, y: (k * 53) % 130, sp: 1 + (k % 2) }));
  paint(p, 3, (ctx, t) => {
    ctx.strokeStyle = 'rgba(140,170,255,0.55)'; ctx.lineWidth = 1.2;
    for (const d of drops) {
      const y = ((d.y + t * 130 * d.sp) % 150) - 10, x = d.x - (y / 130) * 10;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + 9); ctx.stroke();
    }
  });
  return p;
}

// ---------- 6. Witch across the moon ----------

function drawWitch(ctx, x, y, t) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1.55, 1.55); ctx.rotate(-0.08 + Math.sin(TAU * t * 2) * 0.05);
  ctx.fillStyle = '#060309'; ctx.strokeStyle = '#060309'; ctx.lineCap = 'round';
  // broom
  ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(-22, 6); ctx.lineTo(20, 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-20, 6); ctx.lineTo(-32, 0); ctx.lineTo(-34, 7); ctx.lineTo(-31, 13); ctx.closePath(); ctx.fill();
  // cloak and cape flutter
  const flut = Math.sin(TAU * t * 6) * 3;
  ctx.beginPath(); ctx.moveTo(-4, -10); ctx.lineTo(6, 5); ctx.lineTo(-14, 7 + flut * 0.3); ctx.quadraticCurveTo(-20, 0 + flut, -16, -6); ctx.closePath(); ctx.fill();
  // head
  ctx.beginPath(); ctx.arc(-1, -13, 3.6, 0, TAU); ctx.fill();
  // hat
  ctx.beginPath(); ctx.moveTo(-9, -15); ctx.lineTo(7, -16); ctx.lineTo(-4, -18); ctx.lineTo(-10, -29); ctx.lineTo(-3, -18); ctx.closePath(); ctx.fill();
  // arm on broom
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(8, 3); ctx.stroke();
  ctx.restore();
}

function witch() {
  const p = setup('Witch across the moon', ['Night', 'Stars', ['Moon glow', 'add', 0.9], 'Moon', 'Witch'], 40, 70);
  paint(p, 0, (ctx, t, i, W, H) => {
    ctx.fillStyle = linear(ctx, 0, 0, 0, H, [[0, '#04041a'], [1, '#1c0a36']]);
    ctx.fillRect(0, 0, W, H);
  }, { once: true });
  paint(p, 2, (ctx) => {
    ctx.fillStyle = radial(ctx, 50, 56, 56, [[0, 'rgba(255,220,120,0.5)'], [0.6, 'rgba(255,170,60,0.15)'], [1, 'rgba(255,150,50,0)']]);
    ctx.fillRect(0, 0, 100, 130);
  }, { once: true });
  paint(p, 3, (ctx) => {
    ctx.fillStyle = radial(ctx, 42, 46, 40, [[0, '#fff6d0'], [0.7, '#ffd870'], [1, '#e8a830']]);
    ctx.beginPath(); ctx.arc(50, 56, 31, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(200,140,40,0.35)';
    for (const [x, y, r] of [[38, 48, 5], [60, 66, 7], [58, 42, 3.5], [44, 70, 3]]) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  }, { once: true });
  paint(p, 4, (ctx, t) => {
    const x = -55 + t * 210, y = 60 + Math.sin(TAU * t) * 8 - t * 8;
    drawWitch(ctx, x, y, t);
  });
  // Fills the existing "Stars" layer, which sits below the opaque moon.
  twinkle(p, { density: 0.07, speed: 1, seed: 21 });
  return p;
}

export const TEMPLATES = [
  { id: 'pumpkin', name: 'Pumpkin flicker', build: pumpkin },
  { id: 'bats', name: 'Bats crossing', build: bats },
  { id: 'ghost', name: 'Ghost rising', build: ghost },
  { id: 'spider', name: 'Spider descending', build: spider },
  { id: 'storm', name: 'Lightning storm', build: storm },
  { id: 'witch', name: 'Witch across the moon', build: witch },
];

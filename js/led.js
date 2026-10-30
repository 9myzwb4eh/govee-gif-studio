// Draws the 20 x 26 panel output either as flat pixels or as glowing LED beads.

import { PANEL_W, PANEL_H } from './raster.js';

const small = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function toImageData(rgb, w, h) {
  const img = new ImageData(w, h);
  for (let i = 0, p = 0; i < rgb.length; i += 3, p += 4) {
    img.data[p] = rgb[i]; img.data[p + 1] = rgb[i + 1]; img.data[p + 2] = rgb[i + 2]; img.data[p + 3] = 255;
  }
  return img;
}

// Size a canvas for crisp drawing at device pixel ratio. Returns the cell size in device pixels.
export function fitCanvas(canvas, cssWidth, w = PANEL_W, h = PANEL_H) {
  const dpr = window.devicePixelRatio || 1;
  const cell = Math.max(1, Math.floor((cssWidth * dpr) / w));
  canvas.width = cell * w;
  canvas.height = cell * h;
  canvas.style.width = `${(cell * w) / dpr}px`;
  canvas.style.height = `${(cell * h) / dpr}px`;
  return cell;
}

export function drawPanel(canvas, rgb, { mode = 'led', shape = 'round', bloom = 0.7, w = PANEL_W, h = PANEL_H } = {}) {
  const ctx = canvas.getContext('2d');
  const cell = canvas.width / w;
  small.width = w; small.height = h;
  small.getContext('2d').putImageData(toImageData(rgb, w, h), 0, 0);

  if (mode === 'flat') {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    return;
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#050508';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Soft light spill: a bilinear upscale of the tiny image, drawn additively.
  if (bloom > 0) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = bloom * 0.55;
    ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = bloom * 0.35;
    const spread = cell * 0.9;
    ctx.drawImage(small, -spread, -spread, canvas.width + spread * 2, canvas.height + spread * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // Bead cores with a dark gap between them.
  const core = cell * (shape === 'round' ? 0.62 : 0.78), off = (cell - core) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3, r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
      const lum = Math.max(r, g, b);
      ctx.fillStyle = lum < 6 ? 'rgb(22,22,28)' : `rgb(${r},${g},${b})`;
      const px = x * cell + off, py = y * cell + off;
      ctx.beginPath();
      if (shape === 'round') ctx.arc(px + core / 2, py + core / 2, core / 2, 0, Math.PI * 2);
      else ctx.roundRect ? ctx.roundRect(px, py, core, core, core * 0.18) : ctx.rect(px, py, core, core);
      ctx.fill();
      if (lum >= 6) {
        // Hot centre: LEDs look whiter in the middle.
        ctx.fillStyle = `rgba(255,255,255,${(lum / 255) * 0.28})`;
        ctx.beginPath();
        ctx.arc(px + core / 2, py + core / 2, core * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// Flat RGB to a PNG-ready canvas at a given pixel scale.
export function panelToCanvas(rgb, scale = 1, opts = {}) {
  const c = document.createElement('canvas');
  c.width = PANEL_W * scale; c.height = PANEL_H * scale;
  if (opts.mode === 'led') drawPanel(c, rgb, opts);
  else {
    small.width = PANEL_W; small.height = PANEL_H;
    small.getContext('2d').putImageData(toImageData(rgb, PANEL_W, PANEL_H), 0, 0);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, c.width, c.height);
  }
  return c;
}

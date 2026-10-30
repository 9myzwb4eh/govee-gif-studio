// Pixel buffers, compositing, downscaling and transforms.
// Every layer cel is a straight-alpha RGBA Uint8ClampedArray at work resolution (100 x 130).

export const PANEL_W = 20;
export const PANEL_H = 26;
export const SCALE = 5;
export const WORK_W = PANEL_W * SCALE;
export const WORK_H = PANEL_H * SCALE;

export function newBuffer(w = WORK_W, h = WORK_H) {
  return new Uint8ClampedArray(w * h * 4);
}

export function isEmpty(buf) {
  for (let i = 3; i < buf.length; i += 4) if (buf[i]) return false;
  return true;
}

export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// Composite visible layers over black (an unlit LED). Returns Float32Array RGB, 0..255.
// layers: [{ buf, opacity (0..1), blend: 'normal' | 'add' | 'screen' }]
export function compositeLayers(layers, w = WORK_W, h = WORK_H) {
  const out = new Float32Array(w * h * 3);
  for (const L of layers) {
    if (!L.buf || L.opacity <= 0) continue;
    const src = L.buf, op = L.opacity;
    for (let p = 0, q = 0; p < src.length; p += 4, q += 3) {
      const a = (src[p + 3] / 255) * op;
      if (a <= 0) continue;
      const r = src[p], g = src[p + 1], b = src[p + 2];
      if (L.blend === 'add') {
        out[q] += r * a; out[q + 1] += g * a; out[q + 2] += b * a;
      } else if (L.blend === 'screen') {
        out[q] = 255 - ((255 - out[q]) * (255 - r * a)) / 255;
        out[q + 1] = 255 - ((255 - out[q + 1]) * (255 - g * a)) / 255;
        out[q + 2] = 255 - ((255 - out[q + 2]) * (255 - b * a)) / 255;
      } else {
        out[q] += (r - out[q]) * a; out[q + 1] += (g - out[q + 1]) * a; out[q + 2] += (b - out[q + 2]) * a;
      }
    }
  }
  for (let i = 0; i < out.length; i++) if (out[i] > 255) out[i] = 255;
  return out;
}

// Box / area average: every panel pixel is the mean of its s x s block of work cells.
export function downscale(rgb, w = WORK_W, h = WORK_H, s = SCALE) {
  const pw = Math.floor(w / s), ph = Math.floor(h / s), n = s * s;
  const out = new Float32Array(pw * ph * 3);
  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      let r = 0, g = 0, b = 0;
      for (let y = py * s; y < py * s + s; y++) {
        let q = (y * w + px * s) * 3;
        for (let x = 0; x < s; x++, q += 3) { r += rgb[q]; g += rgb[q + 1]; b += rgb[q + 2]; }
      }
      const o = (py * pw + px) * 3;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
    }
  }
  return out;
}

// Weighted RGB distance ("redmean"), cheap and close to perceptual.
export function colorDist(r1, g1, b1, r2, g2, b2) {
  const rm = (r1 + r2) / 2, dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

export function nearestColor(r, g, b, palette) {
  let best = palette[0], bd = Infinity;
  for (const p of palette) {
    const d = colorDist(r, g, b, p[0], p[1], p[2]);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// Pull every pixel toward its nearest palette color. strength 0 = untouched, 1 = fully snapped.
export function snapToPalette(rgb, palette, strength) {
  const out = new Uint8ClampedArray(rgb.length);
  if (!strength || !palette.length) { for (let i = 0; i < rgb.length; i++) out[i] = Math.round(rgb[i]); return out; }
  for (let i = 0; i < rgb.length; i += 3) {
    const p = nearestColor(rgb[i], rgb[i + 1], rgb[i + 2], palette);
    out[i] = Math.round(rgb[i] + (p[0] - rgb[i]) * strength);
    out[i + 1] = Math.round(rgb[i + 1] + (p[1] - rgb[i + 1]) * strength);
    out[i + 2] = Math.round(rgb[i + 2] + (p[2] - rgb[i + 2]) * strength);
  }
  return out;
}

export function countColors(rgb) {
  const set = new Set();
  for (let i = 0; i < rgb.length; i += 3) set.add((rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2]);
  return set.size;
}

// Brightness and saturation tweak applied at output time (LEDs wash out pale colors).
export function adjustOutput(rgb, { brightness = 1, saturation = 1, gamma = 1 } = {}) {
  if (brightness === 1 && saturation === 1 && gamma === 1) return rgb;
  const out = new Uint8ClampedArray(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    let r = rgb[i], g = rgb[i + 1], b = rgb[i + 2];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * saturation; g = l + (g - l) * saturation; b = l + (b - l) * saturation;
    out[i] = 255 * Math.pow(Math.max(0, r * brightness) / 255, gamma);
    out[i + 1] = 255 * Math.pow(Math.max(0, g * brightness) / 255, gamma);
    out[i + 2] = 255 * Math.pow(Math.max(0, b * brightness) / 255, gamma);
  }
  return out;
}

// The curtain drives each LED roughly linearly from the GIF value, while screens apply sRGB gamma,
// so a color that looks nearly black on a phone glows clearly on the curtain. This maps the
// on-screen look to LED drive values: gamma darkens dim tones, and anything under blackCut turns off.
export function ledEncode(rgb, { ledGamma = 2.4, blackCut = 6 } = {}) {
  const out = new Uint8ClampedArray(rgb.length);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const e = 255 * Math.pow(v / 255, ledGamma);
    lut[v] = e < blackCut ? 0 : Math.round(e);
  }
  for (let i = 0; i < rgb.length; i += 3) {
    // Keep hue: scale all channels by the brightest channel's correction instead of per channel,
    // so dim saturated colors don't drift (e.g. a dark orange turning red).
    const m = Math.max(rgb[i], rgb[i + 1], rgb[i + 2]);
    if (!m) continue;
    const k = lut[Math.round(m)] / m;
    if (!k) continue;
    out[i] = rgb[i] * k; out[i + 1] = rgb[i + 1] * k; out[i + 2] = rgb[i + 2] * k;
  }
  return out;
}

// Bilinear sample with premultiplied alpha so edges stay clean when content moves by fractions of a cell.
export function sample(buf, w, h, x, y, out) {
  x -= 0.5; y -= 0.5;
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (let j = 0; j < 2; j++) {
    const yy = y0 + j;
    if (yy < 0 || yy >= h) continue;
    const wy = j ? fy : 1 - fy;
    for (let i = 0; i < 2; i++) {
      const xx = x0 + i;
      if (xx < 0 || xx >= w) continue;
      const wgt = wy * (i ? fx : 1 - fx);
      const p = (yy * w + xx) * 4, al = buf[p + 3] * wgt;
      r += buf[p] * al; g += buf[p + 1] * al; b += buf[p + 2] * al; a += al;
    }
  }
  if (a > 0) { out[0] = r / a; out[1] = g / a; out[2] = b / a; } else { out[0] = out[1] = out[2] = 0; }
  out[3] = a;
  return out;
}

// Move / scale / rotate / fade a buffer. Offsets are in work cells and may be fractional.
export function transformBuffer(src, w, h, { dx = 0, dy = 0, scale = 1, rotate = 0, opacity = 1, cx = w / 2, cy = h / 2 } = {}) {
  const dst = new Uint8ClampedArray(src.length);
  const cos = Math.cos(-rotate), sin = Math.sin(-rotate), tmp = [0, 0, 0, 0];
  const sc = scale || 0.0001;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ux = (x + 0.5 - cx - dx) / sc, uy = (y + 0.5 - cy - dy) / sc;
      const sx = ux * cos - uy * sin + cx, sy = ux * sin + uy * cos + cy;
      sample(src, w, h, sx, sy, tmp);
      if (tmp[3] <= 0) continue;
      const p = (y * w + x) * 4;
      dst[p] = tmp[0]; dst[p + 1] = tmp[1]; dst[p + 2] = tmp[2]; dst[p + 3] = tmp[3] * opacity;
    }
  }
  return dst;
}

// Straight-alpha "source over" of b onto a, scaled by opacity. Writes into a.
export function blendOver(a, b, opacity = 1) {
  for (let p = 0; p < a.length; p += 4) {
    const sa = (b[p + 3] / 255) * opacity;
    if (sa <= 0) continue;
    const da = a[p + 3] / 255, oa = sa + da * (1 - sa);
    for (let c = 0; c < 3; c++) a[p + c] = (b[p + c] * sa + a[p + c] * da * (1 - sa)) / oa;
    a[p + 3] = oa * 255;
  }
  return a;
}

export function mixBuffers(a, b, t) {
  const out = new Uint8ClampedArray(a.length);
  for (let p = 0; p < a.length; p += 4) {
    const aa = a[p + 3] * (1 - t), ba = b[p + 3] * t, oa = aa + ba;
    if (oa <= 0) continue;
    for (let c = 0; c < 3; c++) out[p + c] = (a[p + c] * aa + b[p + c] * ba) / oa;
    out[p + 3] = oa;
  }
  return out;
}

// Premultiplied separable box blur, used for glow.
export function blurBuffer(src, w, h, radius) {
  const r = Math.max(1, Math.round(radius));
  let cur = new Float32Array(src.length);
  for (let p = 0; p < src.length; p += 4) {
    const a = src[p + 3] / 255;
    cur[p] = src[p] * a; cur[p + 1] = src[p + 1] * a; cur[p + 2] = src[p + 2] * a; cur[p + 3] = src[p + 3];
  }
  const pass = (input, horiz) => {
    const out = new Float32Array(input.length), span = 2 * r + 1;
    const len = horiz ? w : h, lines = horiz ? h : w;
    for (let l = 0; l < lines; l++) {
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        const idx = (i) => (horiz ? (l * w + i) : (i * w + l)) * 4 + c;
        for (let i = -r; i <= r; i++) acc += i >= 0 && i < len ? input[idx(i)] : 0;
        for (let i = 0; i < len; i++) {
          out[idx(i)] = acc / span;
          const add = i + r + 1, rem = i - r;
          if (add < len) acc += input[idx(add)];
          if (rem >= 0) acc -= input[idx(rem)];
        }
      }
    }
    return out;
  };
  for (let k = 0; k < 2; k++) { cur = pass(cur, true); cur = pass(cur, false); }
  const out = new Uint8ClampedArray(src.length);
  for (let p = 0; p < src.length; p += 4) {
    const a = cur[p + 3];
    if (a <= 0.5) continue;
    const k = 255 / a;
    out[p] = cur[p] * k; out[p + 1] = cur[p + 1] * k; out[p + 2] = cur[p + 2] * k; out[p + 3] = a;
  }
  return out;
}

// Resize an RGBA image into a target buffer. filter: 'nearest' | 'box'. fit: 'stretch' | 'fit' | 'crop'.
// focusX / focusY (0..1) choose which part of the source stays in view when cropping.
export function resizeInto(src, sw, sh, dw, dh, { filter = 'box', fit = 'fit', focusX = 0.5, focusY = 0.5 } = {}) {
  let rx = dw / sw, ry = dh / sh;
  if (fit === 'fit') rx = ry = Math.min(rx, ry);
  else if (fit === 'crop') rx = ry = Math.max(rx, ry);
  const ox = (dw - sw * rx) * focusX, oy = (dh - sh * ry) * focusY;
  const dst = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const x0 = (x - ox) / rx, x1 = (x + 1 - ox) / rx, y0 = (y - oy) / ry, y1 = (y + 1 - oy) / ry;
      if (x1 <= 0 || y1 <= 0 || x0 >= sw || y0 >= sh) continue;
      const d = (y * dw + x) * 4;
      if (filter === 'nearest') {
        const sx = Math.min(sw - 1, Math.floor((x0 + x1) / 2)), sy = Math.min(sh - 1, Math.floor((y0 + y1) / 2));
        if (sx < 0 || sy < 0) continue;
        const s = (sy * sw + sx) * 4;
        dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2]; dst[d + 3] = src[s + 3];
        continue;
      }
      // Area average over the covered source rectangle (handles both up- and down-scaling).
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      const sx0 = Math.max(0, Math.floor(x0)), sx1 = Math.min(sw, Math.ceil(x1));
      const sy0 = Math.max(0, Math.floor(y0)), sy1 = Math.min(sh, Math.ceil(y1));
      for (let sy = sy0; sy < sy1; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (wy <= 0) continue;
        for (let sx = sx0; sx < sx1; sx++) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (wx <= 0) continue;
          const wgt = wx * wy, s = (sy * sw + sx) * 4, al = src[s + 3] * wgt;
          r += src[s] * al; g += src[s + 1] * al; b += src[s + 2] * al; a += al; area += wgt;
        }
      }
      if (a > 0) { dst[d] = r / a; dst[d + 1] = g / a; dst[d + 2] = b / a; dst[d + 3] = a / ((x1 - x0) * (y1 - y0)); }
    }
  }
  return dst;
}

// Minimal GIF89a encoder and decoder. No dithering: dithering makes LEDs shimmer between frames.

// ---------- palette building ----------

// Median cut over weighted unique colors. Returns up to maxColors [r,g,b] entries.
export function medianCut(colors /* Map<int, count> */, maxColors = 256) {
  let boxes = [[...colors.entries()].map(([c, n]) => [(c >> 16) & 255, (c >> 8) & 255, c & 255, n])];
  const range = (box, ch) => { let lo = 255, hi = 0; for (const c of box) { if (c[ch] < lo) lo = c[ch]; if (c[ch] > hi) hi = c[ch]; } return hi - lo; };
  while (boxes.length < maxColors) {
    let bi = -1, bestScore = 0, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        const score = range(box, ch) * Math.sqrt(box.reduce((s, c) => s + c[3], 0));
        if (score > bestScore) { bestScore = score; bi = i; bestCh = ch; }
      }
    });
    if (bi < 0) break;
    const box = boxes[bi].sort((a, b) => a[bestCh] - b[bestCh]);
    const total = box.reduce((s, c) => s + c[3], 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += box[i][3]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.map((box) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (const c of box) { r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; n += c[3]; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
}

function histogram(rgbList) {
  const map = new Map();
  for (const rgb of rgbList) {
    for (let i = 0; i < rgb.length; i += 3) {
      const k = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
      map.set(k, (map.get(k) || 0) + 1);
    }
  }
  return map;
}

function buildPalette(rgbList) {
  const hist = histogram(rgbList);
  const exact = hist.size <= 256;
  const colors = exact ? [...hist.keys()].map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]) : medianCut(hist, 256);
  return { colors, exact };
}

function indexPixels(rgb, palette) {
  const lookup = new Map();
  palette.colors.forEach((c, i) => lookup.set((c[0] << 16) | (c[1] << 8) | c[2], i));
  const out = new Uint8Array(rgb.length / 3);
  for (let i = 0, p = 0; i < rgb.length; i += 3, p++) {
    const k = (rgb[i] << 16) | (rgb[i + 1] << 8) | rgb[i + 2];
    let idx = lookup.get(k);
    if (idx === undefined) {
      let bd = Infinity;
      palette.colors.forEach((c, j) => {
        const dr = c[0] - rgb[i], dg = c[1] - rgb[i + 1], db = c[2] - rgb[i + 2], d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < bd) { bd = d; idx = j; }
      });
      lookup.set(k, idx);
    }
    out[p] = idx;
  }
  return out;
}

// ---------- LZW ----------

function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1, dict = new Map();
  const out = [];
  let cur = 0, bits = 0;
  const emit = (code) => {
    cur |= code << bits; bits += codeSize;
    while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = prefix * 256 + k, hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    dict.set(key, next++);
    if (next > 1 << codeSize && codeSize < 12) codeSize++;
    if (next >= 4096) { emit(clear); dict = new Map(); codeSize = minCodeSize + 1; next = eoi + 1; }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return out;
}

function lzwDecode(data, minCodeSize, pixelCount) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  const out = new Uint8Array(pixelCount);
  let codeSize = minCodeSize + 1, next = eoi + 1;
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), len = new Int32Array(4096);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; len[i] = 1; }
  let prev = -1, pos = 0, cur = 0, bits = 0, di = 0;
  const writeCode = (code) => {
    const l = len[code];
    let p = pos + l - 1, c = code;
    while (c >= 0 && p >= pos) { if (p < pixelCount) out[p] = suffix[c]; p--; c = prefix[c]; }
    pos += l;
  };
  while (pos < pixelCount) {
    while (bits < codeSize && di < data.length) { cur |= data[di++] << bits; bits += 8; }
    if (bits < codeSize) break;
    const code = cur & ((1 << codeSize) - 1);
    cur >>>= codeSize; bits -= codeSize;
    if (code === clear) { codeSize = minCodeSize + 1; next = eoi + 1; prev = -1; continue; }
    if (code === eoi) break;
    if (prev === -1) { writeCode(code); prev = code; continue; }
    let firstChar;
    if (code < next) firstChar = first[code];
    else firstChar = first[prev]; // KwKwK case
    if (next < 4096) {
      prefix[next] = prev; suffix[next] = firstChar; first[next] = first[prev]; len[next] = len[prev] + 1;
      next++;
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    writeCode(code);
    prev = code;
  }
  return out;
}

// ---------- encoder ----------

class ByteWriter {
  constructor() { this.buf = new Uint8Array(4096); this.len = 0; }
  byte(b) { if (this.len >= this.buf.length) { const n = new Uint8Array(this.buf.length * 2); n.set(this.buf); this.buf = n; } this.buf[this.len++] = b & 255; }
  bytes(arr) { for (const b of arr) this.byte(b); }
  u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
  str(s) { for (const ch of s) this.byte(ch.charCodeAt(0)); }
  result() { return this.buf.slice(0, this.len); }
}

function tableBits(n) { let b = 1; while (1 << b < n) b++; return b; }

function writeTable(w, colors, bits) {
  for (let i = 0; i < 1 << bits; i++) { const c = colors[i] || [0, 0, 0]; w.byte(c[0]); w.byte(c[1]); w.byte(c[2]); }
}

// frames: [{ rgb: Uint8Array(w*h*3), delay: ms }]. loop: 0 = forever, n = repeat n extra times, null = play once.
export function encodeGIF(frames, width, height, { loop = 0 } = {}) {
  const w = new ByteWriter();
  w.str('GIF89a');
  w.u16(width); w.u16(height);

  // One shared table when every frame fits in 256 colors together (smaller, most compatible); else per-frame tables.
  const global = buildPalette(frames.map((f) => f.rgb));
  const useGlobal = global.exact;
  const gBits = useGlobal ? tableBits(global.colors.length) : 1;
  w.byte(0x80 | ((gBits - 1) << 4) | (gBits - 1));
  w.byte(0); w.byte(0);
  writeTable(w, useGlobal ? global.colors : [[0, 0, 0], [0, 0, 0]], gBits);

  if (loop !== null && frames.length > 1) {
    w.byte(0x21); w.byte(0xff); w.byte(11); w.str('NETSCAPE2.0');
    w.byte(3); w.byte(1); w.u16(loop); w.byte(0);
  }

  for (const f of frames) {
    const pal = useGlobal ? global : buildPalette([f.rgb]);
    const bits = tableBits(pal.colors.length);
    const idx = indexPixels(f.rgb, pal);
    // Graphic control extension: disposal 1 (leave in place), no transparency.
    w.byte(0x21); w.byte(0xf9); w.byte(4); w.byte(1 << 2);
    w.u16(Math.max(2, Math.round((f.delay || 100) / 10)));
    w.byte(0); w.byte(0);
    // Image descriptor
    w.byte(0x2c); w.u16(0); w.u16(0); w.u16(width); w.u16(height);
    w.byte(useGlobal ? 0 : 0x80 | (bits - 1));
    if (!useGlobal) writeTable(w, pal.colors, bits);
    const minCode = Math.max(2, useGlobal ? gBits : bits);
    w.byte(minCode);
    const data = lzwEncode(idx, minCode);
    for (let i = 0; i < data.length; i += 255) {
      const chunk = data.slice(i, i + 255);
      w.byte(chunk.length); w.bytes(chunk);
    }
    w.byte(0);
  }
  w.byte(0x3b);
  return w.result();
}

// ---------- decoder ----------

// Returns { width, height, loop, frames: [{ rgba: Uint8ClampedArray(w*h*4) fully composited, delay: ms }] }
export function decodeGIF(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let p = 0;
  const u8 = () => d[p++], u16 = () => { const v = d[p] | (d[p + 1] << 8); p += 2; return v; };
  const sig = String.fromCharCode(...d.slice(0, 6));
  if (!sig.startsWith('GIF')) throw new Error('Not a GIF file');
  p = 6;
  const width = u16(), height = u16(), flags = u8();
  const bgIndex = u8(); u8();
  let gct = null;
  if (flags & 0x80) { const n = 1 << ((flags & 7) + 1); gct = d.slice(p, p + n * 3); p += n * 3; }
  const canvas = new Uint8ClampedArray(width * height * 4);
  const frames = [];
  let gce = { delay: 100, transparent: -1, disposal: 0 }, loop = null;
  const readSub = () => { const parts = []; let n; while ((n = u8())) { parts.push(d.subarray(p, p + n)); p += n; } return parts; };
  while (p < d.length) {
    const block = u8();
    if (block === 0x3b) break;
    if (block === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        u8(); const f = u8(), delay = u16(), ti = u8(); u8();
        gce = { delay: delay * 10 || 100, transparent: f & 1 ? ti : -1, disposal: (f >> 2) & 7 };
      } else if (label === 0xff) {
        const parts = readSub();
        const id = parts[0] ? String.fromCharCode(...parts[0]) : '';
        if (id.startsWith('NETSCAPE') && parts[1] && parts[1][0] === 1) loop = parts[1][1] | (parts[1][2] << 8);
      } else readSub();
      continue;
    }
    if (block !== 0x2c) break;
    const fx = u16(), fy = u16(), fw = u16(), fh = u16(), ff = u8();
    let table = gct;
    if (ff & 0x80) { const n = 1 << ((ff & 7) + 1); table = d.slice(p, p + n * 3); p += n * 3; }
    const interlaced = !!(ff & 0x40);
    const minCode = u8();
    const parts = readSub();
    const total = parts.reduce((s, x) => s + x.length, 0), data = new Uint8Array(total);
    let o = 0; for (const x of parts) { data.set(x, o); o += x.length; }
    const idx = lzwDecode(data, minCode, fw * fh);
    const before = gce.disposal === 3 ? canvas.slice() : null;
    const rows = [];
    if (interlaced) { for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) for (let y = start; y < fh; y += step) rows.push(y); }
    else for (let y = 0; y < fh; y++) rows.push(y);
    rows.forEach((y, row) => {
      for (let x = 0; x < fw; x++) {
        const ci = idx[row * fw + x];
        if (ci === gce.transparent || !table) continue;
        const cx = fx + x, cy = fy + y;
        if (cx >= width || cy >= height) continue;
        const q = (cy * width + cx) * 4;
        canvas[q] = table[ci * 3]; canvas[q + 1] = table[ci * 3 + 1]; canvas[q + 2] = table[ci * 3 + 2]; canvas[q + 3] = 255;
      }
    });
    frames.push({ rgba: canvas.slice(), delay: gce.delay });
    if (gce.disposal === 2) {
      for (let y = fy; y < Math.min(height, fy + fh); y++) for (let x = fx; x < Math.min(width, fx + fw); x++) canvas.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 4);
    } else if (gce.disposal === 3 && before) canvas.set(before);
    gce = { delay: 100, transparent: -1, disposal: 0 };
  }
  void bgIndex;
  return { width, height, loop, frames };
}

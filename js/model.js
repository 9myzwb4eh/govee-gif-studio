// Project data model. Layers are shared by all frames; each frame holds one cel (pixel buffer) per layer.
// Cel buffers are treated as immutable once committed: edits replace the buffer, which makes undo snapshots cheap.

import {
  PANEL_W, PANEL_H, SCALE, WORK_W, WORK_H, newBuffer, isEmpty, hexToRgb,
  compositeLayers, downscale, snapToPalette, adjustOutput, ledEncode,
} from './raster.js';
import { DEFAULT_FONT } from './font.js';

export const MAX_LAYERS = 10;
export const LIMITS = { frames: 100, bytes: 500 * 1024 };
export const DEFAULT_PALETTE = ['#000000', '#3b1260', '#0f1838', '#ff6a00', '#ffd21f', '#3ddc4a', '#ffffff', '#e0102a'];

let uid = 0;
export const newId = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

export function createLayer(name = 'Layer') {
  return { id: newId('L'), name, visible: true, opacity: 1, blend: 'normal' };
}

export function createFrame(layers, duration = 80) {
  const cels = {};
  for (const l of layers) cels[l.id] = null;
  return { id: newId('F'), duration, hold: 0, cels };
}

export function createProject(name = 'Untitled') {
  const layers = [createLayer('Background'), createLayer('Layer 2')];
  return {
    app: 'govee-gif-studio',
    version: 1,
    name,
    width: PANEL_W,
    height: PANEL_H,
    scale: SCALE,
    palette: [...DEFAULT_PALETTE],
    snap: 0,
    output: { brightness: 1, saturation: 1, gamma: 1, ledGamma: 2.4, blackCut: 6 },
    loop: true,
    layers,
    frames: [createFrame(layers)],
    font: JSON.parse(JSON.stringify(DEFAULT_FONT)),
  };
}

export function frameTime(frame) {
  return (frame.duration || 0) + (frame.hold || 0);
}

export function totalTime(project) {
  return project.frames.reduce((s, f) => s + frameTime(f), 0);
}

export function getCel(frame, layerId) {
  return frame.cels[layerId] || null;
}

// Returns a writable buffer for the cel, replacing the stored one with a copy (copy on write).
export function writableCel(frame, layerId) {
  const old = frame.cels[layerId];
  const buf = old ? old.slice() : newBuffer();
  frame.cels[layerId] = buf;
  return buf;
}

export function compositeFrame(project, frame, { onlyLayer = null } = {}) {
  const list = [];
  for (const l of project.layers) {
    if (onlyLayer ? l.id !== onlyLayer : !l.visible) continue;
    const buf = frame.cels[l.id];
    if (buf) list.push({ buf, opacity: l.opacity, blend: l.blend });
  }
  return compositeLayers(list, WORK_W, WORK_H);
}

export function paletteRgb(project) {
  return project.palette.map(hexToRgb);
}

// The exact 20 x 26 RGB that the panel shows, as used by preview and export alike.
export function renderPanel(project, frame) {
  const work = compositeFrame(project, frame);
  const small = downscale(work, WORK_W, WORK_H, project.scale || SCALE);
  const snapped = snapToPalette(small, paletteRgb(project), project.snap || 0);
  return adjustOutput(snapped, project.output || {});
}

// What goes into the GIF: the panel output corrected for how LEDs show brightness (see ledEncode).
export function renderPanelForLeds(project, frame) {
  return ledEncode(renderPanel(project, frame), project.output || {});
}

// ---------- undo snapshots ----------

export function snapshot(project) {
  return {
    name: project.name,
    palette: [...project.palette],
    snap: project.snap,
    output: { ...project.output },
    loop: project.loop,
    font: project.font,
    layers: project.layers.map((l) => ({ ...l })),
    frames: project.frames.map((f) => ({ ...f, cels: { ...f.cels } })),
  };
}

export function restore(project, snap) {
  Object.assign(project, {
    name: snap.name,
    palette: [...snap.palette],
    snap: snap.snap,
    output: { ...snap.output },
    loop: snap.loop,
    font: snap.font,
    layers: snap.layers.map((l) => ({ ...l })),
    frames: snap.frames.map((f) => ({ ...f, cels: { ...f.cels } })),
  });
}

// ---------- serialization (compact run-length + base64) ----------

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(str) {
  const s = atob(str), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function encodeCel(buf) {
  if (!buf || isEmpty(buf)) return null;
  const out = [];
  const px = new Uint32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  for (let i = 0; i < px.length;) {
    let n = 1;
    const v = px[i] >>> 0 && buf[i * 4 + 3] ? px[i] : 0;
    while (i + n < px.length && n < 255 && (buf[(i + n) * 4 + 3] ? px[i + n] : 0) === v) n++;
    out.push(n);
    const p = i * 4;
    if (v) out.push(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]); else out.push(0, 0, 0, 0);
    i += n;
  }
  return toB64(new Uint8Array(out));
}

export function decodeCel(str) {
  if (!str) return null;
  const data = fromB64(str), buf = newBuffer();
  let p = 0;
  for (let i = 0; i < data.length; i += 5) {
    const n = data[i];
    for (let k = 0; k < n; k++, p += 4) { buf[p] = data[i + 1]; buf[p + 1] = data[i + 2]; buf[p + 2] = data[i + 3]; buf[p + 3] = data[i + 4]; }
  }
  return buf;
}

// Cels shared between frames (static backgrounds, held poses) are stored once in a pool.
export function serialize(project) {
  const pool = [], index = new Map();
  const ref = (buf) => {
    if (!buf) return null;
    if (index.has(buf)) return index.get(buf);
    const enc = encodeCel(buf);
    const n = enc ? pool.push(enc) - 1 : null;
    index.set(buf, n);
    return n;
  };
  return {
    app: 'govee-gif-studio',
    version: 1,
    name: project.name,
    width: project.width,
    height: project.height,
    scale: project.scale,
    palette: project.palette,
    snap: project.snap,
    output: project.output,
    loop: project.loop,
    font: project.font,
    layers: project.layers,
    pool,
    frames: project.frames.map((f) => ({
      id: f.id,
      duration: f.duration,
      hold: f.hold,
      cels: Object.fromEntries(Object.entries(f.cels).map(([k, v]) => [k, ref(v)]).filter(([, v]) => v !== null)),
    })),
  };
}

export function deserialize(data) {
  if (!data || data.app !== 'govee-gif-studio') throw new Error('This is not a Govee GIF Studio project file.');
  const base = createProject(data.name);
  const layers = (data.layers || []).slice(0, MAX_LAYERS).map((l) => ({ ...createLayer(l.name), ...l }));
  const pool = data.pool || [], decoded = new Map();
  const cel = (v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string') return decodeCel(v);
    if (!decoded.has(v)) decoded.set(v, decodeCel(pool[v]));
    return decoded.get(v);
  };
  const project = {
    ...base,
    name: data.name || 'Untitled',
    palette: data.palette?.length ? data.palette : base.palette,
    snap: data.snap ?? 0,
    output: { ...base.output, ...(data.output || {}) },
    loop: data.loop ?? true,
    font: data.font || base.font,
    layers: layers.length ? layers : base.layers,
    frames: (data.frames || []).map((f) => {
      const cels = {};
      for (const l of layers) cels[l.id] = cel(f.cels?.[l.id]);
      return { id: f.id || newId('F'), duration: f.duration || 80, hold: f.hold || 0, cels };
    }),
  };
  if (!project.frames.length) project.frames.push(createFrame(project.layers));
  return project;
}

export { PANEL_W, PANEL_H, SCALE, WORK_W, WORK_H };

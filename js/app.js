// UI wiring for Curtain GIF Studio.

import {
  createProject, createLayer, createFrame, writableCel, compositeFrame, renderPanel, snapshot, restore,
  serialize, deserialize, frameTime, totalTime, paletteRgb, MAX_LAYERS, DEFAULT_PALETTE, newId,
  WORK_W, WORK_H, PANEL_W, PANEL_H, SCALE, LIMITS,
} from './model.js';
import { hexToRgb, rgbToHex, newBuffer, downscale, countColors, blendOver, isEmpty } from './raster.js';
import { Stroke, drawRect, drawEllipse, drawLine, floodRegion, fillRegion, gradientBuffer } from './paint.js';
import { drawPanel, fitCanvas, panelToCanvas } from './led.js';
import { DEFAULT_FONT, layoutText } from './font.js';
import * as fx from './effects.js';
import { TEMPLATES } from './templates.js';
import { readImageFile, toCels, isVideoFile, openVideo, fetchClip } from './importer.js';
import { panelFrames, ledFrames, analyse, combineFrames, formatBytes, safeName, download, share, canShareFiles, framePNG, buildGIF } from './exporter.js';
import { sceneFromText, renderScene } from './scene.js';
import { aiScene, chatPrompt, parseSceneReply, AI_MODELS, getKey, setKey } from './ai.js';
import { saveAutosave, loadAutosave, saveToLibrary, listLibrary, deleteFromLibrary, getPref, setPref } from './storage.js';

const $ = (id) => document.getElementById(id);
const DPR = () => window.devicePixelRatio || 1;

const TOOLS = [
  { id: 'pencil', key: 'P', icon: 'i-pencil', name: 'Pencil' },
  { id: 'brush', key: 'B', icon: 'i-brush', name: 'Soft brush' },
  { id: 'eraser', key: 'E', icon: 'i-eraser', name: 'Eraser' },
  { id: 'fill', key: 'G', icon: 'i-fill', name: 'Fill bucket' },
  { sep: true },
  { id: 'line', key: 'L', icon: 'i-line', name: 'Line' },
  { id: 'rect', key: 'R', icon: 'i-rect', name: 'Rectangle' },
  { id: 'ellipse', key: 'O', icon: 'i-ellipse', name: 'Ellipse' },
  { id: 'gradient', key: 'D', icon: 'i-gradient', name: 'Gradient & glow' },
  { sep: true },
  { id: 'picker', key: 'I', icon: 'i-picker', name: 'Eyedropper' },
  { id: 'select', key: 'M', icon: 'i-select', name: 'Select & move' },
  { id: 'text', key: 'T', icon: 'i-text', name: 'Text' },
];

const state = {
  tool: 'brush',
  primary: '#ff6a00',
  secondary: '#000000',
  brush: { size: 10, hardness: 0.55, opacity: 1 },
  pencil: { opacity: 1 },
  eraser: { size: 10, hardness: 0.6, opacity: 1 },
  shape: { filled: false, size: 3, hardness: 1 },
  fill: { tolerance: 8 },
  gradient: { radial: true, toTransparent: true, opacity: 1 },
  mirrorX: false,
  mirrorY: false,
  grid: true,
  panelView: false,
  onion: { on: false, before: 1, after: 1, opacity: 0.3 },
  loop: true,
  previewMode: 'led',
  frameIndex: 0,
  layerId: null,
  selection: null,
  playing: false,
  dirty: false,
};

let project = createProject();
state.layerId = project.layers[project.layers.length - 1].id;
const history = { undo: [], redo: [] };
let clipboard = null;

const cur = {
  get frame() { return project.frames[state.frameIndex]; },
  get layer() { return project.layers.find((l) => l.id === state.layerId) || project.layers[0]; },
};

// ---------- toast ----------

let toastTimer;
function toast(msg, error = false) {
  const t = $('toast');
  // An open dialog sits in the browser's top layer, above everything else, so the message has to
  // live inside the dialog to be seen.
  const dlg = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
  if (t.parentElement !== dlg) dlg.appendChild(t);
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), error ? 7000 : 2600);
}

function guard(fn) {
  return (...args) => {
    try { const r = fn(...args); if (r && r.catch) r.catch((e) => toast(e.message || String(e), true)); return r; } catch (e) { console.error(e); toast(e.message || String(e), true); }
  };
}

// ---------- history ----------

function checkpoint() {
  history.undo.push({ snap: snapshot(project), frameIndex: state.frameIndex, layerId: state.layerId });
  history.redo.length = 0;
  markDirty();
  updateUndoButtons();
}

function undo() {
  const h = history.undo.pop();
  if (!h) return;
  history.redo.push({ snap: snapshot(project), frameIndex: state.frameIndex, layerId: state.layerId });
  applyHistory(h);
}

function redo() {
  const h = history.redo.pop();
  if (!h) return;
  history.undo.push({ snap: snapshot(project), frameIndex: state.frameIndex, layerId: state.layerId });
  applyHistory(h);
}

function applyHistory(h) {
  restore(project, h.snap);
  state.frameIndex = Math.min(h.frameIndex, project.frames.length - 1);
  state.layerId = project.layers.some((l) => l.id === h.layerId) ? h.layerId : project.layers[0].id;
  markDirty();
  renderAll();
}

function updateUndoButtons() {
  $('undoBtn').disabled = $('undoBtnM').disabled = !history.undo.length;
  $('redoBtn').disabled = $('redoBtnM').disabled = !history.redo.length;
}

// ---------- panel output cache ----------

const celIds = new WeakMap();
let celCounter = 0;
const celId = (b) => { if (!b) return 0; if (!celIds.has(b)) celIds.set(b, ++celCounter); return celIds.get(b); };
const panelCache = new WeakMap();

function projectSig() {
  return `${project.snap}|${project.palette.join()}|${JSON.stringify(project.output)}|${project.layers.map((l) => `${l.id}${l.visible ? 1 : 0}${l.opacity}${l.blend}`).join()}`;
}

function panelFor(frame, force = false) {
  const sig = projectSig() + '|' + project.layers.map((l) => celId(frame.cels[l.id])).join();
  const hit = panelCache.get(frame);
  if (!force && hit && hit.sig === sig) return hit.rgb;
  const rgb = renderPanel(project, frame);
  panelCache.set(frame, { sig, rgb });
  return rgb;
}

// ---------- rendering ----------

const work = $('work');
const workCtx = work.getContext('2d');
const scratch = document.createElement('canvas');
scratch.width = WORK_W; scratch.height = WORK_H;
const scratchCtx = scratch.getContext('2d');
let cellPx = 4;
let hover = null;

function layoutWork() {
  const box = work.parentElement.getBoundingClientRect();
  const pad = window.innerWidth <= 860 ? 12 : 28;
  const fit = Math.min((box.width - pad) / WORK_W, (box.height - pad) / WORK_H);
  cellPx = Math.max(1, Math.floor(fit * DPR()));
  work.width = WORK_W * cellPx;
  work.height = WORK_H * cellPx;
  work.style.width = `${work.width / DPR()}px`;
  work.style.height = `${work.height / DPR()}px`;
  renderWork();
}

function rgbToImageData(rgb, w, h, ctx) {
  const img = ctx.createImageData(w, h);
  for (let i = 0, p = 0; i < rgb.length; i += 3, p += 4) {
    img.data[p] = rgb[i]; img.data[p + 1] = rgb[i + 1]; img.data[p + 2] = rgb[i + 2]; img.data[p + 3] = 255;
  }
  return img;
}

function drawOnion(frame, tint, alpha) {
  const rgb = compositeFrame(project, frame);
  const img = scratchCtx.createImageData(WORK_W, WORK_H);
  for (let i = 0, p = 0; i < rgb.length; i += 3, p += 4) {
    const l = Math.max(rgb[i], rgb[i + 1], rgb[i + 2]);
    img.data[p] = tint[0]; img.data[p + 1] = tint[1]; img.data[p + 2] = tint[2]; img.data[p + 3] = l;
  }
  scratchCtx.putImageData(img, 0, 0);
  workCtx.globalAlpha = alpha;
  workCtx.drawImage(scratch, 0, 0, work.width, work.height);
  workCtx.globalAlpha = 1;
}

function renderWork() {
  const frame = cur.frame;
  workCtx.imageSmoothingEnabled = false;
  if (state.panelView) {
    const small = document.createElement('canvas');
    small.width = PANEL_W; small.height = PANEL_H;
    const sctx = small.getContext('2d');
    sctx.putImageData(rgbToImageData(panelFor(frame, true), PANEL_W, PANEL_H, sctx), 0, 0);
    workCtx.drawImage(small, 0, 0, work.width, work.height);
  } else {
    const rgb = compositeFrame(project, frame);
    scratchCtx.putImageData(rgbToImageData(rgb, WORK_W, WORK_H, scratchCtx), 0, 0);
    workCtx.drawImage(scratch, 0, 0, work.width, work.height);
  }

  if (state.onion.on && !state.playing) {
    const n = project.frames.length;
    for (let k = state.onion.before; k >= 1; k--) {
      const i = state.frameIndex - k;
      const f = project.frames[state.loop ? (i + n) % n : i];
      if (f && f !== frame) drawOnion(f, [255, 80, 120], state.onion.opacity / k);
    }
    for (let k = state.onion.after; k >= 1; k--) {
      const i = state.frameIndex + k;
      const f = project.frames[state.loop ? i % n : i];
      if (f && f !== frame) drawOnion(f, [80, 220, 160], state.onion.opacity / k);
    }
  }

  if (state.grid) {
    workCtx.strokeStyle = 'rgba(255,255,255,0.075)';
    workCtx.lineWidth = 1;
    workCtx.beginPath();
    for (let x = SCALE; x < WORK_W; x += SCALE) { const px = x * cellPx + 0.5; workCtx.moveTo(px, 0); workCtx.lineTo(px, work.height); }
    for (let y = SCALE; y < WORK_H; y += SCALE) { const py = y * cellPx + 0.5; workCtx.moveTo(0, py); workCtx.lineTo(work.width, py); }
    workCtx.stroke();
  }
  if (state.mirrorX || state.mirrorY) {
    workCtx.strokeStyle = 'rgba(176,107,255,0.55)';
    workCtx.setLineDash([4 * DPR(), 4 * DPR()]);
    workCtx.beginPath();
    if (state.mirrorX) { workCtx.moveTo(work.width / 2, 0); workCtx.lineTo(work.width / 2, work.height); }
    if (state.mirrorY) { workCtx.moveTo(0, work.height / 2); workCtx.lineTo(work.width, work.height / 2); }
    workCtx.stroke();
    workCtx.setLineDash([]);
  }
  const sel = state.selection;
  if (sel) {
    workCtx.lineWidth = Math.max(1, DPR());
    workCtx.setLineDash([5 * DPR(), 4 * DPR()]);
    workCtx.strokeStyle = '#fff';
    workCtx.strokeRect(sel.x * cellPx + 0.5, sel.y * cellPx + 0.5, sel.w * cellPx - 1, sel.h * cellPx - 1);
    workCtx.lineDashOffset = 5 * DPR();
    workCtx.strokeStyle = '#000';
    workCtx.strokeRect(sel.x * cellPx + 0.5, sel.y * cellPx + 0.5, sel.w * cellPx - 1, sel.h * cellPx - 1);
    workCtx.setLineDash([]);
    workCtx.lineDashOffset = 0;
  }
  if (hover && ['brush', 'eraser'].includes(state.tool) && !drag) {
    const size = state[state.tool].size;
    workCtx.strokeStyle = 'rgba(255,255,255,0.7)';
    workCtx.lineWidth = DPR();
    workCtx.beginPath();
    workCtx.arc(hover[0] * cellPx, hover[1] * cellPx, Math.max(1, (size / 2) * cellPx), 0, Math.PI * 2);
    workCtx.stroke();
  }
}

let previewCell = 0;
function renderPreview() {
  const rgb = panelFor(cur.frame, !!drag);
  const pv = $('preview');
  const width = Math.min(260, $('preview').parentElement.clientWidth - 20 || 220);
  if (previewCell !== width) { fitCanvas(pv, width); previewCell = width; }
  drawPanel(pv, rgb, { mode: state.previewMode });
  const pip = $('pipCanvas');
  const pipW = pipLarge ? 150 : 64;
  if (pip.dataset.w !== String(pipW)) { fitCanvas(pip, pipW); pip.dataset.w = pipW; }
  drawPanel(pip, rgb, { mode: state.previewMode, bloom: pipLarge ? 0.7 : 0.4 });
  $('previewInfo').textContent = `20 × 26 · frame ${state.frameIndex + 1}/${project.frames.length}`;
  const n = countColors(rgb), pal = project.palette.length, warn = $('colorWarn');
  if (n > pal) {
    warn.hidden = false;
    warn.textContent = `${n} colors · palette holds ${pal}`;
    warn.title = project.snap >= 1
      ? 'Brightness or color richness settings are adding colors.'
      : `This frame shows ${n} different colors and your palette has ${pal}. That's fine for smooth art. Raise "Snap to palette" to force palette colors only.`;
  } else warn.hidden = true;
}

function thumbInto(canvas, rgb) {
  canvas.width = PANEL_W; canvas.height = PANEL_H;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(rgbToImageData(rgb, PANEL_W, PANEL_H, ctx), 0, 0);
}

let frameEls = [];
function renderTimeline() {
  const strip = $('frames');
  strip.textContent = '';
  frameEls = project.frames.map((f, i) => {
    const el = document.createElement('div');
    el.className = 'frame' + (i === state.frameIndex ? ' on' : '') + (f.hold ? ' hold' : '');
    el.dataset.index = i;
    const c = document.createElement('canvas');
    thumbInto(c, panelFor(f));
    const num = document.createElement('div');
    num.className = 'fnum';
    num.innerHTML = `<span class="grip" title="Drag to reorder">⋮⋮ ${i + 1}</span><span>${frameTime(f)}</span>`;
    el.append(c, num);
    strip.appendChild(el);
    return el;
  });
  const on = frameEls[state.frameIndex];
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  renderFrameProps();
}

function renderCurrentThumb() {
  const el = frameEls[state.frameIndex];
  if (el) thumbInto(el.querySelector('canvas'), panelFor(cur.frame, !!drag));
}

function selectFrameEl() {
  frameEls.forEach((el, i) => el.classList.toggle('on', i === state.frameIndex));
  const on = frameEls[state.frameIndex];
  if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  renderFrameProps();
}

function renderFrameProps() {
  const f = cur.frame;
  $('frameDuration').value = f.duration;
  $('frameHold').value = f.hold || 0;
  const total = totalTime(project);
  $('tlStats').textContent = `${project.frames.length} frames · ${(total / 1000).toFixed(2)} s`;
}

function renderLayers() {
  const ul = $('layers');
  ul.textContent = '';
  [...project.layers].reverse().forEach((l) => {
    const li = document.createElement('li');
    li.className = 'layer' + (l.id === state.layerId ? ' on' : '') + (l.visible ? '' : ' hidden-layer');
    li.dataset.id = l.id;
    const vis = document.createElement('button');
    vis.className = 'vis';
    vis.title = l.visible ? 'Hide layer' : 'Show layer';
    vis.innerHTML = `<svg><use href="#${l.visible ? 'i-eye' : 'i-eye-off'}"/></svg>`;
    vis.onclick = (e) => { e.stopPropagation(); checkpoint(); l.visible = !l.visible; renderAll(); };
    const c = document.createElement('canvas');
    const cel = cur.frame.cels[l.id];
    if (cel) {
      const rgb = downscale(compositeFrame(project, cur.frame, { onlyLayer: l.id }));
      thumbInto(c, Uint8ClampedArray.from(rgb));
    } else { c.width = PANEL_W; c.height = PANEL_H; }
    const name = document.createElement('span');
    name.className = 'lname';
    name.textContent = l.name;
    name.title = 'Double-click to rename';
    name.ondblclick = () => renameLayer(l, name);
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${l.blend !== 'normal' ? l.blend + ' · ' : ''}${Math.round(l.opacity * 100)}%`;
    li.append(vis, c, name, meta);
    li.onclick = () => { state.layerId = l.id; renderLayers(); };
    ul.appendChild(li);
  });
  $('layerCount').textContent = `${project.layers.length}/${MAX_LAYERS}`;
  const L = cur.layer;
  $('layerOpacity').value = Math.round(L.opacity * 100);
  $('layerOpacityOut').textContent = `${Math.round(L.opacity * 100)}%`;
  $('layerBlend').value = L.blend;
  $('layerAdd').disabled = $('layerDup').disabled = project.layers.length >= MAX_LAYERS;
  $('layerDel').disabled = project.layers.length <= 1;
}

function renameLayer(l, el) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = l.name;
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();
  const done = () => {
    const v = input.value.trim();
    if (v && v !== l.name) { checkpoint(); l.name = v; }
    renderLayers();
  };
  input.onblur = done;
  input.onkeydown = (e) => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = l.name; input.blur(); } e.stopPropagation(); };
}

function renderPalette() {
  const box = $('palette');
  box.textContent = '';
  project.palette.forEach((hex, i) => {
    const b = document.createElement('button');
    b.className = 'pal' + (hex.toLowerCase() === state.primary.toLowerCase() ? ' on' : '');
    b.style.background = hex;
    b.title = `${hex}: click to use, right-click or long-press to edit${i < 9 ? ` (key ${i + 1})` : ''}`;
    if (i < 9) b.innerHTML = `<span>${i + 1}</span>`;
    b.onclick = () => setPrimary(hex);
    b.oncontextmenu = (e) => { e.preventDefault(); editSwatch(i); };
    let pressTimer;
    b.addEventListener('touchstart', () => { pressTimer = setTimeout(() => editSwatch(i), 550); }, { passive: true });
    b.addEventListener('touchend', () => clearTimeout(pressTimer));
    b.addEventListener('touchmove', () => clearTimeout(pressTimer));
    box.appendChild(b);
  });
  $('primary').value = state.primary;
  $('secondary').value = state.secondary;
  $('primarySw').style.background = state.primary;
  $('secondarySw').style.background = state.secondary;
  $('snap').value = Math.round(project.snap * 100);
  $('snapOut').textContent = `${Math.round(project.snap * 100)}%`;
}

function editSwatch(i) {
  const ed = $('swatchEditor');
  ed.value = project.palette[i];
  ed.oninput = () => { project.palette[i] = ed.value; renderPalette(); renderPreview(); };
  ed.onchange = () => { markDirty(); renderAll(); };
  checkpoint();
  ed.click();
}

function setPrimary(hex) {
  state.primary = hex;
  renderPalette();
}

function renderToolbar() {
  const rail = $('toolrail');
  rail.textContent = '';
  for (const t of TOOLS) {
    if (t.sep) { const s = document.createElement('div'); s.className = 'rail-sep'; rail.appendChild(s); continue; }
    const b = document.createElement('button');
    b.className = 'tool' + (state.tool === t.id ? ' on' : '');
    b.title = `${t.name} (${t.key})`;
    b.innerHTML = `<svg><use href="#${t.icon}"/></svg><kbd>${t.key}</kbd>`;
    b.onclick = () => setTool(t.id);
    rail.appendChild(b);
  }
  $('mirrorX').classList.toggle('on', state.mirrorX);
  $('mirrorY').classList.toggle('on', state.mirrorY);
  $('gridToggle').classList.toggle('on', state.grid);
  $('panelView').classList.toggle('on', state.panelView);
}

function slider(label, min, max, value, fmt, oninput, step = 1) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const id = 'opt' + Math.random().toString(36).slice(2);
  wrap.innerHTML = `<label for="${id}">${label} <output>${fmt(value)}</output></label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">`;
  const input = wrap.querySelector('input'), out = wrap.querySelector('output');
  input.oninput = () => { const v = Number(input.value); out.textContent = fmt(v); oninput(v); };
  return wrap;
}

function checkbox(label, checked, onchange) {
  const l = document.createElement('label');
  l.className = 'check';
  l.innerHTML = `<input type="checkbox" ${checked ? 'checked' : ''}> ${label}`;
  l.querySelector('input').onchange = (e) => onchange(e.target.checked);
  return l;
}

function button(label, onclick, cls = 'btn tiny ghost') {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.onclick = guard(onclick);
  return b;
}

function hintP(text) {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  return p;
}

const pct = (v) => `${Math.round(v * 100)}%`;
const cellsFmt = (v) => `${v} cells · ${(v / SCALE).toFixed(1)} LED`;

function renderToolOptions() {
  const box = $('toolOptions');
  box.textContent = '';
  const t = TOOLS.find((x) => x.id === state.tool);
  $('optTitle').textContent = t.name;
  const s = state;
  switch (s.tool) {
    case 'pencil':
      box.append(hintP('Hard single cells. Five cells across make one LED.'), slider('Opacity', 0.05, 1, s.pencil.opacity, pct, (v) => (s.pencil.opacity = v), 0.05));
      break;
    case 'brush':
    case 'eraser': {
      const o = s[s.tool];
      box.append(
        slider('Size', 1, 40, o.size, cellsFmt, (v) => { o.size = v; renderWork(); }),
        slider('Softness', 0, 1, 1 - o.hardness, pct, (v) => (o.hardness = 1 - v), 0.05),
        slider(s.tool === 'brush' ? 'Opacity' : 'Strength', 0.05, 1, o.opacity, pct, (v) => (o.opacity = v), 0.05),
      );
      const presets = document.createElement('div');
      presets.className = 'row-btns';
      [['Fine', 3, 1], ['1 LED', 5, 0.7], ['Soft 2', 10, 0.4], ['Glow', 24, 0], ['Huge', 40, 0.2]].forEach(([n, size, hard]) =>
        presets.append(button(n, () => { o.size = size; o.hardness = hard; renderToolOptions(); })));
      box.append(presets, hintP('Right-click paints with the secondary color. Soft edges become partly lit LEDs.'));
      break;
    }
    case 'fill':
      box.append(slider('Tolerance', 0, 100, s.fill.tolerance, (v) => v, (v) => (s.fill.tolerance = v)), hintP('Fills the touching area of the current layer that has a similar color.'));
      break;
    case 'line':
    case 'rect':
    case 'ellipse':
      box.append(
        slider('Line width', 1, 30, s.shape.size, cellsFmt, (v) => (s.shape.size = v)),
        slider('Softness', 0, 1, 1 - s.shape.hardness, pct, (v) => (s.shape.hardness = 1 - v), 0.05),
      );
      if (s.tool !== 'line') box.append(checkbox('Filled', s.shape.filled, (v) => (s.shape.filled = v)));
      box.append(hintP('Hold Shift for a perfect square, circle or 45° line.'));
      break;
    case 'gradient':
      box.append(
        checkbox('Radial (glow from the centre)', s.gradient.radial, (v) => (s.gradient.radial = v)),
        checkbox('Fade to transparent', s.gradient.toTransparent, (v) => (s.gradient.toTransparent = v)),
        slider('Opacity', 0.05, 1, s.gradient.opacity, pct, (v) => (s.gradient.opacity = v), 0.05),
        hintP('Drag from the centre outwards. Radial + transparent makes a soft glow. Linear primary → secondary makes a sky.'),
      );
      break;
    case 'picker':
      box.append(hintP('Click to take the color you see. Alt-click does this with any tool.'));
      break;
    case 'select': {
      box.append(hintP('Drag to select. Drag inside the selection to move it. Arrow keys nudge it one cell, or one LED with Shift.'));
      const r1 = document.createElement('div');
      r1.className = 'row-btns';
      r1.append(
        button('Select all', selectAll), button('Deselect', () => { state.selection = null; renderWork(); }),
        button('Flip ↔', () => flipSelection(true)), button('Flip ↕', () => flipSelection(false)),
        button('Copy', copySelection), button('Paste', pasteSelection), button('Clear', clearSelection),
      );
      box.append(r1);
      break;
    }
    case 'text':
      box.append(hintP('Click the canvas where the text should start, or open the text options.'), button('Text options…', () => openEffects('text'), 'btn tiny'));
      break;
  }
}

function renderAll() {
  renderToolbar();
  renderToolOptions();
  renderPalette();
  renderLayers();
  renderTimeline();
  renderWork();
  renderPreview();
  updateUndoButtons();
  $('projectName').value = project.name;
}

function renderFrameChange() {
  renderWork();
  renderPreview();
  renderLayers();
  selectFrameEl();
}

function setTool(id) {
  state.tool = id;
  renderToolbar();
  renderToolOptions();
  renderWork();
  if (window.innerWidth <= 860 && id !== 'text') setSheet('tools');
}

// ---------- drawing ----------

let drag = null;

function cellAt(e) {
  const r = work.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * WORK_W, ((e.clientY - r.top) / r.height) * WORK_H];
}

function strokeColor(e) {
  return hexToRgb(e.button === 2 || e.buttons === 2 ? state.secondary : state.primary);
}

function constrain(a, b, tool) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (tool === 'line') {
    const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4), len = Math.hypot(dx, dy);
    return [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len];
  }
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return [a[0] + Math.sign(dx || 1) * m, a[1] + Math.sign(dy || 1) * m];
}

function pickColor(pt) {
  const x = Math.floor(pt[0]), y = Math.floor(pt[1]);
  if (x < 0 || y < 0 || x >= WORK_W || y >= WORK_H) return;
  const rgb = compositeFrame(project, cur.frame), i = (y * WORK_W + x) * 3;
  setPrimary(rgbToHex(rgb[i], rgb[i + 1], rgb[i + 2]));
}

function inSel(pt) {
  const s = state.selection;
  return s && pt[0] >= s.x && pt[1] >= s.y && pt[0] < s.x + s.w && pt[1] < s.y + s.h;
}

function layerReady() {
  if (!cur.layer.visible) { toast('This layer is hidden. Show it to draw on it.', true); return false; }
  return true;
}

function onPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button === 1) return;
  e.preventDefault();
  if (state.playing) stopPlayback();
  const pt = cellAt(e);
  work.setPointerCapture(e.pointerId);
  const tool = e.altKey ? 'picker' : state.tool;

  if (tool === 'picker') { pickColor(pt); drag = { tool: 'picker' }; return; }
  if (tool === 'text') { openEffects('text', { x: Math.floor(pt[0] / SCALE), y: Math.floor(pt[1] / SCALE) }); return; }
  if (tool === 'select') {
    if (inSel(pt)) {
      if (!layerReady()) return;
      checkpoint();
      const base = cur.frame.cels[state.layerId] || newBuffer();
      const s = state.selection;
      drag = { tool: 'move', start: pt, piece: cropBuf(base, s), cleared: clearBuf(base, s), sel0: { ...s } };
    } else {
      drag = { tool: 'select', start: pt };
      state.selection = null;
    }
    return;
  }
  if (!layerReady()) return;
  checkpoint();
  const buf = writableCel(cur.frame, state.layerId);
  const opts = { color: strokeColor(e), mirrorX: state.mirrorX, mirrorY: state.mirrorY, clip: state.selection };
  if (tool === 'eraser') Object.assign(opts, { erase: true, opacity: state.eraser.opacity });
  else if (tool === 'brush') opts.opacity = state.brush.opacity;
  else if (tool === 'pencil') opts.opacity = state.pencil.opacity;
  const stroke = new Stroke(buf, opts);
  drag = { tool, stroke, start: pt, last: pt, base: buf.slice() };
  if (tool === 'pencil') stroke.pixelLine(pt[0], pt[1], pt[0], pt[1]);
  else if (tool === 'brush' || tool === 'eraser') stroke.dab(pt[0], pt[1], state[tool].size, state[tool].hardness);
  else if (tool === 'fill') {
    for (const [px, py] of stroke.points(pt[0], pt[1])) fillRegion(stroke, floodRegion(drag.base, Math.floor(px), Math.floor(py), state.fill.tolerance));
  }
  drawTick();
}

function onPointerMove(e) {
  const pt = cellAt(e);
  hover = pt;
  const inside = pt[0] >= 0 && pt[1] >= 0 && pt[0] < WORK_W && pt[1] < WORK_H;
  $('coords').textContent = inside ? `cell ${Math.floor(pt[0])},${Math.floor(pt[1])} · LED ${Math.floor(pt[0] / SCALE) + 1},${Math.floor(pt[1] / SCALE) + 1}` : '';
  if (!drag) { if (['brush', 'eraser'].includes(state.tool)) renderWork(); return; }
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  const d = drag;
  switch (d.tool) {
    case 'picker': pickColor(pt); return;
    case 'pencil':
      for (const ev of events) { const p = cellAt(ev); d.stroke.pixelLine(d.last[0], d.last[1], p[0], p[1]); d.last = p; }
      break;
    case 'brush':
    case 'eraser': {
      const o = state[d.tool];
      for (const ev of events) { const p = cellAt(ev); d.stroke.segment(d.last[0], d.last[1], p[0], p[1], o.size, o.hardness); d.last = p; }
      break;
    }
    case 'line':
    case 'rect':
    case 'ellipse': {
      const b = e.shiftKey ? constrain(d.start, pt, d.tool) : pt;
      d.stroke.reset();
      const o = { filled: state.shape.filled, size: state.shape.size, hardness: state.shape.hardness };
      if (d.tool === 'line') drawLine(d.stroke, d.start, b, o);
      else if (d.tool === 'rect') drawRect(d.stroke, d.start, b, o);
      else drawEllipse(d.stroke, d.start, b, o);
      break;
    }
    case 'gradient': {
      const g = state.gradient;
      const grad = gradientBuffer(d.start, pt, { colorA: hexToRgb(state.primary), colorB: hexToRgb(state.secondary), radial: g.radial, toTransparent: g.toTransparent, clip: state.selection });
      const out = blendOver(d.base.slice(), grad, g.opacity);
      d.stroke.target.set(out);
      break;
    }
    case 'select': {
      const x0 = Math.max(0, Math.floor(Math.min(d.start[0], pt[0]))), y0 = Math.max(0, Math.floor(Math.min(d.start[1], pt[1])));
      const x1 = Math.min(WORK_W, Math.ceil(Math.max(d.start[0], pt[0]))), y1 = Math.min(WORK_H, Math.ceil(Math.max(d.start[1], pt[1])));
      state.selection = x1 - x0 >= 1 && y1 - y0 >= 1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
      renderWork();
      return;
    }
    case 'move': {
      const dx = Math.round(pt[0] - d.start[0]), dy = Math.round(pt[1] - d.start[1]);
      moveTo(d, dx, dy);
      break;
    }
    default: return;
  }
  drawTick();
}

function moveTo(d, dx, dy) {
  const out = d.cleared.slice();
  pasteShifted(out, d.piece, dx, dy);
  cur.frame.cels[state.layerId] = isEmpty(out) ? null : out;
  state.selection = { ...d.sel0, x: d.sel0.x + dx, y: d.sel0.y + dy };
}

function onPointerUp() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.tool === 'picker' || d.tool === 'select') { renderPalette(); renderWork(); return; }
  const cel = cur.frame.cels[state.layerId];
  if (cel && isEmpty(cel)) cur.frame.cels[state.layerId] = null;
  renderWork();
  renderPreview();
  renderCurrentThumb();
  renderLayers();
}

let tickPending = false;
function drawTick() {
  if (tickPending) return;
  tickPending = true;
  requestAnimationFrame(() => {
    tickPending = false;
    renderWork();
    renderPreview();
    renderCurrentThumb();
  });
}

// ---------- selection helpers ----------

function cropBuf(buf, s) {
  const out = newBuffer();
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
    if (x < 0 || y < 0 || x >= WORK_W || y >= WORK_H) continue;
    const p = (y * WORK_W + x) * 4;
    out[p] = buf[p]; out[p + 1] = buf[p + 1]; out[p + 2] = buf[p + 2]; out[p + 3] = buf[p + 3];
  }
  return out;
}

function clearBuf(buf, s) {
  const out = buf.slice();
  for (let y = Math.max(0, s.y); y < Math.min(WORK_H, s.y + s.h); y++) out.fill(0, (y * WORK_W + Math.max(0, s.x)) * 4, (y * WORK_W + Math.min(WORK_W, s.x + s.w)) * 4);
  return out;
}

function pasteShifted(dst, src, dx, dy) {
  const shifted = newBuffer();
  for (let y = 0; y < WORK_H; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= WORK_H) continue;
    for (let x = 0; x < WORK_W; x++) {
      const sx = x - dx;
      if (sx < 0 || sx >= WORK_W) continue;
      const s = (sy * WORK_W + sx) * 4, d = (y * WORK_W + x) * 4;
      shifted[d] = src[s]; shifted[d + 1] = src[s + 1]; shifted[d + 2] = src[s + 2]; shifted[d + 3] = src[s + 3];
    }
  }
  blendOver(dst, shifted);
}

function selectAll() {
  state.selection = { x: 0, y: 0, w: WORK_W, h: WORK_H };
  if (state.tool !== 'select') setTool('select');
  renderWork();
}

function nudge(dx, dy) {
  if (!state.selection) selectAll();
  checkpoint();
  const base = cur.frame.cels[state.layerId] || newBuffer();
  const d = { piece: cropBuf(base, state.selection), cleared: clearBuf(base, state.selection), sel0: { ...state.selection } };
  moveTo(d, dx, dy);
  renderWork(); renderPreview(); renderCurrentThumb();
}

function flipSelection(horizontal) {
  const s = state.selection || { x: 0, y: 0, w: WORK_W, h: WORK_H };
  const base = cur.frame.cels[state.layerId];
  if (!base) return;
  checkpoint();
  const out = base.slice();
  for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) {
    const sx = horizontal ? s.x + s.w - 1 - (x - s.x) : x, sy = horizontal ? y : s.y + s.h - 1 - (y - s.y);
    const d = (y * WORK_W + x) * 4, p = (sy * WORK_W + sx) * 4;
    for (let c = 0; c < 4; c++) out[d + c] = base[p + c];
  }
  cur.frame.cels[state.layerId] = out;
  renderFrameChange(); renderCurrentThumb();
}

function copySelection() {
  const base = cur.frame.cels[state.layerId];
  if (!base) { toast('Nothing on this layer to copy.'); return; }
  const s = state.selection || { x: 0, y: 0, w: WORK_W, h: WORK_H };
  clipboard = { buf: cropBuf(base, s), sel: { ...s } };
  toast('Copied');
}

function pasteSelection() {
  if (!clipboard) { toast('Copy something first.'); return; }
  if (!layerReady()) return;
  checkpoint();
  const out = cur.frame.cels[state.layerId] ? cur.frame.cels[state.layerId].slice() : newBuffer();
  blendOver(out, clipboard.buf);
  cur.frame.cels[state.layerId] = out;
  state.selection = { ...clipboard.sel };
  if (state.tool !== 'select') setTool('select');
  renderFrameChange(); renderCurrentThumb();
}

function clearSelection() {
  const base = cur.frame.cels[state.layerId];
  if (!base) return;
  checkpoint();
  const out = state.selection ? clearBuf(base, state.selection) : newBuffer();
  cur.frame.cels[state.layerId] = isEmpty(out) ? null : out;
  renderFrameChange(); renderCurrentThumb();
}

// ---------- frames ----------

function goFrame(i) {
  const n = project.frames.length;
  state.frameIndex = ((i % n) + n) % n;
  renderFrameChange();
}

function addFrame(duplicate = false) {
  checkpoint();
  const src = cur.frame;
  const f = createFrame(project.layers, src.duration);
  if (duplicate) { f.cels = { ...src.cels }; f.hold = src.hold; }
  else {
    // A new frame keeps static layers (backgrounds) by sharing cels that are identical in the previous two frames.
    const prev = project.frames[state.frameIndex - 1];
    for (const l of project.layers) if (prev && prev.cels[l.id] && prev.cels[l.id] === src.cels[l.id]) f.cels[l.id] = src.cels[l.id];
  }
  project.frames.splice(state.frameIndex + 1, 0, f);
  state.frameIndex++;
  renderAll();
}

function deleteFrame() {
  if (project.frames.length <= 1) { checkpoint(); for (const l of project.layers) cur.frame.cels[l.id] = null; renderAll(); return; }
  checkpoint();
  project.frames.splice(state.frameIndex, 1);
  state.frameIndex = Math.min(state.frameIndex, project.frames.length - 1);
  renderAll();
}

function moveFrame(from, to) {
  if (to < 0 || to >= project.frames.length || from === to) return;
  checkpoint();
  const [f] = project.frames.splice(from, 1);
  project.frames.splice(to, 0, f);
  state.frameIndex = to;
  renderAll();
}

// Drag to reorder on the frame number ("grip"), click anywhere to select.
function setupTimelineDrag() {
  const strip = $('frames');
  let d = null;
  strip.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.frame');
    if (!el) return;
    const i = Number(el.dataset.index);
    if (state.playing) stopPlayback();
    if (i !== state.frameIndex) { state.frameIndex = i; renderFrameChange(); }
    if (e.target.closest('.grip') || e.pointerType === 'mouse') d = { from: i, x: e.clientX, active: false, el, id: e.pointerId };
  });
  strip.addEventListener('pointermove', (e) => {
    if (!d) return;
    if (!d.active && Math.abs(e.clientX - d.x) > 8) { d.active = true; d.el.classList.add('dragging'); strip.setPointerCapture(d.id); }
    if (!d.active) return;
    e.preventDefault();
    frameEls.forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    const target = dropTarget(e.clientX);
    if (target) frameEls[target.index]?.classList.add(target.after ? 'drop-after' : 'drop-before');
    const r = strip.getBoundingClientRect();
    if (e.clientX < r.left + 30) strip.scrollLeft -= 8; else if (e.clientX > r.right - 30) strip.scrollLeft += 8;
  });
  const end = (e) => {
    if (!d) return;
    const was = d;
    d = null;
    frameEls.forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging'));
    if (!was.active) return;
    const t = dropTarget(e.clientX);
    if (!t) return;
    let to = t.index + (t.after ? 1 : 0);
    if (to > was.from) to--;
    moveFrame(was.from, to);
  };
  strip.addEventListener('pointerup', end);
  strip.addEventListener('pointercancel', () => { d = null; frameEls.forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging')); });
}

function dropTarget(x) {
  for (let i = 0; i < frameEls.length; i++) {
    const r = frameEls[i].getBoundingClientRect();
    if (x < r.right) return { index: i, after: x > r.left + r.width / 2 };
  }
  return frameEls.length ? { index: frameEls.length - 1, after: true } : null;
}

// ---------- playback ----------

let playTimer = null;
function play() {
  if (project.frames.length < 2) { toast('Add a second frame to play an animation.'); return; }
  state.playing = true;
  $('playBtn').innerHTML = '<svg><use href="#i-pause"/></svg>';
  const tick = () => {
    if (!state.playing) return;
    const f = cur.frame;
    playTimer = setTimeout(() => {
      if (state.frameIndex === project.frames.length - 1 && !state.loop) { stopPlayback(); return; }
      state.frameIndex = (state.frameIndex + 1) % project.frames.length;
      renderWork();
      renderPreview();
      selectFrameEl();
      tick();
    }, Math.max(20, frameTime(f)));
  };
  tick();
}

function stopPlayback() {
  state.playing = false;
  clearTimeout(playTimer);
  $('playBtn').innerHTML = '<svg><use href="#i-play"/></svg>';
  renderFrameChange();
}

// ---------- layers ----------

function addLayer(dup = false) {
  if (project.layers.length >= MAX_LAYERS) { toast(`The panel supports ${MAX_LAYERS} layers at most.`, true); return; }
  checkpoint();
  const src = cur.layer;
  const l = dup ? { ...src, id: newId('L'), name: `${src.name} copy` } : createLayer(`Layer ${project.layers.length + 1}`);
  const idx = project.layers.indexOf(src);
  project.layers.splice(idx + 1, 0, l);
  for (const f of project.frames) f.cels[l.id] = dup ? f.cels[src.id] : null;
  state.layerId = l.id;
  renderAll();
}

function deleteLayer() {
  if (project.layers.length <= 1) return;
  checkpoint();
  const idx = project.layers.indexOf(cur.layer);
  const [gone] = project.layers.splice(idx, 1);
  for (const f of project.frames) delete f.cels[gone.id];
  state.layerId = project.layers[Math.max(0, idx - 1)].id;
  renderAll();
}

function moveLayer(dir) {
  const idx = project.layers.indexOf(cur.layer), to = idx + dir;
  if (to < 0 || to >= project.layers.length) return;
  checkpoint();
  const [l] = project.layers.splice(idx, 1);
  project.layers.splice(to, 0, l);
  renderAll();
}

function mergeDown() {
  const idx = project.layers.indexOf(cur.layer);
  if (idx <= 0) { toast('There is no layer below to merge into.'); return; }
  checkpoint();
  const top = project.layers[idx], below = project.layers[idx - 1];
  const done = new Map();
  for (const f of project.frames) {
    const a = f.cels[below.id], b = f.cels[top.id];
    const key = `${celId(a)}:${celId(b)}`;
    if (!done.has(key)) {
      let out = null;
      if (b && top.visible) {
        out = a ? a.slice() : newBuffer();
        if (top.blend === 'normal') blendOver(out, b, top.opacity);
        else {
          for (let p = 0; p < out.length; p += 4) {
            const sa = (b[p + 3] / 255) * top.opacity;
            if (sa <= 0) continue;
            const da = out[p + 3] / 255;
            for (let c = 0; c < 3; c++) {
              const lower = out[p + c] * da;
              out[p + c] = top.blend === 'add' ? Math.min(255, lower + b[p + c] * sa) : 255 - ((255 - lower) * (255 - b[p + c] * sa)) / 255;
            }
            out[p + 3] = 255 * Math.max(da, Math.min(1, da + sa));
            if (out[p + 3] > 0) for (let c = 0; c < 3; c++) out[p + c] = Math.min(255, (out[p + c] * 255) / out[p + 3]);
          }
        }
      } else out = a;
      done.set(key, out);
    }
    f.cels[below.id] = done.get(key);
    delete f.cels[top.id];
  }
  project.layers.splice(idx, 1);
  state.layerId = below.id;
  renderAll();
}

function layerToAllFrames() {
  checkpoint();
  const cel = cur.frame.cels[state.layerId];
  for (const f of project.frames) f.cels[state.layerId] = cel;
  renderAll();
  toast(`"${cur.layer.name}" now matches this frame in all ${project.frames.length} frames.`);
}

// ---------- project lifecycle ----------

function setProject(p, { keepHistory = true } = {}) {
  if (keepHistory) checkpoint();
  else { history.undo.length = 0; history.redo.length = 0; }
  project = p;
  state.frameIndex = 0;
  state.layerId = project.layers[project.layers.length - 1].id;
  state.selection = null;
  markDirty();
  renderAll();
}

let saveTimer;
function markDirty() {
  state.dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autosaveNow, 1200);
}

async function autosaveNow() {
  if (!state.dirty) return;
  state.dirty = false;
  try { await saveAutosave(serialize(project)); } catch (e) { console.warn('Autosave failed', e); }
}

// ---------- dialogs ----------

function openDlg(id) {
  const d = $(id);
  if (!d.open) d.showModal();
  if (id === 'templatesDlg') renderTemplates();
  if (id === 'exportDlg') renderExport();
  if (id === 'projectsDlg') renderProjects();
  if (id === 'paletteDlg') renderPaletteDlg();
  if (id === 'combineDlg') renderCombine();
  if (id === 'createDlg') renderCreate();
  return d;
}

document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDlg(b.dataset.open)));
// Tapping outside a dialog closes it, but only when the tap started outside too: selecting text and
// releasing past the edge must not close it. The Create dialog closes only with its × button.
document.querySelectorAll('dialog').forEach((d) => {
  if (d.id === 'createDlg') return;
  let downOutside = false;
  d.addEventListener('pointerdown', (e) => { downOutside = e.target === d; });
  d.addEventListener('click', (e) => { if (e.target === d && downOutside) d.close(); downOutside = false; });
});

// Templates
let tplAnim = null;
const tplCache = new Map();
function renderTemplates() {
  const grid = $('tplGrid');
  if (!grid.children.length) {
    for (const t of TEMPLATES) {
      const b = document.createElement('button');
      b.className = 'tpl';
      b.innerHTML = `<canvas></canvas><span>${t.name}</span>`;
      b.onclick = guard(() => {
        const p = t.build();
        $('templatesDlg').close();
        setProject(p);
        toast(`${t.name} loaded. Everything is editable, and Undo brings back your previous project.`);
      });
      grid.appendChild(b);
    }
  }
  const canvases = [...grid.querySelectorAll('canvas')];
  // Build previews one per animation frame so the dialog opens immediately.
  TEMPLATES.forEach((t, k) => {
    if (tplCache.has(t.id)) return;
    setTimeout(() => { const p = t.build(); tplCache.set(t.id, panelFrames(p)); }, 30 + k * 40);
  });
  let tick = 0;
  clearInterval(tplAnim);
  tplAnim = setInterval(() => {
    if (!$('templatesDlg').open) { clearInterval(tplAnim); return; }
    tick++;
    TEMPLATES.forEach((t, k) => {
      const frames = tplCache.get(t.id);
      if (!frames) return;
      const c = canvases[k];
      if (!c.dataset.fit) { fitCanvas(c, 110); c.dataset.fit = 1; }
      drawPanel(c, frames[tick % frames.length].rgb, { mode: 'led', bloom: 0.6 });
    });
  }, 70);
}

// Create from a description
const CR_EXAMPLES = [
  'Christmas',
  'Happy Diwali',
  'New Year fireworks',
  'Eid Mubarak',
  'Easter',
  'birthday "SAM"',
  'Halloween',
  'three ghosts flying',
  'Lunar New Year',
  'Hanukkah',
  'Holi',
  'snowman with snow, "LET IT SNOW"',
];
let crProject = null;
let crAnim = null;
let crAbort = null;

function renderCreate() {
  const ex = $('crExamples');
  if (!ex.children.length) {
    for (const e of CR_EXAMPLES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = e;
      b.onclick = () => { $('crPrompt').value = e; crBuild(); };
      ex.appendChild(b);
    }
    const sel = $('crModel');
    for (const m of AI_MODELS) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; sel.appendChild(o); }
    sel.value = getPref('aiModel', AI_MODELS[0].id);
  }
  $('crKey').value = getKey();
  $('crAiSettings').open = !getKey();
  showCreated(crProject);
  setTimeout(() => $('crPrompt').focus(), 50);
}

function showCreated(p, understood = null, note = '') {
  crProject = p;
  $('crUse').disabled = !p;
  const box = $('crUnderstood');
  if (understood) {
    box.textContent = '';
    for (const u of understood) { const s = document.createElement('span'); s.textContent = u; box.appendChild(s); }
  }
  clearTimeout(crAnim);
  const c = $('crPreview');
  fitCanvas(c, window.innerWidth <= 860 ? 130 : 150);
  if (!p) { drawPanel(c, new Uint8ClampedArray(PANEL_W * PANEL_H * 3), { mode: 'led' }); $('crInfo').textContent = note; return; }
  const frames = panelFrames(p);
  $('crInfo').textContent = note || `${frames.length} frames · ${(frames.reduce((a, f) => a + f.delay, 0) / 1000).toFixed(1)} s`;
  let i = 0;
  const step = () => {
    if (!$('createDlg').open) return;
    const f = frames[i++ % frames.length];
    drawPanel(c, f.rgb, { mode: 'led' });
    crAnim = setTimeout(step, Math.max(20, f.delay));
  };
  step();
}

let crVersion = 0, crLastText = '';
const crBuild = guard((again = false) => {
  const text = $('crPrompt').value.trim();
  if (!text) { toast('Type a description first.'); return; }
  crVersion = again === true && text === crLastText ? crVersion + 1 : 0;
  crLastText = text;
  const { scene, understood } = sceneFromText(text, { version: crVersion });
  const p = renderScene(scene);
  showCreated(p, understood, crVersion ? `Version ${crVersion + 1} · ${p.frames.length} frames` : '');
});
$('crAgain').onclick = () => crBuild(true);

$('crBuild').onclick = () => crBuild();
$('crPrompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); crBuild(); } });
$('crKey').onchange = () => setKey($('crKey').value.trim());
$('crModel').onchange = () => setPref('aiModel', $('crModel').value);
$('crForget').onclick = () => { setKey(''); $('crKey').value = ''; toast('API key removed from this browser.'); };

$('crAi').onclick = guard(async () => {
  const text = $('crPrompt').value.trim();
  if (!text) { toast('Type a description first.'); return; }
  const key = $('crKey').value.trim() || getKey();
  if (!key) { $('crAiSettings').open = true; $('crKey').focus(); toast('Paste your Anthropic API key in AI settings first.'); return; }
  setKey(key);
  if (crAbort) crAbort.abort();
  crAbort = new AbortController();
  const btn = $('crAi');
  btn.disabled = true;
  btn.lastChild.textContent = 'Thinking…';
  showCreated(null, [], 'Claude is designing your animation…');
  try {
    const { scene } = await aiScene(text, { apiKey: key, model: $('crModel').value, signal: crAbort.signal });
    const p = renderScene(scene);
    const kinds = [...new Set((scene.elements || []).map((e) => (e.type === 'text' ? `text "${e.text}"` : e.type)))];
    showCreated(p, kinds, `AI scene · ${p.frames.length} frames`);
  } catch (e) {
    if (e.name !== 'AbortError') { showCreated(null, [], ''); throw e; }
  } finally {
    btn.disabled = false;
    btn.lastChild.textContent = 'Build with AI';
  }
});

$('crCopy').onclick = guard(async () => {
  const text = $('crPrompt').value.trim();
  if (!text) { toast('Describe the animation first, then copy the prompt.'); $('crPrompt').focus(); return; }
  const prompt = chatPrompt(text);
  try { await navigator.clipboard.writeText(prompt); } catch {
    // Older browsers: copy through a hidden text box.
    const ta = document.createElement('textarea'); ta.value = prompt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  toast('Prompt copied. Paste it into a new chat, then paste the reply back here.');
});

const crFromReply = guard(() => {
  const reply = $('crReply').value.trim();
  if (!reply) { toast("Paste the AI's reply first."); return; }
  const scene = parseSceneReply(reply);
  const p = renderScene(scene);
  const kinds = [...new Set((scene.elements || []).map((e) => (e.type === 'text' ? `text "${e.text}"` : e.type)))];
  showCreated(p, kinds, `From your AI chat · ${p.frames.length} frames`);
});
$('crFromReply').onclick = crFromReply;
$('crReply').addEventListener('paste', () => setTimeout(() => { if ($('crReply').value.includes('}')) crFromReply(); }, 50));

$('crUse').onclick = () => {
  if (!crProject) return;
  const p = crProject;
  crProject = null;
  $('createDlg').close();
  setProject(p);
  toast('Opened in the editor. Every part is a normal layer you can edit, and Undo brings back your previous project.');
};

// Effects
function openEffects(tab, opts = {}) {
  openDlg('effectsDlg');
  setFxTab(tab);
  if (tab === 'text' && opts.x !== undefined) { $('txX').value = opts.x; $('txY').value = opts.y; renderTextPreview(); }
}

function setFxTab(tab) {
  document.querySelectorAll('#fxTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.fx-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === tab));
  const n = project.frames.length, i = state.frameIndex + 1;
  if (tab === 'tween') { $('twStart').value = i; $('twEnd').value = Math.min(n, i + 1); $('twStart').max = $('twEnd').max = n; }
  if (tab === 'fade') { $('fdStart').value = 1; $('fdEnd').value = n; }
  if (tab === 'text') renderTextPreview();
}

$('fxTabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setFxTab(b.dataset.tab); });

const num = (id, d = 0) => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : d; };

function runFx(fn, msg) {
  return guard(() => {
    checkpoint();
    try { fn(); } catch (e) { history.undo.pop(); throw e; }
    $('effectsDlg').close();
    renderAll();
    if (msg) toast(typeof msg === 'function' ? msg() : msg);
  });
}

let lastFxCount = 0;
$('twGo').onclick = runFx(() => {
  const n = project.frames.length;
  const a = Math.max(1, Math.min(n, num('twStart', 1))) - 1, b = Math.max(1, Math.min(n, num('twEnd', 2))) - 1;
  lastFxCount = fx.tween(project, {
    layerId: state.layerId, startIndex: a, endIndex: b, steps: Math.max(1, Math.min(60, num('twSteps', 6))),
    mode: $('twMode').value, easing: $('twEase').value, selection: state.selection, auto: $('twAuto').checked,
    dx: num('twDx') * SCALE, dy: num('twDy') * SCALE, scale: num('twScale', 1), rotate: num('twRot'),
    opacityFrom: num('twOpA', 1), opacityTo: num('twOpB', 1),
  });
}, () => `Added ${lastFxCount} in-between frames.`);

$('tkGo').onclick = runFx(() => {
  const colors = $('tkColors').value.split(',').map((s) => s.trim()).filter((s) => /^#?[0-9a-f]{6}$/i.test(s)).map((s) => (s[0] === '#' ? s : '#' + s));
  fx.twinkle(project, { density: num('tkDensity', 10) / 100, speed: num('tkSpeed', 1), frames: num('tkFrames', 24), seed: num('tkSeed', 7), colors: colors.length ? colors : undefined });
}, 'Twinkling stars added on the "Stars" layer.');

$('txGo').onclick = runFx(() => {
  const blankX = $('txX').value === '', blankY = $('txY').value === '';
  const r = fx.text(project, {
    value: $('txValue').value || 'BOO', color: $('txColor').value, scroll: $('txScroll').value, speed: num('txSpeed', 0.5),
    x: blankX ? null : num('txX'), y: blankY ? null : num('txY'), frameIndex: state.frameIndex,
  });
  state.layerId = r.layer.id;
}, 'Text added.');

$('glGo').onclick = runFx(() => {
  const l = fx.glow(project, { layerId: state.layerId, radius: num('glRadius', 6), strength: num('glStrength', 80) / 100 });
  void l;
}, 'Glow layer added. Adjust its opacity in Layers.');

$('trGo').onclick = runFx(() => fx.trail(project, { layerId: state.layerId, length: num('trLen', 3), decay: num('trDecay', 50) / 100 }), 'Trail layer added below the current layer.');

$('frGo').onclick = runFx(() => {
  const l = fx.fire(project, { height: num('frHeight', 45) / 100, intensity: num('frIntensity', 100) / 100, frames: num('frFrames', 24) });
  state.layerId = l.id;
}, 'Fire added.');

$('fdGo').onclick = runFx(() => fx.fadeLayer(project, { layerId: state.layerId, start: num('fdStart', 1) - 1, end: num('fdEnd', 1) - 1, from: num('fdFrom', 0), to: num('fdTo', 1) }), 'Fade applied.');

['txValue', 'txColor', 'txX', 'txY'].forEach((id) => $(id).addEventListener('input', renderTextPreview));

function renderTextPreview() {
  const layout = layoutText($('txValue').value || ' ', project.font);
  const rgb = new Uint8ClampedArray(PANEL_W * PANEL_H * 3);
  const col = hexToRgb($('txColor').value);
  const ox = $('txX').value === '' ? Math.floor((PANEL_W - layout.width) / 2) : num('txX');
  const oy = $('txY').value === '' ? Math.floor((PANEL_H - layout.height) / 2) : num('txY');
  for (const [x, y] of layout.cells) {
    const px = x + ox, py = y + oy;
    if (px < 0 || py < 0 || px >= PANEL_W || py >= PANEL_H) continue;
    rgb.set(col, (py * PANEL_W + px) * 3);
  }
  const c = $('txPreview');
  fitCanvas(c, 120);
  drawPanel(c, rgb, { mode: 'led' });
}

// Font editor
let fontChar = 'A';
$('fontEdit').onclick = () => { $('fontDlg').showModal(); renderFont(); };
function renderFont() {
  const chars = $('fontChars');
  chars.textContent = '';
  for (const ch of Object.keys(project.font)) {
    const b = document.createElement('button');
    b.textContent = ch === ' ' ? '␣' : ch;
    b.className = ch === fontChar ? 'on' : '';
    b.onclick = () => { fontChar = ch; renderFont(); };
    chars.appendChild(b);
  }
  const grid = $('fontGrid');
  grid.textContent = '';
  const g = project.font[fontChar];
  g.forEach((row, y) => [...row].forEach((c, x) => {
    const b = document.createElement('button');
    b.className = c === '#' ? 'on' : '';
    b.onclick = () => {
      checkpoint();
      const font = JSON.parse(JSON.stringify(project.font));
      const r = [...font[fontChar][y]];
      r[x] = r[x] === '#' ? '.' : '#';
      font[fontChar][y] = r.join('');
      project.font = font;
      renderFont();
      renderTextPreview();
    };
    grid.appendChild(b);
  }));
}
$('fontReset').onclick = () => { checkpoint(); project.font = JSON.parse(JSON.stringify(DEFAULT_FONT)); renderFont(); renderTextPreview(); };

// Import
let pendingImport = null;
$('importBtn').onclick = () => openDlg('importSrcDlg');
$('srcFile').onclick = () => { $('importSrcDlg').close(); $('fileInput').click(); };
$('srcGo').onclick = guard(async () => {
  const link = $('srcUrl').value.trim();
  if (!link) { toast('Paste a link first.'); return; }
  $('srcGo').disabled = true; $('srcGo').textContent = 'Downloading…';
  try {
    const file = await fetchClip(link);
    $('importSrcDlg').close();
    await handleFile(file);
  } finally { $('srcGo').disabled = false; $('srcGo').textContent = 'Get clip'; }
});
$('srcUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('srcGo').click(); } });
$('fileInput').onchange = guard(async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await handleFile(file);
});

async function handleFile(file) {
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    const data = JSON.parse(await file.text());
    setProject(deserialize(data));
    $('projectsDlg').open && $('projectsDlg').close();
    toast(`Opened "${project.name}".`);
    return;
  }
  closePendingVideo();
  const name = file.name || 'Pasted image';
  if (isVideoFile(file)) {
    toast('Opening video…');
    const video = await openVideo(file);
    pendingImport = { video, image: null, name };
    const sel = $('impStart'); sel.textContent = '';
    const step = video.duration > 30 ? 1 : 0.5;
    for (let t = 0; t < Math.max(step, video.duration - 0.5) && sel.options.length < 120; t += step) sel.add(new Option(`${t.toFixed(1)} s`, t));
    $('impVideo').hidden = false;
    $('impTitle').textContent = 'Import video';
    $('impFit').value = 'crop';
    $('impLook').checked = true;
    $('impDelays').checked = true;
    $('impBg').checked = true; $('impBgStrengthRow').hidden = false;
    openDlg('importDlg');
    await extractVideo();
    return;
  }
  const image = await readImageFile(file);
  pendingImport = { image, name };
  $('impVideo').hidden = true;
  $('impTitle').textContent = 'Import image';
  // Photos get the curtain look by default; drawn art (PNG, GIF) is usually made for the curtain already.
  $('impLook').checked = /jpe?g|heic|webp/i.test(file.type || file.name || '');
  $('impBg').checked = false; $('impBgStrengthRow').hidden = true;
  openDlg('importDlg');
  renderImportPreview();
}

function closePendingVideo() {
  if (pendingImport?.video) pendingImport.video.close();
}

let extractRun = 0;
async function extractVideo() {
  const pi = pendingImport;
  if (!pi?.video) return;
  const run = ++extractRun;
  const fps = +$('impFps').value, len = +$('impLen').value, start = +$('impStart').value || 0;
  $('impGo').disabled = true;
  try {
    const image = await pi.video.frames(start, len, fps, (i, n) => { if (run === extractRun) $('impInfo').textContent = `Reading frames ${i} / ${n}…`; });
    if (run !== extractRun || pendingImport !== pi) return;
    pi.image = image;
    renderImportPreview();
  } finally { if (run === extractRun) $('impGo').disabled = false; }
}

let impAnim = null;
function importOptions(extra = {}) {
  return { fit: $('impFit').value, filter: $('impFilter').value, blackTransparent: $('impBlack').checked, focusX: num('impFocus', 50) / 100, curtainLook: $('impLook').checked, removeBg: $('impBg').checked ? num('impBgStrength', 5) : 0, ...extra };
}

function renderImportPreview() {
  clearTimeout(impAnim);
  if (!pendingImport?.image) return;
  const { image, name } = pendingImport;
  // Preview up to 40 frames so long clips stay quick to adjust.
  const every = Math.max(1, Math.ceil(image.frames.length / 40));
  const sample = { ...image, frames: image.frames.filter((_, k) => k % every === 0) };
  const frames = toCels(sample, importOptions()).map(({ cel, delay }) => ({ rgb: Uint8ClampedArray.from(downscale(compositeLayersSingle(cel || newBuffer()))), delay: delay * every }));
  const c = $('impPreview');
  fitCanvas(c, 80);
  let i = 0;
  const step = () => {
    if (!$('importDlg').open) return;
    const f = frames[i++ % frames.length];
    drawPanel(c, f.rgb, { mode: 'led' });
    if (frames.length > 1) impAnim = setTimeout(step, Math.max(20, f.delay || 100));
  };
  step();
  const kind = pendingImport.video ? 'video clip' : `${image.width} × ${image.height}`;
  $('impInfo').textContent = `${name}: ${kind}, ${image.frames.length} frame${image.frames.length > 1 ? 's' : ''}`;
}

function compositeLayersSingle(cel) {
  const out = new Float32Array(WORK_W * WORK_H * 3);
  for (let p = 0, q = 0; p < cel.length; p += 4, q += 3) { const a = cel[p + 3] / 255; out[q] = cel[p] * a; out[q + 1] = cel[p + 1] * a; out[q + 2] = cel[p + 2] * a; }
  return out;
}

['impFit', 'impFilter', 'impBlack', 'impLook'].forEach((id) => $(id).addEventListener('change', renderImportPreview));
$('impFocus').addEventListener('input', renderImportPreview);
$('impBg').addEventListener('change', () => { $('impBgStrengthRow').hidden = !$('impBg').checked; renderImportPreview(); });
$('impBgStrength').addEventListener('change', renderImportPreview);
['impStart', 'impLen', 'impFps'].forEach((id) => $(id).addEventListener('change', guard(extractVideo)));
$('importDlg').addEventListener('close', () => { clearTimeout(impAnim); if (pendingImport?.video) { closePendingVideo(); pendingImport = null; } });

$('impGo').onclick = guard(() => {
  if (!pendingImport) return;
  const { image, name } = pendingImport;
  if (!image) return;
  const cels = toCels(image, importOptions({ maxFrames: 200 }));
  const useDelays = $('impDelays').checked && image.frames.length > 1;
  const target = $('impTarget').value;
  if (target === 'newProject') {
    const p = createProject(name.replace(/\.\w+$/, ''));
    p.layers = [createLayer('Imported')];
    p.frames = cels.map(({ cel, delay }) => { const f = createFrame(p.layers, useDelays ? delay : 80); f.cels[p.layers[0].id] = cel; return f; });
    setProject(p);
  } else {
    checkpoint();
    let layer = cur.layer;
    if (target === 'newLayer') {
      if (project.layers.length >= MAX_LAYERS) { history.undo.pop(); throw new Error(`The panel supports ${MAX_LAYERS} layers. Import into the current layer instead.`); }
      layer = createLayer(`Imported ${project.layers.length + 1}`);
      project.layers.push(layer);
      for (const f of project.frames) f.cels[layer.id] = null;
    }
    const start = state.frameIndex;
    fx.ensureFrames(project, start + cels.length);
    cels.forEach(({ cel, delay }, k) => {
      const f = project.frames[start + k];
      f.cels[layer.id] = cel;
      if (useDelays) f.duration = delay;
    });
    state.layerId = layer.id;
    renderAll();
  }
  $('importDlg').close();
  toast(`Imported ${cels.length} frame${cels.length > 1 ? 's' : ''}.`);
  pendingImport = null;
});

document.addEventListener('paste', guard(async (e) => {
  if (e.target.matches?.('input, textarea')) return;
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) { e.preventDefault(); await handleFile(item.getAsFile()); return; }
  if (clipboard) { e.preventDefault(); pasteSelection(); }
}));

// Export
let expAnim = null;
let expData = null;
function renderExport() {
  $('outBright').value = Math.round((project.output.brightness ?? 1) * 100);
  $('outSat').value = Math.round((project.output.saturation ?? 1) * 100);
  $('outBrightOut').textContent = `${$('outBright').value}%`;
  $('outSatOut').textContent = `${$('outSat').value}%`;
  $('outGamma').value = Math.round((project.output.ledGamma ?? 2.4) * 10);
  $('outBlack').value = project.output.blackCut ?? 6;
  $('outColors').value = String(project.output.maxColors || 0);
  $('outGammaOut').textContent = gammaLabel(project.output.ledGamma ?? 2.4);
  $('outBlackOut').textContent = `${$('outBlack').value}`;
  $('expLoop').checked = project.loop !== false;
  $('expShare').hidden = !canShareFiles();
  $('combineShare').hidden = !canShareFiles();
  refreshExport();
}

function refreshExport() {
  const frames = panelFrames(project);
  expData = analyse(ledFrames(project), project.loop !== false);
  $('expFrames').textContent = expData.frames;
  $('expSize').textContent = formatBytes(expData.size);
  $('expTime').textContent = `${(expData.duration / 1000).toFixed(1)} s`;
  $('expFrames').parentElement.classList.toggle('bad', expData.frames > 100);
  $('expSize').parentElement.classList.toggle('bad', expData.size > LIMITS.bytes);
  showWarnings($('expWarn'), expData.warnings);
  const c = $('expPreview');
  fitCanvas(c, 120);
  let i = 0;
  clearTimeout(expAnim);
  const step = () => {
    if (!$('exportDlg').open) return;
    drawPanel(c, frames[i % frames.length].rgb, { mode: 'led' });
    expAnim = setTimeout(step, Math.max(20, frames[i % frames.length].delay));
    i++;
  };
  step();
}

function showWarnings(ul, warnings) {
  ul.textContent = '';
  if (!warnings.length) { const li = document.createElement('li'); li.className = 'ok'; li.textContent = 'Within the 100-frame and 100 KB guidelines. Ready for the Govee app.'; ul.appendChild(li); return; }
  for (const w of warnings) { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); }
}

let outTimer;
const outChange = () => {
  project.output = {
    ...project.output,
    brightness: num('outBright', 100) / 100,
    saturation: num('outSat', 100) / 100,
    ledGamma: num('outGamma', 24) / 10,
    blackCut: num('outBlack', 6),
  };
  $('outBrightOut').textContent = `${$('outBright').value}%`;
  $('outSatOut').textContent = `${$('outSat').value}%`;
  $('outGammaOut').textContent = gammaLabel(project.output.ledGamma);
  $('outBlackOut').textContent = `${$('outBlack').value}`;
  project.output.maxColors = num('outColors', 0) || 0;
  markDirty();
  clearTimeout(outTimer);
  outTimer = setTimeout(() => { refreshExport(); renderPreview(); renderTimeline(); }, 120);
};
$('outBright').oninput = outChange;
$('outSat').oninput = outChange;
$('outGamma').oninput = outChange;
$('outBlack').oninput = outChange;
$('outColors').onchange = outChange;
function gammaLabel(g) { return g <= 1.05 ? 'Off' : g < 1.8 ? `Light (${g.toFixed(1)})` : g <= 2.4 ? `Standard (${g.toFixed(1)})` : `Strong (${g.toFixed(1)})`; }
$('expLoop').onchange = () => { project.loop = $('expLoop').checked; markDirty(); refreshExport(); };
$('exportBtn').onclick = () => openDlg('exportDlg');

$('expGif').onclick = guard(async () => { await download(expData.bytes, safeName(project.name, 'gif'), 'image/gif'); toast('GIF saved.'); });
$('expShare').onclick = guard(async () => { try { await share(expData.bytes, safeName(project.name, 'gif'), 'image/gif'); } catch (e) { if (e.name !== 'AbortError') throw e; } });
$('expPng').onclick = guard(async () => download(await framePNG(project, cur.frame, 1), safeName(`${project.name}-frame-${state.frameIndex + 1}`, 'png'), 'image/png'));
$('expPngBig').onclick = guard(async () => download(await framePNG(project, cur.frame, 12, { mode: 'led' }), safeName(`${project.name}-preview-12x`, 'png'), 'image/png'));
$('expJson').onclick = guard(async () => download(JSON.stringify(serialize(project)), safeName(project.name, 'json'), 'application/json'));

// Combine
let combineItems = [];
async function renderCombine() {
  const pick = $('combinePick');
  const lib = await listLibrary();
  pick.textContent = '';
  for (const e of lib) { const o = document.createElement('option'); o.value = e.id; o.textContent = e.name; pick.appendChild(o); }
  pick.hidden = $('combineAddLib').hidden = !lib.length;
  pick._lib = lib;
  renderCombineList();
}

function renderCombineList() {
  const ul = $('combineList');
  ul.textContent = '';
  combineItems.forEach((it, k) => {
    const li = document.createElement('li');
    const c = document.createElement('canvas');
    thumbInto(c, renderPanel(it.project, it.project.frames[0]));
    const name = document.createElement('span');
    name.textContent = `${it.project.name} · ${it.project.frames.length} frames`;
    const rep = document.createElement('input');
    rep.type = 'number'; rep.min = 1; rep.max = 50; rep.value = it.repeat; rep.title = 'Times to repeat';
    rep.onchange = () => { it.repeat = Math.max(1, Math.min(50, Number(rep.value) || 1)); refreshCombine(); };
    const up = button('↑', () => { if (k) { [combineItems[k - 1], combineItems[k]] = [combineItems[k], combineItems[k - 1]]; renderCombineList(); } });
    const del = button('✕', () => { combineItems.splice(k, 1); renderCombineList(); });
    li.append(c, name, document.createTextNode('×'), rep, up, del);
    ul.appendChild(li);
  });
  refreshCombine();
}

let combineData = null;
function refreshCombine() {
  if (!combineItems.length) { $('combineStats').textContent = 'Add two or more projects.'; $('combineWarn').textContent = ''; combineData = null; return; }
  const frames = combineFrames(combineItems);
  combineData = analyse(frames, project.loop !== false);
  $('combineStats').innerHTML = `<div class="stat"><span>${combineData.frames}</span><small>frames</small></div><div class="stat"><span>${formatBytes(combineData.size)}</span><small>file size</small></div><div class="stat"><span>${(combineData.duration / 1000).toFixed(1)} s</span><small>length</small></div>`;
  showWarnings($('combineWarn'), combineData.warnings);
}

$('combineAddCur').onclick = () => { combineItems.push({ project: deserialize(serialize(project)), repeat: 1 }); renderCombineList(); };
$('combineAddLib').onclick = guard(() => {
  const e = $('combinePick')._lib.find((x) => x.id === $('combinePick').value);
  if (e) { combineItems.push({ project: deserialize(e.data), repeat: 1 }); renderCombineList(); }
});
$('combineAddFile').onclick = () => $('combineFile').click();
$('combineFile').onchange = guard(async (e) => {
  for (const f of e.target.files) combineItems.push({ project: deserialize(JSON.parse(await f.text())), repeat: 1 });
  e.target.value = '';
  renderCombineList();
});
$('combineGo').onclick = guard(async () => { if (!combineData) throw new Error('Add projects first.'); await download(combineData.bytes, 'govee-sequence.gif', 'image/gif'); });
$('combineShare').onclick = guard(async () => { if (!combineData) throw new Error('Add projects first.'); try { await share(combineData.bytes, 'govee-sequence.gif', 'image/gif'); } catch (e) { if (e.name !== 'AbortError') throw e; } });

// Projects
async function renderProjects() {
  const ul = $('projList');
  ul.textContent = '';
  const lib = await listLibrary();
  if (!lib.length) { const li = document.createElement('li'); li.innerHTML = '<span>No saved projects yet.</span>'; ul.appendChild(li); return; }
  for (const e of lib) {
    const li = document.createElement('li');
    const img = document.createElement('canvas');
    if (e.thumb) { const im = new Image(); im.onload = () => { img.width = PANEL_W; img.height = PANEL_H; img.getContext('2d').drawImage(im, 0, 0); }; im.src = e.thumb; }
    const s = document.createElement('span');
    s.textContent = `${e.name} · ${new Date(e.savedAt).toLocaleString()}`;
    li.append(img, s,
      button('Open', () => { setProject(deserialize(e.data)); project.libId = e.id; $('projectsDlg').close(); toast(`Opened "${e.name}".`); }),
      button('Delete', async () => { if (confirm(`Delete "${e.name}" from this browser?`)) { await deleteFromLibrary(e.id); renderProjects(); } }));
    ul.appendChild(li);
  }
}

$('projSave').onclick = guard(async () => {
  project.libId = project.libId || newId('P');
  const thumb = panelToCanvas(panelFor(project.frames[0]), 1).toDataURL('image/png');
  await saveToLibrary({ id: project.libId, name: project.name, data: serialize(project), thumb });
  toast(`Saved "${project.name}" in this browser.`);
  renderProjects();
});
$('projNew').onclick = () => { setProject(createProject()); $('projectsDlg').close(); toast('New project. Undo brings the previous one back.'); };
$('projOpenFile').onclick = () => $('fileInput').click();

// Palettes
function renderPaletteDlg() {
  const box = $('palEdit');
  box.textContent = '';
  project.palette.forEach((hex, i) => {
    const l = document.createElement('label');
    l.style.background = hex;
    const inp = document.createElement('input');
    inp.type = 'color'; inp.value = hex;
    inp.oninput = () => { project.palette[i] = inp.value; l.style.background = inp.value; renderPalette(); renderPreview(); };
    inp.onchange = () => { markDirty(); renderAll(); };
    inp.onclick = () => checkpoint();
    l.appendChild(inp);
    box.appendChild(l);
  });
  const ul = $('palList');
  ul.textContent = '';
  const saved = getPref('palettes', []);
  saved.forEach((p, k) => {
    const li = document.createElement('li');
    const mini = document.createElement('div');
    mini.className = 'mini';
    mini.innerHTML = p.colors.map((c) => `<i style="background:${c}"></i>`).join('');
    const s = document.createElement('span');
    s.textContent = p.name;
    li.append(mini, s,
      button('Use', () => { checkpoint(); project.palette = [...p.colors]; renderAll(); renderPaletteDlg(); }),
      button('Delete', () => { saved.splice(k, 1); setPref('palettes', saved); renderPaletteDlg(); }));
    ul.appendChild(li);
  });
}

$('palAdd').onclick = () => { if (project.palette.length >= 32) return; checkpoint(); project.palette.push(state.primary); renderAll(); renderPaletteDlg(); };
$('palRemove').onclick = () => { if (project.palette.length <= 1) return; checkpoint(); project.palette.pop(); renderAll(); renderPaletteDlg(); };
$('palReset').onclick = () => { checkpoint(); project.palette = [...DEFAULT_PALETTE]; renderAll(); renderPaletteDlg(); };
$('palFromFrame').onclick = () => {
  const rgb = panelFor(cur.frame);
  const counts = new Map();
  for (let i = 0; i < rgb.length; i += 3) { const k = rgbToHex(rgb[i] & 0xf0, rgb[i + 1] & 0xf0, rgb[i + 2] & 0xf0); counts.set(k, (counts.get(k) || 0) + 1); }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
  checkpoint();
  project.palette = top;
  renderAll();
  renderPaletteDlg();
};
$('palSave').onclick = () => {
  const name = $('palName').value.trim() || `Palette ${getPref('palettes', []).length + 1}`;
  const saved = getPref('palettes', []);
  saved.push({ name, colors: [...project.palette] });
  setPref('palettes', saved);
  $('palName').value = '';
  renderPaletteDlg();
  toast(`Saved palette "${name}".`);
};

// ---------- keyboard ----------

const KEYS = [
  ...TOOLS.filter((t) => !t.sep).map((t) => [t.key, t.name]),
  ['H', 'Mirror left/right'], ['V', 'Mirror top/bottom'], ['X', 'Swap primary / secondary'], ['1–9', 'Pick palette color'],
  ['[  ]', 'Brush size smaller / bigger'], ['Space', 'Play / pause'], [',  .', 'Previous / next frame'],
  ['N', 'New frame'], ['Shift+N', 'Duplicate frame'], ['U', 'Onion skin'], ['Q', 'Panel view on the canvas'], ['#', 'LED grid'],
  ['Ctrl/⌘+Z', 'Undo'], ['Ctrl/⌘+Shift+Z or Ctrl+Y', 'Redo'], ['Ctrl/⌘+A', 'Select all'], ['Ctrl/⌘+C / V', 'Copy / paste selection'],
  ['Delete', 'Clear selection'], ['Arrows', 'Nudge selection (Shift = 1 LED)'], ['Esc', 'Deselect'],
];

function renderKeyList() {
  $('keyList').innerHTML = KEYS.map(([k, d]) => `<kbd>${k}</kbd><span>${d}</span>`).join('');
}

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
  if (document.querySelector('dialog[open]')) return;
  const k = e.key, mod = e.ctrlKey || e.metaKey;
  if (mod) {
    const lk = k.toLowerCase();
    if (lk === 'z' && e.shiftKey) { e.preventDefault(); redo(); }
    else if (lk === 'z') { e.preventDefault(); undo(); }
    else if (lk === 'y') { e.preventDefault(); redo(); }
    else if (lk === 'a') { e.preventDefault(); selectAll(); }
    else if (lk === 'c') { if (state.selection) { e.preventDefault(); copySelection(); } }
    else if (lk === 's') { e.preventDefault(); autosaveNow(); toast('Saved in this browser.'); }
    return;
  }
  const tool = TOOLS.find((t) => !t.sep && t.key === k.toUpperCase());
  if (tool && !e.shiftKey) { setTool(tool.id); return; }
  if (/^[1-9]$/.test(k)) { const hex = project.palette[Number(k) - 1]; if (hex) setPrimary(hex); return; }
  const sel = state.selection;
  switch (k) {
    case 'h': case 'H': state.mirrorX = !state.mirrorX; renderToolbar(); renderWork(); break;
    case 'v': case 'V': state.mirrorY = !state.mirrorY; renderToolbar(); renderWork(); break;
    case 'x': case 'X': [state.primary, state.secondary] = [state.secondary, state.primary]; renderPalette(); break;
    case '[': adjustSize(-1); break;
    case ']': adjustSize(1); break;
    case ' ': e.preventDefault(); state.playing ? stopPlayback() : play(); break;
    case ',': case '<': goFrame(state.frameIndex - 1); break;
    case '.': case '>': goFrame(state.frameIndex + 1); break;
    case 'n': addFrame(false); break;
    case 'N': addFrame(true); break;
    case 'u': case 'U': toggleOnion(); break;
    case 'q': case 'Q': state.panelView = !state.panelView; renderToolbar(); renderWork(); break;
    case '#': state.grid = !state.grid; renderToolbar(); renderWork(); break;
    case 'Escape': state.selection = null; renderWork(); break;
    case 'Delete': case 'Backspace': if (sel) { e.preventDefault(); clearSelection(); } break;
    case 'ArrowLeft': case 'ArrowRight': case 'ArrowUp': case 'ArrowDown': {
      if (!sel) { if (k === 'ArrowLeft') goFrame(state.frameIndex - 1); if (k === 'ArrowRight') goFrame(state.frameIndex + 1); break; }
      e.preventDefault();
      const s = e.shiftKey ? SCALE : 1;
      nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0);
      break;
    }
    default: break;
  }
});

function adjustSize(dir) {
  const o = state.tool === 'eraser' ? state.eraser : ['line', 'rect', 'ellipse'].includes(state.tool) ? state.shape : state.brush;
  o.size = Math.max(1, Math.min(40, o.size + dir * (o.size >= 10 ? 2 : 1)));
  renderToolOptions();
  renderWork();
  toast(`Size ${o.size} cells`);
}

function toggleOnion() {
  state.onion.on = !state.onion.on;
  $('onionBtn').classList.toggle('on', state.onion.on);
  $('onionOpts').classList.toggle('on', state.onion.on);
  renderWork();
}

// ---------- wiring ----------

work.addEventListener('pointerdown', guard(onPointerDown));
work.addEventListener('pointermove', guard(onPointerMove));
work.addEventListener('pointerup', guard(onPointerUp));
work.addEventListener('pointercancel', guard(onPointerUp));
work.addEventListener('pointerleave', () => { hover = null; if (!drag) renderWork(); });
work.addEventListener('contextmenu', (e) => e.preventDefault());

$('undoBtn').onclick = $('undoBtnM').onclick = undo;
$('redoBtn').onclick = $('redoBtnM').onclick = redo;
$('projectName').onchange = () => { checkpoint(); project.name = $('projectName').value.trim() || 'Untitled'; };
$('mirrorX').onclick = () => { state.mirrorX = !state.mirrorX; renderToolbar(); renderWork(); };
$('mirrorY').onclick = () => { state.mirrorY = !state.mirrorY; renderToolbar(); renderWork(); };
$('gridToggle').onclick = () => { state.grid = !state.grid; renderToolbar(); renderWork(); };
$('panelView').onclick = () => { state.panelView = !state.panelView; renderToolbar(); renderWork(); };
$('previewMode').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.previewMode = b.dataset.v;
  setPref('previewMode', state.previewMode);
  [...$('previewMode').children].forEach((x) => x.classList.toggle('on', x === b));
  renderPreview();
});
let pipLarge = false;
$('pip').onclick = () => { pipLarge = !pipLarge; renderPreview(); };

$('primary').oninput = () => { state.primary = $('primary').value; renderPalette(); };
$('secondary').oninput = () => { state.secondary = $('secondary').value; renderPalette(); };
$('swapColors').onclick = () => { [state.primary, state.secondary] = [state.secondary, state.primary]; renderPalette(); };
let snapCheckpointed = false;
$('snap').oninput = () => {
  if (!snapCheckpointed) { checkpoint(); snapCheckpointed = true; }
  project.snap = Number($('snap').value) / 100;
  $('snapOut').textContent = `${$('snap').value}%`;
  renderPreview();
  if (state.panelView) renderWork();
};
$('snap').onchange = () => { snapCheckpointed = false; markDirty(); renderTimeline(); renderLayers(); };

$('layerAdd').onclick = () => addLayer(false);
$('layerDup').onclick = () => addLayer(true);
$('layerDel').onclick = deleteLayer;
$('layerUp').onclick = () => moveLayer(1);
$('layerDown').onclick = () => moveLayer(-1);
$('layerMerge').onclick = mergeDown;
$('layerAllFrames').onclick = layerToAllFrames;
let opacityCheckpointed = false;
$('layerOpacity').oninput = () => {
  if (!opacityCheckpointed) { checkpoint(); opacityCheckpointed = true; }
  cur.layer.opacity = Number($('layerOpacity').value) / 100;
  $('layerOpacityOut').textContent = `${$('layerOpacity').value}%`;
  renderWork(); renderPreview();
};
$('layerOpacity').onchange = () => { opacityCheckpointed = false; renderLayers(); renderTimeline(); };
$('layerBlend').onchange = () => { checkpoint(); cur.layer.blend = $('layerBlend').value; renderAll(); };

$('prevFrame').onclick = () => goFrame(state.frameIndex - 1);
$('nextFrame').onclick = () => goFrame(state.frameIndex + 1);
$('playBtn').onclick = () => (state.playing ? stopPlayback() : play());
$('loopBtn').onclick = () => { state.loop = !state.loop; $('loopBtn').classList.toggle('on', state.loop); };
$('onionBtn').onclick = toggleOnion;
$('onionBefore').oninput = () => { state.onion.before = Math.max(0, Math.min(5, num('onionBefore', 1))); renderWork(); };
$('onionAfter').oninput = () => { state.onion.after = Math.max(0, Math.min(5, num('onionAfter', 1))); renderWork(); };
$('onionOpacity').oninput = () => { state.onion.opacity = num('onionOpacity', 30) / 100; renderWork(); };
$('frameDuration').onchange = () => { checkpoint(); cur.frame.duration = Math.max(10, Math.min(10000, num('frameDuration', 80))); renderTimeline(); };
$('frameHold').onchange = () => { checkpoint(); cur.frame.hold = Math.max(0, Math.min(20000, num('frameHold', 0))); renderTimeline(); };
$('durAll').onclick = () => { checkpoint(); const d = cur.frame.duration; project.frames.forEach((f) => (f.duration = d)); renderTimeline(); toast(`All frames set to ${d} ms.`); };
$('frameAdd').onclick = () => addFrame(false);
$('frameDup').onclick = () => addFrame(true);
$('frameDel').onclick = deleteFrame;
$('frameLeft').onclick = () => moveFrame(state.frameIndex, state.frameIndex - 1);
$('frameRight').onclick = () => moveFrame(state.frameIndex, state.frameIndex + 1);
setupTimelineDrag();

function setSheet(name) {
  $('app').dataset.sheet = name;
  document.querySelectorAll('[data-sheet-btn]').forEach((b) => b.classList.toggle('on', b.dataset.sheetBtn === name));
  requestAnimationFrame(layoutWork);
}
document.querySelectorAll('[data-sheet-btn]').forEach((b) => b.addEventListener('click', () => {
  setSheet(b.dataset.sheetBtn);
  if (b.dataset.sheetBtn === 'frames') renderTimeline();
}));

new ResizeObserver(() => layoutWork()).observe($('stage'));
window.addEventListener('resize', () => { previewCell = 0; renderPreview(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) autosaveNow(); });
window.addEventListener('beforeunload', () => { autosaveNow(); });

// ---------- start ----------

async function start() {
  state.previewMode = getPref('previewMode', 'led');
  [...$('previewMode').children].forEach((x) => x.classList.toggle('on', x.dataset.v === state.previewMode));
  setSheet('tools');
  renderKeyList();
  renderAll();
  layoutWork();
  const saved = await loadAutosave();
  if (saved?.data?.frames?.length) {
    $('recover').hidden = false;
    $('recoverInfo').textContent = `"${saved.data.name}" · ${saved.data.frames.length} frame${saved.data.frames.length > 1 ? 's' : ''} · ${new Date(saved.savedAt).toLocaleString()}`;
    $('recoverYes').onclick = guard(() => { setProject(deserialize(saved.data), { keepHistory: false }); $('recover').hidden = true; toast('Last session recovered.'); });
    $('recoverNo').onclick = () => { $('recover').hidden = true; };
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__studio = { get project() { return project; }, state, serialize, deserialize, renderAll, panelFrames, buildGIF };
}

start();

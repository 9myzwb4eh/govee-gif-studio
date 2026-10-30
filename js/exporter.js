// Turning projects into files, and getting files onto the device.

import { encodeGIF } from './gif.js';
import { renderPanel, frameTime, LIMITS, PANEL_W, PANEL_H } from './model.js';
import { countColors } from './raster.js';
import { panelToCanvas } from './led.js';

export function panelFrames(project) {
  return project.frames.map((f) => ({ rgb: renderPanel(project, f), delay: frameTime(f) }));
}

export function buildGIF(frames, loop = true) {
  return encodeGIF(frames, PANEL_W, PANEL_H, { loop: loop ? 0 : null });
}

// Exact size by encoding (a 20 x 26 GIF encodes in milliseconds) plus any warnings.
export function analyse(frames, loop = true) {
  const bytes = buildGIF(frames, loop);
  const warnings = [];
  if (frames.length > LIMITS.frames) warnings.push(`${frames.length} frames is over the ${LIMITS.frames}-frame guideline. The Govee app may reject or trim it.`);
  if (bytes.length > LIMITS.bytes) warnings.push(`${formatBytes(bytes.length)} is over the ${formatBytes(LIMITS.bytes)} guideline.`);
  const fast = frames.filter((f) => f.delay < 20).length;
  if (fast) warnings.push(`${fast} frame(s) are shorter than 20 ms. Most players stretch those to 100 ms, so use 20 ms or more.`);
  const heavy = frames.filter((f) => countColors(f.rgb) > 256).length;
  if (heavy) warnings.push(`${heavy} frame(s) use more than 256 colors, the GIF limit. Those are reduced to the 256 closest colors.`);
  const duration = frames.reduce((s, f) => s + Math.max(20, Math.round(f.delay / 10) * 10), 0);
  return { bytes, size: bytes.length, frames: frames.length, duration, warnings };
}

// Several projects one after another, each repeated `repeat` times.
export function combineFrames(items) {
  const out = [];
  for (const { project, repeat = 1 } of items) {
    const frames = panelFrames(project);
    for (let r = 0; r < repeat; r++) out.push(...frames);
  }
  return out;
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
}

export function safeName(name, ext) {
  return `${(name || 'govee').trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'govee'}.${ext}`;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

export async function framePNG(project, frame, scale = 1, opts = {}) {
  return canvasToBlob(panelToCanvas(renderPanel(project, frame), scale, opts));
}

// Saves a file with a real download (anchor + download attribute). Falls back to a data URL
// if the browser refuses object URLs.
export async function download(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  let url;
  try { url = URL.createObjectURL(blob); } catch { url = await blobToDataURL(blob); }
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); if (url.startsWith('blob:')) URL.revokeObjectURL(url); }, 4000);
}

export function canShareFiles() {
  try {
    return !!(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.gif', { type: 'image/gif' })] }));
  } catch { return false; }
}

// iPhone: the share sheet offers "Save to Files", which is where the Govee app picks GIFs from.
export async function share(data, filename, type) {
  const file = new File([data], filename, { type });
  await navigator.share({ files: [file] });
}

function blobToDataURL(blob) {
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
}

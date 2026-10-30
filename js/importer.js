// Reading PNG / JPG / GIF files (all GIF frames) and video clips into work-resolution cels.

import { decodeGIF } from './gif.js';
import { resizeInto, WORK_W, WORK_H, isEmpty } from './raster.js';

// Returns { width, height, frames: [{ rgba, delay }] }
export async function readImageFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isGif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
  if (isGif) {
    const gif = decodeGIF(buf);
    return { width: gif.width, height: gif.height, frames: gif.frames.map((f) => ({ rgba: f.rgba, delay: f.delay })) };
  }
  const img = await loadImage(file);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { width: c.width, height: c.height, frames: [{ rgba: ctx.getImageData(0, 0, c.width, c.height).data, delay: 100 }] };
}

async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file); } catch { /* fall back to <img> */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

// Treat near-black pixels as transparent so imported art drops onto other layers cleanly.
export function knockOutBlack(buf, threshold = 12) {
  for (let p = 0; p < buf.length; p += 4) if (Math.max(buf[p], buf[p + 1], buf[p + 2]) < threshold) buf[p + 3] = 0;
  return buf;
}

export function toCels(image, { fit = 'fit', filter = 'box', blackTransparent = false, maxFrames = 200, focusX = 0.5, curtainLook = false } = {}) {
  return image.frames.slice(0, maxFrames).map((f) => {
    const cel = resizeInto(f.rgba, image.width, image.height, WORK_W, WORK_H, { filter, fit, focusX });
    if (curtainLook) curtainize(cel);
    if (blackTransparent) knockOutBlack(cel);
    return { cel: isEmpty(cel) ? null : cel, delay: f.delay };
  });
}

// Photos and video are made for screens: murky backgrounds light the whole curtain and mid-tones look
// washed out. This pushes dim areas to black (LEDs off), adds contrast and saturates the colours.
export function curtainize(buf, { black = 0.16, contrast = 1.2, saturation = 1.45 } = {}) {
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let x = Math.max(0, (v / 255 - black) / (1 - black));
    x = 0.5 + (x - 0.5) * contrast;
    lut[v] = Math.round(Math.max(0, Math.min(1, x)) * 255);
  }
  for (let p = 0; p < buf.length; p += 4) {
    let r = lut[buf[p]], g = lut[buf[p + 1]], b = lut[buf[p + 2]];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    buf[p] = l + (r - l) * saturation; buf[p + 1] = l + (g - l) * saturation; buf[p + 2] = l + (b - l) * saturation;
  }
  return buf;
}

// Downloads a clip from a link. Only works for direct file links on sites that allow other apps to
// fetch them (CORS); page links from video sites are refused with a clear explanation.
export async function fetchClip(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new Error('That doesn\'t look like a link. Paste the full address starting with https://'); }
  const host = url.hostname.replace(/^www\./, '');
  if (/(^|\.)(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|pinterest\.)/.test(host)) {
    throw new Error(`${host} doesn't let apps download its videos. Save or screen-record the clip to Photos, then choose it with the button above.`);
  }
  // Giphy page links point at a web page; the clip itself lives at a predictable media address.
  const giphy = host.endsWith('giphy.com') && url.pathname.match(/\/(?:gifs|stickers|clips)\/(?:.*-)?([A-Za-z0-9]+)\/?$/);
  if (giphy) url = new URL(`https://media.giphy.com/media/${giphy[1]}/giphy.mp4`);
  let res;
  try { res = await fetch(url.href, { mode: 'cors' }); } catch {
    throw new Error('That site doesn\'t allow apps to download its files. Save the clip to Photos (long-press it, then Save), then choose it with the button above.');
  }
  if (!res.ok) throw new Error(`The link didn't work (error ${res.status}). Check it opens in Safari.`);
  const blob = await res.blob();
  if (blob.size > 60 * 1024 * 1024) throw new Error('That file is over 60 MB. Pick a shorter clip.');
  const type = blob.type || '';
  if (/text\/html/.test(type)) throw new Error('That link is a web page, not a video or image file. Open it, long-press the clip and copy its own address, or save it to Photos.');
  const name = decodeURIComponent(url.pathname.split('/').pop() || 'clip') || 'clip';
  return new File([blob], name, { type });
}

export function isVideoFile(file) {
  return /^video\//.test(file.type) || /\.(mp4|mov|m4v|webm)$/i.test(file.name || '');
}

// Opens a video so frames can be pulled from it. Call .frames(start, length, fps) for
// { width, height, frames: [{ rgba, delay }] } and .close() when done.
export async function openVideo(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  await new Promise((resolve, reject) => {
    v.onloadeddata = resolve;
    v.onerror = () => reject(new Error("Couldn't open that video. Try a .mp4 or .mov clip."));
    v.load();
  });
  // Frames are pulled at a modest size: the curtain is 20 x 26, so more pixels only cost memory.
  const k = Math.min(1, 320 / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.max(1, Math.round(v.videoWidth * k)), h = Math.max(1, Math.round(v.videoHeight * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const seek = (t) => new Promise((resolve) => {
    const done = () => { v.removeEventListener('seeked', done); resolve(); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
    setTimeout(done, 1500); // some browsers skip the event when the time doesn't change
  });
  return {
    duration: v.duration || 0, width: w, height: h,
    async frames(start = 0, length = 3, fps = 12, onProgress) {
      const n = Math.max(1, Math.min(100, Math.round(length * fps)));
      const end = Math.max(0, (v.duration || length) - 0.05), out = [];
      for (let i = 0; i < n; i++) {
        await seek(Math.min(end, start + i / fps));
        ctx.drawImage(v, 0, 0, w, h);
        out.push({ rgba: ctx.getImageData(0, 0, w, h).data, delay: Math.round(1000 / fps) });
        onProgress?.(i + 1, n);
      }
      return { width: w, height: h, frames: out };
    },
    close() { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); },
  };
}

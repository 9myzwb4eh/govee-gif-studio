// Reading PNG / JPG / GIF files (all GIF frames) into work-resolution cels.

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

export function toCels(image, { fit = 'fit', filter = 'box', blackTransparent = false, maxFrames = 200 } = {}) {
  return image.frames.slice(0, maxFrames).map((f) => {
    const cel = resizeInto(f.rgba, image.width, image.height, WORK_W, WORK_H, { filter, fit });
    if (blackTransparent) knockOutBlack(cel);
    return { cel: isEmpty(cel) ? null : cel, delay: f.delay };
  });
}

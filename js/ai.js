// Optional AI mode: Claude turns a description into a scene (see scene.js), using the person's own API key.
// The key stays in this browser and requests go straight from the browser to api.anthropic.com.
// Raw fetch rather than the SDK because the app has no build step or dependencies.

import { ELEMENT_TYPES } from './scene.js';

export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, cheaper)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (cheapest)' },
];

const num = { type: 'number' };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'frames', 'frameMs', 'background', 'elements'],
  properties: {
    name: { type: 'string' },
    frames: { type: 'integer' },
    frameMs: { type: 'integer' },
    background: {
      type: 'object', additionalProperties: false, required: ['top', 'bottom'],
      properties: { top: { type: 'string' }, bottom: { type: 'string' } },
    },
    elements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type'],
        properties: {
          type: { type: 'string', enum: ELEMENT_TYPES },
          color: { type: 'string' },
          gradient: { type: 'string' },
          x: num, y: num, r: num, rx: num, ry: num, w: num, h: num, scale: num,
          count: { type: 'integer' },
          density: num,
          glow: num,
          lineWidth: num,
          fill: { type: 'boolean' },
          motion: { type: 'string', enum: ['rise', 'float', 'cross', 'still', 'scroll', 'pulse'] },
          text: { type: 'string' },
          shape: { type: 'string', enum: ['circle', 'ellipse', 'rect', 'polygon', 'line', 'path'] },
          points: { type: 'array', items: { type: 'array', items: num } },
          keyframes: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false, required: ['t'],
              properties: { t: num, x: num, y: num, scale: num, rotate: num, opacity: num },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You design short looping animations for a Govee Curtain Lights 2 panel: 20 LEDs wide by 26 tall, portrait.
Reply with one scene as JSON matching the schema. Coordinates are in LEDs (x 0-20, y 0-26, fractions allowed); time t runs 0-1 and loops.

What looks good on this panel:
- Black means the LED is off. Keep the background black or nearly black ("#000000"); light only the subject. Dim colors glow brightly on real LEDs, so avoid large dim fills.
- Big, bold, simple shapes, at least 3 LEDs across. Fine detail disappears.
- Saturated colors (orange, purple, green, red, cyan, warm white). Use "glow" (0-3) on bright things.
- Smooth motion: move things by fractions of an LED per frame through keyframes. Make the loop seamless: the last keyframe should match the first unless the object leaves the panel and comes back.
- 24-48 frames at 50-90 ms is a good range. Never more than 100 frames.

Element types:
- Built-in animated elements, which look polished, so prefer them when they fit: stars {density 0.03-0.2}, moon {x,y,r,color}, pumpkin {x,y,scale,color}, ghost {motion rise|float|cross, x,y,scale}, bats {count, color}, spider, witch {y}, lightning {color}, rain {color}, snow {color}, fire, eyes {count,color}, skull {x,y,scale}, heart {x,y,scale,color}.
- text {text, color, motion still|scroll|pulse, y}: letters are 3x5 LEDs. Up to 5 characters fit across; longer text should scroll.
- shape {shape circle|ellipse|rect|polygon|line|path, color, gradient (center color), glow, fill, lineWidth, r|rx,ry|w,h, points (for polygon/line/path, relative to the keyframe position), keyframes [{t,x,y,scale,rotate,opacity}]}: for anything else. Build objects from several shapes that share keyframes.
Elements draw back to front. Use at most 9 elements besides stars.`;

export function getKey() {
  try { return localStorage.getItem('ggs-anthropic-key') || ''; } catch { return ''; }
}

export function setKey(k) {
  try { if (k) localStorage.setItem('ggs-anthropic-key', k); else localStorage.removeItem('ggs-anthropic-key'); } catch { /* private mode */ }
}

export async function aiScene(prompt, { apiKey, model = AI_MODELS[0].id, signal } = {}) {
  if (!apiKey) throw new Error('Add your Anthropic API key first.');
  const body = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `Make this animation: ${prompt}` }],
  };
  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  // Opus and Sonnet can decline borderline requests; let the API retry on its recommended fallback model.
  if (model !== 'claude-haiku-5-5') {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Could not reach the Anthropic API. Check your connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('That API key was not accepted. Check it in AI settings.');
    if (res.status === 429) throw new Error('Rate limited by the API. Wait a moment and try again.');
    if (res.status === 529 || res.status >= 500) throw new Error('The API is busy right now. Try again in a minute.');
    throw new Error(`API error: ${msg}`);
  }
  if (data.stop_reason === 'refusal') throw new Error('Claude declined this request. Try describing it differently.');
  if (data.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Try a simpler description.');
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let scene;
  try { scene = JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Claude did not return a scene. Try again.');
    scene = JSON.parse(m[0]);
  }
  return { scene, usage: data.usage };
}

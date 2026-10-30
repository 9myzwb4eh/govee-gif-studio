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
          colors: { type: 'array', items: { type: 'string' } },
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
- Built-in animated elements, which look polished, so prefer them when they fit. Any of these takes {color}; the still ones also take {x,y,scale}; "count" (1-6) draws several:
  Halloween: moon {x,y,r}, pumpkin, ghost {motion rise|float|cross, count}, bats {count}, spider {count}, witch {y, count}, eyes {count}, skull.
  Christmas and winter: tree (lit tree with chasing lights and a star), santa (sleigh and reindeer flying across, {y}), wreath, baubles {count} (hanging ornaments), candycane, bells, snowman, gift, snow.
  New Year and celebrations: fireworks {count, colors[]}, confetti {count}, sparkles {count}, balloons {count}, cake (birthday cake with candles).
  Diwali and Indian festivals: diya (oil lamp with flame), rangoli (rotating pattern), fireworks. Holi: powder {count} (colour bursts).
  Lunar New Year: lantern (red, swaying), fireworks. Eid and Ramadan: crescent (moon and star), lantern, sparkles. Hanukkah: menorah (candles light one by one).
  Easter and spring: egg, bunny, flower. St Patrick's: shamrock. Thanksgiving and autumn: leaves, pumpkin. Love: heart.
  Weather and sky: stars {density 0.03-0.2}, lightning, rain, snow, fire.
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
  return { scene: parseSceneReply(text), usage: data.usage };
}

// No API key needed: a prompt to paste into any AI chat (Claude, ChatGPT, Gemini...) that has the
// chat answer with a scene, which the person pastes back.
export function chatPrompt(description) {
  return `${SYSTEM}

Reply with only the scene as one compact JSON object inside a single \`\`\`json code block, with no explanation before or after it. Use plain numbers (no math or comments). It must follow this JSON Schema:
${JSON.stringify(SCHEMA)}

Make this animation: ${description}`;
}

// Pulls the scene out of a chat reply. Chat apps add code fences and sentences, phones turn quotes
// curly, and models sometimes write JavaScript-style JSON (comments, trailing commas, bare keys) or
// get cut off, so this repairs what it can before giving up.
export function parseSceneReply(text) {
  const src = String(text || '')
    .replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'")
    .replace(/ /g, ' ').replace(/```[a-z]*\s*/gi, '');
  const starts = [];
  for (let i = 0; i < src.length; i++) if (src[i] === '{') starts.push(i);
  if (!starts.length) throw new Error("That reply doesn't contain a scene. Copy the AI's whole answer, including the { } part.");
  // Try the outermost object first, then any inner one that holds the elements.
  let lastErr = null;
  for (const st of starts) {
    const chunk = balanced(src, st);
    if (!/"?elements"?\s*:/.test(chunk)) continue;
    try {
      const scene = JSON.parse(repair(chunk));
      if (scene && Array.isArray(scene.elements)) return scene;
    } catch (e) { lastErr = e; }
  }
  if (!lastErr) throw new Error("That reply isn't a scene. Make sure you pasted the answer to the copied prompt.");
  throw new Error(`Couldn't read the scene in that reply (${lastErr.message}). Ask the AI to "reply with only the JSON code block" and paste again.`);
}

// From an opening brace to its matching close, skipping braces inside strings. A reply that was cut
// off gets its open strings, arrays and objects closed.
function balanced(src, start) {
  const stack = [];
  let inStr = null, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") inStr = c;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') { stack.pop(); if (!stack.length) return src.slice(start, i + 1); }
  }
  let out = src.slice(start);
  if (inStr) out += inStr;
  out = out.replace(/,\s*("[^"]*"\s*:?\s*)?$/, '').replace(/:\s*$/, ': null');
  return out + stack.reverse().join('');
}

function repair(s) {
  let out = '', inStr = null, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; out += c; continue; }
      if (c === '\\') { esc = true; out += c; continue; }
      if (c === inStr) { inStr = null; out += '"'; continue; }
      if (c === '"') { out += '\\"'; continue; }
      if (c === '\n') { out += '\\n'; continue; }
      out += c; continue;
    }
    if (c === '"' || c === "'") { inStr = c; out += '"'; continue; }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i + 2); if (i < 0) break; i++; continue; }
    out += c;
  }
  return out
    .replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, '$1')
    .replace(/\b(NaN|Infinity|-Infinity|undefined)\b/g, 'null');
}

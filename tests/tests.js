// Browser self-test: open tests/index.html. Results also go to the console and window.__results.
import { WORK_W, WORK_H, PANEL_W, PANEL_H, newBuffer, downscale, compositeLayers, transformBuffer, ledEncode } from '../js/raster.js';
import { createProject, renderPanel, serialize, deserialize, writableCel } from '../js/model.js';
import { encodeGIF, decodeGIF } from '../js/gif.js';
import { Stroke } from '../js/paint.js';
import { tween, centroid, text } from '../js/effects.js';
import { TEMPLATES } from '../js/templates.js';
import { layoutText } from '../js/font.js';
import { sceneFromText, renderScene } from '../js/scene.js';
import { panelFrames, ledFrames, analyse } from '../js/exporter.js';

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail });

// 1. A 100 x 130 drawing downscales to exactly 20 x 26.
check('Work canvas is 100 x 130', WORK_W === 100 && WORK_H === 130, `${WORK_W} x ${WORK_H}`);
const p = createProject('test');
const layerId = p.layers[1].id;
const buf = writableCel(p.frames[0], layerId);
for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) buf.set([255, 0, 0, 255], (y * WORK_W + x) * 4);          // LED (0,0) full red
for (let y = 0; y < 5; y++) for (let x = 5; x < 10; x++) if (x < 7 || (x === 7 && y < 3)) buf.set([0, 0, 255, 255], (y * WORK_W + x) * 4); // LED (1,0) 13/25 blue
for (let y = 125; y < 130; y++) for (let x = 95; x < 100; x++) buf.set([255, 255, 255, 255], (y * WORK_W + x) * 4); // last LED white
const panel = renderPanel(p, p.frames[0]);
check('Downscale gives exactly 20 x 26 = 520 LEDs', panel.length === PANEL_W * PANEL_H * 3, `${panel.length / 3} pixels`);
check('Full 5 x 5 block keeps its exact color', panel[0] === 255 && panel[1] === 0 && panel[2] === 0, `[${panel[0]},${panel[1]},${panel[2]}]`);
check('Partly covered block is the area average', Math.abs(panel[5] - Math.round(255 * 13 / 25)) <= 1, `blue = ${panel[5]}, expected ${Math.round(255 * 13 / 25)}`);
check('Bottom-right block maps to LED (19, 25)', panel[(25 * 20 + 19) * 3] === 255, `${panel[(25 * 20 + 19) * 3]}`);
const small = downscale(compositeLayers([{ buf, opacity: 1, blend: 'normal' }]));
check('downscale() output size', small.length === 520 * 3);

// 2. GIF export has the right dimensions, frame count, timing and pixels.
const frames = [0, 1, 2].map((k) => {
  const rgb = new Uint8ClampedArray(520 * 3);
  for (let i = 0; i < 520; i++) rgb.set([(i * 3 + k * 40) % 256, (i * 7) % 256, (k * 90) % 256], i * 3);
  return { rgb, delay: 60 + k * 20 };
});
const gif = encodeGIF(frames, PANEL_W, PANEL_H, { loop: 0 });
const w = gif[6] | (gif[7] << 8), h = gif[8] | (gif[9] << 8);
check('GIF header says 20 x 26', w === 20 && h === 26, `${w} x ${h}`);
const dec = decodeGIF(gif);
check('GIF decodes to 3 frames of 20 x 26', dec.frames.length === 3 && dec.width === 20 && dec.height === 26);
check('GIF frame durations kept', dec.frames.map((f) => f.delay).join() === '60,80,100', dec.frames.map((f) => f.delay).join());
check('GIF loops forever', dec.loop === 0, `loop = ${dec.loop}`);
let maxErr = 0;
dec.frames.forEach((f, k) => { for (let i = 0; i < 520; i++) for (let c = 0; c < 3; c++) maxErr = Math.max(maxErr, Math.abs(f.rgba[i * 4 + c] - frames[k].rgb[i * 3 + c])); });
check('GIF pixels match the preview exactly', maxErr === 0, `max error ${maxErr}`);
const exp = analyse(ledFrames(p));
const ew = exp.bytes[6] | (exp.bytes[7] << 8), eh = exp.bytes[8] | (exp.bytes[9] << 8);
check('Project export is 20 x 26', ew === 20 && eh === 26, `${ew} x ${eh}, ${exp.size} bytes`);
const back = decodeGIF(exp.bytes).frames[0].rgba;
const ledPanel = ledEncode(panel, p.output);
let same = true;
for (let i = 0; i < 520; i++) for (let c = 0; c < 3; c++) if (back[i * 4 + c] !== ledPanel[i * 3 + c]) same = false;
check('Exported GIF equals the on-screen panel after LED correction', same);

// LED correction: full colors untouched, dark tones pushed toward off, hue kept.
const probe = Uint8ClampedArray.from([255, 128, 0, 30, 20, 60, 120, 60, 0, 4, 4, 4]);
const enc = ledEncode(probe, { ledGamma: 2.4, blackCut: 6 });
check('LED correction keeps full-brightness colors', enc[0] === 255 && Math.abs(enc[1] - 128) <= 1 && enc[2] === 0, `[${enc[0]},${enc[1]},${enc[2]}]`);
check('LED correction darkens a dim navy that would glow on the curtain', enc[5] <= 8, `[${enc[3]},${enc[4]},${enc[5]}]`);
check('LED correction keeps hue (dark orange stays orange)', enc[6] > 0 && Math.abs(enc[7] / enc[6] - 0.5) < 0.05, `[${enc[6]},${enc[7]},${enc[8]}]`);
check('Near-black switches LEDs off', enc[9] === 0 && enc[10] === 0 && enc[11] === 0);
const off = ledEncode(probe, { ledGamma: 1, blackCut: 0 });
check('Correction off leaves values unchanged', off.every((v, i) => v === probe[i]));

// 3. Soft brush and sub-pixel motion.
const s = new Stroke(newBuffer(), { color: [255, 255, 255] });
s.dab(50, 50, 10, 0.3);
check('Soft brush has partial alpha at the edge', s.target[(50 * WORK_W + 54) * 4 + 3] > 0 && s.target[(50 * WORK_W + 54) * 4 + 3] < 255);
const moved = transformBuffer(s.target, WORK_W, WORK_H, { dx: 2.5 });
const c0 = centroid(s.target), c1 = centroid(moved);
check('Sub-pixel move shifts by 2.5 cells (half an LED)', Math.abs(c1[0] - c0[0] - 2.5) < 0.15, `${(c1[0] - c0[0]).toFixed(2)}`);

// 4. Tween.
const tp = createProject('tween');
const lid = tp.layers[1].id;
tp.frames.push({ ...tp.frames[0], id: 'f2', cels: { ...tp.frames[0].cels } });
const a = new Stroke(writableCel(tp.frames[0], lid), { color: [255, 120, 0] }); a.dab(20, 60, 12, 0.5);
const b = new Stroke(writableCel(tp.frames[1], lid), { color: [255, 120, 0] }); b.dab(80, 60, 12, 0.5);
const added = tween(tp, { layerId: lid, startIndex: 0, endIndex: 1, steps: 5, auto: true, easing: 'linear' });
const xs = tp.frames.map((f) => centroid(f.cels[lid])[0]);
check('Tween adds 5 frames', added === 5 && tp.frames.length === 7);
check('Tween moves evenly start → end', xs.every((x, i) => !i || x > xs[i - 1]) && Math.abs(xs[3] - 50) < 1, xs.map((x) => x.toFixed(1)).join(' → '));

// 5. Project file round trip.
const json = JSON.stringify(serialize(p));
const p2 = deserialize(JSON.parse(json));
const panel2 = renderPanel(p2, p2.frames[0]);
check('Project file reopens identically', panel2.every((v, i) => v === panel[i]), `${json.length} bytes`);

// 6. Text.
const textP = createProject('text');
text(textP, { value: 'BOO', color: '#ff6a00' });
const tPanel = renderPanel(textP, textP.frames[0]);
let lit = 0; for (let i = 0; i < 520; i++) if (tPanel[i * 3] > 200) lit++;
const expectLit = layoutText('BOO', textP.font).cells.length;
check('"BOO" lights exactly its font pixels', lit === expectLit, `${lit} of ${expectLit} LEDs lit`);

// 7. Templates build, stay within limits.
for (const t of TEMPLATES) {
  const tp2 = t.build();
  const r = analyse(panelFrames(tp2));
  check(`Template "${t.name}"`, r.frames <= 100 && r.size <= 500 * 1024 && tp2.layers.length <= 10, `${r.frames} frames, ${(r.size / 1024).toFixed(1)} KB, ${tp2.layers.length} layers`);
}

// 8. Text-to-scene builder.
for (const prompt of ['orange pumpkin, stars, "BOO"', 'ghost rising, three bats, moon', 'witch flying across the moon with stars', 'lightning storm with rain', 'red beating heart, "LOVE" pulsing', 'snow falling slowly, "HAPPY HOLIDAYS"', 'skull with fire and green eyes', 'hello there', 'three ghosts flying', 'three witches', 'four pumpkins, "BOO"', '2 spiders', 'Christmas', 'Happy Diwali', 'New Year fireworks', 'Eid Mubarak', 'Easter', 'birthday "SAM"', 'Lunar New Year', 'Hanukkah', 'Holi', 'Halloween', 'christmas tree']) {
  const { scene, understood } = sceneFromText(prompt);
  const sp = renderScene(scene);
  const r = analyse(ledFrames(sp));
  check(`Scene "${prompt}"`, understood.length > 0 && r.frames <= 100 && r.size <= 500 * 1024 && sp.layers.length <= 10, `${understood.join(', ')} · ${r.frames} frames, ${(r.size / 1024).toFixed(1)} KB`);
}
const three = sceneFromText('three purple bats').scene.elements[0];
check('Scene builder reads counts and colors', three.count === 3 && three.color === '#9b30ff', JSON.stringify(three));
const gh = sceneFromText('three ghosts flying').scene.elements.find((e) => e.type === 'ghost');
check('Scene builder reads "three ghosts flying"', gh && gh.count === 3 && gh.motion === 'cross', JSON.stringify(gh));
const wi = sceneFromText('three witches').scene;
const wiScene = renderScene(wi), wiL = wiScene.layers.find((l) => l.name === 'Witch').id;
const wiLit = (f) => { const c = wiScene.frames[f].cels[wiL]; let n = 0; if (c) for (let k = 3; k < c.length; k += 4) n += c[k] > 0; return n; };
check('"three witches" draws three witches', wi.elements[0].count === 3 && wiLit(5) > 0, `count ${wi.elements[0].count}, ${wiLit(5)} lit pixels`);
const xm = sceneFromText('Christmas').scene;
check('"Christmas" builds a tree, snow and a greeting', ['tree', 'snow', 'text'].every((t) => xm.elements.some((e) => e.type === t)), xm.elements.map((e) => e.type).join(', '));
const ct = sceneFromText('christmas tree').scene;
check('"christmas tree" gives the tree and greeting, no extra pieces', ct.elements.map((e) => e.type).join() === 'tree,text', ct.elements.map((e) => e.type).join(', '));
{
  const xp = renderScene(sceneFromText('Christmas').scene);
  const full = analyse(ledFrames(xp)).size;
  xp.output.maxColors = 16;
  const small = ledFrames(xp), smallSize = analyse(small).size;
  const used = new Set(); for (const f of small) for (let i = 0; i < f.rgb.length; i += 3) used.add((f.rgb[i] << 16) | (f.rgb[i + 1] << 8) | f.rgb[i + 2]);
  check('16-color export shrinks the GIF and keeps black exact', used.size <= 16 && used.has(0) && smallSize < full * 0.8, `${(full / 1024).toFixed(1)} KB → ${(smallSize / 1024).toFixed(1)} KB, ${used.size} colors`);
}
const shapeScene = renderScene({ frames: 8, elements: [{ type: 'shape', shape: 'circle', r: 3, color: '#ff0000', keyframes: [{ t: 0, x: 4, y: 13 }, { t: 1, x: 16, y: 13 }] }] });
const xs2 = shapeScene.frames.map((f) => { const L = shapeScene.layers[1].id; return f.cels[L] ? centroid(f.cels[L])[0] : 0; });
check('AI shape keyframes move smoothly', xs2.every((x, i) => !i || x > xs2[i - 1]), xs2.map((x) => (x / 5).toFixed(1)).join(' → '));

const out = document.getElementById('out');
for (const r of results) {
  const li = document.createElement('li');
  li.className = r.ok ? 'pass' : 'fail';
  li.textContent = `${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? ` (${r.detail})` : ''}`;
  out.appendChild(li);
  console.log(li.textContent);
}
const failed = results.filter((r) => !r.ok).length;
document.getElementById('summary').textContent = failed ? `${failed} of ${results.length} checks failed` : `All ${results.length} checks passed`;
document.getElementById('summary').className = failed ? 'fail' : 'pass';
window.__results = results;

# Curtain GIF Studio

A web app for making smooth animated GIFs for the **Govee Curtain Lights 2 (H70B3)**, a 20 × 26 LED panel.
It runs in any modern browser, installs to an iPhone home screen, and works offline. There is no build step and no dependencies.

## Using it

- Open the hosted page (GitHub Pages) in Safari, then Share → **Add to Home Screen**.
- Draw on the 100 × 130 canvas. Every 5 × 5 block becomes one LED, set to the average color of the block, so soft edges and sub-pixel motion come out smooth.
- **Export** → on iPhone, **Share / Save to Files**. In Govee Home: Curtain Lights 2 → **DIY** → upload a GIF → pick it from **Files** (not Photos).

The in-app Help (the ? button) covers the workflow, tips and keyboard shortcuts.

## Running locally

Any static file server works, for example:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

ES modules don't load from `file://`, so opening `index.html` directly will not work.

## Tests

Open `tests/index.html` from the same server. It checks that:

- a 100 × 130 drawing downscales to exactly 20 × 26 by area average,
- an exported GIF is 20 × 26 with the right frame count, timing and loop, and its pixels equal the on-screen panel,
- sub-pixel moves, tweening, project files and the text tool work,
- all six templates stay under 100 frames, 500 KB and 10 layers.

## Layout

| File | Purpose |
| --- | --- |
| `index.html`, `css/app.css` | UI (desktop and phone layouts) |
| `js/app.js` | UI wiring, tools, timeline, dialogs |
| `js/model.js` | Project → layers → frames → cels (one RGBA buffer per layer per frame), undo snapshots, project files |
| `js/raster.js` | Compositing, box downscale, palette snap, transforms, blur |
| `js/paint.js` | Brush strokes, shapes, fill, gradients |
| `js/gif.js` | GIF encoder and decoder (LZW, no dithering) |
| `js/effects.js` | Tween, twinkle, fire, glow, trail, text, fades |
| `js/templates.js` | Six starter animations |
| `js/led.js` | LED glow preview |
| `js/importer.js`, `js/exporter.js`, `js/storage.js` | Import, export/download/share, autosave and library |
| `sw.js`, `manifest.webmanifest` | Offline support and home-screen install |

Govee doesn't publish GIF limits for the panel. The 100-frame and 500 KB warnings are conservative guidelines.

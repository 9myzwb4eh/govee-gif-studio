// Copies the web app (which has no build step) into www/, the folder Capacitor packages into
// the Android and iOS apps. Run from the repo root: npm run build
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`, { recursive: true });
console.log(`www/ ready (${FILES.join(', ')})`);

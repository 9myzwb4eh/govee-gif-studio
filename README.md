# Curtain GIF Studio

A web app for making smooth animated GIFs for the **Govee Curtain Lights 2 (H70B3)**, a 20 × 26 LED panel.
It runs in any modern browser, installs to an iPhone home screen, and works offline. There is no build step and no dependencies.

## Using it

- Open the hosted page (GitHub Pages) in Safari, then Share → **Add to Home Screen**.
- Draw on the 100 × 130 canvas. Every 5 × 5 block becomes one LED, set to the average color of the block, so soft edges and sub-pixel motion come out smooth.
- **Export** → on iPhone, **Share / Save to Files**. In Govee Home: Curtain Lights 2 → **DIY** → upload a GIF → pick it from **Files** (not Photos).

The in-app Help (the ? button) covers the workflow, tips and keyboard shortcuts.

## Phone apps (Android APK and iPhone IPA)

The same app is also packaged as native Android and iOS apps with [Capacitor](https://capacitorjs.com). In the apps, **Save GIF** puts the GIF straight into Photos (iPhone) or the gallery (Android, in a *Curtain GIF Studio* album), which is where the Govee Home app picks GIFs from. **Share…** opens the system share sheet.

### Download a ready-made app

Every change to `main` is built automatically and published on the [Releases page](../../releases/latest):

- **Android:** download `curtain-gif-studio.apk` on the phone and open it. Android asks once to allow installs from your browser or Files app; allow it, then tap **Install**.
- **iPhone:** `curtain-gif-studio-unsigned.ipa` is not signed, because only Apple can sign an app for anyone's phone (that needs the App Store or a paid developer account). You sign it with your own Apple ID as you install it:
  1. Install [Sideloadly](https://sideloadly.io) on a Windows PC or Mac, or [AltStore](https://altstore.io).
  2. Plug the iPhone in, drag the IPA into Sideloadly, enter your Apple ID and click **Start**.
  3. On the iPhone: Settings → General → VPN & Device Management → trust your Apple ID. On iOS 16 and later, also turn on Settings → Privacy & Security → **Developer Mode**.
  4. With a free Apple ID the app stops opening after **7 days**; install it again (AltStore can do this for you automatically). A paid developer account ($99/year) makes it last a year.

If you'd rather not sideload, the web app (Safari → Share → **Add to Home Screen**) does everything the iPhone app does.

### Build it yourself

You need [Node.js](https://nodejs.org) 20 or later. Then:

```sh
git clone https://github.com/9myzwb4eh/govee-gif-studio.git
cd govee-gif-studio
npm install
```

**Android** (Windows, Mac or Linux, with [Android Studio](https://developer.android.com/studio)):

```sh
npm run android        # copies the web app in and opens Android Studio
```

Plug in the phone (with USB debugging on) and press **Run**, or use Build → Build APK(s). From a terminal, `cd android && ./gradlew assembleDebug` writes `android/app/build/outputs/apk/debug/app-debug.apk`.

**iPhone** (needs a Mac with Xcode 26 or later):

```sh
npm run ios            # copies the web app in and opens Xcode
```

In Xcode, select the **App** target → Signing & Capabilities, pick your Apple ID under **Team** (add it in Xcode → Settings → Accounts if needed), and change the bundle identifier to something unique, such as `com.yourname.curtaingif`. Plug in the iPhone, select it at the top, and press **Run**. The same 7-day limit applies with a free Apple ID.

After changing the web app, run `npm run sync` (or `npm run android` / `npm run ios` again) so the native apps get the new files. The web app itself still has no build step: `www/` is just a copy made by `scripts/build-www.mjs`.

### Android signing (for updates)

Android only installs an update over an existing app if both are signed with the same key. Until a key is set up, each automatic build is signed with a throwaway debug key, so uninstall the old app before installing a new APK (your saved projects live in the app and are removed too, so export project files first). To sign every build with one permanent key, create one once:

```sh
keytool -genkeypair -v -keystore release.jks -alias curtain -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.jks     # on a Mac: base64 -i release.jks
```

Then in GitHub: Settings → Secrets and variables → Actions, add `ANDROID_KEYSTORE_BASE64` (the base64 text), `ANDROID_KEYSTORE_PASSWORD`, and `ANDROID_KEY_ALIAS` (`curtain`). Keep `release.jks` and its password somewhere safe and never commit them.

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
| `js/native.js` | Save to Photos / gallery and the share sheet inside the Android and iOS apps (unused in a browser) |
| `android/`, `ios/`, `capacitor.config.json`, `package.json` | Native app projects (Capacitor) |
| `.github/workflows/apps.yml` | Builds the APK and IPA and publishes them as a release |

Govee doesn't publish GIF limits for the panel. The 100-frame and 500 KB warnings are conservative guidelines.

// Bridges to the Android and iOS app shells (Capacitor). In a normal browser none of this runs:
// window.Capacitor only exists inside the native apps, and the plugins are called through the
// native bridge directly, so the web app keeps needing no build step and no libraries.

const cap = () => window.Capacitor;

export function isNative() {
  try { return !!cap()?.isNativePlatform?.(); } catch { return false; }
}

export function platform() {
  return isNative() ? cap().getPlatform() : 'web';
}

function call(plugin, method, options = {}) {
  return cap().nativePromise(plugin, method, options);
}

async function toBase64(data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(',') + 1);
}

// Writes the file to the app's cache folder and returns its file:// URI.
async function writeTemp(data, filename, type) {
  const { uri } = await call('Filesystem', 'writeFile', {
    path: `exports/${filename}`,
    data: await toBase64(data, type),
    directory: 'CACHE',
    recursive: true,
  });
  return uri;
}

// The system share sheet (Save Image, Save to Files, Drive, messages, ...).
export async function nativeShare(data, filename, type) {
  const uri = await writeTemp(data, filename, type);
  try {
    await call('Share', 'share', { title: filename, files: [uri], dialogTitle: 'Save or send' });
  } catch (e) {
    // Closing the sheet without picking anything is not an error.
    if (/cancel/i.test(String(e?.message || e))) { const err = new Error('Share canceled'); err.name = 'AbortError'; throw err; }
    throw e;
  }
}

const ALBUM = 'Curtain GIF Studio';

// Android keeps saved media in an album folder inside the app's media folder, which the
// gallery indexes.
async function androidAlbum() {
  await call('Media', 'createAlbum', { name: ALBUM }).catch(() => {}); // rejects once it exists
  const { path } = await call('Media', 'getAlbumsPath');
  return `${path.replace(/\/$/, '')}/${ALBUM}`;
}

// Saves an image (an animated GIF stays animated) to Photos on iPhone or the gallery on Android.
// That is where the Govee Home app picks GIFs from.
export async function saveToPhotos(data, filename, type) {
  const path = await writeTemp(data, filename, type);
  const opts = { path };
  if (platform() === 'android') {
    // A time stamp keeps earlier saves of the same project from being overwritten.
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
    opts.albumIdentifier = await androidAlbum();
    opts.fileName = `${filename.replace(/\.\w+$/, '')}-${stamp}`;
  }
  await call('Media', 'savePhoto', opts);
}

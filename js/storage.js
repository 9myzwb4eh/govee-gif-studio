// Autosave and project library in IndexedDB (room for many frames); small preferences in localStorage.

const DB_NAME = 'govee-gif-studio';
let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
        req.result.createObjectStore('library', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}

export async function saveAutosave(data) {
  try { await tx('kv', 'readwrite', (s) => s.put({ savedAt: Date.now(), data }, 'autosave')); return true; } catch { return false; }
}

export async function loadAutosave() {
  try { return (await tx('kv', 'readonly', (s) => s.get('autosave'))) || null; } catch { return null; }
}

export async function clearAutosave() {
  try { await tx('kv', 'readwrite', (s) => s.delete('autosave')); } catch { /* storage unavailable */ }
}

export async function saveToLibrary(entry) {
  await tx('library', 'readwrite', (s) => s.put({ ...entry, savedAt: Date.now() }));
}

export async function listLibrary() {
  try {
    const all = (await tx('library', 'readonly', (s) => s.getAll())) || [];
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch { return []; }
}

export async function deleteFromLibrary(id) {
  await tx('library', 'readwrite', (s) => s.delete(id));
}

export function getPref(key, fallback) {
  try { const v = localStorage.getItem(`ggs-${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}

export function setPref(key, value) {
  try { localStorage.setItem(`ggs-${key}`, JSON.stringify(value)); } catch { /* private mode */ }
}

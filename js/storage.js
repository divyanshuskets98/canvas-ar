// IndexedDB library of registered canvases: image + compiled tracking target + ML results.
const DB = 'canvas-ar', VER = 1;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { r.result.createObjectStore('canvases', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('canvases', mode); const s = t.objectStore('canvases'); const out = fn(s); t.oncomplete = () => res(out?.result ?? out); t.onerror = () => rej(t.error); }); };

export async function listCanvases() {
  try { const d = await db(); return await new Promise((res, rej) => { const r = d.transaction('canvases').objectStore('canvases').getAll(); r.onsuccess = () => res(r.result.sort((a, b) => a.created - b.created)); r.onerror = () => rej(r.error); }); }
  catch (e) { console.warn('storage unavailable', e); return []; }
}
export async function saveCanvas(rec) { try { await tx('readwrite', (s) => s.put(rec)); return true; } catch (e) { console.warn('save failed', e); return false; } }
export async function deleteCanvas(id) { try { await tx('readwrite', (s) => s.delete(id)); } catch (e) { console.warn(e); } }
export async function renameCanvas(id, name) {
  const all = await listCanvases(); const r = all.find((x) => x.id === id); if (!r) return;
  r.name = name; await saveCanvas(r);
}

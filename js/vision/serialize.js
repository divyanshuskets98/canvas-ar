// Scene graph <-> transferable form (JSON + two lossless PNG mask images).
// Masks are stored in RGB with opaque alpha so the browser's premultiplication can't corrupt them.
const MASKS_A = ['sky', 'water', 'veg'], MASKS_B = ['snow', 'autumn'];
const BLOB_KEYS = ['nx', 'ny', 'top', 'bottom', 'nw', 'nh', 'area', 'px', 'fill', 'elong', 'hue', 'sat', 'lum', 'peak', 'bg', 'kind', 'contrast', 'color'];
const r4 = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);

function maskCanvas(scene, names) {
  const { gridW: w, gridH: h } = scene;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); const id = x.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    names.forEach((n, k) => { id.data[i * 4 + k] = Math.round((scene.masks[n]?.[i] || 0) * 255); });
    id.data[i * 4 + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  return c;
}
const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));

export async function serializeScene(scene) {
  const json = {
    gridW: scene.gridW, gridH: scene.gridH, aspect: scene.aspect, horizon: scene.horizon,
    skyline: Array.from(scene.skyline, r4),
    blobs: scene.blobs.map((b) => Object.fromEntries(BLOB_KEYS.map((k) => [k, Array.isArray(b[k]) ? b[k].map(r4) : r4(b[k])]))),
    stats: scene.stats, cues: scene.cues, themes: scene.themes, topThemes: scene.topThemes,
    ml: { labels: scene.ml?.labels || [], objects: scene.ml?.objects || [] },
  };
  json.blobs.tinyStars = scene.blobs.tinyStars;
  return { json, masksA: await toBlob(maskCanvas(scene, MASKS_A)), masksB: await toBlob(maskCanvas(scene, MASKS_B)) };
}

export function deserializeScene(json, imgA, imgB) {
  const { gridW: w, gridH: h } = json;
  const read = (img) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, w, h); return x.getImageData(0, 0, w, h).data; };
  const a = read(imgA), b = read(imgB);
  const masks = {};
  MASKS_A.forEach((n, k) => { masks[n] = new Float32Array(w * h); for (let i = 0; i < w * h; i++) masks[n][i] = a[i * 4 + k] / 255; });
  MASKS_B.forEach((n, k) => { masks[n] = new Float32Array(w * h); for (let i = 0; i < w * h; i++) masks[n][i] = b[i * 4 + k] / 255; });
  const blobs = json.blobs.slice(); blobs.tinyStars = json.cues?.tinyStars || 0;
  return { ...json, masks, blobs, skyline: Float32Array.from(json.skyline), objects: json.ml?.objects || [] };
}

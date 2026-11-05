// Measures *where* a generated clip actually moves, so only those parts (blinking eyes,
// flickering flames, rippling water…) are shown on the canvas and everything else stays
// the untouched original painting. Also detects clips where the model moved/redrew the
// whole picture (zoom, drift, repaint) so they can be rejected.
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

function blur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, k = 0; for (let d = -r; d <= r; d++) { const xx = x + d; if (xx >= 0 && xx < w) { s += src[y * w + xx]; k++; } } tmp[y * w + x] = s / k; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, k = 0; for (let d = -r; d <= r; d++) { const yy = y + d; if (yy >= 0 && yy < h) { s += tmp[yy * w + x]; k++; } } out[y * w + x] = s / k; }
  return out;
}
function maxFilter(src, w, h, r) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let m = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && src[yy * w + xx] > m) m = src[yy * w + xx]; }
    out[y * w + x] = m;
  }
  return out;
}

export async function analyseMotion(blob, { samples = 24, size = 192, source = null } = {}) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('the clip could not be decoded')); setTimeout(() => rej(new Error('clip load timed out')), 30000); });
    let dur = v.duration;
    if (!isFinite(dur) || dur <= 0) { // some WebM files don't declare a duration until the end is seeked
      v.currentTime = 1e6; await new Promise((r) => (v.onseeked = r)); dur = v.duration; v.currentTime = 0;
    }
    const vw = v.videoWidth, vh = v.videoHeight;
    const W = vw >= vh ? size : Math.round(size * vw / vh), H = vw >= vh ? Math.round(size * vh / vw) : size;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const n = W * H, sum = new Float32Array(n * 3), sq = new Float32Array(n * 3), first = new Float32Array(n * 3);
    let got = 0;
    for (let i = 0; i < samples; i++) {
      const t = Math.min(dur - 0.01, (i / (samples - 1)) * dur);
      v.currentTime = Math.max(0, t);
      await new Promise((res) => { const done = () => { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); setTimeout(done, 3000); });
      ctx.drawImage(v, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      for (let p = 0; p < n; p++) for (let k = 0; k < 3; k++) {
        const val = d[p * 4 + k] / 255; sum[p * 3 + k] += val; sq[p * 3 + k] += val * val; if (i === 0) first[p * 3 + k] = val;
      }
      got++;
    }
    // per-pixel temporal standard deviation (mean over RGB)
    const sd = new Float32Array(n);
    for (let p = 0; p < n; p++) { let s = 0; for (let k = 0; k < 3; k++) { const m = sum[p * 3 + k] / got; s += Math.sqrt(Math.max(0, sq[p * 3 + k] / got - m * m)); } sd[p] = s / 3; }
    let m = sd.map((x) => smooth(0.025, 0.08, x));
    m = maxFilter(m, W, H, 2);          // include the edges of moving parts
    m = blur(m, W, H, 3);               // soft blend into the still painting
    let moving = 0; for (let p = 0; p < n; p++) if (m[p] > 0.5) moving++;
    // Global-drift test: flat colour areas don't change under a zoom/pan, so measure how many of the
    // picture's *edges* move. Local animation (an eye blinking) moves few edges; zoom/redraw moves most.
    const L = new Float32Array(n); for (let p = 0; p < n; p++) L[p] = (first[p * 3] + first[p * 3 + 1] + first[p * 3 + 2]) / 3;
    let edges = 0, edgesMoving = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      const g = Math.abs(L[p + 1] - L[p - 1]) + Math.abs(L[p + W] - L[p - W]);
      if (g > 0.15) { edges++; if (sd[p] > 0.04) edgesMoving++; }
    }
    const data = new Uint8Array(n * 4);
    for (let p = 0; p < n; p++) { const q = Math.min(255, Math.round(Math.min(1, m[p] * 1.4) * 255)); data[p * 4] = q; data[p * 4 + 1] = q; data[p * 4 + 2] = q; data[p * 4 + 3] = 255; }
    const png = document.createElement('canvas'); png.width = W; png.height = H;
    png.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), W, H), 0, 0);
    const pngBlob = await new Promise((r) => png.toBlob(r, 'image/png'));
    // Does the clip start from the actual painting? (a low image-strength setting makes models redraw it)
    let firstDiff = null;
    if (source) {
      const sc = document.createElement('canvas'); sc.width = W; sc.height = H;
      const sx = sc.getContext('2d', { willReadFrequently: true }); sx.drawImage(source, 0, 0, W, H);
      const sd2 = sx.getImageData(0, 0, W, H).data; let acc = 0;
      for (let p = 0; p < n; p++) for (let k = 0; k < 3; k++) acc += Math.abs(sd2[p * 4 + k] / 255 - first[p * 3 + k]);
      firstDiff = acc / (n * 3);
    }
    return { maskBlob: pngBlob, w: W, h: H, movingFraction: moving / n, edgeMotion: edges ? edgesMoving / edges : 0, firstDiff, frames: got };
  } finally { URL.revokeObjectURL(url); }
}

// Finds discrete painted objects that should move by themselves – birds in the sky,
// boats / floating things on water, clouds – cuts each one out as a sprite and
// fills the background behind it, so the object can be animated *in place*
// (instead of adding new objects). Works in image pixels of the given canvas.
import { sampleMask } from './analyzer.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[row + x] = acc / (2 * r + 1); acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / (2 * r + 1); acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
  return out;
}

// 8-connected components of a binary mask → [{minx,maxx,miny,maxy,count,pixels}]
function components(mask, w, h, maxPixels = 200000) {
  const lab = new Int32Array(w * h).fill(-1), stack = new Int32Array(w * h), out = [];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    const id = out.length; let sp = 0; stack[sp++] = s; lab[s] = id;
    const c = { minx: w, maxx: 0, miny: h, maxy: 0, count: 0, pixels: [] };
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i / w) | 0;
      c.count++; if (c.pixels.length < maxPixels) c.pixels.push(i);
      if (x < c.minx) c.minx = x; if (x > c.maxx) c.maxx = x; if (y < c.miny) c.miny = y; if (y > c.maxy) c.maxy = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx; if (mask[j] && lab[j] < 0) { lab[j] = id; stack[sp++] = j; }
      }
    }
    out.push(c);
  }
  return out;
}

function dilate(mask, w, h, r, box) {
  const out = new Uint8Array(w * h);
  const x0 = box ? Math.max(0, box.x0) : 0, x1 = box ? Math.min(w - 1, box.x1) : w - 1, y0 = box ? Math.max(0, box.y0) : 0, y1 = box ? Math.min(h - 1, box.y1) : h - 1;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!mask[y * w + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) out[yy * w + xx] = 1;
    }
  }
  return out;
}

export function extractObjects(image, scene, { maxBirds = 40, maxClouds = 10, maxFloaters = 4 } = {}) {
  const t0 = performance.now();
  const W = image.width, H = image.height;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(image, 0, 0);
  const src = cx.getImageData(0, 0, W, H);
  const d0 = src.data, n = W * H;
  let d = d0; // pixel source for the current object class (updated so later classes don't copy earlier objects)
  const L = new Float32Array(n), S = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255;
    L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); S[i] = mx > 0 ? (mx - mn) / mx : 0;
  }
  const skyAt = (x, y) => sampleMask(scene, 'sky', x / W, y / H);
  const waterAt = (x, y) => sampleMask(scene, 'water', x / W, y / H);
  const base = new Uint8ClampedArray(d);           // inpainted copy
  const hole = new Float32Array(n * 3);            // per-class hole masks (birds, floaters, clouds)
  const known = new Uint8Array(n).fill(1);
  const out = { birds: [], floaters: [], clouds: [] };

  // ---- reference background colour for a box: per row, mean of the pixels just outside left/right
  const rowRef = (x0, x1, y, pad) => {
    let r = 0, g = 0, b = 0, k = 0;
    for (const xx of [x0 - pad, x0 - pad - 2, x1 + pad, x1 + pad + 2]) {
      if (xx < 0 || xx >= W) continue; const i = (y * W + xx) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; k++;
    }
    return k ? [r / k, g / k, b / k] : null;
  };

  // Smooth fill (sky): each unknown pixel = inverse-distance blend of nearest known pixels in its row & column
  function fillSmooth(x0, y0, x1, y1, unknown) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x; if (!unknown[i]) continue;
      let acc = [0, 0, 0], wsum = 0;
      const probe = (dx, dy) => {
        let xx = x, yy = y, dist = 0;
        while (true) { xx += dx; yy += dy; dist++; if (xx < 0 || yy < 0 || xx >= W || yy >= H || dist > 400) return; if (!unknown[yy * W + xx]) break; }
        const j = (yy * W + xx) * 4, wgt = 1 / (dist * dist);
        acc[0] += d[j] * wgt; acc[1] += d[j + 1] * wgt; acc[2] += d[j + 2] * wgt; wsum += wgt;
      };
      probe(-1, 0); probe(1, 0); probe(0, -1); probe(0, 1); probe(-1, -1); probe(1, 1); probe(1, -1); probe(-1, 1);
      if (wsum > 0) { const o = i * 4; base[o] = acc[0] / wsum; base[o + 1] = acc[1] / wsum; base[o + 2] = acc[2] / wsum; }
    }
    // light smoothing of the filled area to remove streaks
    for (let pass = 0; pass < 2; pass++) for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) {
      const i = y * W + x; if (!unknown[i]) continue;
      for (let c = 0; c < 3; c++) base[i * 4 + c] = (base[(i - 1) * 4 + c] + base[(i + 1) * 4 + c] + base[(i - W) * 4 + c] + base[(i + W) * 4 + c]) / 4;
    }
  }
  // Texture fill (water): copy each row from just beside the object so waves continue
  function fillRows(x0, y0, x1, y1, unknown) {
    const bw = x1 - x0 + 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x; if (!unknown[i]) continue;
      let sx = x - bw - 3; if (sx < 0 || unknown[y * W + sx]) sx = x + bw + 3;
      if (sx >= W) sx = Math.max(0, x0 - 2);
      const j = (y * W + Math.min(W - 1, sx)) * 4;
      base[i * 4] = d[j]; base[i * 4 + 1] = d[j + 1]; base[i * 4 + 2] = d[j + 2];
    }
  }

  // Cut a sprite: alpha from colour distance between original and filled background
  function cutSprite(x0, y0, x1, y1, unknown, t0a, t1a, cls) {
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const sc = document.createElement('canvas'); sc.width = bw; sc.height = bh;
    const sx = sc.getContext('2d'); const id = sx.createImageData(bw, bh);
    let colCount = new Float32Array(bw);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x, o = i * 4, p = ((y - y0) * bw + (x - x0)) * 4;
      if (!unknown[i]) continue;
      const dist = (Math.abs(d[o] - base[o]) + Math.abs(d[o + 1] - base[o + 1]) + Math.abs(d[o + 2] - base[o + 2])) / 765;
      const a = smooth(t0a, t1a, dist);
      if (a <= 0.01) continue;
      for (let c = 0; c < 3; c++) id.data[p + c] = Math.max(0, Math.min(255, (d[o + c] - (1 - a) * base[o + c]) / a));
      id.data[p + 3] = a * 255;
      colCount[x - x0] += a;
      hole[i * 3 + cls] = Math.max(hole[i * 3 + cls], 1);
    }
    sx.putImageData(id, 0, 0);
    // body column = where most opaque pixels are (the "V" vertex of a bird)
    let best = 0, bi = bw / 2; for (let k = 0; k < bw; k++) if (colCount[k] > best) { best = colCount[k]; bi = k; }
    return { sprite: sc, nx: (x0 + bw / 2) / W, ny: (y0 + bh / 2) / H, nw: bw / W, nh: bh / H, body: (bi + 0.5) / bw, top: y0 / H, bottom: (y1 + 1) / H };
  }
  const pad = (c, p) => ({ x0: Math.max(1, c.minx - p), y0: Math.max(1, c.miny - p), x1: Math.min(W - 2, c.maxx + p), y1: Math.min(H - 2, c.maxy + p) });

  const skyL = scene.cues.sky?.L ?? 0.6;
  const darkSky = skyL < 0.35;
  const Lm = boxBlur(L, W, H, Math.max(4, Math.round(W / 90)));

  // sky brightness baseline per row (30th percentile of sky pixels) – clouds and birds are judged against it
  const rowBase = new Float32Array(H);
  for (let y = 0; y < H; y++) {
    const vals = [];
    for (let x = 0; x < W; x += 3) if (skyAt(x, y) > 0.5) vals.push(L[y * W + x]);
    vals.sort((a, b) => a - b); rowBase[y] = vals.length ? vals[Math.floor(vals.length * 0.3)] : 0.5;
  }

  // ------------------------------------------------------------ birds
  {
    const cand = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (skyAt(x, y) < 0.5) continue;
      const diff = L[i] - Lm[i];
      // dark silhouettes against a bright sky (at night only the ML detector may propose birds)
      if (!darkSky && diff < -0.055 && L[i] < rowBase[y] - 0.07) cand[i] = 1;
    }
    const comps = components(dilate(cand, W, H, 1), W, H);
    const sunLike = scene.blobs.filter((b) => b.kind === 'sun' || b.kind === 'moon');
    const mlBirds = (scene.objects || []).filter((o) => o.label === 'bird');
    for (const c of comps) {
      const bw = c.maxx - c.minx + 1, bh = c.maxy - c.miny + 1;
      const nw = bw / W, ar = bw / bh, fill = c.count / (bw * bh);
      const ml = mlBirds.some((o) => c.minx / W >= o.box.nx - 0.01 && c.maxx / W <= o.box.nx + o.box.nw + 0.01 && c.miny / H >= o.box.ny - 0.01 && c.maxy / H <= o.box.ny + o.box.nh + 0.01);
      if (!ml && (nw < 0.006 || nw > 0.09 || ar < 1.1 || ar > 8 || fill > 0.8 || c.count < 6)) continue;
      // a painted bird has a clearly dark core (cloud shading / glow edges are only mildly darker)
      let darkest = 1; for (const i of c.pixels) if (L[i] < darkest) darkest = L[i];
      if (!ml && rowBase[Math.round((c.miny + c.maxy) / 2)] - darkest < 0.22) continue;
      // must sit inside open sky (not the edge of a building / tree line)
      let sk = 0, tot = 0; const ex = bw * 0.8, ey = bh * 1.2;
      for (let y = c.miny - ey; y <= c.maxy + ey; y += Math.max(1, bh / 3)) for (let x = c.minx - ex; x <= c.maxx + ex; x += Math.max(1, bw / 4)) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue; tot++; if (skyAt(x, y) > 0.5) sk++;
      }
      if (!ml && (!tot || sk / tot < 0.9)) continue;
      if (sunLike.some((s) => Math.abs(s.nx - (c.minx + bw / 2) / W) < s.nw * 3 && Math.abs(s.ny - (c.miny + bh / 2) / H) < s.nh * 3)) continue;
      if (out.birds.length >= maxBirds) break;
      const p = pad(c, 2);
      const m = new Uint8Array(n); for (const i of c.pixels) m[i] = 1;
      const unknown = dilate(m, W, H, 2, p);
      fillSmooth(p.x0, p.y0, p.x1, p.y1, unknown);
      out.birds.push(cutSprite(p.x0, p.y0, p.x1, p.y1, unknown, 0.03, 0.14, 0));
    }
  }

  d = new Uint8ClampedArray(base); // clouds are cut from the image with birds already removed
  // ------------------------------------------------------------ clouds (painted puffs in a bright sky)
  if (!darkSky && (scene.cues.skyType === 'day' || scene.cues.skyType === 'sunset')) {
    const cand = new Uint8Array(n);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (skyAt(x, y) > 0.5 && S[i] < 0.28 && L[i] > 0.62 && L[i] > rowBase[y] + 0.07) cand[i] = 1;
    }
    const comps = components(cand, W, H).filter((c) => c.count > n * 0.0015 && c.count < n * 0.2 && (c.maxx - c.minx) < W * 0.7).sort((a, b) => b.count - a.count).slice(0, maxClouds);
    for (const c of comps) {
      const p = pad(c, 3);
      const m = new Uint8Array(n); for (const i of c.pixels) m[i] = 1;
      const unknown = dilate(m, W, H, 3, p);
      fillSmooth(p.x0, p.y0, p.x1, p.y1, unknown);
      out.clouds.push(cutSprite(p.x0, p.y0, p.x1, p.y1, unknown, 0.02, 0.1, 2));
    }
  }

  d = new Uint8ClampedArray(base);
  // ------------------------------------------------------------ floating objects: holes in the water mask
  if (scene.cues.waterArea > 0.02) {
    const gw = scene.gridW, gh = scene.gridH, wm = scene.masks.water, sm = scene.masks.sky;
    const nonWater = new Uint8Array(gw * gh);
    let wminy = gh, wmaxy = 0, wminx = gw, wmaxx = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (wm[i] > 0.5) { if (y < wminy) wminy = y; if (y > wmaxy) wmaxy = y; if (x < wminx) wminx = x; if (x > wmaxx) wmaxx = x; }
    }
    for (let y = wminy; y <= wmaxy; y++) for (let x = wminx; x <= wmaxx; x++) { const i = y * gw + x; if (wm[i] < 0.5 && sm[i] < 0.5) nonWater[i] = 1; }
    const comps = components(nonWater, gw, gh).filter((c) => c.count >= 6 && c.maxy - c.miny >= 2 && c.count < gw * gh * 0.08);
    const isW = (x, y) => x >= 0 && y >= 0 && x < gw && y < gh && wm[y * gw + x] > 0.5;
    for (const c of comps) {
      // enclosed by water left, right and below
      let enc = 0, tot = 0;
      for (let y = c.miny; y <= c.maxy; y++) { tot += 2; enc += isW(c.minx - 2, y) ? 1 : 0; enc += isW(c.maxx + 2, y) ? 1 : 0; }
      for (let x = c.minx; x <= c.maxx; x++) { tot++; enc += isW(x, c.maxy + 2) ? 1 : 0; }
      if (enc / tot < 0.7 || out.floaters.length >= maxFloaters) continue;
      // extend upward into the sky for masts / sails
      let top = c.miny; while (top > 0 && sm[(top - 1) * gw + Math.round((c.minx + c.maxx) / 2)] < 0.5 && wm[(top - 1) * gw + Math.round((c.minx + c.maxx) / 2)] < 0.5 && c.miny - top < (c.maxy - c.miny) * 2) top--;
      const sxp = W / gw, syp = H / gh;
      const x0 = Math.max(1, Math.floor((c.minx - 1) * sxp)), x1 = Math.min(W - 2, Math.ceil((c.maxx + 2) * sxp));
      const y0 = Math.max(1, Math.floor((top - 1.5) * syp)), y1 = Math.min(H - 2, Math.ceil((c.maxy + 2) * syp));
      // object pixels: differ from the row's flanking background
      const m = new Uint8Array(n); let objPx = 0, foam = 0;
      for (let y = y0; y <= y1; y++) {
        const ref = rowRef(x0, x1, y, 3); if (!ref) continue;
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x, o = i * 4; const dist = (Math.abs(d[o] - ref[0]) + Math.abs(d[o + 1] - ref[1]) + Math.abs(d[o + 2] - ref[2])) / 765;
          if (dist > 0.12) { m[i] = 1; objPx++; if (S[i] < 0.15 && L[i] > 0.8) foam++; }
        }
      }
      // a real object fills a good part of its box and isn't just white wave crests
      if (objPx < (x1 - x0 + 1) * (y1 - y0 + 1) * 0.18 || foam > objPx * 0.6) continue;
      const unknown = dilate(m, W, H, 2, { x0, y0, x1, y1 });
      // sky part gets a smooth fill, water part gets wave texture copied from beside it
      fillRows(x0, y0, x1, y1, unknown);
      const skyPart = new Uint8Array(n);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * W + x; if (unknown[i] && skyAt(x, y) > 0.5) skyPart[i] = 1; }
      fillSmooth(x0, y0, x1, y1, skyPart);
      out.floaters.push(cutSprite(x0, y0, x1, y1, unknown, 0.05, 0.16, 1));
    }
  }

  // ------------------------------------------------------------ outputs
  const baseCv = document.createElement('canvas'); baseCv.width = W; baseCv.height = H;
  baseCv.getContext('2d').putImageData(new ImageData(base, W, H), 0, 0);
  // hole mask (feathered), RGB packed; computed at reduced size for the GPU
  const hw = Math.min(512, W), hh = Math.round(H * hw / W);
  const hm = new Uint8Array(hw * hh * 4);
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(hw * hh);
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
      const sx = Math.min(W - 1, Math.floor(x * W / hw)), sy = Math.min(H - 1, Math.floor(y * H / hh));
      let m = 0; // max over the source footprint so thin bird strokes survive downscaling
      const fx = Math.ceil(W / hw), fy = Math.ceil(H / hh);
      for (let yy = 0; yy < fy; yy++) for (let xx = 0; xx < fx; xx++) { const i = Math.min(n - 1, (sy + yy) * W + sx + xx); if (hole[i * 3 + c] > m) m = hole[i * 3 + c]; }
      ch[y * hw + x] = m;
    }
    const bl = boxBlur(ch, hw, hh, 1);
    for (let i = 0; i < hw * hh; i++) hm[i * 4 + c] = Math.min(255, Math.max(ch[i], bl[i] * 1.5) * 255);
  }
  for (let i = 0; i < hw * hh; i++) hm[i * 4 + 3] = 255;
  out.base = baseCv;
  out.holeMask = { data: hm, w: hw, h: hh };
  out.ms = Math.round(performance.now() - t0);
  return out;
}

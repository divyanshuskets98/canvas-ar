// Pixel-level scene analysis. Turns a canvas image into a "scene graph":
// soft region masks (sky / water / vegetation / snow / glow), light-source blobs
// (flames, fairy lights, stars, windows, sun/moon), a skyline profile and global cues.
// Everything is in normalised image coordinates: nx → right, ny → down, both 0..1.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function toCanvas(src, maxW) {
  const w0 = src.naturalWidth || src.videoWidth || src.width;
  const h0 = src.naturalHeight || src.videoHeight || src.height;
  const s = Math.min(1, maxW / w0);
  const w = Math.max(8, Math.round(w0 * s));
  const h = Math.max(8, Math.round(h0 * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data };
}

function hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return [h, mx > 0 ? d / mx : 0, mx];
}

// Separable box blur on a Float32Array (w*h) with radius r.
function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function channels(img) {
  const { w, h, data } = img, n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  const H = new Float32Array(n), S = new Float32Array(n), V = new Float32Array(n), L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255, g = data[i * 4 + 1] / 255, b = data[i * 4 + 2] / 255;
    R[i] = r; G[i] = g; B[i] = b;
    const [hh, ss, vv] = hsv(r, g, b);
    H[i] = hh; S[i] = ss; V[i] = vv;
    L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { w, h, n, R, G, B, H, S, V, L };
}

function sobel(L, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const a = L[i - w - 1], b = L[i - w], c = L[i - w + 1], d = L[i - 1], f = L[i + 1], g = L[i + w - 1], hh = L[i + w], k = L[i + w + 1];
    const X = (c + 2 * f + k) - (a + 2 * d + g);
    const Y = (g + 2 * hh + k) - (a + 2 * b + c);
    gx[i] = X; gy[i] = Y; mag[i] = Math.hypot(X, Y);
  }
  return { gx, gy, mag };
}

// ---------------------------------------------------------------- regions
function segmentRegions(c) {
  const { w, h, n, H, S, V, L, R, G, B } = c;
  const { gx, gy, mag } = sobel(L, w, h);
  const tex = boxBlur(mag, w, h, 2);
  const eH = boxBlur(gy.map(Math.abs), w, h, 3); // horizontal structures (gradient in y)
  const eV = boxBlur(gx.map(Math.abs), w, h, 3);

  // --- sky: flood fill from the top row through smooth, colour-coherent pixels
  const sky = new Float32Array(n);
  const seen = new Uint8Array(n);
  const q = new Int32Array(n);
  let qh = 0, qt = 0;
  // seed colour = median-ish of top rows
  let sr = 0, sg = 0, sb = 0, sc = 0;
  for (let y = 0; y < Math.max(2, h * 0.06); y++) for (let x = 0; x < w; x++) { const i = y * w + x; sr += R[i]; sg += G[i]; sb += B[i]; sc++; }
  sr /= sc; sg /= sc; sb /= sc;
  const texMed = [...tex].sort((a, b) => a - b)[Math.floor(n * 0.5)];
  const gradTol = Math.max(0.12, texMed * 2.2);
  for (let x = 0; x < w; x++) { const i = x; if (tex[i] < gradTol * 1.5) { q[qt++] = i; seen[i] = 1; } }
  let mr = sr, mg = sg, mb = sb, cnt = 1;
  while (qh < qt) {
    const i = q[qh++];
    sky[i] = 1;
    mr += (R[i] - mr) / (cnt + 1); mg += (G[i] - mg) / (cnt + 1); mb += (B[i] - mb) / (cnt + 1); cnt++;
    const x = i % w, y = (i / w) | 0;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of nb) {
      if (j < 0 || seen[j]) continue;
      const yy = (j / w) | 0;
      if (yy > h * 0.82) continue;
      const step = Math.abs(L[j] - L[i]) + Math.abs(R[j] - R[i]) * 0.5 + Math.abs(B[j] - B[i]) * 0.5;
      const dMean = Math.abs(R[j] - mr) + Math.abs(G[j] - mg) + Math.abs(B[j] - mb);
      const cloudy = S[j] < 0.22 && V[j] > 0.55; // white/grey clouds belong to the sky
      if (step < 0.09 && (tex[j] < gradTol || cloudy) && (dMean < 0.55 || cloudy)) { seen[j] = 1; q[qt++] = j; }
    }
  }
  // close small holes (stars, birds, cloud edges) – dilate then erode
  let skyS = boxBlur(sky, w, h, 2);
  for (let i = 0; i < n; i++) skyS[i] = skyS[i] > 0.35 ? 1 : 0;
  skyS = boxBlur(skyS, w, h, 2);
  for (let i = 0; i < n; i++) skyS[i] = skyS[i] > 0.65 ? 1 : 0;

  // skyline profile: lowest sky row per column; cloud-like pixels above it join the sky
  const skyline = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    // lowest sky row reachable from the top with gaps (sun, birds, lights) of < 15% height
    let low = -1, gap = 0;
    for (let y = 0; y < h; y++) {
      const i = y * w + x;
      const cloudLike = S[i] < 0.28 && V[i] > 0.55 && y < h * 0.6;
      if (skyS[i] > 0.5) { low = y; gap = 0; } else if (cloudLike && (low >= 0 || y < h * 0.25)) { gap = 0; } else if (++gap > h * 0.15) break;
    }
    for (let y = 0; y < low; y++) skyS[y * w + x] = 1;
    skyline[x] = (low + 1) / h;
  }
  const skyArea = skyS.reduce((a, b) => a + b, 0) / n;

  // --- water: bluish/teal or grey-reflective, below the skyline, horizontally structured
  const water = new Float32Array(n);
  const colMean = new Float32Array(w);
  for (let x = 0; x < w; x++) { let a = 0, k = 0; for (let y = Math.floor(h * 0.55); y < h; y++) { a += L[y * w + x]; k++; } colMean[x] = a / Math.max(1, k); }
  for (let i = 0; i < n; i++) {
    const x = i % w, y = ((i / w) | 0) / h;
    if (skyS[i] > 0.5 || y < skyline[x] - 0.01) continue;
    const hue = H[i];
    if (V[i] < 0.2) continue;
    const blue = (hue > 170 && hue < 250 && S[i] > 0.22) ? 1 : 0;
    // grey-blue reflective water (puddles, overcast lakes): must be low in the frame and lighter than its column's average
    const greyBlue = (hue > 160 && hue < 260 && S[i] > 0.06 && S[i] <= 0.22 && V[i] > 0.35 && y > 0.6 && L[i] > colMean[x] + 0.04) ? 0.7 : 0;
    const aniso = smooth(0.95, 1.6, (eH[i] + 0.01) / (eV[i] + 0.01));
    const flat = 1 - smooth(gradTol * 0.8, gradTol * 2.5, tex[i]);
    water[i] = Math.max(blue, greyBlue) * Math.max(aniso, flat * 0.8) * smooth(0.25, 0.45, y);
  }
  keepLargeComponents(water, w, h, 0.5, 0.012);
  // real water bodies are wide and sit low; drop tall/narrow or high components (blue walls, windows)
  filterComponents(water, w, h, 0.5, (c) => c.bw >= c.bh * 0.9 && c.cy / h > 0.3);

  // --- vegetation (green) & autumn foliage
  const veg = new Float32Array(n), autumn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (skyS[i] > 0.5 || water[i] > 0.5) continue;
    const hue = H[i];
    if (hue > 65 && hue < 170 && S[i] > 0.18 && V[i] > 0.1) veg[i] = smooth(0.18, 0.35, S[i]);
    if (hue > 12 && hue < 45 && S[i] > 0.45 && V[i] > 0.35 && tex[i] > texMed) autumn[i] = 1;
  }
  keepLargeComponents(veg, w, h, 0.5, 0.004);

  // --- snow: bright, desaturated ground
  const snow = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const y = ((i / w) | 0) / h;
    if (skyS[i] > 0.5) continue;
    if (S[i] < 0.12 && V[i] > 0.82 && B[i] >= R[i] - 0.02) snow[i] = smooth(0.3, 0.55, y);
  }
  keepLargeComponents(snow, w, h, 0.5, 0.02);

  // --- foreground structure / buildings: vertical straight edges outside sky
  let vertical = 0, horiz = 0, edgeCnt = 0;
  for (let i = 0; i < n; i++) {
    if (skyS[i] > 0.5 || mag[i] < 0.25) continue;
    const ax = Math.abs(gx[i]), ay = Math.abs(gy[i]);
    edgeCnt++;
    if (ax > ay * 3) vertical++; else if (ay > ax * 3) horiz++;
  }
  const rectilinear = edgeCnt ? (vertical + horiz) / edgeCnt : 0;

  return {
    sky: skyS, water, veg, snow, autumn, skyline, skyArea, tex, texMed, rectilinear,
    verticalRatio: edgeCnt ? vertical / edgeCnt : 0, seedSky: [mr, mg, mb],
  };
}

// Remove components failing a shape predicate ({bw, bh, cx, cy, size}).
function filterComponents(m, w, h, thr, keep) {
  const n = w * h, lab = new Int32Array(n).fill(-1), stack = new Int32Array(n), comps = [];
  for (let s = 0; s < n; s++) {
    if (m[s] < thr || lab[s] >= 0) continue;
    const id = comps.length; let sp = 0; stack[sp++] = s; lab[s] = id;
    let minx = w, maxx = 0, miny = h, maxy = 0, sx = 0, sy = 0, size = 0;
    while (sp) {
      const i = stack[--sp], x = i % w, y = (i / w) | 0; size++; sx += x; sy += y;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && lab[j] < 0 && m[j] >= thr) { lab[j] = id; stack[sp++] = j; }
    }
    comps.push(keep({ bw: maxx - minx + 1, bh: maxy - miny + 1, cx: sx / size, cy: sy / size, size }));
  }
  for (let i = 0; i < n; i++) if (lab[i] >= 0 && !comps[lab[i]]) m[i] = 0;
}

// Remove components of a soft mask smaller than minFrac of the image.
function keepLargeComponents(m, w, h, thr, minFrac) {
  const n = w * h, lab = new Int32Array(n).fill(-1), stack = new Int32Array(n);
  const sizes = [];
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (m[s] < thr || lab[s] >= 0) continue;
    let sp = 0, size = 0; stack[sp++] = s; lab[s] = id;
    while (sp) {
      const i = stack[--sp]; size++;
      const x = i % w, y = (i / w) | 0;
      if (x > 0 && lab[i - 1] < 0 && m[i - 1] >= thr) { lab[i - 1] = id; stack[sp++] = i - 1; }
      if (x < w - 1 && lab[i + 1] < 0 && m[i + 1] >= thr) { lab[i + 1] = id; stack[sp++] = i + 1; }
      if (y > 0 && lab[i - w] < 0 && m[i - w] >= thr) { lab[i - w] = id; stack[sp++] = i - w; }
      if (y < h - 1 && lab[i + w] < 0 && m[i + w] >= thr) { lab[i + w] = id; stack[sp++] = i + w; }
    }
    sizes.push(size); id++;
  }
  for (let i = 0; i < n; i++) if (lab[i] < 0 || sizes[lab[i]] < minFrac * n) m[i] = 0;
}

// ---------------------------------------------------------------- light sources
function findBlobs(c, regions, gridW, gridH) {
  const { w, h, n, L, H, S, V } = c;
  const Lm = boxBlur(L, w, h, Math.max(4, Math.round(w / 40)));
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const bright = L[i] > Math.max(0.55, Lm[i] + 0.2);
    const vivid = S[i] > 0.25 || L[i] > 0.82;
    if (bright && vivid) mask[i] = 1;
  }
  const lab = new Int32Array(n).fill(-1), stack = new Int32Array(n);
  const blobs = [];
  let tinyStars = 0;
  for (let s = 0; s < n; s++) {
    if (!mask[s] || lab[s] >= 0) continue;
    let sp = 0; stack[sp++] = s; lab[s] = blobs.length;
    let cnt = 0, sx = 0, sy = 0, minx = w, maxx = 0, miny = h, maxy = 0, sl = 0, ssat = 0, hx = 0, hy = 0, peak = 0, bgL = 0;
    while (sp) {
      const i = stack[--sp]; cnt++;
      const x = i % w, y = (i / w) | 0;
      sx += x; sy += y; sl += L[i]; ssat += S[i]; bgL += Lm[i];
      if (L[i] > peak) peak = L[i];
      const a = H[i] * Math.PI / 180; hx += Math.cos(a) * S[i]; hy += Math.sin(a) * S[i];
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (cnt > 40000) break;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) if (j >= 0 && mask[j] && lab[j] < 0) { lab[j] = blobs.length; stack[sp++] = j; }
    }
    if (cnt < 2) { if (peak > 0.6 && bgL / cnt < 0.3) tinyStars++; blobs.push(null); continue; }
    const bw = maxx - minx + 1, bh = maxy - miny + 1;
    let hue = Math.atan2(hy, hx) * 180 / Math.PI; if (hue < 0) hue += 360;
    blobs.push({
      nx: (sx / cnt + 0.5) / w, ny: (sy / cnt + 0.5) / h,
      top: miny / h, bottom: (maxy + 1) / h,
      nw: bw / w, nh: bh / h, area: cnt / n, px: cnt,
      fill: cnt / (bw * bh), elong: bh / bw,
      hue, sat: ssat / cnt, lum: sl / cnt, peak, bg: bgL / cnt,
    });
  }
  const list = blobs.filter(Boolean).filter((b) => b.area < 0.05);

  const skyAt = (nx, ny) => {
    const gx = Math.min(gridW - 1, Math.floor(nx * gridW)), gy = Math.min(gridH - 1, Math.floor(ny * gridH));
    return regions.sky[gy * gridW + gx];
  };
  const maskAt = (m, nx, ny) => {
    if (nx < 0 || ny < 0 || nx >= 1 || ny >= 1) return 0;
    return m[Math.floor(ny * gridH) * gridW + Math.floor(nx * gridW)];
  };
  for (const b of list) {
    const warm = (b.hue < 62 || b.hue > 345) && b.sat > 0.28;
    const inSky = skyAt(b.nx, b.ny) > 0.5;
    const r = Math.max(b.nw, b.nh) * 0.9 + 0.01;
    const ring = [[r, 0], [-r, 0], [0, r], [0, -r]].reduce((a, [dx, dy]) => a + (maskAt(regions.sky, b.nx + dx, b.ny + dy) > 0.5 ? 1 : 0), 0);
    const onWater = maskAt(regions.water, b.nx, b.ny) > 0.5;
    if (b.area > 0.0012 && b.fill > 0.5 && b.ny < 0.5 && b.elong > 0.7 && b.elong < 1.4 && ring >= 2) b.kind = b.sat < 0.3 ? 'moon' : 'sun';
    else if (onWater && b.bg > 0.2) b.kind = 'glint';
    else if (warm && b.elong > 1.25 && b.area > 0.00008 && b.area < 0.02 && b.ny > 0.15) b.kind = 'flame';
    else if (b.area < 0.00015 && b.sat < 0.3 && b.bg < 0.3 && inSky) b.kind = 'star';
    else if (b.fill > 0.8 && b.px >= 6 && b.area < 0.0015 && b.elong > 0.8 && b.elong < 2.5 && b.bg < 0.45) b.kind = 'window?';
    else if (b.area < 0.0016) b.kind = 'light';
    else b.kind = 'glow';
    b.contrast = b.lum - b.bg;
    b.color = hueToRgb(b.hue, Math.min(1, b.sat * 1.3), 1);
  }
  // windows sit in vertical stacks (floors); fairy-light strings are horizontal only
  const cand = list.filter((b) => b.kind === 'window?');
  for (const b of cand) {
    let stacked = 0;
    for (const o of cand) if (o !== b && Math.abs(o.nx - b.nx) < Math.max(b.nw, 0.004) * 0.8 && Math.abs(o.ny - b.ny) < b.nh * 5) stacked++;
    b.kind = stacked >= 1 ? 'window' : 'light';
  }
  const nWin = list.filter((b) => b.kind === 'window').length;
  if (nWin < 6) list.forEach((b) => { if (b.kind === 'window') b.kind = 'light'; });
  // flames come in modest numbers; dozens of warm elongated blobs are more likely texture
  const nFl = list.filter((b) => b.kind === 'flame').length;
  if (nFl > 40) list.forEach((b) => { if (b.kind === 'flame') b.kind = 'light'; });
  const res = list.sort((a, b) => b.area - a.area).slice(0, 400);
  res.tinyStars = tinyStars;
  return res;
}

export function hueToRgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

// ---------------------------------------------------------------- rain streaks
function streakCoherence(c) {
  const { w, h, L } = c;
  const { gx, gy } = sobel(L, w, h);
  const n = w * h, jxx = new Float32Array(n), jyy = new Float32Array(n), jxy = new Float32Array(n);
  for (let i = 0; i < n; i++) { jxx[i] = gx[i] * gx[i]; jyy[i] = gy[i] * gy[i]; jxy[i] = gx[i] * gy[i]; }
  const Jxx = boxBlur(jxx, w, h, 2), Jyy = boxBlur(jyy, w, h, 2), Jxy = boxBlur(jxy, w, h, 2);
  // thin bright near-vertical lines: brighter than horizontal neighbours
  let thin = 0, total = 0, cx = 0, cy = 0;
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x;
    const ridge = L[i] - 0.5 * (L[i - 2] + L[i + 2]);
    const along = Math.abs(L[i - 2 * w] - L[i + 2 * w]);
    total++;
    if (ridge > 0.03 && along < ridge) {
      thin++;
      const a = Jxx[i] - Jyy[i], b = 2 * Jxy[i], m = Math.hypot(a, b) + 1e-6;
      cx += a / m; cy += b / m;
    }
  }
  return { density: thin / Math.max(1, total), coherence: thin ? Math.hypot(cx, cy) / thin : 0 };
}

// ---------------------------------------------------------------- main
// opts.grid / opts.blobRes: analysis resolutions (the admin pipeline uses higher values)
export function analyzeImage(src, { grid: gridRes = 160, blobRes = 512 } = {}) {
  const t0 = performance.now();
  const grid = toCanvas(src, gridRes);
  const c = channels(grid);
  const regions = segmentRegions(c);
  const hi = channels(toCanvas(src, blobRes));
  const blobs = findBlobs(hi, regions, c.w, c.h);
  const streak = streakCoherence(channels(toCanvas(src, 360)));

  // global stats
  let mL = 0, mS = 0, warm = 0, cool = 0, grey = 0, dark = 0;
  for (let i = 0; i < c.n; i++) {
    mL += c.L[i]; mS += c.S[i];
    if (c.S[i] < 0.15) grey++;
    if (c.L[i] < 0.22) dark++;
    if ((c.H[i] < 50 || c.H[i] > 330) && c.S[i] > 0.3) warm++;
    if (c.H[i] > 170 && c.H[i] < 260 && c.S[i] > 0.15) cool++;
  }
  const n = c.n;
  const stats = { meanL: mL / n, meanS: mS / n, warm: warm / n, cool: cool / n, grey: grey / n, dark: dark / n };

  // sky character from sky pixels
  let skL = 0, skS = 0, skWarm = 0, skBlue = 0, skN = 0;
  for (let i = 0; i < n; i++) if (regions.sky[i] > 0.5) {
    skN++; skL += c.L[i]; skS += c.S[i];
    if ((c.H[i] < 50 || c.H[i] > 320) && c.S[i] > 0.25) skWarm++;
    if (c.H[i] > 180 && c.H[i] < 250 && c.S[i] > 0.15) skBlue++;
  }
  const sky = skN ? { L: skL / skN, S: skS / skN, warm: skWarm / skN, blue: skBlue / skN } : { L: 0, S: 0, warm: 0, blue: 0 };
  sky.type = !skN ? 'none' : sky.L < 0.25 ? 'night' : sky.warm > 0.35 ? 'sunset' : (sky.S < 0.24 && sky.blue < 0.5 && sky.L < 0.8) ? 'overcast' : 'day';

  const area = (m) => m.reduce((a, b) => a + (b > 0.5 ? 1 : 0), 0) / n;
  let span = 0;
  for (let x = 0; x < c.w; x++) { for (let y = 0; y < c.h; y++) if (regions.water[y * c.w + x] > 0.5) { span++; break; } }
  const lightHues = new Set(blobs.filter((b) => b.kind === 'light' && b.sat > 0.4 && b.contrast > 0.25).map((b) => Math.floor(b.hue / 45)));
  const count = (k) => blobs.filter((b) => b.kind === k).length;
  const cues = {
    skyArea: regions.skyArea, waterArea: area(regions.water), vegArea: area(regions.veg),
    snowArea: area(regions.snow), autumnArea: area(regions.autumn),
    waterSpan: span / c.w, lightHueVariety: lightHues.size, glints: count('glint'),
    flames: count('flame'), lights: count('light'), tinyStars: blobs.tinyStars || 0, stars: count('star'), windows: count('window'),
    sun: count('sun'), moon: count('moon'), glows: count('glow'),
    rectilinear: regions.rectilinear, vertical: regions.verticalRatio,
    streakDensity: streak.density, streakCoherence: streak.coherence,
    skyType: sky.type, sky,
  };
  // horizon: median skyline over columns that actually have sky
  const sl = [...regions.skyline].filter((v) => v > 0.02).sort((a, b) => a - b);
  const horizon = sl.length > c.w * 0.3 ? sl[Math.floor(sl.length / 2)] : 0;

  return {
    gridW: c.w, gridH: c.h, aspect: c.h / c.w,
    masks: { sky: regions.sky, water: regions.water, veg: regions.veg, snow: regions.snow, autumn: regions.autumn },
    skyline: regions.skyline, horizon,
    blobs, stats, cues, ms: Math.round(performance.now() - t0),
  };
}

// Packed RGBA mask bytes (R=sky G=water B=vegetation A=snow), blurred for feathering.
// Row 0 = top of the image. Returned as raw bytes (not a 2D canvas) so the
// alpha channel is not premultiplied into the colour channels.
export function buildMaskData(scene) {
  const { gridW: w, gridH: h, masks } = scene;
  const blur = (m) => boxBlur(m, w, h, 1);
  const s = blur(masks.sky), wa = blur(masks.water), v = blur(masks.veg), sn = blur(masks.snow);
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = s[i] * 255; data[i * 4 + 1] = wa[i] * 255; data[i * 4 + 2] = v[i] * 255; data[i * 4 + 3] = sn[i] * 255;
  }
  return { data, w, h };
}

// Debug view of the masks (sky=blue, water=cyan, vegetation=green, snow=white).
export function maskPreviewCanvas(scene) {
  const { gridW: w, gridH: h, masks } = scene;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); const id = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const s = masks.sky[i], wa = masks.water[i], v = masks.veg[i], sn = masks.snow[i];
    id.data[i * 4] = 40 * s + 255 * sn; id.data[i * 4 + 1] = 90 * s + 200 * wa + 200 * v + 255 * sn; id.data[i * 4 + 2] = 230 * s + 230 * wa + 255 * sn; id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return cv;
}

export function sampleMask(scene, name, nx, ny) {
  const m = scene.masks[name]; if (!m) return 0;
  const x = Math.min(scene.gridW - 1, Math.max(0, Math.floor(nx * scene.gridW)));
  const y = Math.min(scene.gridH - 1, Math.max(0, Math.floor(ny * scene.gridH)));
  return m[y * scene.gridW + x];
}

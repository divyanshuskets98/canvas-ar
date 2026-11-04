import * as THREE from 'three';
import { understand, scoreThemes, THEME_LABELS } from './vision/classifier.js';
import { analyzeImage, maskPreviewCanvas } from './vision/analyzer.js';
import { Experience, BEHAVIOURS } from './sim/engine.js';
import { Soundscape } from './sim/audio.js';
import { PreviewSession } from './ar/preview.js';
import { Interaction } from './ui/interaction.js';
import { listCanvases, saveCanvas, deleteCanvas } from './storage.js';

const $ = (s) => document.querySelector(s);
const DEMOS = [
  { file: 'diwali.jpg', name: 'Diwali Night' }, { file: 'rain.jpg', name: 'Rainy City' }, { file: 'ocean.jpg', name: 'Seaside' },
  { file: 'forest.jpg', name: 'Valley Lake' }, { file: 'citynight.jpg', name: 'City at Night' },
];
const params = new URLSearchParams(location.search);

const app = {
  library: [], session: null, experiences: new Map(), records: [], activeIdx: -1, audio: new Soundscape(),
  interaction: null, settings: { masked: false, vision: false, stability: 'balanced', gain: 1 }, lastRecord: null,
};
window.canvasAR = app; // handy for debugging

// ------------------------------------------------------------------ navigation
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', goHome));
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('.sheet, .modal').hidden = true));
$('#btnAbout').onclick = () => ($('#about').hidden = false);

function goHome() {
  stopScanner(); stopStage();
  show('home'); renderLibrary();
}

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// ------------------------------------------------------------------ images & records
const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
const toBlob = (cv, q = 0.9) => new Promise((res) => cv.toBlob(res, 'image/jpeg', q));
function imageToCanvas(img, max = 1280) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
}
async function recordImage(rec) {
  if (!rec._img) rec._img = imageToCanvas(await loadImage(URL.createObjectURL(rec.image)));
  return rec._img;
}
function sceneFor(rec, img) {
  if (rec._scene) return rec._scene;
  const scene = analyzeImage(img);
  scene.ml = rec.ml || { labels: [], objects: [] };
  scene.objects = scene.ml.objects || [];
  scene.themes = scoreThemes(scene, scene.ml);
  scene.topThemes = Object.entries(scene.themes).filter(([, v]) => v >= 0.3).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return (rec._scene = scene);
}

// ------------------------------------------------------------------ home
async function renderLibrary() {
  app.library = await listCanvases();
  const el = $('#library');
  $('#libCount').textContent = app.library.length ? `(${app.library.length})` : '';
  $('#btnStart').textContent = app.library.length ? 'Start AR' : 'Start AR – scan a canvas';
  if (!app.library.length) { el.innerHTML = '<p class="empty">No canvases yet. Scan one, upload an artwork, or try a demo below.</p>'; return; }
  el.innerHTML = '';
  for (const rec of app.library) {
    const card = document.createElement('div'); card.className = 'card';
    const url = URL.createObjectURL(rec.image);
    card.innerHTML = `<img src="${url}" alt=""><div class="meta"><b></b><span class="tags"></span></div><div class="acts"><button class="btn" data-a="preview">Preview</button><button class="btn" data-a="del" aria-label="Delete">Delete</button></div>`;
    card.querySelector('b').textContent = rec.name;
    card.querySelector('.tags').textContent = (rec.themes || []).map((t) => THEME_LABELS[t] || t).slice(0, 3).join(' · ') || '—';
    card.querySelector('[data-a=preview]').onclick = () => startPreview(rec);
    card.querySelector('[data-a=del]').onclick = async () => { if (confirm(`Remove “${rec.name}”?`)) { await deleteCanvas(rec.id); renderLibrary(); } };
    el.appendChild(card);
  }
}
function renderDemos() {
  const el = $('#demos');
  for (const d of DEMOS) {
    const card = document.createElement('div'); card.className = 'card';
    card.innerHTML = `<img src="samples/${d.file}" alt=""><div class="meta"><b></b></div><div class="acts"><button class="btn" data-a="add">Add &amp; preview</button><a class="btn" href="samples/${d.file}" target="_blank" rel="noopener">Open</a></div>`;
    card.querySelector('b').textContent = d.name;
    card.querySelector('[data-a=add]').onclick = async () => {
      const existing = app.library.find((r) => r.demo === d.file);
      if (existing) return startPreview(existing);
      const img = await loadImage('samples/' + d.file);
      const rec = await processNew(imageToCanvas(img), { name: d.name, demo: d.file });
      if (rec) showProcessActions(rec);
    };
    el.appendChild(card);
  }
}
$('#btnStart').onclick = () => (app.library.length ? startAR(app.library) : openScanner());
$('#btnScan').onclick = openScanner;
$('#fileInput').onchange = async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const img = await loadImage(URL.createObjectURL(f));
  const rec = await processNew(imageToCanvas(img), { name: f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Artwork' });
  if (rec) showProcessActions(rec);
};
if (!window.isSecureContext) $('#secureWarn').hidden = false;

// ------------------------------------------------------------------ scanner
let scanStream = null, scanAspect = 1.5;
async function openScanner() {
  show('scan');
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    const v = $('#scanVideo'); v.srcObject = scanStream; await v.play();
    layoutGuide();
  } catch (e) {
    console.warn(e); alert('Camera unavailable (' + (e.name || e.message) + '). You can upload the artwork file instead.'); goHome();
  }
}
function stopScanner() { scanStream?.getTracks().forEach((t) => t.stop()); scanStream = null; }
function layoutGuide() {
  const g = $('#guide'), W = innerWidth, H = innerHeight;
  let w = W * 0.86, h = w / scanAspect;
  if (h > H * 0.6) { h = H * 0.6; w = h * scanAspect; }
  g.style.width = w + 'px'; g.style.height = h + 'px';
}
addEventListener('resize', () => { if ($('#scan').classList.contains('active')) layoutGuide(); });
$('#aspectSeg').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $('#aspectSeg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
  scanAspect = +b.dataset.aspect; layoutGuide();
};
$('#btnCapture').onclick = async () => {
  const v = $('#scanVideo'); if (!v.videoWidth) return;
  // map the on-screen guide rectangle into video pixels (video is object-fit: cover)
  const vr = v.getBoundingClientRect(), gr = $('#guide').getBoundingClientRect();
  const s = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight);
  const ox = (vr.width - v.videoWidth * s) / 2, oy = (vr.height - v.videoHeight * s) / 2;
  const sx = (gr.left - vr.left - ox) / s, sy = (gr.top - vr.top - oy) / s, sw = gr.width / s, sh = gr.height / s;
  const c = document.createElement('canvas'); c.width = Math.round(sw); c.height = Math.round(sh);
  c.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
  stopScanner();
  const rec = await processNew(imageToCanvas(c), { name: 'Canvas ' + (app.library.length + 1), scanned: true });
  if (rec) startAR(await listCanvases(), rec.id);
};

// ------------------------------------------------------------------ processing pipeline
function step(name, state) { const li = $(`#procSteps [data-step=${name}]`); li.className = state; }
async function processNew(canvas, meta) {
  show('process');
  $('#procActions').hidden = true; $('#procFound').innerHTML = ''; $('#procPct').textContent = '';
  ['vision', 'ml', 'target', 'compose'].forEach((s) => step(s, ''));
  $('#procThumb').src = canvas.toDataURL('image/jpeg', 0.8);
  try {
    step('vision', 'run');
    await new Promise((r) => setTimeout(r, 30));
    const useML = params.get('ml') !== '0';
    const scene = await understand(canvas, {
      useML, mlTimeout: 20000,
      onStage: (s) => { if (s.startsWith('Recog')) { step('vision', 'done'); step('ml', 'run'); } },
    });
    step('vision', 'done');
    step('ml', scene.ml.available ? 'done' : 'skip');
    if (!scene.ml.available && useML) $('#procSteps [data-step=ml]').textContent = 'Recognising objects (models unavailable – using on-device vision only)';
    renderFound($('#procFound'), scene);

    step('target', 'run');
    let target = null;
    try {
      const { compileTarget } = await import('./ar/tracker.js');
      target = await compileTarget(canvas, (p) => ($('#procPct').textContent = Math.round(p) + '%'));
      step('target', 'done');
    } catch (e) {
      console.error('target compile failed', e); step('target', 'skip');
      $('#procPct').textContent = '(failed – preview only)';
    }
    step('compose', 'run');
    const rec = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()),
      created: Date.now(), name: meta.name, demo: meta.demo, scanned: meta.scanned,
      image: await toBlob(canvas), target, aspect: canvas.height / canvas.width,
      themes: scene.topThemes, ml: { labels: scene.ml.labels, objects: scene.ml.objects },
    };
    rec._img = canvas; rec._scene = scene;
    await saveCanvas(stripTransient(rec));
    step('compose', 'done');
    app.library = await listCanvases();
    app.lastRecord = rec;
    return rec;
  } catch (e) {
    console.error(e); alert('Processing failed: ' + e.message); goHome(); return null;
  }
}
const stripTransient = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')));
function showProcessActions(rec) {
  $('#procActions').hidden = false;
  $('#btnProcAR').disabled = !rec.target;
  $('#btnProcAR').onclick = () => startAR(app.library, rec.id);
  $('#btnProcPreview').onclick = () => startPreview(rec);
}
function renderFound(el, scene) {
  el.innerHTML = '';
  const add = (t, dim) => { const s = document.createElement('span'); s.className = 'tag' + (dim ? ' dim' : ''); s.textContent = t; el.appendChild(s); };
  scene.topThemes.slice(0, 4).forEach((t) => add(THEME_LABELS[t] || t));
  const k = scene.cues;
  if (k.flames) add(`${k.flames} flame${k.flames > 1 ? 's' : ''}`, true);
  if (k.lights > 3) add(`${k.lights} lights`, true);
  if (k.windows) add(`${k.windows} windows`, true);
  if (k.waterArea > 0.02) add('water', true);
  if (k.skyArea > 0.05) add(k.skyType + ' sky', true);
  if (k.vegArea > 0.03) add('foliage', true);
  (scene.ml?.objects || []).slice(0, 3).forEach((o) => add(o.label, true));
  (scene.ml?.labels || []).slice(0, 2).forEach((l) => add('“' + l.name + '”', true));
}

// ------------------------------------------------------------------ stage (shared by AR & preview)
let loopRaf = 0;
function stopStage() {
  cancelAnimationFrame(loopRaf);
  app.interaction?.dispose(); app.interaction = null;
  for (const e of app.experiences.values()) e.dispose();
  app.experiences.clear();
  app.session?.stop(); app.session = null;
  app.audio.disable();
  $('#reticle').hidden = true;
  $('#settings').hidden = $('#addSheet').hidden = true;
}

async function buildExperience(rec, index) {
  const img = await recordImage(rec);
  const scene = sceneFor(rec, img);
  const exp = new Experience({ image: img, scene, audio: app.audio, quality: app.quality ?? 1, toast });
  exp.setMasked(app.settings.masked);
  exp.living.uniforms.uGain.value.setScalar(app.settings.gain);
  app.experiences.set(index, exp);
  if (app.settings.vision) toggleVision(exp, true);
  return exp;
}

function startLoop(onFrame) {
  let last = performance.now(), fpsAcc = 0, fpsN = 0, lowFor = 0;
  app.onFrame = onFrame;
  // test hook (?still=1): freeze the loop; window.stepSim(seconds) advances deterministically
  window.stepSim = (sec, n = Math.ceil(sec / 0.05)) => { for (let i = 0; i < n; i++) onFrame(sec / n); };
  if (params.get('still')) return;
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    onFrame(dt);
    // simple performance governor
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 2) { const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; if (fps < 32 && ++lowFor >= 2 && app.session?.renderer.getPixelRatio() > 1) { app.session.renderer.setPixelRatio(1); app.session.renderer.setSize(innerWidth, innerHeight, false); toast('Lowered resolution for smoother playback'); } else if (fps >= 32) lowFor = 0; }
    loopRaf = requestAnimationFrame(frame);
  };
  loopRaf = requestAnimationFrame(frame);
}

function setupInteraction() {
  app.interaction = new Interaction($('#arContainer'), {
    getCamera: () => app.session?.camera,
    getTarget: () => app.experiences.get(app.activeIdx)?.living.mesh,
    onTap: (nx, ny) => { const exp = app.experiences.get(app.activeIdx); if (!exp) return; app.audio.enabled || null; exp.tap(nx, ny); },
    onDrag: (dx, dy, dt) => app.experiences.get(app.activeIdx)?.drag(dx, dy, dt),
    onLongPress: (p) => { const exp = app.experiences.get(app.activeIdx); if (!exp) return; const h = exp.hitInfo(p.nx, p.ny); toast(describeHit(h)); },
  });
}
function describeHit(h) {
  const parts = [];
  if (h.blob && h.blobDist < 0.05) parts.push(h.blob.kind);
  if (h.sky > 0.5) parts.push('sky'); if (h.water > 0.5) parts.push('water'); if (h.veg > 0.5) parts.push('foliage'); if (h.snow > 0.5) parts.push('snow');
  return 'Here: ' + (parts.join(', ') || 'painted surface');
}

// ------------------------------------------------------------------ AR mode
async function startAR(records, focusId) {
  records = records.filter((r) => r.target);
  if (!records.length) { alert('No trackable canvases yet – scan or upload one first.'); return openScanner(); }
  stopStage(); show('stage');
  app.mode = 'ar'; app.records = records; app.activeIdx = -1;
  setStatus('Starting camera…');
  $('#chips').innerHTML = ''; $('#detected').innerHTML = '';
  try {
    const { ARSession, mergeTargets } = await import('./ar/tracker.js');
    const ordered = focusId ? [...records.filter((r) => r.id === focusId), ...records.filter((r) => r.id !== focusId)] : records;
    app.records = ordered;
    const merged = mergeTargets(ordered.map((r) => r.target));
    app.session = new ARSession($('#arContainer'), {
      targetBuffer: merged, stability: app.settings.stability,
      onFound: async (i) => {
        app.activeIdx = i;
        const exp = app.experiences.get(i) || await buildExperience(ordered[i], i);
        if (!exp.root.parent) app.session.stages[i].stage.add(exp.root);
        setStatus(ordered[i].name, true); $('#reticle').hidden = true;
        renderChips(exp);
        if (!exp._hinted) { exp._hinted = true; const h = exp.hints(); if (h.length) toast(h[0], 3500); }
      },
      onLost: () => { setStatus('Searching…'); setTimeout(() => { if (!app.session?.stages.some((s) => s.tracked)) $('#reticle').hidden = false; }, 800); },
    });
    await app.session.start(ordered.length);
    setStatus('Point at a canvas'); $('#reticle').hidden = false;
    // pre-build the focused canvas so it appears instantly
    buildExperience(ordered[0], 0).then((exp) => app.session?.stages[0].stage.add(exp.root));
    setupInteraction();
    startLoop((dt) => {
      if (!app.session) return;
      const presence = app.session.update(dt);
      app.experiences.forEach((exp, i) => { exp.setOpacity(presence[i] || 0); if (presence[i] > 0) exp.update(dt, app.session.camera); });
      app.session.render();
    });
  } catch (e) {
    console.error(e);
    setStatus('Camera / tracking failed');
    alert('Could not start AR: ' + (e?.message || e || 'camera permission denied?') + '\n\nCamera access needs HTTPS. You can still use Preview.');
    goHome();
  }
}

// ------------------------------------------------------------------ preview mode
async function startPreview(rec) {
  stopStage(); show('stage');
  app.mode = 'preview'; app.records = [rec]; app.activeIdx = 0;
  const img = await recordImage(rec);
  app.session = new PreviewSession($('#arContainer'), { aspect: img.height / img.width });
  const exp = await buildExperience(rec, 0);
  app.session.stage.add(exp.root);
  exp.setOpacity(1);
  setStatus(rec.name + ' · preview', true);
  renderChips(exp);
  setupInteraction();
  const h = exp.hints(); if (h.length) toast(h[0], 3500);
  startLoop((dt) => { if (!app.session) return; app.session.update(dt); exp.update(dt, app.session.camera); app.session.render(); });
  window.previewReady = true;
}

// ------------------------------------------------------------------ HUD
function setStatus(t, ok) { const s = $('#status'); s.textContent = t; s.classList.toggle('ok', !!ok); }

let selectedChip = null;
function renderChips(exp) {
  const el = $('#chips'); el.innerHTML = '';
  const det = $('#detected'); det.innerHTML = '';
  exp.scene.topThemes.slice(0, 4).forEach((t) => { const s = document.createElement('span'); s.className = 'tag'; s.textContent = THEME_LABELS[t] || t; det.appendChild(s); });
  const shown = exp.plan.filter((p) => p.auto || exp.active.has(p.b.id));
  for (const p of shown) {
    const c = document.createElement('button'); c.className = 'chip' + (exp.active.has(p.b.id) ? ' on' : ''); c.textContent = p.b.name;
    c.onclick = () => {
      if (exp.active.has(p.b.id) && selectedChip !== p.b.id) { selectChip(exp, p.b); return; }
      exp.enable(p.b.id, !exp.active.has(p.b.id)); renderChips(exp);
      if (exp.active.has(p.b.id)) { selectChip(exp, p.b); toast(p.b.hint); } else $('#intensity').hidden = true;
    };
    el.appendChild(c);
  }
  const add = document.createElement('button'); add.className = 'chip add'; add.textContent = '+ Add'; add.onclick = () => openAddSheet(exp); el.appendChild(add);
}
function selectChip(exp, b) {
  selectedChip = b.id;
  $('#intensity').hidden = false; $('#intLabel').textContent = b.name;
  const r = $('#intRange'); r.value = exp.intensity.get(b.id) ?? 0.8;
  r.oninput = () => exp.setIntensity(b.id, +r.value);
}
function openAddSheet(exp) {
  const list = $('#addList'); list.innerHTML = '';
  for (const p of exp.plan) {
    if (!p.available) continue;
    const it = document.createElement('button'); it.className = 'add-item' + (exp.active.has(p.b.id) ? ' on' : '');
    it.innerHTML = `<b></b><small></small>`;
    it.querySelector('b').textContent = p.b.name;
    it.querySelector('small').textContent = `${p.b.group} · fit ${Math.round(p.score * 100)}%`;
    it.onclick = () => { exp.enable(p.b.id, !exp.active.has(p.b.id)); if (exp.active.has(p.b.id)) p.auto = p.auto || true; it.classList.toggle('on', exp.active.has(p.b.id)); renderChips(exp); };
    list.appendChild(it);
  }
  $('#addSheet').hidden = false;
}

$('#btnSound').onclick = async () => {
  const b = $('#btnSound');
  if (app.audio.enabled) { app.audio.disable(); b.classList.remove('on'); }
  else if (await app.audio.enable()) { b.classList.add('on'); toast('Sound on'); }
};
$('#btnSettings').onclick = () => ($('#settings').hidden = false);
$('#optMasked').onchange = (e) => { app.settings.masked = e.target.checked; app.experiences.forEach((x) => x.setMasked(app.settings.masked)); };
$('#optVision').onchange = (e) => { app.settings.vision = e.target.checked; app.experiences.forEach((x) => toggleVision(x, app.settings.vision)); };
$('#optGain').oninput = (e) => { app.settings.gain = +e.target.value; app.experiences.forEach((x) => x.living.uniforms.uGain.value.setScalar(app.settings.gain)); };
$('#optStability').onchange = (e) => { app.settings.stability = e.target.value; if (app.mode === 'ar') { $('#settings').hidden = true; startAR(app.records); } };

// "What the AI sees": mask colours + light-source boxes drawn over the canvas
function toggleVision(exp, on) {
  if (exp._vision) { exp.root.remove(exp._vision); exp._vision.material.map.dispose(); exp._vision.material.dispose(); exp._vision = null; }
  if (!on) return;
  const s = exp.scene, W = 640, H = Math.round(640 * s.aspect);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.globalAlpha = 0.45; x.imageSmoothingEnabled = true; x.drawImage(maskPreviewCanvas(s), 0, 0, W, H); x.globalAlpha = 1;
  const col = { flame: '#ff3b30', light: '#34c759', star: '#ffffff', window: '#ffd60a', sun: '#ff2d92', moon: '#64d2ff', glow: '#0a84ff', glint: '#8e8e93' };
  x.lineWidth = 2; x.font = '12px system-ui';
  for (const b of s.blobs) { x.strokeStyle = col[b.kind] || '#fff'; x.strokeRect((b.nx - b.nw / 2) * W - 2, (b.ny - b.nh / 2) * H - 2, Math.max(4, b.nw * W) + 4, Math.max(4, b.nh * H) + 4); }
  for (const o of s.objects || []) { x.strokeStyle = '#bf5af2'; x.strokeRect(o.box.nx * W, o.box.ny * H, o.box.nw * W, o.box.nh * H); x.fillStyle = '#bf5af2'; x.fillText(o.label, o.box.nx * W + 3, o.box.ny * H + 13); }
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, s.aspect), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.position.z = 0.03; m.renderOrder = 10;
  exp.root.add(m); exp._vision = m;
}

// ------------------------------------------------------------------ boot
renderDemos();
renderLibrary().then(async () => {
  // test hook: ?preview=diwali opens a demo canvas in preview mode directly
  const demo = params.get('preview');
  if (demo) {
    const d = DEMOS.find((x) => x.file.startsWith(demo)) || DEMOS[0];
    const img = await loadImage('samples/' + d.file);
    const c = imageToCanvas(img);
    const rec = { id: 'demo-' + d.file, name: d.name, image: await toBlob(c), _img: c, ml: null };
    if (params.get('ml') !== '0') { const sc = await understand(c, { useML: true, mlTimeout: 8000 }); rec._scene = sc; }
    await startPreview(rec);
    if (params.get('vision') === '1') toggleVision(app.experiences.get(0), true);
  }
});

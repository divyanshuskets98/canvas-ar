// Admin-side processing of one scan, run automatically in the admin's browser:
//  1. analyse the canvas (finer light-source pass + object recognition models)
//  2. find painted objects to animate in place and compose the simulation plan
//  3. optionally generate a generative AI clip on the admin's own PC (ComfyUI, free)
//  4. render a preview video for the dashboard
//  5. upload a result package that the phone downloads and plays on the canvas
import * as THREE from 'three';
import { analyzeImage } from '../vision/analyzer.js';
import { scoreThemes } from '../vision/classifier.js';
import { recognise } from '../vision/models.js';
import { extractObjects } from '../vision/objects.js';
import { serializeScene } from '../vision/serialize.js';
import { Experience } from '../sim/engine.js';
import { uploadFile, publicUrl, updateScan } from '../backend/client.js';
import { comfyGenerate } from './comfy.js';

const loadImage = (src) => new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('could not load scan image')); i.src = src; });
function toCanvas(img, max = 1280) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, s = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * s); c.height = Math.round(h * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); return c;
}

// A text description of the motion that fits this canvas – used as the generative prompt
export function motionPrompt(scene, objects, plan) {
  const on = new Set(plan.map((p) => p.id)), parts = [];
  if (objects.birds.length) parts.push(`the ${objects.birds.length > 1 ? objects.birds.length + ' birds' : 'bird'} flap their wings and glide gently in place`);
  if (on.has('flames')) parts.push('the lamp flames flicker softly');
  if (on.has('fairy')) parts.push('the string lights twinkle');
  if (on.has('water')) parts.push(scene.themes.ocean > 0.45 ? 'gentle ocean waves roll and sparkle' : 'the water ripples softly');
  if (objects.floaters.length) parts.push('the boat rocks slowly on the water');
  if (objects.clouds.length || on.has('clouds')) parts.push('clouds drift slowly');
  if (on.has('foliage')) parts.push('trees and grass sway in a light breeze');
  if (on.has('rain')) parts.push('rain falls');
  if (on.has('snow')) parts.push('snow falls softly');
  if (on.has('windows')) parts.push('a few windows switch on and off');
  if (on.has('stars')) parts.push('stars twinkle');
  const motion = parts.length ? parts.join(', ') : 'subtle natural motion of the elements in the scene';
  return `Animate this painting: ${motion}. Keep the exact composition, colours, objects and art style of the original image. Static camera, no zoom, no new objects, smooth seamless loop.`;
}

async function renderPreview(canvas, scene, objects, plan, seconds = 4) {
  if (typeof MediaRecorder === 'undefined') return null;
  const W = 640, H = Math.round(640 * canvas.height / canvas.width);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(W, H, false);
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 20);
  cam.position.set(0, 0, (scene.aspect / 2) / Math.tan(THREE.MathUtils.degToRad(15)));
  const s3 = new THREE.Scene();
  const exp = new Experience({ image: canvas, scene, objects, plan });
  exp.setOpacity(1); s3.add(exp.root);
  const stream = renderer.domElement.captureStream(30);
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) { exp.dispose(); renderer.dispose(); return null; }
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_500_000 });
  const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(250);
  const t0 = performance.now(); let last = t0;
  await new Promise((resolve) => {
    const frame = (now) => {
      exp.update(Math.min(0.1, (now - last) / 1000), cam); last = now;
      renderer.render(s3, cam);
      if (now - t0 < seconds * 1000) requestAnimationFrame(frame); else resolve();
    };
    requestAnimationFrame(frame);
  });
  rec.stop(); await done;
  exp.dispose(); renderer.dispose();
  return new Blob(chunks, { type: type.split(';')[0] });
}

export async function processScan(scan, { worker, comfy, useML = true, onStatus = () => {} }) {
  const t0 = performance.now();
  const dir = `results/${scan.id}`;
  onStatus('Downloading scan…');
  const canvas = toCanvas(await loadImage(publicUrl(scan.image_path) + `?t=${Date.now()}`));

  onStatus('Analysing scene…');
  const scene = analyzeImage(canvas, { grid: 160, blobRes: 768 });
  onStatus('Recognising objects…');
  let ml = { labels: [], objects: [], available: false, errors: [] };
  if (useML) { try { ml = await recognise(canvas, { timeout: 30000 }); } catch (e) { ml.errors = [String(e)]; } }
  scene.ml = ml; scene.objects = ml.objects;
  scene.themes = scoreThemes(scene, ml);
  scene.topThemes = Object.entries(scene.themes).filter(([, v]) => v >= 0.3).sort((a, b) => b[1] - a[1]).map(([k]) => k);

  onStatus('Finding painted objects to animate…');
  const objects = extractObjects(canvas, scene);
  // compose the plan exactly as the phone would, but from the admin's (richer) analysis
  const probe = new Experience({ image: canvas, scene, objects });
  const plan = [...probe.active.keys()].map((id) => ({ id, intensity: +(probe.intensity.get(id) || 0.8).toFixed(2) }));
  probe.dispose();
  const prompt = motionPrompt(scene, objects, plan);

  let video = null, aiNote = null;
  if (comfy?.enabled && comfy.workflow) {
    try {
      const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      const w = Math.round(Math.min(768, canvas.width) / 32) * 32, h = Math.round(w * canvas.height / canvas.width / 32) * 32;
      const clip = await comfyGenerate(comfy, png, { prompt, width: w, height: h, onStatus });
      if (clip.type.startsWith('video/')) {
        const ext = clip.type.includes('webm') ? 'webm' : 'mp4';
        await uploadFile(`${dir}/animation.${ext}`, clip.blob, clip.type, { admin: true, upsert: true });
        video = `${dir}/animation.${ext}`;
      } else aiNote = 'ComfyUI returned ' + clip.type + ' – set the workflow output to an MP4/WebM video';
    } catch (e) { aiNote = 'AI video skipped: ' + e.message; }
  }

  onStatus('Rendering preview…');
  let preview = null;
  try {
    const pv = await renderPreview(canvas, scene, objects, video ? [] : plan);
    if (pv && pv.size > 1000) { preview = `${dir}/preview.${pv.type.includes('mp4') ? 'mp4' : 'webm'}`; await uploadFile(preview, pv, pv.type, { admin: true, upsert: true }); }
  } catch (e) { console.warn('preview failed', e); }

  onStatus('Uploading result…');
  const ser = await serializeScene(scene);
  await uploadFile(`${dir}/masks-a.png`, ser.masksA, 'image/png', { admin: true, upsert: true });
  await uploadFile(`${dir}/masks-b.png`, ser.masksB, 'image/png', { admin: true, upsert: true });
  const manifest = {
    version: 1, scanId: scan.id, createdAt: new Date().toISOString(), worker, generator: 'canvas-ar-admin/2',
    scene: ser.json, masksA: `${dir}/masks-a.png`, masksB: `${dir}/masks-b.png`,
    plan: video ? [] : plan, mode: video ? 'video' : 'live', video, preview, prompt, aiNote,
    summary: { themes: scene.topThemes, birds: objects.birds.length, boats: objects.floaters.length, clouds: objects.clouds.length, flames: scene.cues.flames, labels: ml.labels.slice(0, 3).map((l) => l.name) },
    ms: Math.round(performance.now() - t0),
  };
  await uploadFile(`${dir}/manifest.json`, new Blob([JSON.stringify(manifest)], { type: 'application/json' }), 'application/json', { admin: true, upsert: true });
  await updateScan(scan.id, { status: 'done', result_path: `${dir}/manifest.json`, error: aiNote });
  return manifest;
}

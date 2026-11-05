import * as THREE from 'three';
import { LivingCanvas } from './livingCanvas.js';
import { toImage, clamp } from './common.js';
import { sampleMask, buildMaskData } from '../vision/analyzer.js';
import { Flames, FairyLights, Windows, Glow } from './behaviours/lights.js';
import { Rain, Snow, Clouds, Stars, Nightfall } from './behaviours/weather.js';
import { Birds, Fireflies, Foliage, Motes } from './behaviours/life.js';
import { Water, Fireworks, Traffic } from './behaviours/scene.js';
import { PaintedBirds, Floaters, CloudDrift } from './behaviours/objects.js';
import { FallingLeaves } from './behaviours/life.js';
import { extractObjects } from '../vision/objects.js';

// Every behaviour scores itself against the scene graph; the composer turns on
// the ones that fit (plus any the user adds). New behaviours only need to be
// added to this list – nothing else is theme-specific.
//
// "Preserve" principle: behaviours that animate what is already painted (flames,
// bulbs, water, foliage, sky, painted birds/boats/clouds) switch on automatically.
// Behaviours that ADD things that aren't in the picture (extra birds, fireworks,
// fireflies, motes, traffic, falling leaves) score 0 and are only available via "+ Add".
export const BEHAVIOURS = [Flames, FairyLights, Windows, Glow, Water, Floaters, PaintedBirds, CloudDrift, Foliage, Clouds, Rain, Snow, Stars,
  Fireworks, Traffic, Birds, Fireflies, FallingLeaves, Nightfall, Motes];
const AUTO_THRESHOLD = 0.45;

export function planBehaviours(scene, objects) {
  const scored = BEHAVIOURS.map((b) => ({ b, score: clamp(b.score(scene, objects) || 0, 0, 1), available: !!b.available(scene, objects) }));
  // rain and snow compete – keep the stronger one
  const rain = scored.find((s) => s.b === Rain), snow = scored.find((s) => s.b === Snow);
  if (rain.score >= AUTO_THRESHOLD && snow.score >= AUTO_THRESHOLD) (rain.score > snow.score ? snow : rain).score = 0.3;
  for (const s of scored) s.auto = s.score >= AUTO_THRESHOLD;
  return scored;
}

export class Experience {
  constructor({ image, scene, audio, quality = 1, toast, objects, plan, video, videoMask }) {
    this.scene = scene;
    this.aspect = scene.aspect;
    if (!scene.maskData) scene.maskData = buildMaskData(scene);
    this.root = new THREE.Group();
    this.video = video || null;
    // With a motion mask the original painting stays as the base and the AI video only shows
    // through where it actually moves (eyes, flames, water…). Without one the video covers all.
    if (video && !videoMask) videoMask = { data: new Uint8Array([255, 255, 255, 255]), w: 1, h: 1 }; // no mask → whole clip
    const masked = !!video;
    this.texture = video && !masked ? new THREE.VideoTexture(video) : new THREE.CanvasTexture(image);
    this.texture.minFilter = THREE.LinearFilter; this.texture.generateMipmaps = false;
    // cut out painted birds / boats / clouds so they can be animated where they are
    // (not needed when an AI-generated video already animates the whole canvas)
    try { this.objects = video ? { birds: [], floaters: [], clouds: [] } : objects || extractObjects(image, scene); }
    catch (e) { console.warn('object extraction failed', e); this.objects = { birds: [], floaters: [], clouds: [] }; }
    this.baseTexture = masked ? new THREE.VideoTexture(video) : this.objects.base ? new THREE.CanvasTexture(this.objects.base) : null;
    if (this.baseTexture) { this.baseTexture.minFilter = THREE.LinearFilter; this.baseTexture.generateMipmaps = false; }
    this.living = new LivingCanvas({ texture: this.texture, baseTexture: this.baseTexture, holeMask: masked ? videoMask : this.objects.holeMask, scene });
    if (masked) this.living.uniforms.uHoleOn.value.set(1, 0, 0);
    this.root.add(this.living.mesh);
    this.sampler = makeSampler(image);
    this.wind = new THREE.Vector2(0.3, 0);
    this.camLocal = { value: new THREE.Vector3(0, 0, 2) };
    this._v = new THREE.Vector3();
    this.baseWind = new THREE.Vector2(0.3, 0);
    this.time = 0;
    this.opacity = 0;
    this.active = new Map();
    this.intensity = new Map();
    this.lightFree = Array.from({ length: this.living.nLights }, (_, i) => i);
    const self = this;
    this.ctx = {
      root: this.root, scene, aspect: this.aspect, living: this.living, wind: this.wind, camLocal: this.camLocal, objects: this.objects, audio, quality, toast,
      get time() { return self.time; }, get opacity() { return self.opacity; },
      mask: (name, nx, ny) => sampleMask(scene, name, nx, ny),
      sampleRing: (nx, ny, r) => this.sampler.ring(nx, ny, r),
      allocLight: () => (this.lightFree.length ? this.lightFree.shift() : -1),
      freeLight: (i) => { if (i >= 0) { this.living.uniforms.uLights.value[i].set(0, 0, 0, 0); this.lightFree.push(i); } },
      setLight: (i, nx, ny, r, k, c) => { if (i < 0) return; this.living.uniforms.uLights.value[i].set(nx, ny, r, k); this.living.uniforms.uLightColors.value[i].set(c[0], c[1], c[2]); },
    };
    this.plan = planBehaviours(scene, this.objects);
    if (plan) { // plan supplied by the admin pipeline: [{id, intensity}]
      for (const p of this.plan) { const e = plan.find((x) => x.id === p.b.id); p.auto = !!e; }
      for (const e of plan) if (this.plan.find((p) => p.b.id === e.id)?.available !== false) this.enable(e.id, true, e.intensity);
    } else for (const p of this.plan) if (p.auto) this.enable(p.b.id, true, clamp(0.55 + p.score * 0.45, 0, 1));
  }

  enable(id, on, intensity) {
    const def = BEHAVIOURS.find((b) => b.id === id); if (!def) return;
    if (on && !this.active.has(id)) {
      try {
        const inst = def.create(this.ctx);
        this.active.set(id, inst);
        const v = intensity ?? this.intensity.get(id) ?? 0.8;
        this.intensity.set(id, v); inst.setIntensity?.(v); inst.setOpacity?.(this.opacity);
      } catch (e) { console.error('behaviour failed', id, e); }
    } else if (!on && this.active.has(id)) {
      this.active.get(id).dispose(); this.active.delete(id);
    }
  }
  setIntensity(id, v) { this.intensity.set(id, v); this.active.get(id)?.setIntensity?.(v); }
  setOpacity(o) { this.opacity = o; this.living.uniforms.uOpacity.value = o; for (const b of this.active.values()) b.setOpacity?.(o); }
  setMasked(m) { this.living.uniforms.uMasked.value = m ? 1 : 0; }

  update(dt, camera) {
    dt = Math.min(dt, 0.1);
    // seamless loop: the clip starts on the painting itself, so fade the moving parts back
    // into the still painting just before the clip ends and out of it just after it restarts
    if (this.video) {
      const d = this.video.duration, t = this.video.currentTime;
      this.living.uniforms.uHoleGain.value = isFinite(d) && d > 1 ? Math.min(1, t / 0.35, Math.max(0, d - t) / 0.5) : 1;
    }
    if (camera) { this.root.updateWorldMatrix(true, false); camera.getWorldPosition(this._v); this.camLocal.value.copy(this.root.worldToLocal(this._v)); }
    this.time += dt;
    const t = this.time, U = this.living.uniforms;
    U.uTime.value = t;
    // shared uniforms that behaviours combine with max() are reset every frame
    U.uCloudAmt.value = 0; U.uCloudDark.value = 0; U.uCloudCover.value = 0.3; U.uFlash.value = 0; U.uStars.value = 0;
    // wind relaxes back to a gentle breeze
    this.wind.lerp(this.baseWind, Math.min(1, dt * 0.6));
    for (const [id, b] of this.active) { try { b.update(dt, t); } catch (e) { console.error(id, e); this.enable(id, false); } }
  }

  hitInfo(nx, ny) {
    const s = this.scene;
    let near = null, nd = 1e9;
    for (const b of s.blobs) { const d = Math.hypot(b.nx - nx, (b.ny - ny) * this.aspect); if (d < nd) { nd = d; near = b; } }
    return {
      nx, ny, local: new THREE.Vector3(nx - 0.5, (0.5 - ny) * this.aspect, 0),
      sky: sampleMask(s, 'sky', nx, ny), water: sampleMask(s, 'water', nx, ny), veg: sampleMask(s, 'veg', nx, ny), snow: sampleMask(s, 'snow', nx, ny),
      blob: near, blobDist: nd,
    };
  }
  // Route a tap to the behaviour that claims it most strongly; water always ripples too.
  tap(nx, ny) {
    const hit = this.hitInfo(nx, ny);
    let best = null, bs = 0;
    for (const [id, b] of this.active) { const s = b.tapScore?.(hit) || 0; if (s > bs) { bs = s; best = b; } }
    if (best) best.onTap(hit);
    if (best !== this.active.get('water') && hit.water > 0.4) this.living.addRipple(nx, ny, 0.9, this.time);
    return hit;
  }
  // Drag in image-space units → wind (canvas space, y up)
  drag(dnx, dny, dt) {
    const k = 1 / Math.max(0.016, dt);
    this.wind.x = clamp(this.wind.x + dnx * k * 0.08, -3, 3);
    this.wind.y = clamp(this.wind.y - dny * k * 0.02, -1, 1);
  }
  hints() { return [...this.active.keys()].map((id) => BEHAVIOURS.find((b) => b.id === id)?.hint).filter(Boolean); }

  dispose() {
    for (const id of [...this.active.keys()]) this.enable(id, false);
    this.living.dispose(); this.texture.dispose(); this.baseTexture?.dispose();
    if (this.video) { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); }
  }
}

// CPU colour sampler for the captured image (used to colour "off" bulbs etc.)
function makeSampler(image) {
  const w = 256, h = Math.round(256 * (image.height || image.naturalHeight) / (image.width || image.naturalWidth));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(image, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const at = (nx, ny) => { const X = clamp(Math.floor(nx * w), 0, w - 1), Y = clamp(Math.floor(ny * h), 0, h - 1), i = (Y * w + X) * 4; return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]; };
  return {
    at,
    ring(nx, ny, r) {
      // darkest-ish colour around a point = the background behind a light
      const samples = [];
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; samples.push(at(nx + Math.cos(a) * r, ny + Math.sin(a) * r * (w / h))); }
      samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
      const m = samples.slice(0, 4);
      return [0, 1, 2].map((k) => m.reduce((s, v) => s + v[k], 0) / m.length);
    },
  };
}

export { toImage };

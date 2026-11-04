import * as THREE from 'three';
import { Compiler } from '../../vendor/mindar/mindar-image.prod.js';

// ---------------------------------------------------------------- target compilation
// Compiles one image into MindAR tracking data in the browser (no server, no .mind upload).
export async function compileTarget(img, onProgress) {
  const c = new Compiler();
  // keep compile time reasonable on phones: ~720px on the long side
  const src = downscale(img, 720);
  await c.compileImageTargets([src], (p) => onProgress?.(Math.min(100, p)));
  return c.exportData(); // Uint8Array
}

// Merge several single-target buffers into one multi-target buffer (index order preserved).
export function mergeTargets(buffers) {
  const c = new Compiler();
  const all = [];
  for (const b of buffers) all.push(...new Compiler().importData(b));
  c.data = all;
  return c.exportData();
}

function downscale(img, max) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const s = Math.min(1, max / Math.max(w, h));
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * s); cv.height = Math.round(h * s);
  cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
  return cv;
}

// ---------------------------------------------------------------- AR session
// Wraps MindARThree. Each target gets a "stage" group whose pose is copied from
// MindAR's anchor with light extra smoothing and a short hold when tracking drops,
// so content fades out gracefully instead of blinking.
export class ARSession {
  constructor(container, { targetBuffer, stability = 'balanced', onFound, onLost }) {
    this.container = container;
    this.url = URL.createObjectURL(new Blob([targetBuffer], { type: 'application/octet-stream' }));
    this.stability = stability;
    this.onFound = onFound; this.onLost = onLost;
    this.stages = [];
    this.activeIndex = -1;
  }

  async start(targetCount) {
    const { MindARThree } = await import('../../vendor/mindar/mindar-image-three.prod.js');
    const filters = {
      responsive: { filterMinCF: 0.001, filterBeta: 1000 },
      balanced: { filterMinCF: 0.0007, filterBeta: 300 },
      steady: { filterMinCF: 0.0001, filterBeta: 10 },
    }[this.stability];
    this.mind = new MindARThree({
      container: this.container, imageTargetSrc: this.url, maxTrack: 1,
      uiLoading: 'no', uiScanning: 'no', uiError: 'no',
      warmupTolerance: 3, missTolerance: 8, ...filters,
    });
    const { renderer, scene, camera } = this.mind;
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    for (let i = 0; i < targetCount; i++) {
      const anchor = this.mind.addAnchor(i);
      const stage = new THREE.Group();
      stage.matrixAutoUpdate = false;
      stage.visible = false;
      scene.add(stage);
      const st = { anchor, stage, tracked: false, lostAt: 0, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scl: new THREE.Vector3(1, 1, 1), has: false, presence: 0 };
      anchor.onTargetFound = () => { st.tracked = true; this.activeIndex = i; this.onFound?.(i); };
      anchor.onTargetLost = () => { st.tracked = false; st.lostAt = performance.now(); this.onLost?.(i); };
      this.stages.push(st);
    }
    await this.mind.start();
  }

  // Call once per frame before rendering. Returns per-target presence (0..1) for fading.
  update(dt) {
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const k = 1 - Math.exp(-dt * 30);
    for (const st of this.stages) {
      if (st.tracked) {
        st.anchor.group.matrix.decompose(p, q, s);
        if (!st.has) { st.pos.copy(p); st.quat.copy(q); st.scl.copy(s); st.has = true; }
        else { st.pos.lerp(p, k); st.quat.slerp(q, k); st.scl.lerp(s, k); }
        st.presence = Math.min(1, st.presence + dt * 4);
      } else {
        const held = performance.now() - st.lostAt < 700;
        st.presence = Math.max(0, st.presence - dt * (held ? 1.2 : 4));
        if (st.presence === 0) st.has = false;
      }
      st.stage.visible = st.presence > 0.001 && st.has;
      st.stage.matrix.compose(st.pos, st.quat, st.scl);
      st.stage.matrixWorldNeedsUpdate = true;
    }
    return this.stages.map((st) => st.presence);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  stop() {
    try { this.renderer?.setAnimationLoop(null); this.mind?.stop(); } catch (_) { /* already stopped */ }
    try { this.renderer?.dispose(); } catch (_) { /* ignore */ }
    this.container.innerHTML = '';
    URL.revokeObjectURL(this.url);
  }
}

import * as THREE from 'three';
import { QuadField, toLocal, rand, clamp, pick } from '../common.js';
import { hueToRgb } from '../../vision/analyzer.js';

// ------------------------------------------------------------------ water: waves, ripples, sparkle, bobbing boats, jumping fish
export const Water = {
  id: 'water', name: 'Living water', group: 'Water',
  hint: 'Tap the water to make ripples',
  score: (s) => (s.cues.waterArea > 0.02 ? 0.9 : s.cues.waterArea > 0.01 ? 0.4 : 0),
  available: (s) => s.cues.waterArea > 0.005,
  create(ctx) {
    const { scene, aspect } = ctx;
    const ocean = scene.themes.ocean > 0.45;
    const L = ctx.living.uniforms;
    // painted boats / floating things detected by the object detector
    // water sample points (for fish / idle drops)
    const pts = [];
    for (let k = 0; k < 4000 && pts.length < 200; k++) { const nx = Math.random(), ny = Math.random(); if (ctx.mask('water', nx, ny) > 0.7) pts.push({ nx, ny }); }
    // splash particles for fish jumps
    const sp = new QuadField({
      count: 40, attributes: { aPos: 4, aSize: 2, aParam: 4 }, blending: THREE.NormalBlending,
      vertexShader: /* glsl */`attribute vec4 aPos; attribute vec2 aSize; attribute vec4 aParam; varying vec2 vUv; varying float vA;
        void main(){ vUv = corner * 2.0; vA = aParam.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(aPos.xyz + vec3(corner * aSize, 0.0), 1.0); }`,
      fragmentShader: /* glsl */`uniform float uOpacity; varying vec2 vUv; varying float vA;
        void main(){ gl_FragColor = vec4(vec3(0.92, 0.96, 1.0), smoothstep(1.0, 0.3, length(vUv)) * vA * uOpacity); }`,
    });
    sp.mesh.renderOrder = 4; ctx.root.add(sp.mesh);
    const drops = Array.from({ length: 40 }, () => ({ life: 0 }));
    const jump = (p) => {
      const base = toLocal(p.nx, p.ny, aspect);
      for (let k = 0; k < 14; k++) { const d = drops.find((x) => x.life <= 0); if (!d) break; Object.assign(d, { x: base.x, y: base.y, vx: rand(-0.05, 0.05), vy: rand(0.06, 0.16), life: rand(0.5, 0.9), y0: base.y, s: rand(0.002, 0.004) }); }
      ctx.living.addRipple(p.nx, p.ny, 1.2, ctx.time);
      setTimeout(() => ctx.living.addRipple(p.nx + 0.01, p.ny, 0.8, ctx.time), 500);
      ctx.audio?.play('splash');
    };
    let inten = 1, nextFish = rand(5, 10), nextDrop = 0;
    const night = scene.themes.night > 0.5;
    const dull = scene.themes.rain > 0.45 || scene.cues.skyType === 'overcast';
    ctx.audio?.bed(ocean ? 'ocean' : 'stream', ocean ? 0.45 : 0.2);
    return {
      update(dt, t) {
        L.uWaveAmp.value = (ocean ? 1.0 : 0.35) * inten;
        L.uSparkle.value = (night ? 0.2 : dull ? 0.12 : ocean ? 0.85 : 0.5) * inten;
        if (pts.length && (scene.themes.nature > 0.3 || scene.themes.lake > 0.4) && !ocean && (nextFish -= dt) < 0) { jump(pick(pts)); nextFish = rand(7, 15); }
        if (pts.length && !ocean && (nextDrop -= dt) < 0) { const p = pick(pts); ctx.living.addRipple(p.nx, p.ny, 0.25, t); nextDrop = rand(1.5, 4); }
        drops.forEach((d, i) => {
          if (d.life > 0) { d.life -= dt; d.vy -= 0.45 * dt; d.x += d.vx * dt; d.y += d.vy * dt; if (d.y < d.y0) d.life = 0;
            sp.set('aPos', i, d.x, d.y, 0.003, 0); sp.set('aSize', i, d.s, d.s); sp.set('aParam', i, clamp(d.life * 3, 0, 1), 0, 0, 0);
          } else sp.set('aSize', i, 0, 0);
        });
        sp.touch('aPos', 'aSize', 'aParam');
      },
      tapScore: (hit) => (hit.water > 0.4 ? 0.65 : 0),
      onTap(hit) { ctx.living.addRipple(hit.nx, hit.ny, 1.5, ctx.time); setTimeout(() => ctx.living.addRipple(hit.nx, hit.ny, 0.8, ctx.time), 250); ctx.audio?.play('drop'); },
      setIntensity(v) { inten = v; },
      setOpacity(o) { sp.uniforms.uOpacity.value = o; },
      dispose() { L.uWaveAmp.value = 0; L.uSparkle.value = 0; L.uBob.value = 0; L.uBoats.value.forEach((b) => b.set(-1, -1, 0, 0)); ctx.audio?.bed(ocean ? 'ocean' : 'stream', 0); ctx.root.remove(sp.mesh); sp.dispose(); },
    };
  },
};

// ------------------------------------------------------------------ fireworks
export const Fireworks = {
  id: 'fireworks', name: 'Fireworks', group: 'Add-ons',
  hint: 'Tap the sky to launch fireworks',
  score: () => 0, // adds objects that aren't painted → opt-in only
  available: (s) => s.cues.skyArea > 0.04,
  create(ctx) {
    const { aspect, scene } = ctx;
    const B = 6, P = 90, N = B * P;
    const q = new QuadField({
      count: N, attributes: { aBurst: 4, aDir: 4, aCol: 3, aLaunch: 2 },
      vertexShader: /* glsl */`attribute vec4 aBurst; attribute vec4 aDir; attribute vec3 aCol; attribute vec2 aLaunch;
        uniform float uTime; varying vec2 vUv; varying vec3 vCol; varying float vA;
        void main(){
          vUv = corner * 2.0; vCol = aCol;
          float t = uTime - aBurst.z; float rise = 0.9;
          vec2 pos; vec2 vel; float a = 0.0; float sz = 0.004;
          if (t < 0.0 || t > rise + 2.6) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vA = 0.0; return; }
          if (t < rise) {
            float k = t / rise; float e = 1.0 - (1.0 - k) * (1.0 - k);
            pos = mix(aLaunch, aBurst.xy, e) + vec2(sin(t * 30.0 + aDir.w * 6.0), 0.0) * 0.002 * aDir.w;
            vel = aBurst.xy - aLaunch; a = aDir.w > 0.95 ? 1.0 : 0.0; sz = 0.003; vCol = vec3(1.0, 0.85, 0.6);
          } else {
            float tb = t - rise; float drag = 1.6;
            float sp = aDir.z;
            vec2 d = aDir.xy;
            pos = aBurst.xy + d * sp * (1.0 - exp(-drag * tb)) / drag + vec2(0.0, -0.05) * tb * tb;
            vel = d * sp * exp(-drag * tb) + vec2(0.0, -0.1) * tb;
            float fade = 1.0 - smoothstep(1.2, 2.6, tb);
            float crackle = aBurst.w > 0.5 ? (0.5 + 0.5 * step(0.5, fract(sin(tb * 40.0 + aDir.w * 100.0) * 43758.0))) : 1.0;
            a = fade * crackle; sz = 0.006;
          }
          float sp2 = length(vel); vec2 dir = sp2 > 1e-4 ? vel / sp2 : vec2(0.0, 1.0);
          vec2 k = vec2(corner.x * sz, corner.y * (sz + sp2 * 0.05));
          vec2 r = vec2(dir.y * k.x + dir.x * k.y, -dir.x * k.x + dir.y * k.y);
          vA = a;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos + r, 0.015, 1.0);
        }`,
      fragmentShader: /* glsl */`uniform float uOpacity; varying vec2 vUv; varying vec3 vCol; varying float vA;
        void main(){ float d = length(vUv); float g = exp(-d * d * 3.0); gl_FragColor = vec4(mix(vCol, vec3(1.0), exp(-d * d * 20.0)) * g * vA * uOpacity * 1.3, 1.0); }`,
    });
    q.mesh.renderOrder = 5; ctx.root.add(q.mesh);
    const lights = [ctx.allocLight(), ctx.allocLight()];
    const bursts = Array.from({ length: B }, (_, i) => ({ i, start: -99, col: [1, 1, 1], p: null }));
    const band = { top: 0.08, bottom: Math.max(0.2, Math.min(0.45, (scene.horizon || 0.5) - 0.1)) };
    let next = 1, inten = 1, li = 0;
    const launch = (nx = rand(0.15, 0.85), ny = rand(band.top, band.bottom)) => {
      const b = bursts.reduce((a, c) => (c.start < a.start ? c : a));
      b.start = ctx.time; const p = toLocal(nx, ny, aspect); b.p = p;
      const hue = rand(0, 360); b.col = hueToRgb(hue, 0.8, 1); const col2 = hueToRgb((hue + rand(30, 180)) % 360, 0.7, 1);
      const launchPt = toLocal(nx + rand(-0.05, 0.05), Math.min(0.95, Math.max(ny + 0.35, scene.horizon || 0.6)), aspect);
      const shape = Math.random(); const crackle = Math.random() < 0.35 ? 1 : 0;
      for (let k = 0; k < P; k++) {
        const idx = b.i * P + k;
        let a = (k / P) * Math.PI * 2 + rand(-0.05, 0.05), sp = rand(0.2, 0.28);
        if (shape < 0.3) sp = 0.25 * (0.6 + 0.4 * Math.abs(Math.sin(a * 2.5))); // flower
        else if (shape < 0.5) sp = k % 2 ? 0.26 : 0.14; // double ring
        else sp *= rand(0.4, 1); // peony
        q.set('aBurst', idx, p.x, p.y, b.start, crackle);
        q.set('aDir', idx, Math.cos(a), Math.sin(a), sp, k === 0 ? 1 : Math.random() * 0.9);
        q.set('aCol', idx, ...(k % 3 === 0 ? col2 : b.col));
        q.set('aLaunch', idx, launchPt.x, launchPt.y);
      }
      q.touch('aBurst', 'aDir', 'aCol', 'aLaunch');
      setTimeout(() => ctx.audio?.play('firework'), 900);
      b.light = lights[li++ % lights.length]; b.nx = nx; b.ny = ny;
    };
    return {
      update(dt, t) {
        q.uniforms.uTime.value = t;
        if ((next -= dt) < 0) { launch(); next = rand(1.2, 3.5) / Math.max(0.3, inten); }
        for (const b of bursts) {
          const tb = t - b.start - 0.9;
          if (b.light != null && tb > 0 && tb < 1.5) ctx.setLight(b.light, b.nx, b.ny, 0.35, Math.exp(-tb * 3) * 0.9, b.col);
        }
      },
      tapScore: (hit) => (hit.sky > 0.5 && hit.ny < 0.6 ? 0.75 : 0),
      onTap(hit) { launch(hit.nx, hit.ny); },
      setIntensity(v) { inten = v; },
      setOpacity(o) { q.uniforms.uOpacity.value = o; },
      dispose() { lights.forEach((l) => ctx.freeLight(l)); ctx.root.remove(q.mesh); q.dispose(); },
    };
  },
};

// ------------------------------------------------------------------ traffic light-trails
export const Traffic = {
  id: 'traffic', name: 'Moving traffic', group: 'Add-ons',
  hint: 'Tap the road to speed traffic up or slow it down',
  road(s) {
    const cars = (s.objects || []).filter((o) => ['car', 'bus', 'truck', 'motorcycle'].includes(o.label));
    if (cars.length) return cars.reduce((a, o) => a + o.box.ny + o.box.nh * 0.7, 0) / cars.length;
    if (s.themes.city > 0.4 && s.themes.night > 0.4) return 0.9;
    return null;
  },
  score() { return 0; }, // adds light trails that aren't painted → opt-in only
  available(s) { return s.themes.city > 0.2; },
  create(ctx) {
    const { aspect } = ctx;
    const roadY = toLocal(0, Traffic.road(ctx.scene) ?? 0.9, aspect).y;
    const N = 14;
    const q = new QuadField({
      count: N, attributes: { aSeed: 4 },
      uniforms: { uRoad: { value: roadY }, uSpeed: { value: 1 } },
      vertexShader: /* glsl */`attribute vec4 aSeed; uniform float uTime, uRoad, uSpeed; varying vec2 vUv; varying vec3 vCol; varying float vA;
        void main(){ vUv = corner * 2.0; float dir = aSeed.x < 0.5 ? 1.0 : -1.0;
          float x = mod(aSeed.y * 1.4 + dir * uTime * (0.08 + aSeed.z * 0.06) * uSpeed + 0.7, 1.4) - 0.7;
          float y = uRoad + (dir > 0.0 ? -0.006 : 0.006) + aSeed.w * 0.004;
          vCol = dir > 0.0 ? vec3(1.0, 0.95, 0.8) : vec3(1.0, 0.15, 0.1);
          vA = smoothstep(0.5, 0.45, abs(x));
          vec2 s = vec2(0.05, 0.006);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(x + corner.x * s.x, y + corner.y * s.y, 0.003, 1.0); }`,
      fragmentShader: /* glsl */`uniform float uOpacity; varying vec2 vUv; varying vec3 vCol; varying float vA;
        void main(){ float g = exp(-vUv.y * vUv.y * 4.0) * smoothstep(1.0, 0.2, abs(vUv.x)); gl_FragColor = vec4(vCol * g * vA * uOpacity * 0.9, 1.0); }`,
    });
    for (let i = 0; i < N; i++) q.set('aSeed', i, Math.random(), Math.random(), Math.random(), Math.random());
    q.touch('aSeed'); q.mesh.renderOrder = 4; ctx.root.add(q.mesh);
    ctx.audio?.bed('city', 0.2);
    return {
      update(dt, t) { q.uniforms.uTime.value = t; },
      tapScore: (hit) => (Math.abs(hit.local.y - roadY) < 0.05 ? 0.5 : 0),
      onTap() { q.uniforms.uSpeed.value = q.uniforms.uSpeed.value > 1.5 ? 0.6 : 2.5; ctx.audio?.play('horn'); },
      setIntensity(v) { q.uniforms.uSpeed.value = 0.4 + v; },
      setOpacity(o) { q.uniforms.uOpacity.value = o; },
      dispose() { ctx.audio?.bed('city', 0); ctx.root.remove(q.mesh); q.dispose(); },
    };
  },
};

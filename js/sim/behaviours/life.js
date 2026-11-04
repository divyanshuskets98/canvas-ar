import * as THREE from 'three';
import { QuadField, GLSL_NOISE, WINDOW_VS, WINDOW_FS, toLocal, rand, clamp } from '../common.js';

const PLANE_VS = /* glsl */`
attribute vec4 aPos; attribute vec2 aSize;
vec3 planePos(){ float c = cos(aPos.w), s = sin(aPos.w); vec2 k = corner * aSize; return vec3(aPos.xy + vec2(c*k.x - s*k.y, s*k.x + c*k.y), aPos.z); }
`;

function skyBand(scene) {
  const sl = [...scene.skyline].sort((a, b) => a - b);
  const low = sl[Math.floor(sl.length * 0.3)] || 0.4;
  return { top: 0.06, bottom: Math.max(0.12, low - 0.06) };
}

// ------------------------------------------------------------------ birds
export const Birds = {
  id: 'birds', name: 'Flying birds', group: 'Life',
  hint: 'Tap the sky to startle or summon a flock',
  score: (s) => {
    if (s.cues.skyArea < 0.12 || s.themes.night > 0.5 || s.themes.rain > 0.5) return 0;
    const painted = (s.objects || []).some((o) => o.label === 'bird') ? 0.2 : 0;
    return clamp(0.35 + Math.max(s.themes.ocean, s.themes.nature, s.themes.lake) * 0.4 + painted, 0, 0.95);
  },
  available: (s) => s.cues.skyArea > 0.05,
  create(ctx) {
    const { aspect, scene } = ctx;
    const N = 11;
    const band = skyBand(scene);
    const dark = (scene.cues.sky.L || 0.6) > 0.4;
    const q = new QuadField({
      count: N, attributes: { aPos: 4, aSize: 2, aParam: 4 }, blending: THREE.NormalBlending,
      uniforms: { uCol: { value: new THREE.Color(dark ? 0x1c1f26 : 0xe8ecf2) } },
      vertexShader: PLANE_VS + /* glsl */`attribute vec4 aParam; varying vec2 vUv; varying vec4 vP;
        void main(){ vUv = corner * 2.0; vP = aParam; gl_Position = projectionMatrix * modelViewMatrix * vec4(planePos(), 1.0); }`,
      fragmentShader: /* glsl */`uniform float uOpacity, uTime; uniform vec3 uCol; varying vec2 vUv; varying vec4 vP;
        void main(){
          float flap = sin(uTime * vP.y + vP.x * 6.28);
          vec2 p = vUv; p.x *= vP.z;  // vP.z = facing (±1)
          float ax = abs(p.x);
          float wingY = flap * 0.45 * ax - 0.25 * ax * ax * (1.0 - flap * 0.4);
          float wing = smoothstep(0.11, 0.03, abs(p.y - wingY)) * smoothstep(1.0, 0.75, ax);
          float body = smoothstep(0.16, 0.06, length((p - vec2(0.08, -0.02)) * vec2(1.0, 1.8)));
          float a = max(wing * (0.5 + 0.5 * (1.0 - ax)), body) * vP.w * uOpacity;
          gl_FragColor = vec4(uCol, a); }`,
    });
    q.mesh.renderOrder = 4;
    ctx.root.add(q.mesh);
    const birds = Array.from({ length: N }, (_, i) => ({ i, x: 0, y: 0, vx: 0, vy: 0, ph: Math.random(), flap: rand(9, 13), off: new THREE.Vector2((i % 2 ? 1 : -1) * Math.ceil(i / 2) * -0.035, -Math.ceil(i / 2) * 0.018), scatter: 0, alpha: 0 }));
    let leader, inten = 1, size = 0.03;
    const newFlight = (fromLeft = Math.random() < 0.5, ny) => {
      const y0 = toLocal(0, ny ?? rand(band.top, band.bottom), aspect).y;
      leader = { x: fromLeft ? -0.62 : 0.62, y: y0, vx: (fromLeft ? 1 : -1) * rand(0.06, 0.09), vy: 0, t: rand(0, 100) };
      birds.forEach((b) => { b.x = leader.x + b.off.x * Math.sign(leader.vx) + rand(-0.01, 0.01); b.y = leader.y + b.off.y + rand(-0.01, 0.01); b.vx = leader.vx; b.vy = 0; b.scatter = 0; });
    };
    newFlight();
    const yTop = toLocal(0, band.top, aspect).y, yBot = toLocal(0, band.bottom, aspect).y;
    return {
      update(dt, t) {
        leader.t += dt;
        leader.vy = Math.sin(leader.t * 0.5) * 0.01 + (leader.y > yTop ? -0.01 : 0) + (leader.y < yBot ? 0.01 : 0);
        leader.x += (leader.vx + ctx.wind.x * 0.01) * dt; leader.y += leader.vy * dt;
        let anyIn = false;
        birds.forEach((b, i) => {
          const dir = Math.sign(leader.vx);
          const tx = leader.x + b.off.x * dir + Math.sin(t * 0.7 + i) * 0.006, ty = leader.y + b.off.y + Math.cos(t * 0.9 + i * 2) * 0.005;
          const follow = b.scatter > 0 ? 0.2 : 2.2;
          b.vx += ((tx - b.x) * follow - b.vx * 0.6) * dt * 3; b.vy += ((ty - b.y) * follow - b.vy * 0.6) * dt * 3;
          if (b.scatter > 0) b.scatter -= dt;
          b.x += (b.vx + (b.scatter > 0 ? b.sx : 0)) * dt; b.y += (b.vy + (b.scatter > 0 ? b.sy : 0)) * dt;
          const inside = Math.abs(b.x) < 0.5 && Math.abs(b.y) < aspect / 2;
          anyIn ||= Math.abs(b.x) < 0.65;
          b.alpha += ((inside ? 1 : 0) - b.alpha) * Math.min(1, dt * 4);
          const edge = clamp((0.5 - Math.abs(b.x)) * 25, 0, 1) * clamp((aspect / 2 - Math.abs(b.y)) * 25, 0, 1);
          q.set('aPos', i, b.x, b.y, 0.006, clamp(b.vy * 3, -0.5, 0.5) * dir);
          q.set('aSize', i, size, size * 0.6);
          q.set('aParam', i, b.ph, b.scatter > 0 ? b.flap * 1.8 : b.flap, -dir, b.alpha * edge * inten);
        });
        q.touch('aPos', 'aSize', 'aParam'); q.uniforms.uTime.value = t;
        if (!anyIn || Math.abs(leader.x) > 0.75) newFlight();
      },
      tapScore: (hit) => (hit.sky > 0.5 ? 0.35 : 0),
      onTap(hit) {
        const p = toLocal(hit.nx, hit.ny, aspect);
        const near = birds.some((b) => Math.hypot(b.x - p.x, b.y - p.y) < 0.15);
        if (near) birds.forEach((b) => { const a = Math.atan2(b.y - p.y, b.x - p.x) + rand(-0.4, 0.4); b.sx = Math.cos(a) * 0.25; b.sy = Math.sin(a) * 0.25; b.scatter = rand(0.6, 1.1); });
        else newFlight(hit.nx > 0.5, hit.ny);
        ctx.audio?.play('chirp');
      },
      setIntensity(v) { inten = 0.6 + v * 0.4; },
      setOpacity(o) { q.uniforms.uOpacity.value = o; },
      dispose() { ctx.root.remove(q.mesh); q.dispose(); },
    };
  },
};

// ------------------------------------------------------------------ fireflies
export const Fireflies = {
  id: 'fireflies', name: 'Fireflies', group: 'Life',
  hint: 'Tap to call the fireflies to you',
  score: (s) => (s.cues.vegArea > 0.04 && s.themes.night > 0.4 ? 0.75 : 0),
  available: () => true,
  create(ctx) {
    const { aspect, scene } = ctx;
    const N = 70;
    const anchors = [];
    for (let k = 0; k < 4000 && anchors.length < N; k++) {
      const nx = Math.random(), ny = Math.max(0.3, scene.horizon) + Math.random() * (1 - Math.max(0.3, scene.horizon));
      if (ctx.mask('veg', nx, ny) > 0.4 || (scene.cues.vegArea < 0.02 && ctx.mask('sky', nx, ny) < 0.5)) anchors.push(toLocal(nx, ny, aspect));
    }
    while (anchors.length < N) anchors.push(toLocal(Math.random(), 0.6 + Math.random() * 0.4, aspect));
    const q = new QuadField({
      count: N, attributes: { aPos: 4, aSeed: 4 },
      uniforms: { uAttract: { value: new THREE.Vector3(0, 0, 0) }, uCamLocal: ctx.camLocal, uHalfH: { value: aspect / 2 } },
      vertexShader: GLSL_NOISE + WINDOW_VS + /* glsl */`attribute vec4 aPos; attribute vec4 aSeed; uniform float uTime; uniform vec3 uAttract; varying vec2 vUv; varying float vA;
        void main(){ vUv = corner * 2.0;
          float t = uTime * (0.15 + aSeed.x * 0.15);
          vec2 drift = (vec2(vnoise(vec2(t, aSeed.y * 50.0)), vnoise(vec2(aSeed.z * 50.0, t))) - 0.5) * 0.12;
          vec2 p = aPos.xy + drift;
          p = mix(p, uAttract.xy + drift * 0.4, uAttract.z);
          float blink = smoothstep(0.55, 0.9, sin(uTime * (1.2 + aSeed.w) + aSeed.y * 40.0) * 0.5 + 0.5);
          vA = blink;
          float s = 0.012 + aSeed.x * 0.008;
          vec3 P = vec3(p + corner * s, 0.01 + aSeed.z * 0.12); windowClip(P);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0); }`,
      fragmentShader: WINDOW_FS + /* glsl */`uniform float uOpacity; varying vec2 vUv; varying float vA;
        void main(){ if (outsideWindow()) discard; float d = length(vUv); float g = exp(-d * d * 5.0) * 0.6 + exp(-d * d * 40.0);
          gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * g * vA * uOpacity, 1.0); }`,
    });
    anchors.forEach((a, i) => { q.set('aPos', i, a.x, a.y, 0, 0); q.set('aSeed', i, Math.random(), Math.random(), Math.random(), Math.random()); });
    q.touch('aPos', 'aSeed'); q.mesh.renderOrder = 5;
    ctx.root.add(q.mesh);
    const att = q.uniforms.uAttract.value;
    let hold = 0, inten = 1;
    ctx.audio?.bed('crickets', 0.25);
    return {
      update(dt, t) { q.uniforms.uTime.value = t; hold -= dt; att.z += ((hold > 0 ? 0.75 : 0) - att.z) * Math.min(1, dt * 1.2); q.uniforms.uOpacity.value = ctx.opacity * inten; },
      tapScore: (hit) => (hit.veg > 0.4 ? 0.4 : 0.12),
      onTap(hit) { const p = toLocal(hit.nx, hit.ny, aspect); att.x = p.x; att.y = p.y; hold = 3; },
      setIntensity(v) { inten = v; },
      setOpacity() {},
      dispose() { ctx.audio?.bed('crickets', 0); ctx.root.remove(q.mesh); q.dispose(); },
    };
  },
};

// ------------------------------------------------------------------ falling leaves + foliage sway
export const Foliage = {
  id: 'foliage', name: 'Swaying foliage', group: 'Nature',
  hint: 'Tap trees to shake them · swipe for wind',
  score: (s) => (s.cues.vegArea > 0.03 || s.cues.autumnArea > 0.03 ? 0.85 : 0),
  available: (s) => s.cues.vegArea > 0.01 || s.cues.autumnArea > 0.01,
  create(ctx) {
    const { aspect, scene } = ctx;
    const autumn = scene.themes.autumn > 0.3;
    const N = autumn ? 60 : 28;
    // leaf sources: upper edges of vegetation
    const src = [];
    for (let k = 0; k < 6000 && src.length < 300; k++) {
      const nx = Math.random(), ny = Math.random();
      if ((ctx.mask('veg', nx, ny) > 0.5 || ctx.mask('autumn', nx, ny) > 0.5) && ctx.mask('veg', nx, ny - 0.04) < 0.5) src.push({ nx, ny });
    }
    if (!src.length) for (let k = 0; k < 20; k++) src.push({ nx: Math.random(), ny: rand(0.1, 0.4) });
    const palette = autumn ? [[0.85, 0.35, 0.1], [0.95, 0.6, 0.15], [0.7, 0.2, 0.08], [0.9, 0.75, 0.25]] : [[0.35, 0.6, 0.2], [0.55, 0.7, 0.25], [0.75, 0.7, 0.25]];
    const q = new QuadField({
      count: N, attributes: { aPos: 4, aSize: 2, aParam: 4 }, blending: THREE.NormalBlending,
      vertexShader: PLANE_VS + /* glsl */`attribute vec4 aParam; varying vec2 vUv; varying vec4 vP;
        void main(){ vUv = corner * 2.0; vP = aParam; vec3 p = planePos(); gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: /* glsl */`uniform float uOpacity; varying vec2 vUv; varying vec4 vP;
        void main(){ vec2 p = vUv; float w = 1.0 - p.y * p.y; float leaf = smoothstep(0.08, 0.0, abs(p.x) - w * 0.5) * step(abs(p.y), 1.0);
          float vein = smoothstep(0.08, 0.0, abs(p.x)) * 0.25;
          gl_FragColor = vec4(vP.xyz * (1.0 - vein), leaf * vP.w * uOpacity); }`,
    });
    q.mesh.renderOrder = 4; ctx.root.add(q.mesh);
    const leaves = Array.from({ length: N }, () => ({ life: 0 }));
    const spawn = (at) => {
      const l = leaves.find((x) => x.life <= 0); if (!l) return;
      const s = at || src[(Math.random() * src.length) | 0];
      const p = toLocal(s.nx + rand(-0.02, 0.02), s.ny + rand(-0.02, 0.02), aspect);
      Object.assign(l, { x: p.x, y: p.y, z: rand(0.005, 0.05), vx: rand(-0.01, 0.01), vy: -rand(0.02, 0.05), rot: rand(0, 6.28), spin: rand(-3, 3), flip: rand(0, 6.28), life: rand(5, 9), age: 0, c: palette[(Math.random() * palette.length) | 0], s: rand(0.008, 0.014) });
    };
    let inten = 1, shake = 0;
    const L = ctx.living.uniforms;
    return {
      update(dt, t) {
        L.uSway.value = 0.6 + inten * 0.9 + Math.min(1.5, ctx.wind.length() * 0.6);
        shake = Math.max(0, shake - dt * 1.5); L.uShake.value = shake;
        if (Math.random() < dt * (autumn ? 2 : 0.5) * inten * (1 + ctx.wind.length())) spawn();
        leaves.forEach((l, i) => {
          if (l.life > 0) {
            l.life -= dt; l.age += dt;
            l.vx += (ctx.wind.x * 0.06 - l.vx) * dt * 1.5 + Math.sin(l.age * 2 + l.rot) * 0.02 * dt;
            l.vy += (-0.035 - l.vy) * dt;
            l.x += l.vx * dt; l.y += l.vy * dt; l.rot += l.spin * dt; l.flip += dt * 4;
            const fade = clamp(l.age * 2, 0, 1) * clamp(l.life, 0, 1) * clamp((aspect / 2 + l.y) * 20, 0, 1) * clamp((0.5 - Math.abs(l.x)) * 30, 0, 1);
            q.set('aPos', i, l.x, l.y, l.z, l.rot); q.set('aSize', i, l.s * Math.abs(Math.cos(l.flip)) + 0.002, l.s * 1.6); q.set('aParam', i, ...l.c, fade);
          } else q.set('aSize', i, 0, 0);
        });
        q.touch('aPos', 'aSize', 'aParam');
      },
      tapScore: (hit) => (hit.veg > 0.4 ? 0.5 : 0),
      onTap(hit) { L.uShakeCenter.value.set(hit.nx, hit.ny); shake = 1; for (let k = 0; k < 8; k++) spawn({ nx: hit.nx, ny: hit.ny - 0.03 }); ctx.audio?.play('rustle'); },
      setIntensity(v) { inten = v; },
      setOpacity(o) { q.uniforms.uOpacity.value = o; },
      dispose() { L.uSway.value = 0; L.uShake.value = 0; ctx.root.remove(q.mesh); q.dispose(); },
    };
  },
};

// ------------------------------------------------------------------ dust motes / pollen (works on any canvas)
export const Motes = {
  id: 'motes', name: 'Floating motes', group: 'Ambient',
  hint: 'Move your phone – motes float in front of the canvas in 3D',
  score: () => 0.3,
  available: () => true,
  create(ctx) {
    const { aspect } = ctx;
    const N = 90;
    const warm = ctx.scene.stats.warm > ctx.scene.stats.cool;
    const q = new QuadField({
      count: N, attributes: { aSeed: 4 },
      uniforms: { uAspect: { value: aspect }, uCol: { value: new THREE.Color(warm ? 0xffe2b0 : 0xe0f0ff) }, uWind: { value: ctx.wind }, uCamLocal: ctx.camLocal, uHalfH: { value: aspect / 2 } },
      vertexShader: GLSL_NOISE + WINDOW_VS + /* glsl */`attribute vec4 aSeed; uniform float uTime, uAspect; uniform vec2 uWind; varying vec2 vUv; varying float vA;
        void main(){ vUv = corner * 2.0; float t = uTime * 0.05;
          vec2 p = vec2(aSeed.x - 0.5, (aSeed.y - 0.5) * uAspect) + (vec2(vnoise(vec2(t + aSeed.z * 9.0, aSeed.w * 30.0)), vnoise(vec2(aSeed.w * 30.0, t + aSeed.x * 9.0))) - 0.5) * 0.25;
          p.x = mod(p.x + uTime * uWind.x * 0.004 + 0.55, 1.1) - 0.55;
          vA = smoothstep(0.5, 0.42, abs(p.x)) * smoothstep(uAspect * 0.5, uAspect * 0.42, abs(p.y)) * (0.5 + 0.5 * sin(uTime * (0.5 + aSeed.z) + aSeed.w * 20.0));
          float s = 0.002 + aSeed.z * 0.004;
          vec3 P = vec3(p + corner * s, 0.02 + aSeed.w * 0.28); windowClip(P);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0); }`,
      fragmentShader: WINDOW_FS + /* glsl */`uniform float uOpacity; uniform vec3 uCol; varying vec2 vUv; varying float vA;
        void main(){ if (outsideWindow()) discard; float d = length(vUv); gl_FragColor = vec4(uCol * exp(-d * d * 6.0) * vA * uOpacity * 0.7, 1.0); }`,
    });
    for (let i = 0; i < N; i++) q.set('aSeed', i, Math.random(), Math.random(), Math.random(), Math.random());
    q.touch('aSeed'); q.mesh.renderOrder = 6; ctx.root.add(q.mesh);
    let inten = 1;
    return {
      update(dt, t) { q.uniforms.uTime.value = t; q.uniforms.uOpacity.value = ctx.opacity * inten; },
      tapScore: () => 0, setIntensity(v) { inten = v; }, setOpacity() {},
      dispose() { ctx.root.remove(q.mesh); q.dispose(); },
    };
  },
};

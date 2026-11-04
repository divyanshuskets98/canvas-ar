import * as THREE from 'three';
import { toLocal, rand, clamp, noise1 } from '../common.js';

// Animate objects that are *already painted* on the canvas. Each object was cut out
// (vision/objects.js) and its original spot filled in; here the cut-out is put back
// exactly where it was and moved by itself – no new objects are added.

function spriteMaterial(canvas, vertexBody, extraUniforms = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uMap: { value: tex }, uTime: { value: 0 }, uOpacity: { value: 1 }, ...extraUniforms },
    vertexShader: `varying vec2 vUv; uniform float uTime; ${vertexBody}`,
    fragmentShader: `varying vec2 vUv; uniform sampler2D uMap; uniform float uOpacity;
      void main(){ vec4 c = texture2D(uMap, vUv); gl_FragColor = vec4(c.rgb, c.a * uOpacity); }`,
  });
}

// ------------------------------------------------------------------ painted birds: flap, glide, hover in place
export const PaintedBirds = {
  id: 'pbirds', name: 'Birds come alive', group: 'Life',
  hint: 'The painted birds flap and glide · tap one to make it take off',
  score: (s, o) => (o?.birds.length ? 0.95 : 0),
  available: (s, o) => !!o?.birds.length,
  create(ctx) {
    const { aspect } = ctx;
    const L = ctx.living.uniforms;
    L.uHoleOn.value.x = 1;
    const birds = ctx.objects.birds.map((b, i) => {
      const mat = spriteMaterial(b.sprite, `
        uniform float uFlap, uBody, uGlide;
        void main(){
          vUv = uv;
          vec3 p = position;
          float dx = uv.x - uBody;
          float reach = smoothstep(0.04, 0.5, abs(dx));
          p.y += uFlap * reach * abs(dx) * 1.6 * (1.0 - uGlide * 0.7) + uGlide * reach * 0.12;
          p.y -= uFlap * 0.06;
          p.x *= 1.0 - 0.1 * abs(uFlap);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`, { uFlap: { value: 0 }, uBody: { value: b.body }, uGlide: { value: 0 } });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 16, 4), mat);
      const home = toLocal(b.nx, b.ny, aspect, 0.003);
      mesh.position.copy(home);
      mesh.scale.set(b.nw, b.nh * aspect, 1);
      mesh.renderOrder = 3;
      ctx.root.add(mesh);
      // flap faster for small (distant) birds
      const rate = clamp(10 + (0.03 - b.nw) * 120, 8, 15) * rand(0.9, 1.1);
      return { b, mesh, mat, home, rate, ph: rand(0, 6.28), seed: rand(0, 100), off: new THREE.Vector2(), vel: new THREE.Vector2(), away: 0, flapPhase: rand(0, 6.28) };
    });
    let inten = 1;
    return {
      update(dt, t) {
        for (const k of birds) {
          // glide ↔ flap envelope, shared loosely so the group feels like a flock
          const glide = clamp((noise1(t * 0.25 + k.seed * 0.1) - 0.45) * 4, 0, 1);
          k.flapPhase += dt * k.rate * (1 - glide * 0.85) * (k.away > 0 ? 1.5 : 1);
          k.mat.uniforms.uFlap.value = Math.sin(k.flapPhase) * (0.35 + 0.65 * (1 - glide)) * inten;
          k.mat.uniforms.uGlide.value = glide;
          // hover around the painted position on a slow figure-of-eight; tap → take off and come back
          const target = new THREE.Vector2(Math.sin(t * 0.21 + k.ph) * 0.012, Math.sin(t * 0.34 + k.ph * 1.7) * 0.006).multiplyScalar(inten);
          if (k.away > 0) { k.away -= dt; k.off.addScaledVector(k.vel, dt); k.vel.multiplyScalar(1 - dt * 0.15); }
          else k.off.lerp(target, Math.min(1, dt * 0.8));
          // stay inside the canvas – birds never leave the picture
          const hx = 0.5 - k.b.nw * 0.6, hy = aspect / 2 - k.b.nh * aspect * 0.6;
          k.mesh.position.set(clamp(k.home.x + k.off.x + ctx.wind.x * 0.004, -hx, hx), clamp(k.home.y + k.off.y, -hy, hy), k.home.z);
          if (Math.abs(k.mesh.position.x - k.home.x - k.off.x) > 0.001 || Math.abs(k.mesh.position.y - k.home.y - k.off.y) > 0.001) k.vel.multiplyScalar(0.9);
          k.mesh.rotation.z = clamp(-k.off.y * 3 + (k.away > 0 ? Math.atan2(k.vel.y, k.vel.x) * 0.15 : 0), -0.3, 0.3);
          k.mat.uniforms.uTime.value = t;
        }
      },
      tapScore(hit) {
        const p = hit.local;
        return birds.some((k) => Math.hypot(k.mesh.position.x - p.x, k.mesh.position.y - p.y) < Math.max(0.04, k.b.nw * 1.5)) ? 0.9 : 0;
      },
      onTap(hit) {
        const p = hit.local;
        birds.forEach((k) => {
          const d = Math.hypot(k.mesh.position.x - p.x, k.mesh.position.y - p.y);
          if (d < 0.2) { const a = Math.atan2(k.mesh.position.y - p.y, k.mesh.position.x - p.x) + rand(-0.4, 0.4); k.vel.set(Math.cos(a), Math.abs(Math.sin(a)) + 0.3).multiplyScalar(0.12); k.away = rand(1.2, 2.2); }
        });
        ctx.audio?.play('chirp');
      },
      setIntensity(v) { inten = v; },
      setOpacity(o) { birds.forEach((k) => (k.mat.uniforms.uOpacity.value = o)); },
      dispose() { L.uHoleOn.value.x = 0; birds.forEach((k) => { ctx.root.remove(k.mesh); k.mesh.geometry.dispose(); k.mat.uniforms.uMap.value.dispose(); k.mat.dispose(); }); },
    };
  },
};

// ------------------------------------------------------------------ boats & floating objects: bob and roll on the water
export const Floaters = {
  id: 'floaters', name: 'Boats bob on water', group: 'Water',
  hint: 'Boats rock with the waves · tap one to rock it harder',
  score: (s, o) => (o?.floaters.length ? 0.9 : 0),
  available: (s, o) => !!o?.floaters.length,
  create(ctx) {
    const { aspect } = ctx;
    const L = ctx.living.uniforms;
    L.uHoleOn.value.y = 1;
    const fl = ctx.objects.floaters.map((b) => {
      const mat = spriteMaterial(b.sprite, `void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`);
      const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0); // pivot at the waterline
      const mesh = new THREE.Mesh(g, mat);
      // geometry pivot is bottom-centre, so placing it at the painted bottom keeps the boat exactly where it was
      mesh.userData.base = toLocal(b.nx, b.bottom, aspect, 0.002);
      mesh.position.copy(mesh.userData.base); mesh.scale.set(b.nw, b.nh * aspect, 1);
      mesh.renderOrder = 2;
      ctx.root.add(mesh);
      return { b, mesh, mat, ph: rand(0, 6.28), kick: 0, nextRipple: rand(1, 3) };
    });
    let inten = 1;
    return {
      update(dt, t) {
        for (const f of fl) {
          f.kick = Math.max(0, f.kick - dt * 0.5);
          const amp = inten * (1 + f.kick * 3);
          const base = f.mesh.userData.base;
          f.mesh.position.set(base.x + Math.sin(t * 0.25 + f.ph) * 0.004 * inten + ctx.wind.x * 0.003, base.y + Math.sin(t * 1.3 + f.ph) * 0.0035 * amp, base.z);
          f.mesh.rotation.z = Math.sin(t * 0.9 + f.ph) * 0.04 * amp;
          f.mat.uniforms.uTime.value = t;
          if ((f.nextRipple -= dt) < 0) { ctx.living.addRipple(f.b.nx + rand(-0.4, 0.4) * f.b.nw, f.b.bottom, 0.3 + f.kick, t); f.nextRipple = rand(1.5, 3.5) / (1 + f.kick * 2); }
        }
      },
      tapScore(hit) { return fl.some((f) => Math.abs(hit.nx - f.b.nx) < f.b.nw * 0.6 && hit.ny > f.b.top - 0.02 && hit.ny < f.b.bottom + 0.02) ? 0.85 : 0; },
      onTap(hit) { fl.forEach((f) => { if (Math.abs(hit.nx - f.b.nx) < f.b.nw) f.kick = 1; }); ctx.living.addRipple(hit.nx, hit.ny, 1.2, ctx.time); ctx.audio?.play('splash'); },
      setIntensity(v) { inten = v; },
      setOpacity(o) { fl.forEach((f) => (f.mat.uniforms.uOpacity.value = o)); },
      dispose() { L.uHoleOn.value.y = 0; fl.forEach((f) => { ctx.root.remove(f.mesh); f.mesh.geometry.dispose(); f.mat.uniforms.uMap.value.dispose(); f.mat.dispose(); }); },
    };
  },
};

// ------------------------------------------------------------------ painted clouds drift slowly across the sky
export const CloudDrift = {
  id: 'clouddrift', name: 'Clouds drift', group: 'Sky',
  hint: 'Painted clouds drift with the wind · swipe to push them',
  score: (s, o) => (o?.clouds.length ? 0.85 : 0),
  available: (s, o) => !!o?.clouds.length,
  create(ctx) {
    const { aspect } = ctx;
    const L = ctx.living.uniforms;
    L.uHoleOn.value.z = 1;
    const cl = ctx.objects.clouds.map((b) => {
      const mat = spriteMaterial(b.sprite, `void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      const home = toLocal(b.nx, b.ny, aspect, 0.001);
      mesh.position.copy(home); mesh.scale.set(b.nw, b.nh * aspect, 1); mesh.renderOrder = 1;
      ctx.root.add(mesh);
      return { b, mesh, mat, home, ph: rand(0, 6.28), push: 0, speed: rand(0.7, 1.3) };
    });
    let inten = 1;
    return {
      update(dt, t) {
        for (const c of cl) {
          c.push += (ctx.wind.x - 0.3) * dt * 0.01; c.push *= 1 - dt * 0.05;
          const x = Math.sin(t * 0.04 * c.speed + c.ph) * 0.03 * inten + clamp(c.push, -0.08, 0.08);
          // keep clouds inside the canvas edges
          const half = c.b.nw / 2, lim = 0.5 - half;
          c.mesh.position.set(clamp(c.home.x + x, -lim, lim), c.home.y + Math.sin(t * 0.07 + c.ph) * 0.002, c.home.z);
          const br = 1 + Math.sin(t * 0.3 + c.ph) * 0.012;
          c.mesh.scale.set(c.b.nw * br, c.b.nh * aspect * (2 - br), 1);
        }
      },
      tapScore: () => 0,
      setIntensity(v) { inten = v; },
      setOpacity(o) { cl.forEach((c) => (c.mat.uniforms.uOpacity.value = o)); },
      dispose() { L.uHoleOn.value.z = 0; cl.forEach((c) => { ctx.root.remove(c.mesh); c.mesh.geometry.dispose(); c.mat.uniforms.uMap.value.dispose(); c.mat.dispose(); }); },
    };
  },
};

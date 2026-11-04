import * as THREE from 'three';
import { QuadField, GLSL_NOISE, WINDOW_VS, WINDOW_FS, toLocal, rand, clamp } from '../common.js';

// Points inside the canvas where something can land (ground / water, below the skyline)
function landingSpots(ctx, n) {
  const s = ctx.scene, out = [];
  for (let k = 0; k < n * 20 && out.length < n; k++) {
    const nx = Math.random(), ny = Math.max(s.horizon, 0.35) + Math.random() * (1 - Math.max(s.horizon, 0.35));
    if (ctx.mask('sky', nx, ny) > 0.5) continue;
    out.push({ nx, ny, water: ctx.mask('water', nx, ny) > 0.5 });
  }
  while (out.length < n) out.push({ nx: Math.random(), ny: 0.75 + Math.random() * 0.25, water: false });
  return out;
}

// ------------------------------------------------------------------ rain + storm
export const Rain = {
  id: 'rain', name: 'Rain & storm', group: 'Weather',
  hint: 'Tap the sky for lightning · swipe to slant the rain',
  score: (s) => s.themes.rain,
  available: () => true,
  create(ctx) {
    const { aspect } = ctx;
    const N = ctx.quality > 0.7 ? 2200 : 1200;
    const top = aspect / 2;
    const rain = new QuadField({
      count: N, attributes: { aSeed: 4 }, blending: THREE.NormalBlending,
      uniforms: { uWind: { value: ctx.wind }, uAspect: { value: aspect }, uDensity: { value: 1 }, uCamLocal: ctx.camLocal, uHalfH: { value: aspect / 2 } },
      vertexShader: WINDOW_VS + /* glsl */`
        attribute vec4 aSeed; uniform float uTime, uAspect, uDensity; uniform vec2 uWind;
        varying vec2 vUv; varying float vA;
        void main(){
          vUv = corner + 0.5;
          float speed = 1.5 + aSeed.w * 0.9;
          float H = uAspect * 1.15;
          float fall = mod(aSeed.y * H + uTime * speed, H);
          float y = uAspect * 0.575 - fall;
          float slant = clamp(uWind.x, -2.5, 2.5) * 0.22;
          float x = mod(aSeed.x * 1.3 + fall * slant + 0.65, 1.3) - 0.65;
          float z = 0.01 + aSeed.z * 0.35;
          float len = 0.035 + aSeed.w * 0.03;
          float ang = atan(slant);
          vec2 k = corner * vec2(0.0011 + aSeed.z * 0.0012, len);
          vec2 r = vec2(cos(ang) * k.x + sin(ang) * k.y, -sin(ang) * k.x + cos(ang) * k.y);
          vec3 p = vec3(x + r.x, y + r.y, z);
          windowClip(p);
          vA = step(aSeed.z, uDensity) * (0.25 + aSeed.z * 0.3);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: WINDOW_FS + /* glsl */`uniform float uOpacity; varying vec2 vUv; varying float vA;
        void main(){ if (outsideWindow()) discard; float a = (1.0 - abs(vUv.x * 2.0 - 1.0)) * smoothstep(0.0, 0.5, vUv.y) * vA * uOpacity;
          gl_FragColor = vec4(vec3(0.86, 0.9, 0.95), a); }`,
    });
    for (let i = 0; i < N; i++) rain.set('aSeed', i, Math.random(), Math.random(), Math.random(), Math.random());
    rain.touch('aSeed');

    const spots = landingSpots(ctx, 220);
    const splash = new QuadField({
      count: spots.length, attributes: { aPos: 4, aSeed: 2 }, blending: THREE.NormalBlending,
      uniforms: { uDensity: rain.uniforms.uDensity },
      vertexShader: /* glsl */`attribute vec4 aPos; attribute vec2 aSeed; uniform float uTime; varying vec2 vUv; varying float vPh; varying float vW;
        void main(){ vUv = corner; vPh = fract(uTime * (1.4 + aSeed.y) + aSeed.x); vW = aPos.w;
          vec3 p = vec3(aPos.xy + corner * vec2(0.016, 0.009) * (0.6 + aPos.z), 0.002);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: /* glsl */`uniform float uOpacity, uDensity; varying vec2 vUv; varying float vPh; varying float vW;
        void main(){ vec2 q = vUv * 2.0; q.y *= 1.0 + vW;
          float r = length(q); float ring = smoothstep(0.12, 0.0, abs(r - vPh)) * (1.0 - vPh);
          float crown = (1.0 - vW) * smoothstep(0.15, 0.0, abs(length(q - vec2(0.0, vPh * 0.8)) - 0.1)) * (1.0 - vPh) * step(0.0, q.y);
          gl_FragColor = vec4(vec3(0.85, 0.9, 0.95), (ring + crown) * 0.5 * uOpacity * uDensity); }`,
    });
    spots.forEach((s, i) => { const p = toLocal(s.nx, s.ny, aspect); splash.set('aPos', i, p.x, p.y, (s.ny - 0.4) * 1.5, s.water ? 1 : 0); splash.set('aSeed', i, Math.random(), Math.random()); });
    splash.touch('aPos', 'aSeed');
    const waterSpots = spots.filter((s) => s.water);

    // lightning bolt mesh (rebuilt per strike)
    const boltMat = new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const bolt = new THREE.Mesh(new THREE.BufferGeometry(), boltMat);
    bolt.frustumCulled = false; bolt.renderOrder = 6;
    rain.mesh.renderOrder = 5; splash.mesh.renderOrder = 3;
    ctx.root.add(splash.mesh, rain.mesh, bolt);

    let density = 1, flash = 0, nextStrike = rand(6, 14), boltLife = 0;
    const storm = ctx.scene.themes.rain > 0.55 || ctx.scene.cues.skyType === 'overcast';
    const L = ctx.living.uniforms;
    ctx.audio?.bed('rain', 0.5);

    function buildBolt(nx) {
      const s = ctx.scene;
      const endNy = clamp((s.skyline[Math.floor(nx * (s.gridW - 1))] || 0.5) + 0.05, 0.25, 0.85);
      const pts = []; let x = nx, y = 0.03;
      const segs = 18;
      for (let i = 0; i <= segs; i++) { pts.push([x, y]); y += endNy / segs; x += rand(-0.025, 0.025); }
      const verts = [];
      const strip = (P, w) => {
        for (let i = 0; i < P.length - 1; i++) {
          const a = toLocal(P[i][0], P[i][1], aspect, 0.004), b = toLocal(P[i + 1][0], P[i + 1][1], aspect, 0.004);
          const d = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize(); const nx2 = -d.y * w, ny2 = d.x * w;
          verts.push(a.x - nx2, a.y - ny2, a.z, a.x + nx2, a.y + ny2, a.z, b.x + nx2, b.y + ny2, b.z, a.x - nx2, a.y - ny2, a.z, b.x + nx2, b.y + ny2, b.z, b.x - nx2, b.y - ny2, b.z);
        }
      };
      strip(pts, 0.0025);
      for (let k = 0; k < 3; k++) { // branches
        const i0 = 3 + ((Math.random() * (segs - 6)) | 0); let [bx, by] = pts[i0]; const br = [[bx, by]]; const dir = Math.random() < 0.5 ? -1 : 1;
        for (let i = 0; i < 6; i++) { bx += dir * rand(0.005, 0.03); by += endNy / segs * 0.8; br.push([bx, by]); }
        strip(br, 0.0012);
      }
      bolt.geometry.dispose();
      bolt.geometry = new THREE.BufferGeometry();
      bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    }
    function strike(nx = rand(0.15, 0.85)) {
      buildBolt(nx); boltLife = 0.35; flash = 1;
      setTimeout(() => (flash = Math.max(flash, 0.7)), 120);
      ctx.audio?.play('thunder', { delay: rand(0.3, 1.5) });
    }

    return {
      update(dt, t) {
        rain.uniforms.uTime.value = splash.uniforms.uTime.value = t;
        rain.uniforms.uDensity.value = density;
        // drops on water feed the ripple field
        if (waterSpots.length && Math.random() < dt * 14 * density) { const w = waterSpots[(Math.random() * waterSpots.length) | 0]; ctx.living.addRipple(w.nx + rand(-0.02, 0.02), w.ny + rand(-0.01, 0.01), 0.35, t); }
        if (storm && (nextStrike -= dt) < 0) { strike(); nextStrike = rand(9, 22); }
        flash = Math.max(0, flash - dt * 4.5);
        boltLife = Math.max(0, boltLife - dt);
        boltMat.opacity = boltLife > 0 ? (0.6 + 0.4 * Math.random()) * ctx.opacity : 0;
        L.uFlash.value = Math.max(L.uFlash.value, flash * 0.55);
        L.uWet.value = 0.55 * density;
        L.uCloudAmt.value = Math.max(L.uCloudAmt.value, 0.85);
        L.uCloudDark.value = Math.max(L.uCloudDark.value, 0.75);
        L.uCloudCover.value = Math.max(L.uCloudCover.value, 0.8);
        ctx.audio?.bed('rain', 0.25 + 0.5 * density);
      },
      tapScore(hit) { return hit.sky > 0.5 ? 0.7 : 0.05; },
      onTap(hit) { if (hit.sky > 0.5) strike(hit.nx); else density = density > 0.6 ? 0.35 : 1; },
      setIntensity(v) { density = v; },
      setOpacity(o) { rain.uniforms.uOpacity.value = splash.uniforms.uOpacity.value = o; },
      dispose() {
        ctx.audio?.bed('rain', 0); L.uWet.value = 0;
        for (const q of [rain, splash]) { ctx.root.remove(q.mesh); q.dispose(); }
        ctx.root.remove(bolt); bolt.geometry.dispose(); boltMat.dispose();
      },
    };
  },
};

// ------------------------------------------------------------------ snow
export const Snow = {
  id: 'snow', name: 'Snowfall', group: 'Weather',
  hint: 'Swipe to send a gust through the snow',
  score: (s) => (s.themes.snow >= 0.7 ? s.themes.snow : 0),
  available: () => true,
  create(ctx) {
    const { aspect } = ctx;
    const N = ctx.quality > 0.7 ? 1100 : 600;
    const q = new QuadField({
      count: N, attributes: { aSeed: 4 }, blending: THREE.NormalBlending,
      uniforms: { uWind: { value: ctx.wind }, uAspect: { value: aspect }, uDensity: { value: 1 }, uDrift: { value: 0 }, uCamLocal: ctx.camLocal, uHalfH: { value: aspect / 2 } },
      vertexShader: WINDOW_VS + /* glsl */`attribute vec4 aSeed; uniform float uTime, uAspect, uDensity, uDrift; uniform vec2 uWind; varying vec2 vUv; varying float vA;
        void main(){ vUv = corner;
          float speed = 0.06 + aSeed.w * 0.07 + aSeed.z * 0.05;
          float H = uAspect * 1.1; float fall = mod(aSeed.y * H + uTime * speed, H);
          float y = uAspect * 0.55 - fall;
          float x = mod(aSeed.x * 1.3 + uDrift * (0.4 + aSeed.z) + sin(uTime * (0.6 + aSeed.w) + aSeed.x * 40.0) * 0.015 + 0.65, 1.3) - 0.65;
          float z = 0.01 + aSeed.z * 0.3; float s = 0.003 + aSeed.z * 0.006;
          vA = step(aSeed.w, uDensity);
          vec3 P = vec3(x + corner.x * s, y + corner.y * s, z); windowClip(P);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0); }`,
      fragmentShader: WINDOW_FS + /* glsl */`uniform float uOpacity; varying vec2 vUv; varying float vA;
        void main(){ if (outsideWindow()) discard; float d = length(vUv) * 2.0; gl_FragColor = vec4(vec3(1.0), smoothstep(1.0, 0.2, d) * 0.85 * vA * uOpacity); }`,
    });
    for (let i = 0; i < N; i++) q.set('aSeed', i, Math.random(), Math.random(), Math.random(), Math.random());
    q.touch('aSeed'); q.mesh.renderOrder = 5;
    ctx.root.add(q.mesh);
    let drift = 0;
    ctx.audio?.bed('wind', 0.2);
    return {
      update(dt, t) { drift += (ctx.wind.x * 0.25) * dt; q.uniforms.uDrift.value = drift; q.uniforms.uTime.value = t;
        const L = ctx.living.uniforms; L.uCloudAmt.value = Math.max(L.uCloudAmt.value, 0.5); },
      tapScore: () => 0.1,
      onTap(hit) { ctx.wind.x += hit.nx < 0.5 ? 2 : -2; },
      setIntensity(v) { q.uniforms.uDensity.value = v; },
      setOpacity(o) { q.uniforms.uOpacity.value = o; },
      dispose() { ctx.audio?.bed('wind', 0); ctx.root.remove(q.mesh); q.dispose(); },
    };
  },
};

// ------------------------------------------------------------------ clouds (drives living-canvas sky)
export const Clouds = {
  id: 'clouds', name: 'Moving sky', group: 'Sky',
  hint: 'Swipe to change the wind and cloud direction',
  score: (s) => (s.cues.skyArea > 0.08 && s.cues.skyType !== 'night' ? (s.cues.skyType === 'overcast' ? 0.9 : 0.7) : s.cues.skyArea > 0.08 ? 0.35 : 0),
  available: (s) => s.cues.skyArea > 0.03,
  create(ctx) {
    let inten = 1;
    const L = ctx.living.uniforms;
    const overcast = ctx.scene.cues.skyType === 'overcast';
    return {
      update() {
        L.uSkyBillow.value = 1 * inten;
        L.uCloudAmt.value = Math.max(L.uCloudAmt.value, (overcast ? 0.75 : 0.12) * inten); // only light moving shade unless it's a storm sky
        L.uCloudCover.value = Math.max(L.uCloudCover.value, overcast ? 0.7 : 0.35);
        L.uCloudDark.value = Math.max(L.uCloudDark.value, overcast ? 0.45 : 0);
      },
      tapScore: (hit) => (hit.sky > 0.5 ? 0.15 : 0),
      onTap(hit) { ctx.wind.x += hit.nx < 0.5 ? 1.5 : -1.5; ctx.audio?.play('gust'); },
      setIntensity(v) { inten = v; },
      dispose() { L.uSkyBillow.value = 0; },
    };
  },
};

// ------------------------------------------------------------------ stars & shooting stars
export const Stars = {
  id: 'stars', name: 'Twinkling stars', group: 'Sky',
  hint: 'Tap the night sky for a shooting star',
  score: (s) => (s.themes.night > 0.5 && s.cues.skyArea > 0.08 && (s.cues.stars + (s.cues.tinyStars || 0)) >= 3 ? 0.85 : 0),
  available: (s) => s.cues.skyArea > 0.05,
  create(ctx) {
    const { aspect } = ctx;
    const q = new QuadField({
      count: 3, attributes: { aPos: 4, aSize: 2, aParam: 4 },
      vertexShader: /* glsl */`attribute vec4 aPos; attribute vec2 aSize; attribute vec4 aParam; varying vec2 vUv; varying float vA;
        void main(){ vUv = corner + 0.5; vA = aParam.x; float c = cos(aPos.w), s = sin(aPos.w); vec2 k = corner * aSize;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(aPos.xy + vec2(c*k.x - s*k.y, s*k.x + c*k.y), aPos.z, 1.0); }`,
      fragmentShader: /* glsl */`uniform float uOpacity; varying vec2 vUv; varying float vA;
        void main(){ float w = smoothstep(0.5, 0.0, abs(vUv.y - 0.5)); float tail = pow(vUv.x, 2.5);
          gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * w * tail * vA * uOpacity * 1.6, 1.0); }`,
    });
    q.mesh.renderOrder = 4;
    ctx.root.add(q.mesh);
    const shots = [0, 1, 2].map(() => ({ life: 0 }));
    let inten = 1, next = rand(4, 9);
    const shoot = (nx = rand(0.1, 0.9), ny = rand(0.05, Math.max(0.1, ctx.scene.horizon * 0.6))) => {
      const s = shots.find((x) => x.life <= 0); if (!s) return;
      s.life = s.max = rand(0.7, 1.1); s.a = rand(-0.7, -0.35) * (Math.random() < 0.5 ? 1 : -1) + (Math.random() < 0.5 ? Math.PI : 0);
      const p = toLocal(nx, ny, aspect); s.x = p.x; s.y = p.y; s.v = rand(0.35, 0.6);
    };
    return {
      update(dt) {
        ctx.living.uniforms.uStars.value = inten;
        shots.forEach((s, i) => {
          if (s.life > 0) {
            s.life -= dt; s.x += Math.cos(s.a) * s.v * dt; s.y += Math.sin(s.a) * s.v * dt;
            const k = s.life / s.max;
            q.set('aPos', i, s.x - Math.cos(s.a) * 0.04, s.y - Math.sin(s.a) * 0.04, 0.004, s.a);
            q.set('aSize', i, 0.09, 0.003); q.set('aParam', i, Math.sin(k * Math.PI) * inten, 0, 0, 0);
          } else q.set('aSize', i, 0, 0);
        });
        q.touch('aPos', 'aSize', 'aParam');
      },
      tapScore: (hit) => (hit.sky > 0.5 ? 0.45 : 0),
      onTap(hit) { shoot(hit.nx, hit.ny); ctx.audio?.play('chime'); },
      setIntensity(v) { inten = v; },
      setOpacity(o) { q.uniforms.uOpacity.value = o; },
      dispose() { ctx.living.uniforms.uStars.value = 0; ctx.root.remove(q.mesh); q.dispose(); },
    };
  },
};

// ------------------------------------------------------------------ nightfall (manual)
export const Nightfall = {
  id: 'night', name: 'Nightfall', group: 'Sky',
  hint: 'Tap the sky to toggle day and night',
  score: () => 0,
  available: (s) => s.themes.night < 0.5,
  create(ctx) {
    let target = 0.85, cur = 0;
    return {
      update(dt) { cur += (target - cur) * Math.min(1, dt * 1.5); ctx.living.uniforms.uNight.value = cur;
        ctx.living.uniforms.uStars.value = Math.max(ctx.living.uniforms.uStars.value, cur * 0.8); },
      tapScore: (hit) => (hit.sky > 0.5 ? 0.3 : 0),
      onTap() { target = target > 0.4 ? 0 : 0.85; },
      setIntensity(v) { target = v * 0.9; },
      dispose() { ctx.living.uniforms.uNight.value = 0; },
    };
  },
};

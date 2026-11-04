import * as THREE from 'three';
import { QuadField, GLSL_NOISE, toLocal, noise1, rand, clamp } from '../common.js';

const PLANE_VS = /* glsl */`
attribute vec4 aPos;   // x, y, z, rotation
attribute vec2 aSize;
vec3 planePos(){ float c = cos(aPos.w), s = sin(aPos.w); vec2 k = corner * aSize; return vec3(aPos.xy + vec2(c*k.x - s*k.y, s*k.x + c*k.y), aPos.z); }
`;

// ------------------------------------------------------------------ flames
export const Flames = {
  id: 'flames', name: 'Living flames', group: 'Light',
  hint: 'Tap a flame to make it flare · swipe hard to blow it',
  score: (s) => (s.cues.flames > 0 ? 1 : 0),
  available: () => true,
  create(ctx) {
    const { scene, aspect } = ctx;
    let flames = scene.blobs.filter((b) => b.kind === 'flame').slice(0, 40);
    if (!flames.length) {
      // manual add on a canvas without flames: line of candles near the bottom
      flames = Array.from({ length: 5 }, (_, i) => ({ nx: 0.2 + i * 0.15, top: 0.78, bottom: 0.84, ny: 0.81, nw: 0.018, nh: 0.06 }));
    }
    const n = flames.length;
    const field = new QuadField({
      count: n, attributes: { aPos: 4, aSize: 2, aParam: 4 },
      uniforms: { uWind: { value: ctx.wind } },
      vertexShader: PLANE_VS + /* glsl */`
        attribute vec4 aParam; // seed, flicker, flare, intensity
        varying vec2 vUv; varying vec4 vP;
        void main(){ vUv = corner + 0.5; vP = aParam;
          vec3 p = planePos(); p.y += corner.y * aSize.y * aParam.z * 0.6 + aSize.y * aParam.z * 0.3; p.x += corner.x * aSize.x * aParam.z * 0.3;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
      fragmentShader: GLSL_NOISE + /* glsl */`
        uniform float uTime, uOpacity; uniform vec2 uWind; varying vec2 vUv; varying vec4 vP;
        void main(){
          float seed = vP.x, fl = vP.y, inten = vP.w;
          float t = uTime * 1.6 + seed * 13.0;
          float y = vUv.y;
          float sway = (vnoise(vec2(seed * 7.0, t * 1.7)) - 0.5) * 0.22 + uWind.x * 0.22;
          float x = vUv.x - 0.5 - sway * y * y;
          float turb = (fbm(vec2(vUv.x * 3.0 + seed, y * 3.5 - t * 2.6)) - 0.5) * 0.28 * y;
          float w = 0.62 * pow(max(y, 0.0), 0.42) * pow(max(1.0 - y, 0.0), 0.7) * (0.85 + 0.25 * fl);
          float d = abs(x + turb) / max(w, 1e-3);
          float tip = 1.0 - (1.0 - fl) * 0.25;
          float body = smoothstep(1.0, 0.45, d) * smoothstep(0.0, 0.06, y) * smoothstep(tip, tip - 0.3, y);
          float core = smoothstep(0.55, 0.0, d) * smoothstep(0.6, 0.12, y);
          vec3 c = mix(vec3(1.0, 0.28, 0.04), vec3(1.0, 0.72, 0.22), smoothstep(0.0, 0.8, 1.0 - d));
          c = mix(c, vec3(1.0, 0.97, 0.86), core);
          c += vec3(0.15, 0.25, 0.9) * core * smoothstep(0.18, 0.0, y) * 0.6;
          gl_FragColor = vec4(c * body * inten * uOpacity * 1.15, 1.0);
        }`,
    });
    const halo = new QuadField({
      count: n, attributes: { aPos: 4, aSize: 2, aParam: 4 },
      vertexShader: PLANE_VS + /* glsl */`attribute vec4 aParam; varying vec2 vUv; varying float vI;
        void main(){ vUv = corner; vI = aParam.y * aParam.w * (1.0 + aParam.z); gl_Position = projectionMatrix * modelViewMatrix * vec4(planePos(), 1.0); }`,
      fragmentShader: /* glsl */`uniform float uOpacity; varying vec2 vUv; varying float vI;
        void main(){ float d = length(vUv) * 2.0; float g = exp(-d * d * 3.5) * 0.55 + exp(-d * d * 14.0) * 0.6; gl_FragColor = vec4(vec3(1.0, 0.62, 0.25) * g * vI * 0.28 * uOpacity, 1.0); }`,
    });
    const embers = new QuadField({
      count: 160, attributes: { aPos: 4, aSize: 2, aParam: 4 },
      vertexShader: PLANE_VS + /* glsl */`attribute vec4 aParam; varying vec2 vUv; varying float vA;
        void main(){ vUv = corner; vA = aParam.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(planePos(), 1.0); }`,
      fragmentShader: /* glsl */`uniform float uOpacity; varying vec2 vUv; varying float vA;
        void main(){ float d = length(vUv) * 2.0; float g = exp(-d * d * 6.0); gl_FragColor = vec4(vec3(1.0, 0.6, 0.2) * g * vA * uOpacity, 1.0); }`,
    });
    const st = flames.map((b, i) => {
      const w = Math.max(0.006, b.nw) * 1.5, h = Math.max(0.012, b.nh * aspect) * 1.7;
      const base = toLocal(b.nx, b.bottom, aspect);
      return { b, w, h, base, seed: Math.random() * 10, flare: 0, flick: 1, light: ctx.allocLight() };
    });
    st.forEach((f, i) => {
      field.set('aPos', i, f.base.x, f.base.y + f.h * 0.5 - f.h * 0.08, 0.003, 0);
      field.set('aSize', i, f.w, f.h);
      halo.set('aPos', i, f.base.x, f.base.y + f.h * 0.4, 0.002, 0);
      halo.set('aSize', i, f.h * 2.6, f.h * 2.6);
    });
    const ember = Array.from({ length: 160 }, () => ({ life: 0 }));
    field.touch('aPos', 'aSize'); halo.touch('aPos', 'aSize');
    ctx.root.add(halo.mesh, field.mesh, embers.mesh);
    halo.mesh.renderOrder = 2; field.mesh.renderOrder = 3; embers.mesh.renderOrder = 4;
    let intensity = 1;
    const spawnEmber = (f, burst) => {
      const e = ember.find((x) => x.life <= 0); if (!e) return;
      e.life = e.max = rand(0.8, 1.8);
      e.x = f.base.x + rand(-0.3, 0.3) * f.w; e.y = f.base.y + f.h * rand(0.5, 0.9);
      e.vx = rand(-0.02, 0.02) * (burst ? 2 : 1); e.vy = rand(0.03, 0.08) * (burst ? 1.6 : 1); e.s = rand(0.002, 0.005);
    };
    ctx.audio?.bed('fire', 0.25 * Math.min(1, n / 4));

    return {
      update(dt, t) {
        const gust = clamp((ctx.wind.length() - 1.2) / 1.6, 0, 1); // strong swipe nearly blows flames out
        st.forEach((f, i) => {
          f.flare = Math.max(0, f.flare - dt * 1.2);
          let fl = 0.78 + 0.22 * noise1(t * 9 + f.seed * 31) - 0.12 * Math.pow(noise1(t * 3.1 + f.seed), 4);
          fl *= 1 - gust * 0.75;
          f.flick += (fl - f.flick) * Math.min(1, dt * 20);
          const I = intensity * (1 + f.flare * 0.8);
          field.set('aParam', i, f.seed, f.flick, f.flare, I);
          halo.set('aParam', i, f.seed, f.flick, f.flare, I);
          if (f.light >= 0) ctx.setLight(f.light, f.b.nx, f.b.ny, Math.max(0.04, f.h * 1.5), (0.32 + f.flare * 0.6) * f.flick * intensity, [1.0, 0.6, 0.25]);
          if (i < 12) ctx.living.uniforms.uHeat.value[i].set(f.b.nx, f.b.top, f.b.nw * (1 + f.flare));
          if (Math.random() < dt * (0.15 + f.flare * 12)) spawnEmber(f, f.flare > 0.2);
        });
        field.touch('aParam'); halo.touch('aParam');
        ember.forEach((e, i) => {
          if (e.life > 0) {
            e.life -= dt; e.x += (e.vx + ctx.wind.x * 0.03) * dt; e.y += e.vy * dt; e.vx += rand(-0.02, 0.02) * dt * 10;
            embers.set('aPos', i, e.x, e.y, 0.004, 0); embers.set('aSize', i, e.s, e.s); embers.set('aParam', i, Math.max(0, e.life / e.max) * intensity, 0, 0, 0);
          } else embers.set('aSize', i, 0, 0);
        });
        embers.touch('aPos', 'aSize', 'aParam');
        for (const q of [field, halo, embers]) q.uniforms.uTime.value = t;
      },
      nearest(hit) {
        let best = null, bd = 1e9;
        st.forEach((f) => { const d = Math.hypot(f.b.nx - hit.nx, (f.b.ny - hit.ny) * aspect); if (d < bd) { bd = d; best = f; } });
        return { f: best, d: bd };
      },
      tapScore(hit) { const { f, d } = this.nearest(hit); return f && d < Math.max(0.06, f.h * 1.5) ? 1 : 0; },
      onTap(hit) {
        const { f } = this.nearest(hit);
        f.flare = 1.2;
        st.forEach((o) => { const d = Math.hypot(o.b.nx - f.b.nx, (o.b.ny - f.b.ny) * aspect); if (o !== f && d < 0.25) o.flare = Math.max(o.flare, 0.5 * (1 - d / 0.25)); });
        for (let k = 0; k < 14; k++) spawnEmber(f, true);
        ctx.audio?.play('whoosh');
      },
      setIntensity(v) { intensity = v; },
      setOpacity(o) { for (const q of [field, halo, embers]) q.uniforms.uOpacity.value = o; },
      dispose() {
        st.forEach((f, i) => { ctx.freeLight(f.light); if (i < 12) ctx.living.uniforms.uHeat.value[i].set(-1, -1, 0); });
        ctx.audio?.bed('fire', 0);
        for (const q of [field, halo, embers]) { ctx.root.remove(q.mesh); q.dispose(); }
      },
    };
  },
};

// ------------------------------------------------------------------ fairy / string lights
const PATTERNS = ['twinkle', 'chase', 'breathe', 'alternate', 'sparkle', 'steady'];
export const FairyLights = {
  id: 'fairy', name: 'Blinking lights', group: 'Light',
  hint: 'Tap the lights to change their blink pattern',
  pick: (s) => {
    // exclude decoration right around flames (painted diya bowls, candle holders)
    const flames = s.blobs.filter((b) => b.kind === 'flame');
    const nearFlame = (b) => flames.some((f) => Math.abs(f.nx - b.nx) < Math.max(0.05, f.nw * 3) && b.ny > f.top - 0.02 && b.ny < f.bottom + 0.08);
    return s.blobs.filter((b) => (b.kind === 'light' || b.kind === 'glow') && b.contrast > 0.18 && b.bg < 0.55 && b.sat > 0.2 && b.area < 0.003 && !nearFlame(b));
  },
  // auto-on only for colourful / festive strings; streetlamps in a city shouldn't "chase"
  score(s) { const n = this.pick(s).length; const festive = Math.max(s.themes.festival, s.cues.lightHueVariety >= 3 ? 0.7 : 0.2); return n >= 4 ? Math.min(1, 0.4 + n / 20) * festive * (s.themes.day > 0.6 ? 0.4 : 1) : 0; },
  available(s) { return this.pick(s).length > 0; },
  create(ctx) {
    const { aspect } = ctx;
    const L = FairyLights.pick(ctx.scene).slice(0, 300).sort((a, b) => a.nx - b.nx);
    const n = L.length;
    const common = PLANE_VS + /* glsl */`
      attribute vec4 aParam;  // order(0..1), seed, kind, -
      attribute vec3 aCol;
      uniform float uTime, uPattern, uPrev, uBlend, uInt;
      varying vec2 vUv; varying vec3 vCol; varying float vLevel;
      float hash(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
      float level(float pat, float o, float s){
        if (pat < 0.5) { float k = floor(uTime * (1.3 + s) + s * 9.0); return hash(k + s * 71.0) > 0.35 ? 1.0 : 0.15; }
        if (pat < 1.5) { float ph = fract(o * 6.0 - uTime * 0.8); return smoothstep(0.0, 0.15, ph) * smoothstep(0.55, 0.3, ph) * 0.9 + 0.1; }
        if (pat < 2.5) { return 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 2.0 - o * 10.0)); }
        if (pat < 3.5) { float ab = mod(floor(o * 400.0 + 0.5), 2.0); float on = step(0.5, fract(uTime * 0.9)); return abs(ab - on) < 0.5 ? 1.0 : 0.12; }
        if (pat < 4.5) { float k = floor(uTime * 9.0 + s * 3.0); return hash(k * 1.7 + s * 13.0) > 0.8 ? 1.0 : 0.35; }
        return 1.0;
      }
      void lvl(){ vLevel = mix(level(uPrev, aParam.x, aParam.y), level(uPattern, aParam.x, aParam.y), uBlend) * uInt + (1.0 - uInt); }
    `;
    const cover = new QuadField({
      count: n, attributes: { aPos: 4, aSize: 2, aParam: 4, aCol: 3 }, blending: THREE.NormalBlending,
      uniforms: { uPattern: { value: 0 }, uPrev: { value: 0 }, uBlend: { value: 1 }, uInt: { value: 1 } },
      vertexShader: common + /* glsl */`attribute vec3 aBg; varying vec3 vBg;
        void main(){ vUv = corner; vCol = aCol; vBg = aBg; lvl(); gl_Position = projectionMatrix * modelViewMatrix * vec4(planePos(), 1.0); }`,
      fragmentShader: /* glsl */`uniform float uOpacity; varying vec2 vUv; varying vec3 vCol; varying vec3 vBg; varying float vLevel;
        void main(){ float d = length(vUv) * 2.0; float a = smoothstep(1.0, 0.55, d) * (1.0 - vLevel) * 0.92 * uOpacity;
          gl_FragColor = vec4(mix(vBg, vCol * 0.35 + vBg * 0.4, smoothstep(0.7, 0.0, d)), a); }`,
    });
    cover.geometry.setAttribute('aBg', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    const halo = new QuadField({
      count: n, attributes: { aPos: 4, aSize: 2, aParam: 4, aCol: 3 },
      uniforms: { uPattern: cover.uniforms.uPattern, uPrev: cover.uniforms.uPrev, uBlend: cover.uniforms.uBlend, uInt: cover.uniforms.uInt },
      vertexShader: common + /* glsl */`void main(){ vUv = corner; vCol = aCol; lvl(); gl_Position = projectionMatrix * modelViewMatrix * vec4(planePos(), 1.0); }`,
      fragmentShader: /* glsl */`uniform float uOpacity; varying vec2 vUv; varying vec3 vCol; varying float vLevel;
        void main(){ float d = length(vUv) * 2.0; float g = exp(-d * d * 9.0) * 0.9 + exp(-d * d * 60.0);
          gl_FragColor = vec4(mix(vCol, vec3(1.0), exp(-d * d * 80.0)) * g * vLevel * uOpacity * 0.8, 1.0); }`,
    });
    const bgA = cover.geometry.attributes.aBg.array;
    L.forEach((b, i) => {
      const p = toLocal(b.nx, b.ny, aspect);
      const r = Math.max(b.nw, b.nh * aspect, 0.004);
      for (const q of [cover, halo]) {
        q.set('aPos', i, p.x, p.y, q === cover ? 0.001 : 0.002, 0);
        q.set('aParam', i, i / Math.max(1, n - 1), Math.random(), 0, 0);
        q.set('aCol', i, ...b.color);
      }
      cover.set('aSize', i, r * 1.6, r * 1.6);
      halo.set('aSize', i, r * 6, r * 6);
      const bg = ctx.sampleRing(b.nx, b.ny, r * 1.4);
      bgA.set(bg, i * 3);
    });
    cover.touch('aPos', 'aSize', 'aParam', 'aCol', 'aBg'); halo.touch('aPos', 'aSize', 'aParam', 'aCol');
    cover.mesh.renderOrder = 1; halo.mesh.renderOrder = 2;
    ctx.root.add(cover.mesh, halo.mesh);
    let pat = 0;
    const u = cover.uniforms;
    return {
      update(dt, t) { cover.uniforms.uTime.value = halo.uniforms.uTime.value = t; u.uBlend.value = Math.min(1, u.uBlend.value + dt * 2); },
      tapScore(hit) {
        let bd = 1e9; for (const b of L) bd = Math.min(bd, Math.hypot(b.nx - hit.nx, (b.ny - hit.ny) * aspect));
        return bd < 0.06 ? 0.8 : 0;
      },
      onTap() { u.uPrev.value = pat; pat = (pat + 1) % PATTERNS.length; u.uPattern.value = pat; u.uBlend.value = 0; ctx.audio?.play('chime'); ctx.toast?.('Lights: ' + PATTERNS[pat]); },
      setIntensity(v) { u.uInt.value = v; },
      setOpacity(o) { cover.uniforms.uOpacity.value = halo.uniforms.uOpacity.value = o; },
      dispose() { for (const q of [cover, halo]) { ctx.root.remove(q.mesh); q.dispose(); } },
    };
  },
};

// ------------------------------------------------------------------ city windows
export const Windows = {
  id: 'windows', name: 'Window lights', group: 'City',
  hint: 'Tap a building to switch its lights',
  score: (s) => (s.cues.windows >= 6 ? 0.9 : 0),
  available: (s) => s.cues.windows >= 6,
  create(ctx) {
    const { aspect } = ctx;
    const W = ctx.scene.blobs.filter((b) => b.kind === 'window').slice(0, 600);
    const n = W.length;
    const q = new QuadField({
      count: n, attributes: { aPos: 4, aSize: 2, aParam: 4, aCol: 3 }, blending: THREE.NormalBlending,
      vertexShader: PLANE_VS + /* glsl */`attribute vec4 aParam; attribute vec3 aCol; attribute vec3 aBg; varying vec2 vUv; varying vec4 vP; varying vec3 vCol; varying vec3 vBg;
        void main(){ vUv = corner; vP = aParam; vCol = aCol; vBg = aBg; gl_Position = projectionMatrix * modelViewMatrix * vec4(planePos(), 1.0); }`,
      fragmentShader: /* glsl */`uniform float uOpacity, uTime; varying vec2 vUv; varying vec4 vP; varying vec3 vCol; varying vec3 vBg;
        void main(){ float on = vP.x; float tv = vP.y;
          vec2 e = smoothstep(vec2(0.5), vec2(0.38), abs(vUv));
          float flick = 1.0 - tv * (0.35 + 0.35 * sin(uTime * 11.0 + vP.z * 50.0) * sin(uTime * 3.7 + vP.z * 20.0));
          vec3 lit = mix(vCol, vec3(0.55, 0.7, 1.0), tv * 0.7) * flick;
          vec3 c = mix(vBg * 0.9, lit, on);
          float a = e.x * e.y * uOpacity * max(1.0 - on, tv * 0.6 + abs(1.0 - flick));
          gl_FragColor = vec4(c, a); }`,
    });
    q.geometry.setAttribute('aBg', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    const bgA = q.geometry.attributes.aBg.array;
    const st = W.map((b, i) => {
      const p = toLocal(b.nx, b.ny, aspect);
      q.set('aPos', i, p.x, p.y, 0.001, 0); q.set('aSize', i, b.nw * 1.3, b.nh * aspect * 1.3); q.set('aCol', i, ...b.color);
      bgA.set(ctx.sampleRing(b.nx, b.ny, Math.max(b.nw, b.nh) * 1.2), i * 3);
      return { b, on: 1, target: 1, tv: Math.random() < 0.06 ? 1 : 0, seed: Math.random() };
    });
    q.touch('aPos', 'aSize', 'aCol', 'aBg');
    q.mesh.renderOrder = 1;
    ctx.root.add(q.mesh);
    let rate = 1;
    return {
      update(dt, t) {
        st.forEach((s, i) => {
          if (Math.random() < dt * 0.03 * rate) s.target = s.target ? 0 : 1;
          s.on += (s.target - s.on) * Math.min(1, dt * 12);
          q.set('aParam', i, s.on, s.tv, s.seed, 0);
        });
        q.touch('aParam'); q.uniforms.uTime.value = t;
      },
      tapScore(hit) {
        let bd = 1e9; for (const s of st) bd = Math.min(bd, Math.hypot(s.b.nx - hit.nx, (s.b.ny - hit.ny) * aspect));
        return bd < 0.05 ? 0.55 : 0;
      },
      onTap(hit) {
        // switch a building's column of windows in a cascade
        const near = st.filter((s) => Math.abs(s.b.nx - hit.nx) < 0.04).sort((a, b) => b.b.ny - a.b.ny);
        const turnOn = near.filter((s) => s.target).length < near.length / 2;
        near.forEach((s, k) => setTimeout(() => { s.target = turnOn ? 1 : 0; }, k * 40));
        ctx.audio?.play('click');
      },
      setIntensity(v) { rate = 0.3 + v * 1.7; },
      setOpacity(o) { q.uniforms.uOpacity.value = o; },
      dispose() { ctx.root.remove(q.mesh); q.dispose(); },
    };
  },
};

// ------------------------------------------------------------------ sun / moon / lamps glow
export const Glow = {
  id: 'glow', name: 'Sun & lamp glow', group: 'Light',
  hint: 'Lamps hum and pulse; the sun casts shifting rays',
  sun: (s) => s.blobs.find((b) => b.kind === 'sun' || b.kind === 'moon') || s.blobs.find((b) => b.kind === 'glow' && b.area > 0.001 && b.ny < Math.max(0.2, s.horizon) && b.lum > 0.75 && b.sat < 0.5),
  lamps: (s) => {
    const flames = s.blobs.filter((b) => b.kind === 'flame');
    if (s.themes.night < 0.3) return []; // lamps only read as lamps in the dark (daylight flowers are not lamps)
    return s.blobs.filter((b) => (b.kind === 'glow' || (b.kind === 'light' && b.sat < 0.6)) && b.contrast > 0.2 && b.bg < 0.35 && b.ny > 0.25 && b.area < 0.004
      && !flames.some((f) => Math.hypot(f.nx - b.nx, f.ny - b.ny) < 0.1)).slice(0, 10);
  },
  score(s) { return this.sun(s) ? 0.8 : this.lamps(s).length >= 2 ? 0.55 : 0; },
  available(s) { return !!this.sun(s) || this.lamps(s).length > 0; },
  create(ctx) {
    const sun = Glow.sun(ctx.scene);
    const lamps = Glow.lamps(ctx.scene).map((b) => ({ b, light: ctx.allocLight(), seed: Math.random() * 100, fail: Math.random() < 0.2 }));
    let inten = 1;
    return {
      update(dt, t) {
        const S = ctx.living.uniforms.uSun.value;
        if (sun) S.set(sun.nx, sun.ny, Math.max(0.02, Math.max(sun.nw, sun.nh) * 0.5), (sun.kind === 'moon' ? 0.5 : 1) * inten);
        for (const l of lamps) {
          let f = 0.85 + 0.15 * noise1(t * 2 + l.seed);
          if (l.fail && noise1(t * 0.7 + l.seed) > 0.72) f *= noise1(t * 25 + l.seed) > 0.5 ? 1 : 0.2;
          ctx.setLight(l.light, l.b.nx, l.b.ny, Math.max(0.03, l.b.nw * 2.5), 0.3 * f * inten, l.b.color);
        }
      },
      tapScore: () => 0,
      setIntensity(v) { inten = v; },
      dispose() { ctx.living.uniforms.uSun.value.set(-1, -1, 0, 0); lamps.forEach((l) => ctx.freeLight(l.light)); },
    };
  },
};

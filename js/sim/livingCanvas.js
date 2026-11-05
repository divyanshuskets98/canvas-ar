import * as THREE from 'three';
import { GLSL_NOISE } from './common.js';

// The "living canvas": a re-render of the captured painting, laid exactly over the
// physical canvas, whose pixels are animated region-by-region using the masks from
// the vision pipeline (sky billows, water waves & ripples, foliage sways, flames
// relight their surroundings, heat shimmers, boats bob, night falls, lightning flashes).

const MAX_RIPPLES = 20;

export class LivingCanvas {
  constructor({ texture, baseTexture, holeMask, scene, maxLights = 24 }) {
    this.scene = scene;
    const aspect = scene.aspect;
    const m = scene.maskData;
    this.maskTex = new THREE.DataTexture(m.data, m.w, m.h, THREE.RGBAFormat);
    this.maskTex.magFilter = this.maskTex.minFilter = THREE.LinearFilter;
    this.maskTex.needsUpdate = true;

    const hasWater = scene.cues.waterArea > 0.005;
    // inpainted copy of the canvas + per-class hole masks (birds, floaters, clouds) so animated
    // object sprites can leave their original spot without leaving a static copy behind
    const hm = holeMask || { data: new Uint8Array([0, 0, 0, 255]), w: 1, h: 1 };
    this.holeTex = new THREE.DataTexture(hm.data, hm.w, hm.h, THREE.RGBAFormat);
    this.holeTex.magFilter = this.holeTex.minFilter = THREE.LinearFilter; this.holeTex.needsUpdate = true;
    const img = texture.image;
    this.nLights = maxLights;
    this.ripples = Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
    this.rippleIdx = 0;

    this.uniforms = {
      uMap: { value: texture }, uBase: { value: baseTexture || texture }, uHole: { value: this.holeTex }, uHoleOn: { value: new THREE.Vector3(0, 0, 0) }, uHoleGain: { value: 1 },
      uTexel: { value: new THREE.Vector2(1 / (img?.width || 1024), 1 / (img?.height || 1024)) },
      uMask: { value: this.maskTex }, uTime: { value: 0 }, uAspect: { value: aspect },
      uWind: { value: new THREE.Vector2(0.3, 0) },
      uSkyBillow: { value: 0 }, uCloudAmt: { value: 0 }, uCloudCover: { value: 0.4 }, uCloudDark: { value: 0 },
      uWaveAmp: { value: 0 }, uHorizon: { value: scene.horizon || 0.4 }, uSparkle: { value: 0 },
      uSway: { value: 0 }, uShakeCenter: { value: new THREE.Vector2(-1, -1) }, uShake: { value: 0 },
      uRipples: { value: this.ripples },
      uLights: { value: Array.from({ length: maxLights }, () => new THREE.Vector4()) },
      uLightColors: { value: Array.from({ length: maxLights }, () => new THREE.Vector3()) },
      uHeat: { value: Array.from({ length: 12 }, () => new THREE.Vector3(-1, -1, 0)) },
      uBoats: { value: Array.from({ length: 4 }, () => new THREE.Vector4(-1, -1, 0, 0)) }, uBob: { value: 0 },
      uSun: { value: new THREE.Vector4(-1, -1, 0, 0) },
      uFlash: { value: 0 }, uNight: { value: 0 }, uWet: { value: 0 }, uStars: { value: 0 },
      uOpacity: { value: 0 }, uMasked: { value: 0 }, uGain: { value: new THREE.Vector3(1, 1, 1) },
    };

    const defines = { N_LIGHTS: maxLights, N_RIPPLES: hasWater ? MAX_RIPPLES : 0 };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, defines, transparent: true, depthWrite: true,
      vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: FRAG,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, aspect), this.material);
    this.mesh.renderOrder = 0;
  }

  addRipple(nx, ny, amp = 1, time) {
    const r = this.ripples[this.rippleIdx];
    r.set(nx, ny, time, amp);
    this.rippleIdx = (this.rippleIdx + 1) % MAX_RIPPLES;
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); this.maskTex.dispose(); this.holeTex.dispose(); }
}

const FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uMap, uBase, uHole, uMask;
uniform vec3 uHoleOn; uniform vec2 uTexel; uniform float uHoleGain;
uniform float uTime, uAspect;
uniform vec2 uWind;
uniform float uSkyBillow, uCloudAmt, uCloudCover, uCloudDark;
uniform float uWaveAmp, uHorizon, uSparkle;
uniform float uSway, uShake; uniform vec2 uShakeCenter;
#if N_RIPPLES > 0
uniform vec4 uRipples[N_RIPPLES];
#endif
uniform vec4 uLights[N_LIGHTS]; uniform vec3 uLightColors[N_LIGHTS];
uniform vec3 uHeat[12];
uniform vec4 uBoats[4]; uniform float uBob;
uniform vec4 uSun;
uniform float uFlash, uNight, uWet, uStars, uOpacity, uMasked;
uniform vec3 uGain;
${GLSL_NOISE}
vec3 tex(vec2 p){
  vec2 t = vec2(p.x, 1.0 - p.y);
  vec3 c = texture2D(uMap, t).rgb;
  float h = dot(texture2D(uHole, p).rgb, uHoleOn) * uHoleGain;
  return h > 0.001 ? mix(c, texture2D(uBase, t).rgb, clamp(h, 0.0, 1.0)) : c;
}
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }

void main(){
  vec2 p = vec2(vUv.x, 1.0 - vUv.y);           // image space, y down
  vec4 m = texture2D(uMask, p);                 // r sky, g water, b vegetation, a snow
  vec2 off = vec2(0.0);
  float activity = 0.0;

  // --- vegetation: spatially varying rustle + wind gusts + tap shake
  if (m.b > 0.01 && uSway > 0.0) {
    float n = vnoise(p * vec2(7.0, 11.0) + vec2(uTime * 0.7, uTime * 0.3)) - 0.5;
    float gust = 0.6 + 0.4 * sin(uTime * 1.1 + p.x * 5.0 + vnoise(vec2(uTime * 0.3, p.y * 3.0)) * 3.0);
    off.x += m.b * uSway * (n * 0.0035 + uWind.x * 0.0035 * gust);
    off.y += m.b * uSway * n * 0.0012;
    vec2 sd = (p - uShakeCenter) * vec2(1.0, uAspect);
    off += m.b * uShake * exp(-dot(sd, sd) * 60.0) * vec2(sin(uTime * 38.0), cos(uTime * 31.0)) * 0.006;
    activity += m.b * uSway;
  }

  // --- sky: slow billowing of painted clouds
  if (m.r > 0.01 && uSkyBillow > 0.0) {
    vec2 q = p * vec2(3.0, 5.0) + vec2(-uTime * 0.04 * sign(uWind.x + 1e-3), 0.0);
    off += m.r * uSkyBillow * (vec2(vnoise(q), vnoise(q + 17.3)) - 0.5) * 0.008;
    activity += m.r * uSkyBillow * 0.6;
  }

  // --- heat shimmer above flames
  for (int i = 0; i < 12; i++) {
    vec3 h = uHeat[i]; if (h.z <= 0.0) continue;
    vec2 d = (p - h.xy) / vec2(h.z * 1.4, h.z * 4.0);
    if (p.y < h.y + h.z * 0.4) {
      float k = exp(-dot(d, d));
      off.x += (vnoise(vec2(p.x * 90.0, p.y * 70.0 + uTime * 7.0)) - 0.5) * 0.004 * k;
      activity += k;
    }
  }

  // --- boats / floating objects bob
  for (int i = 0; i < 4; i++) {
    vec4 b = uBoats[i]; if (b.z <= 0.0) continue;
    vec2 e = smoothstep(vec2(0.0), vec2(0.015), p - b.xy) * smoothstep(vec2(0.0), vec2(0.015), b.xy + b.zw - p);
    float inside = e.x * e.y;
    off.y += inside * uBob * sin(uTime * 1.5 + float(i) * 2.1) * 0.003;
    off.x += inside * uBob * sin(uTime * 0.6 + float(i)) * 0.002;
    activity += inside * uBob;
  }

  // --- water: travelling waves, analytic ripple rings, sparkles
  vec2 grad = vec2(0.0); float spark = 0.0;
  if (m.g > 0.01) {
    float depth = clamp((p.y - uHorizon) / max(0.05, 1.0 - uHorizon), 0.03, 1.0);
    if (uWaveAmp > 0.0) {
      float k = mix(260.0, 55.0, depth);
      float n = vnoise(vec2(p.x * mix(70.0, 14.0, depth), p.y * k * 0.12 - uTime * 0.35));
      float wave = sin(p.y * k - uTime * 2.2 + n * 6.2831);
      off.y += m.g * wave * uWaveAmp * 0.0022 * depth;
      off.x += m.g * (n - 0.5) * uWaveAmp * 0.004 * depth;
      grad.y += wave * 0.25 * uWaveAmp;
    }
#if N_RIPPLES > 0
    float squash = mix(3.2, 1.5, depth);   // painted water recedes in perspective → elliptical rings
    for (int i = 0; i < N_RIPPLES; i++) {
      vec4 r = uRipples[i];
      float age = uTime - r.z;
      if (age < 0.0 || age > 4.0) continue;
      vec2 dv = (p - r.xy) * vec2(1.0, uAspect * squash);
      float d = length(dv);
      float x = d - age * 0.08;
      float env = exp(-x * x * 2500.0) * exp(-age * 1.1) * r.w;
      grad += normalize(dv + 1e-5) * cos(x * 280.0) * env;
    }
#endif
    off += m.g * grad * 0.0045;
    float sp = vnoise(vec2(p.x * 170.0, p.y * 520.0) + vec2(uTime * 0.7, -uTime * 1.7));
    spark = pow(sp, 16.0) * uSparkle * (0.4 + depth) * m.g * 2.5;
    activity += m.g * (uWaveAmp + length(grad) * 4.0);
  }

  vec2 q = p + off;

  vec3 col = tex(q);
  vec3 base = col;

  // --- procedural drifting clouds (soft, follow wind) inside the sky
  if (m.r > 0.01 && uCloudAmt > 0.0) {
    vec2 cp = vec2(q.x * 2.6 - uTime * 0.025 * (0.3 + uWind.x), q.y * 5.5 * uAspect);
    float c = fbm(cp + fbm(cp * 0.7 + uTime * 0.01) * 0.8);
    float cl = smoothstep(0.62 - uCloudCover * 0.32, 0.92, c) * m.r * uCloudAmt;
    float L = luma(col);
    vec3 lightCloud = mix(vec3(1.0), col, 0.25) * mix(1.0, 0.35, uNight) + vec3(L * 0.15);
    vec3 darkCloud = mix(col, vec3(0.18, 0.2, 0.24), 0.65);
    col = mix(col, mix(lightCloud, darkCloud, uCloudDark), cl * 0.7);
    activity += cl;
  }

  // --- existing stars twinkle: points brighter than their surroundings in a dark sky
  if (uStars > 0.0 && m.r > 0.1) {
    float L0 = luma(col);
    vec3 ring = tex(q + vec2(uTexel.x * 3.0, 0.0)) + tex(q - vec2(uTexel.x * 3.0, 0.0)) + tex(q + vec2(0.0, uTexel.y * 3.0)) + tex(q - vec2(0.0, uTexel.y * 3.0));
    float Lm = luma(ring * 0.25);
    float k = smoothstep(0.06, 0.25, L0 - Lm) * (1.0 - smoothstep(0.2, 0.45, Lm)) * m.r;
    if (k > 0.0) {
      vec2 cell = floor(q / (uTexel * 6.0));
      float h = hash12(cell);
      float tw = 0.5 + 0.5 * sin(uTime * (1.5 + h * 5.0) + h * 91.0);
      vec3 bg = ring * 0.25;
      col = mix(col, bg + (col - bg) * (0.25 + 1.1 * tw), k * uStars);
      activity += k;
    }
  }

  // --- sun / moon glow & rays
  if (uSun.w > 0.0) {
    vec2 sd = (q - uSun.xy) * vec2(1.0, uAspect);
    float d = length(sd);
    float a = atan(sd.y, sd.x);
    float rays = pow(max(0.0, vnoise(vec2(a * 6.0, uTime * 0.15)) * vnoise(vec2(a * 13.0 + 4.0, -uTime * 0.1))), 1.5);
    float glowK = exp(-d / (uSun.z * 2.5)) * (0.75 + 0.25 * sin(uTime * 0.8));
    float rayK = rays * exp(-d / (uSun.z * 6.0)) * smoothstep(uSun.z * 0.8, uSun.z * 1.6, d);
    col += vec3(1.0, 0.93, 0.75) * (glowK * 0.28 + rayK * 0.35) * uSun.w * (0.3 + 0.7 * m.r);
    activity += glowK + rayK;
  }

  // --- night: darken & cool everything except light sources
  if (uNight > 0.0) {
    float keep = smoothstep(0.6, 0.92, luma(base));
    vec3 nightCol = col * vec3(0.22, 0.28, 0.5);
    col = mix(col, nightCol, uNight * (1.0 - keep));
    activity += uNight;
  }

  // --- dynamic lights (diyas, lamps, sun) re-light the painting around them
  vec3 glow = vec3(0.0);
  for (int i = 0; i < N_LIGHTS; i++) {
    vec4 l = uLights[i]; if (l.w <= 0.0) continue;
    vec2 dv = (q - l.xy) * vec2(1.0, uAspect);
    glow += uLightColors[i] * l.w * exp(-dot(dv, dv) / (l.z * l.z));
  }
  col = 1.0 - (1.0 - col) * (1.0 - clamp(glow * (0.3 + uNight * 0.3), 0.0, 0.85));
  activity += length(glow) * 2.0;

  // --- water highlights
  if (m.g > 0.01) {
    float hl = clamp(dot(grad, vec2(-0.45, 0.8)), 0.0, 1.0);
    col += vec3(hl * 0.22 * m.g + spark);
  }

  // --- rain: wet, slightly darker & more contrasty
  col = mix(col, pow(col, vec3(1.15)) * 0.92, uWet);

  // --- lightning flash
  col += uFlash * (0.25 + 0.75 * m.r) * vec3(0.8, 0.86, 1.0);
  activity += uFlash;

  col *= uGain;

  float edge = smoothstep(0.0, 0.012, vUv.x) * smoothstep(0.0, 0.012, 1.0 - vUv.x) * smoothstep(0.0, 0.012, vUv.y) * smoothstep(0.0, 0.012, 1.0 - vUv.y);
  float a = uOpacity * edge * mix(1.0, clamp(activity * 3.0, 0.0, 1.0), uMasked);
  gl_FragColor = vec4(col, a);
}`;

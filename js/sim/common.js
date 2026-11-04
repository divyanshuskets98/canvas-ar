import * as THREE from 'three';

// Canvas-local space: the canvas is the plane z = 0, x ∈ [-0.5, 0.5], y ∈ [-a/2, a/2]
// where a = height/width. Vision code uses normalised image coords (nx right, ny down).
export const toLocal = (nx, ny, aspect, z = 0) => new THREE.Vector3(nx - 0.5, (0.5 - ny) * aspect, z);
export const toImage = (x, y, aspect) => ({ nx: x + 0.5, ny: 0.5 - y / aspect });

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Cheap 1D value noise for CPU-side flicker
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const h = (n) => { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export const GLSL_NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; mat2 r = mat2(0.8,-0.6,0.6,0.8); for(int i=0;i<5;i++){ v += a*vnoise(p); p = r*p*2.03; a *= 0.5; } return v; }
`;

// "Window" clipping: particles live in a 3D volume in front of the canvas but are only
// drawn where the line of sight passes through the canvas – the canvas acts as a window
// into its own world, so nothing spills onto the wall around it.
export const WINDOW_VS = /* glsl */`
uniform vec3 uCamLocal; varying vec2 vWin;
void windowClip(vec3 p){ vec3 d = p - uCamLocal; float t = -uCamLocal.z / min(d.z, -1e-4); vWin = (uCamLocal + d * t).xy; }
`;
export const WINDOW_FS = /* glsl */`
uniform float uHalfH; varying vec2 vWin;
bool outsideWindow(){ return abs(vWin.x) > 0.5 || abs(vWin.y) > uHalfH; }
`;

// Instanced quads lying in the canvas plane (so they inherit perspective and
// orientation from the tracked canvas). `attributes` = { name: itemSize }.
// The vertex shader receives `corner` (−0.5..0.5) and must write gl_Position.
export class QuadField {
  constructor({ count, attributes = {}, vertexShader, fragmentShader, uniforms = {}, blending = THREE.AdditiveBlending, depthWrite = false, transparent = true }) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = count;
    this.arrays = {};
    for (const [name, size] of Object.entries(attributes)) {
      const arr = new Float32Array(count * size);
      this.arrays[name] = arr;
      const a = new THREE.InstancedBufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
    }
    this.uniforms = { uTime: { value: 0 }, uOpacity: { value: 1 }, ...uniforms };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: '#define corner position.xy\n' + vertexShader, fragmentShader,
      blending, depthWrite, transparent, depthTest: true, side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.geometry = g;
    this.count = count;
  }
  set(name, i, ...v) { const a = this.arrays[name], s = v.length; for (let k = 0; k < s; k++) a[i * s + k] = v[k]; }
  touch(...names) { for (const n of names) this.geometry.attributes[n].needsUpdate = true; }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}

// Soft round sprite texture used by several layers
let _glowTex = null;
export function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

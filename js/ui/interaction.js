import * as THREE from 'three';

// Pointer → canvas-space taps and wind drags, by ray-casting against the living canvas.
export class Interaction {
  constructor(el, { getCamera, getTarget, onTap, onDrag, onLongPress }) {
    this.el = el; this.getCamera = getCamera; this.getTarget = getTarget;
    this.onTap = onTap; this.onDrag = onDrag; this.onLongPress = onLongPress;
    this.ray = new THREE.Raycaster();
    this.down = null;
    this._d = (e) => this.pointerDown(e); this._m = (e) => this.pointerMove(e); this._u = (e) => this.pointerUp(e);
    el.addEventListener('pointerdown', this._d);
    el.addEventListener('pointermove', this._m);
    el.addEventListener('pointerup', this._u);
    el.addEventListener('pointercancel', this._u);
  }
  project(e) {
    const cam = this.getCamera(), target = this.getTarget();
    if (!cam || !target || !target.visible) return null;
    const r = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, cam);
    target.updateWorldMatrix(true, false);
    const hit = this.ray.intersectObject(target, false)[0];
    if (!hit || !hit.uv) return null;
    return { nx: hit.uv.x, ny: 1 - hit.uv.y };
  }
  pointerDown(e) {
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), last: this.project(e), lt: performance.now(), moved: false };
    clearTimeout(this.lp);
    this.lp = setTimeout(() => { if (this.down && !this.down.moved && this.down.last) { this.onLongPress?.(this.down.last); this.down.long = true; } }, 550);
  }
  pointerMove(e) {
    if (!this.down) return;
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 12) this.down.moved = true;
    if (!this.down.moved) return;
    const p = this.project(e), now = performance.now();
    if (p && this.down.last) this.onDrag?.(p.nx - this.down.last.nx, p.ny - this.down.last.ny, (now - this.down.lt) / 1000);
    this.down.last = p; this.down.lt = now;
  }
  pointerUp(e) {
    clearTimeout(this.lp);
    const d = this.down; this.down = null;
    if (!d || d.moved || d.long || performance.now() - d.t > 500) return;
    const p = this.project(e);
    if (p) this.onTap?.(p.nx, p.ny, e);
  }
  dispose() {
    this.el.removeEventListener('pointerdown', this._d); this.el.removeEventListener('pointermove', this._m);
    this.el.removeEventListener('pointerup', this._u); this.el.removeEventListener('pointercancel', this._u);
  }
}

import * as THREE from 'three';

// Desktop / no-camera preview: the canvas hangs on a virtual wall and the camera
// drifts (mouse, device tilt or auto-orbit) so you can judge anchoring & parallax.
export class PreviewSession {
  constructor(container, { aspect, autoOrbit = true }) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x1a1714);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50);
    this.stage = new THREE.Group();
    this.scene.add(this.stage);
    this.aspect = aspect;
    // wall + frame for context
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ color: 0x2a2520 }));
    wall.position.z = -0.012; this.scene.add(wall);
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x14110e });
    const t = 0.03;
    for (const [w, h, x, y] of [[1 + 2 * t, t, 0, aspect / 2 + t / 2], [1 + 2 * t, t, 0, -aspect / 2 - t / 2], [t, aspect, -0.5 - t / 2, 0], [t, aspect, 0.5 + t / 2, 0]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), frameMat); m.position.set(x, y, -0.004); this.scene.add(m);
    }
    this.mouse = new THREE.Vector2();
    this.autoOrbit = autoOrbit;
    this.t = 0;
    this._onMove = (e) => { const r = container.getBoundingClientRect(); this.mouse.set((e.clientX - r.left) / r.width * 2 - 1, (e.clientY - r.top) / r.height * 2 - 1); this.lastMouse = performance.now(); };
    this._onTilt = (e) => { if (e.gamma == null) return; this.mouse.set(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, (e.beta - 45) / 30))); this.lastMouse = performance.now(); };
    container.addEventListener('pointermove', this._onMove);
    window.addEventListener('deviceorientation', this._onTilt);
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }
  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    // distance so the canvas fills ~80% of the view
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const needH = this.aspect / 0.8, needW = 1 / 0.8 / this.camera.aspect;
    this.dist = Math.max(needH, needW) / (2 * Math.tan(fov / 2));
  }
  update(dt) {
    this.t += dt;
    const idle = !this.lastMouse || performance.now() - this.lastMouse > 4000;
    const tx = idle && this.autoOrbit ? Math.sin(this.t * 0.25) * 0.6 : this.mouse.x;
    const ty = idle && this.autoOrbit ? Math.sin(this.t * 0.17) * 0.3 : this.mouse.y;
    this.cx = (this.cx ?? 0) + (tx - (this.cx ?? 0)) * Math.min(1, dt * 3);
    this.cy = (this.cy ?? 0) + (ty - (this.cy ?? 0)) * Math.min(1, dt * 3);
    const yaw = this.cx * 0.45, pitch = -this.cy * 0.25;
    this.camera.position.set(Math.sin(yaw) * this.dist, Math.sin(pitch) * this.dist, Math.cos(yaw) * Math.cos(pitch) * this.dist);
    this.camera.lookAt(0, 0, 0);
    return [1];
  }
  render() { this.renderer.render(this.scene, this.camera); }
  stop() {
    this.renderer.setAnimationLoop(null);
    this.container.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('deviceorientation', this._onTilt);
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
    this.container.innerHTML = '';
  }
}

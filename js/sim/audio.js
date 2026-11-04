// Procedural soundscape (Web Audio): no audio files, everything is synthesised.
// Beds are continuous loops whose level behaviours set; one-shots are short events.
export class Soundscape {
  constructor() { this.ctx = null; this.enabled = false; this.beds = {}; this.levels = {}; }

  async enable() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(this.ctx.destination);
      this.noise = this._noiseBuffer(4);
      this.brown = this._noiseBuffer(4, true);
    }
    await this.ctx.resume();
    this.enabled = true;
    for (const [k, v] of Object.entries(this.levels)) this._applyBed(k, v);
    return true;
  }
  disable() { this.enabled = false; for (const k of Object.keys(this.beds)) this._applyBed(k, 0); }

  _noiseBuffer(sec, brown = false) {
    const c = this.ctx, b = c.createBuffer(1, c.sampleRate * sec, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  }
  _src(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; return s; }

  _makeBed(name) {
    const c = this.ctx, g = c.createGain(); g.gain.value = 0; g.connect(this.master);
    const nodes = [];
    const chain = (src, ...fx) => { let n = src; for (const f of fx) { n.connect(f); n = f; } n.connect(g); src.start(); nodes.push(src); };
    const filt = (type, f, Q = 0.7) => { const x = c.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = Q; return x; };
    const lfo = (target, rate, depth, base) => { const o = c.createOscillator(), og = c.createGain(); o.frequency.value = rate; og.gain.value = depth; o.connect(og).connect(target); target.value = base; o.start(); nodes.push(o); };
    if (name === 'rain') { chain(this._src(this.noise), filt('highpass', 500), filt('lowpass', 5000)); chain(this._src(this.brown), filt('lowpass', 400)); }
    else if (name === 'ocean') { const amp = c.createGain(); lfo(amp.gain, 0.09, 0.5, 0.55); chain(this._src(this.brown), filt('lowpass', 900), amp); const a2 = c.createGain(); lfo(a2.gain, 0.13, 0.3, 0.3); chain(this._src(this.noise), filt('bandpass', 1200, 0.4), a2); }
    else if (name === 'stream') { const f = filt('bandpass', 2500, 1.5); lfo(f.frequency, 0.7, 600, 2500); chain(this._src(this.noise), f); }
    else if (name === 'wind') { const f = filt('bandpass', 500, 1.2); lfo(f.frequency, 0.15, 250, 500); chain(this._src(this.noise), f); }
    else if (name === 'city') { chain(this._src(this.brown), filt('lowpass', 250)); }
    else if (name === 'fire') { chain(this._src(this.brown), filt('lowpass', 300)); this._crackle = setInterval(() => { if (this.enabled && this.levels.fire > 0) this._click(0.08 * this.levels.fire, 2500 + Math.random() * 3000); }, 90); }
    else if (name === 'crickets') { this._cricket = setInterval(() => { if (this.enabled && this.levels.crickets > 0) this._chirp(); }, 900); }
    this.beds[name] = { g, nodes };
  }
  _applyBed(name, level) {
    if (!this.ctx) return;
    if (!this.beds[name]) { if (level <= 0) return; this._makeBed(name); }
    this.beds[name].g.gain.setTargetAtTime(this.enabled ? level : 0, this.ctx.currentTime, 0.4);
  }
  bed(name, level) { if (Math.abs((this.levels[name] ?? -1) - level) < 0.02) return; this.levels[name] = level; if (this.ctx) this._applyBed(name, level); }

  _env(node, peak, a, d, t0 = this.ctx.currentTime) { const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d); node.connect(g).connect(this.master); return g; }
  _burst(dur, type, f, peak, a = 0.005, t0) { const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; const x = c.createBiquadFilter(); x.type = type; x.frequency.value = f; s.connect(x); this._env(x, peak, a, dur, t0); s.start(t0 ?? c.currentTime); s.stop((t0 ?? c.currentTime) + a + dur + 0.1); }
  _click(peak, f) { this._burst(0.03, 'highpass', f, peak); }
  _tone(freq, dur, peak, type = 'sine', t0, slideTo) { const c = this.ctx, o = c.createOscillator(); o.type = type; const T = t0 ?? c.currentTime; o.frequency.setValueAtTime(freq, T); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, T + dur); this._env(o, peak, 0.01, dur, T); o.start(T); o.stop(T + dur + 0.1); }
  _chirp() { const t = this.ctx.currentTime; for (let i = 0; i < 3; i++) this._tone(4200 + Math.random() * 300, 0.04, 0.03 * this.levels.crickets, 'sine', t + i * 0.07); }

  play(name, { delay = 0 } = {}) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    switch (name) {
      case 'thunder': this._burst(0.15, 'lowpass', 1800, 0.9, 0.01, t); this._burst(3.5, 'lowpass', 160, 1.2, 0.25, t + 0.05); break;
      case 'firework': this._burst(0.25, 'lowpass', 300, 0.7, 0.005, t); for (let i = 0; i < 12; i++) this._burst(0.04, 'highpass', 3000, 0.12, 0.002, t + 0.25 + Math.random() * 1.2); break;
      case 'splash': this._burst(0.35, 'bandpass', 1500, 0.35, 0.01, t); break;
      case 'drop': this._tone(900, 0.18, 0.12, 'sine', t, 400); break;
      case 'chime': this._tone(1320, 0.6, 0.06, 'sine', t); this._tone(1980, 0.5, 0.03, 'sine', t + 0.05); break;
      case 'whoosh': this._burst(0.5, 'bandpass', 700, 0.3, 0.08, t); break;
      case 'gust': this._burst(1.2, 'bandpass', 450, 0.25, 0.3, t); break;
      case 'rustle': for (let i = 0; i < 8; i++) this._burst(0.06, 'highpass', 2500, 0.08, 0.005, t + Math.random() * 0.5); break;
      case 'chirp': for (let i = 0; i < 3; i++) this._tone(2800 + Math.random() * 800, 0.08, 0.06, 'sine', t + i * 0.12, 4200); break;
      case 'click': this._click(0.15, 1500); break;
      case 'horn': this._tone(392, 0.35, 0.08, 'sawtooth', t); this._tone(494, 0.35, 0.06, 'sawtooth', t); break;
    }
  }
  dispose() { clearInterval(this._crackle); clearInterval(this._cricket); this.ctx?.close(); }
}

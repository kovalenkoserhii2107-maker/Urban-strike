// Весь звук синтезируется Web Audio — никаких файлов, игра работает офлайн.
export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this.listener = { x: 0, z: 0 };
    this.last = {};
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = 0.7;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.sfx = c.createGain();
      this.sfx.connect(this.master);
      this.musicBus = c.createGain();
      this.musicBus.gain.value = 0.32;
      this.musicBus.connect(this.master);
      const len = c.sampleRate * 2;
      this.noise = c.createBuffer(1, len, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.7 : 0;
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.musicBus) this.musicBus.gain.value = on ? 0.32 : 0;
  }

  setListener(x, z) {
    this.listener.x = x;
    this.listener.z = z;
  }

  noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  env(gain, t, a, peak, d) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  noiseHit(t, { type = 'lowpass', f0 = 800, f1 = f0, q = 1, a = 0.005, peak = 0.5, d = 0.3, vol = 1 }) {
    const c = this.ctx;
    const src = this.noiseSrc();
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + a + d);
    const g = c.createGain();
    this.env(g, t, a, peak * vol, d);
    src.connect(f).connect(g).connect(this.sfx);
    src.start(t, Math.random());
    src.stop(t + a + d + 0.05);
  }

  tone(t, { type = 'sine', f0 = 440, f1 = f0, a = 0.005, peak = 0.3, d = 0.2, vol = 1 }) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + a + d);
    const g = c.createGain();
    this.env(g, t, a, peak * vol, d);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + a + d + 0.05);
  }

  play(name, x, z) {
    if (!this.ctx || !this.enabled) return;
    let vol = 1;
    if (x !== undefined) {
      const d = Math.hypot(x - this.listener.x, z - this.listener.z);
      vol = Math.max(0, 1 - d / 140);
      if (vol < 0.03) return;
    }
    const now = this.ctx.currentTime;
    const minGap = { gun: 0.06, gunE: 0.05, hitMetal: 0.08, boom: 0.04, flakShot: 0.05 }[name] || 0.02;
    if (this.last[name] && now - this.last[name] < minGap) return;
    this.last[name] = now;
    const t = now + 0.005;
    switch (name) {
      case 'gun':
        this.noiseHit(t, { type: 'bandpass', f0: 1800, f1: 600, q: 0.8, peak: 0.35, d: 0.07, vol });
        this.tone(t, { type: 'square', f0: 140, f1: 60, peak: 0.12, d: 0.05, vol });
        break;
      case 'gunE':
        this.noiseHit(t, { type: 'bandpass', f0: 1200, f1: 500, q: 1, peak: 0.18, d: 0.06, vol });
        break;
      case 'rocket':
      case 'rocketE':
        this.noiseHit(t, { type: 'bandpass', f0: 1400, f1: 300, q: 1.2, a: 0.02, peak: 0.4, d: 0.5, vol });
        break;
      case 'hellfire':
        this.noiseHit(t, { type: 'bandpass', f0: 900, f1: 200, q: 1.5, a: 0.03, peak: 0.5, d: 0.8, vol });
        this.tone(t, { type: 'sawtooth', f0: 220, f1: 90, peak: 0.08, d: 0.5, vol });
        break;
      case 'samLaunch':
        this.noiseHit(t, { type: 'bandpass', f0: 600, f1: 2500, q: 1.5, a: 0.05, peak: 0.45, d: 1.0, vol });
        break;
      case 'boom':
        this.noiseHit(t, { type: 'lowpass', f0: 1800, f1: 120, a: 0.005, peak: 0.8, d: 0.7, vol });
        this.tone(t, { f0: 110, f1: 35, peak: 0.5, d: 0.5, vol });
        break;
      case 'boomBig':
        this.noiseHit(t, { type: 'lowpass', f0: 1200, f1: 60, a: 0.01, peak: 1, d: 1.6, vol });
        this.tone(t, { f0: 80, f1: 25, peak: 0.8, d: 1.0, vol });
        break;
      case 'flak':
        this.noiseHit(t, { type: 'lowpass', f0: 2400, f1: 300, peak: 0.45, d: 0.35, vol });
        break;
      case 'flakShot':
      case 'cannon':
        this.noiseHit(t, { type: 'lowpass', f0: 2000, f1: 200, peak: 0.4, d: name === 'cannon' ? 0.5 : 0.18, vol });
        this.tone(t, { f0: 160, f1: 50, peak: 0.25, d: 0.2, vol });
        break;
      case 'hitMetal':
        this.tone(t, { type: 'square', f0: 900, f1: 300, peak: 0.15, d: 0.12, vol });
        this.noiseHit(t, { type: 'highpass', f0: 3000, f1: 1500, peak: 0.2, d: 0.08, vol });
        break;
      case 'hitSoft':
        this.noiseHit(t, { type: 'lowpass', f0: 600, f1: 200, peak: 0.25, d: 0.15, vol });
        break;
      case 'pickup':
        [660, 880, 1320].forEach((f, i) => this.tone(t + i * 0.07, { type: 'triangle', f0: f, peak: 0.25, d: 0.15 }));
        break;
      case 'rescue':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.08, { type: 'triangle', f0: f, peak: 0.25, d: 0.2 }));
        break;
      case 'objective':
        [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.1, { type: 'square', f0: f, peak: 0.12, d: 0.25 }));
        break;
      case 'warn':
        [0, 0.18, 0.36].forEach((o) => this.tone(t + o, { type: 'square', f0: 980, peak: 0.14, d: 0.1 }));
        break;
      case 'lock':
        this.tone(t, { type: 'square', f0: 1500, peak: 0.08, d: 0.05 });
        break;
      case 'flare':
        this.noiseHit(t, { type: 'highpass', f0: 2000, f1: 4000, a: 0.02, peak: 0.3, d: 0.5 });
        break;
      case 'winch':
        this.tone(t, { type: 'sawtooth', f0: 90, f1: 140, a: 0.05, peak: 0.08, d: 0.8 });
        break;
      case 'shieldDown':
        this.tone(t, { type: 'sawtooth', f0: 800, f1: 60, a: 0.01, peak: 0.25, d: 1.2 });
        break;
      case 'click':
        this.tone(t, { type: 'square', f0: 700, f1: 500, peak: 0.1, d: 0.04 });
        break;
      case 'ui':
        this.tone(t, { type: 'triangle', f0: 880, f1: 1320, peak: 0.15, d: 0.08 });
        break;
    }
  }

  // Шум винта: фильтрованный шум с «хлопками» лопастей.
  startRotor() {
    if (!this.ctx || this.rotor) return;
    const c = this.ctx;
    const src = this.noiseSrc();
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const g = c.createGain();
    g.gain.value = 0;
    const lfo = c.createOscillator();
    lfo.frequency.value = 13;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.12;
    lfo.connect(lfoGain).connect(g.gain);
    src.connect(f).connect(g).connect(this.sfx);
    src.start();
    lfo.start();
    this.rotor = { src, f, g, lfo };
  }

  setRotor(level, speed) {
    if (!this.rotor) return;
    const t = this.ctx.currentTime;
    this.rotor.g.gain.setTargetAtTime(level * 0.16, t, 0.2);
    this.rotor.lfo.frequency.setTargetAtTime(12 + speed * 0.12, t, 0.3);
    this.rotor.f.frequency.setTargetAtTime(320 + speed * 8, t, 0.3);
  }

  stopRotor() {
    if (!this.rotor) return;
    this.rotor.src.stop();
    this.rotor.lfo.stop();
    this.rotor = null;
  }

  // Простой процедурный саундтрек: барабаны + бас, два настроения.
  startMusic(mood = 'action') {
    if (!this.ctx) return;
    this.stopMusic();
    const c = this.ctx;
    const bpm = mood === 'menu' ? 96 : 132;
    const step = 60 / bpm / 4;
    const bass = mood === 'menu' ? [45, 0, 45, 0, 48, 0, 43, 0, 45, 0, 45, 0, 40, 0, 43, 0] : [40, 40, 0, 40, 43, 0, 40, 0, 38, 38, 0, 38, 43, 0, 45, 0];
    let i = 0;
    let next = c.currentTime + 0.1;
    const out = this.musicBus;
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const tick = () => {
      while (next < c.currentTime + 0.2) {
        const s = i % 16;
        const t = next;
        if (s % 4 === 0) {
          const o = c.createOscillator();
          const g = c.createGain();
          o.frequency.setValueAtTime(150, t);
          o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
          this.env(g, t, 0.003, 0.9, 0.2);
          o.connect(g).connect(out);
          o.start(t);
          o.stop(t + 0.25);
        }
        if (mood !== 'menu' && (s === 4 || s === 12)) {
          const src = this.noiseSrc();
          const f = c.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.value = 1800;
          const g = c.createGain();
          this.env(g, t, 0.002, 0.45, 0.14);
          src.connect(f).connect(g).connect(out);
          src.start(t);
          src.stop(t + 0.2);
        }
        if (s % 2 === 1) {
          const src = this.noiseSrc();
          const f = c.createBiquadFilter();
          f.type = 'highpass';
          f.frequency.value = 7000;
          const g = c.createGain();
          this.env(g, t, 0.001, 0.12, 0.04);
          src.connect(f).connect(g).connect(out);
          src.start(t);
          src.stop(t + 0.06);
        }
        if (bass[s]) {
          const o = c.createOscillator();
          o.type = 'sawtooth';
          const f = c.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = mood === 'menu' ? 500 : 750;
          const g = c.createGain();
          o.frequency.value = midi(bass[s]);
          this.env(g, t, 0.005, 0.28, step * 1.6);
          o.connect(f).connect(g).connect(out);
          o.start(t);
          o.stop(t + step * 2);
        }
        if (mood === 'menu' && s % 8 === 0) {
          const chord = [57, 60, 64].map((n) => n + (Math.floor(i / 32) % 2 ? -2 : 0));
          for (const n of chord) {
            const o = c.createOscillator();
            o.type = 'triangle';
            const g = c.createGain();
            o.frequency.value = midi(n);
            this.env(g, t, 0.15, 0.06, step * 7);
            o.connect(g).connect(out);
            o.start(t);
            o.stop(t + step * 8);
          }
        }
        next += step;
        i++;
      }
    };
    this.musicTimer = setInterval(tick, 50);
    tick();
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

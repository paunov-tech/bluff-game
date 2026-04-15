// AXIOS Audio Engine — Web Audio API, zero external files

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.bgNode = null;
    this.bgGain = null;
    this.bgNodes = [];
    this.masterGain = null;
  }

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.7;
    this.masterGain.connect(this.ctx.destination);
  }

  // ─── TICK SOUND ─────────────────────────────────────────────
  tick(urgency = 1) {
    if (!this.enabled || !this.ctx) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;

    o.frequency.value = 600 + urgency * 200;
    o.type = "sine";
    g.gain.setValueAtTime(0.4 * urgency * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);

    o.connect(g);
    g.connect(this.masterGain);
    o.start(t);
    o.stop(t + 0.06);

    if (urgency >= 2) {
      setTimeout(() => {
        if (!this.ctx || !this.enabled) return;
        const o2 = this.ctx.createOscillator();
        const g2 = this.ctx.createGain();
        const t2 = this.ctx.currentTime;
        o2.frequency.value = 400;
        g2.gain.setValueAtTime(0.2, t2);
        g2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.04);
        o2.connect(g2);
        g2.connect(this.masterGain);
        o2.start(t2);
        o2.stop(t2 + 0.04);
      }, 300);
    }
  }

  // ─── HEARTBEAT (timer < 10s) ─────────────────────────────────
  heartbeat() {
    if (!this.enabled || !this.ctx) return;
    const playBeat = (delay, freq) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime + delay;
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g);
      g.connect(this.masterGain);
      o.start(t);
      o.stop(t + 0.25);
    };
    playBeat(0, 60);
    playBeat(0.15, 50);
  }

  // ─── DRUM ROLL (lock-in) ──────────────────────────────────────
  drumRoll(duration = 1.5) {
    if (!this.enabled || !this.ctx) return;
    const snare = (time) => {
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.05, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
      }
      const src = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      src.buffer = buf;
      g.gain.setValueAtTime(0.3, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
      src.connect(g);
      g.connect(this.masterGain);
      src.start(time);
    };

    let time = this.ctx.currentTime;
    let interval = 0.18;
    while (time < this.ctx.currentTime + duration) {
      snare(time);
      interval = Math.max(0.04, interval * 0.93);
      time += interval;
    }
  }

  // ─── FANFARE (correct) ───────────────────────────────────────
  fanfare() {
    if (!this.enabled || !this.ctx) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime + i * 0.12;

      o.frequency.value = freq;
      o.type = "triangle";
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.4, t + 0.02);
      g.gain.setValueAtTime(0.4, t + 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = 6;
      lfoGain.gain.value = 4;
      lfo.connect(lfoGain);
      lfoGain.connect(o.frequency);

      o.connect(g);
      g.connect(this.masterGain);
      lfo.start(t);
      o.start(t);
      o.stop(t + 0.4);
      lfo.stop(t + 0.4);
    });

    [523, 659, 784].forEach(freq => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime + 0.55;
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      o.connect(g);
      g.connect(this.masterGain);
      o.start(t);
      o.stop(t + 0.8);
    });
  }

  // ─── BUZZER (wrong) ──────────────────────────────────────────
  buzzer() {
    if (!this.enabled || !this.ctx) return;
    [[466, 0], [370, 0.03], [311, 0.06]].forEach(([freq, delay]) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime + delay;
      o.frequency.value = freq;
      o.type = "sawtooth";
      g.gain.setValueAtTime(0.35, t);
      g.gain.setValueAtTime(0.35, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(g);
      g.connect(this.masterGain);
      o.start(t);
      o.stop(t + 0.5);
    });
  }

  // ─── WHOOSH (card select) ────────────────────────────────────
  whoosh() {
    if (!this.enabled || !this.ctx) return;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 0.2, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    }
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1500;
    src.buffer = buf;
    g.gain.setValueAtTime(0.15, this.ctx.currentTime);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    src.start();
  }

  // ─── LEVEL UP ────────────────────────────────────────────────
  levelUp() {
    if (!this.enabled || !this.ctx) return;
    [440, 554, 659, 880].forEach((freq, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime + i * 0.08;
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g);
      g.connect(this.masterGain);
      o.start(t);
      o.stop(t + 0.3);
    });
  }

  // ─── BACKGROUND MUSIC ────────────────────────────────────────
  startBackgroundMusic(ladderPos) {
    if (!this.enabled || !this.ctx) return;
    this.stopBackgroundMusic();

    const gainNode = this.ctx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(this.masterGain);
    this.bgGain = gainNode;

    const tension = Math.min(ladderPos / 10, 1);
    const baseFreq = 60 + tension * 20;

    const drone = this.ctx.createOscillator();
    drone.type = "sine";
    drone.frequency.value = baseFreq;
    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0.08 + tension * 0.12;
    drone.connect(droneGain);
    droneGain.connect(gainNode);
    drone.start();

    const pulseRate = 1.2 + tension * 0.8;
    const pulseLfo = this.ctx.createOscillator();
    pulseLfo.type = "sine";
    pulseLfo.frequency.value = pulseRate;
    const pulseMod = this.ctx.createGain();
    pulseMod.gain.value = 0.05 + tension * 0.1;
    pulseLfo.connect(pulseMod);
    pulseMod.connect(droneGain.gain);
    pulseLfo.start();

    if (ladderPos >= 6) {
      const tension_osc = this.ctx.createOscillator();
      tension_osc.type = "triangle";
      tension_osc.frequency.value = baseFreq * 7.5;
      const tg = this.ctx.createGain();
      tg.gain.value = 0.02 + (tension - 0.5) * 0.04;
      tension_osc.connect(tg);
      tg.connect(gainNode);
      tension_osc.start();
      this.bgNodes = [drone, pulseLfo, tension_osc];
    } else {
      this.bgNodes = [drone, pulseLfo];
    }

    gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(1, this.ctx.currentTime + 1.5);
  }

  stopBackgroundMusic() {
    if (!this.bgGain || !this.ctx) return;
    this.bgGain.gain.setValueAtTime(this.bgGain.gain.value, this.ctx.currentTime);
    this.bgGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.8);
    setTimeout(() => {
      this.bgNodes?.forEach(n => { try { n.stop(); } catch {} });
      this.bgGain = null;
      this.bgNodes = [];
    }, 900);
  }
}

export const audio = new AudioEngine();

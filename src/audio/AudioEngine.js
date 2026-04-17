// AXIOS Audio Engine — Web Audio API, zero external files

// ─── AXIOS BREATH ─────────────────────────────────────────────────
// Generates filtered-noise breathing sounds that grow with tension
class AxiosBreath {
  constructor(ctx, masterGain, emitFn) {
    this.ctx = ctx;
    this.masterGain = masterGain;
    this.emit = emitFn;
    this.isRunning = false;
    this.breathCycle = null;
    this.breathRate = 2.8;
    this.volume = 0.03;
    this.duration = 1.2;
  }

  _makeBreath(type, volume, duration) {
    if (!this.ctx || !this.isRunning) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const bufSize = Math.floor(ctx.sampleRate * duration);
    if (bufSize <= 0) return;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) {
      data[i] = (Math.random() * 2 - 1) *
        Math.pow(type === "in" ? i / bufSize : 1 - i / bufSize, 0.8);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bpf = ctx.createBiquadFilter();
    bpf.type = "bandpass";
    bpf.frequency.value = type === "in" ? 600 : 400;
    bpf.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + duration * 0.3);
    gain.gain.setValueAtTime(volume, t + duration * 0.6);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    src.connect(bpf);
    bpf.connect(gain);
    gain.connect(this.masterGain);
    src.start(t);
    src.stop(t + duration);
  }

  start(timerFraction) {
    this.stop();
    this.isRunning = true;
    this._applyFraction(timerFraction);
    this._cycle();
  }

  updateRate(timerFraction) {
    this._applyFraction(timerFraction);
  }

  _applyFraction(f) {
    this.breathRate = 0.7 + f * 2.1;     // fast at 0 → slow at 1
    this.volume     = 0.03 + (1 - f) * 0.12;
    this.duration   = 1.2  - (1 - f) * 0.6;
  }

  _cycle() {
    if (!this.isRunning) return;
    const d = Math.max(0.15, this.duration);
    this._makeBreath("in", this.volume, d * 0.45);
    this.emit?.("breathIn");
    setTimeout(() => {
      if (!this.isRunning) return;
      this._makeBreath("out", this.volume * 0.7, d * 0.55);
      this.emit?.("breathOut");
      const jitter = 0.8 + Math.random() * 0.4;
      this.breathCycle = setTimeout(() => this._cycle(), this.breathRate * 1000 * jitter);
    }, d * 450);
  }

  stop() {
    this.isRunning = false;
    clearTimeout(this.breathCycle);
  }
}

// ─── TENSION DRONE ────────────────────────────────────────────────
// Ambient drone that rises a semitone at each tension threshold
class TensionDrone {
  constructor(ctx, masterGain, emitFn) {
    this.ctx = ctx;
    this.masterGain = masterGain;
    this.emit = emitFn;
    this.gainNode = null;
    this.oscillators = [];
  }

  start(ladderPos) {
    if (!this.ctx) return;
    this.stop();
    const ctx = this.ctx;
    const baseFreq = 55 + (ladderPos - 1) * 5; // 55Hz (L1) → 100Hz (L10)

    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 0;
    this.gainNode.connect(this.masterGain);

    // Slight dissonance on higher ladder positions (L6+)
    const freqs = ladderPos <= 5
      ? [baseFreq, baseFreq * 2]
      : [baseFreq, baseFreq * 2, baseFreq * 2.97];

    freqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? "sine" : "triangle";
      osc.frequency.value = freq;
      const oscGain = ctx.createGain();
      oscGain.gain.value = i === 0 ? 0.12 : 0.06 / (i + 1);
      osc.connect(oscGain);
      oscGain.connect(this.gainNode);
      osc.start();
      this.oscillators.push({ osc, oscGain });
    });

    this.gainNode.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
  }

  // Shift all oscillators up one semitone (×1.0595) over 3s
  shiftUp() {
    if (!this.ctx || !this.oscillators.length) return;
    const t = this.ctx.currentTime;
    this.oscillators.forEach(({ osc }) => {
      const cur = osc.frequency.value;
      osc.frequency.setValueAtTime(cur, t);
      osc.frequency.exponentialRampToValueAtTime(cur * 1.0595, t + 3);
    });
    this.emit?.("droneShift");
  }

  stop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.gainNode) {
      this.gainNode.gain.linearRampToValueAtTime(0, t + 1.5);
    }
    const oscs = [...this.oscillators];
    setTimeout(() => {
      oscs.forEach(({ osc }) => { try { osc.stop(); } catch {} });
    }, 1800);
    this.gainNode = null;
    this.oscillators = [];
  }
}

// ─── SPARSE PIANO ─────────────────────────────────────────────────
// Acousmatic piano notes at irregular intervals — no clear source
class SparsePiano {
  constructor(ctx, masterGain) {
    this.ctx = ctx;
    this.masterGain = masterGain;
    this.timer = null;
    this.isRunning = false;
    this._frac = 1.0;
  }

  _playNote(freq, volume) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    [freq, freq * 2.003].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(volume / (i + 1), t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 2.5);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 2.5);
    });
  }

  start(timerFraction) {
    if (this.isRunning) return;
    this.isRunning = true;
    this._frac = timerFraction;
    this.timer = setTimeout(() => this._schedule(), 2000 + Math.random() * 3000);
  }

  updateFraction(frac) {
    this._frac = frac;
  }

  _schedule() {
    if (!this.isRunning) return;
    const frac = this._frac;
    const SCALES = {
      calm:    [220, 246.94, 261.63, 293.66, 329.63],
      tense:   [220, 233.08, 261.63, 293.66, 311.13],
      critical:[220, 233.08, 246.94, 261.63, 277.18],
    };
    const scale = frac > 0.5 ? SCALES.calm : frac > 0.25 ? SCALES.tense : SCALES.critical;
    const freq = scale[Math.floor(Math.random() * scale.length)];
    this._playNote(freq, 0.08 + (1 - frac) * 0.12);
    const minGap = 3000 + frac * 4000;
    this.timer = setTimeout(() => this._schedule(), minGap + Math.random() * 3000);
  }

  stop() {
    this.isRunning = false;
    clearTimeout(this.timer);
  }
}

// ═══════════════════════════════════════════════════════════════
// AUDIO ENGINE
// ═══════════════════════════════════════════════════════════════
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.masterGain = null;
    // Legacy bg refs (kept for compat)
    this.bgGain = null;
    this.bgNodes = [];
    // Tension subsystems (initialized in init())
    this.breath = null;
    this.drone = null;
    this.piano = null;
    // Heartbeat loop
    this._heartbeatActive = false;
    this._heartbeatTimer = null;
    this._heartbeatRate = 1.2;
    // Void state
    this._isVoid = false;
    // Event emitter
    this._listeners = {};
  }

  // ─── EVENT EMITTER ─────────────────────────────────────────
  on(event, fn)  { (this._listeners[event] = this._listeners[event] || []).push(fn); }
  off(event, fn) { this._listeners[event] = (this._listeners[event] || []).filter(f => f !== fn); }
  emit(event, ...args) { (this._listeners[event] || []).forEach(f => f(...args)); }

  // ─── INIT ──────────────────────────────────────────────────
  init() {
    if (this.ctx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.7;
      this.masterGain.connect(this.ctx.destination);
      const emitFn = (event, ...args) => this.emit(event, ...args);
      this.breath = new AxiosBreath(this.ctx, this.masterGain, emitFn);
      this.drone  = new TensionDrone(this.ctx, this.masterGain, emitFn);
      this.piano  = new SparsePiano(this.ctx, this.masterGain);
    } catch (e) {
      console.warn("[audio] init failed:", e);
      this.ctx = null;
    }
  }

  // ─── TICK ──────────────────────────────────────────────────
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
        o2.connect(g2); g2.connect(this.masterGain);
        o2.start(t2); o2.stop(t2 + 0.04);
      }, 300);
    }
  }

  // ─── HEARTBEAT ─────────────────────────────────────────────
  heartbeat() {
    if (!this.enabled || !this.ctx) return;
    const playBeat = (delay, freq) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime + delay;
      o.frequency.value = freq; o.type = "sine";
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.connect(g); g.connect(this.masterGain);
      o.start(t); o.stop(t + 0.25);
    };
    playBeat(0, 60);
    playBeat(0.15, 50);
  }

  // Continuous heartbeat loop — starts at 40% threshold
  startHeartbeatLoop() {
    if (!this.enabled || !this.ctx || this._heartbeatActive) return;
    this._heartbeatActive = true;
    this._heartbeatRate = 1.2;
    this._doHeartbeat();
  }

  _doHeartbeat() {
    if (!this._heartbeatActive || !this.enabled || !this.ctx) return;
    this.heartbeat();
    const next = this._heartbeatRate * (0.9 + Math.random() * 0.2);
    this._heartbeatTimer = setTimeout(() => this._doHeartbeat(), next * 1000);
  }

  intensifyHeartbeat() {
    this._heartbeatRate = 0.65;
  }

  _stopHeartbeat() {
    this._heartbeatActive = false;
    clearTimeout(this._heartbeatTimer);
  }

  // ─── DRUM ROLL ─────────────────────────────────────────────
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
      src.connect(g); g.connect(this.masterGain);
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

  // ─── FANFARE / BUZZER (void-aware) ─────────────────────────
  _fanfareNotes() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((freq, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime + i * 0.12;
      o.frequency.value = freq; o.type = "triangle";
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.4, t + 0.02);
      g.gain.setValueAtTime(0.4, t + 0.1);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = 6; lfoGain.gain.value = 4;
      lfo.connect(lfoGain); lfoGain.connect(o.frequency);
      o.connect(g); g.connect(this.masterGain);
      lfo.start(t); o.start(t); o.stop(t + 0.4); lfo.stop(t + 0.4);
    });
    [523, 659, 784].forEach(freq => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime + 0.55;
      o.frequency.value = freq; o.type = "sine";
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      o.connect(g); g.connect(this.masterGain);
      o.start(t); o.stop(t + 0.8);
    });
  }

  _buzzerNotes() {
    [[466, 0], [370, 0.03], [311, 0.06]].forEach(([freq, delay]) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime + delay;
      o.frequency.value = freq; o.type = "sawtooth";
      g.gain.setValueAtTime(0.35, t);
      g.gain.setValueAtTime(0.35, t + 0.15);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(g); g.connect(this.masterGain);
      o.start(t); o.stop(t + 0.5);
    });
  }

  fanfare() {
    if (!this.enabled || !this.ctx) return;
    if (this._isVoid) { this._revealFromVoid(true); return; }
    this._fanfareNotes();
  }

  buzzer() {
    if (!this.enabled || !this.ctx) return;
    if (this._isVoid) { this._revealFromVoid(false); return; }
    this._buzzerNotes();
  }

  _revealFromVoid(correct) {
    const t = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(t);
    this.masterGain.gain.setValueAtTime(0, t);
    // Fast restore — sharp contrast after silence
    this.masterGain.gain.linearRampToValueAtTime(0.9, t + 0.05);
    this._isVoid = false;
    if (correct) this._fanfareNotes();
    else this._buzzerNotes();
    this.emit("reveal", correct);
  }

  // ─── WHOOSH ────────────────────────────────────────────────
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
    filter.type = "highpass"; filter.frequency.value = 1500;
    src.buffer = buf;
    g.gain.setValueAtTime(0.15, this.ctx.currentTime);
    src.connect(filter); filter.connect(g); g.connect(this.masterGain);
    src.start();
  }

  // ─── LEVEL UP ──────────────────────────────────────────────
  levelUp() {
    if (!this.enabled || !this.ctx) return;
    [440, 554, 659, 880].forEach((freq, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      const t = this.ctx.currentTime + i * 0.08;
      o.frequency.value = freq; o.type = "sine";
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g); g.connect(this.masterGain);
      o.start(t); o.stop(t + 0.3);
    });
  }

  // ─── BACKGROUND MUSIC → TENSION SYSTEM ─────────────────────
  startBackgroundMusic(ladderPos) {
    if (!this.enabled || !this.ctx) return;
    this.stopBackgroundMusic();
    this._isVoid = false;
    // Restore master gain in case it was lowered
    this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
    // Start tension subsystems
    this.drone.start(ladderPos);
    this.breath.start(1.0);
    this.piano.start(1.0);
  }

  stopBackgroundMusic() {
    this._isVoid = false;
    this._stopHeartbeat();
    this.breath?.stop();
    this.drone?.stop();
    this.piano?.stop();
    // Legacy cleanup
    if (this.bgGain && this.ctx) {
      this.bgGain.gain.setValueAtTime(this.bgGain.gain.value, this.ctx.currentTime);
      this.bgGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.8);
      setTimeout(() => {
        this.bgNodes?.forEach(n => { try { n.stop(); } catch {} });
        this.bgGain = null;
        this.bgNodes = [];
      }, 900);
    }
  }

  // ─── TENSION PHASE SHIFT ──────────────────────────────────
  // Called at 65%, 40%, 20% timer thresholds
  tensionShift(timerFraction) {
    if (!this.enabled || !this.ctx || this._isVoid) return;
    this.drone?.shiftUp();
    this.breath?.updateRate(timerFraction);
    this.piano?.updateFraction(timerFraction);
  }

  // ─── THE VOID ─────────────────────────────────────────────
  // Silence all audio at 8s remaining — maximum psychological tension
  enterTheVoid() {
    if (!this.enabled || !this.ctx || this._isVoid) return;
    this._isVoid = true;
    const t = this.ctx.currentTime;
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, t);
    this.masterGain.gain.linearRampToValueAtTime(0, t + 0.3);
    this.breath?.stop();
    this.drone?.stop();
    this.piano?.stop();
    this._stopHeartbeat();
    this.emit("voidEnter");
  }
}

export const audio = new AudioEngine();

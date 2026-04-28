import { useEffect, useRef, useState } from "react";

// PitFall — 3-second elimination choreography that overlays the game on a
// wrong answer. Phases: SHOCK (0-500ms) → FALL (500-2000ms) → IMPACT
// (2000-3000ms). Procedural Web Audio for buzzer/wind/thud (no asset deps).
// AXIOM voice line plays once during FALL via /api/axiom-voice. Decoupled
// from game state — caller renders <PitFall ... /> and removes it after
// onComplete fires.

const MOCK_LINES = [
  "Down you go.",
  "Pathetic.",
  "I expected more.",
  "Such promise. Such failure.",
];

function pitAudioBuzzer() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.18);
    g.gain.setValueAtTime(0.35, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g); g.connect(ctx.destination);
    o.start(t); o.stop(t + 0.25);
    setTimeout(() => { try { ctx.close(); } catch {} }, 400);
  } catch {}
}

function pitAudioWind() {
  // Pink-ish noise burst, 1.5s, descending lowpass — gives a "falling air" feel.
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 1.5);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.04 * w) / 1.04;
      data[i] = last * 6 * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.setValueAtTime(2400, ctx.currentTime);
    filt.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 1.5);
    const g = ctx.createGain();
    g.gain.value = 0.55;
    src.connect(filt); filt.connect(g); g.connect(ctx.destination);
    src.start();
    setTimeout(() => { try { ctx.close(); } catch {} }, 1700);
  } catch {}
}

function pitAudioImpact() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;
    // Low-frequency thud
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    og.gain.setValueAtTime(0.85, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(og); og.connect(ctx.destination);
    o.start(t); o.stop(t + 0.6);
    // Dust noise burst
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * 0.35);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    src.connect(ng); ng.connect(ctx.destination);
    src.start();
    setTimeout(() => { try { ctx.close(); } catch {} }, 800);
  } catch {}
}

function playMockVoice(skin) {
  const line = MOCK_LINES[Math.floor(Math.random() * MOCK_LINES.length)];
  fetch("/api/axiom-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: line, skin }),
  })
    .then((r) => (r.ok ? r.blob() : null))
    .then((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 0.95;
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      const p = audio.play();
      if (p?.catch) p.catch(() => {});
    })
    .catch(() => {});
}

// Number of dust particles in the impact burst. Kept low for perf.
const DUST_COUNT = 14;

export function PitFall({ fellToRound, skin, onComplete }) {
  const [phase, setPhase] = useState(0); // 0 shock, 1 fall, 2 impact
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    pitAudioBuzzer();
    const t1 = setTimeout(() => {
      setPhase(1);
      pitAudioWind();
      playMockVoice(skin);
    }, 500);
    const t2 = setTimeout(() => {
      setPhase(2);
      pitAudioImpact();
    }, 2000);
    const t3 = setTimeout(() => {
      onCompleteRef.current?.();
    }, 3000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [skin]);

  const bg = phase === 0
    ? "rgba(244,63,94,0.18)"
    : phase === 1
      ? "linear-gradient(to bottom, rgba(0,0,0,0.55), rgba(0,0,0,0.95))"
      : "linear-gradient(to bottom, #0a0000, #1a0006)";

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        // Absorb clicks so the user can't advance past the choreography early.
        pointerEvents: "auto",
        background: bg,
        transition: "background 600ms ease",
        overflow: "hidden",
        animation: phase === 0 ? "pit-shake 80ms 6 linear" : "none",
      }}
    >
      {phase === 0 && (
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(circle at 50% 50%, rgba(244,63,94,0.55) 0%, rgba(244,63,94,0.0) 60%)",
          animation: "pit-flash 500ms ease-out forwards",
        }} />
      )}

      {phase === 1 && (
        <>
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(to bottom, transparent 0%, rgba(244,63,94,0.18) 100%)",
            animation: "pit-streaks 1.5s linear",
            pointerEvents: "none",
          }} />
          <div style={{
            position: "absolute", top: "18vh", left: 0, right: 0,
            textAlign: "center",
            color: "rgba(255,255,255,0.92)",
            fontSize: "clamp(40px, 12vw, 84px)",
            fontWeight: 900,
            letterSpacing: "8px",
            fontFamily: "Georgia, serif",
            textShadow: "0 6px 24px rgba(244,63,94,0.55)",
            animation: "pit-fall-text 1.5s ease-in forwards",
          }}>
            FALLING
          </div>
        </>
      )}

      {phase === 2 && (
        <>
          {/* Dust particles */}
          {Array.from({ length: DUST_COUNT }).map((_, i) => {
            const x = 10 + Math.random() * 80;
            const drift = (Math.random() - 0.5) * 80;
            const size = 6 + Math.random() * 18;
            const delay = Math.random() * 80;
            return (
              <div key={i} style={{
                position: "absolute",
                bottom: 0, left: `${x}%`,
                width: size, height: size,
                borderRadius: "50%",
                background: "rgba(180,140,90,0.42)",
                filter: "blur(2px)",
                animation: `pit-dust 900ms ${delay}ms ease-out forwards`,
                ["--pit-dust-x"]: `${drift}px`,
              }} />
            );
          })}
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 12,
            animation: "pit-impact-bounce 600ms cubic-bezier(.5,.05,.4,1.5)",
          }}>
            <div style={{
              fontSize: "clamp(14px, 3.6vw, 18px)",
              letterSpacing: "6px",
              color: "rgba(244,63,94,0.85)",
              fontWeight: 800,
            }}>
              💀 FALLEN
            </div>
            {Number.isFinite(fellToRound) && fellToRound > 0 && (
              <div style={{
                fontSize: "clamp(28px, 7vw, 48px)",
                color: "#e8c547",
                fontFamily: "Georgia, serif",
                fontWeight: 900,
                letterSpacing: "3px",
                textShadow: "0 0 30px rgba(232,197,71,0.5)",
              }}>
                ROUND {fellToRound}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default PitFall;

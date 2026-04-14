import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
const BETA_MODE = true; // ← set false for production paywall

const CATEGORIES = ["history", "science", "animals", "geography", "food"];
const CATEGORY_EMOJIS = {
  history: "🏛️", science: "🔬", animals: "🦎",
  geography: "🌍", food: "🍷",
};

const ROUND_DIFFICULTY = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
const TIMER_PER_DIFFICULTY = { 1: 30, 2: 35, 3: 45, 4: 60, 5: 75 };

// ═══════════════════════════════════════════════════════════════
// AXIOM FACE DATA
// ═══════════════════════════════════════════════════════════════
const AXIOM_MOODS = {
  idle: {
    eye: "#22d3ee", eyeR: 5,
    mouth: { type: "line", props: { x1: 80, y1: 120, x2: 120, y2: 120, stroke: "#22d3ee", strokeWidth: 2, strokeLinecap: "round" } },
    browL: { x1: 68, y1: 78, x2: 90, y2: 82 },
    browR: { x1: 110, y1: 82, x2: 132, y2: 78 },
    dot: "#22d3ee",
  },
  taunting: {
    eye: "#f43f5e", eyeR: 7,
    mouth: { type: "path", props: { d: "M80 118 Q100 114 120 118", stroke: "#f43f5e", strokeWidth: 2, fill: "none", strokeLinecap: "round" } },
    browL: { x1: 68, y1: 74, x2: 90, y2: 80 },
    browR: { x1: 110, y1: 80, x2: 132, y2: 74 },
    dot: "#f43f5e",
  },
  shocked: {
    eye: "#f0d878", eyeR: 8,
    mouth: { type: "path", props: { d: "M80 122 Q100 130 120 122", stroke: "#f0d878", strokeWidth: 2.5, fill: "none", strokeLinecap: "round" } },
    browL: { x1: 68, y1: 82, x2: 90, y2: 76 },
    browR: { x1: 110, y1: 76, x2: 132, y2: 82 },
    dot: "#f0d878",
  },
  defeated: {
    eye: "#2dd4a0", eyeR: 4,
    mouth: { type: "path", props: { d: "M80 122 Q100 115 120 122", stroke: "#2dd4a0", strokeWidth: 2, fill: "none", strokeLinecap: "round" } },
    browL: { x1: 68, y1: 80, x2: 90, y2: 84 },
    browR: { x1: 110, y1: 84, x2: 132, y2: 80 },
    dot: "#2dd4a0",
  },
};

// ═══════════════════════════════════════════════════════════════
// AXIOM FACE — useRef UID fixes SVG filter/clipPath collision
// ═══════════════════════════════════════════════════════════════
function AxiomFace({ mood = "idle", size = 64 }) {
  // Unique ID per instance — prevents SVG filter ID collisions in DOM
  const uid = useRef(Math.random().toString(36).slice(2)).current;
  const m = AXIOM_MOODS[mood] || AXIOM_MOODS.idle;
  const sc = size / 200;
  const s = (v) => Math.round(v * sc);
  const filterId = `gc-${uid}`;
  const clipId = `hc-${uid}`;

  const MouthEl = m.mouth.type === "line"
    ? <line {...m.mouth.props} />
    : <path {...m.mouth.props} />;

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {/* Outer ring */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ position: "absolute", inset: 0, animation: "hexRotate 13s linear infinite" }}>
        <polygon
          points={`${s(100)},${s(8)} ${s(186)},${s(52)} ${s(186)},${s(148)} ${s(100)},${s(192)} ${s(14)},${s(148)} ${s(14)},${s(52)}`}
          fill="none" stroke="rgba(34,211,238,.1)" strokeWidth="1.5" strokeDasharray="5 4" />
      </svg>
      {/* Inner ring CCW */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ position: "absolute", inset: 0, animation: "hexRotateCCW 9s linear infinite" }}>
        <polygon
          points={`${s(100)},${s(20)} ${s(174)},${s(62)} ${s(174)},${s(138)} ${s(100)},${s(180)} ${s(26)},${s(138)} ${s(26)},${s(62)}`}
          fill="none" stroke="rgba(34,211,238,.15)" strokeWidth="1" strokeDasharray="2 5" />
      </svg>
      {/* Face */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id={filterId}>
            <feGaussianBlur stdDeviation="2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <clipPath id={clipId}>
            <polygon points={`${s(100)},${s(32)} ${s(168)},${s(70)} ${s(168)},${s(148)} ${s(100)},${s(186)} ${s(32)},${s(148)} ${s(32)},${s(70)}`} />
          </clipPath>
        </defs>
        {/* Body */}
        <polygon
          points={`${s(100)},${s(32)} ${s(168)},${s(70)} ${s(168)},${s(148)} ${s(100)},${s(186)} ${s(32)},${s(148)} ${s(32)},${s(70)}`}
          fill="#030810" stroke={m.eye} strokeWidth={size > 80 ? 2 : 1.5} filter={`url(#${filterId})`} />
        {/* Eye sockets */}
        <ellipse cx={s(82)} cy={s(94)} rx={s(15)} ry={s(11)} fill="rgba(2,6,16,.95)" stroke="rgba(34,211,238,.2)" strokeWidth="1" />
        <ellipse cx={s(118)} cy={s(94)} rx={s(15)} ry={s(11)} fill="rgba(2,6,16,.95)" stroke="rgba(34,211,238,.2)" strokeWidth="1" />
        {/* Eyes */}
        <circle cx={s(82)} cy={s(94)} r={Math.round(m.eyeR * sc * 0.85)} fill={m.eye} filter={`url(#${filterId})`} />
        <circle cx={s(118)} cy={s(94)} r={Math.round(m.eyeR * sc * 0.85)} fill={m.eye} filter={`url(#${filterId})`} />
        <circle cx={s(82)} cy={s(94)} r={Math.max(1, Math.round(2.2 * sc))} fill="#030810" />
        <circle cx={s(118)} cy={s(94)} r={Math.max(1, Math.round(2.2 * sc))} fill="#030810" />
        {/* Mouth */}
        <g transform={`scale(${sc})`}>{MouthEl}</g>
        {/* Brows */}
        <line x1={s(m.browL.x1)} y1={s(m.browL.y1)} x2={s(m.browL.x2)} y2={s(m.browL.y2)}
          stroke="rgba(34,211,238,.35)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1={s(m.browR.x1)} y1={s(m.browR.y1)} x2={s(m.browR.x2)} y2={s(m.browR.y2)}
          stroke="rgba(34,211,238,.35)" strokeWidth="1.5" strokeLinecap="round" />
        {/* Scan line */}
        <rect x={s(32)} y={s(32)} width={s(136)} height="2"
          fill={m.eye} opacity=".04" clipPath={`url(#${clipId})`}
          style={{ animation: "scanDown 3s linear infinite" }} />
      </svg>
      {/* Status dot */}
      <div style={{
        position: "absolute",
        bottom: size > 80 ? 10 : 2, right: size > 80 ? 10 : 2,
        width: size > 80 ? 12 : 8, height: size > 80 ? 12 : 8,
        borderRadius: "50%", background: m.dot,
        border: "2px solid #04060f",
        boxShadow: `0 0 7px ${m.dot}`,
        animation: "axiomPulse 2s infinite",
        transition: "all .4s",
      }} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AXIOM PANEL
// ═══════════════════════════════════════════════════════════════
function AxiomPanel({ mood, speech, loading, compact = false }) {
  const m = AXIOM_MOODS[mood] || AXIOM_MOODS.idle;
  const ec = m.eye;

  if (compact) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        background: "rgba(4,10,22,.85)", border: "1px solid rgba(34,211,238,.15)",
        borderRadius: 14, padding: "10px 12px", marginBottom: 12,
        backdropFilter: "blur(8px)",
      }}>
        <AxiomFace mood={mood} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: "2.5px", color: ec, fontWeight: 600, opacity: .65, marginBottom: 3 }}>AXIOM</div>
          <div style={{
            fontSize: "clamp(11px,3vw,13px)", color: "#e8e6e1", lineHeight: 1.45,
            overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            fontStyle: "italic", animation: "moodIn .35s ease", opacity: loading ? .4 : 1,
          }}>
            {loading ? "..." : speech}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: "rgba(4,10,22,.9)", border: "1px solid rgba(34,211,238,.18)",
      borderRadius: 16, padding: 16, marginBottom: 16,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <AxiomFace mood={mood} size={68} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
            <span style={{ fontSize: 12, letterSpacing: "3px", color: ec, fontWeight: 700 }}>AXIOM</span>
            <span style={{ fontSize: 9, padding: "2px 6px", background: "rgba(34,211,238,.1)", borderRadius: 8, color: "rgba(34,211,238,.55)", letterSpacing: "1px" }}>AI OPPONENT</span>
          </div>
          <div style={{
            fontSize: "clamp(12px,3.2vw,14px)", color: "#e8e6e1", lineHeight: 1.55,
            fontStyle: "italic", animation: "moodIn .4s ease",
            opacity: loading ? .4 : 1, transition: "opacity .2s",
          }}>
            {loading ? "..." : `"${speech}"`}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CINEMATIC INTRO
// ═══════════════════════════════════════════════════════════════
function CinematicIntro({ onComplete }) {
  const [phase, setPhase] = useState(0);
  const sealSize = Math.min(window.innerWidth * 0.44, 180);
  const sc = sealSize / 200;
  const sp = (v) => Math.round(v * sc);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 2600),
      setTimeout(() => setPhase(3), 4000),
      setTimeout(() => setPhase(4), 5800),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const particles = useRef(
    Array.from({ length: 18 }, () => ({
      x: Math.random() * 100, y: Math.random() * 100,
      s: 2 + Math.random() * 3, d: 3 + Math.random() * 4, dl: Math.random() * 2,
    }))
  ).current;

  return (
    <div onClick={() => phase >= 3 && onComplete()} style={{
      position: "fixed", inset: 0, zIndex: 9999, background: "#040408",
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", cursor: phase >= 3 ? "pointer" : "default", overflow: "hidden",
    }}>
      {particles.map((p, i) => (
        <div key={i} style={{
          position: "absolute", width: p.s, height: p.s, borderRadius: "50%", background: "#e8c547",
          left: `${p.x}%`, top: `${p.y}%`, pointerEvents: "none",
          opacity: phase >= 2 ? 0.05 + (i % 3) * 0.04 : 0,
          transition: `opacity ${1 + (i % 3) * 0.5}s ease`,
          animation: `g-float ${p.d}s ease-in-out ${p.dl}s infinite`,
        }} />
      ))}

      {BETA_MODE && (
        <div style={{
          position: "absolute", top: "max(14px, env(safe-area-inset-top))", right: 16,
          fontSize: 10, letterSpacing: "2px", color: "rgba(45,212,160,.75)",
          background: "rgba(45,212,160,.09)", border: "1px solid rgba(45,212,160,.22)",
          padding: "4px 10px", borderRadius: 20, fontWeight: 600,
        }}>β BETA</div>
      )}

      {/* SIAL Seal */}
      <div style={{
        position: "absolute",
        opacity: phase >= 1 && phase < 3 ? 1 : 0,
        transform: phase === 1 ? "scale(1)" : phase >= 3 ? "scale(1.5)" : "scale(.25)",
        transition: phase === 1 ? "all .75s cubic-bezier(.34,1.56,.64,1)" : "all .55s ease",
        display: "flex", flexDirection: "column", alignItems: "center",
      }}>
        <div style={{ width: sealSize, height: sealSize, borderRadius: "50%", border: "3px solid rgba(232,197,71,.4)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 36px rgba(232,197,71,.1),inset 0 0 20px rgba(232,197,71,.05)" }}>
          <div style={{ width: sp(175), height: sp(175), borderRadius: "50%", border: "1.5px solid rgba(232,197,71,.2)", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
            <div style={{ fontSize: sp(10), letterSpacing: sp(8), color: "rgba(232,197,71,.4)", marginBottom: sp(5) }}>★ ★ ★</div>
            <div style={{ fontFamily: "Georgia,serif", fontSize: sp(36), fontWeight: 700, letterSpacing: sp(5), color: "#e8c547", textShadow: "0 0 15px rgba(232,197,71,.3)" }}>SIAL</div>
            <div style={{ width: sp(80), height: 1.5, margin: `${sp(7)}px 0`, background: "linear-gradient(90deg,transparent,rgba(232,197,71,.4),transparent)" }} />
            <div style={{ fontSize: sp(12), letterSpacing: sp(6), fontWeight: 600, color: "rgba(232,197,71,.55)" }}>GAMES</div>
            <div style={{ fontSize: sp(10), letterSpacing: sp(8), color: "rgba(232,197,71,.4)", marginTop: sp(5) }}>★ ★ ★</div>
          </div>
        </div>
        <div style={{ marginTop: sp(16), fontSize: sp(11), letterSpacing: sp(6), color: "rgba(232,197,71,.4)", fontWeight: 500, opacity: phase >= 1 ? 1 : 0, transition: "opacity .5s ease .3s" }}>PRESENTS</div>
      </div>

      {/* BLUFF Logo */}
      <div style={{
        position: "absolute", display: "flex", flexDirection: "column", alignItems: "center",
        opacity: phase >= 3 ? 1 : 0,
        transform: phase >= 3 ? "scale(1) translateY(0)" : "scale(.45) translateY(20px)",
        transition: "all .9s cubic-bezier(.34,1.56,.64,1) .1s",
      }}>
        <h1 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(62px,17vw,92px)", fontWeight: 900, letterSpacing: -2, margin: 0, lineHeight: 1, background: "linear-gradient(135deg,#e8c547,#f0d878,rgba(255,255,255,.6),#e8c547)", backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "g-shimmer 3s ease infinite", filter: "drop-shadow(0 0 24px rgba(232,197,71,.3))" }}>
          BLUFF<sup style={{ fontSize: "clamp(12px,3vw,15px)", WebkitTextFillColor: "rgba(232,197,71,.5)", position: "relative", top: "clamp(-28px,-6vw,-38px)", marginLeft: 2, fontFamily: "system-ui", fontWeight: 400 }}>™</sup>
        </h1>
        <div style={{ width: phase >= 3 ? 180 : 0, height: 1.5, marginTop: 10, background: "linear-gradient(90deg,transparent,rgba(232,197,71,.4),transparent)", transition: "width .8s ease .5s" }} />
        <div style={{ marginTop: 12, fontSize: "clamp(10px,2.5vw,12px)", letterSpacing: "clamp(3px,1vw,5px)", color: "rgba(232,197,71,.5)", textTransform: "uppercase", fontWeight: 500, opacity: phase >= 4 ? 1 : 0, transition: "opacity .5s .2s" }}>The AI Deception Game</div>
        <div style={{ marginTop: 32, fontSize: 11, letterSpacing: "3px", color: "rgba(255,255,255,.22)", textTransform: "uppercase", animation: "g-tapPulse 2s infinite", opacity: phase >= 4 ? 1 : 0, transition: "opacity .4s .4s" }}>Tap anywhere to play</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// VISUAL HELPERS
// ═══════════════════════════════════════════════════════════════
function Particles({ count = 14 }) {
  const ps = useRef(Array.from({ length: count }, () => ({
    x: Math.random() * 100, y: Math.random() * 100,
    s: 2 + Math.random() * 3, d: 3 + Math.random() * 5, dl: Math.random() * 3,
  }))).current;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
      {ps.map((p, i) => (
        <div key={i} style={{ position: "absolute", width: p.s, height: p.s, borderRadius: "50%", background: "#e8c547", opacity: .06, left: `${p.x}%`, top: `${p.y}%`, animation: `g-float ${p.d}s ease-in-out ${p.dl}s infinite` }} />
      ))}
    </div>
  );
}

function Confetti() {
  const colors = ["#e8c547", "#2dd4a0", "#60a5fa", "#f43f5e", "#a78bfa", "#fb923c"];
  const ps = useRef(Array.from({ length: 44 }, () => ({
    x: Math.random() * 100, dl: Math.random() * 1.1,
    c: colors[Math.floor(Math.random() * colors.length)],
    w: 4 + Math.random() * 9, h: 4 + Math.random() * 9,
    r: Math.random() > .5, dur: 1.4 + Math.random() * 1.2,
  }))).current;
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999, overflow: "hidden" }}>
      {ps.map((p, i) => (
        <div key={i} style={{ position: "absolute", top: -20, left: `${p.x}%`, width: p.w, height: p.h, background: p.c, borderRadius: p.r ? "50%" : "2px", animation: `g-confetti ${p.dur}s ease-in ${p.dl}s forwards` }} />
      ))}
    </div>
  );
}

function TimerRing({ time, max = 45, size = 48 }) {
  const r = (size - 6) / 2, circ = 2 * Math.PI * r;
  const color = time <= 10 ? "#f43f5e" : time <= 20 ? "#fb923c" : "#e8c547";
  const pct = Math.max(0, time / max);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={3} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s linear, stroke .3s" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color, animation: time <= 5 ? "g-pulse .5s infinite" : "none" }}>{time}</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SHARE CARD
// ═══════════════════════════════════════════════════════════════
function generateShareCard(score, total, best, axiomSpeech, won) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 900; canvas.height = 500;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#04060f"; ctx.fillRect(0, 0, 900, 500);

    ctx.strokeStyle = "rgba(34,211,238,.04)"; ctx.lineWidth = 1;
    for (let x = 0; x < 900; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 500); ctx.stroke(); }
    for (let y = 0; y < 500; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(900, y); ctx.stroke(); }

    const grd = ctx.createRadialGradient(450, 0, 0, 450, 0, 380);
    grd.addColorStop(0, "rgba(232,197,71,.08)"); grd.addColorStop(1, "transparent");
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 900, 500);

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,.2)"; ctx.font = "500 11px system-ui";
    ctx.fillText("SIAL GAMES", 450, 48);

    ctx.font = "900 88px Georgia,serif";
    const lg = ctx.createLinearGradient(300, 0, 600, 0);
    lg.addColorStop(0, "#e8c547"); lg.addColorStop(.5, "#fff"); lg.addColorStop(1, "#e8c547");
    ctx.fillStyle = lg; ctx.fillText("BLUFF™", 450, 148);

    ctx.strokeStyle = "rgba(232,197,71,.22)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(300, 168); ctx.lineTo(600, 168); ctx.stroke();

    ctx.fillStyle = won ? "#2dd4a0" : "rgba(244,63,94,.85)";
    ctx.font = "700 26px system-ui";
    ctx.fillText(won ? "I defeated AXIOM" : "AXIOM defeated me... for now", 450, 212);

    ctx.fillStyle = "#e8c547"; ctx.font = "900 68px Georgia,serif";
    ctx.fillText(`${score}/${total}`, 450, 302);

    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.font = "500 14px system-ui";
    ctx.fillText(`Accuracy: ${total ? Math.round(score / total * 100) : 0}%   ·   Best streak: ${best}🔥`, 450, 348);

    if (axiomSpeech && axiomSpeech !== "...") {
      ctx.fillStyle = "rgba(34,211,238,.5)"; ctx.font = "italic 500 15px system-ui";
      ctx.fillText(`"${axiomSpeech}"`, 450, 395);
    }

    ctx.fillStyle = "rgba(255,255,255,.14)"; ctx.font = "500 12px system-ui";
    ctx.fillText("playbluff.games  ·  SIAL Consulting d.o.o.", 450, 458);

    ctx.strokeStyle = "rgba(232,197,71,.1)"; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 898, 498);

    return canvas.toDataURL("image/png");
  } catch (e) {
    console.error("[share-card] error:", e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function BluffGame() {
  const [showIntro, setShowIntro] = useState(true);
  const [screen, setScreen] = useState("home");
  const [stmts, setStmts] = useState([]);
  const [roundIdx, setRoundIdx] = useState(0);
  const [category, setCategory] = useState("history");
  const [sel, setSel] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [time, setTime] = useState(45);
  const [confetti, setConfetti] = useState(false);
  const [loadingRound, setLoadingRound] = useState(false);
  const [axiomMood, setAxiomMood] = useState("idle");
  const [axiomSpeech, setAxiomSpeech] = useState("Your confidence is endearing. Begin.");
  const [axiomLoading, setAxiomLoading] = useState(false);
  const [shareImg, setShareImg] = useState(null);
  const timerRef = useRef(null);

  // ── AXIOM SPEAK ──────────────────────────────────────────────
  const axiomSpeak = useCallback(async (context, mood) => {
    setAxiomMood(mood);
    setAxiomLoading(true);
    try {
      const res = await fetch("/api/axiom-speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context }),
      });
      const data = await res.json();
      setAxiomSpeech(data.speech || "...");
    } catch {
      const fallbacks = {
        idle: "Your confidence is endearing. Begin.",
        taunting: "Predictable.",
        shocked: "Impossible. A fluke.",
        defeated: "You are exceptional. I concede.",
      };
      setAxiomSpeech(fallbacks[mood] || "...");
    } finally {
      setAxiomLoading(false);
    }
  }, []);

  // ── FETCH ROUND ──────────────────────────────────────────────
  const fetchRound = useCallback(async (idx) => {
    setLoadingRound(true);
    const diff = ROUND_DIFFICULTY[idx] || 3;
    const cat = CATEGORIES[idx % CATEGORIES.length];
    setCategory(cat);
    try {
      const res = await fetch("/api/generate-round", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: cat, difficulty: diff, lang: "en" }),
      });
      const data = await res.json();

      // Normalize real field — defensive: ensure booleans
      const normalized = (data.statements || []).map((s) => ({
        text: String(s.text || ""),
        real: s.real === true || s.real === "true",
      }));

      // Verify exactly 1 lie exists
      const lies = normalized.filter((s) => !s.real);
      console.log(`[fetchRound] idx=${idx} cat=${cat} diff=${diff} lies=${lies.length}`, lies[0]?.text);

      if (lies.length !== 1) {
        console.error("[fetchRound] Bad lie count — using fallback");
        throw new Error("Bad lie count");
      }

      setStmts(shuffle(normalized));
    } catch (e) {
      console.warn("[fetchRound] fallback triggered:", e.message);
      setStmts(shuffle([
        { text: "Napoleon was once attacked by a horde of rabbits during a hunting party after the Treaty of Tilsit.", real: true },
        { text: "Cleopatra lived closer in time to the Moon landing than to the Great Pyramid's construction.", real: true },
        { text: "The French army used over 600 Paris taxis to rush troops to the Battle of the Marne.", real: true },
        { text: "Ancient Romans built steam-powered door mechanisms making temple doors open by 'divine force.'", real: true },
        { text: "Queen Victoria kept a diary in Urdu exclusively for the last 13 years of her reign.", real: false },
      ]));
    } finally {
      setLoadingRound(false);
    }
  }, []);

  // ── TIMER ────────────────────────────────────────────────────
  const startTimer = useCallback((diff) => {
    clearInterval(timerRef.current);
    const maxTime = TIMER_PER_DIFFICULTY[diff] || 45;
    setTime(maxTime);
    timerRef.current = setInterval(() => {
      setTime((t) => {
        if (t <= 1) { clearInterval(timerRef.current); return 0; }
        if (t === 11) axiomSpeak("thinking", "taunting");
        return t - 1;
      });
    }, 1000);
  }, [axiomSpeak]);

  // Auto-reveal when timer hits 0
  useEffect(() => {
    if (time === 0 && !revealed && screen === "play" && stmts.length > 0) {
      doReveal();
    }
  }, [time]);

  // ── START GAME ───────────────────────────────────────────────
  const startGame = useCallback(() => {
    clearInterval(timerRef.current);
    setScreen("play");
    setRoundIdx(0);
    setSel(null);
    setRevealed(false);
    setScore(0);
    setTotal(0);
    setStreak(0);
    setConfetti(false);
    setShareImg(null);
    fetchRound(0);
    axiomSpeak("intro", "idle");
    startTimer(ROUND_DIFFICULTY[0] || 1);
  }, [fetchRound, axiomSpeak, startTimer]);

  // ── REVEAL ───────────────────────────────────────────────────
  const doReveal = useCallback(() => {
    clearInterval(timerRef.current);
    setRevealed(true);

    setStmts((currentStmts) => {
      const bi = currentStmts.findIndex((s) => !s.real);
      console.log("[doReveal] bi=", bi, "sel=", sel, "stmts=", currentStmts.map(s => s.real));

      setSel((currentSel) => {
        const isCorrect = currentSel === bi && bi !== -1;
        setTotal((t) => t + 1);
        if (isCorrect) {
          setScore((s) => s + 1);
          setStreak((prev) => {
            const next = prev + 1;
            setBest((b) => Math.max(b, next));
            if (next >= 2) setConfetti(true);
            axiomSpeak(next >= 3 ? "streak" : "correct", "shocked");
            return next;
          });
        } else {
          setStreak(0);
          axiomSpeak("wrong", "taunting");
        }
        return currentSel;
      });
      return currentStmts;
    });
  }, [sel, axiomSpeak]);

  // ── NEXT ROUND ───────────────────────────────────────────────
  const nextRound = useCallback(() => {
    const next = roundIdx + 1;
    if (next >= ROUND_DIFFICULTY.length) { showResultScreen(); return; }
    clearInterval(timerRef.current);
    setRoundIdx(next);
    setSel(null);
    setRevealed(false);
    setConfetti(false);
    fetchRound(next);
    axiomSpeak("intro", "idle");
    startTimer(ROUND_DIFFICULTY[next] || 3);
  }, [roundIdx, fetchRound, axiomSpeak, startTimer]);

  // ── RESULT ───────────────────────────────────────────────────
  const showResultScreen = useCallback(() => {
    clearInterval(timerRef.current);
    setScreen("result");
    setScore((currentScore) => {
      setTotal((currentTotal) => {
        const won = currentScore >= Math.ceil(currentTotal * .67);
        axiomSpeak(won ? "final_win" : "final_lose", won ? "defeated" : "taunting");
        if (won) setConfetti(true);
        setBest((b) => {
          setAxiomSpeech((speech) => {
            setTimeout(() => {
              const img = generateShareCard(currentScore, currentTotal, b, speech, won);
              setShareImg(img);
            }, 800);
            return speech;
          });
          return b;
        });
        return currentTotal;
      });
      return currentScore;
    });
  }, [axiomSpeak]);

  useEffect(() => () => clearInterval(timerRef.current), []);

  // ── COLORS ───────────────────────────────────────────────────
  const T = {
    bg: "#04060f", card: "#0f0f1a", gold: "#e8c547",
    goldDim: "rgba(232,197,71,.1)", ok: "#2dd4a0", bad: "#f43f5e",
    dim: "#5a5a68", glass: "rgba(255,255,255,.03)", gb: "rgba(255,255,255,.07)",
  };

  const wrap = {
    minHeight: "100vh",
    background: `radial-gradient(ellipse at 50% 0%,rgba(232,197,71,.05) 0%,${T.bg} 55%)`,
    fontFamily: "'Segoe UI',system-ui,sans-serif",
    display: "flex", flexDirection: "column", alignItems: "center",
    position: "relative", overflow: "hidden", color: "#e8e6e1",
    paddingBottom: "max(24px,env(safe-area-inset-bottom))",
  };

  const bi = stmts.findIndex((s) => !s.real);
  const correct = sel === bi && bi !== -1;
  const diff = ROUND_DIFFICULTY[roundIdx] || 3;
  const diffLabel = ["", "Warm-up", "Tricky", "Sneaky", "Devious", "Diabolical"][diff];
  const diffColor = ["", "#2dd4a0", "#a3e635", "#fb923c", "#f43f5e", "#a855f7"][diff];

  if (showIntro) return <><CinematicIntro onComplete={() => setShowIntro(false)} /><GameStyles /></>;

  // ─── HOME ─────────────────────────────────────────────────────
  if (screen === "home") return (
    <div style={wrap}>
      <Particles />
      {BETA_MODE && <div style={{ position: "fixed", top: "max(12px,env(safe-area-inset-top))", right: 16, fontSize: 10, letterSpacing: "2px", color: "rgba(45,212,160,.75)", background: "rgba(45,212,160,.09)", border: "1px solid rgba(45,212,160,.22)", padding: "4px 10px", borderRadius: 20, fontWeight: 600, zIndex: 10 }}>β BETA</div>}
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 460, padding: "clamp(14px,4vw,22px)", paddingTop: "max(48px,env(safe-area-inset-top))" }}>
        <div style={{ textAlign: "center", marginBottom: "clamp(20px,5vw,28px)", animation: "g-fadeUp .5s ease both" }}>
          <div style={{ fontSize: "clamp(10px,2.5vw,11px)", letterSpacing: "6px", color: T.dim, marginBottom: 14, fontWeight: 500 }}>SIAL GAMES</div>
          <h1 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(52px,13vw,78px)", fontWeight: 900, letterSpacing: -2, margin: "0 0 4px", lineHeight: 1, background: "linear-gradient(135deg,#e8c547,#f0d878,rgba(255,255,255,.5),#e8c547)", backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "g-shimmer 4s linear infinite", filter: "drop-shadow(0 0 22px rgba(232,197,71,.18))" }}>
            BLUFF<sup style={{ fontSize: "clamp(11px,2.5vw,14px)", WebkitTextFillColor: "rgba(232,197,71,.5)", position: "relative", top: "clamp(-22px,-5vw,-30px)", marginLeft: 2, fontFamily: "system-ui", fontWeight: 400 }}>™</sup>
          </h1>
          <p style={{ fontSize: "clamp(10px,2.5vw,12px)", color: T.dim, letterSpacing: "4px", textTransform: "uppercase", margin: 0, fontWeight: 500 }}>The AI Deception Game</p>
        </div>
        <AxiomPanel mood={axiomMood} speech={axiomSpeech} loading={axiomLoading} compact={false} />
        <div style={{ background: T.glass, borderRadius: 16, border: `1px solid ${T.gb}`, padding: "clamp(16px,4vw,22px)", marginBottom: 14, animation: "g-fadeUp .5s .1s both" }}>
          <div style={{ fontSize: "clamp(10px,2.5vw,11px)", color: T.gold, letterSpacing: "3px", textTransform: "uppercase", fontWeight: 600, marginBottom: 12 }}>How to play</div>
          {["🧠 AI generates 5 surprising statements", "🎭 One is a masterfully crafted LIE", "⏱️ Find the BLUFF before AXIOM wins", "🔥 Build streaks — beat the machine"].map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: i < 3 ? 10 : 0, fontSize: "clamp(13px,3.5vw,15px)", lineHeight: 1.5, animation: `g-fadeUp .5s ${.15 + i * .07}s both` }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>{t.slice(0, 2)}</span>
              <span style={{ opacity: .8 }}>{t.slice(3)}</span>
            </div>
          ))}
        </div>
        {total > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14, animation: "g-fadeUp .5s .3s both" }}>
            {[[score, "Correct", T.ok], [total, "Played", T.gold], [best + "🔥", "Streak", "#a78bfa"]].map(([v, l, c]) => (
              <div key={l} style={{ background: T.glass, borderRadius: 12, border: `1px solid ${T.gb}`, padding: "clamp(10px,3vw,14px) 6px", textAlign: "center" }}>
                <div style={{ fontSize: "clamp(20px,6vw,28px)", fontWeight: 800, color: c, fontFamily: "Georgia,serif" }}>{v}</div>
                <div style={{ fontSize: 9, color: T.dim, letterSpacing: "1px", textTransform: "uppercase", marginTop: 3 }}>{l}</div>
              </div>
            ))}
          </div>
        )}
        <button onClick={startGame} style={{ width: "100%", minHeight: 52, padding: "clamp(14px,3.5vw,17px)", fontSize: "clamp(13px,3.5vw,15px)", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", background: "linear-gradient(135deg,#e8c547,#d4a830)", color: T.bg, borderRadius: 16, position: "relative", overflow: "hidden", boxShadow: "0 0 36px rgba(232,197,71,.14)", animation: "g-fadeUp .5s .4s both", transition: "transform .15s" }}
          onMouseDown={e => e.currentTarget.style.transform = "scale(.97)"} onMouseUp={e => e.currentTarget.style.transform = ""}
          onTouchStart={e => e.currentTarget.style.transform = "scale(.97)"} onTouchEnd={e => e.currentTarget.style.transform = ""}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)", animation: "g-btnShimmer 3s infinite" }} />
          <span style={{ position: "relative" }}>{total > 0 ? "⚔️ Challenge AXIOM again" : "⚔️ Challenge AXIOM"}</span>
        </button>
        <div style={{ marginTop: 20, textAlign: "center", fontSize: 10, color: "rgba(255,255,255,.1)", letterSpacing: "1px" }}>playbluff.games · SIAL Consulting d.o.o.</div>
      </div>
      <GameStyles />
    </div>
  );

  // ─── PLAY ─────────────────────────────────────────────────────
  if (screen === "play") return (
    <div style={wrap}>
      <Particles count={10} />
      {confetti && <Confetti />}
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 460, padding: "clamp(14px,4vw,22px)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingTop: "max(8px,env(safe-area-inset-top))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 20 }}>{CATEGORY_EMOJIS[category] || "🎯"}</span>
            <div>
              <div style={{ fontSize: 10, color: T.gold, letterSpacing: "3px", textTransform: "uppercase", fontWeight: 600 }}>{category}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ fontSize: 9, color: T.dim }}>Round {roundIdx + 1}/{ROUND_DIFFICULTY.length}</div>
                <div style={{ fontSize: 9, color: diffColor, letterSpacing: "1px" }}>· {diffLabel}</div>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {streak > 0 && (
              <div style={{ fontSize: 12, color: T.gold, fontWeight: 700, display: "flex", alignItems: "center", gap: 3, background: T.goldDim, padding: "4px 10px", borderRadius: 20, animation: streak >= 3 ? "g-fire .6s infinite" : "none" }}>🔥{streak}</div>
            )}
            {!revealed
              ? <TimerRing time={time} max={TIMER_PER_DIFFICULTY[diff] || 45} size={46} />
              : <div style={{ width: 46, height: 46, borderRadius: "50%", background: correct ? "rgba(45,212,160,.12)" : "rgba(244,63,94,.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, animation: "g-pulse .5s", color: correct ? T.ok : T.bad }}>{correct ? "✓" : "✗"}</div>
            }
          </div>
        </div>

        {loadingRound ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: T.dim, fontSize: 14 }}>
            <div style={{ animation: "g-pulse 1s infinite", marginBottom: 8, fontSize: 22 }}>🤖</div>
            AXIOM is preparing your deception...
          </div>
        ) : (<>
          <AxiomPanel mood={axiomMood} speech={axiomSpeech} loading={axiomLoading} compact={true} />
          <div style={{ textAlign: "center", marginBottom: 12 }}>
            <h2 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(17px,4.5vw,22px)", fontWeight: 800, margin: "0 0 4px", color: revealed ? (correct ? T.ok : T.bad) : "#fff", transition: "color .4s" }}>
              {revealed ? (correct ? "You found it! 🎯" : "AXIOM won this one 🎭") : "Which one is the BLUFF?"}
            </h2>
            <p style={{ fontSize: "clamp(10px,2.5vw,12px)", color: T.dim, margin: 0 }}>
              {revealed ? (correct ? "Your instincts beat the machine" : "The fabricated lie is highlighted below") : "One statement was invented by AI."}
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14, animation: revealed && !correct ? "g-shake .5s" : "none" }}>
            {stmts.map((s, i) => {
              const isB = !s.real, isS = sel === i;
              let bg = T.card, border = T.gb, anim = "";
              if (!revealed && isS) { bg = T.goldDim; border = "rgba(232,197,71,.4)"; }
              if (revealed && isB) { bg = "rgba(244,63,94,.07)"; border = "rgba(244,63,94,.4)"; anim = "g-glow .8s"; }
              if (revealed && isS && correct) { bg = "rgba(45,212,160,.07)"; border = "rgba(45,212,160,.4)"; anim = "g-correctGlow .8s"; }
              return (
                <button key={i} onClick={() => !revealed && setSel(i)} style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, background: bg, border: `1.5px solid ${border}`, borderRadius: 16, padding: "clamp(11px,3vw,14px)", cursor: revealed ? "default" : "pointer", transition: "all .22s ease", textAlign: "left", color: "#e8e6e1", fontSize: "clamp(13px,3.5vw,15px)", lineHeight: 1.55, fontFamily: "inherit", minHeight: 52, animation: `g-cardIn .3s ${i * .055}s both, ${anim}` }}>
                  <div style={{ width: "clamp(24px,6vw,28px)", height: "clamp(24px,6vw,28px)", borderRadius: "50%", flexShrink: 0, border: `2px solid ${isS && !revealed ? T.gold : revealed && isB ? T.bad : T.gb}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, marginTop: 2, background: isS && !revealed ? T.gold : revealed && isB ? "rgba(244,63,94,.18)" : "transparent", color: isS && !revealed ? T.bg : revealed && isB ? T.bad : T.dim, transition: "all .25s" }}>
                    {revealed && isB ? "!" : String.fromCharCode(65 + i)}
                  </div>
                  <div style={{ flex: 1 }}>
                    {s.text}
                    {revealed && (
                      <div style={{ marginTop: 6, fontSize: 10, fontWeight: 700, letterSpacing: "1.5px", color: isB ? T.bad : isS ? T.bad : T.ok, opacity: isB || isS ? 1 : .4 }}>
                        {isB ? "🎭 AI FABRICATION" : isS ? "✗ This is actually real" : "✓ Verified fact"}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {!revealed
            ? <button onClick={() => sel !== null && doReveal()} disabled={sel === null} style={{ width: "100%", minHeight: 52, padding: "clamp(14px,3.5vw,16px)", fontSize: "clamp(13px,3.5vw,15px)", fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", background: sel !== null ? "linear-gradient(135deg,#e8c547,#d4a830)" : T.card, color: sel !== null ? T.bg : T.dim, border: sel !== null ? "none" : `1.5px solid ${T.gb}`, borderRadius: 16, cursor: sel !== null ? "pointer" : "not-allowed", transition: "all .25s", fontFamily: "inherit", position: "relative", overflow: "hidden" }}>
              {sel !== null && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)", animation: "g-btnShimmer 2.5s infinite" }} />}
              <span style={{ position: "relative" }}>{sel !== null ? "🔒 Lock in answer" : "Select a statement"}</span>
            </button>
            : <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { clearInterval(timerRef.current); setScreen("home"); }} style={{ flex: 1, minHeight: 52, padding: 14, fontSize: "clamp(13px,3.5vw,15px)", fontWeight: 600, background: T.glass, color: "#e8e6e1", border: `1.5px solid ${T.gb}`, borderRadius: 12, fontFamily: "inherit" }}>Home</button>
              <button onClick={roundIdx + 1 < ROUND_DIFFICULTY.length ? nextRound : showResultScreen} style={{ flex: 2, minHeight: 52, padding: 14, fontSize: "clamp(13px,3.5vw,15px)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: "linear-gradient(135deg,#e8c547,#d4a830)", color: T.bg, borderRadius: 12, fontFamily: "inherit", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)", animation: "g-btnShimmer 2.5s infinite" }} />
                <span style={{ position: "relative" }}>{roundIdx + 1 < ROUND_DIFFICULTY.length ? "Next round →" : "See results →"}</span>
              </button>
            </div>
          }

          <div style={{ display: "flex", justifyContent: "center", gap: "clamp(12px,4vw,18px)", marginTop: 12, fontSize: "clamp(10px,2.5vw,12px)", color: T.dim }}>
            <span>Score <b style={{ color: T.gold, fontSize: 13 }}>{score}/{total}</b></span>
            <span style={{ opacity: .2 }}>|</span>
            <span>Accuracy <b style={{ color: T.gold, fontSize: 13 }}>{total ? Math.round(score / total * 100) : 0}%</b></span>
            <span style={{ opacity: .2 }}>|</span>
            <span>Streak <b style={{ color: streak > 0 ? T.gold : T.dim, fontSize: 13 }}>{streak}🔥</b></span>
          </div>
        </>)}
      </div>
      <GameStyles />
    </div>
  );

  // ─── RESULT ───────────────────────────────────────────────────
  const won = score >= Math.ceil(total * .67);
  return (
    <div style={wrap}>
      <Particles />
      {confetti && <Confetti />}
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 460, padding: "clamp(14px,4vw,22px)", paddingTop: "max(36px,env(safe-area-inset-top))" }}>
        <AxiomPanel mood={axiomMood} speech={axiomSpeech} loading={axiomLoading} compact={false} />
        <div style={{ background: T.glass, borderRadius: 16, border: `1px solid ${T.gb}`, padding: "clamp(18px,4vw,24px)", marginBottom: 16, textAlign: "center", animation: "g-fadeUp .5s .2s both" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>{won ? "🏆" : "💀"}</div>
          <h2 style={{ fontFamily: "Georgia,serif", fontSize: "clamp(18px,4.5vw,22px)", fontWeight: 800, margin: "0 0 4px", color: won ? T.gold : T.bad }}>
            {won ? "You beat AXIOM!" : "AXIOM wins... this time."}
          </h2>
          <p style={{ fontSize: "clamp(10px,2.5vw,12px)", color: T.dim, margin: "0 0 16px" }}>
            {won ? "Impressive. AXIOM did not expect this." : "Train harder. AXIOM is patient."}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {[[score + "/" + total, "Correct", T.ok], [Math.round(score / total * 100) + "%", "Accuracy", T.gold], [best + "🔥", "Streak", "#a78bfa"]].map(([v, l, c]) => (
              <div key={l} style={{ background: "#07070e", borderRadius: 10, border: `1px solid ${T.gb}`, padding: "12px 6px" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: c, fontFamily: "Georgia,serif" }}>{v}</div>
                <div style={{ fontSize: 9, color: T.dim, letterSpacing: "1px", textTransform: "uppercase", marginTop: 2 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 16, animation: "g-fadeUp .6s .5s both" }}>
          <div style={{ fontSize: 10, letterSpacing: "3px", color: "rgba(255,255,255,.2)", textTransform: "uppercase", marginBottom: 10 }}>Share card</div>
          {shareImg
            ? <>
              <img src={shareImg} alt="Result card" style={{ width: "100%", borderRadius: 12, border: `1px solid ${T.gb}`, marginBottom: 10 }} />
              <a href={shareImg} download="bluff-result.png" style={{ display: "block", width: "100%", minHeight: 48, padding: 14, fontSize: "clamp(13px,3.5vw,15px)", fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", background: "rgba(34,211,238,.08)", color: "#22d3ee", border: "1px solid rgba(34,211,238,.25)", borderRadius: 12, textAlign: "center", textDecoration: "none", fontFamily: "inherit" }}>↓ Download image</a>
            </>
            : <div style={{ background: "rgba(34,211,238,.05)", border: "1px solid rgba(34,211,238,.12)", borderRadius: 12, padding: 14, textAlign: "center", fontSize: 13, color: "rgba(34,211,238,.4)" }}>Generating share card...</div>
          }
        </div>
        <div style={{ display: "flex", gap: 10, animation: "g-fadeUp .6s .6s both" }}>
          <button onClick={() => setScreen("home")} style={{ flex: 1, minHeight: 52, padding: 14, fontSize: "clamp(13px,3.5vw,15px)", fontWeight: 600, background: T.glass, color: "#e8e6e1", border: `1.5px solid ${T.gb}`, borderRadius: 12, fontFamily: "inherit" }}>Home</button>
          <button onClick={startGame} style={{ flex: 2, minHeight: 52, padding: 14, fontSize: "clamp(13px,3.5vw,15px)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: "linear-gradient(135deg,#e8c547,#d4a830)", color: T.bg, borderRadius: 12, fontFamily: "inherit", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)", animation: "g-btnShimmer 2.5s infinite" }} />
            <span style={{ position: "relative" }}>⚔️ Rematch</span>
          </button>
        </div>
      </div>
      <GameStyles />
    </div>
  );
}

function shuffle(a) {
  let b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function GameStyles() {
  return <style>{`
    @keyframes g-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
    @keyframes g-shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
    @keyframes g-fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
    @keyframes g-cardIn{from{opacity:0;transform:translateX(-10px) scale(.97)}to{opacity:1;transform:none}}
    @keyframes g-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
    @keyframes g-confetti{0%{transform:translateY(-10px) rotate(0);opacity:1}100%{transform:translateY(105vh) rotate(720deg);opacity:0}}
    @keyframes g-btnShimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
    @keyframes g-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-5px)}40%,80%{transform:translateX(5px)}}
    @keyframes g-glow{0%{box-shadow:0 0 0}50%{box-shadow:0 0 22px rgba(244,63,94,.3)}100%{box-shadow:0 0 10px rgba(244,63,94,.1)}}
    @keyframes g-correctGlow{0%{box-shadow:0 0 0}50%{box-shadow:0 0 22px rgba(45,212,160,.35)}100%{box-shadow:0 0 10px rgba(45,212,160,.15)}}
    @keyframes g-fire{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}}
    @keyframes g-tapPulse{0%,100%{opacity:.25}50%{opacity:.65}}
    @keyframes hexRotate{to{transform:rotate(360deg)}}
    @keyframes hexRotateCCW{to{transform:rotate(-360deg)}}
    @keyframes scanDown{0%{transform:translateY(-50px)}100%{transform:translateY(220px)}}
    @keyframes moodIn{from{opacity:0;transform:translateX(6px)}to{opacity:1;transform:none}}
    @keyframes axiomPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
  `}</style>;
}

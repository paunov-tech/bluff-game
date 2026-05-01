import { useEffect, useRef, useState } from "react";
import { useActiveEffects, useGameActions } from "../GameContext.jsx";
import { useBlindMath } from "../hooks/useBlindMath.js";
import { vibrate } from "../api.js";
import { captureEvent } from "../../../lib/telemetry.js";

// V2 BlindMath — 3 rounds, progressive difficulty.
//   Round 1: 3 ops, range 10-30, +/- only.
//   Round 2: 5 ops, range 20-100, +/-/×.
//   Round 3: 7 ops, range 50-200, +/-/×/÷ (÷ only when running total is clean).
//
// Each op flashes for 1 second, then disappears. The running total is hidden.
// AXIOM states a final value as a True/False claim. Player judges.
// 200 points + 10 SWEAR per correct call.
//
// Outer component holds the round counter and unmounts/remounts the inner
// per round so useBlindMath re-seeds with the new config.

const ROUND_CONFIGS = [
  { opsCount: 3, startMin: 10, startMax: 30,  stepMs: 1100, allowMultiply: false, allowDivide: false },
  { opsCount: 5, startMin: 20, startMax: 100, stepMs: 1000, allowMultiply: true,  allowDivide: false },
  { opsCount: 7, startMin: 50, startMax: 200, stepMs: 900,  allowMultiply: true,  allowDivide: true  },
];

const ROUND_COUNT     = ROUND_CONFIGS.length;
const REVEAL_HOLD_MS  = 1800;
const POINTS_PER_HIT  = 200;
const SWEAR_PER_HIT   = 10;

const T = {
  bg: "#04060f", gold: "#e8c547",
  ok: "#2dd4a0", bad: "#f43f5e", dim: "#5a5a68",
  glass: "rgba(255,255,255,.03)", gb: "rgba(255,255,255,.07)",
};

export function BlindMath({ onComplete, onAbort }) {
  const { consumeEffect } = useGameActions();
  const activeEffects = useActiveEffects();
  const [roundIdx, setRoundIdx]       = useState(0);
  const [stats, setStats]             = useState({ correct: 0, total: 0 });
  const finishedRef = useRef(false);
  const completionRef = useRef({ correct: 0, total: 0 });
  // Effect snapshots — consumed once on mount, applied to all rounds.
  const pointsMultRef = useRef(1);
  const stepMsCutRef  = useRef(0);

  useEffect(() => { completionRef.current = stats; }, [stats]);

  useEffect(() => {
    const has2x  = activeEffects.some(e => e.type === "POINTS_2X");
    const hasCut = activeEffects.some(e => e.type === "TIMER_CUT");
    if (has2x)  { pointsMultRef.current = 2; consumeEffect("POINTS_2X"); }
    if (hasCut) { stepMsCutRef.current = 200; consumeEffect("TIMER_CUT"); }
    captureEvent("v2_phase_started", { phase: "BLIND_MATH", points2x: has2x, timerCut: hasCut });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRoundDone(correct) {
    setStats(s => ({
      correct: s.correct + (correct ? 1 : 0),
      total:   s.total + 1,
    }));
    const next = roundIdx + 1;
    if (next >= ROUND_COUNT) {
      if (!finishedRef.current) {
        finishedRef.current = true;
        // Use computed (not setState) to avoid losing the last round.
        const finalCorrect = completionRef.current.correct + (correct ? 1 : 0);
        const finalTotal   = completionRef.current.total + 1;
        captureEvent("v2_phase_completed", {
          phase: "BLIND_MATH", correct: finalCorrect, total: finalTotal,
        });
        onComplete?.({
          ok: true,
          phase: "BLIND_MATH",
          stats: { correct: finalCorrect, total: finalTotal },
        });
      }
    } else {
      setRoundIdx(next);
    }
  }

  return (
    <div style={wrap()}>
      <header style={hud()}>
        <button onClick={onAbort} style={hudBtn()}>✕</button>
        <div style={{ fontSize: 12, letterSpacing: 2, color: T.dim }}>
          Round {roundIdx + 1}/{ROUND_COUNT} · Blind Math
        </div>
        <div style={{ width: 32 }} />
      </header>

      <BlindMathRound
        key={roundIdx}
        config={{
          ...ROUND_CONFIGS[roundIdx],
          stepMs: Math.max(500, ROUND_CONFIGS[roundIdx].stepMs - stepMsCutRef.current),
        }}
        pointsMultiplier={pointsMultRef.current}
        onDone={handleRoundDone}
      />
    </div>
  );
}

function BlindMathRound({ config, pointsMultiplier = 1, onDone }) {
  const { addScore, addSwear } = useGameActions();
  const m = useBlindMath(config);
  const [showResult, setShowResult] = useState(false);
  const submittedRef = useRef(false);
  const doneTimerRef = useRef(null);

  useEffect(() => { m.start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (doneTimerRef.current) clearTimeout(doneTimerRef.current); }, []);

  function answer(saysTrue) {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const correct = m.submit(saysTrue);
    if (correct === null) { submittedRef.current = false; return; }
    if (correct) { addScore(POINTS_PER_HIT * pointsMultiplier); addSwear(SWEAR_PER_HIT); vibrate(15); }
    else         { vibrate([20, 50, 20]); }
    setShowResult(true);
    doneTimerRef.current = setTimeout(() => onDone(correct), REVEAL_HOLD_MS);
  }

  // ── Render states: starting / revealing / awaiting / result ──
  return (
    <div style={stage()}>
      {!m.started && (
        <div style={{ color: T.dim, fontSize: 13 }}>Loading…</div>
      )}

      {m.started && !m.finished && (
        <>
          <div style={tag()}>STARTING NUMBER</div>
          <div style={{
            fontSize: 56, fontWeight: 800, color: T.gold,
            fontFamily: "Georgia, serif", lineHeight: 1, marginTop: 4, marginBottom: 24,
          }}>
            {m.startValue}
          </div>

          <div style={tag()}>{Math.min(m.opsRevealed + 1, m.opsCount)} / {m.opsCount}</div>
          <div key={m.currentIndex} style={opCard()}>
            {m.currentOp ? `${m.currentOp.kind} ${m.currentOp.value}` : "…"}
          </div>
          <div style={{ marginTop: 14, color: T.dim, fontSize: 12, letterSpacing: 1 }}>
            (Running total hidden)
          </div>
        </>
      )}

      {m.finished && !showResult && (
        <>
          <div style={tag()}>AXIOM CLAIMS</div>
          <div style={{
            fontSize: 64, fontWeight: 900, color: T.gold,
            fontFamily: "Georgia, serif", lineHeight: 1, margin: "8px 0 28px",
            textShadow: "0 0 24px rgba(232,197,71,.35)",
          }}>
            {m.axiomClaim}
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <button onClick={() => answer(true)}  style={btnTrue()}>✓ TRUE</button>
            <button onClick={() => answer(false)} style={btnLie()}>✗ LIE</button>
          </div>
        </>
      )}

      {showResult && (
        <>
          <div style={{
            ...tag(),
            color: m.judgementCorrect ? T.ok : T.bad,
            fontSize: 12, fontWeight: 800,
          }}>
            {m.judgementCorrect ? `CORRECT · +${POINTS_PER_HIT}` : "WRONG"}
          </div>
          <div style={{ marginTop: 8, color: T.dim, fontSize: 13 }}>
            Real answer was <b style={{ color: "#e8e6e1" }}>{m.realAnswer}</b>
          </div>
          <div style={{ marginTop: 4, color: T.dim, fontSize: 12 }}>
            AXIOM said {m.axiomClaim} ({m.axiomClaimIsTrue ? "true" : "lie"})
          </div>
        </>
      )}
    </div>
  );
}

function wrap() {
  return {
    minHeight: "100dvh",
    background: `radial-gradient(ellipse at 50% 0%, rgba(232,197,71,.06) 0%, ${T.bg} 55%)`,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: "#e8e6e1",
    display: "flex", flexDirection: "column",
    paddingBottom: "max(20px, env(safe-area-inset-bottom))",
  };
}
function hud() {
  return {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,.04)",
  };
}
function hudBtn() {
  return {
    width: 32, height: 32, borderRadius: 8,
    background: "transparent", color: "#e8e6e1",
    border: "1px solid rgba(255,255,255,.1)",
    cursor: "pointer", fontFamily: "inherit", fontSize: 14,
  };
}
function stage() {
  return {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    padding: 24, textAlign: "center",
  };
}
function tag() {
  return { fontSize: 11, letterSpacing: 3, color: T.dim, textTransform: "uppercase" };
}
function opCard() {
  return {
    padding: "20px 32px", border: `1.5px solid ${T.gold}`, borderRadius: 16,
    fontSize: 40, fontWeight: 800, fontFamily: "Georgia, serif",
    minWidth: 160, textAlign: "center", color: "#e8e6e1",
    background: "rgba(232,197,71,.04)",
    boxShadow: "0 0 28px rgba(232,197,71,.10), inset 0 1px 0 rgba(255,255,255,.04)",
    animation: "g-flash-in .25s ease",
  };
}
function btnTrue() {
  return {
    minWidth: 130, minHeight: 56, fontSize: 14, fontWeight: 800, letterSpacing: 2,
    textTransform: "uppercase",
    background: "rgba(45,212,160,0.10)", color: T.ok, border: `1.5px solid ${T.ok}`,
    borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
  };
}
function btnLie() {
  return {
    minWidth: 130, minHeight: 56, fontSize: 14, fontWeight: 800, letterSpacing: 2,
    textTransform: "uppercase",
    background: "rgba(244,63,94,0.10)", color: T.bad, border: `1.5px solid ${T.bad}`,
    borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
  };
}

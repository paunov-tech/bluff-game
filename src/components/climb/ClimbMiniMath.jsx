import { useEffect, useMemo, useRef, useState } from "react";

// CLIMB Mini-game 3 — Numbers TRUE/FALSE math claim.
// AXIOM throws a math expression (3-4 operands) and a *claimed* result.
// Sometimes the claim is correct, sometimes it's off by a plausible margin.
// Player taps TRUE or FALSE. 3 rounds per session.
//
// Pure client-side — no API calls. Deterministic per-mount via Math.random.
// Calls onComplete({ pointsEarned, correct, total }) when finished.

const ROUNDS = 3;
const POINTS_PER_HIT = 200;
const SECONDS_PER_ROUND = 18;

const T = {
  bg: "#04060f",
  numbers: "#22d3ee",
  ok: "#2dd4a0",
  bad: "#f43f5e",
  dim: "#5a5a68",
  glass: "rgba(255,255,255,.03)",
  gb: "rgba(255,255,255,.07)",
};

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Generate one challenge: an expression string and the *true* numeric result,
// then pick whether the claim shown to the player is correct or off by ±N.
function makeChallenge() {
  const opCount = Math.random() < 0.5 ? 2 : 3; // 3 or 4 operands
  const ops = ["+", "-", "×"];
  const operands = [rand(5, 49)];
  const opSeq = [];
  for (let i = 0; i < opCount; i++) {
    const op = ops[rand(0, ops.length - 1)];
    opSeq.push(op);
    operands.push(rand(2, op === "×" ? 9 : 39));
  }

  // Eval honoring × > +/-, left-to-right. First fold ×, then +/-.
  let nums = [...operands];
  let oprs = [...opSeq];
  for (let i = 0; i < oprs.length; ) {
    if (oprs[i] === "×") {
      const product = nums[i] * nums[i + 1];
      nums.splice(i, 2, product);
      oprs.splice(i, 1);
    } else { i++; }
  }
  let truth = nums[0];
  for (let i = 0; i < oprs.length; i++) {
    truth = oprs[i] === "+" ? truth + nums[i + 1] : truth - nums[i + 1];
  }

  // 50/50 truthful claim vs. plausibly-wrong claim. Wrong claims drift by
  // ±[3..15] so the player can't dismiss them on size alone.
  const claimIsTrue = Math.random() < 0.5;
  let claim = truth;
  if (!claimIsTrue) {
    const drift = rand(3, 15) * (Math.random() < 0.5 ? -1 : 1);
    claim = truth + drift;
    if (claim === truth) claim = truth + 7; // safety: never accidentally truthful
  }

  // Render the expression as "47 + 23 × 2" using the original operand list.
  let expr = String(operands[0]);
  for (let i = 0; i < opSeq.length; i++) {
    expr += ` ${opSeq[i]} ${operands[i + 1]}`;
  }
  return { expr, claim, truth, claimIsTrue };
}

export function ClimbMiniMath({ onComplete }) {
  const [round, setRound] = useState(0);
  const [stats, setStats] = useState({ correct: 0, total: 0, pointsEarned: 0 });
  const [challenge, setChallenge] = useState(() => makeChallenge());
  const [revealed, setRevealed] = useState(false);
  const [tapped, setTapped] = useState(null); // "true" | "false"
  const [timeLeft, setTimeLeft] = useState(SECONDS_PER_ROUND);
  const finishedRef = useRef(false);
  const advanceRef = useRef(null);

  useEffect(() => {
    setTimeLeft(SECONDS_PER_ROUND);
    setRevealed(false);
    setTapped(null);
  }, [round]);

  useEffect(() => {
    if (revealed || finishedRef.current) return;
    if (timeLeft <= 0) { handleAnswer(null); return; }
    const id = setTimeout(() => setTimeLeft(s => s - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, revealed]);

  useEffect(() => () => { if (advanceRef.current) clearTimeout(advanceRef.current); }, []);

  function handleAnswer(answer) {
    if (revealed || finishedRef.current) return;
    setTapped(answer);
    setRevealed(true);
    const userSaidTrue = answer === "true";
    const correct = answer != null && (userSaidTrue === challenge.claimIsTrue);
    const next = {
      correct: stats.correct + (correct ? 1 : 0),
      total: stats.total + 1,
      pointsEarned: stats.pointsEarned + (correct ? POINTS_PER_HIT : 0),
    };
    setStats(next);
    if (navigator.vibrate) try { navigator.vibrate(correct ? 12 : [15, 40, 15]); } catch {}

    advanceRef.current = setTimeout(() => {
      const nextRound = round + 1;
      if (nextRound >= ROUNDS) {
        finishedRef.current = true;
        onComplete?.({ pointsEarned: next.pointsEarned, correct: next.correct, total: next.total });
      } else {
        setChallenge(makeChallenge());
        setRound(nextRound);
      }
    }, 1600);
  }

  const correctnessLabel = useMemo(() => {
    if (!revealed) return null;
    const userSaidTrue = tapped === "true";
    if (tapped == null) return { txt: `⏱  AXIOM scored a beat. Truth: ${challenge.truth}`, color: T.bad };
    if (userSaidTrue === challenge.claimIsTrue) return { txt: `✓ +${POINTS_PER_HIT}`, color: T.ok };
    return { txt: `✗ Truth: ${challenge.truth}`, color: T.bad };
  }, [revealed, tapped, challenge]);

  return (
    <div style={wrap()}>
      <header style={hud()}>
        <span style={{ fontSize: 11, letterSpacing: 3, color: T.numbers, fontWeight: 700, textTransform: "uppercase" }}>
          Numbers · {round + 1}/{ROUNDS}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 800, fontFamily: "Georgia, serif",
          color: timeLeft <= 5 ? T.bad : T.numbers, minWidth: 40, textAlign: "right",
        }}>{timeLeft}s</span>
      </header>

      <div style={{ height: 3, background: "rgba(255,255,255,.05)" }}>
        <div style={{
          height: "100%", width: `${(timeLeft / SECONDS_PER_ROUND) * 100}%`,
          background: timeLeft <= 5 ? T.bad : T.numbers,
          transition: "width 1s linear, background .2s",
        }} />
      </div>

      {/* Vertically-centered main area — header + progress stay at top. */}
      <div style={{
        flex: 1,
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "0 4px",
      }}>
        <div style={{ padding: "0 18px 4px", textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: T.numbers, opacity: 0.8, textTransform: "uppercase" }}>
            AXIOM claims:
          </div>
        </div>

        <div style={card()}>
          <div style={{ fontSize: "clamp(22px, 6vw, 30px)", fontWeight: 700, fontFamily: "Georgia, serif", color: "#f0eee8", letterSpacing: 1.5 }}>
            {challenge.expr}
          </div>
          <div style={{
            marginTop: 18, fontSize: "clamp(28px, 8vw, 40px)", fontWeight: 800,
            fontFamily: "Georgia, serif", color: T.numbers, letterSpacing: 2,
            animation: revealed ? "none" : "climb-math-pulse 2.2s ease-in-out infinite",
          }}>
            = {challenge.claim}
          </div>
        </div>

        {correctnessLabel && (
          <div style={{ textAlign: "center", marginTop: 10, color: correctnessLabel.color, fontWeight: 700, fontSize: 14 }}>
            {correctnessLabel.txt}
          </div>
        )}

        <div style={btnRow()}>
          <button
            onClick={() => handleAnswer("false")}
            disabled={revealed}
            style={btnFalse(revealed && tapped === "false")}
          >✗ FALSE</button>
          <button
            onClick={() => handleAnswer("true")}
            disabled={revealed}
            style={btnTrue(revealed && tapped === "true")}
          >✓ TRUE</button>
        </div>

        <div style={{ textAlign: "center", color: T.dim, fontSize: 11, letterSpacing: 1.5, marginTop: 14 }}>
          AXIOM lies sometimes. Trust nothing.
        </div>
      </div>

      <style>{`
        @keyframes climb-math-pulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.03); }
        }
      `}</style>
    </div>
  );
}

function wrap() {
  return {
    minHeight: "100dvh",
    background: `radial-gradient(ellipse at 50% 0%, rgba(34,211,238,.06) 0%, ${T.bg} 55%)`,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: "#e8e6e1",
    display: "flex", flexDirection: "column",
    paddingBottom: "max(20px, env(safe-area-inset-bottom))",
  };
}
function hud() {
  return {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.04)",
  };
}
function card() {
  return {
    margin: "16px",
    padding: "28px 18px",
    background: "linear-gradient(135deg, #232336, #14141f)",
    border: "1px solid rgba(34,211,238,.18)",
    borderRadius: 18,
    textAlign: "center",
    // Outer glow gives a faint warm halo under the card so it doesn't feel
    // like it's floating in negative space; inner shadow preserves depth.
    boxShadow: "0 10px 40px rgba(0,0,0,.45), 0 0 60px rgba(232,197,71,.07)",
  };
}
function btnRow() {
  return {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12,
    padding: "14px 16px 18px",
  };
}
function btnTrue(highlight) {
  return {
    minHeight: 68, fontSize: 16, fontWeight: 800, letterSpacing: 2,
    textTransform: "uppercase",
    background: highlight ? "rgba(45,212,160,.20)" : "rgba(45,212,160,.08)",
    color: T.ok, border: `1.5px solid ${T.ok}`,
    borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
    transition: "transform .12s, background .15s",
  };
}
function btnFalse(highlight) {
  return {
    minHeight: 68, fontSize: 16, fontWeight: 800, letterSpacing: 2,
    textTransform: "uppercase",
    background: highlight ? "rgba(244,63,94,.20)" : "rgba(244,63,94,.08)",
    color: T.bad, border: `1.5px solid ${T.bad}`,
    borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
    transition: "transform .12s, background .15s",
  };
}

export default ClimbMiniMath;

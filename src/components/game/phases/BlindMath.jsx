import { useEffect } from "react";
import { PhaseShell } from "../PhaseShell.jsx";
import { useGameActions } from "../GameContext.jsx";
import { useBlindMath } from "../hooks/useBlindMath.js";

// BlindMath phase — see useBlindMath for the rules.
// Only the current operation is shown; the running total is hidden.
// AXIOM states a final value as True or False. The player must call it.
export function BlindMath({ onComplete, onAbort }) {
  const { addScore, loseLife } = useGameActions();
  const m = useBlindMath({ opsCount: 6, stepMs: 1100 });

  // Auto-start the sequence when the phase mounts.
  useEffect(() => { m.start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleAnswer(saysTrue) {
    const correct = m.submit(saysTrue);
    if (correct === null) return;
    if (correct) addScore(250);
    else loseLife();

    // Brief reveal pause so the player can see the truth before advancing.
    setTimeout(() => onComplete?.({ ok: correct, judgement: saysTrue, claim: m.axiomClaim }), 1400);
  }

  return (
    <PhaseShell
      name="Blind Math"
      blurb="Hold the running total in your head. AXIOM will state the answer — call it."
      onComplete={() => {}}
      onAbort={onAbort}
    >
      <div style={stage}>
        {!m.started && <div style={dim}>Loading…</div>}

        {m.started && !m.finished && (
          <>
            <div style={tag}>STARTING NUMBER</div>
            <div style={bigNum}>{m.startValue}</div>
            <div style={tag}>{m.opsRevealed + 1} / {m.opsCount}</div>
            <div style={opCard}>
              {m.currentOp ? `${m.currentOp.kind} ${m.currentOp.value}` : "…"}
            </div>
            <div style={dim}>(Running total hidden)</div>
          </>
        )}

        {m.finished && m.userJudgement === null && (
          <>
            <div style={tag}>AXIOM CLAIMS</div>
            <div style={bigNum}>{m.axiomClaim}</div>
            <div style={row}>
              <button onClick={() => handleAnswer(true)}  style={trueBtn}>TRUE</button>
              <button onClick={() => handleAnswer(false)} style={falseBtn}>LIE</button>
            </div>
          </>
        )}

        {m.userJudgement !== null && (
          <>
            <div style={{ ...tag, color: m.judgementCorrect ? "#2dd4a0" : "#f43f5e" }}>
              {m.judgementCorrect ? "CORRECT" : "WRONG"}
            </div>
            <div style={dim}>Real answer was <b>{m.realAnswer}</b></div>
          </>
        )}
      </div>
    </PhaseShell>
  );
}

const stage = { display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginTop: 16 };
const tag = { fontSize: 11, letterSpacing: 3, opacity: 0.5 };
const bigNum = { fontSize: 56, fontWeight: 700, fontFamily: "Georgia, serif", color: "#e8c547" };
const opCard = {
  padding: "16px 28px", border: "1.5px solid #e8c547", borderRadius: 14,
  fontSize: 32, fontWeight: 700, fontFamily: "Georgia, serif", minWidth: 140, textAlign: "center",
};
const dim = { opacity: 0.6, fontSize: 13 };
const row = { display: "flex", gap: 12, marginTop: 12 };
const trueBtn = {
  padding: "12px 28px", borderRadius: 10, background: "#2dd4a0",
  color: "#04060f", border: "none", fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
};
const falseBtn = {
  padding: "12px 28px", borderRadius: 10, background: "#f43f5e",
  color: "#04060f", border: "none", fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
};

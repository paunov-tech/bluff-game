import { useCallback, useEffect, useRef, useState } from "react";
import { useGameActions, useSwear } from "../GameContext.jsx";
import { authFetch, vibrate } from "../api.js";
import { captureEvent } from "../../../lib/telemetry.js";

// V2 SuddenDeath — final phase, classic format with infinite streak.
//
//   Each round: 5 statements, find the lie, 20s timer, hardest difficulty.
//   Reward grows with the streak: 500 × streak points, 10 × streak SWEAR.
//   First miss → if balance >= CONTINUE_COST: offer "Continue for 10 SWEAR"
//                else: end run.
//   Continued miss = end run. Walk away always available.
//
//   When the run ends here, we award the accumulated points/SWEAR via the
//   GameContext. The engine treats this phase's onComplete as the run's
//   final beat (it's the final phase) and fires onRunComplete with outcome
//   "victory" regardless. (Sudden Death "loss" is still considered a
//   completed run — the streak earned is the score.)

const SECONDS_PER_ROUND = 20;
const CONTINUE_COST     = 10;
const REVEAL_HOLD_MS    = 2500;

const T = {
  bg: "#0c0306", crimson: "#1a0408", gold: "#e8c547",
  ok: "#2dd4a0", bad: "#f43f5e", dim: "#5a5a68",
  glass: "rgba(255,255,255,.03)", gb: "rgba(255,255,255,.07)",
};

const AXIOM_LINES = {
  1:  "Lucky.",
  3:  "You're still standing. Surprising.",
  5:  "I'm starting to take this seriously.",
  7:  "How are you still here.",
  10: "You're not human. Or I'm not.",
  15: "Stop. Just stop.",
};

function axiomLineFor(streak) {
  let line = null;
  for (const k of Object.keys(AXIOM_LINES).map(Number).sort((a, b) => a - b)) {
    if (streak >= k) line = AXIOM_LINES[k];
  }
  return line;
}

export function SuddenDeath({ lang = "en", userId, onComplete, onAbort }) {
  const { addScore, addSwear, spendSwear } = useGameActions();
  const swear = useSwear();

  const [round, setRound]               = useState(null);
  const [selectedIdx, setSelectedIdx]   = useState(null);
  const [revealed, setRevealed]         = useState(false);
  const [streak, setStreak]             = useState(0);
  const [accumScore, setAccumScore]     = useState(0);
  const [accumSwear, setAccumSwear]     = useState(0);
  const [stage, setStage]               = useState("loading"); // loading | playing | reveal | continue_offer | dead | error
  const [error, setError]               = useState(null);
  const [timeLeft, setTimeLeft]         = useState(SECONDS_PER_ROUND);
  const [roundsPlayed, setRoundsPlayed] = useState(0);

  const finishedRef = useRef(false);
  const advanceTimerRef = useRef(null);

  useEffect(() => {
    captureEvent("v2_phase_started", { phase: "SUDDEN_DEATH" });
    fetchNextRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => { if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current); }, []);

  // Per-round timer.
  useEffect(() => {
    if (stage !== "playing") return;
    if (timeLeft <= 0) { handleReveal(); return; }
    const id = setTimeout(() => setTimeLeft(s => s - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, stage]);

  async function fetchNextRound() {
    setStage("loading");
    try {
      // phase=second is rounds 7-12 of solo difficulty list = [4,4,4,5,5,5].
      // Pick a single random round at the high end.
      const url = `/api/solo-rounds?phase=second` +
                  (userId ? `&userId=${encodeURIComponent(userId)}` : "");
      const r = await authFetch(url);
      if (!r.ok && r.status !== 206) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `solo_${r.status}`);
      }
      const data = await r.json();
      if (!Array.isArray(data.rounds) || data.rounds.length === 0) {
        throw new Error("no_rounds");
      }
      const pick = data.rounds[Math.floor(Math.random() * data.rounds.length)];
      setRound(pick);
      setSelectedIdx(null);
      setRevealed(false);
      setTimeLeft(SECONDS_PER_ROUND);
      setStage("playing");
    } catch (e) {
      setError(e.message || "load_failed");
      setStage("error");
    }
  }

  const handleReveal = useCallback(() => {
    if (revealed || finishedRef.current || !round) return;
    setRevealed(true);
    setStage("reveal");

    const correctIdx = (round.statements || []).findIndex(s => !s.real);
    const correct    = selectedIdx !== null && selectedIdx === correctIdx;
    setRoundsPlayed(p => p + 1);

    if (correct) {
      const newStreak = streak + 1;
      const points = 500 * newStreak;
      const swearReward = 10 * newStreak;
      setStreak(newStreak);
      setAccumScore(s => s + points);
      setAccumSwear(s => s + swearReward);
      addScore(points);
      addSwear(swearReward);
      vibrate(15);
      captureEvent("v2_sudden_death_streak", { streak: newStreak });

      advanceTimerRef.current = setTimeout(() => fetchNextRound(), REVEAL_HOLD_MS);
    } else {
      vibrate([30, 60, 30, 60, 80]);
      // Offer continue if the player can afford it AND has banked something
      // worth saving. We always offer — if they want to walk away, the
      // modal has a "Bank & End" button.
      const canContinue = swear >= CONTINUE_COST;
      advanceTimerRef.current = setTimeout(() => {
        if (canContinue) setStage("continue_offer");
        else { setStage("dead"); endPhase("died"); }
      }, REVEAL_HOLD_MS);
    }
  }, [revealed, round, selectedIdx, streak, swear, addScore, addSwear]);

  function handleContinue() {
    if (swear < CONTINUE_COST) return;
    spendSwear(CONTINUE_COST);
    captureEvent("v2_sudden_death_continued", { streak, costPaid: CONTINUE_COST });
    fetchNextRound();
  }

  function handleWalkAway() {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    setStage("dead");
    endPhase("walked_away");
  }

  function endPhase(reason) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    captureEvent("v2_phase_completed", {
      phase: "SUDDEN_DEATH",
      streak, accumScore, accumSwear, reason, roundsPlayed,
    });
    // Hold the dead/banked screen briefly before passing control back to
    // the engine.
    advanceTimerRef.current = setTimeout(() => {
      onComplete?.({
        ok: true,
        phase: "SUDDEN_DEATH",
        stats: { streak, accumScore, accumSwear, reason, roundsPlayed },
      });
    }, 1800);
  }

  // ── Render ─────────────────────────────────────────────────
  if (stage === "error") {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center", maxWidth: 400, margin: "0 auto" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠</div>
          <div style={{ color: T.bad, marginBottom: 16 }}>Couldn't load round.</div>
          <div style={{ color: T.dim, fontSize: 12, marginBottom: 16 }}>{error}</div>
          <button onClick={onAbort} style={btnSecondary()}>Back</button>
        </div>
      </div>
    );
  }

  if (stage === "loading") {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: T.bad, fontWeight: 800, textTransform: "uppercase", marginBottom: 12 }}>
            💀 Sudden Death
          </div>
          <div style={{ color: T.dim, fontSize: 13 }}>{streak > 0 ? `Streak ${streak} — next round…` : "Loading…"}</div>
        </div>
      </div>
    );
  }

  if (stage === "dead") {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center", maxWidth: 420, margin: "0 auto" }}>
          <div style={{ fontSize: 38, marginBottom: 8 }}>💀</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: T.bad, fontFamily: "Georgia, serif", marginBottom: 14 }}>
            {streak > 0 ? "Banked." : "AXIOM wins this round."}
          </div>
          <div style={{ color: T.dim, fontSize: 14 }}>
            Streak: <b style={{ color: "#e8e6e1" }}>{streak}</b> · Banked <b style={{ color: T.gold }}>{accumScore}</b> pts · <b style={{ color: T.gold }}>{accumSwear}</b> SWEAR
          </div>
        </div>
      </div>
    );
  }

  if (stage === "continue_offer") {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center", maxWidth: 420, margin: "0 auto" }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: T.bad, fontWeight: 800, textTransform: "uppercase", marginBottom: 8 }}>
            You missed
          </div>
          <div style={{ fontSize: 22, fontFamily: "Georgia, serif", color: "#e8e6e1", marginBottom: 8 }}>
            Pay {CONTINUE_COST} SWEAR to keep your streak?
          </div>
          <div style={{ color: T.dim, fontSize: 13, marginBottom: 18 }}>
            Streak so far: <b style={{ color: T.gold }}>{streak}</b> · Balance <b style={{ color: T.gold }}>{swear}</b> SWEAR
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleContinue} style={btnPrimary(false)}>
              Continue ({CONTINUE_COST} SWEAR)
            </button>
            <button onClick={handleWalkAway} style={btnSecondary()}>
              Bank & end
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Playing or reveal
  if (!round) return null;
  const correctIdx = (round.statements || []).findIndex(s => !s.real);
  const lineForStreak = streak >= 1 ? axiomLineFor(streak) : null;

  return (
    <div style={wrap()}>
      <header style={hud()}>
        <button onClick={onAbort} style={hudBtn()}>✕</button>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{
            fontSize: 12, letterSpacing: 2,
            color: streak >= 5 ? T.bad : T.dim,
            fontWeight: 800, textShadow: streak >= 5 ? `0 0 10px ${T.bad}` : "none",
          }}>
            🔥 {streak}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 800,
            color: timeLeft <= 5 ? T.bad : T.gold, fontFamily: "Georgia, serif",
            minWidth: 36, textAlign: "right",
          }}>
            {timeLeft}s
          </span>
        </div>
        <div style={{ width: 32 }} />
      </header>

      <div style={{ height: 3, background: "rgba(255,255,255,.05)" }}>
        <div style={{
          height: "100%", width: `${(timeLeft / SECONDS_PER_ROUND) * 100}%`,
          background: timeLeft <= 5 ? T.bad : T.gold,
          transition: "width 1s linear, background .2s",
        }} />
      </div>

      <div style={{ padding: "14px 16px 4px", textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: T.bad, fontWeight: 800, textTransform: "uppercase" }}>
          💀 Sudden Death
        </div>
        <div style={{ fontSize: 12, color: T.dim, marginTop: 4 }}>
          Find the lie · One miss ends it (or pay {CONTINUE_COST} SWEAR)
        </div>
        {lineForStreak && (
          <div style={{ fontSize: 12, color: T.bad, marginTop: 8, fontStyle: "italic", opacity: 0.85 }}>
            AXIOM: “{lineForStreak}”
          </div>
        )}
      </div>

      <div style={list()}>
        {(round.statements || []).map((s, idx) => {
          const isSel = selectedIdx === idx;
          const isCorrectAnswer = revealed && idx === correctIdx;
          const isWrongPick     = revealed && isSel && idx !== correctIdx;

          let border = `1.5px solid ${T.gb}`;
          let bg     = T.glass;
          let color  = "#e8e6e1";
          if (isCorrectAnswer) { border = `1.5px solid ${T.bad}`; bg = "rgba(244,63,94,.10)"; color = T.bad; }
          else if (isWrongPick) { border = `1.5px solid ${T.dim}`; bg = "rgba(255,255,255,.02)"; color = T.dim; }
          else if (isSel)       { border = `1.5px solid ${T.gold}`; bg = "rgba(232,197,71,.08)"; }

          return (
            <button
              key={idx}
              onClick={() => { if (!revealed) setSelectedIdx(idx); }}
              disabled={revealed}
              style={{
                width: "100%", textAlign: "left", padding: "14px 16px",
                background: bg, border, borderRadius: 12, color,
                fontFamily: "Georgia, serif",
                fontSize: "clamp(14px, 3.6vw, 16px)", lineHeight: 1.4,
                cursor: revealed ? "default" : "pointer", transition: "all .12s ease",
              }}
            >
              {isCorrectAnswer && <span style={{ color: T.bad, fontWeight: 800, marginRight: 8 }}>✗ LIE</span>}
              {s.text}
            </button>
          );
        })}
      </div>

      <div style={{ padding: "10px 16px 18px" }}>
        {!revealed ? (
          <button onClick={handleReveal} disabled={selectedIdx === null} style={btnPrimary(selectedIdx === null)}>
            Lock in
          </button>
        ) : (
          <div style={{
            textAlign: "center", padding: 12,
            color: selectedIdx === correctIdx ? T.ok : T.bad,
            fontWeight: 800, letterSpacing: 2, textTransform: "uppercase",
          }}>
            {selectedIdx === correctIdx
              ? `Correct · +${500 * (streak + 1)} pts · +${10 * (streak + 1)} SWEAR`
              : "Missed"}
          </div>
        )}
      </div>
    </div>
  );
}

function wrap() {
  return {
    minHeight: "100dvh",
    background: `radial-gradient(ellipse at 50% 0%, rgba(244,63,94,.08) 0%, ${T.crimson} 55%)`,
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
function list() {
  return {
    flex: 1, padding: "8px 16px",
    display: "flex", flexDirection: "column", gap: 8, overflowY: "auto",
  };
}
function btnPrimary(disabled) {
  return {
    flex: 1, minHeight: 52, padding: 14,
    fontSize: 13, fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase",
    background: disabled
      ? "rgba(232,197,71,.18)"
      : "linear-gradient(135deg,#e8c547,#d4a830)",
    color: T.bg, border: "none", borderRadius: 14,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    fontFamily: "inherit",
  };
}
function btnSecondary() {
  return {
    flex: 1, minHeight: 52, padding: 14,
    fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
    background: "transparent", color: T.gold, border: `1px solid ${T.gold}`,
    borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
  };
}

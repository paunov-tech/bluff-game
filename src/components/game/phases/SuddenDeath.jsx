import { useCallback, useEffect, useRef, useState } from "react";
import { useGameActions, useSwear } from "../GameContext.jsx";
import { authFetch, vibrate } from "../api.js";
import { captureEvent } from "../../../lib/telemetry.js";
import { pickSabotageType, scrambleText, SABOTAGE_TYPES } from "../../../lib/sabotage.js";
import { PitFall } from "../../PitFall.jsx";
import { AxiomReaction } from "../../AxiomReaction.jsx";

// V2 SuddenDeath — final phase, classic format with infinite streak.
//
// Step 4 (drama):
//   - Sabotage 15% per round, ALL difficulties (drama is the point).
//   - PitFall (crimson + finalDeath) on the FATAL miss.
//   - AxiomReaction LAUGH after each correct: streak >= 5 escalates from
//     "default" tone to "worried" — AXIOM stops trying to pretend it's fine.
//   - AxiomReaction MOCK with intensity="high" overlays PitFall on death.
//   - NO CommunityToast — distraction would dilute the intensity.
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
const REVEAL_HOLD_CORRECT_MS = 2500;
const REVEAL_HOLD_WRONG_MS   = 4000; // PitFall is 3s + 1s buffer
const V2_SUDDEN_DEATH_SABOTAGE_CHANCE = 0.15;
const V2_SD_SABOTAGE_DELAY_MIN_MS = 3000;
const V2_SD_SABOTAGE_DELAY_MAX_MS = 11000;
const V2_SD_SABOTAGE_TIMER_CUT_S  = 5;   // out of 20s timer; min 3s remaining

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

  // Drama state.
  const [activeSabotage, setActiveSabotage] = useState(null);
  const [sabotageBanner, setSabotageBanner] = useState(null);
  const [showPitFall, setShowPitFall]       = useState(false);
  const [showAxiomMock, setShowAxiomMock]   = useState(false);
  const [showAxiomLaugh, setShowAxiomLaugh] = useState(false);
  const [laughIntensity, setLaughIntensity] = useState("default");

  const finishedRef = useRef(false);
  const advanceTimerRef = useRef(null);
  const sabotageScheduleRef = useRef(null);
  const sabotageEndTimerRef = useRef(null);
  const sabotagePeekTimerRef = useRef(null);
  const sabotageBannerTimerRef = useRef(null);
  // Per-round flag to ensure sabotage doesn't double-fire on re-renders.
  // Resets every fetchNextRound() via roundsPlayed change.
  const sabotageRoundFlagRef = useRef({ key: -1, triggered: false });

  useEffect(() => {
    captureEvent("v2_phase_started", { phase: "SUDDEN_DEATH" });
    fetchNextRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup pending timers on unmount.
  useEffect(() => () => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    if (sabotageScheduleRef.current) clearTimeout(sabotageScheduleRef.current);
    if (sabotageEndTimerRef.current) clearTimeout(sabotageEndTimerRef.current);
    if (sabotagePeekTimerRef.current) clearTimeout(sabotagePeekTimerRef.current);
    if (sabotageBannerTimerRef.current) clearTimeout(sabotageBannerTimerRef.current);
  }, []);

  // ── Sabotage scheduling — 15% per round, all difficulties ───────
  useEffect(() => {
    if (stage !== "playing" || revealed || finishedRef.current) return;
    if (!round) return;
    if (sabotageRoundFlagRef.current.key !== roundsPlayed) {
      sabotageRoundFlagRef.current = { key: roundsPlayed, triggered: false };
    }
    if (sabotageRoundFlagRef.current.triggered) return;
    if (Math.random() >= V2_SUDDEN_DEATH_SABOTAGE_CHANCE) {
      sabotageRoundFlagRef.current.triggered = true; // burn the roll for this round
      return;
    }

    const type = pickSabotageType();
    const difficulty = round?.difficulty | 0 || 5;
    const delay = V2_SD_SABOTAGE_DELAY_MIN_MS +
                  Math.random() * (V2_SD_SABOTAGE_DELAY_MAX_MS - V2_SD_SABOTAGE_DELAY_MIN_MS);

    sabotageScheduleRef.current = setTimeout(() => {
      sabotageRoundFlagRef.current.triggered = true;
      captureEvent("v2_sabotage_triggered", {
        phase: "SUDDEN_DEATH", type, streak, difficulty,
      });

      const dur = SABOTAGE_TYPES[type]?.durationMs || 1500;

      if (type === "TIME_THIEF") {
        setActiveSabotage({ type });
        setSabotageBanner({ text: "⚡ AXIOM STOLE YOUR TIME", key: Date.now() });
        setTimeLeft(t => Math.max(3, t - V2_SD_SABOTAGE_TIMER_CUT_S));
        sabotageEndTimerRef.current = setTimeout(() => setActiveSabotage(null), 800);
      } else if (type === "REALITY_GLITCH") {
        setActiveSabotage({ type });
        setSabotageBanner({ text: "🌀 GLITCH IN THE MATRIX", key: Date.now() });
        sabotageEndTimerRef.current = setTimeout(() => setActiveSabotage(null), dur);
      } else if (type === "PEEK_AND_HIDE") {
        const truthIdxs = (round?.statements || [])
          .map((s, i) => (s?.real ? i : -1))
          .filter(i => i >= 0);
        if (truthIdxs.length === 0) return;
        const peekIdx = truthIdxs[Math.floor(Math.random() * truthIdxs.length)];
        setActiveSabotage({ type, peekIdx });
        setSabotageBanner({ text: "👁 AXIOM SHOWED YOU SOMETHING. TOO LATE.", key: Date.now() });
        sabotagePeekTimerRef.current = setTimeout(() => {
          setActiveSabotage(prev => (prev && prev.type === "PEEK_AND_HIDE") ? { ...prev, peekIdx: -1 } : prev);
        }, 1000);
      }

      sabotageBannerTimerRef.current = setTimeout(() => setSabotageBanner(null), 1800);
    }, delay);

    return () => {
      if (sabotageScheduleRef.current) clearTimeout(sabotageScheduleRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, revealed, roundsPlayed, round, streak]);

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
      setActiveSabotage(null);
      setSabotageBanner(null);
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

      // AXIOM laughs after every correct, with intensity escalation at
      // streak >= 5 to "worried" — its tone shifts from smug to anxious.
      setLaughIntensity(newStreak >= 5 ? "worried" : "default");
      setShowAxiomLaugh(true);

      advanceTimerRef.current = setTimeout(() => fetchNextRound(), REVEAL_HOLD_CORRECT_MS);
    } else {
      vibrate([30, 60, 30, 60, 80]);
      const canContinue = swear >= CONTINUE_COST;

      // FATAL miss: full crimson PitFall + high-intensity MOCK overlay,
      // then advance to the continue offer or dead screen. PitFall is 3s,
      // we add 1s buffer for the impact frame to settle.
      captureEvent("v2_sudden_death_pitfall", {
        finalStreak: streak, bankedScore: accumScore, bankedSwear: accumSwear,
      });
      setShowPitFall(true);
      setShowAxiomMock(true);

      advanceTimerRef.current = setTimeout(() => {
        setShowPitFall(false);
        setShowAxiomMock(false);
        if (canContinue) setStage("continue_offer");
        else { setStage("dead"); endPhase("died"); }
      }, REVEAL_HOLD_WRONG_MS);
    }
  }, [revealed, round, selectedIdx, streak, swear, accumScore, accumSwear, addScore, addSwear]);

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

      <div style={{
        ...list(),
        animation: !revealed && activeSabotage?.type === "REALITY_GLITCH"
          ? "sabotage-glitch 1.5s linear" : "none",
      }}>
        {(round.statements || []).map((s, idx) => {
          const isSel = selectedIdx === idx;
          const isCorrectAnswer = revealed && idx === correctIdx;
          const isWrongPick     = revealed && isSel && idx !== correctIdx;
          const isPeeked   = !revealed && activeSabotage?.type === "PEEK_AND_HIDE" && activeSabotage.peekIdx === idx;
          const isGlitching = !revealed && activeSabotage?.type === "REALITY_GLITCH";

          let border = `1.5px solid ${T.gb}`;
          let bg     = T.glass;
          let color  = "#e8e6e1";
          if (isCorrectAnswer) { border = `1.5px solid ${T.bad}`; bg = "rgba(244,63,94,.10)"; color = T.bad; }
          else if (isWrongPick) { border = `1.5px solid ${T.dim}`; bg = "rgba(255,255,255,.02)"; color = T.dim; }
          else if (isPeeked)   { border = `1.5px solid ${T.ok}`; bg = "rgba(45,212,160,.08)"; }
          else if (isSel)       { border = `1.5px solid ${T.gold}`; bg = "rgba(232,197,71,.08)"; }
          const renderText = isGlitching ? scrambleText(s.text) : s.text;

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
                animation: isPeeked ? "peek-glow 1s ease" : "none",
              }}
            >
              {isCorrectAnswer && <span style={{ color: T.bad, fontWeight: 800, marginRight: 8 }}>✗ LIE</span>}
              {renderText}
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

      {/* ── Drama overlays ─────────────────────────────────────── */}
      {activeSabotage?.type === "TIME_THIEF" && (
        <div aria-hidden="true" style={{
          position: "fixed", inset: 0, zIndex: 55, pointerEvents: "none",
          background: "radial-gradient(ellipse at 50% 0%, rgba(220,30,40,0.65) 0%, rgba(220,30,40,0.0) 60%)",
          animation: "sabotage-flash 700ms ease-out",
          mixBlendMode: "screen",
        }} />
      )}
      {sabotageBanner && (
        <div aria-hidden="true" key={sabotageBanner.key} style={crimsonBannerStyle()}>
          {sabotageBanner.text}
        </div>
      )}
      {showPitFall && (
        <PitFall
          fellToRound={null}
          colorPalette="crimson"
          finalDeath={true}
          onComplete={() => setShowPitFall(false)}
        />
      )}
      {showAxiomMock && (
        <AxiomReaction
          type="MOCK"
          intensity="high"
          playVoice={false}                                  /* PitFall owns voice */
          onComplete={() => setShowAxiomMock(false)}
        />
      )}
      {showAxiomLaugh && (
        <AxiomReaction
          type="LAUGH"
          intensity={laughIntensity}
          playVoice={true}
          onComplete={() => setShowAxiomLaugh(false)}
        />
      )}
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
function crimsonBannerStyle() {
  return {
    position: "fixed", top: 78, left: "50%", zIndex: 56,
    transform: "translateX(-50%)",
    background: "rgba(220,20,30,0.95)",
    border: "2px solid #ff3344",
    color: "#ffeeee",
    padding: "10px 18px",
    borderRadius: 12,
    fontSize: 12.5,
    fontWeight: 800,
    letterSpacing: "1.5px",
    textTransform: "uppercase",
    fontFamily: "'Segoe UI',system-ui,sans-serif",
    boxShadow: "0 0 40px rgba(220,20,30,0.5), 0 8px 24px rgba(220,20,30,0.4)",
    backdropFilter: "blur(6px)",
    textShadow: "0 0 10px rgba(255,100,100,0.5)",
    animation: "sabotage-banner 1800ms ease forwards",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  };
}

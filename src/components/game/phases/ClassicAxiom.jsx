import { useCallback, useEffect, useRef, useState } from "react";
import { useActiveEffects, useGameActions } from "../GameContext.jsx";
import { authFetch, vibrate } from "../api.js";
import { captureEvent } from "../../../lib/telemetry.js";
import { pickSabotageType, scrambleText, SABOTAGE_TYPES } from "../../../lib/sabotage.js";
import { startCommunityPulse } from "../../../lib/communityPulse.js";
import { PitFall } from "../../PitFall.jsx";
import { AxiomReaction } from "../../AxiomReaction.jsx";
import { CommunityToast } from "../../CommunityToast.jsx";

// V2 ClassicAxiom — 3 rounds of "find the lie among 5 statements".
//   15s per round, lock-in or auto-reveal at 0s.
//   100 points + 5 SWEAR per correct call.
//
// Step 4 (drama):
//   - Sabotage on rounds 2-3, 5% chance, no difficulty floor (V2 difficulty
//     is naturally lower than legacy Climb's diff-4+ ramp).
//   - PitFall + AxiomReaction MOCK on wrong; AxiomReaction LAUGH on correct
//     (rounds 2-3 only, round 1 is the warm-up).
//   - CommunityToast polling for the duration of the phase.

const ROUND_COUNT      = 3;
const SECONDS_PER_ROUND = 15;
const REVEAL_HOLD_CORRECT_MS = 2500;
const REVEAL_HOLD_WRONG_MS   = 4000; // PitFall is 3s + 1s buffer

// V2 sabotage rules — replaces shouldTriggerSabotage() (legacy gating
// requires difficulty >= 4, but V2 Classic uses difficulty 2-3).
const V2_CLASSIC_SABOTAGE_CHANCE = 0.05;
const V2_SABOTAGE_DELAY_MIN_MS   = 5000;
const V2_SABOTAGE_DELAY_MAX_MS   = 10000;
const V2_SABOTAGE_TIMER_CUT_S    = 5;    // out of 15s; legacy was 10/30

const T = {
  bg: "#04060f", gold: "#e8c547",
  ok: "#2dd4a0", bad: "#f43f5e", dim: "#5a5a68",
  glass: "rgba(255,255,255,.03)", gb: "rgba(255,255,255,.07)",
};

export function ClassicAxiom({ lang = "en", userId, onComplete, onAbort }) {
  const { addScore, addSwear, consumeEffect } = useGameActions();
  const activeEffects = useActiveEffects();
  // Snapshot effects on mount so consumption doesn't affect this phase mid-run.
  const pointsMultRef = useRef(1);
  const shieldActiveRef = useRef(false);

  const [rounds, setRounds]               = useState([]);
  const [currentRound, setCurrentRound]   = useState(0);
  const [selectedIdx, setSelectedIdx]     = useState(null);
  const [revealed, setRevealed]           = useState(false);
  const [timeLeft, setTimeLeft]           = useState(SECONDS_PER_ROUND);
  const [stats, setStats]                 = useState({ correct: 0, total: 0 });
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);

  // Drama state.
  const [activeSabotage, setActiveSabotage] = useState(null); // { type, peekIdx? }
  const [sabotageBanner, setSabotageBanner] = useState(null); // { text, key }
  const [showPitFall, setShowPitFall]       = useState(false);
  const [showAxiomMock, setShowAxiomMock]   = useState(false);
  const [showAxiomLaugh, setShowAxiomLaugh] = useState(false);
  const [communityToast, setCommunityToast] = useState(null);

  const finishedRef    = useRef(false);
  const completionRef  = useRef({ correct: 0, total: 0 });
  const advanceTimerRef = useRef(null);
  // Sabotage scheduling refs (per-round timer + per-round flag so we don't
  // double-fire if the round re-renders).
  const sabotageScheduleRef = useRef(null);
  const sabotageEndTimerRef = useRef(null);
  const sabotagePeekTimerRef = useRef(null);
  const sabotageBannerTimerRef = useRef(null);
  const sabotageRoundFlagRef = useRef({ round: -1, triggered: false });

  // ── Effect consumption + telemetry on mount ─────────────────
  useEffect(() => {
    const has2x     = activeEffects.some(e => e.type === "POINTS_2X");
    const hasShield = activeEffects.some(e => e.type === "SHIELD");
    if (has2x)     { pointsMultRef.current = 2; consumeEffect("POINTS_2X"); }
    if (hasShield) { shieldActiveRef.current = true; consumeEffect("SHIELD"); }
    captureEvent("v2_phase_started", { phase: "CLASSIC", points2x: has2x, shield: hasShield });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Initial fetch ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/solo-rounds?phase=first` +
                    (userId ? `&userId=${encodeURIComponent(userId)}` : "");
        const r = await authFetch(url);
        if (!r.ok && r.status !== 206) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `solo_${r.status}`);
        }
        const data = await r.json();
        if (cancelled) return;
        if (!Array.isArray(data.rounds) || data.rounds.length === 0) {
          throw new Error("no_rounds");
        }
        // Take rounds[2..5) → difficulty [2,2,3]. Falls back to whatever's
        // available if the API returned a shorter list.
        const sliced = data.rounds.slice(2, 2 + ROUND_COUNT);
        const filled = sliced.length >= ROUND_COUNT
          ? sliced
          : data.rounds.slice(0, ROUND_COUNT);
        setRounds(filled);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "load_failed");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // Keep latest stats in a ref so finish() never loses the last round.
  useEffect(() => { completionRef.current = stats; }, [stats]);

  // ── Per-round 15s timer ─────────────────────────────────────
  useEffect(() => {
    if (loading || error || revealed || finishedRef.current) return;
    if (currentRound >= rounds.length) return;
    if (timeLeft <= 0) {
      // Auto-reveal at timeout. If no selection, treat as wrong (tappedIdx=-1).
      handleReveal();
      return;
    }
    const id = setTimeout(() => setTimeLeft(s => s - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, loading, error, revealed, currentRound, rounds.length]);

  // Reset round-local state when the round index advances.
  useEffect(() => {
    setSelectedIdx(null);
    setRevealed(false);
    setTimeLeft(SECONDS_PER_ROUND);
    setActiveSabotage(null);
    setSabotageBanner(null);
    sabotageRoundFlagRef.current = { round: currentRound, triggered: false };
  }, [currentRound]);

  // ── Community pulse — start once on phase mount, stop on unmount ────
  useEffect(() => {
    const stop = startCommunityPulse((toast) => setCommunityToast(toast), { lang });
    return () => { try { stop?.(); } catch {} };
  }, [lang]);

  // ── Sabotage scheduling — rounds 2-3 only, 5% chance, no diff floor ─
  useEffect(() => {
    if (loading || error || revealed || finishedRef.current) return;
    if (currentRound < 1) return;                                 // round 1 = warm-up
    if (currentRound >= rounds.length) return;
    if (sabotageRoundFlagRef.current.round !== currentRound) return;
    if (sabotageRoundFlagRef.current.triggered) return;
    if (Math.random() >= V2_CLASSIC_SABOTAGE_CHANCE) return;

    const round = rounds[currentRound];
    const difficulty = round?.difficulty | 0 || 3;
    const type = pickSabotageType();
    const delay = V2_SABOTAGE_DELAY_MIN_MS +
                  Math.random() * (V2_SABOTAGE_DELAY_MAX_MS - V2_SABOTAGE_DELAY_MIN_MS);

    sabotageScheduleRef.current = setTimeout(() => {
      sabotageRoundFlagRef.current.triggered = true;
      captureEvent("v2_sabotage_triggered", {
        phase: "CLASSIC", type, round: currentRound + 1, difficulty,
      });

      const dur = SABOTAGE_TYPES[type]?.durationMs || 1500;

      if (type === "TIME_THIEF") {
        setActiveSabotage({ type });
        setSabotageBanner({ text: "⚡ AXIOM STOLE YOUR TIME", key: Date.now() });
        setTimeLeft(t => Math.max(5, t - V2_SABOTAGE_TIMER_CUT_S));
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
  }, [currentRound, revealed, loading, error, rounds.length]);

  // Cleanup any pending timers on unmount.
  useEffect(() => () => {
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    if (sabotageScheduleRef.current) clearTimeout(sabotageScheduleRef.current);
    if (sabotageEndTimerRef.current) clearTimeout(sabotageEndTimerRef.current);
    if (sabotagePeekTimerRef.current) clearTimeout(sabotagePeekTimerRef.current);
    if (sabotageBannerTimerRef.current) clearTimeout(sabotageBannerTimerRef.current);
  }, []);

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    captureEvent("v2_phase_completed", { phase: "CLASSIC", ...completionRef.current });
    onComplete?.({
      ok: true,
      phase: "CLASSIC",
      stats: { ...completionRef.current },
    });
  }

  const handleReveal = useCallback(() => {
    if (revealed || finishedRef.current) return;
    setRevealed(true);

    const round = rounds[currentRound];
    if (!round) return;

    const correctIdx = (round.statements || []).findIndex(s => !s.real);
    const userPicked = selectedIdx;
    const correct    = userPicked !== null && userPicked === correctIdx;

    if (correct) {
      addScore(100 * pointsMultRef.current);
      addSwear(5);
      vibrate(15);
      // LAUGH on rounds 2 and 3 only — round 1 is the warm-up so the
      // first hit shouldn't be needled.
      if (currentRound >= 1) {
        setShowAxiomLaugh(true);
      }
    } else {
      vibrate([20, 50, 20]);
      captureEvent("v2_pitfall_shown", { phase: "CLASSIC", round: currentRound + 1 });
      setShowPitFall(true);
      setShowAxiomMock(true);
    }

    setStats(s => ({
      correct: s.correct + (correct ? 1 : 0),
      total:   s.total + 1,
    }));

    const holdMs = correct ? REVEAL_HOLD_CORRECT_MS : REVEAL_HOLD_WRONG_MS;
    advanceTimerRef.current = setTimeout(() => {
      const next = currentRound + 1;
      if (next >= rounds.length || next >= ROUND_COUNT) {
        finish();
      } else {
        setCurrentRound(next);
      }
    }, holdMs);
  }, [revealed, rounds, currentRound, selectedIdx, addScore, addSwear]);

  // ── Render ──────────────────────────────────────────────────
  if (error) {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠</div>
          <div style={{ color: T.bad, marginBottom: 16 }}>Couldn't load rounds.</div>
          <button onClick={onAbort} style={btnSecondary()}>Back</button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: T.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
            Classic AXIOM
          </div>
          <div style={{ color: T.dim, fontSize: 13 }}>AXIOM is composing…</div>
        </div>
      </div>
    );
  }

  const round = rounds[currentRound];
  if (!round) return null;
  const correctIdx = (round.statements || []).findIndex(s => !s.real);
  // SHIELD only applies to round 1 of this phase. Pick a deterministic
  // wrong option to eliminate (avoid the lie at correctIdx).
  const shieldEliminatedIdx = (shieldActiveRef.current && currentRound === 0)
    ? ((round.statements || []).findIndex((s, i) => i !== correctIdx))
    : -1;

  return (
    <div style={wrap()}>
      <header style={hud()}>
        <button onClick={onAbort} style={hudBtn()}>✕</button>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 12, letterSpacing: 2, color: T.dim }}>
            Round {currentRound + 1}/{ROUND_COUNT}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 800,
            color: timeLeft <= 3 ? T.bad : T.gold, fontFamily: "Georgia, serif",
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
          background: timeLeft <= 3 ? T.bad : T.gold,
          transition: "width 1s linear, background .2s",
        }} />
      </div>

      <div style={prompt()}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: T.gold, opacity: 0.7, textTransform: "uppercase" }}>
          Find the lie
        </div>
        <div style={{ fontSize: 12, color: T.dim, marginTop: 4 }}>
          {round.category} · {"⭐".repeat(Math.max(1, Math.min(5, round.difficulty | 0)))}
        </div>
      </div>

      <div style={{
        ...statementList(),
        animation: !revealed && activeSabotage?.type === "REALITY_GLITCH"
          ? "sabotage-glitch 1.5s linear"
          : "none",
      }}>
        {(round.statements || []).map((s, idx) => {
          const isShielded = idx === shieldEliminatedIdx;
          const isSelected = selectedIdx === idx;
          const isCorrect  = revealed && idx === correctIdx;
          const isWrongPick = revealed && isSelected && idx !== correctIdx;
          const isPeeked   = !revealed && activeSabotage?.type === "PEEK_AND_HIDE" && activeSabotage.peekIdx === idx;
          const isGlitching = !revealed && activeSabotage?.type === "REALITY_GLITCH";

          let border = `1.5px solid ${T.gb}`;
          let bg     = T.glass;
          let color  = "#e8e6e1";
          if (isShielded && !revealed) {
            border = `1.5px dashed rgba(232,197,71,.45)`;
            bg     = "rgba(232,197,71,.04)";
            color  = "rgba(232,230,225,.35)";
          } else if (isCorrect) {
            border = `1.5px solid ${T.bad}`;
            bg     = "rgba(244,63,94,.10)";
            color  = T.bad;
          } else if (isWrongPick) {
            border = `1.5px solid ${T.dim}`;
            bg     = "rgba(255,255,255,.02)";
            color  = T.dim;
          } else if (isPeeked) {
            border = `1.5px solid ${T.ok}`;
            bg     = "rgba(45,212,160,.08)";
          } else if (isSelected) {
            border = `1.5px solid ${T.gold}`;
            bg     = "rgba(232,197,71,.08)";
          }
          const renderText = isGlitching ? scrambleText(s.text) : s.text;

          return (
            <button
              key={idx}
              onClick={() => { if (!revealed && !isShielded) setSelectedIdx(idx); }}
              disabled={revealed || isShielded}
              style={{
                width: "100%", textAlign: "left",
                padding: "14px 16px",
                background: bg, border, borderRadius: 12,
                color, fontFamily: "Georgia, serif",
                fontSize: "clamp(14px, 3.6vw, 16px)", lineHeight: 1.4,
                cursor: revealed || isShielded ? "default" : "pointer",
                transition: "all .15s ease",
                textDecoration: isShielded ? "line-through" : "none",
                animation: isPeeked ? "peek-glow 1s ease" : "none",
              }}
            >
              {isShielded && <span style={{ color: T.gold, fontWeight: 800, marginRight: 8 }}>🛡 ELIM</span>}
              {isCorrect && <span style={{ color: T.bad, fontWeight: 800, marginRight: 8 }}>✗ LIE</span>}
              {renderText}
            </button>
          );
        })}
      </div>

      <div style={{ padding: "10px 16px 18px" }}>
        {!revealed ? (
          <button
            onClick={handleReveal}
            disabled={selectedIdx === null}
            style={btnPrimary(selectedIdx === null)}
          >
            Lock in
          </button>
        ) : (
          <div style={{
            textAlign: "center", padding: 12,
            color: selectedIdx === correctIdx ? T.ok : T.bad,
            fontWeight: 800, letterSpacing: 2, textTransform: "uppercase",
          }}>
            {selectedIdx === correctIdx ? "Correct · +100" : "Missed"}
          </div>
        )}
      </div>

      {/* ── Drama overlays ───────────────────────────────────────── */}
      {activeSabotage?.type === "TIME_THIEF" && (
        <div aria-hidden="true" style={{
          position: "fixed", inset: 0, zIndex: 55, pointerEvents: "none",
          background: "radial-gradient(ellipse at 50% 0%, rgba(244,63,94,0.55) 0%, rgba(244,63,94,0.0) 60%)",
          animation: "sabotage-flash 700ms ease-out",
          mixBlendMode: "screen",
        }} />
      )}
      {sabotageBanner && (
        <div aria-hidden="true" key={sabotageBanner.key} style={sabotageBannerStyle()}>
          {sabotageBanner.text}
        </div>
      )}
      {showPitFall && (
        <PitFall
          fellToRound={currentRound + 1}
          onComplete={() => setShowPitFall(false)}
        />
      )}
      {showAxiomMock && (
        <AxiomReaction
          type="MOCK"
          playVoice={false}                                /* PitFall owns voice */
          onComplete={() => setShowAxiomMock(false)}
        />
      )}
      {showAxiomLaugh && (
        <AxiomReaction
          type="LAUGH"
          playVoice={true}
          onComplete={() => setShowAxiomLaugh(false)}
        />
      )}
      <CommunityToast
        toast={communityToast}
        onDismiss={() => setCommunityToast(null)}
      />
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
function prompt() {
  return { padding: "16px 16px 8px", textAlign: "center" };
}
function statementList() {
  return {
    flex: 1, padding: "8px 16px",
    display: "flex", flexDirection: "column", gap: 8, overflowY: "auto",
  };
}
function btnPrimary(disabled) {
  return {
    width: "100%", minHeight: 52, padding: 14,
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
    width: "100%", minHeight: 48, padding: 12,
    fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
    background: "transparent", color: T.gold, border: `1px solid ${T.gold}`,
    borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
  };
}
function sabotageBannerStyle() {
  return {
    position: "fixed", top: 78, left: "50%", zIndex: 56,
    transform: "translateX(-50%)",
    background: "rgba(20,20,28,0.92)",
    border: "1px solid rgba(244,63,94,0.55)",
    color: "#f43f5e",
    padding: "10px 18px",
    borderRadius: 12,
    fontSize: 12.5,
    fontWeight: 800,
    letterSpacing: "1.5px",
    textTransform: "uppercase",
    fontFamily: "'Segoe UI',system-ui,sans-serif",
    boxShadow: "0 8px 24px rgba(244,63,94,0.25)",
    backdropFilter: "blur(6px)",
    animation: "sabotage-banner 1800ms ease forwards",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  };
}

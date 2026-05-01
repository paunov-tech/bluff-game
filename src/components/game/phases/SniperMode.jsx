import { useCallback, useEffect, useRef, useState } from "react";
import { useGameActions, useActiveEffects } from "../GameContext.jsx";
import { authFetch, vibrate } from "../api.js";
import { captureEvent } from "../../../lib/telemetry.js";

// V2 SniperMode — 3 sentences, tap the wrong word.
//   Each sentence is 10-15 words; one is factually swapped.
//   20 seconds per sentence (TIMER_CUT effect from RED roulette → 15s).
//   Server (/api/sniper-judge) is source of truth for correctness, awards.
//   Client mirrors pointsAwarded / swearAwarded into in-run GameContext.

const TARGET_COUNT       = 3;
const SECONDS_PER_TARGET = 20;
const TIMER_CUT_SECS     = 5;
const REVEAL_HOLD_MS     = 3500;

const T = {
  bg: "#04060f", gold: "#e8c547",
  ok: "#2dd4a0", bad: "#f43f5e", dim: "#5a5a68",
  glass: "rgba(255,255,255,.03)", gb: "rgba(255,255,255,.07)",
};

export function SniperMode({ lang = "en", userId, onComplete, onAbort }) {
  const { addScore, addSwear, consumeEffect } = useGameActions();
  const activeEffects = useActiveEffects();

  const [sentences, setSentences]       = useState([]);
  const [sessionId, setSessionId]       = useState(null);
  const [currentIdx, setCurrentIdx]     = useState(0);
  const [tappedIdx, setTappedIdx]       = useState(null);
  const [revealed, setRevealed]         = useState(false);
  const [revealData, setRevealData]     = useState(null);
  const [timerSeconds, setTimerSeconds] = useState(SECONDS_PER_TARGET);
  const [timeLeft, setTimeLeft]         = useState(SECONDS_PER_TARGET);
  const [stats, setStats]               = useState({ correct: 0, total: 0 });
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const finishedRef = useRef(false);
  const advanceTimerRef = useRef(null);
  const submittingRef = useRef(false);

  // Consume TIMER_CUT once on mount — applies to all 3 sentences.
  useEffect(() => {
    const hasCut = activeEffects.some(e => e.type === "TIMER_CUT");
    if (hasCut) {
      consumeEffect("TIMER_CUT");
      const cut = Math.max(5, SECONDS_PER_TARGET - TIMER_CUT_SECS);
      setTimerSeconds(cut);
      setTimeLeft(cut);
    }
    captureEvent("v2_phase_started", { phase: "SNIPER", timerCut: hasCut });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Initial fetch ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/sniper-batch?count=${TARGET_COUNT}&lang=${encodeURIComponent(lang)}` +
                    (userId ? `&userId=${encodeURIComponent(userId)}` : "");
        const r = await authFetch(url);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `sniper_${r.status}`);
        }
        const data = await r.json();
        if (cancelled) return;
        if (!Array.isArray(data.sentences) || data.sentences.length === 0) {
          throw new Error("empty_batch");
        }
        setSentences(data.sentences.slice(0, TARGET_COUNT));
        setSessionId(data.sessionId);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "load_failed");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [lang, userId]);

  // Reset per-sentence state on advance.
  useEffect(() => {
    setTappedIdx(null);
    setRevealed(false);
    setRevealData(null);
    setTimeLeft(timerSeconds);
    submittingRef.current = false;
  }, [currentIdx, timerSeconds]);

  // Per-sentence countdown.
  useEffect(() => {
    if (loading || error || revealed || finishedRef.current) return;
    if (currentIdx >= sentences.length) return;
    if (timeLeft <= 0) {
      handleTap(-1); // timeout = wrong
      return;
    }
    const id = setTimeout(() => setTimeLeft(s => s - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, loading, error, revealed, currentIdx, sentences.length]);

  useEffect(() => () => { if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current); }, []);

  function finish(finalStats) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    captureEvent("v2_phase_completed", { phase: "SNIPER", ...finalStats });
    onComplete?.({ ok: true, phase: "SNIPER", stats: finalStats });
  }

  const handleTap = useCallback(async (wordIdx) => {
    if (revealed || finishedRef.current || submittingRef.current) return;
    if (currentIdx >= sentences.length) return;
    submittingRef.current = true;
    setTappedIdx(wordIdx);

    let result = null;
    try {
      const r = await authFetch("/api/sniper-judge", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          sentenceId: sentences[currentIdx].id,
          tappedWordIndex: wordIdx,
          userId: userId || undefined,
        }),
      });
      if (r.ok) result = await r.json();
    } catch { /* network — treat as wrong */ }

    if (!result) {
      result = { correct: false, lieWordIndex: -1, lieWord: "?", correctWord: "?", explanation: "Network error.", pointsAwarded: 0, swearAwarded: 0 };
    }

    setRevealData(result);
    setRevealed(true);

    if (result.correct) {
      addScore(result.pointsAwarded | 0);
      addSwear(result.swearAwarded | 0);
      vibrate(15);
    } else {
      vibrate([20, 50, 20]);
    }

    const nextStats = {
      correct: stats.correct + (result.correct ? 1 : 0),
      total:   stats.total + 1,
    };
    setStats(nextStats);

    advanceTimerRef.current = setTimeout(() => {
      const next = currentIdx + 1;
      if (next >= sentences.length || next >= TARGET_COUNT) {
        finish(nextStats);
      } else {
        setCurrentIdx(next);
      }
    }, REVEAL_HOLD_MS);
  }, [revealed, currentIdx, sentences, sessionId, userId, addScore, addSwear, stats]);

  // ── Render ─────────────────────────────────────────────────
  if (error) {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center", maxWidth: 400, margin: "0 auto" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠</div>
          <div style={{ color: T.bad, marginBottom: 16 }}>AXIOM is reloading.</div>
          <div style={{ color: T.dim, fontSize: 12, marginBottom: 16 }}>{error}</div>
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
            Sniper
          </div>
          <div style={{ color: T.dim, fontSize: 13 }}>Loading targets…</div>
        </div>
      </div>
    );
  }

  const sentence = sentences[currentIdx];
  if (!sentence) return null;

  return (
    <div style={wrap()}>
      <header style={hud()}>
        <button onClick={onAbort} style={hudBtn()}>✕</button>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 12, letterSpacing: 2, color: T.dim }}>
            🎯 {currentIdx + 1}/{TARGET_COUNT}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 800,
            color: timeLeft <= 5 ? T.bad : T.gold,
            fontFamily: "Georgia, serif", minWidth: 36, textAlign: "right",
          }}>
            {timeLeft}s
          </span>
        </div>
        <div style={{ width: 32 }} />
      </header>

      <div style={{ height: 3, background: "rgba(255,255,255,.05)" }}>
        <div style={{
          height: "100%", width: `${(timeLeft / timerSeconds) * 100}%`,
          background: timeLeft <= 5 ? T.bad : T.gold,
          transition: "width 1s linear, background .2s",
        }} />
      </div>

      <div style={{ padding: "16px 16px 6px", textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: T.gold, opacity: 0.8, textTransform: "uppercase" }}>
          Tap the lie
        </div>
      </div>

      <div style={sentenceBox()}>
        {(sentence.words || []).map((word, idx) => {
          const isTap   = idx === tappedIdx;
          const isLie   = revealed && idx === revealData?.lieWordIndex;
          const isWrong = revealed && isTap && !revealData?.correct;

          let style = wordChip();
          if (isLie)        style = { ...style, ...wordChipLie() };
          else if (isWrong) style = { ...style, ...wordChipWrong() };
          else if (isTap)   style = { ...style, ...wordChipTap() };

          return (
            <span
              key={idx}
              role="button"
              tabIndex={revealed ? -1 : 0}
              onClick={() => handleTap(idx)}
              style={style}
            >
              {word}
            </span>
          );
        })}
      </div>

      {revealed && revealData && (
        <div style={revealBox()}>
          {revealData.correct ? (
            <div style={{ color: T.ok, fontWeight: 800, fontSize: 14 }}>
              ✓ +{revealData.pointsAwarded} · 🎯 Sniper
            </div>
          ) : (
            <div style={{ color: T.bad, fontWeight: 700, fontSize: 13 }}>
              The lie was “<b>{revealData.lieWord}</b>” — should be “<b>{revealData.correctWord}</b>”.
            </div>
          )}
          {revealData.explanation && (
            <div style={{ color: T.dim, fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
              {revealData.explanation}
            </div>
          )}
        </div>
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
function sentenceBox() {
  return {
    flex: 1, padding: "12px 18px",
    fontFamily: "Georgia, serif",
    fontSize: "clamp(20px, 5.2vw, 26px)",
    lineHeight: 1.55, color: "#f0eee8", textAlign: "center",
    display: "flex", flexWrap: "wrap", justifyContent: "center",
    alignContent: "center",
    gap: 4,
  };
}
function wordChip() {
  return {
    display: "inline-block",
    padding: "3px 6px", margin: 2, borderRadius: 8,
    cursor: "pointer", transition: "all .12s ease",
    border: "1.5px solid transparent",
    userSelect: "none", WebkitUserSelect: "none",
  };
}
function wordChipTap() {
  return { color: T.gold, background: "rgba(232,197,71,.12)", border: `1.5px solid ${T.gold}` };
}
function wordChipLie() {
  return {
    color: T.ok, background: "rgba(45,212,160,.18)",
    border: `1.5px solid ${T.ok}`, fontWeight: 800,
  };
}
function wordChipWrong() {
  return {
    color: T.bad, background: "rgba(244,63,94,.14)",
    border: `1.5px solid ${T.bad}`, textDecoration: "line-through",
  };
}
function revealBox() {
  return {
    padding: "14px 18px 22px", textAlign: "center",
    borderTop: "1px solid rgba(255,255,255,.04)",
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

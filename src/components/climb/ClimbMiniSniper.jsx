import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentIdToken } from "../../auth.js";

// CLIMB Mini-game 2 — Shifter as "find the lie word" sniper.
// Reuses existing /api/sniper-batch + /api/sniper-judge.
// 3 sentences, tap the suspect word. Server is source of truth.
//
// onComplete({ pointsEarned, correct, total })

const TARGET_COUNT = 3;
const SECONDS_PER_TARGET = 20;
const REVEAL_HOLD_MS = 3000;

const T = {
  bg: "#04060f",
  shifter: "#2dd4a0",
  gold: "#e8c547",
  ok: "#2dd4a0",
  bad: "#f43f5e",
  dim: "#5a5a68",
  glass: "rgba(255,255,255,.03)",
  gb: "rgba(255,255,255,.07)",
};

async function authFetch(url, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  try {
    const token = await getCurrentIdToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  } catch { /* anon */ }
  return fetch(url, { ...init, headers });
}

export function ClimbMiniSniper({ lang = "en", userId, onComplete }) {
  const [sentences, setSentences] = useState([]);
  const [sessionId, setSessionId] = useState(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [tappedIdx, setTappedIdx] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [revealData, setRevealData] = useState(null);
  const [timeLeft, setTimeLeft] = useState(SECONDS_PER_TARGET);
  const [stats, setStats] = useState({ correct: 0, total: 0, pointsEarned: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const finishedRef = useRef(false);
  const advanceTimerRef = useRef(null);
  const submittingRef = useRef(false);

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
    setTimeLeft(SECONDS_PER_TARGET);
    submittingRef.current = false;
  }, [currentIdx]);

  // Per-sentence countdown.
  useEffect(() => {
    if (loading || error || revealed || finishedRef.current) return;
    if (currentIdx >= sentences.length) return;
    if (timeLeft <= 0) {
      handleTap(-1);
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
    onComplete?.({
      pointsEarned: finalStats.pointsEarned,
      correct: finalStats.correct,
      total: finalStats.total,
    });
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
    } catch { /* network — wrong */ }

    if (!result) {
      result = { correct: false, lieWordIndex: -1, lieWord: "?", correctWord: "?", explanation: "Network error.", pointsAwarded: 0 };
    }

    setRevealData(result);
    setRevealed(true);
    if (navigator.vibrate) try { navigator.vibrate(result.correct ? 15 : [20, 50, 20]); } catch {}

    const nextStats = {
      correct: stats.correct + (result.correct ? 1 : 0),
      total: stats.total + 1,
      pointsEarned: stats.pointsEarned + (result.pointsAwarded | 0),
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
  }, [revealed, currentIdx, sentences, sessionId, userId, stats]);

  // ── Render ─────────────────────────────────────────────────
  if (error) {
    // Skip the mini-game on load failure rather than blocking the run.
    if (!finishedRef.current) {
      finishedRef.current = true;
      onComplete?.({ pointsEarned: 0, correct: 0, total: 0, skipped: true, error });
    }
    return null;
  }

  if (loading) {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: T.shifter, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
            Shifter
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
        <span style={{ fontSize: 11, letterSpacing: 3, color: T.shifter, fontWeight: 700, textTransform: "uppercase" }}>
          Shifter · {currentIdx + 1}/{TARGET_COUNT}
        </span>
        <span style={{
          fontSize: 13, fontWeight: 800, fontFamily: "Georgia, serif",
          color: timeLeft <= 5 ? T.bad : T.gold, minWidth: 40, textAlign: "right",
        }}>{timeLeft}s</span>
      </header>

      <div style={{ height: 3, background: "rgba(255,255,255,.05)" }}>
        <div style={{
          height: "100%", width: `${(timeLeft / SECONDS_PER_TARGET) * 100}%`,
          background: timeLeft <= 5 ? T.bad : T.gold,
          transition: "width 1s linear, background .2s",
        }} />
      </div>

      <div style={{ padding: "14px 16px 6px", textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: T.shifter, opacity: 0.85, textTransform: "uppercase" }}>
          Tap the lie word
        </div>
      </div>

      <div style={sentenceBox()}>
        {(sentence.words || []).map((word, idx) => {
          const isTap = idx === tappedIdx;
          const isLie = revealed && idx === revealData?.lieWordIndex;
          const isWrong = revealed && isTap && !revealData?.correct;

          let style = wordChip();
          if (isLie) style = { ...style, ...wordChipLie() };
          else if (isWrong) style = { ...style, ...wordChipWrong() };
          else if (isTap) style = { ...style, ...wordChipTap() };

          return (
            <span
              key={idx}
              role="button"
              tabIndex={revealed ? -1 : 0}
              onClick={() => handleTap(idx)}
              style={style}
            >{word}</span>
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
    background: `radial-gradient(ellipse at 50% 0%, rgba(45,212,160,.06) 0%, ${T.bg} 55%)`,
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
function sentenceBox() {
  return {
    margin: "16px",
    padding: "20px 16px",
    background: "linear-gradient(135deg, #232336, #14141f)",
    border: "1px solid rgba(45,212,160,.18)",
    borderRadius: 18,
    boxShadow: "0 10px 40px rgba(0,0,0,.45)",
    display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center",
    fontSize: "clamp(16px, 4.4vw, 20px)", lineHeight: 1.55,
    fontFamily: "Georgia, serif", color: "#f0eee8",
  };
}
function wordChip() {
  return {
    padding: "6px 10px",
    borderRadius: 8,
    background: "rgba(255,255,255,.04)",
    border: "1px solid rgba(255,255,255,.06)",
    cursor: "pointer",
    transition: "background .15s, border-color .15s",
    userSelect: "none",
  };
}
function wordChipTap() {
  return {
    background: "rgba(232,197,71,.18)",
    border: "1px solid rgba(232,197,71,.6)",
    color: T.gold,
  };
}
function wordChipLie() {
  return {
    background: "rgba(244,63,94,.20)",
    border: "1px solid rgba(244,63,94,.7)",
    color: T.bad,
  };
}
function wordChipWrong() {
  return {
    background: "rgba(244,63,94,.06)",
    border: "1px dashed rgba(244,63,94,.4)",
  };
}
function revealBox() {
  return {
    margin: "0 16px 16px",
    padding: "14px 16px",
    background: T.glass,
    border: `1px solid ${T.gb}`,
    borderRadius: 12,
    textAlign: "center",
  };
}

export default ClimbMiniSniper;

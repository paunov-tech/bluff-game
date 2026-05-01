import { useCallback, useEffect, useRef, useState } from "react";
import { t as translate } from "../../../i18n/index.js";
import { useGameActions } from "../GameContext.jsx";
import { authFetch, vibrate } from "../api.js";

// V2 SwipeMode — warm-up phase.
//   12 cards, 3 seconds per card.
//   Right = TRUE, Left = LIE.
//   Streak multiplier: 1x → 1.5x → 2x → 3x → 5x at 10+.
//   Server (/api/swipe-judge) is the source of truth for correctness, the
//   server-side combo, and SWEAR awarded. We mirror its values into the
//   in-run GameContext display.
//
// Note: this is NOT the same as SwipeWarmup (the daily 60-second gateway).
// That one stays in src/components/SwipeWarmup.jsx.

const TOTAL_CARDS      = 12;
const SECONDS_PER_CARD = 3;
const SWIPE_THRESHOLD  = 90; // px before a drag commits to a swipe

// Exponential streak → score multiplier. Tracks spec PART 2.
function streakMultiplier(streak) {
  if (streak >= 10) return 5;
  if (streak >= 7)  return 3;
  if (streak >= 5)  return 2;
  if (streak >= 3)  return 1.5;
  return 1;
}

const T = {
  bg: "#04060f", gold: "#e8c547",
  ok: "#2dd4a0", bad: "#f43f5e", dim: "#5a5a68",
  glass: "rgba(255,255,255,.03)", gb: "rgba(255,255,255,.07)",
};

export function SwipeMode({ lang = "en", userId, onComplete, onAbort }) {
  const t = (k, params) => translate(k, lang, params);
  const { addScore, addSwear } = useGameActions();

  const [statements, setStatements]   = useState([]);
  const [sessionId, setSessionId]     = useState(null);
  const [currentIdx, setCurrentIdx]   = useState(0);
  const [timeLeft, setTimeLeft]       = useState(SECONDS_PER_CARD);
  const [streak, setStreak]           = useState(0);
  const [bestStreak, setBestStreak]   = useState(0);
  const [stats, setStats]             = useState({ correct: 0, total: 0 });
  const [flashColor, setFlashColor]   = useState(null);
  const [drag, setDrag]               = useState({ x: 0, rotate: 0, dragging: false });
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);

  const cardShownAtRef = useRef(Date.now());
  const dragStartRef   = useRef({ x: 0, y: 0 });
  const animatingRef   = useRef(false);
  const finishedRef    = useRef(false);
  const sessionIdRef   = useRef(null);
  const completionRef  = useRef({ correct: 0, total: 0, bestStreak: 0 });

  // ── Initial batch fetch ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/swipe-batch?count=${TOTAL_CARDS}&lang=${encodeURIComponent(lang)}` +
                    (userId ? `&userId=${encodeURIComponent(userId)}` : "");
        const r = await authFetch(url);
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || `batch_${r.status}`);
        }
        const data = await r.json();
        if (cancelled) return;
        if (!Array.isArray(data.statements) || data.statements.length === 0) {
          throw new Error("empty_batch");
        }
        setStatements(data.statements.slice(0, TOTAL_CARDS));
        setSessionId(data.sessionId);
        sessionIdRef.current = data.sessionId;
        setLoading(false);
        cardShownAtRef.current = Date.now();
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "load_failed");
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [lang, userId]);

  // Keep completionRef synced so finish() captures the latest stats even if
  // the very last swipe and finish() collide in the same render.
  useEffect(() => {
    completionRef.current = { correct: stats.correct, total: stats.total, bestStreak };
  }, [stats.correct, stats.total, bestStreak]);

  // ── Per-card 3s timer ───────────────────────────────────────
  useEffect(() => {
    if (loading || error || finishedRef.current) return;
    if (currentIdx >= statements.length || currentIdx >= TOTAL_CARDS) return;
    if (timeLeft <= 0) {
      // Timeout = local "wrong". Don't hit /api/swipe-judge — it requires a
      // direction. Server dedup is fine; the unswiped statement just won't
      // be marked consumed.
      handleSwipeOutcome({ correct: false, swearAwarded: 0, newCombo: 0, isTimeout: true });
      return;
    }
    const tm = setTimeout(() => setTimeLeft(s => Math.max(0, +(s - 0.1).toFixed(2))), 100);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, loading, error, currentIdx, statements.length]);

  // ── Reset per-card state when the index changes ─────────────
  useEffect(() => {
    setTimeLeft(SECONDS_PER_CARD);
    setDrag({ x: 0, rotate: 0, dragging: false });
    cardShownAtRef.current = Date.now();
  }, [currentIdx]);

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const final = completionRef.current;
    onComplete?.({
      ok: true,
      phase: "SWIPE",
      stats: { correct: final.correct, total: final.total },
      bestStreak: final.bestStreak,
      sessionId: sessionIdRef.current,
    });
  }

  // Apply local effects + advance. Used by both server-judged swipes and
  // local timeouts (which skip the network call).
  const handleSwipeOutcome = useCallback((result) => {
    if (animatingRef.current || finishedRef.current) return;
    animatingRef.current = true;

    setStats(s => ({
      correct: s.correct + (result.correct ? 1 : 0),
      total:   s.total + 1,
    }));

    if (result.correct) {
      const newStreak = result.newCombo | 0;
      setStreak(newStreak);
      setBestStreak(b => Math.max(b, newStreak));
      const mult   = streakMultiplier(newStreak);
      const points = Math.floor(10 * mult);
      addScore(points);
      // Trust the server for SWEAR awarded — bluff_players is already updated.
      addSwear(result.swearAwarded | 0);
      setFlashColor("green");
      vibrate(15);
    } else {
      setStreak(0);
      setFlashColor("red");
      vibrate([20, 50, 20]);
    }

    setTimeout(() => setFlashColor(null), 300);

    setTimeout(() => {
      animatingRef.current = false;
      const next = currentIdx + 1;
      if (next >= TOTAL_CARDS || next >= statements.length) {
        finish();
      } else {
        setCurrentIdx(next);
      }
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, statements.length, addScore, addSwear]);

  // Server-judged swipe — used for real left/right swipes.
  const handleSwipe = useCallback(async (direction) => {
    if (animatingRef.current || finishedRef.current) return;
    if (currentIdx >= statements.length) return;
    const stmt = statements[currentIdx];
    if (!stmt) return;
    animatingRef.current = true;

    // Animate card off-screen.
    const exitX = direction === "right" ? 600 : -600;
    setDrag({ x: exitX, rotate: direction === "right" ? 25 : -25, dragging: false });

    const reactionMs = Date.now() - cardShownAtRef.current;
    let result = { correct: false, swearAwarded: 0, newCombo: 0 };
    try {
      const r = await authFetch("/api/swipe-judge", {
        method: "POST",
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          statementId: stmt.id,
          swipeDirection: direction,
          reactionMs,
          userId: userId || undefined,
        }),
      });
      if (r.ok) result = await r.json();
    } catch { /* network — treat as wrong, no award */ }

    animatingRef.current = false; // handleSwipeOutcome re-locks via animatingRef
    handleSwipeOutcome(result);
  }, [currentIdx, statements, userId, handleSwipeOutcome]);

  // ── Pointer drag handlers ───────────────────────────────────
  function onPointerDown(e) {
    if (animatingRef.current) return;
    const p = pt(e);
    dragStartRef.current = p;
    setDrag(d => ({ ...d, dragging: true }));
  }
  function onPointerMove(e) {
    if (!drag.dragging || animatingRef.current) return;
    const p = pt(e);
    const dx = p.x - dragStartRef.current.x;
    setDrag({ x: dx, rotate: dx * 0.06, dragging: true });
  }
  function onPointerUp() {
    if (!drag.dragging) return;
    if (drag.x > SWIPE_THRESHOLD)        handleSwipe("right");
    else if (drag.x < -SWIPE_THRESHOLD)  handleSwipe("left");
    else setDrag({ x: 0, rotate: 0, dragging: false });
  }
  function pt(e) {
    if (e.touches?.[0])        return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches?.[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX || 0, y: e.clientY || 0 };
  }

  // ── Render ──────────────────────────────────────────────────
  if (error) {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠</div>
          <div style={{ color: T.bad, marginBottom: 16 }}>{t("swipe.load_failed")}</div>
          <button onClick={onAbort} style={btnSecondary()}>{t("swipe.back_home")}</button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: T.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
            Warm-up
          </div>
          <div style={{ color: T.dim, fontSize: 13 }}>{t("swipe.starting")}</div>
        </div>
      </div>
    );
  }

  const stmt = statements[currentIdx];
  const dirHint = drag.x > 30 ? "right" : drag.x < -30 ? "left" : null;
  const flashBg = flashColor === "green" ? "rgba(45,212,160,.16)"
                : flashColor === "red"   ? "rgba(244,63,94,.18)"
                : "transparent";

  return (
    <div style={{ ...wrap(), background: `${flashBg}, ${wrap().background}`, transition: "background .25s" }}>
      {/* HUD */}
      <header style={hud()}>
        <button onClick={onAbort} style={hudBtn()}>✕</button>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 12, letterSpacing: 2, color: T.dim }}>
            {currentIdx + 1}/{TOTAL_CARDS}
          </span>
          <span style={{ fontSize: 13, fontWeight: 800, color: timeLeft < 1 ? T.bad : T.gold, fontFamily: "Georgia, serif" }}>
            {timeLeft.toFixed(1)}s
          </span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: streak >= 3 ? T.gold : T.dim, minWidth: 56, textAlign: "right" }}>
          {streak > 0 ? `🔥 ${streak}` : "—"}
        </div>
      </header>

      {/* Timer bar */}
      <div style={{ height: 3, background: "rgba(255,255,255,.05)" }}>
        <div style={{
          height: "100%", width: `${(timeLeft / SECONDS_PER_CARD) * 100}%`,
          background: timeLeft < 1 ? T.bad : T.gold,
          transition: "width .1s linear, background .2s",
        }} />
      </div>

      {/* Card stack — only the current card is interactive. */}
      <div style={cardArea()}>
        {stmt && (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              position: "relative", width: "min(360px, 92vw)", height: "min(460px, 60vh)",
              transform: `translateX(${drag.x}px) rotate(${drag.rotate}deg)`,
              transition: drag.dragging ? "none" : "transform .35s ease",
              touchAction: "pan-y",
            }}
          >
            <Card stmt={stmt} dirHint={dirHint} />
          </div>
        )}
        {streak >= 3 && (
          <div style={streakBadge()}>×{streakMultiplier(streak)}</div>
        )}
      </div>

      {/* Tap fallback (and useful on desktop). */}
      <div style={{
        display: "flex", gap: 12, width: "100%", maxWidth: 360,
        padding: "0 6px", boxSizing: "border-box", margin: "10px 0 18px",
      }}>
        <button onClick={() => handleSwipe("left")} style={btnLie()}>✗ {t("swipe.lie")}</button>
        <button onClick={() => handleSwipe("right")} style={btnTrue()}>✓ {t("swipe.true")}</button>
      </div>
    </div>
  );
}

function Card({ stmt, dirHint }) {
  const borderColor = dirHint === "right" ? "rgba(45,212,160,0.7)"
                    : dirHint === "left"  ? "rgba(244,63,94,0.7)"
                    : "rgba(255,255,255,0.1)";
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "linear-gradient(135deg, #232336, #14141f)",
      border: `2px solid ${borderColor}`, borderRadius: 18, padding: 20,
      boxShadow: "0 20px 50px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)",
      display: "flex", flexDirection: "column", justifyContent: "space-between",
      cursor: "grab", userSelect: "none", WebkitUserSelect: "none",
    }}>
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "clamp(17px, 4.6vw, 22px)", lineHeight: 1.42,
        color: "#f0eee8", fontFamily: "Georgia, serif", textAlign: "center",
      }}>
        {stmt.text}
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        fontSize: 10, letterSpacing: 1.5, color: "rgba(232,230,225,.4)",
        textTransform: "uppercase", fontWeight: 600,
      }}>
        <span>{stmt.category}</span>
        <span>{"⭐".repeat(Math.max(1, Math.min(5, stmt.difficulty | 0)))}</span>
      </div>
    </div>
  );
}

function wrap() {
  return {
    minHeight: "100dvh",
    background: `radial-gradient(ellipse at 50% 0%, rgba(232,197,71,.06) 0%, ${T.bg} 55%)`,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: "#e8e6e1",
    display: "flex", flexDirection: "column", alignItems: "stretch",
    paddingBottom: "max(20px, env(safe-area-inset-bottom))",
    overflow: "hidden",
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
function cardArea() {
  return {
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
    padding: "20px 16px", position: "relative",
  };
}
function streakBadge() {
  return {
    position: "absolute", top: 18, right: 18,
    fontSize: 14, fontWeight: 800, color: T.gold,
    background: "rgba(232,197,71,.12)", border: `1px solid ${T.gold}`,
    padding: "6px 10px", borderRadius: 999, fontFamily: "Georgia, serif",
  };
}
function btnLie() {
  return {
    flex: 1, minHeight: 56, fontSize: 14, fontWeight: 800, letterSpacing: 2,
    textTransform: "uppercase",
    background: "rgba(244,63,94,0.08)", color: T.bad, border: `1.5px solid ${T.bad}`,
    borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
  };
}
function btnTrue() {
  return {
    flex: 1, minHeight: 56, fontSize: 14, fontWeight: 800, letterSpacing: 2,
    textTransform: "uppercase",
    background: "rgba(45,212,160,0.08)", color: T.ok, border: `1.5px solid ${T.ok}`,
    borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
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

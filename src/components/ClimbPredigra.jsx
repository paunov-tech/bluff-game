import { useCallback, useEffect, useRef, useState } from "react";
import { t as translate } from "../i18n/index.js";
import { getCurrentIdToken } from "../auth.js";
import { captureEvent } from "../lib/telemetry.js";

// ClimbPredigra — 30-second swipe warm-up that runs immediately before Climb.
//
//   10 cards × 3s/card. Right = TRUE, left = LIE.
//   Per-card timeout: skip — no judge call, no stats change. Spec: "ne računaju se".
//   Streak counter: consecutive correct, resets to 0 on wrong.
//   Final streak carries into Climb (Climb's streak state seeded with this value).
//
// API: reuses /api/swipe-batch + /api/swipe-judge (same infra as SwipeWarmup).
// SWEAR is auto-credited by /api/swipe-judge per correct swipe — that's a
// pre-existing side-effect of the judge endpoint, not new behavior here.
//
// Mandatory step (no Skip-to-Climb button), but a small ✕ in the corner
// returns to home as a cancel-the-run escape hatch.

const TOTAL_CARDS      = 10;
const SECONDS_PER_CARD = 3;
const SWIPE_THRESHOLD  = 90;          // px before a drag commits to a swipe
const COMPLETE_AUTO_ADVANCE_MS = 5000; // auto-advance from complete screen if user is idle

const T = {
  bg: "#04060f", card: "#0f0f1a", gold: "#e8c547",
  ok: "#2dd4a0", bad: "#f43f5e", dim: "#5a5a68",
  glass: "rgba(255,255,255,.03)", gb: "rgba(255,255,255,.07)",
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

function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
}

export function ClimbPredigra({ lang = "en", userId, onComplete, onAbort }) {
  const t = (k, params) => translate(k, lang, params);

  const [statements, setStatements]   = useState([]);
  const [currentIdx, setCurrentIdx]   = useState(0);
  const [timeLeft, setTimeLeft]       = useState(SECONDS_PER_CARD);
  const [streak, setStreak]           = useState(0);
  const [bestStreak, setBestStreak]   = useState(0);
  const [stats, setStats]             = useState({ correct: 0, total: 0 });
  const [flashColor, setFlashColor]   = useState(null);
  const [drag, setDrag]               = useState({ x: 0, rotate: 0, dragging: false });
  const [phase, setPhase]             = useState("loading"); // "loading" | "playing" | "complete" | "error"
  const [error, setError]             = useState(null);

  const cardShownAtRef = useRef(Date.now());
  const dragStartRef   = useRef({ x: 0, y: 0 });
  const animatingRef   = useRef(false);
  const sessionIdRef   = useRef(null);
  const startedAtRef   = useRef(Date.now());
  const completionRef  = useRef({ correct: 0, total: 0, streak: 0, bestStreak: 0 });
  const completeAdvanceRef = useRef(null);

  // Keep the latest stats mirrored into a ref so finish() captures them
  // even if the last swipe and the finish-trigger interleave.
  useEffect(() => {
    completionRef.current = { correct: stats.correct, total: stats.total, streak, bestStreak };
  }, [stats.correct, stats.total, streak, bestStreak]);

  // ── Initial batch fetch ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    captureEvent("predigra_started", { userId: userId || null });
    startedAtRef.current = Date.now();
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
        sessionIdRef.current = data.sessionId;
        setPhase("playing");
        cardShownAtRef.current = Date.now();
      } catch (e) {
        if (!cancelled) {
          setError(e.message || "load_failed");
          setPhase("error");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [lang, userId]);

  // ── Per-card 3s timer ──────────────────────────────────────
  useEffect(() => {
    if (phase !== "playing") return;
    if (currentIdx >= TOTAL_CARDS || currentIdx >= statements.length) return;
    if (timeLeft <= 0) {
      // Skip the card — don't count, don't reset streak, don't hit judge.
      advanceCard();
      return;
    }
    const id = setTimeout(() => setTimeLeft(s => Math.max(0, +(s - 0.1).toFixed(2))), 100);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, phase, currentIdx, statements.length]);

  // ── Reset per-card state when index changes ────────────────
  useEffect(() => {
    setTimeLeft(SECONDS_PER_CARD);
    setDrag({ x: 0, rotate: 0, dragging: false });
    cardShownAtRef.current = Date.now();
  }, [currentIdx]);

  // ── Auto-advance off the complete screen if user is idle ───
  useEffect(() => {
    if (phase !== "complete") return;
    completeAdvanceRef.current = setTimeout(() => proceedToClimb(), COMPLETE_AUTO_ADVANCE_MS);
    return () => { if (completeAdvanceRef.current) clearTimeout(completeAdvanceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function advanceCard() {
    setTimeout(() => {
      animatingRef.current = false;
      setFlashColor(null);
      const next = currentIdx + 1;
      if (next >= TOTAL_CARDS || next >= statements.length) {
        finishPredigra();
      } else {
        setCurrentIdx(next);
      }
    }, 300);
  }

  function finishPredigra() {
    if (phase === "complete") return;
    const final = completionRef.current;
    captureEvent("predigra_completed", {
      correct:    final.correct,
      total:      final.total,
      finalStreak: final.streak,
      bestStreak: final.bestStreak,
      durationMs: Date.now() - startedAtRef.current,
    });
    setPhase("complete");
  }

  function proceedToClimb() {
    const final = completionRef.current;
    if (completeAdvanceRef.current) clearTimeout(completeAdvanceRef.current);
    captureEvent("predigra_to_climb_streak_carried", { initialClimbStreak: final.streak });
    onComplete?.({
      initialStreak: final.streak,
      correct:       final.correct,
      total:         final.total,
      bestStreak:    final.bestStreak,
    });
  }

  // Server-judged swipe.
  const handleSwipe = useCallback(async (direction) => {
    if (animatingRef.current) return;
    if (currentIdx >= statements.length) return;
    const stmt = statements[currentIdx];
    if (!stmt) return;
    animatingRef.current = true;

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

    captureEvent("predigra_card_resolved", {
      correct:    !!result.correct,
      reactionMs,
      cardIdx:    currentIdx,
    });

    setStats(s => ({
      correct: s.correct + (result.correct ? 1 : 0),
      total:   s.total + 1,
    }));

    if (result.correct) {
      setStreak(prev => {
        const next = prev + 1;
        setBestStreak(b => Math.max(b, next));
        return next;
      });
      setFlashColor("green");
      vibrate(15);
    } else {
      setStreak(0);
      setFlashColor("red");
      vibrate([20, 50, 20]);
    }

    advanceCard();
  }, [currentIdx, statements, userId]);

  // ── Pointer drag handlers ──────────────────────────────────
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

  // ── Render ─────────────────────────────────────────────────
  if (phase === "error") {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center", maxWidth: 400, margin: "0 auto" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠</div>
          <div style={{ color: T.bad, marginBottom: 16 }}>{t("predigra.load_failed")}</div>
          <div style={{ color: T.dim, fontSize: 12, marginBottom: 18 }}>{error}</div>
          <button onClick={onAbort} style={btnSecondary()}>{t("predigra.back_home")}</button>
        </div>
      </div>
    );
  }

  if (phase === "loading") {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: T.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
            {t("predigra.title")}
          </div>
          <div style={{ color: T.dim, fontSize: 13 }}>{t("predigra.loading")}</div>
        </div>
      </div>
    );
  }

  if (phase === "complete") {
    const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
    return (
      <div style={wrap()}>
        <div style={{
          padding: 24, textAlign: "center", maxWidth: 380, margin: "0 auto",
          animation: "g-fadeUp .4s both",
        }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: T.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>
            {t("predigra.complete")}
          </div>
          <div style={{ fontSize: 48, marginBottom: 4 }}>⚡</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "16px 0" }}>
            <Stat value={`${stats.correct}/${stats.total}`} label={t("predigra.correct_label")} color={T.ok} />
            <Stat value={`${streak}`} label={t("predigra.streak_label")} color={T.gold} />
          </div>
          <div style={{ fontSize: 13, color: T.dim, marginBottom: 18, fontFamily: "Georgia, serif" }}>
            {t("predigra.streak_carries", { n: streak })}
          </div>
          <button onClick={proceedToClimb} style={btnPrimary()}>
            {t("predigra.start_climb")}
          </button>
          <div style={{ fontSize: 10, color: T.dim, letterSpacing: 1.5, textTransform: "uppercase", marginTop: 10 }}>
            {accuracy}% accuracy
          </div>
        </div>
      </div>
    );
  }

  // Playing.
  const stmt = statements[currentIdx];
  const dirHint = drag.x > 30 ? "right" : drag.x < -30 ? "left" : null;
  const flashBg = flashColor === "green" ? "rgba(45,212,160,.16)"
                : flashColor === "red"   ? "rgba(244,63,94,.18)"
                : "transparent";

  return (
    <div style={{ ...wrap(), background: `${flashBg}, ${wrap().background}`, transition: "background .25s" }}>
      <header style={hud()}>
        {/* Cancel-the-run escape hatch (NOT a skip-to-Climb). */}
        <button onClick={onAbort} style={hudBtn()} aria-label={t("predigra.back_home")}>✕</button>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 12, letterSpacing: 2, color: T.dim }}>
            {currentIdx + 1}/{TOTAL_CARDS}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 800,
            color: timeLeft < 1 ? T.bad : T.gold,
            fontFamily: "Georgia, serif",
          }}>
            {timeLeft.toFixed(1)}s
          </span>
        </div>
        <div style={{
          fontSize: 12, fontWeight: 700, minWidth: 56, textAlign: "right",
          color: streak >= 3 ? T.gold : T.dim,
        }}>
          {streak > 0 ? `🔥 ${streak}` : "—"}
        </div>
      </header>

      {/* Per-card timer bar. */}
      <div style={{ height: 3, background: "rgba(255,255,255,.05)" }}>
        <div style={{
          height: "100%", width: `${(timeLeft / SECONDS_PER_CARD) * 100}%`,
          background: timeLeft < 1 ? T.bad : T.gold,
          transition: "width .1s linear, background .2s",
        }} />
      </div>

      {/* Subtitle */}
      <div style={{ padding: "12px 16px 4px", textAlign: "center" }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: T.gold, opacity: 0.75, textTransform: "uppercase" }}>
          {t("predigra.title")}
        </div>
        <div style={{ fontSize: 11, color: T.dim, marginTop: 4 }}>
          {t("predigra.subtitle")}
        </div>
      </div>

      {/* Card */}
      <div style={cardArea()}>
        {stmt && (
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{
              position: "relative", width: "min(360px, 92vw)", height: "min(420px, 56vh)",
              transform: `translateX(${drag.x}px) rotate(${drag.rotate}deg)`,
              transition: drag.dragging ? "none" : "transform .35s ease",
              touchAction: "pan-y",
            }}
          >
            <Card stmt={stmt} dirHint={dirHint} />
          </div>
        )}
      </div>

      {/* Tap fallback. */}
      <div style={{
        display: "flex", gap: 12, width: "100%", maxWidth: 360,
        padding: "0 12px", boxSizing: "border-box", margin: "10px auto 18px",
      }}>
        <button onClick={() => handleSwipe("left")}  style={btnLie()}>✗ {t("predigra.lie")}</button>
        <button onClick={() => handleSwipe("right")} style={btnTrue()}>✓ {t("predigra.true")}</button>
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

function Stat({ value, label, color }) {
  return (
    <div style={{
      background: T.glass, border: `1px solid ${T.gb}`, borderRadius: 10, padding: "10px 6px",
    }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "Georgia, serif" }}>{value}</div>
      <div style={{ fontSize: 9, color: T.dim, letterSpacing: 1.4, textTransform: "uppercase", marginTop: 2 }}>{label}</div>
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
    padding: "16px 16px 0", position: "relative",
  };
}
function btnPrimary() {
  return {
    width: "100%", minHeight: 52, padding: 14,
    fontSize: 13, fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase",
    background: "linear-gradient(135deg,#e8c547,#d4a830)",
    color: T.bg, border: "none", borderRadius: 14,
    cursor: "pointer", fontFamily: "inherit",
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

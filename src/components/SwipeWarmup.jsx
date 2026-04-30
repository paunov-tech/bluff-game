import { useEffect, useRef, useState, useCallback } from "react";
import { t as translate } from "../i18n/index.js";
import { getCurrentIdToken } from "../auth.js";

// BLUFF Swipe — 60-second warm-up.
// Tinder-style card stack: swipe RIGHT = TRUE, LEFT = LIE.
// One statement per card; reaction time and combo drive bonus SWEAR.
//
// Owns its own session — fetches a batch, judges each swipe through the
// server (so isTrue is never revealed pre-swipe), and calls onComplete with
// the final stats so App.jsx can post the streak update + share card.

const T = {
  bg: "#04060f", card: "#0f0f1a", gold: "#e8c547",
  ok: "#2dd4a0", bad: "#f43f5e", dim: "#5a5a68",
  glass: "rgba(255,255,255,.03)", gb: "rgba(255,255,255,.07)",
};

const SESSION_SECONDS = 60;
const BATCH_COUNT     = 25;
const SWIPE_THRESHOLD = 90; // px

async function authFetch(url, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  try {
    const token = await getCurrentIdToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  } catch { /* anon */ }
  return fetch(url, { ...init, headers });
}

export function SwipeWarmup({ lang = "en", userId, onExit, onComplete }) {
  const t = (k, params) => translate(k, lang, params);

  const [statements, setStatements]   = useState([]);
  const [sessionId, setSessionId]     = useState(null);
  const [currentIdx, setCurrentIdx]   = useState(0);
  const [timeLeft, setTimeLeft]       = useState(SESSION_SECONDS);
  const [combo, setCombo]             = useState(0);
  const [bestCombo, setBestCombo]     = useState(0);
  const [totalCorrect, setTotalCorrect] = useState(0);
  const [totalSwiped, setTotalSwiped]   = useState(0);
  const [swearEarned, setSwearEarned]   = useState(0);
  const [feedback, setFeedback]       = useState(null);
  const [drag, setDrag]               = useState({ x: 0, y: 0, rotate: 0, dragging: false });
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [done, setDone]               = useState(false);

  const cardShownAtRef = useRef(Date.now());
  const dragStartRef   = useRef({ x: 0, y: 0 });
  const animatingRef   = useRef(false);
  const finishedRef    = useRef(false);
  const sessionIdRef   = useRef(null);
  const completionRef  = useRef({ totalCorrect: 0, totalSwiped: 0, swearEarned: 0, bestCombo: 0 });

  // ── Initial batch fetch ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `/api/swipe-batch?count=${BATCH_COUNT}&lang=${encodeURIComponent(lang)}` +
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
        setStatements(data.statements);
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

  // ── Timer ────────────────────────────────────────────────────
  useEffect(() => {
    if (loading || error || done) return;
    if (timeLeft <= 0) {
      finish();
      return;
    }
    const id = setTimeout(() => setTimeLeft(s => s - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, loading, error, done]);

  // ── Reset card timer when index changes ──────────────────────
  useEffect(() => {
    cardShownAtRef.current = Date.now();
    setDrag({ x: 0, y: 0, rotate: 0, dragging: false });
  }, [currentIdx]);

  // Keep completionRef in lock-step with state so finish() doesn't lose
  // the last swipe's award due to React's batched updates.
  useEffect(() => {
    completionRef.current = { totalCorrect, totalSwiped, swearEarned, bestCombo };
  }, [totalCorrect, totalSwiped, swearEarned, bestCombo]);

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setDone(true);
    const final = completionRef.current;
    onComplete?.({
      totalCorrect: final.totalCorrect,
      totalSwiped:  final.totalSwiped,
      swearEarned:  final.swearEarned,
      bestCombo:    final.bestCombo,
      accuracy:     final.totalSwiped > 0 ? final.totalCorrect / final.totalSwiped : 0,
      sessionId:    sessionIdRef.current,
    });
  }

  const handleSwipe = useCallback(async (direction) => {
    if (animatingRef.current || finishedRef.current) return;
    if (currentIdx >= statements.length) return;
    const stmt = statements[currentIdx];
    if (!stmt) return;
    animatingRef.current = true;

    const reactionMs = Date.now() - cardShownAtRef.current;
    const exitX = direction === "right" ? 600 : -600;
    setDrag({ x: exitX, y: 0, rotate: direction === "right" ? 25 : -25, dragging: false });

    let result = { correct: false, swearAwarded: 0, newCombo: 0, feedback: null };
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

    setTotalSwiped(s => s + 1);
    if (result.correct) {
      setTotalCorrect(c => c + 1);
      setCombo(result.newCombo | 0);
      setBestCombo(b => Math.max(b, result.newCombo | 0));
      setSwearEarned(s => s + (result.swearAwarded | 0));
      setFeedback(result.feedback === "lightning" ? t("swipe.feedback_lightning")
                : result.feedback === "combo"     ? t("swipe.feedback_combo")
                : t("swipe.feedback_correct"));
      if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
    } else {
      setCombo(0);
      setFeedback(t("swipe.feedback_wrong"));
      if (navigator.vibrate) try { navigator.vibrate([15, 40, 15]); } catch {}
    }

    // Advance to next card after a short reveal beat.
    setTimeout(() => {
      animatingRef.current = false;
      setFeedback(null);
      setCurrentIdx(i => {
        const next = i + 1;
        // Fetched 25 — if user's a swipe demon and consumed all of them,
        // we just freeze on the empty stack until the timer ends.
        return next;
      });
    }, 220);
  }, [currentIdx, statements, userId, t]);

  // ── Pointer drag ─────────────────────────────────────────────
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
    const dy = p.y - dragStartRef.current.y;
    setDrag({ x: dx, y: dy * 0.3, rotate: dx * 0.06, dragging: true });
  }
  function onPointerUp() {
    if (!drag.dragging) return;
    if (drag.x > SWIPE_THRESHOLD)       handleSwipe("right");
    else if (drag.x < -SWIPE_THRESHOLD) handleSwipe("left");
    else setDrag({ x: 0, y: 0, rotate: 0, dragging: false });
  }
  function pt(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX || 0, y: e.clientY || 0 };
  }

  // ── Render ───────────────────────────────────────────────────
  if (error) {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠</div>
          <div style={{ color: T.bad, marginBottom: 16 }}>{t("swipe.load_failed")}</div>
          <button onClick={onExit} style={btnSecondary()}>{t("swipe.back_home")}</button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: T.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
            {t("swipe.daily_warmup")}
          </div>
          <div style={{ color: T.dim, fontSize: 13 }}>{t("swipe.starting")}</div>
        </div>
      </div>
    );
  }

  if (done) {
    const accuracy = totalSwiped > 0 ? Math.round((totalCorrect / totalSwiped) * 100) : 0;
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center", maxWidth: 380, animation: "g-fadeUp .4s both" }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: T.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>
            {t("swipe.complete")}
          </div>
          <div style={{ fontSize: 56, marginBottom: 4 }}>🔥</div>
          <div style={{ fontSize: 13, color: T.ok, marginBottom: 20, fontFamily: "Georgia, serif" }}>
            {t("swipe.unlock_climb")}
          </div>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 18,
          }}>
            <Stat value={totalSwiped} label={t("swipe.stat_swiped")} color={T.gold} />
            <Stat value={totalCorrect} label={t("swipe.stat_correct")} color={T.ok} />
            <Stat value={`${accuracy}%`} label={t("swipe.stat_accuracy")} color="#22d3ee" />
          </div>
          <div style={{ fontSize: 12, color: T.dim, marginBottom: 18 }}>
            +{swearEarned} <span style={{ color: T.gold }}>Ⓢ</span>
            {bestCombo >= 5 && <span style={{ marginLeft: 10, color: "#ff6b35" }}>· best 🔥 {bestCombo}</span>}
          </div>
          <button onClick={onExit} style={btnPrimary()}>{t("swipe.back_home")}</button>
        </div>
      </div>
    );
  }

  const stmt    = statements[currentIdx];
  const peek    = statements[currentIdx + 1]; // shadow card under the active one
  const dirHint = drag.x >  50 ? "right"
                : drag.x < -50 ? "left"
                : null;

  return (
    <div style={wrap()}>
      {/* Header — timer / combo / SWEAR */}
      <div style={{
        width: "100%", maxWidth: 460, padding: "max(14px, env(safe-area-inset-top)) 16px 8px",
        boxSizing: "border-box",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <button onClick={onExit} style={{
          background: "transparent", color: T.dim, border: `1px solid ${T.gb}`,
          borderRadius: 8, padding: "6px 10px", fontSize: 11, letterSpacing: 1.5,
          textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
        }}>← {t("swipe.exit")}</button>
        <div style={{
          fontSize: 28, fontWeight: 800, fontFamily: "Georgia, serif",
          color: timeLeft <= 10 ? T.bad : T.gold,
          minWidth: 64, textAlign: "center",
        }}>{timeLeft}s</div>
        <div style={{ minWidth: 64, textAlign: "right", fontSize: 13, color: T.ok, fontWeight: 700 }}>
          +{swearEarned} <span style={{ color: T.gold }}>Ⓢ</span>
        </div>
      </div>

      {/* Combo indicator */}
      <div style={{
        height: 22, marginBottom: 4,
        fontSize: 14, color: combo >= 5 ? "#ff6b35" : T.dim,
        fontWeight: 700, letterSpacing: 1,
      }}>
        {combo >= 2 ? `🔥 ${combo}` : " "}
      </div>

      {/* LIE / TRUE prompts */}
      <div style={{
        display: "flex", justifyContent: "space-between",
        width: "100%", maxWidth: 360, padding: "0 6px", boxSizing: "border-box",
        fontSize: 11, letterSpacing: 2.5, fontWeight: 700, marginBottom: 8,
      }}>
        <span style={{ color: dirHint === "left" ? T.bad : "rgba(244,63,94,.4)" }}>
          ← {t("swipe.lie")}
        </span>
        <span style={{ color: dirHint === "right" ? T.ok : "rgba(45,212,160,.4)" }}>
          {t("swipe.true")} →
        </span>
      </div>

      {/* Card stack */}
      <div style={{
        position: "relative", width: "100%", maxWidth: 360,
        height: "min(420px, 60vh)",
        margin: "4px 0 16px",
        touchAction: "none",
      }}>
        {peek && (
          <Card stmt={peek} style={{
            transform: "scale(0.94) translateY(12px)",
            opacity: 0.5, zIndex: 1,
          }} />
        )}
        {stmt ? (
          <Card
            stmt={stmt}
            dirHint={dirHint}
            interactive
            style={{
              transform: `translate(${drag.x}px, ${drag.y}px) rotate(${drag.rotate}deg)`,
              transition: drag.dragging ? "none" : "transform .25s cubic-bezier(.2,.9,.4,1.1)",
              zIndex: 2,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        ) : (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: T.dim, fontSize: 13, textAlign: "center", padding: 20,
          }}>{t("swipe.batch_done")}</div>
        )}

        {feedback && (
          <div style={{
            position: "absolute", top: "40%", left: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: 18, fontWeight: 800, letterSpacing: 2,
            textTransform: "uppercase",
            color: feedback === t("swipe.feedback_wrong") ? T.bad
                 : feedback === t("swipe.feedback_lightning") ? "#fbbf24"
                 : feedback === t("swipe.feedback_combo") ? "#ff6b35"
                 : T.ok,
            pointerEvents: "none", zIndex: 3,
            animation: "swipe-fb .4s ease",
            textShadow: "0 2px 16px rgba(0,0,0,.6)",
          }}>{feedback}</div>
        )}
      </div>

      {/* Tap fallback buttons (also useful on desktop). */}
      <div style={{
        display: "flex", gap: 12, width: "100%", maxWidth: 360,
        padding: "0 6px", boxSizing: "border-box", marginBottom: 10,
      }}>
        <button onClick={() => handleSwipe("left")} style={btnLie()}>✗ {t("swipe.lie")}</button>
        <button onClick={() => handleSwipe("right")} style={btnTrue()}>✓ {t("swipe.true")}</button>
      </div>

      <div style={{ fontSize: 10, color: T.dim, letterSpacing: 1.5, textTransform: "uppercase" }}>
        {totalSwiped} {t("swipe.swiped_label")} · {totalCorrect} {t("swipe.correct_label")}
      </div>

      {/* Inline keyframes — keep self-contained so we don't depend on App's <GameStyles>. */}
      <style>{`
        @keyframes swipe-fb {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(.6); }
          40% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </div>
  );
}

function Card({ stmt, style, interactive, dirHint, ...handlers }) {
  const borderColor = dirHint === "right" ? "rgba(45,212,160,0.7)"
                    : dirHint === "left"  ? "rgba(244,63,94,0.7)"
                    : "rgba(255,255,255,0.1)";
  return (
    <div
      {...handlers}
      style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(135deg, #232336, #14141f)",
        border: `2px solid ${borderColor}`,
        borderRadius: 18,
        padding: 20,
        boxShadow: "0 20px 50px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)",
        display: "flex", flexDirection: "column", justifyContent: "space-between",
        cursor: interactive ? "grab" : "default",
        userSelect: "none", WebkitUserSelect: "none",
        ...style,
      }}
    >
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
function wrap() {
  return {
    minHeight: "100dvh",
    background: `radial-gradient(ellipse at 50% 0%, rgba(232,197,71,.06) 0%, ${T.bg} 55%)`,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: "#e8e6e1",
    display: "flex", flexDirection: "column", alignItems: "center",
    paddingBottom: "max(20px, env(safe-area-inset-bottom))",
    overflow: "hidden",
  };
}

export default SwipeWarmup;

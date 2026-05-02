import { useEffect, useRef } from "react";
import { t as translate } from "../i18n/index.js";
import { captureEvent } from "../lib/telemetry.js";
import { moduleById } from "../lib/moduleRegistry.js";

// FinalScoreScreen — terminal screen of a PLAY session. Shows total score,
// SWEAR, per-module breakdown, and CTAs to play again or return home.
//
// Side effect on mount: fires session_completed telemetry and a single
// `awardSwear("bluff_session_complete", gid)` for the run-end completion
// bonus. Per-module SWEAR shown to the player is in-run only — the
// existing /api/swear-earn endpoint requires a server-side rate lookup
// and doesn't accept variable amounts. Variable per-session SWEAR awarding
// is a follow-up; for now the completion bonus is fixed.
export function FinalScoreScreen({ sessionState, userId, lang = "en", onPlayAgain, onHome, awardSwear }) {
  const t = (k, params) => translate(k, lang, params);
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const durationMs = Date.now() - sessionState.startedAt;
    captureEvent("session_completed", {
      sessionId:    sessionState.sessionId,
      totalScore:   sessionState.score,
      totalSwear:   sessionState.swear,
      moduleCount:  sessionState.moduleResults.length,
      durationMs,
    });

    if (typeof awardSwear === "function" && userId) {
      awardSwear("bluff_session_complete", `bluff_${sessionState.sessionId}`, {
        label: t("final.swear_label"),
        meta:  { score: sessionState.score, modules: sessionState.moduleResults.length },
      }).catch?.((e) => console.warn("[final] swear-earn failed:", e?.message));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={wrap()}>
      <div style={hero()}>
        <div style={tag()}>{t("final.complete")}</div>
        <div style={bigNum()}>{sessionState.score}</div>
        <div style={subLine()}>
          ⓢ <b style={{ color: "#e8c547" }}>{sessionState.swear}</b> {t("final.swear_earned")}
        </div>
      </div>

      <div style={breakdown()}>
        {sessionState.moduleResults.map((r, idx) => {
          const m = moduleById(r.moduleId);
          return (
            <div key={idx} style={row()}>
              <span style={{ fontSize: 16 }}>{m?.icon || "🎯"}</span>
              <span style={{ flex: 1, fontSize: 13, color: "#e8e6e1" }}>
                {m ? t(m.nameKey) : r.moduleId}
              </span>
              <span style={{ color: r.success ? "#2dd4a0" : "#f43f5e", fontSize: 13, fontWeight: 800 }}>
                {r.success ? "✓" : "✗"}
              </span>
              <span style={{ color: "#e8c547", fontSize: 12, fontWeight: 700, minWidth: 48, textAlign: "right" }}>
                +{r.scoreDelta}
              </span>
            </div>
          );
        })}
      </div>

      <div style={actions()}>
        <button onClick={onPlayAgain} style={btnPrimary()}>{t("final.play_again")}</button>
        <button onClick={onHome}      style={btnSecondary()}>{t("final.home")}</button>
      </div>
    </div>
  );
}

function wrap() {
  return {
    minHeight: "100dvh",
    background: "radial-gradient(ellipse at 50% 0%, rgba(232,197,71,.08) 0%, #04060f 55%)",
    color: "#e8e6e1",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    display: "flex", flexDirection: "column",
    paddingBottom: "max(20px, env(safe-area-inset-bottom))",
  };
}
function hero() {
  return { textAlign: "center", padding: "44px 24px 18px" };
}
function tag() {
  return { fontSize: 11, letterSpacing: 4, color: "#e8c547", fontWeight: 800, textTransform: "uppercase", marginBottom: 12 };
}
function bigNum() {
  return {
    fontSize: 84, fontWeight: 900, fontFamily: "Georgia, serif",
    color: "#e8c547", lineHeight: 1, textShadow: "0 0 36px rgba(232,197,71,.4)",
  };
}
function subLine() {
  return { fontSize: 14, color: "#e8e6e1", marginTop: 12, opacity: 0.85 };
}
function breakdown() {
  return {
    flex: 1, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, overflowY: "auto",
    maxWidth: 480, margin: "0 auto", width: "100%", boxSizing: "border-box",
  };
}
function row() {
  return {
    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
    background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)",
    borderRadius: 10,
  };
}
function actions() {
  return {
    display: "flex", flexDirection: "column", gap: 8,
    padding: "16px", maxWidth: 420, margin: "0 auto", width: "100%", boxSizing: "border-box",
  };
}
function btnPrimary() {
  return {
    width: "100%", minHeight: 56, padding: 14,
    fontSize: 14, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase",
    background: "linear-gradient(135deg,#e8c547,#d4a830)",
    color: "#04060f", border: "none", borderRadius: 14,
    cursor: "pointer", fontFamily: "inherit",
  };
}
function btnSecondary() {
  return {
    width: "100%", minHeight: 48, padding: 12,
    fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase",
    background: "transparent", color: "#e8c547", border: "1px solid #e8c547",
    borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
  };
}

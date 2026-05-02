import { useState } from "react";
import { t as translate } from "../i18n/index.js";
import { captureEvent } from "../lib/telemetry.js";

// MultiplayerStub — "Coming soon" screen with email-collector form.
// Posts to /api/multiplayer-waitlist; no real multiplayer logic yet.
//
// Spec: "Multiplayer može da bude stub za prvu verziju (waitlist)" —
// build a list of interested users before building the feature.
export function MultiplayerStub({ lang = "en", onBack }) {
  const t = (k, params) => translate(k, lang, params);
  const [email, setEmail]   = useState("");
  const [stage, setStage]   = useState("input"); // "input" | "submitting" | "done" | "error"
  const [error, setError]   = useState(null);

  async function submit(e) {
    e?.preventDefault?.();
    if (stage !== "input") return;
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t("multiplayer.invalid_email"));
      return;
    }
    setStage("submitting");
    setError(null);
    try {
      const r = await fetch("/api/multiplayer-waitlist", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: trimmed, lang }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `waitlist_${r.status}`);
      }
      captureEvent("multiplayer_waitlist_signup", { lang });
      setStage("done");
    } catch (err) {
      setError(err.message || "submit_failed");
      setStage("error");
    }
  }

  return (
    <div style={wrap()}>
      <header style={hud()}>
        <button onClick={onBack} style={hudBtn()}>← {t("multiplayer.back")}</button>
      </header>

      <div style={body()}>
        <div style={{ fontSize: 60, marginBottom: 12 }}>👥</div>
        <h2 style={title()}>{t("multiplayer.coming_soon")}</h2>
        <p style={blurb()}>{t("multiplayer.blurb")}</p>

        {stage === "done" ? (
          <div style={done()}>
            <div style={{ fontSize: 32 }}>✓</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#2dd4a0", marginTop: 8 }}>
              {t("multiplayer.thanks")}
            </div>
          </div>
        ) : (
          <form onSubmit={submit} style={form()}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("multiplayer.email_placeholder")}
              disabled={stage === "submitting"}
              style={input()}
              autoComplete="email"
            />
            <button type="submit" disabled={stage === "submitting"} style={btnPrimary(stage === "submitting")}>
              {stage === "submitting" ? "…" : t("multiplayer.notify_me")}
            </button>
            {error && <div style={errLine()}>{error}</div>}
          </form>
        )}
      </div>
    </div>
  );
}

function wrap() {
  return {
    minHeight: "100dvh",
    background: "radial-gradient(ellipse at 50% 0%, rgba(232,197,71,.06) 0%, #04060f 55%)",
    color: "#e8e6e1",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    display: "flex", flexDirection: "column",
    paddingBottom: "max(20px, env(safe-area-inset-bottom))",
  };
}
function hud() {
  return {
    padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,.05)",
  };
}
function hudBtn() {
  return {
    padding: "8px 12px", borderRadius: 8,
    background: "transparent", color: "#e8e6e1",
    border: "1px solid rgba(255,255,255,.12)",
    cursor: "pointer", fontFamily: "inherit", fontSize: 12,
  };
}
function body() {
  return {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    padding: "20px 24px", textAlign: "center", maxWidth: 420, margin: "0 auto",
    width: "100%", boxSizing: "border-box",
  };
}
function title() {
  return { fontSize: 22, fontFamily: "Georgia, serif", color: "#e8c547", margin: "8px 0" };
}
function blurb() {
  return { fontSize: 14, color: "rgba(232,230,225,.7)", lineHeight: 1.5, marginBottom: 24, maxWidth: 360 };
}
function form() {
  return { width: "100%", display: "flex", flexDirection: "column", gap: 10 };
}
function input() {
  return {
    width: "100%", padding: "14px", borderRadius: 12,
    background: "rgba(255,255,255,.04)",
    border: "1.5px solid rgba(255,255,255,.12)",
    color: "#e8e6e1", fontFamily: "inherit", fontSize: 15,
    boxSizing: "border-box",
  };
}
function btnPrimary(disabled) {
  return {
    width: "100%", minHeight: 50, padding: 14,
    fontSize: 13, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase",
    background: disabled ? "rgba(232,197,71,.18)" : "linear-gradient(135deg,#e8c547,#d4a830)",
    color: "#04060f", border: "none", borderRadius: 12,
    cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
    opacity: disabled ? 0.6 : 1,
  };
}
function done() {
  return { padding: "24px 0" };
}
function errLine() {
  return { color: "#f43f5e", fontSize: 12, marginTop: 6 };
}

import { t as translate } from "../i18n/index.js";

// HomeScreen — drastically simplified two-CTA home for the consolidated
// BLUFF flow. Replaces the legacy 2,000-line home render in App.jsx.
//
// Default landing screen post-consolidation. The legacy home is reachable
// via ?home=v1 as an escape hatch (handled in App.jsx).
//
// Footer "More" routes to a small archive page that links to the legacy
// modes (Blitz, Daily, Duel, Shifter, Numbers, legacy Climb) for users who
// want them. Settings + Leaderboard sit alongside.
export function HomeScreen({
  lang = "en",
  userStats,        // { totalScore, swearBalance, gamesPlayed }
  onPlay,
  onMultiplayer,
  onMore,
  onSettings,
  onLeaderboard,
}) {
  const t = (k, params) => translate(k, lang, params);

  return (
    <div style={wrap()}>
      <div style={topSection()}>
        <div style={brand()}>BLUFF</div>
        <div style={tagline()}>{t("home_v2.tagline")}</div>
      </div>

      <div style={ctaBlock()}>
        <button onClick={onPlay} style={btnPrimary()}>
          <span style={{ fontSize: 28 }}>🎮</span>
          <span style={{ fontSize: 18, fontWeight: 900, letterSpacing: 3 }}>{t("home_v2.play")}</span>
          <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.75, letterSpacing: 1 }}>
            {t("home_v2.play_subtitle")}
          </span>
        </button>

        <button onClick={onMultiplayer} style={btnSecondary()}>
          <span style={{ fontSize: 22 }}>👥</span>
          <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: 2 }}>{t("home_v2.multiplayer")}</span>
          <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.65, letterSpacing: 1 }}>
            {t("home_v2.multiplayer_subtitle")}
          </span>
        </button>
      </div>

      {userStats && (
        <div style={statsRow()}>
          <Stat icon="⭐" value={userStats.totalScore | 0} />
          <Stat icon="ⓢ" value={userStats.swearBalance | 0} color="#e8c547" />
          <Stat icon="🏆" value={userStats.gamesPlayed | 0} />
        </div>
      )}

      <div style={footer()}>
        <button onClick={onLeaderboard} style={footerLink()}>{t("home_v2.leaderboard")}</button>
        <span style={{ opacity: 0.3 }}>·</span>
        <button onClick={onMore}        style={footerLink()}>{t("home_v2.more")}</button>
        <span style={{ opacity: 0.3 }}>·</span>
        <button onClick={onSettings}    style={footerLink()}>{t("home_v2.settings")}</button>
      </div>
    </div>
  );
}

function Stat({ icon, value, color }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      flex: 1, padding: "10px 4px",
      background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)",
      borderRadius: 10,
    }}>
      <div style={{ fontSize: 14, opacity: 0.85 }}>{icon}</div>
      <div style={{
        fontSize: 18, fontWeight: 800, color: color || "#e8e6e1",
        fontFamily: "Georgia, serif",
      }}>{value}</div>
    </div>
  );
}

function wrap() {
  return {
    minHeight: "100dvh",
    background: "radial-gradient(ellipse at 50% -20%, rgba(232,197,71,.18) 0%, rgba(8,8,15,0) 50%), #04060f",
    color: "#e8e6e1",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    display: "flex", flexDirection: "column",
    padding: "max(40px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom))",
    boxSizing: "border-box",
  };
}
function topSection() {
  return {
    flex: "0 0 auto", textAlign: "center",
    padding: "20px 0 36px",
  };
}
function brand() {
  return {
    fontSize: "clamp(56px, 14vw, 84px)",
    fontWeight: 900, letterSpacing: "clamp(8px, 2.5vw, 12px)",
    color: "#e8c547", fontFamily: "Georgia, serif",
    textShadow: "0 0 28px rgba(232,197,71,.45)",
  };
}
function tagline() {
  return {
    fontSize: 12, letterSpacing: 4, color: "rgba(232,230,225,.55)",
    textTransform: "uppercase", marginTop: 8, fontWeight: 600,
  };
}
function ctaBlock() {
  return {
    flex: 1, display: "flex", flexDirection: "column", gap: 14,
    maxWidth: 420, margin: "0 auto", width: "100%", boxSizing: "border-box",
    padding: "0 4px",
  };
}
function btnPrimary() {
  return {
    width: "100%", minHeight: 110, padding: "18px",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
    background: "linear-gradient(135deg,#e8c547,#d4a830)",
    color: "#04060f", border: "none", borderRadius: 18,
    boxShadow: "0 14px 40px rgba(232,197,71,.28), inset 0 1px 0 rgba(255,255,255,.4)",
    cursor: "pointer", fontFamily: "inherit",
    textTransform: "uppercase",
  };
}
function btnSecondary() {
  return {
    width: "100%", minHeight: 80, padding: "14px",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
    background: "rgba(255,255,255,.04)", color: "#e8e6e1",
    border: "1.5px solid rgba(255,255,255,.12)", borderRadius: 16,
    cursor: "pointer", fontFamily: "inherit",
    textTransform: "uppercase",
  };
}
function statsRow() {
  return {
    display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8,
    maxWidth: 420, margin: "16px auto 0", width: "100%", boxSizing: "border-box",
    padding: "0 4px",
  };
}
function footer() {
  return {
    display: "flex", justifyContent: "center", alignItems: "center", gap: 10,
    fontSize: 12, color: "rgba(232,230,225,.55)", marginTop: 16,
  };
}
function footerLink() {
  return {
    background: "transparent", color: "rgba(232,230,225,.6)",
    border: "none", padding: "6px 8px",
    cursor: "pointer", fontFamily: "inherit", fontSize: 12,
    textTransform: "uppercase", letterSpacing: 1.5,
  };
}

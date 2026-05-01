import { useGameState } from "./GameContext.jsx";

// Shared chrome for placeholder phases. Real phases will eventually
// replace this with their own UI, but they keep reading state from context.
export function PhaseShell({ name, blurb, onComplete, onAbort, children }) {
  const { score, lives, swear } = useGameState();
  return (
    <div style={wrap}>
      <header style={hud}>
        <div>SCORE <b>{score}</b></div>
        <div>LIVES <b>{"♥".repeat(lives) || "—"}</b></div>
        <div>SWEAR <b>{swear}</b></div>
      </header>
      <div style={body}>
        <div style={tag}>PHASE</div>
        <h1 style={title}>{name}</h1>
        {blurb && <p style={subtitle}>{blurb}</p>}
        {children}
      </div>
      <footer style={foot}>
        <button onClick={onAbort} style={btnGhost}>Quit</button>
        <button onClick={() => onComplete?.({ ok: true })} style={btnPrimary}>Finish phase</button>
      </footer>
    </div>
  );
}

const wrap = {
  minHeight: "100dvh", display: "flex", flexDirection: "column",
  background: "#04060f", color: "#e8e6e1", fontFamily: "inherit",
};
const hud = {
  display: "flex", justifyContent: "space-between",
  padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.06)",
  fontSize: 12, letterSpacing: 1,
};
const body = { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" };
const tag = { fontSize: 11, letterSpacing: 3, opacity: 0.5 };
const title = { fontFamily: "Georgia, serif", color: "#e8c547", margin: "8px 0 16px" };
const subtitle = { opacity: 0.7, maxWidth: 460 };
const foot = { display: "flex", gap: 8, padding: 16, borderTop: "1px solid rgba(255,255,255,.06)" };
const btnPrimary = {
  flex: 1, padding: 14, borderRadius: 10, background: "#e8c547",
  color: "#04060f", border: "none", fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
};
const btnGhost = {
  padding: "14px 20px", borderRadius: 10, background: "transparent",
  color: "#e8e6e1", border: "1.5px solid rgba(255,255,255,.12)", fontFamily: "inherit", cursor: "pointer",
};

// src/screens/DuelChallenge.jsx
// Opponent plays the same 10 rounds as the challenger.
// Standalone component — no dependency on main app state.

import { useState, useEffect, useRef } from "react";

// ── Theme ─────────────────────────────────────────────────────
const T = {
  bg:      "#04060f",
  card:    "#0f0f1a",
  gold:    "#e8c547",
  goldDim: "rgba(232,197,71,.1)",
  ok:      "#2dd4a0",
  bad:     "#f43f5e",
  dim:     "#5a5a68",
  glass:   "rgba(255,255,255,.03)",
  gb:      "rgba(255,255,255,.07)",
};

const wrap = {
  minHeight: "100vh",
  background: `radial-gradient(ellipse at 50% 0%, rgba(232,197,71,.05) 0%, ${T.bg} 55%)`,
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  display: "flex", flexDirection: "column", alignItems: "center",
  color: "#e8e6e1",
  padding: "env(safe-area-inset-top, 24px) 16px 24px",
};

const inner = { width: "100%", maxWidth: 460 };

// ── Minimal pulse animation ───────────────────────────────────
function DuelStyles() {
  return (
    <style>{`
      @keyframes d-fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
      @keyframes d-shimmer { from{background-position:0%} to{background-position:200%} }
      @keyframes d-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
    `}</style>
  );
}

// ── Timer ring ────────────────────────────────────────────────
function TimerRing({ time, max = 45, size = 44 }) {
  const r = (size - 6) / 2, circ = 2 * Math.PI * r;
  const color = time <= 10 ? T.bad : time <= 20 ? "#fb923c" : T.gold;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={3}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.max(0, time / max))}
          strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s linear, stroke .3s" }}/>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: 14, fontWeight: 700, color,
        animation: time <= 5 ? "d-pulse .5s infinite" : "none" }}>
        {time}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function DuelChallenge({ challengeId }) {
  const [phase, setPhase] = useState("loading");
  // phases: loading | error | intro | playing | submitting | result | result_view
  const [duel, setDuel]      = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("bluff_duel_name") || "");

  // ── Game state ────────────────────────────────────────────
  const [roundIdx, setRoundIdx] = useState(0);
  const [stmts, setStmts]       = useState([]);
  const [sel, setSel]           = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore]       = useState(0);
  const [time, setTime]         = useState(45);

  const timerRef    = useRef(null);
  const gameStartRef = useRef(null);
  const resultsRef  = useRef([]);   // accumulates booleans per round

  // ── Load duel ─────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/duel/${challengeId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setErrorMsg(data.error); setPhase("error"); return; }
        setDuel(data);
        setPhase(data.status === "completed" ? "result_view" : "intro");
      })
      .catch(() => { setErrorMsg("Network error. Please try again."); setPhase("error"); });
  }, [challengeId]);

  // ── Timer ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "playing" || revealed) return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTime(t => {
        if (t <= 1) { clearInterval(timerRef.current); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase, roundIdx, revealed]);

  // Auto-reveal when timer hits 0
  useEffect(() => {
    if (time === 0 && !revealed && phase === "playing") doReveal();
  }, [time]);

  useEffect(() => () => clearInterval(timerRef.current), []);

  // ── Actions ───────────────────────────────────────────────
  function startGame() {
    if (!playerName.trim()) return;
    localStorage.setItem("bluff_duel_name", playerName.trim());
    gameStartRef.current = Date.now();
    resultsRef.current = [];
    setScore(0);
    setRoundIdx(0);
    const round = duel?.challenger?.rounds?.[0];
    setStmts(round?.statements || []);
    setSel(null);
    setRevealed(false);
    setTime(45);
    setPhase("playing");
  }

  function doReveal() {
    clearInterval(timerRef.current);
    const bi = stmts.findIndex(s => !s.real);
    const isCorrect = sel === bi && bi !== -1;
    resultsRef.current = [...resultsRef.current, isCorrect];
    setRevealed(true);
    if (isCorrect) setScore(s => s + 1);
  }

  function nextRound() {
    const totalRounds = duel?.challenger?.rounds?.length || 10;
    const next = roundIdx + 1;
    if (next >= totalRounds) {
      handleSubmit();
      return;
    }
    const round = duel.challenger.rounds[next];
    setRoundIdx(next);
    setStmts(round?.statements || []);
    setSel(null);
    setRevealed(false);
    setTime(45);
  }

  async function handleSubmit() {
    setPhase("submitting");
    const totalTime    = Math.round((Date.now() - gameStartRef.current) / 1000);
    const computedScore = resultsRef.current.filter(Boolean).length;

    try {
      const r = await fetch(`/api/duel/${challengeId}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          score:   computedScore,
          time:    totalTime,
          results: resultsRef.current,
          name:    playerName.trim() || "Player",
        }),
      });
      const data = await r.json();
      setDuel(prev => ({
        ...prev,
        status:   "completed",
        winner:   data.winner,
        opponent: {
          name:    playerName.trim(),
          score:   computedScore,
          time:    totalTime,
          results: resultsRef.current,
        },
      }));
      setPhase("result");
    } catch {
      // Show result anyway with local computation
      setDuel(prev => ({
        ...prev,
        status:   "completed",
        winner:   computedScore > (prev?.challenger?.score ?? 0) ? "opponent" : "challenger",
        opponent: {
          name:    playerName.trim(),
          score:   computedScore,
          time:    totalTime,
        },
      }));
      setPhase("result");
    }
  }

  // ── PHASE: loading ────────────────────────────────────────
  if (phase === "loading") return (
    <div style={{ ...wrap, justifyContent: "center" }}>
      <div style={{ fontSize: 20, color: T.dim }}>Loading challenge...</div>
      <DuelStyles/>
    </div>
  );

  // ── PHASE: error ──────────────────────────────────────────
  if (phase === "error") return (
    <div style={{ ...wrap, justifyContent: "center", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>❌</div>
      <div style={{ fontSize: 20, color: T.bad, marginBottom: 8 }}>Challenge not found</div>
      <div style={{ fontSize: 14, color: T.dim, marginBottom: 24 }}>{errorMsg}</div>
      <button
        onClick={() => window.location.href = "/"}
        style={{ padding: "12px 28px", background: T.gold, color: "#04060f", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 15, fontFamily: "inherit" }}>
        Play BLUFF™
      </button>
      <DuelStyles/>
    </div>
  );

  // ── PHASE: intro ──────────────────────────────────────────
  if (phase === "intro") {
    const ch = duel.challenger;
    const totalRounds = ch.rounds?.length || 10;
    return (
      <div style={wrap}>
        <div style={inner}>
          <div style={{ textAlign: "center", marginBottom: 28, animation: "d-fadeUp .5s both" }}>
            <div style={{ fontSize: 11, letterSpacing: "6px", color: T.dim, marginBottom: 10, fontWeight: 500 }}>SIAL GAMES</div>
            <h1 style={{ fontFamily: "Georgia,serif", fontSize: 60, fontWeight: 900, letterSpacing: -2, margin: "0 0 4px", lineHeight: 1, background: "linear-gradient(135deg,#e8c547,#f0d878,rgba(255,255,255,.5),#e8c547)", backgroundSize: "200% auto", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", animation: "d-shimmer 4s linear infinite" }}>
              BLUFF<sup style={{ fontSize: 13, WebkitTextFillColor: "rgba(232,197,71,.5)", position: "relative", top: -28, marginLeft: 2, fontFamily: "system-ui", fontWeight: 400 }}>™</sup>
            </h1>
            <p style={{ fontSize: 11, color: T.dim, letterSpacing: "4px", textTransform: "uppercase", margin: 0 }}>Duel Challenge</p>
          </div>

          {/* Challenger card */}
          <div style={{ background: "rgba(232,197,71,.08)", border: "1.5px solid rgba(232,197,71,.3)", borderRadius: 16, padding: "20px 18px", marginBottom: 20, textAlign: "center", animation: "d-fadeUp .5s .1s both" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚔️</div>
            <div style={{ fontSize: 15, color: "#e8e6e1", marginBottom: 6 }}>
              <strong style={{ color: T.gold }}>{ch.name || "Your friend"}</strong> challenged you!
            </div>
            <div style={{ fontSize: 36, fontFamily: "Georgia,serif", fontWeight: 800, color: T.gold, marginBottom: 4 }}>
              {ch.score}<span style={{ fontSize: 18, opacity: .6 }}>/{totalRounds}</span>
            </div>
            <div style={{ fontSize: 12, color: T.dim }}>
              {ch.score === totalRounds ? "Perfect score — can you match it?" :
               ch.score >= Math.ceil(totalRounds * .67) ? "Can you beat this score?" :
               "Think you can do better?"}
            </div>
          </div>

          {/* Name input */}
          <div style={{ marginBottom: 14, animation: "d-fadeUp .5s .2s both" }}>
            <input
              value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && startGame()}
              placeholder="Enter your name..."
              autoFocus
              style={{ width: "100%", padding: "14px 16px", fontSize: 16, background: T.card, border: `1.5px solid ${T.gb}`, borderRadius: 12, color: "#e8e6e1", fontFamily: "inherit", boxSizing: "border-box", outline: "none" }}
            />
          </div>

          <button
            onClick={startGame}
            disabled={!playerName.trim()}
            style={{ width: "100%", minHeight: 54, fontSize: 16, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: playerName.trim() ? `linear-gradient(135deg, ${T.gold}, #d4a830)` : T.card, color: playerName.trim() ? "#04060f" : T.dim, border: playerName.trim() ? "none" : `1.5px solid ${T.gb}`, borderRadius: 16, cursor: playerName.trim() ? "pointer" : "not-allowed", fontFamily: "inherit", animation: "d-fadeUp .5s .25s both" }}>
            ⚔️ Accept Challenge
          </button>

          <button
            onClick={() => window.location.href = "/"}
            style={{ width: "100%", minHeight: 44, marginTop: 10, fontSize: 13, fontWeight: 500, background: "transparent", color: T.dim, border: "none", cursor: "pointer", fontFamily: "inherit" }}>
            Play solo instead →
          </button>
        </div>
        <DuelStyles/>
      </div>
    );
  }

  // ── PHASE: playing ────────────────────────────────────────
  if (phase === "playing") {
    const totalRounds = duel?.challenger?.rounds?.length || 10;
    const bi = stmts.findIndex(s => !s.real);
    const isCorrect = sel === bi && bi !== -1;

    return (
      <div style={wrap}>
        <div style={inner}>
          {/* Header row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: "2px", color: T.dim, textTransform: "uppercase" }}>vs {duel.challenger.name}</div>
              <div style={{ fontSize: 13, color: T.gold, fontWeight: 700 }}>{duel.challenger.score}/{totalRounds} to beat</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: T.dim }}>Round</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{roundIdx + 1}<span style={{ color: T.dim, fontWeight: 400 }}>/{totalRounds}</span></div>
            </div>
            <TimerRing time={time} max={45}/>
          </div>

          {/* Progress bar */}
          <div style={{ height: 3, background: "rgba(255,255,255,.06)", borderRadius: 2, marginBottom: 16 }}>
            <div style={{ height: "100%", borderRadius: 2, background: T.gold, width: `${(roundIdx / totalRounds) * 100}%`, transition: "width .4s" }}/>
          </div>

          {/* Score */}
          <div style={{ textAlign: "center", marginBottom: 14 }}>
            <div style={{ fontSize: 11, letterSpacing: "2px", color: T.dim, textTransform: "uppercase", marginBottom: 2 }}>Your score</div>
            <div style={{ fontSize: 28, fontFamily: "Georgia,serif", fontWeight: 800, color: T.gold }}>{score}<span style={{ fontSize: 16, opacity: .6 }}>/{totalRounds}</span></div>
          </div>

          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <h2 style={{ fontFamily: "Georgia,serif", fontSize: 20, fontWeight: 800, margin: 0, color: revealed ? (isCorrect ? T.ok : T.bad) : "#fff", transition: "color .4s" }}>
              {revealed ? (isCorrect ? "You found it! 🎯" : "AXIOM won this one 🎭") : "Which one is the BLUFF?"}
            </h2>
          </div>

          {/* Statement cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 14 }}>
            {stmts.map((s, i) => {
              const isB = !s.real, isS = sel === i;
              let bg = T.card, border = T.gb;
              if (!revealed && isS) { bg = T.goldDim; border = "rgba(232,197,71,.4)"; }
              if (revealed && isB)  { bg = "rgba(244,63,94,.07)"; border = "rgba(244,63,94,.4)"; }
              if (revealed && isS && isCorrect) { bg = "rgba(45,212,160,.07)"; border = "rgba(45,212,160,.4)"; }

              return (
                <button
                  key={i}
                  onClick={() => !revealed && setSel(i)}
                  style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, background: bg, border: `1.5px solid ${border}`, borderRadius: 16, padding: "12px 14px", cursor: revealed ? "default" : "pointer", transition: "all .22s ease", textAlign: "left", color: "#e8e6e1", fontSize: "clamp(13px,3.5vw,15px)", lineHeight: 1.55, fontFamily: "inherit", minHeight: 52 }}>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, border: `2px solid ${isS && !revealed ? T.gold : revealed && isB ? T.bad : T.gb}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, marginTop: 2, background: isS && !revealed ? T.gold : "transparent", color: isS && !revealed ? T.bg : revealed && isB ? T.bad : T.dim, transition: "all .25s" }}>
                    {revealed && isB ? "!" : String.fromCharCode(65 + i)}
                  </div>
                  <div style={{ flex: 1 }}>
                    {s.text}
                    {revealed && (
                      <div style={{ marginTop: 6, fontSize: 10, fontWeight: 700, letterSpacing: "1.5px", color: isB ? T.bad : T.ok, opacity: isB || isS ? 1 : .4 }}>
                        {isB ? "🎭 AI FABRICATION" : "✓ Verified fact"}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Action buttons */}
          {!revealed ? (
            <button
              onClick={() => sel !== null && doReveal()}
              disabled={sel === null}
              style={{ width: "100%", minHeight: 52, fontSize: 15, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", background: sel !== null ? `linear-gradient(135deg, ${T.gold}, #d4a830)` : T.card, color: sel !== null ? "#04060f" : T.dim, border: sel !== null ? "none" : `1.5px solid ${T.gb}`, borderRadius: 16, cursor: sel !== null ? "pointer" : "not-allowed", fontFamily: "inherit" }}>
              {sel !== null ? "🔒 Lock in answer" : "Select a statement"}
            </button>
          ) : (
            <button
              onClick={nextRound}
              style={{ width: "100%", minHeight: 52, fontSize: 15, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: `linear-gradient(135deg, ${T.gold}, #d4a830)`, color: "#04060f", border: "none", borderRadius: 16, cursor: "pointer", fontFamily: "inherit", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)", animation: "d-shimmer 2.5s infinite" }}/>
              <span style={{ position: "relative" }}>{roundIdx + 1 < (duel?.challenger?.rounds?.length || 10) ? "Next Round →" : "See Results →"}</span>
            </button>
          )}

          {/* Running score bar */}
          <div style={{ display: "flex", justifyContent: "center", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
            {resultsRef.current.map((r, i) => (
              <div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: r ? T.ok : T.bad }}/>
            ))}
            {Array.from({ length: (duel?.challenger?.rounds?.length || 10) - resultsRef.current.length }, (_, i) => (
              <div key={`pending-${i}`} style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.15)" }}/>
            ))}
          </div>
        </div>
        <DuelStyles/>
      </div>
    );
  }

  // ── PHASE: submitting ─────────────────────────────────────
  if (phase === "submitting") return (
    <div style={{ ...wrap, justifyContent: "center" }}>
      <div style={{ fontSize: 20, color: T.dim }}>Submitting result...</div>
      <DuelStyles/>
    </div>
  );

  // ── PHASE: result / result_view ───────────────────────────
  if (phase === "result" || phase === "result_view") {
    const ch         = duel.challenger;
    const opp        = duel.opponent;
    const totalRounds = ch.rounds?.length || 10;
    const myScore    = opp?.score ?? 0;
    const winner     = duel.winner;
    const iWon       = winner === "opponent";
    const tied       = winner === "tie";

    // Results grid from the opponent's results
    const myResults  = opp?.results || [];
    const hisResults = ch.results || [];

    return (
      <div style={wrap}>
        <div style={inner}>
          {/* Outcome header */}
          <div style={{ textAlign: "center", marginBottom: 20, animation: "d-fadeUp .5s both" }}>
            <div style={{ fontSize: 60, marginBottom: 8 }}>{iWon ? "🏆" : tied ? "🤝" : "💀"}</div>
            <h2 style={{ fontFamily: "Georgia,serif", fontSize: 28, fontWeight: 800, color: iWon ? T.gold : tied ? "#22d3ee" : T.bad, margin: "0 0 6px" }}>
              {iWon ? "You won!" : tied ? "It's a tie!" : `${ch.name || "Challenger"} wins!`}
            </h2>
            <p style={{ fontSize: 13, color: T.dim, margin: 0 }}>
              {iWon ? "You beat the challenge!" : tied ? "Same score, same time!" : "Better luck next time!"}
            </p>
          </div>

          {/* Score comparison */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, marginBottom: 20, alignItems: "center", animation: "d-fadeUp .5s .1s both" }}>
            <div style={{ background: winner === "challenger" ? "rgba(232,197,71,.12)" : T.glass, border: `1.5px solid ${winner === "challenger" ? "rgba(232,197,71,.4)" : T.gb}`, borderRadius: 14, padding: "16px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 12, color: T.dim, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{ch.name || "Challenger"}</div>
              <div style={{ fontSize: 34, fontFamily: "Georgia,serif", fontWeight: 800, color: winner === "challenger" ? T.gold : "#e8e6e1", lineHeight: 1 }}>{ch.score}</div>
              <div style={{ fontSize: 11, color: T.dim }}>/{totalRounds}</div>
              {winner === "challenger" && <div style={{ fontSize: 12, color: T.gold, marginTop: 4 }}>👑 Winner</div>}
            </div>
            <div style={{ fontSize: 18, color: T.dim, textAlign: "center", fontWeight: 700 }}>vs</div>
            <div style={{ background: iWon ? "rgba(232,197,71,.12)" : T.glass, border: `1.5px solid ${iWon ? "rgba(232,197,71,.4)" : T.gb}`, borderRadius: 14, padding: "16px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 12, color: T.dim, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opp?.name || "You"}</div>
              <div style={{ fontSize: 34, fontFamily: "Georgia,serif", fontWeight: 800, color: iWon ? T.gold : "#e8e6e1", lineHeight: 1 }}>{myScore}</div>
              <div style={{ fontSize: 11, color: T.dim }}>/{totalRounds}</div>
              {iWon && <div style={{ fontSize: 12, color: T.gold, marginTop: 4 }}>👑 Winner</div>}
            </div>
          </div>

          {/* Round-by-round results */}
          {(myResults.length > 0 || hisResults.length > 0) && (
            <div style={{ background: T.glass, border: `1px solid ${T.gb}`, borderRadius: 14, padding: "14px 16px", marginBottom: 20, animation: "d-fadeUp .5s .2s both" }}>
              <div style={{ fontSize: 10, letterSpacing: "2px", color: T.dim, textTransform: "uppercase", marginBottom: 10 }}>Round by round</div>
              {hisResults.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 12, color: T.dim, width: 70, flexShrink: 0 }}>{ch.name?.slice(0, 8) || "They"}</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {hisResults.map((r, i) => <div key={i} style={{ width: 16, height: 16, borderRadius: 4, background: r ? T.ok : T.bad, fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#04060f", fontWeight: 700 }}>{r ? "✓" : "✗"}</div>)}
                  </div>
                </div>
              )}
              {myResults.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 12, color: T.dim, width: 70, flexShrink: 0 }}>{opp?.name?.slice(0, 8) || "You"}</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {myResults.map((r, i) => <div key={i} style={{ width: 16, height: 16, borderRadius: 4, background: r ? T.ok : T.bad, fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#04060f", fontWeight: 700 }}>{r ? "✓" : "✗"}</div>)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, animation: "d-fadeUp .5s .3s both" }}>
            <button
              onClick={() => {
                const url  = window.location.href;
                const text = `I ${iWon ? "won" : tied ? "tied" : "lost"} a BLUFF™ duel! ${myScore}/${totalRounds} vs ${ch.name || "Challenger"}'s ${ch.score}/${totalRounds}. Play at playbluff.games`;
                if (navigator.share) navigator.share({ title: "BLUFF™ Duel Result", text, url }).catch(() => navigator.clipboard?.writeText(text));
                else navigator.clipboard?.writeText(text).then(() => alert("Copied! 📋")).catch(() => alert(text));
              }}
              style={{ width: "100%", minHeight: 48, fontSize: 14, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: "rgba(34,211,238,.08)", color: "#22d3ee", border: "1px solid rgba(34,211,238,.25)", borderRadius: 12, cursor: "pointer", fontFamily: "inherit" }}>
              📤 Share result
            </button>
            <button
              onClick={() => window.location.href = "/"}
              style={{ width: "100%", minHeight: 52, fontSize: 15, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: `linear-gradient(135deg, ${T.gold}, #d4a830)`, color: "#04060f", border: "none", borderRadius: 12, cursor: "pointer", fontFamily: "inherit" }}>
              Play BLUFF™ →
            </button>
          </div>
        </div>
        <DuelStyles/>
      </div>
    );
  }

  return null;
}

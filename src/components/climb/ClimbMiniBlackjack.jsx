import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentIdToken } from "../../auth.js";

// CLIMB Mini-game 1 — Blackjack-form Daily Warm-up.
// Player and AXIOM each get 2 cards (one of AXIOM's hidden).
// To draw a card: player sees a TRUE/LIE statement and swipes (tap buttons OK).
//   ✓ correct  → card revealed and added to hand (random rank A/2-10/J/Q/K)
//   ✗ wrong    → BUST, hand lost (Blackjack rule: bust = end of hand)
//   bust > 21  → lose hand
// AXIOM auto-plays to 17 with 70% answer accuracy (simulated client-side).
// Best-of-3 hands. Card values + win-hand bonus feed CLIMB total.
//
// Reuses existing endpoints ONLY:
//   GET  /api/swipe-batch?count=20&lang=en
//   POST /api/swipe-judge { sessionId, statementId, swipeDirection, reactionMs }
//
// onComplete({ pointsEarned, outcome, results })

const POINTS_PER_CARD = 25;     // Each successful draw — points = card value × this.
const WIN_BONUS = 400;
const PUSH_BONUS = 100;
// Max additional player draws after the initial deal of 2 cards. Caps the
// hand at 6 cards so a streak doesn't drag the mini-game out indefinitely.
const MAX_DRAWS = 4;
// Best-of-N: 3 hands total. First to 2 wins decides the predigra; remaining
// hands are still played for points but the match outcome is locked.
const TOTAL_HANDS = 3;
// Hold the per-hand result this long before allowing tap-through to next hand.
const HAND_RESULT_HOLD_MS = 2200;
// Final summary auto-advance fallback if the player doesn't tap.
const FINAL_HOLD_MS = 6000;

const HAND_STATE = {
  PLAYING:   "playing",
  BUST:      "bust",
  STAND:     "stand",
  BLACKJACK: "blackjack",
};

const T = {
  bg: "#04060f",
  warm: "#e8c547",
  ok: "#2dd4a0",
  bad: "#f43f5e",
  dim: "#5a5a68",
  glass: "rgba(255,255,255,.03)",
  gb: "rgba(255,255,255,.07)",
};

const CARD_RANKS = [
  { rank: "A",  value: 11, soft: true  },
  { rank: "2",  value: 2  },
  { rank: "3",  value: 3  },
  { rank: "4",  value: 4  },
  { rank: "5",  value: 5  },
  { rank: "6",  value: 6  },
  { rank: "7",  value: 7  },
  { rank: "8",  value: 8  },
  { rank: "9",  value: 9  },
  { rank: "10", value: 10 },
  { rank: "J",  value: 10 },
  { rank: "Q",  value: 10 },
  { rank: "K",  value: 10 },
];
const SUITS = ["♠", "♥", "♦", "♣"];

function drawCard() {
  const rank = CARD_RANKS[Math.floor(Math.random() * CARD_RANKS.length)];
  const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
  return { ...rank, suit, id: Math.random().toString(36).slice(2) };
}

// Compute hand total honoring soft Aces (down-rate any A from 11 → 1 if needed).
function handTotal(cards) {
  let total = cards.reduce((s, c) => s + c.value, 0);
  let aces = cards.filter(c => c.rank === "A").length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

async function authFetch(url, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  try {
    const token = await getCurrentIdToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  } catch { /* anon */ }
  return fetch(url, { ...init, headers });
}

export function ClimbMiniBlackjack({ lang = "en", userId, onComplete }) {
  const [statements, setStatements] = useState([]);
  const [sessionId, setSessionId]   = useState(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  // Match state (across hands)
  const [currentHand, setCurrentHand] = useState(1);
  const [handResults, setHandResults] = useState([]); // [{ hand, score, state, outcome }]
  const [matchDone, setMatchDone]     = useState(false);

  // Per-hand state
  const [playerHand, setPlayerHand] = useState([]);
  const [axiomHand, setAxiomHand]   = useState([]); // first card hidden until reveal
  const [phase, setPhase] = useState("loading");
    // "loading" | "player" | "axiom" | "result" | "final"
  const [feedback, setFeedback] = useState(null); // {kind: "ok"|"miss", text}
  const [pointsEarned, setPointsEarned] = useState(0);
  const [outcome, setOutcome] = useState(null); // "win"|"lose"|"push"|"bust"
  const [handState, setHandState] = useState(HAND_STATE.PLAYING);

  const pointsRef = useRef(0); // mirrors pointsEarned for closure-safe reads
  const cardShownAtRef = useRef(Date.now());
  const submittingRef = useRef(false);
  const finishedRef = useRef(false);
  const advanceRef = useRef(null);
  const handResultsRef = useRef([]);
  const currentHandRef = useRef(1);

  function addPoints(n) {
    pointsRef.current += n;
    setPointsEarned(pointsRef.current);
  }

  // ── Initial swipe-batch fetch ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch enough statements for 3 hands × ~6 cards = 18, plus buffer.
        const url = `/api/swipe-batch?count=30&lang=${encodeURIComponent(lang)}` +
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

        // Initial deal: 2 cards player, 2 cards AXIOM (one hidden in UI).
        setPlayerHand([drawCard(), drawCard()]);
        setAxiomHand([drawCard(), drawCard()]);

        setLoading(false);
        setPhase("player");
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

  useEffect(() => () => { if (advanceRef.current) clearTimeout(advanceRef.current); }, []);

  // ── Player swipe (tap TRUE / LIE) ──────────────────────────
  const handleSwipe = useCallback(async (direction) => {
    if (phase !== "player" || submittingRef.current) return;
    if (handState !== HAND_STATE.PLAYING) return;
    if (currentIdx >= statements.length) return;
    const stmt = statements[currentIdx];
    if (!stmt) return;
    submittingRef.current = true;
    const reactionMs = Date.now() - cardShownAtRef.current;

    let result = null;
    try {
      const r = await authFetch("/api/swipe-judge", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          statementId: stmt.id,
          swipeDirection: direction,
          reactionMs,
          userId: userId || undefined,
        }),
      });
      if (r.ok) result = await r.json();
    } catch { /* network — treat as wrong */ }

    if (!result) result = { correct: false };

    if (result.correct) {
      const card = drawCard();
      const next = [...playerHand, card];
      setPlayerHand(next);
      addPoints(card.value * POINTS_PER_CARD);
      setFeedback({ kind: "ok", text: `✓ +${card.rank}${card.suit}` });

      const tot = handTotal(next);
      if (tot > 21) {
        setHandState(HAND_STATE.BUST);
        setOutcome("bust");
        advanceRef.current = setTimeout(() => endHand("bust", next, axiomHand), 900);
        return;
      }
      if (tot === 21) {
        setHandState(HAND_STATE.BLACKJACK);
        setFeedback({ kind: "ok", text: "✓ 21!" });
        advanceRef.current = setTimeout(() => beginAxiomTurn(next), 900);
        return;
      }
      // Cap player draws so the mini-game can't sprawl. Initial deal is 2;
      // after MAX_DRAWS additional cards the player auto-stands and AXIOM
      // turn begins.
      if (next.length >= 2 + MAX_DRAWS) {
        setHandState(HAND_STATE.STAND);
        setFeedback({ kind: "ok", text: "STAND · max draws" });
        advanceRef.current = setTimeout(() => beginAxiomTurn(next), 900);
        return;
      }
      setCurrentIdx(i => i + 1);
      cardShownAtRef.current = Date.now();
      setTimeout(() => { submittingRef.current = false; setFeedback(null); }, 700);
    } else {
      // Blackjack rule: wrong answer = BUST. Hand is lost immediately, no
      // AXIOM turn, no chance to recover within this hand.
      setHandState(HAND_STATE.BUST);
      setOutcome("bust");
      setFeedback({ kind: "miss", text: "✗ BUST · Hand lost" });
      advanceRef.current = setTimeout(() => endHand("bust", playerHand, axiomHand), 900);
    }
  }, [phase, currentIdx, statements, sessionId, userId, playerHand, axiomHand, handState]);

  function handleStand() {
    if (phase !== "player" || submittingRef.current) return;
    if (handState !== HAND_STATE.PLAYING) return;
    submittingRef.current = true;
    setHandState(HAND_STATE.STAND);
    setFeedback({ kind: "ok", text: "STAND" });
    advanceRef.current = setTimeout(() => beginAxiomTurn(playerHand), 700);
  }

  // ── AXIOM auto-play ────────────────────────────────────────
  function beginAxiomTurn(playerFinalHand) {
    setPhase("axiom");
    setFeedback(null);
    // Sequential simulated draws with 70% accuracy until total >= 17 or stand.
    let hand = [...axiomHand];
    let step = 0;
    const tickRef = { stop: false };

    function loop() {
      if (tickRef.stop) return;
      const tot = handTotal(hand);
      if (tot >= 17) {
        endHand(null, playerFinalHand, hand);
        return;
      }
      // 70% AXIOM "answers correctly" → adds a card. 30% → stops on this total.
      if (Math.random() < 0.7) {
        const card = drawCard();
        hand = [...hand, card];
        setAxiomHand(hand);
        step++;
        if (handTotal(hand) > 21) {
          endHand("axiom_bust", playerFinalHand, hand);
          return;
        }
        if (handTotal(hand) >= 17 || step >= 5) {
          endHand(null, playerFinalHand, hand);
          return;
        }
        advanceRef.current = setTimeout(loop, 700);
      } else {
        // AXIOM "missed" — turn over.
        endHand(null, playerFinalHand, hand);
      }
    }
    advanceRef.current = setTimeout(loop, 600);
  }

  function endHand(forcedOutcome, pHand, aHand) {
    const pTot = handTotal(pHand);
    const aTot = handTotal(aHand);
    let result;
    if (forcedOutcome === "bust") result = "lose";
    else if (forcedOutcome === "axiom_bust") result = "win";
    else if (pTot > 21) result = "lose";
    else if (aTot > 21) result = "win";
    else if (pTot > aTot) result = "win";
    else if (pTot < aTot) result = "lose";
    else result = "push";
    setOutcome(result);
    setPhase("result");
    let bonus = 0;
    if (result === "win") bonus = WIN_BONUS;
    else if (result === "push") bonus = PUSH_BONUS;
    if (bonus > 0) addPoints(bonus);

    const handRecord = {
      hand: currentHandRef.current,
      score: pTot,
      state: forcedOutcome === "bust" ? HAND_STATE.BUST : (handState !== HAND_STATE.PLAYING ? handState : HAND_STATE.STAND),
      outcome: result,
    };
    handResultsRef.current = [...handResultsRef.current, handRecord];
    setHandResults(handResultsRef.current);
  }

  // Advance to the next hand (or final summary if last).
  function nextHand() {
    if (advanceRef.current) clearTimeout(advanceRef.current);
    if (currentHandRef.current >= TOTAL_HANDS) {
      finalizeMatch();
      return;
    }
    currentHandRef.current += 1;
    setCurrentHand(currentHandRef.current);
    // Re-deal
    setPlayerHand([drawCard(), drawCard()]);
    setAxiomHand([drawCard(), drawCard()]);
    setHandState(HAND_STATE.PLAYING);
    setOutcome(null);
    setFeedback(null);
    submittingRef.current = false;
    setPhase("player");
    cardShownAtRef.current = Date.now();
    // Advance the statement cursor — leave plenty of statements per hand.
    setCurrentIdx(i => i + 1);
  }

  function finalizeMatch() {
    if (finishedRef.current) return;
    setMatchDone(true);
    setPhase("final");
    advanceRef.current = setTimeout(() => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      onComplete?.({
        pointsEarned: pointsRef.current,
        outcome: matchOutcomeFrom(handResultsRef.current),
        results: handResultsRef.current,
      });
    }, FINAL_HOLD_MS);
  }

  function matchOutcomeFrom(results) {
    const wins = results.filter(r => r.outcome === "win").length;
    const losses = results.filter(r => r.outcome === "lose").length;
    if (wins > losses) return "win";
    if (losses > wins) return "lose";
    return "push";
  }

  // User can short-circuit: from per-hand result → next hand; from final → exit.
  function continueNow() {
    if (phase === "result") {
      nextHand();
      return;
    }
    if (phase === "final") {
      if (advanceRef.current) clearTimeout(advanceRef.current);
      if (finishedRef.current) return;
      finishedRef.current = true;
      onComplete?.({
        pointsEarned: pointsRef.current,
        outcome: matchOutcomeFrom(handResultsRef.current),
        results: handResultsRef.current,
      });
    }
  }

  // ── Render ─────────────────────────────────────────────────
  if (error) {
    if (!finishedRef.current) {
      finishedRef.current = true;
      onComplete?.({ pointsEarned: 0, outcome: "skipped", error });
    }
    return null;
  }

  if (loading) {
    return (
      <div style={wrap()}>
        <div style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: T.warm, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
            Daily Warm-up
          </div>
          <div style={{ color: T.dim, fontSize: 13 }}>Shuffling…</div>
        </div>
      </div>
    );
  }

  // Final summary screen — all hands played.
  if (phase === "final") {
    const wins = handResults.filter(r => r.outcome === "win").length;
    const losses = handResults.filter(r => r.outcome === "lose").length;
    const pushes = handResults.filter(r => r.outcome === "push").length;
    const matchResult = matchOutcomeFrom(handResults);
    return (
      <div style={wrap()}>
        <header style={hud()}>
          <span style={{ fontSize: 11, letterSpacing: 3, color: T.warm, fontWeight: 700, textTransform: "uppercase" }}>
            Warm-up · Final
          </span>
          <span style={{ fontSize: 12, color: T.ok, fontWeight: 700 }}>+{pointsEarned} pts</span>
        </header>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 18px", gap: 16 }}>
          <div style={{
            fontSize: 32, fontWeight: 800, fontFamily: "Georgia, serif", letterSpacing: 4, textTransform: "uppercase",
            color: matchResult === "win" ? T.ok : matchResult === "push" ? T.warm : T.bad,
          }}>
            {matchResult === "win" ? "Match win" : matchResult === "push" ? "Match push" : "AXIOM took it"}
          </div>
          <div style={{ fontSize: 13, color: T.dim }}>
            {wins}W · {losses}L{pushes ? ` · ${pushes}P` : ""} ({TOTAL_HANDS} hands)
          </div>
          <div style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {handResults.map((r) => (
              <div key={r.hand} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 14px",
                background: T.glass, border: `1px solid ${T.gb}`, borderRadius: 10,
                color: r.outcome === "win" ? T.ok : r.outcome === "push" ? T.warm : T.bad,
                fontSize: 13, fontWeight: 700, letterSpacing: 1,
              }}>
                <span style={{ textTransform: "uppercase", fontSize: 11, color: T.dim, letterSpacing: 2 }}>
                  Hand {r.hand}
                </span>
                <span>
                  {r.state === HAND_STATE.BUST ? "BUST" : `${r.score} pts`} · {r.outcome.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
          <button onClick={continueNow} style={{
            marginTop: 6,
            padding: "12px 20px",
            fontSize: 12, fontWeight: 800, letterSpacing: 2.5,
            textTransform: "uppercase",
            background: "linear-gradient(135deg,#e8c547,#d4a830)",
            color: T.bg,
            border: "none",
            borderRadius: 12,
            cursor: "pointer", fontFamily: "inherit",
          }}>
            Continue to BLUFF →
          </button>
        </div>
      </div>
    );
  }

  const stmt = statements[currentIdx];
  const pTot = handTotal(playerHand);
  const aTotShown = phase === "player" ? "?" : handTotal(axiomHand);

  return (
    <div style={wrap()}>
      <header style={hud()}>
        <span style={{ fontSize: 11, letterSpacing: 3, color: T.warm, fontWeight: 700, textTransform: "uppercase" }}>
          Hand {currentHand} / {TOTAL_HANDS}
        </span>
        <span style={{ fontSize: 12, color: T.ok, fontWeight: 700 }}>
          +{pointsEarned} pts
        </span>
      </header>

      {/* AXIOM hand */}
      <div style={handRow("rgba(244,63,94,.15)")}>
        <div style={handLabel(T.bad)}>AXIOM · {aTotShown}</div>
        <div style={cardRow()}>
          {axiomHand.map((c, i) => (
            <CardView key={c.id} card={c} hidden={phase === "player" && i === 0} />
          ))}
        </div>
      </div>

      {/* Statement card / outcome */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
        {phase === "player" && stmt && (
          <div style={stmtBox()}>
            <div style={{ fontSize: 10, letterSpacing: 2.5, color: T.warm, fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
              Answer to draw — wrong = BUST
            </div>
            <div style={{ fontSize: "clamp(15px, 4vw, 18px)", color: "#f0eee8", fontFamily: "Georgia, serif", lineHeight: 1.45, textAlign: "center" }}>
              {stmt.text}
            </div>
            {feedback && (
              <div style={{ marginTop: 10, fontWeight: 800, fontSize: 14, color: feedback.kind === "ok" ? T.ok : T.bad }}>
                {feedback.text}
              </div>
            )}
          </div>
        )}
        {phase === "axiom" && (
          <div style={{ textAlign: "center", color: T.dim, fontSize: 13, letterSpacing: 1.5, textTransform: "uppercase" }}>
            AXIOM is drawing…
          </div>
        )}
        {phase === "result" && (
          <div style={{ textAlign: "center" }}>
            <div style={{
              fontSize: outcome === "bust" ? 48 : 32,
              fontWeight: 900, fontFamily: "Georgia, serif",
              color: outcome === "win" ? T.ok : outcome === "push" ? T.warm : T.bad,
              letterSpacing: outcome === "bust" ? 6 : 4,
              textTransform: "uppercase",
              textShadow: outcome === "bust" ? `0 0 50px ${T.bad}` : "none",
            }}>
              {outcome === "bust" ? "BUST" : outcome === "win" ? "You win" : outcome === "push" ? "Push" : "AXIOM wins"}
            </div>
            <div style={{ marginTop: 8, color: T.dim, fontSize: 12, letterSpacing: 1.5 }}>
              {outcome === "bust" ? "Hand lost — wrong answer" : `+${pointsEarned} → CLIMB`}
            </div>
            <button onClick={continueNow} style={{
              marginTop: 18,
              padding: "10px 18px",
              fontSize: 11, fontWeight: 700, letterSpacing: 2,
              textTransform: "uppercase",
              background: "rgba(232,197,71,.10)",
              color: T.warm,
              border: `1px solid rgba(232,197,71,.4)`,
              borderRadius: 10,
              cursor: "pointer", fontFamily: "inherit",
            }}>
              {currentHand < TOTAL_HANDS ? `Next hand (${currentHand + 1}/${TOTAL_HANDS}) →` : "See results →"}
            </button>
          </div>
        )}
      </div>

      {/* Player hand */}
      <div style={handRow("rgba(232,197,71,.15)")}>
        <div style={handLabel(T.warm)}>YOU · {pTot}</div>
        <div style={cardRow()}>
          {playerHand.map(c => <CardView key={c.id} card={c} />)}
        </div>
      </div>

      {/* Action buttons */}
      {phase === "player" && handState === HAND_STATE.PLAYING && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, padding: "12px 14px 16px" }}>
          <button onClick={() => handleSwipe("left")} style={btnLie()}>✗ LIE</button>
          <button onClick={handleStand} style={btnStand()}>STAND</button>
          <button onClick={() => handleSwipe("right")} style={btnTrue()}>✓ TRUE</button>
        </div>
      )}
    </div>
  );
}

function CardView({ card, hidden }) {
  if (hidden) {
    return (
      <div style={{
        width: 50, height: 70, borderRadius: 8,
        background: "linear-gradient(135deg, #4a4a64, #2a2a40)",
        border: "1px solid rgba(255,255,255,.1)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 26, color: "rgba(255,255,255,.2)", boxShadow: "0 4px 14px rgba(0,0,0,.5)",
      }}>?</div>
    );
  }
  const isRed = card.suit === "♥" || card.suit === "♦";
  return (
    <div style={{
      width: 50, height: 70, borderRadius: 8,
      background: "#f0eee8",
      color: isRed ? "#b91c1c" : "#0a0a14",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontSize: 22, fontWeight: 800, fontFamily: "Georgia, serif",
      boxShadow: "0 4px 14px rgba(0,0,0,.5)",
    }}>
      <div>{card.rank}</div>
      <div style={{ fontSize: 14 }}>{card.suit}</div>
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
    padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.04)",
  };
}
function handRow(bg) {
  return {
    background: bg,
    padding: "12px 14px",
    display: "flex", alignItems: "center", gap: 12,
    borderTop: "1px solid rgba(255,255,255,.04)",
    borderBottom: "1px solid rgba(255,255,255,.04)",
  };
}
function handLabel(color) {
  return {
    fontSize: 10, letterSpacing: 2.5, fontWeight: 800, textTransform: "uppercase",
    color, minWidth: 78,
  };
}
function cardRow() {
  return {
    display: "flex", gap: 6, flexWrap: "wrap",
  };
}
function stmtBox() {
  return {
    width: "100%", maxWidth: 380,
    padding: "20px 18px",
    background: "linear-gradient(135deg, #232336, #14141f)",
    border: "1px solid rgba(232,197,71,.18)",
    borderRadius: 16,
    boxShadow: "0 10px 40px rgba(0,0,0,.45)",
    display: "flex", flexDirection: "column", alignItems: "center",
  };
}
function btnTrue() {
  return {
    minHeight: 56, fontSize: 13, fontWeight: 800, letterSpacing: 2,
    textTransform: "uppercase",
    background: "rgba(45,212,160,0.08)", color: T.ok, border: `1.5px solid ${T.ok}`,
    borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
  };
}
function btnLie() {
  return {
    minHeight: 56, fontSize: 13, fontWeight: 800, letterSpacing: 2,
    textTransform: "uppercase",
    background: "rgba(244,63,94,0.08)", color: T.bad, border: `1.5px solid ${T.bad}`,
    borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
  };
}
function btnStand() {
  return {
    minHeight: 56, fontSize: 12, fontWeight: 700, letterSpacing: 2,
    textTransform: "uppercase",
    background: "rgba(232,197,71,.06)", color: T.warm, border: `1px solid ${T.warm}`,
    borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
  };
}

export default ClimbMiniBlackjack;

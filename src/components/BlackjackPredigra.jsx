import { useCallback, useEffect, useRef, useState } from "react";
import { t as translate } from "../i18n/index.js";
import { getCurrentIdToken } from "../auth.js";
import { captureEvent } from "../lib/telemetry.js";

// BlackjackPredigra — Best-of-3 Blackjack 21 against AXIOM as a Climb warm-up.
//
// The server (api/blackjack-deal, blackjack-question, blackjack-answer) is the
// only authority for game state. The client renders + dispatches actions; it
// never decides correctness or draws cards locally. Truth answers for TRUE/LIE
// questions are stored server-side on the session and validated atomically.
//
// Match flow
//   start_match (server)            → initial deal, hand 1, state=player_turn
//   loop:
//     question (server)             → next statement
//     answer (server)               → correct → hit; wrong → end turn
//     [or] stand                    → end turn
//   axiom_turn (server)             → AXIOM auto-plays + hand resolution
//   if !matchOver: next_hand (server) → next hand
//   else: onComplete(streakTransfer)
//
// `streakTransfer` ∈ [0, 9] is seeded into Climb's streak state by App.jsx
// before routing to "play".

const QUESTION_TIMER_S = 8;
const T = {
  bg: "#04060f", felt: "#0d4d2c", feltDark: "#082818",
  gold: "#e8c547", goldDark: "#d4af37",
  card: "#ffffff", cardCream: "#f5f5dc",
  red: "#d62828", black: "#1a1a1a",
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────

export function BlackjackPredigra({ lang = "en", userId, onComplete, onAbort }) {
  const t = (k, params) => translate(k, lang, params);

  const [phase, setPhase]             = useState("loading"); // loading | dealing | player_turn | axiom_animating | hand_resolved | match_over | error
  const [error, setError]             = useState(null);
  const [session, setSession]         = useState(null);
  const [question, setQuestion]       = useState(null);
  const [questionTime, setQuestionTime] = useState(QUESTION_TIMER_S);
  const [feedback, setFeedback]       = useState(null);   // { kind: "correct"|"wrong", lastCard? }
  const [bustOverlay, setBustOverlay] = useState(false);
  const [axiomBeat, setAxiomBeat]     = useState(null);   // { statementText, axiomCorrect, card?, sequenceIdx, sequenceTotal }
  const [handResolution, setHandResolution] = useState(null); // { handWinner, axiomFinalHand, axiomTotal, axiomBusted }

  const sessionRef        = useRef(null);
  const submittingRef     = useRef(false);   // block double-fires on rapid taps
  const finishedRef       = useRef(false);
  const questionAskedAtRef = useRef(0);
  const advanceTimerRef   = useRef(null);

  // ── Mount: start the match ─────────────────────────────
  useEffect(() => {
    captureEvent("blackjack_match_started", { userId: userId || null });
    (async () => { await startMatch(); })();
    return () => { if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startMatch() {
    try {
      const r = await authFetch("/api/blackjack-deal", {
        method: "POST",
        body: JSON.stringify({ action: "start_match", userId: userId || undefined, lang }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `start_${r.status}`);
      }
      const data = await r.json();
      sessionRef.current = data.session;
      setSession(data.session);
      captureEvent("blackjack_hand_started", { handNumber: 1 });

      setPhase("dealing");
      await sleep(700); // let the deal animation breathe
      await goToPlayerTurn();
    } catch (e) {
      setError(e.message || "load_failed");
      setPhase("error");
    }
  }

  async function goToPlayerTurn() {
    setPhase("player_turn");
    await fetchNextQuestion();
  }

  async function fetchNextQuestion() {
    const sid = sessionRef.current?.id;
    if (!sid) return;
    try {
      const r = await authFetch("/api/blackjack-question", {
        method: "POST",
        body: JSON.stringify({ sessionId: sid, userId: userId || undefined }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `q_${r.status}`);
      }
      const data = await r.json();
      setQuestion(data.statement);
      setQuestionTime(QUESTION_TIMER_S);
      questionAskedAtRef.current = Date.now();
    } catch (e) {
      setError(e.message || "question_failed");
      setPhase("error");
    }
  }

  // ── Per-question 8s timer ─────────────────────────────
  useEffect(() => {
    if (phase !== "player_turn" || !question) return;
    if (questionTime <= 0) {
      // Timeout = treat as wrong answer per spec ("auto-bust if no decision").
      handleAnswer("left", true).catch(() => {});  // direction is irrelevant if timeout, server ends turn
      return;
    }
    const id = setTimeout(() => setQuestionTime(s => s - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionTime, phase, question]);

  // ── Player actions ────────────────────────────────────
  async function handleAnswer(direction, isTimeout = false) {
    if (submittingRef.current) return;
    if (phase !== "player_turn" || !question) return;
    submittingRef.current = true;
    const reactionMs = Date.now() - (questionAskedAtRef.current || Date.now());

    try {
      const r = await authFetch("/api/blackjack-answer", {
        method: "POST",
        body: JSON.stringify({
          sessionId: sessionRef.current?.id,
          swipeDirection: direction,
          reactionMs,
          userId: userId || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `a_${r.status}`);

      if (data.session) {
        sessionRef.current = data.session;
        setSession(data.session);
      }

      if (data.correct) {
        captureEvent("blackjack_player_hit_correct", {
          newCardRank: data.newCard?.rank, special: data.newCard?.special, playerTotal: data.playerTotal,
        });
        if (data.newCard?.special) {
          captureEvent("blackjack_special_card_drawn", { type: data.newCard.special });
        }
        setFeedback({ kind: "correct", lastCard: data.newCard });
        vibrate(15);
        await sleep(800); // let the new card animate in
        setFeedback(null);

        if (data.busted) {
          captureEvent("blackjack_player_bust", { playerTotal: data.playerTotal });
          setBustOverlay(true);
          vibrate([30, 60, 30, 60, 80]);
          await sleep(1200);
          setBustOverlay(false);
          setQuestion(null);
          await runAxiomTurn();
        } else {
          submittingRef.current = false;
          await fetchNextQuestion();
        }
      } else {
        captureEvent("blackjack_player_hit_wrong", { isTimeout });
        setFeedback({ kind: "wrong" });
        vibrate([20, 50, 20]);
        await sleep(900);
        setFeedback(null);
        setQuestion(null);
        await runAxiomTurn();
      }
    } catch (e) {
      setError(e.message || "answer_failed");
      setPhase("error");
      submittingRef.current = false;
    }
  }

  async function handleStand() {
    if (submittingRef.current || phase !== "player_turn") return;
    submittingRef.current = true;
    captureEvent("blackjack_player_stand", { playerTotal: session?.player?.total });
    try {
      const r = await authFetch("/api/blackjack-deal", {
        method: "POST",
        body: JSON.stringify({ action: "stand", sessionId: sessionRef.current?.id, userId: userId || undefined }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `stand_${r.status}`);
      if (data.session) { sessionRef.current = data.session; setSession(data.session); }
      setQuestion(null);
      await runAxiomTurn();
    } catch (e) {
      setError(e.message || "stand_failed");
      setPhase("error");
      submittingRef.current = false;
    }
  }

  async function runAxiomTurn() {
    setPhase("axiom_animating");
    submittingRef.current = false;
    try {
      const r = await authFetch("/api/blackjack-deal", {
        method: "POST",
        body: JSON.stringify({ action: "axiom_turn", sessionId: sessionRef.current?.id, userId: userId || undefined }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `axiom_${r.status}`);

      // Animate AXIOM's beats one by one before showing the resolved hand.
      const beats = Array.isArray(data.axiomMoves) ? data.axiomMoves : [];
      for (let i = 0; i < beats.length; i++) {
        const b = beats[i];
        setAxiomBeat({ ...b, sequenceIdx: i, sequenceTotal: beats.length });
        await sleep(b.card ? 1800 : 1400);
      }
      setAxiomBeat(null);
      if (data.axiomBusted) captureEvent("blackjack_axiom_bust", { axiomTotal: data.axiomTotal });

      // Reveal final state.
      sessionRef.current = data.session;
      setSession(data.session);
      setHandResolution({
        handWinner:     data.handWinner,
        axiomFinalHand: data.axiomFinalHand,
        axiomTotal:     data.axiomTotal,
        axiomBusted:    data.axiomBusted,
      });
      setPhase("hand_resolved");
      captureEvent("blackjack_hand_resolved", {
        winner: data.handWinner,
        playerTotal: data.session?.player?.total,
        axiomTotal: data.axiomTotal,
      });

      // Hold the resolution screen, then advance.
      advanceTimerRef.current = setTimeout(async () => {
        if (data.matchOver) {
          captureEvent("blackjack_match_resolved", {
            matchWinner: data.matchWinner, score: data.score, streak: data.streakTransfer,
          });
          setPhase("match_over");
          // Auto-advance to Climb after the result has been read.
          advanceTimerRef.current = setTimeout(() => finishMatch(data.streakTransfer | 0), 3000);
        } else {
          setHandResolution(null);
          await nextHand();
        }
      }, 2500);
    } catch (e) {
      setError(e.message || "axiom_failed");
      setPhase("error");
    }
  }

  async function nextHand() {
    try {
      const r = await authFetch("/api/blackjack-deal", {
        method: "POST",
        body: JSON.stringify({ action: "next_hand", sessionId: sessionRef.current?.id, userId: userId || undefined }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `next_${r.status}`);
      sessionRef.current = data.session;
      setSession(data.session);
      captureEvent("blackjack_hand_started", { handNumber: data.session?.handsPlayed });
      setPhase("dealing");
      await sleep(700);
      await goToPlayerTurn();
    } catch (e) {
      setError(e.message || "next_hand_failed");
      setPhase("error");
    }
  }

  function finishMatch(initialStreak) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onComplete?.({
      initialStreak: initialStreak | 0,
      playerScore:   session?.score?.player | 0,
      axiomScore:    session?.score?.axiom  | 0,
    });
  }

  // ── Render ─────────────────────────────────────────────
  if (phase === "loading") {
    return (
      <div style={wrap()}>
        <Styles />
        <div style={{ padding: 24, textAlign: "center", color: "#e8e6e1" }}>
          <div style={{ fontSize: 11, letterSpacing: 3, color: T.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
            {t("blackjack.title")}
          </div>
          <div style={{ color: T.dim, fontSize: 13 }}>{t("blackjack.dealing")}</div>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div style={wrap()}>
        <Styles />
        <div style={{ padding: 24, textAlign: "center", maxWidth: 400, margin: "0 auto", color: "#e8e6e1" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠</div>
          <div style={{ color: T.bad, marginBottom: 12 }}>{t("blackjack.load_failed")}</div>
          <div style={{ color: T.dim, fontSize: 12, marginBottom: 18 }}>{error}</div>
          <button onClick={onAbort} style={btnSecondary()}>{t("blackjack.back_home")}</button>
        </div>
      </div>
    );
  }

  if (!session) return null;

  const playerHand = session.player?.hand || [];
  const axiomHand  = session.axiom?.hand || [];
  const playerTotal = session.player?.total | 0;
  const axiomTotal  = session.axiom?.total;  // may be null while card hidden
  const score = session.score || { player: 0, axiom: 0 };

  return (
    <div style={wrap()}>
      <Styles />

      <header style={hud()}>
        <button onClick={onAbort} style={hudBtn()} aria-label={t("blackjack.back_home")}>✕</button>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, letterSpacing: 1.5 }}>
          <span style={{ color: T.gold, fontWeight: 800, textTransform: "uppercase" }}>
            🎴 {t("blackjack.title")}
          </span>
          <span style={{ color: T.dim }}>
            {t("blackjack.hand_n", { n: session.handsPlayed | 0 })}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, fontSize: 12, fontWeight: 800 }}>
          <span style={{ color: T.ok }}>{t("blackjack.you_short")}: {score.player}</span>
          <span style={{ color: T.dim }}>·</span>
          <span style={{ color: T.bad }}>AXIOM: {score.axiom}</span>
        </div>
      </header>

      {/* AXIOM section */}
      <section style={section()}>
        <SideHeader label={`AXIOM ${axiomTotal == null ? "" : `· ${axiomTotal}`}`} color={T.bad} avatar="🤖" pulsing={phase === "axiom_animating"} />
        <Hand cards={axiomHand} busted={!!session.axiom?.busted} />
      </section>

      <div style={divider()}>· 21 ·</div>

      {/* Player section */}
      <section style={section()}>
        <SideHeader label={`${t("blackjack.you_short")} · ${playerTotal}`} color={T.ok} />
        <Hand cards={playerHand} busted={!!session.player?.busted || bustOverlay} />
        {bustOverlay && <BustOverlay label={t("blackjack.bust")} />}
      </section>

      {/* Active interaction zone */}
      {phase === "player_turn" && question && (
        <QuestionCard
          statement={question.text}
          timeLeft={questionTime}
          feedback={feedback}
          onTrue={() => handleAnswer("right")}
          onLie={() => handleAnswer("left")}
          onStand={handleStand}
          tLabels={{
            stand: t("blackjack.stand"),
            lie:   t("blackjack.lie"),
            true:  t("blackjack.true"),
          }}
          submitting={submittingRef.current}
        />
      )}

      {phase === "axiom_animating" && (
        <AxiomBeatPanel
          beat={axiomBeat}
          thinkingLabel={t("blackjack.axiom_thinking")}
        />
      )}

      {phase === "hand_resolved" && handResolution && (
        <HandResolutionPanel
          resolution={handResolution}
          you={t("blackjack.you_win")}
          axiom={t("blackjack.axiom_wins")}
          tie={t("blackjack.tie")}
          nextLabel={t("blackjack.next_hand")}
        />
      )}

      {phase === "match_over" && (
        <MatchResultPanel
          score={score}
          matchWinner={session.matchWinner}
          streak={session.streakTransfer | 0}
          tWin={t("blackjack.you_win_match")}
          tLose={t("blackjack.axiom_wins_match")}
          tTie={t("blackjack.match_tie")}
          tStreak={t("blackjack.streak_carries", { n: session.streakTransfer | 0 })}
          tAuto={t("blackjack.auto_advance")}
        />
      )}
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────

function SideHeader({ label, color, avatar, pulsing }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 14px 8px", color }}>
      {avatar && (
        <div style={{
          fontSize: 22, lineHeight: 1,
          animation: pulsing ? "bj-axiom-pulse 1.2s ease-in-out infinite" : "none",
          textShadow: `0 0 14px ${color}80`,
        }}>{avatar}</div>
      )}
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, textTransform: "uppercase" }}>{label}</div>
    </div>
  );
}

function Hand({ cards, busted }) {
  return (
    <div style={{
      display: "flex", justifyContent: "center", alignItems: "flex-end",
      padding: "8px 16px 0", minHeight: 130,
      filter: busted ? "saturate(.5) brightness(.85)" : "none",
      transition: "filter .25s",
    }}>
      {cards.map((card, idx) => {
        const lift = idx % 2 === 0 ? -1 : 1;
        const tilt = (idx - cards.length / 2) * 2;
        return (
          <div key={idx} style={{
            transform: `translateY(${lift * 2}px) rotate(${tilt}deg)`,
            marginLeft: idx === 0 ? 0 : -22,
            animation: "bj-card-deal .55s cubic-bezier(.34,1.56,.64,1) both",
            animationDelay: `${idx * 70}ms`,
            zIndex: idx,
          }}>
            <Card card={card} />
          </div>
        );
      })}
    </div>
  );
}

function Card({ card }) {
  if (card?.hidden) {
    return (
      <div style={{
        ...cardBase(), background: "linear-gradient(135deg,#4a148c,#1a0033)",
        borderColor: "#ffd700",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 28, color: "#ffd700",
      }}>🎴</div>
    );
  }
  if (card?.special === "axiom_error") {
    return (
      <div style={{
        ...cardBase(), background: "linear-gradient(135deg,#ffd700,#ff6b00)",
        color: T.black,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 2,
      }}>
        <div style={{ fontSize: 26 }}>⚡</div>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1 }}>−3 AXIOM</div>
      </div>
    );
  }
  if (card?.special === "double") {
    return (
      <div style={{
        ...cardBase(), background: "linear-gradient(135deg,#00ffaa,#00aaff)",
        color: T.black,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 30, fontWeight: 900,
      }}>×2</div>
    );
  }

  const isRed = card?.suit === "♥" || card?.suit === "♦";
  const color = isRed ? T.red : T.black;
  return (
    <div style={cardBase()}>
      <div style={{ position: "absolute", top: 6, left: 6, color, fontSize: 14, fontWeight: 800, lineHeight: 1 }}>
        <div>{card?.rank}</div>
        <div style={{ fontSize: 14 }}>{card?.suit}</div>
      </div>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color, fontSize: 36 }}>
        {card?.suit}
      </div>
      <div style={{
        position: "absolute", bottom: 6, right: 6, color, fontSize: 14, fontWeight: 800, lineHeight: 1,
        transform: "rotate(180deg)",
      }}>
        <div>{card?.rank}</div>
        <div style={{ fontSize: 14 }}>{card?.suit}</div>
      </div>
      {card?.doubled && (
        <div style={{
          position: "absolute", top: -6, right: -6,
          background: "#00ffaa", color: T.black,
          fontSize: 9, fontWeight: 900, padding: "2px 5px", borderRadius: 8,
          border: `1px solid ${T.black}`,
        }}>×2</div>
      )}
    </div>
  );
}

function QuestionCard({ statement, timeLeft, feedback, onTrue, onLie, onStand, tLabels, submitting }) {
  const flashBg = feedback?.kind === "correct" ? "rgba(45,212,160,.18)"
                : feedback?.kind === "wrong"   ? "rgba(244,63,94,.20)"
                : "transparent";
  return (
    <div style={{
      margin: "12px 14px 16px", padding: 14, borderRadius: 14,
      background: `${flashBg}, rgba(15,15,26,.85)`,
      border: `1px solid ${T.gb}`,
      transition: "background .25s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: T.dim, textTransform: "uppercase" }}>
          🎴 {/* hand symbol */}
        </div>
        <div style={{
          fontSize: 13, fontWeight: 800,
          color: timeLeft <= 3 ? T.bad : T.gold,
          fontFamily: "Georgia, serif",
        }}>
          {timeLeft}s
        </div>
      </div>
      <div style={{
        fontSize: "clamp(15px, 4vw, 18px)", lineHeight: 1.45,
        color: "#f0eee8", fontFamily: "Georgia, serif",
        textAlign: "center", padding: "10px 6px",
      }}>
        “{statement}”
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={onLie}  disabled={submitting} style={btnLie()}>✗ {tLabels.lie}</button>
        <button onClick={onStand} disabled={submitting} style={btnStand()}>🛑 {tLabels.stand}</button>
        <button onClick={onTrue} disabled={submitting} style={btnTrue()}>✓ {tLabels.true}</button>
      </div>
    </div>
  );
}

function BustOverlay({ label }) {
  return (
    <div style={{
      position: "absolute", left: "50%", top: "50%",
      transform: "translate(-50%,-50%)",
      fontSize: 36, fontWeight: 900, color: T.bad,
      letterSpacing: 6, textShadow: "0 4px 14px rgba(0,0,0,.65)",
      animation: "bj-bust-flash .9s ease",
      pointerEvents: "none",
      whiteSpace: "nowrap",
    }}>💥 {label}</div>
  );
}

function AxiomBeatPanel({ beat, thinkingLabel }) {
  if (!beat) {
    return (
      <div style={beatPanel()}>
        <div style={{ fontSize: 12, color: T.dim, fontStyle: "italic" }}>{thinkingLabel}</div>
      </div>
    );
  }
  return (
    <div style={beatPanel()}>
      <div style={{ fontSize: 11, letterSpacing: 2, color: T.bad, textTransform: "uppercase", fontWeight: 800, marginBottom: 6 }}>
        AXIOM · {beat.sequenceIdx + 1}/{beat.sequenceTotal}
      </div>
      <div style={{
        fontSize: "clamp(13px, 3.6vw, 15px)", lineHeight: 1.45,
        color: "#f0eee8", fontFamily: "Georgia, serif", padding: "6px 4px 10px",
      }}>
        “{beat.statementText}”
      </div>
      <div style={{
        fontSize: 13, fontWeight: 800, letterSpacing: 1,
        color: beat.axiomCorrect ? T.ok : T.bad,
      }}>
        {beat.axiomCorrect ? `${beat.card ? "😏 hits" : "😏 correct"}` : "😤 wrong"}
      </div>
    </div>
  );
}

function HandResolutionPanel({ resolution, you, axiom, tie, nextLabel }) {
  const w = resolution.handWinner;
  const text = w === "player" ? you : w === "axiom" ? axiom : tie;
  const color = w === "player" ? T.ok : w === "axiom" ? T.bad : T.dim;
  return (
    <div style={{ ...beatPanel(), textAlign: "center" }}>
      <div style={{ fontSize: 18, fontWeight: 800, color, letterSpacing: 1 }}>{text}</div>
      <div style={{ fontSize: 11, color: T.dim, marginTop: 6 }}>{nextLabel}</div>
    </div>
  );
}

function MatchResultPanel({ score, matchWinner, streak, tWin, tLose, tTie, tStreak, tAuto }) {
  const text = matchWinner === "player" ? tWin : matchWinner === "axiom" ? tLose : tTie;
  const color = matchWinner === "player" ? T.ok : matchWinner === "axiom" ? T.bad : T.gold;
  return (
    <div style={{ ...beatPanel(), textAlign: "center", animation: "bj-result-in .5s ease both" }}>
      <div style={{ fontSize: 26, fontWeight: 900, color, letterSpacing: 2, fontFamily: "Georgia, serif" }}>{text}</div>
      <div style={{ fontSize: 13, color: T.dim, marginTop: 8 }}>
        {score.player} · {score.axiom}
      </div>
      <div style={{ fontSize: 14, color: T.gold, marginTop: 10, fontWeight: 700 }}>
        🔥 {tStreak}
      </div>
      <div style={{ fontSize: 11, color: T.dim, marginTop: 12, fontStyle: "italic" }}>{tAuto}</div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────

function wrap() {
  return {
    minHeight: "100dvh",
    background: `radial-gradient(ellipse at 50% 30%, ${T.felt} 0%, ${T.feltDark} 70%)`,
    color: "#e8e6e1",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    display: "flex", flexDirection: "column",
    position: "relative", overflow: "hidden",
    paddingBottom: "max(20px, env(safe-area-inset-bottom))",
  };
}
function hud() {
  return {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,.05)",
    background: "rgba(0,0,0,.18)",
  };
}
function hudBtn() {
  return {
    width: 32, height: 32, borderRadius: 8,
    background: "transparent", color: "#e8e6e1",
    border: "1px solid rgba(255,255,255,.12)",
    cursor: "pointer", fontFamily: "inherit", fontSize: 14,
  };
}
function section() {
  return {
    padding: "10px 0",
    position: "relative",
  };
}
function divider() {
  return {
    textAlign: "center", fontSize: 11,
    letterSpacing: 8, color: "rgba(232,197,71,.4)",
    margin: "8px 0 4px", fontFamily: "Georgia, serif",
  };
}
function cardBase() {
  return {
    width: 64, height: 92,
    background: `linear-gradient(135deg, ${T.card} 0%, ${T.cardCream} 100%)`,
    borderRadius: 8, border: `2px solid ${T.goldDark}`,
    boxShadow: "0 4px 10px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.5)",
    position: "relative",
    fontFamily: "Georgia, serif",
  };
}
function beatPanel() {
  return {
    margin: "12px 14px 16px", padding: "14px 16px",
    borderRadius: 14, background: "rgba(15,15,26,.85)",
    border: `1px solid ${T.gb}`,
    minHeight: 90,
  };
}
function btnLie() {
  return {
    flex: 1, minHeight: 50, fontSize: 13, fontWeight: 800, letterSpacing: 1.5,
    textTransform: "uppercase",
    background: "rgba(244,63,94,.10)", color: T.bad, border: `1.5px solid ${T.bad}`,
    borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
  };
}
function btnTrue() {
  return {
    flex: 1, minHeight: 50, fontSize: 13, fontWeight: 800, letterSpacing: 1.5,
    textTransform: "uppercase",
    background: "rgba(45,212,160,.10)", color: T.ok, border: `1.5px solid ${T.ok}`,
    borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
  };
}
function btnStand() {
  return {
    flex: 1, minHeight: 50, fontSize: 12, fontWeight: 800, letterSpacing: 1.5,
    textTransform: "uppercase",
    background: "rgba(232,197,71,.08)", color: T.gold, border: `1px solid ${T.gold}`,
    borderRadius: 12, cursor: "pointer", fontFamily: "inherit",
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

// Inline keyframes — V2Styles isn't mounted in the legacy Climb flow, so we
// ship a focused subset of animation defs alongside the component.
function Styles() {
  return <style>{`
    @keyframes bj-card-deal {
      from { transform: translate(40px, -120px) rotate(40deg); opacity: 0; }
      to   { transform: translate(0, 0) rotate(var(--bj-tilt, 0deg)); opacity: 1; }
    }
    @keyframes bj-bust-flash {
      0% { opacity: 0; transform: translate(-50%,-50%) scale(.6); }
      40% { opacity: 1; transform: translate(-50%,-50%) scale(1.2); }
      100% { opacity: 0; transform: translate(-50%,-50%) scale(1); }
    }
    @keyframes bj-axiom-pulse {
      0%, 100% { transform: scale(1); filter: brightness(1); }
      50%      { transform: scale(1.15); filter: brightness(1.25); }
    }
    @keyframes bj-result-in {
      from { opacity: 0; transform: translateY(8px) scale(.96); }
      to   { opacity: 1; transform: translateY(0)    scale(1); }
    }
  `}</style>;
}

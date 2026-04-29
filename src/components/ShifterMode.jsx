import { useEffect, useMemo, useRef, useState } from "react";
import { generateLetters, getMatchedLetters } from "../lib/letterPool.js";
import { t as translate } from "../i18n/index.js";

// AXIOM Shifter — 5-round letter match. Each round:
//   1. Reveal 8 letters (4 vowels + 4 consonants).
//   2. 45s timer; user types a true factual statement.
//   3. Lock in → server judges (grammar/factuality/letter matches).
//   4. AXIOM "thinks" (real call to /api/shifter-axiom) → competing line.
//   5. Higher score wins the round.
//
// Self-contained: owns its match state. Calls onExit to bail, onComplete
// with the final summary so App.jsx can persist stats / SWEAR.

const ROUNDS = 5;
const TIMER_SECONDS = 45;

const T = {
  bg: "#04060f", card: "#0f0f1a", gold: "#e8c547",
  ok: "#2dd4a0", bad: "#f43f5e", dim: "#5a5a68",
  glass: "rgba(255,255,255,.03)", gb: "rgba(255,255,255,.07)",
};

function fetchJSON(url, body, timeoutMs = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: ctrl.signal,
  })
    .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j)).catch(() => Promise.reject({ error: `HTTP ${r.status}` })))
    .finally(() => clearTimeout(timer));
}

function playAxiomLine(text, skin) {
  if (!text) return;
  fetch("/api/axiom-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, skin }),
  })
    .then(r => r.ok ? r.blob() : null)
    .then(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 0.9;
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      const p = audio.play();
      if (p?.catch) p.catch(() => {});
    })
    .catch(() => {});
}

export function ShifterMode({ lang = "en", skin = "default", onExit, onComplete }) {
  const t = (k, params) => translate(k, lang, params);

  // Match-level state
  const [round, setRound] = useState(0); // 0..ROUNDS-1
  const [userScores, setUserScores] = useState([]);
  const [axiomScores, setAxiomScores] = useState([]);
  const [done, setDone] = useState(false);

  // Round-level state
  const [letters, setLetters] = useState(() => generateLetters(lang));
  const [statement, setStatement] = useState("");
  const [time, setTime] = useState(TIMER_SECONDS);
  const [locked, setLocked] = useState(false);
  const [judging, setJudging] = useState(false);
  const [judgeResult, setJudgeResult] = useState(null);
  const [axiomThinking, setAxiomThinking] = useState(false);
  const [axiomResult, setAxiomResult] = useState(null);
  const [error, setError] = useState(null);

  const timerRef = useRef(null);
  const lockedRef = useRef(false);

  // Derived: live letter matches for the highlight strip.
  const matched = useMemo(() => getMatchedLetters(statement, letters), [statement, letters]);

  // Timer
  useEffect(() => {
    if (locked || done) return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTime(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          if (!lockedRef.current) {
            // Auto-lock at zero — judge whatever they typed.
            lockedRef.current = true;
            setLocked(true);
            doJudge();
          }
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, locked, done]);

  async function doJudge() {
    setJudging(true);
    setError(null);
    const trimmed = statement.trim();
    let userScore = 0;
    let resultPayload = null;
    if (trimmed.length === 0) {
      // Empty submission: zero out instantly, skip server call.
      resultPayload = {
        letterMatches: [],
        grammarValid: false,
        factuallyTrue: "false",
        score: 0,
        feedback: t("shifter.no_answer"),
      };
    } else {
      try {
        resultPayload = await fetchJSON("/api/shifter-judge", {
          letters, userStatement: trimmed, lang,
        });
        userScore = resultPayload?.score | 0;
      } catch (e) {
        setError(e?.error || "judge_failed");
        resultPayload = {
          letterMatches: [], grammarValid: false, factuallyTrue: "false",
          score: 0, feedback: t("shifter.judge_failed"),
        };
      }
    }
    setJudgeResult(resultPayload);
    setJudging(false);

    // AXIOM "thinks"
    setAxiomThinking(true);
    let axiomData = null;
    try {
      axiomData = await fetchJSON("/api/shifter-axiom", { letters, lang });
    } catch (e) {
      axiomData = {
        statement: t("shifter.axiom_silent"),
        lettersUsed: [],
        thinking: "",
      };
    }
    // Compute AXIOM score deterministically client-side: count letter matches
    // against the same pool. Server already computed them; we trust the AI's
    // own list but cap by what the letters allow.
    const axiomMatched = getMatchedLetters(axiomData.statement, letters);
    const axiomScore = axiomMatched.length * 10;
    axiomData.score = axiomScore;
    axiomData.lettersMatched = axiomMatched;
    setAxiomResult(axiomData);
    setAxiomThinking(false);

    // Voice line based on round outcome.
    const youWon = userScore > axiomScore;
    const tied = userScore === axiomScore;
    if (youWon) playAxiomLine("Impressive. I'll do better next time.", skin);
    else if (tied) playAxiomLine("A draw. We'll see who blinks first.", skin);
    else playAxiomLine("You'll get me eventually. Keep trying.", skin);

    setUserScores(prev => [...prev, userScore]);
    setAxiomScores(prev => [...prev, axiomScore]);
  }

  function nextRound() {
    if (round + 1 >= ROUNDS) {
      finishMatch();
      return;
    }
    setRound(r => r + 1);
    setLetters(generateLetters(lang));
    setStatement("");
    setTime(TIMER_SECONDS);
    setLocked(false);
    lockedRef.current = false;
    setJudgeResult(null);
    setAxiomResult(null);
    setError(null);
  }

  function finishMatch() {
    setDone(true);
    const wins = userScores.filter((s, i) => s > (axiomScores[i] || 0)).length;
    const cleanSweep = wins === ROUNDS;
    onComplete?.({
      mode: "shifter",
      rounds: ROUNDS,
      wins,
      losses: ROUNDS - wins,
      cleanSweep,
      userTotal: userScores.reduce((a, b) => a + b, 0),
      axiomTotal: axiomScores.reduce((a, b) => a + b, 0),
    });
  }

  function handleLockIn() {
    if (locked) return;
    lockedRef.current = true;
    setLocked(true);
    clearInterval(timerRef.current);
    doJudge();
  }

  // ── End-of-match summary ──
  if (done) {
    const wins = userScores.filter((s, i) => s > (axiomScores[i] || 0)).length;
    return (
      <SummaryScreen
        title={t("shifter.title")}
        wins={wins}
        rounds={ROUNDS}
        userTotal={userScores.reduce((a, b) => a + b, 0)}
        axiomTotal={axiomScores.reduce((a, b) => a + b, 0)}
        onExit={onExit}
        lang={lang}
      />
    );
  }

  return (
    <div style={wrapStyle()}>
      <Header
        title={t("shifter.title")}
        roundLabel={t("shifter.round_of", { n: round + 1, total: ROUNDS })}
        onExit={onExit}
        lang={lang}
      />

      <div style={{ width: "100%", maxWidth: 460, padding: "0 16px", boxSizing: "border-box" }}>
        <ScoreBar lang={lang} userTotal={userScores.reduce((a, b) => a + b, 0)} axiomTotal={axiomScores.reduce((a, b) => a + b, 0)} />

        {/* Letter cards */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6,
          margin: "16px 0 10px",
        }}>
          {letters.map((L, i) => {
            const isMatched = matched.includes(L);
            return (
              <div key={i} style={{
                aspectRatio: "1 / 1",
                background: isMatched ? "rgba(45,212,160,0.18)" : T.glass,
                border: `1.5px solid ${isMatched ? "rgba(45,212,160,0.7)" : T.gb}`,
                borderRadius: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "clamp(16px, 5vw, 22px)", fontWeight: 800,
                fontFamily: "Georgia, serif",
                color: isMatched ? "#2dd4a0" : "#e8e6e1",
                textTransform: "uppercase",
                transition: "all 200ms",
                animation: `g-fadeUp .35s ${i * 0.04}s both`,
              }}>
                {L}
                {isMatched && (
                  <div style={{ position: "absolute", marginTop: 32, fontSize: 9, color: "#2dd4a0", fontWeight: 700 }}>✓</div>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 11, color: T.dim, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>
          {t("shifter.matches", { n: matched.length, total: 8 })}
        </div>

        {/* Statement input */}
        <textarea
          value={statement}
          onChange={(e) => setStatement(e.target.value.slice(0, 400))}
          placeholder={t("shifter.input_placeholder")}
          disabled={locked}
          rows={3}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: 12, borderRadius: 12,
            background: T.card, color: "#e8e6e1",
            border: `1.5px solid ${locked ? T.gb : "rgba(232,197,71,0.3)"}`,
            fontSize: "clamp(13px, 3.6vw, 15px)",
            fontFamily: "inherit",
            resize: "none",
            outline: "none",
            lineHeight: 1.5,
          }}
        />

        {/* Timer */}
        {!locked && (
          <div style={{
            marginTop: 8, marginBottom: 10,
            display: "flex", justifyContent: "space-between", alignItems: "center",
            color: time <= 10 ? T.bad : T.dim,
            fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700,
          }}>
            <span>{t("shifter.timer_label")}: {time}s</span>
            <span style={{ color: T.gold }}>{t("shifter.score_preview", { n: matched.length * 10 })}</span>
          </div>
        )}

        {!locked && (
          <button
            onClick={handleLockIn}
            disabled={statement.trim().length === 0}
            style={{
              width: "100%", minHeight: 52, padding: 14,
              fontSize: 13, fontWeight: 800, letterSpacing: 2.5,
              textTransform: "uppercase",
              background: statement.trim().length === 0
                ? "rgba(255,255,255,.04)"
                : "linear-gradient(135deg,#e8c547,#d4a830)",
              color: statement.trim().length === 0 ? "rgba(232,197,71,0.3)" : T.bg,
              border: "none", borderRadius: 14,
              cursor: statement.trim().length === 0 ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              transition: "transform 150ms",
            }}
          >
            {t("shifter.lock_in")}
          </button>
        )}

        {/* Reveal block */}
        {locked && (
          <RevealBlock
            judging={judging}
            judgeResult={judgeResult}
            axiomThinking={axiomThinking}
            axiomResult={axiomResult}
            error={error}
            onNext={nextRound}
            isLast={round + 1 >= ROUNDS}
            lang={lang}
          />
        )}
      </div>
    </div>
  );
}

function RevealBlock({ judging, judgeResult, axiomThinking, axiomResult, error, onNext, isLast, lang }) {
  const t = (k, params) => translate(k, lang, params);
  return (
    <div style={{ marginTop: 14, animation: "g-fadeUp .35s both" }}>
      <div style={{ background: T.glass, border: `1px solid ${T.gb}`, borderRadius: 12, padding: 14, marginBottom: 10 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.6, color: T.dim, textTransform: "uppercase", marginBottom: 6 }}>
          {t("shifter.your_score")}
        </div>
        {judging
          ? <ThinkingDots label={t("shifter.judging")} />
          : (
            <>
              <div style={{ fontSize: 28, fontWeight: 800, color: T.gold, fontFamily: "Georgia, serif" }}>
                {judgeResult?.score ?? 0}
              </div>
              {judgeResult?.feedback && (
                <div style={{ fontSize: 12, color: "rgba(232,230,225,.7)", marginTop: 4 }}>
                  {judgeResult.feedback}
                </div>
              )}
              {judgeResult?.factuallyTrue === "false" && (
                <div style={{ fontSize: 11, color: T.bad, marginTop: 4 }}>
                  {t("shifter.fact_false")}
                </div>
              )}
              {judgeResult?.factuallyTrue === "partial" && (
                <div style={{ fontSize: 11, color: "#fb923c", marginTop: 4 }}>
                  {t("shifter.fact_partial")}
                </div>
              )}
            </>
          )}
      </div>
      <div style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
        <div style={{ fontSize: 10, letterSpacing: 1.6, color: "rgba(34,211,238,0.7)", textTransform: "uppercase", marginBottom: 6 }}>
          {t("shifter.axiom_answer")}
        </div>
        {axiomThinking
          ? <ThinkingDots label={t("shifter.thinking")} />
          : (
            <>
              <div style={{ fontSize: 13, color: "#e8e6e1", lineHeight: 1.5, marginBottom: 6 }}>
                "{axiomResult?.statement}"
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#22d3ee", fontFamily: "Georgia, serif" }}>
                {axiomResult?.score ?? 0}
              </div>
            </>
          )}
      </div>
      {error && (
        <div style={{ fontSize: 11, color: T.bad, marginBottom: 10 }}>{error}</div>
      )}
      {!judging && !axiomThinking && (
        <button
          onClick={onNext}
          style={{
            width: "100%", minHeight: 52, padding: 14,
            fontSize: 13, fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase",
            background: "linear-gradient(135deg,#22d3ee,#0ea5e9)",
            color: T.bg, border: "none", borderRadius: 14,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          {isLast ? t("shifter.see_results") : t("shifter.next_round")}
        </button>
      )}
    </div>
  );
}

export function ScoreBar({ lang, userTotal, axiomTotal }) {
  const t = (k, params) => translate(k, lang, params);
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8,
      marginTop: 8,
    }}>
      <div style={{ background: T.glass, border: `1px solid ${T.gb}`, borderRadius: 10, padding: "8px 10px" }}>
        <div style={{ fontSize: 9, color: T.dim, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700 }}>{t("shifter.you")}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: T.gold, fontFamily: "Georgia, serif" }}>{userTotal}</div>
      </div>
      <div style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: 10, padding: "8px 10px" }}>
        <div style={{ fontSize: 9, color: "rgba(34,211,238,0.7)", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700 }}>AXIOM</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#22d3ee", fontFamily: "Georgia, serif" }}>{axiomTotal}</div>
      </div>
    </div>
  );
}

export function Header({ title, roundLabel, onExit, lang }) {
  const t = (k, params) => translate(k, lang, params);
  return (
    <div style={{
      width: "100%", maxWidth: 460,
      padding: "max(14px, env(safe-area-inset-top)) 16px 8px",
      boxSizing: "border-box",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <button onClick={onExit} style={{
        background: "transparent", color: T.dim, border: `1px solid ${T.gb}`,
        borderRadius: 8, padding: "6px 10px", fontSize: 11, letterSpacing: 1.5,
        textTransform: "uppercase", cursor: "pointer", fontFamily: "inherit",
      }}>← {t("shifter.exit")}</button>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 11, letterSpacing: 2.5, color: T.gold, fontWeight: 700, textTransform: "uppercase" }}>{title}</div>
        <div style={{ fontSize: 10, color: T.dim, letterSpacing: 1.2, textTransform: "uppercase", marginTop: 2 }}>{roundLabel}</div>
      </div>
    </div>
  );
}

export function ThinkingDots({ label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: T.dim, fontSize: 12 }}>
      <span>{label}</span>
      <span style={{ display: "inline-flex", gap: 2 }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: "50%", background: T.gold,
            animation: `g-tapPulse 1s ${i * 0.15}s ease-in-out infinite`,
          }} />
        ))}
      </span>
    </div>
  );
}

export function SummaryScreen({ title, wins, rounds, userTotal, axiomTotal, onExit, lang }) {
  const t = (k, params) => translate(k, lang, params);
  const win = wins > rounds / 2;
  const cleanSweep = wins === rounds;
  return (
    <div style={wrapStyle()}>
      <div style={{ width: "100%", maxWidth: 420, padding: 24, textAlign: "center", animation: "g-fadeUp .5s both" }}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: T.gold, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 48, fontWeight: 900, fontFamily: "Georgia, serif", color: cleanSweep ? "#22d3ee" : win ? T.ok : T.bad, marginBottom: 8 }}>
          {cleanSweep ? "🏆" : win ? "★" : "—"}
        </div>
        <div style={{ fontSize: 18, color: "#e8e6e1", marginBottom: 16, fontFamily: "Georgia, serif" }}>
          {cleanSweep ? t("shifter.clean_sweep") : win ? t("shifter.you_won_match") : t("shifter.axiom_won_match")}
        </div>
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18,
        }}>
          <div style={{ background: T.glass, border: `1px solid ${T.gb}`, borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 10, color: T.dim, letterSpacing: 1.5, textTransform: "uppercase" }}>{t("shifter.you")}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: T.gold, fontFamily: "Georgia, serif" }}>{userTotal}</div>
          </div>
          <div style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 10, color: "rgba(34,211,238,0.7)", letterSpacing: 1.5, textTransform: "uppercase" }}>AXIOM</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: "#22d3ee", fontFamily: "Georgia, serif" }}>{axiomTotal}</div>
          </div>
        </div>
        <div style={{ fontSize: 13, color: T.dim, marginBottom: 18 }}>
          {t("shifter.match_summary", { wins, total: rounds })}
        </div>
        <button onClick={onExit} style={{
          width: "100%", minHeight: 52, padding: 14,
          fontSize: 13, fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase",
          background: "linear-gradient(135deg,#e8c547,#d4a830)",
          color: T.bg, border: "none", borderRadius: 14,
          cursor: "pointer", fontFamily: "inherit",
        }}>{t("shifter.back_home")}</button>
      </div>
    </div>
  );
}

function wrapStyle() {
  return {
    minHeight: "100dvh",
    background: `radial-gradient(ellipse at 50% 0%,rgba(232,197,71,.05) 0%,${T.bg} 55%)`,
    fontFamily: "'Segoe UI',system-ui,sans-serif",
    color: "#e8e6e1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBottom: 24,
  };
}

export default ShifterMode;

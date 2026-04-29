import { useEffect, useMemo, useRef, useState } from "react";
import { generatePuzzle, evalExpression, verifyNumbersUsed } from "../lib/numberGenerator.js";
import { t as translate } from "../i18n/index.js";
import { Header, ScoreBar, ThinkingDots, SummaryScreen } from "./ShifterMode.jsx";

// AXIOM Numbers — 5-round Brojke i slova / Countdown puzzle. Each round:
//   1. Reveal 6 numbers + a target.
//   2. 60s timer; user builds expression by tapping number cards + ops.
//   3. Lock in → server validates expression and scores by distance.
//   4. AXIOM solves the puzzle (with intentional 5s thinking budget).
//   5. Higher score wins.
//
// Tap-to-build UI prevents typo errors. Each number can be used once;
// the card fades after it's added to the expression and re-enables on
// backspace if removed.

const ROUNDS = 5;
const TIMER_SECONDS = 60;
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

// Tokens are objects: { kind: "num"|"op"|"paren", value: string, numIdx?: number }
// numIdx tracks the slot in the original numbers array so we can
// re-enable the card on backspace.
function tokensToString(tokens) {
  return tokens.map(t => t.value).join(" ");
}

export function NumbersMode({ lang = "en", skin = "default", onExit, onComplete }) {
  const t = (k, params) => translate(k, lang, params);

  const [round, setRound] = useState(0);
  const [userScores, setUserScores] = useState([]);
  const [axiomScores, setAxiomScores] = useState([]);
  const [done, setDone] = useState(false);

  const [{ numbers, target }, setPuzzle] = useState(() => generatePuzzle("easy"));
  const [tokens, setTokens] = useState([]);
  const [usedSlots, setUsedSlots] = useState(() => new Set());
  const [time, setTime] = useState(TIMER_SECONDS);
  const [locked, setLocked] = useState(false);
  const [judging, setJudging] = useState(false);
  const [judgeResult, setJudgeResult] = useState(null);
  const [axiomThinking, setAxiomThinking] = useState(false);
  const [axiomResult, setAxiomResult] = useState(null);
  const [error, setError] = useState(null);

  const timerRef = useRef(null);
  const lockedRef = useRef(false);

  const exprStr = useMemo(() => tokensToString(tokens), [tokens]);
  const liveResult = useMemo(() => evalExpression(exprStr), [exprStr]);
  const liveDelta = liveResult == null ? null : Math.abs(liveResult - target);

  // Timer
  useEffect(() => {
    if (locked || done) return;
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTime(t => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          if (!lockedRef.current) {
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

  function tapNumber(numIdx) {
    if (locked) return;
    if (usedSlots.has(numIdx)) return;
    const value = String(numbers[numIdx]);
    setTokens(prev => [...prev, { kind: "num", value, numIdx }]);
    setUsedSlots(prev => {
      const next = new Set(prev);
      next.add(numIdx);
      return next;
    });
  }

  function tapOp(op) {
    if (locked) return;
    setTokens(prev => [...prev, { kind: "op", value: op }]);
  }

  function tapParen(paren) {
    if (locked) return;
    setTokens(prev => [...prev, { kind: "paren", value: paren }]);
  }

  function backspace() {
    if (locked) return;
    setTokens(prev => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      const removed = prev[prev.length - 1];
      if (removed?.kind === "num" && Number.isFinite(removed.numIdx)) {
        setUsedSlots(s => {
          const out = new Set(s);
          out.delete(removed.numIdx);
          return out;
        });
      }
      return next;
    });
  }

  function clearExpr() {
    if (locked) return;
    setTokens([]);
    setUsedSlots(new Set());
  }

  async function doJudge() {
    setJudging(true);
    setError(null);
    let resultPayload = null;
    let userScore = 0;
    const expression = exprStr.trim();
    if (expression.length === 0) {
      resultPayload = { result: null, difference: null, score: 0, valid: false, error: "no_answer" };
    } else if (!verifyNumbersUsed(expression, numbers)) {
      resultPayload = { result: null, difference: null, score: 0, valid: false, error: "invalid_numbers" };
    } else {
      try {
        resultPayload = await fetchJSON("/api/numbers-judge", {
          numbers, target, expression,
        });
        userScore = resultPayload?.score | 0;
      } catch (e) {
        setError(e?.error || "judge_failed");
        resultPayload = { result: null, difference: null, score: 0, valid: false };
      }
    }
    setJudgeResult(resultPayload);
    setJudging(false);

    setAxiomThinking(true);
    let axiomData = null;
    try {
      axiomData = await fetchJSON("/api/numbers-axiom", { numbers, target });
    } catch {
      axiomData = { expression: "—", result: null, difference: null, thinking: "" };
    }
    let axiomScore = 0;
    if (axiomData?.difference != null) {
      const d = axiomData.difference;
      if (d === 0) axiomScore = 100;
      else if (d <= 5) axiomScore = 50;
      else if (d <= 10) axiomScore = 25;
    }
    axiomData.score = axiomScore;
    setAxiomResult(axiomData);
    setAxiomThinking(false);

    const youWon = userScore > axiomScore;
    const tied = userScore === axiomScore;
    if (youWon) playAxiomLine("Cleverer than I expected.", skin);
    else if (tied) playAxiomLine("A draw. Tighten your math.", skin);
    else playAxiomLine("Numbers are my native tongue.", skin);

    setUserScores(prev => [...prev, userScore]);
    setAxiomScores(prev => [...prev, axiomScore]);
  }

  function nextRound() {
    if (round + 1 >= ROUNDS) {
      finishMatch();
      return;
    }
    setRound(r => r + 1);
    setPuzzle(generatePuzzle("easy"));
    setTokens([]);
    setUsedSlots(new Set());
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
      mode: "numbers",
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
    if (tokens.length === 0) return;
    lockedRef.current = true;
    setLocked(true);
    clearInterval(timerRef.current);
    doJudge();
  }

  if (done) {
    const wins = userScores.filter((s, i) => s > (axiomScores[i] || 0)).length;
    return (
      <SummaryScreen
        title={t("numbers.title")}
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
        title={t("numbers.title")}
        roundLabel={t("shifter.round_of", { n: round + 1, total: ROUNDS })}
        onExit={onExit}
        lang={lang}
      />

      <div style={{ width: "100%", maxWidth: 460, padding: "0 16px", boxSizing: "border-box" }}>
        <ScoreBar lang={lang} userTotal={userScores.reduce((a, b) => a + b, 0)} axiomTotal={axiomScores.reduce((a, b) => a + b, 0)} />

        {/* Target */}
        <div style={{
          margin: "16px 0 12px", padding: "16px 20px",
          background: "linear-gradient(135deg, rgba(232,197,71,0.18), rgba(232,197,71,0.05))",
          border: "1.5px solid rgba(232,197,71,0.4)",
          borderRadius: 14,
          textAlign: "center",
        }}>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "rgba(232,197,71,0.7)", textTransform: "uppercase", fontWeight: 700, marginBottom: 4 }}>
            {t("numbers.target")}
          </div>
          <div style={{ fontSize: 44, fontWeight: 900, color: T.gold, fontFamily: "Georgia, serif", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
            {target}
          </div>
        </div>

        {/* Number cards */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 6, marginBottom: 12,
        }}>
          {numbers.map((n, idx) => {
            const used = usedSlots.has(idx);
            return (
              <button
                key={idx}
                onClick={() => tapNumber(idx)}
                disabled={used || locked}
                style={{
                  aspectRatio: "1 / 1",
                  background: used ? "rgba(255,255,255,0.02)" : T.card,
                  border: `1.5px solid ${used ? T.gb : "rgba(232,197,71,0.3)"}`,
                  color: used ? T.dim : T.gold,
                  borderRadius: 10,
                  fontSize: "clamp(14px, 4.5vw, 20px)",
                  fontWeight: 800,
                  fontFamily: "Georgia, serif",
                  cursor: used || locked ? "not-allowed" : "pointer",
                  opacity: used ? 0.45 : 1,
                  transition: "all 200ms",
                  fontFamilyNumeric: "tabular-nums",
                }}
              >
                {n}
              </button>
            );
          })}
        </div>

        {/* Expression display */}
        <div style={{
          background: T.card, border: `1.5px solid ${T.gb}`,
          borderRadius: 12, padding: "10px 12px",
          fontSize: "clamp(13px, 4vw, 16px)",
          fontFamily: "ui-monospace, monospace",
          color: "#e8e6e1", minHeight: 40,
          marginBottom: 8,
          wordBreak: "break-all",
        }}>
          {exprStr || <span style={{ color: T.dim }}>{t("numbers.expr_placeholder")}</span>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 10, color: T.dim, letterSpacing: 1.2, textTransform: "uppercase" }}>
          <span>
            {liveResult == null
              ? <span style={{ opacity: 0.5 }}>—</span>
              : liveDelta === 0
                ? <span style={{ color: T.ok, fontWeight: 700 }}>{t("numbers.exact")} ✓</span>
                : <>= {Number.isFinite(liveResult) ? Number.isInteger(liveResult) ? liveResult : liveResult.toFixed(2) : "?"} <span style={{ color: liveDelta <= 5 ? "#fb923c" : T.dim, marginLeft: 6 }}>{t("numbers.off_by", { n: liveDelta })}</span></>
            }
          </span>
          {!locked && <span style={{ color: time <= 10 ? T.bad : T.dim, fontWeight: 700 }}>{time}s</span>}
        </div>

        {/* Operator pad */}
        {!locked && (
          <>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: 6, marginBottom: 8,
            }}>
              {["+", "−", "×", "÷"].map((label, i) => {
                const op = ["+", "-", "*", "/"][i];
                return (
                  <button key={op} onClick={() => tapOp(op)} style={opBtnStyle()}>{label}</button>
                );
              })}
              <button onClick={() => tapParen("(")} style={opBtnStyle()}>(</button>
              <button onClick={() => tapParen(")")} style={opBtnStyle()}>)</button>
              <button onClick={backspace} style={{ ...opBtnStyle(), color: T.bad, borderColor: "rgba(244,63,94,0.3)" }}>⌫</button>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button onClick={clearExpr} style={{
                flex: 1, minHeight: 44, padding: "10px 14px",
                background: "rgba(244,63,94,0.06)",
                color: T.bad, border: "1px solid rgba(244,63,94,0.25)",
                borderRadius: 12, fontSize: 11, fontWeight: 700,
                letterSpacing: 1.5, textTransform: "uppercase",
                fontFamily: "inherit", cursor: "pointer",
              }}>{t("numbers.clear")}</button>
              <button
                onClick={handleLockIn}
                disabled={tokens.length === 0}
                style={{
                  flex: 2, minHeight: 44, padding: "10px 14px",
                  background: tokens.length === 0
                    ? "rgba(255,255,255,0.04)"
                    : "linear-gradient(135deg,#e8c547,#d4a830)",
                  color: tokens.length === 0 ? "rgba(232,197,71,0.3)" : T.bg,
                  border: "none", borderRadius: 12,
                  fontSize: 13, fontWeight: 800, letterSpacing: 2.5,
                  textTransform: "uppercase",
                  cursor: tokens.length === 0 ? "not-allowed" : "pointer",
                  fontFamily: "inherit",
                }}
              >{t("numbers.lock_in")}</button>
            </div>
          </>
        )}

        {/* Reveal block */}
        {locked && (
          <div style={{ marginTop: 12, animation: "g-fadeUp .35s both" }}>
            <div style={{ background: T.glass, border: `1px solid ${T.gb}`, borderRadius: 12, padding: 14, marginBottom: 10 }}>
              <div style={{ fontSize: 10, letterSpacing: 1.6, color: T.dim, textTransform: "uppercase", marginBottom: 6 }}>
                {t("numbers.your_score")}
              </div>
              {judging
                ? <ThinkingDots label={t("numbers.judging")} />
                : (
                  <>
                    <div style={{ fontSize: 26, fontWeight: 800, color: T.gold, fontFamily: "Georgia, serif" }}>
                      {judgeResult?.score ?? 0}
                    </div>
                    {judgeResult?.result != null && (
                      <div style={{ fontSize: 12, color: "rgba(232,230,225,0.7)", marginTop: 4 }}>
                        {exprStr} = <strong style={{ color: T.gold }}>{judgeResult.result}</strong>
                        {judgeResult.difference === 0
                          ? <span style={{ color: T.ok, marginLeft: 8 }}>{t("numbers.exact")}</span>
                          : <span style={{ marginLeft: 8 }}>{t("numbers.off_by", { n: judgeResult.difference })}</span>}
                      </div>
                    )}
                  </>
                )}
            </div>

            <div style={{ background: "rgba(34,211,238,0.05)", border: "1px solid rgba(34,211,238,0.2)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 10, letterSpacing: 1.6, color: "rgba(34,211,238,0.7)", textTransform: "uppercase", marginBottom: 6 }}>
                {t("numbers.axiom_solution")}
              </div>
              {axiomThinking
                ? <ThinkingDots label={t("numbers.thinking")} />
                : (
                  <>
                    <div style={{ fontSize: 13, color: "#e8e6e1", lineHeight: 1.4, fontFamily: "ui-monospace,monospace", marginBottom: 4 }}>
                      {axiomResult?.expression || "—"} {axiomResult?.result != null && <>= <strong>{axiomResult.result}</strong></>}
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
                onClick={nextRound}
                style={{
                  width: "100%", minHeight: 52, padding: 14,
                  fontSize: 13, fontWeight: 800, letterSpacing: 2.5, textTransform: "uppercase",
                  background: "linear-gradient(135deg,#22d3ee,#0ea5e9)",
                  color: T.bg, border: "none", borderRadius: 14,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {round + 1 >= ROUNDS ? t("shifter.see_results") : t("shifter.next_round")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function opBtnStyle() {
  return {
    minHeight: 44, padding: 0,
    background: "rgba(232,197,71,0.06)",
    color: T.gold, border: "1px solid rgba(232,197,71,0.25)",
    borderRadius: 10, fontSize: 18, fontWeight: 800,
    fontFamily: "ui-monospace,monospace", cursor: "pointer",
  };
}

function wrapStyle() {
  return {
    minHeight: "100dvh",
    background: `radial-gradient(ellipse at 50% 0%,rgba(34,211,238,.05) 0%,${T.bg} 55%)`,
    fontFamily: "'Segoe UI',system-ui,sans-serif",
    color: "#e8e6e1",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBottom: 24,
  };
}

export default NumbersMode;

import { useCallback, useEffect, useRef, useState } from "react";

// useBlindMath — drives one "blind arithmetic" round.
//
//   1. Picks a starting integer + a sequence of operations (length `opsCount`).
//   2. Reveals each operation one at a time using setTimeout (every `stepMs` ms).
//   3. Hides the running total — only the current operation is shown.
//   4. After the last operation, AXIOM states a final value with a True/False claim.
//      The user calls submit(true|false); the hook returns whether that
//      judgement was correct.
//
// Divisibility:
//   When `allowDivide` is true, ÷ is only chosen if the current running total
//   is evenly divisible by one of {2,3,4,5}. This guarantees integer math
//   throughout — no ugly halves to track in your head.
//
// Public state: started, finished, awaitingAnswer, currentOp, opsRevealed,
//   currentIndex, axiomClaim, axiomClaimIsTrue (only after submit), realAnswer
//   (only after submit), userJudgement, judgementCorrect.
// Public actions: start(), submit(userSaysTrue), reset().

const DIVISORS = [2, 3, 4, 5];

function pickInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function applyOp(total, op) {
  switch (op.kind) {
    case "+": return total + op.value;
    case "-": return total - op.value;
    case "×": return total * op.value;
    case "÷": return Math.trunc(total / op.value);
    default:  return total;
  }
}

// Walk the running total while picking ops so ÷ is only chosen when the
// current total is evenly divisible. Returns { ops, finalAnswer }.
function generateOpsFromStart(start, count, { allowMultiply, allowDivide }) {
  let total = start;
  const ops = [];
  for (let i = 0; i < count; i++) {
    // Candidate kinds. ÷ only when the running total has a clean divisor.
    const kinds = ["+", "-"];
    if (allowMultiply) kinds.push("×");

    let chosen = null;
    if (allowDivide) {
      const cleanDivisors = DIVISORS.filter(d => total !== 0 && total % d === 0 && Math.abs(total / d) >= 1);
      if (cleanDivisors.length > 0 && Math.random() < 0.25) {
        const value = cleanDivisors[pickInt(0, cleanDivisors.length - 1)];
        chosen = { kind: "÷", value };
      }
    }

    if (!chosen) {
      const kind = kinds[pickInt(0, kinds.length - 1)];
      const value = kind === "×" ? pickInt(2, 4) : pickInt(2, 12);
      chosen = { kind, value };
      // Avoid generating an op that drives total negative or to absurd magnitudes.
      if (kind === "-" && total - value < -50) chosen = { kind: "+", value };
    }

    ops.push(chosen);
    total = applyOp(total, chosen);
  }
  return { ops, finalAnswer: total };
}

export function useBlindMath({
  opsCount      = 6,
  stepMs        = 1100,
  startMin      = 5,
  startMax      = 20,
  allowMultiply = true,
  allowDivide   = false,
  // probability AXIOM tells the truth (otherwise it lies by ±drift)
  truthRate     = 0.5,
  // how far AXIOM's lie strays from the real answer (in absolute units)
  liarDrift     = (real) => pickInt(2, 6) * (Math.random() < 0.5 ? -1 : 1),
} = {}) {
  const buildSeed = useCallback(() => {
    const start = pickInt(startMin, startMax);
    const { ops, finalAnswer } = generateOpsFromStart(start, opsCount, { allowMultiply, allowDivide });
    return { start, ops, finalAnswer };
  }, [opsCount, startMin, startMax, allowMultiply, allowDivide]);

  const [seed, setSeed]                     = useState(buildSeed);
  const [started, setStarted]               = useState(false);
  const [currentIndex, setCurrentIndex]     = useState(-1);
  const [finished, setFinished]             = useState(false);
  const [axiomClaim, setAxiomClaim]         = useState(null);
  const [axiomClaimIsTrue, setClaimIsTrue]  = useState(null);
  const [userJudgement, setUserJudgement]   = useState(null);
  const [judgementCorrect, setCorrect]      = useState(null);

  const timerRef = useRef(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const start = useCallback(() => {
    clearTimers();
    setStarted(true);
    setFinished(false);
    setCurrentIndex(0);
    setAxiomClaim(null);
    setClaimIsTrue(null);
    setUserJudgement(null);
    setCorrect(null);
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setSeed(buildSeed());
    setStarted(false);
    setFinished(false);
    setCurrentIndex(-1);
    setAxiomClaim(null);
    setClaimIsTrue(null);
    setUserJudgement(null);
    setCorrect(null);
  }, [clearTimers, buildSeed]);

  // Step through ops sequentially. Each tick advances currentIndex; the
  // total is computed at generation time and never exposed until after submit().
  useEffect(() => {
    if (!started || finished) return;
    if (currentIndex < 0) return;

    if (currentIndex >= seed.ops.length) {
      const real = seed.finalAnswer;
      const tellsTruth = Math.random() < truthRate;
      const drift = liarDrift(real);
      const claim = tellsTruth ? real : real + (drift === 0 ? 1 : drift);

      setAxiomClaim(claim);
      setClaimIsTrue(tellsTruth);
      setFinished(true);
      return;
    }

    timerRef.current = setTimeout(() => {
      setCurrentIndex(i => i + 1);
    }, stepMs);

    return clearTimers;
  }, [started, finished, currentIndex, seed, stepMs, truthRate, liarDrift, clearTimers]);

  // Cleanup on unmount.
  useEffect(() => clearTimers, [clearTimers]);

  const submit = useCallback((userSaysTrue) => {
    if (!finished || axiomClaimIsTrue === null || userJudgement !== null) return null;
    const correct = Boolean(userSaysTrue) === Boolean(axiomClaimIsTrue);
    setUserJudgement(Boolean(userSaysTrue));
    setCorrect(correct);
    return correct;
  }, [finished, axiomClaimIsTrue, userJudgement]);

  const opsRevealed     = currentIndex < 0 ? 0 : Math.min(currentIndex, seed.ops.length);
  const currentOp       = currentIndex >= 0 && currentIndex < seed.ops.length ? seed.ops[currentIndex] : null;
  const awaitingAnswer  = finished && userJudgement === null;
  const realAnswer      = userJudgement !== null ? seed.finalAnswer : null;

  return {
    // seed
    startValue: seed.start,
    opsCount: seed.ops.length,
    // progress
    started, finished, awaitingAnswer,
    currentIndex, currentOp, opsRevealed,
    // AXIOM
    axiomClaim,
    axiomClaimIsTrue: userJudgement !== null ? axiomClaimIsTrue : null,
    realAnswer,
    // user
    userJudgement,
    judgementCorrect,
    // actions
    start, submit, reset,
  };
}

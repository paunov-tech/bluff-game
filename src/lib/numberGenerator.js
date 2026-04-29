// Numbers mode generator — Brojke i slova / Countdown classic format:
// 4 small (1-10) + 2 big (25/50/75/100), with a target. Easy MVP keeps
// targets in the 100-300 range so partial-credit hits feel achievable.

const SMALL_POOL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const BIG_POOL   = [25, 50, 75, 100];

function pickN(arr, n) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

// Returns { numbers, target }. Numbers are shuffled.
// difficulty: "easy" | "normal" — only "easy" used for MVP.
export function generatePuzzle(difficulty = "easy") {
  const small = Array.from({ length: 4 }, () => SMALL_POOL[Math.floor(Math.random() * SMALL_POOL.length)]);
  const big = pickN(BIG_POOL, 2);
  const numbers = [...small, ...big];
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  const target = difficulty === "easy"
    ? 100 + Math.floor(Math.random() * 201) // 100-300
    : 300 + Math.floor(Math.random() * 700); // 300-999
  return { numbers, target };
}

// Local sanitizer + safe eval for the live "= X" preview in the UI.
// Server is authoritative; this is purely for instant feedback.
const ALLOWED_RE = /^[0-9+\-*/()\s]*$/;

export function evalExpression(expr) {
  if (!expr || !ALLOWED_RE.test(expr)) return null;
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr});`)();
    if (typeof result !== "number" || !isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

// Verifies (client-side) that the expression only uses each provided
// number at most once. Server re-checks. Returns true/false.
export function verifyNumbersUsed(expr, provided) {
  if (!expr) return true;
  const used = expr.match(/\d+/g)?.map(Number) || [];
  const pool = [...provided];
  for (const n of used) {
    const idx = pool.indexOf(n);
    if (idx === -1) return false;
    pool.splice(idx, 1);
  }
  return true;
}

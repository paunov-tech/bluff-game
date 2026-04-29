// api/numbers-judge.js — server-authoritative validation of a Numbers
// puzzle expression (Brojke i slova / Countdown style). No LLM call —
// fully deterministic.
//
// POST { numbers: number[], target: number, expression: string }
//   → { result, difference, score, valid, error? }

const ALLOWED_RE = /^[0-9+\-*/()\s]+$/;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { numbers, target, expression } = req.body || {};
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: "numbers required" });
  }
  if (typeof target !== "number" || !Number.isFinite(target)) {
    return res.status(400).json({ error: "target required" });
  }
  if (typeof expression !== "string" || expression.trim().length === 0) {
    return res.status(400).json({ error: "expression required" });
  }
  if (expression.length > 200) {
    return res.status(400).json({ error: "expression too long" });
  }

  const expr = expression.trim();
  if (!ALLOWED_RE.test(expr)) {
    return res.status(400).json({ error: "invalid_characters" });
  }

  // Each provided number can be used at most once.
  const usedNums = expr.match(/\d+/g)?.map(Number) || [];
  const pool = [...numbers];
  for (const n of usedNums) {
    const idx = pool.indexOf(n);
    if (idx === -1) {
      return res.status(400).json({
        error: "number_not_in_pool_or_used_twice",
        n,
      });
    }
    pool.splice(idx, 1);
  }

  // Safe eval — characters already allow-listed; no identifiers, no calls.
  let result;
  try {
    // eslint-disable-next-line no-new-func
    result = Function(`"use strict"; return (${expr});`)();
  } catch {
    return res.status(400).json({ error: "invalid_expression" });
  }
  if (typeof result !== "number" || !Number.isFinite(result)) {
    return res.status(400).json({ error: "non_finite_result" });
  }

  const difference = Math.abs(result - target);
  let score = 0;
  if (difference === 0) score = 100;
  else if (difference <= 5) score = 50;
  else if (difference <= 10) score = 25;

  return res.status(200).json({
    result, difference, score, valid: true,
  });
}

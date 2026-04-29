// api/numbers-axiom.js — AXIOM solves a Numbers puzzle. Deliberately
// imperfect: the prompt asks for a "competitive but not always optimal"
// solution and we cap thinking budget so the AI lands at ~70% win rate.
//
// POST { numbers: number[], target: number }
//   → { expression, result, difference, thinking }

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const ALLOWED_RE = /^[0-9+\-*/()\s]+$/;

function extractJSON(raw) {
  if (!raw?.trim()) throw new Error("empty");
  const clean = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(clean); } catch {}
  const f = clean.indexOf("{"), l = clean.lastIndexOf("}");
  if (f !== -1 && l > f) {
    try { return JSON.parse(clean.slice(f, l + 1)); } catch {}
  }
  throw new Error("no JSON");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { numbers, target } = req.body || {};
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: "numbers required" });
  }
  if (typeof target !== "number" || !Number.isFinite(target)) {
    return res.status(400).json({ error: "target required" });
  }

  const prompt = `You are AXIOM playing a Numbers puzzle (Brojke i slova / Countdown).

Available numbers: ${numbers.join(", ")}
Target: ${target}

Find an arithmetic expression using only +, -, *, /, parentheses to get as close as possible to the target. Each number can be used AT MOST once. You may use fewer than all numbers.

IMPORTANT: Be competitive but NOT flawless. Spend roughly 5 seconds of mental effort. If a perfect solution isn't immediately obvious, settle for close. Don't exhaustively search — that's not the spirit of this game. You should land within 0-15 of the target most of the time.

Return JSON ONLY (no markdown):
{
  "expression": "(100+50)*6+75-25+3",
  "result": 953,
  "difference": 1,
  "thinking": "One short sentence about your approach."
}`;

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content[0]?.text || "";
    const parsed = extractJSON(raw);

    const expression = String(parsed.expression || "").trim();
    if (!expression || !ALLOWED_RE.test(expression) || expression.length > 200) {
      return res.status(502).json({ error: "axiom_invalid_expression" });
    }

    // Recompute the result server-side rather than trust the AI — keeps
    // the AXIOM score honest.
    const usedNums = expression.match(/\d+/g)?.map(Number) || [];
    const pool = [...numbers];
    for (const n of usedNums) {
      const idx = pool.indexOf(n);
      if (idx === -1) {
        return res.status(502).json({ error: "axiom_used_invalid_number" });
      }
      pool.splice(idx, 1);
    }
    let result;
    try {
      // eslint-disable-next-line no-new-func
      result = Function(`"use strict"; return (${expression});`)();
    } catch {
      return res.status(502).json({ error: "axiom_unparseable" });
    }
    if (typeof result !== "number" || !Number.isFinite(result)) {
      return res.status(502).json({ error: "axiom_non_finite" });
    }
    const difference = Math.abs(result - target);
    const thinking = String(parsed.thinking || "").slice(0, 200);

    return res.status(200).json({ expression, result, difference, thinking });
  } catch (err) {
    console.error("[numbers-axiom]", err.message);
    return res.status(500).json({ error: "axiom_unavailable" });
  }
}

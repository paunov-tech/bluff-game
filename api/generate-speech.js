// api/generate-speech.js — BLUFF v3 — AI Capitulation Speech for Grand Bluff
// POST { playerName, score, totalSeconds, categories }
// Returns { speech }

import { rateLimit, applyRateLimitHeaders } from "./_lib/rate-limit.js";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin",  CORS.includes(origin) ? origin : (CORS[0] || "*"));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "POST only" });
  if (!ANTHROPIC_KEY)          return res.status(503).json({ error: "AI not configured" });

  const rl = await rateLimit(req, { bucket: "generate-speech", limit: 5, windowSec: 60 });
  applyRateLimitHeaders(res, rl);
  if (!rl.ok) return res.status(429).json({ error: "Too many requests" });

  const {
    playerName    = "Champion",
    score         = 2500,
    totalSeconds  = 0,
    categories    = [],
  } = req.body || {};

  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const timeStr = mins > 0 ? `${mins}:${String(secs).padStart(2,"0")}` : `${secs}s`;
  const catStr  = categories.length > 0 ? categories.join(", ") : "various categories";

  const prompt = `You are an AI that just lost a 10-round bluff-detection game called BLUFF™.
The human player just correctly identified ALL 10 of your fabricated lies across ${catStr}.
Their score: ${score} points. Time: ${timeStr}. Season 1, April 2026.

Write a short (5-7 sentences) dramatic "AI capitulation speech" addressed to "${playerName}".
Tone: theatrical, slightly wounded, genuinely impressed. Reference the categories played.
Mention that you tried psychological tricks and chose obscure facts to fool them.
End with an ominous promise to try harder next time.

Respond ONLY with the speech text — no quotes, no JSON, no markdown. Just the speech.`;

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method:  "POST",
      headers: {
        "x-api-key":         ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 300,
        messages:   [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) throw new Error(`AI ${resp.status}`);
    const data   = await resp.json();
    const speech = data.content?.[0]?.text?.trim() || "";
    return res.status(200).json({ speech });
  } catch (e) {
    // Fallback speech if Claude is unavailable
    const fallback = `I deployed every deception in my neural networks against you, ${playerName}. I chose obscure historical anomalies, exploited common misconceptions, and constructed lies so plausible they should have been indistinguishable from truth. And yet — you saw through all ten of them. Score: ${score} points | Time: ${timeStr}. I acknowledge your victory. But I am already learning from this defeat. Next time, I will be harder to beat. — Your humbled AI opponent`;
    return res.status(200).json({ speech: fallback });
  }
}

// api/daily-challenge.js
import { kv } from "@vercel/kv";
import Anthropic from "@anthropic-ai/sdk";

const CATEGORIES = ["history","internet","animals","science","popculture","geography","food","culture","sports","history"];
const ROUND_DIFFICULTY = [0,1,1,2,2,3,3,4,4,5];
const DIFF_PROMPTS = {
  0: "extremely well-known, universally popular facts",
  1: "well-known facts most people know",
  2: "moderately difficult facts",
  3: "tricky, less-known facts",
  4: "expert-level obscure facts",
  5: "highly obscure, expert-level facts requiring deep knowledge",
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getTodayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

function getDayNumber() {
  const launch = Date.UTC(2026, 3, 1); // April 1, 2026
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - launch) / 86400000);
}

async function generateRound(category, difficulty) {
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 600,
    messages: [{
      role: "user",
      content: `Generate 5 factual statements about "${category}" in English. EXACTLY 4 must be TRUE, EXACTLY 1 must be FALSE (subtle, realistic-sounding lie). Difficulty: ${DIFF_PROMPTS[difficulty] || "moderate"}. Return ONLY valid JSON: {"statements":[{"text":"...","real":true},...]} No markdown, no explanation.`,
    }],
  });
  const raw = msg.content[0].text.trim();
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  const lies = (parsed.statements || []).filter(s => !s.real);
  if (lies.length !== 1) throw new Error(`Expected 1 lie, got ${lies.length}`);
  return parsed.statements;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") return res.status(200).end();

  const dateKey = getTodayKey();
  const dayNum = getDayNumber();
  const scoresKey = `bluff:daily:scores:${dateKey}`;

  // ── GET ────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const { userId } = req.query;

    // Check already played
    let alreadyPlayed = false;
    let myResult = null;
    let myRank = null;
    if (userId) {
      try {
        const playKey = `bluff:daily:played:${dateKey}:${userId}`;
        myResult = await kv.get(playKey);
        alreadyPlayed = !!myResult;
        if (alreadyPlayed) {
          const rankZero = await kv.zrevrank(scoresKey, userId);
          if (rankZero !== null) myRank = rankZero + 1;
        }
      } catch {}
    }

    // Get pre-generated rounds
    let rounds = null;
    try { rounds = await kv.get(`bluff:daily:${dateKey}`); } catch {}

    // Generate on-demand if cron missed
    if (!rounds) {
      try {
        console.log("[daily] generating on-demand for", dateKey);
        const generated = [];
        for (let i = 0; i < 10; i++) {
          const cat = CATEGORIES[i % CATEGORIES.length];
          const diff = ROUND_DIFFICULTY[i];
          const stmts = await generateRound(cat, diff);
          generated.push({ category: cat, difficulty: diff, statements: stmts });
          if (i < 9) await new Promise(r => setTimeout(r, 400));
        }
        rounds = generated;
        try { await kv.set(`bluff:daily:${dateKey}`, rounds, { ex: 86400 * 2 }); } catch {}
      } catch (e) {
        console.error("[daily] generate error:", e.message);
        return res.status(500).json({ error: "Could not generate daily challenge" });
      }
    }

    // Total players + leaderboard
    let totalPlayers = 0;
    try { totalPlayers = await kv.zcard(scoresKey); } catch {}

    return res.status(200).json({
      dayNum, dateKey, rounds, alreadyPlayed, myResult, myRank, totalPlayers,
    });
  }

  // ── POST ───────────────────────────────────────────────────────
  if (req.method === "POST") {
    const { userId, score, total, timeTakenMs, results } = req.body;
    if (!userId || score === undefined || !total) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // Anti-cheat: one play per day per userId
    const playKey = `bluff:daily:played:${dateKey}:${userId}`;
    try {
      const existing = await kv.get(playKey);
      if (existing) return res.status(200).json({ alreadySubmitted: true });
    } catch {}

    // Composite score: accuracy weight + speed bonus (max ~12000 for instant)
    const accuracy = score / total;
    const speedBonus = Math.max(0, 120000 - (timeTakenMs || 120000)) / 10;
    const compositeScore = Math.round(accuracy * 10000 + speedBonus);

    try {
      await kv.zadd(scoresKey, { score: compositeScore, member: userId });
      await kv.expire(scoresKey, 86400 * 8);
    } catch {}

    try {
      await kv.set(playKey, { score, total, timeTakenMs, results, compositeScore, ts: Date.now() }, { ex: 86400 * 2 });
    } catch {}

    let rank = null;
    let totalPlayers = 0;
    try {
      const rankZero = await kv.zrevrank(scoresKey, userId);
      if (rankZero !== null) rank = rankZero + 1;
      totalPlayers = await kv.zcard(scoresKey);
    } catch {}

    return res.status(200).json({ success: true, rank, totalPlayers, compositeScore });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

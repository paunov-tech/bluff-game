// api/cron-daily.js
// Cron: 0 23 * * * — pre-generates tomorrow's daily challenge at 23:00 UTC
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
  5: "highly obscure, expert-level facts",
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getTomorrowKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
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

export default async function handler(req, res) {
  const tomorrowKey = getTomorrowKey();
  const kvKey = `bluff:daily:${tomorrowKey}`;

  // Skip if already generated
  try {
    const existing = await kv.get(kvKey);
    if (existing) {
      return res.status(200).json({ status: "already_generated", date: tomorrowKey });
    }
  } catch {}

  const rounds = [];
  const errors = [];

  for (let i = 0; i < 10; i++) {
    const cat = CATEGORIES[i % CATEGORIES.length];
    const diff = ROUND_DIFFICULTY[i];
    try {
      const stmts = await generateRound(cat, diff);
      rounds.push({ category: cat, difficulty: diff, statements: stmts });
      console.log(`[cron-daily] round ${i+1}/10 done (${cat}, diff ${diff})`);
    } catch (e) {
      console.error(`[cron-daily] round ${i+1} failed:`, e.message);
      errors.push({ round: i, error: e.message });
    }
    if (i < 9) await new Promise(r => setTimeout(r, 500));
  }

  if (rounds.length < 8) {
    return res.status(500).json({ error: "Too many failures", rounds: rounds.length, errors });
  }

  try {
    await kv.set(kvKey, rounds, { ex: 86400 * 3 }); // keep 3 days
  } catch (e) {
    return res.status(500).json({ error: "KV save failed", detail: e.message });
  }

  return res.status(200).json({ status: "ok", date: tomorrowKey, rounds: rounds.length, errors });
}

// api/sniper-batch.js — Generate N "find the lie word" sentences via Claude.
//
// GET /api/sniper-batch?count=3&lang=en   (auth optional — anon OK)
//
// Each sentence is a 10-15 word factual statement where exactly ONE word
// has been swapped for a plausible-but-wrong alternative. The client gets
// the words array; the lie index + correct word + explanation are stored
// server-side in `sniper_sessions/{sessionId}` and resolved by sniper-judge.

import Anthropic from "@anthropic-ai/sdk";
import { fsPatch, toFS } from "./_lib/firestore-rest.js";
import { rateLimit, applyRateLimitHeaders } from "./_lib/rate-limit.js";
import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";

const SESSIONS_COL = "sniper_sessions";
const DEFAULT_COUNT = 3;
const MAX_COUNT     = 5;

const LANG_NAMES = {
  en: "English", sr: "Serbian", hr: "Croatian", de: "German",
  fr: "French", es: "Spanish", sl: "Slovenian", bs: "Bosnian",
};

const MODEL = "claude-sonnet-4-6";

const client = new Anthropic();

function buildPrompt(count, langName) {
  return `Generate ${count} factual sentences in ${langName}, each 10-15 words, on diverse topics (history, science, geography, culture).

CRITICAL: In each sentence, replace ONE specific word with a factually WRONG alternative that fits grammatically but is incorrect.

Example:
  Original: "Apollo 11 landed on the Moon in 1969 with commander Neil Armstrong."
  Modified: "Apollo 11 landed on the Moon in 1969 with commander Yuri Gagarin."
                                                              ↑ wrong (was Armstrong)

Return STRICT JSON only — no prose, no markdown fences:
{
  "sentences": [
    {
      "id": "sniper_1",
      "text": "Apollo 11 landed on the Moon in 1969 with commander Yuri Gagarin.",
      "words": ["Apollo","11","landed","on","the","Moon","in","1969","with","commander","Yuri","Gagarin"],
      "lieWordIndex": 10,
      "lieWord": "Yuri",
      "correctWord": "Neil",
      "explanation": "Yuri Gagarin was the first Soviet cosmonaut; Neil Armstrong commanded Apollo 11."
    }
  ]
}

Rules:
- "words" MUST be a tokenisation of "text" by whitespace (punctuation stays attached to its word).
- "lieWordIndex" MUST point to the swapped word in "words".
- The lie should be SPECIFIC (a name, date, place, number) — not generic.
- The lie should be PLAUSIBLE — same category (person→person, year→year).
- Difficulty progressive: sentence 1 easier, last hardest.
- Do NOT include any sentence where the lie word is a stop-word ("the", "a", "of", etc.).`;
}

function stripFences(text) {
  return String(text || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
}

// Validate one sentence shape — defends against partial / malformed model output.
function isValidSentence(s) {
  if (!s || typeof s !== "object") return false;
  if (typeof s.text !== "string" || s.text.length < 8) return false;
  if (!Array.isArray(s.words) || s.words.length < 6 || s.words.length > 30) return false;
  if (!Number.isInteger(s.lieWordIndex)) return false;
  if (s.lieWordIndex < 0 || s.lieWordIndex >= s.words.length) return false;
  if (typeof s.lieWord !== "string" || typeof s.correctWord !== "string") return false;
  if (typeof s.explanation !== "string") return false;
  // The lieWord at lieWordIndex must roughly match the words[lieWordIndex].
  // Strip trailing punctuation for the comparison so "Gagarin." matches "Gagarin".
  const wordAtIdx = String(s.words[s.lieWordIndex] || "").replace(/[.,;:!?"']+$/g, "").toLowerCase();
  const claimed   = String(s.lieWord).replace(/[.,;:!?"']+$/g, "").toLowerCase();
  if (wordAtIdx !== claimed) return false;
  return true;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const rl = await rateLimit(req, { bucket: "sniper-batch", limit: 30, windowSec: 60 });
  applyRateLimitHeaders(res, rl);
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  if (!process.env.FIREBASE_API_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "Anthropic not configured" });
  }

  const count = Math.min(MAX_COUNT, Math.max(1, parseInt(req.query.count, 10) || DEFAULT_COUNT));
  const lang  = (req.query.lang || "en").toString().slice(0, 4);
  const langName = LANG_NAMES[lang] || "English";
  const auth = await verifyRequestAuth(req);
  const uid  = auth?.uid || (typeof req.query.userId === "string" ? req.query.userId.slice(0, 80) : "");

  let parsed;
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: buildPrompt(count, langName) }],
    });

    const block = (response.content || []).find(b => b.type === "text");
    const raw   = stripFences(block?.text || "");
    parsed      = JSON.parse(raw);
  } catch (err) {
    console.error("[sniper-batch] generation failed:", err.message);
    return res.status(502).json({ error: "AXIOM is loading ammunition…" });
  }

  const sentences = Array.isArray(parsed?.sentences) ? parsed.sentences : [];
  const valid     = sentences.filter(isValidSentence).slice(0, count);
  if (valid.length === 0) {
    return res.status(502).json({ error: "AXIOM produced no usable sentences" });
  }

  // Re-id so we don't depend on the model's choices and have stable references.
  const sessionId = `snipe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const reIded = valid.map((s, i) => ({ ...s, id: `${sessionId}_${i + 1}` }));

  // Server-side store with the answer key — never sent to the client.
  // MUST await: sniper has only 3 sentences and the user can tap within ~1s
  // of receiving the batch, so a fire-and-forget write often gets frozen by
  // the Vercel runtime before reaching Firestore, then sniper-judge 404s
  // with session_not_found. Awaiting trades a few hundred ms of latency for
  // a reliable next read.
  try {
    await fsPatch(SESSIONS_COL, sessionId, {
      userId:    toFS(uid || null),
      lang:      toFS(lang),
      sentences: toFS(reIded),
      consumed:  toFS([]),
      createdAt: toFS(Date.now()),
    });
  } catch (err) {
    console.warn("[sniper-batch] session write failed:", err.message);
    return res.status(503).json({ error: "session_persist_failed" });
  }

  // Strip the answer key from the response.
  const clientSentences = reIded.map(s => ({
    id:    s.id,
    text:  s.text,
    words: s.words,
  }));

  return res.status(200).json({
    sessionId,
    sentences: clientSentences,
  });
}

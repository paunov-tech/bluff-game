// api/_lib/sniper-generate.js — Shared Anthropic generation + validation for
// "find the lie word" Sniper sentences. Used by both /api/sniper-batch (live
// fallback path) and /api/admin/build-sniper-pool (cron pre-generator).
//
// Centralised so prompt drift can't happen between the two callers — same
// rules, same validator, same output shape.

import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";

export const SNIPER_LANGS = ["en", "de", "sr", "hr", "sl", "bs", "fr", "es"];

export const LANG_NAMES = {
  en: "English", sr: "Serbian", hr: "Croatian", de: "German",
  fr: "French", es: "Spanish", sl: "Slovenian", bs: "Bosnian",
};

export const MODEL = "claude-sonnet-4-6";

let _client;
function getClient() {
  if (!_client) _client = new Anthropic();
  return _client;
}

// Pool ID is content-derived so re-running the cron over the same sentence
// is a no-op (fsCreateIfMissing rejects with `false`). Keyed on lang+text.
export function poolIdFor(lang, text) {
  const norm = String(text || "").trim().toLowerCase();
  const h = createHash("sha1").update(`${lang}|${norm}`).digest("hex").slice(0, 16);
  return `snipe_pool_${lang}_${h}`;
}

export function buildPrompt(count, langName) {
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

export function stripFences(text) {
  return String(text || "").replace(/```json\s*/gi, "").replace(/```/g, "").trim();
}

// Validate one sentence shape — defends against partial / malformed model output.
export function isValidSentence(s) {
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

// One Anthropic round-trip → up to `count` validated sentences.
// Throws on Anthropic API errors so callers can decide whether to fall back
// (sniper-batch live path) or skip (cron continues to next batch/lang).
export async function generateSniperBatch(lang, count, { maxTokens = 3500 } = {}) {
  const langName = LANG_NAMES[lang] || "English";
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: buildPrompt(count, langName) }],
  });
  const block = (response.content || []).find(b => b.type === "text");
  const raw   = stripFences(block?.text || "");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const sentences = Array.isArray(parsed?.sentences) ? parsed.sentences : [];
  return sentences.filter(isValidSentence);
}

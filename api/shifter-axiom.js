// api/shifter-axiom.js — AXIOM generates a competing factual statement
// where as many words as possible START with the provided letters.
// POST { letters: string[8], lang?: "en"|"sr"|"hr" }
//   → { statement, lettersUsed: string[], thinking }

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const LANG_NAMES = { en: "English", sr: "Serbian", hr: "Croatian" };

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

  const { letters, lang = "en" } = req.body || {};
  if (!Array.isArray(letters) || letters.length !== 8) {
    return res.status(400).json({ error: "letters[8] required" });
  }
  const cleanLetters = letters.map(l => String(l || "").toUpperCase().slice(0, 2));
  const langName = LANG_NAMES[lang] || "English";

  const prompt = `You are AXIOM, an AI competitor in a word game called Shifter (inspired by Brojke i slova / Countdown).

The player has 8 letters: ${cleanLetters.join(", ")}

Goal: write ONE factually true statement in ${langName} where as many WORDS as possible START with the given letters (in any order). Each letter can be the start of at most ONE word in your statement.

Rules:
- Statement MUST be in ${langName}.
- Statement MUST be factually true (history, science, geography, culture).
- Use AT LEAST 4 of the 8 letters as starting letters of words.
- Aim for 5-7 letters used — strong but not always perfect (you are competitive but not flawless).
- Sentence must be grammatically correct and natural.
- Length 6-12 words.

Return JSON ONLY (no markdown, no explanation):
{
  "statement": "Your factual sentence here",
  "lettersUsed": ["A", "R", "M"],
  "thinking": "One short sentence explaining your strategy."
}`;

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content[0]?.text || "";
    const parsed = extractJSON(raw);

    const statement = String(parsed.statement || "").trim();
    if (!statement) return res.status(502).json({ error: "no statement returned" });

    const lettersUsed = Array.isArray(parsed.lettersUsed)
      ? parsed.lettersUsed.map(l => String(l || "").toUpperCase().slice(0, 2)).filter(Boolean)
      : [];
    const thinking = String(parsed.thinking || "").slice(0, 200);

    return res.status(200).json({ statement, lettersUsed, thinking });
  } catch (err) {
    console.error("[shifter-axiom]", err.message);
    return res.status(500).json({ error: "axiom_unavailable" });
  }
}

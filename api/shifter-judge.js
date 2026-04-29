// api/shifter-judge.js — evaluate a user Shifter statement.
// POST { letters: string[8], userStatement, lang?: "en"|"sr"|"hr" }
//   → { letterMatches, grammarValid, factuallyTrue, score, feedback }

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

  const { letters, userStatement, lang = "en" } = req.body || {};
  if (!Array.isArray(letters) || letters.length !== 8) {
    return res.status(400).json({ error: "letters[8] required" });
  }
  const statement = String(userStatement || "").trim();
  if (!statement) return res.status(400).json({ error: "userStatement required" });
  if (statement.length > 400) {
    return res.status(400).json({ error: "userStatement too long" });
  }
  const cleanLetters = letters.map(l => String(l || "").toUpperCase().slice(0, 2));
  const langName = LANG_NAMES[lang] || "English";

  const prompt = `Evaluate a Shifter game statement.
Letters provided: ${cleanLetters.join(", ")}
User statement (${langName}): "${statement.replace(/"/g, '\\"')}"

Evaluate strictly but fairly:
1. Match each provided letter to AT MOST ONE word in the statement that starts with that letter (case-insensitive). Each letter can be matched at most once. Each word can match at most one letter.
2. Is the statement grammatically valid in ${langName}? (true/false)
3. Is the statement factually true? Be slightly permissive on phrasing but strict on facts. Return one of: "true", "false", or "partial".

Score:
- score = (letters successfully matched) × 10
- If grammarValid is false → score = 0
- If factuallyTrue == "false" → score = 0
- If factuallyTrue == "partial" → score = floor(score × 0.5)

Return JSON ONLY (no markdown):
{
  "letterMatches": [{"letter": "A", "word": "Armstrong"}],
  "grammarValid": true,
  "factuallyTrue": "true",
  "score": 80,
  "feedback": "Brief 1-sentence note in ${langName}."
}`;

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content[0]?.text || "";
    const parsed = extractJSON(raw);

    const letterMatches = Array.isArray(parsed.letterMatches)
      ? parsed.letterMatches
          .map(m => ({
            letter: String(m?.letter || "").toUpperCase().slice(0, 2),
            word:   String(m?.word   || "").slice(0, 80),
          }))
          .filter(m => m.letter && m.word)
      : [];
    const grammarValid = parsed.grammarValid === true;
    const factuallyTrueRaw = parsed.factuallyTrue;
    const factuallyTrue = factuallyTrueRaw === true ? "true"
      : factuallyTrueRaw === false ? "false"
      : ["true","false","partial"].includes(String(factuallyTrueRaw)) ? String(factuallyTrueRaw)
      : "partial";

    let score = letterMatches.length * 10;
    if (!grammarValid) score = 0;
    else if (factuallyTrue === "false") score = 0;
    else if (factuallyTrue === "partial") score = Math.floor(score * 0.5);

    const feedback = String(parsed.feedback || "").slice(0, 200);
    return res.status(200).json({
      letterMatches, grammarValid, factuallyTrue, score, feedback,
    });
  } catch (err) {
    console.error("[shifter-judge]", err.message);
    return res.status(500).json({ error: "judge_unavailable" });
  }
}

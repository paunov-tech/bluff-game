// api/generate-round.js — Generate a BLUFF round via Claude Sonnet
// POST { category, difficulty, lang }
// Returns { roundId, statements: [{text}], category, difficulty }
// SECURITY: "real" flags are stored server-side only, never sent to client

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FB_KEY        = process.env.FIREBASE_API_KEY;
const FB_PROJECT    = "molty-portal";
const COLLECTION    = "bluff_rounds";

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

const CAT_DESCS = {
  history:    "historical facts, events, and figures",
  science:    "scientific discoveries, phenomena, and facts",
  animals:    "animal behavior, biology, and adaptations",
  geography:  "world geography, places, and landmarks",
  food:       "food, cuisine, gastronomy, and beverages",
  technology: "technology, inventions, and computing",
  culture:    "art, culture, music, and entertainment",
  sports:     "sports, athletes, and competitions",
};

function buildPrompt(category, difficulty, lang) {
  const catDesc = CAT_DESCS[category] || category;
  const diffGuide = {
    easy:   "Make the lie somewhat detectable — plausible but has a subtle inconsistency a curious person might catch.",
    medium: "Balance it — the lie should fool about 50% of players. Both true and false should sound equally credible.",
    hard:   "Make the lie extremely subtle. True facts should be bizarre and counterintuitive. The lie must be indistinguishable from truth.",
  }[difficulty] || "Balance it evenly.";

  const langNote = lang !== "en"
    ? `Respond in ${lang === "hr" ? "Croatian" : lang === "de" ? "German" : lang === "it" ? "Italian" : "English"}.`
    : "";

  return `Generate 5 fascinating, highly specific statements about ${catDesc}.
EXACTLY 4 must be 100% verifiably true.
EXACTLY 1 must be a convincing fabrication — plausible but factually false.

Difficulty: ${diffGuide}
${langNote}

Respond ONLY with valid JSON (no markdown fences, no explanation outside JSON):
{
  "statements": [
    {"text": "...", "real": true},
    {"text": "...", "real": false},
    {"text": "...", "real": true},
    {"text": "...", "real": true},
    {"text": "...", "real": true}
  ],
  "bluffExplanation": "One concise sentence: why the false statement is wrong."
}

Rules:
- Randomize which of the 5 positions contains the lie (not always the same)
- Each statement: 1-3 sentences, specific details (numbers, names, dates when applicable)
- No "Did you know" or "Interestingly" openers
- True facts should be genuinely surprising — not common knowledge
- The false fact must sound completely plausible to an educated adult`;
}

// ── Firestore: save round (with real flags) ──────────────────
async function saveRound(id, data) {
  if (!FB_KEY) return; // dev mode — skip persistence
  const fields = {
    category:         { stringValue:  data.category },
    difficulty:       { stringValue:  data.difficulty },
    lang:             { stringValue:  data.lang },
    bluffExplanation: { stringValue:  data.bluffExplanation || "" },
    answered:         { booleanValue: false },
    ts:               { stringValue:  new Date().toISOString() },
    statements: {
      arrayValue: {
        values: data.statements.map(s => ({
          mapValue: {
            fields: {
              text: { stringValue:  s.text },
              real: { booleanValue: s.real },
            },
          },
        })),
      },
    },
  };
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${COLLECTION}/${id}?key=${FB_KEY}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
      signal: AbortSignal.timeout(8000),
    }
  );
}

// ── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allowOrigin = CORS.includes(origin) ? origin : (CORS[0] || "*");
  res.setHeader("Access-Control-Allow-Origin",  allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "POST only" });
  if (!ANTHROPIC_KEY)          return res.status(503).json({ error: "AI not configured" });

  const { category = "history", difficulty = "medium", lang = "en" } = req.body || {};

  let parsed;
  try {
    const aiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages:   [{ role: "user", content: buildPrompt(category, difficulty, lang) }],
      }),
      signal: AbortSignal.timeout(28000),
    });

    if (!aiResp.ok) {
      const t = await aiResp.text();
      return res.status(502).json({ error: "AI error " + aiResp.status + ": " + t.slice(0, 120) });
    }

    const aiData = await aiResp.json();
    const raw    = aiData.content?.[0]?.text || "";
    const match  = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON from AI: " + raw.slice(0, 100));
    parsed = JSON.parse(match[0]);
  } catch (e) {
    return res.status(502).json({ error: "AI parse error: " + e.message });
  }

  if (!Array.isArray(parsed.statements) || parsed.statements.length !== 5) {
    return res.status(502).json({ error: "AI returned invalid structure" });
  }
  if (!parsed.statements.some(s => s.real === false)) {
    return res.status(502).json({ error: "AI returned no bluff" });
  }

  // Unique round ID
  const roundId = `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // Save to Firestore (includes real flags — never sent to client)
  try {
    await saveRound(roundId, {
      category, difficulty, lang,
      statements:       parsed.statements,
      bluffExplanation: parsed.bluffExplanation || "",
    });
  } catch (_) { /* non-fatal — game still works without persistence */ }

  // Return to client: only text, no real flags
  return res.status(200).json({
    roundId,
    statements: parsed.statements.map(s => ({ text: s.text })),
    category,
    difficulty,
  });
}

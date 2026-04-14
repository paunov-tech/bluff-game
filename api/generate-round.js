// api/generate-round.js — BLUFF v2 — Difficulty 1-5 + Firestore cache
// POST { category, difficulty: 1-5, lang }
// Returns { roundId, statements: [{text}], category, difficulty, level }
// SECURITY: "real" flags stored server-side only, never sent to client

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FB_KEY        = process.env.FIREBASE_API_KEY;
const FB_PROJECT    = "molty-portal";
const ROUNDS_COL    = "bluff_rounds";
const CACHE_COL     = "bluff_cache";

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

const LEVEL_RULES = {
  1: `LEVEL 1 — WARM-UP: The lie should be obvious to anyone with basic general knowledge.
      Use clearly wrong details: wrong country, obviously wrong date, implausible number.
      Example: "The Eiffel Tower was built in 1820" (wrong era is obvious).`,
  2: `LEVEL 2 — TRICKY: The lie sounds plausible but has one wrong specific detail.
      A curious person might catch it. About 60% of players should get it wrong.
      Example: Wrong by a factor of 2, or a plausible-sounding but wrong person.`,
  3: `LEVEL 3 — SNEAKY: Take a real fact structure and change ONE precise detail
      (a number, a name, a date) to make it false. The lie should fool most people on first read.
      True facts should also be surprising. About 50/50 correct.`,
  4: `LEVEL 4 — DEVIOUS: The lie exploits a common misconception — something most people THINK
      is true but isn't. The 4 true statements should sound counterintuitive or unbelievable.
      Most players will choose a true statement thinking it's the lie.`,
  5: `LEVEL 5 — DIABOLICAL: ALL 4 TRUE statements must be so bizarre, unexpected, and
      counterintuitive that they sound completely fabricated.
      The lie must be the most NORMAL-SOUNDING statement of the five.
      This is maximum cognitive warfare. Players will doubt every true fact.`,
};

// ── Build prompt ──────────────────────────────────────────────
function buildPrompt(category, level, lang) {
  const catDesc  = CAT_DESCS[category] || category;
  const rules    = LEVEL_RULES[level]  || LEVEL_RULES[3];
  const langNote = lang !== "en"
    ? `\nRespond in ${lang === "hr" ? "Croatian" : lang === "de" ? "German" : lang === "it" ? "Italian" : "English"}.`
    : "";

  return `Generate a BLUFF game round. Category: ${catDesc}.

${rules}

Create EXACTLY 5 statements: 4 TRUE + 1 FALSE.
Randomize which position (1–5) contains the lie — NOT always second.
${langNote}

Respond ONLY with valid JSON, no markdown fences:
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
- Each statement: 1-2 sentences, specific (names, numbers, dates)
- No "Did you know" or "Interestingly" openers
- The false statement must SOUND completely plausible`;
}

// ── Firestore helpers ─────────────────────────────────────────
async function fsGet(col, id) {
  if (!FB_KEY) return null;
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${col}/${id}?key=${FB_KEY}`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (!r.ok) return null;
  return r.json();
}

async function fsPatch(col, id, fields) {
  if (!FB_KEY) return;
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${col}/${id}?key=${FB_KEY}`,
    {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fields }),
      signal:  AbortSignal.timeout(6000),
    }
  );
}

async function fsQuery(col, filters) {
  if (!FB_KEY) return [];
  const body = {
    structuredQuery: {
      from: [{ collectionId: col }],
      where: {
        compositeFilter: {
          op: "AND",
          filters: filters.map(([field, op, val]) => ({
            fieldFilter: {
              field: { fieldPath: field },
              op,
              value: typeof val === "boolean"
                ? { booleanValue: val }
                : typeof val === "number"
                  ? { integerValue: String(val) }
                  : { stringValue: val },
            },
          })),
        },
      },
      orderBy: [{ field: { fieldPath: "ts" }, direction: "ASCENDING" }],
      limit: 1,
    },
  };
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents:runQuery?key=${FB_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000) }
  );
  if (!r.ok) return [];
  const data = await r.json();
  return data.filter(d => d.document).map(d => d.document);
}

// ── Try to pop a pre-generated round from cache ───────────────
async function popFromCache(category, level) {
  if (!FB_KEY) return null;
  try {
    const docs = await fsQuery(CACHE_COL, [
      ["category", "EQUAL", category],
      ["level",    "EQUAL", level],
      ["used",     "EQUAL", false],
    ]);
    if (!docs.length) return null;

    const doc    = docs[0];
    const docId  = doc.name.split("/").pop();
    const f      = doc.fields || {};
    const stmts  = (f.statements?.arrayValue?.values || []).map(v => ({
      text: v.mapValue.fields.text.stringValue,
      real: v.mapValue.fields.real.booleanValue,
    }));
    if (stmts.length !== 5 || !stmts.some(s => !s.real)) return null;

    // Mark as used (fire and forget)
    fsPatch(CACHE_COL, docId, { used: { booleanValue: true } }).catch(() => {});

    return {
      statements:       stmts,
      bluffExplanation: f.bluffExplanation?.stringValue || "",
    };
  } catch { return null; }
}

// ── Save round to bluff_rounds (with real flags) ──────────────
async function saveRound(id, data) {
  if (!FB_KEY) return;
  const fields = {
    category:         { stringValue:  data.category },
    level:            { integerValue: String(data.level) },
    lang:             { stringValue:  data.lang },
    bluffExplanation: { stringValue:  data.bluffExplanation || "" },
    answered:         { booleanValue: false },
    ts:               { stringValue:  new Date().toISOString() },
    statements: {
      arrayValue: {
        values: data.statements.map(s => ({
          mapValue: { fields: {
            text: { stringValue:  s.text },
            real: { booleanValue: s.real },
          }},
        })),
      },
    },
  };
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${ROUNDS_COL}/${id}?key=${FB_KEY}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields && { fields }), signal: AbortSignal.timeout(8000) }
  );
}

// ── Generate via Claude ───────────────────────────────────────
async function generateWithClaude(category, level, lang) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":         ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages:   [{ role: "user", content: buildPrompt(category, level, lang) }],
    }),
    signal: AbortSignal.timeout(28000),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI ${resp.status}: ${t.slice(0, 100)}`);
  }

  const data  = await resp.json();
  const raw   = data.content?.[0]?.text || "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON from AI: " + raw.slice(0, 80));
  const parsed = JSON.parse(match[0]);

  if (!Array.isArray(parsed.statements) || parsed.statements.length !== 5)
    throw new Error("AI returned invalid structure");
  if (!parsed.statements.some(s => s.real === false))
    throw new Error("AI returned no bluff");

  return {
    statements:       parsed.statements,
    bluffExplanation: parsed.bluffExplanation || "",
  };
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin",  CORS.includes(origin) ? origin : (CORS[0] || "*"));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "POST only" });
  if (!ANTHROPIC_KEY)          return res.status(503).json({ error: "AI not configured" });

  const {
    category  = "history",
    difficulty = 3,   // 1-5
    lang      = "en",
  } = req.body || {};

  const level = Math.max(1, Math.min(5, parseInt(difficulty) || 3));

  // 1. Try cache first (instant response)
  let round = await popFromCache(category, level);
  let source = "cache";

  // 2. Fallback to live Claude generation
  if (!round) {
    source = "live";
    try {
      round = await generateWithClaude(category, level, lang);
    } catch (e) {
      return res.status(502).json({ error: "AI error: " + e.message });
    }
  }

  const roundId = `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // Save to bluff_rounds (real flags, never sent to client)
  saveRound(roundId, { category, level, lang, ...round }).catch(() => {});

  return res.status(200).json({
    roundId,
    statements: round.statements.map(s => ({ text: s.text })),
    category,
    level,
    source, // "cache" or "live" — for analytics only
  });
}

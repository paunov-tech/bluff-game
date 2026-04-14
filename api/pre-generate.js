// api/pre-generate.js — BLUFF v2 — Pre-generate cache rounds into Firestore
// Vercel cron: every 6h  →  1 round per (category × level) = 40 rounds/run
// Stored in bluff_cache with used=false; generate-round.js pops them on demand

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FB_KEY        = process.env.FIREBASE_API_KEY;
const FB_PROJECT    = "molty-portal";
const CACHE_COL     = "bluff_cache";

const CATS = ["history","science","animals","geography","food","technology","culture","sports"];
const LEVELS = [1,2,3,4,5];

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

// ── Build Claude prompt ──────────────────────────────────────
function buildPrompt(category, level) {
  const catDesc = CAT_DESCS[category] || category;
  const rules   = LEVEL_RULES[level]  || LEVEL_RULES[3];
  return `Generate a BLUFF game round. Category: ${catDesc}.

${rules}

Create EXACTLY 5 statements: 4 TRUE + 1 FALSE.
Randomize which position (1–5) contains the lie — NOT always second.

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

// ── Firestore PATCH ──────────────────────────────────────────
async function fsPatch(col, id, fields) {
  if (!FB_KEY) return;
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${col}/${id}?key=${FB_KEY}`,
    {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fields }),
      signal:  AbortSignal.timeout(8000),
    }
  );
}

// ── Generate one round via Claude ────────────────────────────
async function generateOne(category, level) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "x-api-key":         ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages:   [{ role: "user", content: buildPrompt(category, level) }],
    }),
    signal: AbortSignal.timeout(28000),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI ${resp.status}: ${t.slice(0, 80)}`);
  }

  const data   = await resp.json();
  const raw    = data.content?.[0]?.text || "";
  const match  = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON from AI");
  const parsed = JSON.parse(match[0]);

  if (!Array.isArray(parsed.statements) || parsed.statements.length !== 5)
    throw new Error("Bad structure");
  if (!parsed.statements.some(s => s.real === false))
    throw new Error("No bluff in response");

  return {
    statements:       parsed.statements,
    bluffExplanation: parsed.bluffExplanation || "",
  };
}

// ── Store round in bluff_cache ───────────────────────────────
async function storeInCache(category, level, round) {
  const id = `cache_${category}_${level}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  await fsPatch(CACHE_COL, id, {
    category:         { stringValue:  category },
    level:            { integerValue: String(level) },
    used:             { booleanValue: false },
    ts:               { stringValue:  new Date().toISOString() },
    bluffExplanation: { stringValue:  round.bluffExplanation || "" },
    statements: {
      arrayValue: {
        values: round.statements.map(s => ({
          mapValue: { fields: {
            text: { stringValue:  s.text },
            real: { booleanValue: s.real },
          }},
        })),
      },
    },
  });
}

// ── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  // Accept Vercel cron requests (x-vercel-cron: 1) or manual with token
  const isCron = req.headers["x-vercel-cron"] === "1";
  const token  = req.headers["x-admin-token"] || req.query.token || "";
  const secret = process.env.CRON_SECRET;
  if (!isCron && secret && token !== secret)
    return res.status(401).json({ error: "unauthorized" });
  if (!ANTHROPIC_KEY)
    return res.status(503).json({ error: "AI not configured" });
  if (!FB_KEY)
    return res.status(503).json({ error: "Firestore not configured" });

  // Build all 40 combos
  const combos = [];
  for (const cat of CATS) {
    for (const lvl of LEVELS) {
      combos.push({ category: cat, level: lvl });
    }
  }

  // Process in batches of 8 (Anthropic rate-limit safe)
  const BATCH_SIZE = 8;
  const results = { ok: 0, failed: 0, errors: [] };

  for (let i = 0; i < combos.length; i += BATCH_SIZE) {
    const batch = combos.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ category, level }) => {
        try {
          const round = await generateOne(category, level);
          await storeInCache(category, level, round);
          results.ok++;
        } catch (e) {
          results.failed++;
          results.errors.push(`${category}:${level}: ${e.message}`);
        }
      })
    );
  }

  return res.status(200).json({
    generated: results.ok,
    failed:    results.failed,
    errors:    results.errors,
    timestamp: new Date().toISOString(),
  });
}

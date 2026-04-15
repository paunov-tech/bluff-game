// api/duel/create.js
// POST { rounds, score, time, results, name }
// Saves challenger data to Firestore and returns { challengeId }

const FB_KEY     = process.env.FIREBASE_API_KEY;
const FB_PROJECT = "molty-portal";

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

// URL-safe alphanumeric, avoid confusable chars
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjklmnpqrstuvwxyz23456789";
function generateId(len = 6) {
  return Array.from({ length: len }, () =>
    CHARS[Math.floor(Math.random() * CHARS.length)]
  ).join("");
}

async function fsSet(col, id, fields) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${col}/${id}?key=${FB_KEY}`,
    {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fields }),
      signal:  AbortSignal.timeout(8000),
    }
  );
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Firestore PATCH ${r.status}: ${t.slice(0, 80)}`);
  }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin",  CORS.includes(origin) ? origin : (CORS[0] || "*"));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "POST only" });

  if (!FB_KEY) return res.status(503).json({ error: "DB not configured" });

  const { rounds, score, time, results, name } = req.body || {};

  if (!Array.isArray(rounds) || rounds.length === 0)
    return res.status(400).json({ error: "rounds required" });
  if (typeof score !== "number")
    return res.status(400).json({ error: "score must be a number" });

  const challengeId = generateId(6);
  const now = Date.now();

  const challengerData = {
    name:        String(name || "Anonymous").slice(0, 30),
    score,
    time:        typeof time === "number" ? time : 0,
    rounds,      // [{statements: [{text, real}], category}] — full data for replay
    results:     Array.isArray(results) ? results : [],
    completedAt: now,
  };

  try {
    await fsSet("duels", challengeId, {
      challengeId:     { stringValue: challengeId },
      createdAt:       { integerValue: String(now) },
      expiresAt:       { integerValue: String(now + 7 * 24 * 60 * 60 * 1000) },
      status:          { stringValue: "pending" },
      winner:          { stringValue: "" },
      challenger_json: { stringValue: JSON.stringify(challengerData) },
      opponent_json:   { stringValue: "" },
    });

    return res.status(200).json({ challengeId });
  } catch (e) {
    console.error("[duel/create]", e.message);
    return res.status(500).json({ error: "Failed to create duel: " + e.message });
  }
}

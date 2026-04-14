// api/check-answer.js — Verify player's answer and update stats
// POST { roundId, selectedIndex, deviceId }
// Returns { correct, bluffIndex, explanation }

const FB_KEY     = process.env.FIREBASE_API_KEY;
const FB_PROJECT = "molty-portal";

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

// ── Firestore helpers ──────────────────────────────────────
async function fsGet(collection, id) {
  if (!FB_KEY) return null;
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${collection}/${id}?key=${FB_KEY}`,
    { signal: AbortSignal.timeout(6000) }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Firestore GET ${r.status}`);
  return r.json();
}

async function fsPatch(collection, id, fields) {
  if (!FB_KEY) return;
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${collection}/${id}?key=${FB_KEY}`,
    {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fields }),
      signal:  AbortSignal.timeout(6000),
    }
  );
}

// ── Handler ──────────────────────────────────────────────
export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allowOrigin = CORS.includes(origin) ? origin : (CORS[0] || "*");
  res.setHeader("Access-Control-Allow-Origin",  allowOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")   return res.status(405).json({ error: "POST only" });

  const { roundId, selectedIndex, deviceId } = req.body || {};
  if (!roundId)               return res.status(400).json({ error: "roundId required" });
  if (selectedIndex === undefined) return res.status(400).json({ error: "selectedIndex required" });

  // ── Read round ──────────────────────────────────────────
  let doc;
  try { doc = await fsGet("bluff_rounds", roundId); } catch (e) {
    return res.status(500).json({ error: "DB read error: " + e.message });
  }

  if (!doc?.fields) {
    // Firestore not configured or round missing — fallback: can't verify
    return res.status(200).json({ correct: null, bluffIndex: null, explanation: "", offline: true });
  }

  // Prevent re-answering same round (anti-replay)
  if (doc.fields.answered?.booleanValue === true) {
    // Already answered — return stored result without updating stats again
    const stmts = doc.fields.statements?.arrayValue?.values || [];
    const bluffIndex = stmts.findIndex(v => v.mapValue?.fields?.real?.booleanValue === false);
    const correct = parseInt(selectedIndex) === bluffIndex;
    return res.status(200).json({
      correct,
      bluffIndex,
      explanation: doc.fields.bluffExplanation?.stringValue || "",
    });
  }

  // ── Find bluff index ────────────────────────────────────
  const stmts = doc.fields.statements?.arrayValue?.values || [];
  const bluffIndex = stmts.findIndex(v => v.mapValue?.fields?.real?.booleanValue === false);

  if (bluffIndex === -1) {
    return res.status(500).json({ error: "Round data corrupt — no bluff found" });
  }

  const correct     = parseInt(selectedIndex) === bluffIndex;
  const explanation = doc.fields.bluffExplanation?.stringValue || "";

  // ── Mark round as answered ──────────────────────────────
  fsPatch("bluff_rounds", roundId, { answered: { booleanValue: true } }).catch(() => {});

  // ── Update user stats ───────────────────────────────────
  if (deviceId) {
    (async () => {
      try {
        const userDoc    = await fsGet("bluff_users", deviceId);
        const f          = userDoc?.fields || {};
        const prevScore  = parseInt(f.score?.integerValue        || "0");
        const prevStreak = parseInt(f.streak?.integerValue       || "0");
        const prevBest   = parseInt(f.bestStreak?.integerValue   || "0");
        const prevTotal  = parseInt(f.total?.integerValue        || "0");
        const newStreak  = correct ? prevStreak + 1 : 0;
        const newBest    = Math.max(prevBest, newStreak);

        await fsPatch("bluff_users", deviceId, {
          score:      { integerValue: String(prevScore + (correct ? 1 : 0)) },
          streak:     { integerValue: String(newStreak) },
          bestStreak: { integerValue: String(newBest) },
          total:      { integerValue: String(prevTotal + 1) },
          lastPlayed: { stringValue:  new Date().toISOString() },
        });
      } catch (_) { /* stats update is non-fatal */ }
    })();
  }

  return res.status(200).json({ correct, bluffIndex, explanation });
}

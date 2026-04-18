// api/duel-rounds.js — Returns N fresh pre-generated rounds from Firestore
// Called by PartyKit duel server when a match starts.
// Query params: ?mode=regular|blitz&count=6

const FB_KEY     = process.env.FIREBASE_API_KEY;
const FB_PROJECT = "molty-portal";
const FB_URL     = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

const COLLECTION_BY_MODE = {
  regular: "bluff_cache",
  blitz:   "bluff_rounds_blitz",
};

// Difficulty distribution — matches buildFallbackRounds in party/duel.ts
const DIFFICULTIES = {
  regular: [2, 3, 3, 4, 3, 4],
  blitz:   [3, 4, 4, 5],
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const mode = req.query.mode === "blitz" ? "blitz" : "regular";
  const collection = COLLECTION_BY_MODE[mode];
  const targetDiffs = DIFFICULTIES[mode];

  if (!FB_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }

  try {
    const listUrl = `${FB_URL}/${collection}?key=${FB_KEY}&pageSize=500`;
    const listRes = await fetch(listUrl);
    if (!listRes.ok) {
      throw new Error(`Firestore list failed: ${listRes.status}`);
    }
    const listData = await listRes.json();
    const docs = (listData.documents || [])
      .map(d => parseFirestoreDoc(d))
      .filter(Boolean);

    if (docs.length === 0) {
      return res.status(503).json({ error: "Cache empty" });
    }

    // Group by difficulty level (pre-generate writes the field as `level`)
    const byDiff = {};
    for (const d of docs) {
      const diff = d.difficulty ?? d.level ?? 3;
      if (!byDiff[diff]) byDiff[diff] = [];
      byDiff[diff].push(d);
    }

    // Cap sports at 1 round per 6-match (prevent Bundesliga/NBA dominance)
    const MAX_SPORTS_PER_MATCH = 1;

    const rounds = [];
    const usedIds = new Set();
    const categoryCount = {};

    for (const targetDiff of targetDiffs) {
      let pool = (byDiff[targetDiff] || []).filter(r => !usedIds.has(r.id));

      // If this level has no unused rounds, fall back to any unused
      if (pool.length === 0) {
        pool = docs.filter(r => !usedIds.has(r.id));
      }

      // Prefer rounds that don't exceed category cap
      const preferredPool = pool.filter(r => {
        const cat = r.category || "mixed";
        if (cat === "sports" && (categoryCount.sports || 0) >= MAX_SPORTS_PER_MATCH) {
          return false;
        }
        // Avoid repeating the same non-sport category more than twice
        if ((categoryCount[cat] || 0) >= 2) return false;
        return true;
      });

      const finalPool = preferredPool.length > 0 ? preferredPool : pool;
      if (finalPool.length === 0) break;

      const pick = finalPool[Math.floor(Math.random() * finalPool.length)];
      usedIds.add(pick.id);
      const cat = pick.category || "mixed";
      categoryCount[cat] = (categoryCount[cat] || 0) + 1;

      rounds.push({
        category: cat,
        difficulty: targetDiff,
        statements: pick.statements || [],
      });
    }

    if (rounds.length < targetDiffs.length) {
      return res.status(206).json({
        rounds,
        partial: true,
        requested: targetDiffs.length,
      });
    }

    return res.status(200).json({ rounds });
  } catch (err) {
    console.error("[duel-rounds] error:", err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}

function parseFirestoreDoc(doc) {
  if (!doc || !doc.fields) return null;
  const id = doc.name?.split("/").pop();
  const out = { id };
  for (const [key, val] of Object.entries(doc.fields)) {
    out[key] = parseFirestoreValue(val);
  }
  return out;
}

function parseFirestoreValue(val) {
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
  if (val.doubleValue !== undefined) return val.doubleValue;
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.arrayValue !== undefined) {
    return (val.arrayValue.values || []).map(parseFirestoreValue);
  }
  if (val.mapValue !== undefined) {
    const obj = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      obj[k] = parseFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

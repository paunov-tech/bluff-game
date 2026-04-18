// api/solo-rounds.js — Returns pre-generated solo rounds from Firestore
// Called by solo mode at game start. Supports hybrid batching.
// Query params: ?phase=first|second — first returns rounds 1-6, second 7-12

const FB_KEY     = process.env.FIREBASE_API_KEY;
const FB_PROJECT = "molty-portal";
const FB_URL     = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

// Solo has 12 rounds across 3 waves, difficulty ramps up
const SOLO_DIFFICULTIES = [1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const phase = req.query.phase === "second" ? "second" : "first";
  const targetDiffs = phase === "first"
    ? SOLO_DIFFICULTIES.slice(0, 6)   // rounds 1-6
    : SOLO_DIFFICULTIES.slice(6, 12); // rounds 7-12

  if (!FB_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }

  try {
    const listUrl = `${FB_URL}/bluff_cache?key=${FB_KEY}&pageSize=500`;
    const listRes = await fetch(listUrl);
    if (!listRes.ok) throw new Error(`Firestore list failed: ${listRes.status}`);

    const listData = await listRes.json();
    const docs = (listData.documents || [])
      .map(d => parseFirestoreDoc(d))
      .filter(Boolean);

    if (docs.length === 0) {
      return res.status(503).json({ error: "Cache empty" });
    }

    const byDiff = {};
    for (const d of docs) {
      const diff = d.difficulty ?? d.level ?? 3;
      if (!byDiff[diff]) byDiff[diff] = [];
      byDiff[diff].push(d);
    }

    const MAX_SPORTS = 1;
    const MAX_SAME_CAT = 2;
    const rounds = [];
    const usedIds = new Set();
    const categoryCount = {};

    for (const targetDiff of targetDiffs) {
      let pool = (byDiff[targetDiff] || []).filter(r => !usedIds.has(r.id));

      // Fall back to nearby difficulty if exact level empty
      if (pool.length === 0) {
        const adjacent = [targetDiff - 1, targetDiff + 1, targetDiff - 2, targetDiff + 2];
        for (const d of adjacent) {
          const alt = (byDiff[d] || []).filter(r => !usedIds.has(r.id));
          if (alt.length > 0) { pool = alt; break; }
        }
      }

      // Last-resort: any unused
      if (pool.length === 0) {
        pool = docs.filter(r => !usedIds.has(r.id));
      }

      const preferred = pool.filter(r => {
        const cat = r.category || "mixed";
        if (cat === "sports" && (categoryCount.sports || 0) >= MAX_SPORTS) return false;
        if ((categoryCount[cat] || 0) >= MAX_SAME_CAT) return false;
        return true;
      });

      const finalPool = preferred.length > 0 ? preferred : pool;
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
        phase,
      });
    }

    return res.status(200).json({ rounds, phase });
  } catch (err) {
    console.error("[solo-rounds] error:", err);
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

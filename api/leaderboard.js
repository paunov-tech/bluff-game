// api/leaderboard.js — BLUFF v3 — Daily leaderboard
// GET  → returns top 10 for today
// POST { deviceId, playerName, score, climbComplete } → upserts (only if score improves)

const FB_KEY     = process.env.FIREBASE_API_KEY;
const FB_PROJECT = "molty-portal";
const COL        = "bluff_leaderboard";

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

function today() { return new Date().toISOString().slice(0, 10); }

async function fsGet(id) {
  if (!FB_KEY) return null;
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${COL}/${id}?key=${FB_KEY}`,
    { signal: AbortSignal.timeout(5000) }
  );
  if (r.status === 404) return null;
  if (!r.ok) return null;
  return r.json();
}

async function fsPatch(id, fields) {
  if (!FB_KEY) return;
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${COL}/${id}?key=${FB_KEY}`,
    {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fields }),
      signal:  AbortSignal.timeout(6000),
    }
  );
}

async function fsQuery(date) {
  if (!FB_KEY) return [];
  const body = {
    structuredQuery: {
      from: [{ collectionId: COL }],
      where: {
        fieldFilter: {
          field: { fieldPath: "date" },
          op: "EQUAL",
          value: { stringValue: date },
        },
      },
      orderBy: [{ field: { fieldPath: "score" }, direction: "DESCENDING" }],
      limit: 10,
    },
  };
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents:runQuery?key=${FB_KEY}`,
    { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body), signal:AbortSignal.timeout(6000) }
  );
  if (!r.ok) return [];
  const data = await r.json();
  return data.filter(d => d.document).map(d => {
    const f = d.document.fields || {};
    return {
      playerName:     f.playerName?.stringValue    || "Anonymous",
      score:          parseInt(f.score?.integerValue || "0"),
      climbComplete:  f.climbComplete?.booleanValue || false,
      completedAt:    f.completedAt?.stringValue    || "",
    };
  });
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin",  CORS.includes(origin) ? origin : (CORS[0] || "*"));
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  // ── GET — fetch today's top 10 ─────────────────────────────
  if (req.method === "GET") {
    try {
      const rows = await fsQuery(today());
      return res.status(200).json({ date: today(), leaderboard: rows });
    } catch {
      return res.status(200).json({ date: today(), leaderboard: [] });
    }
  }

  // ── POST — upsert player score ─────────────────────────────
  if (req.method === "POST") {
    const { deviceId, playerName = "Anonymous", score = 0, climbComplete = false } = req.body || {};
    if (!deviceId) return res.status(400).json({ error: "deviceId required" });

    const docId = `${today()}_${deviceId}`;
    try {
      // Only update if new score is better
      const existing = await fsGet(docId);
      const prevScore = parseInt(existing?.fields?.score?.integerValue || "0");
      if (score <= prevScore) return res.status(200).json({ updated: false, score: prevScore });

      await fsPatch(docId, {
        deviceId:      { stringValue:  deviceId },
        playerName:    { stringValue:  playerName.slice(0, 20) },
        score:         { integerValue: String(score) },
        climbComplete: { booleanValue: climbComplete },
        date:          { stringValue:  today() },
        completedAt:   { stringValue:  new Date().toISOString() },
      });
      return res.status(200).json({ updated: true, score });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "GET or POST only" });
}

// api/duel/[id].js
// GET  → returns challenge data (rounds included so opponent can replay)
// POST { score, time, results, name } → opponent finishes, computes winner

const FB_KEY     = process.env.FIREBASE_API_KEY;
const FB_PROJECT = "molty-portal";

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

async function fsGet(col, id) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${col}/${id}?key=${FB_KEY}`,
    { signal: AbortSignal.timeout(6000) }
  );
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Firestore GET ${r.status}`);
  return r.json();
}

async function fsPatch(col, id, fields) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${col}/${id}?key=${FB_KEY}`,
    {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fields }),
      signal:  AbortSignal.timeout(8000),
    }
  );
  if (!r.ok) throw new Error(`Firestore PATCH ${r.status}`);
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin",  CORS.includes(origin) ? origin : (CORS[0] || "*"));
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!FB_KEY) return res.status(503).json({ error: "DB not configured" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "id required" });

  let doc;
  try { doc = await fsGet("duels", id); } catch (e) {
    return res.status(500).json({ error: "DB read error" });
  }

  if (!doc?.fields) return res.status(404).json({ error: "Duel not found" });

  const f          = doc.fields;
  const status     = f.status?.stringValue || "pending";
  const challenger = JSON.parse(f.challenger_json?.stringValue || "{}");
  const oppRaw     = f.opponent_json?.stringValue;
  const opponent   = oppRaw ? JSON.parse(oppRaw) : null;

  // ── GET ──────────────────────────────────────────────────────
  if (req.method === "GET") {
    // Check expiry
    const expiresAt = parseInt(f.expiresAt?.integerValue || "0");
    if (expiresAt && Date.now() > expiresAt) {
      return res.status(410).json({ error: "Duel has expired" });
    }

    return res.status(200).json({
      challengeId: f.challengeId?.stringValue || id,
      status,
      winner: f.winner?.stringValue || null,
      challenger: {
        name:    challenger.name    || "Anonymous",
        score:   challenger.score  ?? 0,
        time:    challenger.time   ?? 0,
        results: challenger.results || [],
        rounds:  challenger.rounds  || [],  // full round data for replay
      },
      opponent: opponent ? {
        name:    opponent.name    || "Anonymous",
        score:   opponent.score  ?? 0,
        time:    opponent.time   ?? 0,
        results: opponent.results || [],
      } : null,
    });
  }

  // ── POST (opponent submits result) ───────────────────────────
  if (req.method === "POST") {
    if (status === "completed") {
      return res.status(200).json({
        winner:          f.winner?.stringValue || "challenger",
        challengerScore: challenger.score ?? 0,
        opponentScore:   opponent?.score  ?? 0,
        challengerName:  challenger.name  || "Challenger",
        opponentName:    opponent?.name   || "Opponent",
        alreadyCompleted: true,
      });
    }

    const { score, time, results, name } = req.body || {};
    if (typeof score !== "number") return res.status(400).json({ error: "score required" });

    const now          = Date.now();
    const opponentData = {
      name:        String(name || "Anonymous").slice(0, 30),
      score,
      time:        typeof time === "number" ? time : 0,
      results:     Array.isArray(results) ? results : [],
      completedAt: now,
    };

    const cScore = challenger.score ?? 0;
    const cTime  = challenger.time  ?? 0;
    const winner =
      score > cScore ? "opponent"
      : score < cScore ? "challenger"
      : (time ?? 999) < cTime ? "opponent"   // tie-break: faster wins
      : "challenger";

    try {
      await fsPatch("duels", id, {
        status:        { stringValue: "completed" },
        winner:        { stringValue: winner },
        opponent_json: { stringValue: JSON.stringify(opponentData) },
      });

      return res.status(200).json({
        winner,
        challengerScore: cScore,
        opponentScore:   score,
        challengerName:  challenger.name || "Challenger",
        opponentName:    opponentData.name,
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

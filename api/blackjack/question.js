// api/blackjack-question.js — Pull the next TRUE/LIE statement for the
// player's pending Blackjack hit decision.
//
// POST /api/blackjack-question
//   Body: { sessionId, userId? }
//
// Picks an un-used statement from the session's prefetched pool, marks it
// pending on the session, returns id+text to the client. The truth flag
// (`isTrue`) is held server-side until /api/blackjack-answer is called.

import { verifyRequestAuth } from "../_lib/verify-firebase-token.js";
import { rateLimit, applyRateLimitHeaders } from "../_lib/rate-limit.js";
import { loadSession, saveSession } from "../_lib/blackjack.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "POST only" });

  const rl = await rateLimit(req, { bucket: "blackjack-question", limit: 120, windowSec: 60 });
  applyRateLimitHeaders(res, rl);
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  if (!process.env.FIREBASE_API_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }

  const body = req.body || {};
  const { sessionId } = body;
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId required" });
  }

  const auth = await verifyRequestAuth(req);
  const uid  = auth?.uid || (typeof body.userId === "string" ? body.userId.slice(0, 80) : "");

  let session;
  try {
    session = await loadSession(sessionId);
  } catch (e) {
    return res.status(500).json({ error: "session_read_failed" });
  }
  if (!session) return res.status(404).json({ error: "session_not_found" });
  if (session.userId && uid && session.userId !== uid) {
    return res.status(403).json({ error: "uid_mismatch" });
  }
  if (session.state !== "player_turn") {
    return res.status(400).json({ error: `not_player_turn:${session.state}` });
  }

  const remaining = session.pool.filter(s => !session.poolUsed.includes(s.id));
  if (remaining.length === 0) {
    return res.status(503).json({ error: "pool_exhausted" });
  }

  // Prefer mid-difficulty for player questions (level 2-3), but fall back to
  // anything if the easy bucket is empty.
  let candidates = remaining.filter(s => s.difficulty >= 2 && s.difficulty <= 3);
  if (candidates.length === 0) candidates = remaining;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];

  session.poolUsed.push(pick.id);
  session.pending = {
    id:        pick.id,
    isTrue:    !!pick.isTrue,
    askedAt:   Date.now(),
  };
  try {
    await saveSession(session);
  } catch (e) {
    console.warn("[blackjack-question] save:", e.message);
    // Non-fatal — return the question anyway. If the answer endpoint can't
    // find pending, it will 400 cleanly.
  }

  return res.status(200).json({
    statement: {
      id:         pick.id,
      text:       pick.text,
      difficulty: pick.difficulty,
    },
  });
}

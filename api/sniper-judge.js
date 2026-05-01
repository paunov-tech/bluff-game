// api/sniper-judge.js — Validate one sniper tap.
//
// POST { sessionId, sentenceId, tappedWordIndex, userId? }
//
// Returns:
//   { correct, lieWordIndex, lieWord, correctWord, explanation,
//     pointsAwarded, swearAwarded, duplicate? }
//
// Per-sentence dedup via session.consumed. The same sentence can't
// double-pay even on retry. SWEAR is NOT credited to the player's
// bluff_players doc here — sniper points/swear stay in-run only and
// roll up into the run-end /api/swear-earn call from the client.

import { fsGetFields, fsPatchMerge, toFS } from "./_lib/firestore-rest.js";
import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";
import { rateLimit, applyRateLimitHeaders } from "./_lib/rate-limit.js";

const SESSIONS_COL = "sniper_sessions";
const POINTS_HIT   = 200;
const SWEAR_HIT    = 10;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const rl = await rateLimit(req, { bucket: "sniper-judge", limit: 60, windowSec: 60 });
  applyRateLimitHeaders(res, rl);
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  if (!process.env.FIREBASE_API_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }

  const { sessionId, sentenceId, tappedWordIndex } = req.body || {};
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId required" });
  }
  if (!sentenceId || typeof sentenceId !== "string") {
    return res.status(400).json({ error: "sentenceId required" });
  }
  // tappedWordIndex may be -1 for "timed out" — that always counts as wrong.
  if (!Number.isInteger(tappedWordIndex)) {
    return res.status(400).json({ error: "tappedWordIndex must be integer" });
  }

  const auth = await verifyRequestAuth(req);
  const uid  = auth?.uid || (typeof req.body.userId === "string" ? req.body.userId.slice(0, 80) : "");

  let session;
  try {
    session = await fsGetFields(SESSIONS_COL, sessionId);
  } catch {
    return res.status(500).json({ error: "session_read_failed" });
  }
  if (!session) return res.status(404).json({ error: "session_not_found" });

  if (session.userId && uid && session.userId !== uid) {
    return res.status(403).json({ error: "session_uid_mismatch" });
  }

  const sentences = Array.isArray(session.sentences) ? session.sentences : [];
  const sentence  = sentences.find(s => s && s.id === sentenceId);
  if (!sentence) return res.status(404).json({ error: "sentence_not_found" });

  const consumed = Array.isArray(session.consumed) ? session.consumed : [];
  if (consumed.includes(sentenceId)) {
    return res.status(200).json({
      correct: false, duplicate: true,
      lieWordIndex: sentence.lieWordIndex,
      lieWord:      sentence.lieWord,
      correctWord:  sentence.correctWord,
      explanation:  sentence.explanation,
      pointsAwarded: 0,
      swearAwarded:  0,
    });
  }

  const correct = tappedWordIndex >= 0 && tappedWordIndex === sentence.lieWordIndex;
  const pointsAwarded = correct ? POINTS_HIT : 0;
  const swearAwarded  = correct ? SWEAR_HIT  : 0;

  // Mark consumed (best-effort — never block the response).
  fsPatchMerge(SESSIONS_COL, sessionId, {
    consumed:  toFS(consumed.concat([sentenceId])),
    updatedAt: toFS(Date.now()),
  }, ["consumed", "updatedAt"]).catch(err => console.warn("[sniper-judge] session merge:", err.message));

  return res.status(200).json({
    correct,
    lieWordIndex: sentence.lieWordIndex,
    lieWord:      sentence.lieWord,
    correctWord:  sentence.correctWord,
    explanation:  sentence.explanation,
    pointsAwarded,
    swearAwarded,
  });
}

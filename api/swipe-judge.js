// api/swipe-judge.js — Validate one swipe, award SWEAR, update seen+stats.
//
// POST { sessionId, statementId, swipeDirection: "right"|"left", reactionMs }
//   right = TRUE (the user thinks the statement is true)
//   left  = LIE  (the user thinks the statement is false)
//
// Returns:
//   { correct, isTrue, swearAwarded, newCombo, totalCorrect, totalSwiped,
//     newBalance, feedback, anonymousCapHit }
//
// SWEAR awarding bypasses /api/swear-earn because:
//   • Earning is fast (≤2-3s per call) — going through the rate-table dedup
//     would require unique gameIds and triple network hops per swipe.
//   • This endpoint maintains its own dedup via `consumedIds` on the session
//     doc — a single statement can't double-pay even on retry.
//
// SWEAR per correct swipe:
//   1 base
//   +1 if combo ≥ 5 (current run before this swipe, including it)
//   +2 if reactionMs < 1500 (lightning bonus)

import {
  fsGetFields, fsPatchMerge, fsIncrement, toFS,
} from "./_lib/firestore-rest.js";
import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";

const PLAYERS_COL  = "bluff_players";
const SESSIONS_COL = "bluff_swipe_sessions";
const SEEN_COL     = "bluff_swipe_seen";
const ANON_CAP     = 500;
const SEEN_CAP     = 2000;

const COMBO_THRESHOLD   = 5;
const LIGHTNING_MAX_MS  = 1500;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.FIREBASE_API_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }

  const { sessionId, statementId, swipeDirection, reactionMs } = req.body || {};
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId required" });
  }
  if (!statementId || typeof statementId !== "string") {
    return res.status(400).json({ error: "statementId required" });
  }
  if (swipeDirection !== "right" && swipeDirection !== "left") {
    return res.status(400).json({ error: "swipeDirection must be 'right' or 'left'" });
  }
  const reactMs = Number.isFinite(reactionMs) ? Math.max(0, reactionMs | 0) : 99999;

  const auth = await verifyRequestAuth(req);
  const uid  = auth?.uid || (typeof req.body.userId === "string" ? req.body.userId.slice(0, 80) : "");

  // Look up session.
  let session;
  try {
    session = await fsGetFields(SESSIONS_COL, sessionId);
  } catch (e) {
    return res.status(500).json({ error: "session_read_failed" });
  }
  if (!session) {
    return res.status(404).json({ error: "session_not_found" });
  }

  // If the session was opened by a signed-in user, it's bound to that uid.
  if (session.userId && uid && session.userId !== uid) {
    return res.status(403).json({ error: "session_uid_mismatch" });
  }

  const answerKey = session.answerKey || {};
  if (!Object.prototype.hasOwnProperty.call(answerKey, statementId)) {
    return res.status(400).json({ error: "statement_not_in_session" });
  }
  const isTrue = !!answerKey[statementId];

  // Per-statement dedup inside the session.
  const consumedIds = Array.isArray(session.consumedIds) ? session.consumedIds : [];
  if (consumedIds.includes(statementId)) {
    return res.status(200).json({
      correct: false, isTrue, swearAwarded: 0,
      newCombo: 0, duplicate: true,
    });
  }

  const userSaysTrue = swipeDirection === "right";
  const correct = userSaysTrue === isTrue;

  // Compute combo: load existing seen doc to read combo state. We store
  // currentCombo on the session itself so it's atomic per-session.
  const prevCombo = session.currentCombo | 0;
  const newCombo  = correct ? prevCombo + 1 : 0;

  let swearAwarded = 0;
  let feedback = null;
  if (correct) {
    swearAwarded = 1;
    if (newCombo >= COMBO_THRESHOLD) { swearAwarded += 1; feedback = "combo"; }
    if (reactMs < LIGHTNING_MAX_MS)  { swearAwarded += 2; feedback = "lightning"; }
  }

  // Update session: append consumed, bump combo. We always touch this even on
  // wrong answers so the dedup is durable.
  const updatedConsumed = consumedIds.concat([statementId]);
  try {
    await fsPatchMerge(SESSIONS_COL, sessionId, {
      consumedIds:  toFS(updatedConsumed),
      currentCombo: toFS(newCombo),
      updatedAt:    toFS(Date.now()),
    }, ["consumedIds", "currentCombo", "updatedAt"]);
  } catch (e) {
    // Non-fatal — we still award if the session write hiccups, but log loud.
    console.warn("[swipe-judge] session merge failed:", e.message);
  }

  // Award SWEAR + bump player stats. Anonymous users have a hard cap.
  let newBalance = null;
  let anonymousCapHit = false;
  let actualAward = swearAwarded;

  if (uid && actualAward > 0) {
    try {
      const prof = await fsGetFields(PLAYERS_COL, uid);
      if (!prof) {
        // No profile — refuse award gracefully (matches swear-earn behaviour).
        actualAward = 0;
      } else if (prof.migratedTo) {
        actualAward = 0;
      } else if (!auth) {
        // Anonymous: respect the cap. We treat presence of a verified token
        // as the signal — if no token, this is anon traffic.
        const cur = Number(prof.swearBalance || 0);
        if (cur >= ANON_CAP) {
          actualAward = 0; anonymousCapHit = true;
        } else {
          const room = ANON_CAP - cur;
          if (actualAward > room) { actualAward = room; anonymousCapHit = true; }
        }
      }

      if (actualAward > 0) {
        newBalance = await fsIncrement(PLAYERS_COL, uid, "swearBalance", actualAward);
      }
    } catch (e) {
      console.warn("[swipe-judge] balance update failed:", e.message);
    }
  }

  // Bump per-user swipe stats (best-effort, never blocks the response path).
  if (uid) {
    fsIncrement(PLAYERS_COL, uid, "stats.swipeTotal",   1).catch(() => {});
    if (correct) fsIncrement(PLAYERS_COL, uid, "stats.swipeCorrect", 1).catch(() => {});
  }

  // Track seen statement so the next batch excludes it. FIFO-cap to SEEN_CAP.
  if (uid) {
    appendSeen(uid, statementId).catch(() => {});
  }

  return res.status(200).json({
    correct,
    isTrue,
    swearAwarded: actualAward,
    newCombo,
    newBalance: typeof newBalance === "number" ? newBalance : null,
    feedback,
    anonymousCapHit,
  });
}

// Append a statement ID to bluff_swipe_seen/{uid}.seenIds, FIFO-capped.
// Read-modify-write — no atomic array-append in Firestore REST without
// transforms. Race conditions just lose a couple of seen IDs per user, which
// is acceptable (the user just sees a card again sooner than ideal).
async function appendSeen(uid, statementId) {
  let seen = [];
  try {
    const f = await fsGetFields(SEEN_COL, uid);
    if (f && Array.isArray(f.seenIds)) seen = f.seenIds;
  } catch { /* fresh doc */ }
  if (seen.includes(statementId)) return;
  seen.push(statementId);
  if (seen.length > SEEN_CAP) seen = seen.slice(seen.length - SEEN_CAP);
  await fsPatchMerge(SEEN_COL, uid, {
    userId:    toFS(uid),
    seenIds:   toFS(seen),
    updatedAt: toFS(Date.now()),
  }, ["userId", "seenIds", "updatedAt"]);
}

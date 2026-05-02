// api/blackjack-answer.js — Validate the player's TRUE/LIE answer for the
// pending Blackjack hit decision and atomically apply the outcome.
//
// POST /api/blackjack-answer
//   Body: { sessionId, swipeDirection: "right"|"left", reactionMs?, userId? }
//
// Atomic semantics — the answer validation AND the resulting state mutation
// happen in a single server action so the client cannot cheat by, for
// example, "answering" then deciding whether to commit a hit. The pending
// question stored on the session is the only authority for what truth value
// the answer is checked against.
//
// On correct: draw a card for the player (with DOUBLE / AXIOM_ERROR side
// effects), recompute totals, advance to axiom_turn if the player busts.
// On wrong: the player's turn ends — state advances to axiom_turn.
//
// Either way, the pending question is consumed and cleared.

import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";
import { rateLimit, applyRateLimitHeaders } from "./_lib/rate-limit.js";
import {
  applyAxiomErrorIfDrawn, applyDoubleIfPending,
  calcTotal, drawCard, loadSession, redactAxiomHidden, saveSession,
} from "./_lib/blackjack.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "POST only" });

  const rl = await rateLimit(req, { bucket: "blackjack-answer", limit: 120, windowSec: 60 });
  applyRateLimitHeaders(res, rl);
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  if (!process.env.FIREBASE_API_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }

  const body = req.body || {};
  const { sessionId, swipeDirection } = body;
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId required" });
  }
  if (swipeDirection !== "right" && swipeDirection !== "left") {
    return res.status(400).json({ error: "swipeDirection must be 'right' or 'left'" });
  }
  const reactionMs = Number.isFinite(body.reactionMs) ? Math.max(0, body.reactionMs | 0) : 99999;

  const auth = await verifyRequestAuth(req);
  const uid  = auth?.uid || (typeof body.userId === "string" ? body.userId.slice(0, 80) : "");

  let session;
  try {
    session = await loadSession(sessionId);
  } catch {
    return res.status(500).json({ error: "session_read_failed" });
  }
  if (!session) return res.status(404).json({ error: "session_not_found" });
  if (session.userId && uid && session.userId !== uid) {
    return res.status(403).json({ error: "uid_mismatch" });
  }
  if (session.state !== "player_turn") {
    return res.status(400).json({ error: `not_player_turn:${session.state}` });
  }
  if (!session.pending || !session.pending.id) {
    return res.status(400).json({ error: "no_pending_question" });
  }

  const userSaysTrue = swipeDirection === "right";
  const isTrue       = !!session.pending.isTrue;
  const correct      = userSaysTrue === isTrue;

  let newCard       = null;
  let busted        = false;
  let nextState     = "player_turn";
  let axiomTotalDelta = 0;

  if (correct) {
    // HIT — draw a card for the player.
    let card = drawCard(false);
    card = applyDoubleIfPending(session.player, card);
    if (session.player.doubleNext && !card.special) session.player.doubleNext = false;
    // DOUBLE special card itself just primes the next non-special draw.
    if (card.special === "double") session.player.doubleNext = true;
    // AXIOM_ERROR special card subtracts 3 from AXIOM's total.
    if (card.special === "axiom_error") {
      const before = session.axiom.total | 0;
      applyAxiomErrorIfDrawn(card, session.axiom);
      axiomTotalDelta = (session.axiom.total | 0) - before;
    }
    session.player.hand.push(card);
    session.player.total = calcTotal(session.player.hand);
    newCard = card;

    if (session.player.total > 21) {
      session.player.busted = true;
      busted = true;
      session.state = "axiom_turn";
      nextState = "axiom_turn";
    }
  } else {
    // WRONG — turn ends.
    session.state = "axiom_turn";
    nextState = "axiom_turn";
  }

  // Consume pending regardless of outcome.
  session.pending = null;
  try {
    await saveSession(session);
  } catch (e) {
    console.warn("[blackjack-answer] save:", e.message);
  }

  return res.status(200).json({
    correct,
    isTrue,
    newCard,
    playerTotal:  session.player.total,
    busted,
    nextState,
    axiomTotalDelta,
    reactionMs,
    // Always return the redacted session so the client can re-sync state.
    session: redactAxiomHidden(session),
  });
}

// api/blackjack-deal.js — Blackjack 21 Predigra match state machine.
//
// POST /api/blackjack-deal
//   Body: { sessionId?, action, userId?, lang? }
//
// Actions:
//   start_match   → create session, prefetch ~30 statements, deal hand 1
//   stand         → end player turn, set state ready for axiom_turn
//   axiom_turn    → server simulates AXIOM's plays; resolves hand; advances
//                   state. If best-of-3 is over, computes streakTransfer.
//   next_hand     → start the next hand (used between hands, not at match end)
//
// Auth: Firebase ID token Bearer header preferred; falls back to body.userId
// or anonymous. Each session is bound to its owning uid.
//
// Sister endpoints: blackjack-question, blackjack-answer.
// Shared helpers live in api/_lib/blackjack.js.

import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";
import { rateLimit, applyRateLimitHeaders } from "./_lib/rate-limit.js";
import {
  AXIOM_ACCURACY, AXIOM_STAND_AT,
  computeStreakTransfer, drawCard, calcTotal, freshAxiomSlot, freshHandSlot,
  isBlackjackNatural, isMatchOver, loadSession, loadStatementSample,
  newSessionId, redactAxiomHidden, resolveHand, saveSession,
} from "./_lib/blackjack.js";

// ── action handlers ─────────────────────────────────────

async function actionStartMatch({ uid, lang }) {
  const id   = newSessionId();
  const pool = await loadStatementSample(lang, 30);
  if (pool.length < 6) {
    const err = new Error("pool_too_thin");
    err.status = 503;
    throw err;
  }

  const player = freshHandSlot();
  const axiom  = freshAxiomSlot();
  player.hand = [drawCard(false), drawCard(false)];
  player.total = calcTotal(player.hand);
  axiom.hand  = [drawCard(true), drawCard(true)];
  axiom.total = calcTotal(axiom.hand);

  const session = {
    id, userId: uid || null, lang, pool, poolUsed: [],
    pending: null,
    player, axiom,
    score: { player: 0, axiom: 0 },
    handsPlayed: 1,
    hadBlackjack: isBlackjackNatural(player.hand),
    state: "player_turn",
    handWinner: null, matchWinner: null, streakTransfer: null, matchOver: false,
    createdAt: Date.now(),
  };
  await saveSession(session);
  return { session: redactAxiomHidden(session), poolSize: pool.length };
}

function assertOwner(session, uid) {
  if (session.userId && uid && session.userId !== uid) {
    const e = new Error("uid_mismatch");
    e.status = 403;
    throw e;
  }
}

async function actionStand({ session, uid }) {
  assertOwner(session, uid);
  if (session.state !== "player_turn") {
    return { session: redactAxiomHidden(session), warning: "not_player_turn" };
  }
  session.pending = null;
  session.state = "axiom_turn";
  await saveSession(session);
  return { session: redactAxiomHidden(session) };
}

async function actionAxiomTurn({ session, uid }) {
  assertOwner(session, uid);
  if (session.state !== "axiom_turn") {
    return { session: redactAxiomHidden(session), warning: "not_axiom_turn" };
  }

  // AXIOM plays. Returns a sequence of beats the client animates through.
  // If the player busted, AXIOM doesn't draw — player's bust auto-loses.
  const axiomMoves = [];
  if (!session.player.busted) {
    while (session.axiom.total < AXIOM_STAND_AT) {
      const remaining = session.pool.filter(s => !session.poolUsed.includes(s.id));
      if (remaining.length === 0) break;
      const q = remaining[Math.floor(Math.random() * remaining.length)];
      session.poolUsed.push(q.id);

      const correct = Math.random() < AXIOM_ACCURACY;
      const move = { statementId: q.id, statementText: q.text, axiomCorrect: correct, card: null };
      if (correct) {
        const card = drawCard(true);
        session.axiom.hand.push(card);
        session.axiom.total = calcTotal(session.axiom.hand);
        move.card = card;
        if (session.axiom.total > 21) {
          session.axiom.busted = true;
          axiomMoves.push(move);
          break;
        }
      }
      axiomMoves.push(move);
      if (!correct) break;
    }
  }

  // Resolve hand.
  const handWinner = resolveHand(session);
  session.handWinner = handWinner;
  if (handWinner === "player")     session.score.player++;
  else if (handWinner === "axiom") session.score.axiom++;
  // tie_bust → no point either side.

  if (isMatchOver(session)) {
    session.state       = "match_over";
    session.matchWinner = session.score.player > session.score.axiom ? "player"
                       : session.score.axiom  > session.score.player ? "axiom" : null;
    session.matchOver   = true;
    session.streakTransfer = computeStreakTransfer(session);
  } else {
    session.state = "hand_resolved";
  }
  await saveSession(session);
  return {
    session,                                    // post-resolve we can reveal everything
    axiomMoves,
    axiomFinalHand: session.axiom.hand,
    axiomTotal:     session.axiom.total,
    axiomBusted:    session.axiom.busted,
    handWinner,
    matchOver:      session.matchOver,
    matchWinner:    session.matchWinner,
    streakTransfer: session.streakTransfer,
    score:          session.score,
  };
}

async function actionNextHand({ session, uid }) {
  assertOwner(session, uid);
  if (session.state !== "hand_resolved" || session.matchOver) {
    return { session: redactAxiomHidden(session), warning: "cannot_advance" };
  }
  // Carry over the bustedThisMatch flag so streak calc later knows.
  const bustedSticky = !!(session.player && session.player.bustedThisMatch) || !!session.player.busted;

  const player = freshHandSlot();
  const axiom  = freshAxiomSlot();
  player.bustedThisMatch = bustedSticky;
  player.hand  = [drawCard(false), drawCard(false)];
  player.total = calcTotal(player.hand);
  axiom.hand   = [drawCard(true), drawCard(true)];
  axiom.total  = calcTotal(axiom.hand);

  session.player        = player;
  session.axiom         = axiom;
  session.handsPlayed  += 1;
  session.handWinner    = null;
  session.pending       = null;
  session.state         = "player_turn";
  if (isBlackjackNatural(player.hand)) session.hadBlackjack = true;

  await saveSession(session);
  return { session: redactAxiomHidden(session) };
}

// ── handler ──────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "POST only" });

  const rl = await rateLimit(req, { bucket: "blackjack-deal", limit: 60, windowSec: 60 });
  applyRateLimitHeaders(res, rl);
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  if (!process.env.FIREBASE_API_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }

  const body = req.body || {};
  const { sessionId, action } = body;
  if (!action) return res.status(400).json({ error: "action required" });

  const auth = await verifyRequestAuth(req);
  const uid  = auth?.uid || (typeof body.userId === "string" ? body.userId.slice(0, 80) : "");
  const lang = (body.lang || "en").toString().slice(0, 4);

  try {
    if (action === "start_match") {
      const out = await actionStartMatch({ uid, lang });
      return res.status(200).json(out);
    }

    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "sessionId required" });
    }
    const session = await loadSession(sessionId);
    if (!session) return res.status(404).json({ error: "session_not_found" });

    if (action === "stand")      return res.status(200).json(await actionStand({ session, uid }));
    if (action === "axiom_turn") return res.status(200).json(await actionAxiomTurn({ session, uid }));
    if (action === "next_hand")  return res.status(200).json(await actionNextHand({ session, uid }));

    return res.status(400).json({ error: `unknown_action:${action}` });
  } catch (err) {
    const status = err?.status || 500;
    console.warn("[blackjack-deal]", action, err.message);
    return res.status(status).json({ error: err.message || "internal" });
  }
}

// api/_lib/blackjack.js — Shared helpers for the Blackjack 21 Predigra
// endpoints (blackjack-deal, blackjack-question, blackjack-answer).
//
// Pure functions only — no I/O. Server-side only; never imported by the
// client.

import { fsGetFields, fsPatch, fsQuery, toFS } from "./firestore-rest.js";

export const SESSIONS_COL = "blackjack_sessions";
export const POOL_COL     = "bluff_swipe_pool";

const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const SUITS = ["♥","♦","♣","♠"];

// Special-card draw rates — only roll for player draws (spec: "only available
// to player"). Combined ~5% chance per player draw.
const SPECIAL_AXIOM_ERROR_RATE = 0.025;
const SPECIAL_DOUBLE_RATE      = 0.025;

export const AXIOM_STAND_AT      = 17;   // classic Blackjack dealer rule
export const AXIOM_ACCURACY      = 0.70; // server-rolled per AXIOM question
export const POOL_FETCH_LIMIT    = 500;
export const STATEMENTS_PER_MATCH = 30;

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Draw a card. `forAxiom=true` skips special cards (player-only per spec).
export function drawCard(forAxiom) {
  if (!forAxiom) {
    const r = Math.random();
    if (r < SPECIAL_AXIOM_ERROR_RATE) {
      return { rank: "AXIOM_ERROR", suit: null, value: 0, special: "axiom_error" };
    }
    if (r < SPECIAL_AXIOM_ERROR_RATE + SPECIAL_DOUBLE_RATE) {
      return { rank: "DOUBLE", suit: null, value: 0, special: "double" };
    }
  }
  const rank = RANKS[Math.floor(Math.random() * RANKS.length)];
  const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
  let value;
  if (rank === "A")                                       value = 11;
  else if (rank === "J" || rank === "Q" || rank === "K")  value = 10;
  else                                                    value = parseInt(rank, 10);
  return { rank, suit, value };
}

// Sum a hand with optimised aces (11 → 1 if would otherwise bust).
// Special cards are excluded from the running total.
export function calcTotal(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.special) continue;
    total += c.value;
    if (c.rank === "A") aces++;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

export function isBlackjackNatural(hand) {
  if (!hand || hand.length !== 2) return false;
  return calcTotal(hand) === 21;
}

// Mutates `card` to apply a pending DOUBLE (if any). Returns the (possibly
// mutated copy of the) card. Special cards are NOT doubled themselves.
export function applyDoubleIfPending(playerSlot, newCard) {
  if (!playerSlot.doubleNext)        return newCard;
  if (newCard.special)               return newCard;
  return { ...newCard, value: newCard.value * 2, doubled: true };
}

// AXIOM_ERROR card subtracts 3 from AXIOM's total. Mutates `axiomSlot.total`.
export function applyAxiomErrorIfDrawn(card, axiomSlot) {
  if (card.special !== "axiom_error") return;
  axiomSlot.total = Math.max(0, axiomSlot.total - 3);
}

export function freshHandSlot() {
  return { hand: [], total: 0, busted: false, doubleNext: false };
}

export function freshAxiomSlot() {
  return { hand: [], total: 0, busted: false, hiddenIdx: 1 };
}

export function newSessionId() {
  return `bj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Pull a random-ish sample from the swipe pool. Firestore can't sort by
// random, so we fetch a wider window then shuffle in-memory.
export async function loadStatementSample(lang, count) {
  const docs = await fsQuery(POOL_COL, {
    where: [{ path: "lang", op: "EQUAL", value: lang }],
    limit: POOL_FETCH_LIMIT,
  });
  const parsed = docs
    .map(d => ({
      id:         d.id,
      text:       d.fields.text,
      isTrue:     !!d.fields.isTrue,
      difficulty: d.fields.difficulty | 0 || 3,
    }))
    .filter(s => s.text);
  return shuffle(parsed).slice(0, count);
}

export function resolveHand(session) {
  const p = session.player;
  const a = session.axiom;
  if (p.busted && a.busted) return "tie_bust";
  if (p.busted)             return "axiom";
  if (a.busted)             return "player";
  if (p.total >= a.total)   return "player";  // ties to player per spec
  return "axiom";
}

// Best-of-3 streak transfer mapping (per spec):
//   Player 2-0: 7
//   Player 2-1 (no busts):    5
//   Player 2-1 (any bust):    4
//   AXIOM 2-1: 2
//   AXIOM 2-0: 0
//   +2 if any hand was a Blackjack natural on player side
export function computeStreakTransfer(session) {
  const ps = session.score.player | 0;
  const as = session.score.axiom  | 0;
  let s = 0;
  if (ps > as) {
    if (ps === 2 && as === 0) s = 7;
    else if (ps === 2 && as === 1) s = session.player.bustedThisMatch ? 4 : 5;
  } else if (as > ps) {
    if (as === 2 && ps === 0) s = 0;
    else if (as === 2 && ps === 1) s = 2;
  }
  if (session.hadBlackjack) s += 2;
  return Math.max(0, s);
}

export function isMatchOver(session) {
  return session.score.player >= 2 || session.score.axiom >= 2;
}

// Strip the AXIOM hidden card before sending to the client during player
// turn. The total is also nulled while a card is hidden.
export function redactAxiomHidden(session) {
  if (session.state !== "player_turn") return session;
  const a = session.axiom;
  if (!a || !Array.isArray(a.hand) || a.hand.length <= a.hiddenIdx) return session;
  const visibleHand = a.hand.map((c, i) => i === a.hiddenIdx ? { hidden: true } : c);
  return { ...session, axiom: { ...a, hand: visibleHand, total: null } };
}

export async function saveSession(session) {
  await fsPatch(SESSIONS_COL, session.id, {
    userId:        toFS(session.userId || null),
    lang:          toFS(session.lang || "en"),
    pool:          toFS(session.pool || []),
    poolUsed:      toFS(session.poolUsed || []),
    pending:       toFS(session.pending || null),
    player:        toFS(session.player || null),
    axiom:         toFS(session.axiom  || null),
    score:         toFS(session.score  || { player: 0, axiom: 0 }),
    handsPlayed:   toFS(session.handsPlayed | 0),
    hadBlackjack:  toFS(!!session.hadBlackjack),
    state:         toFS(session.state || "player_turn"),
    handWinner:    toFS(session.handWinner || null),
    matchWinner:   toFS(session.matchWinner || null),
    streakTransfer: toFS(session.streakTransfer == null ? null : (session.streakTransfer | 0)),
    matchOver:     toFS(!!session.matchOver),
    createdAt:     toFS(session.createdAt || Date.now()),
    updatedAt:     toFS(Date.now()),
  });
}

export async function loadSession(sessionId) {
  const f = await fsGetFields(SESSIONS_COL, sessionId);
  if (!f) return null;
  return {
    id:             sessionId,
    userId:         f.userId || null,
    lang:           f.lang   || "en",
    pool:           Array.isArray(f.pool) ? f.pool : [],
    poolUsed:       Array.isArray(f.poolUsed) ? f.poolUsed : [],
    pending:        f.pending || null,
    player:         f.player  || freshHandSlot(),
    axiom:          f.axiom   || freshAxiomSlot(),
    score:          f.score   || { player: 0, axiom: 0 },
    handsPlayed:    f.handsPlayed | 0,
    hadBlackjack:   !!f.hadBlackjack,
    state:          f.state   || "player_turn",
    handWinner:     f.handWinner  || null,
    matchWinner:    f.matchWinner || null,
    streakTransfer: f.streakTransfer == null ? null : (f.streakTransfer | 0),
    matchOver:      !!f.matchOver,
    createdAt:      f.createdAt || Date.now(),
  };
}

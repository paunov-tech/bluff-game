// api/swear-earn.js — award SWEAR for a validated event.
// POST { userId, event, gameId, meta? } → { awarded, newBalance, duplicate, event }
//
// Integrity rules:
//  - Amount is looked up server-side from EARN_RATES (client can't inflate).
//  - Dedup: we create a doc in `bluff_earn_log/{userId}_{gameId}_{event}`
//    using fsCreateIfMissing — if it already exists we return duplicate:true
//    and skip the increment. This makes the endpoint safe to retry.
//  - Stats bump: we also increment a matching counter on the player profile
//    (e.g. solo_win → stats.soloWins++) when the event maps to one.

import { fsIncrement, fsCreateIfMissing, fsGetFields, fsPatchMerge, toFS } from "./_lib/firestore-rest.js";
import { rateFor, EARN_RATES } from "./_lib/swear-rates.js";

const PLAYERS = "bluff_players";
const LOGS    = "bluff_earn_log";

// Map earn event → stats counter path to increment (nested under `stats.*`).
const STAT_MAP = {
  solo_win:                  "soloWins",
  solo_loss:                 "soloLosses",
  blitz_win:                 "blitzWins",
  blitz_loss:                "blitzLosses",
  duel_win:                  "duelWins",
  duel_loss:                 "duelLosses",
  daily_challenge_complete:  "dailyCompletes",
  daily_challenge_perfect:   "dailyPerfects",
  grand_bluff_victory:       "grandBluffs",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { userId, event, gameId, meta } = req.body || {};
  if (!userId || typeof userId !== "string") return res.status(400).json({ error: "userId required" });
  if (!event || typeof event !== "string")   return res.status(400).json({ error: "event required" });
  if (!gameId || typeof gameId !== "string") return res.status(400).json({ error: "gameId required" });

  if (!Object.prototype.hasOwnProperty.call(EARN_RATES, event)) {
    return res.status(400).json({ error: `unknown event: ${event}` });
  }
  const amount = rateFor(event);

  const uid     = userId.trim().slice(0, 80);
  const gid     = gameId.trim().slice(0, 80);
  const logId   = `${uid}__${gid}__${event}`.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 200);

  try {
    // Ensure profile exists before incrementing (avoids orphan docs with
    // only a swearBalance field).
    const prof = await fsGetFields(PLAYERS, uid);
    if (!prof) {
      return res.status(404).json({ error: "profile_not_found", hint: "POST /api/swear-profile first" });
    }

    // Idempotency: create log doc iff missing. If it already exists the
    // client is retrying; we return the current balance without double-paying.
    const created = await fsCreateIfMissing(LOGS, logId, {
      userId: toFS(uid),
      gameId: toFS(gid),
      event:  toFS(event),
      amount: toFS(amount),
      meta:   toFS(meta || null),
      ts:     toFS(new Date().toISOString()),
    });

    if (!created) {
      return res.status(200).json({
        awarded:    0,
        newBalance: prof.swearBalance || 0,
        duplicate:  true,
        event,
      });
    }

    // Award SWEAR atomically.
    const newBalance = await fsIncrement(PLAYERS, uid, "swearBalance", amount);

    // Bump matching stat counter (best-effort, not blocking).
    const statField = STAT_MAP[event];
    if (statField) {
      try { await fsIncrement(PLAYERS, uid, `stats.${statField}`, 1); } catch { /* non-fatal */ }
    }

    // Touch updatedAt.
    try {
      await fsPatchMerge(PLAYERS, uid,
        { updatedAt: toFS(new Date().toISOString()) },
        ["updatedAt"]);
    } catch { /* non-fatal */ }

    return res.status(200).json({
      awarded:    amount,
      newBalance: typeof newBalance === "number" ? newBalance : (prof.swearBalance || 0) + amount,
      duplicate:  false,
      event,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// api/swear-sync-tier.js — reconcile a player's Pro / Early Adopter flags
// against the KV truth (set by checkout webhook + early-adopter endpoint).
// Awards `early_adopter_bonus` exactly once, gated by the existing earn-log
// dedup (logId = {userId}__early_adopter__early_adopter_bonus).
//
// POST { userId, isPro?, proPlan?, isEarlyAdopter?, earlyAdopterRank? }
// Clients pass what they know from localStorage; server is authoritative
// via KV where possible, but for Part A we trust client hints (matches the
// existing leaderboard.js / webhook.js trust model).

import { kv } from "@vercel/kv";
import { fsGetFields, fsPatchMerge, fsCreateIfMissing, fsIncrement, toFS } from "./_lib/firestore-rest.js";
import { rateFor } from "./_lib/swear-rates.js";

const PLAYERS = "bluff_players";
const LOGS    = "bluff_earn_log";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { userId, isPro, proPlan, isEarlyAdopter, earlyAdopterRank } = req.body || {};
  if (!userId || typeof userId !== "string") return res.status(400).json({ error: "userId required" });
  const uid = userId.trim().slice(0, 80);

  try {
    const prof = await fsGetFields(PLAYERS, uid);
    if (!prof) return res.status(404).json({ error: "profile_not_found" });

    // Cross-check KV if available — early adopter is tracked there.
    let kvEA = null;
    try { kvEA = await kv.get(`early_adopter:${uid}`); } catch { /* fail open */ }
    const confirmedEA = !!(kvEA || isEarlyAdopter);
    const confirmedRank = (kvEA && kvEA.rank) || earlyAdopterRank || null;

    const patch = {};
    const mask  = [];
    if (confirmedEA !== !!prof.isEarlyAdopter) {
      patch.isEarlyAdopter = toFS(confirmedEA);
      mask.push("isEarlyAdopter");
    }
    if (confirmedRank && confirmedRank !== prof.earlyAdopterRank) {
      patch.earlyAdopterRank = toFS(confirmedRank);
      mask.push("earlyAdopterRank");
    }
    if (typeof isPro === "boolean" && isPro !== !!prof.isPro) {
      patch.isPro = toFS(isPro);
      mask.push("isPro");
    }
    if (proPlan && proPlan !== prof.proPlan) {
      patch.proPlan = toFS(proPlan);
      mask.push("proPlan");
    }
    if (mask.length) {
      patch.updatedAt = toFS(new Date().toISOString());
      mask.push("updatedAt");
      await fsPatchMerge(PLAYERS, uid, patch, mask);
    }

    // Award early adopter bonus once, via the standard earn-log dedup key.
    let awarded = 0;
    if (confirmedEA) {
      const logId = `${uid}__early_adopter__early_adopter_bonus`.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 200);
      const created = await fsCreateIfMissing(LOGS, logId, {
        userId: toFS(uid),
        gameId: toFS("early_adopter"),
        event:  toFS("early_adopter_bonus"),
        amount: toFS(rateFor("early_adopter_bonus")),
        meta:   toFS({ rank: confirmedRank }),
        ts:     toFS(new Date().toISOString()),
      });
      if (created) {
        awarded = rateFor("early_adopter_bonus");
        await fsIncrement(PLAYERS, uid, "swearBalance", awarded);
      }
    }

    const fresh = await fsGetFields(PLAYERS, uid);
    return res.status(200).json({ ok: true, profile: fresh, awarded, event: awarded ? "early_adopter_bonus" : null });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

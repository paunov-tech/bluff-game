// api/swear-migrate.js — migrate an anonymous profile to a signed-in uid.
// POST { anonymousId } with Bearer <firebase-id-token>
// → { ok, profile, merged: boolean, awardedFromAnon: number }
//
// Rules:
//   - Bearer token required; target uid = token.sub.
//   - If target (uid) profile doesn't exist, create it seeded from anon.
//   - If both exist, merge anon into target:
//       • swearBalance += anon.swearBalance
//       • stats.* summed
//       • preserve target.handle/isPro/isEarlyAdopter (don't downgrade)
//   - Mark anon doc with `migratedTo: uid` — subsequent migrations become
//     no-ops, and leaderboards/earn filter it out.
//   - NEVER delete the anonymous doc (audit trail).
//   - Idempotent: second call with same anon returns merged:false but ok:true.

import {
  fsGetFields,
  fsPatch,
  fsPatchMerge,
  fsCreateIfMissing,
  fsIncrement,
  toFS,
} from "./_lib/firestore-rest.js";
import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";

const PLAYERS = "bluff_players";

function defaultStats() {
  return {
    soloWins: 0, soloLosses: 0,
    blitzWins: 0, blitzLosses: 0,
    duelWins: 0, duelLosses: 0,
    dailyCompletes: 0, dailyPerfects: 0,
    bestStreak: 0, grandBluffs: 0,
  };
}

function mergeStats(a = {}, b = {}) {
  const keys = new Set([...Object.keys(defaultStats()), ...Object.keys(a), ...Object.keys(b)]);
  const out = {};
  for (const k of keys) {
    const av = Number(a[k] || 0);
    const bv = Number(b[k] || 0);
    out[k] = (k === "bestStreak") ? Math.max(av, bv) : av + bv;
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = await verifyRequestAuth(req);
  if (!auth?.uid) return res.status(401).json({ error: "unauthenticated" });

  const { anonymousId } = req.body || {};
  const anonId = typeof anonymousId === "string" ? anonymousId.trim() : "";
  const uid = auth.uid;

  if (!anonId) return res.status(400).json({ error: "anonymousId required" });
  if (anonId === uid) return res.status(400).json({ error: "anon_equals_uid" });

  try {
    const anon = await fsGetFields(PLAYERS, anonId);

    // If there's no anon doc, just ensure target exists and return.
    if (!anon) {
      const existing = await fsGetFields(PLAYERS, uid);
      return res.status(200).json({
        ok: true,
        merged: false,
        profile: existing || null,
        awardedFromAnon: 0,
        note: "no_anon_profile",
      });
    }

    // Already migrated? No-op.
    if (anon.migratedTo) {
      const target = await fsGetFields(PLAYERS, anon.migratedTo);
      return res.status(200).json({
        ok: true,
        merged: false,
        profile: target || null,
        awardedFromAnon: 0,
        note: "already_migrated",
      });
    }

    const anonBalance = Number(anon.swearBalance || 0);
    const anonStats   = anon.stats || {};
    const now         = new Date().toISOString();

    // Ensure target exists (create seeded from anon if not).
    const target = await fsGetFields(PLAYERS, uid);

    if (!target) {
      const seeded = {
        userId:            toFS(uid),
        handle:            toFS(anon.handle || null),
        swearBalance:      toFS(anonBalance | 0),
        createdAt:         toFS(anon.createdAt || now),
        updatedAt:         toFS(now),
        isEarlyAdopter:    toFS(!!anon.isEarlyAdopter),
        earlyAdopterRank:  toFS(anon.earlyAdopterRank || null),
        isPro:             toFS(!!anon.isPro),
        proPlan:           toFS(anon.proPlan || null),
        stats:             toFS({ ...defaultStats(), ...anonStats }),
        firstBonusAwarded: toFS(!!anon.firstBonusAwarded),
        mergedFromAnonymous: toFS(anonId),
        email:             toFS(auth.email || null),
      };
      const created = await fsCreateIfMissing(PLAYERS, uid, seeded);
      if (!created) {
        // Race: target was created between our check and write. Fall through
        // into the merge branch by re-reading.
        const again = await fsGetFields(PLAYERS, uid);
        return await mergeBranch(uid, anonId, again, anon, anonBalance, anonStats, auth, now, res);
      }

      // Mark anon as migrated.
      await fsPatchMerge(PLAYERS, anonId, {
        migratedTo: toFS(uid),
        updatedAt:  toFS(now),
      }, ["migratedTo", "updatedAt"]);

      const fresh = await fsGetFields(PLAYERS, uid);
      return res.status(200).json({
        ok: true,
        merged: true,
        created: true,
        profile: fresh,
        awardedFromAnon: anonBalance,
      });
    }

    // Target exists — merge anon into it.
    return await mergeBranch(uid, anonId, target, anon, anonBalance, anonStats, auth, now, res);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function mergeBranch(uid, anonId, target, anon, anonBalance, anonStats, auth, now, res) {
  // Sum balance atomically.
  if (anonBalance > 0) {
    try { await fsIncrement(PLAYERS, uid, "swearBalance", anonBalance); } catch { /* non-fatal */ }
  }

  // Merge stats.
  const mergedStats = mergeStats(target.stats || {}, anonStats || {});

  // Preserve target values where they'd be a "downgrade" if overwritten.
  const nextHandle = target.handle || anon.handle || null;
  const nextIsPro  = !!target.isPro || !!anon.isPro;
  const nextPlan   = target.proPlan || anon.proPlan || null;
  const nextEarly  = !!target.isEarlyAdopter || !!anon.isEarlyAdopter;
  const nextRank   = target.earlyAdopterRank || anon.earlyAdopterRank || null;

  await fsPatchMerge(PLAYERS, uid, {
    handle:            toFS(nextHandle),
    isPro:             toFS(nextIsPro),
    proPlan:           toFS(nextPlan),
    isEarlyAdopter:    toFS(nextEarly),
    earlyAdopterRank:  toFS(nextRank),
    stats:             toFS(mergedStats),
    updatedAt:         toFS(now),
    mergedFromAnonymous: toFS(anonId),
    email:             toFS(target.email || auth.email || null),
  }, [
    "handle", "isPro", "proPlan", "isEarlyAdopter", "earlyAdopterRank",
    "stats", "updatedAt", "mergedFromAnonymous", "email",
  ]);

  // Mark anon as migrated.
  try {
    await fsPatchMerge(PLAYERS, anonId, {
      migratedTo: toFS(uid),
      updatedAt:  toFS(now),
      swearBalance: toFS(0),
    }, ["migratedTo", "updatedAt", "swearBalance"]);
  } catch { /* non-fatal */ }

  const fresh = await fsGetFields(PLAYERS, uid);
  return res.status(200).json({
    ok: true,
    merged: true,
    created: false,
    profile: fresh,
    awardedFromAnon: anonBalance,
  });
}

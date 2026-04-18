// api/swear-profile.js — GET or create a player's SWEAR profile.
// GET  ?userId=...  → existing profile (or null)
// POST { userId }    → ensure-exists; returns profile, awards first_time_bonus once.
//
// Profile schema in Firestore collection `bluff_players`:
//   userId, handle (nullable), swearBalance, createdAt, updatedAt,
//   isEarlyAdopter, earlyAdopterRank, isPro, proPlan,
//   stats: { soloWins, soloLosses, blitzWins, blitzLosses,
//            duelWins, duelLosses, dailyCompletes, dailyPerfects,
//            bestStreak, grandBluffs }

import { fsGet, fsGetFields, fsPatch, fsCreateIfMissing, fsIncrement, toFS } from "./_lib/firestore-rest.js";
import { rateFor } from "./_lib/swear-rates.js";
import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";

const COL = "bluff_players";

function defaultStats() {
  return {
    soloWins: 0, soloLosses: 0,
    blitzWins: 0, blitzLosses: 0,
    duelWins: 0, duelLosses: 0,
    dailyCompletes: 0, dailyPerfects: 0,
    bestStreak: 0, grandBluffs: 0,
  };
}

function docToProfile(fields) {
  if (!fields) return null;
  return {
    userId:          fields.userId || null,
    handle:          fields.handle || null,
    swearBalance:    fields.swearBalance || 0,
    createdAt:       fields.createdAt || null,
    updatedAt:       fields.updatedAt || null,
    isEarlyAdopter:  !!fields.isEarlyAdopter,
    earlyAdopterRank: fields.earlyAdopterRank || null,
    isPro:           !!fields.isPro,
    proPlan:         fields.proPlan || null,
    stats:           { ...defaultStats(), ...(fields.stats || {}) },
    firstBonusAwarded: !!fields.firstBonusAwarded,
  };
}

function profileFields(p) {
  return {
    userId:          toFS(p.userId),
    handle:          toFS(p.handle),
    swearBalance:    toFS(p.swearBalance | 0),
    createdAt:       toFS(p.createdAt),
    updatedAt:       toFS(p.updatedAt),
    isEarlyAdopter:  toFS(!!p.isEarlyAdopter),
    earlyAdopterRank: toFS(p.earlyAdopterRank || null),
    isPro:           toFS(!!p.isPro),
    proPlan:         toFS(p.proPlan || null),
    stats:           toFS(p.stats || defaultStats()),
    firstBonusAwarded: toFS(!!p.firstBonusAwarded),
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  // ── GET — return current profile or null ───────────────────────
  if (req.method === "GET") {
    const userId = String(req.query.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "userId required" });
    try {
      const fields = await fsGetFields(COL, userId);
      return res.status(200).json({ profile: docToProfile(fields) });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── POST — ensure-exists (create + first-time bonus) ───────────
  if (req.method === "POST") {
    const { userId } = req.body || {};
    if (!userId || typeof userId !== "string") {
      return res.status(400).json({ error: "userId required" });
    }
    const uid = userId.trim();
    if (uid.length < 3 || uid.length > 80) {
      return res.status(400).json({ error: "userId out of range" });
    }

    // If a bearer token is present, the POSTed userId MUST match.
    const auth = await verifyRequestAuth(req);
    if (auth?.uid && uid !== auth.uid) {
      return res.status(403).json({ error: "uid_mismatch" });
    }

    try {
      const existing = await fsGetFields(COL, uid);
      if (existing) {
        return res.status(200).json({ profile: docToProfile(existing), created: false });
      }

      // Create fresh profile. Idempotent: if two parallel calls race, the
      // loser falls through to a GET.
      const now = new Date().toISOString();
      const initial = {
        userId: uid,
        handle: null,
        swearBalance: 0,
        createdAt: now,
        updatedAt: now,
        isEarlyAdopter: false,
        earlyAdopterRank: null,
        isPro: false,
        proPlan: null,
        stats: defaultStats(),
        firstBonusAwarded: false,
      };
      const created = await fsCreateIfMissing(COL, uid, profileFields(initial));
      if (!created) {
        const again = await fsGetFields(COL, uid);
        return res.status(200).json({ profile: docToProfile(again), created: false });
      }

      // Award first_time_bonus atomically, mark flag via merge-write.
      const bonus = rateFor("first_time_bonus");
      if (bonus > 0) {
        await fsIncrement(COL, uid, "swearBalance", bonus);
      }
      // Mark firstBonusAwarded so we never double-pay even if the client
      // re-POSTs. We merge-patch just that field.
      const { fsPatchMerge } = await import("./_lib/firestore-rest.js");
      await fsPatchMerge(COL, uid, {
        firstBonusAwarded: toFS(true),
        updatedAt:         toFS(new Date().toISOString()),
      }, ["firstBonusAwarded", "updatedAt"]);

      const full = await fsGetFields(COL, uid);
      return res.status(200).json({
        profile: docToProfile(full),
        created: true,
        awarded: bonus,
        event: "first_time_bonus",
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: "GET or POST only" });
}

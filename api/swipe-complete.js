// api/swipe-complete.js — Records a completed daily warm-up session and
// updates the player's `dailyWarmup` profile field + streak counter.
//
// POST { userId, sessionId, stats: { totalSwiped, totalCorrect, swearEarned } }
//
// Response: { profile: { dailyWarmup }, streakDays, todayCompletedDate }
//
// Streak rule:
//   • diff (today - lastCompletedDate) === 0  → already counted today, no change.
//   • diff === 1                              → continue: streakDays + 1.
//   • else (or no prior date)                 → reset to 1.

import { fsGetFields, fsPatchMerge, toFS } from "./_lib/firestore-rest.js";
import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";

const PLAYERS_COL = "bluff_players";

// Local-date string YYYY-MM-DD from a UTC ISO. Caller passes their local TZ
// offset (mins, +/-) so we record the date in the user's frame, not the server's.
function todayLocalDate(tzOffsetMin) {
  const offset = Number.isFinite(tzOffsetMin) ? tzOffsetMin | 0 : 0;
  const local = new Date(Date.now() - offset * 60 * 1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth()+1).padStart(2,"0")}-${String(local.getUTCDate()).padStart(2,"0")}`;
}

function diffDays(a, b) {
  if (!a || !b) return NaN;
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.round((db - da) / 86400000);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.FIREBASE_API_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }

  const { userId, sessionId, stats, tzOffsetMin } = req.body || {};
  if (!userId || typeof userId !== "string") {
    return res.status(400).json({ error: "userId required" });
  }
  if (!stats || typeof stats !== "object") {
    return res.status(400).json({ error: "stats required" });
  }

  const uid = userId.trim().slice(0, 80);
  const auth = await verifyRequestAuth(req);
  if (auth?.uid && uid !== auth.uid) {
    return res.status(403).json({ error: "uid_mismatch" });
  }

  const today = todayLocalDate(tzOffsetMin);

  let prof;
  try {
    prof = await fsGetFields(PLAYERS_COL, uid);
  } catch (e) {
    return res.status(500).json({ error: "profile_read_failed" });
  }
  if (!prof) {
    return res.status(404).json({ error: "profile_not_found", hint: "POST /api/swear-profile first" });
  }

  const prevWarmup = prof.dailyWarmup || {};
  const prevDate   = prevWarmup.todayCompletedDate || null;
  const prevStreak = prevWarmup.streakDays | 0;

  let streakDays;
  let alreadyToday = false;
  const d = diffDays(prevDate, today);
  if (prevDate && d === 0) {
    streakDays = prevStreak;          // already counted — keep streak
    alreadyToday = true;
  } else if (prevDate && d === 1) {
    streakDays = prevStreak + 1;      // contiguous day — extend
  } else {
    streakDays = 1;                   // fresh start or broken streak
  }

  const dailyWarmup = {
    todayCompletedDate: today,
    lastCompletedAt:    Date.now(),
    streakDays,
    lastSessionStats: {
      totalSwiped:  stats.totalSwiped  | 0,
      totalCorrect: stats.totalCorrect | 0,
      swearEarned:  stats.swearEarned  | 0,
      sessionId:    typeof sessionId === "string" ? sessionId.slice(0, 80) : null,
    },
  };

  try {
    await fsPatchMerge(PLAYERS_COL, uid, {
      dailyWarmup: toFS(dailyWarmup),
      updatedAt:   toFS(new Date().toISOString()),
    }, ["dailyWarmup", "updatedAt"]);
  } catch (e) {
    return res.status(500).json({ error: "profile_write_failed", detail: e.message });
  }

  return res.status(200).json({
    dailyWarmup,
    streakDays,
    todayCompletedDate: today,
    alreadyToday,
  });
}

// api/swear-set-handle.js — claim or change a public handle.
// POST { userId, handle } → { ok, profile } or { error: "taken" | "invalid" }
//
// Uniqueness strategy: we reserve the handle in a `bluff_handles` collection
// using fsCreateIfMissing (doc id = lowercased handle). If that succeeds,
// we write the handle onto the profile and release the previous handle
// reservation, if any.

import { fsGetFields, fsCreateIfMissing, fsPatchMerge, fsDelete, toFS } from "./_lib/firestore-rest.js";
import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";

const PLAYERS = "bluff_players";
const HANDLES = "bluff_handles";

const HANDLE_RE = /^[a-zA-Z0-9_]{3,16}$/;

// Reserved handles that impersonate staff/system accounts (exact lowercased match).
const RESERVED = new Set([
  "admin","administrator","staff","mod","moderator","support","system",
  "bluff","axiom","official","root","null","undefined",
]);

// Substring-matched slur/profanity blocklist. Kept short and obvious —
// this is launch-day hygiene, not a content-moderation system. Lowercased.
const BANNED_SUBSTRINGS = [
  "nigger","nigga","faggot","retard","tranny","kike","chink","spic",
  "cunt","whore","slut","nazi","hitler","rape","pedo",
  "fuck","shit","dick","pussy","bitch","asshole",
];

function isBannedHandle(lower) {
  if (RESERVED.has(lower)) return true;
  for (const needle of BANNED_SUBSTRINGS) {
    if (lower.includes(needle)) return true;
  }
  return false;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const auth = await verifyRequestAuth(req);
  if (!auth?.uid) return res.status(401).json({ error: "unauthenticated" });

  const { userId, handle } = req.body || {};
  if (!userId || typeof userId !== "string") return res.status(400).json({ error: "userId required" });
  if (!handle || typeof handle !== "string") return res.status(400).json({ error: "handle required" });

  const uid = userId.trim().slice(0, 80);
  if (uid !== auth.uid) return res.status(403).json({ error: "uid_mismatch" });
  const raw = handle.trim();
  if (!HANDLE_RE.test(raw)) {
    return res.status(400).json({ error: "invalid", detail: "3-16 chars, letters/digits/underscore only" });
  }
  const lower = raw.toLowerCase();
  if (isBannedHandle(lower)) {
    return res.status(400).json({ error: "banned", detail: "handle not allowed" });
  }

  try {
    const prof = await fsGetFields(PLAYERS, uid);
    if (!prof) return res.status(404).json({ error: "profile_not_found" });

    // No-op if user is re-setting the same handle.
    if (prof.handle && prof.handle.toLowerCase() === lower) {
      return res.status(200).json({ ok: true, profile: prof, unchanged: true });
    }

    // Reserve the new handle. Wins the race or fails if taken.
    const reserved = await fsCreateIfMissing(HANDLES, lower, {
      userId: toFS(uid),
      handle: toFS(raw),
      ts:     toFS(new Date().toISOString()),
    });
    if (!reserved) {
      return res.status(409).json({ error: "taken" });
    }

    // Commit handle to profile.
    await fsPatchMerge(PLAYERS, uid, {
      handle:    toFS(raw),
      updatedAt: toFS(new Date().toISOString()),
    }, ["handle", "updatedAt"]);

    // Release previous reservation if any.
    if (prof.handle) {
      try { await fsDelete(HANDLES, prof.handle.toLowerCase()); } catch { /* non-fatal */ }
    }

    const fresh = await fsGetFields(PLAYERS, uid);
    return res.status(200).json({ ok: true, profile: fresh });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

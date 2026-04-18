// api/swear-set-handle.js — claim or change a public handle.
// POST { userId, handle } → { ok, profile } or { error: "taken" | "invalid" }
//
// Uniqueness strategy: we reserve the handle in a `bluff_handles` collection
// using fsCreateIfMissing (doc id = lowercased handle). If that succeeds,
// we write the handle onto the profile and release the previous handle
// reservation, if any.

import { fsGetFields, fsCreateIfMissing, fsPatchMerge, fsDelete, toFS } from "./_lib/firestore-rest.js";

const PLAYERS = "bluff_players";
const HANDLES = "bluff_handles";

const HANDLE_RE = /^[a-zA-Z0-9_]{3,16}$/;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { userId, handle } = req.body || {};
  if (!userId || typeof userId !== "string") return res.status(400).json({ error: "userId required" });
  if (!handle || typeof handle !== "string") return res.status(400).json({ error: "handle required" });

  const uid = userId.trim().slice(0, 80);
  const raw = handle.trim();
  if (!HANDLE_RE.test(raw)) {
    return res.status(400).json({ error: "invalid", detail: "3-16 chars, letters/digits/underscore only" });
  }
  const lower = raw.toLowerCase();

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

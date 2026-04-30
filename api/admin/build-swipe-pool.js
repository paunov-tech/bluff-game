// api/admin/build-swipe-pool.js — One-time + idempotent migration that
// extracts individual statements from `bluff_cache` rounds and writes them
// to the flat `bluff_swipe_pool` collection used by /api/swipe-batch.
//
// Auth: same gate as pre-generate.js — Vercel cron header OR x-admin-token /
// ?token query matching CRON_SECRET.
//
// Document IDs in bluff_swipe_pool are deterministic (`swipe_<roundId>_<idx>`)
// so re-running the migration is a no-op for already-extracted statements.
//
// Statements over 200 chars are skipped (too long for a swipe card).

import { fsQuery, fsCreateIfMissing, toFS } from "../_lib/firestore-rest.js";

export const config = { maxDuration: 300 };

const CACHE_COL = "bluff_cache";
const POOL_COL  = "bluff_swipe_pool";
const MAX_LEN   = 200;

function poolIdFor(roundId, idx) {
  // Already-safe characters from the cache ID (`{cat}_{level}_{variant}`).
  return `swipe_${roundId}_${idx}`;
}

export default async function handler(req, res) {
  const isCron = req.headers["x-vercel-cron"] === "1";
  const token  = req.headers["x-admin-token"] || req.query.token || "";
  const secret = process.env.CRON_SECRET;
  if (!isCron && secret && token !== secret) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!process.env.FIREBASE_API_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }

  const lang = (req.query.lang || "en").toString().slice(0, 4);
  const dryRun = req.query.dryRun === "1";

  let docs;
  try {
    // bluff_cache is small (~275 docs at 11 cats × 5 levels × 5 variants).
    // No paging needed — fsQuery without `limit` returns up to Firestore default.
    docs = await fsQuery(CACHE_COL, { limit: 1000 });
  } catch (e) {
    return res.status(500).json({ error: "list failed", detail: e.message });
  }

  let considered = 0, written = 0, skippedExisting = 0, skippedLong = 0, errors = 0;
  const now = Date.now();

  for (const doc of docs) {
    const roundId = doc.id;
    const f = doc.fields || {};
    const stmts = Array.isArray(f.statements) ? f.statements : [];
    if (stmts.length === 0) continue;

    const category   = f.category || "mixed";
    const difficulty = typeof f.level === "number" ? f.level : 3;

    for (let i = 0; i < stmts.length; i++) {
      const s = stmts[i];
      if (!s || typeof s.text !== "string") continue;
      considered++;
      if (s.text.length > MAX_LEN) { skippedLong++; continue; }
      if (typeof s.real !== "boolean") continue;

      const id = poolIdFor(roundId, i);
      if (dryRun) { written++; continue; }

      try {
        const created = await fsCreateIfMissing(POOL_COL, id, {
          id:          toFS(id),
          text:        toFS(s.text),
          isTrue:      toFS(s.real),
          category:    toFS(category),
          difficulty:  toFS(difficulty),
          sourceRound: toFS(roundId),
          lang:        toFS(lang),
          createdAt:   toFS(now),
        });
        if (created) written++; else skippedExisting++;
      } catch (e) {
        errors++;
      }
    }
  }

  return res.status(200).json({
    rounds:          docs.length,
    statementsConsidered: considered,
    written,
    skippedExisting,
    skippedLong,
    errors,
    lang,
    dryRun,
  });
}

// api/admin/build-sniper-pool.js — Periodic cron that pre-generates Sniper
// sentences via Claude and stores them in `sniper_pool/{id}` for the live
// /api/sniper-batch endpoint to read from. Mirrors build-swipe-pool's
// idempotent shape, but differs in that it actually CALLS Anthropic per
// run (swipe-pool is just a flatten/index over existing bluff_cache).
//
// Why this exists: until this cron, sniper-batch did a live Claude call on
// every user request, so any Anthropic blip (5xx, rate-limit, latency
// spike) would 502 the Sniper mini-game and break the CLIMB flow. With the
// pool populated, sniper-batch reads from Firestore and only falls back to
// live generation when the pool is empty.
//
// Auth: Vercel cron header OR x-admin-token / ?token query matching
// CRON_SECRET. Fails CLOSED if CRON_SECRET is unset (matches the audit
// hardening applied to other admin endpoints).
//
// Idempotency: doc IDs are content-derived (sha1(lang|text)) so re-running
// over the same generated text is a no-op via fsCreateIfMissing.
//
// Time budget: each cron has ~5min Vercel ceiling. We bail at 4 minutes
// and let the next 6h-cron pick up where we stopped — 8 langs × ~5 batches
// per lang × ~5s each can exceed a single invocation.

import { fsQuery, fsCreateIfMissing, toFS } from "../_lib/firestore-rest.js";
import {
  generateSniperBatch,
  poolIdFor,
  SNIPER_LANGS,
} from "../_lib/sniper-generate.js";

export const config = { maxDuration: 300 };

const POOL_COL          = "sniper_pool";
const TARGET_PER_LANG   = 50;       // Plenty of variety for 3-pick-per-game.
const BATCH_SIZE        = 15;       // One Claude call → ~15 sentences.
const THROTTLE_MS       = 300;      // Anthropic-friendly pause between calls.
const TIME_BUDGET_MS    = 240_000;  // 4 min — leaves 60s buffer under 5min lambda max.
const POOL_QUERY_LIMIT  = 500;      // Cap pool count read per lang.

export default async function handler(req, res) {
  const isCron = req.headers["x-vercel-cron"] === "1";
  const token  = req.headers["x-admin-token"] || req.query.token || "";
  const secret = process.env.CRON_SECRET;
  // Fail-closed: if CRON_SECRET isn't configured, treat the endpoint as
  // unavailable rather than wide-open. Matches the audit hardening pattern.
  if (!secret) return res.status(503).json({ error: "CRON_SECRET not configured" });
  if (!isCron && token !== secret) return res.status(401).json({ error: "unauthorized" });

  if (!process.env.FIREBASE_API_KEY)  return res.status(503).json({ error: "Firestore not configured" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "Anthropic not configured" });

  const startMs    = Date.now();
  const langArg    = (req.query.lang || "").toString().toLowerCase();
  const target     = Math.max(1, Math.min(500, parseInt(req.query.target, 10) || TARGET_PER_LANG));
  const langs      = langArg
    ? [langArg].filter(l => SNIPER_LANGS.includes(l))
    : SNIPER_LANGS;
  const stats = {
    target, batchSize: BATCH_SIZE,
    perLang: {},
    totals: { generated: 0, written: 0, skippedExisting: 0, failed: 0, currentSize: 0 },
    langsProcessed: [],
    outOfTime: false,
  };

  for (const lang of langs) {
    if (Date.now() - startMs > TIME_BUDGET_MS) { stats.outOfTime = true; break; }

    const langStats = { generated: 0, written: 0, skippedExisting: 0, failed: 0, currentSize: 0, batchesRun: 0 };
    stats.perLang[lang] = langStats;
    stats.langsProcessed.push(lang);

    // How many do we already have? Cap the read at POOL_QUERY_LIMIT —
    // anything past that is "enough" for our purposes.
    let currentCount = 0;
    try {
      const existing = await fsQuery(POOL_COL, {
        where: [{ path: "lang", op: "EQUAL", value: lang }],
        limit: POOL_QUERY_LIMIT,
      });
      currentCount = existing.length;
    } catch (e) {
      console.warn(`[build-sniper-pool] pool count read failed for ${lang}:`, e.message);
      langStats.failed++;
      continue;
    }
    langStats.currentSize = currentCount;

    const needed = Math.max(0, target - currentCount);
    if (needed === 0) continue;

    const batches = Math.ceil(needed / BATCH_SIZE);
    for (let b = 0; b < batches; b++) {
      if (Date.now() - startMs > TIME_BUDGET_MS) { stats.outOfTime = true; break; }

      let valid;
      try {
        valid = await generateSniperBatch(lang, BATCH_SIZE);
        langStats.batchesRun++;
        langStats.generated += valid.length;
      } catch (err) {
        console.error(`[build-sniper-pool] ${lang} batch ${b + 1}/${batches} gen failed:`, err.message);
        langStats.failed++;
        await sleep(THROTTLE_MS);
        continue;
      }

      // Parallel writes per batch — safe because fsCreateIfMissing is
      // serverless-safe (each call is its own HTTP request with conditional
      // create semantics on the Firestore side).
      const writes = await Promise.allSettled(valid.map(s => {
        const id = poolIdFor(lang, s.text);
        return fsCreateIfMissing(POOL_COL, id, {
          id:           toFS(id),
          text:         toFS(s.text),
          words:        toFS(s.words),
          lieWordIndex: toFS(s.lieWordIndex),
          lieWord:      toFS(s.lieWord),
          correctWord:  toFS(s.correctWord),
          explanation:  toFS(s.explanation),
          lang:         toFS(lang),
          createdAt:    toFS(Date.now()),
        });
      }));
      for (const r of writes) {
        if (r.status === "fulfilled") {
          if (r.value === true) langStats.written++;
          else                  langStats.skippedExisting++;
        } else {
          langStats.failed++;
        }
      }

      await sleep(THROTTLE_MS);
    }
  }

  // Aggregate totals after per-lang loop.
  for (const l of Object.values(stats.perLang)) {
    stats.totals.generated       += l.generated;
    stats.totals.written         += l.written;
    stats.totals.skippedExisting += l.skippedExisting;
    stats.totals.failed          += l.failed;
    stats.totals.currentSize     += l.currentSize;
  }
  stats.elapsedMs = Date.now() - startMs;

  return res.status(200).json({ ok: true, stats });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

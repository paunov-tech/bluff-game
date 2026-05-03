// api/sniper-batch.js — Returns N "find the lie word" sentences per session.
//
// GET /api/sniper-batch?count=3&lang=en   (auth optional — anon OK)
//
// Selection priority:
//   1. Pre-generated pool (sniper_pool/{id}, lang field) — populated by the
//      /api/admin/build-sniper-pool cron every 6h. This is the fast path
//      and is immune to Anthropic outages.
//   2. Live Claude generation — fallback when the pool doesn't have enough
//      sentences for the requested lang. Successful live generations are
//      backfilled into the pool fire-and-forget so the next user doesn't
//      pay the same Claude latency.
//
// Each sentence is a 10-15 word factual statement where exactly ONE word
// has been swapped for a plausible-but-wrong alternative. The client gets
// {id, text, words[]} only; the lie index + correct word + explanation
// stay in `sniper_sessions/{sessionId}` and resolve via /api/sniper-judge.

import { fsQuery, fsPatch, fsCreateIfMissing, toFS } from "./_lib/firestore-rest.js";
import { rateLimit, applyRateLimitHeaders } from "./_lib/rate-limit.js";
import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";
import { generateSniperBatch, poolIdFor } from "./_lib/sniper-generate.js";

const SESSIONS_COL  = "sniper_sessions";
const POOL_COL      = "sniper_pool";
const DEFAULT_COUNT = 3;
const MAX_COUNT     = 5;
const POOL_FETCH    = 200;          // Cap pool docs read per request.
const POOL_TTL_MS   = 5 * 60 * 1000; // Per-instance cache lifetime.

// In-memory pool cache, keyed by lang. Same pattern as swipe-batch.
// Stale by up to 5 min per Vercel instance — acceptable since pool turnover
// is on a 6h cron cadence.
const _poolCache = new Map();

async function loadPool(lang) {
  const now = Date.now();
  const cached = _poolCache.get(lang);
  if (cached && (now - cached.cachedAt) < POOL_TTL_MS) return cached.pool;

  const docs = await fsQuery(POOL_COL, {
    where: [{ path: "lang", op: "EQUAL", value: lang }],
    limit: POOL_FETCH,
  });
  const pool = docs.map(d => ({
    id:           d.id,
    text:         d.fields.text,
    words:        Array.isArray(d.fields.words) ? d.fields.words : null,
    lieWordIndex: d.fields.lieWordIndex,
    lieWord:      d.fields.lieWord,
    correctWord:  d.fields.correctWord,
    explanation:  d.fields.explanation,
  })).filter(s =>
    typeof s.text === "string" &&
    Array.isArray(s.words) &&
    Number.isInteger(s.lieWordIndex)
  );
  _poolCache.set(lang, { pool, cachedAt: now });
  return pool;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Backfill freshly-Claude-generated sentences into the pool so subsequent
// users skip the live path. Fire-and-forget — losing this on lambda freeze
// just means the next cron picks up. Don't block the user's response.
async function backfillPool(lang, sentences) {
  for (const s of sentences) {
    const id = poolIdFor(lang, s.text);
    try {
      await fsCreateIfMissing(POOL_COL, id, {
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
    } catch (e) {
      console.warn("[sniper-batch] backfill failed for", id, ":", e.message);
    }
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const rl = await rateLimit(req, { bucket: "sniper-batch", limit: 30, windowSec: 60 });
  applyRateLimitHeaders(res, rl);
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  if (!process.env.FIREBASE_API_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }

  const count = Math.min(MAX_COUNT, Math.max(1, parseInt(req.query.count, 10) || DEFAULT_COUNT));
  const lang  = (req.query.lang || "en").toString().slice(0, 4);
  const auth  = await verifyRequestAuth(req);
  const uid   = auth?.uid || (typeof req.query.userId === "string" ? req.query.userId.slice(0, 80) : "");

  // ── Step 1: try the pool ─────────────────────────────────────
  // If the pool has at least `count` valid docs for this lang, pick a
  // random `count`-subset. This is the fast, Anthropic-outage-immune path.
  let picked = null;
  let source = "pool";
  try {
    const pool = await loadPool(lang);
    if (pool.length >= count) {
      picked = shuffle(pool).slice(0, count);
    }
  } catch (e) {
    console.warn("[sniper-batch] pool read failed for", lang, ":", e.message);
  }

  // ── Step 2: live Claude fallback ─────────────────────────────
  // Only if pool was insufficient (empty, partial, or read errored).
  // Backfills the pool so the next user gets the pool path.
  if (!picked) {
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(503).json({ error: "pool_empty_and_anthropic_unconfigured" });
    }
    let valid;
    try {
      valid = await generateSniperBatch(lang, count);
    } catch (err) {
      console.error("[sniper-batch] live generation failed:", err.message);
      return res.status(502).json({ error: "AXIOM is loading ammunition…" });
    }
    if (!valid || valid.length === 0) {
      return res.status(502).json({ error: "AXIOM produced no usable sentences" });
    }
    picked = valid.slice(0, count);
    source = "live";
    // Best-effort backfill so the pool warms up. Awaited — Vercel may freeze
    // the lambda otherwise — but bounded by the live-generation count (3-5
    // tiny PATCH requests). Keep it inside try/catch so a backfill failure
    // never breaks the user response.
    try { await backfillPool(lang, picked); } catch { /* logged inside */ }
  }

  // ── Re-id to session-scoped IDs ──────────────────────────────
  // The /api/sniper-judge endpoint expects sentenceId to be unique to the
  // session, not a stable pool ID — that prevents replay attacks across
  // runs. The original lieWord/correctWord/etc stays attached for the
  // server-side session record.
  const sessionId = `snipe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const reIded = picked.map((s, i) => ({ ...s, id: `${sessionId}_${i + 1}` }));

  // ── Persist session — MUST await (PR #9 fix preserved) ───────
  // Vercel freezes the lambda after the response is sent; a fire-and-forget
  // PATCH would never reach Firestore on cold containers, leaving the next
  // /api/sniper-judge call to 404 with session_not_found.
  try {
    await fsPatch(SESSIONS_COL, sessionId, {
      userId:    toFS(uid || null),
      lang:      toFS(lang),
      sentences: toFS(reIded),
      consumed:  toFS([]),
      createdAt: toFS(Date.now()),
      source:    toFS(source),
    });
  } catch (err) {
    console.warn("[sniper-batch] session write failed:", err.message);
    return res.status(503).json({ error: "session_persist_failed" });
  }

  // ── Strip answer key from response ───────────────────────────
  const clientSentences = reIded.map(s => ({
    id:    s.id,
    text:  s.text,
    words: s.words,
  }));

  return res.status(200).json({
    sessionId,
    sentences: clientSentences,
  });
}

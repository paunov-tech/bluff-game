// api/swipe-batch.js — Returns a 25-statement batch for one warm-up session.
//
// GET /api/swipe-batch?count=25&lang=en   (auth optional — anonymous users OK)
//
// Server-side anti-cheat:
//   • The response NEVER includes `isTrue` per statement.
//   • The truth flags are stored server-side in `bluff_swipe_sessions/{id}`
//     and resolved by /api/swipe-judge when the user swipes.
//
// Selection rules (best-effort — falls back to "any" when the pool is sparse):
//   1. Filter by language.
//   2. Exclude statements the user has already seen (bluff_swipe_seen/{uid}).
//   3. Mix difficulties: ~60% L1-2, ~30% L3, ~10% L4-5.
//   4. Roughly 50/50 isTrue/isFalse balance.
//   5. Avoid 3 same-category statements in a row.

import { fsQuery, fsGetFields, fsPatch, toFS } from "./_lib/firestore-rest.js";
import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";

const POOL_COL     = "bluff_swipe_pool";
const SEEN_COL     = "bluff_swipe_seen";
const SESSIONS_COL = "bluff_swipe_sessions";

const DEFAULT_COUNT = 25;
const MAX_COUNT     = 50;

// In-memory cache of the pool, refreshed every POOL_TTL_MS to amortise the
// 1k-row Firestore read. The pool grows ~25/hr at most so per-instance staleness
// of a few minutes is fine.
const POOL_TTL_MS = 5 * 60 * 1000;
let _poolCache = null;
let _poolCachedAt = 0;
let _poolLang = null;

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadPool(lang) {
  const now = Date.now();
  if (_poolCache && _poolLang === lang && (now - _poolCachedAt) < POOL_TTL_MS) {
    return _poolCache;
  }
  const docs = await fsQuery(POOL_COL, {
    where: [{ path: "lang", op: "EQUAL", value: lang }],
    limit: 2000,
  });
  const pool = docs.map(d => ({
    id:         d.id,
    text:       d.fields.text,
    isTrue:     !!d.fields.isTrue,
    category:   d.fields.category || "mixed",
    difficulty: d.fields.difficulty | 0 || 3,
  })).filter(s => s.text);
  _poolCache = pool;
  _poolLang = lang;
  _poolCachedAt = now;
  return pool;
}

function difficultyBucket(d) {
  if (d <= 2) return "easy";
  if (d === 3) return "medium";
  return "hard";
}

// Pick `count` items by sampling from per-bucket pools at the desired ratio,
// then shuffle. Falls back to whatever's available if a bucket is empty.
function pickByDifficultyMix(pool, count) {
  const buckets = { easy: [], medium: [], hard: [] };
  for (const s of pool) buckets[difficultyBucket(s.difficulty)].push(s);
  for (const k of Object.keys(buckets)) buckets[k] = shuffle(buckets[k]);

  const want = {
    easy:   Math.round(count * 0.6),
    medium: Math.round(count * 0.3),
    hard:   count - Math.round(count * 0.6) - Math.round(count * 0.3),
  };

  const picked = [];
  for (const k of ["easy", "medium", "hard"]) {
    picked.push(...buckets[k].splice(0, want[k]));
  }
  // Backfill from any leftover bucket if any were short.
  if (picked.length < count) {
    const leftover = shuffle([...buckets.easy, ...buckets.medium, ...buckets.hard]);
    picked.push(...leftover.slice(0, count - picked.length));
  }
  return picked.slice(0, count);
}

// Roughly balance true/false ratio. We try to swap from the unused pool if
// the natural mix is way off.
function balanceTruth(picked, pool, count) {
  let trues  = picked.filter(s => s.isTrue).length;
  let falses = picked.length - trues;
  const targetTrue = Math.round(count / 2);
  const usedIds = new Set(picked.map(p => p.id));

  if (Math.abs(trues - targetTrue) <= 2) return picked; // close enough

  const need = trues > targetTrue ? "false" : "true";
  const candidates = shuffle(pool.filter(s =>
    !usedIds.has(s.id) && (need === "true" ? s.isTrue : !s.isTrue)
  ));
  const dropKind  = need === "true" ? true : false;  // we drop opposite parity
  let cIdx = 0;
  for (let i = 0; i < picked.length && cIdx < candidates.length; i++) {
    if (picked[i].isTrue === dropKind) {
      picked[i] = candidates[cIdx++];
      if (need === "true") trues++; else falses++;
      if (Math.abs(trues - targetTrue) <= 1) break;
    }
  }
  return picked;
}

// Reorder so the same category never appears 3 in a row. Best-effort.
function smoothCategories(arr) {
  if (arr.length < 3) return arr;
  const out = arr.slice();
  for (let i = 2; i < out.length; i++) {
    if (out[i].category === out[i-1].category && out[i-1].category === out[i-2].category) {
      // Find a swap candidate further down with a different category.
      for (let j = i + 1; j < out.length; j++) {
        if (out[j].category !== out[i].category) {
          [out[i], out[j]] = [out[j], out[i]];
          break;
        }
      }
    }
  }
  return out;
}

async function loadSeen(uid) {
  if (!uid) return new Set();
  try {
    const f = await fsGetFields(SEEN_COL, uid);
    if (!f) return new Set();
    return new Set(Array.isArray(f.seenIds) ? f.seenIds : []);
  } catch {
    return new Set();
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  if (!process.env.FIREBASE_API_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }

  const auth   = await verifyRequestAuth(req);
  const uid    = auth?.uid || (typeof req.query.userId === "string" ? req.query.userId.slice(0, 80) : "");
  const lang   = (req.query.lang || "en").toString().slice(0, 4);
  const count  = Math.min(MAX_COUNT, Math.max(5,
    parseInt(req.query.count, 10) || DEFAULT_COUNT));

  try {
    const [pool, seenSet] = await Promise.all([
      loadPool(lang),
      loadSeen(uid),
    ]);
    if (pool.length === 0) {
      return res.status(503).json({ error: "pool_empty", hint: "run /api/admin/build-swipe-pool" });
    }

    let candidates = pool.filter(s => !seenSet.has(s.id));
    // If user has seen everything, fall back to the full pool and let them
    // re-see — same recovery shape as solo-rounds.js.
    if (candidates.length < count) candidates = pool;

    let picked = pickByDifficultyMix(candidates, count);
    picked = balanceTruth(picked, candidates, count);
    picked = smoothCategories(shuffle(picked));

    // Build session with answer key. ID is unguessable.
    const sessionId = `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const answerKey = {};
    for (const s of picked) answerKey[s.id] = s.isTrue;

    // Fire-and-forget session write — if it fails, judge will treat the
    // session as missing and 404. Acceptable degradation.
    fsPatch(SESSIONS_COL, sessionId, {
      userId:    toFS(uid || null),
      lang:      toFS(lang),
      answerKey: toFS(answerKey),
      createdAt: toFS(Date.now()),
      consumed:  toFS(false),
    }).catch(() => {});

    // Strip isTrue from response — anti-cheat.
    return res.status(200).json({
      sessionId,
      statements: picked.map(s => ({
        id: s.id, text: s.text,
        category: s.category, difficulty: s.difficulty,
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

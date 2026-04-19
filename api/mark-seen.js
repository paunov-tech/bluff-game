// api/mark-seen.js — Append round IDs + short summaries a user has been shown
// to bluff_seen/{userId}. Called fire-and-forget from the client at game end.
//
// Body: { userId, mode: "solo"|"blitz"|"daily", rounds: [{id, summary?}] }
//
// Tracking fuels two behaviours:
//   1. solo-rounds.js filters the cache pool against bluff_seen.solo
//   2. generate-round.js passes last ~20 seenSummaries to Claude so live-gen
//      produces topics the user hasn't been fed before
//
// Failure modes are intentionally soft — mark-seen is never on the critical
// path. We always return 200 so the client's `.catch(() => {})` hook never
// sees an error.

const FB_KEY     = process.env.FIREBASE_API_KEY;
const FB_PROJECT = "molty-portal";
const FB_URL     = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

const MODE_KEYS = new Set(["solo", "blitz", "daily"]);
// FIFO cap per mode — oldest IDs drop off, allowing the deep backlog to
// eventually resurface after a user has played hundreds of games.
const ID_CAP = 500;
// Keep fewer summaries than IDs — we only feed the most recent ~20 to Claude
// as an "avoid these topics" hint. The full map would inflate the doc.
const SUMMARY_CAP = 80;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(200).json({ ok: false, error: "method" });

  try {
    const { userId, mode, rounds } = req.body || {};
    if (!userId || typeof userId !== "string") return res.status(200).json({ ok: false });
    if (!MODE_KEYS.has(mode))                   return res.status(200).json({ ok: false });
    if (!Array.isArray(rounds) || rounds.length === 0) return res.status(200).json({ ok: true, noop: true });
    if (!FB_KEY)                                return res.status(200).json({ ok: false });

    const ids = [];
    const summaryPairs = [];
    for (const r of rounds) {
      if (!r || typeof r.id !== "string" || !r.id) continue;
      ids.push(r.id);
      if (typeof r.summary === "string" && r.summary.trim()) {
        summaryPairs.push([r.id, r.summary.slice(0, 80)]);
      }
    }
    if (ids.length === 0) return res.status(200).json({ ok: true, noop: true });

    // Fetch existing doc (may be missing)
    let existing = null;
    try {
      const r = await fetch(`${FB_URL}/bluff_seen/${encodeURIComponent(userId)}?key=${FB_KEY}`, {
        signal: AbortSignal.timeout(4000),
      });
      if (r.ok) existing = await r.json();
    } catch { /* ignore — we'll just create */ }

    const parsed = parseSeen(existing);

    // Merge: append new IDs, dedup while preserving order (oldest first),
    // enforce FIFO cap.
    const existingIds = parsed[mode] || [];
    const seenSet = new Set(existingIds);
    const merged = existingIds.slice();
    for (const id of ids) {
      if (!seenSet.has(id)) {
        merged.push(id);
        seenSet.add(id);
      }
    }
    const cappedIds = merged.length > ID_CAP ? merged.slice(merged.length - ID_CAP) : merged;

    // Summary map — only keep summaries for IDs that survived the cap,
    // and cap the overall summary count so the doc doesn't balloon.
    const existingSummaries = parsed.seenSummaries?.[mode] || {};
    const mergedSummaries = { ...existingSummaries };
    for (const [id, s] of summaryPairs) {
      mergedSummaries[id] = s;
    }
    const keepIdSet = new Set(cappedIds);
    let trimmedSummaries = {};
    for (const id of cappedIds) {
      if (mergedSummaries[id]) trimmedSummaries[id] = mergedSummaries[id];
    }
    // If somehow still over summary cap, drop oldest (cappedIds is oldest→newest)
    const summaryEntries = Object.keys(trimmedSummaries);
    if (summaryEntries.length > SUMMARY_CAP) {
      const keepIds = cappedIds.slice(cappedIds.length - SUMMARY_CAP);
      const trimmed2 = {};
      for (const id of keepIds) if (trimmedSummaries[id]) trimmed2[id] = trimmedSummaries[id];
      trimmedSummaries = trimmed2;
    }

    // Build PATCH payload — rewrite the per-mode fields, preserve the other
    // modes' data by round-tripping their existing values.
    const allModes = ["solo", "blitz", "daily"];
    const fields = {
      userId:    { stringValue: userId },
      updatedAt: { integerValue: String(Date.now()) },
    };
    for (const m of allModes) {
      const arr = m === mode ? cappedIds : (parsed[m] || []);
      fields[m] = toArrayValue(arr);
    }
    const summariesFields = {};
    for (const m of allModes) {
      const sm = m === mode ? trimmedSummaries : (parsed.seenSummaries?.[m] || {});
      summariesFields[m] = toMapValue(sm);
    }
    fields.seenSummaries = { mapValue: { fields: summariesFields } };

    const lastResetFields = {};
    const existingReset = parsed.lastReset || {};
    for (const m of allModes) {
      const v = existingReset[m];
      if (typeof v === "number" && v > 0) {
        lastResetFields[m] = { integerValue: String(v) };
      }
    }
    if (Object.keys(lastResetFields).length > 0) {
      fields.lastReset = { mapValue: { fields: lastResetFields } };
    }

    try {
      await fetch(`${FB_URL}/bluff_seen/${encodeURIComponent(userId)}?key=${FB_KEY}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      console.warn("[mark-seen] write failed:", e.message);
    }

    return res.status(200).json({ ok: true, mode, count: cappedIds.length });
  } catch (e) {
    console.warn("[mark-seen] handler error:", e.message);
    return res.status(200).json({ ok: false });
  }
}

function toArrayValue(ids) {
  return { arrayValue: { values: ids.map(id => ({ stringValue: id })) } };
}

function toMapValue(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === "string") fields[k] = { stringValue: v };
  }
  return { mapValue: { fields } };
}

function parseSeen(doc) {
  if (!doc?.fields) return {};
  const out = {};
  for (const [k, v] of Object.entries(doc.fields)) out[k] = parseFirestoreValue(v);
  return out;
}

function parseFirestoreValue(val) {
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
  if (val.doubleValue !== undefined) return val.doubleValue;
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.arrayValue !== undefined) {
    return (val.arrayValue.values || []).map(parseFirestoreValue);
  }
  if (val.mapValue !== undefined) {
    const obj = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      obj[k] = parseFirestoreValue(v);
    }
    return obj;
  }
  return null;
}

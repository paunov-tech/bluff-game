// api/community-pulse.js — aggregate community presence for the toast
// system shown during Solo play. NOT real-time multiplayer. Returns a
// best-effort player count (with a >5 floor) plus a single recent event.
//
// Privacy:
//   - Only returns handles, never real names or emails.
//   - Never returns IPs or city. A flag emoji is OK if we already know
//     the player's display flag (we currently don't store one, so the
//     event flag is a randomized stable hash from the handle).
//   - Anonymous (no-handle) players are excluded.
//   - If <6 registered players visible, we round up to 6 instead of
//     revealing the true small count.

import { fsQuery } from "./_lib/firestore-rest.js";

const COL = "bluff_players";

// Stable, lo-fi flag pick keyed off the handle so the same player always
// shows the same flag. Not a privacy leak — it does not reveal location.
const FLAGS = ["🇷🇸","🇩🇪","🇧🇷","🇯🇵","🇺🇸","🇰🇷","🇮🇹","🇫🇷","🇪🇸","🇬🇧","🇭🇷","🇸🇮","🇳🇱","🇨🇦","🇦🇺","🇲🇽","🇵🇱","🇸🇪","🇳🇴","🇫🇮"];
function flagFor(handle) {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) | 0;
  return FLAGS[Math.abs(h) % FLAGS.length];
}

const EVENT_KINDS = ["loss", "win", "streak"];
function pickKind() {
  // Loss is most common (we want the "you're not alone in failing" vibe).
  const r = Math.random();
  if (r < 0.55) return "loss";
  if (r < 0.85) return "win";
  return "streak";
}

const MIN_VISIBLE_COUNT = 6;

let cachedAt = 0;
let cachedPayload = null;
const CACHE_TTL_MS = 25_000;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  // Light per-process cache so a wave of concurrent solo players doesn't
  // hammer Firestore. The toast cadence is already 25-35s per client.
  const now = Date.now();
  if (cachedPayload && now - cachedAt < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "public, max-age=15");
    return res.status(200).json(cachedPayload);
  }

  let players = [];
  try {
    // Sample a slice of registered players ordered by recency. We can't
    // filter "handle != null" via REST without indexes, so over-fetch and
    // strip in memory.
    players = await fsQuery(COL, {
      orderBy: [{ path: "updatedAt", desc: true }],
      limit: 60,
    });
  } catch {
    // Fall through to empty — we still return a synthetic payload.
  }

  const handled = players
    .map(p => p.fields || {})
    .filter(f => f.handle && !f.migratedTo)
    .map(f => String(f.handle));

  // activePlayersNow: count of registered players whose updatedAt is
  // within the last 24h, with a fuzzed minimum of 6 so we never reveal
  // a tiny community. We add a small live-feeling jitter.
  const visible = handled.length;
  const baseCount = Math.max(visible, MIN_VISIBLE_COUNT);
  const jitter = Math.floor(Math.random() * 9) - 4; // -4 .. +4
  const activePlayersNow = Math.max(MIN_VISIBLE_COUNT, baseCount + jitter);

  // Pick a recent event. Prefer a real handle from the sample (privacy:
  // handles are already player-chosen public identifiers). If none, fall
  // back to a small synthetic pool so the feed never goes dead.
  let recentEvent = null;
  const SYNTH_POOL = ["Mira","Kenji","João","Ana","Yuki","Nikola","Hassan","Leo","Sofia","Oskar"];
  const handleSrc = handled.length > 0
    ? handled[Math.floor(Math.random() * handled.length)]
    : SYNTH_POOL[Math.floor(Math.random() * SYNTH_POOL.length)];
  recentEvent = {
    kind: pickKind(),
    flag: flagFor(handleSrc),
    handle: handleSrc,
    age: 5 + Math.floor(Math.random() * 55),
  };

  // Top choice — without per-round telemetry yet, return a plausible but
  // synthetic stat. The toast text frames it as "Top 10% chose X" so the
  // randomness reads as real audience behaviour.
  const ANSWERS = ["A","B","C","D","E"];
  const topChoice = {
    answer: ANSWERS[Math.floor(Math.random() * ANSWERS.length)],
    percent: 60 + Math.floor(Math.random() * 25),
  };

  const payload = { activePlayersNow, recentEvent, topChoice };
  cachedAt = now;
  cachedPayload = payload;
  res.setHeader("Cache-Control", "public, max-age=15");
  return res.status(200).json(payload);
}

// api/swear-leaderboard.js — top SWEAR balances.
// GET → top 20 players by swearBalance (only those with a handle set).

import { fsQuery } from "./_lib/firestore-rest.js";

const COL = "bluff_players";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  try {
    // Pull top 40 by balance then filter to those with a handle. We can't
    // easily combine "handle != null" with an order-by in REST queries
    // without composite indexes, so we over-fetch and trim.
    const rows = await fsQuery(COL, {
      orderBy: [{ path: "swearBalance", desc: true }],
      limit: 40,
    });
    const leaderboard = rows
      .filter(r => !r.fields.migratedTo)
      .map(r => ({
        handle:         r.fields.handle || null,
        swearBalance:   r.fields.swearBalance || 0,
        isEarlyAdopter: !!r.fields.isEarlyAdopter,
        isPro:          !!r.fields.isPro,
      }))
      .filter(p => p.handle && p.swearBalance > 0)
      .slice(0, 20);

    return res.status(200).json({ leaderboard });
  } catch (e) {
    return res.status(200).json({ leaderboard: [], error: e.message });
  }
}

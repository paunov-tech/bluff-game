// api/early-adopter.js — Track first 100 users who get lifetime free
// Uses Vercel KV for counter. GET returns rank, POST registers user.

import { kv } from "@vercel/kv";

const EARLY_ADOPTER_LIMIT = 100;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const count = (await kv.get("early_adopter_count")) || 0;
    return res.status(200).json({
      count,
      limit: EARLY_ADOPTER_LIMIT,
      slots_remaining: Math.max(0, EARLY_ADOPTER_LIMIT - count),
      window_open: count < EARLY_ADOPTER_LIMIT,
    });
  }

  if (req.method === "POST") {
    const { user_id } = req.body || {};
    if (!user_id) return res.status(400).json({ error: "user_id required" });

    const existing = await kv.get(`early_adopter:${user_id}`);
    if (existing) {
      return res.status(200).json({
        is_early_adopter: true,
        rank: existing.rank,
        registered_at: existing.registered_at,
      });
    }

    const newCount = await kv.incr("early_adopter_count");

    if (newCount > EARLY_ADOPTER_LIMIT) {
      await kv.decr("early_adopter_count");
      return res.status(200).json({
        is_early_adopter: false,
        slots_closed: true,
      });
    }

    const record = {
      rank: newCount,
      registered_at: new Date().toISOString(),
    };
    await kv.set(`early_adopter:${user_id}`, record);

    return res.status(200).json({
      is_early_adopter: true,
      ...record,
    });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

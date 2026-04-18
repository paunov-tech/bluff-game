// api/_lib/rate-limit.js — KV-backed sliding-window rate limiter.
// Fails open if KV isn't configured (dev) or errors (don't block real traffic).

import { kv } from "@vercel/kv";

export function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (real) return String(real).trim();
  return req.socket?.remoteAddress || "unknown";
}

export async function rateLimit(req, {
  bucket = "rl",
  limit = 10,
  windowSec = 60,
} = {}) {
  const ip = getClientIp(req);
  const windowStart = Math.floor(Date.now() / 1000 / windowSec) * windowSec;
  const key = `rl:${bucket}:${ip}:${windowStart}`;

  try {
    const count = await kv.incr(key);
    if (count === 1) {
      await kv.expire(key, windowSec + 5);
    }
    const remaining = Math.max(0, limit - count);
    return {
      ok: count <= limit,
      count,
      limit,
      remaining,
      resetAt: (windowStart + windowSec) * 1000,
    };
  } catch {
    // KV unavailable — fail open so prod doesn't break on infra hiccups
    return { ok: true, count: 0, limit, remaining: limit, resetAt: 0, failOpen: true };
  }
}

export function applyRateLimitHeaders(res, result) {
  res.setHeader("X-RateLimit-Limit", String(result.limit));
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  if (result.resetAt) res.setHeader("X-RateLimit-Reset", String(Math.floor(result.resetAt / 1000)));
}

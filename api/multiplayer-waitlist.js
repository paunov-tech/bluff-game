// api/multiplayer-waitlist.js — Collect emails for the multiplayer waitlist.
//
// POST { email, lang? }
//
// Writes to multiplayer_waitlist/{normalised-email}. Idempotent: if the
// same email signs up twice, the doc is upserted with the latest timestamp.
// No auth required — this is a public sign-up endpoint.

import { fsPatch, toFS } from "./_lib/firestore-rest.js";
import { rateLimit, applyRateLimitHeaders } from "./_lib/rate-limit.js";

const COL = "multiplayer_waitlist";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Firestore document IDs can't contain ".", "/", "\", "[", "]", "*". Map
// "@" → "_at_" and "." → "_" so addresses round-trip safely.
function emailToDocId(email) {
  return email.toLowerCase().replace(/@/g, "_at_").replace(/\./g, "_");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")    return res.status(405).json({ error: "POST only" });

  // Light rate limit — no auth, public form. 10/min/IP is plenty.
  const rl = await rateLimit(req, { bucket: "mp-waitlist", limit: 10, windowSec: 60 });
  applyRateLimitHeaders(res, rl);
  if (!rl.ok) return res.status(429).json({ error: "rate_limited" });

  if (!process.env.FIREBASE_API_KEY) {
    return res.status(503).json({ error: "Firestore not configured" });
  }

  const body = req.body || {};
  const rawEmail = typeof body.email === "string" ? body.email.trim() : "";
  if (!rawEmail || rawEmail.length > 200 || !EMAIL_RE.test(rawEmail)) {
    return res.status(400).json({ error: "invalid_email" });
  }
  const lang = (body.lang || "en").toString().slice(0, 4);

  const docId = emailToDocId(rawEmail);
  try {
    await fsPatch(COL, docId, {
      email:     toFS(rawEmail.toLowerCase()),
      lang:      toFS(lang),
      createdAt: toFS(Date.now()),
      ip:        toFS(req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",")[0].trim().slice(0, 64) : null),
      userAgent: toFS(typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, 200) : null),
    });
  } catch (e) {
    console.warn("[mp-waitlist] write failed:", e.message);
    return res.status(500).json({ error: "write_failed" });
  }

  return res.status(200).json({ ok: true });
}

// api/recover.js — SIAL Shared Premium Recovery via Email
// ENV: STRIPE_SECRET_KEY, FIREBASE_API_KEY, PRODUCT_NAME
import Stripe from "stripe";

const _rl = new Map();
function rlOk(ip) {
  const now = Date.now(), WIN = 3600000;
  for (const [k, v] of _rl) { if (now > v.r) _rl.delete(k); }
  const e = _rl.get(ip);
  if (!e || now > e.r) { _rl.set(ip, { c: 1, r: now + WIN }); return true; }
  if (e.c >= 5) return false;
  e.c++; return true;
}

async function writePremium(deviceId, data) {
  const apiKey = process.env.FIREBASE_API_KEY;
  if (!apiKey || !deviceId) return false;
  const product = (process.env.PRODUCT_NAME || "sial").toLowerCase().replace(/[^a-z0-9]/g, "_");
  const url = `https://firestore.googleapis.com/v1/projects/molty-portal/databases/(default)/documents/${product}_premium/${deviceId}?key=${apiKey}`;
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) continue;
    if (typeof v === "number") fields[k] = { integerValue: String(v) };
    else fields[k] = { stringValue: String(v || "") };
  }
  try { const r = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) }); return r.ok; } catch { return false; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const clientIp = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (!rlOk(clientIp)) return res.status(429).json({ error: "Too many attempts. Try again in 1 hour." });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: "Service unavailable" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const { email, deviceId } = req.body || {};
  if (!email || !deviceId) return res.status(400).json({ error: "Email and deviceId required" });

  const cleanEmail = String(email).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: "Invalid email" });

  try {
    const productName = process.env.PRODUCT_NAME || "";
    const sessions = await stripe.checkout.sessions.list({ limit: 100, status: "complete" });
    const match = sessions.data.find(s =>
      s.customer_email?.toLowerCase() === cleanEmail &&
      s.payment_status === "paid" &&
      (!productName || (s.metadata?.product || "").toLowerCase() === productName.toLowerCase())
    );

    if (!match) return res.status(404).json({ error: "No payment found for this email", recovered: false });

    const meta = match.metadata || {};
    const days = parseInt(meta.days) || 7;
    const paidAt = new Date(match.created * 1000);
    const expiresAt = new Date(paidAt.getTime() + days * 86400000);

    if (expiresAt < new Date()) return res.status(410).json({ error: "Subscription expired", recovered: false });

    await writePremium(deviceId, {
      plan: meta.plan || "basic", days, email: cleanEmail,
      paidAt: paidAt.toISOString(), expiresAt: expiresAt.toISOString(),
      recoveredAt: new Date().toISOString(), sessionId: match.id,
    });

    return res.status(200).json({ recovered: true, plan: meta.plan, days, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    console.error("Recovery error:", err.message);
    return res.status(500).json({ error: "Recovery service error" });
  }
}

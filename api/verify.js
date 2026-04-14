// api/verify.js — SIAL Shared Payment Verification
// ENV: STRIPE_SECRET_KEY
import Stripe from "stripe";

const _rl = new Map();
function rlOk(ip) {
  const now = Date.now(), WIN = 3600000;
  for (const [k, v] of _rl) { if (now > v.r) _rl.delete(k); }
  const e = _rl.get(ip);
  if (!e || now > e.r) { _rl.set(ip, { c: 1, r: now + WIN }); return true; }
  if (e.c >= 10) return false;
  e.c++; return true;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const clientIp = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (!rlOk(clientIp)) return res.status(429).json({ error: "Too many attempts" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: "Not configured" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid") {
      const meta = session.metadata || {};
      return res.status(200).json({
        verified: true,
        plan: meta.plan || "basic",
        days: parseInt(meta.days) || 7,
        email: session.customer_email || "",
      });
    }
    return res.status(402).json({ verified: false, status: session.payment_status });
  } catch (err) {
    return res.status(500).json({ error: "Verification failed" });
  }
}

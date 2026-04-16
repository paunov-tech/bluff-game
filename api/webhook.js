// api/webhook.js — SIAL Shared Stripe Webhook
// ENV: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, FIREBASE_API_KEY, PRODUCT_NAME
import Stripe from "stripe";
import { kv } from "@vercel/kv";

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
  try {
    const r = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
    return r.ok;
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(500).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    const buf = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook sig error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const meta = session.metadata || {};

    // Slayer Event entry confirmation
    if (meta.type === "slayer_entry" && meta.userId && meta.weekKey) {
      await kv.sadd(`slayer:${meta.weekKey}:entrants`, meta.userId);
      console.log(`[slayer] Entry confirmed for ${meta.userId} week ${meta.weekKey}`);
    }

    // Device Firebase premium
    const deviceId = meta.deviceId;
    if (deviceId) {
      await writePremium(deviceId, {
        plan: meta.plan || "basic",
        days: parseInt(meta.days) || 7,
        email: session.customer_email || "",
        paidAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + (parseInt(meta.days) || 7) * 86400000).toISOString(),
        sessionId: session.id,
        amount: session.amount_total || 0,
      });
    }
  }
  res.status(200).json({ received: true });
}

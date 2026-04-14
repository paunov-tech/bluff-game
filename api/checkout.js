// api/checkout.js — BLUFF™ Stripe Checkout
// ENV: STRIPE_SECRET_KEY, PRODUCT_NAME, PRODUCT_DOMAIN
// Body: { plan, deviceId, email, returnPath, lang }
import Stripe from "stripe";

const CORS_ORIGINS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games").split(",").map(d => `https://${d.trim()}`);

// ── BLUFF Pro plans ──
const DEFAULT_PLANS = {
  monthly:  { price: 499,  days: 30,    label: "Pro — Monthly"    },
  yearly:   { price: 3499, days: 365,   label: "Pro — Yearly"     },
  lifetime: { price: 6999, days: 36500, label: "Pro — Lifetime"   },
};

function getPlans() {
  try { return JSON.parse(process.env.PRODUCT_PLANS); } catch { return DEFAULT_PLANS; }
}

// ── Rate limit ──
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
  const origin = req.headers.origin;
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0] || "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const clientIp = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (!rlOk(clientIp)) return res.status(429).json({ error: "Too many attempts" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: "Payments not configured" });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const plans = getPlans();
  const productName = process.env.PRODUCT_NAME || "SIAL Product";

  try {
    const { plan = "basic", deviceId, email, returnPath, lang } = req.body || {};
    const p = plans[plan] || plans.basic;
    const basePath = (returnPath || "/").split("?")[0];
    const origin = `https://${(process.env.PRODUCT_DOMAIN || "").split(",")[0].trim()}`;
    const successUrl = `${origin}${basePath}?payment=success&plan=${plan}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}${basePath}?payment=cancelled`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: { name: `${productName} — ${p.label}` },
          unit_amount: p.price,
        },
        quantity: 1,
      }],
      customer_email: email || undefined,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { product: productName, plan, days: String(p.days), deviceId: deviceId || "", lang: lang || "en" },
    });

    return res.status(200).json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Checkout error:", err.message);
    return res.status(500).json({ error: "Payment service unavailable" });
  }
}

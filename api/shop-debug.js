// api/shop-debug.js — diagnostic endpoint, safe to leave deployed
import Stripe from "stripe";
import { kv } from "@vercel/kv";

const EXPECTED_PRICES = {
  balkan:    "price_1TMAwkFrEcgVfTLCLUeAremZ",
  anime:     "price_1TMAxDFrEcgVfTLCzujnFaJW",
  corporate: "price_1TMAxYFrEcgVfTLCgfAIJN7z",
  british:   "price_1TMAxsFrEcgVfTLCCQ9ZLZ1x",
  bundle:    "price_1TMAyCFrEcgVfTLCopDBqUDb",
};

export default async function handler(req, res) {
  const results = {};

  // 1. Stripe key
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  results.stripe_key = stripeKey
    ? `OK — ${stripeKey.slice(0, 12)}...`
    : "MISSING — add STRIPE_SECRET_KEY to env";

  // 2. Stripe connection + price IDs
  if (stripeKey) {
    const stripe = new Stripe(stripeKey);
    try {
      const prices = await stripe.prices.list({ limit: 5 });
      results.stripe_connection = `OK — ${prices.data.length} prices found`;
    } catch (e) {
      results.stripe_connection = `FAILED — ${e.message}`;
    }

    results.price_checks = {};
    for (const [skin, priceId] of Object.entries(EXPECTED_PRICES)) {
      try {
        const price = await stripe.prices.retrieve(priceId);
        results.price_checks[skin] = `OK — ${price.unit_amount / 100} ${price.currency.toUpperCase()} (${price.active ? "active" : "INACTIVE"})`;
      } catch (e) {
        results.price_checks[skin] = `FAILED — ${e.message}`;
      }
    }
  }

  // 3. KV connection
  try {
    await kv.set("bluff:diag", "ok", { ex: 60 });
    const val = await kv.get("bluff:diag");
    results.kv = val === "ok" ? "OK" : `MISMATCH — got: ${val}`;
  } catch (e) {
    results.kv = `NOT CONFIGURED — ${e.message.slice(0, 120)}`;
    results.kv_fix = "Go to vercel.com → project → Storage → Connect KV database, then run: vercel env pull .env.local";
  }

  return res.status(200).json(results);
}

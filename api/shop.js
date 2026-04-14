// api/shop.js
import Stripe from "stripe";
import { kv } from "@vercel/kv";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

// Skin price IDs — replace with real Stripe price IDs from Dashboard
const SKIN_PRICES = {
  balkan:    "price_balkan_XXXXX",
  anime:     "price_anime_XXXXX",
  corporate: "price_corporate_XXXXX",
  british:   "price_british_XXXXX",
  bundle:    "price_bundle_XXXXX",
};

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin",  CORS.includes(origin) ? origin : (CORS[0] || "*"));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { action, skinId, userId, sessionId } = req.body;

  // CREATE CHECKOUT SESSION
  if (action === "checkout") {
    if (!SKIN_PRICES[skinId] || SKIN_PRICES[skinId].includes("XXXXX"))
      return res.status(400).json({ error: "Skin not available yet" });

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: SKIN_PRICES[skinId], quantity: 1 }],
        success_url: `${req.headers.origin}?skin_purchased=${skinId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin}?shop=1`,
        metadata: { skinId, userId: userId || "anonymous" },
      });
      return res.status(200).json({ url: session.url });
    } catch (err) {
      console.error("[shop] checkout error:", err.message);
      return res.status(500).json({ error: "Checkout failed" });
    }
  }

  // VERIFY PURCHASE (after redirect back)
  if (action === "verify") {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === "paid") {
        const purchasedSkin = session.metadata.skinId;
        const userKey = `bluff:skins:${userId || session.customer_email || sessionId}`;
        await kv.sadd(userKey, purchasedSkin);
        await kv.expire(userKey, 60 * 60 * 24 * 365 * 5); // 5 years
        return res.status(200).json({ success: true, skinId: purchasedSkin });
      }
      return res.status(200).json({ success: false });
    } catch (err) {
      return res.status(500).json({ error: "Verify failed" });
    }
  }

  // GET OWNED SKINS
  if (action === "owned") {
    try {
      const userKey = `bluff:skins:${userId}`;
      const owned = await kv.smembers(userKey);
      return res.status(200).json({ skins: owned || [] });
    } catch {
      return res.status(200).json({ skins: [] });
    }
  }

  return res.status(400).json({ error: "Invalid action" });
}

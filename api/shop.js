// api/shop.js
import Stripe from "stripe";
import { kv } from "@vercel/kv";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const SKIN_PRICES = {
  balkan:    "price_1TMAwkFrEcgVfTLCLUeAremZ",
  anime:     "price_1TMAxDFrEcgVfTLCzujnFaJW",
  corporate: "price_1TMAxYFrEcgVfTLCgfAIJN7z",
  british:   "price_1TMAxsFrEcgVfTLCCQ9ZLZ1x",
  bundle:    "price_1TMAyCFrEcgVfTLCopDBqUDb",
};

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { action, skinId, userId, sessionId } = req.body;

  if (action === "checkout") {
    if (!SKIN_PRICES[skinId])
      return res.status(400).json({ error: "Invalid skin" });

    const baseUrl = req.headers.origin ||
      (req.headers.host ? `https://${req.headers.host}` : "https://playbluff.games");

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: SKIN_PRICES[skinId], quantity: 1 }],
        success_url: `${baseUrl}?skin_purchased=${skinId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}?shop=1`,
        metadata: { skinId, userId: userId || "anonymous" },
      });
      return res.status(200).json({ url: session.url });
    } catch (err) {
      console.error("[shop] checkout error:", err.message);
      return res.status(500).json({ error: "Checkout failed", detail: err.message });
    }
  }

  if (action === "verify") {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === "paid") {
        const purchasedSkin = session.metadata.skinId;
        const userKey = `bluff:skins:${userId || session.customer_email || sessionId}`;
        // Bundle unlocks all 4 skins
        if (purchasedSkin === "bundle") {
          await kv.sadd(userKey, "balkan", "anime", "corporate", "british");
        } else {
          await kv.sadd(userKey, purchasedSkin);
        }
        await kv.expire(userKey, 60 * 60 * 24 * 365 * 5);
        return res.status(200).json({ success: true, skinId: purchasedSkin });
      }
      return res.status(200).json({ success: false });
    } catch (err) {
      console.error("[shop] verify error:", err.message);
      return res.status(500).json({ error: "Verify failed" });
    }
  }

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

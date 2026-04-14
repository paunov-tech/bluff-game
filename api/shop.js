// api/shop.js
import Stripe from "stripe";
import { kv } from "@vercel/kv";

const SKIN_PRICES = {
  balkan:    "price_1TMAwkFrEcgVfTLCLUeAremZ",
  anime:     "price_1TMAxDFrEcgVfTLCzujnFaJW",
  corporate: "price_1TMAxYFrEcgVfTLCgfAIJN7z",
  british:   "price_1TMAxsFrEcgVfTLCCQ9ZLZ1x",
  bundle:    "price_1TMAyCFrEcgVfTLCopDBqUDb",
};

const BUNDLE_INCLUDES = ["balkan", "anime", "corporate", "british"];

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  return new Stripe(key);
}

async function saveSkinsToKV(userId, skinIds) {
  try {
    const key = `bluff:skins:${userId}`;
    await kv.sadd(key, ...skinIds);
    await kv.expire(key, 60 * 60 * 24 * 365 * 5);
    return true;
  } catch (e) {
    // KV not configured — skins live in localStorage on the client, that's fine
    console.warn("[shop] KV unavailable, skipping server-side save:", e.message);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { action, skinId, userId, sessionId } = req.body;
  console.log(`[shop] action=${action} skinId=${skinId} userId=${userId}`);

  // ── CREATE CHECKOUT ──────────────────────────────────────────
  if (action === "checkout") {
    if (!SKIN_PRICES[skinId]) {
      return res.status(400).json({ error: `Invalid skin: ${skinId}` });
    }
    try {
      const stripe = getStripe();
      const origin =
        req.headers.origin ||
        req.headers.referer?.split("/").slice(0, 3).join("/") ||
        (req.headers.host ? `https://${req.headers.host}` : "https://playbluff.games");

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{ price: SKIN_PRICES[skinId], quantity: 1 }],
        success_url: `${origin}?skin_purchased=${skinId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}?shop=1`,
        metadata: { skinId, userId: userId || "anonymous", source: "bluff_web" },
      });

      console.log(`[shop] Created session ${session.id} for ${skinId}`);
      return res.status(200).json({ url: session.url, sessionId: session.id });
    } catch (err) {
      console.error("[shop] Checkout error:", err.message);
      return res.status(500).json({ error: "Checkout failed", detail: err.message });
    }
  }

  // ── VERIFY PURCHASE ──────────────────────────────────────────
  if (action === "verify") {
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(`[shop] Session ${sessionId}: payment_status=${session.payment_status}`);

      if (session.payment_status !== "paid") {
        return res.status(200).json({
          success: false,
          reason: `payment_status: ${session.payment_status}`,
        });
      }

      const purchasedSkin = session.metadata?.skinId || skinId;
      const purchasedUserId = session.metadata?.userId || userId || "anonymous";
      const skinsToUnlock = purchasedSkin === "bundle" ? BUNDLE_INCLUDES : [purchasedSkin];

      // Best-effort KV save — not fatal if it fails
      const kvSaved = await saveSkinsToKV(purchasedUserId, skinsToUnlock);
      console.log(`[shop] Unlocked [${skinsToUnlock}] for ${purchasedUserId} — KV: ${kvSaved}`);

      return res.status(200).json({
        success: true,
        skinId: purchasedSkin,
        skinsUnlocked: skinsToUnlock,
        userId: purchasedUserId,
      });
    } catch (err) {
      console.error("[shop] Verify error:", err.message);
      return res.status(500).json({ error: "Verify failed", detail: err.message });
    }
  }

  // ── GET OWNED SKINS ──────────────────────────────────────────
  if (action === "owned") {
    if (!userId) return res.status(200).json({ skins: [] });
    try {
      const skins = await kv.smembers(`bluff:skins:${userId}`) || [];
      return res.status(200).json({ skins });
    } catch {
      return res.status(200).json({ skins: [] });
    }
  }

  return res.status(400).json({ error: `Invalid action: ${action}` });
}

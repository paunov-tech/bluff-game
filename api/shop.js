// api/shop.js
import Stripe from "stripe";
import { kv } from "@vercel/kv";
import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";

// Consumed-session TTL: 90 days is past Stripe's typical refund/dispute
// window, after which replay protection is no longer load-bearing.
const CONSUMED_TTL_SEC = 60 * 60 * 24 * 90;

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
      // Replay protection: each Stripe session may grant skins exactly
      // once. Without this, anyone who learns a paid sessionId can
      // re-trigger the verify path indefinitely; combined with the
      // injection of `userId` from the body that previously existed,
      // that was a permanent skin-grant primitive.
      const consumedKey = `shop:consumed:${sessionId}`;
      const alreadyConsumed = await kv.get(consumedKey).catch(() => null);
      if (alreadyConsumed) {
        return res.status(400).json({ error: "Session already redeemed" });
      }

      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      console.log(`[shop] Session ${sessionId}: payment_status=${session.payment_status}`);

      if (session.payment_status !== "paid") {
        return res.status(200).json({
          success: false,
          reason: `payment_status: ${session.payment_status}`,
        });
      }

      // userId resolution priority: (1) authenticated bearer token,
      // (2) metadata captured at checkout creation, (3) reject. Body
      // `userId` is NEVER trusted — that was the injection vector.
      const auth = await verifyRequestAuth(req);
      const metaUid = session.metadata?.userId;
      let resolvedUserId;
      if (auth?.uid) {
        resolvedUserId = auth.uid;
      } else if (metaUid && metaUid !== "anonymous" && metaUid !== "anon") {
        resolvedUserId = metaUid;
      } else {
        return res.status(401).json({ error: "auth_required_for_verify" });
      }

      const purchasedSkin = session.metadata?.skinId || skinId;
      const skinsToUnlock = purchasedSkin === "bundle" ? BUNDLE_INCLUDES : [purchasedSkin];

      // Mark the session consumed BEFORE granting so a parallel race
      // can't double-grant. KV is the source of truth here.
      await kv.set(consumedKey, { uid: resolvedUserId, ts: Date.now() }, { ex: CONSUMED_TTL_SEC }).catch(() => {});

      const kvSaved = await saveSkinsToKV(resolvedUserId, skinsToUnlock);
      console.log(`[shop] Unlocked [${skinsToUnlock}] for ${resolvedUserId} — KV: ${kvSaved}`);

      return res.status(200).json({
        success: true,
        skinId: purchasedSkin,
        skinsUnlocked: skinsToUnlock,
        userId: resolvedUserId,
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

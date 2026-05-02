import { kv } from "@vercel/kv";
import Stripe from "stripe";
import { verifyRequestAuth } from "./_lib/verify-firebase-token.js";

// Maximum plausible solo run score. The current Climb tops out around
// ~25k under best-case scoring; 100k is generous headroom but still
// cheap-cheating-proof for the weekly cash pool.
const MAX_SLAYER_SCORE = 100000;

let _stripe;
function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not set");
  if (!_stripe) _stripe = new Stripe(key);
  return _stripe;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const CORS_ORIGIN = process.env.PRODUCT_DOMAIN
    ? `https://${process.env.PRODUCT_DOMAIN.split(",")[0].trim()}` : "*";
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();

  const weekKey = getWeekKey();

  if (req.method === "GET") {
    const power = Number(await kv.get("axiom:power") ?? 1000);
    const isOpen = power <= 0;
    const entrantCount = await kv.scard(`slayer:${weekKey}:entrants`) ?? 0;
    const pool = (entrantCount * 0.99 * 0.7).toFixed(2);
    return res.json({ isOpen, entrantCount, pool, weekKey });
  }

  if (req.method === "POST") {
    const { action, userId } = req.body;

    if (action === "enter") {
      const session = await getStripe().checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [{
          price_data: {
            currency: "eur",
            product_data: {
              name: "BLUFF™ Slayer Event Entry",
              description: "One entry to this week's AXIOM Slayer Event",
            },
            unit_amount: 99,
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${origin || "https://playbluff.games"}?slayer_success=1&userId=${userId}`,
        cancel_url: `${origin || "https://playbluff.games"}`,
        metadata: { userId, weekKey, type: "slayer_entry" },
      });
      return res.json({ url: session.url });
    }

    if (action === "verify_entry") {
      const isMember = await kv.sismember(`slayer:${weekKey}:entrants`, userId);
      return res.json({ entered: !!isMember });
    }

    if (action === "submit_score") {
      // Hardened: require Bearer token, score is type+range checked,
      // member is forced to auth.uid (not from body), and ZADD GT means
      // a replay with a lower score can't overwrite a higher one.
      const auth = await verifyRequestAuth(req);
      if (!auth?.uid) return res.status(401).json({ error: "auth_required" });

      const { score } = req.body || {};
      if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > MAX_SLAYER_SCORE) {
        return res.status(400).json({ error: "invalid_score" });
      }

      const member = auth.uid;
      const isMember = await kv.sismember(`slayer:${weekKey}:entrants`, member);
      if (!isMember) return res.status(403).json({ error: "Not entered" });

      // GT: only update if the new score is strictly greater than current.
      await kv.zadd(`slayer:${weekKey}:scores`, { gt: true }, { score, member });
      return res.json({ ok: true, score, member });
    }
  }

  return res.status(405).end();
}

function getWeekKey() {
  const d = new Date();
  const week = Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000));
  return `${d.getFullYear()}-W${week}`;
}

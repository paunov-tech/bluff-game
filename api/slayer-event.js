import { kv } from "@vercel/kv";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const CORS_ORIGIN = process.env.PRODUCT_DOMAIN
    ? `https://${process.env.PRODUCT_DOMAIN.split(",")[0].trim()}` : "*";
  res.setHeader("Access-Control-Allow-Origin", CORS_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
      const session = await stripe.checkout.sessions.create({
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
      const { score, userId: uid } = req.body;
      const isMember = await kv.sismember(`slayer:${weekKey}:entrants`, uid);
      if (!isMember) return res.status(403).json({ error: "Not entered" });
      await kv.zadd(`slayer:${weekKey}:scores`, { score, member: uid });
      return res.json({ ok: true });
    }
  }

  return res.status(405).end();
}

function getWeekKey() {
  const d = new Date();
  const week = Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000));
  return `${d.getFullYear()}-W${week}`;
}

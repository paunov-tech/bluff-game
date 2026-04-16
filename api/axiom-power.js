import { kv } from "@vercel/kv";

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin", CORS.includes(origin) ? origin : CORS[0]);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    const power = await kv.get("axiom:power") ?? 1000;
    const weekKey = `axiom:slayer_week:${getWeekKey()}`;
    const slayerCount = await kv.scard(weekKey) ?? 0;
    return res.json({ power: Number(power), slayerCount });
  }

  if (req.method === "POST") {
    const { result } = req.body; // "win" | "loss"
    if (result === "win") {
      await kv.incrbyfloat("axiom:power", -1);
    } else {
      await kv.incrbyfloat("axiom:power", 0.3);
    }
    const raw = Number(await kv.get("axiom:power") ?? 1000);
    const power = Math.max(0, Math.min(1000, raw));
    await kv.set("axiom:power", power);
    return res.json({ power });
  }

  return res.status(405).end();
}

function getWeekKey() {
  const d = new Date();
  const week = Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000));
  return `${d.getFullYear()}-W${week}`;
}

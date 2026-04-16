import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();

  await kv.set("axiom:power", 1000);
  return res.json({ reset: true, power: 1000 });
}

// api/hall-of-shame.js
import { kv } from "@vercel/kv";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin",  CORS.includes(origin) ? origin : (CORS[0] || "*"));
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  // GET — returns top shame entries
  if (req.method === "GET") {
    try {
      const entries = await kv.lrange("bluff:shame:global", 0, 19);
      const parsed = entries
        .map(e => { try { return JSON.parse(e); } catch { return null; }})
        .filter(Boolean);
      return res.status(200).json({ entries: parsed });
    } catch (err) {
      return res.status(200).json({ entries: [] });
    }
  }

  // POST — submit new shame entry
  if (req.method === "POST") {
    const { wrongStatement, correctStatement, category, roundNum } = req.body;
    if (!wrongStatement) return res.status(400).json({ error: "missing data" });

    try {
      const msg = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 80,
        messages: [{
          role: "user",
          content: `You are AXIOM writing a funny anonymous entry for a "Hall of Shame" page.
A player chose "${wrongStatement}" as the lie, but it was actually TRUE.
Write ONE short, funny, anonymous entry about this mistake.
Style: dry, funny, like a roast but not mean. Third person ("someone", "a person", "one individual").
Max 20 words. No quotes.`
        }],
      });

      const writeup = msg.content[0]?.text?.trim() || `Someone thought this was the lie. It wasn't.`;

      const entry = {
        writeup,
        category: category || "unknown",
        round: roundNum || 1,
        ts: Date.now(),
        views: Math.floor(Math.random() * 800) + 100,
      };

      await kv.lpush("bluff:shame:global", JSON.stringify(entry));
      await kv.ltrim("bluff:shame:global", 0, 99);

      return res.status(200).json({ success: true, entry });
    } catch (err) {
      console.error("[shame] error:", err.message);
      return res.status(200).json({ success: false });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

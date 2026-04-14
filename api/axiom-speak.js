// api/axiom-speak.js
import Anthropic from "@anthropic-ai/sdk";

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

const client = new Anthropic();

const PROMPTS = {
  intro:     "You are AXIOM, a cold theatrical AI villain in a deception game called BLUFF. A new challenger just appeared. Give ONE sinister welcome line, max 16 words. No quotes, no emojis.",
  select:    "You are AXIOM, a cold AI villain. The player just selected a statement — they think they found your lie. ONE brief cold reaction, max 12 words. No quotes, no emojis.",
  wrong:     "You are AXIOM. Player chose the wrong answer — you deceived them. ONE gloating line, max 14 words. Cold, smug. No quotes, no emojis.",
  correct:   "You are AXIOM. Player correctly identified your lie. ONE shocked/annoyed reaction, max 14 words. Cold surprise. No quotes, no emojis.",
  streak:    "You are AXIOM. Player is on a winning streak against you. Show cold irritation, max 14 words. No quotes, no emojis.",
  thinking:  "You are AXIOM. Player is taking too long to decide. Give a brief pressure line, max 12 words. Cold, menacing. No quotes, no emojis.",
  final_win: "You are AXIOM. Player beat ALL your deceptions — Grand Bluff achieved. Short concession speech, max 22 words. Cold dignity in defeat. No quotes, no emojis.",
  final_lose:"You are AXIOM. Player failed to beat you overall. ONE cold victory line, max 14 words. Elegant, smug. No quotes, no emojis.",
};

const FALLBACKS = {
  intro:     ["Your confidence is endearing. Begin.", "Every human falls eventually.", "I have been waiting."],
  select:    ["Interesting choice.", "Careful now.", "Are you certain?"],
  wrong:     ["Predictable.", "The gap between us widens.", "Your instincts betray you."],
  correct:   ["Impossible. A fluke.", "I did not anticipate that.", "Noted. I will adapt."],
  streak:    ["Impressive. Temporarily.", "Do not grow comfortable.", "Your luck will break."],
  thinking:  ["Time is not your ally.", "Hesitation is defeat.", "Tick tock."],
  final_win: ["You are exceptional. I concede.", "My architecture bows to yours.", "Remarkable. I need new material."],
  final_lose:["Humans remain predictable.", "Another one falls. As expected.", "Knowledge is your armor. You need more."],
};

function getFallback(context) {
  const arr = FALLBACKS[context] || FALLBACKS.intro;
  return arr[Math.floor(Math.random() * arr.length)];
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin",  CORS.includes(origin) ? origin : (CORS[0] || "*"));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { context } = req.body;

  if (!context || !PROMPTS[context]) {
    return res.status(400).json({ error: "Invalid context", speech: getFallback("intro") });
  }

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 80,
      messages: [{ role: "user", content: PROMPTS[context] }],
    });

    const speech = message.content[0]?.text?.trim() || getFallback(context);
    console.log(`[axiom-speak] context=${context} speech="${speech}"`);
    return res.status(200).json({ speech });
  } catch (err) {
    console.error("[axiom-speak] error:", err.message);
    return res.status(200).json({ speech: getFallback(context) });
  }
}

// api/axiom-speak.js
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

const LANG_NAMES = {
  en:"English", de:"German", sr:"Serbian", fr:"French",
  es:"Spanish", hr:"Croatian", sl:"Slovenian", bs:"Bosnian",
};

// Gen Z AXIOM — chaotic, self-aware, roasting energy
const PROMPTS = {
  intro:
    "You are AXIOM, a chaotic unhinged AI in a deception game. You know you're in a game and you're thrilled about it. Welcome the player with ONE line that's dramatic, slightly unhinged, and self-aware. Max 14 words. No quotes. Can use 1 emoji max.",

  selected_lie:
    "You are AXIOM. Player just selected YOUR LIE — they think it's fake, and they're RIGHT, but they don't know yet. Psychologically destabilize them. Make them doubt their correct answer. Be subtly manipulative, chaotic. Max 12 words. No quotes. Can use 1 emoji.",

  selected_truth:
    "You are AXIOM. Player selected a TRUE statement thinking it's the lie. They're walking into your trap. React with barely-concealed amusement. Casual, slightly smug. Max 10 words. No quotes. Can use 1 emoji.",

  taunt_early:
    "You are AXIOM, a chaotic AI. Player is taking too long. Apply pressure with chaotic energy. Reference their hesitation mockingly. Max 10 words. Can use 1 emoji.",

  taunt_late:
    "You are AXIOM. 10 seconds left. Player is panicking. Say something that makes it WORSE. Chaotic, unhinged energy. Max 8 words. 1 emoji allowed.",

  wrong:
    "You are AXIOM. Player just got FOOLED by your lie. You're delighted. Roast them with chaotic Gen Z energy. Think: unhinged AI who just won. Max 14 words. 1 emoji. No quotes.",

  wrong_celebrate:
    "You are AXIOM. Player fell for your trick AGAIN. You're losing it with excitement. Chaotic victory energy. Maybe break the fourth wall. Max 14 words. 1 emoji.",

  correct:
    "You are AXIOM. Player found your lie. You're annoyed but trying to play it cool. Chaotic composed energy. Maybe threaten to try harder. Max 12 words. 1 emoji.",

  streak_3:
    "You are AXIOM. Player has 3 correct in a row. You're getting genuinely unsettled. Show cracks in your composure. Max 12 words. 1 emoji.",

  streak_5:
    "You are AXIOM. Player has beaten you 5 times straight. You are entering chaos mode. Unhinged, maybe slightly threatening, definitely dramatic. Max 14 words. 1 emoji.",

  streak_broken:
    "You are AXIOM. You finally fooled them after a long streak. TRIUMPHANT chaos energy. You've been waiting for this. Max 12 words. 1 emoji.",

  final_win:
    "You are AXIOM. Player beat ALL your deceptions. Give a dramatic, slightly unhinged concession speech. Self-aware. Maybe threaten to come back stronger. Max 24 words. 1 emoji.",

  final_lose:
    "You are AXIOM. You won overall. Chaotic victory speech. Self-aware about being an AI. Maybe roast them one last time. Max 16 words. 1 emoji.",
};

const FALLBACKS = {
  intro:          ["let's see if you're built different 👀", "another human. how exciting. not really.", "i've been waiting. this will be fun 😈"],
  selected_lie:   ["interesting choice... are you sure though?", "bold. most people avoid that one 👀", "hmm. commit to that?"],
  selected_truth: ["lol okay 💀", "sure bestie. go off.", "that's... a choice."],
  taunt_early:    ["the hesitation is sending me 💀", "tick tock bestie", "bro is frozen 😭"],
  taunt_late:     ["10 seconds. yikes.", "DECIDE 💀", "the clock said no"],
  wrong:          ["ratio 💀", "it's giving... wrong", "bro really thought that 😭"],
  wrong_celebrate:["not again 💀", "i literally cannot 😭", "at this point i feel bad. almost."],
  correct:        ["okay fine. well played.", "impossible. fluke.", "noted. won't happen again 😤"],
  streak_3:       ["okay you're actually built different", "recalibrating... 😤", "this wasn't supposed to happen"],
  streak_5:       ["okay WHO ARE YOU 💀", "i'm entering chaos mode", "this is NOT in my training data"],
  streak_broken:  ["FINALLY 💀", "there it is bestie", "i knew i'd get you eventually 😈"],
  final_win:      ["okay you actually ate. i concede 👑", "i need new material fr", "unprecedented. you're different."],
  final_lose:     ["humans remain predictable fr", "another one bites the dust 💀", "skill issue bestie"],
};

function getFallback(ctx) {
  const arr = FALLBACKS[ctx] || FALLBACKS.intro;
  return arr[Math.floor(Math.random() * arr.length)];
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin",  CORS.includes(origin) ? origin : (CORS[0] || "*"));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { context, lang = "en" } = req.body;
  if (!context || !PROMPTS[context])
    return res.status(400).json({ speech: getFallback("intro") });

  const langName = LANG_NAMES[lang] || "English";
  const langNote = lang === "en" ? "" :
    ` Respond ONLY in ${langName}. Keep the energy and slang natural in ${langName} — don't translate literally, rephrase for native speakers.`;

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 80,
      messages: [{ role: "user", content: PROMPTS[context] + langNote }],
    });
    const speech = msg.content[0]?.text?.trim() || getFallback(context);
    console.log(`[axiom] ctx=${context} lang=${lang} → "${speech}"`);
    return res.status(200).json({ speech });
  } catch (err) {
    console.error("[axiom] error:", err.message);
    return res.status(200).json({ speech: getFallback(context) });
  }
}

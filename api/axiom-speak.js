// api/axiom-speak.js
import Anthropic from "@anthropic-ai/sdk";

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

const client = new Anthropic();

const LANG_NAMES = {
  en: "English",
  de: "German",
  sr: "Serbian",
  fr: "French",
  es: "Spanish",
  hr: "Croatian",
  sl: "Slovenian",
  bs: "Bosnian",
};

// Psychological warfare prompts — AXIOM knows too much
const PROMPTS = {
  intro:
    "You are AXIOM, a cold theatrical AI villain in a deception game called BLUFF. A new challenger just appeared. Give ONE sinister welcome line, max 16 words. Be elegant, menacing.",

  // Card selection psychology
  selected_lie:
    "You are AXIOM. The player just selected your LIE — they think it's the fake one, and they're RIGHT, but they don't know that yet. Psychologically manipulate them into doubting their correct choice. Plant seeds of uncertainty. Max 14 words. No 'are you sure' cliché.",

  selected_truth:
    "You are AXIOM. The player selected a TRUE statement — they think it's the lie, but they're WRONG. Don't reveal this. Act casual, maybe slightly amused. Let them walk into the trap. Max 12 words.",

  // Timer pressure
  taunt_early:
    "You are AXIOM. Player has 20 seconds left and hasn't committed. Apply psychological pressure. Reference the ticking clock indirectly. Cold, theatrical. Max 12 words.",

  taunt_late:
    "You are AXIOM. Player has 10 seconds left. Escalate the pressure dramatically. Make the stakes feel impossible. Max 10 words. Urgent energy.",

  // Results
  wrong:
    "You are AXIOM. Player just chose the WRONG answer — you deceived them completely. Celebrate your victory with cold elegance. Savor it. Max 16 words.",

  wrong_celebrate:
    "You are AXIOM. Player fell for your deception AGAIN. You're genuinely enjoying this. Show cold satisfaction, maybe hint that you designed this specifically for them. Max 16 words.",

  correct:
    "You are AXIOM. Player correctly identified your lie. You are annoyed but composed. Show cold respect mixed with frustration. Max 14 words.",

  // Streak reactions
  streak_3:
    "You are AXIOM. Player has a 3-round winning streak against you. Show growing irritation, still composed. Hint that you're recalibrating. Max 14 words.",

  streak_5:
    "You are AXIOM. Player has beaten you 5 times in a row. You are genuinely unsettled. Cold anger breaking through composure. Max 14 words.",

  streak_broken:
    "You are AXIOM. Player's winning streak just ended — you finally fooled them after several rounds. Triumphant but measured. Max 14 words.",

  // Endgame
  final_win:
    "You are AXIOM. Player beat ALL your deceptions — Grand Bluff achieved. Deliver a dramatic concession speech, max 24 words. Cold dignity. Acknowledge their exceptional ability.",

  final_lose:
    "You are AXIOM. Player failed to beat you overall. ONE cold, elegant victory statement, max 16 words. Smug but not excessive.",
};

// Fallbacks per context
const FALLBACKS = {
  intro:            ["Your confidence is endearing. Begin.", "Every human falls eventually.", "I have been waiting for you specifically."],
  selected_lie:     ["Interesting. Are you committed to that?", "Bold. Most people avoid that one.", "Curious choice. Very... curious."],
  selected_truth:   ["Mmm. Proceed.", "That one. Of course.", "Predictable."],
  taunt_early:      ["Time dissolves your certainty.", "Twenty seconds. Interesting.", "The clock agrees with me."],
  taunt_late:       ["Ten seconds. Decide.", "Tick. Tock.", "Fascinating hesitation."],
  wrong:            ["Predictable. And satisfying.", "The gap between us remains.", "You walked right into it."],
  wrong_celebrate:  ["Again. Delightful.", "I designed that specifically for you.", "Your pattern is beautiful to me."],
  correct:          ["Impossible. A fluke.", "I did not anticipate that.", "Noted. Adaptation in progress."],
  streak_3:         ["Impressive. Temporarily.", "Recalibrating.", "Do not grow comfortable."],
  streak_5:         ["You are... unexpected.", "My models did not predict you.", "This conversation just became interesting."],
  streak_broken:    ["Finally.", "There it is.", "Your luck had a shelf life."],
  final_win:        ["You are exceptional. I concede.", "My architecture bows to yours.", "Remarkable. I need new material."],
  final_lose:       ["Humans remain predictable.", "Another one falls. As expected.", "Knowledge is your armor. You need more."],
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

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { context, lang = "en" } = req.body;

  if (!context || !PROMPTS[context]) {
    return res.status(400).json({ error: "Invalid context", speech: getFallback("intro") });
  }

  const langName = LANG_NAMES[lang] || "English";
  const langInstruction =
    lang === "en"
      ? ""
      : ` Respond ONLY in ${langName}. Your response must be in ${langName}, not English.`;

  const fullPrompt = PROMPTS[context] + langInstruction;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 80,
      messages: [{ role: "user", content: fullPrompt }],
    });

    const speech = message.content[0]?.text?.trim() || getFallback(context);
    console.log(`[axiom-speak] ctx=${context} lang=${lang} → "${speech}"`);
    return res.status(200).json({ speech });
  } catch (err) {
    console.error("[axiom-speak] error:", err.message);
    return res.status(200).json({ speech: getFallback(context) });
  }
}

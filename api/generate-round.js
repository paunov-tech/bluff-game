// api/generate-round.js
import Anthropic from "@anthropic-ai/sdk";

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

const client = new Anthropic();

const DIFFICULTY_RULES = {
  1: `DIFFICULTY 1 — WARM-UP:
This must be VERY easy. The lie should be something almost everyone knows is false.
Examples of lie style: wrong capital city, wrong continent, obvious wrong number (saying
Eiffel Tower is in Berlin, saying humans have 3 legs, saying the Sun orbits the Earth).
The 4 truths should be simple, well-known facts. No tricks. Player must feel smart.`,
  2: `DIFFICULTY 2 — EASY:
Still easy, but requires basic school-level knowledge.
The lie has one clearly wrong detail that most people would catch if they think for a moment.
Example: wrong country for a famous landmark, wrong century for a famous invention.
The truths should be mildly interesting but familiar. Player should still feel confident.`,
  3: `DIFFICULTY 3 — SNEAKY:
The lie is very plausible. Change ONE specific detail in an otherwise true fact.
The truths should be genuinely surprising and counterintuitive.`,
  4: `DIFFICULTY 4 — DEVIOUS:
The lie exploits a common misconception — something most people THINK is true but isn't.
The truths should sound fake but be completely real.`,
  5: `DIFFICULTY 5 — DIABOLICAL:
ALL 4 truths must be so bizarre they sound completely made up.
The lie must be the most "normal-sounding" statement of the five.
Maximum confusion. The lie should be almost indistinguishable from truths.`,
};

const CATEGORY_HINTS = {
  history:   "Surprising historical events, counterintuitive facts about historical figures, little-known events.",
  science:   "Physics, biology, chemistry, astronomy. Include surprising numbers and phenomena.",
  animals:   "Animal behavior, anatomy, and abilities that sound impossible but are real.",
  geography: "Counterintuitive geography facts, surprising borders, distances, and locations.",
  food:      "Origins, ingredients, and surprising facts about food and drink.",
  culture:   "Traditions, art, music, and cultural practices around the world.",
};

const LANG_NAMES = {
  en: "English", de: "German", sr: "Serbian", fr: "French", es: "Spanish",
  hr: "Croatian", sl: "Slovenian", bs: "Bosnian",
};

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin",  CORS.includes(origin) ? origin : (CORS[0] || "*"));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { category = "history", difficulty = 3, lang = "en" } = req.body;
  const difficultyRules = DIFFICULTY_RULES[difficulty] || DIFFICULTY_RULES[3];
  const categoryHint = CATEGORY_HINTS[category] || "Interesting and surprising facts from this topic.";
  const langName = LANG_NAMES[lang] || "English";

  const langInstruction =
    lang === "en"
      ? "Write all statements in English."
      : `Write ALL statements in ${langName}. The content must feel natural and native — not translated. Facts should still be real internationally known facts, but phrased naturally in ${langName}.`;

  const prompt = `Generate a BLUFF round for the "${category}" category.

${difficultyRules}

Category guidance: ${categoryHint}

${langInstruction}

STRICT RULES:
- Create exactly 5 statements
- Exactly 4 must be TRUE — genuinely real, verifiable facts
- Exactly 1 must be a CONVINCING LIE
- The lie must match the style and length of the truths
- The lie must contain specific details (names, numbers, dates) to seem credible
- Do NOT make the lie about something easily Googleable in 5 seconds
- Each statement should be 1-2 sentences, clear and specific
- The lie can be in ANY position — randomize it

CRITICAL JSON RULES:
- "real" must be a boolean: true or false — NOT a string "true" or "false"
- Exactly 4 items must have "real": true
- Exactly 1 item must have "real": false
- Return ONLY the JSON object, no explanation, no markdown

Required format:
{
  "statements": [
    {"text": "A true fact.", "real": true},
    {"text": "Another true fact.", "real": true},
    {"text": "The convincing lie.", "real": false},
    {"text": "Another true fact.", "real": true},
    {"text": "Another true fact.", "real": true}
  ]
}`;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0]?.text || "";
    const parsed = extractJSON(raw);
    const normalized = normalizeStatements(parsed.statements);
    validateAndRepair(normalized);

    console.log(`[generate-round] cat=${category} diff=${difficulty} lang=${lang} lies=${normalized.filter(s => !s.real).length}`);
    return res.status(200).json({ category, difficulty, statements: normalized });
  } catch (err) {
    console.error("[generate-round] error:", err.message);
    return res.status(200).json(getFallbackRound(category));
  }
}

function normalizeStatements(statements) {
  if (!Array.isArray(statements)) throw new Error("statements is not an array");
  return statements.map(s => ({
    text: String(s.text || s.t || ""),
    real: s.real === true || s.real === "true" || s.r === true,
  }));
}

function validateAndRepair(statements) {
  const lieCount = statements.filter(s => !s.real).length;
  if (lieCount === 0) {
    console.warn("[generate-round] No lie — forcing last to false");
    statements[statements.length - 1].real = false;
  }
  if (lieCount > 1) {
    console.warn(`[generate-round] ${lieCount} lies — keeping first`);
    let found = false;
    statements.forEach(s => { if (!s.real) { if (found) s.real = true; else found = true; } });
  }
  if (statements.length !== 5) throw new Error(`Expected 5, got ${statements.length}`);
}

function extractJSON(raw) {
  if (!raw?.trim()) throw new Error("Empty response");
  let clean = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(clean); } catch {}
  const f = clean.indexOf("{"), l = clean.lastIndexOf("}");
  if (f !== -1 && l > f) { try { return JSON.parse(clean.slice(f, l + 1)); } catch {} }
  throw new Error("Could not parse JSON");
}

function getFallbackRound(category) {
  const fallbacks = {
    history: { category: "history", difficulty: 3, statements: [
      { text: "Napoleon was once attacked by a horde of rabbits during a hunting party after the Treaty of Tilsit.", real: true },
      { text: "Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid.", real: true },
      { text: "The French army requisitioned over 600 Paris taxis to rush troops to the Battle of the Marne.", real: true },
      { text: "Ancient Romans built steam-powered mechanisms making temple doors appear to open by divine force.", real: true },
      { text: "Queen Victoria kept a personal diary written exclusively in Urdu for the last 13 years of her reign.", real: false },
    ]},
    science: { category: "science", difficulty: 3, statements: [
      { text: "Honey never spoils — archaeologists found 3,000-year-old honey in Egyptian tombs still edible.", real: true },
      { text: "A teaspoon of neutron star material would weigh approximately 6 billion tons on Earth.", real: true },
      { text: "Bananas are slightly radioactive due to their potassium-40 isotope content.", real: true },
      { text: "Hot water can freeze faster than cold water under certain conditions — the Mpemba effect.", real: true },
      { text: "Jupiter's core is a single enormous diamond roughly the size of Earth.", real: false },
    ]},
    animals: { category: "animals", difficulty: 3, statements: [
      { text: "A group of flamingos is officially called a 'flamboyance.'", real: true },
      { text: "Octopuses have three hearts and blue blood.", real: true },
      { text: "Crows can recognize individual human faces and hold grudges for years.", real: true },
      { text: "The mimic octopus can impersonate over 15 marine species including lionfish and sea snakes.", real: true },
      { text: "Dolphins sleep with both eyes closed but alternate which hemisphere stays awake — 'stereo dreaming.'", real: false },
    ]},
  };
  return fallbacks[category] || fallbacks.history;
}

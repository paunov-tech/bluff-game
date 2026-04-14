// api/generate-round.js
import Anthropic from "@anthropic-ai/sdk";
import { kv } from "@vercel/kv";

const client = new Anthropic();

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

const LANG_NAMES = {
  en:"English", de:"German", sr:"Serbian", fr:"French",
  es:"Spanish", hr:"Croatian", sl:"Slovenian", bs:"Bosnian",
};

const DIFFICULTY_RULES = {
  0: `DIFFICULTY 0 — BABY MODE (Round 1 only):
This must be IMPOSSIBLE to get wrong for any adult.
The lie must be something a 6-year-old would know is false.
Examples of acceptable lies: "The Sun orbits the Earth",
"Humans have 4 legs", "Paris is the capital of Germany",
"Water is made of fire", "Dogs can fly naturally".
The 4 truths must be genuinely interesting surprising facts
that feel rewarding to learn. Player must feel SMART and CURIOUS.
This round exists only to hook the player. Make it fun, not challenging.`,

  1: `DIFFICULTY 1 — WARM-UP:
The lie should be something most adults would catch within seconds.
Use one obviously wrong detail — wrong continent, wrong century,
clearly impossible number. Example lie style: saying the Eiffel Tower
is 8000 meters tall, or that Shakespeare was American.
The 4 truths should be surprising and fun — things that make you say
"wait really?!" Player should feel confident but slightly challenged.`,

  2: `DIFFICULTY 2 — EASY:
The lie requires basic school-level knowledge to detect.
One wrong detail that's incorrect but sounds almost plausible.
Example: wrong country for a famous invention, wrong decade for an event.
The truths should be genuinely surprising. Player should feel smart for catching it.`,

  3: `DIFFICULTY 3 — SNEAKY:
The lie is very plausible. ONE specific detail is wrong in an otherwise
true-sounding statement. The truths should be counterintuitive.`,

  4: `DIFFICULTY 4 — DEVIOUS:
The lie exploits common misconceptions — things most people THINK are
true. The truths should sound completely fake but be real.`,

  5: `DIFFICULTY 5 — DIABOLICAL:
ALL 4 truths must be so bizarre they sound made up.
The lie must be the most normal-sounding statement.
Maximum psychological confusion.`,
};

const CATEGORY_HINTS = {
  history:     "Surprising historical events, counterintuitive facts about historical figures.",
  science:     "Physics, biology, chemistry, astronomy. Surprising numbers and phenomena.",
  animals:     "Animal behavior, anatomy, abilities that sound impossible but are real.",
  geography:   "Counterintuitive geography facts, surprising borders, distances.",
  food:        "Origins, ingredients, surprising facts about food and drink.",
  culture:     "Traditions, art, music, cultural practices around the world.",
  internet:    "Facts about the internet, social media, viral moments, gaming, tech culture. Things Gen Z would find genuinely surprising about the digital world.",
  popculture:  "Music, movies, celebrities, streaming, Gen Z cultural moments. Surprising behind-the-scenes facts, real statistics, unexpected truths.",
  sports:      "Surprising sports records, athlete facts, unexpected statistics from football, basketball, tennis, Olympics.",
};

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < Math.min(str.length, 50); i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return String(Math.abs(h));
}

async function getUsedFacts(category, lang) {
  try {
    const key = `bluff:used:${category}:${lang}`;
    const used = await kv.lrange(key, 0, 59);
    return used || [];
  } catch { return []; }
}

async function saveUsedFacts(category, lang, statements) {
  try {
    const key = `bluff:used:${category}:${lang}`;
    const hashes = statements.map(s => simpleHash(s.text));
    if (hashes.length > 0) {
      await kv.lpush(key, ...hashes);
      await kv.ltrim(key, 0, 59);
    }
  } catch { /* non-critical */ }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin",  CORS.includes(origin) ? origin : (CORS[0] || "*"));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { category = "history", difficulty = 3, lang = "en" } = req.body;
  const diffRules = DIFFICULTY_RULES[difficulty] ?? DIFFICULTY_RULES[3];
  const catHint = CATEGORY_HINTS[category] || "Interesting surprising facts from this topic.";
  const langName = LANG_NAMES[lang] || "English";

  const langNote = lang === "en"
    ? "Write all statements in English."
    : `Write ALL statements in ${langName}. Rephrase naturally for native speakers — do NOT translate literally. Use natural phrasing, idioms, and cultural references appropriate for ${langName} speakers. The facts must still be internationally accurate.`;

  const usedHashes = await getUsedFacts(category, lang);
  const dedupNote = usedHashes.length > 0
    ? `\nIMPORTANT — AVOID REPETITION: You have already used ${usedHashes.length} fact combinations in this category. Generate FRESH facts and topics not recently used. Vary your subjects widely.`
    : "";

  const prompt = `Generate a BLUFF round for the "${category}" category.

${diffRules}

Category guidance: ${catHint}

${langNote}${dedupNote}

STRICT RULES:
- Create exactly 5 statements
- Exactly 4 TRUE — genuinely real, verifiable facts
- Exactly 1 CONVINCING LIE — same style/length as truths
- Lie must have specific details (names, numbers, dates)
- Each statement: 1-2 sentences, clear and specific
- Randomize the lie position
- Make truths SURPRISING and interesting — reward curiosity

CRITICAL JSON:
- "real": true or false (boolean, NOT string)
- Exactly 4 true, exactly 1 false
- Return ONLY JSON, no markdown, no explanation

Format:
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
    const msg = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = msg.content[0]?.text || "";
    const parsed = extractJSON(raw);
    const normalized = normalize(parsed.statements);
    repair(normalized);

    await saveUsedFacts(category, lang, normalized);

    console.log(`[round] cat=${category} diff=${difficulty} lang=${lang} used=${usedHashes.length} lies=${normalized.filter(s=>!s.real).length}`);
    return res.status(200).json({ category, difficulty, statements: normalized });
  } catch (err) {
    console.error("[round] error:", err.message);
    return res.status(200).json(getFallback(category));
  }
}

function normalize(statements) {
  if (!Array.isArray(statements)) throw new Error("not array");
  return statements.map(s => ({
    text: String(s.text || ""),
    real: s.real === true || s.real === "true",
  }));
}

function repair(stmts) {
  const lies = stmts.filter(s => !s.real).length;
  if (lies === 0) { stmts[stmts.length - 1].real = false; }
  if (lies > 1) {
    let f = false;
    stmts.forEach(s => { if (!s.real) { if (f) s.real = true; else f = true; }});
  }
  if (stmts.length !== 5) throw new Error(`bad length: ${stmts.length}`);
}

function extractJSON(raw) {
  if (!raw?.trim()) throw new Error("empty");
  let clean = raw.replace(/```json\s*/g,"").replace(/```\s*/g,"").trim();
  try { return JSON.parse(clean); } catch {}
  const f = clean.indexOf("{"), l = clean.lastIndexOf("}");
  if (f !== -1 && l > f) { try { return JSON.parse(clean.slice(f,l+1)); } catch {} }
  throw new Error("no JSON");
}

function getFallback(cat) {
  const map = {
    history: { category:"history", difficulty:1, statements:[
      {text:"Napoleon was once attacked by a horde of rabbits during a hunting party.",real:true},
      {text:"Cleopatra lived closer in time to the Moon landing than to the Great Pyramid.",real:true},
      {text:"The French army used 600 Paris taxis to rush troops to the Battle of the Marne.",real:true},
      {text:"Ancient Romans built steam-powered mechanisms making temple doors open by 'divine force.'",real:true},
      {text:"Queen Victoria kept a diary in Urdu for the last 13 years of her reign.",real:false},
    ]},
    internet: { category:"internet", difficulty:1, statements:[
      {text:"The first YouTube video ever uploaded was called 'Me at the zoo' and is 18 seconds long.",real:true},
      {text:"'E' is the most common letter used in English internet text.",real:true},
      {text:"The original Space Jam website from 1996 is still live and unchanged.",real:true},
      {text:"Wikipedia has over 6.7 million articles in English alone.",real:true},
      {text:"Google's original name was 'Backrub' before it was changed in 1997.",real:false},
    ]},
    popculture: { category:"popculture", difficulty:1, statements:[
      {text:"Eminem can rap approximately 11 syllables per second at his fastest.",real:true},
      {text:"The Netflix show Squid Game became the platform's most-watched series ever within 28 days.",real:true},
      {text:"Billie Eilish recorded her debut album entirely in her childhood bedroom.",real:true},
      {text:"The Minecraft soundtrack was composed in just 3 days.",real:true},
      {text:"Among Us was originally designed as a battle royale game before changing concept.",real:false},
    ]},
  };
  return map[cat] || map.history;
}

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

GOAL: The player MUST win immediately. This is a dopamine hit,
not a challenge. If the player gets this wrong, they will quit.

LIE RULE:
The lie must be something EVERY 8-YEAR-OLD KNOWS is false.
Completely absurd, impossible claim that sounds wrong at first glance.
No subtlety, no tricks.

GOOD LIE EXAMPLES for difficulty 0:
- "The Earth orbits the Moon"
- "The Eiffel Tower is located in Berlin"
- "Humans have 4 legs"
- "Water is made of fire and air"
- "The Sun rises in the west"
- "Cows can fly naturally"
- "China is located in Europe"
- "Napoleon was American"

4 TRUTHS RULE:
Must be BRILLIANT, UNBELIEVABLE, FASCINATING.
Player must think "WOW, really?!" for each one.
This is the reward for playing — they learn something amazing.
Avoid boring, well-known facts.

GOOD TRUTH EXAMPLES for difficulty 0:
- Octopuses have three hearts and blue blood
- Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid
- Honey never spoils — 3000-year-old edible honey was found in Egyptian tombs
- A group of flamingos is called a "flamboyance"

FORMAT: The lie must be CLEARLY the most obviously wrong of the five statements.

TEST BEFORE RETURNING: Would a 10-year-old immediately know which statement is the lie? If not, make the lie more obvious.`,


  1: `DIFFICULTY 1 — WARM-UP:

GOAL: Almost everyone should get this right. 85%+ of players must
pass. Warm-up, not a challenge. The player feels smart.

LIE RULE:
One obviously incorrect piece of information that every adult knows.
Wrong country, wrong continent, wrong century, or a bizarrely wrong number.
The lie must NOT be subtle. It must "click" as wrong immediately.

GOOD LIE EXAMPLES for difficulty 1:
- Wrong country: "The Eiffel Tower was built in London in 1889."
- Wrong continent: "The Amazon River flows through Africa"
- Wrong century: "Christopher Columbus discovered America in 1992."
- Bizarre number: "The average person has 8 fingers on their hands"
- Famous error: "Shakespeare wrote in French"

WHAT TO AVOID:
- Subtle date errors (1776 vs 1766)
- Errors that require specific knowledge
- Lies that sound possible
- Anything that would confuse an average adult

4 TRUTHS RULE:
Interesting, a little surprising, but not too hard.
The player should be able to easily verify each one mentally.

TEST BEFORE RETURNING: Would a 10-year-old immediately know which statement is the lie? If not, make the lie more obvious.`,


  2: `DIFFICULTY 2 — EASY:

GOAL: Most adults (70%) should get this right.
Requires a little thinking but not too much.

LIE RULE:
One incorrect piece of information that requires basic school-level knowledge.
One wrong detail that ALMOST sounds right but something is "off".
Wrong country for a famous invention, wrong decade for a famous event,
a number that is close to correct but isn't.

GOOD LIE EXAMPLES for difficulty 2:
- "Penicillin was discovered by Alexander Graham Bell in 1928."
  (wrong name — it was Fleming)
- "The Berlin Wall fell in 1991."
  (wrong year — it fell in 1989)
- "The Olympic Games were revived in 1906 in Athens."
  (wrong year — 1896)
- "The DNA structure was discovered by Watson, Crick and Einstein."
  (wrong name — Franklin, not Einstein)

4 TRUTHS RULE:
Must be surprising and educational.
The player should learn something new from each round.`,


  3: `DIFFICULTY 3 — SNEAKY:

GOAL: Half the players get it right (50%). Requires attention.

LIE RULE:
One specific detail is wrong in an otherwise believable statement.
The lie sounds completely plausible. Change: precise dates, specific names,
exact numbers, locations that are close to the correct ones.

The lie must be the same length and style as the truths.
Specific details (names, numbers, dates) make it convincing.
It must not be easily googleable in 5 seconds.

4 TRUTHS RULE:
Should be counterintuitive — things that sound false but are real.
The player should doubt the truths.`,


  4: `DIFFICULTY 4 — DEVIOUS:

GOAL: Fewer than 35% of players get it right. Serious challenge.

LIE RULE:
Exploit a popular misconception — something most people THINK is
true but isn't. The lie must be a "common myth" that circulates as truth.

EXAMPLES of popular misconceptions for the lie:
- "Goldfish have a 3-second memory" (MYTH — they remember for months)
- "Napoleon was exceptionally short" (MYTH — he was average height for his era)
- "Humans only use 10% of their brain" (MYTH — we use all of it)
- "The Great Wall of China is visible from space with the naked eye" (MYTH — it isn't)
- "Lightning never strikes the same place twice" (MYTH — it does)

4 TRUTHS RULE:
Must sound FAKE but be real.
The player must doubt every statement.`,


  5: `DIFFICULTY 5 — DIABOLICAL:

GOAL: Fewer than 15% of players get it right. Maximum confusion.

LIE RULE:
The lie MUST be the most normal, accessible, believable
statement of all five. The lie should sound like a textbook fact.

4 TRUTHS RULE:
ALL FOUR truths must sound like made-up nonsense.
The more bizarre, the better. The player must doubt everything.
The truths should be so strange that the player thinks:
"This CANNOT possibly be true."

PERFECT TRUTH EXAMPLES for difficulty 5:
- Octopuses have three hearts, two of which stop beating when they swim
- Cleopatra lived closer in time to the iPhone than to the Great Pyramid
- Wombats are the only animals that produce cube-shaped droppings
- On Saturn's moon Titan, liquid methane rains down instead of water
- Ant colonies can survive a nuclear blast`,

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
      {text:"Napoleon was once attacked by a horde of rabbits during a hunting party after the Treaty of Tilsit.",real:true},
      {text:"Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid.",real:true},
      {text:"The French army used over 600 Paris taxis to rush troops to the Battle of the Marne in 1914.",real:true},
      {text:"Ancient Romans built steam-powered door mechanisms that made temple doors appear to open by divine force.",real:true},
      {text:"The Eiffel Tower was built in Brussels in 1889 as a symbol of Belgium.",real:false},
    ]},
    science: { category:"science", difficulty:1, statements:[
      {text:"Honey never spoils — archaeologists have found 3,000-year-old edible honey in Egyptian tombs.",real:true},
      {text:"A teaspoon of neutron star material would weigh around 6 billion tons on Earth.",real:true},
      {text:"Bananas are mildly radioactive due to their potassium-40 content.",real:true},
      {text:"Hot water can freeze faster than cold water under certain conditions — the Mpemba effect — and is still not fully explained.",real:true},
      {text:"The Sun rises in the west and sets in the east, opposite to the direction of clock hands.",real:false},
    ]},
    animals: { category:"animals", difficulty:1, statements:[
      {text:"A group of flamingos is officially called a 'flamboyance'.",real:true},
      {text:"Octopuses have three hearts and blue blood.",real:true},
      {text:"Crows can recognize individual human faces and remember grudges for years.",real:true},
      {text:"The mimic octopus can imitate over 15 marine species including lionfish and sea snakes.",real:true},
      {text:"Elephants are the only animals that cannot jump due to their weight, but can fly short distances by flapping their ears.",real:false},
    ]},
    internet: { category:"internet", difficulty:1, statements:[
      {text:"The first YouTube video ever uploaded was called 'Me at the zoo' and lasts 18 seconds.",real:true},
      {text:"The original Space Jam website from 1996 is still live and unchanged.",real:true},
      {text:"Wikipedia has over 6.7 million articles in English alone.",real:true},
      {text:"The domain sex.com was sold in 2010 for $13 million — a record for a domain sale at the time.",real:true},
      {text:"Google was originally founded in Japan in 1995 under the name 'SearchMaster'.",real:false},
    ]},
    popculture: { category:"popculture", difficulty:1, statements:[
      {text:"Eminem can rap around 11 syllables per second at his fastest.",real:true},
      {text:"Squid Game became Netflix's most-watched series ever within just 28 days.",real:true},
      {text:"Billie Eilish recorded her debut album entirely in her childhood bedroom.",real:true},
      {text:"The score for the film Titanic was composed under extreme time pressure in just five days.",real:true},
      {text:"The Harry Potter books were originally written in Latin and only later translated into English.",real:false},
    ]},
  };
  return map[cat] || map.history;
}

// api/pre-generate.js — BLUFF v2 — Pre-generate cache rounds into Firestore
// Vercel cron: every 6h  →  1 round per (category × level) per mode
// Regular mode → bluff_cache; blitz mode → bluff_rounds_blitz
// Invoke with ?mode=blitz for the blitz pass.

import { SCHEMA } from "../src/config/schema.js";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FB_KEY        = process.env.FIREBASE_API_KEY;
const FB_PROJECT    = "molty-portal";
const COLLECTION_BY_MODE = {
  regular: "bluff_cache",
  blitz:   "bluff_rounds_blitz",
};

const CATS = [
  "history", "science", "medicine", "showbiz", "culture",
  "geography", "animals", "food", "technology", "life", "sports"
];
const LEVELS = [1,2,3,4,5];

// Variable subtopic counts per category — balances pool size to fix sports dominance
const SUBTOPICS_PRE = {
  history: [
    "Ancient Rome — emperors, legions, gladiators, fall of empire, surprising daily life facts",
    "Ancient Egypt — pharaohs, pyramids, mummification, Cleopatra, surprising engineering facts",
    "Ancient Greece — philosophers, Olympic origins, Alexander the Great, Sparta vs Athens, myths",
    "World War II — battles, leaders, turning points, resistance, surprising statistics and records",
    "World War I — trenches, new weapons, treaties, surprising records and causes",
    "Medieval Europe — castles, Black Death, Crusades, knights, feudal life, surprising everyday facts",
    "Renaissance — Da Vinci, Michelangelo, Florence, printing press, scientific revolution",
    "Napoleonic era — rise and fall, battles, exile, Code Napoléon, surprising personal facts",
    "Russian Revolution & USSR — Lenin, Stalin, Cold War origins, Gulag, surprising Soviet facts",
    "Cold War — nuclear close-calls, Berlin Wall, CIA/KGB, space race, surprising spy stories",
    "Ottoman Empire — sultans, conquests, cultural legacy, surprising Ottoman daily life facts",
    "Balkan history — Yugoslavia, WW1 trigger, Tito, Ottoman influence, Byzantine era, surprising facts",
    "Colonial era — European empires, scramble for Africa, India, surprising colonial records",
    "Industrial Revolution — steam, railways, child labor, inventions, surprising social changes",
    "Ancient civilizations — Mesopotamia, Indus Valley, Maya, Aztec, Inca, surprising achievements",
    "20th century leaders — Churchill, FDR, Gandhi, Mao, Mandela, surprising personal details",
  ],
  science: [
    "Physics — relativity, quantum, famous experiments, Einstein, surprising results",
    "Chemistry — elements, reactions, periodic table history, surprising compound facts",
    "Biology and evolution — DNA, Darwin, natural selection, surprising evolutionary facts",
    "Astronomy and space — planets, black holes, galaxies, Webb/Hubble discoveries, records",
    "Neuroscience — brain facts, memory, sleep, consciousness, surprising psychology experiments",
    "Genetics and CRISPR — heredity, cloning, surprising DNA findings",
    "Mathematics — famous theorems, Pi, infinity, unsolved problems, surprising number facts",
    "Earth sciences — plate tectonics, volcanism, earthquakes, weather, surprising geological facts",
    "Climate science — ice ages, ocean currents, extreme weather, surprising natural records",
    "Materials and inventions — glass, concrete, silicon, polymers, surprising origin stories",
    "Famous scientists — Newton, Curie, Tesla, Feynman, Hawking, surprising biographical facts",
    "Ocean and deep sea — Mariana Trench, bioluminescence, extremophiles, surprising aquatic facts",
  ],
  medicine: [
    "Pandemics — Black Death, Spanish Flu, HIV, COVID, surprising epidemic history",
    "Vaccine history — smallpox eradication, polio, mRNA, surprising medical milestones",
    "Human body oddities — records, anomalies, surprising anatomical facts",
    "Medical discoveries — penicillin, anesthesia, X-ray, ECG, CT, surprising origin stories",
    "Mental health history — asylums, Freud, antidepressants, surprising psychiatric facts",
    "Surgery milestones — first transplant, heart surgery, brain surgery, surprising records",
    "Antibiotics and resistance — Fleming, superbugs, surprising microbial facts",
    "Nutrition science — vitamins, deficiency diseases, diet fads, surprising food science",
    "Cancer research — chemotherapy, radiation, immunotherapy, surprising oncology facts",
    "Pharmacology — famous drugs origin stories, overdose records, surprising pharmaceutical facts",
  ],
  showbiz: [
    "Oscars and Academy Awards — upsets, records, snubs, iconic speeches, surprising Oscar facts",
    "Hollywood classics — golden age, iconic films, directors, surprising behind-the-scenes stories",
    "Music legends — Beatles, Elvis, Michael Jackson, Madonna, surprising career facts",
    "Rock and metal — Led Zeppelin, Queen, Rolling Stones, Metallica, surprising band facts",
    "Hip-hop history — early NY scene, Tupac, Biggie, Eminem, Kanye, surprising industry facts",
    "Pop music — Grammy records, streaming era, Taylor Swift, BTS, surprising chart records",
    "TV series — Sopranos, Breaking Bad, Game of Thrones, Stranger Things, surprising production facts",
    "Streaming era — Netflix originals, Disney+, surprising streaming industry facts",
    "Celebrity scandals — famous feuds, comebacks, iconic public moments, surprising celebrity facts",
    "Movie franchises — Star Wars, Marvel, Bond, LOTR, surprising franchise records",
    "Classical music — Beethoven, Mozart, Bach, Wagner, surprising composer anecdotes",
    "Eurovision and pop culture — winners, scandals, surprising Eurovision history facts",
  ],
  culture: [
    "Famous paintings — Mona Lisa, Starry Night, Guernica, surprising art auction records",
    "Literature — novels, authors (Shakespeare, Tolstoy, García Márquez, Murakami), surprising facts",
    "Architecture wonders — Eiffel, Colosseum, Sagrada Família, Petra, surprising construction facts",
    "Photography icons — famous photos, photographers, records, surprising image history",
    "Museums and heritage — Louvre, Met, Prado, UNESCO sites, surprising collection facts",
    "Poetry — Shakespeare, Rumi, Neruda, Whitman, surprising poetic history facts",
    "Religion history — world religions, sacred sites, surprising religious records",
    "Festivals — Carnival, Diwali, Holi, Oktoberfest, surprising celebration origins",
    "Language — most spoken, oldest, dying languages, surprising etymology",
    "Fashion history — jeans, suits, haute couture, surprising fashion records",
  ],
  geography: [
    "Countries of the world — smallest, largest, landlocked, unusual borders, surprising facts",
    "World capitals — unusual histories, landmark origins, surprising capital city facts",
    "Extreme places — deepest, highest, hottest, coldest, driest, surprising record locations",
    "Rivers and lakes — Nile, Amazon, Caspian, surprising freshwater facts",
    "Mountain ranges — Himalayas, Andes, Alps, surprising mountaineering records",
    "Deserts — Sahara, Gobi, Atacama, surprising desert life and records",
    "Islands — Madagascar, Iceland, Hawaii, surprising island history and biology",
    "Weather records — hurricanes, tornadoes, rainfall, snowfall, surprising extremes",
    "Cultural geography — surprising customs, regional differences, national identities",
  ],
  animals: [
    "Big cats — lions, tigers, leopards, cheetahs, surprising hunting facts",
    "Ocean life — whales, sharks, octopus, deep sea creatures, surprising aquatic facts",
    "Insects and spiders — records, social bees/ants, dangerous species, surprising facts",
    "Birds — flight records, intelligence, migration, surprising behavior",
    "Reptiles — snakes, lizards, crocodiles, Komodo, surprising reptile facts",
    "Amphibians — frogs, salamanders, poison records, surprising amphibian facts",
    "Primates — chimps, gorillas, orangutans, tool use, surprising ape behavior",
    "Extinct animals — dinosaurs, mammoths, dodos, megalodon, surprising prehistoric facts",
    "Unusual creatures — platypus, tardigrade, axolotl, surprising weird animal facts",
    "Domestic animals — dogs, cats, horses, surprising pet history and records",
  ],
  food: [
    "Cuisines of the world — Italian, Japanese, Indian, Mexican, surprising culinary history",
    "Coffee and tea — origin stories, records, rituals, surprising beverage facts",
    "Wine and spirits — regions, vintage records, surprising alcohol history",
    "Chocolate and sweets — Aztec origins, luxury brands, surprising confectionery facts",
    "Spices — pepper, saffron, cinnamon trade routes, surprising spice history",
    "Weird foods worldwide — durian, fermented shark, century egg, surprising delicacies",
    "Fast food history — McDonald's, KFC, Coca-Cola, surprising brand origins",
    "Cooking techniques — sous-vide, fermentation, molecular gastronomy, surprising kitchen science",
  ],
  technology: [
    "Computer history — ENIAC, Turing, Apple, Microsoft, surprising early-computing facts",
    "Internet and web — ARPANET, Berners-Lee, Google, surprising internet history",
    "Smartphones — iPhone, Android, surprising mobile industry facts",
    "AI and machine learning — deep learning, GPT, surprising AI milestones",
    "Space technology — Apollo, ISS, SpaceX, surprising space engineering facts",
    "Cars and transport — early automobiles, Tesla, surprising automotive history",
    "Inventions with unexpected origins — microwave, Velcro, Post-its, surprising invention stories",
    "Video game history — Atari, Nintendo, arcade era, surprising gaming industry facts",
  ],
  sports: [
    "Global football — Premier/La Liga/Serie A/Bundesliga records, iconic players, surprising transfer facts",
    "FIFA World Cup — tournament moments, upsets, top scorers, surprising World Cup records",
    "Grand Slam tennis — Wimbledon/US/Roland Garros/Australian; Federer, Nadal, Djokovic, Serena records",
    "Summer Olympics — world records, medal surprises, iconic athletes, surprising host city facts",
  ],
  life: [
    "Human body — heart, brain, skin, immune system, surprising physiological facts",
    "Psychology — memory tricks, cognitive biases, famous experiments, surprising behavior facts",
    "Sleep science — dreams, REM, sleep disorders, surprising sleep records",
    "Everyday physics — why sky is blue, mirrors, rainbows, surprising daily-life science",
    "Money and economy history — surprising currency facts, famous bankruptcies, economic records",
    "Inventions around the home — refrigerator, washing machine, surprising household tech history",
    "Transportation in daily life — subway, bicycle, elevator, surprising transit history",
    "Work and office culture — 9-5 origin, weekend history, surprising workplace facts",
  ],
};

// Keep backwards-compat keys for any lingering references
const CAT_DESCS = Object.fromEntries(Object.keys(SUBTOPICS_PRE).map(k => [k, null]));

function buildLevelRules({ truths, total }) {
  return {
    1: `LEVEL 1 — WARM-UP: The lie should be obvious to anyone with basic general knowledge.
        Use clearly wrong details: wrong country, obviously wrong date, implausible number.
        Example: "The Eiffel Tower was built in 1820" (wrong era is obvious).`,
    2: `LEVEL 2 — TRICKY: The lie sounds plausible but has one wrong specific detail.
        A curious person might catch it. About 60% of players should get it wrong.
        Example: Wrong by a factor of 2, or a plausible-sounding but wrong person.`,
    3: `LEVEL 3 — SNEAKY: Take a real fact structure and change ONE precise detail
        (a number, a name, a date) to make it false. The lie should fool most people on first read.
        True facts should also be surprising. About 50/50 correct.`,
    4: `LEVEL 4 — DEVIOUS: The lie exploits a common misconception — something most people THINK
        is true but isn't. The ${truths} true statements should sound counterintuitive or unbelievable.
        Most players will choose a true statement thinking it's the lie.`,
    5: `LEVEL 5 — DIABOLICAL: ALL ${truths} TRUE statements must be so bizarre, unexpected, and
        counterintuitive that they sound completely fabricated.
        The lie must be the most NORMAL-SOUNDING of the ${total} statements.
        This is maximum cognitive warfare. Players will doubt every true fact.`,
  };
}

// ── Build Claude prompt ──────────────────────────────────────
function buildPrompt(category, level, mode) {
  const schema = SCHEMA[mode] || SCHEMA.regular;
  const { total, truths, lies } = schema;
  const rules = buildLevelRules(schema)[level] || buildLevelRules(schema)[3];
  const subtopicList = SUBTOPICS_PRE[category];
  const catDesc = subtopicList
    ? `${category}. Sub-topic for this round: ${subtopicList[Math.floor(Math.random() * subtopicList.length)]}. Use specific names, dates, records, and surprising statistics.`
    : category;
  const truthEntries = Array(truths).fill(`    {"text": "...", "real": true}`).join(",\n");
  return `Generate a BLUFF game round. Category: ${catDesc}.

${rules}

Create EXACTLY ${total} statements: ${truths} TRUE + ${lies} FALSE.
Randomize which position (1–${total}) contains the lie — NOT always second.

Respond ONLY with valid JSON, no markdown fences:
{
  "statements": [
    {"text": "...", "real": false},
${truthEntries}
  ],
  "bluffExplanation": "One concise sentence: why the false statement is wrong."
}

STRICT RULES:
- Create exactly ${total} statements
- Exactly ${truths} TRUE — genuinely real, verifiable facts
- Exactly 1 CONVINCING LIE — same style as truths
- Lie must have specific details (names, numbers, dates)

LENGTH — CRITICAL:
- TARGET: 40-70 characters per statement
- HARD MAX: 90 characters. Never exceed.
- VARY length deliberately across statements in the round.
  Mix some ~30-char punchy ones with some ~80-char complex ones.
  Uniform length is dull and predictable. Variance creates rhythm.
- Cut filler. No "during a hunting party organized after signing..."
- No explanatory context. Trust the player's knowledge.

STYLE — HOOK PATTERN:
- Lead with the surprise. Never bury the lead.
- "Napoleon once lost a battle to rabbits." ✓ (40 chars)
- "Napoleon was attacked by a horde of rabbits during a hunting
   party organized after the Treaty of Tilsit." ✗ (buried, 110 chars)
- "Octopuses have three hearts and blue blood." ✓ (43)
- "Wombats produce cube-shaped droppings." ✓ (38)
- "A teaspoon of neutron star weighs 6 billion tons." ✓ (49)
- "Honey from Egyptian tombs is still edible." ✓ (42)

CONTENT:
- Counterintuitive > exhaustive
- Specific numbers where possible ("11 time zones", not "many")
- Make truths SURPRISING — reward curiosity
- Randomize lie position
- NEVER use profanity or explicit content`;
}

// ── Firestore PATCH ──────────────────────────────────────────
async function fsPatch(col, id, fields) {
  if (!FB_KEY) return;
  await fetch(
    `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents/${col}/${id}?key=${FB_KEY}`,
    {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fields }),
      signal:  AbortSignal.timeout(8000),
    }
  );
}

// ── Generate one round via Claude ────────────────────────────
async function generateOne(category, level, mode) {
  const schema = SCHEMA[mode] || SCHEMA.regular;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method:  "POST",
    headers: {
      "x-api-key":         ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages:   [{ role: "user", content: buildPrompt(category, level, mode) }],
    }),
    signal: AbortSignal.timeout(28000),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`AI ${resp.status}: ${t.slice(0, 80)}`);
  }

  const data   = await resp.json();
  const raw    = data.content?.[0]?.text || "";
  const match  = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON from AI");
  const parsed = JSON.parse(match[0]);

  if (!Array.isArray(parsed.statements) || parsed.statements.length !== schema.total)
    throw new Error(`Bad structure (expected ${schema.total} statements)`);
  if (!parsed.statements.some(s => s.real === false))
    throw new Error("No bluff in response");

  return {
    statements:       parsed.statements,
    bluffExplanation: parsed.bluffExplanation || "",
  };
}

// ── Store round in mode-specific Firestore collection ────────
async function storeInCache(category, level, round, mode) {
  const col = COLLECTION_BY_MODE[mode] || COLLECTION_BY_MODE.regular;
  const id = `${category}_${level}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  await fsPatch(col, id, {
    category:         { stringValue:  category },
    level:            { integerValue: String(level) },
    used:             { booleanValue: false },
    ts:               { stringValue:  new Date().toISOString() },
    bluffExplanation: { stringValue:  round.bluffExplanation || "" },
    statements: {
      arrayValue: {
        values: round.statements.map(s => ({
          mapValue: { fields: {
            text: { stringValue:  s.text },
            real: { booleanValue: s.real },
          }},
        })),
      },
    },
  });
}

// ── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  // Accept Vercel cron requests (x-vercel-cron: 1) or manual with token
  const isCron = req.headers["x-vercel-cron"] === "1";
  const token  = req.headers["x-admin-token"] || req.query.token || "";
  const secret = process.env.CRON_SECRET;
  if (!isCron && secret && token !== secret)
    return res.status(401).json({ error: "unauthorized" });
  if (!ANTHROPIC_KEY)
    return res.status(503).json({ error: "AI not configured" });
  if (!FB_KEY)
    return res.status(503).json({ error: "Firestore not configured" });

  const mode = req.query.mode === "blitz" ? "blitz" : "regular";

  // Build all 40 combos
  const combos = [];
  for (const cat of CATS) {
    for (const lvl of LEVELS) {
      combos.push({ category: cat, level: lvl });
    }
  }

  // Process in batches of 8 (Anthropic rate-limit safe)
  const BATCH_SIZE = 8;
  const results = { ok: 0, failed: 0, errors: [] };

  for (let i = 0; i < combos.length; i += BATCH_SIZE) {
    const batch = combos.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async ({ category, level }) => {
        try {
          const round = await generateOne(category, level, mode);
          await storeInCache(category, level, round, mode);
          results.ok++;
        } catch (e) {
          results.failed++;
          results.errors.push(`${category}:${level}: ${e.message}`);
        }
      })
    );
  }

  return res.status(200).json({
    mode,
    collection: COLLECTION_BY_MODE[mode],
    generated:  results.ok,
    failed:     results.failed,
    errors:     results.errors,
    timestamp:  new Date().toISOString(),
  });
}

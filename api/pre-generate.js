// api/pre-generate.js — BLUFF v2 — Pre-generate cache rounds into Firestore
// Vercel cron: every 6h  →  1 round per (category × level) = 40 rounds/run
// Stored in bluff_cache with used=false; generate-round.js pops them on demand

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const FB_KEY        = process.env.FIREBASE_API_KEY;
const FB_PROJECT    = "molty-portal";
const CACHE_COL     = "bluff_cache";

const CATS = ["history","science","animals","geography","food","technology","culture","sports"];
const LEVELS = [1,2,3,4,5];

// 12 sub-topics per category — randomly rotated to maximise pre-generated pool variety
const SUBTOPICS_PRE = {
  history: [
    "Ancient Rome — emperors, military campaigns, architecture, fall of the empire, surprising records",
    "Ancient Egypt — pharaohs, pyramids, religious rituals, dynasties, Cleopatra, surprising facts",
    "World War II — key battles, military leaders, turning points, resistance movements, statistics",
    "World War I — causes, trench warfare, key battles, treaties, new technology, surprising facts",
    "Medieval Europe — castles, Black Death, Crusades, feudal life, surprising everyday facts",
    "Ancient Greece — philosophers, city-states, Olympic origins, Alexander the Great, surprising facts",
    "The Renaissance — Da Vinci, Michelangelo, Florence, scientific revolution, surprising facts",
    "Age of Exploration — Columbus, Magellan, Vasco da Gama, surprising navigation and discovery facts",
    "The Cold War — arms race, space race, Berlin Wall, Cuba, espionage, surprising political facts",
    "Great Empires — British, Ottoman, Mongol; surprising size, power and decline facts",
    "Revolutions — French, American, Russian; surprising causes, key figures, and consequences",
    "Ancient Americas — Aztecs, Incas, Maya, Mesopotamia, surprising civilisation and architecture facts",
  ],
  science: [
    "Space and astronomy — planets, black holes, galaxies, NASA missions, cosmic scale records",
    "Human body — anatomy, biology, medical records, nervous and immune systems, surprising facts",
    "Physics — Newton, Einstein, quantum mechanics, relativity, surprising experimental results",
    "Chemistry — periodic table, elements, reactions, surprising compound and material science facts",
    "Evolution and genetics — DNA, Darwin, mutations, natural selection, surprising evolutionary facts",
    "Earth sciences — plate tectonics, volcanism, climate history, surprising geological facts",
    "Mathematics — famous theorems, unsolved problems, Pi, infinity, surprising number facts",
    "Neuroscience — brain capacity, memory, sleep science, surprising psychology and cognition facts",
    "Medicine and vaccines — plague history, antibiotic discovery, surgical milestones, surprising facts",
    "Ocean science — deep sea records, bioluminescence, ocean trenches, surprising underwater facts",
    "Famous inventions — Nobel Prize history, surprising origin stories behind major inventions",
    "Climate and natural phenomena — weather extremes, ecosystem records, surprising natural phenomena",
  ],
  animals: [
    "Big cats — lions, tigers, leopards, cheetahs; speed, territory, hunting strategies, surprising facts",
    "Ocean creatures — sharks, whales, octopuses, deep-sea animals, surprising marine abilities and records",
    "Birds — migration distances, exceptional intelligence, flight altitude records, surprising avian facts",
    "Insects and arachnids — ant colonies, bee navigation, spider silk, surprising survival abilities",
    "Mammals — elephants, dolphins, primates, bats; surprising intelligence and behavior facts",
    "Reptiles and amphibians — crocodiles, Komodo dragons, poison frogs, surprising survival facts",
    "Animal records — fastest, largest, smallest, longest-lived, most venomous on Earth",
    "Animal intelligence — tool use, problem-solving, mirror recognition, surprising cognition facts",
    "Prehistoric animals — dinosaurs, woolly mammoths, megafauna, surprising fossil and extinction facts",
    "Bizarre animals — tardigrades, mantis shrimp, axolotl, naked mole rat, surprising impossible facts",
    "Animal behavior — mating rituals, migration, hibernation, surprising social structures",
    "Endangered species — surprising conservation records, recovery stories, extinction cause facts",
  ],
  geography: [
    "Countries and national records — smallest nations, unusual territories, surprising sovereignty facts",
    "Mountains and extreme terrain — Everest, K2, Mariana Trench, surprising altitude records",
    "Rivers and lakes — Amazon, Nile, Yangtze, Baikal; length and depth records, surprising water facts",
    "Oceans and seas — Pacific, Atlantic, deepest trenches, surprising ocean geography and current facts",
    "Deserts and extreme climates — Sahara, Antarctica, Death Valley; temperature and climate records",
    "Islands and archipelagos — surprising island records, isolated nations, volcanic island formation",
    "Borders and geopolitical quirks — enclaves, exclaves, most borders shared, surprising facts",
    "Cities and megacities — most populated, oldest, highest-altitude cities, surprising urban facts",
    "Natural wonders — Grand Canyon, Great Barrier Reef, Northern Lights, surprising wonder facts",
    "Population and demographics — densely populated places, surprising migration and census facts",
    "Flags and national symbols — surprising flag design origins, anthem records, country name facts",
    "Continental extremes — surprising geographical records and boundary facts for each continent",
  ],
  food: [
    "Origins of iconic dishes — where pizza, pasta, sushi, burgers, croissants, tacos really come from",
    "Spices and condiments — history of pepper, salt trade, mustard, ketchup, Tabasco, surprising facts",
    "Fruits and vegetables — surprising botanical facts, unusual origins, world production records",
    "Alcohol and beverages — wine, beer, whiskey, coffee, tea; origins and surprising production facts",
    "Fast food industry — McDonald's, Coca-Cola, KFC; surprising founding stories, scale and culture facts",
    "Chocolate and confectionery — cacao origins, chocolate history, surprising sweet industry records",
    "World cuisines — surprising cultural origins and history behind famous traditional dishes",
    "Food records — most expensive ingredients, most produced foods globally, surprising calorie records",
    "Food science and myths — surprising debunked nutrition facts, food chemistry",
    "Agriculture and farming — crop domestication history, farming records, food production facts",
    "Food laws and regulations — surprising legal definitions, unusual bans worldwide",
    "Street food and culinary culture — surprising facts about food markets and culinary traditions",
  ],
  technology: [
    "History of computing — ENIAC, first transistors, Moore's Law, surprising computing milestone facts",
    "Internet and networking — ARPANET origins, TCP/IP, Wi-Fi, surprising infrastructure facts",
    "Smartphones and mobile — iPhone launch, Android, app store records, surprising adoption facts",
    "Artificial intelligence — Turing Test, machine learning milestones, surprising AI history facts",
    "Space technology — Sputnik, Apollo missions, ISS, surprising space engineering facts",
    "Famous tech companies — Apple, Microsoft, Google, IBM; surprising founding and growth stories",
    "Robotics and automation — surprising robot history, industrial automation, AI robotics records",
    "Video games and gaming hardware — Atari, Nintendo, PlayStation, Xbox; surprising gaming tech facts",
    "Inventions timeline — telegraph, telephone, radio, TV, internet; surprising invention history facts",
    "Semiconductor industry — silicon chips, CPU records, transistor counts, surprising chip facts",
    "Energy and power technology — electricity history, nuclear power, solar panels, surprising energy facts",
    "Medical technology — X-ray, MRI, pacemaker, CRISPR; surprising medical device history facts",
  ],
  culture: [
    "Famous paintings — Mona Lisa, Sistine Chapel, Starry Night, surprising art auction records",
    "Architecture wonders — Eiffel Tower, Colosseum, Taj Mahal, Sagrada Família, surprising construction facts",
    "Classical music — Beethoven, Mozart, Bach, Vivaldi; surprising composer life and musical records",
    "Literature and books — famous novels, banned books, publishing records, surprising author facts",
    "Fashion history — surprising origins of jeans, suits, high heels, luxury brands, iconic trends",
    "Religion and mythology — surprising facts about world religions, sacred texts, pilgrimage records",
    "Festivals and traditions — Carnival, Chinese New Year, Diwali, surprising global celebration facts",
    "Language and linguistics — most spoken languages, surprising etymology, dying languages, records",
    "Film history — silent films, Hollywood Golden Age, Oscar firsts, surprising cinema records",
    "Theatre and performing arts — Broadway, West End, ballet, surprising performance history facts",
    "Photography and visual media — camera invention history, iconic photographs, record images",
    "Museums and heritage — surprising facts about the world's greatest collections and UNESCO sites",
  ],
  sports: [
    "NBA basketball — championship records, iconic players (Jordan, LeBron, Kobe), records, draft history",
    "English Premier League — club records, top scorers, legendary managers (Ferguson, Wenger, Klopp, Guardiola)",
    "La Liga (Spain) — Real Madrid, Barcelona, El Clásico history, legends (Messi, Ronaldo, Zidane, Xavi)",
    "Serie A (Italy) — Juventus, AC Milan, Inter Milan; Scudetto records, icons (Del Piero, Maldini, Totti)",
    "Bundesliga (Germany) — Bayern Munich, Borussia Dortmund, records, Lewandowski, Müller, Neuer",
    "UEFA Champions League — finals, records, top scorers, iconic comebacks (Istanbul 2005, Barcelona 1999)",
    "FIFA World Cup — tournament records, top scorers, upsets, iconic players and moments",
    "Formula 1 — champions (Schumacher, Hamilton, Verstappen, Senna), constructor records, iconic races",
    "Grand Slam tennis — Wimbledon, US Open, Roland Garros, Australian Open; Federer, Nadal, Djokovic, Serena",
    "NFL American Football — Super Bowl records, all-time leaders, franchise history, iconic moments",
    "Summer Olympics — world records, medal table surprises, iconic athletes, host city facts",
    "Football transfer market — world record fees, most expensive signings, surprising valuations",
  ],
};

// Keep backwards-compat keys for any lingering references
const CAT_DESCS = Object.fromEntries(Object.keys(SUBTOPICS_PRE).map(k => [k, null]));

const LEVEL_RULES = {
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
      is true but isn't. The 4 true statements should sound counterintuitive or unbelievable.
      Most players will choose a true statement thinking it's the lie.`,
  5: `LEVEL 5 — DIABOLICAL: ALL 4 TRUE statements must be so bizarre, unexpected, and
      counterintuitive that they sound completely fabricated.
      The lie must be the most NORMAL-SOUNDING statement of the five.
      This is maximum cognitive warfare. Players will doubt every true fact.`,
};

// ── Build Claude prompt ──────────────────────────────────────
function buildPrompt(category, level) {
  const rules = LEVEL_RULES[level] || LEVEL_RULES[3];
  const subtopicList = SUBTOPICS_PRE[category];
  const catDesc = subtopicList
    ? `${category}. Sub-topic for this round: ${subtopicList[Math.floor(Math.random() * subtopicList.length)]}. Use specific names, dates, records, and surprising statistics.`
    : category;
  return `Generate a BLUFF game round. Category: ${catDesc}.

${rules}

Create EXACTLY 5 statements: 4 TRUE + 1 FALSE.
Randomize which position (1–5) contains the lie — NOT always second.

Respond ONLY with valid JSON, no markdown fences:
{
  "statements": [
    {"text": "...", "real": true},
    {"text": "...", "real": false},
    {"text": "...", "real": true},
    {"text": "...", "real": true},
    {"text": "...", "real": true}
  ],
  "bluffExplanation": "One concise sentence: why the false statement is wrong."
}

Rules:
- Each statement: 1-2 sentences, specific (names, numbers, dates)
- No "Did you know" or "Interestingly" openers
- The false statement must SOUND completely plausible
- Never use profanity or vulgar language`;
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
async function generateOne(category, level) {
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
      messages:   [{ role: "user", content: buildPrompt(category, level) }],
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

  if (!Array.isArray(parsed.statements) || parsed.statements.length !== 5)
    throw new Error("Bad structure");
  if (!parsed.statements.some(s => s.real === false))
    throw new Error("No bluff in response");

  return {
    statements:       parsed.statements,
    bluffExplanation: parsed.bluffExplanation || "",
  };
}

// ── Store round in bluff_cache ───────────────────────────────
async function storeInCache(category, level, round) {
  const id = `cache_${category}_${level}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
  await fsPatch(CACHE_COL, id, {
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
          const round = await generateOne(category, level);
          await storeInCache(category, level, round);
          results.ok++;
        } catch (e) {
          results.failed++;
          results.errors.push(`${category}:${level}: ${e.message}`);
        }
      })
    );
  }

  return res.status(200).json({
    generated: results.ok,
    failed:    results.failed,
    errors:    results.errors,
    timestamp: new Date().toISOString(),
  });
}

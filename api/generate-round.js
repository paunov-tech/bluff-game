// api/generate-round.js
import Anthropic from "@anthropic-ai/sdk";
import { kv } from "@vercel/kv";
import { SCHEMA } from "../src/config/schema.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() }); // trim: env value may carry a trailing newline

const CORS = (process.env.PRODUCT_DOMAIN || "playbluff.games,www.playbluff.games")
  .split(",").map(d => `https://${d.trim()}`);

const FB_KEY     = process.env.FIREBASE_API_KEY?.trim(); // trim: env value may carry a trailing newline
const FB_PROJECT = "molty-portal";
const FB_URL     = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;

const LANG_NAMES = {
  en:"English", de:"German", sr:"Serbian", fr:"French",
  es:"Spanish", hr:"Croatian", sl:"Slovenian", bs:"Bosnian",
};

// Overused facts the model must never reuse — keeps live-gen genuinely fresh.
const BANNED_FACTS = [
  // Overused classics
  "Cleopatra and Moon landing", "Napoleon rabbit attack",
  "octopus hearts", "banana radioactive", "honey never spoils",
  "Mpemba effect", "goldfish memory", "flamingo flamboyance",
  "crow grudges", "mimic octopus", "neutron star teaspoon",
  "Jupiter diamond", "Queen Victoria Urdu", "dolphin stereo dreaming",
  "Great Wall of China visible from space", "we only use 10% of brain",
  "lightning never strikes twice", "swallow before sleeping",
  "bulls hate red color", "Everest tallest mountain",
  // ExYU overused
  "Tesla invented electricity", "Djokovic GOAT",
];

// Ex-Yugoslav region guidance — injected into the prompt for exyu* categories.
const EXYU_RULES = `
CATEGORY: Ex-Yugoslav Region (Serbia, Croatia, Slovenia, Bosnia, Montenegro, North Macedonia, Kosovo)

REQUIRED CONTENT — each ExYU round must include statements from these areas:
- Sports legends: Đoković, Pančev, Prosinečki, Stojković, Savićević, Vlado Divac, Sabonis (Slovene-adjacent), Iva Majoli, Arantxa-era rivalries
- Music & culture: Turbofolk, Lepa Brena, Bijelo Dugme, Ekatarina Velika, No Smoking Orchestra, EXIT festival, Balašević
- History (surprising, not textbook): SFRY oddities, Tito facts, Yugoslav space program, Non-Aligned Movement trivia, partisans facts
- Cinema & art: Kusturica, Makavejev, Yugoslav Black Wave, Šijan, Goran Bregović
- Science & invention: Tesla (real obscure facts, not the overused ones), Mileva Marić, Mihajlo Pupin
- Geography oddities: Adriatic secrets, Dinaric Alps records, Neretva, Sava, Danube facts
- Yugoslav Wars: factual, specific, not politicized
- Food & tradition: ćevapi origins, rakija facts, burek debate, ajvar

DIFFICULTY ADAPTATION for ExYU:
- Level 1-2: Obvious local facts, regional pride questions
- Level 3-4: Details only fans of the region know — wrong statistics, twisted attributions
- Level 5: Truths so bizarre about the region that even locals will doubt them`;

const DIFFICULTY_RULES = {

  0: `DIFFICULTY 0 — BABY MODE (Round 1 only):

GOAL: The player MUST win immediately. This is a dopamine hit,
not a challenge. If the player gets this wrong, they will quit.

LIE RULE:
The lie must be something EVERY 6-YEAR-OLD KNOWS is false.
So obviously absurd that the player laughs out loud.
It must be 100% impossible, not just unlikely.
ZERO subtlety. ZERO tricks. Maximum obviousness.

GOOD LIE EXAMPLES for difficulty 0:
- "The Earth orbits the Moon"
- "The Eiffel Tower is located in Berlin"
- "Humans have 4 legs"
- "Water is made of fire and air"
- "The Sun rises in the west"
- "Cows can fly naturally"
- "China is located in Europe"
- "Napoleon was American"
- "The sky is green"
- "Fish live on trees"

4 TRUTHS RULE:
Must be BRILLIANT, UNBELIEVABLE, FASCINATING — but easy to believe.
Player must think "WOW, really?!" for each one.
This is the reward for playing — they learn something amazing.
Truths must be CLEAR and SIMPLE — do NOT use counterintuitive facts
that could be mistaken for the lie. Each truth must sound 100% believable.

GOOD TRUTH EXAMPLES for difficulty 0:
- Octopuses have three hearts and blue blood
- Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid
- Honey never spoils — 3000-year-old edible honey was found in Egyptian tombs
- A group of flamingos is called a "flamboyance"

FORMAT: The lie must be SO OBVIOUSLY WRONG that it stands out immediately.
The player should identify it in under 3 seconds.

TEST BEFORE RETURNING: Would a 6-year-old immediately know which statement is the lie?
If there is ANY doubt at all, make the lie even more ridiculous and obvious.`,


  1: `WARM-UP (Level 1):
The lie is obvious — wrong country, wrong decade, obviously incorrect number.
Truths are feel-good "wow, I didn't know that!" facts. Player should feel smart.
Emotional target: "Easy! I got it!" — confidence builder.`,

  2: `TRICKY (Level 2):
The lie sounds plausible but ONE detail is clearly wrong if you know the field.
Wrong year by a lot, wrong country for a famous thing, off by a large factor.
Truths should make the player say "wait, really?"
Emotional target: slight uncertainty, then satisfaction.`,

  3: `SNEAKY (Level 3):
The lie is structurally a real-looking fact but ONE specific detail is wrong.
Same category, right ballpark, wrong number/name/date by a small amount.
Truths sound surprising but are 100% real. Player genuinely hesitates.
Emotional target: "I'm not sure... I'll go with my gut."`,

  4: `DEVIOUS (Level 4):
The lie IS something most people confidently believe is true — a common misconception.
The 4 truths sound fake, impossible, or ridiculous — but are verified facts.
Players who "know things" are most vulnerable here.
Emotional target: "That can't be true... wait, is it?"`,

  5: `DIABOLICAL (Level 5):
ALL 4 truths must be so bizarre, counterintuitive, or absurd that they seem like obvious lies.
The ONE lie must be the most normal-sounding, mundane, "of course that's true" statement.
The lie hides in plain sight among impossible-sounding truths.
Emotional target: complete confusion, humility, "I have no idea."`,

};

// 12 sub-topics per category — randomly rotated each round to maximize pool variety
const SUBTOPICS = {

  history: [
    "Ancient Rome — emperors, military campaigns, architecture, fall of the empire, daily life, surprising records",
    "Ancient Egypt — pharaohs, pyramids, religious rituals, dynasties, Cleopatra, hieroglyphics, surprising facts",
    "World War II — key battles, military leaders, turning points, resistance movements, surprising statistics",
    "World War I — causes, trench warfare, key battles, treaties, new technology, surprising facts",
    "Medieval Europe — castles, Black Death, Crusades, feudal life, surprising everyday and court life facts",
    "Ancient Greece — philosophers, city-states, Olympic origins, Alexander the Great, surprising cultural facts",
    "The Renaissance — Da Vinci, Michelangelo, Florence, scientific revolution, patronage, surprising facts",
    "Age of Exploration — Columbus, Magellan, Vasco da Gama, surprising navigation and conquest facts",
    "The Cold War — arms race, space race, Berlin Wall, Cuba, espionage, surprising political facts",
    "Great Empires — British Empire, Ottoman Empire, Mongol Empire, surprising size, power and decline facts",
    "Revolutions — French, American, Russian; surprising causes, key figures, and lasting consequences",
    "Ancient Americas — Aztecs, Incas, Maya, Mesopotamia, surprising civilisation and architecture facts",
  ],

  science: [
    "Space and astronomy — planets, black holes, galaxies, NASA missions, cosmic scale records, surprising facts",
    "Human body — anatomy, biology, medical records, nervous and immune systems, surprising physiological facts",
    "Physics — Newton, Einstein, quantum mechanics, relativity, surprising experimental and theoretical results",
    "Chemistry — periodic table, elements, chemical reactions, surprising compound and material science facts",
    "Evolution and genetics — DNA structure, Darwin, natural selection, mutations, surprising evolutionary facts",
    "Earth sciences — plate tectonics, volcanic records, climate history, ice ages, surprising geological facts",
    "Mathematics — Euler, Pythagoras, unsolved problems, Pi, infinity, surprising number and pattern facts",
    "Neuroscience — brain capacity, memory, sleep science, cognitive research, surprising psychology facts",
    "Medicine and vaccines — plague history, antibiotic discovery, surgical milestones, surprising health facts",
    "Ocean science — deep sea records, bioluminescence, ocean trenches, surprising underwater world facts",
    "Famous inventions — Nobel Prize history, surprising origin stories behind world-changing inventions",
    "Climate and natural phenomena — weather extremes, ecosystem records, surprising natural world phenomena",
  ],

  animals: [
    "Big cats — lions, tigers, leopards, cheetahs, jaguars; speed, territory, hunting strategies, surprising facts",
    "Ocean creatures — sharks, blue whales, octopuses, anglerfish, surprising deep-sea abilities and records",
    "Birds — migration distances, exceptional intelligence, flight altitude records, extinct species, surprising facts",
    "Insects and arachnids — ant colony structures, bee navigation, spider silk strength, surprising abilities",
    "Mammals — elephants, dolphins, primates, platypus, bats; surprising intelligence and behavior facts",
    "Reptiles and amphibians — crocodiles, Komodo dragons, poison dart frogs, surprising survival facts",
    "Animal records — fastest, largest, smallest, longest-lived, most venomous — record-breaking creature facts",
    "Animal intelligence — tool use, problem-solving, mirror recognition, language, surprising cognition facts",
    "Prehistoric animals — dinosaurs, woolly mammoths, saber-tooths, surprising fossil and extinction facts",
    "Bizarre animals — tardigrades, mantis shrimp, axolotl, naked mole rat, surprising impossible-sounding facts",
    "Animal behavior — mating rituals, migration, hibernation, surprising social structures and cooperation",
    "Endangered species — surprising recovery stories, conservation records, and extinction cause facts",
  ],

  geography: [
    "Countries and national records — smallest nations, most unusual territories, surprising sovereignty facts",
    "Mountains and extreme terrain — Everest, K2, Mariana Trench, surprising altitude and exploration records",
    "Rivers and lakes — Amazon, Nile, Yangtze, Congo, Baikal; length and depth records, surprising water facts",
    "Oceans and seas — Pacific, Atlantic, deepest trenches, ocean current facts, surprising marine geography",
    "Deserts and extreme climates — Sahara, Antarctica, Death Valley; temperature and precipitation records",
    "Islands and archipelagos — surprising island records, isolated island nations, volcanic island formation",
    "Borders and geopolitical quirks — enclaves, exclaves, most borders shared, surprising border history facts",
    "Cities and megacities — most populated, oldest, highest-altitude cities, surprising urban geography facts",
    "Natural wonders — Grand Canyon, Great Barrier Reef, Northern Lights, surprising natural wonder facts",
    "Population and demographics — most densely populated places, surprising migration and census facts",
    "Flags and national symbols — surprising flag design origins, anthem records, country name etymology",
    "Continental extremes — surprising geographical records and boundary facts for each continent",
  ],

  food: [
    "Origins of iconic dishes — where pizza, pasta, sushi, burgers, croissants, tacos really come from",
    "Spices and condiments — history of black pepper, salt trade, mustard, ketchup, Tabasco, surprising facts",
    "Fruits and vegetables — surprising botanical classifications, unusual origins, world production records",
    "Alcohol and beverages — wine, beer, whiskey, coffee, tea; origin stories and surprising production facts",
    "Fast food industry — McDonald's, Coca-Cola, KFC; surprising founding stories, cultural impact, scale facts",
    "Chocolate and confectionery — cacao origins, Swiss chocolate history, surprising sweet industry records",
    "World cuisines and national dishes — surprising cultural origins and history behind famous traditional foods",
    "Food records and extremes — most expensive ingredients (saffron, truffle, wagyu), most produced foods globally",
    "Food science and nutrition myths — surprising debunked health facts, how food actually works in the body",
    "Agriculture and farming — surprising crop domestication history, world farming records, food production facts",
    "Food laws and regulations — surprising legal food definitions, unusual bans and restrictions worldwide",
    "Street food and culinary culture — surprising facts about food markets, culinary traditions, and food history",
  ],

  culture: [
    "Famous paintings and art history — Mona Lisa, Sistine Chapel, Starry Night, surprising art auction records",
    "Architecture wonders — Eiffel Tower, Colosseum, Taj Mahal, Sagrada Família, surprising construction facts",
    "Classical music — Beethoven, Mozart, Bach, Vivaldi; surprising composer life stories and musical records",
    "Literature and books — surprising facts about famous novels, banned books, publishing records, author lives",
    "Fashion history — surprising origins of jeans, suits, high heels, luxury brands, and iconic fashion trends",
    "Religion and world mythology — surprising facts about world religions, sacred texts, pilgrimage records",
    "Festivals and traditions — Carnival, Chinese New Year, Diwali, surprising global celebration history facts",
    "Language and linguistics — most spoken languages, surprising etymology, dying languages, linguistic records",
    "Film history — silent films, Hollywood Golden Age, Oscar firsts, surprising cinema records and failures",
    "Theatre and performing arts — Broadway, West End, ballet origins, surprising performance history facts",
    "Photography and visual media — surprising camera invention history, iconic photographs, record images",
    "Museums and heritage — surprising facts about the world's greatest collections and UNESCO sites",
  ],

  internet: [
    "Social media records — Instagram, TikTok, Twitter/X, YouTube; surprising follower, view, and usage stats",
    "Gaming — most played games, esports prize pools, game dev history, surprising video game facts",
    "History of the internet — ARPANET, first websites, email origins, surprising internet milestone facts",
    "Viral moments and memes — most viewed videos ever, famous internet phenomena, how content spreads",
    "Tech giants — Apple, Google, Meta, Amazon, Microsoft; surprising founding stories and growth milestones",
    "Cybersecurity and famous hacks — largest data breaches, surprising facts about digital security history",
    "Streaming platforms — Netflix, Spotify, YouTube; surprising subscriber stats, content budgets, record data",
    "Artificial intelligence milestones — ChatGPT, AlphaGo, DeepMind, surprising AI development timeline facts",
    "Cryptocurrency and blockchain — Bitcoin origins, surprising crypto market records and adoption facts",
    "E-commerce — Amazon, Alibaba, eBay; surprising shopping statistics, record sales days, delivery records",
    "Mobile apps and smartphones — most downloaded apps ever, smartphone adoption speed, surprising app facts",
    "Internet infrastructure — undersea cables, data centers, DNS system, surprising technical scale facts",
  ],

  popculture: [
    "Music industry records — best-selling albums and artists of all time, surprising chart history facts",
    "Hollywood blockbusters — highest-grossing films ever, production budgets, surprising box office records",
    "Streaming industry — Netflix, Disney+, HBO Max; surprising content budgets, cancellations, and records",
    "Animated films and franchises — Disney, Pixar, Studio Ghibli, anime; surprising production and record facts",
    "Music awards and ceremonies — Grammy, Oscars, MTV VMAs, Brit Awards; surprising historical award facts",
    "Superhero franchises — Marvel MCU, DC Universe; surprising production costs, box office, casting facts",
    "K-pop and global music phenomena — BTS, Blackpink, surprising global reach and streaming record facts",
    "Classic TV shows — Friends, Game of Thrones, Breaking Bad, Seinfeld; surprising production and cast facts",
    "Celebrity culture — surprising facts about famous celebrities' careers, earnings, and record-breaking moments",
    "Fashion and luxury brands — Met Gala, Chanel, Gucci, Louis Vuitton; surprising fashion industry facts",
    "Reality TV — Survivor, Big Brother, Idol, The Voice; surprising global format origins and viewership facts",
    "Video game culture — best-selling games ever, esports rise, gaming celebrities, surprising history facts",
  ],

  sports: [
    "NBA ALL STARS & LEGENDS — Michael Jordan's 6 Finals MVPs, LeBron James all-time scoring record, Wilt Chamberlain's 100-point game, Kobe Bryant's 81-point night, Magic vs Bird rivalry, Shaq's dominance, Stephen Curry's 3-point revolution, shocking draft facts, surprising salary and contract records",
    "NBA DYNASTIES & DRAMA — Chicago Bulls 72-win season, Golden State Warriors 73 wins, LeBron's Cleveland comeback from 3-1, Russell Westbrook triple-double record, Kevin Durant controversies, trade deadline shocks, franchise relocations, surprising ownership facts",
    "PREMIER LEAGUE LEGENDS — Thierry Henry's Invincibles season, Wayne Rooney goal records, Alan Shearer's 260 goals, Eric Cantona's genius and controversies, Peter Schmeichel's saves, surprising transfer fees that shocked the world, manager sackings and records",
    "PREMIER LEAGUE DRAMA & RECORDS — Sergio Aguero's 93:20 moment, Leicester City 5000-1 title, Erling Haaland's debut season record, Manchester City 100 points, Liverpool Istanbul comeback, Arsenal going unbeaten, surprising ownership and financial facts",
    "LA LIGA ALL STARS — Messi's 91 goals in a calendar year, Ronaldo's Real Madrid records, Zidane's Champions League treble as manager, Xavi and Iniesta's tiki-taka dominance, Raul's legend status, surprising El Clásico facts and records",
    "LA LIGA DRAMA — Real Madrid's 14 Champions League titles, Barcelona's financial collapse, Atletico Madrid's surprising title wins, Galactico era spending records, shocking player departures (Messi, Ronaldo, Neymar), surprising stadium facts",
    "BUNDESLIGA MASTERS — Bayern Munich's 11 consecutive titles, Robert Lewandowski's 41-goal season breaking Gerd Müller's record, Borussia Dortmund's yellow wall with 81,365 fans, Thomas Müller's 'Raumdeuter' concept, shocking transfer departures",
    "CHAMPIONS LEAGUE GREATEST MOMENTS — Istanbul 2005 Liverpool comeback, Manchester United 1999 Treble, Barcelona 6-1 vs PSG, Real Madrid's 4 titles in 5 years, Zidane's Hampden volley, Ronaldo vs Messi Champions League stats, surprising final host city facts",
    "FIFA WORLD CUP SHOCKS & RECORDS — Germany 7-1 Brazil 2014, Cameroon 1990 surprise, Maradona's Hand of God and Goal of the Century, Ronaldo's hat-trick at 33, surprising host country bidding facts, most goals in a single tournament, shocking early exits",
    "FORMULA 1 LEGENDS — Michael Schumacher's 7 titles, Ayrton Senna's genius and Monaco records, Lewis Hamilton breaking every record, Max Verstappen youngest champion, surprising engine failure moments, constructor championship facts, fastest pit stop records",
    "TENNIS GRAND SLAM WARS — Federer vs Nadal vs Djokovic Grand Slam count race, Serena Williams' 23 Slams, Wimbledon's longest match (11 hours), surprising prize money history, Rafael Nadal's 14 French Open titles, shocking upsets and retirements",
    "SPORTS MONEY & TRANSFERS — Neymar's world record €222M PSG move, Kylian Mbappe's contract drama, Cristiano Ronaldo's total career earnings, LeBron James becoming first active billionaire athlete, most expensive football club purchases, shocking agent fees",
  ],

  nba: [
    "NBA scoring legends — Wilt Chamberlain's 100 points, LeBron's all-time record, Kobe's 81, Jordan's 63 playoff points, surprising career totals",
    "NBA draft shocks — Michael Jordan picked 3rd, Kobe traded on draft night, Sam Bowie over Jordan, Nikola Jokic picked 41st, surprising late picks who became legends",
    "NBA Finals drama — LeBron's 3-1 comeback with Cleveland, Warriors dynasty, Dirk Nowitzki's 2011 Finals, surprising MVP choices and sweep records",
    "NBA contract and salary records — first billion-dollar active athlete (LeBron), max contract history, surprising team payroll facts",
    "NBA records that may never be broken — Wilt's 50.4 PPG season, Oscar Robertson's triple-double season, surprising durability and streak records",
  ],

  premier_league: [
    "Premier League title races — Manchester City's Aguero moment, Leicester 5000-1, Arsenal Invincibles, Liverpool's 30-year wait ended, surprising final-day drama",
    "Premier League transfers and fees — record signings, surprising bargain buys who became legends, most expensive flops, surprising free transfer masterstrokes",
    "Premier League managers — Sir Alex Ferguson's 26 years, Arsene Wenger's revolution, Klopp vs Guardiola rivalry, surprising sacking timing records",
    "Premier League goal records — Alan Shearer 260, Thierry Henry's season record broken by Haaland, surprising own goal and hat-trick facts",
    "Premier League clubs history — founding dates, name changes, ground moves, surprising ownership takeover facts",
  ],

  bundesliga: [
    "Bayern Munich dominance records — 11 consecutive titles, surprising seasons they DIDN'T win, Champions League trebles, transfer records",
    "Borussia Dortmund — Yellow Wall record crowds, Robert Lewandowski's departure to rivals, surprising young talents developed",
    "Bundesliga goal records — Gerd Müller's record stood 49 years until Lewandowski, surprising top scorer history",
    "Bundesliga financial model — 50+1 ownership rule, surprising wage structure compared to Premier League",
    "German football national team — World Cup records, 7-1 Brazil humiliation, surprising squad selection controversies",
  ],

  exyu: [
    "ExYU football — Red Star Belgrade's 1991 European Cup, Dejan Savićević, Robert Prosinečki, Darko Pančev's Golden Boot, Dragan Stojković, surprising Yugoslav national team facts",
    "ExYU sport beyond football — Vlade Divac and the Yugoslav NBA wave, Dražen Petrović, Iva Majoli's 1997 Roland Garros, Yugoslav basketball and water polo dominance",
    "Yugoslav rock — Bijelo Dugme, Ekatarina Velika, Riblja Čorba, Azra, the Yugoslav new wave, surprising music history facts",
    "Turbofolk and pop — Lepa Brena's stadium fame, the rise of turbofolk, EXIT festival's origins in Novi Sad, Balašević, surprising entertainment facts",
    "SFR Yugoslavia oddities — the Non-Aligned Movement, workers' self-management, the powerful red passport, surprising everyday-life facts",
    "Tito's Yugoslavia — the personality cult, the 1948 Tito–Stalin split, the Brijuni islands, surprising political and personal facts",
    "Yugoslav cinema — Emir Kusturica's two Palme d'Or wins, the Black Wave, Dušan Makavejev, partisan epics, surprising film-industry facts",
    "Tesla & ExYU science — Nikola Tesla's lesser-known inventions, Mihajlo Pupin, Mileva Marić, Ruđer Bošković, surprising scientific facts",
    "Adriatic & Dinaric geography — Croatia's 1,000+ islands, the Dinaric Alps, the Neretva and Sava rivers, surprising geography records",
    "Yugoslav Wars — factual and specific: the breakup timeline, the siege of Sarajevo, the Dayton Agreement, surprising non-politicized details",
    "ExYU food & tradition — the eternal burek debate, ćevapi origins, rakija varieties, ajvar and kajmak, surprising culinary history",
    "ExYU surprising records — unusual regional firsts, world records held by the region, and bizarre-but-true ExYU facts",
  ],

};

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < Math.min(str.length, 50); i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return String(Math.abs(h));
}

const DEDUP_WINDOW = { sports: 150, default: 120 };

async function getUsedFacts(category, lang) {
  try {
    const window = DEDUP_WINDOW[category] ?? DEDUP_WINDOW.default;
    const key = `bluff:used:${category}:${lang}`;
    const used = await kv.lrange(key, 0, window - 1);
    return used || [];
  } catch { return []; }
}

async function saveUsedFacts(category, lang, statements) {
  try {
    const window = DEDUP_WINDOW[category] ?? DEDUP_WINDOW.default;
    const key = `bluff:used:${category}:${lang}`;
    const hashes = statements.map(s => simpleHash(s.text));
    if (hashes.length > 0) {
      await kv.lpush(key, ...hashes);
      await kv.ltrim(key, 0, window - 1);
    }
  } catch { /* non-critical */ }
}

const RL_MAX = 200;
const RL_WINDOW = 3600;

async function rateLimitOk(ip) {
  try {
    const key = `rl:gen:${ip}`;
    const count = await kv.incr(key);
    if (count === 1) await kv.expire(key, RL_WINDOW);
    return count <= RL_MAX;
  } catch { return true; }
}

// Fetch the user's last ~20 seenSummaries for the current mode. Feeds into
// Claude as an "avoid these topics" hint so live-gen produces genuinely fresh
// content rather than quietly cycling through the same topic space.
async function fetchAvoidSummaries(userId, modeKey) {
  if (!userId || !FB_KEY) return [];
  try {
    const r = await fetch(
      `${FB_URL}/bluff_seen/${encodeURIComponent(userId)}?key=${FB_KEY}&mask.fieldPaths=seenSummaries`,
      { signal: AbortSignal.timeout(3500) }
    );
    if (!r.ok) return [];
    const doc = await r.json();
    const modeMap = doc?.fields?.seenSummaries?.mapValue?.fields?.[modeKey]?.mapValue?.fields;
    if (!modeMap) return [];
    const values = [];
    for (const v of Object.values(modeMap)) {
      if (v?.stringValue) values.push(v.stringValue);
    }
    return values.slice(-20);
  } catch { return []; }
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  res.setHeader("Access-Control-Allow-Origin",  CORS.includes(origin) ? origin : (CORS[0] || "*"));
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const clientIp = (req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
  if (!(await rateLimitOk(clientIp)))
    return res.status(429).json({ error: "Too many rounds, slow down" });

  const { category = "history", difficulty = 3, lang = "en", mode = "regular", userId = "" } = req.body;
  const schema = SCHEMA[mode] || SCHEMA.regular;
  const isBlitz = mode === "blitz";
  // bluff_seen tracks solo/blitz separately — blitz is always live-gen, solo
  // usually cache-served (EN) but falls through to live for non-EN.
  const seenModeKey = isBlitz ? "blitz" : "solo";
  const stmtCount = schema.total;
  const truthCount = schema.truths;
  const diffRules = DIFFICULTY_RULES[difficulty] ?? DIFFICULTY_RULES[3];
  const isExYU = category === "exyu" || category === "exyu_sport"
    || category === "exyu_music" || category === "exyu_history";
  const subtopics = SUBTOPICS[category] || (isExYU ? SUBTOPICS.exyu : undefined);
  const catHint = subtopics
    ? `Sub-topic for this round: ${subtopics[Math.floor(Math.random() * subtopics.length)]}. Use specific names, dates, records, and surprising statistics. Generate facts that genuinely reward curiosity.`
    : "Interesting surprising facts from this topic.";
  const exyuContext = isExYU ? `\n${EXYU_RULES}\n` : "";
  const bannedNote = `\nNEVER reuse these overused/banned facts: ${BANNED_FACTS.slice(0, 14).join(", ")}.`;
  const langName = LANG_NAMES[lang] || "English";

  const langNote = lang === "en"
    ? "Write all statements in English."
    : `Write ALL statements in ${langName}. Rephrase naturally for native speakers — do NOT translate literally. Use natural phrasing, idioms, and cultural references appropriate for ${langName} speakers. The facts must still be internationally accurate.`;

  const [usedHashes, avoidSummaries] = await Promise.all([
    getUsedFacts(category, lang),
    fetchAvoidSummaries(userId, seenModeKey),
  ]);
  const dedupNote = usedHashes.length > 0
    ? `\nIMPORTANT — AVOID REPETITION: You have already used ${usedHashes.length} fact combinations in this category. Generate FRESH facts and topics not recently used. Vary your subjects widely.`
    : "";
  const avoidHint = avoidSummaries.length > 0
    ? `\n\nAVOID these topics the user has seen recently (generate genuinely different content):\n- ${avoidSummaries.join("\n- ")}`
    : "";

  const extraTruthExamples = Array(truthCount - 1)
    .fill(`    {"text": "Another true fact.", "real": true}`)
    .join(",\n");
  const surpriseMin = Math.max(1, Math.ceil(truthCount / 2));
  const blitzNote = isBlitz
    ? `\nBLITZ MODE: Generate exactly ${truthCount} truths + 1 lie (${stmtCount} statements total). Shorter round, same quality bar.\n`
    : "";

  const prompt = `Generate one BLUFF round for BLUFF™ by SIAL Games.

Category: ${category}
Language: ${lang}
Difficulty: ${difficulty}/5

${DIFFICULTY_RULES[difficulty]}

RULES FOR THE ${truthCount} TRUE STATEMENTS:
- Every truth must pass the "NO WAY" test — player says "no way" then learns it's real
- Mix tones: one funny, one shocking, one "I should have known", one deep obscure
- Use specific details: real names, real numbers, real dates
- Never use top-10 Google result facts for this category
- FORBIDDEN (never use): Cleopatra/Moon landing, Napoleon rabbits, octopus hearts, banana radioactive, honey spoils, Mpemba, goldfish memory, Jupiter diamond, Great Wall visible from space, Tesla invented electricity

${category === 'exyu' || category === 'exyu_sport' || category === 'exyu_music' || category === 'exyu_history' ? `
EX-YU SPECIFIC CONTENT — include from: Đoković/Pančev/Prosinečki/Savićević/Divac obscure facts, Lepa Brena/Bijelo Dugme/Bregović, Tito oddities, SFRY trivia, Kusturica/Makavejev, Tesla real obscure facts (not overused ones), ajvar/ćevapi/rakija origins, Yugoslav Non-Aligned Movement, EXIT festival, Dinaric Alps records.
` : ''}

POPULAR CULTURE: At least 1 statement must connect to something people actually care about — sports records, famous musicians, movies, world records, celebrity facts.

RULES FOR THE 1 LIE:
- Same length, style, specificity as truths — no tonal difference
- Contains plausible specific details (real-sounding name, number, date)
- At difficulty 4-5: the lie must be the most normal-sounding statement
- Must feel like it belongs — no style red flags

Shuffle order — lie must NOT always be last.

Return ONLY valid JSON, no markdown:
{
  "statements": [
    {"text": "...", "real": true},
    {"text": "...", "real": false},
${extraTruthExamples}
  ],
  "bluff_explanation": "One sentence: why this lie is convincing and what's actually true",
  "difficulty_achieved": ${difficulty}
}`

  async function attempt() {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content[0]?.text || "";
    const parsed = extractJSON(raw);
    const normalized = normalize(parsed.statements);
    repair(normalized, stmtCount);
    return normalized;
  }

  let normalized;
  try {
    normalized = await attempt();
  } catch (err1) {
    console.warn(`[round] attempt 1 failed (${err1.message}), retrying once`);
    try {
      normalized = await attempt();
    } catch (err2) {
      console.error("[round] both attempts failed:", err2.message);
      const fb = getFallback(category, stmtCount);
      return res.status(200).json({
        ...fb,
        id: `live_fallback_${lang}_${category}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        summary: fb.statements?.[0]?.text?.slice(0, 80) || "",
      });
    }
  }

  await saveUsedFacts(category, lang, normalized);
  console.log(`[round] cat=${category} diff=${difficulty} lang=${lang} mode=${mode} used=${usedHashes.length} avoid=${avoidSummaries.length} lies=${normalized.filter(s=>!s.real).length}`);
  // Stable-per-response ID + short topic summary so the client can feed this
  // round into mark-seen exactly like a cache round, and the next live-gen
  // call can avoid regenerating the same topic.
  const firstTruth = normalized.find(s => s.real) || normalized[0];
  const summary = (firstTruth?.text || "").slice(0, 80);
  const id = `live_${lang}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return res.status(200).json({ id, summary, category, difficulty, statements: normalized });
}

function normalize(statements) {
  if (!Array.isArray(statements)) throw new Error("not array");
  return statements.map(s => ({
    text: String(s.text || ""),
    real: s.real === true || s.real === "true",
  }));
}

function repair(stmts, expectedLen) {
  const lies = stmts.filter(s => !s.real).length;
  if (lies === 0) { stmts[stmts.length - 1].real = false; }
  if (lies > 1) {
    let f = false;
    stmts.forEach(s => { if (!s.real) { if (f) s.real = true; else f = true; }});
  }
  if (stmts.length !== expectedLen) throw new Error(`bad length: ${stmts.length} (expected ${expectedLen})`);
}

function extractJSON(raw) {
  if (!raw?.trim()) throw new Error("empty");
  let clean = raw.replace(/```json\s*/g,"").replace(/```\s*/g,"").trim();
  try { return JSON.parse(clean); } catch {}
  const f = clean.indexOf("{"), l = clean.lastIndexOf("}");
  if (f !== -1 && l > f) { try { return JSON.parse(clean.slice(f,l+1)); } catch {} }
  throw new Error("no JSON");
}

function getFallback(cat, stmtCount = SCHEMA.regular.total) {
  // Pool = 4 truths + 1 lie per category; slice to stmtCount for the caller's schema
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
    exyu: { category:"exyu", difficulty:1, statements:[
      {text:"Red Star Belgrade won the 1991 European Cup, beating Marseille on penalties.",real:true},
      {text:"Nikola Tesla was born in Smiljan, in modern-day Croatia, in 1856.",real:true},
      {text:"Yugoslavia was a founding member of the Non-Aligned Movement in 1961.",real:true},
      {text:"Emir Kusturica has won the Palme d'Or at the Cannes Film Festival twice.",real:true},
      {text:"Yugoslavia was the first country to land an uncrewed probe on the Moon, in 1971.",real:false},
    ]},
  };
  const entry = map[cat] || map.history;
  if (stmtCount >= entry.statements.length) return entry;
  // Blitz trim: keep the lie + (stmtCount - 1) truths, then shuffle
  const lie = entry.statements.find(s => !s.real);
  const truths = entry.statements.filter(s => s.real).slice(0, stmtCount - 1);
  const trimmed = [...truths, lie].sort(() => Math.random() - 0.5);
  return { ...entry, statements: trimmed };
}

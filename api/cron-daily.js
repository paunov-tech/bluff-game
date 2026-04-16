// api/cron-daily.js
// Cron: 0 23 * * * — pre-generates tomorrow's daily challenge at 23:00 UTC
import { kv } from "@vercel/kv";
import Anthropic from "@anthropic-ai/sdk";
import { SCHEMA } from "../src/config/schema.js";
const { total: TOTAL, truths: TRUTHS, lies: LIES } = SCHEMA.regular;

const CATEGORIES = ["history","internet","animals","science","popculture","geography","food","culture","sports","history"];
const ROUND_DIFFICULTY = [0,1,1,2,2,3,3,4,4,5];
const DIFF_PROMPTS = {
  0: "extremely well-known, universally popular facts",
  1: "well-known facts most people know",
  2: "moderately difficult facts",
  3: "tricky, less-known facts",
  4: "expert-level obscure facts",
  5: "highly obscure, expert-level facts",
};

// 12 sub-topics per category — randomly rotated to maximise daily challenge pool variety
const SUBTOPICS_DAILY = {
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
    "Ancient Americas — Aztecs, Incas, Maya, Mesopotamia, surprising civilisation facts",
  ],
  science: [
    "Space and astronomy — planets, black holes, galaxies, NASA missions, cosmic scale records",
    "Human body — anatomy, biology, medical records, nervous and immune systems, surprising facts",
    "Physics — Newton, Einstein, quantum mechanics, relativity, surprising experimental results",
    "Chemistry — periodic table, elements, reactions, surprising compound and material science facts",
    "Evolution and genetics — DNA, Darwin, mutations, natural selection, surprising evolutionary facts",
    "Earth sciences — plate tectonics, volcanism, climate history, surprising geological facts",
    "Mathematics — Euler, Pythagoras, unsolved problems, Pi, surprising number and pattern facts",
    "Neuroscience — brain capacity, memory, sleep science, surprising psychology and cognition facts",
    "Medicine and vaccines — plague history, antibiotic discovery, surgical milestones, surprising facts",
    "Ocean science — deep sea records, bioluminescence, ocean trenches, surprising underwater facts",
    "Famous inventions — Nobel Prize history, surprising origin stories behind major inventions",
    "Climate and natural phenomena — weather extremes, ecosystem records, surprising natural phenomena",
  ],
  animals: [
    "Big cats — lions, tigers, leopards, cheetahs; speed, territory, hunting strategies, surprising facts",
    "Ocean creatures — sharks, whales, octopuses, deep-sea animals, surprising marine abilities",
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
    "Food records — most expensive ingredients, most produced foods globally, calorie records",
    "Food science and myths — surprising debunked nutrition facts, food chemistry",
    "Agriculture and farming — crop domestication history, farming records, food production facts",
    "Food laws and regulations — surprising legal definitions, unusual bans worldwide",
    "Street food and culinary culture — surprising facts about food markets and culinary traditions",
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
  internet: [
    "Social media records — Instagram, TikTok, Twitter/X, YouTube; surprising usage and follower stats",
    "Gaming — most played games, esports prize pools, game dev history, surprising video game facts",
    "History of the internet — ARPANET, first websites, email origins, surprising milestone facts",
    "Viral moments and memes — most viewed videos, famous internet phenomena, content spread facts",
    "Tech giants — Apple, Google, Meta, Amazon, Microsoft; surprising founding and growth facts",
    "Cybersecurity and famous hacks — largest data breaches, surprising digital security history facts",
    "Streaming platforms — Netflix, Spotify, YouTube; surprising subscriber and content budget facts",
    "Artificial intelligence milestones — ChatGPT, AlphaGo, DeepMind, surprising AI timeline facts",
    "Cryptocurrency — Bitcoin origins, surprising crypto market records and adoption facts",
    "E-commerce — Amazon, Alibaba, eBay; surprising shopping statistics and record sales facts",
    "Mobile apps and smartphones — most downloaded apps, smartphone adoption, surprising app facts",
    "Internet infrastructure — undersea cables, data centers, DNS, surprising technical scale facts",
  ],
  popculture: [
    "Music industry records — best-selling albums and artists, surprising chart history facts",
    "Hollywood blockbusters — highest-grossing films, production budgets, surprising box office records",
    "Streaming industry — Netflix, Disney+, HBO Max; surprising content budgets and subscriber records",
    "Animated films — Disney, Pixar, Studio Ghibli; surprising production and box office facts",
    "Music awards — Grammy, Oscars, MTV VMAs, Brit Awards; surprising historical ceremony facts",
    "Superhero franchises — Marvel MCU, DC; surprising production costs and box office records",
    "K-pop and global music — BTS, Blackpink, surprising global reach and streaming record facts",
    "Classic TV shows — Friends, Game of Thrones, Breaking Bad; surprising production and cast facts",
    "Celebrity culture — surprising career, earnings, and record-breaking celebrity facts",
    "Fashion and luxury brands — Met Gala, Chanel, Gucci, Louis Vuitton; surprising industry facts",
    "Reality TV — Survivor, Big Brother, Idol, The Voice; surprising global format and viewership facts",
    "Video game culture — best-selling games, esports rise, gaming celebrities, surprising history facts",
  ],
  sports: [
    "NBA basketball — championship records, iconic players (Jordan, LeBron, Kobe), draft history, franchise stats",
    "English Premier League — club records, top scorers, legendary managers, transfer records",
    "La Liga (Spain) — Real Madrid, Barcelona, Atletico Madrid; records, El Clásico, legends",
    "Serie A (Italy) — Juventus, AC Milan, Inter Milan; Scudetto records, iconic players",
    "Bundesliga (Germany) — Bayern Munich, Borussia Dortmund; records, famous players",
    "UEFA Champions League — final records, top scorers all-time, iconic comebacks",
    "FIFA World Cup — tournament records, top scorers, memorable upsets, surprising facts",
    "Formula 1 — world champions, constructor records, iconic races and drivers",
    "Grand Slam tennis — titles records, iconic players (Federer, Nadal, Djokovic, Serena)",
    "NFL American Football — Super Bowl records, all-time leaders, franchise history, iconic moments",
    "Summer Olympics — world records, medal surprises, iconic athletes, host city facts",
    "Football transfer market — world record fees, most expensive signings, surprising valuations",
  ],
};

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getTomorrowKey() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

async function generateRound(category, difficulty) {
  const subtopicList = SUBTOPICS_DAILY[category];
  const subtopicNote = subtopicList
    ? ` Sub-topic for this round: ${subtopicList[Math.floor(Math.random() * subtopicList.length)]}. Use specific names, dates, records, and surprising statistics.`
    : "";
  const msg = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 600,
    messages: [{
      role: "user",
      content: `Generate ${TOTAL} factual statements about "${category}" in English.${subtopicNote} EXACTLY ${TRUTHS} must be TRUE, EXACTLY ${LIES} must be FALSE (subtle, realistic-sounding lie). Difficulty: ${DIFF_PROMPTS[difficulty] || "moderate"}. Never use profanity or vulgar language. Return ONLY valid JSON: {"statements":[{"text":"...","real":true},...]} No markdown, no explanation.`,
    }],
  });
  const raw = msg.content[0].text.trim();
  const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  const lies = (parsed.statements || []).filter(s => !s.real);
  if (lies.length !== 1) throw new Error(`Expected 1 lie, got ${lies.length}`);
  return parsed.statements;
}

function getTodayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
}

export default async function handler(req, res) {
  const useToday = req.query.today === "1";
  const dateKey = useToday ? getTodayKey() : getTomorrowKey();
  const kvKey = `bluff:daily:${dateKey}`;

  // Skip if already generated (unless force=1)
  if (req.query.force !== "1") {
    try {
      const existing = await kv.get(kvKey);
      if (existing) {
        return res.status(200).json({ status: "already_generated", date: dateKey });
      }
    } catch {}
  }

  const rounds = [];
  const errors = [];

  for (let i = 0; i < 10; i++) {
    const cat = CATEGORIES[i % CATEGORIES.length];
    const diff = ROUND_DIFFICULTY[i];
    try {
      const stmts = await generateRound(cat, diff);
      rounds.push({ category: cat, difficulty: diff, statements: stmts });
      console.log(`[cron-daily] round ${i+1}/10 done (${cat}, diff ${diff})`);
    } catch (e) {
      console.error(`[cron-daily] round ${i+1} failed:`, e.message);
      errors.push({ round: i, error: e.message });
    }
    if (i < 9) await new Promise(r => setTimeout(r, 500));
  }

  if (rounds.length < 8) {
    return res.status(500).json({ error: "Too many failures", rounds: rounds.length, errors });
  }

  try {
    await kv.set(kvKey, rounds, { ex: 86400 * 3 }); // keep 3 days
  } catch (e) {
    return res.status(500).json({ error: "KV save failed", detail: e.message });
  }

  return res.status(200).json({ status: "ok", date: dateKey, rounds: rounds.length, errors });
}

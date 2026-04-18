// Translate src/i18n/en.js → src/i18n/sr.js, hr.js via Claude.
// Usage:
//   ANTHROPIC_API_KEY=... node scripts/translate-strings.mjs
// Run whenever en.js changes to refresh sr/hr.

import Anthropic from "@anthropic-ai/sdk";
import { writeFile } from "node:fs/promises";
import enModule from "../src/i18n/en.js";

const enTranslations = enModule.default || enModule;

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LANGUAGES = [
  {
    code: "sr",
    name: "Serbian (Latin script)",
    style:
      "casual, playful, appropriate for a casino/quiz game. Use Latin alphabet only (no Cyrillic). Match the tone of English (direct, punchy, slightly cheeky). Keep 'BLUFF', 'AXIOM', 'Pro', 'Stripe', 'Telegram' untranslated. Keep currency (€4.99) and numbers intact.",
    examples: {
      "Challenge AXIOM": "Izazovi AXIOM",
      "Lock in": "Zaključaj",
      "Next round": "Sledeća runda",
      "Cash Out": "Uzmi poene",
      "Spin the Wheel": "Zavrti točak",
      "Home": "Početna",
      "Best streak": "Najbolji niz",
      "You beat AXIOM": "Pobedio si AXIOM",
      "Points": "Poeni",
      "Waiting for opponent": "Čekam protivnika",
      "Try again": "Pokušaj ponovo",
    },
  },
  {
    code: "hr",
    name: "Croatian",
    style:
      "casual, playful, appropriate for a casino/quiz game. Match the tone of English (direct, punchy, slightly cheeky). Keep 'BLUFF', 'AXIOM', 'Pro', 'Stripe', 'Telegram' untranslated. Keep currency and numbers intact.",
    examples: {
      "Challenge AXIOM": "Izazovi AXIOM",
      "Lock in": "Zaključaj",
      "Next round": "Sljedeća runda",
      "Cash Out": "Uzmi bodove",
      "Spin the Wheel": "Zavrti kolo",
      "Home": "Početna",
      "Best streak": "Najbolji niz",
      "You beat AXIOM": "Pobijedio si AXIOM",
      "Points": "Bodovi",
      "Waiting for opponent": "Čekam protivnika",
      "Try again": "Pokušaj ponovno",
    },
  },
];

async function translateBatch(lang, stringsMap) {
  const prompt = `Translate these UI strings from English to ${lang.name}.

Tone: ${lang.style}

CRITICAL RULES:
- Return ONLY a JSON object mapping each English string to its translation
- No explanation, no markdown fences, no preamble
- Preserve placeholders like {n}, {mult}, {name} EXACTLY
- Preserve punctuation like · and — and all emojis exactly
- Keep prices like €4.99 intact
- Keep "BLUFF", "AXIOM", "Pro", "Stripe", "Telegram" untranslated
- If a string is only emojis or only numbers, return it unchanged

Examples for reference:
${Object.entries(lang.examples).map(([en, tr]) => `"${en}" → "${tr}"`).join("\n")}

Strings to translate (return a JSON object with same keys):
${JSON.stringify(stringsMap, null, 2)}`;

  const resp = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  let text = resp.content[0].text.trim();
  text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
  return JSON.parse(text);
}

function flatten(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "object" && v !== null) {
      Object.assign(out, flatten(v, fullKey));
    } else {
      out[fullKey] = v;
    }
  }
  return out;
}

function unflatten(flat) {
  const out = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split(".");
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] || {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}

async function main() {
  const flat = flatten(enTranslations);
  const allKeys = Object.keys(flat);
  console.log(`Source: ${allKeys.length} strings`);

  for (const lang of LANGUAGES) {
    console.log(`\nTranslating to ${lang.name}...`);
    const entries = Object.entries(flat);
    const CHUNK = 40;
    const translations = {};
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = Object.fromEntries(entries.slice(i, i + CHUNK));
      const ci = Math.floor(i / CHUNK) + 1;
      const total = Math.ceil(entries.length / CHUNK);
      console.log(`  chunk ${ci}/${total} (${Object.keys(chunk).length} strings)`);
      const result = await translateBatch(lang, chunk);
      Object.assign(translations, result);
    }

    // Verify all keys present; backfill from English if missing
    for (const k of allKeys) {
      if (!(k in translations)) {
        console.warn(`    ⚠ missing key ${k} — falling back to English`);
        translations[k] = flat[k];
      }
    }

    const nested = unflatten(translations);
    const fileContent =
      `// Auto-generated from en.js via scripts/translate-strings.mjs\n` +
      `// Do not edit by hand — re-run the script to refresh.\n\n` +
      `export default ${JSON.stringify(nested, null, 2)};\n`;
    await writeFile(`src/i18n/${lang.code}.js`, fileContent);
    console.log(`  ✓ wrote src/i18n/${lang.code}.js (${Object.keys(translations).length} strings)`);
  }
}

main().catch((e) => {
  console.error("Translation failed:", e);
  process.exit(1);
});

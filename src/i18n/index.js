import en from "./en.js";
import sr from "./sr.js";
import hr from "./hr.js";

const translations = { en, sr, hr };

export function getTranslation(lang) {
  return translations[lang] || translations.en;
}

function resolve(key, lang) {
  const dict = getTranslation(lang);
  const parts = key.split(".");
  let value = dict;
  for (const p of parts) {
    value = value?.[p];
    if (value === undefined) break;
  }
  if (value === undefined) {
    value = parts.reduce((o, p) => o?.[p], en);
  }
  return value;
}

export function t(key, lang, params = {}) {
  let value = resolve(key, lang);
  if (value === undefined && key.startsWith("rab_card.")) {
    value = resolve(key.replace("rab_card.", "swear_card."), lang);
  }
  if (value === undefined) {
    if (typeof console !== "undefined") console.warn(`[i18n] Missing key: ${key}`);
    return key;
  }
  if (typeof value === "string" && params && Object.keys(params).length > 0) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return value;
}

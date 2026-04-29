// Letter pools for AXIOM Shifter (slovni mod). Easy MVP: only the
// "approachable" consonants. Vowels are constant across languages to
// keep grammar workable. Latin alphabet only — Cyrillic comes later.

const VOWELS = ["A", "E", "I", "O", "U"];

const POOLS = {
  en: {
    vowels: VOWELS,
    consonants: ["T", "R", "M", "S", "N", "L", "P", "K", "D", "G", "B", "C", "H", "F"],
  },
  sr: {
    vowels: VOWELS,
    consonants: ["T", "R", "M", "S", "N", "L", "P", "K", "D", "G", "B", "C", "V", "J"],
  },
  hr: {
    vowels: VOWELS,
    consonants: ["T", "R", "M", "S", "N", "L", "P", "K", "D", "G", "B", "C", "V", "J"],
  },
};

function pickN(arr, n) {
  const copy = [...arr];
  const out = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

// Returns 8 letters: 4 vowels + 4 consonants, shuffled. Never duplicates
// within the 4 consonants (vowels can repeat — only 5 in the pool).
export function generateLetters(lang = "en") {
  const pool = POOLS[lang] || POOLS.en;
  // 4 vowels with repetition allowed (pool only has 5)
  const vowels = Array.from({ length: 4 }, () => pool.vowels[Math.floor(Math.random() * pool.vowels.length)]);
  const consonants = pickN(pool.consonants, 4);
  const letters = [...vowels, ...consonants];
  // Fisher-Yates shuffle
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  return letters;
}

// Match user statement letters against the pool. Each letter can be matched
// at most once. Case-insensitive. Returns the normalized list of matched
// letters (in the order words appear).
export function getMatchedLetters(statement, letters) {
  if (!statement || !letters?.length) return [];
  const words = statement.trim().split(/\s+/).filter(Boolean);
  const remaining = letters.map(l => l.toUpperCase());
  const matched = [];
  for (const word of words) {
    const firstChar = word[0]?.toUpperCase();
    if (!firstChar) continue;
    const idx = remaining.indexOf(firstChar);
    if (idx !== -1) {
      matched.push(firstChar);
      remaining.splice(idx, 1);
    }
  }
  return matched;
}

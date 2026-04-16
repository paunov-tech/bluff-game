// Offline/error fallback rounds — used when /api/generate-round fails.
// Shapes match src/config/schema.js exactly.

export const REGULAR_FALLBACK = [
  { text: "Napoleon was once attacked by a horde of rabbits during a hunting party after the Treaty of Tilsit.", real: true },
  { text: "Cleopatra lived closer in time to the Moon landing than to the Great Pyramid's construction.", real: true },
  { text: "The French army used over 600 Paris taxis to rush troops to the Battle of the Marne.", real: true },
  { text: "Queen Victoria kept a diary in Urdu exclusively for the last 13 years of her reign.", real: false },
];

export const BLITZ_FALLBACK = [
  { text: "Octopuses have three hearts and blue blood.", real: true },
  { text: "Honey never spoils — archaeologists have found 3,000-year-old edible honey in Egyptian tombs.", real: true },
  { text: "The Great Wall of China is visible from the Moon with the naked eye.", real: false },
];

export function getFallback(mode) {
  return mode === "blitz" ? BLITZ_FALLBACK : REGULAR_FALLBACK;
}

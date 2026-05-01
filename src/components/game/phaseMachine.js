// Single-player phase order. Edit here, not in callers.
export const PHASES = ["SWIPE", "CLASSIC", "SNIPER", "BLIND_MATH", "SUDDEN_DEATH"];

// Interstitial slot identifier — distinct from a phase so the engine
// can render <RouletteInterstitial /> without polluting PHASES.
export const INTERSTITIAL = "INTERSTITIAL";

// Which transitions get a roulette gate. SUDDEN_DEATH is the finale —
// no interstitial after it.
const INTERSTITIAL_AFTER = new Set(["SWIPE", "CLASSIC", "SNIPER", "BLIND_MATH"]);

export function nextPhase(current) {
  const i = PHASES.indexOf(current);
  if (i === -1 || i === PHASES.length - 1) return null;
  return PHASES[i + 1];
}

export function shouldRunInterstitialAfter(phase) {
  return INTERSTITIAL_AFTER.has(phase);
}

export function isFinalPhase(phase) {
  return phase === PHASES[PHASES.length - 1];
}

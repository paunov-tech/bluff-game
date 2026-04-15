// Per-ladder-position timer durations (seconds) — Fix 1: adaptive timer
export const TIMER_BY_LADDER = {
  1: 22, 2: 28, 3: 28, 4: 38, 5: 32,
  6: 52, 7: 42, 8: 68, 9: 68, 10: 75,
};

// Show-logic difficulty curve (Millionaire/The Chase style)
// Trap rounds 4 and 7 — harder than expected after easier round
export const LADDER_DIFFICULTY = {
  1: 1,  // L1 Warm-up  — "This is easy, I've got this"
  2: 2,  // L2 Tricky   — "Hmm, almost got me..."
  3: 2,  // L2 Tricky   — Consolidation — feeling of safety
  4: 3,  // L3 Sneaky   — TRAP "Wait, I thought I knew this!"
  5: 2,  // L2 Tricky   — Safety Net 1 — breather before harder rounds
  6: 4,  // L4 Devious  — "The game just got serious"
  7: 3,  // L3 Sneaky   — TRAP — relaxed after L4
  8: 5,  // L5 Diabolical — Safety Net 2 — full hit
  9: 5,  // L5 Diabolical — "Everything sounds like a lie"
  10: 5, // L5 Diabolical — Grand Bluff — finale
};

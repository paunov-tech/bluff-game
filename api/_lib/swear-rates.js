// api/_lib/swear-rates.js — server-validated earn table for SWEAR currency.
// Clients pass an `event` name; server looks up the amount here. Clients
// never send amounts — stops trivial balance manipulation.

export const EARN_RATES = {
  grand_bluff_victory:       100,
  solo_win:                   30,
  solo_loss:                  10,
  blitz_win:                  25,
  blitz_loss:                  8,
  duel_win:                   15,
  duel_loss:                   5,
  daily_challenge_complete:   20,
  daily_challenge_perfect:    30,
  first_time_bonus:          100,
  streak_milestone_5:         10,
  streak_milestone_10:        25,
  streak_milestone_15:        50,
  early_adopter_bonus:       500,
  // Shifter / Numbers (Brojke i slova / Countdown style modes)
  shifter_match_win:          30,
  shifter_match_loss:         10,
  shifter_clean_sweep:        50,
  numbers_match_win:          30,
  numbers_match_loss:         10,
  numbers_clean_sweep:        50,
  // V2 multi-phase loop. Per-phase SWEAR is credited individually by
  // swipe-judge / sniper-judge for those server-judged phases. These two
  // events are the run-end completion bonus.
  v2_run_victory:             50,
  v2_run_death:               15,
  // Consolidation BLUFF flow (BluffEngine 6-module sequence). Per-module
  // SWEAR is shown in-run only; this is the run-end completion bonus.
  bluff_session_complete:     25,
};

export function rateFor(event) {
  return Object.prototype.hasOwnProperty.call(EARN_RATES, event) ? EARN_RATES[event] : 0;
}

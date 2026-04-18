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
};

export function rateFor(event) {
  return Object.prototype.hasOwnProperty.call(EARN_RATES, event) ? EARN_RATES[event] : 0;
}

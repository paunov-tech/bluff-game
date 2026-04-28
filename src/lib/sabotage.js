// Sabotage moments — AXIOM occasionally disrupts a round to break the
// "1956 crossword puzzle" feel. Solo Climb only, hard rounds only, once
// per game. Telemetry via PostHog (captureEvent).

import { captureEvent } from "./telemetry.js";

export const SABOTAGE_CONFIG = {
  enabled: true,
  triggerChance: 0.05,
  // Round numbers are 1-indexed for users. App.jsx tracks roundIdx (0-indexed),
  // so callers should pass roundIdx + 1 here.
  minRound: 2,
  maxRound: 9,
  minDifficulty: 4,
};

export const SABOTAGE_TYPES = {
  TIME_THIEF:     { weight: 40, durationMs: 1500 },
  REALITY_GLITCH: { weight: 35, durationMs: 1500 },
  PEEK_AND_HIDE:  { weight: 25, durationMs: 1000 },
};

export function shouldTriggerSabotage(round, difficulty, alreadyTriggered) {
  if (!SABOTAGE_CONFIG.enabled) return false;
  if (alreadyTriggered) return false;
  if (round < SABOTAGE_CONFIG.minRound) return false;
  if (round > SABOTAGE_CONFIG.maxRound) return false;
  if (difficulty < SABOTAGE_CONFIG.minDifficulty) return false;
  return Math.random() < SABOTAGE_CONFIG.triggerChance;
}

export function pickSabotageType() {
  const total = Object.values(SABOTAGE_TYPES).reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const [name, config] of Object.entries(SABOTAGE_TYPES)) {
    r -= config.weight;
    if (r <= 0) return name;
  }
  return "TIME_THIEF";
}

// Scramble a piece of text with random latin/symbol characters while
// preserving spaces and approximate length. Used for REALITY_GLITCH.
const SCRAMBLE = "▓▒░█▌▐■□▪▫◆◇○●◐◑01ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function scrambleText(text) {
  if (!text) return "";
  let out = "";
  for (const ch of text) {
    if (ch === " " || ch === "\n") { out += ch; continue; }
    out += SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)];
  }
  return out;
}

export function logSabotageTriggered(type, round, difficulty, userId) {
  try {
    captureEvent("sabotage_triggered", {
      sabotage_type: type,
      round,
      difficulty,
      user_id: userId || null,
    });
  } catch {}
}

export function logSabotageOutcome(type, isCorrect, userId) {
  try {
    captureEvent("sabotage_outcome", {
      sabotage_type: type,
      result: isCorrect ? "correct" : "wrong",
      user_id: userId || null,
    });
  } catch {}
}

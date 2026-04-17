import { ROUNDS } from "../data/rounds.js";
import { LADDER_DIFFICULTY } from "../data/difficultyMap.js";

const PLAYED_KEY = "bluff_played_v2";
const BLOCK_SIZE = 10;

function readPlayed() {
  try {
    const raw = localStorage.getItem(PLAYED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writePlayed(arr) {
  try { localStorage.setItem(PLAYED_KEY, JSON.stringify(arr)); } catch {}
}

export function getNextRound(ladderPosition, lastThreeCats) {
  const targetDiff = LADDER_DIFFICULTY[ladderPosition] ?? 3;
  let played = readPlayed();

  // Filter: matching difficulty + not played + not same category as recent 3
  let candidates = ROUNDS.filter(r =>
    r.difficulty === targetDiff &&
    !played.has(r.id) &&
    !lastThreeCats.includes(r.cat)
  );

  // Fallback 1: relax category constraint
  if (candidates.length === 0) {
    candidates = ROUNDS.filter(r =>
      r.difficulty === targetDiff && !played.has(r.id)
    );
  }

  // Fallback 2: widen difficulty by ±1
  if (candidates.length === 0) {
    candidates = ROUNDS.filter(r =>
      Math.abs(r.difficulty - targetDiff) <= 1 && !played.has(r.id)
    );
  }

  // Fallback 3: full reset — keep only last BLOCK_SIZE as blocked
  if (candidates.length === 0) {
    const allPlayed = [...played];
    const recentBlock = allPlayed.slice(-BLOCK_SIZE);
    played = new Set(recentBlock);
    writePlayed(recentBlock);
    candidates = ROUNDS.filter(r =>
      r.difficulty === targetDiff && !played.has(r.id)
    );
    // Last resort: any round
    if (candidates.length === 0) {
      candidates = ROUNDS.filter(r => !played.has(r.id));
    }
    if (candidates.length === 0) candidates = [...ROUNDS];
  }

  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  played.add(selected.id);
  writePlayed([...played]);
  return selected;
}

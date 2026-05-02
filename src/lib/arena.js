// Arena Module Interface
//
// Every module in the BLUFF flow conforms to this contract. Modules are
// self-contained — they don't read or write each other's state, and they
// never write to Firestore directly. Only BluffEngine aggregates session
// state and persists results at run-end.
//
// @typedef {Object} ArenaModuleProps
// @property {(result: ArenaResult) => void} onComplete  Fired when the
//   module finishes successfully or terminally fails (e.g., bust).
// @property {() => void} onAbort  Fired when the user cancels via the X.
// @property {"en" | "sr" | "hr"} lang
// @property {string} userId
// @property {string} sessionId  Engine-supplied; stable across modules.
// @property {Object} [incomingState]  Optional state from prior module
//   (e.g., { streak: number }). Modules can ignore.
// @property {Object} [config]  Module-specific config from moduleRegistry
//   (e.g., { roundCount, difficultyMin, difficultyMax }).
//
// @typedef {Object} ArenaResult
// @property {boolean} success
// @property {number} scoreDelta   Points added to session score
// @property {number} swearDelta   SWEAR tokens added (server-credited
//   for the modules that talk to swipe-judge / sniper-judge; otherwise
//   in-run only — see BluffEngine commentary)
// @property {number} [streakDelta]  Points added to streak (engine clamps to >= 0)
// @property {Object} [moduleStats]  Module-specific telemetry payload

export const ARENA_RESULT_DEFAULTS = Object.freeze({
  success: false,
  scoreDelta: 0,
  swearDelta: 0,
  streakDelta: 0,
  moduleStats: {},
});

// Validate + sanitize a module's result. Drops bad shapes silently with a
// warning so a misbehaving module can't crash the engine. Returns a result
// object with all fields filled in.
export function sanitizeArenaResult(result) {
  if (!result || typeof result !== "object") {
    // eslint-disable-next-line no-console
    console.warn("[arena] invalid result, using defaults", result);
    return { ...ARENA_RESULT_DEFAULTS };
  }
  return {
    success:     !!result.success,
    scoreDelta:  Number(result.scoreDelta)  || 0,
    swearDelta:  Number(result.swearDelta)  || 0,
    streakDelta: Number(result.streakDelta) || 0,
    moduleStats: result.moduleStats || {},
  };
}

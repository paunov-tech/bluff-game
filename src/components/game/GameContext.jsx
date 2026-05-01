import { createContext, useContext, useMemo, useReducer } from "react";

// Shared single-player session state. Phases mutate score / lives / SWEAR
// and roulette power-up effects through dispatch — no phase reads or writes
// another phase's local state.

const GameStateContext = createContext(null);
const GameDispatchContext = createContext(null);

const STARTING_LIVES = 3;
const STARTING_SWEAR = 0;

const initialState = {
  score: 0,
  lives: STARTING_LIVES,
  swear: STARTING_SWEAR,
  phaseLog: [],
  // Roulette power-ups that the next phase consumes. Each entry:
  //   { id: string, type: "POINTS_2X" | "SHIELD" | "TIMER_CUT", payload?: object }
  // Effects are removed on consumption; a phase that doesn't consume them
  // before completing leaves them in the queue for the phase after.
  activeEffects: [],
};

let _effectIdSeq = 0;
function nextEffectId() { _effectIdSeq += 1; return `eff_${Date.now().toString(36)}_${_effectIdSeq}`; }

function reducer(state, action) {
  switch (action.type) {
    case "ADD_SCORE":
      return { ...state, score: state.score + action.amount };
    case "LOSE_LIFE":
      return { ...state, lives: Math.max(0, state.lives - 1) };
    case "GAIN_LIFE":
      return { ...state, lives: state.lives + 1 };
    case "ADD_SWEAR":
      return { ...state, swear: state.swear + action.amount };
    case "SPEND_SWEAR":
      if (state.swear < action.amount) return state;
      return { ...state, swear: state.swear - action.amount };
    case "ADD_EFFECT":
      return { ...state, activeEffects: [...state.activeEffects, action.effect] };
    case "CONSUME_EFFECT_BY_ID":
      return {
        ...state,
        activeEffects: state.activeEffects.filter(e => e.id !== action.id),
      };
    case "CONSUME_EFFECT_BY_TYPE": {
      const idx = state.activeEffects.findIndex(e => e.type === action.effectType);
      if (idx < 0) return state;
      const next = state.activeEffects.slice();
      next.splice(idx, 1);
      return { ...state, activeEffects: next };
    }
    case "RECORD_PHASE":
      return { ...state, phaseLog: [...state.phaseLog, action.entry] };
    case "RESET":
      return { ...initialState };
    default:
      return state;
  }
}

export function GameProvider({ children, initial }) {
  const [state, dispatch] = useReducer(reducer, { ...initialState, ...(initial || {}) });

  const api = useMemo(() => ({
    addScore:    (amount) => dispatch({ type: "ADD_SCORE", amount }),
    loseLife:    ()       => dispatch({ type: "LOSE_LIFE" }),
    gainLife:    ()       => dispatch({ type: "GAIN_LIFE" }),
    addSwear:    (amount) => dispatch({ type: "ADD_SWEAR", amount }),
    spendSwear:  (amount) => dispatch({ type: "SPEND_SWEAR", amount }),
    addEffect:   ({ type, payload }) => {
      const effect = { id: nextEffectId(), type, payload };
      dispatch({ type: "ADD_EFFECT", effect });
      return effect;
    },
    consumeEffect:     (effectType) => dispatch({ type: "CONSUME_EFFECT_BY_TYPE", effectType }),
    consumeEffectById: (id)         => dispatch({ type: "CONSUME_EFFECT_BY_ID", id }),
    recordPhase:       (entry)      => dispatch({ type: "RECORD_PHASE", entry }),
    reset:             ()           => dispatch({ type: "RESET" }),
  }), []);

  return (
    <GameStateContext.Provider value={state}>
      <GameDispatchContext.Provider value={api}>
        {children}
      </GameDispatchContext.Provider>
    </GameStateContext.Provider>
  );
}

export function useGameState() {
  const ctx = useContext(GameStateContext);
  if (!ctx) throw new Error("useGameState must be used inside <GameProvider>");
  return ctx;
}

export function useGameActions() {
  const ctx = useContext(GameDispatchContext);
  if (!ctx) throw new Error("useGameActions must be used inside <GameProvider>");
  return ctx;
}

// Convenience: subscribe to a single slice without re-deriving in callers.
export function useScore()         { return useGameState().score; }
export function useLives()         { return useGameState().lives; }
export function useSwear()         { return useGameState().swear; }
export function useActiveEffects() { return useGameState().activeEffects; }

// Return whether an effect of the given type is queued. Callers that consume
// should use this together with consumeEffect(type) inside an effect/handler
// — never call dispatch during render.
export function useHasEffect(type) {
  return useActiveEffects().some(e => e.type === type);
}

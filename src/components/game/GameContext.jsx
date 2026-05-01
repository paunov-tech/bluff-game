import { createContext, useCallback, useContext, useMemo, useReducer } from "react";

// Shared single-player session state. Phases mutate score / lives / SWEAR
// through dispatch — no phase reads or writes another phase's local state.

const GameStateContext = createContext(null);
const GameDispatchContext = createContext(null);

const STARTING_LIVES = 3;
const STARTING_SWEAR = 0;

const initialState = {
  score: 0,
  lives: STARTING_LIVES,
  swear: STARTING_SWEAR,
  phaseLog: [],
};

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
    recordPhase: (entry)  => dispatch({ type: "RECORD_PHASE", entry }),
    reset:       ()       => dispatch({ type: "RESET" }),
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
export function useScore() { return useGameState().score; }
export function useLives() { return useGameState().lives; }
export function useSwear() { return useGameState().swear; }

import { useEffect, useRef } from "react";
import { GameProvider, useGameState } from "../../game/GameContext.jsx";
import { V2Styles } from "../../game/V2Styles.jsx";
import { BlindMath } from "../../game/phases/BlindMath.jsx";

// BlindMathModule — ARENA wrapper around the existing V2 BlindMath.
//
// V2 BlindMath runs 3 progressive rounds (3 ops easy → 5 ops medium → 7 ops
// hard with /÷). We wrap with a fresh GameProvider, capture the final
// in-context score/swear, and translate to ArenaResult.
export function BlindMathModule({ onComplete, onAbort, lang, userId }) {
  return (
    <>
      <V2Styles />
      <GameProvider>
        <BlindMathShim lang={lang} userId={userId} onComplete={onComplete} onAbort={onAbort} />
      </GameProvider>
    </>
  );
}

function BlindMathShim({ onComplete, onAbort }) {
  const state    = useGameState();
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  function handleInnerComplete(innerResult) {
    const stats = innerResult?.stats || { correct: 0, total: 0 };
    const finalState = stateRef.current;
    onComplete({
      success:     (stats.correct | 0) >= Math.ceil((stats.total | 0) / 2),
      scoreDelta:  finalState.score | 0,
      swearDelta:  finalState.swear | 0,
      streakDelta: 0,
      moduleStats: stats,
    });
  }

  return <BlindMath onComplete={handleInnerComplete} onAbort={onAbort} />;
}

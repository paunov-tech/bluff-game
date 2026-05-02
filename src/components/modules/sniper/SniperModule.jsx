import { useEffect, useRef } from "react";
import { GameProvider, useGameState } from "../../game/GameContext.jsx";
import { V2Styles } from "../../game/V2Styles.jsx";
import { SniperMode } from "../../game/phases/SniperMode.jsx";

// SniperModule — ARENA wrapper around the existing V2 SniperMode.
//
// V2 SniperMode pulls 3 sentences from /api/sniper-batch (Claude-generated
// sentences with one factually-swapped word) and validates each tap via
// /api/sniper-judge. Server is the only authority for correctness; SWEAR
// awarded by the judge endpoint accumulates into our local GameContext.
//
// API folder reorg note: /api/sniper-batch and /api/sniper-judge are the
// flat-file paths the V2 SniperMode hardcodes. The new
// /api/sniper/{batch,judge}.js paths added in this consolidation re-export
// the same handlers. Either path works; the underlying logic is identical.
export function SniperModule({ onComplete, onAbort, lang, userId }) {
  return (
    <>
      <V2Styles />
      <GameProvider>
        <SniperShim lang={lang} userId={userId} onComplete={onComplete} onAbort={onAbort} />
      </GameProvider>
    </>
  );
}

function SniperShim({ lang, userId, onComplete, onAbort }) {
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

  return <SniperMode lang={lang} userId={userId} onComplete={handleInnerComplete} onAbort={onAbort} />;
}

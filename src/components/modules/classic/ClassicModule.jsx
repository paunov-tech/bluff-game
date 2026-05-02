import { useEffect, useRef } from "react";
import { GameProvider, useGameState } from "../../game/GameContext.jsx";
import { V2Styles } from "../../game/V2Styles.jsx";
import { ClassicAxiom } from "../../game/phases/ClassicAxiom.jsx";

// ClassicModule — ARENA wrapper around the existing V2 ClassicAxiom.
//
// V2's ClassicAxiom already implements: 3-round 5-statement-find-the-lie,
// 15s timer per round, full Phase 1 drama (Sabotage / PitFall / AxiomReaction
// / CommunityToast). We wrap it with a fresh GameProvider so it can call
// `addScore` / `addSwear` into a local context, then translate the final
// GameContext state into the ArenaResult shape on completion.
//
// Note: V2 ClassicAxiom uses ROUND_COUNT=3 internally (not config-driven).
// Variable round-count + difficulty per `config` is a follow-up — see the
// PR body for the rationale.
export function ClassicModule({ onComplete, onAbort, lang, userId, sessionId }) {
  return (
    <>
      <V2Styles />
      <GameProvider>
        <ClassicShim
          lang={lang}
          userId={userId}
          sessionId={sessionId}
          onComplete={onComplete}
          onAbort={onAbort}
        />
      </GameProvider>
    </>
  );
}

function ClassicShim({ lang, userId, onComplete, onAbort }) {
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
      streakDelta: 0, // Classic doesn't carry a streak between modules in v1
      moduleStats: stats,
    });
  }

  return (
    <ClassicAxiom
      lang={lang}
      userId={userId}
      onComplete={handleInnerComplete}
      onAbort={onAbort}
    />
  );
}

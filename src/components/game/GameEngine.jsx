import { useCallback, useEffect, useRef, useState } from "react";
import { GameProvider, useGameActions, useGameState } from "./GameContext.jsx";
import { PHASES, INTERSTITIAL, isFinalPhase, nextPhase, shouldRunInterstitialAfter } from "./phaseMachine.js";
import { RouletteInterstitial } from "./RouletteInterstitial.jsx";
import { SwipeMode } from "./phases/SwipeMode.jsx";
import { ClassicAxiom } from "./phases/ClassicAxiom.jsx";
import { SniperMode } from "./phases/SniperMode.jsx";
import { BlindMath } from "./phases/BlindMath.jsx";
import { SuddenDeath } from "./phases/SuddenDeath.jsx";

// Master single-player loop. Wraps everything in <GameProvider> so phases
// can read / mutate score, lives, and SWEAR through context.
//
//   PHASES: SWIPE → CLASSIC → SNIPER → BLIND_MATH → SUDDEN_DEATH
//   Between every non-final phase, a <RouletteInterstitial /> wager beat.
//
// Callbacks (V2 spec):
//   onRunComplete({ score, swearEarned, phasesCompleted, finalPhase, outcome })
//     outcome: "victory" | "death" | "abort"
//   onRunAbort()  — user bailed; engine fires this then onRunComplete with outcome:"abort"
//
// Each phase component receives { lang, userId, onComplete, onAbort }.
export function GameEngine({ lang = "en", userId, onRunComplete, onRunAbort }) {
  return (
    <GameProvider>
      <EngineInner lang={lang} userId={userId} onRunComplete={onRunComplete} onRunAbort={onRunAbort} />
    </GameProvider>
  );
}

function EngineInner({ lang, userId, onRunComplete, onRunAbort }) {
  const [currentPhase, setCurrentPhase] = useState(PHASES[0]);
  const [slot, setSlot] = useState("PHASE"); // "PHASE" | "INTERSTITIAL"
  const [done, setDone] = useState(false);
  const state = useGameState();
  const { recordPhase } = useGameActions();
  const startSwearRef = useRef(state.swear);

  // Build the run-end payload from current context state.
  const finishRun = useCallback((outcome) => {
    if (done) return;
    setDone(true);
    onRunComplete?.({
      score:            state.score,
      swearEarned:      Math.max(0, state.swear - startSwearRef.current),
      phasesCompleted:  state.phaseLog.length,
      finalPhase:       currentPhase,
      outcome,
    });
  }, [done, state.score, state.swear, state.phaseLog.length, currentPhase, onRunComplete]);

  // Run-end driven by state changes (lives reaching 0). Effect, not render-time.
  useEffect(() => {
    if (state.lives <= 0 && !done) finishRun("death");
  }, [state.lives, done, finishRun]);

  const advance = useCallback((result) => {
    if (result) recordPhase({ phase: currentPhase, ...result });

    if (slot === "PHASE") {
      if (isFinalPhase(currentPhase)) {
        finishRun("victory");
        return;
      }
      if (shouldRunInterstitialAfter(currentPhase)) {
        setSlot("INTERSTITIAL");
        return;
      }
      const np = nextPhase(currentPhase);
      if (np) setCurrentPhase(np);
      return;
    }

    // Coming out of the interstitial → next phase.
    const np = nextPhase(currentPhase);
    if (np) {
      setCurrentPhase(np);
      setSlot("PHASE");
    }
  }, [currentPhase, slot, recordPhase, finishRun]);

  const handleAbort = useCallback(() => {
    if (done) return;
    onRunAbort?.();
    finishRun("abort");
  }, [done, onRunAbort, finishRun]);

  if (done) return null;

  if (slot === INTERSTITIAL) {
    return (
      <RouletteInterstitial
        lang={lang}
        nextPhase={nextPhase(currentPhase)}
        onComplete={() => advance()}
        onSkip={() => advance()}
      />
    );
  }

  const phaseProps = {
    lang,
    userId,
    onComplete: advance,
    onAbort: handleAbort,
  };

  switch (currentPhase) {
    case "SWIPE":        return <SwipeMode        {...phaseProps} />;
    case "CLASSIC":      return <ClassicAxiom     {...phaseProps} />;
    case "SNIPER":       return <SniperMode       {...phaseProps} />;
    case "BLIND_MATH":   return <BlindMath        {...phaseProps} />;
    case "SUDDEN_DEATH": return <SuddenDeath      {...phaseProps} />;
    default:             return null;
  }
}

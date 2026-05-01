import { PhaseShell } from "../PhaseShell.jsx";
import { useGameActions } from "../GameContext.jsx";

// Placeholder. Real implementation will lift logic out of
// src/components/SwipeWarmup.jsx and report results through onComplete.
export function SwipeMode({ onComplete, onAbort }) {
  const { addScore, addSwear } = useGameActions();
  function finish() {
    addScore(100);
    addSwear(5);
    onComplete?.({ ok: true, scoreDelta: 100, swearDelta: 5 });
  }
  return (
    <PhaseShell
      name="Swipe"
      blurb="Tinder-style true/false warm-up. 60 seconds, combo bonuses, swear earnings."
      onComplete={finish}
      onAbort={onAbort}
    />
  );
}

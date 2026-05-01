import { PhaseShell } from "../PhaseShell.jsx";
import { useGameActions } from "../GameContext.jsx";

// Placeholder. Sniper = single-shot precision round. Wrong answer
// costs a life; right answer is worth more than Classic.
export function SniperMode({ onComplete, onAbort }) {
  const { addScore } = useGameActions();
  function finish() {
    addScore(300);
    onComplete?.({ ok: true, scoreDelta: 300 });
  }
  return (
    <PhaseShell
      name="Sniper"
      blurb="One shot. One claim. Pull the trigger only when you're sure."
      onComplete={finish}
      onAbort={onAbort}
    />
  );
}

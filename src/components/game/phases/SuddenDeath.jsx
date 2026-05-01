import { PhaseShell } from "../PhaseShell.jsx";
import { useGameActions } from "../GameContext.jsx";

// Placeholder. Final phase. Every miss is fatal — lives drop to zero
// on a single wrong call, ending the run.
export function SuddenDeath({ onComplete, onAbort }) {
  const { addScore } = useGameActions();
  function finish() {
    addScore(1000);
    onComplete?.({ ok: true, scoreDelta: 1000 });
  }
  return (
    <PhaseShell
      name="Sudden Death"
      blurb="No second chances. Beat AXIOM here or the run is over."
      onComplete={finish}
      onAbort={onAbort}
    />
  );
}

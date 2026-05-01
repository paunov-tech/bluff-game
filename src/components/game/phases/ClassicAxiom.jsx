import { PhaseShell } from "../PhaseShell.jsx";
import { useGameActions } from "../GameContext.jsx";

// Placeholder. Real implementation will host the 12-round AXIOM duel
// currently embedded in App.jsx.
export function ClassicAxiom({ onComplete, onAbort }) {
  const { addScore } = useGameActions();
  function finish() {
    addScore(500);
    onComplete?.({ ok: true, scoreDelta: 500 });
  }
  return (
    <PhaseShell
      name="Classic AXIOM"
      blurb="The main duel: 12 statements from AXIOM, true or lie. Higher difficulty as the run goes."
      onComplete={finish}
      onAbort={onAbort}
    />
  );
}

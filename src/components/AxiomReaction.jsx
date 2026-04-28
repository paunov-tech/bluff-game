import { useEffect, useRef } from "react";

// Lightweight AXIOM reaction overlay — a small emoji avatar in the top
// corner with a voice line. LAUGH plays after the user nails round 5+,
// MOCK plays alongside PitFall on a wrong answer (PitFall handles its
// own voice line, so we only fire MOCK voice when used standalone).

const REACTIONS = {
  LAUGH: {
    emoji: "😂",
    voiceLines: ["Lucky.", "I let you have that one.", "Coincidence."],
    duration: 1500,
    accent: "#2dd4a0",
  },
  MOCK: {
    emoji: "😏",
    voiceLines: ["Pathetic.", "I expected more.", "Predictable."],
    duration: 1500,
    accent: "#f43f5e",
  },
};

export function AxiomReaction({ type, skin, playVoice = true, onComplete }) {
  const reaction = REACTIONS[type];
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (!reaction) { onCompleteRef.current?.(); return; }

    if (playVoice) {
      const line = reaction.voiceLines[Math.floor(Math.random() * reaction.voiceLines.length)];
      fetch("/api/axiom-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: line, skin }),
      })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.volume = 0.9;
          audio.onended = () => URL.revokeObjectURL(url);
          audio.onerror = () => URL.revokeObjectURL(url);
          const p = audio.play();
          if (p?.catch) p.catch(() => {});
        })
        .catch(() => {});
    }

    const t = setTimeout(() => onCompleteRef.current?.(), reaction.duration);
    return () => clearTimeout(t);
  }, [reaction, playVoice, skin]);

  if (!reaction) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        // Sits above PitFall so the MOCK avatar is visible during the
        // elimination choreography. LAUGH never overlaps PitFall.
        position: "fixed", top: 18, right: 18, zIndex: 10000,
        background: "rgba(20,20,28,0.85)",
        border: `2px solid ${reaction.accent}`,
        borderRadius: "50%",
        width: 64, height: 64,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 32,
        boxShadow: `0 0 40px ${reaction.accent}66, inset 0 0 12px ${reaction.accent}33`,
        animation: "axiom-reaction-pulse 1.5s ease both",
        pointerEvents: "none",
      }}
    >
      {reaction.emoji}
    </div>
  );
}

export default AxiomReaction;

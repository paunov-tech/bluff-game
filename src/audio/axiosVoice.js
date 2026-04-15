// AXIOS Voice — Web Speech API lip-sync driver

export const AXIOS_LINES = {
  round_start: [
    "Let's see if you're as clever as you think.",
    "I've prepared something special for you.",
    "One of these is mine. Can you tell which?",
    "I've been waiting for this.",
  ],
  player_selects: [
    "Interesting choice...",
    "Are you sure about that?",
    "Mmm.",
    "I see.",
  ],
  correct: [
    "Hmm. Impressive.",
    "I underestimated you. This time.",
    "Lucky guess. Let's continue.",
    "You're better than I expected.",
  ],
  wrong: [
    "Too easy.",
    "I fabricated that myself. Proud of it.",
    "The lie was right there.",
    "Perhaps next round will go better for you.",
  ],
  streak_3: ["You're starting to annoy me."],
  streak_5: ["This is... unexpected."],
  streak_7: ["How are you doing this?"],
  timer_10: ["Tick. Tock."],
  timer_5: ["Time's almost up."],
  grand_bluff: [
    "I used every trick in my neural networks. And you found them all. I need to recalibrate.",
  ],
};

export function axiosSay(event, onStart, onEnd) {
  if (!window.speechSynthesis) return;

  const lines = AXIOS_LINES[event];
  if (!lines) return;
  const text = lines[Math.floor(Math.random() * lines.length)];

  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);

  const speak = (voices) => {
    const preferred = voices.find(v =>
      v.name.includes("Google UK English Male") ||
      v.name.includes("Daniel") ||
      v.name.includes("Alex") ||
      (v.lang.startsWith("en") && v.name.toLowerCase().includes("male"))
    ) || voices.find(v => v.lang.startsWith("en"));

    if (preferred) utt.voice = preferred;
    utt.rate = 0.88;
    utt.pitch = 0.75;
    utt.volume = 0.8;

    utt.onstart = () => onStart?.();
    utt.onend = () => onEnd?.();
    window.speechSynthesis.speak(utt);
  };

  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    speak(voices);
  } else {
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      speak(window.speechSynthesis.getVoices());
    }, { once: true });
  }
}

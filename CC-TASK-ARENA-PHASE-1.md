# CC TASK: BLUFF Arena — Phase 1 (Drama Elements in Solo Mode)

**Repo:** `~/bluff-game`
**Branch:** main
**Estimated time:** 5-7 days CC work
**Reference:** BLUFF-ARENA-DESIGN-DOC.md (in repo root)

---

## Context

User feedback says BLUFF feels "like a 1956 crossword puzzle." Solo mode 
needs visceral drama before Arena (Phase 2) ships. This task adds three 
drama elements to solo mode that make every game feel alive.

**Goal:** Ship to production this week. Users feel the change immediately.

**Non-goal:** Do NOT implement Arena/multiplayer in this task. That's 
Phase 2.

---

## What ships in this task

1. **Sabotage moments** — AXIOM randomly disrupts rounds with glitch effects
2. **The Pit** — dramatic 3-second elimination choreography on wrong answers
3. **Real-time community presence** — toasts showing other players' activity
4. **AXIOM physical reactions** — basic emotion responses (laugh on win, mock on loss)

---

## PART 1 — Sabotage moments

### Trigger logic

- 5% chance per round to trigger ONE sabotage event
- Cannot trigger on Round 1 or Round 10 (first impression + final must be clean)
- Cannot trigger twice in same game
- Difficulty Level 4-5 only (don't sabotage easy rounds, feels unfair)

### Sabotage types (pick randomly when triggered)

**Type A: TIME THIEF (40% probability when sabotage fires)**
```
Visual:  Timer briefly flashes red, then jumps from current value to 
         current value minus 10s
Audio:   Glass shatter sound
Text overlay (1.5s): "⚡ AXIOM STOLE YOUR TIME"
Implementation: 
  - At random point between 5s-15s into round
  - setTimeLeft(t => Math.max(5, t - 10))
  - Flash red overlay div 300ms
  - Show banner top-center, fade in/out 1.5s
```

**Type B: REALITY GLITCH (35% probability)**
```
Visual:  All 5 statement cards briefly distort (CSS chromatic aberration)
         Cards flip through random text for 1.5s, then settle
Audio:   Static/TV interference sound
Text overlay: "🌀 GLITCH IN THE MATRIX"
Implementation:
  - Apply CSS filter: hue-rotate animation + skew transform
  - During 1.5s glitch, replace card text with random characters
  - Cards return to original after 1.5s
  - User loses 1.5s of reading time but no other penalty
```

**Type C: PEEK & HIDE (25% probability)**
```
Visual:  One random TRUE statement briefly shows green border (1s)
         Then border disappears, no indication which it was
Audio:   Brief "ding" then silence
Text overlay: "👁 AXIOM SHOWED YOU SOMETHING. TOO LATE."
Implementation:
  - At random point 8s-18s into round
  - Pick one statement.real === true at random
  - Apply green glow border 1000ms then fade
  - Statement text remains, only visual marker disappears
  - User got a 1-second hint they had to catch in real time
```

### Where to add

Create new file: `src/lib/sabotage.js`

```javascript
const SABOTAGE_CONFIG = {
  enabled: true,
  triggerChance: 0.05,
  minRound: 2,
  maxRound: 9,
  minDifficulty: 4,
};

const SABOTAGE_TYPES = {
  TIME_THIEF: { weight: 40, ... },
  REALITY_GLITCH: { weight: 35, ... },
  PEEK_AND_HIDE: { weight: 25, ... },
};

export function shouldTriggerSabotage(round, difficulty, alreadyTriggered) {
  if (!SABOTAGE_CONFIG.enabled) return false;
  if (alreadyTriggered) return false;
  if (round < SABOTAGE_CONFIG.minRound) return false;
  if (round > SABOTAGE_CONFIG.maxRound) return false;
  if (difficulty < SABOTAGE_CONFIG.minDifficulty) return false;
  return Math.random() < SABOTAGE_CONFIG.triggerChance;
}

export function pickSabotageType() {
  // Weighted random pick
  const total = Object.values(SABOTAGE_TYPES).reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const [name, config] of Object.entries(SABOTAGE_TYPES)) {
    r -= config.weight;
    if (r <= 0) return name;
  }
  return "TIME_THIEF";
}
```

In App.jsx, add to round-start useEffect:
```javascript
const sabotageRef = useRef({ triggered: false, type: null, scheduled: null });

useEffect(() => {
  if (gameState !== "playing") return;
  
  sabotageRef.current = { triggered: false, type: null, scheduled: null };
  
  if (shouldTriggerSabotage(currentRound, difficulty, false)) {
    const type = pickSabotageType();
    const delay = 5000 + Math.random() * 10000; // 5-15s into round
    sabotageRef.current.scheduled = setTimeout(() => {
      triggerSabotage(type);
      sabotageRef.current.triggered = true;
    }, delay);
  }
  
  return () => {
    if (sabotageRef.current.scheduled) {
      clearTimeout(sabotageRef.current.scheduled);
    }
  };
}, [currentRound, gameState]);
```

### Telemetry

Log to Firestore `bluff_telemetry` collection:
```
{ event: "sabotage_triggered", type: "TIME_THIEF", round: 5, userId, timestamp }
{ event: "sabotage_user_correct", type: "TIME_THIEF", userId }  // did they still win?
```

This helps tune the trigger chance later.

---

## PART 2 — The Pit (elimination drama)

### Current behavior

When user answers wrong on solo Climb, they fall to last safety net. 
Currently a quick state transition with little visual impact.

### New choreography (3 seconds total)

**Phase 1 (0-500ms): SHOCK**
- Selected wrong card flashes RED (border + glow)
- Screen shake (CSS keyframe)
- Audio: deep BUZZER (low frequency, 200ms)

**Phase 2 (500-2000ms): FALL**
- Camera "drops" — entire UI shifts down 200px with motion blur
- Background gradient transitions from current → black → crimson
- Text "FALLING..." appears huge, white, fades from top
- AXIOM voice line plays (use existing axiom-voice endpoint):
  - Random pick: "Down you go.", "Pathetic.", "I expected more.", 
    "Such promise. Such failure."

**Phase 3 (2000-3000ms): IMPACT + LANDED**
- Sudden stop with bounce animation
- Dust particles burst from bottom of screen
- "FALLEN TO ROUND {N}" appears center, large
- Brief silence, then return to game

### Implementation

New file: `src/components/PitFall.jsx`

```jsx
export function PitFall({ fellToRound, onComplete }) {
  const [phase, setPhase] = useState(0);
  
  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),
      setTimeout(() => setPhase(2), 2000),
      setTimeout(() => onComplete(), 3000),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);
  
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      pointerEvents: "none",
      background: phase === 0 ? "transparent" 
        : phase === 1 ? "linear-gradient(to bottom, transparent, #000)"
        : "linear-gradient(to bottom, #000, #1a0000)",
      transition: "background 1.5s ease",
    }}>
      {phase === 0 && (
        <div className="screen-shake" style={{...}}>
          {/* Empty — shake whole game */}
        </div>
      )}
      {phase === 1 && (
        <div style={{ animation: "fall-down 1.5s ease-in" }}>
          <h1 style={{ fontSize: 60, color: "white", textAlign: "center", marginTop: 100 }}>
            FALLING...
          </h1>
        </div>
      )}
      {phase === 2 && (
        <div style={{ animation: "impact-bounce 0.5s" }}>
          <h1 style={{ fontSize: 80, color: "#e8c547", textAlign: "center", marginTop: "40vh" }}>
            FALLEN TO ROUND {fellToRound}
          </h1>
        </div>
      )}
    </div>
  );
}
```

### Trigger

In existing reveal logic where wrong answer is processed:
```javascript
if (sel !== bluffIndex) {
  // existing logic that drops to safety net
  setShowPitFall(true);
  // After 3s onComplete, continue game flow
}
```

### Audio

Add to `src/sounds/`:
- `pit-buzzer.mp3` — short low buzzer
- `pit-fall.mp3` — wind/falling sound (1.5s)
- `pit-impact.mp3` — heavy thud + dust burst

Use existing AXIOM voice endpoint for the voice lines (4 different lines, randomly picked).

---

## PART 3 — Real-time community presence

### What user sees

Bottom-right toast notifications during Solo play, ~1 every 30s:

```
┌──────────────────────────────────┐
│ 🇧🇷 João just lost on this round │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│ 142 players are choosing now     │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│ 🌍 Top 10% chose A on this one   │
└──────────────────────────────────┘
```

### Important: NOT real-time multiplayer

This is **simulated presence** based on aggregate data. We use telemetry 
from other players (the same `bluff_telemetry` collection from Part 1).

### Server endpoint

New: `api/community-pulse.js`

```javascript
// GET /api/community-pulse?roundId=xxx
// Returns aggregate data for the toast system
{
  activePlayersNow: 142,        // estimated, not exact
  recentEvent: {
    type: "loss" | "win" | "streak",
    flag: "🇧🇷",
    handle: "João",
    age: 12,                    // seconds ago
  },
  topChoice: {                  // for current round if known
    answer: "A",
    percent: 67
  }
}
```

Client polls this every 25-35s during solo play (jittered to avoid sync).

### Implementation

New file: `src/lib/communityPulse.js`

```javascript
const TOAST_INTERVAL_MIN = 25000;
const TOAST_INTERVAL_MAX = 35000;

export function startCommunityPulse(onToast) {
  let active = true;
  
  async function poll() {
    if (!active) return;
    try {
      const res = await fetch("/api/community-pulse?roundId=current");
      const data = await res.json();
      const toast = pickToast(data);
      if (toast) onToast(toast);
    } catch {}
    
    const delay = TOAST_INTERVAL_MIN + Math.random() * (TOAST_INTERVAL_MAX - TOAST_INTERVAL_MIN);
    setTimeout(poll, delay);
  }
  
  setTimeout(poll, 5000); // first toast after 5s
  return () => { active = false; };
}

function pickToast(data) {
  // 30% activity count, 50% recent event, 20% topChoice
  const r = Math.random();
  if (r < 0.3) return { type: "count", text: `${data.activePlayersNow} players are choosing now` };
  if (r < 0.8 && data.recentEvent) {
    const { type, flag, handle } = data.recentEvent;
    if (type === "loss") return { type: "event", text: `${flag} ${handle} just lost on this round` };
    if (type === "win") return { type: "event", text: `${flag} ${handle} just nailed it 🎯` };
    if (type === "streak") return { type: "event", text: `${flag} ${handle} hit a 5-streak 🔥` };
  }
  if (data.topChoice) {
    return { type: "stat", text: `Top 10% chose ${data.topChoice.answer} on this one` };
  }
  return null;
}
```

### Toast UI component

`src/components/CommunityToast.jsx`:

```jsx
export function CommunityToast({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [toast]);
  
  return (
    <div style={{
      position: "fixed", bottom: 20, right: 20,
      background: "rgba(20, 20, 28, 0.95)",
      border: "1px solid rgba(232, 197, 71, 0.3)",
      borderRadius: 12, padding: "12px 16px",
      color: "#e8e6e1", fontSize: 13,
      backdropFilter: "blur(10px)",
      animation: "slide-in-right 300ms, fade-out 500ms 3500ms",
      zIndex: 50,
    }}>
      {toast.text}
    </div>
  );
}
```

### Privacy

- Use only handles (not real names)
- Use only flags (not city/IP)
- Don't show events from logged-out anonymous users (only Pro/registered)
- Aggregate counts must be >5 before showing (don't reveal small communities)

---

## PART 4 — AXIOM physical reactions

### Two new reactions

**Reaction 1: AXIOM laughs after user wins a round (Round 5+)**
- Brief 1.5s animation: AXIOM avatar (existing) zooms in slightly
- Smile emoji or laugh animation overlay
- AXIOM voice: "Lucky." or "I let you have that one."
- Shows in the reveal screen, just before next round button

**Reaction 2: AXIOM mocks after user loses (any round)**
- 1.5s during Pit fall (overlap with Part 2)
- AXIOM avatar appears in corner with smug expression
- Voice line plays (already in Pit fall — coordinate)
- Avatar fades out as game returns

### Implementation

`src/components/AxiomReaction.jsx`:

```jsx
const REACTIONS = {
  LAUGH: {
    emoji: "😂",
    voiceLines: ["Lucky.", "I let you have that one.", "Coincidence."],
    duration: 1500,
  },
  MOCK: {
    emoji: "😏",
    voiceLines: ["Pathetic.", "I expected more.", "Predictable."],
    duration: 1500,
  },
};

export function AxiomReaction({ type, onComplete }) {
  const reaction = REACTIONS[type];
  
  useEffect(() => {
    // Trigger voice via existing axiom-voice endpoint
    const line = reaction.voiceLines[Math.floor(Math.random() * reaction.voiceLines.length)];
    fetch("/api/axiom-voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: line }),
    }).then(res => res.blob()).then(blob => {
      const audio = new Audio(URL.createObjectURL(blob));
      audio.play();
    }).catch(() => {});
    
    setTimeout(onComplete, reaction.duration);
  }, []);
  
  return (
    <div style={{
      position: "fixed", top: 20, right: 20,
      background: "rgba(232, 197, 71, 0.1)",
      border: "2px solid #e8c547",
      borderRadius: "50%", width: 80, height: 80,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 40,
      animation: "axiom-pulse 1.5s ease",
      zIndex: 100,
    }}>
      {reaction.emoji}
    </div>
  );
}
```

### Trigger points

In reveal logic:
- User correct AND round >= 5 → trigger AxiomReaction type=LAUGH
- User wrong → AXIOM mock plays inside Pit Fall (Part 2 handles voice)

---

## TESTING (after deploy)

### Test 1 — Sabotage trigger
- Play 20 solo games on Devious/Diabolical
- Expect ~1 sabotage event total (5% of ~20 rounds with eligible difficulty)
- Verify all 3 types fire at least once

### Test 2 — Pit fall
- Intentionally fail a Round 6+ question
- Verify 3-second animation plays
- Verify AXIOM voice line plays
- Verify game continues to safety net after

### Test 3 — Community toasts
- Play one game
- Verify 1-3 toasts appear during game (depends on game length)
- Verify toasts auto-dismiss after 4s
- Verify toasts don't overlap (queue if multiple)

### Test 4 — AXIOM reactions
- Win Round 5+ → expect laugh emoji + voice
- Lose any round → expect mock emoji + voice (during Pit fall)

### Test 5 — Performance
- All animations must run at 60fps on iPhone 12 or newer
- Sabotage glitch effect must not cause memory leaks (test 50 rounds back-to-back)
- Audio must preload (no delay when triggers fire)

---

## DEPLOY

```bash
npx vite build 2>&1 | tail -10

git add src/lib/sabotage.js src/lib/communityPulse.js \
        src/components/PitFall.jsx src/components/CommunityToast.jsx \
        src/components/AxiomReaction.jsx \
        src/App.jsx src/sounds/ \
        api/community-pulse.js

git diff --cached --stat

git commit -m "feat(drama): Phase 1 Arena drama elements in solo mode

User feedback: BLUFF feels static, like a 1956 crossword puzzle.
This adds 3 drama systems before full Arena (Phase 2) ships.

CHANGES:

1. Sabotage moments (5% chance, Levels 4-5):
   - TIME THIEF: timer jumps -10s
   - REALITY GLITCH: cards distort 1.5s
   - PEEK AND HIDE: one true statement briefly highlighted
   New: src/lib/sabotage.js

2. The Pit elimination drama (3-second sequence):
   - Phase 1: shock + screen shake + buzzer
   - Phase 2: fall animation + AXIOM voice
   - Phase 3: impact + 'FALLEN TO ROUND N'
   New: src/components/PitFall.jsx + 3 sound files

3. Community presence toasts (every 25-35s):
   - Show aggregate player counts
   - Show recent events from other players
   - Show 'Top 10% chose X' insight
   - Privacy: only registered users, only flag+handle
   New: src/lib/communityPulse.js + api/community-pulse.js
   New: src/components/CommunityToast.jsx

4. AXIOM physical reactions:
   - Laugh after user wins (Round 5+)
   - Mock during Pit fall
   - Voice lines via existing axiom-voice endpoint
   New: src/components/AxiomReaction.jsx

Telemetry added for sabotage tuning (bluff_telemetry collection).

Phase 2 (Arena MVP, multiplayer 10-player rooms) is separate task,
NOT included here.

Ref: BLUFF-ARENA-DESIGN-DOC.md"

git push origin main
```

---

## REPORT BACK

After deploy:
1. Commit SHA
2. Bundle size delta (should be <50KB increase)
3. Confirmation all 4 features render in production
4. Any unexpected behavior during testing

If audio files are not provided (sound assets missing), CC should:
- Use Web Audio API to generate basic procedural sounds, OR
- Note the missing files and ship without audio (visuals only)

User will provide sound assets later if needed.

---

## CONSTRAINTS

- Do NOT touch Arena logic (Phase 2)
- Do NOT change scoring or difficulty curves
- Do NOT add new dependencies (use existing tools)
- Performance: 60fps on iPhone 12+
- All features should work in en/sr/hr languages

---

## What this changes for users

Before:
- Round 8: Pick A. Wrong. "You fell to Round 5." Continue.

After:
- Round 8: Pick A. Wrong. SHAKE. Screen falls. AXIOM laughs in your ear. 
  "Pathetic." Crimson background. Dust. "FALLEN TO ROUND 5." Continue.
- Plus, midway through the round, screen had glitched briefly. You weren't 
  sure what you saw. Toast in corner: "🇧🇷 João just lost on this round."
- After winning Round 5, AXIOM laughs at you anyway: "I let you have that one."

Same game. Completely different feeling.

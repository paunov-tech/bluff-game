import { useState, useEffect, useRef } from "react";

const MOUTH_SHAPES = {
  closed:  "M 35,65 Q 50,65 65,65",
  slight:  "M 35,63 Q 50,68 65,63",
  open_s:  "M 38,62 Q 50,70 62,62 Q 50,66 38,62",
  open_m:  "M 35,60 Q 50,72 65,60 Q 50,68 35,60",
  open_w:  "M 33,58 Q 50,75 67,58 Q 50,70 33,58",
  smirk:   "M 38,65 Q 52,62 65,60",
  frown:   "M 35,68 Q 50,62 65,68",
  grimace: "M 33,62 Q 50,70 67,62 M 36,66 L 64,66",
};

const EYE_SHAPES = {
  normal:  { ry: 9, opacity: 1 },
  narrow:  { ry: 4, opacity: 1 },
  wide:    { ry: 14, opacity: 1 },
  wink:    { ry: 1, opacity: 1 },
  nervous: { ry: 7, opacity: 1, animation: "ax-nervousBlink 0.3s infinite" },
};

export function AxiosFace({ emotion = "idle", speaking = false, ladderPosition = 1, eyeTrack = false }) {
  const [mouthIdx, setMouthIdx] = useState(0);
  const [blinkState, setBlinkState] = useState(false);
  const [gazeOffset, setGazeOffset] = useState({ x: 0, y: 0 });
  const rawGaze = useRef({ x: 0, y: 0 });
  const smoothGaze = useRef({ x: 0, y: 0 });

  // Eye tracking with creepy lag (lerp factor 0.04 = delayed follow)
  useEffect(() => {
    if (!eyeTrack) { setGazeOffset({ x: 0, y: 0 }); return; }
    const track = (e) => {
      const x = (e.touches?.[0]?.clientX ?? e.clientX) / window.innerWidth;
      const y = (e.touches?.[0]?.clientY ?? e.clientY) / window.innerHeight;
      rawGaze.current = { x: x * 2 - 1, y: y * 2 - 1 };
    };
    window.addEventListener("mousemove", track);
    window.addEventListener("touchmove", track, { passive: true });
    const lag = setInterval(() => {
      const lf = 0.04;
      smoothGaze.current = {
        x: smoothGaze.current.x + (rawGaze.current.x - smoothGaze.current.x) * lf,
        y: smoothGaze.current.y + (rawGaze.current.y - smoothGaze.current.y) * lf,
      };
      setGazeOffset({ ...smoothGaze.current });
    }, 16);
    return () => {
      window.removeEventListener("mousemove", track);
      window.removeEventListener("touchmove", track);
      clearInterval(lag);
    };
  }, [eyeTrack]);

  // Lip sync
  useEffect(() => {
    if (!speaking) { setMouthIdx(0); return; }
    const shapes = ["open_s", "open_m", "open_w", "open_m", "open_s", "slight", "closed", "open_s"];
    let i = 0;
    const interval = setInterval(() => {
      setMouthIdx(i % shapes.length);
      i++;
    }, 110);
    return () => clearInterval(interval);
  }, [speaking]);

  // Natural blink cycle
  useEffect(() => {
    const blink = () => {
      setBlinkState(true);
      setTimeout(() => setBlinkState(false), 120);
    };
    const interval = setInterval(blink, 2800 + Math.random() * 2000);
    return () => clearInterval(interval);
  }, []);

  const axColor = ladderPosition <= 3 ? "#4a9eff"
    : ladderPosition <= 6 ? "#e8c547"
    : ladderPosition <= 8 ? "#ff8c42"
    : "#ff3366";

  const mouthKeys = Object.keys(MOUTH_SHAPES);
  const currentMouth = speaking
    ? mouthKeys[mouthIdx % mouthKeys.length]
    : emotion === "smug" ? "smirk"
    : emotion === "shocked" ? "open_w"
    : emotion === "taunting" ? "open_m"
    : emotion === "defeated" ? "frown"
    : "slight";

  const eyeScale = blinkState ? 0.05
    : emotion === "shocked" ? 1.5
    : emotion === "thinking" || emotion === "smug" ? 0.45
    : emotion === "nervous" ? (Math.random() > 0.7 ? 0.1 : 1)
    : 1;

  const containerAnim = emotion === "nervous" ? "ax-shake 0.15s infinite"
    : emotion === "defeated" ? "ax-meltdown 0.5s ease-in-out infinite"
    : emotion === "thinking" ? "ax-tilt 2s ease-in-out infinite"
    : "ax-breathe 4s ease-in-out infinite";

  return (
    <div style={{
      position: "relative",
      width: 110, height: 110,
      animation: containerAnim,
    }}>
      {/* Outer glow ring */}
      <div style={{
        position: "absolute", inset: -4, borderRadius: "50%",
        boxShadow: `0 0 ${emotion === "defeated" ? 40 : 20}px ${axColor}`,
        opacity: emotion === "defeated" ? 1 : 0.4,
        animation: emotion === "taunting" ? "ax-tauntGlow 0.3s infinite" : "none",
        transition: "all 0.4s",
      }} />

      <svg viewBox="0 0 100 100" width={110} height={110}>
        <defs>
          <pattern id="ax-scanlines" x="0" y="0" width="100" height="3" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="100" height="1" fill="white"/>
          </pattern>
          <radialGradient id="ax-irisGrad" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stopColor="white" stopOpacity="0.9"/>
            <stop offset="40%" stopColor={axColor} stopOpacity="1"/>
            <stop offset="100%" stopColor="#000" stopOpacity="1"/>
          </radialGradient>
        </defs>

        {/* Face background */}
        <circle cx="50" cy="50" r="46"
          fill="#0d0d1a"
          stroke={axColor} strokeWidth="2"
          style={{ filter: `drop-shadow(0 0 8px ${axColor}40)` }}
        />

        {/* Scan line overlay */}
        <rect x="4" y="4" width="92" height="92" rx="42"
          fill="url(#ax-scanlines)" opacity="0.08"
        />

        {/* LEFT EYE */}
        <g>
          <ellipse cx="33" cy="42" rx="10" ry={10 * eyeScale}
            fill="url(#ax-irisGrad)"
            style={{ transition: "ry 0.08s" }}
          />
          <ellipse cx="33" cy="42" rx="10" ry={10 * eyeScale}
            fill="none" stroke={axColor} strokeWidth="1"
            opacity="0.6"
            style={{ filter: `drop-shadow(0 0 4px ${axColor})` }}
          />
          <circle
            cx={33 + gazeOffset.x * 3} cy={42 + gazeOffset.y * 2}
            r={3 * Math.min(eyeScale, 1)}
            fill="#000" opacity={eyeScale > 0.2 ? 1 : 0}
          />
        </g>

        {/* RIGHT EYE */}
        <g>
          <ellipse cx="67" cy="42" rx="10" ry={10 * eyeScale}
            fill="url(#ax-irisGrad)"
            style={{ transition: "ry 0.08s" }}
          />
          <ellipse cx="67" cy="42" rx="10" ry={10 * eyeScale}
            fill="none" stroke={axColor} strokeWidth="1" opacity="0.6"
            style={{ filter: `drop-shadow(0 0 4px ${axColor})` }}
          />
          <circle
            cx={67 + gazeOffset.x * 3} cy={42 + gazeOffset.y * 2}
            r={3 * Math.min(eyeScale, 1)}
            fill="#000" opacity={eyeScale > 0.2 ? 1 : 0}
          />
        </g>

        {/* NOSE LINE */}
        <line x1="50" y1="50" x2="50" y2="57"
          stroke={axColor} strokeWidth="1" opacity="0.3"
        />

        {/* MOUTH */}
        <path
          d={MOUTH_SHAPES[currentMouth]}
          fill={currentMouth.startsWith("open") ? "#00000080" : "none"}
          stroke={axColor} strokeWidth="2.5"
          strokeLinecap="round"
          style={{
            transition: "d 0.08s",
            filter: `drop-shadow(0 0 3px ${axColor})`,
          }}
        />

        {/* SENTIMENT BAR */}
        <rect x="20" y="82" width="60" height="3" rx="1.5"
          fill={axColor} opacity="0.2"
        />
        <rect x="20" y="82"
          width={
            emotion === "shocked" || emotion === "nervous" ? 60
            : emotion === "taunting" || emotion === "smug" ? 45
            : emotion === "defeated" ? 5
            : 30
          }
          height="3" rx="1.5"
          fill={axColor}
          style={{ transition: "width 0.8s ease" }}
        />

        {/* DEFEATED: crack lines */}
        {emotion === "defeated" && (
          <>
            <line x1="30" y1="20" x2="45" y2="45" stroke="#f43f5e" strokeWidth="1" opacity="0.6"/>
            <line x1="55" y1="15" x2="70" y2="50" stroke="#f43f5e" strokeWidth="1" opacity="0.4"/>
            <line x1="60" y1="60" x2="80" y2="75" stroke="#f43f5e" strokeWidth="1" opacity="0.5"/>
          </>
        )}

        {/* NERVOUS: sweat drop */}
        {emotion === "nervous" && (
          <ellipse cx="78" cy="35" rx="3" ry="5"
            fill="#4a9eff" opacity="0.6"
            style={{ animation: "ax-sweatDrop 1.2s ease-in infinite" }}
          />
        )}
      </svg>

      {/* AXIOS label */}
      <div style={{
        position: "absolute", bottom: -18, left: 0, right: 0,
        textAlign: "center", fontSize: 9, letterSpacing: 4,
        color: axColor, opacity: 0.7, textTransform: "uppercase",
        fontWeight: 600,
      }}>AXIOS</div>
    </div>
  );
}

export function AxiosBubble({ text, visible }) {
  return (
    <div style={{
      maxWidth: 200, padding: "10px 14px",
      background: "rgba(13,13,26,0.95)",
      border: "1px solid rgba(232,197,71,0.2)",
      borderRadius: "0 16px 16px 16px",
      fontSize: 13, lineHeight: 1.5, color: "#e8e6e1",
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0) scale(1)" : "translateY(8px) scale(0.95)",
      transition: "all 0.3s cubic-bezier(0.34,1.56,0.64,1)",
      fontStyle: "italic",
    }}>
      &ldquo;{text}&rdquo;
    </div>
  );
}

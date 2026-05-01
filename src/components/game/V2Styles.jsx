// Keyframes the V2 phases + drama overlays depend on. The legacy
// `<GameStyles/>` (defined privately inside App.jsx) defines the full
// catalog for the legacy Climb screen — V2 doesn't render that wrapper,
// so we ship a focused subset here.
//
// Includes:
//   - PitFall choreography (pit-shake, pit-flash, pit-streaks, pit-fall-text,
//     pit-impact-bounce, pit-dust)
//   - AxiomReaction pulse
//   - CommunityToast slide-in/out
//   - Sabotage banner + glitch + flash + peek glow
//   - g-flash-in used by BlindMath's op card
//   - sabotage-banner-crimson — NEW for SuddenDeath crimson palette
export function V2Styles() {
  return <style>{`
    @keyframes g-flash-in {
      from { opacity: 0; transform: scale(.5); }
      to   { opacity: 1; transform: scale(1); }
    }
    /* === PitFall === */
    @keyframes pit-flash{
      0%{opacity:0}30%{opacity:1}100%{opacity:0}
    }
    @keyframes pit-shake{
      0%,100%{transform:translate(0,0)}
      25%{transform:translate(-6px,4px) rotate(-0.4deg)}
      50%{transform:translate(7px,-5px) rotate(0.4deg)}
      75%{transform:translate(-4px,-6px) rotate(-0.2deg)}
    }
    @keyframes pit-streaks{
      0%{transform:translateY(-100%);opacity:0.4}
      100%{transform:translateY(100%);opacity:0.7}
    }
    @keyframes pit-fall-text{
      0%{transform:translateY(-180px) scale(0.6);opacity:0;filter:blur(8px)}
      30%{opacity:1;filter:blur(0)}
      100%{transform:translateY(40vh) scale(1.4);opacity:0;filter:blur(2px)}
    }
    @keyframes pit-impact-bounce{
      0%{transform:translateY(-50px) scale(1.4);opacity:0}
      40%{transform:translateY(20px) scale(0.92);opacity:1}
      70%{transform:translateY(-10px) scale(1.04)}
      100%{transform:translateY(0) scale(1);opacity:1}
    }
    @keyframes pit-dust{
      0%{transform:translate(0,0) scale(0.4);opacity:0}
      30%{opacity:0.7}
      100%{transform:translate(var(--pit-dust-x,0),-220px) scale(1.4);opacity:0}
    }
    /* === AxiomReaction === */
    @keyframes axiom-reaction-pulse{
      0%{opacity:0;transform:scale(0.3) rotate(-12deg)}
      30%{opacity:1;transform:scale(1.18) rotate(8deg)}
      55%{transform:scale(0.96) rotate(-3deg)}
      80%{opacity:1;transform:scale(1.05) rotate(0)}
      100%{opacity:0;transform:scale(1) rotate(0)}
    }
    /* === CommunityToast === */
    @keyframes community-toast-in{
      from{opacity:0;transform:translateX(20px)}
      to{opacity:1;transform:translateX(0)}
    }
    @keyframes community-toast-out{
      from{opacity:1;transform:translateX(0)}
      to{opacity:0;transform:translateX(20px)}
    }
    /* === Sabotage === */
    @keyframes sabotage-flash{
      0%{opacity:0} 20%{opacity:0.55} 100%{opacity:0}
    }
    @keyframes sabotage-banner{
      0%{opacity:0;transform:translate(-50%,-30px) scale(0.8)}
      20%{opacity:1;transform:translate(-50%,0) scale(1.05)}
      40%{transform:translate(-50%,0) scale(1)}
      80%{opacity:1}
      100%{opacity:0;transform:translate(-50%,-12px) scale(0.95)}
    }
    @keyframes sabotage-glitch{
      0%,100%{filter:none;transform:translate(0,0)}
      15%{filter:hue-rotate(60deg) saturate(1.4) contrast(1.2);transform:translate(-2px,1px) skewX(-1.5deg)}
      30%{filter:hue-rotate(-30deg) saturate(1.6);transform:translate(3px,-2px) skewX(1.2deg)}
      45%{filter:hue-rotate(120deg) contrast(1.3);transform:translate(-1px,2px) skewX(-0.6deg)}
      60%{filter:hue-rotate(-90deg) saturate(0.6);transform:translate(2px,1px) skewX(1deg)}
      80%{filter:hue-rotate(45deg);transform:translate(-1px,0) skewX(-0.4deg)}
    }
    @keyframes peek-glow{
      0%{box-shadow:0 0 0 rgba(45,212,160,0)}
      50%{box-shadow:0 0 18px rgba(45,212,160,.6)}
      100%{box-shadow:0 0 0 rgba(45,212,160,0)}
    }
    /* NEW: SuddenDeath crimson sabotage banner shake */
    @keyframes crimson-shake{
      0%,100%{transform:translate(-50%,-50%) translateX(0)}
      25%{transform:translate(-50%,-50%) translateX(-8px)}
      75%{transform:translate(-50%,-50%) translateX(8px)}
    }
  `}</style>;
}

export default V2Styles;

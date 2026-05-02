import { BlackjackModule }  from "../components/modules/blackjack/BlackjackModule.jsx";
import { ClassicModule }    from "../components/modules/classic/ClassicModule.jsx";
import { BlindMathModule }  from "../components/modules/blindmath/BlindMathModule.jsx";
import { SniperModule }     from "../components/modules/sniper/SniperModule.jsx";

// The fixed PLAY flow. BluffEngine renders these in order. To add a new
// module: append below + ensure it conforms to ArenaModule (see arena.js).
// To temporarily remove: comment out the entry; no other code touches.
//
// `config` is passed to each module verbatim — modules pick keys they care
// about and ignore the rest. This keeps the registry the single source of
// truth for difficulty curves / round counts across the flow.
export const FLOW_MODULES = [
  {
    id:          "blackjack",
    nameKey:     "modules.blackjack.title",
    descKey:     "modules.blackjack.subtitle",
    component:   BlackjackModule,
    icon:        "🎴",
  },
  {
    id:          "classic_set_1",
    nameKey:     "modules.classic.set_1",
    descKey:     "modules.classic.subtitle",
    component:   ClassicModule,
    icon:        "🎯",
    config: { roundCount: 5, difficultyMin: 2, difficultyMax: 3, soloPhase: "first" },
  },
  {
    id:          "blindmath",
    nameKey:     "modules.blindmath.title",
    descKey:     "modules.blindmath.subtitle",
    component:   BlindMathModule,
    icon:        "🧠",
  },
  {
    id:          "classic_set_2",
    nameKey:     "modules.classic.set_2",
    descKey:     "modules.classic.subtitle",
    component:   ClassicModule,
    icon:        "🎯",
    config: { roundCount: 5, difficultyMin: 3, difficultyMax: 4, soloPhase: "first" },
  },
  {
    id:          "sniper",
    nameKey:     "modules.sniper.title",
    descKey:     "modules.sniper.subtitle",
    component:   SniperModule,
    icon:        "🎯",
  },
  {
    id:          "classic_final",
    nameKey:     "modules.classic.final_set",
    descKey:     "modules.classic.subtitle",
    component:   ClassicModule,
    icon:        "🎯",
    config: { roundCount: 5, difficultyMin: 4, difficultyMax: 5, soloPhase: "second" },
  },
];

export function moduleById(id) {
  return FLOW_MODULES.find(m => m.id === id) || null;
}

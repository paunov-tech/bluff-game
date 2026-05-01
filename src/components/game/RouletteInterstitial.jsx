import { useState } from "react";
import { useGameActions, useSwear } from "./GameContext.jsx";

// Between-phase wager beat. Player stakes SWEAR on a roulette outcome:
//   GREEN (50/50)  → 2x return
//   GOLD  (~33%)   → 3x return
//   RED   (~16%)   → 6x return, but a miss is a total loss.
//
// Skipping is always allowed; this is a side-bet, not a gate.

const ZONES = [
  { key: "GREEN", multiplier: 2, weight: 50 },
  { key: "GOLD",  multiplier: 3, weight: 33 },
  { key: "RED",   multiplier: 6, weight: 17 },
];

function spinZone() {
  const total = ZONES.reduce((s, z) => s + z.weight, 0);
  let n = Math.random() * total;
  for (const z of ZONES) {
    if (n < z.weight) return z.key;
    n -= z.weight;
  }
  return ZONES[0].key;
}

export function RouletteInterstitial({ lang = "en", nextPhase, onComplete, onSkip }) {
  const swear = useSwear();
  const { spendSwear, addSwear } = useGameActions();

  const [stake, setStake] = useState(0);
  const [pick, setPick] = useState("GREEN");
  const [spinning, setSpinning] = useState(false);
  const [outcome, setOutcome] = useState(null);

  const canBet = stake > 0 && stake <= swear && !spinning && !outcome;

  function placeBet() {
    if (!canBet) return;
    spendSwear(stake);
    setSpinning(true);

    setTimeout(() => {
      const winningZone = spinZone();
      const won = winningZone === pick;
      const zone = ZONES.find(z => z.key === pick);
      const payout = won ? stake * zone.multiplier : 0;
      if (payout > 0) addSwear(payout);
      setOutcome({ winningZone, won, payout });
      setSpinning(false);
    }, 1500);
  }

  return (
    <div style={wrap}>
      <div style={label}>NEXT PHASE → {nextPhase || "—"}</div>
      <h2 style={title}>SWEAR Roulette</h2>
      <div style={balance}>Balance: <b>{swear}</b> SWEAR</div>

      {!outcome && (
        <>
          <div style={row}>
            {ZONES.map(z => (
              <button
                key={z.key}
                onClick={() => setPick(z.key)}
                disabled={spinning}
                style={{ ...zoneBtn, ...(pick === z.key ? zoneBtnActive : null) }}
              >
                <div style={{ fontWeight: 700 }}>{z.key}</div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{z.multiplier}×</div>
              </button>
            ))}
          </div>

          <div style={row}>
            <input
              type="number"
              min={0}
              max={swear}
              value={stake}
              onChange={(e) => setStake(Math.max(0, Math.min(swear, Number(e.target.value) || 0)))}
              disabled={spinning}
              style={input}
            />
            <button onClick={placeBet} disabled={!canBet} style={primaryBtn}>
              {spinning ? "Spinning…" : "Spin"}
            </button>
            <button onClick={onSkip} disabled={spinning} style={secondaryBtn}>Skip</button>
          </div>
        </>
      )}

      {outcome && (
        <div style={resultBox}>
          <div style={{ fontSize: 14, opacity: 0.7 }}>Wheel landed on</div>
          <div style={{ fontSize: 32, fontWeight: 700, margin: "8px 0" }}>{outcome.winningZone}</div>
          <div style={{ color: outcome.won ? "#2dd4a0" : "#f43f5e", fontWeight: 600 }}>
            {outcome.won ? `+${outcome.payout} SWEAR` : `−${stake} SWEAR`}
          </div>
          <button onClick={onComplete} style={{ ...primaryBtn, marginTop: 16 }}>Continue</button>
        </div>
      )}
    </div>
  );
}

const wrap = {
  display: "flex", flexDirection: "column", alignItems: "center",
  padding: 24, color: "#e8e6e1", fontFamily: "inherit", gap: 12,
};
const label = { fontSize: 11, letterSpacing: 3, opacity: 0.5 };
const title = { margin: 0, fontFamily: "Georgia, serif", color: "#e8c547" };
const balance = { fontSize: 14, opacity: 0.8 };
const row = { display: "flex", gap: 8, alignItems: "center", marginTop: 12 };
const zoneBtn = {
  padding: "12px 18px", borderRadius: 12, background: "rgba(255,255,255,.04)",
  border: "1.5px solid rgba(255,255,255,.07)", color: "#e8e6e1", cursor: "pointer",
  minWidth: 80, fontFamily: "inherit",
};
const zoneBtnActive = { borderColor: "#e8c547", background: "rgba(232,197,71,.1)" };
const input = {
  width: 100, padding: 10, borderRadius: 8,
  background: "rgba(255,255,255,.04)", border: "1.5px solid rgba(255,255,255,.07)",
  color: "#e8e6e1", fontFamily: "inherit",
};
const primaryBtn = {
  padding: "10px 20px", borderRadius: 10, background: "#e8c547",
  color: "#04060f", border: "none", fontWeight: 700, cursor: "pointer",
  fontFamily: "inherit",
};
const secondaryBtn = {
  padding: "10px 20px", borderRadius: 10, background: "transparent",
  color: "#e8e6e1", border: "1.5px solid rgba(255,255,255,.12)",
  fontFamily: "inherit", cursor: "pointer",
};
const resultBox = { textAlign: "center", marginTop: 16 };

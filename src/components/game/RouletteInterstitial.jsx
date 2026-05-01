import { useState } from "react";
import { useGameActions, useSwear } from "./GameContext.jsx";
import { captureEvent } from "../../lib/telemetry.js";

// V2 Roulette — between-phase power-up wager.
//
//   Pick a colour, stake SWEAR, spin.
//     GREEN  ~50%   → wins POINTS_2X effect for the next phase
//     GOLD   ~33%   → wins SHIELD effect (Classic phase removes one wrong option)
//     RED    ~17%   → if you win, applies TIMER_CUT to AXIOM in the next
//                     phase (red is high-risk for AXIOM, not for you)
//
//   Payout on win: stake × 2 returned + the effect granted.
//   Loss: stake forfeited, no effect granted.
//   Skip is always allowed — this is a side-bet, not a gate.

const ZONES = [
  { key: "GREEN", weight: 50, multiplier: 2, effect: { type: "POINTS_2X" }, label: "GREEN", subtitle: "2× points" },
  { key: "GOLD",  weight: 33, multiplier: 2, effect: { type: "SHIELD" },    label: "GOLD",  subtitle: "Shield" },
  { key: "RED",   weight: 17, multiplier: 2, effect: { type: "TIMER_CUT" }, label: "RED",   subtitle: "AXIOM −5s" },
];

const T = {
  bg: "#04060f", gold: "#e8c547",
  ok: "#2dd4a0", bad: "#f43f5e", dim: "#5a5a68",
  glass: "rgba(255,255,255,.03)", gb: "rgba(255,255,255,.07)",
};

function spinZone() {
  const total = ZONES.reduce((s, z) => s + z.weight, 0);
  let n = Math.random() * total;
  for (const z of ZONES) {
    if (n < z.weight) return z.key;
    n -= z.weight;
  }
  return ZONES[0].key;
}

const SPIN_MS = 1500;

export function RouletteInterstitial({ lang = "en", nextPhase, onComplete, onSkip }) {
  const swear = useSwear();
  const { spendSwear, addSwear, addEffect } = useGameActions();

  const [pick, setPick]         = useState("GREEN");
  const [stake, setStake]       = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult]     = useState(null);

  const canBet = stake > 0 && stake <= swear && !spinning && !result;
  const pickedZone = ZONES.find(z => z.key === pick) || ZONES[0];

  function handleSpin() {
    if (!canBet) return;
    spendSwear(stake);
    setSpinning(true);
    captureEvent("v2_roulette_played", { stake, choice: pick, nextPhase });

    setTimeout(() => {
      const winningZone = spinZone();
      const won = winningZone === pick;
      const payout = won ? stake * pickedZone.multiplier : 0;
      let grantedEffect = null;
      if (won) {
        if (payout > 0) addSwear(payout);
        grantedEffect = addEffect(pickedZone.effect);
      }
      setResult({ winningZone, won, payout, grantedEffect });
      setSpinning(false);
      captureEvent("v2_roulette_settled", {
        choice: pick, winningZone, won, payout, effectType: grantedEffect?.type || null,
      });
    }, SPIN_MS);
  }

  function handleSkip() {
    captureEvent("v2_roulette_skipped", { nextPhase });
    onSkip?.();
  }

  return (
    <div style={wrap()}>
      <div style={topbar()}>
        <span style={{ fontSize: 11, letterSpacing: 3, color: T.dim, textTransform: "uppercase" }}>
          Next: {nextPhase || "—"}
        </span>
      </div>

      <div style={body()}>
        <div style={{ fontSize: 11, letterSpacing: 3, color: T.gold, textTransform: "uppercase" }}>
          Roulette
        </div>
        <h2 style={title()}>Wager a power-up</h2>
        <div style={{ color: T.dim, fontSize: 12, marginBottom: 18 }}>
          Balance: <b style={{ color: "#e8e6e1" }}>{swear}</b> SWEAR
        </div>

        {!result && (
          <>
            <div style={zoneRow()}>
              {ZONES.map(z => {
                const active = pick === z.key;
                return (
                  <button
                    key={z.key}
                    onClick={() => setPick(z.key)}
                    disabled={spinning}
                    style={zoneBtn(z.key, active, spinning)}
                  >
                    <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 1.5 }}>{z.label}</div>
                    <div style={{ fontSize: 11, opacity: 0.85, marginTop: 4 }}>{z.subtitle}</div>
                    <div style={{ fontSize: 10, opacity: 0.6, marginTop: 6 }}>{z.weight}%</div>
                  </button>
                );
              })}
            </div>

            <div style={stakeRow()}>
              <button onClick={() => setStake(s => Math.max(0, s - 1))} disabled={spinning} style={stepBtn()}>−</button>
              <input
                type="number" min={0} max={swear} value={stake}
                onChange={(e) => setStake(Math.max(0, Math.min(swear, Number(e.target.value) || 0)))}
                disabled={spinning}
                style={stakeInput()}
              />
              <button onClick={() => setStake(s => Math.min(swear, s + 1))} disabled={spinning} style={stepBtn()}>+</button>
              <button onClick={() => setStake(swear)} disabled={spinning || swear === 0} style={maxBtn()}>MAX</button>
            </div>

            <div style={actionRow()}>
              <button onClick={handleSpin} disabled={!canBet} style={spinBtn(!canBet)}>
                {spinning ? "Spinning…" : `Spin · ${stake} SWEAR`}
              </button>
              <button onClick={handleSkip} disabled={spinning} style={skipBtn()}>Skip</button>
            </div>

            {swear === 0 && (
              <div style={{ marginTop: 12, fontSize: 11, color: T.dim }}>
                No SWEAR yet — earn some in the next phase, then wager.
              </div>
            )}
          </>
        )}

        {result && (
          <div style={resultBox()}>
            <div style={{ fontSize: 11, letterSpacing: 3, color: T.dim }}>WHEEL LANDED ON</div>
            <div style={{
              fontSize: 36, fontWeight: 900, fontFamily: "Georgia, serif",
              margin: "8px 0", color: zoneColor(result.winningZone),
            }}>
              {result.winningZone}
            </div>
            <div style={{
              fontSize: 14, fontWeight: 700, marginBottom: 12,
              color: result.won ? T.ok : T.bad,
            }}>
              {result.won
                ? `Won +${result.payout} SWEAR · ${effectLabel(result.grantedEffect?.type)} active next phase`
                : `Lost ${stake} SWEAR`}
            </div>
            <button onClick={onComplete} style={spinBtn(false)}>Continue</button>
          </div>
        )}
      </div>
    </div>
  );
}

function zoneColor(key) {
  if (key === "GREEN") return T.ok;
  if (key === "GOLD")  return T.gold;
  return T.bad;
}

function effectLabel(type) {
  if (type === "POINTS_2X") return "2× points";
  if (type === "SHIELD")    return "Shield";
  if (type === "TIMER_CUT") return "AXIOM −5s";
  return "—";
}

function wrap() {
  return {
    minHeight: "100dvh",
    background: `radial-gradient(ellipse at 50% 0%, rgba(232,197,71,.08) 0%, ${T.bg} 55%)`,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: "#e8e6e1",
    display: "flex", flexDirection: "column",
    paddingBottom: "max(20px, env(safe-area-inset-bottom))",
  };
}
function topbar() {
  return {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,.04)",
  };
}
function body() {
  return {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    padding: "20px 18px", textAlign: "center",
  };
}
function title() {
  return { fontSize: 20, fontFamily: "Georgia, serif", color: T.gold, margin: "10px 0 4px" };
}
function zoneRow() {
  return {
    display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))",
    gap: 10, width: "100%", maxWidth: 360, marginBottom: 16,
  };
}
function zoneBtn(key, active, spinning) {
  const base = {
    padding: "12px 8px", borderRadius: 14,
    background: "rgba(255,255,255,.03)",
    color: "#e8e6e1", border: `1.5px solid ${T.gb}`,
    cursor: spinning ? "default" : "pointer", fontFamily: "inherit",
  };
  if (!active) return base;
  return {
    ...base,
    border: `1.5px solid ${zoneColor(key)}`,
    background: `${zoneColor(key)}1A`,
    boxShadow: `0 0 18px ${zoneColor(key)}33`,
  };
}
function stakeRow() {
  return { display: "flex", gap: 8, alignItems: "center", margin: "8px 0 16px" };
}
function stepBtn() {
  return {
    width: 40, height: 40, borderRadius: 10,
    background: "rgba(255,255,255,.04)", border: `1.5px solid ${T.gb}`,
    color: "#e8e6e1", fontWeight: 800, fontSize: 18, cursor: "pointer",
    fontFamily: "inherit",
  };
}
function stakeInput() {
  return {
    width: 90, height: 40, padding: 8, textAlign: "center", borderRadius: 10,
    background: "rgba(255,255,255,.04)", border: `1.5px solid ${T.gb}`,
    color: "#e8e6e1", fontFamily: "inherit", fontSize: 16, fontWeight: 700,
  };
}
function maxBtn() {
  return {
    height: 40, padding: "0 12px", borderRadius: 10,
    background: "transparent", color: T.gold, border: `1px solid ${T.gold}`,
    fontWeight: 700, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit",
  };
}
function actionRow() {
  return { display: "flex", gap: 10, width: "100%", maxWidth: 360 };
}
function spinBtn(disabled) {
  return {
    flex: 2, minHeight: 50, padding: 12, borderRadius: 12,
    background: disabled ? "rgba(232,197,71,.18)" : "linear-gradient(135deg,#e8c547,#d4a830)",
    color: T.bg, border: "none", fontWeight: 800, letterSpacing: 1.5,
    cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
    opacity: disabled ? 0.6 : 1, fontSize: 13, textTransform: "uppercase",
  };
}
function skipBtn() {
  return {
    flex: 1, minHeight: 50, padding: 12, borderRadius: 12,
    background: "transparent", color: "#e8e6e1", border: `1px solid ${T.gb}`,
    fontWeight: 700, letterSpacing: 1, cursor: "pointer", fontFamily: "inherit",
    fontSize: 13, textTransform: "uppercase",
  };
}
function resultBox() {
  return { textAlign: "center", marginTop: 8, width: "100%", maxWidth: 360 };
}

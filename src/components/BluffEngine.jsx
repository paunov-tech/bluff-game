import { useCallback, useEffect, useRef, useState } from "react";
import { FLOW_MODULES } from "../lib/moduleRegistry.js";
import { sanitizeArenaResult } from "../lib/arena.js";
import { captureEvent } from "../lib/telemetry.js";
import { t as translate } from "../i18n/index.js";
import { FinalScoreScreen } from "./FinalScoreScreen.jsx";

// BluffEngine — orchestrates the fixed PLAY flow declared in
// src/lib/moduleRegistry.js. Renders one module at a time, captures its
// ArenaResult, accumulates session totals (score / swear / streak), then
// advances. On the final module, transitions to the FinalScoreScreen which
// owns SWEAR-earn + leaderboard write.
//
// Modules are remounted on each transition (key={moduleId + idx}) so they
// can't leak state across boundaries.
export function BluffEngine({ userId, lang = "en", onExit, awardSwear }) {
  const t = (k, params) => translate(k, lang, params);

  const [currentModuleIdx, setCurrentModuleIdx] = useState(0);
  const [phase, setPhase] = useState("playing"); // "playing" | "finished"
  const [sessionState, setSessionState] = useState(() => makeFreshSession());

  // Telemetry on session start.
  useEffect(() => {
    captureEvent("session_started", {
      sessionId: sessionState.sessionId,
      mode: "solo",
    });
    captureEvent("module_started", {
      moduleId:  FLOW_MODULES[0]?.id,
      sessionId: sessionState.sessionId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleModuleComplete = useCallback((rawResult) => {
    const result = sanitizeArenaResult(rawResult);
    const module = FLOW_MODULES[currentModuleIdx];

    captureEvent("module_completed", {
      moduleId:    module.id,
      sessionId:   sessionState.sessionId,
      success:     result.success,
      scoreDelta:  result.scoreDelta,
      swearDelta:  result.swearDelta,
      streakDelta: result.streakDelta,
    });

    setSessionState(prev => ({
      ...prev,
      score: prev.score + result.scoreDelta,
      swear: prev.swear + result.swearDelta,
      streak: Math.max(0, prev.streak + result.streakDelta),
      moduleResults: [...prev.moduleResults, { moduleId: module.id, ...result }],
    }));

    const nextIdx = currentModuleIdx + 1;
    if (nextIdx >= FLOW_MODULES.length) {
      setPhase("finished");
    } else {
      captureEvent("module_started", {
        moduleId:  FLOW_MODULES[nextIdx].id,
        sessionId: sessionState.sessionId,
      });
      setCurrentModuleIdx(nextIdx);
    }
  }, [currentModuleIdx, sessionState.sessionId]);

  const handleModuleAbort = useCallback(() => {
    captureEvent("session_aborted", {
      sessionId:    sessionState.sessionId,
      atModule:     FLOW_MODULES[currentModuleIdx]?.id,
      partialScore: sessionState.score,
      partialSwear: sessionState.swear,
      moduleIdx:    currentModuleIdx,
    });
    onExit?.();
  }, [currentModuleIdx, sessionState, onExit]);

  if (phase === "finished") {
    return (
      <FinalScoreScreen
        sessionState={sessionState}
        userId={userId}
        lang={lang}
        awardSwear={awardSwear}
        onPlayAgain={() => {
          const fresh = makeFreshSession();
          setSessionState(fresh);
          setCurrentModuleIdx(0);
          setPhase("playing");
          captureEvent("session_started", { sessionId: fresh.sessionId, mode: "solo" });
          captureEvent("module_started", { moduleId: FLOW_MODULES[0]?.id, sessionId: fresh.sessionId });
        }}
        onHome={onExit}
      />
    );
  }

  const module = FLOW_MODULES[currentModuleIdx];
  if (!module) return null;
  const ModuleComponent = module.component;
  const incomingState = { streak: sessionState.streak };

  return (
    <div style={wrap()}>
      <header style={hud()}>
        <button onClick={handleModuleAbort} style={hudBtn()} aria-label="Quit">✕</button>
        <Pips
          modules={FLOW_MODULES}
          currentIdx={currentModuleIdx}
        />
        <div style={statsRow()}>
          <span>⭐ {sessionState.score}</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span style={{ color: "#e8c547" }}>ⓢ {sessionState.swear}</span>
          {sessionState.streak > 0 && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span style={{ color: "#e8c547" }}>🔥 {sessionState.streak}</span>
            </>
          )}
        </div>
      </header>

      <div style={moduleArea()}>
        <ModuleComponent
          key={`${module.id}_${currentModuleIdx}`}
          onComplete={handleModuleComplete}
          onAbort={handleModuleAbort}
          lang={lang}
          userId={userId}
          sessionId={sessionState.sessionId}
          incomingState={incomingState}
          config={module.config || {}}
        />
      </div>
    </div>
  );
}

function makeFreshSession() {
  return {
    sessionId:     `session_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    score:         0,
    swear:         0,
    streak:        0,
    moduleResults: [],
    startedAt:     Date.now(),
  };
}

function Pips({ modules, currentIdx }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      {modules.map((m, idx) => {
        const isDone   = idx < currentIdx;
        const isActive = idx === currentIdx;
        const color    = isDone ? "#2dd4a0" : isActive ? "#e8c547" : "rgba(255,255,255,.18)";
        return (
          <span key={m.id} style={{
            display: "inline-block", width: 18, height: 18, borderRadius: 4,
            border: `1.5px solid ${color}`,
            background: isDone ? `${color}33` : isActive ? `${color}1a` : "transparent",
            fontSize: 11, lineHeight: "16px", textAlign: "center",
            color, fontWeight: 700,
          }}>{isDone ? "✓" : ""}</span>
        );
      })}
    </div>
  );
}

function wrap() {
  return {
    minHeight: "100dvh",
    background: "#04060f",
    color: "#e8e6e1",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    display: "flex", flexDirection: "column",
  };
}
function hud() {
  return {
    display: "grid", gridTemplateColumns: "auto 1fr auto",
    alignItems: "center", gap: 12,
    padding: "10px 14px",
    borderBottom: "1px solid rgba(255,255,255,.06)",
    background: "rgba(0,0,0,.25)",
  };
}
function hudBtn() {
  return {
    width: 32, height: 32, borderRadius: 8,
    background: "transparent", color: "#e8e6e1",
    border: "1px solid rgba(255,255,255,.12)",
    cursor: "pointer", fontFamily: "inherit", fontSize: 14,
  };
}
function statsRow() {
  return {
    display: "flex", gap: 6, alignItems: "center",
    fontSize: 12, fontWeight: 800, letterSpacing: .5, justifyContent: "flex-end",
    color: "#e8e6e1",
  };
}
function moduleArea() {
  return { flex: 1, display: "flex", flexDirection: "column" };
}

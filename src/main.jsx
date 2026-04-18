import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import DuelChallenge from "./screens/DuelChallenge";
import ErrorBoundary from "./components/ErrorBoundary";
import SWUpdatePrompt from "./components/SWUpdatePrompt";
import { initTelemetry, captureError } from "./lib/telemetry";

initTelemetry();

window.addEventListener("unhandledrejection", (e) => {
  captureError(e.reason || e, { kind: "unhandledrejection" });
});
window.addEventListener("error", (e) => {
  captureError(e.error || e.message, { kind: "error" });
});

function Root() {
  const path = window.location.pathname;

  // /duel/:id — opponent plays the same rounds as the challenger
  if (path.startsWith("/duel/")) {
    const challengeId = path.replace(/^\/duel\//, "").split("/")[0];
    if (challengeId) return <DuelChallenge challengeId={challengeId} />;
  }

  // Default: main app
  return <App />;
}

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <ErrorBoundary>
      <Root />
      <SWUpdatePrompt />
    </ErrorBoundary>
  );
}

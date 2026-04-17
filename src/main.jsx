import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import DuelChallenge from "./screens/DuelChallenge";
import ErrorBoundary from "./components/ErrorBoundary";

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
    </ErrorBoundary>
  );
}

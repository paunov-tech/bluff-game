import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import DuelChallenge from "./screens/DuelChallenge";

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

ReactDOM.createRoot(document.getElementById("root")).render(<Root />);

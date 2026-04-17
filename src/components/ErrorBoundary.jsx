import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    console.error("[ErrorBoundary]", err, info?.componentStack);
  }

  reset = () => {
    this.setState({ err: null });
  };

  hardReload = () => {
    try { window.location.reload(); } catch {}
  };

  render() {
    if (!this.state.err) return this.props.children;
    const msg = this.state.err?.message || String(this.state.err);
    return (
      <div style={{
        minHeight: "100vh",
        background: "#0b0b0c",
        color: "#e8e6e1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "Georgia, serif",
      }}>
        <div style={{ maxWidth: 520, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 44, fontWeight: 900, letterSpacing: "2px", marginBottom: 12 }}>
            BLUFF™
          </div>
          <div style={{ fontSize: 14, color: "rgba(232,197,71,.85)", marginBottom: 16, letterSpacing: "1px", textTransform: "uppercase" }}>
            Something went wrong
          </div>
          <div style={{
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.1)",
            borderRadius: 10,
            padding: "14px 16px",
            fontSize: 13,
            color: "rgba(255,255,255,.7)",
            marginBottom: 20,
            wordBreak: "break-word",
            fontFamily: "ui-monospace, Menlo, monospace",
          }}>
            {msg}
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={this.reset} style={btnStyle("primary")}>Try Again</button>
            <button onClick={this.hardReload} style={btnStyle("secondary")}>Reload</button>
          </div>
        </div>
      </div>
    );
  }
}

function btnStyle(variant) {
  const base = {
    padding: "12px 18px",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "1px",
    textTransform: "uppercase",
    borderRadius: 10,
    cursor: "pointer",
    fontFamily: "inherit",
  };
  if (variant === "primary") {
    return {
      ...base,
      background: "rgba(232,197,71,.15)",
      color: "#e8c547",
      border: "1px solid rgba(232,197,71,.4)",
    };
  }
  return {
    ...base,
    background: "transparent",
    color: "rgba(255,255,255,.6)",
    border: "1px solid rgba(255,255,255,.15)",
  };
}

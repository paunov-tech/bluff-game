import React, { useEffect, useState } from "react";

// Minimal SW update toast — appears when workbox detects a new version.
// Plugin injects `virtual:pwa-register` at build time; fall back silently in dev.
export default function SWUpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [updateFn, setUpdateFn] = useState(() => () => {});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("virtual:pwa-register");
        const update = mod.registerSW({
          onNeedRefresh() { if (!cancelled) setNeedRefresh(true); },
          onRegisteredSW(_u, reg) {
            if (!reg) return;
            setInterval(() => { try { reg.update(); } catch {} }, 60 * 60 * 1000);
          },
        });
        if (!cancelled) setUpdateFn(() => () => update(true));
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  if (!needRefresh) return null;

  return (
    <div style={{
      position: "fixed", left: 16, right: 16, bottom: 16, zIndex: 9999,
      maxWidth: 360, margin: "0 auto",
      background: "rgba(8,8,15,.96)",
      border: "1px solid rgba(232,197,71,.35)",
      borderRadius: 14, padding: "14px 16px",
      display: "flex", alignItems: "center", gap: 12,
      boxShadow: "0 10px 40px rgba(0,0,0,.5), 0 0 24px rgba(232,197,71,.15)",
      color: "#e8e6e1", fontFamily: "'Segoe UI', system-ui, sans-serif",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
    }}>
      <div style={{ flex: 1, fontSize: 13, lineHeight: 1.4 }}>
        <div style={{ color: "#e8c547", fontWeight: 700, letterSpacing: 1, fontSize: 10, textTransform: "uppercase", marginBottom: 2 }}>
          New version
        </div>
        <div style={{ color: "rgba(255,255,255,.75)" }}>
          Tap to reload and get the latest.
        </div>
      </div>
      <button
        onClick={updateFn}
        style={{
          background: "rgba(232,197,71,.18)",
          color: "#e8c547",
          border: "1px solid rgba(232,197,71,.5)",
          padding: "8px 14px", borderRadius: 8,
          fontSize: 12, fontWeight: 700, letterSpacing: 1,
          textTransform: "uppercase", cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Reload
      </button>
    </div>
  );
}

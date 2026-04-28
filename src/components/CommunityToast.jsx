import { useEffect, useRef } from "react";

// CommunityToast — bottom-right ambient toast that auto-dismisses after
// 4 seconds. Caller owns the queue (only one toast on screen at a time);
// we don't try to stack them.

export function CommunityToast({ toast, onDismiss }) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => dismissRef.current?.(), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!toast) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 18, right: 18,
        background: "rgba(15,15,26,0.92)",
        border: "1px solid rgba(232,197,71,0.32)",
        borderRadius: 12,
        padding: "10px 14px",
        color: "#e8e6e1",
        fontSize: 12.5,
        fontFamily: "'Segoe UI',system-ui,sans-serif",
        letterSpacing: "0.2px",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        animation: "community-toast-in 280ms ease-out, community-toast-out 320ms ease-in 3680ms forwards",
        zIndex: 60,
        maxWidth: 280,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        pointerEvents: "none",
      }}
    >
      {toast.text}
    </div>
  );
}

export default CommunityToast;

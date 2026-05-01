import { getCurrentIdToken } from "../../auth.js";

// Mirror of SwipeWarmup's authFetch — attaches the current Firebase ID token
// when available, falls back to anonymous. JSON content-type is auto-applied
// when a body is present.
export async function authFetch(url, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  try {
    const token = await getCurrentIdToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  } catch { /* anon */ }
  return fetch(url, { ...init, headers });
}

// Tiny haptic helper — no-op when navigator.vibrate is missing or rejected.
export function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch {}
}

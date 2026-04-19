import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let app = null;
let auth = null;

function ensureInit() {
  if (!firebaseConfig.apiKey) return null;
  if (!app) {
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    auth = getAuth(app);
  }
  return auth;
}

export function isAuthReady() {
  return !!ensureInit();
}

export function onAuthChange(callback) {
  const a = ensureInit();
  if (!a) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(a, (user) => {
    callback(user || null);
  });
}

// iOS Safari blocks signInWithPopup reliably (ITP + cross-site cookie
// restrictions break the OAuth callback). Detect and switch to redirect.
function shouldUseRedirect() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isMobileSafari = isIOS || (/Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua));
  const isStandalone =
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;
  return isIOS || isMobileSafari || isStandalone;
}

export async function signInGoogle() {
  const a = ensureInit();
  if (!a) throw new Error("auth_not_configured");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  if (shouldUseRedirect()) {
    try { sessionStorage.setItem("bluff_auth_redirect_pending", "1"); } catch {}
    await signInWithRedirect(a, provider);
    return null;
  }

  try {
    const result = await signInWithPopup(a, provider);
    return result.user;
  } catch (err) {
    if (
      err?.code === "auth/popup-blocked" ||
      err?.code === "auth/popup-closed-by-user" ||
      err?.code === "auth/cancelled-popup-request"
    ) {
      console.warn("[auth] popup failed, falling back to redirect:", err.code);
      try { sessionStorage.setItem("bluff_auth_redirect_pending", "1"); } catch {}
      await signInWithRedirect(a, provider);
      return null;
    }
    throw err;
  }
}

export async function consumeRedirectResult() {
  const a = ensureInit();
  if (!a) return null;
  try {
    const result = await getRedirectResult(a);
    return result?.user || null;
  } catch (err) {
    console.error("[auth] redirect result error:", err);
    return null;
  }
}

export async function signInApple() {
  throw new Error("apple_signin_not_available");
}

export async function signOutUser() {
  const a = ensureInit();
  if (!a) return;
  await signOut(a);
}

export async function getCurrentIdToken() {
  const a = ensureInit();
  if (!a || !a.currentUser) return null;
  try {
    return await a.currentUser.getIdToken();
  } catch {
    return null;
  }
}

export function getCurrentUid() {
  const a = ensureInit();
  return a?.currentUser?.uid || null;
}

export function getCurrentUser() {
  const a = ensureInit();
  return a?.currentUser || null;
}

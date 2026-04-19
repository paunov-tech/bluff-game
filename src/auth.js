import { initializeApp, getApps } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
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

// Google OAuth 2.0 Web Client ID for the molty-portal project.
// This is the SAME client_id Firebase Auth already issues to on google.com,
// verified via identitytoolkit createAuthUri probe. It's a public value — safe
// to commit (appears in every OAuth URL). Env var wins if set.
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  "1010121862220-b3u5essa69jck1f7m4bua0aoo77oifh5.apps.googleusercontent.com";

let app = null;
let auth = null;

function ensureInit() {
  if (!firebaseConfig.apiKey) return null;
  if (!app) {
    console.log("[auth] init firebase", { authDomain: firebaseConfig.authDomain, projectId: firebaseConfig.projectId, origin: typeof window !== "undefined" ? window.location.origin : null });
    app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    // Force IndexedDB persistence. Default order includes browserLocalStorage which
    // Safari ITP can silently partition after a redirect; IndexedDB is more robust.
    try {
      auth = initializeAuth(app, {
        persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      });
    } catch {
      // initializeAuth throws if called twice; fall back to getAuth.
      auth = getAuth(app);
    }
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
    console.log("[auth] onAuthStateChanged fired", user ? { uid: user.uid, email: user.email, isAnonymous: user.isAnonymous } : null);
    callback(user || null);
  });
}

// iOS Safari — even with a custom authDomain on the same registrable domain,
// iOS 18+ ITP wipes Firebase's first-party storage on return from the OAuth
// redirect. We detect this environment so the UI can route to the GIS
// (google.accounts.id) button path, which keeps the entire flow in the
// first-party context of the origin and never relies on redirect state.
export function isIOSSafari() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports desktop UA; detect via touch + platform.
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
  if (!isIOS) return false;
  // On iOS, all browsers are WebKit/Safari under the hood for auth purposes.
  return true;
}

function shouldUseRedirect() {
  if (typeof window === "undefined") return false;
  if (isIOSSafari()) return true;
  const ua = window.navigator.userAgent || "";
  const isMobileSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
  const isStandalone =
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    window.navigator.standalone === true;
  return isMobileSafari || isStandalone;
}

// ── Google Identity Services (GIS) path ──────────────────────────────
// On iOS Safari the Firebase redirect dance can get its storage partitioned
// by ITP even with a custom authDomain. GIS returns an ID token via a popup
// that stays in the first-party context of playbluff.games, bypassing the
// redirect entirely. Firebase then consumes the ID token via signInWithCredential.

let gisLoadPromise = null;
function loadGIS(debug) {
  if (typeof window === "undefined") return Promise.reject(new Error("no_window"));
  if (window.google?.accounts?.id) {
    debug?.("loadGIS:already_loaded", {});
    return Promise.resolve();
  }
  if (gisLoadPromise) {
    debug?.("loadGIS:reusing_inflight", {});
    return gisLoadPromise;
  }
  gisLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-gis="1"]');
    if (existing) {
      debug?.("loadGIS:script_already_in_dom", {});
      existing.addEventListener("load", () => { debug?.("loadGIS:existing_script_onload", {}); resolve(); });
      existing.addEventListener("error", () => { debug?.("loadGIS:existing_script_error", {}); reject(new Error("gis_script_error")); });
      return;
    }
    debug?.("loadGIS:appending_script", { src: "https://accounts.google.com/gsi/client" });
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.dataset.gis = "1";
    s.onload = () => {
      debug?.("loadGIS:script_onload", { hasGlobal: !!window.google?.accounts?.id });
      resolve();
    };
    s.onerror = (ev) => {
      debug?.("loadGIS:script_onerror", { type: ev?.type || "error" });
      reject(new Error("gis_script_error"));
    };
    document.head.appendChild(s);
    // Hard timeout so the UI can fall back to Firebase redirect instead of hanging.
    setTimeout(() => {
      if (!window.google?.accounts?.id) {
        debug?.("loadGIS:timeout", { ms: 8000 });
        reject(new Error("gis_load_timeout"));
      }
    }, 8000);
  });
  return gisLoadPromise;
}

// Render Google's branded button into a container. Resolves with the signed-in
// Firebase user after the user clicks and the credential is exchanged.
// This is the most reliable GIS flow for iOS Safari because Google's button
// triggers their own popup within a user gesture — no One Tap prompt quirks,
// no cross-site redirect.
// onDebug is called with { label, obj } at every step so the UI can render a
// live trace (iPhone users have no Mac to read console.log).
export async function renderGoogleButton(container, { width, onDebug } = {}) {
  const debug = (label, obj) => {
    try { onDebug?.({ label, obj }); } catch {}
    console.log("[auth/gis]", label, obj);
  };
  const a = ensureInit();
  if (!a) throw new Error("auth_not_configured");
  debug("renderGoogleButton:start", { hasContainer: !!container });
  await loadGIS(debug);
  debug("renderGoogleButton:gis_ready", { hasGlobal: !!window.google?.accounts?.id });
  return new Promise((resolve, reject) => {
    try {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        ux_mode: "popup",
        auto_select: false,
        itp_support: true,
        callback: async (response) => {
          debug("callback:fired", { hasCredential: !!response?.credential, select_by: response?.select_by });
          try {
            if (!response?.credential) {
              reject(new Error("gis_no_credential"));
              return;
            }
            const cred = GoogleAuthProvider.credential(response.credential);
            debug("signInWithCredential:calling", {});
            const result = await signInWithCredential(a, cred);
            debug("signInWithCredential:ok", { uid: result.user?.uid, email: result.user?.email });
            resolve(result.user);
          } catch (e) {
            debug("signInWithCredential:error", { code: e?.code, message: e?.message });
            reject(e);
          }
        },
      });
      debug("initialize:done", { clientIdPrefix: GOOGLE_CLIENT_ID.split("-")[0] });
      window.google.accounts.id.renderButton(container, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        text: "continue_with",
        shape: "rectangular",
        logo_alignment: "left",
        width: width || 300,
      });
      debug("renderButton:done", { childCount: container?.childElementCount });
    } catch (e) {
      debug("renderGoogleButton:threw", { message: e?.message });
      reject(e);
    }
  });
}

export async function signInGoogle() {
  const a = ensureInit();
  if (!a) throw new Error("auth_not_configured");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  if (shouldUseRedirect()) {
    // iOS path should normally be handled by the UI via renderGoogleButton().
    // This branch is reached only when signInGoogle() is invoked directly on
    // a Safari-like environment — used as the redirect fallback if GIS load fails.
    console.log("[auth] signInGoogle: using redirect (iOS/Safari fallback)", { ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 80) : null });
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
      console.warn("[auth] popup failed, falling back to redirect", { code: err.code });
      try { sessionStorage.setItem("bluff_auth_redirect_pending", "1"); } catch {}
      await signInWithRedirect(a, provider);
      return null;
    }
    throw err;
  }
}

export async function consumeRedirectResult() {
  const a = ensureInit();
  if (!a) {
    console.log("[auth] consumeRedirectResult skipped: auth not ready");
    return null;
  }
  console.log("[auth] before getRedirectResult", { currentUser: a.currentUser ? a.currentUser.uid : null });
  try {
    const result = await getRedirectResult(a);
    console.log("[auth] getRedirectResult returned", result ? { user: result.user ? { uid: result.user.uid, email: result.user.email } : null, providerId: result.providerId, operationType: result.operationType } : null);
    return result?.user || null;
  } catch (err) {
    console.error("[auth] redirect result error", { code: err?.code, message: err?.message });
    return null;
  }
}

export async function signInApple() {
  throw new Error("apple_signin_not_available");
}

export async function signOutUser() {
  const a = ensureInit();
  if (!a) return;
  try { window.google?.accounts?.id?.disableAutoSelect?.(); } catch {}
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

// ── Diagnostic helper ─────────────────────────────────────────────────
// Returns a snapshot of browser storage state relevant to Firebase auth,
// for use in an on-screen debug panel when the user has no Mac to run
// Safari remote DevTools. Shape is stable for UI rendering.
export async function authStorageSnapshot() {
  const snap = {
    authDomain: firebaseConfig.authDomain || null,
    origin: typeof window !== "undefined" ? window.location.origin : null,
    currentUser: null,
    localStorageFirebaseKeys: [],
    sessionStoragePendingFlag: null,
    cookieCount: 0,
    indexedDBDatabases: [],
    indexedDBSupported: typeof indexedDB !== "undefined",
    ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : null,
  };
  try {
    const a = ensureInit();
    if (a?.currentUser) snap.currentUser = { uid: a.currentUser.uid, email: a.currentUser.email };
  } catch {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("firebase:") || k.includes("firebaseLocalStorage"))) {
        snap.localStorageFirebaseKeys.push(k);
      }
    }
  } catch (e) { snap.localStorageFirebaseKeys = ["<blocked: " + (e?.message || "") + ">"]; }
  try { snap.sessionStoragePendingFlag = sessionStorage.getItem("bluff_auth_redirect_pending"); } catch {}
  try { snap.cookieCount = (document.cookie || "").split(";").filter(Boolean).length; } catch {}
  try {
    if (typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function") {
      const dbs = await indexedDB.databases();
      snap.indexedDBDatabases = dbs.map((d) => d.name).filter(Boolean);
    }
  } catch (e) { snap.indexedDBDatabases = ["<err: " + (e?.message || "") + ">"]; }
  return snap;
}

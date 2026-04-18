import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
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

export async function signInGoogle() {
  const a = ensureInit();
  if (!a) throw new Error("auth_not_configured");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await signInWithPopup(a, provider);
  return result.user;
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

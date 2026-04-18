// api/_lib/verify-firebase-token.js
// Edge-compatible Firebase ID token verifier using jose + JWKS.
// Returns { uid, email, name, picture } on success, or null on any failure.

import { createRemoteJWKSet, jwtVerify } from "jose";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "molty-portal";
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`;

let _jwks = null;
function getJWKS() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(new URL(JWKS_URL), {
      cacheMaxAge: 60 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    });
  }
  return _jwks;
}

export function extractBearerToken(req) {
  const h = req.headers?.authorization || req.headers?.Authorization || "";
  if (!h || typeof h !== "string") return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export async function verifyFirebaseToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer: ISSUER,
      audience: PROJECT_ID,
      algorithms: ["RS256"],
    });
    if (!payload.sub || payload.auth_time == null) return null;
    return {
      uid: payload.sub,
      email: payload.email || null,
      name: payload.name || null,
      picture: payload.picture || null,
      authTime: payload.auth_time,
    };
  } catch (err) {
    return null;
  }
}

export async function verifyRequestAuth(req) {
  const token = extractBearerToken(req);
  if (!token) return null;
  return await verifyFirebaseToken(token);
}

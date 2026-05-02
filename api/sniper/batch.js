// api/sniper/batch.js — Module-folder re-export of the existing
// /api/sniper-batch handler. Both URL paths route to the same logic; the
// folder layout is for code organisation only. Vercel maps each .js under
// /api/ to its file path verbatim.
//
// Existing flat path /api/sniper-batch is kept working for backward compat
// with V2's SniperMode (which hardcodes the flat path).
export { default } from "../sniper-batch.js";

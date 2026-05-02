import { useState, useEffect, useRef, useCallback } from "react";
import { PartySocket } from "partysocket";
import { SCHEMA, QUESTIONS_PER_WAVE } from "./config/schema";
import { getFallback } from "./config/fallbacks";
import { t as translate } from "./i18n/index.js";
import {
  isAuthReady,
  onAuthChange,
  signInGoogle,
  signOutUser,
  getCurrentIdToken,
  consumeRedirectResult,
  authStorageSnapshot,
  isIOSSafari,
  renderGoogleButton,
} from "./auth.js";
import {
  shouldTriggerSabotage,
  pickSabotageType,
  scrambleText,
  logSabotageTriggered,
  logSabotageOutcome,
  SABOTAGE_TYPES,
} from "./lib/sabotage.js";
import { startCommunityPulse } from "./lib/communityPulse.js";
import { PitFall } from "./components/PitFall.jsx";
import { AxiomReaction } from "./components/AxiomReaction.jsx";
import { CommunityToast } from "./components/CommunityToast.jsx";
import { ShifterMode } from "./components/ShifterMode.jsx";
import { NumbersMode } from "./components/NumbersMode.jsx";
import { SwipeWarmup } from "./components/SwipeWarmup.jsx";
import { ClimbMiniBlackjack } from "./components/climb/ClimbMiniBlackjack.jsx";
import { ClimbMiniSniper } from "./components/climb/ClimbMiniSniper.jsx";
import { ClimbMiniMath } from "./components/climb/ClimbMiniMath.jsx";
import { GameEngine } from "./components/game/GameEngine.jsx";
import { captureEvent } from "./lib/telemetry.js";

// V2 single-player loop (5 phases + roulette interstitials).
// Off by default; opt in with ?v2=1 in the URL. Old Climb stays the default
// "play" screen until the V2 phases are real and validated.
const V2_ENABLED = (() => {
  try { return new URLSearchParams(window.location.search).get("v2") === "1"; } catch { return false; }
})();

// ── Daily warm-up gating ─────────────────────────────────────────
// Phased rollout: ship as a SOFT gate (warning, never blocks). Flip to true
// after the first few days once users have learned the daily ritual.
const WARMUP_HARD_GATE = false;

// ── CLIMB-flow screen transitions ───────────────────────────────
// Fade-in animation on mount for screens in the CLIMB sequence
// (climb-mini1/2/3, play, result). Each screen change is a remount
// of a different return branch in App.jsx, so the keyframe runs
// fresh on each transition. Toggle false to revert to snap-cuts
// without changing any other code.
const CLIMB_TRANSITIONS_ENABLED = true;
const CLIMB_FADE_IN = "climb-screen-fade-in 350ms ease-out";
const climbScreenAnim = () => CLIMB_TRANSITIONS_ENABLED ? CLIMB_FADE_IN : undefined;

function todayLocalDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// ── SWEAR Card helpers ───────────────────
// Format an ISO createdAt timestamp as MM/YY. Falls back to "—" on invalid input.
function formatMonthYear(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${yy}`;
}

// Launch date: 2026-04-29. "Founding" = profile created within first 14 days.
const FOUNDING_CUTOFF_MS = Date.parse("2026-05-13T00:00:00Z");
function isFoundingMember(createdAt) {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  if (isNaN(t)) return false;
  return t >= Date.parse("2026-04-29T00:00:00Z") && t < FOUNDING_CUTOFF_MS;
}

// Tier badge priority: EarlyAdopter → Pro → Founding → none.
function resolveSwearTierBadge(profile, tFn, lang) {
  if (!profile) return null;
  if (profile.isEarlyAdopter) {
    return tFn("swear_card.early_adopter_badge", lang, { n: profile.earlyAdopterRank || "—" });
  }
  if (profile.isPro) {
    return tFn("swear_card.pro_badge", lang);
  }
  if (isFoundingMember(profile.createdAt)) {
    return tFn("swear_card.founding_member", lang);
  }
  return null;
}

// ── Haptic feedback ──────────────────────
function useHaptic() {
  const supported = typeof navigator !== "undefined" && "vibrate" in navigator;
  const tgH = () => window.Telegram?.WebApp?.HapticFeedback;
  return {
    tap:          () => { tgH()?.selectionChanged(); if (supported) navigator.vibrate(8); },
    lockIn:       () => { tgH()?.impactOccurred("medium"); if (supported) navigator.vibrate([12, 60, 12]); },
    correct:      () => { tgH()?.notificationOccurred("success"); if (supported) navigator.vibrate([15, 40, 15, 40, 80]); },
    wrong:        () => { tgH()?.notificationOccurred("error"); if (supported) navigator.vibrate([0, 30, 80, 30, 80, 30, 150]); },
    timerWarning: () => { tgH()?.impactOccurred("light"); if (supported) navigator.vibrate(20); },
    victory:      () => { tgH()?.notificationOccurred("success"); if (supported) navigator.vibrate([50,30,50,30,50,80,50,80,50,200]); },
  };
}

// ── Telegram Mini App ─────────────────────
function useTelegram() {
  const tg = window.Telegram?.WebApp;
  const isInsideTelegram = !!tg?.initData;
  const tgUser = tg?.initDataUnsafe?.user || null;

  function sendResult(data) {
    if (!tg) return;
    try { tg.sendData(JSON.stringify(data)); } catch {}
  }

  function shareToChat(text, url) {
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    if (tg) tg.openTelegramLink(shareUrl);
    else window.open(shareUrl, "_blank");
  }

  return { isInsideTelegram, tgUser, sendResult, shareToChat };
}

// ═══════════════════════════════════════════════════════════════
// Safari Private mode and strict Firefox throw on any localStorage access.
function safeLSGet(key, fallback = null) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function safeLSSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* quota/private mode — ignore */ }
}

// CONFIG
// ═══════════════════════════════════════════════════════════════
const BETA_MODE = true;

const LANGUAGES = [
  { code: "en", flag: "🇬🇧", label: "EN", ready: true },
  { code: "sr", flag: "🇷🇸", label: "SR", ready: true },
  { code: "hr", flag: "🇭🇷", label: "HR", ready: true },
  { code: "de", flag: "🇩🇪", label: "DE", ready: false },
  { code: "sl", flag: "🇸🇮", label: "SL", ready: false },
  { code: "bs", flag: "🇧🇦", label: "BS", ready: false },
  { code: "fr", flag: "🇫🇷", label: "FR", ready: false },
  { code: "es", flag: "🇪🇸", label: "ES", ready: false },
];

// 12 rounds total (matching ROUND_DIFFICULTY length).
// Mix across 11 categories from pre-generate.js SUBTOPICS_PRE.
// Max 1 sports round per match. Diverse across history, science,
// medicine, showbiz, culture, geography, animals, food, technology, life, sports.
const CATEGORIES = [
  "history",    // Q1 warm-up
  "science",    // Q2 warm-up
  "culture",    // Q3 rising
  "showbiz",    // Q4 rising
  "animals",    // Q5 rising
  "geography",  // Q6 rising
  "medicine",   // Q7 devious
  "technology", // Q8 devious
  "food",       // Q9 devious
  "life",       // Q10 diabolical
  "sports",     // Q11 diabolical (only 1 sports in entire match)
  "showbiz",    // Q12 diabolical finale
];
const CATEGORY_EMOJIS = {
  history:"🏛️", science:"🔬", animals:"🦎", geography:"🌍",
  food:"🍷", culture:"🎭", internet:"💻", popculture:"🎬", sports:"⚽",
  nba:"🏀", premier_league:"⚽", bundesliga:"⚽",
};
function CategoryIcon({ category, size=26 }) {
  const svgs = {
    nba: `<svg width="${size}" height="${size}" viewBox="0 0 28 28" fill="none"><circle cx="14" cy="14" r="12" stroke="#e8c547" stroke-width="1.5" fill="none"/><path d="M14 2 C14 2 8 8 8 14 C8 20 14 26 14 26" stroke="#e8c547" stroke-width="1.2" fill="none"/><path d="M14 2 C14 2 20 8 20 14 C20 20 14 26 14 26" stroke="#e8c547" stroke-width="1.2" fill="none"/><line x1="2" y1="14" x2="26" y2="14" stroke="#e8c547" stroke-width="1.2"/></svg>`,
    premier_league: `<svg width="${size}" height="${size}" viewBox="0 0 28 28" fill="none"><path d="M14 3 L16.5 10 L24 10 L18 15 L20.5 22 L14 18 L7.5 22 L10 15 L4 10 L11.5 10 Z" stroke="#e8c547" stroke-width="1.5" fill="none"/></svg>`,
    bundesliga: `<svg width="${size}" height="${size}" viewBox="0 0 28 28" fill="none"><path d="M14 4 L24 9 L24 19 L14 24 L4 19 L4 9 Z" stroke="#e8c547" stroke-width="1.5" fill="none"/><circle cx="14" cy="14" r="4" stroke="#e8c547" stroke-width="1.2" fill="none"/></svg>`,
  };
  const svg = svgs[category];
  if (!svg) return <span style={{fontSize:size*0.75}}>{CATEGORY_EMOJIS[category]||"🎯"}</span>;
  return <span dangerouslySetInnerHTML={{__html:svg.replace(/\${size}/g,size)}} style={{display:"inline-flex",alignItems:"center"}}/>;
}
// 3 WAVES × 4 QUESTIONS = 12 rounds total
// Wave 1: Warm-up (diff 1-2), Wave 2: Rising (diff 3-4), Wave 3: Finale (diff 4-5)
const ROUND_DIFFICULTY = [1, 1, 2, 2, 3, 3, 4, 4, 4, 5, 5, 5];
const WAVE_BOUNDARIES = [0, 4, 8, 12]; // wave starts at these indices
const WAVE_LABELS = ["WARM-UP", "RISING", "FINALE"];
const WAVE_COLORS = ["#2dd4a0", "#fb923c", "#f43f5e"];
const WAVE_AXIOM_INTRO = [
  "Beginner's luck is a myth. Prove me wrong.",
  "Now we begin.",
  "Everything ends here.",
];
const BLITZ_DIFFICULTY = [4, 4, 5, 5, 4, 5, 5, 4, 5, 5, 5, 5]; // 3 questions x 4 sets
const BLITZ_TIMER = 18; // 18 seconds per question
const BLITZ_ROUNDS = 12; // 3q x 4 sets
const TIMER_PER_DIFF = { 0:22, 1:28, 2:34, 3:40, 4:48, 5:60 };
const DIFF_LABEL = ["","Warm-up","Easy","Sneaky","Devious","Diabolical"];
const DIFF_COLOR = ["","#2dd4a0","#a3e635","#fb923c","#f43f5e","#a855f7"];

// Cashout multiplier tuning — keep together for easy post-playtest adjustment
const BASE_POINTS = 100;
const BASE_PENALTY = 50;
const NEGLIGENCE_PENALTY_REGULAR = 300;
const NEGLIGENCE_PENALTY_BLITZ = 150;
const MULTIPLIER_MILESTONES = [1.5, 2.0, 2.5, 3.0];

function computeMultiplier(timeElapsed, maxTime, isBlitz) {
  const p = Math.min(1, Math.max(0, timeElapsed / maxTime));
  if (isBlitz) {
    if (p < 0.11) return 1.0;
    if (p < 0.44) return 1.0 + (p - 0.11) / 0.33 * 0.8;
    if (p < 0.72) return 1.8 + (p - 0.44) / 0.28 * 0.7;
    return 2.5 + (p - 0.72) / 0.28 * 0.5;
  }
  if (p < 0.10) return 1.0;
  if (p < 0.25) return 1.0 + (p - 0.10) / 0.15 * 0.5;
  if (p < 0.50) return 1.5 + (p - 0.25) / 0.25 * 0.5;
  if (p < 0.75) return 2.0 + (p - 0.50) / 0.25 * 0.5;
  if (p < 0.95) return 2.5 + (p - 0.75) / 0.20 * 0.5;
  return 3.0 + (p - 0.95) / 0.05 * 0.5;
}

function getStreakMultiplier(streak) {
  if (streak >= 7) return 3.0;
  if (streak >= 5) return 2.0;
  if (streak >= 3) return 1.5;
  return 1.0;
}

function getRingColor(mult) {
  if (mult >= 3.0) return '#dc2626';
  if (mult >= 2.5) return '#f43f5e';
  if (mult >= 2.0) return '#fb923c';
  if (mult >= 1.5) return '#e8c547';
  return 'rgba(255,255,255,0.45)';
}

function BreakdownRow({ label, value, highlight, delay }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      padding: '4px 0',
      opacity: 0,
      animation: `breakdownFadeIn 0.3s ease ${delay}ms forwards`,
      fontWeight: highlight ? 700 : 400,
      fontSize: highlight ? 15 : 13,
      fontFamily: 'inherit',
    }}>
      <span style={{ color: highlight ? '#fff' : 'rgba(255,255,255,0.55)' }}>{label}</span>
      <span style={{ color: highlight ? '#e8c547' : '#fff' }}>{value}</span>
    </div>
  );
}

// Helper — which wave is a given round index in?
function getWave(idx) { return idx < 4 ? 0 : idx < 8 ? 1 : 2; }
function isWaveStart(idx) { return idx === 0 || idx === 4 || idx === 8; }
function isWaveEnd(idx) { return idx === 3 || idx === 7 || idx === 11; }

// ── Challenge system ──────────────────────────
function encodeChallenge(score, total, roundDifficulties) {
  const data = {
    s: score,
    t: total,
    d: roundDifficulties, // array of difficulties played
    ts: Date.now(),
  };
  return btoa(JSON.stringify(data)).replace(/=/g, "");
}

function decodeChallenge(encoded) {
  try {
    const padded = encoded + "==".slice(0, (4 - encoded.length % 4) % 4);
    return JSON.parse(atob(padded));
  } catch { return null; }
}

function getChallengeFromURL() {
  const params = new URLSearchParams(window.location.search);
  const c = params.get("c");
  if (!c) return null;
  return decodeChallenge(c);
}

function buildChallengeURL(score, total) {
  const encoded = encodeChallenge(score, total, ROUND_DIFFICULTY);
  return `${window.location.origin}?c=${encoded}`;
}

// ═══════════════════════════════════════════════════════════════
// AXIOM FACE DATA
// ═══════════════════════════════════════════════════════════════
const MOODS = {
  idle:     { eye:"#22d3ee", er:5,  dot:"#22d3ee",
    mouth:{ type:"line", p:{x1:80,y1:120,x2:120,y2:120,stroke:"#22d3ee",strokeWidth:2,strokeLinecap:"round"}},
    bl:{x1:68,y1:78,x2:90,y2:82}, br:{x1:110,y1:82,x2:132,y2:78} },
  taunting: { eye:"#f43f5e", er:7,  dot:"#f43f5e",
    mouth:{ type:"path", p:{d:"M80 118 Q100 114 120 118",stroke:"#f43f5e",strokeWidth:2,fill:"none",strokeLinecap:"round"}},
    bl:{x1:68,y1:74,x2:90,y2:80}, br:{x1:110,y1:80,x2:132,y2:74} },
  shocked:  { eye:"#f0d878", er:8,  dot:"#f0d878",
    mouth:{ type:"path", p:{d:"M80 122 Q100 130 120 122",stroke:"#f0d878",strokeWidth:2.5,fill:"none",strokeLinecap:"round"}},
    bl:{x1:68,y1:82,x2:90,y2:76}, br:{x1:110,y1:76,x2:132,y2:82} },
  defeated: { eye:"#2dd4a0", er:4,  dot:"#2dd4a0",
    mouth:{ type:"path", p:{d:"M80 122 Q100 115 120 122",stroke:"#2dd4a0",strokeWidth:2,fill:"none",strokeLinecap:"round"}},
    bl:{x1:68,y1:80,x2:90,y2:84}, br:{x1:110,y1:84,x2:132,y2:80} },
  amused:   { eye:"#fb923c", er:6,  dot:"#fb923c",
    mouth:{ type:"path", p:{d:"M80 122 Q100 128 120 122",stroke:"#fb923c",strokeWidth:2,fill:"none",strokeLinecap:"round"}},
    bl:{x1:68,y1:76,x2:90,y2:80}, br:{x1:110,y1:80,x2:132,y2:76} },
};

// ═══════════════════════════════════════════════════════════════
// AXIOM FACE
// ═══════════════════════════════════════════════════════════════
function AxiomFace({ mood="idle", size=64 }) {
  const uid = useRef(Math.random().toString(36).slice(2)).current;
  const m = MOODS[mood] || MOODS.idle;
  const sc = size / 200;
  const s2 = v => Math.round(v * sc);
  const fid = `gc-${uid}`;
  const ex = s2(95), ey = s2(92);
  const r1=s2(30),r2=s2(24),r3=s2(17),r4=s2(9),r5=s2(4);
  return (
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{position:"absolute",inset:0,animation:"hexRotate 22s linear infinite, axiomPulse 3s ease-in-out infinite"}}>
        <polygon points={`${s2(100)},${s2(12)} ${s2(178)},${s2(56)} ${s2(178)},${s2(144)} ${s2(100)},${s2(188)} ${s2(22)},${s2(144)} ${s2(22)},${s2(56)}`}
          fill="none" stroke={m.eye} strokeWidth={sc*1.2} strokeOpacity=".15" strokeDasharray={`${s2(10)} ${s2(7)}`}/>
        {/* Circuit lines */}
        <line x1={s2(100)} y1={s2(12)} x2={s2(100)} y2={s2(0)}
          stroke={m.eye} strokeWidth={sc*0.8} opacity=".4" strokeLinecap="round"/>
        <line x1={s2(178)} y1={s2(56)} x2={s2(196)} y2={s2(46)}
          stroke={m.eye} strokeWidth={sc*0.8} opacity=".4" strokeLinecap="round"/>
        <line x1={s2(178)} y1={s2(144)} x2={s2(196)} y2={s2(154)}
          stroke={m.eye} strokeWidth={sc*0.8} opacity=".4" strokeLinecap="round"/>
        <line x1={s2(22)} y1={s2(144)} x2={s2(4)} y2={s2(154)}
          stroke={m.eye} strokeWidth={sc*0.8} opacity=".4" strokeLinecap="round"/>
      </svg>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{position:"absolute",inset:0,animation:"hexRotateCCW 14s linear infinite"}}>
        <polygon points={`${s2(100)},${s2(22)} ${s2(164)},${s2(61)} ${s2(164)},${s2(139)} ${s2(100)},${s2(178)} ${s2(36)},${s2(139)} ${s2(36)},${s2(61)}`}
          fill="none" stroke="rgba(34,211,238,.1)" strokeWidth={sc*.7} strokeDasharray={`${s2(4)} ${s2(12)}`}/>
      </svg>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{position:"absolute",inset:0}}>
        <defs><filter id={fid}><feGaussianBlur stdDeviation={sc*1.5} result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
        <polygon points={`${s2(100)},${s2(12)} ${s2(178)},${s2(56)} ${s2(178)},${s2(144)} ${s2(100)},${s2(188)} ${s2(22)},${s2(144)} ${s2(22)},${s2(56)}`}
          fill="#030810" stroke={m.eye} strokeWidth={size>80?1.8:1.2} filter={`url(#${fid})`}/>
        <line x1={s2(52)} y1={s2(62)} x2={s2(136)} y2={s2(55)} stroke={m.eye} strokeWidth={size>80?1.8:1.2} strokeLinecap="round" opacity=".9"/>
        <line x1={s2(136)} y1={s2(55)} x2={s2(148)} y2={s2(63)} stroke={m.eye} strokeWidth={size>80?1.8:1.2} strokeLinecap="round" opacity=".9"/>
        {/* Eyebrows — coords vary per mood, taunting = furrowed/angry */}
        <line x1={s2(m.bl.x1)} y1={s2(m.bl.y1)} x2={s2(m.bl.x2)} y2={s2(m.bl.y2)}
          stroke={m.eye} strokeWidth={sc*2} strokeLinecap="round" opacity=".85"
          style={{animation: mood==="taunting" ? "ax-browTwitch 0.6s ease-in-out infinite" : "none"}}/>
        <line x1={s2(m.br.x1)} y1={s2(m.br.y1)} x2={s2(m.br.x2)} y2={s2(m.br.y2)}
          stroke={m.eye} strokeWidth={sc*2} strokeLinecap="round" opacity=".85"
          style={{animation: mood==="taunting" ? "ax-browTwitch 0.6s ease-in-out infinite" : "none"}}/>
        <ellipse cx={ex} cy={ey} rx={s2(36)} ry={s2(29)} fill="#010407"/>
        <circle cx={ex} cy={ey} r={r1} fill="none" stroke={m.eye} strokeWidth={size>80?1.5:1} opacity=".9"/>
        <circle cx={ex} cy={ey} r={s2(28)} fill="#050f20"/>
        <circle cx={ex} cy={ey} r={r2} fill="none" stroke={m.eye} strokeWidth={sc*.8} opacity=".5" style={{animation:"axiomPulse 2s infinite"}}/>
        <circle cx={ex} cy={ey} r={r3} fill="none" stroke="rgba(34,211,238,.3)" strokeWidth={sc*.6}/>
        <circle cx={ex} cy={ey} r={r4} fill="#020912"/>
        <circle cx={ex} cy={ey} r={r5} fill={m.eye} filter={`url(#${fid})`}
          style={{animation:"ic-blink 3s ease-in-out infinite",transformBox:"fill-box",transformOrigin:"center"}}/>
        <ellipse cx={ex+s2(8)} cy={ey-s2(8)} rx={s2(5)} ry={s2(3.5)} fill="rgba(224,247,255,.5)"/>
        <rect x={s2(58)} y={ey} width={s2(74)} height={sc*.9} fill={m.eye} opacity=".35" style={{animation:"scanDown 3s linear infinite"}}/>
        {m.mouth.type==="path"
          ? <path d={`M${s2(65)} ${s2(140)} Q${s2(100)} ${s2(140+m.er*sc*1.8)} ${s2(135)} ${s2(140)}`} stroke={m.eye} strokeWidth={sc*1.2} fill="none" strokeLinecap="round" opacity=".6"/>
          : <line x1={s2(70)} y1={s2(140)} x2={s2(130)} y2={s2(140)} stroke={m.eye} strokeWidth={sc*1.2} strokeLinecap="round" opacity=".6"/>
        }
      </svg>
      <div style={{position:"absolute",bottom:size>80?8:1,right:size>80?8:1,width:size>80?10:6,height:size>80?10:6,borderRadius:"50%",background:m.dot,border:`${sc*2}px solid #04060f`,animation:"axiomPulse 2s infinite",transition:"all .4s"}}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AXIOM PANEL
// ═══════════════════════════════════════════════════════════════
function AxiomPanel({ mood, speech, loading, compact=false }) {
  const ec = (MOODS[mood]||MOODS.idle).eye;
  if (compact) return (
    <div style={{display:"flex",alignItems:"center",gap:10,
      background:"rgba(4,10,22,.85)",border:"1px solid rgba(34,211,238,.15)",
      borderRadius:14,padding:"10px 12px",marginBottom:12,backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)"}}>
      <AxiomFace mood={mood} size={44}/>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:10,letterSpacing:"2.5px",color:ec,fontWeight:600,opacity:.65,marginBottom:3}}>AXIOM</div>
        <div style={{fontSize:"clamp(11px,3vw,13px)",color:"#e8e6e1",lineHeight:1.45,
          overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",
          fontStyle:"italic",animation:"moodIn .35s ease",opacity:loading?.4:1}}>
          {loading?"...":speech}
        </div>
      </div>
    </div>
  );
  return (
    <div style={{background:"rgba(4,10,22,.9)",border:"1px solid rgba(34,211,238,.18)",borderRadius:16,padding:16,marginBottom:16}}>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <AxiomFace mood={mood} size={68}/>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
            <span style={{fontSize:12,letterSpacing:"3px",color:ec,fontWeight:700}}>AXIOM</span>
            <span style={{fontSize:9,padding:"2px 6px",background:"rgba(34,211,238,.1)",borderRadius:8,color:"rgba(34,211,238,.55)",letterSpacing:"1px"}}>AI OPPONENT</span>
          </div>
          <div style={{fontSize:"clamp(12px,3.2vw,14px)",color:"#e8e6e1",lineHeight:1.55,
            fontStyle:"italic",animation:"moodIn .4s ease",opacity:loading?.4:1,transition:"opacity .2s"}}>
            {loading?"...":`"${speech}"`}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// LANGUAGE PICKER
// ═══════════════════════════════════════════════════════════════
function LangPicker({ lang, onChange }) {
  return (
    <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:16,flexWrap:"wrap"}}>
      {LANGUAGES.map(l => (
        <button
          key={l.code}
          disabled={!l.ready}
          onClick={() => l.ready && onChange(l.code)}
          title={l.ready ? l.label : `${l.label} — coming soon`}
          style={{
            position:"relative",
            display:"flex",alignItems:"center",gap:5,
            padding:"6px 12px",borderRadius:20,fontSize:12,fontWeight:600,
            fontFamily:"inherit",cursor:l.ready?"pointer":"not-allowed",transition:"all .2s",
            background: lang===l.code ? "rgba(232,197,71,.12)" : "rgba(255,255,255,.03)",
            border: lang===l.code ? "1px solid rgba(232,197,71,.45)" : "1px solid rgba(255,255,255,.07)",
            color: !l.ready ? "rgba(255,255,255,.25)" : (lang===l.code ? "#e8c547" : "#5a5a68"),
            opacity: l.ready ? 1 : .55,
          }}
        >
          <span style={{fontSize:16}}>{l.flag}</span>
          <span>{l.label}</span>
          {!l.ready && (
            <span style={{
              position:"absolute",top:-6,right:-6,fontSize:8,letterSpacing:"0.5px",
              background:"#e8c547",color:"#1a0f00",borderRadius:4,padding:"1px 4px",fontWeight:700,
            }}>SOON</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CINEMATIC INTRO
// ═══════════════════════════════════════════════════════════════
function CinematicIntro({ onComplete }) {
  const [phase, setPhase] = useState(0);
  const ss = Math.min(window.innerWidth * 0.44, 180);
  const sc = ss / 200;
  const sp = v => Math.round(v * sc);
  const pts = useRef(Array.from({length:18},()=>({
    x:Math.random()*100,y:Math.random()*100,
    s:2+Math.random()*3,d:3+Math.random()*4,dl:Math.random()*2
  }))).current;

  useEffect(() => {
    const t = [
      setTimeout(()=>setPhase(1),300),
      setTimeout(()=>setPhase(2),2600),
      setTimeout(()=>setPhase(3),4000),
      setTimeout(()=>setPhase(4),5800),
    ];
    return ()=>t.forEach(clearTimeout);
  },[]);

  return (
    <div onClick={()=>phase>=3&&onComplete()} style={{
      position:"fixed",inset:0,zIndex:9999,background:"#040408",
      display:"flex",flexDirection:"column",alignItems:"center",
      justifyContent:"center",cursor:phase>=3?"pointer":"default",overflow:"hidden"}}>
      {pts.map((p,i)=>(
        <div key={i} style={{position:"absolute",width:p.s,height:p.s,borderRadius:"50%",background:"#e8c547",
          left:`${p.x}%`,top:`${p.y}%`,pointerEvents:"none",
          opacity:phase>=2?0.05+(i%3)*0.04:0,transition:`opacity ${1+(i%3)*.5}s ease`,
          animation:`g-float ${p.d}s ease-in-out ${p.dl}s infinite`}}/>
      ))}
      {BETA_MODE&&<div style={{position:"absolute",top:"max(14px,env(safe-area-inset-top))",right:16,fontSize:10,letterSpacing:"2px",color:"rgba(45,212,160,.75)",background:"rgba(45,212,160,.09)",border:"1px solid rgba(45,212,160,.22)",padding:"4px 10px",borderRadius:20,fontWeight:600}}>β BETA</div>}
      {/* Seal */}
      <div style={{position:"absolute",opacity:phase>=1&&phase<3?1:0,
        transform:phase===1?"scale(1)":phase>=3?"scale(1.5)":"scale(.25)",
        transition:phase===1?"all .75s cubic-bezier(.34,1.56,.64,1)":"all .55s ease",
        display:"flex",flexDirection:"column",alignItems:"center"}}>
        <div style={{width:ss,height:ss,borderRadius:"50%",border:"3px solid rgba(232,197,71,.4)",
          display:"flex",alignItems:"center",justifyContent:"center",position:"relative",
          boxShadow:"0 0 36px rgba(232,197,71,.1),inset 0 0 20px rgba(232,197,71,.05)"}}>
          <div style={{width:sp(175),height:sp(175),borderRadius:"50%",border:"1.5px solid rgba(232,197,71,.2)",
            display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
            <div style={{fontSize:sp(10),letterSpacing:sp(8),color:"rgba(232,197,71,.4)",marginBottom:sp(5)}}>★ ★ ★</div>
            <div style={{fontFamily:"Georgia,serif",fontSize:sp(36),fontWeight:700,letterSpacing:sp(5),color:"#e8c547",textShadow:"0 0 15px rgba(232,197,71,.3)"}}>SIAL</div>
            <div style={{width:sp(80),height:1.5,margin:`${sp(7)}px 0`,background:"linear-gradient(90deg,transparent,rgba(232,197,71,.4),transparent)"}}/>
            <div style={{fontSize:sp(12),letterSpacing:sp(6),fontWeight:600,color:"rgba(232,197,71,.55)"}}>GAMES</div>
            <div style={{fontSize:sp(10),letterSpacing:sp(8),color:"rgba(232,197,71,.4)",marginTop:sp(5)}}>★ ★ ★</div>
          </div>
          <svg width={ss} height={ss} viewBox={`0 0 ${ss} ${ss}`}
            style={{position:"absolute",top:0,left:0,animation:"hexRotate 18s linear infinite"}}>
            <defs>
              <path id="seal-ring"
                d={`M ${ss/2},${ss/2} m -${ss*.42},0 a ${ss*.42},${ss*.42} 0 1,1 ${ss*.84},0 a ${ss*.42},${ss*.42} 0 1,1 -${ss*.84},0`}/>
            </defs>
            <text fill="rgba(232,197,71,.28)"
              fontSize={Math.round(ss*.058)}
              letterSpacing={Math.round(ss*.032)}
              fontFamily="Georgia,serif">
              <textPath href="#seal-ring">
                · SIAL DIGITAL FACTORY · MADE IN SLOVENIA · EST. 2000 · SIAL DIGITAL FACTORY · MADE IN SLOVENIA · EST. 2000 ·
              </textPath>
            </text>
          </svg>
        </div>
        <div style={{marginTop:sp(16),fontSize:sp(11),letterSpacing:sp(6),color:"rgba(232,197,71,.4)",fontWeight:500,opacity:phase>=1?1:0,transition:"opacity .5s ease .3s"}}>PRESENTS</div>
      </div>
      {/* Logo */}
      <div style={{position:"absolute",display:"flex",flexDirection:"column",alignItems:"center",
        opacity:phase>=3?1:0,transform:phase>=3?"scale(1) translateY(0)":"scale(.45) translateY(20px)",
        transition:"all .9s cubic-bezier(.34,1.56,.64,1) .1s"}}>
        <h1 style={{fontFamily:"Georgia,serif",fontSize:"clamp(62px,17vw,92px)",fontWeight:900,letterSpacing:-2,margin:0,lineHeight:1,
          background:"linear-gradient(135deg,#e8c547,#f0d878,rgba(255,255,255,.6),#e8c547)",backgroundSize:"200% auto",
          WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          animation:"g-shimmer 3s ease infinite",filter:"drop-shadow(0 0 24px rgba(232,197,71,.3))"}}>
          BLUFF<sup style={{fontSize:"clamp(12px,3vw,15px)",WebkitTextFillColor:"rgba(232,197,71,.5)",position:"relative",top:"clamp(-28px,-6vw,-38px)",marginLeft:2,fontFamily:"system-ui",fontWeight:400}}>™</sup>
        </h1>
        <div style={{width:phase>=3?180:0,height:1.5,marginTop:10,background:"linear-gradient(90deg,transparent,rgba(232,197,71,.4),transparent)",transition:"width .8s ease .5s"}}/>
        <div style={{marginTop:12,fontSize:"clamp(10px,2.5vw,12px)",letterSpacing:"clamp(3px,1vw,5px)",color:"rgba(232,197,71,.5)",textTransform:"uppercase",fontWeight:500,opacity:phase>=4?1:0,transition:"opacity .5s .2s"}}>The AI Deception Game</div>
        <div style={{marginTop:32,fontSize:11,letterSpacing:"3px",color:"rgba(255,255,255,.22)",textTransform:"uppercase",animation:"g-tapPulse 2s infinite",opacity:phase>=4?1:0,transition:"opacity .4s .4s"}}>Tap anywhere to play</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function Particles({count=14}) {
  const ps = useRef(Array.from({length:count},()=>({
    x:Math.random()*100,y:Math.random()*100,
    s:2+Math.random()*3,d:3+Math.random()*5,dl:Math.random()*3
  }))).current;
  return (
    <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none",zIndex:0}}>
      {ps.map((p,i)=><div key={i} style={{position:"absolute",width:p.s,height:p.s,borderRadius:"50%",background:"#e8c547",opacity:.06,left:`${p.x}%`,top:`${p.y}%`,animation:`g-float ${p.d}s ease-in-out ${p.dl}s infinite`}}/>)}
    </div>
  );
}

function Confetti() {
  const colors=["#e8c547","#2dd4a0","#60a5fa","#f43f5e","#a78bfa","#fb923c"];
  const ps=useRef(Array.from({length:44},()=>({
    x:Math.random()*100,dl:Math.random()*1.1,
    c:colors[Math.floor(Math.random()*colors.length)],
    w:4+Math.random()*9,h:4+Math.random()*9,
    r:Math.random()>.5,dur:1.4+Math.random()*1.2
  }))).current;
  return (
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,overflow:"hidden"}}>
      {ps.map((p,i)=><div key={i} style={{position:"absolute",top:-20,left:`${p.x}%`,width:p.w,height:p.h,background:p.c,borderRadius:p.r?"50%":"2px",animation:`g-confetti ${p.dur}s ease-in ${p.dl}s forwards`}}/>)}
    </div>
  );
}

function TimerRing({time,max=45,size=48}) {
  const r=(size-6)/2,circ=2*Math.PI*r;
  const color=time<=5?"#f43f5e":time<=10?"#fb923c":time<=15?"#e8c547":"#e8c547";
  const pct=Math.max(0,time/max);
  const strokeW = time<=5 ? 5 : time<=10 ? 4.5 : time<=15 ? 4 : 3;
  const [glitchKey,setGlitchKey]=useState(0);
  useEffect(()=>{
    if(time<=0) return;
    const delay=7000+Math.random()*6000;
    const to=setTimeout(()=>setGlitchKey(k=>k+1),delay);
    return ()=>clearTimeout(to);
  },[glitchKey,time]);
  return (
    <div
      key={`timer-${glitchKey}`}
      style={{
        position:"relative",width:size,height:size,flexShrink:0,color,
        animation: glitchKey>0 ? "timer-glitch 400ms ease-out" : "none",
      }}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={strokeW}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={strokeW}
          strokeDasharray={circ} strokeDashoffset={circ*(1-pct)}
          strokeLinecap="round" style={{transition:"stroke-dashoffset 1s linear,stroke .3s,stroke-width .3s"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color,animation:time<=5?"g-pulse .5s infinite":"none"}}>{time}</div>
    </div>
  );
}

// ── Freemium: 3 free solo games/day, localStorage counter with midnight reset ──
function getFreeGamesKey() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `bluff_free_games_${yyyy}-${mm}-${dd}`;
}

function getFreeGamesUsed() {
  try {
    const key = getFreeGamesKey();
    return parseInt(localStorage.getItem(key) || "0", 10);
  } catch { return 0; }
}

function incrementFreeGames() {
  try {
    const key = getFreeGamesKey();
    const current = getFreeGamesUsed();
    localStorage.setItem(key, String(current + 1));
    return current + 1;
  } catch { return 0; }
}

function generateShareCard(score, total, best, speech, won, correctCount, maxCashout, axiomScore) {
  try {
    correctCount = correctCount ?? total;
    maxCashout = maxCashout ?? 1.0;
    axiomScore = axiomScore ?? 0;
    const c = document.createElement("canvas");
    c.width = 900; c.height = 500;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#04060f"; ctx.fillRect(0, 0, 900, 500);
    ctx.strokeStyle = "rgba(34,211,238,.04)"; ctx.lineWidth = 1;
    for (let x = 0; x < 900; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 500); ctx.stroke(); }
    for (let y = 0; y < 500; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(900, y); ctx.stroke(); }
    const grd = ctx.createRadialGradient(450, 0, 0, 450, 0, 380);
    grd.addColorStop(0, "rgba(232,197,71,.08)"); grd.addColorStop(1, "transparent");
    ctx.fillStyle = grd; ctx.fillRect(0, 0, 900, 500);

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,.2)"; ctx.font = "500 11px system-ui";
    ctx.fillText("SIAL GAMES", 450, 48);

    ctx.font = "900 56px Georgia,serif";
    const lg = ctx.createLinearGradient(340, 0, 560, 0);
    lg.addColorStop(0, "#e8c547"); lg.addColorStop(.5, "#fff"); lg.addColorStop(1, "#e8c547");
    ctx.fillStyle = lg; ctx.fillText("BLUFF™", 450, 120);

    ctx.strokeStyle = "rgba(232,197,71,.22)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(360, 152); ctx.lineTo(540, 152); ctx.stroke();

    ctx.fillStyle = won ? "#2dd4a0" : "rgba(244,63,94,.85)"; ctx.font = "700 16px system-ui";
    ctx.fillText(won ? "I DEFEATED AXIOM" : "AXIOM DEFEATED ME", 450, 180);

    const scoreFmt = score.toLocaleString('en-US');
    ctx.fillStyle = "#e8c547"; ctx.font = "900 72px Georgia,serif";
    ctx.fillText(scoreFmt, 450, 270);

    ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.font = "500 14px system-ui";
    ctx.fillText("POINTS", 450, 298);

    ctx.font = "500 13px system-ui";
    const axiomFmt = axiomScore.toLocaleString('en-US');
    const stats = [
      { label: won ? `Beat AXIOM ${score.toLocaleString('en-US')} vs ${axiomFmt}` : `Lost ${score.toLocaleString('en-US')} vs ${axiomFmt}`, color: won ? "#2dd4a0" : "#f43f5e" },
      { label: `Best streak ${best}🔥`, color: "#e8c547" },
      { label: `Max ${maxCashout.toFixed(1)}x 💰`, color: "#f43f5e" },
    ];
    const sepWidth = 24;
    const widths = stats.map(s => ctx.measureText(s.label).width);
    const totalWidth = widths.reduce((a, b) => a + b, 0) + sepWidth * 2;
    let x = 450 - totalWidth / 2;
    ctx.textAlign = "left";
    stats.forEach((s, i) => {
      ctx.fillStyle = s.color;
      ctx.fillText(s.label, x, 348);
      x += widths[i];
      if (i < stats.length - 1) {
        ctx.fillStyle = "rgba(255,255,255,.2)";
        ctx.fillText("·", x + sepWidth / 2 - 2, 348);
        x += sepWidth;
      }
    });
    ctx.textAlign = "center";

    if (speech && speech !== "...") {
      ctx.fillStyle = "rgba(34,211,238,.5)"; ctx.font = "italic 500 15px system-ui";
      ctx.fillText(`"${speech}"`, 450, 400);
    }
    ctx.fillStyle = "rgba(255,255,255,.14)"; ctx.font = "500 12px system-ui";
    ctx.fillText("playbluff.games  ·  SIAL Consulting d.o.o.", 450, 458);
    ctx.strokeStyle = "rgba(232,197,71,.1)"; ctx.lineWidth = 2; ctx.strokeRect(1, 1, 898, 498);
    return c.toDataURL("image/png");
  } catch (e) { console.error("[share-card]", e); return null; }
}

function generateStoriesCard(score, total, best, axiomSpeech, won, lieText, roastLine, correctCount, maxCashout, axiomScore) {
  correctCount = correctCount ?? total;
  maxCashout = maxCashout ?? 1.0;
  axiomScore = axiomScore ?? 0;
  try {
    const W = 540, H = 960; // 1:1.77 = 9:16 portrait
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");

    // Background
    ctx.fillStyle = "#04060f";
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = "rgba(34,211,238,.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 30) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 30) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // Top glow
    const topGlow = ctx.createRadialGradient(W/2, 0, 0, W/2, 0, 300);
    topGlow.addColorStop(0, "rgba(232,197,71,.12)");
    topGlow.addColorStop(1, "transparent");
    ctx.fillStyle = topGlow;
    ctx.fillRect(0, 0, W, H);

    // Bottom glow (AXIOM cyan)
    const botGlow = ctx.createRadialGradient(W/2, H, 0, W/2, H, 300);
    botGlow.addColorStop(0, "rgba(34,211,238,.08)");
    botGlow.addColorStop(1, "transparent");
    ctx.fillStyle = botGlow;
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = "center";

    // ── Top section ──
    // SIAL label
    ctx.fillStyle = "rgba(255,255,255,.2)";
    ctx.font = "500 10px system-ui";
    ctx.fillText("SIAL GAMES PRESENTS", W/2, 60);

    // BLUFF logo
    ctx.font = "900 80px Georgia,serif";
    const lg = ctx.createLinearGradient(150, 0, 390, 0);
    lg.addColorStop(0, "#e8c547");
    lg.addColorStop(.5, "#fff");
    lg.addColorStop(1, "#e8c547");
    ctx.fillStyle = lg;
    ctx.fillText("BLUFF™", W/2, 148);

    // Divider
    ctx.strokeStyle = "rgba(232,197,71,.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(160, 168); ctx.lineTo(380, 168); ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,.3)";
    ctx.font = "500 11px system-ui";
    ctx.fillText("THE AI DECEPTION GAME", W/2, 190);

    // ── AXIOM hex face (SVG-like on canvas) ──
    const cx = W/2, cy = 360, hr = 90;
    // Outer hex
    ctx.strokeStyle = won ? "rgba(45,212,160,.5)" : "rgba(244,63,94,.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const x = cx + hr * Math.cos(a), y = cy + hr * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();

    // Inner hex fill
    ctx.fillStyle = "#030810";
    ctx.beginPath();
    const ir = 78;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 2;
      const x = cx + ir * Math.cos(a), y = cy + ir * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = won ? "rgba(45,212,160,.8)" : "rgba(244,63,94,.8)";
    ctx.stroke();

    // Eyes
    const eyeColor = won ? "#2dd4a0" : "#f43f5e";
    ctx.fillStyle = eyeColor;
    ctx.shadowColor = eyeColor;
    ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(cx - 24, cy - 8, won ? 7 : 9, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 24, cy - 8, won ? 7 : 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#030810";
    ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.arc(cx - 24, cy - 8, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 24, cy - 8, 3, 0, Math.PI * 2); ctx.fill();

    // Mouth
    ctx.strokeStyle = eyeColor;
    ctx.shadowColor = eyeColor;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (won) {
      // Defeated — downward curve
      ctx.moveTo(cx - 20, cy + 20);
      ctx.quadraticCurveTo(cx, cy + 28, cx + 20, cy + 20);
    } else {
      // Smug — upward curve
      ctx.moveTo(cx - 20, cy + 22);
      ctx.quadraticCurveTo(cx, cy + 16, cx + 20, cy + 22);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // AXIOM label under face
    ctx.fillStyle = "rgba(34,211,238,.45)";
    ctx.font = "600 10px system-ui";
    ctx.fillText("A X I O M", W/2, cy + 115);

    // ── Score section ──
    ctx.fillStyle = won ? "#2dd4a0" : "#f43f5e";
    ctx.font = "700 18px system-ui";
    ctx.fillText(won ? "I DEFEATED AXIOM" : "AXIOM DEFEATED ME", W/2, cy + 155);

    const scoreFmt = score.toLocaleString('en-US');
    const axiomFmt = axiomScore.toLocaleString('en-US');

    ctx.fillStyle = "#e8c547";
    ctx.font = "900 64px Georgia,serif";
    ctx.fillText(scoreFmt, W/2, cy + 220);

    ctx.fillStyle = "rgba(255,255,255,.4)";
    ctx.font = "500 12px system-ui";
    ctx.fillText("POINTS", W/2, cy + 248);

    // Stats panel — 3 rows
    const panelY = cy + 266;
    const rowH = 30;
    const rows = [
      { label: "vs AXIOM", value: `${scoreFmt} vs ${axiomFmt}`, color: won ? "#2dd4a0" : "#f43f5e" },
      { label: "Best streak", value: `${best} 🔥`, color: "#e8c547" },
      { label: "Max cashout", value: `${maxCashout.toFixed(1)}x 💰`, color: "#f43f5e" },
    ];
    rows.forEach((row, i) => {
      const ry = panelY + i * (rowH + 6);
      ctx.fillStyle = "rgba(255,255,255,.03)";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(40, ry, W - 80, rowH, 6);
      else ctx.rect(40, ry, W - 80, rowH);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.45)";
      ctx.font = "500 12px system-ui";
      ctx.textAlign = "left";
      ctx.fillText(row.label, 54, ry + 19);
      ctx.fillStyle = row.color;
      ctx.font = "600 12px system-ui";
      ctx.textAlign = "right";
      ctx.fillText(row.value, W - 54, ry + 19);
    });
    ctx.textAlign = "center";

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, panelY + 3 * (rowH + 6) + 8); ctx.lineTo(W - 60, panelY + 3 * (rowH + 6) + 8); ctx.stroke();

    // AXIOM quote
    const displayQuote = roastLine || axiomSpeech;
    if (displayQuote && displayQuote !== "...") {
      ctx.fillStyle = "rgba(34,211,238,.55)";
      ctx.font = "italic 500 13px system-ui";
      const maxW = W - 80;
      const words = `"${displayQuote}"`.split(" ");
      let line = "", lines = [], y = panelY + 3 * (rowH + 6) + 30;
      words.forEach(word => {
        const test = line + word + " ";
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line.trim()); line = word + " ";
        } else { line = test; }
      });
      lines.push(line.trim());
      lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, W/2, y + i * 20));
    }

    // The lie (if available)
    if (lieText) {
      const lieY = cy + 390;
      ctx.fillStyle = "rgba(244,63,94,.15)";
      ctx.beginPath();
      ctx.roundRect(30, lieY - 20, W - 60, 56, 8);
      ctx.fill();
      ctx.strokeStyle = "rgba(244,63,94,.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#f43f5e";
      ctx.font = "700 9px system-ui";
      ctx.fillText("🎭 THE LIE WAS:", W/2, lieY - 3);
      ctx.fillStyle = "rgba(255,255,255,.7)";
      ctx.font = "500 11px system-ui";
      const lw = W - 100;
      const lwords = lieText.split(" ");
      let lline = "", llines = [];
      lwords.forEach(word => {
        const test = lline + word + " ";
        if (ctx.measureText(test).width > lw && lline) {
          llines.push(lline.trim()); lline = word + " ";
        } else { lline = test; }
      });
      llines.push(lline.trim());
      llines.slice(0, 2).forEach((l, i) => ctx.fillText(l, W/2, lieY + 16 + i * 16));
    }

    // ── Bottom CTA ──
    ctx.fillStyle = "rgba(232,197,71,.1)";
    ctx.beginPath();
    ctx.roundRect(30, H - 160, W - 60, 50, 10);
    ctx.fill();
    ctx.strokeStyle = "rgba(232,197,71,.3)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#e8c547";
    ctx.font = "700 16px system-ui";
    ctx.fillText("Can you beat me? 🎯", W/2, H - 129);

    ctx.fillStyle = "rgba(255,255,255,.2)";
    ctx.font = "500 11px system-ui";
    ctx.fillText("playbluff.games", W/2, H - 100);

    ctx.fillStyle = "rgba(255,255,255,.1)";
    ctx.font = "500 10px system-ui";
    ctx.fillText("#BluffGame  #SIAL", W/2, H - 78);

    // Border glow
    ctx.strokeStyle = "rgba(232,197,71,.08)";
    ctx.lineWidth = 3;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    return c.toDataURL("image/png");
  } catch (e) {
    console.error("[stories-card]", e);
    return null;
  }
}


// ═══════════════════════════════════════════════════════════════
// CASINO AUDIO HELPERS — stake ticks, roulette clicks, wheel chime
// ═══════════════════════════════════════════════════════════════
let _tickCtx = null;
function _ensureTickCtx() {
  if (_tickCtx) return _tickCtx;
  try { _tickCtx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch { return null; }
  return _tickCtx;
}
function _closeTickCtx() {
  if (!_tickCtx) return;
  try { _tickCtx.close(); } catch {}
  _tickCtx = null;
}
function playTick(intensity = "light") {
  const ctx = _ensureTickCtx(); if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = intensity === "heavy" ? 880 : intensity === "medium" ? 660 : 440;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t); osc.stop(t + 0.09);
  } catch {}
}
function playRouletteClicks(durationMs) {
  const ctx = _ensureTickCtx(); if (!ctx) return;
  try {
    const start = ctx.currentTime;
    const clicks = 40;
    for (let i = 0; i < clicks; i++) {
      const progress = i / clicks;
      const t = start + (progress * progress * (durationMs / 1000));
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 1800 - progress * 1000;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.08, t + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.05);
    }
  } catch {}
}
function playWheelChime(kind) {
  const ctx = _ensureTickCtx(); if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const frequencies = {
      jackpot: [523.25, 659.25, 783.99, 1046.5],
      win:     [659.25, 783.99],
      loss:    [196, 146.83],
      catastrophe: [110, 82.4, 55],
    };
    const freqs = frequencies[kind] || frequencies.win;
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === "catastrophe" ? "sawtooth" : "sine";
      osc.frequency.value = f;
      const t = now + i * 0.12;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t); osc.stop(t + 1);
    });
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// CASINO CHIP (decorative SVG)
// ═══════════════════════════════════════════════════════════════
function CasinoChip({ tier = "gold", value, size = 56 }) {
  const colors = {
    bronze: { center:"#c08550",rim:"#8b5e2f",edge:"#6b4822",highlight:"#ffd9a8",text:"#3a2510",inner:"#9e6838",shimmer:"#ffe5c2" },
    silver: { center:"#c8c8d0",rim:"#8e8e98",edge:"#5e5e68",highlight:"#f8f8fc",text:"#2a2a32",inner:"#a0a0aa",shimmer:"#fff" },
    gold:   { center:"#e8c547",rim:"#9e7c1f",edge:"#6e5512",highlight:"#ffe99a",text:"#4a3a0e",inner:"#d4a830",shimmer:"#fff8d4" },
  };
  const c = colors[tier] || colors.gold;
  const id = useRef(`chip-${tier}-${Math.random().toString(36).slice(2,7)}`).current;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{filter:`drop-shadow(0 8px 24px ${c.edge}aa)`}}>
      <defs>
        <radialGradient id={`${id}-body`} cx="0.35" cy="0.3">
          <stop offset="0%" stopColor={c.shimmer}/>
          <stop offset="20%" stopColor={c.highlight}/>
          <stop offset="50%" stopColor={c.center}/>
          <stop offset="100%" stopColor={c.rim}/>
        </radialGradient>
        <radialGradient id={`${id}-inner`} cx="0.4" cy="0.35">
          <stop offset="0%" stopColor={c.highlight} stopOpacity="0.95"/>
          <stop offset="60%" stopColor={c.center}/>
          <stop offset="100%" stopColor={c.inner}/>
        </radialGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.4"/>
          <stop offset="40%" stopColor="#fff" stopOpacity="0.1"/>
          <stop offset="100%" stopColor="#fff" stopOpacity="0"/>
        </linearGradient>
        <path id={`${id}-text-path`}
              d="M 50 50 m -42 0 a 42 42 0 1 1 84 0 a 42 42 0 1 1 -84 0"
              fill="none"/>
      </defs>
      <circle cx="50" cy="50" r="49" fill={c.edge}/>
      <circle cx="50" cy="50" r="48" fill={`url(#${id}-body)`}/>
      <circle cx="50" cy="50" r="48" fill={`url(#${id}-sheen)`}/>
      <circle cx="50" cy="50" r="48" fill="none" stroke={c.edge} strokeWidth="0.5"/>
      {[...Array(8)].map((_, i) => {
        const angle = (i / 8) * Math.PI * 2 - Math.PI / 2;
        const sx = 50 + 42 * Math.cos(angle);
        const sy = 50 + 42 * Math.sin(angle);
        return (
          <g key={i}>
            <rect x={sx-4} y={sy-2.5} width="8" height="5" rx="1"
              fill="#fff" opacity="0.9"
              transform={`rotate(${(i/8)*360+90} ${sx} ${sy})`}/>
            <rect x={sx-4} y={sy-2.5} width="8" height="1" rx="1"
              fill={c.edge} opacity="0.3"
              transform={`rotate(${(i/8)*360+90} ${sx} ${sy})`}/>
          </g>
        );
      })}
      <text fontFamily="Georgia, serif" fontSize="5" fontWeight="700"
            fill={c.text} letterSpacing="1.2">
        <textPath href={`#${id}-text-path`} startOffset="13%">
          BLUFF · CASINO ROYALE · BLUFF · CASINO ROYALE
        </textPath>
      </text>
      <circle cx="50" cy="50" r="34" fill="none" stroke={c.edge} strokeWidth="0.8" strokeDasharray="1.5 2"/>
      <circle cx="50" cy="50" r="30" fill="none" stroke={c.edge} strokeWidth="1.5" opacity="0.5"/>
      <circle cx="50" cy="50" r="27" fill={`url(#${id}-inner)`}/>
      <circle cx="50" cy="50" r="27" fill="none" stroke={c.edge} strokeWidth="0.5"/>
      {[...Array(20)].map((_, i) => {
        const angle = (i / 20) * Math.PI * 2;
        const x1 = 50 + 11 * Math.cos(angle);
        const y1 = 50 + 11 * Math.sin(angle);
        const x2 = 50 + 24 * Math.cos(angle);
        const y2 = 50 + 24 * Math.sin(angle);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c.edge} strokeWidth="0.3" opacity="0.3"/>;
      })}
      <circle cx="50" cy="50" r="14" fill={c.center} stroke={c.edge} strokeWidth="1"/>
      <circle cx="50" cy="50" r="13" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="0.4"/>
      <text x="50" y="56" textAnchor="middle" fontFamily="Georgia, serif" fontSize="14" fontWeight="900"
            fill={c.text}
            style={{filter:`drop-shadow(0 1px 1px ${c.edge}88)`}}>B</text>
      {value !== undefined && (
        <text x="50" y="78" textAnchor="middle" fontFamily="Georgia, serif" fontSize="6" fontWeight="700" fill={c.text} opacity="0.75">
          {typeof value === "number" ? value.toLocaleString('en-US') : value}
        </text>
      )}
    </svg>
  );
}

// Interleaved wheel field colors — visual layout independent from odds.
// Spin math picks a matching field by zone; layout is just for realism.
const FIELD_COLORS = [
  "green", "red", "green", "red", "green", "red", "green", "black",
  "green", "red", "green", "red", "green", "gold", "green", "red",
  "green", "red", "green", "red", "green", "black", "green", "red",
  "green", "gold", "green", "red", "green", "red", "green", "gold",
];

// ═══════════════════════════════════════════════════════════════
// WHEEL OF FORTUNE — Double-or-Nothing phase resolver
// ═══════════════════════════════════════════════════════════════
function WheelOfFortune({ phaseNum, phaseScore, totalScore, mandatory, onCashOut, onSpinResult, lang = "en", gambitMode = false, gambitRisk = null, gambitPot = 0 }) {
  const t = (key, params) => translate(key, lang, params);
  const [spinning, setSpinning] = useState(false);
  const [resultZone, setResultZone] = useState(null);
  const [finalAngle, setFinalAngle] = useState(0);
  const [showOutcome, setShowOutcome] = useState(false);
  const chipTier = phaseNum === 1 ? "bronze" : phaseNum === 2 ? "silver" : "gold";
  const spinMs = gambitMode ? 4500 : 3500;
  const riskLabel = gambitMode && gambitRisk
    ? (gambitRisk === "allin" ? t("gambit.allin") : gambitRisk === "balanced" ? t("gambit.balanced") : t("gambit.conservative"))
    : "";
  const stakeForDisplay = gambitMode ? gambitPot : phaseScore;

  const reducedMotion = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const particleCount = reducedMotion ? 0 : (isMobile ? 36 : 80);
  const showAmbient = !reducedMotion;

  const handleSpin = () => {
    const r = Math.random();
    let zone;
    if (r < 0.38) zone = "green";
    else if (r < 0.76) zone = "red";
    else if (r < 0.9375) zone = "gold";
    else zone = "black";

    // Pick a visible field that matches the chosen zone color.
    const matchingFields = FIELD_COLORS
      .map((col, idx) => col === zone ? idx : -1)
      .filter(idx => idx !== -1);
    const targetField = matchingFields.length > 0
      ? matchingFields[Math.floor(Math.random() * matchingFields.length)]
      : Math.floor(Math.random() * 32);

    const offsetInField = (Math.random() * 8 - 4);
    const targetAngle = -(targetField * 11.25 + 5.625 + offsetInField);
    const extraSpins = 5 + Math.random() * 2;
    const finalAng = targetAngle - (extraSpins * 360);

    setSpinning(true);
    setFinalAngle(0);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setFinalAngle(finalAng);
      });
    });
    try { playRouletteClicks(spinMs); } catch {}

    setTimeout(() => {
      setResultZone(zone);
      setShowOutcome(true);
      try {
        if (zone === "gold") playWheelChime("jackpot");
        else if (zone === "green") playWheelChime("win");
        else if (zone === "red") playWheelChime("loss");
        else playWheelChime("catastrophe");
      } catch {}
      setTimeout(() => onSpinResult(zone), 2600);
    }, spinMs);
  };

  return (
    <div style={{
      position:"fixed",inset:0,zIndex:2000,
      background:"radial-gradient(ellipse at 50% 30%, rgba(90,20,20,0.35) 0%, rgba(45,10,10,0.85) 40%, rgba(12,5,8,0.98) 80%, rgba(4,2,6,1) 100%)",
      backdropFilter:"blur(12px)",
      WebkitBackdropFilter:"blur(12px)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      padding:"20px",animation:"wheel-overlay-in .4s ease",
    }}>
      {/* Layer 1: Damask wallpaper pattern — blurred, subtle */}
      {showAmbient && <svg width="100%" height="100%" style={{
        position:"absolute",inset:0,
        opacity:0.08,
        filter:"blur(1.5px)",
        pointerEvents:"none",
      }}>
        <defs>
          <pattern id="damask" x="0" y="0" width="80" height="120" patternUnits="userSpaceOnUse">
            <g fill="#8b6a1f" opacity="0.8">
              <path d="M 40 10 Q 30 20, 25 35 Q 20 50, 40 55 Q 60 50, 55 35 Q 50 20, 40 10 Z"/>
              <path d="M 40 55 Q 30 65, 25 80 Q 20 95, 40 105 Q 60 95, 55 80 Q 50 65, 40 55 Z"/>
              <circle cx="40" cy="30" r="3"/>
              <circle cx="40" cy="85" r="3"/>
              <path d="M 15 60 Q 20 55, 25 60 M 55 60 Q 60 55, 65 60"
                    stroke="#8b6a1f" strokeWidth="1" fill="none"/>
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#damask)"/>
      </svg>}

      {/* Layer 2: Warm vignette glows — distant wall sconces */}
      <div style={{position:"absolute",inset:0,pointerEvents:"none"}}>
        <div style={{
          position:"absolute",top:"15%",left:"10%",
          width:200,height:200,borderRadius:"50%",
          background:"radial-gradient(circle, rgba(232,197,71,0.18) 0%, transparent 60%)",
          filter:"blur(30px)",
        }}/>
        <div style={{
          position:"absolute",top:"10%",right:"12%",
          width:180,height:180,borderRadius:"50%",
          background:"radial-gradient(circle, rgba(232,197,71,0.15) 0%, transparent 60%)",
          filter:"blur(30px)",
        }}/>
        <div style={{
          position:"absolute",bottom:"20%",left:"5%",
          width:150,height:150,borderRadius:"50%",
          background:"radial-gradient(circle, rgba(180,80,40,0.12) 0%, transparent 60%)",
          filter:"blur(25px)",
        }}/>
        <div style={{
          position:"absolute",bottom:"15%",right:"8%",
          width:170,height:170,borderRadius:"50%",
          background:"radial-gradient(circle, rgba(232,197,71,0.14) 0%, transparent 60%)",
          filter:"blur(28px)",
        }}/>
      </div>

      {/* Layer 3: Blurred chandelier silhouettes at top */}
      {showAmbient && <div style={{
        position:"absolute",top:-20,left:0,right:0,height:140,
        pointerEvents:"none",opacity:0.6,filter:"blur(1px)",
      }}>
        <svg width="120" height="140" style={{position:"absolute",left:"15%",top:0}}>
          <defs>
            <radialGradient id="chandelier-bulb-L" cx="0.5" cy="0.5">
              <stop offset="0%" stopColor="#fff9c8" stopOpacity="0.9"/>
              <stop offset="60%" stopColor="#e8c547" stopOpacity="0.5"/>
              <stop offset="100%" stopColor="#8b6a1f" stopOpacity="0"/>
            </radialGradient>
          </defs>
          <line x1="60" y1="0" x2="60" y2="30" stroke="#3a2a14" strokeWidth="1"/>
          <ellipse cx="60" cy="32" rx="8" ry="3" fill="#6b4f0f"/>
          <path d="M 35 35 Q 60 32 85 35 L 80 60 Q 60 68 40 60 Z"
                fill="#4a3a14" stroke="#8b6a1f" strokeWidth="0.5"/>
          {[...Array(7)].map((_, i) => {
            const x = 40 + i * 7;
            const length = 15 + ((i * 37) % 20);
            return (
              <g key={i}>
                <line x1={x} y1="58" x2={x} y2={58 + length} stroke="#8b6a1f" strokeWidth="0.3"/>
                <circle cx={x} cy={58 + length} r="1.5" fill="#fff9c8" opacity="0.6"/>
              </g>
            );
          })}
          <circle cx="60" cy="48" r="30" fill="url(#chandelier-bulb-L)"/>
          {[...Array(6)].map((_, i) => {
            const angle = (i / 6) * Math.PI * 2 + Math.PI / 12;
            const r = 22;
            const x = 60 + r * Math.cos(angle);
            const y = 48 + r * Math.sin(angle);
            return <circle key={i} cx={x} cy={y} r="2.5" fill="#fff9c8" opacity="0.8"/>;
          })}
        </svg>

        <svg width="100" height="120" style={{position:"absolute",right:"18%",top:10}}>
          <defs>
            <radialGradient id="chandelier-bulb-R" cx="0.5" cy="0.5">
              <stop offset="0%" stopColor="#fff9c8" stopOpacity="0.85"/>
              <stop offset="60%" stopColor="#e8c547" stopOpacity="0.4"/>
              <stop offset="100%" stopColor="#8b6a1f" stopOpacity="0"/>
            </radialGradient>
          </defs>
          <line x1="50" y1="0" x2="50" y2="25" stroke="#3a2a14" strokeWidth="1"/>
          <ellipse cx="50" cy="27" rx="6" ry="2.5" fill="#6b4f0f"/>
          <path d="M 30 30 Q 50 27 70 30 L 66 50 Q 50 57 34 50 Z"
                fill="#4a3a14" stroke="#8b6a1f" strokeWidth="0.5"/>
          {[...Array(5)].map((_, i) => {
            const x = 35 + i * 7.5;
            const length = 12 + ((i * 29) % 15);
            return (
              <g key={i}>
                <line x1={x} y1="48" x2={x} y2={48 + length} stroke="#8b6a1f" strokeWidth="0.3"/>
                <circle cx={x} cy={48 + length} r="1.2" fill="#fff9c8" opacity="0.5"/>
              </g>
            );
          })}
          <circle cx="50" cy="40" r="25" fill="url(#chandelier-bulb-R)"/>
          {[...Array(5)].map((_, i) => {
            const angle = (i / 5) * Math.PI * 2 + Math.PI / 10;
            const r = 18;
            const x = 50 + r * Math.cos(angle);
            const y = 40 + r * Math.sin(angle);
            return <circle key={i} cx={x} cy={y} r="2" fill="#fff9c8" opacity="0.75"/>;
          })}
        </svg>
      </div>}

      {/* Layer 4: Cinematic bokeh — gold sparkles, white stars, amber embers */}
      <div style={{position:"absolute",inset:0,pointerEvents:"none"}}>
        {[...Array(particleCount)].map((_, i) => {
          const type = Math.random();
          let color, size, glow;
          if (type < 0.6) {
            color = "#e8c547";
            size = 1 + Math.random() * 3;
            glow = "0 0 6px rgba(232,197,71,0.7)";
          } else if (type < 0.85) {
            color = "#ffffff";
            size = 1 + Math.random() * 2;
            glow = "0 0 8px rgba(255,255,255,0.8)";
          } else {
            color = "#ff9a3d";
            size = 2 + Math.random() * 4;
            glow = "0 0 12px rgba(255,154,61,0.6)";
          }
          const isLarge = Math.random() > 0.9;
          return (
            <div key={i} style={{
              position:"absolute",
              width: isLarge ? size*2 : size,
              height: isLarge ? size*2 : size,
              borderRadius:"50%",
              background: color,
              left:`${Math.random()*100}%`,top:`${Math.random()*100}%`,
              opacity: 0.15 + Math.random()*0.5,
              boxShadow: glow,
              animation:`wheel-particle-drift ${5+Math.random()*7}s ease-in-out infinite`,
              animationDelay:`${Math.random()*5}s`,
            }}/>
          );
        })}
      </div>

      {/* Layer 5: Radial spotlight glow behind wheel */}
      <div style={{
        position:"absolute",
        left:"50%",top:"50%",
        width:500,height:500,
        borderRadius:"50%",
        background:"radial-gradient(circle, rgba(232,197,71,0.18) 0%, rgba(232,197,71,0.05) 40%, transparent 70%)",
        filter:"blur(40px)",
        pointerEvents:"none",
        zIndex:0,
        transform:"translate(-50%,-50%)",
        animation:"wheel-spotlight-pulse 4s ease-in-out infinite",
      }}/>

      {!spinning && !showOutcome && (
        <>
          <div style={{fontSize:10,letterSpacing:6,color:"rgba(232,197,71,.6)",textTransform:"uppercase",fontWeight:700,marginBottom:6}}>
            {gambitMode ? t("gambit.header", { risk: riskLabel.toUpperCase() }) : t("wheel.phase_complete", { n: phaseNum })}
          </div>
          <div style={{fontFamily:"Georgia,serif",fontSize:28,fontWeight:900,color:"#e8c547",marginBottom:32,textAlign:"center",textShadow:"0 0 30px rgba(232,197,71,.4)"}}>
            {gambitMode ? t("gambit.title") : mandatory ? t("wheel.grand_bluff") : t("wheel.cash_or_spin")}
          </div>
        </>
      )}

      <div style={{
        marginBottom:24,
        transform:spinning?"scale(0.6) translateY(-80px)":"scale(1)",
        transition:"transform 0.5s cubic-bezier(0.4,0,0.2,1)",
      }}>
        <CasinoChip tier={chipTier} value={stakeForDisplay} size={100}/>
      </div>

      {!showOutcome && (
        <div style={{fontSize:11,letterSpacing:3,color:"rgba(255,255,255,.4)",textTransform:"uppercase",marginBottom:20}}>
          {gambitMode ? t("gambit.pot") : t("wheel.phase_stake")} <span style={{color:"#e8c547",fontWeight:700,fontSize:18,fontFamily:"Georgia,serif"}}>
            {stakeForDisplay.toLocaleString('en-US')}
          </span>
        </div>
      )}

      <div style={{
        position:"relative",width:280,height:280,marginBottom:28,
        display:"block",zIndex:1,
      }}>
        <svg width="280" height="280" viewBox="0 0 280 280"
          style={{
            transform:`rotate(${finalAngle}deg)`,
            transition:spinning?`transform ${spinMs}ms cubic-bezier(0.17,0.67,0.12,0.99)`:"none",
            filter:"drop-shadow(0 0 40px rgba(232,197,71,.35))",
          }}>
          <defs>
            <radialGradient id="field-green" cx="0.5" cy="0.3">
              <stop offset="0%" stopColor="#2d8a4d"/>
              <stop offset="60%" stopColor="#1a6b3a"/>
              <stop offset="100%" stopColor="#0d4e26"/>
            </radialGradient>
            <radialGradient id="field-red" cx="0.5" cy="0.3">
              <stop offset="0%" stopColor="#a82a2a"/>
              <stop offset="60%" stopColor="#6b1a1a"/>
              <stop offset="100%" stopColor="#3d0a0a"/>
            </radialGradient>
            <radialGradient id="field-gold" cx="0.5" cy="0.3">
              <stop offset="0%" stopColor="#ffe99a"/>
              <stop offset="50%" stopColor="#e8c547"/>
              <stop offset="100%" stopColor="#9e7c1f"/>
            </radialGradient>
            <radialGradient id="field-black" cx="0.5" cy="0.3">
              <stop offset="0%" stopColor="#2a2a2a"/>
              <stop offset="60%" stopColor="#0a0a0a"/>
              <stop offset="100%" stopColor="#000"/>
            </radialGradient>
            <linearGradient id="wheel-rim" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffe99a"/>
              <stop offset="50%" stopColor="#c49828"/>
              <stop offset="100%" stopColor="#6b4f0f"/>
            </linearGradient>
            <radialGradient id="wheel-hub" cx="0.4" cy="0.3">
              <stop offset="0%" stopColor="#3a2a14"/>
              <stop offset="60%" stopColor="#1a0f00"/>
              <stop offset="100%" stopColor="#000"/>
            </radialGradient>
            <radialGradient id="wheel-monogram-bg" cx="0.4" cy="0.3">
              <stop offset="0%" stopColor="#2a1a08"/>
              <stop offset="100%" stopColor="#0a0500"/>
            </radialGradient>
            <filter id="wheel-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur"/>
              <feMerge>
                <feMergeNode in="blur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          {/* Outer bevel ring — thick gold with depth */}
          <circle cx="140" cy="140" r="138" fill="url(#wheel-rim)"/>
          <circle cx="140" cy="140" r="135" fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth="1"/>
          <circle cx="140" cy="140" r="130" fill="#1a0f00"/>

          {/* 32 interleaved fields */}
          {[...Array(32)].map((_, i) => {
            const sa = (i*11.25-90)*Math.PI/180;
            const ea = ((i+1)*11.25-90)*Math.PI/180;
            const r = 125;
            const x1 = 140+r*Math.cos(sa), y1 = 140+r*Math.sin(sa);
            const x2 = 140+r*Math.cos(ea), y2 = 140+r*Math.sin(ea);
            const colorKey = FIELD_COLORS[i];
            return (
              <path key={i}
                d={`M 140 140 L ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2} Z`}
                fill={`url(#field-${colorKey})`}
                stroke="rgba(255,215,80,0.3)" strokeWidth="0.8"/>
            );
          })}

          {/* Inner hub ring */}
          <circle cx="140" cy="140" r="60" fill="url(#wheel-hub)" stroke="url(#wheel-rim)" strokeWidth="2.5"/>

          {/* Decorative dashed ring */}
          <circle cx="140" cy="140" r="55" fill="none" stroke="rgba(232,197,71,0.4)" strokeWidth="1" strokeDasharray="2 4"/>

          {/* 8 decorative dots around hub */}
          {[...Array(8)].map((_, i) => {
            const a = (i / 8) * Math.PI * 2;
            const x = 140 + 50 * Math.cos(a);
            const y = 140 + 50 * Math.sin(a);
            return <circle key={i} cx={x} cy={y} r="1.5" fill="#e8c547" opacity="0.6"/>;
          })}

          {/* Center monogram disc */}
          <circle cx="140" cy="140" r="32" fill="url(#wheel-monogram-bg)" stroke="url(#wheel-rim)" strokeWidth="2"/>
          <circle cx="140" cy="140" r="28" fill="none" stroke="rgba(232,197,71,0.3)" strokeWidth="0.5"/>
          <text x="140" y="148" textAnchor="middle" fontFamily="Georgia, serif" fontSize="26" fontWeight="900"
                fill="#e8c547" filter="url(#wheel-glow)">B</text>
        </svg>

        {/* Dramatic SVG pointer with jewel */}
        <svg width="50" height="60" style={{
          position:"absolute",top:-22,left:"50%",
          transform:"translateX(-50%)",
          zIndex:10,
          filter:"drop-shadow(0 0 12px rgba(232,197,71,0.9))",
        }} viewBox="0 0 50 60">
          <defs>
            <linearGradient id="pointer-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffe99a"/>
              <stop offset="50%" stopColor="#e8c547"/>
              <stop offset="100%" stopColor="#9e7c1f"/>
            </linearGradient>
          </defs>
          <circle cx="25" cy="12" r="8" fill="#e8c547" opacity="0.3"/>
          <path d="M 25 50 L 12 18 L 18 14 L 25 6 L 32 14 L 38 18 Z"
                fill="url(#pointer-grad)"
                stroke="#3a2a08" strokeWidth="0.5"/>
          <path d="M 25 50 L 12 18 L 18 14 L 25 6 Z"
                fill="rgba(255,233,154,0.4)"/>
          <circle cx="25" cy="11" r="3.5" fill="#fff" opacity="0.85"/>
          <circle cx="25" cy="11" r="2" fill="#e8c547"/>
        </svg>
      </div>

      {!spinning && !showOutcome && (
        <div style={{display:"flex",gap:14,width:"100%",maxWidth:380,marginTop:10}}>
          {!mandatory && !gambitMode && (
            <button onClick={onCashOut} style={{
              flex:1,minHeight:56,padding:16,
              fontSize:13,fontWeight:700,letterSpacing:2,textTransform:"uppercase",fontFamily:"inherit",
              background:"rgba(255,255,255,.03)",color:"#e8e6e1",
              border:"1.5px solid rgba(255,255,255,.15)",borderRadius:14,cursor:"pointer",
            }}>
              {t("wheel.cash_out")}
              <div style={{fontSize:10,color:"rgba(255,255,255,.5)",letterSpacing:1,marginTop:4}}>
                {t("wheel.keep_n", { n: phaseScore.toLocaleString('en-US') })}
              </div>
            </button>
          )}
          <button onClick={handleSpin} style={{
            flex:mandatory?2:1,minHeight:56,padding:16,
            fontSize:14,fontWeight:700,letterSpacing:2,textTransform:"uppercase",fontFamily:"inherit",
            background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#1a0f00",
            border:"none",borderRadius:14,cursor:"pointer",
            boxShadow:"0 0 40px rgba(232,197,71,.4)",
            position:"relative",overflow:"hidden",
          }}>
            <div style={{
              position:"absolute",inset:0,
              background:"linear-gradient(90deg,transparent,rgba(255,255,255,.3),transparent)",
              animation:"stake-shimmer 2s infinite",
            }}/>
            <div style={{position:"relative"}}>
              {mandatory ? t("wheel.spin_the_wheel") : `🎰 ${t("wheel.spin")}`}
              <div style={{fontSize:10,opacity:.7,letterSpacing:1,marginTop:4}}>×2 · ×3 · or bust</div>
            </div>
          </button>
        </div>
      )}

      {!spinning && !showOutcome && (
        <div style={{marginTop:20,display:"flex",gap:14,fontSize:10,letterSpacing:1,color:"rgba(255,255,255,.4)",textTransform:"uppercase"}}>
          <span><span style={{color:"#4ade80"}}>●</span> ×2</span>
          <span><span style={{color:"#f43f5e"}}>●</span> ×0</span>
          <span><span style={{color:"#e8c547"}}>●</span> ×3</span>
          <span><span style={{color:"#888"}}>●</span> bust</span>
        </div>
      )}

      {showOutcome && resultZone && (
        <div style={{
          textAlign:"center",marginTop:10,
          animation:"wheel-outcome-in .5s cubic-bezier(0.34,1.56,0.64,1)",
          position:"relative",
        }}>
          {/* Glow halo behind text */}
          <div style={{
            position:"absolute",
            inset:-40,
            background:`radial-gradient(circle, ${
              resultZone==="gold" ? "rgba(232,197,71,0.4)"
                : resultZone==="green" ? "rgba(74,222,128,0.3)"
                : resultZone==="red" ? "rgba(244,63,94,0.3)"
                : "rgba(50,50,50,0.5)"
            } 0%, transparent 70%)`,
            filter:"blur(20px)",
            zIndex:-1,
            animation:"wheel-outcome-pulse 2s ease-in-out infinite",
          }}/>
          <div style={{
            fontFamily:"Georgia, serif",
            fontSize:48,fontWeight:900,
            color: resultZone==="gold" ? "#e8c547"
              : resultZone==="green" ? "#4ade80"
              : resultZone==="red" ? "#f43f5e"
              : "#888",
            marginBottom:8,
            letterSpacing:2,
            textShadow:`0 0 60px ${
              resultZone==="gold" ? "rgba(232,197,71,0.8)"
                : resultZone==="green" ? "rgba(74,222,128,0.6)"
                : resultZone==="red" ? "rgba(244,63,94,0.6)"
                : "rgba(0,0,0,0.9)"
            }, 0 4px 12px rgba(0,0,0,0.8)`,
          }}>
            {resultZone==="gold" ? "JACKPOT"
              : resultZone==="green" ? "WINNER"
              : resultZone==="red" ? "LOST"
              : "BUST"}
          </div>
          <div style={{
            fontSize:14,color:"rgba(255,255,255,0.8)",
            letterSpacing:1,fontWeight:600,
          }}>
            {gambitMode
              ? (resultZone==="gold" ? t("gambit.outcome_gold", { n: (gambitPot*2).toLocaleString('en-US') })
                : resultZone==="green" ? t("gambit.outcome_green", { n: gambitPot.toLocaleString('en-US') })
                : resultZone==="red" ? t("gambit.outcome_red", { n: gambitPot.toLocaleString('en-US') })
                : t("gambit.outcome_black", { n: (gambitPot*2).toLocaleString('en-US') }))
              : (resultZone==="gold" ? `+${(phaseScore*3).toLocaleString('en-US')} points`
                : resultZone==="green" ? `+${(phaseScore*2).toLocaleString('en-US')} points`
                : resultZone==="red" ? `AXIOM takes ${phaseScore.toLocaleString('en-US')}`
                : "−50% of total score")}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RISK SELECTOR — choose stake before the Gambit
// ═══════════════════════════════════════════════════════════════
function RiskSelector({ playerScore, onPick, lang = "en" }) {
  const t = (key, params) => translate(key, lang, params);
  const safe = Math.max(0, Math.floor(playerScore));
  const options = [
    { key: "conservative", pct: 0.30, title: t("gambit.conservative"), sub: t("gambit.conservative_sub"), color: "#4ade80" },
    { key: "balanced",     pct: 0.60, title: t("gambit.balanced"),     sub: t("gambit.balanced_sub"),     color: "#e8c547" },
    { key: "allin",        pct: 1.00, title: t("gambit.allin"),        sub: t("gambit.allin_sub"),        color: "#f43f5e" },
  ];

  return (
    <div style={{
      position:"fixed",inset:0,zIndex:2000,
      background:"radial-gradient(ellipse at 50% 30%, rgba(90,20,20,0.35) 0%, rgba(45,10,10,0.85) 40%, rgba(12,5,8,0.98) 80%, rgba(4,2,6,1) 100%)",
      backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      padding:"20px",animation:"wheel-overlay-in .4s ease",
    }}>
      <div style={{fontSize:10,letterSpacing:6,color:"rgba(232,197,71,.6)",textTransform:"uppercase",fontWeight:700,marginBottom:6}}>
        {t("gambit.choose_risk")}
      </div>
      <div style={{fontFamily:"Georgia,serif",fontSize:32,fontWeight:900,color:"#e8c547",marginBottom:10,textAlign:"center",textShadow:"0 0 30px rgba(232,197,71,.4)"}}>
        {t("gambit.title")}
      </div>
      <div style={{fontSize:13,color:"rgba(232,230,225,.7)",marginBottom:28,textAlign:"center",maxWidth:320,lineHeight:1.5}}>
        {t("gambit.subtitle")}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:12,width:"100%",maxWidth:380}}>
        {options.map(opt => {
          const pot = Math.floor(safe * opt.pct);
          return (
            <button key={opt.key} onClick={() => onPick(opt.key, pot)} style={{
              padding:"16px 18px",minHeight:72,
              background:`linear-gradient(135deg, rgba(${opt.color==="#4ade80"?"74,222,128":opt.color==="#e8c547"?"232,197,71":"244,63,94"},0.12), rgba(${opt.color==="#4ade80"?"74,222,128":opt.color==="#e8c547"?"232,197,71":"244,63,94"},0.03))`,
              color:"#e8e6e1",
              border:`1.5px solid ${opt.color}55`,
              borderRadius:14,cursor:"pointer",fontFamily:"inherit",textAlign:"left",
              display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,
            }}>
              <div>
                <div style={{fontWeight:900,fontSize:15,letterSpacing:"1.5px",textTransform:"uppercase",color:opt.color,marginBottom:3}}>
                  {opt.title}
                </div>
                <div style={{fontSize:12,opacity:.65}}>{opt.sub}</div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:10,letterSpacing:2,color:"rgba(255,255,255,.4)",textTransform:"uppercase"}}>{t("gambit.pot")}</div>
                <div style={{fontWeight:900,fontSize:22,fontFamily:"Georgia,serif",color:"#e8c547"}}>{pot.toLocaleString('en-US')}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUDDEN DEATH — one-round steal-or-lose-all comeback
// ═══════════════════════════════════════════════════════════════
function SuddenDeath({ playerScore, axiomScore, onResolve, lang = "en" }) {
  const t = (key, params) => translate(key, lang, params);
  const [round, setRound] = useState(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [selected, setSelected] = useState(null);
  const [outcome, setOutcome] = useState(null); // "win" | "lose"
  const resolvedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const CATS = ["history","science","animals","geography","culture","food","sports"];
    const cat = CATS[Math.floor(Math.random()*CATS.length)];
    (async () => {
      try {
        const res = await fetch("/api/generate-round", {
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body: JSON.stringify({ category: cat, difficulty: 5, lang, mode: "regular" }),
        });
        const data = await res.json();
        if (!cancelled && data && Array.isArray(data.statements)) {
          setRound({ statements: data.statements.slice(0, 4) });
        } else if (!cancelled) {
          setRound(null);
        }
      } catch {
        if (!cancelled) setRound(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [lang]);

  // Graceful skip if fetch failed: resolve with null once so caller moves on
  useEffect(() => {
    if (!loading && !round && !resolvedRef.current) {
      resolvedRef.current = true;
      onResolve(null);
    }
  }, [loading, round, onResolve]);

  function pick(idx) {
    if (locked || !round) return;
    setSelected(idx);
    setLocked(true);
    const s = round.statements[idx];
    const won = s && s.real === false;
    setOutcome(won ? "win" : "lose");
    setTimeout(() => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      onResolve(won);
    }, 2200);
  }

  if (loading) {
    return (
      <div style={{
        position:"fixed",inset:0,zIndex:2000,
        background:"radial-gradient(ellipse at 50% 30%, rgba(90,20,20,0.35) 0%, rgba(12,5,8,0.98) 80%)",
        display:"flex",alignItems:"center",justifyContent:"center",color:"#e8c547",fontFamily:"Georgia,serif",fontSize:18,
      }}>
        {t("gambit.loading")}
      </div>
    );
  }

  // Graceful fallback: if round fetch failed, onResolve(null) is fired by the effect above
  if (!round) return null;

  return (
    <div style={{
      position:"fixed",inset:0,zIndex:2000,
      background:"radial-gradient(ellipse at 50% 30%, rgba(120,10,10,0.45) 0%, rgba(45,10,10,0.9) 40%, rgba(12,5,8,0.99) 80%)",
      backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",
      padding:"32px 20px",overflow:"auto",animation:"wheel-overlay-in .4s ease",
    }}>
      <div style={{fontSize:10,letterSpacing:6,color:"rgba(244,63,94,.8)",textTransform:"uppercase",fontWeight:700,marginBottom:6}}>
        {t("gambit.sudden_death_round")}
      </div>
      <div style={{fontFamily:"Georgia,serif",fontSize:26,fontWeight:900,color:"#f43f5e",marginBottom:8,textAlign:"center",textShadow:"0 0 30px rgba(244,63,94,.4)"}}>
        {t("gambit.sudden_death_offer")}
      </div>
      <div style={{fontSize:13,color:"rgba(232,230,225,.75)",marginBottom:22,textAlign:"center",maxWidth:340,lineHeight:1.5}}>
        {t("gambit.sudden_death_prompt")}
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:420}}>
        {round.statements.map((s, i) => {
          const isSelected = selected === i;
          const showResult = locked;
          const isLie = s.real === false;
          const bg = showResult
            ? (isLie ? "rgba(74,222,128,0.15)" : isSelected ? "rgba(244,63,94,0.18)" : "rgba(255,255,255,0.03)")
            : "rgba(255,255,255,0.04)";
          const border = showResult
            ? (isLie ? "#4ade80" : isSelected ? "#f43f5e" : "rgba(255,255,255,0.12)")
            : "rgba(255,255,255,0.15)";
          return (
            <button key={i} disabled={locked} onClick={()=>pick(i)} style={{
              padding:"14px 16px",minHeight:56,
              background:bg,color:"#e8e6e1",textAlign:"left",
              border:`1.5px solid ${border}`,borderRadius:12,
              cursor:locked?"default":"pointer",fontFamily:"inherit",fontSize:14,lineHeight:1.4,
              transition:"all .25s ease",
            }}>
              {s.text}
            </button>
          );
        })}
      </div>

      {outcome && (
        <div style={{
          marginTop:24,textAlign:"center",
          animation:"wheel-outcome-in .5s cubic-bezier(0.34,1.56,0.64,1)",
        }}>
          <div style={{
            fontFamily:"Georgia,serif",fontSize:36,fontWeight:900,
            color: outcome==="win" ? "#4ade80" : "#f43f5e",
            textShadow: outcome==="win" ? "0 0 60px rgba(74,222,128,0.6)" : "0 0 60px rgba(244,63,94,0.6)",
            letterSpacing:2,marginBottom:6,
          }}>
            {outcome==="win" ? "STOLEN" : "LOST"}
          </div>
          <div style={{fontSize:13,color:"rgba(255,255,255,0.8)",letterSpacing:1}}>
            {outcome==="win" ? t("gambit.sudden_death_won") : t("gambit.sudden_death_lost")}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SUDDEN DEATH OFFER — prompt before accepting the round
// ═══════════════════════════════════════════════════════════════
function SuddenDeathOffer({ onAccept, onDecline, lang = "en" }) {
  const t = (key, params) => translate(key, lang, params);
  return (
    <div style={{
      position:"fixed",inset:0,zIndex:2000,
      background:"radial-gradient(ellipse at 50% 30%, rgba(120,10,10,0.45) 0%, rgba(12,5,8,0.98) 80%)",
      backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      padding:"24px",animation:"wheel-overlay-in .4s ease",
    }}>
      <div style={{fontSize:40,marginBottom:8}}>💀</div>
      <div style={{fontFamily:"Georgia,serif",fontSize:30,fontWeight:900,color:"#f43f5e",marginBottom:12,textAlign:"center",textShadow:"0 0 30px rgba(244,63,94,.4)",letterSpacing:1}}>
        {t("gambit.sudden_death_offer")}
      </div>
      <div style={{fontSize:14,color:"rgba(232,230,225,.8)",marginBottom:28,textAlign:"center",maxWidth:340,lineHeight:1.5}}>
        {t("gambit.sudden_death_sub")}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10,width:"100%",maxWidth:340}}>
        <button onClick={onAccept} style={{
          minHeight:56,padding:16,fontSize:14,fontWeight:700,letterSpacing:2,textTransform:"uppercase",fontFamily:"inherit",
          background:"linear-gradient(135deg,#f43f5e,#b91c3a)",color:"#fff",
          border:"none",borderRadius:14,cursor:"pointer",boxShadow:"0 0 40px rgba(244,63,94,.4)",
        }}>
          {t("gambit.sudden_death_accept")}
        </button>
        <button onClick={onDecline} style={{
          minHeight:48,padding:12,fontSize:12,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",fontFamily:"inherit",
          background:"rgba(255,255,255,.03)",color:"rgba(232,230,225,.7)",
          border:"1px solid rgba(255,255,255,.12)",borderRadius:12,cursor:"pointer",
        }}>
          {t("gambit.sudden_death_decline")}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// WEB AUDIO TENSION ENGINE
// ═══════════════════════════════════════════════════════════════
const AudioTension = (() => {
  let ctx = null, masterGain = null, droneOsc = null, droneLfo = null, droneGain = null, muted = false;
  const init = () => {
    if (ctx) return;
    try { ctx = new (window.AudioContext||window.webkitAudioContext)(); masterGain = ctx.createGain(); masterGain.gain.value = 0.5; masterGain.connect(ctx.destination); } catch(e) {}
  };
  const play = (fn) => { if(muted||!ctx) return; if(ctx.state==="suspended") ctx.resume().catch(()=>{}); try{fn(ctx,masterGain);}catch(e){} };
  return {
    init,
    setMuted:(v)=>{ muted=v; if(masterGain) masterGain.gain.value=v?0:0.5; },
    tick(u=1){ play((ctx,dst)=>{ const o=ctx.createOscillator(),g=ctx.createGain(),t=ctx.currentTime; o.frequency.value=480+u*160; o.type="sine"; g.gain.setValueAtTime(0.18+u*0.06,t); g.gain.exponentialRampToValueAtTime(0.001,t+0.06); o.connect(g);g.connect(dst);o.start(t);o.stop(t+0.07); if(u>=2){const o2=ctx.createOscillator(),g2=ctx.createGain(),t2=t+0.25; o2.frequency.value=320; g2.gain.setValueAtTime(0.1,t2); g2.gain.exponentialRampToValueAtTime(0.001,t2+0.05); o2.connect(g2);g2.connect(dst);o2.start(t2);o2.stop(t2+0.06);} }); },
    lockIn(){ play((ctx,dst)=>{ const buf=ctx.createBuffer(1,ctx.sampleRate*0.06,ctx.sampleRate),d=buf.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2); const src=ctx.createBufferSource(),g=ctx.createGain(); src.buffer=buf;g.gain.setValueAtTime(0.45,ctx.currentTime); src.connect(g);g.connect(dst);src.start(); }); },
    fanfare(){ play((ctx,dst)=>{ const s=ctx.currentTime+0.38; [523,659,784,1047].forEach((f,i)=>{ const o=ctx.createOscillator(),g=ctx.createGain(),t=s+i*0.1; o.frequency.value=f;o.type="triangle"; g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.28,t+0.02);g.gain.exponentialRampToValueAtTime(0.001,t+0.4); o.connect(g);g.connect(dst);o.start(t);o.stop(t+0.45); }); [523,659,784].forEach(f=>{ const o=ctx.createOscillator(),g=ctx.createGain(),t=s+0.45; o.frequency.value=f;o.type="sine"; g.gain.setValueAtTime(0.16,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.9); o.connect(g);g.connect(dst);o.start(t);o.stop(t+1); }); }); },
    buzzer(){ play((ctx,dst)=>{ const s=ctx.currentTime+0.32; [[466,0],[370,0.04],[311,0.08]].forEach(([f,d])=>{ const o=ctx.createOscillator(),g=ctx.createGain(),t=s+d; o.frequency.value=f;o.type="sawtooth"; g.gain.setValueAtTime(0.26,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.5); o.connect(g);g.connect(dst);o.start(t);o.stop(t+0.55); }); }); },
    startDrone(level=0){ play((ctx,dst)=>{ const dg=ctx.createGain(); dg.gain.value=0; dg.connect(dst); const o=ctx.createOscillator(); o.type="sine"; o.frequency.value=50+level*10; o.connect(dg); o.start(); const lfo=ctx.createOscillator(),lg=ctx.createGain(); lfo.frequency.value=0.8+level*0.3; lg.gain.value=0.025+level*0.015; lfo.connect(lg);lg.connect(dg.gain);lfo.start(); dg.gain.linearRampToValueAtTime(0.05+level*0.03,ctx.currentTime+1.5); droneOsc=o;droneLfo=lfo;droneGain=dg; }); },
    stopDrone(){ if(!ctx) return; if(droneGain){droneGain.gain.setTargetAtTime(0,ctx.currentTime,0.3); setTimeout(()=>{try{droneOsc?.stop();droneLfo?.stop();}catch(e){}},700);} droneOsc=droneGain=droneLfo=null; },
    destroy(){ try{ droneOsc?.stop(); droneLfo?.stop(); }catch{} try{ ctx?.close(); }catch{} ctx=masterGain=droneOsc=droneLfo=droneGain=null; },
  };
})();

// ═══════════════════════════════════════════════════════════════
// PAYWALL SCREEN
// ═══════════════════════════════════════════════════════════════
function PaywallScreen({ reason, onClose, slotsRemaining, lang = "en" }) {
  const [loading, setLoading] = useState(null);
  const t = (key, params) => translate(key, lang, params);

  const headline = reason === "blitz"
    ? t("paywall.headline_blitz")
    : reason === "wheel"
    ? t("paywall.headline_wheel")
    : t("paywall.headline_daily");
  const subline = reason === "blitz"
    ? t("paywall.sub_blitz")
    : reason === "wheel"
    ? t("paywall.sub_wheel")
    : t("paywall.sub_daily");

  async function checkout(plan) {
    setLoading(plan);
    try {
      let userId = "";
      try { userId = localStorage.getItem("bluff_user_id") || ""; } catch {}
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, user_id: userId }),
      });
      const data = await res.json();
      if (data && data.url) {
        window.location.href = data.url;
        return;
      }
      setLoading(null);
      alert(data?.error || t("paywall.checkout_failed"));
    } catch {
      setLoading(null);
      alert(t("paywall.checkout_failed_network"));
    }
  }

  return (
    <div className="dvh-screen" style={{
      position:"fixed",inset:0,zIndex:9999,
      background:"linear-gradient(180deg,#04060f 0%,#0a0d1a 100%)",
      color:"#e8e6e1",fontFamily:"inherit",
      display:"flex",flexDirection:"column",
      padding:"24px 20px",overflow:"auto",
      animation:"g-fadeUp .4s both",
    }}>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:12}}>
        <button onClick={onClose} aria-label="Close" style={{
          minHeight:36,minWidth:36,padding:"0 12px",background:"transparent",
          color:"rgba(255,255,255,.6)",border:"1px solid rgba(255,255,255,.15)",
          borderRadius:10,cursor:"pointer",fontFamily:"inherit",fontSize:14,
        }}>✕</button>
      </div>

      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:11,letterSpacing:"2px",color:"rgba(232,197,71,.7)",marginBottom:8,textTransform:"uppercase",fontWeight:700}}>
          {t("paywall.brand")}
        </div>
        <div style={{
          fontSize:"clamp(22px,6vw,30px)",fontWeight:900,fontFamily:"Georgia,serif",
          color:"#e8c547",marginBottom:8,lineHeight:1.1,
        }}>
          {headline}
        </div>
        <div style={{fontSize:14,color:"rgba(232,230,225,.75)",lineHeight:1.5,maxWidth:380,margin:"0 auto"}}>
          {subline}
        </div>
      </div>

      {typeof slotsRemaining === "number" && slotsRemaining > 0 && (
        <div style={{
          textAlign:"center",marginBottom:20,padding:"10px 14px",
          background:"linear-gradient(135deg,rgba(232,197,71,.12),rgba(232,197,71,.04))",
          border:"1px solid rgba(232,197,71,.3)",borderRadius:12,
          maxWidth:380,width:"100%",margin:"0 auto 20px",
        }}>
          <div style={{fontSize:11,letterSpacing:"1.5px",color:"#e8c547",fontWeight:700,marginBottom:4,textTransform:"uppercase"}}>
            {t("paywall.early_adopter_title")}
          </div>
          <div style={{fontSize:13,color:"rgba(255,255,255,.85)"}}
            dangerouslySetInnerHTML={{__html: t("paywall.early_adopter_body", { n: `<b style="color:#e8c547">${slotsRemaining}</b>` })}}
          />
        </div>
      )}

      <div style={{display:"flex",flexDirection:"column",gap:10,maxWidth:380,width:"100%",margin:"0 auto"}}>
        {/* Yearly — featured */}
        <button onClick={()=>checkout("yearly")} disabled={loading!==null} style={{
          position:"relative",minHeight:72,padding:"14px 18px",
          background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#04060f",
          border:"none",borderRadius:14,cursor:loading?"wait":"pointer",fontFamily:"inherit",
          opacity:loading&&loading!=="yearly"?.5:1,textAlign:"left",
          boxShadow:"0 8px 24px rgba(232,197,71,0.25)",
        }}>
          <div style={{
            position:"absolute",top:-8,right:12,background:"#04060f",color:"#e8c547",
            fontSize:10,fontWeight:700,padding:"3px 10px",borderRadius:99,
            letterSpacing:"1px",border:"1px solid rgba(232,197,71,.5)",
          }}>{t("paywall.best_value")}</div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontWeight:900,fontSize:15,letterSpacing:"1.5px",textTransform:"uppercase"}}>{t("paywall.yearly")}</div>
              <div style={{fontSize:12,opacity:.75,marginTop:2}}>{t("paywall.yearly_sub")}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontWeight:900,fontSize:22,fontFamily:"Georgia,serif"}}>€34.99</div>
              <div style={{fontSize:10,opacity:.7}}>{t("paywall.yearly_per_mo")}</div>
            </div>
          </div>
        </button>

        {/* Monthly */}
        <button onClick={()=>checkout("monthly")} disabled={loading!==null} style={{
          minHeight:60,padding:"12px 18px",
          background:"rgba(255,255,255,.04)",color:"#e8e6e1",
          border:"1px solid rgba(255,255,255,.15)",borderRadius:14,cursor:loading?"wait":"pointer",fontFamily:"inherit",
          opacity:loading&&loading!=="monthly"?.5:1,textAlign:"left",
        }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontWeight:700,fontSize:14,letterSpacing:"1.5px",textTransform:"uppercase"}}>{t("paywall.monthly")}</div>
              <div style={{fontSize:11,opacity:.6,marginTop:2}}>{t("paywall.monthly_sub")}</div>
            </div>
            <div style={{fontWeight:700,fontSize:18,fontFamily:"Georgia,serif",color:"#e8c547"}}>€4.99</div>
          </div>
        </button>

        {/* Lifetime */}
        <button onClick={()=>checkout("lifetime")} disabled={loading!==null} style={{
          minHeight:60,padding:"12px 18px",
          background:"rgba(244,63,94,.06)",color:"#e8e6e1",
          border:"1px solid rgba(244,63,94,.25)",borderRadius:14,cursor:loading?"wait":"pointer",fontFamily:"inherit",
          opacity:loading&&loading!=="lifetime"?.5:1,textAlign:"left",
        }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontWeight:700,fontSize:14,letterSpacing:"1.5px",textTransform:"uppercase",color:"#f43f5e"}}>{t("paywall.lifetime")}</div>
              <div style={{fontSize:11,opacity:.6,marginTop:2}}>{t("paywall.lifetime_sub")}</div>
            </div>
            <div style={{fontWeight:700,fontSize:18,fontFamily:"Georgia,serif",color:"#f43f5e"}}>€69.99</div>
          </div>
        </button>
      </div>

      <div style={{marginTop:"auto",paddingTop:20,textAlign:"center",fontSize:11,color:"rgba(255,255,255,.4)",maxWidth:380,width:"100%",margin:"auto auto 0"}}>
        <div style={{marginBottom:6}}>{t("paywall.footer_free_modes")}</div>
        <div>{t("paywall.footer_secured")}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function BluffGame() {
  const haptic = useHaptic();
  const tg = useTelegram();
  const [showIntro, setShowIntro] = useState(true);
  const [screen, setScreen] = useState("home");
  const [lang, setLang] = useState(() => {
    const saved = safeLSGet("bluff_lang", null);
    if (saved) return saved;
    try {
      const browser = (navigator.language || "en").slice(0, 2).toLowerCase();
      if (browser === "sr") return "sr";
      if (browser === "hr") return "hr";
      if (browser === "bs" || browser === "sl" || browser === "me") return "sr";
    } catch {}
    return "en";
  });
  const t = useCallback((key, params) => translate(key, lang, params), [lang]);
  const [stmts, setStmts] = useState([]);
  const [roundIdx, setRoundIdx] = useState(0);
  const [category, setCategory] = useState("history");
  const [sel, setSel] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const [axiomScore, setAxiomScore] = useState(0);
  const axiomScoreRef = useRef(0);
  const [total, setTotal] = useState(0);
  const totalRef = useRef(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const bestRef = useRef(0);
  const [time, setTime] = useState(45);
  const [multiplier, setMultiplier] = useState(1.0);
  const multiplierRef = useRef(1.0);
  const [multiplierLocked, setMultiplierLocked] = useState(null);
  // Casino stake mechanic
  const STAKE_LEVELS = [1.0, 1.3, 1.8, 2.5, 3.5];
  const [stakeLevel, setStakeLevel] = useState(0);
  const [stakeAnim, setStakeAnim] = useState(null);
  const stakeTimersRef = useRef([]);
  const stakeLevelRef = useRef(0);
  // Phase scoring (rounds 1-4 → wheel, 5-8 → wheel, 9-12 → wheel)
  const [phaseScore, setPhaseScore] = useState(0);
  const phaseScoreRef = useRef(0);
  // Wheel-of-fortune state
  const [wheelOpen, setWheelOpen] = useState(false);
  const [wheelPhaseNum, setWheelPhaseNum] = useState(1);
  // Gambit (final-phase all-or-nothing) state
  const [gambitRiskOpen, setGambitRiskOpen] = useState(false);
  const [gambitRisk, setGambitRisk] = useState(null);
  const [gambitPot, setGambitPot] = useState(0);
  const [suddenDeathOfferOpen, setSuddenDeathOfferOpen] = useState(false);
  const [suddenDeathOpen, setSuddenDeathOpen] = useState(false);
  // Chip flight on Lock In
  const [chipFlying, setChipFlying] = useState(false);
  const milestonesFiredRef = useRef(new Set());
  const [lastRoundResult, setLastRoundResult] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);
  const correctCountRef = useRef(0);
  const [maxCashout, setMaxCashout] = useState(1.0);
  const maxCashoutRef = useRef(1.0);
  const [confetti, setConfetti] = useState(false);
  const [autoAdvanceCount, setAutoAdvanceCount] = useState(null);
  const [loadingRound, setLoadingRound] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [axiomPower, setAxiomPower] = useState(null);
  const [slayerEvent, setSlayerEvent] = useState(null);
  const [slayerEntered, setSlayerEntered] = useState(false);
  const [axiomMood, setAxiomMood] = useState("idle");
  const [axiomSpeech, setAxiomSpeech] = useState("Your confidence is endearing. Begin.");
  const [axiomLoading, setAxiomLoading] = useState(false);
  const [shareImg, setShareImg] = useState(null);
  const [storiesImg, setStoriesImg] = useState(null);
  const [challengeURL, setChallengeURL] = useState(null);
  const [challenge, setChallenge] = useState(null);
  const [duelId, setDuelId] = useState(null);
  const [duelCreating, setDuelCreating] = useState(false);
  const [duelName, setDuelName] = useState(() => safeLSGet("bluff_duel_name", ""));

  // ── Freemium / Pro ───────────────────────────────────────────
  const [isPro, setIsPro] = useState(() => {
    try { return localStorage.getItem("bluff_pro") === "1"; } catch { return false; }
  });
  const [isEarlyAdopter, setIsEarlyAdopter] = useState(() => {
    try { return localStorage.getItem("bluff_early_adopter") === "1"; } catch { return false; }
  });
  const [freeGamesRemaining, setFreeGamesRemaining] = useState(() => Math.max(0, 3 - getFreeGamesUsed()));
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallReason, setPaywallReason] = useState("daily_limit");
  const [showWheelTeaser, setShowWheelTeaser] = useState(false);
  const [earlyAdopterSlotsRemaining, setEarlyAdopterSlotsRemaining] = useState(null);

  // ── SWEAR currency / SWEAR Card ──────────────────────────────
  const [swearProfile, setSwearProfile] = useState(null);
  const swearProfileRef = useRef(null);
  const [swearBalance, setSwearBalance] = useState(0);
  const [showSwearCard, setShowSwearCard] = useState(false);
  const [showHandleModal, setShowHandleModal] = useState(false);
  const [handleInput, setHandleInput] = useState("");
  const [handleError, setHandleError] = useState("");
  const [handleSaving, setHandleSaving] = useState(false);
  const [swearAward, setSwearAward] = useState(null); // { amount, label }
  const swearAwardTimerRef = useRef(null);
  // Fired streak milestones in current game — prevents re-paying on re-renders.
  const firedStreakSwearRef = useRef(new Set());

  // ── Auth (Firebase) ────────────────────────────────────────────
  const [authUser, setAuthUser] = useState(null);   // { uid, email, displayName, ... } or null
  const authUserRef = useRef(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoadingFromRedirect, setAuthLoadingFromRedirect] = useState(
    () => { try { return sessionStorage.getItem("bluff_auth_redirect_pending") === "1"; } catch { return false; } }
  );
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [anonCapBannerOpen, setAnonCapBannerOpen] = useState(false);
  const migrationInFlightRef = useRef(false);
  // Auth debug panel: visible when URL has ?authDebug=1. Captures the storage
  // state at mount, after the redirect result is drained, and after auth
  // state transitions. Lets the user diagnose iOS ITP behavior without a Mac.
  const [authDebugOpen, setAuthDebugOpen] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("authDebug") === "1"; } catch { return false; }
  });
  const [authDebugLines, setAuthDebugLines] = useState([]);
  const pushAuthDebug = useCallback((label, obj) => {
    setAuthDebugLines((lines) => [...lines, { t: Date.now(), label, obj }]);
  }, []);
  // Google Identity Services renderButton flow — used on ALL platforms.
  // iOS Safari: bypasses ITP storage partitioning of the Firebase redirect.
  // Desktop: uses the same in-place popup flow, no UX divergence.
  // signInGoogle() + signInWithRedirect remains wired as the last-resort
  // fallback shown when GIS script fails to load (8s timeout / CSP / offline).
  const gisButtonRef = useRef(null);
  const [gisStatus, setGisStatus] = useState("loading"); // loading | ready | failed

  // ── Real-time Duel (PartyKit) ────────────────────────────────
  const [duelScreen, setDuelScreen] = useState(null); // null | "lobby" | "playing" | "result"
  const [duelMode, setDuelMode] = useState("regular"); // "regular" | "blitz"
  const [duelRoomId, setDuelRoomId] = useState(null);
  const [duelPlayers, setDuelPlayers] = useState({});
  const [duelPhase, setDuelPhase] = useState("waiting");
  const [duelCountdown, setDuelCountdown] = useState(null);
  const [duelClocks, setDuelClocks] = useState({});
  const [duelAnswers, setDuelAnswers] = useState({});
  const [duelScores, setDuelScores] = useState({});
  const [duelCurrentRound, setDuelCurrentRound] = useState(0);
  const [duelRoundData, setDuelRoundData] = useState(null);
  const [duelBluffIdx, setDuelBluffIdx] = useState(-1);
  const [duelWinner, setDuelWinner] = useState(null);
  const [duelIsTie, setDuelIsTie] = useState(false);
  const [duelSelection, setDuelSelection] = useState(null);
  const [duelRoundStart, setDuelRoundStart] = useState(null);
  const [duelRoundTimerMs, setDuelRoundTimerMs] = useState(45000);
  const [duelTimeLeft, setDuelTimeLeft] = useState(45);
  const [duelBonusOpportunity, setDuelBonusOpportunity] = useState(false);
  const [myDuelId, setMyDuelId] = useState(null);
  const duelSocketRef = useRef(null);
  const duelCountdownIntervalRef = useRef(null);
  const duelAnswerSentRef = useRef(false);
  // Stable per-match timestamp used as the SWEAR earn gameId component.
  // Bumped on each fresh countdown so rematches dedup correctly.
  const duelGameStartRef = useRef(null);
  const [duelConnectionState, setDuelConnectionState] = useState("idle");
  const [duelRetryAttempt, setDuelRetryAttempt] = useState(0);
  const [lobbyElapsed, setLobbyElapsed] = useState(0);
  const lobbyStartRef = useRef(null);
  const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || "bluff-duel.paunov-tech.partykit.dev";
  const [activeSkin, setActiveSkin] = useState(() => safeLSGet("bluff_skin", "default"));
  const [ownedSkins, setOwnedSkins] = useState(() => {
    try { return JSON.parse(safeLSGet("bluff_owned_skins", '["default"]')); }
    catch { return ["default"]; }
  });
  const [showShop, setShowShop] = useState(false);
  const [showHowToPlay, setShowHowToPlay] = useState(false);
  const [showLangModal, setShowLangModal] = useState(false);
  const [lastWrongStmt, setLastWrongStmt] = useState(null);
  const [shameSent, setShameSent] = useState(false);
  const [lastAxiomLine, setLastAxiomLine] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(() => safeLSGet("bluff_voice") !== "off");

  // ── Phase 1 Arena drama: sabotage / pit / community / reactions ──
  const [pitFallActive, setPitFallActive] = useState(false);
  const pitFellToRoundRef = useRef(0);
  const [axiomReaction, setAxiomReaction] = useState(null); // "LAUGH" | "MOCK" | null
  const [communityToast, setCommunityToast] = useState(null);
  const communityStopRef = useRef(null);
  // Sabotage runtime state. `triggeredThisGame` is reset on game start
  // (startBlitz / startClimb / startDaily). `active` is the visual sabotage
  // currently playing this round; cleared at round end.
  const sabotageGameRef = useRef({ triggeredThisGame: false });
  const sabotageScheduleRef = useRef(null);
  const [sabotageActive, setSabotageActive] = useState(null); // { type, startedAt, peekIdx? }
  const [sabotageBanner, setSabotageBanner] = useState(null); // { text, key }
  const sabotageBannerTimerRef = useRef(null);
  const sabotageEndTimerRef = useRef(null);
  const sabotagePeekTimerRef = useRef(null);

  const timerRef = useRef(null);
  const autoAdvanceRef = useRef(null);
  const audioRef = useRef(null);
  const userInteractedRef = useRef(false);
  // CLIMB mini-game carry-over points: Mini1 awards points BEFORE the BLUFF
  // rounds reset score, so we stash them here and apply inside startGame.
  const pendingMiniCarryRef = useRef(0);
  const onMultiplierMilestone = (threshold) => {
    if (!userInteractedRef.current) return;
    const tap = haptic.streakFire || haptic.timerWarning;
    try {
      if (threshold === 1.5) {
        tap?.();
      } else if (threshold === 2.0) {
        tap?.();
        AudioTension.tick(1);
      } else if (threshold === 2.5) {
        tap?.();
        AudioTension.tick(2);
      } else if (threshold === 3.0) {
        tap?.();
        AudioTension.tick(3);
      }
    } catch (e) {
      console.warn('[cashout milestone] audio failed:', e.message);
    }
  };
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const axiomBusyRef = useRef(false); // prevents concurrent AXIOM calls
  const wrongCountRef = useRef(0); // tracks consecutive wrongs for escalating taunts
  const currentStmtsRef = useRef([]); // always-current stmts for timer callbacks
  const currentSelRef = useRef(null);
  const roundsPlayedRef = useRef([]); // [{statements, category}] — duel replay data
  const resultsHistoryRef = useRef([]); // boolean per round — duel results
  const gameStartTimeRef = useRef(null); // ms timestamp — duel total time
  const roundCategoriesRef = useRef(null); // shuffled CATEGORIES for current match
  const preloadedRoundsRef = useRef([]); // pre-fetched solo rounds from Firestore cache
  const secondBatchPendingRef = useRef(false); // true while rounds 7-12 are in-flight
  // Round IDs + short topic summaries collected during a game. Flushed to
  // /api/mark-seen at end-of-game so (a) the user stops seeing cached rounds
  // they've already played and (b) live-gen has topics to avoid next time.
  const playedRoundIdsRef = useRef([]);

  // ── Stake mechanic sync + scheduler ──────────────────────────
  useEffect(() => {
    stakeLevelRef.current = stakeLevel;
    const mult = STAKE_LEVELS[stakeLevel] || 1.0;
    if (multiplierLocked === null) {
      setMultiplier(mult);
      multiplierRef.current = mult;
    }
  }, [stakeLevel, multiplierLocked]);

  useEffect(() => { phaseScoreRef.current = phaseScore; }, [phaseScore]);
  useEffect(() => { axiomScoreRef.current = axiomScore; }, [axiomScore]);
  useEffect(() => { scoreRef.current = score; }, [score]);
  useEffect(() => { totalRef.current = total; }, [total]);
  useEffect(() => { bestRef.current = best; }, [best]);

  function clearStakeTimers() {
    stakeTimersRef.current.forEach(clearTimeout);
    stakeTimersRef.current = [];
  }

  function scheduleStakeEvents(totalSeconds) {
    clearStakeTimers();
    setStakeLevel(0);
    setStakeAnim(null);
    if (totalSeconds < 10) return;

    const bangCount = 4 + Math.floor(Math.random() * 2);
    const fallCount = 1 + Math.floor(Math.random() * 2);
    const minGap = 4;

    const bangTimes = [];
    for (let i = 0; i < bangCount; i++) {
      let attempts = 0;
      while (attempts < 20) {
        const t = 3 + Math.random() * (totalSeconds - 5);
        if (bangTimes.every(bt => Math.abs(bt - t) > minGap)) {
          bangTimes.push(t); break;
        }
        attempts++;
      }
    }
    bangTimes.sort((a, b) => a - b);

    const fallTimes = [];
    for (let i = 0; i < fallCount; i++) {
      let attempts = 0;
      while (attempts < 20) {
        const t = 8 + Math.random() * Math.max(1, totalSeconds - 12);
        const clashBang = bangTimes.some(bt => Math.abs(bt - t) < 2);
        const clashFall = fallTimes.some(ft => Math.abs(ft - t) < 5);
        if (!clashBang && !clashFall) { fallTimes.push(t); break; }
        attempts++;
      }
    }

    bangTimes.forEach(sec => {
      const id = setTimeout(() => {
        setStakeLevel(lvl => {
          const next = Math.min(STAKE_LEVELS.length - 1, lvl + 1);
          if (next !== lvl) {
            setStakeAnim("bang");
            setTimeout(() => setStakeAnim(null), 600);
            try { playTick("medium"); } catch {}
          }
          return next;
        });
      }, sec * 1000);
      stakeTimersRef.current.push(id);
    });

    fallTimes.forEach(sec => {
      const id = setTimeout(() => {
        setStakeLevel(lvl => {
          const next = Math.max(0, lvl - 1);
          if (next !== lvl) {
            setStakeAnim("fall");
            setTimeout(() => setStakeAnim(null), 800);
            try { playTick("heavy"); } catch {}
          }
          return next;
        });
      }, sec * 1000);
      stakeTimersRef.current.push(id);
    });
  }

  // ── Blitz Mode ───────────────────────────────────────────────
  const [blitzMode, setBlitzMode] = useState(false);
  const [currentWave, setCurrentWave] = useState(0);
  const [showWaveIntro, setShowWaveIntro] = useState(false);
  const [blitzScore, setBlitzScore] = useState(0);
  const [blitzTimeBonus, setBlitzTimeBonus] = useState(0);

  // ── Daily Challenge ──────────────────────────────────────────
  const [dailyMode, setDailyMode] = useState(false);
  const [dailyData, setDailyData] = useState(null);
  const [dailyRank, setDailyRank] = useState(null);
  const [dailyPlayers, setDailyPlayers] = useState(0);
  const [dailyAlreadyPlayed, setDailyAlreadyPlayed] = useState(false);
  const [loadingDaily, setLoadingDaily] = useState(false);
  const dailyModeRef = useRef(false);
  const blitzModeRef = useRef(false);
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);
  const dailyResultsRef = useRef([]);
  const dailyRoundsRef = useRef(null);
  const dailyStartTimeRef = useRef(null);
  const userIdRef = useRef(
    (() => {
      // Prefer Telegram user ID when running inside Mini App
      const tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
      if (tgId) {
        const id = `tg_${tgId}`;
        localStorage.setItem("bluff_user_id", id);
        return id;
      }
      const stored = localStorage.getItem("bluff_user_id");
      if (stored) return stored;
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem("bluff_user_id", id);
      return id;
    })()
  );

  // ── FUNCTIONS ────────────────────────────────────────────────

  // Persist language
  function changeLang(code) {
    setLang(code);
    localStorage.setItem("bluff_lang", code);
  }

  // ── SWEAR helpers ───────────────────────────────────────────
  // Apply a fresh profile object from the server to local state.
  function applyProfile(p) {
    if (!p) return;
    swearProfileRef.current = p;
    setSwearProfile(p);
    setSwearBalance(p.swearBalance | 0);
  }

  // Show the gold "+N SWEAR" toast overlay for ~1.8s.
  function flashSwearAward(amount, label) {
    if (!amount || amount <= 0) return;
    if (swearAwardTimerRef.current) clearTimeout(swearAwardTimerRef.current);
    setSwearAward({ amount, label: label || "" });
    swearAwardTimerRef.current = setTimeout(() => setSwearAward(null), 1800);
  }

  // Award SWEAR for a validated event. Server enforces the rate + dedup.
  // Safe to call from idempotent result screens (same gameId → no double pay).
  async function awardSwear(event, gameId, { label, meta } = {}) {
    const uid = userIdRef.current;
    if (!uid || !event || !gameId) return null;
    try {
      const headers = { "Content-Type": "application/json" };
      const token = await getCurrentIdToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch("/api/swear-earn", {
        method:  "POST",
        headers,
        body:    JSON.stringify({ userId: uid, event, gameId, meta: meta || null }),
      });
      const data = await r.json();
      if (!r.ok) return null;
      if (data.awarded > 0 && !data.duplicate) {
        setSwearBalance(data.newBalance);
        if (swearProfileRef.current) {
          const next = { ...swearProfileRef.current, swearBalance: data.newBalance };
          swearProfileRef.current = next;
          setSwearProfile(next);
        }
        flashSwearAward(data.awarded, label || event);
      }
      if (data.anonymousCapHit && !authUserRef.current) {
        setAnonCapBannerOpen(true);
      }
      return data;
    } catch (e) {
      console.warn("[swear] award failed:", e.message);
      return null;
    }
  }

  // Gold "+N SWEAR" toast overlay. Returns JSX for inlining in each screen.
  function renderSwearToast() {
    if (!swearAward) return null;
    return (
      <div style={{
        position:"fixed",top:"22%",left:"50%",transform:"translateX(-50%)",
        zIndex:1000,pointerEvents:"none",
        animation:"swear-award-in .4s cubic-bezier(0.34,1.56,0.64,1) both, swear-award-out .5s 1.3s both",
      }}>
        <div style={{
          display:"flex",alignItems:"center",gap:10,
          padding:"12px 20px",borderRadius:999,
          background:"linear-gradient(135deg,rgba(240,216,120,.95),rgba(212,168,48,.95))",
          border:"1px solid rgba(255,255,255,.35)",
          boxShadow:"0 0 40px rgba(232,197,71,.5), inset 0 1px 0 rgba(255,255,255,.4)",
          color:"#04060f",fontWeight:900,fontSize:16,letterSpacing:1,
          fontFamily:"Georgia,serif",
        }}>
          <span style={{
            display:"inline-flex",alignItems:"center",justifyContent:"center",
            width:26,height:26,borderRadius:"50%",
            background:"#04060f",color:"#e8c547",fontSize:16,fontWeight:900,
            animation:"swear-coin-spin 1s linear",
          }}>Ⓢ</span>
          <span>+{swearAward.amount}</span>
          {swearAward.label && (
            <span style={{fontSize:11,fontWeight:600,opacity:.7,letterSpacing:".5px",textTransform:"uppercase",fontFamily:"inherit"}}>
              {swearAward.label}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Save a handle. Returns { ok, error? } so the modal can render errors.
  async function saveHandle(raw) {
    const uid = userIdRef.current;
    if (!uid) return { ok: false, error: "no_user" };
    if (!authUserRef.current) return { ok: false, error: "sign_in_required" };
    const handle = String(raw || "").trim();
    if (!/^[a-zA-Z0-9_]{3,16}$/.test(handle)) return { ok: false, error: "invalid" };
    try {
      const token = await getCurrentIdToken();
      if (!token) return { ok: false, error: "sign_in_required" };
      const r = await fetch("/api/swear-set-handle", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body:    JSON.stringify({ userId: uid, handle }),
      });
      const data = await r.json();
      if (r.status === 409 || data.error === "taken") return { ok: false, error: "taken" };
      if (!r.ok) return { ok: false, error: "save_failed" };
      applyProfile(data.profile);
      return { ok: true };
    } catch {
      return { ok: false, error: "save_failed" };
    }
  }

  // Run anonymous → uid migration once after sign-in.
  async function migrateAnonToUid(anonymousId) {
    if (migrationInFlightRef.current) return null;
    migrationInFlightRef.current = true;
    try {
      const token = await getCurrentIdToken();
      if (!token) return null;
      const r = await fetch("/api/swear-migrate", {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ anonymousId }),
      });
      const data = await r.json();
      if (r.ok && data.profile) {
        applyProfile(data.profile);
      }
      return data;
    } catch (e) {
      console.warn("[auth] migrate failed:", e.message);
      return null;
    } finally {
      migrationInFlightRef.current = false;
    }
  }

  // ── DAILY CHALLENGE ─────────────────────────────────────────
  async function loadDailyChallenge() {
    setLoadingDaily(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(`/api/daily-challenge?userId=${encodeURIComponent(userIdRef.current)}`, { signal: controller.signal });
      const data = await r.json();
      setDailyData(data);
      setDailyAlreadyPlayed(!!data.alreadyPlayed);
      if (data.myRank) setDailyRank(data.myRank);
      if (data.totalPlayers) setDailyPlayers(data.totalPlayers);
    } catch(e) {
      if (e.name === "AbortError") console.warn("[daily] timeout after 8s");
      else console.error("[daily] error:", e);
      setDailyData(null);
    } finally {
      clearTimeout(timeout);
      setLoadingDaily(false);
    }
  }

  async function submitDailyResult(finalScore, finalTotal) {
    try {
      const timeTakenMs = Date.now() - (dailyStartTimeRef.current || Date.now());
      const r = await fetch("/api/daily-challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userIdRef.current,
          score: finalScore,
          total: finalTotal,
          timeTakenMs,
          results: dailyResultsRef.current,
        }),
      });
      const data = await r.json();
      if (data.rank) setDailyRank(data.rank);
      if (data.totalPlayers) setDailyPlayers(data.totalPlayers);
      // Update dailyData so home screen shows completion state on return
      setDailyAlreadyPlayed(true);
      setDailyData(prev => prev ? {
        ...prev,
        alreadyPlayed: true,
        myResult: { score: finalScore, total: finalTotal, results: [...dailyResultsRef.current] },
      } : null);

      // SWEAR: award daily completion. Perfect = all rounds correct.
      // dailyResultsRef.current stores raw booleans (see line where it's pushed),
      // so the predicate must be a boolean equality, not a `.correct` lookup.
      const perfect = dailyResultsRef.current.length > 0 &&
        dailyResultsRef.current.every(x => x === true);
      const dayKey = new Date().toISOString().slice(0, 10);
      const gid = `daily_${dayKey}`;
      awardSwear(
        perfect ? "daily_challenge_perfect" : "daily_challenge_complete",
        gid,
        {
          label: t(perfect ? "swear.daily_perfect" : "swear.daily_complete", lang),
          meta: { score: finalScore, total: finalTotal },
        }
      );
    } catch {}
  }

  function startDailyChallenge() {
    if (!dailyData?.rounds) return;
    dailyModeRef.current = true;
    dailyResultsRef.current = [];
    dailyStartTimeRef.current = Date.now();
    dailyRoundsRef.current = dailyData.rounds;
    setDailyMode(true);
    setDailyRank(null);
    clearInterval(timerRef.current);
    // Reset time + loadingRound before any other state so auto-reveal effect
    // can't fire with stale time=0 from a previous session on first render.
    setTime(TIMER_PER_DIFF[ROUND_DIFFICULTY[0]] || 60);
    setLoadingRound(true);
    setMultiplier(1.0);
    multiplierRef.current = 1.0;
    setMultiplierLocked(null);
    milestonesFiredRef.current = new Set();
    firedStreakSwearRef.current = new Set();
    setLastRoundResult(null);
    setCorrectCount(0);
    correctCountRef.current = 0;
    setMaxCashout(1.0);
    maxCashoutRef.current = 1.0;
    wrongCountRef.current = 0;
    setScreen("play");
    setRoundIdx(0);
    setSel(null);
    currentSelRef.current = null;
    setRevealed(false);
    setScore(0);
    setAxiomScore(0);
    axiomScoreRef.current = 0;
    setTotal(0);
    setStreak(0);
    setConfetti(false);
    setShareImg(null);
    setCurrentWave(0);
    setShowWaveIntro(false);
    setStoriesImg(null);
    preloadedRoundsRef.current = [];
    secondBatchPendingRef.current = false;
    fetchRound(0);
    axiomSpeak("intro", "idle");
  }

  // ── AXIOM VOICE ─────────────────────────────────────────────
  async function playAxiomVoice(text, skin) {
    if (!voiceEnabled || !text || text === "...") return;

    audioQueueRef.current.push({ text, skin });
    if (isPlayingRef.current) return;

    const playNext = async () => {
      if (audioQueueRef.current.length === 0) {
        isPlayingRef.current = false;
        return;
      }
      isPlayingRef.current = true;
      const { text: t, skin: s } = audioQueueRef.current.shift();
      try {
        const r = await fetch("/api/axiom-voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: t, skin: s }),
        });
        if (!r.ok) { isPlayingRef.current = false; playNext(); return; }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        if (audioRef.current) {
          audioRef.current.pause();
          URL.revokeObjectURL(audioRef.current.src);
        }
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => { URL.revokeObjectURL(url); isPlayingRef.current = false; playNext(); };
        audio.onerror = () => { isPlayingRef.current = false; playNext(); };
        if (!userInteractedRef.current) {
          isPlayingRef.current = false;
          audioQueueRef.current.unshift({ text: t, skin: s });
          return;
        }
        const p = audio.play();
        if (p !== undefined) p.catch(() => { isPlayingRef.current = false; });
      } catch {
        isPlayingRef.current = false;
        playNext();
      }
    };

    playNext();
  }

  // ── AXIOM SPEAK ─────────────────────────────────────────────
  async function axiomSpeak(context, mood) {
    if(axiomBusyRef.current) return;
    axiomBusyRef.current = true;
    setAxiomMood(mood);
    setAxiomLoading(true);
    try {
      const res = await fetch("/api/axiom-speak",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ context, lang, skin: activeSkin }),
      });
      const data = await res.json();
      const speechText = data.speech || "...";
      setAxiomSpeech(speechText);
      setLastAxiomLine(speechText);
      playAxiomVoice(speechText, activeSkin);
    } catch {
      const fb={idle:"Your confidence is endearing.",taunting:"Predictable.",shocked:"Impossible.",amused:"Delightful.",defeated:"I concede."};
      const fallbackText = fb[mood] || "...";
      setAxiomSpeech(fallbackText);
      playAxiomVoice(fallbackText, activeSkin);
    } finally {
      setAxiomLoading(false);
      axiomBusyRef.current = false;
    }
  }

  // ── FETCH ROUND ─────────────────────────────────────────────
  async function fetchSoloBatch(phase) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const uid = userIdRef.current ? `&userId=${encodeURIComponent(userIdRef.current)}` : "";
      const res = await fetch(`/api/solo-rounds?phase=${phase}${uid}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!res.ok && res.status !== 206) return [];
      const data = await res.json();
      return data.rounds || [];
    } catch (e) {
      console.warn(`[fetchSoloBatch ${phase}] fail:`, e.message);
      return [];
    }
  }

  async function fetchRound(idx) {
    setLoadingRound(true);
    setFetchError(false);

    // Daily mode: use pre-generated rounds instead of fetching
    if (dailyModeRef.current && dailyRoundsRef.current?.[idx]) {
      const round = dailyRoundsRef.current[idx];
      const cat = round.category || (roundCategoriesRef.current || CATEGORIES)[idx % CATEGORIES.length];
      setCategory(cat);
      const normalized = (round.statements || []).map(s => ({
        text: String(s.text || ""),
        real: s.real === true || s.real === "true",
      }));
      const lies = normalized.filter(s => !s.real);
      if (lies.length === 1) {
        const shuffled = shuffle(normalized);
        setStmts(shuffled);
        currentStmtsRef.current = shuffled;
        roundsPlayedRef.current[idx] = { statements: shuffled, category: cat };
      }
      setLoadingRound(false);
      return;
    }

    // Solo mode: use pre-fetched Firestore rounds if available.
    // Skip for non-English — the cache is EN-only; live generate-round honors lang.
    if (!blitzModeRef.current && langRef.current === "en" && preloadedRoundsRef.current?.[idx]) {
      const round = preloadedRoundsRef.current[idx];
      const cat = round.category || (roundCategoriesRef.current || CATEGORIES)[idx % CATEGORIES.length];
      setCategory(cat);
      const normalized = (round.statements || []).map(s => ({
        text: String(s.text || ""),
        real: s.real === true || s.real === "true",
      }));
      const lies = normalized.filter(s => !s.real);
      if (lies.length === 1) {
        const shuffled = shuffle(normalized);
        setStmts(shuffled);
        currentStmtsRef.current = shuffled;
        roundsPlayedRef.current[idx] = { statements: shuffled, category: cat };
        if (round.id) {
          const firstTruth = normalized.find(s => s.real) || normalized[0];
          playedRoundIdsRef.current.push({
            id: round.id,
            summary: (firstTruth?.text || "").slice(0, 80),
          });
        }
        setLoadingRound(false);
        return;
      }
      // bad data — fall through to live fetch
    }

    const diff = blitzModeRef.current ? (BLITZ_DIFFICULTY[idx] || 4) : (ROUND_DIFFICULTY[idx]||3);
    const cat = (roundCategoriesRef.current || CATEGORIES)[idx % CATEGORIES.length];
    setCategory(cat);

    // Non-EN generation is slower (Claude multilingual adds ~2x latency).
    // 9s was too aggressive and caused frequent fallback to the hardcoded EN pool.
    const isNonEn = lang !== "en";
    const attemptTimeoutMs = isNonEn ? 20000 : 12000;

    async function attempt() {
      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
      try {
        const res = await fetch("/api/generate-round",{
          method:"POST",
          headers:{"Content-Type":"application/json"},
          body: JSON.stringify({
            category: cat,
            difficulty: diff,
            lang,
            mode: blitzModeRef.current ? "blitz" : "regular",
            userId: userIdRef.current,
          }),
          signal: controller.signal,
        });
        const data = await res.json();
        const normalized = (data.statements||[]).map(s=>({
          text: String(s.text||""),
          real: s.real===true||s.real==="true",
        }));
        const lies = normalized.filter(s=>!s.real);
        if(lies.length!==1) throw new Error("Bad lie count");
        return { normalized, id: data.id, summary: data.summary };
      } finally {
        clearTimeout(fetchTimeout);
      }
    }

    try {
      let result;
      try {
        result = await attempt();
      } catch (err1) {
        console.warn("[fetchRound] attempt 1 failed:",
          err1.name === "AbortError" ? `timeout ${attemptTimeoutMs}ms` : err1.message,
          "— retrying");
        result = await attempt();
      }
      const { normalized, id: roundId, summary: roundSummary } = result;
      const shuffled = shuffle(normalized);
      setStmts(shuffled);
      currentStmtsRef.current = shuffled;
      roundsPlayedRef.current[idx] = { statements: shuffled, category: cat };
      if (roundId) {
        const firstTruth = normalized.find(s => s.real) || normalized[0];
        playedRoundIdsRef.current.push({
          id: roundId,
          summary: roundSummary || (firstTruth?.text || "").slice(0, 80),
        });
      }
    } catch(e) {
      // Both attempts failed. Last-resort hardcoded fallback is EN-only and
      // category-agnostic — a known visual mismatch we accept over a frozen UI.
      console.error("[fetchRound] both attempts failed, using hardcoded fallback:",
        e.name === "AbortError" ? `timeout ${attemptTimeoutMs}ms` : e.message);
      const fb = shuffle(getFallback(blitzModeRef.current ? "blitz" : "regular"));
      setStmts(fb);
      currentStmtsRef.current = fb;
      roundsPlayedRef.current[idx] = { statements: fb, category: cat };
    } finally {
      setLoadingRound(false);
    }
  }

  // ── CARD SELECT — psychological warfare ─────────────────────
  function handleCardSelect(i) {
    if(revealed) return;
    haptic.tap();
    setSel(i);
    currentSelRef.current = i;
    const s = currentStmtsRef.current[i];
    if(!s) return;
    // AXIOM reacts differently based on whether player picked lie or truth
    // Small delay so it doesn't feel instant/robotic
    setTimeout(()=>{
      if(s.real===false) {
        // Player selected the LIE — try to make them doubt
        axiomSpeak("selected_lie","taunting");
      } else {
        // Player selected a TRUTH — be amused
        axiomSpeak("selected_truth","amused");
      }
    },300);
  }

  // ── REVEAL ───────────────────────────────────────────────────
  function doReveal() {
    clearInterval(timerRef.current);
    clearStakeTimers();
    const stmtsCurrent = currentStmtsRef.current;
    const selCurrent = currentSelRef.current;
    const bi = stmtsCurrent.findIndex(s=>!s.real);
    const isCorrect = selCurrent===bi && bi!==-1;

    resultsHistoryRef.current[roundIdx] = isCorrect;

    fetch("/api/axiom-power", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: isCorrect ? "win" : "loss" }),
    }).then(r => r.json()).then(d => setAxiomPower(typeof d?.power === 'number' && !Number.isNaN(d.power) ? d.power : null)).catch(() => {});

    setRevealed(true);
    setTotal(t=>t+1);

    if (dailyModeRef.current) {
      dailyResultsRef.current = [...dailyResultsRef.current, isCorrect];
    }

    const autoReveal = time <= 0;
    const lockedMult = multiplierRef.current;
    setMultiplierLocked(lockedMult);
    const streakMultAtLock = getStreakMultiplier(streak);

    let earned = 0;
    let penalty = 0;

    if(isCorrect){
      haptic.correct();
      AudioTension.stopDrone();
      AudioTension.fanfare();
      earned = Math.round(BASE_POINTS * lockedMult * streakMultAtLock);
      // Blitz and Daily skip the phase-end wheel entirely, so they bank
      // points directly into score on each round. Solo/Climb accumulates
      // into phaseScore which the wheel (Pro) or the free-tier teaser
      // path (now also banking, see advanceAfterRound) folds into score.
      if (blitzMode || dailyModeRef.current) setScore(s=>s+earned);
      else setPhaseScore(s=>s+earned);
      setCorrectCount(c => { correctCountRef.current = c + 1; return c + 1; });
      setMaxCashout(m => { const next = Math.max(m, lockedMult); maxCashoutRef.current = next; return next; });
      wrongCountRef.current = 0;
      setStreak(prev=>{
        const next=prev+1;
        setBest(b=>Math.max(b,next));
        if(next>=2) setConfetti(true);
        // Escalating shock based on streak
        if(next>=5) axiomSpeak("streak_5","shocked");
        else if(next>=3) axiomSpeak("streak_3","shocked");
        else axiomSpeak("correct","shocked");
        // SWEAR: streak milestones — fire once per game per milestone.
        for (const m of [5, 10, 15]) {
          if (next >= m && !firedStreakSwearRef.current.has(m)) {
            firedStreakSwearRef.current.add(m);
            const gid = `streak_${gameStartTimeRef.current || Date.now()}_${m}`;
            awardSwear(`streak_milestone_${m}`, gid, { label: t("swear.streak_milestone", lang, { n: m }) });
          }
        }
        return next;
      });
    } else {
      haptic.wrong();
      AudioTension.stopDrone();
      AudioTension.buzzer();
      penalty = Math.round(BASE_PENALTY * lockedMult * 0.3);
      if (autoReveal) {
        penalty += blitzMode ? NEGLIGENCE_PENALTY_BLITZ : NEGLIGENCE_PENALTY_REGULAR;
      }
      // AXIOM gains points instead of player losing them
      let axiomGained = Math.round(BASE_POINTS * lockedMult * 0.75);
      if (autoReveal) {
        axiomGained += blitzMode ? NEGLIGENCE_PENALTY_BLITZ : NEGLIGENCE_PENALTY_REGULAR;
      }
      setAxiomScore(a => { const next = a + axiomGained; axiomScoreRef.current = next; return next; });
      wrongCountRef.current++;
      const lieStmt = stmtsCurrent.find(s => !s.real);
      setLastWrongStmt(lieStmt?.text || null);
      setShameSent(false);
      setStreak(prev=>{
        if(prev>0) axiomSpeak("streak_broken","amused"); // broke their streak
        else if(wrongCountRef.current>=2) axiomSpeak("wrong_celebrate","amused"); // consecutive wrongs
        else axiomSpeak("wrong","taunting");
        return 0;
      });
    }

    setLastRoundResult({
      earned, penalty, lockedMult,
      isCorrect, autoReveal,
      streakMult: streakMultAtLock,
    });

    // ── Phase 1 drama hooks ────────────────────────────────────
    // Telemetry: did the player still win the sabotaged round?
    if (sabotageGameRef.current.lastType && sabotageGameRef.current.triggeredThisGame) {
      const sabType = sabotageGameRef.current.lastType;
      logSabotageOutcome(sabType, isCorrect, userIdRef.current);
      sabotageGameRef.current.lastType = null;
    }
    // Pit fall on a wrong answer (solo Climb only — skip blitz/duel).
    // The 3s overlay runs in parallel with the existing reveal flow;
    // auto-advance starts 4.3s post-reveal so the choreography finishes
    // first. AXIOM mock emoji rides shotgun above the overlay; PitFall
    // owns the voice line so we set playVoice=false on the reaction.
    if (!isCorrect && !blitzMode) {
      pitFellToRoundRef.current = roundIdx + 1;
      setPitFallActive(true);
      setAxiomReaction("MOCK");
    } else if (isCorrect && !blitzMode && roundIdx >= 4) {
      // AXIOM laughs after the player nails round 5+. Voice line plays
      // independently of axiomSpeak (above) — it's a short reaction layered
      // on top of the round commentary, not a replacement.
      setAxiomReaction("LAUGH");
    }
  }

  // ── NEXT ROUND ───────────────────────────────────────────────
  function nextRound() {
    const next = roundIdx+1;
    const totalRounds = blitzMode ? BLITZ_ROUNDS : ROUND_DIFFICULTY.length;
    if(next>=totalRounds){ showResultScreen(); return; }
    clearInterval(timerRef.current);
    // Reset time synchronously so transient time=0 from prior round can't trigger auto-reveal
    const nextDiff = blitzMode ? (BLITZ_DIFFICULTY[next] || 4) : (ROUND_DIFFICULTY[next] || 3);
    setTime(blitzMode ? BLITZ_TIMER : (TIMER_PER_DIFF[nextDiff] || 60));
    setMultiplier(1.0);
    multiplierRef.current = 1.0;
    setMultiplierLocked(null);
    milestonesFiredRef.current = new Set();
    firedStreakSwearRef.current = new Set();
    setLastRoundResult(null);
    setCorrectCount(0);
    correctCountRef.current = 0;
    setMaxCashout(1.0);
    maxCashoutRef.current = 1.0;
    setRoundIdx(next);
    setSel(null);
    currentSelRef.current=null;
    setRevealed(false);
    setConfetti(false);
    setStakeLevel(0);
    stakeLevelRef.current = 0;
    setStakeAnim(null);
    clearStakeTimers();
    // Check if entering new wave
    if(!blitzMode && isWaveStart(next)) {
      const wave = getWave(next);
      setCurrentWave(wave);
      setShowWaveIntro(true);
      setTimeout(() => setShowWaveIntro(false), 1800);
      axiomSpeak("intro", wave === 2 ? "taunting" : "idle");
    } else {
      axiomSpeak("intro","idle");
    }
    fetchRound(next);
  }

  // ── BLITZ ────────────────────────────────────────────────────
  function startBlitz() {
    userInteractedRef.current = true;
    AudioTension.init();
    clearInterval(timerRef.current);
    // Reset time + loadingRound before any other state so auto-reveal effect
    // can't fire with stale time=0 from a previous session on first render.
    setTime(BLITZ_TIMER);
    setLoadingRound(true);
    setMultiplier(1.0);
    multiplierRef.current = 1.0;
    setMultiplierLocked(null);
    milestonesFiredRef.current = new Set();
    firedStreakSwearRef.current = new Set();
    setLastRoundResult(null);
    setCorrectCount(0);
    correctCountRef.current = 0;
    setMaxCashout(1.0);
    maxCashoutRef.current = 1.0;
    wrongCountRef.current = 0;
    blitzModeRef.current = true;
    setBlitzMode(true);
    setBlitzScore(0);
    setBlitzTimeBonus(0);
    setDailyMode(false);
    dailyModeRef.current = false;
    setScreen("play");
    setRoundIdx(0);
    setSel(null);
    currentSelRef.current = null;
    setRevealed(false);
    setScore(0);
    setAxiomScore(0);
    axiomScoreRef.current = 0;
    setTotal(0);
    setStreak(0);
    setConfetti(false);
    setShareImg(null);
    setDuelId(null);
    setDuelCreating(false);
    roundsPlayedRef.current = [];
    resultsHistoryRef.current = [];
    playedRoundIdsRef.current = [];
    gameStartTimeRef.current = Date.now();
    setCurrentWave(0);
    setShowWaveIntro(true);
    setTimeout(() => setShowWaveIntro(false), 1800);
    setFetchError(false);
    preloadedRoundsRef.current = [];
    secondBatchPendingRef.current = false;
    fetchRound(0);
    axiomSpeak("intro", "idle");
  }

  // ── REAL-TIME DUEL ───────────────────────────────────────────
  function openDuel(mode) {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    setDuelRoomId(roomId);
    setDuelMode(mode);
    setDuelScreen("lobby");
    connectDuel(roomId, mode);
  }

  function joinDuel(roomId, mode) {
    setDuelRoomId(roomId.toUpperCase());
    setDuelMode(mode);
    setDuelScreen("lobby");
    connectDuel(roomId.toUpperCase(), mode);
  }

  function connectDuel(roomId, mode, attempt = 1) {
    const MAX_ATTEMPTS = 3;
    const name = duelName.trim() || "Player";

    if (duelSocketRef.current) {
      const existing = duelSocketRef.current;
      const existingUrl = existing.url || "";
      if (existingUrl.includes(`/parties/main/${roomId}`) &&
          (existing.readyState === 0 || existing.readyState === 1)) {
        return;
      }
      try { existing.close(); } catch {}
      duelSocketRef.current = null;
    }

    setDuelConnectionState("connecting");
    setDuelRetryAttempt(attempt);

    const ws = new PartySocket({
      host: PARTYKIT_HOST,
      room: roomId,
      query: { name, mode },
    });
    duelSocketRef.current = ws;

    let opened = false;
    let failed = false;

    const failAndMaybeRetry = (reason) => {
      if (opened || failed) return;
      failed = true;
      try { ws.close(); } catch {}

      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[duel] attempt ${attempt} failed (${reason}), retrying in 1.5s...`);
        setTimeout(() => connectDuel(roomId, mode, attempt + 1), 1500);
      } else {
        console.error(`[duel] all ${MAX_ATTEMPTS} attempts failed`);
        setDuelConnectionState("failed");
      }
    };

    const connectionTimeout = setTimeout(() => failAndMaybeRetry("timeout"), 4000);

    ws.addEventListener("message", (e) => {
      try {
        const msg = JSON.parse(e.data);
        handleDuelMessage(msg, ws);
      } catch (err) {
        console.error("[duel] parse error:", err);
      }
    });

    ws.addEventListener("open", () => {
      opened = true;
      clearTimeout(connectionTimeout);
      setDuelConnectionState("connected");
      setDuelRetryAttempt(0);
      setMyDuelId(ws.id);
    });

    ws.addEventListener("error", (e) => {
      clearTimeout(connectionTimeout);
      console.error("[duel] WebSocket error:", e);
      failAndMaybeRetry("error");
    });

    ws.addEventListener("close", () => {
      if (!opened) {
        clearTimeout(connectionTimeout);
        failAndMaybeRetry("close-before-open");
      }
    });
  }

  function handleDuelMessage(msg, ws) {
    if (msg.type === "state") {
      setDuelPlayers(msg.state.players);
      setDuelPhase(msg.state.phase);
    }
    if (msg.type === "countdown") {
      if (duelCountdownIntervalRef.current) clearInterval(duelCountdownIntervalRef.current);
      if (!duelGameStartRef.current) duelGameStartRef.current = Date.now();
      setDuelCountdown(msg.seconds);
      let c = msg.seconds;
      duelCountdownIntervalRef.current = setInterval(() => {
        c--;
        setDuelCountdown(c);
        if (c <= 0) {
          clearInterval(duelCountdownIntervalRef.current);
          duelCountdownIntervalRef.current = null;
          setDuelCountdown(null);
        }
      }, 1000);
    }
    if (msg.type === "round_start") {
      duelAnswerSentRef.current = false;
      setDuelSelection(null);
      if (msg.timerMs && msg.startTime) {
        setDuelRoundStart(msg.startTime);
        setDuelRoundTimerMs(msg.timerMs);
        setDuelTimeLeft(Math.ceil(msg.timerMs / 1000));
      }
      setDuelCurrentRound(msg.round);
      setDuelRoundData(msg.data);
      setDuelPhase("playing");
      setDuelAnswers({});
      setDuelBluffIdx(-1);
      setDuelBonusOpportunity(false);
      setDuelScreen("playing");
    }
    if (msg.type === "clock_update") {
      setDuelClocks(msg.clocks);
    }
    if (msg.type === "bonus_opportunity") {
      if (msg.forPlayerId === ws.id) {
        setDuelBonusOpportunity(true);
      }
    }
    if (msg.type === "player_answered") {
      setDuelAnswers(prev => ({ ...prev, [msg.playerId]: msg }));
      setDuelScores(prev => ({ ...prev, [msg.playerId]: msg.score }));
    }
    if (msg.type === "round_result") {
      setDuelBluffIdx(msg.bluffIdx);
      setDuelScores(msg.scores);
      setDuelPhase("round_result");
    }
    if (msg.type === "game_over") {
      setDuelWinner(msg.winner);
      setDuelIsTie(!!msg.isTie);
      setDuelScores(msg.scores);
      setDuelPhase("finished");
      setDuelScreen("result");
      // SWEAR: award duel outcome. Ties count as a loss for now (small
      // participation reward). gid combines the room id with the per-match
      // start timestamp so rematches don't dedup against prior games.
      const iWon = !msg.isTie && msg.winner === ws.id;
      const gid = `duel_${duelRoomId || "unknown"}_${duelGameStartRef.current || Date.now()}`;
      awardSwear(iWon ? "duel_win" : "duel_loss", gid, {
        label: t(iWon ? "swear.duel_win" : "swear.duel_loss", lang),
        meta: { scores: msg.scores, isTie: !!msg.isTie },
      });
      duelGameStartRef.current = null;
    }
    if (msg.type === "player_left") {
      setDuelPhase("abandoned");
      setTimeout(() => {
        duelSocketRef.current?.close();
        setDuelScreen(null);
        setDuelPlayers({});
        setDuelConnectionState("idle"); setDuelRetryAttempt(0);
      }, 4000);
    }
  }

  function sendDuelAnswer(sel) {
    if (!duelSocketRef.current || duelAnswerSentRef.current) return;
    duelAnswerSentRef.current = true;
    setDuelSelection(sel);
    duelSocketRef.current.send(JSON.stringify({
      type: "answer",
      sel,
      doublePoints: duelBonusOpportunity,
    }));
  }

  // ── START ────────────────────────────────────────────────────
  // ── Freemium wrappers ──
  function tryStartSoloGame() {
    if (!isPro) {
      const used = getFreeGamesUsed();
      const remaining = Math.max(0, 3 - used);
      setFreeGamesRemaining(remaining);
      if (remaining <= 0) {
        setPaywallReason("daily_limit");
        setShowPaywall(true);
        return false;
      }
      const next = incrementFreeGames();
      setFreeGamesRemaining(Math.max(0, 3 - next));
    }
    // CLIMB flow: Mini1 (Blackjack Warm-up) → 4 BLUFF rounds → Roulette →
    //   Mini2 (Shifter sniper) → 4 BLUFF → Roulette → Mini3 (Numbers TRUE/FALSE)
    //   → 4 BLUFF → Final.
    userInteractedRef.current = true;
    AudioTension.init();
    pendingMiniCarryRef.current = 0;
    setScreen("climb-mini1");
    return true;
  }

  function tryStartBlitz() {
    if (!isPro) {
      setPaywallReason("blitz");
      setShowPaywall(true);
      return false;
    }
    startBlitz();
    return true;
  }

  // ── SHIFTER / NUMBERS — Brojke i slova / Countdown style modes ─────
  function startShifter() {
    userInteractedRef.current = true;
    AudioTension.init();
    setScreen("shifter");
  }
  function startNumbers() {
    userInteractedRef.current = true;
    AudioTension.init();
    setScreen("numbers");
  }

  // ── SWIPE WARM-UP ──────────────────────────────────────────────
  function startSwipe() {
    userInteractedRef.current = true;
    AudioTension.init();
    setScreen("swipe");
  }
  // Completion handler: post the daily warm-up record (updates streak +
  // todayCompletedDate on the player profile), then refresh local state.
  // SWEAR was already incremented atomically inside /api/swipe-judge per
  // swipe — we only flash a toast here for the cumulative amount.
  async function onSwipeComplete(stats) {
    if (!stats) return;
    const uid = userIdRef.current;
    if (uid) {
      try {
        const headers = { "Content-Type": "application/json" };
        const token = await getCurrentIdToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const r = await fetch("/api/swipe-complete", {
          method: "POST",
          headers,
          body: JSON.stringify({
            userId: uid,
            sessionId: stats.sessionId,
            tzOffsetMin: new Date().getTimezoneOffset(),
            stats: {
              totalSwiped:  stats.totalSwiped  | 0,
              totalCorrect: stats.totalCorrect | 0,
              swearEarned:  stats.swearEarned  | 0,
            },
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.ok && data.dailyWarmup) {
          // Patch the local profile so home re-renders with streak + today flag.
          if (swearProfileRef.current) {
            const next = { ...swearProfileRef.current, dailyWarmup: data.dailyWarmup };
            swearProfileRef.current = next;
            setSwearProfile(next);
          }
        }
      } catch (e) {
        console.warn("[swipe] complete failed:", e.message);
      }

      // Re-fetch SWEAR balance — judging awarded directly, profile may be stale.
      try {
        const r = await fetch(`/api/swear-profile?userId=${encodeURIComponent(uid)}`);
        const data = await r.json();
        if (data.profile) applyProfile(data.profile);
      } catch { /* non-fatal */ }
    }

    if (stats.swearEarned > 0) {
      flashSwearAward(stats.swearEarned, t("swipe.label_warmup"));
    }
  }
  function handleSideModeComplete(summary) {
    if (!summary) return;
    const gid = `${summary.mode}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const won = summary.wins > summary.rounds / 2;
    const winEvent  = summary.mode === "shifter" ? "shifter_match_win"  : "numbers_match_win";
    const lossEvent = summary.mode === "shifter" ? "shifter_match_loss" : "numbers_match_loss";
    const sweepEvent = summary.mode === "shifter" ? "shifter_clean_sweep" : "numbers_clean_sweep";
    awardSwear(won ? winEvent : lossEvent, gid, {
      label: won ? "Match win" : "Match",
      meta: { wins: summary.wins, total: summary.rounds, userTotal: summary.userTotal, axiomTotal: summary.axiomTotal },
    });
    if (summary.cleanSweep) {
      awardSwear(sweepEvent, `${gid}_sweep`, { label: "Clean sweep" });
    }
  }

  function startGame() {
    userInteractedRef.current = true;
    AudioTension.init();
    clearInterval(timerRef.current);
    setMultiplier(1.0);
    multiplierRef.current = 1.0;
    setMultiplierLocked(null);
    milestonesFiredRef.current = new Set();
    firedStreakSwearRef.current = new Set();
    setLastRoundResult(null);
    setCorrectCount(0);
    correctCountRef.current = 0;
    setMaxCashout(1.0);
    maxCashoutRef.current = 1.0;
    // Reset time + loadingRound before any other state so auto-reveal effect
    // can't fire with stale time=0 from a previous session on first render.
    setTime(TIMER_PER_DIFF[ROUND_DIFFICULTY[0]] || 60);
    setLoadingRound(true);
    wrongCountRef.current=0;
    setBlitzMode(false);
    blitzModeRef.current = false;
    setDailyMode(false);
    dailyModeRef.current = false;
    dailyResultsRef.current = [];
    setDailyRank(null);
    setScreen("play");
    setRoundIdx(0);
    setSel(null);
    currentSelRef.current=null;
    setRevealed(false);
    {
      // Carry-over from CLIMB Mini1 (Blackjack Warm-up) — applied as the
      // starting score so player sees their pre-game points roll into CLIMB.
      const carry = pendingMiniCarryRef.current | 0;
      pendingMiniCarryRef.current = 0;
      setScore(carry);
      scoreRef.current = carry;
    }
    setAxiomScore(0);
    axiomScoreRef.current = 0;
    setTotal(0);
    setStreak(0);
    setConfetti(false);
    setShareImg(null);
    setDuelId(null);
    setDuelCreating(false);
    roundsPlayedRef.current = [];
    resultsHistoryRef.current = [];
    playedRoundIdsRef.current = [];
    gameStartTimeRef.current = Date.now();
    setCurrentWave(0);
    setShowWaveIntro(true);
    setTimeout(() => setShowWaveIntro(false), 1800);
    setFetchError(false);
    setPhaseScore(0);
    phaseScoreRef.current = 0;
    setStakeLevel(0);
    stakeLevelRef.current = 0;
    setStakeAnim(null);
    clearStakeTimers();
    setWheelOpen(false);
    setChipFlying(false);
    roundCategoriesRef.current = [...CATEGORIES].sort(() => Math.random() - 0.5);
    preloadedRoundsRef.current = [];
    secondBatchPendingRef.current = false;

    // Hybrid batch: await batch 1 (rounds 1-6), fire-and-forget batch 2 (rounds 7-12).
    // For non-English the cache is EN-only, so skip preloading and let fetchRound
    // fall through to /api/generate-round which honors the requested language.
    (async () => {
      if (langRef.current === "en") {
        const firstBatch = await fetchSoloBatch("first");
        preloadedRoundsRef.current = firstBatch;

        secondBatchPendingRef.current = true;
        fetchSoloBatch("second").then(batch => {
          preloadedRoundsRef.current = [...preloadedRoundsRef.current, ...batch];
          secondBatchPendingRef.current = false;
        });
      }

      fetchRound(0);
    })();

    axiomSpeak("intro","idle");
  }

  // Wheel-aware advance: rounds 4/8 (solo) trigger Wheel of Fortune; round 12 triggers Gambit
  function advanceAfterRound() {
    const justCompleted = roundIdx + 1; // 1-indexed
    // Daily uses exactly the server-issued round set (typically 10). Blitz has
    // its own fixed count. Regular solo has 12 with phase-end wheels.
    const totalRounds = dailyModeRef.current
      ? (dailyRoundsRef.current?.length || ROUND_DIFFICULTY.length)
      : (blitzMode ? BLITZ_ROUNDS : ROUND_DIFFICULTY.length);
    // Phase-end wheel/gambit only applies to regular solo mode.
    const isPhaseEnd = !blitzMode && !dailyModeRef.current && (justCompleted === 4 || justCompleted === 8 || justCompleted === 12);
    if (isPhaseEnd) {
      setWheelPhaseNum(justCompleted === 4 ? 1 : justCompleted === 8 ? 2 : 3);
      clearStakeTimers();
      clearTimeout(autoAdvanceRef.current);
      setAutoAdvanceCount(null);
      if (!isPro) {
        // Free users: show teaser instead of wheel/gambit, auto-continue.
        // CRITICAL: bank the phase's accumulated points into total score
        // here. The wheel onCashOut/onSpinResult is the only other place
        // phaseScore folds into score, and free users skip the wheel
        // entirely. Without this, every BLUFF round answered correctly
        // is silently dropped — score stays at 0 across phases.
        const curPhaseScore = phaseScoreRef.current;
        if (curPhaseScore > 0) {
          const next = scoreRef.current + curPhaseScore;
          scoreRef.current = next;
          setScore(next);
          phaseScoreRef.current = 0;
          setPhaseScore(0);
        }
        setShowWheelTeaser(true);
        setTimeout(() => {
          setShowWheelTeaser(false);
          if (justCompleted >= totalRounds) showResultScreen();
          // After teaser at phase 1/2, drop into the corresponding mini-game.
          else if (justCompleted === 4) setScreen("climb-mini2");
          else if (justCompleted === 8) setScreen("climb-mini3");
          else nextRound();
        }, 2200);
        return;
      }
      if (justCompleted === 12) {
        // Gambit flow: commit accumulated phase-3 bank to total first, then pick risk
        const curPhaseScore = phaseScoreRef.current;
        const curPlayer = scoreRef.current + curPhaseScore;
        const curAxiom = axiomScoreRef.current;
        setScore(curPlayer);
        scoreRef.current = curPlayer;
        setPhaseScore(0);
        phaseScoreRef.current = 0;
        // Offer Sudden Death if player is trailing 2×+
        if (curAxiom >= curPlayer * 2 && curAxiom > 0) {
          axiomSpeak("sudden_death_intro", "taunting");
          setSuddenDeathOfferOpen(true);
        } else {
          axiomSpeak("gambit_intro", "taunting");
          setGambitRiskOpen(true);
        }
        return;
      }
      setWheelOpen(true);
      return;
    }
    if (justCompleted >= totalRounds) showResultScreen();
    else nextRound();
  }

  // ── CREATE DUEL ──────────────────────────────────────────────
  async function handleCreateDuel() {
    if (duelCreating || duelId) return;
    const rounds = roundsPlayedRef.current.filter(Boolean);
    if (rounds.length < ROUND_DIFFICULTY.length) return; // not all rounds tracked
    setDuelCreating(true);
    try {
      const totalTime = gameStartTimeRef.current
        ? Math.round((Date.now() - gameStartTimeRef.current) / 1000)
        : 0;
      const name = duelName.trim() || "Player";
      localStorage.setItem("bluff_duel_name", name);
      const res = await fetch("/api/duel/create", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          rounds,
          score,
          time:    totalTime,
          results: resultsHistoryRef.current,
          name,
        }),
      });
      const data = await res.json();
      if (data.challengeId) {
        setDuelId(data.challengeId);
        const url = `${window.location.origin}/duel/${data.challengeId}`;
        if (navigator.share) {
          navigator.share({
            title: "BLUFF™ Duel Challenge",
            text:  `Crushed AXIOM with ${score.toLocaleString('en-US')} points. ${correctCount}/${total} reads. Can you beat me? 🎯`,
            url,
          }).catch(() => {});
        } else {
          navigator.clipboard?.writeText(url)
            .then(() => alert(t("result.duel_link_copied")))
            .catch(() => alert(url));
        }
      }
    } catch (e) {
      console.error("[duel create]", e);
      alert(t("result.could_not_create_duel"));
    } finally {
      setDuelCreating(false);
    }
  }

  // ── RESULT ───────────────────────────────────────────────────
  function showResultScreen() {
    clearInterval(timerRef.current);
    setScreen("result");

    // Snapshot from refs — React state reads here are stale when showResultScreen
    // is called synchronously right after setScore/setTotal in the wheel/gambit
    // paths. Refs mirror the latest committed value.
    const finalScore = scoreRef.current;
    const finalTotal = totalRef.current;
    const finalBest  = bestRef.current;
    const finalCorrect = correctCountRef.current;
    const won = finalCorrect >= Math.ceil(finalTotal * 0.67);

    if (dailyModeRef.current) submitDailyResult(finalScore, finalTotal);

    // Mark rounds as seen for this user (solo/blitz only — daily uses its
    // own shared-leaderboard pool). Fire-and-forget: mark-seen failures must
    // never bubble to the user or block the result screen.
    if (!dailyModeRef.current && userIdRef.current && playedRoundIdsRef.current.length > 0) {
      const seenMode = blitzModeRef.current ? "blitz" : "solo";
      const seenRounds = playedRoundIdsRef.current.filter(r => r && r.id);
      if (seenRounds.length > 0) {
        fetch("/api/mark-seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: userIdRef.current,
            mode: seenMode,
            rounds: seenRounds,
          }),
          keepalive: true,
        }).catch(() => {});
      }
    }

    // SWEAR: award end-of-game SWEAR for solo/blitz. Daily is awarded in
    // submitDailyResult; duel is awarded in its own result handler (skipped
    // for Part A MVP). gameStartTimeRef gives us a stable dedup key.
    if (!dailyModeRef.current) {
      const gid = `${blitzModeRef.current ? "blitz" : "solo"}_${gameStartTimeRef.current || Date.now()}`;
      if (blitzModeRef.current) {
        awardSwear(won ? "blitz_win" : "blitz_loss", gid, {
          label: t(won ? "swear.blitz_win" : "swear.blitz_loss", lang),
          meta: { score: finalScore, correct: finalCorrect, total: finalTotal },
        });
      } else {
        const soloWon = finalScore > axiomScoreRef.current;
        awardSwear(soloWon ? "solo_win" : "solo_loss", gid, {
          label: t(soloWon ? "swear.solo_win" : "swear.solo_loss", lang),
          meta: { score: finalScore, axiom: axiomScoreRef.current, correct: finalCorrect },
        });
      }
    }

    axiomSpeak(won ? "final_win" : "final_lose", won ? "defeated" : "taunting");
    if (won) { setConfetti(true); haptic.victory(); }

    // Share card — wait for AXIOM speech to land (~1s)
    setTimeout(() => {
      setAxiomSpeech(speech => {
        const img = generateShareCard(finalScore, finalTotal, finalBest, speech, won, correctCountRef.current, maxCashoutRef.current, axiomScoreRef.current);
        setShareImg(img);
        return speech;
      });
    }, 1000);

    // Stories card + challenge URL
    setTimeout(() => {
      const lieStmt = currentStmtsRef.current.find(s => !s.real);
      const lieText = lieStmt?.text || "";
      setAxiomSpeech(speech => {
        const img = generateStoriesCard(finalScore, finalTotal, finalBest, speech, won, lieText, lastAxiomLine, correctCountRef.current, maxCashoutRef.current, axiomScoreRef.current);
        setStoriesImg(img);
        setChallengeURL(buildChallengeURL(finalScore, finalTotal));
        return speech;
      });
    }, 1200);
  }

  // ── USEEFFECTS ───────────────────────────────────────────────

  // Track first user interaction for audio unlock
  useEffect(() => {
    function markInteracted() {
      userInteractedRef.current = true;
    }
    document.addEventListener("click", markInteracted, { once: true });
    document.addEventListener("touchstart", markInteracted, { once: true });
    return () => {
      document.removeEventListener("click", markInteracted);
      document.removeEventListener("touchstart", markInteracted);
    };
  }, []);

  // Keep refs in sync
  useEffect(()=>{ currentStmtsRef.current = stmts; },[stmts]);
  useEffect(()=>{ currentSelRef.current = sel; },[sel]);

  // Re-trigger intro speech if language changes or user returns to home
  useEffect(()=>{
    if(screen==="home" && !showIntro) axiomSpeak("intro","idle");
  },[lang, screen, showIntro]);

  // Fetch AXIOM power + slayer event on mount
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    fetch("/api/axiom-power", { signal: controller.signal })
      .then(r => r.json())
      .then(d => { if (alive) setAxiomPower(typeof d?.power === 'number' && !Number.isNaN(d.power) ? d.power : null); })
      .catch(() => {});
    fetch("/api/slayer-event", { signal: controller.signal })
      .then(r => r.json())
      .then(d => { if (alive) setSlayerEvent(d); })
      .catch(() => {});
    return () => { alive = false; controller.abort(); };
  }, []);

  // Detect challenge from URL
  useEffect(() => {
    const ch = getChallengeFromURL();
    if (ch && ch.s !== undefined && ch.t > 0) {
      setChallenge(ch);
      // Clean URL without reload
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Handle slayer_success redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("slayer_success") === "1") {
      const userId = params.get("userId") || localStorage.getItem("bluff_user_id");
      window.history.replaceState({}, "", window.location.pathname);
      setSlayerEntered(true);
      // Verify entry server-side
      if (userId) {
        fetch("/api/slayer-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "verify_entry", userId }),
        }).then(r => r.json()).then(d => { if (d.entered) setSlayerEntered(true); }).catch(() => {});
      }
    }
  }, []);

  // Verify Stripe skin purchase after redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const skinPurchased = params.get("skin_purchased");
    const sessionId = params.get("session_id");
    const openShop = params.get("shop");

    // User cancelled checkout
    if (openShop === "1") {
      window.history.replaceState({}, "", window.location.pathname);
      setShowShop(true);
      return;
    }

    if (!skinPurchased || !sessionId) return;
    window.history.replaceState({}, "", window.location.pathname);

    const currentUserId = localStorage.getItem("bluff_user_id") || "anon";

    // Send Bearer token so the server can pin the unlock to the auth'd
    // uid. Anonymous purchases still resolve through the Stripe metadata
    // userId captured at checkout creation; only fully-anon sessions
    // (metadata.userId === "anon") will be 401'd, requiring sign-in.
    (async () => {
      const headers = { "Content-Type": "application/json" };
      try {
        const token = await getCurrentIdToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
      } catch { /* anon proceed */ }
      fetch("/api/shop", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "verify", skinId: skinPurchased, userId: currentUserId, sessionId }),
      })
    .then(r => r.json())
    .then(data => {
      if (data.success) {
        const toUnlock = data.skinsUnlocked || [skinPurchased];
        setOwnedSkins(prev => {
          const merged = [...new Set([...prev, ...toUnlock])];
          localStorage.setItem("bluff_owned_skins", JSON.stringify(merged));
          return merged;
        });
        if (skinPurchased !== "bundle") {
          setActiveSkin(skinPurchased);
          localStorage.setItem("bluff_skin", skinPurchased);
        } else {
          setActiveSkin("balkan");
          localStorage.setItem("bluff_skin", "balkan");
        }
        setShowShop(true);
        setTimeout(() => {
          const names = { balkan:"Balkan", anime:"Anime", corporate:"Corporate", british:"British", bundle:"All" };
          alert(`✅ ${names[skinPurchased] || skinPurchased} AXIOM unlocked! 🎉`);
        }, 300);
      } else {
        console.warn("[shop] Not verified:", data);
        alert(`⚠️ ${t("common.checkout_verify_failed")}`);
      }
    })
    .catch(err => {
      console.error("[shop] Verify fetch error:", err);
      alert(`⚠️ ${t("common.checkout_verify_network")}`);
    });
    })();
  }, []);

  // Deep-link: ?duel=CODE&mode=regular|blitz → auto-join that room
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (deepLinkHandledRef.current) return;
    deepLinkHandledRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const duelCode = params.get("duel");
    const mode = params.get("mode") || "regular";
    if (duelCode && duelCode.length === 6) {
      window.history.replaceState({}, "", window.location.pathname);
      joinDuel(duelCode.toUpperCase(), mode);
    }
  }, []);

  // Load daily challenge on mount and on return to home
  useEffect(() => { loadDailyChallenge(); }, []);

  // Freemium: claim early-adopter slot + verify returning Stripe checkout + refresh free games counter
  useEffect(() => {
    let userId = null;
    try {
      userId = localStorage.getItem("bluff_user_id");
      if (!userId) {
        userId = "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem("bluff_user_id", userId);
      }
    } catch {}

    setFreeGamesRemaining(Math.max(0, 3 - getFreeGamesUsed()));

    try {
      if (localStorage.getItem("bluff_pro") === "1") setIsPro(true);
      if (localStorage.getItem("bluff_early_adopter") === "1") {
        setIsEarlyAdopter(true);
        setIsPro(true);
      }
    } catch {}

    if (userId) {
      fetch("/api/early-adopter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      })
        .then(r => r.json())
        .then(data => {
          if (data && data.is_early_adopter) {
            setIsEarlyAdopter(true);
            setIsPro(true);
            try {
              localStorage.setItem("bluff_early_adopter", "1");
              localStorage.setItem("bluff_pro", "1");
              if (data.rank) localStorage.setItem("bluff_early_adopter_rank", String(data.rank));
            } catch {}
          }
        })
        .catch(() => { /* offline: localStorage fallback already applied */ });
    }

    fetch("/api/early-adopter")
      .then(r => r.json())
      .then(data => {
        if (data && typeof data.slots_remaining === "number") {
          setEarlyAdopterSlotsRemaining(data.slots_remaining);
        }
      })
      .catch(() => {});

    try {
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get("session_id");
      if (sessionId) {
        fetch(`/api/verify?session_id=${encodeURIComponent(sessionId)}`)
          .then(r => r.json())
          .then(data => {
            if (data && data.verified) {
              setIsPro(true);
              try {
                localStorage.setItem("bluff_pro", "1");
                if (data.plan) localStorage.setItem("bluff_pro_plan", data.plan);
                if (data.email) localStorage.setItem("bluff_pro_email", data.email);
              } catch {}
              window.history.replaceState({}, "", window.location.pathname);
            }
          })
          .catch(() => {});
      }
    } catch {}
  }, []);

  // SWEAR profile: load or create on mount, then sync tier (early adopter /
  // pro) once so the server awards the Early Adopter bonus exactly once.
  useEffect(() => {
    const uid = userIdRef.current;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = { "Content-Type": "application/json" };
        const token = await getCurrentIdToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const r = await fetch("/api/swear-profile", {
          method:  "POST",
          headers,
          body:    JSON.stringify({ userId: uid }),
        });
        const data = await r.json();
        if (cancelled || !data.profile) return;
        applyProfile(data.profile);
        if (data.created && data.awarded > 0) {
          flashSwearAward(data.awarded, t("swear.first_bonus", lang));
        }
        // Tier sync only for signed-in users (endpoint now requires auth).
        if (!token) return;
        try {
          const tierR = await fetch("/api/swear-sync-tier", {
            method:  "POST",
            headers: {
              "Content-Type":  "application/json",
              "Authorization": `Bearer ${token}`,
            },
            body:    JSON.stringify({
              userId: uid,
              isPro:  localStorage.getItem("bluff_pro") === "1",
              proPlan: localStorage.getItem("bluff_pro_plan") || null,
              isEarlyAdopter: localStorage.getItem("bluff_early_adopter") === "1",
              earlyAdopterRank: parseInt(localStorage.getItem("bluff_early_adopter_rank") || "0", 10) || null,
            }),
          });
          const tierData = await tierR.json();
          if (cancelled) return;
          if (tierData.profile) applyProfile(tierData.profile);
          if (tierData.awarded > 0) {
            flashSwearAward(tierData.awarded, t("swear.early_adopter_bonus", lang));
          }
        } catch { /* non-fatal */ }
      } catch (e) {
        console.warn("[swear] profile init failed:", e.message);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser?.uid]);

  // iOS / mobile Safari uses signInWithRedirect; Firebase hands the result
  // back via getRedirectResult on the next page load. onAuthStateChanged
  // will also fire with the user, so we don't use the return value — we
  // just need to drain it so the SDK settles state, then clear the flag.
  useEffect(() => {
    if (!isAuthReady()) { console.log("[auth] redirect effect: auth not ready"); return; }
    let pending = false;
    try { pending = sessionStorage.getItem("bluff_auth_redirect_pending") === "1"; } catch {}
    console.log("[auth] redirect effect mounted", { pending });
    authStorageSnapshot().then((s) => pushAuthDebug("mount", { isIOSSafari: isIOSSafari(), ...s })).catch(() => {});
    if (!pending) { setAuthLoadingFromRedirect(false); return; }
    consumeRedirectResult().then((user) => {
      console.log("[auth] consumeRedirectResult resolved", user ? { uid: user.uid, email: user.email } : null);
      pushAuthDebug("redirect_result", { user: user ? { uid: user.uid, email: user.email } : null });
    }).finally(() => {
      try { sessionStorage.removeItem("bluff_auth_redirect_pending"); } catch {}
      setAuthLoadingFromRedirect(false);
      console.log("[auth] redirect pending flag cleared, overlay dismissed");
      authStorageSnapshot().then((s) => pushAuthDebug("post_redirect", s)).catch(() => {});
    });
  }, [pushAuthDebug]);

  // GIS (google.accounts.id) renderButton lifecycle — runs on every platform.
  // Fires whenever the auth modal opens; cleans up on close / unmount.
  useEffect(() => {
    if (!authModalOpen) return;
    let cancelled = false;
    setGisStatus("loading");
    pushAuthDebug("gis:effect_mounted", {});
    // Defer so the modal has painted and ref is attached.
    const id = setTimeout(() => {
      if (cancelled) return;
      const container = gisButtonRef.current;
      if (!container) {
        pushAuthDebug("gis:no_container", {});
        setGisStatus("failed");
        return;
      }
      // Clear any stale GIS iframe from a prior modal open.
      try { container.innerHTML = ""; } catch {}
      renderGoogleButton(container, {
        width: 300,
        onDebug: ({ label, obj }) => { if (!cancelled) pushAuthDebug("gis:" + label, obj); },
      }).then((user) => {
        if (cancelled) return;
        pushAuthDebug("gis:user_resolved", { uid: user?.uid, email: user?.email });
        if (user) {
          setAuthModalOpen(false);
          setAnonCapBannerOpen(false);
        }
      }).catch((e) => {
        if (cancelled) return;
        pushAuthDebug("gis:error", { message: e?.message });
        setGisStatus("failed");
      });
      setGisStatus("ready");
    }, 50);
    return () => { cancelled = true; clearTimeout(id); };
  }, [authModalOpen, pushAuthDebug]);

  // Firebase auth subscription: flip userIdRef to the uid on sign-in and
  // kick off anon → uid migration. On sign-out, restore prior anonymous id.
  useEffect(() => {
    if (!isAuthReady()) return;
    const unsub = onAuthChange(async (user) => {
      console.log("[auth] App onAuthChange", { user: user ? { uid: user.uid, email: user.email } : null, prevUserId: userIdRef.current });
      pushAuthDebug("onAuthChange", { user: user ? { uid: user.uid, email: user.email } : null });
      if (!user) {
        // Sign-out: restore anon id (fresh random if none stored).
        let anon = null;
        try { anon = localStorage.getItem("bluff_anonymous_id"); } catch {}
        if (!anon) {
          anon = Math.random().toString(36).slice(2) + Date.now().toString(36);
          try { localStorage.setItem("bluff_anonymous_id", anon); } catch {}
        }
        userIdRef.current = anon;
        try { localStorage.setItem("bluff_user_id", anon); } catch {}
        authUserRef.current = null;
        setAuthUser(null);
        return;
      }
      // Sign-in: remember the anon id we were using, then switch to uid and
      // run migration BEFORE publishing authUser (so the profile effect sees
      // a uid profile that already reflects the merged anon state).
      const prevUserId = userIdRef.current;
      let anonToMigrate = null;
      if (prevUserId && prevUserId !== user.uid && !prevUserId.startsWith("tg_")) {
        anonToMigrate = prevUserId;
        try { localStorage.setItem("bluff_anonymous_id", prevUserId); } catch {}
      }
      userIdRef.current = user.uid;
      try { localStorage.setItem("bluff_user_id", user.uid); } catch {}
      authUserRef.current = user;

      if (anonToMigrate) {
        await migrateAnonToUid(anonToMigrate);
      }
      setAuthUser(user);
    });
    return () => { try { unsub(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (screen === "home") loadDailyChallenge();
  }, [screen]);

  // Auto-reveal at 0
  useEffect(()=>{
    // Guard loadingRound/fetchError: stale time=0 from prior round races with transition.
    // Use stmts.length (not ref) so effect re-runs on setStmts and deps stay accurate.
    if(time<=0&&!revealed&&screen==="play"&&stmts.length>0&&!loadingRound&&!fetchError) doReveal();
  },[time,revealed,screen,stmts.length,loadingRound,fetchError]);

  // Timer starts only after round finishes loading
  useEffect(() => {
    if (fetchError || !stmts.length || loadingRound || revealed) return;
    if (screen === "play") {
      clearInterval(timerRef.current);
      const diff = blitzMode ? (BLITZ_DIFFICULTY[roundIdx] || 4) : (ROUND_DIFFICULTY[roundIdx] || 3);
      const maxT = blitzMode ? BLITZ_TIMER : (TIMER_PER_DIFF[diff] || 60);
      setTime(maxT);
      // Stake mechanic drives multiplier in solo mode (replaces time-based curve)
      if (!blitzMode) scheduleStakeEvents(maxT);
      timerRef.current = setInterval(() => {
        setTime(t => {
          const next = t <= 1 ? 0 : t - 1;
          if (blitzMode && multiplierLocked === null) {
            const elapsed = maxT - next;
            const m = computeMultiplier(elapsed, maxT, blitzMode);
            multiplierRef.current = m;
            setMultiplier(m);
            MULTIPLIER_MILESTONES.forEach(threshold => {
              if (m >= threshold && !milestonesFiredRef.current.has(threshold)) {
                milestonesFiredRef.current.add(threshold);
                onMultiplierMilestone(threshold);
              }
            });
          }
          if (t <= 1) { clearInterval(timerRef.current); return 0; }
          if (t === Math.floor(maxT * .45)) axiomSpeak("taunt_early", "taunting");
          if (t === 15) { try { AudioTension.tick(1); } catch {} haptic.timerWarning(); }
          if (t === 10) { axiomSpeak("taunt_late", "taunting"); haptic.timerWarning(); try { AudioTension.tick(1); } catch {} }
          if (t === 5) { haptic.timerWarning(); try { AudioTension.tick(2); } catch {} }
          if (t === 3) { haptic.timerWarning(); try { AudioTension.tick(3); } catch {} }
          if (t === 2) { try { AudioTension.tick(3); } catch {} }
          if (t === 1) { try { AudioTension.tick(3); } catch {} }
          return t - 1;
        });
      }, 1000);
    }
  }, [loadingRound, fetchError, stmts.length, revealed, roundIdx, blitzMode]);

  // ── SABOTAGE: schedule one optional disruption per eligible round ──
  // Runs after a fresh round is rendered. Solo Climb only (skip blitz +
  // daily challenge to keep deterministic-feeling modes clean). Cleans
  // up its own timers on round/screen change.
  useEffect(() => {
    if (screen !== "play" || revealed || loadingRound || fetchError || !stmts.length) return;
    if (blitzMode || dailyMode) return;

    const round1 = roundIdx + 1;
    const diff = ROUND_DIFFICULTY[roundIdx] || 3;
    if (!shouldTriggerSabotage(round1, diff, sabotageGameRef.current.triggeredThisGame)) return;

    const type = pickSabotageType();
    const delay = 5000 + Math.random() * 10000; // 5–15s into the round

    sabotageScheduleRef.current = setTimeout(() => {
      sabotageGameRef.current.triggeredThisGame = true;
      sabotageGameRef.current.lastType = type;
      logSabotageTriggered(type, round1, diff, userIdRef.current);

      const dur = SABOTAGE_TYPES[type]?.durationMs || 1500;

      if (type === "TIME_THIEF") {
        try { AudioTension.tick(3); } catch {}
        haptic.timerWarning?.();
        setSabotageActive({ type, startedAt: Date.now() });
        setSabotageBanner({ text: "⚡ AXIOM STOLE YOUR TIME", key: Date.now() });
        setTime(t => Math.max(5, t - 10));
        sabotageEndTimerRef.current = setTimeout(() => setSabotageActive(null), 800);
      } else if (type === "REALITY_GLITCH") {
        try { AudioTension.tick(2); } catch {}
        setSabotageActive({ type, startedAt: Date.now() });
        setSabotageBanner({ text: "🌀 GLITCH IN THE MATRIX", key: Date.now() });
        sabotageEndTimerRef.current = setTimeout(() => setSabotageActive(null), dur);
      } else if (type === "PEEK_AND_HIDE") {
        const truthIdxs = currentStmtsRef.current
          .map((s, i) => (s?.real ? i : -1))
          .filter(i => i >= 0);
        if (truthIdxs.length === 0) return;
        const peekIdx = truthIdxs[Math.floor(Math.random() * truthIdxs.length)];
        try { AudioTension.tick(1); } catch {}
        setSabotageActive({ type, startedAt: Date.now(), peekIdx });
        setSabotageBanner({ text: "👁 AXIOM SHOWED YOU SOMETHING. TOO LATE.", key: Date.now() });
        sabotagePeekTimerRef.current = setTimeout(() => {
          // Clear the green border but keep the banner readable for the
          // remainder of its display duration.
          setSabotageActive(prev => (prev && prev.type === "PEEK_AND_HIDE") ? { ...prev, peekIdx: -1 } : prev);
        }, 1000);
      }

      // Banner fades on its own via CSS, but we still null it out so a
      // subsequent sabotage on a different game cycle can re-trigger.
      sabotageBannerTimerRef.current = setTimeout(() => setSabotageBanner(null), 1800);
    }, delay);

    return () => {
      if (sabotageScheduleRef.current) clearTimeout(sabotageScheduleRef.current);
      if (sabotageEndTimerRef.current) clearTimeout(sabotageEndTimerRef.current);
      if (sabotagePeekTimerRef.current) clearTimeout(sabotagePeekTimerRef.current);
      if (sabotageBannerTimerRef.current) clearTimeout(sabotageBannerTimerRef.current);
      setSabotageActive(null);
      setSabotageBanner(null);
    };
  }, [screen, revealed, loadingRound, fetchError, stmts.length, roundIdx, blitzMode, dailyMode]);

  // Reset per-game sabotage state on a new game start.
  useEffect(() => {
    if (screen === "play" && roundIdx === 0) {
      sabotageGameRef.current = { triggeredThisGame: false };
    }
    if (screen !== "play") {
      // Leaving play (home / result / etc): clear any in-flight visuals.
      setSabotageActive(null);
      setSabotageBanner(null);
      setPitFallActive(false);
      setAxiomReaction(null);
    }
  }, [screen, roundIdx]);

  // ── COMMUNITY PULSE: ambient toasts during Solo play ──
  useEffect(() => {
    if (screen !== "play") return;
    if (blitzMode) return; // keep Blitz lean — no ambient distractions
    const stop = startCommunityPulse((toast) => {
      // Only show if no toast currently visible. New toasts replace stale.
      setCommunityToast(toast);
    }, { lang });
    communityStopRef.current = stop;
    return () => {
      try { stop(); } catch {}
      setCommunityToast(null);
    };
  }, [screen, blitzMode, lang]);

  // ── TELEGRAM MAIN BUTTON sync ───────────────────────────────
  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp?.MainButton) return;
    if (screen !== "play") { webApp.MainButton.hide(); return; }

    webApp.MainButton.offClick();
    if (!revealed) {
      if (sel !== null) {
        webApp.MainButton.setText("🔒 LOCK IN ANSWER");
        webApp.MainButton.setParams({ color: "#e8c547", text_color: "#04060f", is_active: true, is_visible: true });
        webApp.MainButton.onClick(doReveal);
      } else {
        webApp.MainButton.setText("SELECT AN ANSWER FIRST");
        webApp.MainButton.setParams({ color: "#2a2a2a", text_color: "#555555", is_active: false, is_visible: true });
      }
      webApp.MainButton.show();
    } else {
      const isLast = roundIdx + 1 >= (blitzMode ? BLITZ_ROUNDS : ROUND_DIFFICULTY.length);
      webApp.MainButton.setText(isLast ? "SEE RESULTS →" : "NEXT ROUND →");
      webApp.MainButton.setParams({ color: "#22d3ee", text_color: "#04060f", is_active: true, is_visible: true });
      webApp.MainButton.onClick(advanceAfterRound);
      webApp.MainButton.show();
    }
  }, [screen, sel, revealed, roundIdx]);

  // ── TELEGRAM BACK BUTTON ────────────────────────────────────
  useEffect(() => {
    const webApp = window.Telegram?.WebApp;
    if (!webApp?.BackButton) return;
    if (screen === "play") {
      webApp.BackButton.offClick();
      webApp.BackButton.onClick(() => {
        clearInterval(timerRef.current);
        webApp.BackButton.hide();
        webApp.MainButton.hide();
        setScreen("home");
      });
      webApp.BackButton.show();
    } else {
      webApp.BackButton.hide();
    }
  }, [screen]);

  useEffect(()=>()=>clearInterval(timerRef.current),[]);
  useEffect(()=>()=>{ try{ AudioTension.destroy(); }catch{} try{ _closeTickCtx(); }catch{} },[]);
  useEffect(()=>{
    if(!revealed){ clearTimeout(autoAdvanceRef.current); setAutoAdvanceCount(null); return; }
    let count=3;
    setAutoAdvanceCount(count);
    const tick=()=>{
      count--;
      if(count<=0){ setAutoAdvanceCount(null); advanceAfterRound(); }
      else{ setAutoAdvanceCount(count); autoAdvanceRef.current=setTimeout(tick,750); }
    };
    autoAdvanceRef.current=setTimeout(tick, blitzMode ? 100 : 4300);
    return ()=>clearTimeout(autoAdvanceRef.current);
  },[revealed]);
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
    };
  }, []);
  useEffect(() => {
    return () => {
      if (duelSocketRef.current) {
        duelSocketRef.current.close();
        duelSocketRef.current = null;
      }
      if (duelCountdownIntervalRef.current) {
        clearInterval(duelCountdownIntervalRef.current);
        duelCountdownIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (duelPhase !== "playing" || !duelRoundStart || duelMode === "blitz") return;
    const iv = setInterval(() => {
      const elapsed = Date.now() - duelRoundStart;
      const remaining = Math.max(0, duelRoundTimerMs - elapsed);
      setDuelTimeLeft(Math.ceil(remaining / 1000));
    }, 500);
    return () => clearInterval(iv);
  }, [duelPhase, duelRoundStart, duelRoundTimerMs, duelMode]);

  // First-visit auto-show of How-to-Play
  useEffect(() => {
    if (total === 0 && !safeLSGet("bluff_howto_shown")) {
      setShowHowToPlay(true);
      safeLSSet("bluff_howto_shown", "1");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lobby elapsed-time tracker
  useEffect(() => {
    if (duelScreen === "lobby") {
      lobbyStartRef.current = Date.now();
      setLobbyElapsed(0);
      const tick = setInterval(() => {
        setLobbyElapsed(Math.floor((Date.now() - lobbyStartRef.current) / 1000));
      }, 1000);
      return () => clearInterval(tick);
    }
  }, [duelScreen]);

  // Unlock audio on first user gesture (iOS/mobile requirement)
  useEffect(() => {
    function unlockAudio() {
      haptic.tap();
      document.removeEventListener("click", unlockAudio);
      document.removeEventListener("touchstart", unlockAudio);
    }
    document.addEventListener("click", unlockAudio);
    document.addEventListener("touchstart", unlockAudio);
    return () => {
      document.removeEventListener("click", unlockAudio);
      document.removeEventListener("touchstart", unlockAudio);
    };
  }, []);

  // ── THEME ────────────────────────────────────────────────────
  const T = {
    bg:"#04060f",card:"#0f0f1a",gold:"#e8c547",
    goldDim:"rgba(232,197,71,.1)",ok:"#2dd4a0",bad:"#f43f5e",
    dim:"#5a5a68",glass:"rgba(255,255,255,.03)",gb:"rgba(255,255,255,.07)",
  };
  const wrap = {
    minHeight:"100dvh",
    background:`radial-gradient(ellipse at 50% 0%,rgba(232,197,71,.05) 0%,${T.bg} 55%)`,
    fontFamily:"'Segoe UI',system-ui,sans-serif",
    display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
    position:"relative",overflow:"hidden",color:"#e8e6e1",
    paddingTop:"env(safe-area-inset-top)",
    paddingBottom:"max(24px,env(safe-area-inset-bottom))",
  };

  const bi = stmts.findIndex(s=>!s.real);
  const correct = sel===bi && bi!==-1;
  const diff = blitzMode ? (BLITZ_DIFFICULTY[roundIdx] || 4) : (ROUND_DIFFICULTY[roundIdx] || 3);
  const qpw = QUESTIONS_PER_WAVE[blitzMode ? "blitz" : "regular"];

  if(showIntro) return <><CinematicIntro onComplete={()=>{
    setShowIntro(false);
    localStorage.setItem("bluff_played","1");
    axiomSpeak("intro","idle");
  }}/><GameStyles/></>;

  // ─── DUEL MODE SELECT (Create vs Join) ─────────────────────
  if (duelScreen === "mode-select") return (
    <div className="dvh-screen" style={{background:"#04060f",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:"24px",color:"#e8e6e1",
      fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:11,letterSpacing:"4px",color:"rgba(232,197,71,.5)",marginBottom:8}}>
            {t("duel_mode.title")}
          </div>
          <div style={{fontFamily:"Georgia,serif",fontSize:26,fontWeight:900,color:"#e8c547"}}>
            {t("duel_mode.subtitle")}
          </div>
        </div>

        {/* CREATE */}
        <div style={{marginBottom:20,padding:"20px",background:"rgba(232,197,71,.05)",
          border:"1px solid rgba(232,197,71,.2)",borderRadius:14}}>
          <div style={{fontSize:13,color:"#e8c547",fontWeight:700,marginBottom:10,letterSpacing:"2px"}}>
            {t("duel_mode.create")}
          </div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.5)",marginBottom:14,lineHeight:1.5}}>
            {t("duel_mode.create_sub")}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={() => openDuel("regular")}
              style={{flex:1,padding:"12px",fontSize:12,fontWeight:700,
                background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#04060f",
                border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit",
                letterSpacing:"1px",textTransform:"uppercase"}}>
              {t("duel_mode.create_regular")}
            </button>
            <button onClick={() => openDuel("blitz")}
              style={{flex:1,padding:"12px",fontSize:12,fontWeight:700,
                background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#04060f",
                border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit",
                letterSpacing:"1px",textTransform:"uppercase"}}>
              {t("duel_mode.create_blitz")}
            </button>
          </div>
        </div>

        {/* JOIN */}
        <div style={{padding:"20px",background:"rgba(255,255,255,.03)",
          border:"1px solid rgba(255,255,255,.1)",borderRadius:14}}>
          <div style={{fontSize:13,color:"rgba(255,255,255,.9)",fontWeight:700,marginBottom:10,letterSpacing:"2px"}}>
            {t("duel_mode.join")}
          </div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.5)",marginBottom:14,lineHeight:1.5}}>
            {t("duel_mode.join_sub")}
          </div>
          <input
            placeholder={t("duel_mode.code")}
            maxLength={6}
            autoCapitalize="characters"
            autoFocus
            style={{width:"100%",padding:"14px",fontSize:22,textAlign:"center",
              background:"rgba(255,255,255,.04)",border:"1px solid rgba(255,255,255,.15)",
              borderRadius:10,color:"#e8e6e1",fontFamily:"Georgia,serif",fontWeight:900,
              letterSpacing:"6px",outline:"none",marginBottom:10,textTransform:"uppercase",
              boxSizing:"border-box"}}
            id="home-join-input"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const code = e.target.value.trim().toUpperCase();
                if (code.length === 6) joinDuel(code, "regular");
              }
            }}
          />
          <div style={{display:"flex",gap:8}}>
            <button onClick={() => {
              const el = document.getElementById("home-join-input");
              const code = (el?.value || "").trim().toUpperCase();
              if (code.length === 6) joinDuel(code, "regular");
            }}
              style={{flex:1,padding:"12px",fontSize:12,fontWeight:700,
                background:"rgba(232,197,71,.12)",color:"#e8c547",
                border:"1px solid rgba(232,197,71,.3)",borderRadius:10,cursor:"pointer",
                fontFamily:"inherit",letterSpacing:"1px",textTransform:"uppercase"}}>
              {t("duel_mode.join_regular")}
            </button>
            <button onClick={() => {
              const el = document.getElementById("home-join-input");
              const code = (el?.value || "").trim().toUpperCase();
              if (code.length === 6) joinDuel(code, "blitz");
            }}
              style={{flex:1,padding:"12px",fontSize:12,fontWeight:700,
                background:"rgba(232,197,71,.12)",color:"#e8c547",
                border:"1px solid rgba(232,197,71,.3)",borderRadius:10,cursor:"pointer",
                fontFamily:"inherit",letterSpacing:"1px",textTransform:"uppercase"}}>
              {t("duel_mode.join_blitz")}
            </button>
          </div>
        </div>

        <button onClick={() => setDuelScreen(null)}
          style={{marginTop:20,width:"100%",padding:"12px",fontSize:12,
            background:"transparent",color:"rgba(255,255,255,.4)",
            border:"1px solid rgba(255,255,255,.1)",borderRadius:10,cursor:"pointer",
            fontFamily:"inherit"}}>
          {t("duel_mode.back")}
        </button>
      </div>
      <GameStyles/>
    </div>
  );

  // ─── DUEL LOBBY ────────────────────────────────────────────
  if (duelScreen === "lobby") return (
    <div className="dvh-screen" style={{background:"#04060f",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:"24px",color:"#e8e6e1",
      fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{width:"100%",maxWidth:420}}>
        {duelConnectionState === "connecting" && (
          <div style={{textAlign:"center",padding:"48px 20px",color:"rgba(255,255,255,.5)"}}>
            <div style={{fontSize:32,marginBottom:12,animation:"g-pulse 1s infinite"}}>🛰️</div>
            <div style={{fontSize:15,fontWeight:600}}>{t("duel_lobby.connecting")}</div>
            {duelRetryAttempt > 1 ? (
              <div style={{fontSize:11,marginTop:6,color:"#fb923c"}}>
                {t("duel_lobby.attempt_n", { n: duelRetryAttempt })}
              </div>
            ) : (
              <div style={{fontSize:11,marginTop:8,opacity:.6}}>{t("duel_lobby.may_take_seconds")}</div>
            )}
          </div>
        )}

        {duelConnectionState === "failed" && (
          <div style={{textAlign:"center",padding:"24px"}}>
            <div style={{fontSize:32,marginBottom:8}}>⚠️</div>
            <div style={{color:"#f43f5e",fontWeight:600,marginBottom:12}}>{t("duel_lobby.connection_failed")}</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.5)",marginBottom:20,lineHeight:1.5}}>
              {t("duel_lobby.server_unreachable")}
            </div>
            <button
              onClick={()=>{
                try { duelSocketRef.current?.close(); } catch {}
                setDuelConnectionState("idle"); setDuelRetryAttempt(0);
                setDuelScreen(null);
                setDuelPlayers({});
              }}
              style={{padding:"12px 24px",background:"rgba(232,197,71,.1)",color:"#e8c547",
                border:"1px solid rgba(232,197,71,.3)",borderRadius:10,cursor:"pointer",
                fontFamily:"inherit",fontSize:14,fontWeight:600}}>
              {t("duel_lobby.back_home")}
            </button>
          </div>
        )}

        {duelConnectionState === "connected" && (<>
        {Object.keys(duelPlayers).length < 2 ? (<>
          <div style={{textAlign:"center",marginBottom:24}}>
            <div style={{fontSize:12,letterSpacing:"5px",color:"#e8c547",
                         textTransform:"uppercase",marginBottom:12,fontWeight:700,
                         textShadow:"0 0 20px rgba(232,197,71,0.3)"}}>
              {duelMode==="blitz"?t("duel_lobby.blitz_duel"):t("duel_lobby.regular_duel")}
            </div>
            <div style={{fontSize:16,color:"#e8e6e1",opacity:1,fontWeight:500,letterSpacing:0.3}}>
              {t("duel_lobby.waiting_for_opponent")}
              <span style={{
                display:"inline-block",animation:"lobby-dotwave 1.4s ease-in-out infinite"
              }}>…</span>
            </div>
          </div>

          {/* Animated heartbeat */}
          <div style={{display:"flex",justifyContent:"center",gap:8,marginBottom:32}}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width:12,height:12,borderRadius:"50%",background:"#e8c547",
                animation:`lobby-pulse 1.4s ease-in-out ${i*0.2}s infinite`,
                opacity:0.3,boxShadow:"0 0 12px rgba(232,197,71,0.6)"
              }}/>
            ))}
          </div>

          {/* Big room code card */}
          <div style={{
            background:"linear-gradient(135deg,#14141c 0%,#0c0c14 100%)",
            border:"2px solid rgba(232,197,71,0.55)",
            borderRadius:20,padding:"28px 20px",marginBottom:18,textAlign:"center",
            boxShadow:"0 0 60px rgba(232,197,71,0.18),inset 0 0 30px rgba(232,197,71,0.04)",
            position:"relative",overflow:"hidden"
          }}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:2,
              background:"linear-gradient(90deg,transparent,rgba(232,197,71,0.8),transparent)"}}/>
            <div style={{fontSize:11,color:"#e8c547",letterSpacing:3,
                         textTransform:"uppercase",fontWeight:600,marginBottom:10}}>
              {t("duel_lobby.room_code")}
            </div>
            <div style={{fontSize:42,fontWeight:900,letterSpacing:8,
                         fontFamily:"Georgia,serif",color:"#e8c547",
                         textShadow:"0 0 20px rgba(232,197,71,0.3)"}}>
              {duelRoomId || "- - - - - -"}
            </div>
          </div>

          {/* Share buttons */}
          <div style={{display:"flex",gap:10,marginBottom:14}}>
            <button onClick={() => {
              const url = `${window.location.origin}/?duel=${duelRoomId}&mode=${duelMode}`;
              if (navigator.share) {
                navigator.share({ title:"BLUFF duel", text:"Can you beat me?", url })
                  .catch(() => {});
              } else {
                navigator.clipboard?.writeText(url).catch(() => {});
              }
            }}
              style={{flex:1,padding:"14px",fontSize:13,fontWeight:700,
                letterSpacing:1,textTransform:"uppercase",
                background:"linear-gradient(135deg,#e8c547,#d4a830)",
                color:"#08080f",border:"none",borderRadius:12,cursor:"pointer",
                fontFamily:"inherit"}}
            >
              {t("duel_lobby.share_link")}
            </button>
            <button onClick={() => {
              navigator.clipboard?.writeText(duelRoomId || "").catch(() => {});
            }}
              style={{flex:1,padding:"14px",fontSize:13,fontWeight:700,
                letterSpacing:1,textTransform:"uppercase",
                background:"rgba(232,197,71,0.08)",color:"#e8c547",
                border:"1.5px solid rgba(232,197,71,0.35)",borderRadius:12,
                cursor:"pointer",fontFamily:"inherit"}}
            >
              {t("duel_lobby.copy_code")}
            </button>
          </div>

          {/* Elapsed time + conditional escape hatch */}
          <div style={{textAlign:"center",marginTop:20}}>
            <div style={{
              fontSize:13,letterSpacing:2,textTransform:"uppercase",
              fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:6,
              opacity:lobbyElapsed < 30 ? 0.6 : 1,
              color:lobbyElapsed >= 60 ? "#fb923c" : lobbyElapsed >= 30 ? "#e8c547" : "#7a7a88",
              transition:"color 1s"
            }}>
              <span style={{
                display:"inline-block",width:6,height:6,borderRadius:"50%",
                background:"currentColor",
                animation:"lobby-tick 1s ease-in-out infinite"
              }}/>
              {t("duel_lobby.waiting")} {Math.floor(lobbyElapsed / 60)}:{String(lobbyElapsed % 60).padStart(2,"0")}
            </div>

            {lobbyElapsed >= 120 && (
              <div style={{marginTop:16,padding:"14px 16px",
                background:"rgba(244,63,94,0.06)",borderRadius:12,
                border:"1px solid rgba(244,63,94,0.2)",
                animation:"lobby-timeout-fadeIn 0.5s ease"
              }}>
                <div style={{fontSize:13,color:"#e8e6e1",marginBottom:10,opacity:0.8}}>
                  {t("duel_lobby.friend_not_coming")}
                </div>
                <button onClick={() => {
                  if (duelSocketRef.current) duelSocketRef.current.close();
                  setDuelScreen(null);
                  setDuelConnectionState("idle");
                  setDuelRetryAttempt(0);
                  setScreen("home");
                }}
                  style={{padding:"10px 20px",fontSize:12,fontWeight:600,
                    background:"rgba(244,63,94,0.15)",color:"#f43f5e",
                    border:"1px solid rgba(244,63,94,0.3)",borderRadius:10,
                    cursor:"pointer",letterSpacing:1,textTransform:"uppercase",
                    fontFamily:"inherit"}}
                >
                  {t("duel_lobby.cancel_duel")}
                </button>
              </div>
            )}
          </div>
        </>) : (<>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:11,letterSpacing:"4px",color:"rgba(232,197,71,.5)",marginBottom:8}}>
            {duelMode==="blitz"?t("duel_lobby.blitz_duel"):t("duel_lobby.regular_duel")}
          </div>
          <div style={{fontFamily:"Georgia,serif",fontSize:36,fontWeight:900,color:"#e8c547"}}>
            {duelRoomId}
          </div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.3)",marginTop:6,letterSpacing:"2px"}}>
            {t("duel_lobby.room_code").toUpperCase()}
          </div>
        </div>

        {Object.values(duelPlayers).map((p,i) => (
          <div key={p.id} style={{
            display:"flex",alignItems:"center",gap:12,padding:"14px 16px",marginBottom:8,
            background:"rgba(232,197,71,.06)",border:"1px solid rgba(232,197,71,.15)",
            borderRadius:12,
          }}>
            <div style={{width:36,height:36,borderRadius:"50%",
              background:i===0?"rgba(232,197,71,.2)":"rgba(45,212,160,.2)",
              display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:14,fontWeight:700,color:i===0?"#e8c547":"#2dd4a0",
            }}>
              {p.name[0].toUpperCase()}
            </div>
            <div>
              <div style={{fontWeight:700,fontSize:15}}>{p.name}</div>
              <div style={{fontSize:11,color:"rgba(255,255,255,.3)"}}>
                {p.id === myDuelId ? t("duel_lobby.you") : t("duel_lobby.opponent")}
              </div>
            </div>
            <div style={{marginLeft:"auto",fontSize:11,color:"#2dd4a0"}}>{t("duel_lobby.ready")}</div>
          </div>
        ))}
        </>)}

        {duelCountdown !== null && (
          <div style={{textAlign:"center",fontSize:72,fontWeight:900,fontFamily:"Georgia,serif",
            color:"#e8c547",animation:"g-pulse .5s infinite"}}>
            {duelCountdown}
          </div>
        )}

        <button
          onClick={()=>{
            duelSocketRef.current?.close();
            setDuelScreen(null);
            setDuelConnectionState("idle"); setDuelRetryAttempt(0);
          }}
          style={{width:"100%",marginTop:20,padding:"12px",fontSize:13,
            background:"transparent",color:"rgba(255,255,255,.2)",
            border:"1px solid rgba(255,255,255,.07)",borderRadius:10,
            cursor:"pointer",fontFamily:"inherit"}}>
          {t("duel_lobby.cancel")}
        </button>
        </>)}
      </div>
      <GameStyles/>
    </div>
  );

  // ─── DUEL PLAYING ──────────────────────────────────────────
  if (duelScreen === "playing" && duelRoundData) return (
    <div className="dvh-screen" style={{background:"#04060f",display:"flex",flexDirection:"column",
      alignItems:"center",padding:"20px 16px",color:"#e8e6e1",
      fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{width:"100%",maxWidth:460}}>
        {/* Header: scores + clocks */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16,
          paddingTop:"max(12px,env(safe-area-inset-top))"}}>
          {Object.values(duelPlayers).map((p,i) => (
            <div key={p.id} style={{textAlign:i===0?"left":"right",flex:1}}>
              <div style={{fontSize:10,color:i===0?"#e8c547":"#2dd4a0",letterSpacing:"2px"}}>
                {p.id===myDuelId?"YOU":p.name.toUpperCase()}
              </div>
              <div style={{fontSize:24,fontWeight:900,fontFamily:"Georgia,serif",
                color:i===0?"#e8c547":"#2dd4a0"}}>
                {duelScores[p.id]||0}
              </div>
              {duelMode==="blitz" && duelClocks[p.id] !== undefined && (
                <div style={{fontSize:11,color:duelClocks[p.id]<10000?"#f43f5e":"rgba(255,255,255,.3)"}}>
                  ⏱ {(duelClocks[p.id]/1000).toFixed(1)}s
                </div>
              )}
            </div>
          ))}
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"0 12px",gap:4}}>
            <div style={{fontSize:11,color:"rgba(255,255,255,.3)",letterSpacing:"1px"}}>
              {duelCurrentRound+1}/{duelMode==="blitz"?4:6}
            </div>
            {duelMode !== "blitz" && duelPhase === "playing" && (
              <div style={{fontSize:18,fontWeight:900,fontFamily:"Georgia,serif",
                color:duelTimeLeft<=10?"#f43f5e":duelTimeLeft<=20?"#e8c547":"rgba(255,255,255,.85)",
                animation:duelTimeLeft<=5?"g-pulse 0.5s infinite":"none"}}>
                {duelTimeLeft}s
              </div>
            )}
          </div>
        </div>

        {duelBonusOpportunity && (
          <div style={{textAlign:"center",padding:"10px",marginBottom:12,
            background:"rgba(232,197,71,.15)",border:"1px solid rgba(232,197,71,.4)",
            borderRadius:10,fontSize:13,color:"#e8c547",fontWeight:700}}>
            {t("duel_play.opponent_flag_fell")}
          </div>
        )}

        <div style={{textAlign:"center",marginBottom:16}}>
          <h2 style={{fontFamily:"Georgia,serif",fontSize:"clamp(17px,4.5vw,22px)",fontWeight:800,
            margin:"0 0 4px",color:duelPhase==="round_result"?"rgba(255,255,255,.4)":"#fff"}}>
            {duelPhase==="round_result"?t("duel_play.round_over"):t("duel_play.which_is_bluff")}
          </h2>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
          {(duelRoundData.statements||[]).map((s,i) => {
            const isBluff = !s.real;
            const myAnswer = duelAnswers[myDuelId];
            const revealed = duelPhase==="round_result";
            let bg="rgba(15,15,26,.9)",border="rgba(255,255,255,.07)";
            if(!revealed && duelSelection===i){bg="rgba(232,197,71,.12)";border="rgba(232,197,71,.5)";}
            if(revealed && i===duelBluffIdx){bg="rgba(244,63,94,.08)";border="rgba(244,63,94,.4)";}
            if(revealed && myAnswer?.sel===i && i!==duelBluffIdx){border="rgba(244,63,94,.3)";}
            if(revealed && myAnswer?.sel===i && myAnswer?.correct){bg="rgba(45,212,160,.07)";border="rgba(45,212,160,.4)";}

            return (
              <button key={i}
                onClick={()=>duelPhase==="playing"&&!duelAnswers[myDuelId]&&sendDuelAnswer(i)}
                style={{width:"100%",display:"flex",alignItems:"flex-start",gap:10,
                  background:bg,border:`1.5px solid ${border}`,borderRadius:14,
                  padding:"clamp(11px,3vw,14px)",cursor:duelPhase==="playing"&&!duelAnswers[myDuelId]?"pointer":"default",
                  textAlign:"left",color:"#e8e6e1",fontSize:"clamp(13px,3.5vw,15px)",
                  lineHeight:1.55,fontFamily:"inherit",minHeight:52,transition:"all .2s"}}>
                <div style={{width:26,height:26,borderRadius:"50%",flexShrink:0,
                  border:`2px solid ${revealed&&isBluff?"rgba(244,63,94,.5)":!revealed&&duelSelection===i?"#e8c547":"rgba(255,255,255,.1)"}`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:12,fontWeight:700,marginTop:2,
                  background:revealed&&isBluff?"rgba(244,63,94,.18)":!revealed&&duelSelection===i?"rgba(232,197,71,.2)":"transparent",
                  color:revealed&&isBluff?"#f43f5e":"rgba(90,90,104,1)"}}>
                  {revealed&&isBluff?"!":String.fromCharCode(65+i)}
                </div>
                <div style={{flex:1}}>
                  {s.text}
                  {revealed && (
                    <div style={{marginTop:5,fontSize:10,fontWeight:700,letterSpacing:"1px",
                      color:isBluff?"#f43f5e":i===myAnswer?.sel?"rgba(244,63,94,.6)":"rgba(45,212,160,.5)"}}>
                      {isBluff?t("duel_play.bluff"):i===myAnswer?.sel?t("duel_play.real_wrong"):t("duel_play.real_right")}
                    </div>
                  )}
                </div>
                {revealed && Object.entries(duelAnswers).filter(([_,a])=>a.sel===i).map(([pid])=>(
                  <div key={pid} style={{fontSize:10,color:"rgba(255,255,255,.3)",flexShrink:0}}>
                    {duelPlayers[pid]?.name?.[0]}
                  </div>
                ))}
              </button>
            );
          })}
        </div>

        {duelAnswers[myDuelId] && duelPhase==="playing" && (
          <div style={{textAlign:"center",color:"rgba(255,255,255,.3)",fontSize:13}}>
            {t("duel_play.waiting_for_opponent")}
          </div>
        )}

        {duelPhase==="abandoned" && (
          <div style={{textAlign:"center",padding:20,color:"#f43f5e",fontSize:14}}>
            {t("duel_play.opponent_disconnected")}
          </div>
        )}
      </div>
      <GameStyles/>
    </div>
  );

  // ─── DUEL RESULT ───────────────────────────────────────────
  if (duelScreen === "result") {
    const iWon = duelWinner === myDuelId;
    const myScore = duelScores[myDuelId] || 0;
    const duelGlyph = duelIsTie ? "🤝" : iWon ? "👑" : "💀";
    const duelVerdict = duelIsTie ? t("duel_result.tie") : iWon ? t("duel_result.victory") : t("duel_result.defeated");
    const duelHeroText = duelIsTie ? t("duel_result.equally_matched") : iWon ? t("duel_result.you_beat_them") : t("duel_result.they_beat_you");
    const duelShareURL = duelRoomId ? `${window.location.origin}/duel/${duelRoomId}` : null;
    return (
    <div style={{
      minHeight:"100dvh",
      background:"radial-gradient(ellipse 100% 60% at 50% 30%, rgba(232,197,71,0.08), transparent 60%), #04060f",
      display:"flex",flexDirection:"column",alignItems:"center",
      padding:"max(28px,env(safe-area-inset-top)) 20px max(28px,env(safe-area-inset-bottom))",
      color:"#e8e6e1",fontFamily:"'Segoe UI',system-ui,sans-serif",
      position:"relative",overflow:"hidden"
    }}>
      <Particles/>
      {iWon && !duelIsTie && <Confetti/>}
      <div style={{width:"100%",maxWidth:440,position:"relative",zIndex:1}}>

        {/* HERO */}
        <div style={{textAlign:"center",marginBottom:24,animation:"result-heroIn 0.8s cubic-bezier(0.34,1.56,0.64,1)"}}>
          <div style={{fontSize:56,marginBottom:8,filter:"drop-shadow(0 0 20px rgba(232,197,71,0.4))"}}>
            {duelGlyph}
          </div>
          <div style={{fontSize:11,letterSpacing:6,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",marginBottom:8,fontWeight:500}}>
            {duelVerdict}
          </div>
          <div style={{
            fontFamily:"Georgia,serif",
            fontSize:"clamp(28px,7.5vw,42px)",
            fontWeight:900,letterSpacing:-1,lineHeight:1.1,
            background: duelIsTie
              ? "linear-gradient(135deg,#e8c547,#f0d878,#e8c547)"
              : iWon
                ? "linear-gradient(135deg,#f0d878,#e8c547,#fff,#e8c547)"
                : "linear-gradient(135deg,#f43f5e,#a78bfa)",
            backgroundSize:"200% auto",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
            animation:"g-shimmer 3s linear infinite",
            marginBottom:14
          }}>
            {duelHeroText}
          </div>
          <div style={{
            fontFamily:"Georgia,serif",
            fontSize:"clamp(48px,14vw,76px)",
            fontWeight:900,lineHeight:1,
            color:"#e8c547",
            textShadow:"0 0 40px rgba(232,197,71,0.3)",
            marginBottom:6
          }}>
            {myScore}
          </div>
          <div style={{fontSize:11,letterSpacing:4,color:"rgba(255,255,255,0.3)",textTransform:"uppercase"}}>
            {t("duel_result.your_points")}
          </div>
        </div>

        {/* PLAYER COMPARISON */}
        <div style={{marginBottom:18,animation:"g-fadeUp 0.6s 0.3s both"}}>
          {Object.values(duelPlayers).map((p)=>(
            <div key={p.id} style={{
              display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"14px 18px",marginBottom:8,
              background: p.id===duelWinner?"rgba(232,197,71,.1)":"rgba(255,255,255,.03)",
              border: p.id===duelWinner?"1px solid rgba(232,197,71,.3)":"1px solid rgba(255,255,255,.07)",
              borderRadius:12,
            }}>
              <div style={{fontWeight:700,fontSize:15}}>{p.id===myDuelId?t("duel_lobby.you"):p.name}</div>
              <div style={{fontFamily:"Georgia,serif",fontSize:28,fontWeight:900,
                color:p.id===duelWinner?"#e8c547":"rgba(255,255,255,.5)"}}>
                {duelScores[p.id]||0}
              </div>
            </div>
          ))}
        </div>

        {/* PRIMARY CTA */}
        <button onClick={()=>{
          if (duelSocketRef.current?.readyState === 1) {
            setDuelScores({});
            setDuelWinner(null);
            setDuelIsTie(false);
            setDuelSelection(null);
            duelAnswerSentRef.current = false;
            duelSocketRef.current.send(JSON.stringify({ type: "new_game" }));
          } else {
            duelSocketRef.current?.close();
            setDuelScreen(null);
            setDuelPlayers({});
            setDuelScores({});
            setDuelWinner(null);
            setDuelIsTie(false);
            setDuelConnectionState("idle"); setDuelRetryAttempt(0);
          }
        }} style={{
          width:"100%",minHeight:60,padding:18,
          fontSize:"clamp(14px,4vw,16px)",fontWeight:700,letterSpacing:2,textTransform:"uppercase",
          background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#120c08",
          border:"none",borderRadius:16,cursor:"pointer",fontFamily:"inherit",
          boxShadow:"0 0 50px rgba(232,197,71,0.25), 0 8px 24px rgba(232,197,71,0.12)",
          marginBottom:10,position:"relative",overflow:"hidden",
          animation:"g-fadeUp 0.5s 0.4s both"
        }}>
          <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
          <span style={{position:"relative"}}>{t("result.play_again")}</span>
        </button>

        {/* SECONDARY */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:18,animation:"g-fadeUp 0.5s 0.5s both"}}>
          <button
            onClick={()=>{
              if (!duelShareURL) return;
              if (navigator.share) {
                navigator.share({
                  title:"BLUFF™ Duel",
                  text: iWon
                    ? `Won a BLUFF duel ${myScore}-${duelScores[duelWinner===myDuelId?Object.keys(duelPlayers).find(k=>k!==myDuelId):duelWinner]||0}. Who's next? ⚔️`
                    : "Think you can deceive better? Jump in this duel room.",
                  url: duelShareURL,
                }).catch(()=>{
                  navigator.clipboard?.writeText(duelShareURL);
                  alert(t("duel_lobby.link_copied"));
                });
              } else {
                navigator.clipboard?.writeText(duelShareURL);
                alert(t("duel_lobby.link_copied"));
              }
            }}
            disabled={!duelShareURL}
            style={{minHeight:52,padding:14,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase",
              background:"rgba(34,211,238,0.08)",color:"#22d3ee",border:"1px solid rgba(34,211,238,0.3)",
              borderRadius:12,cursor:duelShareURL?"pointer":"not-allowed",opacity:duelShareURL?1:0.5,fontFamily:"inherit"}}>
            {t("duel_result.invite_another")}
          </button>
          <button
            onClick={()=>{
              const text = iWon
                ? `Won a BLUFF duel ${myScore} points! Can you deceive better? 🎭 playbluff.games`
                : `Got BLUFFED ${myScore} points. Think you can do better? 🎭 playbluff.games`;
              if (navigator.share) navigator.share({ text, url:"https://playbluff.games" }).catch(()=>navigator.clipboard?.writeText(text));
              else navigator.clipboard?.writeText(text).then(()=>alert("Copied!")).catch(()=>alert(text));
            }}
            style={{minHeight:52,padding:14,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase",
              background:"linear-gradient(135deg,rgba(131,58,180,0.2),rgba(253,29,29,0.15),rgba(252,176,69,0.2))",
              color:"#fff",border:"1px solid rgba(255,255,255,0.15)",
              borderRadius:12,cursor:"pointer",fontFamily:"inherit"}}>
            {t("duel_result.share_result")}
          </button>
        </div>

        {/* TERTIARY HOME */}
        <div style={{textAlign:"center",marginTop:8,animation:"g-fadeUp .5s .7s both"}}>
          <button onClick={()=>{
            duelSocketRef.current?.close();
            setDuelScreen(null);
            setDuelPlayers({});
            setDuelScores({});
            setDuelWinner(null);
            setDuelIsTie(false);
            setDuelConnectionState("idle"); setDuelRetryAttempt(0);
          }} style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.3)",
            fontSize:12,letterSpacing:2,textTransform:"uppercase",
            cursor:"pointer",fontFamily:"inherit",padding:"8px 16px"}}>
            {t("duel_result.home")}
          </button>
        </div>
      </div>
      <GameStyles/>
    </div>
    );
  }

  // ─── HOME ──────────────────────────────────────────────────
  if(screen==="home") {
  const settingButtonStyle = {
    flex:1, minHeight:36, padding:"8px 4px",
    background:"transparent", border:"none", cursor:"pointer",
    color:"#5a5a68", fontSize:11, letterSpacing:1,
    textTransform:"uppercase", fontFamily:"inherit",
    display:"flex", alignItems:"center", justifyContent:"center", gap:4,
    transition:"color 0.2s",
  };
  const newBadgeStyle = {
    display:"inline-block", width:6, height:6, borderRadius:"50%",
    background:"#e8c547", marginLeft:4,
  };

  if (showPaywall) {
    return (
      <PaywallScreen
        reason={paywallReason}
        slotsRemaining={earlyAdopterSlotsRemaining}
        lang={lang}
        onClose={()=>setShowPaywall(false)}
      />
    );
  }

  return (
    <div style={wrap}>
      <Particles/>
      <div style={{
        position:"fixed",inset:0,pointerEvents:"none",zIndex:0,
        background:"radial-gradient(ellipse 80% 50% at 50% 0%, rgba(232,197,71,0.05), transparent 70%), radial-gradient(ellipse 60% 40% at 50% 100%, rgba(34,211,238,0.03), transparent 70%)"
      }}/>
      {authDebugOpen && (
        <div style={{
          position:"fixed",top:"max(56px,env(safe-area-inset-top))",left:8,right:8,zIndex:9999,
          maxHeight:"60vh",overflow:"auto",
          background:"rgba(4,6,15,0.96)",border:"1px solid rgba(45,212,160,0.4)",borderRadius:10,
          padding:"10px 12px",fontFamily:"ui-monospace,monospace",fontSize:10,color:"#d7e3ec",
          boxShadow:"0 8px 24px rgba(0,0,0,0.5)"
        }}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
            <span style={{color:"#2dd4a0",fontWeight:700,letterSpacing:"1px"}}>AUTH DEBUG</span>
            <button onClick={() => setAuthDebugOpen(false)} style={{background:"none",border:"1px solid rgba(215,227,236,0.3)",color:"#d7e3ec",fontFamily:"inherit",fontSize:10,padding:"2px 8px",borderRadius:4,cursor:"pointer"}}>close</button>
          </div>
          {authDebugLines.length === 0 && <div style={{opacity:.6}}>no events yet</div>}
          {authDebugLines.map((ln, i) => (
            <div key={i} style={{marginBottom:8,paddingBottom:6,borderBottom:"1px dashed rgba(215,227,236,0.1)"}}>
              <div style={{color:"#e8c547",fontWeight:700}}>[{ln.label}] +{i === 0 ? 0 : (ln.t - authDebugLines[0].t)}ms</div>
              <pre style={{margin:"4px 0 0 0",whiteSpace:"pre-wrap",wordBreak:"break-all",color:"#a9b8c2"}}>{JSON.stringify(ln.obj, null, 2)}</pre>
            </div>
          ))}
          <button
            onClick={() => authStorageSnapshot().then((s) => setAuthDebugLines((lines) => [...lines, { t: Date.now(), label: "manual", obj: s }]))}
            style={{marginTop:6,background:"rgba(45,212,160,0.15)",border:"1px solid rgba(45,212,160,0.4)",color:"#2dd4a0",fontFamily:"inherit",fontSize:10,padding:"4px 10px",borderRadius:4,cursor:"pointer"}}
          >refresh snapshot</button>
        </div>
      )}
      {BETA_MODE&&<div style={{position:"fixed",top:"max(12px,env(safe-area-inset-top))",right:16,fontSize:10,letterSpacing:"2px",color:"rgba(45,212,160,.75)",background:"rgba(45,212,160,.09)",border:"1px solid rgba(45,212,160,.22)",padding:"4px 10px",borderRadius:20,fontWeight:600,zIndex:10}}>β BETA</div>}
      {/* SWEAR balance chip — opens SWEAR Card */}
      <button
        onClick={() => setShowSwearCard(true)}
        style={{
          position:"fixed",top:"max(10px,env(safe-area-inset-top))",left:12,zIndex:11,
          display:"flex",alignItems:"center",gap:6,
          padding:"5px 11px",borderRadius:999,
          background:"linear-gradient(135deg,rgba(232,197,71,.18),rgba(232,197,71,.06))",
          border:"1px solid rgba(232,197,71,.38)",
          color:"#e8c547",fontSize:11,letterSpacing:"1.5px",fontWeight:700,
          textTransform:"uppercase",fontFamily:"inherit",cursor:"pointer",
          boxShadow:"0 2px 12px rgba(232,197,71,.1)",
        }}
        aria-label="Open SWEAR Card"
      >
        <span style={{
          display:"inline-flex",alignItems:"center",justifyContent:"center",
          width:16,height:16,borderRadius:999,
          background:"linear-gradient(135deg,#f0d878,#d4a830)",
          color:"#04060f",fontSize:10,fontWeight:900,
        }}>Ⓢ</span>
        <span>{swearBalance.toLocaleString("en-US")}</span>
        {!authUser && (
          <span style={{
            marginLeft:4,padding:"1px 6px",borderRadius:6,
            background:"rgba(244,63,94,.14)",color:"#f43f5e",
            fontSize:8,letterSpacing:"1px",fontWeight:700,textTransform:"uppercase",
            border:"1px solid rgba(244,63,94,.3)",
          }}>
            {t("auth.anon_badge", lang)}
          </span>
        )}
      </button>
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:460,padding:"clamp(14px,4vw,22px)",paddingTop:"max(52px,env(safe-area-inset-top))"}}>
        {/* 1. LOGO */}
        <div style={{textAlign:"center",marginBottom:18,animation:"g-fadeUp .5s ease both"}}>
          <div style={{fontSize:10,letterSpacing:"5px",color:T.dim,marginBottom:10,fontWeight:500}}>SIAL GAMES</div>
          <h1 style={{fontFamily:"Georgia,serif",fontSize:"clamp(44px,11vw,64px)",fontWeight:900,letterSpacing:-2,margin:"0 0 4px",lineHeight:1,background:"linear-gradient(135deg,#e8c547,#f0d878,rgba(255,255,255,.5),#e8c547)",backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"g-shimmer 4s linear infinite",filter:"drop-shadow(0 0 22px rgba(232,197,71,.18))"}}>
            BLUFF<sup style={{fontSize:"clamp(10px,2vw,12px)",WebkitTextFillColor:"rgba(232,197,71,.5)",position:"relative",top:"clamp(-18px,-4vw,-24px)",marginLeft:2,fontFamily:"system-ui",fontWeight:400}}>™</sup>
          </h1>
          <p style={{fontSize:11,letterSpacing:"3px",color:T.dim,textTransform:"uppercase",margin:0,fontWeight:500}}>{t("home.tagline")}</p>
        </div>

        {/* 2. EVENT BANNERS — urgent items stay high */}
        {challenge && (
          <div style={{
            background:"rgba(232,197,71,.08)",border:"1px solid rgba(232,197,71,.3)",
            borderRadius:14,padding:"14px 16px",marginBottom:12,animation:"g-fadeUp .4s ease both",
          }}>
            <div style={{fontSize:10,letterSpacing:"3px",color:"#e8c547",fontWeight:700,marginBottom:6,textTransform:"uppercase"}}>
              ⚔️ {t("home.challenge_received")}
            </div>
            <div style={{fontSize:"clamp(13px,3.5vw,15px)",color:"#e8e6e1",marginBottom:8}}>
              Your friend scored{" "}
              <span style={{color:"#e8c547",fontWeight:700,fontFamily:"Georgia,serif",fontSize:18}}>
                {challenge.s}/{challenge.t}
              </span>
              {" "}({challenge.t?Math.round(challenge.s/challenge.t*100):0}% accuracy).
              <br/>
              <span style={{opacity:.7}}>Can you beat them?</span>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{setChallenge(null);tryStartSoloGame();}}
                style={{flex:2,minHeight:44,padding:"10px 14px",fontSize:13,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#04060f",borderRadius:10,fontFamily:"inherit",cursor:"pointer",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
                <span style={{position:"relative"}}>{t("home.accept_challenge")}</span>
              </button>
              <button onClick={()=>setChallenge(null)}
                style={{flex:1,minHeight:44,padding:"10px",fontSize:13,fontWeight:600,background:"transparent",color:"#5a5a68",border:"1px solid rgba(255,255,255,.07)",borderRadius:10,fontFamily:"inherit",cursor:"pointer"}}>
                {t("home.dismiss")}
              </button>
            </div>
          </div>
        )}

        {slayerEvent?.isOpen && (
          <div style={{
            background:"linear-gradient(135deg,rgba(244,63,94,.12),rgba(251,146,60,.08))",
            border:"1px solid rgba(244,63,94,.4)",borderRadius:16,
            padding:"16px",marginBottom:12,position:"relative",overflow:"hidden",
          }}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:2,
              background:"linear-gradient(90deg,#f43f5e,#fb923c,#f43f5e)",
              animation:"g-btnShimmer 2s infinite"}}/>
            <div style={{fontSize:10,letterSpacing:"3px",color:"#f43f5e",fontWeight:700,marginBottom:4}}>
              ⚡ AXIOM SLAYER EVENT — OPEN
            </div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.7)",marginBottom:10}}>
              {slayerEvent.entrantCount} challengers · Prize pool: €{slayerEvent.pool}
            </div>
            {slayerEntered ? (
              <div style={{fontSize:12,color:"#2dd4a0",fontWeight:600}}>✓ You're in — play to win</div>
            ) : (
              <button onClick={()=>{
                fetch("/api/slayer-event",{
                  method:"POST",
                  headers:{"Content-Type":"application/json"},
                  body:JSON.stringify({action:"enter",userId:localStorage.getItem("bluff_user_id")}),
                }).then(r=>r.json()).then(d=>{if(d.url)window.location.href=d.url;}).catch(()=>{});
              }}
                style={{width:"100%",padding:"12px",fontSize:13,fontWeight:700,
                  background:"linear-gradient(135deg,#f43f5e,#d4294a)",color:"#fff",
                  border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit",letterSpacing:"1px"}}>
                ⚡ Enter for €0.99
              </button>
            )}
          </div>
        )}

        {/* 3. AXIOM TEASER — feature panel */}
        <div style={{
          background:"linear-gradient(135deg, rgba(34,211,238,0.08) 0%, rgba(232,197,71,0.06) 50%, rgba(244,63,94,0.04) 100%)",
          border:"1px solid rgba(232,197,71,0.2)",
          borderRadius:16,padding:"16px 18px",marginBottom:16,
          display:"flex",alignItems:"center",gap:14,
          boxShadow:"0 0 40px rgba(232,197,71,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
          position:"relative",overflow:"hidden",
          animation:"g-fadeUp .5s .1s both"
        }}>
          <div style={{
            position:"absolute",inset:0,pointerEvents:"none",
            background:"linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%)",
            animation:"home-shimmer 6s ease-in-out infinite"
          }}/>
          <AxiomFace mood={axiomMood} size={52}/>
          <div style={{flex:1,minWidth:0,position:"relative"}}>
            <div style={{fontSize:10,letterSpacing:"2px",color:"#22d3ee",
                         textTransform:"uppercase",fontWeight:600,marginBottom:2}}>
              AXIOM
            </div>
            <div style={{fontSize:13,color:"#e8e6e1",lineHeight:1.3,
                         overflow:"hidden",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",
                         fontStyle:"italic",opacity:axiomLoading?.5:1}}>
              {axiomLoading ? "..." : (axiomSpeech || "Ready when you are.")}
            </div>
          </div>
        </div>

        {/* 4. FREE GAMES / PRO BADGE */}
        {isPro ? (
          <div style={{
            textAlign:"center",marginBottom:10,padding:"8px 14px",
            background:isEarlyAdopter
              ? "linear-gradient(135deg,rgba(232,197,71,.14),rgba(232,197,71,.05))"
              : "linear-gradient(135deg,rgba(45,212,160,.12),rgba(45,212,160,.04))",
            border:isEarlyAdopter?"1px solid rgba(232,197,71,.35)":"1px solid rgba(45,212,160,.3)",
            borderRadius:10,fontSize:11,letterSpacing:"2px",fontWeight:700,
            color:isEarlyAdopter?"#e8c547":"#2dd4a0",textTransform:"uppercase",
            animation:"g-fadeUp .5s .18s both",
          }}>
            {isEarlyAdopter ? t("home.early_adopter_badge") : t("home.pro_badge")}
          </div>
        ) : (
          <div style={{
            display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,
            marginBottom:10,padding:"8px 12px",
            background:freeGamesRemaining>0?"rgba(255,255,255,.03)":"rgba(244,63,94,.06)",
            border:freeGamesRemaining>0?"1px solid rgba(255,255,255,.08)":"1px solid rgba(244,63,94,.25)",
            borderRadius:10,fontSize:11,letterSpacing:"1.5px",
            color:freeGamesRemaining>0?"rgba(232,230,225,.75)":"#f43f5e",
            textTransform:"uppercase",fontWeight:600,
            animation:"g-fadeUp .5s .18s both",
          }}>
            <span>{freeGamesRemaining>0 ? t("home.free_games_today", { n: freeGamesRemaining }) : t("home.daily_limit_reached")}</span>
            <button onClick={()=>{setPaywallReason(freeGamesRemaining>0?"daily_limit":"daily_limit");setShowPaywall(true);}} style={{
              background:"transparent",border:"none",color:"#e8c547",
              fontSize:11,letterSpacing:"1.5px",fontWeight:700,
              cursor:"pointer",fontFamily:"inherit",padding:0,textTransform:"uppercase",
            }}>{t("home.go_pro")}</button>
          </div>
        )}

        {/* 4a. DAILY WARM-UP button removed — Warm-up is now Mini-game 1 inside CLIMB. */}

        {/* 4. PRIMARY CTA */}
        {(() => {
          const warmupDone = (swearProfile?.dailyWarmup?.todayCompletedDate || null) === todayLocalDateStr();
          const gated = WARMUP_HARD_GATE && !warmupDone;
          return (
            <button onClick={() => {
                userInteractedRef.current = true;
                const silent = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARAAAAAgABAAIAZGF0YQQAAAAAAA==");
                silent.play().catch(()=>{});
                if (gated) { startSwipe(); return; }
                tryStartSoloGame();
              }}
              style={{width:"100%",minHeight:64,padding:"18px",fontSize:"clamp(14px,4vw,17px)",fontWeight:700,letterSpacing:"3px",textTransform:"uppercase",
                background: gated
                  ? "linear-gradient(135deg,rgba(232,197,71,.25),rgba(212,168,48,.15))"
                  : "linear-gradient(135deg,#e8c547,#d4a830)",
                color: gated ? "rgba(232,197,71,.7)" : T.bg,
                borderRadius:16,position:"relative",overflow:"hidden",
                boxShadow: gated
                  ? "0 0 20px rgba(232,197,71,0.08)"
                  : "0 0 60px rgba(232,197,71,0.25), 0 8px 24px rgba(232,197,71,0.15), inset 0 1px 0 rgba(255,255,255,0.2)",
                animation:"g-fadeUp .5s .2s both",transition:"transform .15s",marginBottom:10,
                border: gated ? "1px dashed rgba(232,197,71,.4)" : "none",
                cursor:"pointer",
              }}
              onMouseDown={e=>e.currentTarget.style.transform="scale(.97)"} onMouseUp={e=>e.currentTarget.style.transform=""}
              onTouchStart={e=>e.currentTarget.style.transform="scale(.97)"} onTouchEnd={e=>e.currentTarget.style.transform=""}>
              {!gated && <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)",animation:"g-btnShimmer 3s infinite"}}/>}
              <span style={{position:"relative"}}>
                {gated ? `🔒 ${t("swipe.unlock_climb_cta")}` : (total>0?t("home.cta_challenge_again"):t("home.cta_challenge"))}
              </span>
            </button>
          );
        })()}

        {/* 5. SECONDARY MODES — Blitz + Duel side-by-side */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8,animation:"g-fadeUp .5s .28s both"}}>
          <button onClick={tryStartBlitz} style={{
            minHeight:48,padding:12,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase",
            background:"linear-gradient(135deg,rgba(244,63,94,.15),rgba(244,63,94,.05))",
            color:"#f43f5e",border:"1px solid rgba(244,63,94,.3)",
            borderRadius:12,cursor:"pointer",fontFamily:"inherit"
          }}>
            {t("home.cta_blitz")}
          </button>
          <button onClick={()=>setDuelScreen("mode-select")} style={{
            minHeight:48,padding:12,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase",
            background:"rgba(232,197,71,.06)",color:"#e8c547",
            border:"1px solid rgba(232,197,71,.3)",borderRadius:12,
            cursor:"pointer",fontFamily:"inherit"
          }}>
            {t("home.cta_duel")}
          </button>
        </div>
        {/* 5b. SIDE MODES (Shifter + Numbers) removed — both are now mini-games inside CLIMB. */}

        {/* 6. STATS — only if played */}
        {total>0&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8,marginBottom:14,animation:"g-fadeUp .5s .35s both"}}>
            {[[score.toLocaleString('en-US'),"Points",T.gold],[best+"🔥","Streak","#a78bfa"]].map(([v,l,c])=>(
              <div key={l} style={{background:T.glass,borderRadius:12,border:`1px solid ${T.gb}`,padding:"clamp(10px,3vw,14px) 6px",textAlign:"center"}}>
                <div style={{fontSize:"clamp(20px,6vw,28px)",fontWeight:800,color:c,fontFamily:"Georgia,serif"}}>{v}</div>
                <div style={{fontSize:9,color:T.dim,letterSpacing:"1px",textTransform:"uppercase",marginTop:3}}>{l}</div>
              </div>
            ))}
          </div>
        )}

        {/* 7. AXIOM POWER — compact */}
        {axiomPower !== null && !Number.isNaN(axiomPower) && (
          <div style={{
            background:"rgba(4,6,15,.6)",border:"1px solid rgba(34,211,238,.15)",
            borderRadius:10,padding:"10px 14px",marginBottom:14
          }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
              <div style={{fontSize:9,letterSpacing:"2px",color:"rgba(34,211,238,.6)",fontWeight:700}}>
                {t("home.axiom_power")}
              </div>
              <div style={{fontSize:11,fontWeight:700,
                color:axiomPower<200?"#f43f5e":axiomPower<500?"#fb923c":"#22d3ee"}}>
                {Math.round(axiomPower)}/1000
              </div>
            </div>
            <div style={{height:4,background:"rgba(255,255,255,.06)",borderRadius:2,overflow:"hidden"}}>
              <div style={{height:"100%",transition:"width 1s ease",
                width:`${(axiomPower/1000)*100}%`,
                background:axiomPower<200
                  ?"linear-gradient(90deg,#f43f5e,#fb923c)"
                  :axiomPower<500
                  ?"linear-gradient(90deg,#fb923c,#e8c547)"
                  :"linear-gradient(90deg,#22d3ee,#0891b2)"
              }}/>
            </div>
          </div>
        )}

        {/* 8. SETTINGS ROW */}
        <div style={{
          display:"flex",gap:6,padding:"10px 0",marginTop:8,
          borderTop:"1px solid rgba(255,255,255,.05)"
        }}>
          <button onClick={()=>setShowLangModal(true)} style={settingButtonStyle}>
            🌐 {(lang||"en").toUpperCase()}
          </button>
          <button onClick={()=>{
            const next=!voiceEnabled;
            setVoiceEnabled(next);
            safeLSSet("bluff_voice", next?"on":"off");
            if(!next && audioRef.current){
              audioRef.current.pause();
              isPlayingRef.current=false;
              audioQueueRef.current=[];
            }
          }} style={settingButtonStyle}>
            {voiceEnabled?t("home.voice_on"):t("home.voice_off")}
          </button>
          <button onClick={()=>setShowShop(true)} style={settingButtonStyle}>
            {t("home.skins")}
            {ownedSkins.length<=1 && <span style={newBadgeStyle}/>}
          </button>
          <button onClick={()=>setShowHowToPlay(true)} style={settingButtonStyle}>
            {t("home.help")}
          </button>
        </div>

        {tg.isInsideTelegram && (
          <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"center",marginTop:10,fontSize:10,color:"rgba(41,182,246,.4)",letterSpacing:"1px"}}>
            <span>✈️</span><span>{t("home.running_in_telegram")}</span>
          </div>
        )}

        <div style={{marginTop:16,textAlign:"center",fontSize:10,color:"rgba(255,255,255,.1)",letterSpacing:"1px"}}>playbluff.games · SIAL Consulting d.o.o.</div>
      </div>

      {showHowToPlay && (
        <div onClick={()=>setShowHowToPlay(false)}
          style={{position:"fixed",inset:0,zIndex:600,background:"rgba(4,6,15,.9)",
            backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
          <div onClick={e=>e.stopPropagation()}
            style={{maxWidth:360,width:"100%",background:"#0c0c14",
              border:"1px solid rgba(232,197,71,.25)",borderRadius:18,
              padding:"24px 22px 22px",position:"relative",
              boxShadow:"0 0 40px rgba(232,197,71,.1)",
              animation:"g-fadeUp .3s ease both"}}>
            <button onClick={()=>setShowHowToPlay(false)}
              style={{position:"absolute",top:10,right:10,width:32,height:32,
                borderRadius:"50%",background:"rgba(255,255,255,.06)",
                border:"1px solid rgba(255,255,255,.1)",color:"#e8e6e1",
                fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
            <div style={{fontSize:11,color:T.gold,letterSpacing:"3px",textTransform:"uppercase",fontWeight:600,marginBottom:16,textAlign:"center"}}>
              {t("home.how_to_play")}
            </div>
            {[t("home.how_to_1"),t("home.how_to_2"),t("home.how_to_3"),t("home.how_to_4")].map((line,i)=>(
              <div key={i} style={{display:"flex",gap:10,marginBottom:i<3?12:0,fontSize:14,lineHeight:1.5}}>
                <span style={{fontSize:18,flexShrink:0}}>{line.slice(0,2)}</span>
                <span style={{opacity:.85,color:"#e8e6e1"}}>{line.slice(3)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showSwearCard && (
        <div onClick={()=>setShowSwearCard(false)}
          style={{
            position:"fixed",inset:0,zIndex:650,
            background:"radial-gradient(ellipse at 50% 30%, #1a1208 0%, #040404 70%)",
            overflowY:"auto",WebkitOverflowScrolling:"touch",
            padding:"40px 20px",
            animation:"g-fadeUp .35s ease both",
          }}>
          <style>{`
            @keyframes sc-particle-float {
              0%   { opacity: 0; transform: translateY(0) translateX(0); }
              15%  { opacity: .6; }
              50%  { opacity: .9; transform: translateY(-80px) translateX(20px); }
              85%  { opacity: .4; }
              100% { opacity: 0; transform: translateY(-160px) translateX(-15px); }
            }
            @keyframes sc-card-breathing {
              0%,100% { box-shadow: 0 30px 80px rgba(0,0,0,.8), 0 10px 30px rgba(232,197,71,.3),
                       inset 0 1px 2px rgba(255,255,255,.25), inset 0 -1px 2px rgba(0,0,0,.35); }
              50%     { box-shadow: 0 30px 100px rgba(0,0,0,.9), 0 15px 40px rgba(232,197,71,.45),
                       inset 0 1px 2px rgba(255,255,255,.3), inset 0 -1px 2px rgba(0,0,0,.4); }
            }
            @keyframes sc-foil-sweep {
              0%,100% { transform: translateX(-30%) translateY(-10%); opacity: 0; }
              40%     { opacity: 1; }
              60%     { opacity: 1; }
              100%    { transform: translateX(30%) translateY(5%); opacity: 0; }
            }
            @keyframes sc-seal-rotate {
              from { transform: rotate(0deg); }
              to   { transform: rotate(360deg); }
            }
            @keyframes sc-seal-pulse {
              0%,100% { opacity: .4; transform: scale(.95); }
              50%     { opacity: 1;  transform: scale(1.08); }
            }
            .sc-particle {
              position: absolute; width: 3px; height: 3px;
              background: #e8c547; border-radius: 50%; opacity: 0;
              animation: sc-particle-float 8s ease-in-out infinite;
              filter: blur(.5px);
            }
            .sc-card {
              position: relative; width: 320px; height: 512px; border-radius: 18px;
              background: linear-gradient(135deg,
                #4a3612 0%, #8a6b28 18%, #d4a943 35%, #f0d878 48%,
                #e8c547 52%, #d4a943 65%, #8a6b28 82%, #4a3612 100%);
              box-shadow: 0 30px 80px rgba(0,0,0,.8), 0 10px 30px rgba(232,197,71,.3),
                          inset 0 1px 2px rgba(255,255,255,.25), inset 0 -1px 2px rgba(0,0,0,.35);
              overflow: hidden;
              animation: sc-card-breathing 4s ease-in-out infinite;
            }
            .sc-brushed {
              position: absolute; inset: 0;
              background: repeating-linear-gradient(92deg,
                rgba(255,255,255,.04) 0, rgba(255,255,255,.04) .5px,
                transparent .5px, transparent 1.3px,
                rgba(0,0,0,.06) 1.3px, rgba(0,0,0,.06) 1.8px,
                transparent 1.8px, transparent 3px);
              mix-blend-mode: overlay; pointer-events: none;
            }
            .sc-foil {
              position: absolute; top: -40%; left: -60%; width: 220%; height: 180%;
              background: linear-gradient(115deg,
                transparent 35%,
                rgba(255,250,220,.22) 47%, rgba(255,255,255,.4) 50%, rgba(255,250,220,.22) 53%,
                transparent 65%);
              animation: sc-foil-sweep 6s ease-in-out infinite;
              pointer-events: none; mix-blend-mode: screen;
            }
            .sc-engraving { position: absolute; inset: 0; pointer-events: none; opacity: .35; mix-blend-mode: multiply; }
            .sc-vignette  { position: absolute; inset: 0; pointer-events: none;
              background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.35) 100%); }
            .sc-seal-ring { animation: sc-seal-rotate 40s linear infinite; transform-origin: center; position: absolute; inset: 0; }
            .sc-seal-glow {
              position: absolute; inset: -8px; border-radius: 50%;
              background: radial-gradient(circle, rgba(255,220,100,.35) 0%, transparent 60%);
              animation: sc-seal-pulse 3s ease-in-out infinite;
              filter: blur(4px);
            }
            .sc-card-wrap { display: flex; flex-direction: column; align-items: center; gap: 20px; }
            @media (max-width: 500px) {
              .sc-card { transform: scale(.85); transform-origin: top center; }
              .sc-card-wrap { gap: 0; }
              .sc-aux { margin-top: -64px; }
            }
          `}</style>

          <button onClick={()=>setShowSwearCard(false)}
            style={{position:"fixed",top:"max(20px,env(safe-area-inset-top))",right:20,zIndex:652,
              width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,.06)",
              border:"1px solid rgba(255,255,255,.14)",color:"#e8e6e1",
              fontSize:16,cursor:"pointer",fontFamily:"inherit",
              backdropFilter:"blur(6px)",WebkitBackdropFilter:"blur(6px)"}}
            aria-label={t("swear_card.close", lang)}>✕</button>

          <div onClick={e=>e.stopPropagation()} className="sc-card-wrap" style={{maxWidth:360,margin:"0 auto"}}>
            <div style={{position:"relative",width:320,height:512}}>
              {/* 12 floating particles */}
              <div style={{position:"absolute",inset:0,pointerEvents:"none"}}>
                {[
                  {left:"10%",top:"80%",delay:"0s"},{left:"22%",top:"85%",delay:"1.2s"},
                  {left:"35%",top:"90%",delay:"2.5s"},{left:"48%",top:"82%",delay:".7s"},
                  {left:"61%",top:"88%",delay:"3.1s"},{left:"74%",top:"84%",delay:"1.9s"},
                  {left:"87%",top:"90%",delay:"4.2s"},{left:"15%",top:"75%",delay:"2.1s"},
                  {left:"40%",top:"78%",delay:"5s"}, {left:"65%",top:"76%",delay:"3.8s"},
                  {left:"90%",top:"80%",delay:"1.4s"},{left:"5%", top:"70%",delay:"6s"},
                ].map((p,i)=>(
                  <div key={i} className="sc-particle" style={{left:p.left,top:p.top,animationDelay:p.delay}}/>
                ))}
              </div>

              <div className="sc-card">
                {/* Engraving — fine mesh + diamond weave + flourishes + footer */}
                <svg className="sc-engraving" viewBox="0 0 320 512" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
                  <defs>
                    <pattern id="sc-fine-mesh" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
                      <path d="M 0 7 L 14 7 M 7 0 L 7 14" stroke="#4a3015" strokeWidth="0.25" opacity="0.5"/>
                      <circle cx="7" cy="7" r="0.4" fill="#4a3015" opacity="0.6"/>
                    </pattern>
                    <pattern id="sc-diamond-weave" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M 10 0 L 20 10 L 10 20 L 0 10 Z" fill="none" stroke="#4a3015" strokeWidth="0.3" opacity="0.55"/>
                    </pattern>
                  </defs>
                  <rect x="0" y="0" width="320" height="512" fill="url(#sc-fine-mesh)"/>
                  <rect x="8" y="8" width="304" height="496" rx="14" fill="none" stroke="#4a3015" strokeWidth="0.5" opacity="0.5"/>
                  <rect x="12" y="12" width="296" height="488" rx="12" fill="none" stroke="#4a3015" strokeWidth="0.3" opacity="0.4"/>
                  <rect x="22" y="140" width="276" height="232" fill="url(#sc-diamond-weave)"/>
                  <g transform="translate(160, 256)">
                    <circle cx="0" cy="0" r="62" fill="none" stroke="#4a3015" strokeWidth="0.3" opacity="0.4"/>
                    <circle cx="0" cy="0" r="54" fill="none" stroke="#4a3015" strokeWidth="0.3" opacity="0.4"/>
                  </g>
                  <g opacity="0.6">
                    <path d="M 26 90 Q 40 80, 54 90 Q 40 100, 26 90" fill="none" stroke="#4a3015" strokeWidth="0.4"/>
                    <path d="M 266 90 Q 280 80, 294 90 Q 280 100, 266 90" fill="none" stroke="#4a3015" strokeWidth="0.4"/>
                    <path d="M 26 422 Q 40 412, 54 422 Q 40 432, 26 422" fill="none" stroke="#4a3015" strokeWidth="0.4"/>
                    <path d="M 266 422 Q 280 412, 294 422 Q 280 432, 266 422" fill="none" stroke="#4a3015" strokeWidth="0.4"/>
                  </g>
                  <text x="160" y="496" textAnchor="middle" fontFamily="Georgia, serif" fontSize="5.5" letterSpacing="2.5" fill="#3d2a0a" opacity="0.7">
                    {t("swear_card.certified_footer", lang)}
                  </text>
                </svg>

                <div className="sc-brushed"/>
                <div className="sc-foil"/>
                <div className="sc-vignette"/>

                {/* Content */}
                <div style={{position:"relative",height:"100%",padding:"28px 24px",
                  display:"flex",flexDirection:"column",zIndex:2,boxSizing:"border-box"}}>

                  {/* Top: brand + QR */}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                    <div>
                      <div style={{fontFamily:"Georgia,serif",fontSize:10,letterSpacing:4,color:"#3d2a0a",fontWeight:500,textShadow:"0 1px 0 rgba(255,255,255,.25)"}}>SIAL GAMES</div>
                      <div style={{fontFamily:"Georgia,serif",fontSize:8,letterSpacing:2,color:"#3d2a0a",marginTop:2,opacity:.6}}>EST. MMXXVI</div>
                    </div>
                    <div style={{width:46,height:46,borderRadius:4,background:"#f8e8b8",padding:3,
                      boxShadow:"inset 0 1px 1px rgba(255,255,255,.5), 0 1px 3px rgba(0,0,0,.4), 0 0 0 .5px rgba(42,27,3,.4)",
                      boxSizing:"border-box"}}>
                      <svg viewBox="0 0 29 29" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges" style={{width:"100%",height:"100%",display:"block"}}>
                        <rect width="29" height="29" fill="#f8e8b8"/>
                        <g fill="#1a0f00">
                          <rect x="0" y="0" width="7" height="1"/><rect x="0" y="0" width="1" height="7"/>
                          <rect x="6" y="0" width="1" height="7"/><rect x="0" y="6" width="7" height="1"/>
                          <rect x="2" y="2" width="3" height="3"/>
                          <rect x="22" y="0" width="7" height="1"/><rect x="22" y="0" width="1" height="7"/>
                          <rect x="28" y="0" width="1" height="7"/><rect x="22" y="6" width="7" height="1"/>
                          <rect x="24" y="2" width="3" height="3"/>
                          <rect x="0" y="22" width="7" height="1"/><rect x="0" y="22" width="1" height="7"/>
                          <rect x="6" y="22" width="1" height="7"/><rect x="0" y="28" width="7" height="1"/>
                          <rect x="2" y="24" width="3" height="3"/>
                          <rect x="8" y="0" width="1" height="1"/><rect x="10" y="0" width="2" height="1"/><rect x="13" y="0" width="1" height="1"/><rect x="15" y="0" width="1" height="1"/><rect x="17" y="0" width="1" height="1"/><rect x="19" y="0" width="2" height="1"/>
                          <rect x="9" y="1" width="1" height="1"/><rect x="11" y="1" width="1" height="1"/><rect x="14" y="1" width="2" height="1"/><rect x="18" y="1" width="1" height="1"/><rect x="20" y="1" width="1" height="1"/>
                          <rect x="8" y="2" width="2" height="1"/><rect x="12" y="2" width="1" height="1"/><rect x="14" y="2" width="1" height="1"/><rect x="16" y="2" width="1" height="1"/><rect x="18" y="2" width="2" height="1"/>
                          <rect x="9" y="3" width="1" height="1"/><rect x="11" y="3" width="2" height="1"/><rect x="15" y="3" width="1" height="1"/><rect x="17" y="3" width="1" height="1"/><rect x="19" y="3" width="2" height="1"/>
                          <rect x="8" y="4" width="1" height="1"/><rect x="10" y="4" width="1" height="1"/><rect x="13" y="4" width="2" height="1"/><rect x="17" y="4" width="2" height="1"/><rect x="20" y="4" width="1" height="1"/>
                          <rect x="9" y="5" width="2" height="1"/><rect x="12" y="5" width="1" height="1"/><rect x="15" y="5" width="1" height="1"/><rect x="18" y="5" width="1" height="1"/><rect x="20" y="5" width="1" height="1"/>
                          <rect x="8" y="6" width="1" height="1"/><rect x="10" y="6" width="2" height="1"/><rect x="14" y="6" width="1" height="1"/><rect x="16" y="6" width="2" height="1"/><rect x="19" y="6" width="1" height="1"/>
                          <rect x="0" y="8" width="1" height="1"/><rect x="2" y="8" width="2" height="1"/><rect x="5" y="8" width="1" height="1"/><rect x="7" y="8" width="2" height="1"/><rect x="10" y="8" width="1" height="1"/><rect x="12" y="8" width="1" height="1"/><rect x="15" y="8" width="2" height="1"/><rect x="18" y="8" width="1" height="1"/><rect x="20" y="8" width="1" height="1"/><rect x="22" y="8" width="2" height="1"/><rect x="25" y="8" width="1" height="1"/><rect x="27" y="8" width="2" height="1"/>
                          <rect x="1" y="9" width="1" height="1"/><rect x="4" y="9" width="1" height="1"/><rect x="6" y="9" width="2" height="1"/><rect x="9" y="9" width="1" height="1"/><rect x="11" y="9" width="2" height="1"/><rect x="14" y="9" width="1" height="1"/><rect x="16" y="9" width="1" height="1"/><rect x="19" y="9" width="1" height="1"/><rect x="21" y="9" width="1" height="1"/><rect x="24" y="9" width="2" height="1"/><rect x="27" y="9" width="1" height="1"/>
                          <rect x="0" y="10" width="2" height="1"/><rect x="3" y="10" width="1" height="1"/><rect x="5" y="10" width="2" height="1"/><rect x="8" y="10" width="1" height="1"/><rect x="10" y="10" width="2" height="1"/><rect x="13" y="10" width="1" height="1"/><rect x="15" y="10" width="1" height="1"/><rect x="17" y="10" width="2" height="1"/><rect x="20" y="10" width="1" height="1"/><rect x="22" y="10" width="2" height="1"/><rect x="25" y="10" width="1" height="1"/><rect x="28" y="10" width="1" height="1"/>
                          <rect x="2" y="11" width="1" height="1"/><rect x="4" y="11" width="2" height="1"/><rect x="7" y="11" width="1" height="1"/><rect x="9" y="11" width="1" height="1"/><rect x="12" y="11" width="2" height="1"/><rect x="15" y="11" width="2" height="1"/><rect x="18" y="11" width="1" height="1"/><rect x="20" y="11" width="2" height="1"/><rect x="23" y="11" width="1" height="1"/><rect x="26" y="11" width="2" height="1"/>
                          <rect x="0" y="12" width="1" height="1"/><rect x="3" y="12" width="2" height="1"/><rect x="6" y="12" width="1" height="1"/><rect x="8" y="12" width="2" height="1"/><rect x="11" y="12" width="1" height="1"/><rect x="14" y="12" width="1" height="1"/><rect x="16" y="12" width="2" height="1"/><rect x="19" y="12" width="2" height="1"/><rect x="22" y="12" width="1" height="1"/><rect x="25" y="12" width="2" height="1"/><rect x="28" y="12" width="1" height="1"/>
                          <rect x="1" y="13" width="2" height="1"/><rect x="4" y="13" width="1" height="1"/><rect x="6" y="13" width="2" height="1"/><rect x="10" y="13" width="2" height="1"/><rect x="13" y="13" width="1" height="1"/><rect x="15" y="13" width="1" height="1"/><rect x="18" y="13" width="2" height="1"/><rect x="21" y="13" width="1" height="1"/><rect x="23" y="13" width="2" height="1"/><rect x="26" y="13" width="1" height="1"/>
                          <rect x="0" y="14" width="2" height="1"/><rect x="3" y="14" width="1" height="1"/><rect x="5" y="14" width="1" height="1"/><rect x="7" y="14" width="2" height="1"/><rect x="11" y="14" width="1" height="1"/><rect x="13" y="14" width="2" height="1"/><rect x="16" y="14" width="1" height="1"/><rect x="19" y="14" width="1" height="1"/><rect x="20" y="14" width="2" height="1"/><rect x="24" y="14" width="1" height="1"/><rect x="26" y="14" width="2" height="1"/>
                          <rect x="2" y="15" width="2" height="1"/><rect x="5" y="15" width="1" height="1"/><rect x="8" y="15" width="1" height="1"/><rect x="10" y="15" width="2" height="1"/><rect x="13" y="15" width="1" height="1"/><rect x="15" y="15" width="2" height="1"/><rect x="18" y="15" width="1" height="1"/><rect x="21" y="15" width="2" height="1"/><rect x="25" y="15" width="1" height="1"/><rect x="27" y="15" width="1" height="1"/>
                          <rect x="0" y="16" width="1" height="1"/><rect x="3" y="16" width="2" height="1"/><rect x="6" y="16" width="1" height="1"/><rect x="8" y="16" width="2" height="1"/><rect x="12" y="16" width="2" height="1"/><rect x="15" y="16" width="1" height="1"/><rect x="17" y="16" width="1" height="1"/><rect x="19" y="16" width="2" height="1"/><rect x="22" y="16" width="1" height="1"/><rect x="24" y="16" width="2" height="1"/><rect x="28" y="16" width="1" height="1"/>
                          <rect x="1" y="17" width="1" height="1"/><rect x="4" y="17" width="1" height="1"/><rect x="6" y="17" width="2" height="1"/><rect x="9" y="17" width="2" height="1"/><rect x="12" y="17" width="1" height="1"/><rect x="14" y="17" width="2" height="1"/><rect x="17" y="17" width="1" height="1"/><rect x="20" y="17" width="1" height="1"/><rect x="22" y="17" width="2" height="1"/><rect x="26" y="17" width="1" height="1"/><rect x="28" y="17" width="1" height="1"/>
                          <rect x="0" y="18" width="2" height="1"/><rect x="3" y="18" width="1" height="1"/><rect x="5" y="18" width="1" height="1"/><rect x="8" y="18" width="2" height="1"/><rect x="11" y="18" width="1" height="1"/><rect x="13" y="18" width="1" height="1"/><rect x="16" y="18" width="2" height="1"/><rect x="19" y="18" width="1" height="1"/><rect x="21" y="18" width="1" height="1"/><rect x="23" y="18" width="2" height="1"/><rect x="26" y="18" width="2" height="1"/>
                          <rect x="2" y="19" width="1" height="1"/><rect x="4" y="19" width="2" height="1"/><rect x="7" y="19" width="1" height="1"/><rect x="10" y="19" width="1" height="1"/><rect x="12" y="19" width="2" height="1"/><rect x="15" y="19" width="1" height="1"/><rect x="17" y="19" width="2" height="1"/><rect x="20" y="19" width="2" height="1"/><rect x="24" y="19" width="1" height="1"/><rect x="26" y="19" width="1" height="1"/><rect x="28" y="19" width="1" height="1"/>
                          <rect x="0" y="20" width="1" height="1"/><rect x="3" y="20" width="2" height="1"/><rect x="6" y="20" width="1" height="1"/><rect x="9" y="20" width="2" height="1"/><rect x="13" y="20" width="1" height="1"/><rect x="16" y="20" width="1" height="1"/><rect x="18" y="20" width="2" height="1"/><rect x="21" y="20" width="1" height="1"/><rect x="23" y="20" width="1" height="1"/><rect x="25" y="20" width="2" height="1"/><rect x="28" y="20" width="1" height="1"/>
                          <rect x="8" y="22" width="2" height="1"/><rect x="11" y="22" width="1" height="1"/><rect x="14" y="22" width="1" height="1"/><rect x="16" y="22" width="2" height="1"/><rect x="19" y="22" width="2" height="1"/><rect x="22" y="22" width="1" height="1"/><rect x="24" y="22" width="2" height="1"/><rect x="27" y="22" width="1" height="1"/>
                          <rect x="8" y="23" width="1" height="1"/><rect x="10" y="23" width="1" height="1"/><rect x="12" y="23" width="2" height="1"/><rect x="15" y="23" width="1" height="1"/><rect x="17" y="23" width="1" height="1"/><rect x="19" y="23" width="1" height="1"/><rect x="21" y="23" width="1" height="1"/><rect x="23" y="23" width="2" height="1"/><rect x="27" y="23" width="2" height="1"/>
                          <rect x="8" y="24" width="2" height="1"/><rect x="11" y="24" width="2" height="1"/><rect x="14" y="24" width="1" height="1"/><rect x="16" y="24" width="1" height="1"/><rect x="18" y="24" width="2" height="1"/><rect x="21" y="24" width="2" height="1"/><rect x="24" y="24" width="1" height="1"/><rect x="26" y="24" width="2" height="1"/>
                          <rect x="9" y="25" width="1" height="1"/><rect x="12" y="25" width="1" height="1"/><rect x="14" y="25" width="2" height="1"/><rect x="17" y="25" width="2" height="1"/><rect x="20" y="25" width="1" height="1"/><rect x="22" y="25" width="1" height="1"/><rect x="25" y="25" width="1" height="1"/><rect x="27" y="25" width="1" height="1"/>
                          <rect x="8" y="26" width="1" height="1"/><rect x="10" y="26" width="2" height="1"/><rect x="13" y="26" width="2" height="1"/><rect x="16" y="26" width="1" height="1"/><rect x="18" y="26" width="1" height="1"/><rect x="20" y="26" width="2" height="1"/><rect x="23" y="26" width="1" height="1"/><rect x="25" y="26" width="2" height="1"/><rect x="28" y="26" width="1" height="1"/>
                          <rect x="9" y="27" width="1" height="1"/><rect x="11" y="27" width="1" height="1"/><rect x="13" y="27" width="1" height="1"/><rect x="15" y="27" width="2" height="1"/><rect x="18" y="27" width="2" height="1"/><rect x="21" y="27" width="2" height="1"/><rect x="24" y="27" width="1" height="1"/><rect x="26" y="27" width="1" height="1"/>
                          <rect x="8" y="28" width="2" height="1"/><rect x="12" y="28" width="1" height="1"/><rect x="14" y="28" width="2" height="1"/><rect x="17" y="28" width="1" height="1"/><rect x="19" y="28" width="1" height="1"/><rect x="21" y="28" width="1" height="1"/><rect x="23" y="28" width="2" height="1"/><rect x="27" y="28" width="2" height="1"/>
                        </g>
                      </svg>
                    </div>
                  </div>

                  {/* Title block */}
                  <div style={{margin:"40px 0 6px 0",textAlign:"center"}}>
                    <h1 style={{fontFamily:"Georgia, 'Times New Roman', serif",fontSize:40,fontWeight:900,
                      letterSpacing:8,color:"#2a1b03",margin:0,lineHeight:1,
                      textShadow:"0 1px 0 rgba(255,240,180,.5), 0 -1px 0 rgba(0,0,0,.3)"}}>SWEAR</h1>
                    <div style={{fontFamily:"Georgia,serif",fontSize:9,letterSpacing:5,color:"#3d2a0a",
                      margin:"6px 0 0",fontStyle:"italic",opacity:.7}}>
                      {t("swear_card.reserve_member", lang)}
                    </div>
                  </div>

                  {/* Rotating Ⓢ seal */}
                  <div style={{display:"flex",justifyContent:"center",margin:"28px 0 20px"}}>
                    <div style={{width:100,height:100,position:"relative"}}>
                      <div className="sc-seal-glow"/>
                      <svg className="sc-seal-ring" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                          <path id="sc-seal-arc" d="M 50,50 m -42,0 a 42,42 0 1,1 84,0 a 42,42 0 1,1 -84,0"/>
                        </defs>
                        <text fontFamily="Georgia, serif" fontSize="6" letterSpacing="3" fill="#2a1b03" fontWeight="700">
                          <textPath href="#sc-seal-arc">⋆ SWEAR ⋅ THE OATH CURRENCY ⋅ SINCE 2026 ⋆</textPath>
                        </text>
                      </svg>
                      <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style={{position:"absolute",inset:0}}>
                        <defs>
                          <radialGradient id="sc-seal-fill">
                            <stop offset="0%"  stopColor="#f8e58a"/>
                            <stop offset="60%" stopColor="#d4a943"/>
                            <stop offset="100%" stopColor="#8a6b28"/>
                          </radialGradient>
                        </defs>
                        <circle cx="50" cy="50" r="30" fill="none" stroke="#2a1b03" strokeWidth="0.8" opacity="0.7"/>
                        <circle cx="50" cy="50" r="27" fill="none" stroke="#2a1b03" strokeWidth="0.3" opacity="0.5"/>
                        <circle cx="50" cy="50" r="24" fill="url(#sc-seal-fill)"/>
                        <text x="50" y="60" textAnchor="middle" fontFamily="Georgia, serif" fontSize="32" fontWeight="900" fill="#1a0f00">Ⓢ</text>
                      </svg>
                    </div>
                  </div>

                  {/* Balance + handle + tier badge */}
                  <div style={{marginTop:"auto",textAlign:"left"}}>
                    <p style={{fontFamily:"Georgia,serif",fontSize:8,letterSpacing:4,color:"#3d2a0a",margin:"0 0 4px",opacity:.7}}>
                      {t("swear_card.balance_label", lang)}
                    </p>
                    <div style={{display:"flex",alignItems:"baseline"}}>
                      <span style={{fontFamily:"Georgia, 'Times New Roman', serif",fontSize:48,fontWeight:900,
                        color:"#1a0f00",margin:0,lineHeight:1,letterSpacing:-1,
                        textShadow:"1px 1px 0 rgba(255,245,200,.4), -1px -1px 0 rgba(40,20,0,.4), 0 2px 3px rgba(0,0,0,.15)",
                        fontVariantNumeric:"tabular-nums"}}>
                        {swearBalance.toLocaleString("en-US")}
                      </span>
                      <span style={{fontFamily:"Georgia,serif",fontSize:13,letterSpacing:3,color:"#2a1b03",fontWeight:600,marginLeft:6}}>Ⓢ</span>
                    </div>

                    <div style={{height:1,background:"linear-gradient(90deg, transparent, rgba(42,27,3,.3) 20%, rgba(42,27,3,.3) 80%, transparent)",margin:"12px 0 6px"}}/>

                    <div style={{marginTop:14,display:"flex",justifyContent:"space-between",alignItems:"flex-end",gap:8}}>
                      <div style={{minWidth:0,flex:1}}>
                        <p style={{fontFamily:"Georgia,serif",fontSize:13,color:"#2a1b03",letterSpacing:1.5,
                          fontWeight:700,textTransform:"uppercase",margin:0,
                          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {swearProfile?.handle ? `⋆ ${swearProfile.handle} ⋆` : "—"}
                        </p>
                        <div style={{fontFamily:"Georgia,serif",fontSize:8,letterSpacing:2,color:"#3d2a0a",marginTop:3,opacity:.7}}>
                          {t("swear_card.member_since", lang, { date: formatMonthYear(swearProfile?.createdAt) })}
                        </div>
                      </div>
                      {(() => {
                        const badge = resolveSwearTierBadge(swearProfile, t, lang);
                        if (!badge) return null;
                        return (
                          <div style={{fontFamily:"Georgia,serif",fontSize:7,letterSpacing:2,color:"#2a1b03",
                            padding:"3px 8px",border:"1px solid rgba(42,27,3,.4)",borderRadius:3,
                            background:"rgba(255,245,200,.15)",fontWeight:700,textAlign:"right",whiteSpace:"nowrap"}}>
                            {badge}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Auxiliary UI below the card ── */}
            <div className="sc-aux" style={{width:"100%",maxWidth:340,display:"flex",flexDirection:"column",gap:12}}>
              {/* Handle setter + sign-in/sign-out cluster */}
              {authUser ? (
                <div style={{
                  background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.08)",
                  borderRadius:12,padding:"12px 14px",
                  display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap",
                }}>
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{fontSize:11,color:"#e8e6e1",fontWeight:600,
                      overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {t("auth.signed_in_as", lang, { email: authUser.email || authUser.displayName || authUser.uid.slice(0,8) })}
                    </div>
                    <button onClick={()=>{
                        setHandleInput(swearProfile?.handle || "");
                        setHandleError("");
                        setShowHandleModal(true);
                      }}
                      style={{marginTop:6,background:"transparent",border:"1px solid rgba(232,197,71,.4)",
                        color:"#e8c547",fontSize:10,letterSpacing:"1.5px",fontWeight:700,
                        padding:"5px 10px",borderRadius:8,cursor:"pointer",fontFamily:"inherit",textTransform:"uppercase"}}>
                      {swearProfile?.handle ? t("swear_card.change_handle", lang) : t("swear_card.set_handle", lang)}
                    </button>
                  </div>
                  <button onClick={()=>setSignOutConfirmOpen(true)}
                    style={{background:"transparent",border:"none",color:"#f43f5e",
                      fontSize:10,letterSpacing:"1.5px",fontWeight:700,
                      padding:"6px 8px",cursor:"pointer",fontFamily:"inherit",textTransform:"uppercase",
                      textDecoration:"underline",textUnderlineOffset:2}}>
                    {t("auth.sign_out", lang)}
                  </button>
                </div>
              ) : (
                <div style={{
                  background:"rgba(255,255,255,.03)",border:"1px solid rgba(232,197,71,.18)",
                  borderRadius:12,padding:"14px 16px",
                }}>
                  <div style={{fontSize:11,color:T.dim,lineHeight:1.45,marginBottom:10}}>
                    {t("auth.sign_in_subtitle", lang)}
                  </div>
                  <button onClick={()=>{ setShowSwearCard(false); setAuthModalOpen(true); }}
                    style={{width:"100%",padding:"10px 14px",fontSize:12,fontWeight:700,letterSpacing:"1.5px",
                      textTransform:"uppercase",background:"linear-gradient(135deg,#e8c547,#d4a830)",
                      color:"#04060f",border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit"}}>
                    {t("auth.sign_in_title", lang)}
                  </button>
                </div>
              )}

              {/* Stats grid */}
              <div>
                <div style={{fontSize:10,color:T.dim,letterSpacing:"2px",textTransform:"uppercase",
                  marginBottom:8,fontWeight:600}}>
                  {t("swear_card.stats_title", lang)}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                  {[
                    [t("swear_card.stat_solo", lang),        swearProfile?.stats?.soloWins || 0],
                    [t("swear_card.stat_blitz", lang),       swearProfile?.stats?.blitzWins || 0],
                    [t("swear_card.stat_duel", lang),        swearProfile?.stats?.duelWins || 0],
                    [t("swear_card.stat_daily", lang),       swearProfile?.stats?.dailyCompletes || 0],
                    [t("swear_card.stat_grand", lang),       swearProfile?.stats?.grandBluffs || 0],
                    [t("swear_card.stat_best_streak", lang), swearProfile?.stats?.bestStreak || best || 0],
                  ].map(([label, val]) => (
                    <div key={label} style={{
                      background:"rgba(255,255,255,.02)",border:"1px solid rgba(255,255,255,.05)",
                      borderRadius:10,padding:"10px 10px",
                    }}>
                      <div style={{fontFamily:"Georgia,serif",fontSize:18,fontWeight:800,color:"#e8e6e1",lineHeight:1.1}}>{val}</div>
                      <div style={{fontSize:9,color:T.dim,letterSpacing:"1px",textTransform:"uppercase",marginTop:3}}>{label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {authLoadingFromRedirect && (
        <div style={{position:"fixed",inset:0,zIndex:9998,background:"rgba(4,6,15,.95)",
          backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",
          display:"flex",alignItems:"center",justifyContent:"center",
          flexDirection:"column",gap:16}}>
          <div style={{width:48,height:48,border:"3px solid rgba(232,197,71,.2)",
            borderTopColor:"#e8c547",borderRadius:"50%",
            animation:"bluff-auth-spin 1s linear infinite"}}/>
          <div style={{fontFamily:"Georgia, serif",fontSize:14,
            color:"rgba(255,255,255,.6)",letterSpacing:1}}>
            {t("auth.signing_in", lang)}
          </div>
          <style>{`@keyframes bluff-auth-spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {authModalOpen && (
        <div onClick={()=>{ if (!authBusy) setAuthModalOpen(false); }}
          style={{position:"fixed",inset:0,zIndex:720,background:"rgba(4,6,15,.94)",
            backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
          <div onClick={e=>e.stopPropagation()}
            style={{maxWidth:360,width:"100%",background:"#0c0c14",
              border:"1px solid rgba(232,197,71,.3)",borderRadius:18,
              padding:"22px 20px 20px",position:"relative",
              boxShadow:"0 0 40px rgba(232,197,71,.12)",
              animation:"g-fadeUp .3s ease both"}}>
            <button onClick={()=>{ if (!authBusy) setAuthModalOpen(false); }}
              style={{position:"absolute",top:10,right:10,width:32,height:32,
                borderRadius:"50%",background:"rgba(255,255,255,.06)",
                border:"1px solid rgba(255,255,255,.1)",color:"#e8e6e1",
                fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
            <div style={{fontSize:11,color:"#e8c547",letterSpacing:"3px",textTransform:"uppercase",fontWeight:700,marginBottom:8,textAlign:"center"}}>
              {t("auth.sign_in_title", lang)}
            </div>
            <div style={{fontSize:12,color:T.dim,textAlign:"center",marginBottom:18,lineHeight:1.45}}>
              {t("auth.sign_in_subtitle", lang)}
            </div>
            {authError && (
              <div style={{color:"#f43f5e",fontSize:11,marginBottom:10,textAlign:"center"}}>
                {t("auth.sign_in_failed", lang)}
              </div>
            )}
            <div style={{marginBottom:10}}>
              <div
                ref={gisButtonRef}
                style={{display:"flex",justifyContent:"center",minHeight:44,
                  visibility: gisStatus === "failed" ? "hidden" : "visible",
                  height: gisStatus === "failed" ? 0 : "auto",
                  overflow: "hidden"}}
              />
              {gisStatus === "loading" && (
                <div style={{fontSize:10,color:T.dim,textAlign:"center",marginTop:6,letterSpacing:"1px"}}>
                  {t("auth.signing_in", lang)}
                </div>
              )}
              {gisStatus === "failed" && (
                <>
                  <button
                    onClick={async ()=>{
                      setAuthError("");
                      setAuthBusy(true);
                      try {
                        const user = await signInGoogle();
                        if (user) { setAuthModalOpen(false); setAnonCapBannerOpen(false); }
                      } catch (e) {
                        const code = e?.code || "";
                        if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
                          setAuthError("sign_in_cancelled");
                        } else if (code === "auth/network-request-failed") {
                          setAuthError("network_error");
                        } else if (code === "auth/unauthorized-domain") {
                          setAuthError("unauthorized_domain");
                        } else {
                          setAuthError(e?.message || "sign_in_failed");
                        }
                      } finally { setAuthBusy(false); }
                    }}
                    disabled={authBusy}
                    style={{width:"100%",padding:"12px 14px",fontSize:13,fontWeight:700,letterSpacing:"1.5px",
                      textTransform:"uppercase",background:"#ffffff",color:"#04060f",
                      border:"none",borderRadius:10,cursor: authBusy ? "wait" : "pointer",fontFamily:"inherit",
                      opacity: authBusy ? .6 : 1,
                      display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
                    <span style={{fontSize:16,fontWeight:900,color:"#4285F4"}}>G</span>
                    {t("auth.continue_google", lang)}
                  </button>
                  <div style={{fontSize:9,color:T.dim,textAlign:"center",marginTop:4,letterSpacing:"1px",opacity:.7}}>
                    (fallback mode)
                  </div>
                </>
              )}
            </div>
            <button
              disabled
              style={{width:"100%",padding:"12px 14px",fontSize:13,fontWeight:700,letterSpacing:"1.5px",
                textTransform:"uppercase",background:"rgba(255,255,255,.04)",color:"rgba(232,230,225,.4)",
                border:"1px solid rgba(255,255,255,.08)",borderRadius:10,cursor:"not-allowed",fontFamily:"inherit",
                marginBottom:12,
                display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
              <span style={{fontSize:14,fontWeight:900}}>‹</span>
              {t("auth.continue_apple", lang)}
              <span style={{fontSize:9,opacity:.8,marginLeft:6,letterSpacing:"1px"}}>
                ({t("auth.apple_soon", lang)})
              </span>
            </button>
            <button
              onClick={()=>{ if (!authBusy) setAuthModalOpen(false); }}
              disabled={authBusy}
              style={{width:"100%",padding:"10px",fontSize:11,fontWeight:600,letterSpacing:"1px",
                background:"transparent",color:T.dim,border:"none",cursor:"pointer",fontFamily:"inherit",
                textTransform:"uppercase"}}>
              {t("auth.continue_anon", lang)}
            </button>
            <div style={{fontSize:10,color:T.dim,textAlign:"center",marginTop:8,lineHeight:1.3}}>
              {t("auth.anon_cap_note", lang)}
            </div>
          </div>
        </div>
      )}

      {signOutConfirmOpen && (
        <div onClick={()=>setSignOutConfirmOpen(false)}
          style={{position:"fixed",inset:0,zIndex:730,background:"rgba(4,6,15,.94)",
            backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
          <div onClick={e=>e.stopPropagation()}
            style={{maxWidth:320,width:"100%",background:"#0c0c14",
              border:"1px solid rgba(232,197,71,.3)",borderRadius:16,
              padding:"20px 18px 18px",animation:"g-fadeUp .3s ease both"}}>
            <div style={{fontSize:13,color:"#e8e6e1",textAlign:"center",marginBottom:16,lineHeight:1.5}}>
              {t("auth.sign_out_confirm", lang)}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <button onClick={()=>setSignOutConfirmOpen(false)}
                style={{padding:"10px",fontSize:11,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",
                  background:"transparent",color:"#5a5a68",
                  border:"1px solid rgba(255,255,255,.08)",borderRadius:10,cursor:"pointer",fontFamily:"inherit"}}>
                {t("auth.sign_out_cancel", lang)}
              </button>
              <button onClick={async ()=>{
                  try { await signOutUser(); } catch {}
                  setSignOutConfirmOpen(false);
                  setShowSwearCard(false);
                }}
                style={{padding:"10px",fontSize:11,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",
                  background:"#f43f5e",color:"#04060f",border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit"}}>
                {t("auth.sign_out", lang)}
              </button>
            </div>
          </div>
        </div>
      )}

      {anonCapBannerOpen && !authUser && (
        <div style={{
          position:"fixed",left:"50%",transform:"translateX(-50%)",
          bottom:"max(20px,env(safe-area-inset-bottom))",zIndex:620,
          maxWidth:360,width:"calc(100% - 24px)",
          background:"rgba(4,6,15,.96)",
          border:"1px solid rgba(244,63,94,.4)",borderRadius:14,
          padding:"12px 14px",display:"flex",alignItems:"center",gap:10,
          boxShadow:"0 0 40px rgba(244,63,94,.18)",
          animation:"g-fadeUp .3s ease both",
        }}>
          <div style={{fontSize:12,color:"#e8e6e1",lineHeight:1.4,flex:1}}>
            {t("auth.cap_hit_banner", lang)}
          </div>
          <button onClick={()=>{ setAnonCapBannerOpen(false); setAuthModalOpen(true); }}
            style={{padding:"7px 12px",fontSize:10,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",
              background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#04060f",
              border:"none",borderRadius:8,cursor:"pointer",fontFamily:"inherit"}}>
            {t("auth.sign_in_title", lang)}
          </button>
          <button onClick={()=>setAnonCapBannerOpen(false)}
            style={{width:26,height:26,borderRadius:"50%",background:"rgba(255,255,255,.06)",
              border:"1px solid rgba(255,255,255,.1)",color:"#e8e6e1",
              fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
        </div>
      )}

      {showHandleModal && (
        <div onClick={()=>{ if (!handleSaving) setShowHandleModal(false); }}
          style={{position:"fixed",inset:0,zIndex:700,background:"rgba(4,6,15,.94)",
            backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
          <div onClick={e=>e.stopPropagation()}
            style={{maxWidth:340,width:"100%",background:"#0c0c14",
              border:"1px solid rgba(232,197,71,.3)",borderRadius:18,
              padding:"22px 20px 20px",position:"relative",
              boxShadow:"0 0 40px rgba(232,197,71,.12)",
              animation:"g-fadeUp .3s ease both"}}>
            <div style={{fontSize:10,color:"#e8c547",letterSpacing:"3px",textTransform:"uppercase",fontWeight:700,marginBottom:6,textAlign:"center"}}>
              {t("handle.title", lang)}
            </div>
            <div style={{fontSize:12,color:T.dim,textAlign:"center",marginBottom:14,lineHeight:1.4}}>
              {t("handle.subtitle", lang)}
            </div>
            <input
              type="text"
              value={handleInput}
              onChange={e=>{ setHandleInput(e.target.value); if (handleError) setHandleError(""); }}
              placeholder={t("handle.placeholder", lang)}
              maxLength={16}
              autoFocus
              style={{
                width:"100%",padding:"12px 14px",fontSize:15,fontFamily:"Georgia,serif",
                background:"rgba(255,255,255,.04)",color:"#e8e6e1",
                border:`1px solid ${handleError ? "rgba(244,63,94,.5)" : "rgba(232,197,71,.25)"}`,
                borderRadius:10,outline:"none",marginBottom:handleError?8:14,boxSizing:"border-box",
              }}
            />
            {handleError && (
              <div style={{color:"#f43f5e",fontSize:11,marginBottom:12,lineHeight:1.3}}>
                {t(`handle.${handleError}`, lang)}
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:8}}>
              <button
                onClick={()=>setShowHandleModal(false)}
                disabled={handleSaving}
                style={{padding:"12px",fontSize:12,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",
                  background:"transparent",color:"#5a5a68",
                  border:"1px solid rgba(255,255,255,.08)",borderRadius:10,cursor:"pointer",fontFamily:"inherit"}}
              >{t("handle.cancel", lang)}</button>
              <button
                onClick={async()=>{
                  setHandleSaving(true);
                  const result = await saveHandle(handleInput);
                  setHandleSaving(false);
                  if (result.ok) setShowHandleModal(false);
                  else setHandleError(result.error);
                }}
                disabled={handleSaving || handleInput.trim().length < 3}
                style={{padding:"12px",fontSize:12,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",
                  background: (handleSaving || handleInput.trim().length < 3) ? "rgba(232,197,71,.3)" : "linear-gradient(135deg,#e8c547,#d4a830)",
                  color:"#04060f",border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit",
                  opacity: (handleSaving || handleInput.trim().length < 3) ? .6 : 1}}
              >{handleSaving ? "…" : t("handle.save", lang)}</button>
            </div>
          </div>
        </div>
      )}

      {showLangModal && (
        <div onClick={()=>setShowLangModal(false)}
          style={{position:"fixed",inset:0,zIndex:600,background:"rgba(4,6,15,.9)",
            backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"24px"}}>
          <div onClick={e=>e.stopPropagation()}
            style={{maxWidth:360,width:"100%",background:"#0c0c14",
              border:"1px solid rgba(232,197,71,.25)",borderRadius:18,
              padding:"24px 22px 22px",position:"relative",
              boxShadow:"0 0 40px rgba(232,197,71,.1)",
              animation:"g-fadeUp .3s ease both"}}>
            <button onClick={()=>setShowLangModal(false)}
              style={{position:"absolute",top:10,right:10,width:32,height:32,
                borderRadius:"50%",background:"rgba(255,255,255,.06)",
                border:"1px solid rgba(255,255,255,.1)",color:"#e8e6e1",
                fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>✕</button>
            <div style={{fontSize:11,color:T.gold,letterSpacing:"3px",textTransform:"uppercase",fontWeight:600,marginBottom:14,textAlign:"center"}}>
              {t("home.language")}
            </div>
            <LangPicker lang={lang} onChange={(l)=>{changeLang(l);setShowLangModal(false);}}/>
          </div>
        </div>
      )}

      {showShop && (
        <div style={{position:"fixed",inset:0,zIndex:500,
          background:"rgba(4,6,15,.95)",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",
          overflowY:"auto",padding:"24px 16px 48px"}}>
          <div style={{maxWidth:460,margin:"0 auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",
              alignItems:"center",marginBottom:20,paddingTop:"max(12px,env(safe-area-inset-top))"}}>
              <div>
                <div style={{fontFamily:"Georgia,serif",fontSize:22,fontWeight:900,color:"#e8c547"}}>{t("home.axiom_skins")}</div>
                <div style={{fontSize:11,color:"#5a5a68",letterSpacing:"2px"}}>{t("home.choose_villain")}</div>
              </div>
              <button onClick={()=>setShowShop(false)}
                style={{width:36,height:36,borderRadius:"50%",background:"rgba(255,255,255,.06)",
                  border:"1px solid rgba(255,255,255,.1)",color:"#e8e6e1",fontSize:16,
                  cursor:"pointer",fontFamily:"inherit"}}>✕</button>
            </div>

            {[
              {id:"default",  emoji:"🤖", name:"Default AXIOM",   desc:"Chaotic Gen Z energy. Ships with the game.",           price:null,    preview:'"ratio 💀"'},
              {id:"balkan",   emoji:"🇧🇦", name:"Balkan AXIOM",    desc:"Brate, majke mi humor. Roastuje na srpsko-hrvatskom.", price:"€2.99", preview:'"jbg brate 😂"'},
              {id:"anime",    emoji:"🎌", name:"Anime AXIOM",     desc:"Dramatic villain arc. NANI energy.",                  price:"€2.99", preview:'"OMAE WA MOU SHINDEIRU 💀"'},
              {id:"corporate",emoji:"💼", name:"Corporate AXIOM", desc:"Passive-aggressive LinkedIn energy.",                 price:"€2.99", preview:'"This is not a culture fit, answer-wise."'},
              {id:"british",  emoji:"🎩", name:"British AXIOM",   desc:"Devastatingly polite. Dry sarcasm.",                 price:"€2.99", preview:'"Oh. Oh dear."'},
              {id:"bundle",   emoji:"⚡", name:"All Skins Bundle", desc:"Balkan + Anime + Corporate + British. Best value.",  price:"€9.99", preview:null},
            ].map(skin => {
              const allFour = ["balkan","anime","corporate","british"].every(s => ownedSkins.includes(s));
              const isOwned = skin.id === "default" || ownedSkins.includes(skin.id) ||
                (skin.id === "bundle" && allFour);
              const isActive = activeSkin === skin.id;
              return (
                <div key={skin.id} style={{
                  background: isActive ? "rgba(232,197,71,.08)" : "rgba(15,15,26,.9)",
                  border: isActive ? "1.5px solid rgba(232,197,71,.4)" : "1px solid rgba(255,255,255,.07)",
                  borderRadius:16, padding:"16px", marginBottom:10,
                }}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <span style={{fontSize:28}}>{skin.emoji}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:15,color:"#e8e6e1",marginBottom:2}}>{skin.name}</div>
                      <div style={{fontSize:12,color:"#5a5a68",lineHeight:1.4}}>{skin.desc}</div>
                      {skin.preview && <div style={{fontSize:12,color:"rgba(34,211,238,.5)",marginTop:4,fontStyle:"italic"}}>{skin.preview}</div>}
                    </div>
                    <div style={{flexShrink:0}}>
                      {isOwned ? (
                        <button
                          onClick={() => {
                            if (skin.id !== "bundle") {
                              setActiveSkin(skin.id);
                              localStorage.setItem("bluff_skin", skin.id);
                            }
                          }}
                          style={{padding:"8px 14px",fontSize:12,fontWeight:700,
                            background: isActive ? "rgba(232,197,71,.2)" : "rgba(45,212,160,.1)",
                            color: isActive ? "#e8c547" : "#2dd4a0",
                            border: isActive ? "1px solid rgba(232,197,71,.3)" : "1px solid rgba(45,212,160,.2)",
                            borderRadius:10,cursor:skin.id!=="bundle"?"pointer":"default",fontFamily:"inherit"}}>
                          {isActive ? "✓ Active" : skin.id==="bundle" ? "Owned" : "Use"}
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            const currentUserId = localStorage.getItem("bluff_user_id") || "anon";
                            fetch("/api/shop", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ action: "checkout", skinId: skin.id, userId: currentUserId }),
                            })
                            .then(r => r.json())
                            .then(data => {
                              if (data.url) {
                                window.location.href = data.url;
                              } else {
                                console.error("[shop] No URL:", data);
                                alert(`❌ ${data.error || t("home.shop_unavailable")}`);
                              }
                            })
                            .catch(err => {
                              console.error("[shop] Checkout error:", err);
                              alert(`❌ ${t("home.network_error")}`);
                            });
                          }}
                          style={{padding:"8px 14px",fontSize:12,fontWeight:700,
                            background:"linear-gradient(135deg,#e8c547,#d4a830)",
                            color:"#04060f",border:"none",borderRadius:10,
                            cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>
                          {skin.price}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            <a href="/shame.html" target="_blank"
              style={{display:"block",textAlign:"center",marginTop:16,
                fontSize:12,color:"rgba(244,63,94,.5)",textDecoration:"none",
                letterSpacing:"2px"}}>
              {t("home.hall_of_shame")}
            </a>

            <button
              onClick={async () => {
                const currentUserId = localStorage.getItem("bluff_user_id") || "anon";
                try {
                  const r = await fetch("/api/shop", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "owned", userId: currentUserId }),
                  });
                  const data = await r.json();
                  if (data.skins?.length > 0) {
                    setOwnedSkins(prev => {
                      const merged = [...new Set([...prev, ...data.skins])];
                      localStorage.setItem("bluff_owned_skins", JSON.stringify(merged));
                      return merged;
                    });
                    alert(`✅ Restored: ${data.skins.join(", ")}`);
                  } else {
                    alert("No purchases found for this account.");
                  }
                } catch {
                  alert(`❌ ${t("common.restore_failed")}`);
                }
              }}
              style={{display:"block",width:"100%",textAlign:"center",marginTop:10,
                padding:"10px",fontSize:12,color:"rgba(255,255,255,.2)",
                background:"transparent",border:"1px solid rgba(255,255,255,.06)",
                borderRadius:10,fontFamily:"inherit",cursor:"pointer"}}>
              {t("home.restore_purchases")}
            </button>
          </div>
        </div>
      )}

      {renderSwearToast()}
      <GameStyles/>
    </div>
  );
  }

  // ─── SHIFTER / NUMBERS ─────────────────────────────────────
  if (screen === "shifter") {
    return (
      <ShifterMode
        lang={lang}
        skin={activeSkin}
        onExit={() => setScreen("home")}
        onComplete={(summary) => {
          handleSideModeComplete(summary);
        }}
      />
    );
  }
  if (screen === "numbers") {
    return (
      <NumbersMode
        lang={lang}
        skin={activeSkin}
        onExit={() => setScreen("home")}
        onComplete={(summary) => {
          handleSideModeComplete(summary);
        }}
      />
    );
  }
  if (screen === "swipe") {
    return (
      <SwipeWarmup
        lang={lang}
        userId={userIdRef.current}
        onExit={() => setScreen("home")}
        onComplete={onSwipeComplete}
      />
    );
  }

  // ─── CLIMB mini-games (1: Blackjack-form Warm-up, 2: Sniper, 3: Math) ──
  // The wrapping div carries the fade-in animation that fires on each
  // screen mount. GameStyles is rendered alongside so the keyframe is
  // present in the DOM when the animation evaluates.
  if (screen === "climb-mini1") {
    return (
      <div style={{ animation: climbScreenAnim() }}>
        <ClimbMiniBlackjack
          lang={lang}
          userId={userIdRef.current}
          onComplete={({ pointsEarned } = {}) => {
            pendingMiniCarryRef.current = pointsEarned | 0;
            startGame();
          }}
        />
        <GameStyles/>
      </div>
    );
  }
  if (screen === "climb-mini2") {
    return (
      <div style={{ animation: climbScreenAnim() }}>
        <ClimbMiniSniper
          lang={lang}
          userId={userIdRef.current}
          onComplete={({ pointsEarned } = {}) => {
            const add = pointsEarned | 0;
            if (add > 0) {
              const next = scoreRef.current + add;
              scoreRef.current = next;
              setScore(next);
            }
            setScreen("play");
            nextRound();
          }}
        />
        <GameStyles/>
      </div>
    );
  }
  if (screen === "climb-mini3") {
    return (
      <div style={{ animation: climbScreenAnim() }}>
        <ClimbMiniMath
          onComplete={({ pointsEarned } = {}) => {
            const add = pointsEarned | 0;
            if (add > 0) {
              const next = scoreRef.current + add;
              scoreRef.current = next;
              setScore(next);
            }
            setScreen("play");
            nextRound();
          }}
        />
        <GameStyles/>
      </div>
    );
  }

  // ─── PLAY (V2) ─────────────────────────────────────────────
  // V2 single-player loop. Opt-in via ?v2=1 until promoted to default.
  // Per-phase SWEAR is credited individually by the server-judged phases
  // (swipe-judge, sniper-judge). The handler below adds the run-end
  // completion bonus (v2_run_victory / v2_run_death) and writes a
  // leaderboard entry on victory.
  if (screen === "play" && V2_ENABLED) {
    const handleV2RunComplete = (payload) => {
      const { score, swearEarned, phasesCompleted, finalPhase, outcome } = payload || {};
      captureEvent("v2_run_completed", {
        outcome, score, swearEarned, phasesCompleted, finalPhase,
      });
      // Navigate first so the user isn't staring at a blank screen while
      // the awards round-trip. Awards + leaderboard run fire-and-forget.
      setScreen("home");

      const gid = `v2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
      const earnEvent = outcome === "victory" ? "v2_run_victory"
                      : outcome === "death"   ? "v2_run_death"
                      : null;
      if (earnEvent) {
        const labelKey = outcome === "victory" ? "v2.run.victory" : "v2.run.death";
        awardSwear(earnEvent, gid, { label: t(labelKey, lang), meta: { score, finalPhase } })
          .catch(e => console.warn("[v2] swear-earn failed:", e?.message));
      }

      if (outcome === "victory" && score > 0 && userIdRef.current) {
        const playerName =
          swearProfile?.handle
          || authUser?.displayName
          || (authUser?.email ? authUser.email.split("@")[0].slice(0, 20) : "Anonymous");
        fetch("/api/leaderboard", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            deviceId:      userIdRef.current,
            playerName,
            score:         score | 0,
            climbComplete: false, // V2 isn't Climb; field repurposed to just flag run completion
          }),
        }).catch(e => console.warn("[v2] leaderboard write failed:", e?.message));
      }
    };
    const handleV2RunAbort = () => {
      captureEvent("v2_run_aborted", {});
      setScreen("home");
    };
    return (
      <GameEngine
        lang={lang}
        userId={userIdRef.current}
        onRunComplete={handleV2RunComplete}
        onRunAbort={handleV2RunAbort}
      />
    );
  }

  // ─── PLAY (legacy Climb) ───────────────────────────────────
  if(screen==="play") return (
    <div style={{
      ...wrap,
      background:
        "radial-gradient(ellipse at 50% 0%,rgba(232,197,71,.08) 0%,rgba(8,8,15,0) 55%),"
        + "radial-gradient(ellipse at 50% 115%,rgba(20,83,45,.28) 0%,rgba(8,8,15,0) 60%),"
        + `${T.bg}`,
      // Compose animations: fade-in runs once on mount (each transition
      // remounts this branch), screen-shake fires when the timer is
      // critical. Both can coexist via comma-list.
      animation: [
        CLIMB_TRANSITIONS_ENABLED ? CLIMB_FADE_IN : null,
        !revealed && time>0 && time<=3 ? "screen-shake 200ms infinite" : null,
      ].filter(Boolean).join(", ") || "none",
    }}>
      <div aria-hidden="true" style={{
        position:"absolute",inset:0,pointerEvents:"none",zIndex:0,
        background:"radial-gradient(ellipse at 50% 50%,rgba(232,197,71,.05) 0%,rgba(8,8,15,0) 70%)",
        animation:"ambient-breath 8s ease-in-out infinite",
      }}/>
      {/* Sabotage TIME_THIEF red flash overlay */}
      {sabotageActive?.type === "TIME_THIEF" && (
        <div aria-hidden="true" style={{
          position:"fixed", inset:0, zIndex:55, pointerEvents:"none",
          background:"radial-gradient(ellipse at 50% 0%, rgba(244,63,94,0.55) 0%, rgba(244,63,94,0.0) 60%)",
          animation:"sabotage-flash 700ms ease-out",
          mixBlendMode:"screen",
        }}/>
      )}
      {/* Sabotage banner — top-center text overlay */}
      {sabotageBanner && (
        <div aria-hidden="true" style={{
          position:"fixed", top: 78, left: "50%", zIndex: 56,
          transform: "translateX(-50%)",
          background: "rgba(20,20,28,0.92)",
          border: "1px solid rgba(244,63,94,0.55)",
          color: "#f43f5e",
          padding: "10px 18px",
          borderRadius: 12,
          fontSize: 12.5,
          fontWeight: 800,
          letterSpacing: "1.5px",
          textTransform: "uppercase",
          fontFamily: "'Segoe UI',system-ui,sans-serif",
          boxShadow: "0 8px 24px rgba(244,63,94,0.25)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          animation: "sabotage-banner 1.7s ease forwards",
          pointerEvents: "none",
          maxWidth: "90vw",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        key={sabotageBanner.key}>
          {sabotageBanner.text}
        </div>
      )}
      {pitFallActive && (
        <PitFall
          fellToRound={pitFellToRoundRef.current}
          skin={activeSkin}
          onComplete={() => setPitFallActive(false)}
        />
      )}
      {axiomReaction && (
        <AxiomReaction
          type={axiomReaction}
          skin={activeSkin}
          // PitFall plays its own MOCK voice line — don't double up here.
          playVoice={axiomReaction !== "MOCK"}
          onComplete={() => setAxiomReaction(null)}
        />
      )}
      {communityToast && (
        <CommunityToast
          toast={communityToast}
          onDismiss={() => setCommunityToast(null)}
        />
      )}
      {chipFlying && (
        <div style={{
          position:"fixed",zIndex:100,pointerEvents:"none",
          left:"50%",bottom:140,
          animation:"chip-fly .5s cubic-bezier(0.5,0,0.75,1) forwards",
        }}>
          <CasinoChip tier="gold" size={60}/>
        </div>
      )}
      {showWheelTeaser && (
        <div style={{
          position:"fixed",inset:0,zIndex:5000,
          background:"radial-gradient(ellipse at center, rgba(232,197,71,.18) 0%, rgba(4,6,15,.92) 60%)",
          display:"flex",alignItems:"center",justifyContent:"center",
          animation:"g-fadeUp .4s both",padding:"0 24px",
        }}>
          <div style={{
            textAlign:"center",maxWidth:340,
            background:"linear-gradient(135deg,rgba(232,197,71,.08),rgba(232,197,71,.02))",
            border:"1px solid rgba(232,197,71,.35)",borderRadius:18,
            padding:"24px 20px",
            boxShadow:"0 0 60px rgba(232,197,71,0.2)",
          }}>
            <div style={{fontSize:40,marginBottom:8}}>🎰</div>
            <div style={{fontSize:11,letterSpacing:"2px",color:"rgba(232,197,71,.7)",fontWeight:700,marginBottom:6,textTransform:"uppercase"}}>
              {t("wheel.teaser_pro_label")}
            </div>
            <div style={{fontSize:18,fontWeight:900,fontFamily:"Georgia,serif",color:"#e8c547",marginBottom:6,lineHeight:1.2}}>
              {t("wheel.teaser_title")}
            </div>
            <div style={{fontSize:13,color:"rgba(232,230,225,.8)",lineHeight:1.5}}>
              {t("wheel.teaser_sub")}
            </div>
          </div>
        </div>
      )}
      {wheelOpen && (
        <WheelOfFortune
          phaseNum={wheelPhaseNum}
          phaseScore={phaseScore}
          totalScore={score}
          lang={lang}
          mandatory={wheelPhaseNum === 3}
          gambitMode={wheelPhaseNum === 3 && gambitRisk !== null}
          gambitRisk={gambitRisk}
          gambitPot={gambitPot}
          onCashOut={() => {
            setScore(s => { const next = s + phaseScore; scoreRef.current = next; return next; });
            setPhaseScore(0);
            phaseScoreRef.current = 0;
            const justClosed = wheelPhaseNum;
            setWheelOpen(false);
            if (justClosed === 3) showResultScreen();
            else if (justClosed === 1) setScreen("climb-mini2");
            else if (justClosed === 2) setScreen("climb-mini3");
            else nextRound();
          }}
          onSpinResult={(zone) => {
            const isGambit = wheelPhaseNum === 3 && gambitRisk !== null;
            if (isGambit) {
              const pot = gambitPot;
              if (zone === "green") {
                setScore(s => { const next = s + pot; scoreRef.current = next; return next; });
                setAxiomScore(a => { const next = Math.max(0, a - pot); axiomScoreRef.current = next; return next; });
                axiomSpeak("gambit_win_green", "shocked");
              } else if (zone === "gold") {
                setScore(s => { const next = s + pot * 2; scoreRef.current = next; return next; });
                setAxiomScore(a => { const next = Math.max(0, a - pot * 2); axiomScoreRef.current = next; return next; });
                axiomSpeak("gambit_win_gold", "defeated");
                const gid = `grand_${gameStartTimeRef.current || Date.now()}`;
                awardSwear("grand_bluff_victory", gid, {
                  label: t("swear.grand_bluff_victory", lang),
                  meta: { pot, risk: gambitRisk },
                });
              } else if (zone === "red") {
                setScore(s => { const next = Math.max(0, s - pot); scoreRef.current = next; return next; });
                setAxiomScore(a => { const next = a + pot; axiomScoreRef.current = next; return next; });
                axiomSpeak("gambit_loss_red", "amused");
              } else if (zone === "black") {
                setScore(s => { const next = Math.max(0, s - pot * 2); scoreRef.current = next; return next; });
                setAxiomScore(a => { const next = a + pot * 2; axiomScoreRef.current = next; return next; });
                axiomSpeak("gambit_loss_black", "taunting");
              }
              setGambitRisk(null);
              setGambitPot(0);
              setWheelOpen(false);
              showResultScreen();
              return;
            }
            const stake = phaseScoreRef.current;
            if (zone === "green") setScore(s => { const next = s + stake * 2; scoreRef.current = next; return next; });
            else if (zone === "gold") setScore(s => { const next = s + stake * 3; scoreRef.current = next; return next; });
            else if (zone === "red") {
              setAxiomScore(a => { const next = a + stake; axiomScoreRef.current = next; return next; });
            } else if (zone === "black") {
              setScore(s => { const next = Math.floor(s * 0.5); scoreRef.current = next; return next; });
              setAxiomScore(a => { const next = a + stake; axiomScoreRef.current = next; return next; });
            }
            if (wheelPhaseNum === 3 && zone === "gold") {
              const gid = `grand_${gameStartTimeRef.current || Date.now()}`;
              awardSwear("grand_bluff_victory", gid, {
                label: t("swear.grand_bluff_victory", lang),
                meta: { stake },
              });
            }
            setPhaseScore(0);
            phaseScoreRef.current = 0;
            const justClosed = wheelPhaseNum;
            setWheelOpen(false);
            if (justClosed === 3) showResultScreen();
            else if (justClosed === 1) setScreen("climb-mini2");
            else if (justClosed === 2) setScreen("climb-mini3");
            else nextRound();
          }}
        />
      )}
      {suddenDeathOfferOpen && (
        <SuddenDeathOffer
          lang={lang}
          onAccept={() => {
            setSuddenDeathOfferOpen(false);
            setSuddenDeathOpen(true);
          }}
          onDecline={() => {
            setSuddenDeathOfferOpen(false);
            axiomSpeak("gambit_intro", "taunting");
            setGambitRiskOpen(true);
          }}
        />
      )}
      {suddenDeathOpen && (
        <SuddenDeath
          lang={lang}
          playerScore={score}
          axiomScore={axiomScore}
          onResolve={(won) => {
            setSuddenDeathOpen(false);
            if (won === true) {
              const stolen = axiomScoreRef.current;
              setScore(s => s + stolen);
              setAxiomScore(() => { axiomScoreRef.current = 0; return 0; });
              axiomSpeak("sudden_death_win", "defeated");
            } else if (won === false) {
              const lost = score;
              setAxiomScore(a => { const next = a + lost; axiomScoreRef.current = next; return next; });
              setScore(() => 0);
              axiomSpeak("sudden_death_lose", "amused");
            }
            // Proceed to Gambit risk selection after a brief pause for outcome readability
            setTimeout(() => {
              axiomSpeak("gambit_intro", "taunting");
              setGambitRiskOpen(true);
            }, won === null ? 0 : 1200);
          }}
        />
      )}
      {gambitRiskOpen && (
        <RiskSelector
          lang={lang}
          playerScore={score}
          onPick={(risk, pot) => {
            setGambitRisk(risk);
            setGambitPot(pot);
            setGambitRiskOpen(false);
            if (risk === "conservative") axiomSpeak("gambit_conservative", "amused");
            else if (risk === "balanced") axiomSpeak("gambit_balanced", "idle");
            else axiomSpeak("gambit_allin", "shocked");
            setWheelOpen(true);
          }}
        />
      )}
      <Particles count={10}/>
      {confetti&&<Confetti/>}
      {showWaveIntro&&(
        <div style={{position:"fixed",inset:0,zIndex:150,display:"flex",flexDirection:"column",
          alignItems:"center",justifyContent:"center",pointerEvents:"none",
          background:"rgba(4,6,15,.92)",animation:"g-fadeUp .3s ease"}}>
          <div style={{fontSize:11,letterSpacing:"6px",color:WAVE_COLORS[currentWave],
            marginBottom:10,fontWeight:700,textTransform:"uppercase"}}>
            {currentWave===0?"🟢":currentWave===1?"🟠":"🔴"} WAVE {currentWave+1}
          </div>
          <div style={{fontFamily:"Georgia,serif",fontSize:"clamp(28px,8vw,42px)",
            fontWeight:900,color:"#fff",marginBottom:8,letterSpacing:-1}}>
            {WAVE_LABELS[currentWave]}
          </div>
          <div style={{fontSize:13,color:"rgba(255,255,255,.4)",fontStyle:"italic"}}>
            "{WAVE_AXIOM_INTRO[currentWave]}"
          </div>
        </div>
      )}
      {!revealed&&time>0&&time<=5&&(
        <div style={{
          position:"fixed",inset:0,pointerEvents:"none",zIndex:50,
          boxShadow: time<=3
            ? "inset 0 0 150px 30px rgba(244,63,94,.4), inset 0 0 280px 60px rgba(244,63,94,.22)"
            : "inset 0 0 100px 18px rgba(244,63,94,.25), inset 0 0 200px 40px rgba(244,63,94,.12)",
          animation: time<=3 ? "vignette-pulse .9s ease-in-out infinite" : "none",
          transition:"box-shadow .4s ease",
        }}/>
      )}
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:460,padding:"clamp(14px,4vw,22px)"}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,paddingTop:"max(12px,env(safe-area-inset-top))"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <CategoryIcon category={category} size={22}/>
            <div>
              <div key={`cat-${roundIdx}-${category}`} style={{fontSize:10,color:T.gold,letterSpacing:"3px",textTransform:"uppercase",fontWeight:600,animation:"category-entrance .55s ease-out both"}}>{category}</div>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{fontSize:9,color:T.dim}}>Q{(roundIdx%qpw)+1}/{qpw}{blitzMode?" ⚡":""}</div>
                <div style={{fontSize:9,color:diff===0?"#2dd4a0":DIFF_COLOR[diff],letterSpacing:"1px"}}>· {DIFF_LABEL[diff]||"Baby"}</div>
              </div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {streak>0&&<div style={{fontSize:12,color:T.gold,fontWeight:700,display:"flex",alignItems:"center",gap:3,background:T.goldDim,padding:"4px 10px",borderRadius:20,animation:streak>=3?"g-fire .6s infinite":"none"}}>🔥{streak}</div>}
            {!revealed
              ?<TimerRing time={time} max={TIMER_PER_DIFF[diff]||45} size={46}/>
              :<div style={{width:46,height:46,borderRadius:"50%",background:correct?"rgba(45,212,160,.12)":"rgba(244,63,94,.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,animation:"g-pulse .5s",color:correct?T.ok:T.bad}}>{correct?"✓":"✗"}</div>
            }
          </div>
        </div>

        {loadingRound?(
          <div style={{padding:"6px 0 0"}}>
            <div style={{textAlign:"center",marginBottom:14}}>
              <div style={{fontFamily:"Georgia,serif",fontSize:"clamp(16px,4.2vw,20px)",fontWeight:700,color:"#fff",marginBottom:4,letterSpacing:-.3}}>{t("play.axiom_shuffling")}</div>
              <div style={{fontSize:"clamp(10px,2.5vw,12px)",color:T.dim,letterSpacing:".5px"}}>Preparing your next deception</div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:7}}>
              {[0,1,2,3].map(i=>(
                <div key={i} style={{
                  display:"flex",alignItems:"flex-start",gap:10,
                  background:T.card,border:`1.5px solid ${T.gb}`,borderRadius:16,
                  padding:"clamp(11px,3vw,14px)",minHeight:52,
                  animation:`g-cardIn .3s ${i*.06}s both`,
                }}>
                  <div style={{
                    width:"clamp(24px,6vw,28px)",height:"clamp(24px,6vw,28px)",borderRadius:"50%",
                    flexShrink:0,border:`2px solid ${T.gb}`,marginTop:2,
                    background:"linear-gradient(90deg,rgba(255,255,255,.04) 0%,rgba(255,255,255,.12) 50%,rgba(255,255,255,.04) 100%)",
                    backgroundSize:"200% 100%",animation:"skeleton-shimmer 1.6s linear infinite",
                  }}/>
                  <div style={{flex:1,display:"flex",flexDirection:"column",gap:6,paddingTop:4}}>
                    <div style={{
                      height:10,borderRadius:4,width:"92%",
                      background:"linear-gradient(90deg,rgba(255,255,255,.04) 0%,rgba(255,255,255,.12) 50%,rgba(255,255,255,.04) 100%)",
                      backgroundSize:"200% 100%",animation:`skeleton-shimmer 1.6s linear infinite ${i*.12}s`,
                    }}/>
                    <div style={{
                      height:10,borderRadius:4,width:`${65+((i*13)%25)}%`,
                      background:"linear-gradient(90deg,rgba(255,255,255,.04) 0%,rgba(255,255,255,.10) 50%,rgba(255,255,255,.04) 100%)",
                      backgroundSize:"200% 100%",animation:`skeleton-shimmer 1.6s linear infinite ${(i*.12)+.2}s`,
                    }}/>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ):fetchError?(
          <div style={{textAlign:"center",padding:"40px 20px"}}>
            <div style={{fontSize:32,marginBottom:12}}>⚠️</div>
            <div style={{color:"rgba(255,255,255,.5)",marginBottom:16,fontSize:14}}>{t("play.axiom_unreachable")}</div>
            <button onClick={()=>{
              const d = blitzMode ? (BLITZ_DIFFICULTY[roundIdx] || 4) : (ROUND_DIFFICULTY[roundIdx] || 3);
              setMultiplier(1.0);
              multiplierRef.current = 1.0;
              setMultiplierLocked(null);
              milestonesFiredRef.current = new Set();
    firedStreakSwearRef.current = new Set();
              setLastRoundResult(null);
              setCorrectCount(0);
              correctCountRef.current = 0;
              setMaxCashout(1.0);
              maxCashoutRef.current = 1.0;
              setTime(blitzMode ? BLITZ_TIMER : (TIMER_PER_DIFF[d] || 60));
              setLoadingRound(true);
              setFetchError(false);
              fetchRound(roundIdx);
            }}
              style={{padding:"12px 24px",background:"rgba(232,197,71,.1)",color:"#e8c547",
                border:"1px solid rgba(232,197,71,.3)",borderRadius:10,cursor:"pointer",
                fontFamily:"inherit",fontSize:14,fontWeight:700}}>
              Try again
            </button>
          </div>
        ):(<>
          <AxiomPanel mood={axiomMood} speech={axiomSpeech} loading={axiomLoading} compact={true}/>

          <div style={{textAlign:"center",marginBottom:12}}>
            <h2 style={{fontFamily:"Georgia,serif",fontSize:"clamp(17px,4.5vw,22px)",fontWeight:800,margin:"0 0 4px",color:revealed?(correct?T.ok:T.bad):"#fff",transition:"color .4s"}}>
              {revealed?(correct?t("play.you_found_it"):t("play.axiom_won_round")):t("play.which_is_bluff")}
            </h2>
            <p style={{fontSize:"clamp(10px,2.5vw,12px)",color:T.dim,margin:0}}>
              {revealed?(correct?t("play.instincts_beat_machine"):t("play.fabricated_below")):t("play.one_was_invented")}
            </p>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:14,animation:revealed&&!correct?"g-shake .5s":sabotageActive?.type==="REALITY_GLITCH"?"sabotage-glitch 1.5s linear":"none"}}>
            {stmts.map((s,i)=>{
              const isB=!s.real,isS=sel===i;
              const peek = sabotageActive?.type === "PEEK_AND_HIDE" && sabotageActive.peekIdx === i;
              const glitching = sabotageActive?.type === "REALITY_GLITCH" && !revealed;
              let bg=T.card,border=T.gb,anim="";
              if(!revealed&&isS){bg=T.goldDim;border="rgba(232,197,71,.4)";}
              if(revealed&&isB){bg="rgba(244,63,94,.07)";border="rgba(244,63,94,.4)";anim="g-glow .8s";}
              if(revealed&&isS&&correct){bg="rgba(45,212,160,.07)";border="rgba(45,212,160,.4)";anim="g-correctGlow .8s";}
              if(peek){border="rgba(45,212,160,0.7)"; anim=`${anim?anim+", ":""}peek-glow 1s ease-out`;}
              return (
                <button key={i} onClick={()=>handleCardSelect(i)} disabled={flipping||revealed} style={{width:"100%",display:"flex",alignItems:"flex-start",gap:10,background:bg,border:`1.5px solid ${border}`,borderRadius:16,padding:"clamp(11px,3vw,14px)",cursor:revealed||flipping?"default":"pointer",transition:"all .22s ease, transform .25s ease, box-shadow .25s ease",textAlign:"left",color:"#e8e6e1",fontSize:"clamp(13px,3.5vw,15px)",lineHeight:1.55,fontFamily:"inherit",minHeight:52,boxShadow:revealed&&isB?"0 6px 22px rgba(244,63,94,.22), inset 0 1px 0 rgba(255,255,255,.04)":revealed&&isS&&correct?"0 6px 22px rgba(45,212,160,.22), inset 0 1px 0 rgba(255,255,255,.04)":peek?"0 0 24px rgba(45,212,160,0.55), inset 0 0 12px rgba(45,212,160,0.25)":"0 2px 10px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.04)",animation:flipping?`card-flip 400ms ${i*.04}s ease-in-out both`:`g-cardIn .3s ${i*.055}s both${revealed&&isB?`, card-kick .5s ${.05+i*.04}s ease-out both`:""}${anim?`, ${anim}`:""}`}}>
                  <div style={{width:"clamp(24px,6vw,28px)",height:"clamp(24px,6vw,28px)",borderRadius:"50%",flexShrink:0,border:`2px solid ${isS&&!revealed?T.gold:revealed&&isB?T.bad:T.gb}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,marginTop:2,background:isS&&!revealed?T.gold:revealed&&isB?"rgba(244,63,94,.18)":"transparent",color:isS&&!revealed?T.bg:revealed&&isB?T.bad:T.dim,transition:"all .25s"}}>
                    {revealed&&isB?"!":String.fromCharCode(65+i)}
                  </div>
                  <div style={{flex:1, fontFamily: glitching ? "monospace" : "inherit"}}>
                    {glitching ? scrambleText(s.text) : s.text}
                    {revealed&&<div style={{marginTop:6,fontSize:10,fontWeight:700,letterSpacing:"1.5px",color:isB?T.bad:isS?T.bad:T.ok,opacity:isB||isS?1:.4}}>
                      {isB?t("play.ai_fabrication"):isS?t("play.actually_real"):t("play.verified_fact")}
                    </div>}
                  </div>
                </button>
              );
            })}
          </div>

          {lastRoundResult?.isCorrect && (
            <div style={{
              marginTop: 12,
              marginBottom: 12,
              padding: '12px 16px',
              background: 'rgba(45,212,160,0.08)',
              border: '1px solid rgba(45,212,160,0.3)',
              borderRadius: 12,
              fontSize: 13,
            }}>
              <BreakdownRow label="Base" value={BASE_POINTS} delay={0} />
              <BreakdownRow label="× Multiplier" value={`${lastRoundResult.lockedMult.toFixed(1)}x 💰`} delay={200} />
              {lastRoundResult.streakMult > 1 && (
                <BreakdownRow label="× Streak" value={`${lastRoundResult.streakMult.toFixed(1)}x 🔥`} delay={400} />
              )}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', marginTop: 8, paddingTop: 8 }}>
                <BreakdownRow label="Earned" value={`+${lastRoundResult.earned}`} highlight delay={600} />
              </div>
            </div>
          )}

          {lastRoundResult && !lastRoundResult.isCorrect && !lastRoundResult.autoReveal && (
            <div style={{
              marginTop: 12,
              marginBottom: 12,
              padding: '12px 16px',
              background: 'rgba(244,63,94,0.08)',
              border: '1px solid rgba(244,63,94,0.3)',
              borderRadius: 12,
              fontSize: 13,
            }}>
              <BreakdownRow label="Penalty" value={`-${lastRoundResult.penalty}`} delay={0} />
              <BreakdownRow label="Locked at" value={`${lastRoundResult.lockedMult.toFixed(1)}x`} delay={200} />
              {streak === 0 && lastRoundResult.streakMult > 1 && (
                <BreakdownRow label="Streak" value="Broken 💔" delay={400} />
              )}
            </div>
          )}

          {lastRoundResult && !lastRoundResult.isCorrect && lastRoundResult.autoReveal && (
            <div style={{
              marginTop: 12,
              marginBottom: 12,
              padding: '12px 16px',
              background: 'rgba(244,63,94,0.12)',
              border: '1px solid rgba(244,63,94,0.4)',
              borderRadius: 12,
              fontSize: 13,
            }}>
              <BreakdownRow label="Timer expired" value="⏱" delay={0} />
              <BreakdownRow label="Base penalty" value={`-${Math.round(BASE_PENALTY * 0.3)}`} delay={200} />
              <BreakdownRow label="Negligence" value={`-${blitzMode ? NEGLIGENCE_PENALTY_BLITZ : NEGLIGENCE_PENALTY_REGULAR}`} delay={400} />
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', marginTop: 8, paddingTop: 8 }}>
                <BreakdownRow label="Total" value={`-${lastRoundResult.penalty}`} highlight delay={600} />
              </div>
            </div>
          )}

          {!revealed
            ? sel === null
              ? <button
                  disabled
                  style={{
                    width:"100%",minHeight:64,padding:18,
                    opacity:0.4,
                    background:"rgba(255,255,255,.02)",
                    border:"1.5px dashed rgba(232,197,71,.2)",
                    color:"rgba(232,197,71,.3)",
                    fontSize:12,letterSpacing:3,textTransform:"uppercase",
                    borderRadius:16,fontFamily:"inherit",cursor:"not-allowed",
                  }}
                >
                  {t("play.pick_your_bluff")}
                </button>
              : <button
                  onClick={() => {
                    if (flipping || chipFlying) return;
                    haptic.lockIn();
                    AudioTension.lockIn();
                    try { playTick("medium"); } catch {}
                    setChipFlying(true);
                    setTimeout(() => {
                      setChipFlying(false);
                      setFlipping(true);
                      setTimeout(() => { setFlipping(false); doReveal(); }, 400);
                    }, 500);
                  }}
                  style={{
                    width:"100%",minHeight:64,padding:0,
                    position:"relative",overflow:"hidden",
                    background:"rgba(4,6,15,.7)",
                    border:`2px solid ${
                      stakeAnim==="fall"?"#f43f5e":stakeAnim==="bang"?"#f0d878":"rgba(232,197,71,.5)"
                    }`,
                    borderRadius:16,cursor:"pointer",fontFamily:"inherit",
                    boxShadow:stakeAnim==="bang"
                      ?"0 0 60px rgba(232,197,71,.5), 0 0 120px rgba(232,197,71,.2)"
                      :stakeAnim==="fall"
                      ?"0 0 40px rgba(244,63,94,.4)"
                      :`0 0 ${20+stakeLevel*12}px rgba(232,197,71,${0.15+stakeLevel*0.07})`,
                    transition:"box-shadow .4s, border-color .3s",
                    animation:stakeAnim==="bang"?"stake-bang .6s ease-out":stakeAnim==="fall"?"stake-fall .8s ease-out":"none",
                  }}
                >
                  <div style={{
                    position:"absolute",left:0,top:0,bottom:0,
                    width:`${((stakeLevel+1)/STAKE_LEVELS.length)*100}%`,
                    background:stakeAnim==="fall"
                      ?"linear-gradient(90deg, rgba(244,63,94,.35), rgba(244,63,94,.15))"
                      :"linear-gradient(90deg, #d4a830 0%, #e8c547 50%, #f0d878 100%)",
                    transition:"width .6s cubic-bezier(0.34,1.56,0.64,1), background .3s",
                    zIndex:0,
                  }}/>
                  <div style={{
                    position:"absolute",inset:0,pointerEvents:"none",
                    background:"linear-gradient(90deg, transparent 20%, rgba(255,255,255,.15) 50%, transparent 80%)",
                    backgroundSize:"200% 100%",
                    animation:"stake-shimmer 2.5s linear infinite",
                    zIndex:1,
                  }}/>
                  <div style={{
                    position:"relative",zIndex:2,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    gap:14,padding:18,
                    color:"#04060f",fontWeight:900,
                    textShadow:"0 1px 0 rgba(255,255,255,.1)",
                  }}>
                    <span style={{fontSize:14,letterSpacing:3,textTransform:"uppercase"}}>{t("play.lock_in")}</span>
                    <span style={{
                      fontSize:26,fontFamily:"Georgia,serif",fontWeight:900,
                      transform:stakeAnim==="bang"?"scale(1.25)":"scale(1)",
                      transition:"transform .4s cubic-bezier(0.34,1.56,0.64,1)",
                    }}>
                      ×{STAKE_LEVELS[stakeLevel].toFixed(1)}
                    </span>
                  </div>
                </button>
            :<div style={{display:"flex",gap:10}}>
              <button onClick={()=>{clearInterval(timerRef.current);clearTimeout(autoAdvanceRef.current);setAutoAdvanceCount(null);setScreen("home");}} style={{flex:1,minHeight:52,padding:14,fontSize:"clamp(13px,3.5vw,15px)",fontWeight:600,background:T.glass,color:"#e8e6e1",border:`1.5px solid ${T.gb}`,borderRadius:12,fontFamily:"inherit"}}>{t("play.home")}</button>
              <button onClick={()=>{clearTimeout(autoAdvanceRef.current);setAutoAdvanceCount(null);advanceAfterRound();}} style={{flex:2,minHeight:52,padding:14,fontSize:"clamp(13px,3.5vw,15px)",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",background:"linear-gradient(135deg,#e8c547,#d4a830)",color:T.bg,borderRadius:12,fontFamily:"inherit",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
                <span style={{position:"relative"}}>{autoAdvanceCount!=null?(roundIdx+1<(blitzMode?BLITZ_ROUNDS:ROUND_DIFFICULTY.length)?t("play.next_in",{n:autoAdvanceCount}):t("play.results_in",{n:autoAdvanceCount})):(roundIdx+1<(blitzMode?BLITZ_ROUNDS:ROUND_DIFFICULTY.length)?t("play.next_round"):t("play.see_results"))}</span>
              </button>
            </div>
          }

          {revealed && !correct && (
            <div style={{
              position:"fixed", inset:0, zIndex:100,
              display:"flex", alignItems:"center", justifyContent:"center",
              pointerEvents:"none",
              animation:"g-fadeIn .1s ease both",
            }}>
              <div style={{
                fontSize:"clamp(48px,15vw,80px)",
                fontFamily:"Georgia,serif", fontWeight:900,
                color:"#f43f5e", letterSpacing:-2,
                textShadow:"0 0 40px rgba(244,63,94,.5)",
                animation:"g-glitchText .6s ease both",
                opacity:.85,
              }}>RATIO'D 💀</div>
            </div>
          )}

          {/* Segment indicator — round progress */}
          {(() => {
            const totalRounds = blitzMode ? BLITZ_ROUNDS : ROUND_DIFFICULTY.length;
            return (
              <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:8,padding:"12px 0",marginTop:6,marginBottom:4,position:"relative"}}>
                <div style={{position:"absolute",left:"18%",right:"18%",top:"50%",height:1,background:"rgba(232,197,71,.1)",transform:"translateY(-50%)",zIndex:0}}/>
                {Array.from({length:totalRounds}).map((_,i)=>{
                  const isActive = i===roundIdx;
                  const isPast = i<roundIdx;
                  const pastResult = isPast ? resultsHistoryRef.current[i] : undefined;
                  const isCorrect = pastResult===true;
                  const isWrong = pastResult===false;
                  const isFuture = !isActive && !isPast;
                  return (
                    <div key={i} style={{
                      position:"relative",zIndex:1,
                      width:isActive?14:10,height:isActive?14:10,borderRadius:"50%",
                      background:isActive?"#e8c547":isCorrect?"#2dd4a0":isWrong?"#f43f5e":"rgba(255,255,255,.1)",
                      boxShadow:isActive?"0 0 16px #e8c547,0 0 32px rgba(232,197,71,.4)":"none",
                      border:isFuture?"1px solid rgba(232,197,71,.18)":"none",
                      animation:isActive?"segment-pulse 1.4s ease-in-out infinite":"none",
                      transition:"all .3s ease",
                      display:"flex",alignItems:"center",justifyContent:"center",
                    }}>
                      {(isCorrect||isWrong) && (
                        <span style={{fontSize:8,fontWeight:900,color:"#04060f",lineHeight:1}}>
                          {isCorrect?"✓":"✗"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
          {!blitzMode && (
            <div style={{
              display:"grid",gridTemplateColumns:"1fr auto 1fr",gap:10,
              marginTop:14,alignItems:"center",
              padding:"8px 12px",
              background:"rgba(4,6,15,.45)",
              border:"1px solid rgba(232,197,71,.1)",
              borderRadius:10,
            }}>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:8,letterSpacing:2,color:"rgba(255,255,255,.4)",textTransform:"uppercase",fontWeight:700,marginBottom:1}}>YOU</div>
                <div style={{fontSize:20,fontWeight:800,fontFamily:"Georgia,serif",
                  color: score >= axiomScore ? T.gold : "rgba(255,255,255,.5)",
                  textShadow: score >= axiomScore ? "0 0 12px rgba(232,197,71,.4)" : "none",
                  transition:"color .3s ease",
                }}>
                  {score.toLocaleString('en-US')}
                </div>
              </div>
              <div style={{fontSize:10,color:"rgba(255,255,255,.3)",letterSpacing:2,fontWeight:700}}>VS</div>
              <div style={{textAlign:"left"}}>
                <div style={{fontSize:8,letterSpacing:2,color:"rgba(34,211,238,.6)",textTransform:"uppercase",fontWeight:700,marginBottom:1}}>AXIOM</div>
                <div style={{fontSize:20,fontWeight:800,fontFamily:"Georgia,serif",
                  color: axiomScore > score ? "#22d3ee" : "rgba(255,255,255,.5)",
                  textShadow: axiomScore > score ? "0 0 12px rgba(34,211,238,.4)" : "none",
                  transition:"color .3s ease",
                }}>
                  {axiomScore.toLocaleString('en-US')}
                </div>
              </div>
            </div>
          )}
          <div style={{display:"flex",justifyContent:"center",gap:"clamp(12px,4vw,18px)",marginTop:12,fontSize:"clamp(10px,2.5vw,12px)",color:T.dim}}>
            {blitzMode && (
              <span>Banked <b style={{color:T.gold,fontSize:13}}>{score.toLocaleString('en-US')}</b></span>
            )}
            {!blitzMode && phaseScore > 0 && (
              <>
                <span>Stake <b style={{color:"#f0d878",fontSize:13}}>{phaseScore.toLocaleString('en-US')}</b></span>
                <span style={{opacity:.2}}>|</span>
              </>
            )}
            <span>Streak <b style={{color:streak>0?T.gold:T.dim,fontSize:13}}>{streak}🔥</b></span>
          </div>
        </>)}
      </div>
      {renderSwearToast()}
      <GameStyles/>
    </div>
  );

  // ─── RESULT ────────────────────────────────────────────────
  const won = blitzMode ? (correctCount >= Math.ceil(total * 0.67)) : (score > axiomScore);
  const respectable = blitzMode ? (correctCount >= Math.floor(total / 2)) : (score >= axiomScore * 0.7);
  return (
    <div style={{
      minHeight:"100dvh",
      background:"radial-gradient(ellipse 100% 60% at 50% 30%, rgba(232,197,71,0.08), transparent 60%), #04060f",
      display:"flex",flexDirection:"column",alignItems:"center",
      padding:"max(28px,env(safe-area-inset-top)) 20px max(28px,env(safe-area-inset-bottom))",
      position:"relative",overflow:"hidden",
      color:"#e8e6e1",fontFamily:"'Segoe UI',system-ui,sans-serif",
      animation: climbScreenAnim()
    }}>
      <Particles/>
      {won && confetti && <Confetti/>}
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:440}}>
        {/* HERO BLOCK */}
        <div style={{textAlign:"center",marginBottom:24,animation:"result-heroIn 0.8s cubic-bezier(0.34,1.56,0.64,1)"}}>
          <div style={{fontSize:56,marginBottom:8,filter:"drop-shadow(0 0 20px rgba(232,197,71,0.4))"}}>
            {won ? "👑" : respectable ? "🎭" : "💀"}
          </div>
          <div style={{fontSize:11,letterSpacing:6,color:"rgba(255,255,255,0.4)",textTransform:"uppercase",marginBottom:8,fontWeight:500}}>
            {won ? t("result.champion") : respectable ? t("result.respectable") : t("result.axiom_wins")}
          </div>
          <div style={{
            fontFamily:"Georgia,serif",
            fontSize:"clamp(28px,7.5vw,42px)",
            fontWeight:900,letterSpacing:-1,lineHeight:1.1,
            background: won
              ? "linear-gradient(135deg,#f0d878,#e8c547,#fff,#e8c547)"
              : "linear-gradient(135deg,#a78bfa,#e8c547)",
            backgroundSize:"200% auto",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
            animation:"g-shimmer 3s linear infinite",
            marginBottom:14
          }}>
            {won ? t("result.you_beat_axiom") : respectable ? t("result.close_but_not_enough") : t("result.axiom_fooled_you")}
          </div>
          <div style={{
            fontFamily:"Georgia,serif",
            fontSize:"clamp(48px,14vw,76px)",
            fontWeight:900,lineHeight:1,
            color:"#e8c547",
            textShadow:"0 0 40px rgba(232,197,71,0.3)",
            marginBottom:6
          }}>
            {score.toLocaleString('en-US')}
          </div>
          <div style={{fontSize:11,letterSpacing:4,color:"rgba(255,255,255,0.3)",textTransform:"uppercase"}}>
            Points
          </div>
        </div>

        {/* STATS ROW */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:20,animation:"g-fadeUp 0.6s 0.3s both"}}>
          <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(34,211,238,0.15)",borderRadius:12,padding:"12px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"Georgia,serif",fontSize:22,fontWeight:700,color:"#22d3ee"}}>{axiomScore.toLocaleString('en-US')}</div>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1,textTransform:"uppercase",marginTop:2}}>AXIOM</div>
          </div>
          <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:12,padding:"12px 8px",textAlign:"center"}}>
            <div style={{fontFamily:"Georgia,serif",fontSize:22,fontWeight:700,color:"#a78bfa"}}>{best}🔥</div>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",letterSpacing:1,textTransform:"uppercase",marginTop:2}}>{t("result.best_streak")}</div>
          </div>
        </div>

        {/* PRIMARY CTA — Play again */}
        <button onClick={tryStartSoloGame} style={{
          width:"100%",minHeight:60,padding:18,
          fontSize:"clamp(14px,4vw,16px)",fontWeight:700,letterSpacing:2,textTransform:"uppercase",
          background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#120c08",
          border:"none",borderRadius:16,cursor:"pointer",fontFamily:"inherit",
          boxShadow:"0 0 50px rgba(232,197,71,0.25), 0 8px 24px rgba(232,197,71,0.12)",
          marginBottom:10,position:"relative",overflow:"hidden",
          animation:"g-fadeUp 0.5s 0.4s both"
        }}>
          <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
          <span style={{position:"relative"}}>{t("result.play_again")}</span>
        </button>

        {/* SECONDARY ROW — Duel + Share Card */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:18,animation:"g-fadeUp 0.5s 0.5s both"}}>
          <button
            onClick={()=>{
              if(!challengeURL) return;
              if(navigator.share){
                navigator.share({
                  title:"BLUFF™ — Can you beat me?",
                  text: won
                    ? `Crushed AXIOM with ${score.toLocaleString('en-US')} points. Think you can do better? 🎯`
                    : `AXIOM got me. Think you can beat ${score.toLocaleString('en-US')}? 🎭`,
                  url: challengeURL,
                }).catch(()=>{
                  navigator.clipboard?.writeText(challengeURL);
                  alert(t("common.link_copied"));
                });
              } else {
                navigator.clipboard?.writeText(challengeURL);
                alert(t("result.challenge_link_copied"));
              }
            }}
            disabled={!challengeURL}
            style={{minHeight:52,padding:14,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase",
              background:"rgba(34,211,238,0.08)",color:"#22d3ee",border:"1px solid rgba(34,211,238,0.3)",
              borderRadius:12,cursor:challengeURL?"pointer":"not-allowed",opacity:challengeURL?1:0.5,fontFamily:"inherit"}}>
            {t("result.duel_friend")}
          </button>
          <button
            onClick={()=>document.getElementById("share-card-link")?.click()}
            disabled={!storiesImg}
            style={{minHeight:52,padding:14,fontSize:12,fontWeight:700,letterSpacing:1,textTransform:"uppercase",
              background:"linear-gradient(135deg,rgba(131,58,180,0.2),rgba(253,29,29,0.15),rgba(252,176,69,0.2))",
              color:"#fff",border:"1px solid rgba(255,255,255,0.15)",
              borderRadius:12,cursor:storiesImg?"pointer":"not-allowed",opacity:storiesImg?1:0.5,fontFamily:"inherit"}}>
            {t("result.share_card")}
          </button>
        </div>
        {storiesImg && <a id="share-card-link" href={storiesImg} download="bluff-score.png" style={{display:"none"}}/>}
        {/* Daily result summary */}
        {dailyMode && (
          <div style={{background:"rgba(45,212,160,.06)",border:"1px solid rgba(45,212,160,.25)",borderRadius:14,padding:"14px 16px",marginBottom:16,animation:"g-fadeUp .5s .35s both"}}>
            <div style={{fontSize:10,letterSpacing:"3px",color:"rgba(45,212,160,.7)",fontWeight:700,marginBottom:10,textTransform:"uppercase"}}>
              {t("result.daily_complete")}
            </div>
            <div style={{fontSize:24,letterSpacing:3,textAlign:"center",marginBottom:10}}>
              {dailyResultsRef.current.map(r => r ? "🟩" : "🟥").join("")}
            </div>
            {dailyRank ? (
              <div style={{textAlign:"center",fontSize:14,color:"rgba(255,255,255,.55)",marginBottom:10}}>
                {t("result.you_ranked")}{" "}
                <span style={{color:"#e8c547",fontWeight:800,fontSize:20,fontFamily:"Georgia,serif"}}>#{dailyRank}</span>
                {dailyPlayers > 0 && <span style={{color:"rgba(255,255,255,.35)"}}> {t("result.of_n_players", { n: dailyPlayers })}</span>}
              </div>
            ) : (
              <div style={{textAlign:"center",fontSize:12,color:"rgba(255,255,255,.3)",marginBottom:10}}>{t("result.submitting_score")}</div>
            )}
            <button
              onClick={() => {
                const grid = dailyResultsRef.current.map(r => r ? "🟩" : "🟥").join("");
                const rankStr = dailyRank ? ` · #${dailyRank}/${dailyPlayers}` : "";
                const scoreFmt = score.toLocaleString('en-US');
                const text = `BLUFF™ Daily #${dailyData?.dayNum ?? ""}\n${grid}\n${scoreFmt} pts · ${correctCount}/${total}${rankStr}\nplaybluff.games`;
                if (navigator.share) navigator.share({ text }).catch(() => navigator.clipboard?.writeText(text));
                else navigator.clipboard?.writeText(text).then(() => alert(t("common.link_copied"))).catch(() => alert(text));
              }}
              style={{width:"100%",minHeight:44,padding:"10px 14px",fontSize:13,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",background:"rgba(45,212,160,.1)",color:"#2dd4a0",border:"1px solid rgba(45,212,160,.3)",borderRadius:10,fontFamily:"inherit",cursor:"pointer"}}>
              {t("result.share_daily")}
            </button>
          </div>
        )}

        {/* Blitz result */}
        {blitzMode && (
          <div style={{textAlign:"center",marginBottom:16,padding:"12px",
            background:"rgba(244,63,94,.08)",border:"1px solid rgba(244,63,94,.2)",
            borderRadius:12,animation:"g-fadeUp .5s .35s both"}}>
            <div style={{fontSize:11,letterSpacing:"3px",color:"#f43f5e",marginBottom:4}}>{t("result.blitz_result")}</div>
            <div style={{fontFamily:"Georgia,serif",fontSize:48,fontWeight:900,color:"#f43f5e"}}>{correctCount}/4</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.55)",marginTop:2,fontFamily:"Georgia,serif"}}>{score.toLocaleString('en-US')} pts</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginTop:4}}>
              {correctCount===4?t("result.demolished"):correctCount>=3?t("result.sharp"):correctCount>=2?t("result.decent"):t("result.axiom_wins_caption")}
            </div>
          </div>
        )}

        {/* Secondary share options */}
        <div style={{ marginBottom: 16, animation: "g-fadeUp .6s .6s both" }}>

          {/* DUEL — same questions, head-to-head */}
          {!dailyMode && roundsPlayedRef.current.filter(Boolean).length >= ROUND_DIFFICULTY.length && (
            <>
              <div style={{ fontSize: 10, letterSpacing: "3px", color: "rgba(255,255,255,.2)", textTransform: "uppercase", marginTop: 14, marginBottom: 10 }}>
                {t("result.duel_head_to_head")}
              </div>
              {!duelId && (
                <input
                  value={duelName}
                  onChange={e => setDuelName(e.target.value)}
                  placeholder={t("result.duel_name_placeholder")}
                  style={{ width: "100%", padding: "11px 14px", fontSize: 14, background: T.card, border: `1.5px solid ${T.gb}`, borderRadius: 10, color: "#e8e6e1", fontFamily: "inherit", boxSizing: "border-box", marginBottom: 8, outline: "none" }}
                />
              )}
              {duelId ? (
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/duel/${duelId}`;
                    if (navigator.share) {
                      navigator.share({
                        title: "BLUFF™ Duel Challenge",
                        text:  `Crushed AXIOM with ${score.toLocaleString('en-US')} points on these questions. ${correctCount}/${total} reads. Can you beat me? 🎯`,
                        url,
                      }).catch(() => navigator.clipboard?.writeText(url));
                    } else {
                      navigator.clipboard?.writeText(url)
                        .then(() => alert(t("result.duel_link_copied")))
                        .catch(() => alert(url));
                    }
                  }}
                  style={{ width: "100%", minHeight: 48, padding: 14, fontSize: "clamp(13px,3.5vw,14px)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: "rgba(232,197,71,.1)", color: "#e8c547", border: "1px solid rgba(232,197,71,.3)", borderRadius: 12, fontFamily: "inherit", cursor: "pointer" }}>
                  {t("result.share_duel_link")}
                </button>
              ) : (
                <button
                  onClick={handleCreateDuel}
                  disabled={duelCreating}
                  style={{ width: "100%", minHeight: 48, padding: 14, fontSize: "clamp(13px,3.5vw,14px)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: duelCreating ? T.glass : "rgba(232,197,71,.08)", color: duelCreating ? T.dim : "#e8c547", border: `1px solid ${duelCreating ? T.gb : "rgba(232,197,71,.3)"}`, borderRadius: 12, fontFamily: "inherit", cursor: duelCreating ? "not-allowed" : "pointer" }}>
                  {duelCreating ? t("result.creating_duel") : t("result.challenge_to_duel")}
                </button>
              )}
            </>
          )}

          {/* Telegram share */}
          {tg.isInsideTelegram && (
            <button
              onClick={() => {
                tg.sendResult({
                  score, total, won,
                  dayNum: dailyData?.dayNum,
                  isDaily: dailyMode,
                  emojiGrid: dailyResultsRef.current.map(r => r ? "🟩" : "🟥").join(""),
                });
              }}
              style={{ width:"100%", minHeight:48, padding:14, fontSize:"clamp(13px,3.5vw,14px)", fontWeight:700, letterSpacing:"1px", textTransform:"uppercase", marginTop:10, background:"linear-gradient(135deg,rgba(34,171,238,.25),rgba(34,171,238,.12))", color:"#29b6f6", border:"1px solid rgba(34,171,238,.4)", borderRadius:12, fontFamily:"inherit", cursor:"pointer" }}>
              {t("result.share_telegram")}
            </button>
          )}
          <button
            onClick={() => {
              const grid = dailyResultsRef.current.length > 0
                ? "\n" + dailyResultsRef.current.map(r => r ? "🟩" : "🟥").join("")
                : "";
              const text = `🎭 Crushed AXIOM with ${score.toLocaleString('en-US')} points in BLUFF! ${correctCount}/${total} reads.${grid}\nCan you beat me?`;
              tg.shareToChat(text, "https://playbluff.games");
            }}
            style={{ width:"100%", minHeight:48, padding:14, fontSize:"clamp(13px,3.5vw,14px)", fontWeight:700, letterSpacing:"1px", textTransform:"uppercase", marginTop:10, background:"rgba(255,255,255,.03)", color:"#5a5a68", border:"1px solid rgba(255,255,255,.07)", borderRadius:12, fontFamily:"inherit", cursor:"pointer" }}>
            {t("result.send_telegram")}
          </button>
        </div>
        {lastWrongStmt && !shameSent && (
          <div style={{
            background:"rgba(244,63,94,.06)",
            border:"1px solid rgba(244,63,94,.2)",
            borderRadius:14, padding:"14px 16px", marginBottom:16,
            animation:"g-fadeUp .6s .7s both",
          }}>
            <div style={{fontSize:10,letterSpacing:"3px",color:"rgba(244,63,94,.6)",
              fontWeight:700,marginBottom:6,textTransform:"uppercase"}}>
              {t("result.submit_shame_title")}
            </div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.5)",marginBottom:10,lineHeight:1.5}}>
              {t("result.submit_shame_body")}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button
                onClick={() => {
                  fetch("/api/hall-of-shame", {
                    method: "POST",
                    headers: {"Content-Type":"application/json"},
                    body: JSON.stringify({ wrongStatement: lastWrongStmt, category, roundNum: roundIdx + 1 }),
                  }).then(() => setShameSent(true));
                }}
                style={{flex:2,minHeight:44,padding:"10px 14px",fontSize:13,
                  fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",
                  background:"rgba(244,63,94,.15)",color:"#f43f5e",
                  border:"1px solid rgba(244,63,94,.3)",borderRadius:10,
                  fontFamily:"inherit",cursor:"pointer"}}>
                {t("result.submit_shame_btn")}
              </button>
              <button
                onClick={() => setLastWrongStmt(null)}
                style={{flex:1,minHeight:44,padding:10,fontSize:13,fontWeight:600,
                  background:"transparent",color:"#5a5a68",
                  border:"1px solid rgba(255,255,255,.07)",borderRadius:10,
                  fontFamily:"inherit",cursor:"pointer"}}>
                {t("result.nope")}
              </button>
            </div>
          </div>
        )}
        {shameSent && (
          <div style={{textAlign:"center",fontSize:13,color:"rgba(244,63,94,.5)",
            marginBottom:16,padding:"12px",animation:"g-fadeUp .3s ease both"}}>
            {t("result.shame_submitted")}
          </div>
        )}

        <div style={{textAlign:"center",marginTop:8,animation:"g-fadeUp .5s .7s both"}}>
          <button onClick={()=>setScreen("home")}
            style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.3)",
              fontSize:12,letterSpacing:2,textTransform:"uppercase",
              cursor:"pointer",fontFamily:"inherit",padding:"8px 16px"}}>
            {t("result.back_home")}
          </button>
        </div>
      </div>
      {renderSwearToast()}
      <GameStyles/>
    </div>
  );
}

function shuffle(a){let b=[...a];for(let i=b.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;}

function GameStyles(){
  return <style>{`
    @keyframes g-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
    @keyframes g-shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
    @keyframes g-fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
    @keyframes g-cardIn{from{opacity:0;transform:translateX(-10px) scale(.97)}to{opacity:1;transform:none}}
    @keyframes g-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
    @keyframes g-confetti{0%{transform:translateY(-10px) rotate(0);opacity:1}100%{transform:translateY(105vh) rotate(720deg);opacity:0}}
    @keyframes g-btnShimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
    @keyframes cashoutPulse{0%,100%{opacity:1}50%{opacity:.55}}
    @keyframes breakdownFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
    @keyframes g-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-5px)}40%,80%{transform:translateX(5px)}}
    @keyframes g-glow{0%{box-shadow:0 0 0}50%{box-shadow:0 0 22px rgba(244,63,94,.3)}100%{box-shadow:0 0 10px rgba(244,63,94,.1)}}
    @keyframes g-correctGlow{0%{box-shadow:0 0 0}50%{box-shadow:0 0 22px rgba(45,212,160,.35)}100%{box-shadow:0 0 10px rgba(45,212,160,.15)}}
    @keyframes g-fire{0%,100%{transform:scale(1)}50%{transform:scale(1.25)}}
    @keyframes g-tapPulse{0%,100%{opacity:.25}50%{opacity:.65}}
    @keyframes hexRotate{to{transform:rotate(360deg)}}
    @keyframes hexRotateCCW{to{transform:rotate(-360deg)}}
    @keyframes g-fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes climb-screen-fade-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
    @keyframes g-glitchText{
      0%{transform:scale(2) rotate(-5deg);opacity:0}
      40%{transform:scale(1.1) rotate(1deg);opacity:1}
      60%{transform:scale(1.05) rotate(-1deg)}
      100%{transform:scale(1) rotate(0);opacity:.85}
    }
    @keyframes g-screenFlash{
      0%{opacity:0} 20%{opacity:.15} 100%{opacity:0}
    }
    @keyframes scanDown{0%{transform:translateY(-50px)}100%{transform:translateY(220px)}}
    @keyframes moodIn{from{opacity:0;transform:translateX(6px)}to{opacity:1;transform:none}}
    @keyframes swear-award-in{from{opacity:0;transform:translateX(-50%) translateY(14px) scale(.85)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}
    @keyframes swear-award-out{0%{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}100%{opacity:0;transform:translateX(-50%) translateY(-12px) scale(.95)}}
    @keyframes swear-coin-spin{from{transform:rotateY(0deg)}to{transform:rotateY(720deg)}}
    @keyframes axiomPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
    @keyframes ic-blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(0.05)}}
    @keyframes ax-browTwitch{0%,100%{transform:translateY(0)}50%{transform:translateY(-0.6px)}}
    @keyframes lobby-pulse{0%,100%{opacity:0.3;transform:scale(1)}50%{opacity:1;transform:scale(1.3)}}
    @keyframes lobby-timeout-fadeIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes lobby-dotwave{0%,100%{opacity:0.4;transform:translateX(0)}50%{opacity:1;transform:translateX(2px)}}
    @keyframes lobby-tick{0%,100%{opacity:0.4;transform:scale(1)}50%{opacity:1;transform:scale(1.4)}}
    @keyframes home-shimmer{0%,100%{transform:translateX(-100%)}50%{transform:translateX(100%)}}
    @keyframes swipe-cta-pulse{
      0%,100%{box-shadow:0 0 36px rgba(255,107,53,.25), 0 6px 18px rgba(255,107,53,.18)}
      50%{box-shadow:0 0 56px rgba(255,107,53,.45), 0 6px 18px rgba(255,107,53,.32)}
    }
    @keyframes result-heroIn{0%{opacity:0;transform:translateY(40px) scale(0.9)}100%{opacity:1;transform:translateY(0) scale(1)}}
    @keyframes skeleton-shimmer{0%{background-position:-160% 0}100%{background-position:260% 0}}
    @keyframes timer-glitch{
      0%{transform:translate(0,0);filter:brightness(1)}
      15%{transform:translate(-2px,1px) scale(1.06);filter:brightness(1.35)}
      30%{transform:translate(2px,-1px) scale(1.02);filter:brightness(1.2)}
      55%{transform:translate(-1px,0) scale(1.04);filter:brightness(1.25)}
      100%{transform:translate(0,0) scale(1);filter:brightness(1)}
    }
    @keyframes vignette-pulse{
      0%,100%{box-shadow:inset 0 0 80px 10px rgba(244,63,94,.32), inset 0 0 160px 30px rgba(244,63,94,.18)}
      50%{box-shadow:inset 0 0 120px 20px rgba(244,63,94,.5), inset 0 0 220px 60px rgba(244,63,94,.28)}
    }
    @keyframes ambient-breath{
      0%,100%{opacity:.35}
      50%{opacity:.7}
    }
    @keyframes category-entrance{
      0%{opacity:0;letter-spacing:14px;transform:translateY(-2px)}
      60%{opacity:1;letter-spacing:5px}
      100%{opacity:1;letter-spacing:3px;transform:translateY(0)}
    }
    @keyframes card-kick{
      0%{transform:translateX(0)}
      30%{transform:translateX(-6px) rotate(-0.5deg)}
      60%{transform:translateX(4px) rotate(0.3deg)}
      100%{transform:translateX(0)}
    }
    @keyframes segment-pulse{
      0%,100%{transform:scale(1);box-shadow:0 0 16px #e8c547,0 0 32px rgba(232,197,71,.4)}
      50%{transform:scale(1.15);box-shadow:0 0 24px #e8c547,0 0 48px rgba(232,197,71,.6)}
    }
    @keyframes screen-shake{
      0%{transform:translate(0,0)}
      25%{transform:translate(1px,-1px)}
      50%{transform:translate(-1px,1px)}
      75%{transform:translate(1px,1px)}
      100%{transform:translate(0,0)}
    }
    @keyframes lockin-fill{
      0%{width:0}
      100%{width:100%}
    }
    @keyframes lockin-shimmer{
      0%{transform:translateX(-100%)}
      100%{transform:translateX(100%)}
    }
    @keyframes card-flip{
      0%{transform:perspective(600px) rotateX(0)}
      50%{transform:perspective(600px) rotateX(90deg) scale(.95);opacity:.5}
      100%{transform:perspective(600px) rotateX(0)}
    }
    @keyframes stake-bang{
      0%{transform:scale(1)}
      30%{transform:scale(1.04) translateY(-2px)}
      60%{transform:scale(1.02) translateY(-1px)}
      100%{transform:scale(1)}
    }
    @keyframes stake-fall{
      0%,100%{transform:translateX(0)}
      15%{transform:translateX(-4px)}
      30%{transform:translateX(4px)}
      45%{transform:translateX(-3px)}
      60%{transform:translateX(3px)}
      75%{transform:translateX(-1px)}
    }
    @keyframes stake-shimmer{
      0%{background-position:-200% center}
      100%{background-position:200% center}
    }
    @keyframes chip-fly{
      0%{opacity:0;transform:translateX(-50%) translateY(0) scale(.4) rotate(0deg)}
      20%{opacity:1;transform:translateX(-50%) translateY(-80px) scale(1.1) rotate(180deg)}
      100%{opacity:.7;transform:translateX(-50%) translateY(-340px) scale(.85) rotate(540deg)}
    }
    @keyframes wheel-overlay-in{
      from{opacity:0}
      to{opacity:1}
    }
    @keyframes wheel-outcome-in{
      0%{opacity:0;transform:scale(.5) translateY(20px)}
      100%{opacity:1;transform:scale(1) translateY(0)}
    }
    @keyframes wheel-particle-drift{
      0%,100%{transform:translateY(0) translateX(0);opacity:.2}
      50%{transform:translateY(-20px) translateX(8px);opacity:.5}
    }
    @keyframes wheel-spotlight-pulse{
      0%,100%{opacity:.6;transform:translate(-50%,-50%) scale(1)}
      50%{opacity:1;transform:translate(-50%,-50%) scale(1.05)}
    }
    @keyframes wheel-outcome-pulse{
      0%,100%{opacity:.7}
      50%{opacity:1}
    }
    /* === Phase 1 Arena drama === */
    @keyframes pit-flash{
      0%{opacity:0}30%{opacity:1}100%{opacity:0}
    }
    @keyframes pit-shake{
      0%,100%{transform:translate(0,0)}
      25%{transform:translate(-6px,4px) rotate(-0.4deg)}
      50%{transform:translate(7px,-5px) rotate(0.4deg)}
      75%{transform:translate(-4px,-6px) rotate(-0.2deg)}
    }
    @keyframes pit-streaks{
      0%{transform:translateY(-100%);opacity:0.4}
      100%{transform:translateY(100%);opacity:0.7}
    }
    @keyframes pit-fall-text{
      0%{transform:translateY(-180px) scale(0.6);opacity:0;filter:blur(8px)}
      30%{opacity:1;filter:blur(0)}
      100%{transform:translateY(40vh) scale(1.4);opacity:0;filter:blur(2px)}
    }
    @keyframes pit-impact-bounce{
      0%{transform:translateY(-50px) scale(1.4);opacity:0}
      40%{transform:translateY(20px) scale(0.92);opacity:1}
      70%{transform:translateY(-10px) scale(1.04)}
      100%{transform:translateY(0) scale(1);opacity:1}
    }
    @keyframes pit-dust{
      0%{transform:translate(0,0) scale(0.4);opacity:0}
      30%{opacity:0.7}
      100%{transform:translate(var(--pit-dust-x,0),-220px) scale(1.4);opacity:0}
    }
    @keyframes axiom-reaction-pulse{
      0%{opacity:0;transform:scale(0.3) rotate(-12deg)}
      30%{opacity:1;transform:scale(1.18) rotate(8deg)}
      55%{transform:scale(0.96) rotate(-3deg)}
      80%{opacity:1;transform:scale(1.05) rotate(0)}
      100%{opacity:0;transform:scale(1) rotate(0)}
    }
    @keyframes community-toast-in{
      from{opacity:0;transform:translateX(20px)}
      to{opacity:1;transform:translateX(0)}
    }
    @keyframes community-toast-out{
      from{opacity:1;transform:translateX(0)}
      to{opacity:0;transform:translateX(20px)}
    }
    @keyframes sabotage-flash{
      0%{opacity:0}
      20%{opacity:0.55}
      100%{opacity:0}
    }
    @keyframes sabotage-banner{
      0%{opacity:0;transform:translate(-50%,-30px) scale(0.8)}
      20%{opacity:1;transform:translate(-50%,0) scale(1.05)}
      40%{transform:translate(-50%,0) scale(1)}
      80%{opacity:1}
      100%{opacity:0;transform:translate(-50%,-12px) scale(0.95)}
    }
    @keyframes sabotage-glitch{
      0%,100%{filter:none;transform:translate(0,0)}
      15%{filter:hue-rotate(60deg) saturate(1.4) contrast(1.2);transform:translate(-2px,1px) skewX(-1.5deg)}
      30%{filter:hue-rotate(-30deg) saturate(1.6);transform:translate(3px,-2px) skewX(1.2deg)}
      45%{filter:hue-rotate(120deg) contrast(1.3);transform:translate(-1px,2px) skewX(-0.6deg)}
      60%{filter:hue-rotate(-90deg) saturate(0.6);transform:translate(2px,1px) skewX(1deg)}
      80%{filter:hue-rotate(45deg);transform:translate(-1px,0) skewX(-0.4deg)}
    }
    @keyframes peek-glow{
      0%{box-shadow:0 0 0 rgba(45,212,160,0)}
      30%{box-shadow:0 0 24px rgba(45,212,160,0.65), inset 0 0 12px rgba(45,212,160,0.35)}
      100%{box-shadow:0 0 0 rgba(45,212,160,0)}
    }
    @media (prefers-reduced-motion: reduce){
      *,*::before,*::after{
        animation-duration:.001ms!important;
        animation-iteration-count:1!important;
        transition-duration:.001ms!important;
      }
    }
  `}</style>;
}

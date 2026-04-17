import { useState, useEffect, useRef, useCallback } from "react";
import { PartySocket } from "partysocket";
import { SCHEMA, QUESTIONS_PER_WAVE } from "./config/schema";
import { getFallback } from "./config/fallbacks";

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
// CONFIG
// ═══════════════════════════════════════════════════════════════
const BETA_MODE = true;

const LANGUAGES = [
  { code: "en", flag: "🇬🇧", label: "EN" },
  { code: "de", flag: "🇩🇪", label: "DE" },
  { code: "sr", flag: "🇷🇸", label: "SR" },
  { code: "hr", flag: "🇭🇷", label: "HR" },
  { code: "sl", flag: "🇸🇮", label: "SL" },
  { code: "bs", flag: "🇧🇦", label: "BS" },
  { code: "fr", flag: "🇫🇷", label: "FR" },
  { code: "es", flag: "🇪🇸", label: "ES" },
];

const CATEGORIES = [
  "premier_league","nba","bundesliga","premier_league","nba",
  "sports","popculture","science","bundesliga","sports",
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
        <ellipse cx={ex} cy={ey} rx={s2(36)} ry={s2(29)} fill="#010407"/>
        <circle cx={ex} cy={ey} r={r1} fill="none" stroke={m.eye} strokeWidth={size>80?1.5:1} opacity=".9"/>
        <circle cx={ex} cy={ey} r={s2(28)} fill="#050f20"/>
        <circle cx={ex} cy={ey} r={r2} fill="none" stroke={m.eye} strokeWidth={sc*.8} opacity=".5" style={{animation:"axiomPulse 2s infinite"}}/>
        <circle cx={ex} cy={ey} r={r3} fill="none" stroke="rgba(34,211,238,.3)" strokeWidth={sc*.6}/>
        <circle cx={ex} cy={ey} r={r4} fill="#020912"/>
        <circle cx={ex} cy={ey} r={r5} fill={m.eye} filter={`url(#${fid})`}
          style={{animation:"ic-blink 7s ease-in-out infinite",transformBox:"fill-box",transformOrigin:"center"}}/>
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
      borderRadius:14,padding:"10px 12px",marginBottom:12,backdropFilter:"blur(8px)"}}>
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
        <button key={l.code} onClick={()=>onChange(l.code)} style={{
          display:"flex",alignItems:"center",gap:5,
          padding:"6px 12px",borderRadius:20,fontSize:12,fontWeight:600,
          fontFamily:"inherit",cursor:"pointer",transition:"all .2s",
          background: lang===l.code ? "rgba(232,197,71,.12)" : "rgba(255,255,255,.03)",
          border: lang===l.code ? "1px solid rgba(232,197,71,.45)" : "1px solid rgba(255,255,255,.07)",
          color: lang===l.code ? "#e8c547" : "#5a5a68",
        }}>
          <span style={{fontSize:16}}>{l.flag}</span>
          <span>{l.label}</span>
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
  const color=time<=10?"#f43f5e":time<=20?"#fb923c":"#e8c547";
  const pct=Math.max(0,time/max);
  return (
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={3}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={circ} strokeDashoffset={circ*(1-pct)}
          strokeLinecap="round" style={{transition:"stroke-dashoffset 1s linear,stroke .3s"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color,animation:time<=5?"g-pulse .5s infinite":"none"}}>{time}</div>
    </div>
  );
}

function generateShareCard(score, total, best, speech, won, correctCount, maxCashout) {
  try {
    correctCount = correctCount ?? total;
    maxCashout = maxCashout ?? 1.0;
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
    const stats = [
      { label: `${correctCount}/${total} correct`, color: "#2dd4a0" },
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

function generateStoriesCard(score, total, best, axiomSpeech, won, lieText, roastLine, correctCount, maxCashout) {
  correctCount = correctCount ?? total;
  maxCashout = maxCashout ?? 1.0;
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
    const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 0;

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
      { label: "Correct", value: `${correctCount}/${total} · ${accuracy}%`, color: "#2dd4a0" },
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
  };
})();

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function BluffGame() {
  const haptic = useHaptic();
  const tg = useTelegram();
  const [showIntro, setShowIntro] = useState(true);
  const [screen, setScreen] = useState("home");
  const [lang, setLang] = useState(()=>localStorage.getItem("bluff_lang")||"en");
  const [stmts, setStmts] = useState([]);
  const [roundIdx, setRoundIdx] = useState(0);
  const [category, setCategory] = useState("history");
  const [sel, setSel] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [time, setTime] = useState(45);
  const [multiplier, setMultiplier] = useState(1.0);
  const multiplierRef = useRef(1.0);
  const [multiplierLocked, setMultiplierLocked] = useState(null);
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
  const [duelName, setDuelName] = useState(() => localStorage.getItem("bluff_duel_name") || "");

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
  const duelAnswerSentRef = useRef(false);
  const [duelConnectionState, setDuelConnectionState] = useState("idle");
  const [duelRetryAttempt, setDuelRetryAttempt] = useState(0);
  const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || "bluff-duel.paunov-tech.partykit.dev";
  const [activeSkin, setActiveSkin] = useState(
    () => localStorage.getItem("bluff_skin") || "default"
  );
  const [ownedSkins, setOwnedSkins] = useState(() => {
    try { return JSON.parse(localStorage.getItem("bluff_owned_skins") || '["default"]'); }
    catch { return ["default"]; }
  });
  const [showShop, setShowShop] = useState(false);
  const [lastWrongStmt, setLastWrongStmt] = useState(null);
  const [shameSent, setShameSent] = useState(false);
  const [lastAxiomLine, setLastAxiomLine] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(
    () => localStorage.getItem("bluff_voice") !== "off"
  );
  const timerRef = useRef(null);
  const autoAdvanceRef = useRef(null);
  const audioRef = useRef(null);
  const userInteractedRef = useRef(false);
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

  // ── DAILY CHALLENGE ─────────────────────────────────────────
  async function loadDailyChallenge() {
    console.log("[daily] loading...");
    setLoadingDaily(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const r = await fetch(`/api/daily-challenge?userId=${encodeURIComponent(userIdRef.current)}`, { signal: controller.signal });
      console.log("[daily] response status:", r.status);
      const data = await r.json();
      console.log("[daily] data:", data);
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
    setTotal(0);
    setStreak(0);
    setConfetti(false);
    setShareImg(null);
    setCurrentWave(0);
    setShowWaveIntro(false);
    setStoriesImg(null);
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
  async function fetchRound(idx) {
    setLoadingRound(true);
    setFetchError(false);

    // Daily mode: use pre-generated rounds instead of fetching
    if (dailyModeRef.current && dailyRoundsRef.current?.[idx]) {
      const round = dailyRoundsRef.current[idx];
      const cat = round.category || CATEGORIES[idx % CATEGORIES.length];
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

    const diff = blitzModeRef.current ? (BLITZ_DIFFICULTY[idx] || 4) : (ROUND_DIFFICULTY[idx]||3);
    const cat = CATEGORIES[idx % CATEGORIES.length];
    setCategory(cat);
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch("/api/generate-round",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ category:cat, difficulty:diff, lang, mode: blitzModeRef.current ? "blitz" : "regular" }),
        signal: controller.signal,
      });
      const data = await res.json();
      const normalized = (data.statements||[]).map(s=>({
        text: String(s.text||""),
        real: s.real===true||s.real==="true",
      }));
      const lies = normalized.filter(s=>!s.real);
      console.log(`[fetchRound] idx=${idx} cat=${cat} diff=${diff} lang=${lang} lies=${lies.length}`);
      if(lies.length!==1) throw new Error("Bad lie count");
      const shuffled = shuffle(normalized);
      setStmts(shuffled);
      currentStmtsRef.current = shuffled;
      roundsPlayedRef.current[idx] = { statements: shuffled, category: cat };
    } catch(e) {
      console.warn("[fetchRound] fallback:", e.name === "AbortError" ? "timeout 9s" : e.message);
      setFetchError(true);
      const fb = shuffle(getFallback(blitzModeRef.current ? "blitz" : "regular"));
      setStmts(fb);
      currentStmtsRef.current = fb;
      roundsPlayedRef.current[idx] = { statements: fb, category: cat };
    } finally {
      clearTimeout(fetchTimeout);
      setLoadingRound(false);
    }
  }

  // ── TIMER ────────────────────────────────────────────────────
  function startTimer(diff) {
    clearInterval(timerRef.current);
    const maxT = TIMER_PER_DIFF[diff]||45;
    setTime(maxT);
    timerRef.current = setInterval(()=>{
      setTime(t=>{
        if(t<=1){ clearInterval(timerRef.current); return 0; }
        if(t===Math.floor(maxT*.45)) axiomSpeak("taunt_early","taunting"); // ~45% remaining
        if(t===10){ axiomSpeak("taunt_late","taunting"); haptic.timerWarning(); }
        if(t===5) haptic.timerWarning();
        if(t===3) haptic.timerWarning();
        return t-1;
      });
    },1000);
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
      setScore(s=>s+earned);
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
      setScore(s=>Math.max(0, s - penalty));
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
    setTotal(0);
    setStreak(0);
    setConfetti(false);
    setShareImg(null);
    setDuelId(null);
    setDuelCreating(false);
    roundsPlayedRef.current = [];
    resultsHistoryRef.current = [];
    gameStartTimeRef.current = Date.now();
    setCurrentWave(0);
    setShowWaveIntro(true);
    setTimeout(() => setShowWaveIntro(false), 1800);
    setFetchError(false);
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
        console.log(`[duel] already connecting/connected to ${roomId}, skipping duplicate`);
        return;
      }
      try { existing.close(); } catch {}
      duelSocketRef.current = null;
    }

    setDuelConnectionState("connecting");
    setDuelRetryAttempt(attempt);
    console.log(`[duel] connect attempt ${attempt}/${MAX_ATTEMPTS} to room ${roomId}`);

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
      console.log("[duel-debug] raw message:", e.data.slice(0, 300));
      try {
        const msg = JSON.parse(e.data);
        console.log("[duel-debug] parsed:", msg.type,
          msg.state ? `players=${Object.keys(msg.state.players || {}).length}` : "");
        handleDuelMessage(msg, ws);
      } catch (err) {
        console.error("[duel-debug] parse error:", err);
      }
    });

    ws.addEventListener("open", () => {
      opened = true;
      clearTimeout(connectionTimeout);
      setDuelConnectionState("connected");
      setDuelRetryAttempt(0);
      setMyDuelId(ws.id);
      console.log(`[duel] connected on attempt ${attempt}, ws.id=${ws.id}, room=${roomId}`);
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
      console.log("[duel] state update — players:",
        Object.keys(msg.state.players || {}),
        "phase:", msg.state.phase);
      setDuelPlayers(msg.state.players);
      setDuelPhase(msg.state.phase);
    }
    if (msg.type === "countdown") {
      setDuelCountdown(msg.seconds);
      let c = msg.seconds;
      const t = setInterval(() => {
        c--;
        setDuelCountdown(c);
        if (c <= 0) { clearInterval(t); setDuelCountdown(null); }
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
  function startGame() {
    userInteractedRef.current = true;
    AudioTension.init();
    clearInterval(timerRef.current);
    setMultiplier(1.0);
    multiplierRef.current = 1.0;
    setMultiplierLocked(null);
    milestonesFiredRef.current = new Set();
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
    setScore(0);
    setTotal(0);
    setStreak(0);
    setConfetti(false);
    setShareImg(null);
    setDuelId(null);
    setDuelCreating(false);
    roundsPlayedRef.current = [];
    resultsHistoryRef.current = [];
    gameStartTimeRef.current = Date.now();
    setCurrentWave(0);
    setShowWaveIntro(true);
    setTimeout(() => setShowWaveIntro(false), 1800);
    setFetchError(false);
    fetchRound(0);
    axiomSpeak("intro","idle");
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
            .then(() => alert("Duel link copied! 📋"))
            .catch(() => alert(url));
        }
      }
    } catch (e) {
      console.error("[duel create]", e);
      alert("Could not create duel. Please try again.");
    } finally {
      setDuelCreating(false);
    }
  }

  // ── RESULT ───────────────────────────────────────────────────
  function showResultScreen() {
    clearInterval(timerRef.current);
    setScreen("result");

    // Snapshot committed state once — avoids nested-updater race conditions
    const finalScore = score;
    const finalTotal = total;
    const finalBest  = best;
    const finalCorrect = correctCountRef.current;
    const won = finalCorrect >= Math.ceil(finalTotal * 0.67);

    if (dailyModeRef.current) submitDailyResult(finalScore, finalTotal);

    axiomSpeak(won ? "final_win" : "final_lose", won ? "defeated" : "taunting");
    if (won) { setConfetti(true); haptic.victory(); }

    // Share card — wait for AXIOM speech to land (~1s)
    setTimeout(() => {
      setAxiomSpeech(speech => {
        const img = generateShareCard(finalScore, finalTotal, finalBest, speech, won, correctCountRef.current, maxCashoutRef.current);
        setShareImg(img);
        return speech;
      });
    }, 1000);

    // Stories card + challenge URL
    setTimeout(() => {
      const lieStmt = currentStmtsRef.current.find(s => !s.real);
      const lieText = lieStmt?.text || "";
      setAxiomSpeech(speech => {
        const img = generateStoriesCard(finalScore, finalTotal, finalBest, speech, won, lieText, lastAxiomLine, correctCountRef.current, maxCashoutRef.current);
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
    fetch("/api/axiom-power")
      .then(r => r.json())
      .then(d => setAxiomPower(typeof d?.power === 'number' && !Number.isNaN(d.power) ? d.power : null))
      .catch(() => {});
    fetch("/api/slayer-event")
      .then(r => r.json())
      .then(d => setSlayerEvent(d))
      .catch(() => {});
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
    console.log(`[shop] Verifying ${skinPurchased} session=${sessionId} user=${currentUserId}`);

    fetch("/api/shop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "verify", skinId: skinPurchased, userId: currentUserId, sessionId }),
    })
    .then(r => r.json())
    .then(data => {
      console.log("[shop] Verify result:", data);
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
        alert("⚠️ Could not verify purchase. Contact support if charged.");
      }
    })
    .catch(err => {
      console.error("[shop] Verify fetch error:", err);
      alert("⚠️ Network error verifying purchase. Refresh the page.");
    });
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
      timerRef.current = setInterval(() => {
        setTime(t => {
          const next = t <= 1 ? 0 : t - 1;
          if (multiplierLocked === null) {
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
          if (t === 10) { axiomSpeak("taunt_late", "taunting"); haptic.timerWarning(); }
          if (t === 5) haptic.timerWarning();
          if (t === 3) haptic.timerWarning();
          return t - 1;
        });
      }, 1000);
    }
  }, [loadingRound, fetchError, stmts.length, revealed, roundIdx, blitzMode]);

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
      webApp.MainButton.onClick(isLast ? showResultScreen : nextRound);
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
  useEffect(()=>{
    if(!revealed){ clearTimeout(autoAdvanceRef.current); setAutoAdvanceCount(null); return; }
    let count=3;
    setAutoAdvanceCount(count);
    const tick=()=>{
      count--;
      if(count<=0){ setAutoAdvanceCount(null); if(roundIdx+1<(blitzMode ? BLITZ_ROUNDS : ROUND_DIFFICULTY.length)) nextRound(); else showResultScreen(); }
      else{ setAutoAdvanceCount(count); autoAdvanceRef.current=setTimeout(tick,750); }
    };
    autoAdvanceRef.current=setTimeout(tick, blitzMode ? 100 : 800);
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
    minHeight:"100vh",
    background:`radial-gradient(ellipse at 50% 0%,rgba(232,197,71,.05) 0%,${T.bg} 55%)`,
    fontFamily:"'Segoe UI',system-ui,sans-serif",
    display:"flex",flexDirection:"column",alignItems:"center",
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
    <div style={{minHeight:"100vh",background:"#04060f",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:"24px",color:"#e8e6e1",
      fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:11,letterSpacing:"4px",color:"rgba(232,197,71,.5)",marginBottom:8}}>
            DUEL MODE
          </div>
          <div style={{fontFamily:"Georgia,serif",fontSize:26,fontWeight:900,color:"#e8c547"}}>
            1v1 vs a friend
          </div>
        </div>

        {/* CREATE */}
        <div style={{marginBottom:20,padding:"20px",background:"rgba(232,197,71,.05)",
          border:"1px solid rgba(232,197,71,.2)",borderRadius:14}}>
          <div style={{fontSize:13,color:"#e8c547",fontWeight:700,marginBottom:10,letterSpacing:"2px"}}>
            CREATE
          </div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.5)",marginBottom:14,lineHeight:1.5}}>
            Start a room. Share the link with a friend.
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={() => openDuel("regular")}
              style={{flex:1,padding:"12px",fontSize:12,fontWeight:700,
                background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#04060f",
                border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit",
                letterSpacing:"1px",textTransform:"uppercase"}}>
              ⚔️ Regular
            </button>
            <button onClick={() => openDuel("blitz")}
              style={{flex:1,padding:"12px",fontSize:12,fontWeight:700,
                background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#04060f",
                border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit",
                letterSpacing:"1px",textTransform:"uppercase"}}>
              ⚡ Blitz
            </button>
          </div>
        </div>

        {/* JOIN */}
        <div style={{padding:"20px",background:"rgba(255,255,255,.03)",
          border:"1px solid rgba(255,255,255,.1)",borderRadius:14}}>
          <div style={{fontSize:13,color:"rgba(255,255,255,.9)",fontWeight:700,marginBottom:10,letterSpacing:"2px"}}>
            JOIN
          </div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.5)",marginBottom:14,lineHeight:1.5}}>
            Got a code? Enter it here.
          </div>
          <input
            placeholder="CODE"
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
              const code = document.getElementById("home-join-input").value.trim().toUpperCase();
              if (code.length === 6) joinDuel(code, "regular");
            }}
              style={{flex:1,padding:"12px",fontSize:12,fontWeight:700,
                background:"rgba(232,197,71,.12)",color:"#e8c547",
                border:"1px solid rgba(232,197,71,.3)",borderRadius:10,cursor:"pointer",
                fontFamily:"inherit",letterSpacing:"1px",textTransform:"uppercase"}}>
              Join Regular
            </button>
            <button onClick={() => {
              const code = document.getElementById("home-join-input").value.trim().toUpperCase();
              if (code.length === 6) joinDuel(code, "blitz");
            }}
              style={{flex:1,padding:"12px",fontSize:12,fontWeight:700,
                background:"rgba(232,197,71,.12)",color:"#e8c547",
                border:"1px solid rgba(232,197,71,.3)",borderRadius:10,cursor:"pointer",
                fontFamily:"inherit",letterSpacing:"1px",textTransform:"uppercase"}}>
              Join Blitz
            </button>
          </div>
        </div>

        <button onClick={() => setDuelScreen(null)}
          style={{marginTop:20,width:"100%",padding:"12px",fontSize:12,
            background:"transparent",color:"rgba(255,255,255,.4)",
            border:"1px solid rgba(255,255,255,.1)",borderRadius:10,cursor:"pointer",
            fontFamily:"inherit"}}>
          ← Back
        </button>
      </div>
      <GameStyles/>
    </div>
  );

  // ─── DUEL LOBBY ────────────────────────────────────────────
  if (duelScreen === "lobby") return (
    <div style={{minHeight:"100vh",background:"#04060f",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:"24px",color:"#e8e6e1",
      fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{width:"100%",maxWidth:420}}>
        {duelConnectionState === "connecting" && (
          <div style={{textAlign:"center",padding:"48px 20px",color:"rgba(255,255,255,.5)"}}>
            <div style={{fontSize:32,marginBottom:12,animation:"g-pulse 1s infinite"}}>🛰️</div>
            <div style={{fontSize:15,fontWeight:600}}>Connecting to duel server...</div>
            {duelRetryAttempt > 1 ? (
              <div style={{fontSize:11,marginTop:6,color:"#fb923c"}}>
                Attempt {duelRetryAttempt} of 3
              </div>
            ) : (
              <div style={{fontSize:11,marginTop:8,opacity:.6}}>This may take a few seconds</div>
            )}
          </div>
        )}

        {duelConnectionState === "failed" && (
          <div style={{textAlign:"center",padding:"24px"}}>
            <div style={{fontSize:32,marginBottom:8}}>⚠️</div>
            <div style={{color:"#f43f5e",fontWeight:600,marginBottom:12}}>Connection failed</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.5)",marginBottom:20,lineHeight:1.5}}>
              Couldn't reach duel server after 3 attempts.
              The server may be starting up — wait 10 seconds and try again.
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
              Back to home
            </button>
          </div>
        )}

        {duelConnectionState === "connected" && (<>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:11,letterSpacing:"4px",color:"rgba(232,197,71,.5)",marginBottom:8}}>
            {duelMode==="blitz"?"⚡ DUEL BLITZ":"⚔️ DUEL REGULAR"}
          </div>
          <div style={{fontFamily:"Georgia,serif",fontSize:36,fontWeight:900,color:"#e8c547"}}>
            {duelRoomId}
          </div>
          <div style={{fontSize:12,color:"rgba(255,255,255,.3)",marginTop:6,letterSpacing:"2px"}}>
            ROOM CODE
          </div>
          <button onClick={() => {
            const url = `https://playbluff.games/?duel=${duelRoomId}&mode=${duelMode}`;
            const text = `Duel me on BLUFF 🎭\n${url}`;
            if (navigator.share) {
              navigator.share({ title: "BLUFF Duel", text, url }).catch(() => {
                navigator.clipboard?.writeText(url).then(() => alert("Link copied to clipboard"));
              });
            } else {
              navigator.clipboard?.writeText(url)
                .then(() => alert("Link copied to clipboard"))
                .catch(() => prompt("Copy this link:", url));
            }
          }}
            style={{marginTop:14,padding:"12px 20px",fontSize:13,fontWeight:700,
              background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#04060f",
              border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit",
              letterSpacing:"1px",textTransform:"uppercase"}}>
            📨 Share duel link
          </button>
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
                {p.id === myDuelId ? "YOU" : "OPPONENT"}
              </div>
            </div>
            <div style={{marginLeft:"auto",fontSize:11,color:"#2dd4a0"}}>✓ READY</div>
          </div>
        ))}

        {Object.keys(duelPlayers).length < 2 && (
          <div style={{textAlign:"center",padding:"24px",animation:"g-pulse 1s infinite",
            color:"rgba(255,255,255,.3)",fontSize:13}}>
            Waiting for opponent...
          </div>
        )}

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
          Cancel
        </button>
        </>)}
      </div>
      <GameStyles/>
    </div>
  );

  // ─── DUEL PLAYING ──────────────────────────────────────────
  if (duelScreen === "playing" && duelRoundData) return (
    <div style={{minHeight:"100vh",background:"#04060f",display:"flex",flexDirection:"column",
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
            ⚡ OPPONENT'S FLAG FELL — Answer for 2× points!
          </div>
        )}

        <div style={{textAlign:"center",marginBottom:16}}>
          <h2 style={{fontFamily:"Georgia,serif",fontSize:"clamp(17px,4.5vw,22px)",fontWeight:800,
            margin:"0 0 4px",color:duelPhase==="round_result"?"rgba(255,255,255,.4)":"#fff"}}>
            {duelPhase==="round_result"?"Round over":"Which one is the BLUFF?"}
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
                      {isBluff?"🎭 BLUFF":i===myAnswer?.sel?"✗ Real":"✓ Real"}
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
            Waiting for opponent...
          </div>
        )}

        {duelPhase==="abandoned" && (
          <div style={{textAlign:"center",padding:20,color:"#f43f5e",fontSize:14}}>
            Opponent disconnected. Returning to home...
          </div>
        )}
      </div>
      <GameStyles/>
    </div>
  );

  // ─── DUEL RESULT ───────────────────────────────────────────
  if (duelScreen === "result") return (
    <div style={{minHeight:"100vh",background:"#04060f",display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:"24px",color:"#e8e6e1",
      fontFamily:"'Segoe UI',system-ui,sans-serif"}}>
      <div style={{width:"100%",maxWidth:420,textAlign:"center"}}>
        <div style={{fontSize:11,letterSpacing:"4px",color:"rgba(255,255,255,.3)",marginBottom:16}}>
          DUEL OVER
        </div>

        {duelIsTie ? (
          <div style={{marginBottom:24}}>
            <div style={{fontFamily:"Georgia,serif",fontSize:48,fontWeight:900,
              color:"#e8c547",marginBottom:8}}>
              IT'S A TIE
            </div>
            <div style={{fontSize:14,color:"rgba(255,255,255,.4)"}}>
              🤝 Equally matched deceivers
            </div>
          </div>
        ) : duelWinner && (
          <div style={{marginBottom:24}}>
            <div style={{fontFamily:"Georgia,serif",fontSize:48,fontWeight:900,
              color: duelWinner===myDuelId?"#e8c547":"#f43f5e",marginBottom:8}}>
              {duelWinner===myDuelId?"YOU WIN":"YOU LOSE"}
            </div>
            <div style={{fontSize:14,color:"rgba(255,255,255,.4)"}}>
              {duelWinner===myDuelId?"🏆 Opponent humiliated":"💀 AXIOM is disappointed in you"}
            </div>
          </div>
        )}

        {Object.values(duelPlayers).map((p)=>(
          <div key={p.id} style={{
            display:"flex",justifyContent:"space-between",alignItems:"center",
            padding:"14px 18px",marginBottom:8,
            background: p.id===duelWinner?"rgba(232,197,71,.1)":"rgba(255,255,255,.03)",
            border: p.id===duelWinner?"1px solid rgba(232,197,71,.3)":"1px solid rgba(255,255,255,.07)",
            borderRadius:12,
          }}>
            <div style={{fontWeight:700,fontSize:15}}>{p.id===myDuelId?"You":p.name}</div>
            <div style={{fontFamily:"Georgia,serif",fontSize:28,fontWeight:900,
              color:p.id===duelWinner?"#e8c547":"rgba(255,255,255,.5)"}}>
              {duelScores[p.id]||0}
            </div>
          </div>
        ))}

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
        }} style={{width:"100%",marginTop:20,padding:"16px",fontSize:14,fontWeight:700,
          background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#04060f",
          border:"none",borderRadius:14,cursor:"pointer",fontFamily:"inherit",
          letterSpacing:"1px",textTransform:"uppercase"}}>
          Play again
        </button>

        <button onClick={()=>{
          duelSocketRef.current?.close();
          setDuelScreen(null);
          setDuelPlayers({});
          setDuelScores({});
          setDuelWinner(null);
          setDuelIsTie(false);
          setDuelConnectionState("idle"); setDuelRetryAttempt(0);
        }} style={{width:"100%",marginTop:10,padding:"14px",fontSize:13,fontWeight:600,
          background:"transparent",color:"rgba(255,255,255,.5)",
          border:"1px solid rgba(255,255,255,.1)",borderRadius:12,cursor:"pointer",
          fontFamily:"inherit",letterSpacing:"1px"}}>
          Exit to home
        </button>
      </div>
      <GameStyles/>
    </div>
  );

  // ─── HOME ──────────────────────────────────────────────────
  if(screen==="home") return (
    <div style={wrap}>
      <Particles/>
      {BETA_MODE&&<div style={{position:"fixed",top:"max(12px,env(safe-area-inset-top))",right:16,fontSize:10,letterSpacing:"2px",color:"rgba(45,212,160,.75)",background:"rgba(45,212,160,.09)",border:"1px solid rgba(45,212,160,.22)",padding:"4px 10px",borderRadius:20,fontWeight:600,zIndex:10}}>β BETA</div>}
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:460,padding:"clamp(14px,4vw,22px)",paddingTop:"max(52px,env(safe-area-inset-top))"}}>
        <div style={{textAlign:"center",marginBottom:"clamp(18px,4vw,26px)",animation:"g-fadeUp .5s ease both"}}>
          <div style={{fontSize:"clamp(10px,2.5vw,11px)",letterSpacing:"6px",color:T.dim,marginBottom:14,fontWeight:500}}>SIAL GAMES</div>
          <h1 style={{fontFamily:"Georgia,serif",fontSize:"clamp(52px,13vw,78px)",fontWeight:900,letterSpacing:-2,margin:"0 0 4px",lineHeight:1,background:"linear-gradient(135deg,#e8c547,#f0d878,rgba(255,255,255,.5),#e8c547)",backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",animation:"g-shimmer 4s linear infinite",filter:"drop-shadow(0 0 22px rgba(232,197,71,.18))"}}>
            BLUFF<sup style={{fontSize:"clamp(11px,2.5vw,14px)",WebkitTextFillColor:"rgba(232,197,71,.5)",position:"relative",top:"clamp(-22px,-5vw,-30px)",marginLeft:2,fontFamily:"system-ui",fontWeight:400}}>™</sup>
          </h1>
          <p style={{fontSize:"clamp(10px,2.5vw,12px)",color:T.dim,letterSpacing:"4px",textTransform:"uppercase",margin:0,fontWeight:500}}>The AI Deception Game</p>
        </div>

        <LangPicker lang={lang} onChange={changeLang}/>

        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.07)",
          borderRadius:12, padding:"10px 14px", marginBottom:12,
        }}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:16}}>{voiceEnabled ? "🔊" : "🔇"}</span>
            <div>
              <div style={{fontSize:13,fontWeight:500,color:"#e8e6e1"}}>AXIOM Voice</div>
              <div style={{fontSize:11,color:"#5a5a68"}}>{voiceEnabled ? "ElevenLabs TTS active" : "Text only"}</div>
            </div>
          </div>
          <button
            onClick={() => {
              const next = !voiceEnabled;
              setVoiceEnabled(next);
              localStorage.setItem("bluff_voice", next ? "on" : "off");
              if (!next && audioRef.current) {
                audioRef.current.pause();
                isPlayingRef.current = false;
                audioQueueRef.current = [];
              }
            }}
            style={{
              width:44, height:24, borderRadius:12, cursor:"pointer",
              background: voiceEnabled ? "rgba(45,212,160,.3)" : "rgba(255,255,255,.08)",
              border: voiceEnabled ? "1px solid rgba(45,212,160,.5)" : "1px solid rgba(255,255,255,.1)",
              position:"relative", transition:"all .25s",
            }}>
            <div style={{
              width:16, height:16, borderRadius:"50%",
              background: voiceEnabled ? "#2dd4a0" : "#5a5a68",
              position:"absolute", top:3,
              left: voiceEnabled ? 22 : 4,
              transition:"all .25s",
            }}/>
          </button>
        </div>

        {challenge && (
          <div style={{
            background: "rgba(232,197,71,.08)",
            border: "1px solid rgba(232,197,71,.3)",
            borderRadius: 14, padding: "14px 16px",
            marginBottom: 14, animation: "g-fadeUp .4s ease both",
          }}>
            <div style={{ fontSize: 10, letterSpacing: "3px", color: "#e8c547", fontWeight: 700, marginBottom: 6, textTransform: "uppercase" }}>
              ⚔️ Challenge received
            </div>
            <div style={{ fontSize: "clamp(13px,3.5vw,15px)", color: "#e8e6e1", marginBottom: 8 }}>
              Your friend scored{" "}
              <span style={{ color: "#e8c547", fontWeight: 700, fontFamily: "Georgia,serif", fontSize: 18 }}>
                {challenge.s}/{challenge.t}
              </span>
              {" "}({challenge.t ? Math.round(challenge.s / challenge.t * 100) : 0}% accuracy).
              <br/>
              <span style={{ opacity: .7 }}>Can you beat them?</span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { setChallenge(null); startGame(); }}
                style={{ flex: 2, minHeight: 44, padding: "10px 14px", fontSize: 13, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: "linear-gradient(135deg,#e8c547,#d4a830)", color: "#04060f", borderRadius: 10, fontFamily: "inherit", cursor: "pointer", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)", animation: "g-btnShimmer 2.5s infinite" }}/>
                <span style={{ position: "relative" }}>Accept challenge</span>
              </button>
              <button
                onClick={() => setChallenge(null)}
                style={{ flex: 1, minHeight: 44, padding: "10px", fontSize: 13, fontWeight: 600, background: "transparent", color: "#5a5a68", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, fontFamily: "inherit", cursor: "pointer" }}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        <AxiomPanel mood={axiomMood} speech={axiomSpeech} loading={axiomLoading} compact={false}/>

        <div style={{background:T.glass,borderRadius:16,border:`1px solid ${T.gb}`,padding:"clamp(16px,4vw,22px)",marginBottom:14,animation:"g-fadeUp .5s .1s both"}}>
          <div style={{fontSize:"clamp(10px,2.5vw,11px)",color:T.gold,letterSpacing:"3px",textTransform:"uppercase",fontWeight:600,marginBottom:12}}>How to play</div>
          {["🧠 AI generates 4 surprising statements","🎭 One is a masterfully crafted LIE","⏱️ Find the BLUFF before AXIOM wins","🔥 Build streaks — beat the machine"].map((t,i)=>(
            <div key={i} style={{display:"flex",gap:10,marginBottom:i<3?10:0,fontSize:"clamp(13px,3.5vw,15px)",lineHeight:1.5,animation:`g-fadeUp .5s ${.15+i*.07}s both`}}>
              <span style={{fontSize:16,flexShrink:0}}>{t.slice(0,2)}</span>
              <span style={{opacity:.8}}>{t.slice(3)}</span>
            </div>
          ))}
        </div>

        {total>0&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14,animation:"g-fadeUp .5s .3s both"}}>
            {[[score.toLocaleString('en-US'),"Points",T.gold],[correctCount+"/"+total,"Correct",T.ok],[best+"🔥","Streak","#a78bfa"]].map(([v,l,c])=>(
              <div key={l} style={{background:T.glass,borderRadius:12,border:`1px solid ${T.gb}`,padding:"clamp(10px,3vw,14px) 6px",textAlign:"center"}}>
                <div style={{fontSize:"clamp(20px,6vw,28px)",fontWeight:800,color:c,fontFamily:"Georgia,serif"}}>{v}</div>
                <div style={{fontSize:9,color:T.dim,letterSpacing:"1px",textTransform:"uppercase",marginTop:3}}>{l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Blitz button */}
        <button onClick={startBlitz} style={{
          width:"100%",minHeight:48,padding:"13px",marginBottom:10,
          fontSize:"clamp(12px,3.5vw,15px)",fontWeight:700,letterSpacing:"1px",
          textTransform:"uppercase",
          background:"linear-gradient(135deg,rgba(244,63,94,.15),rgba(244,63,94,.05))",
          color:"#f43f5e",border:"1px solid rgba(244,63,94,.3)",
          borderRadius:16,fontFamily:"inherit",cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"center",gap:8,
          animation:"g-fadeUp .5s .38s both",
        }}>
          <span>⚡</span>
          <span>Blitz — 4 questions, 18 seconds</span>
        </button>

        {/* Duel button → mode-select */}
        <div style={{display:"flex",gap:8,marginBottom:10,animation:"g-fadeUp .5s .42s both"}}>
          <button onClick={()=>setDuelScreen("mode-select")} style={{
            flex:1,minHeight:48,padding:"13px",
            fontSize:"clamp(11px,3vw,13px)",fontWeight:700,letterSpacing:"1px",
            textTransform:"uppercase",
            background:"rgba(232,197,71,.06)",color:"#e8c547",
            border:"1px solid rgba(232,197,71,.2)",
            borderRadius:14,fontFamily:"inherit",cursor:"pointer",
          }}>
            ⚔️ Duel a Friend
          </button>
        </div>

        {tg.isInsideTelegram && (
          <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"center",marginBottom:12,fontSize:11,color:"rgba(41,182,246,.45)",letterSpacing:"1px"}}>
            <span>✈️</span><span>Running inside Telegram</span>
          </div>
        )}

        {axiomPower !== null && !Number.isNaN(axiomPower) && (
          <div style={{
            background:"rgba(4,6,15,.8)",border:"1px solid rgba(34,211,238,.15)",
            borderRadius:14,padding:"12px 16px",marginBottom:14,
          }}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
              <div style={{fontSize:10,letterSpacing:"3px",color:"rgba(34,211,238,.6)",fontWeight:700}}>
                AXIOM POWER
              </div>
              <div style={{fontSize:11,fontWeight:700,
                color:axiomPower<200?"#f43f5e":axiomPower<500?"#fb923c":"#22d3ee"}}>
                {Math.round(axiomPower)}/1000
              </div>
            </div>
            <div style={{height:6,background:"rgba(255,255,255,.06)",borderRadius:3,overflow:"hidden"}}>
              <div style={{
                height:"100%",borderRadius:3,transition:"width 1s ease",
                width:`${(axiomPower/1000)*100}%`,
                background:axiomPower<200
                  ?"linear-gradient(90deg,#f43f5e,#fb923c)"
                  :axiomPower<500
                  ?"linear-gradient(90deg,#fb923c,#e8c547)"
                  :"linear-gradient(90deg,#22d3ee,#0891b2)",
              }}/>
            </div>
            <div style={{fontSize:10,color:"rgba(255,255,255,.25)",marginTop:6}}>
              {axiomPower <= 0
                ? "⚡ AXIOM is weakened — Slayer Event OPEN"
                : axiomPower < 100
                ? "🔴 AXIOM is nearly defeated"
                : axiomPower < 300
                ? "🟠 AXIOM is struggling"
                : "Every win chips away at AXIOM's power"}
            </div>
          </div>
        )}

        {slayerEvent?.isOpen && (
          <div style={{
            background:"linear-gradient(135deg,rgba(244,63,94,.12),rgba(251,146,60,.08))",
            border:"1px solid rgba(244,63,94,.4)",borderRadius:16,
            padding:"16px",marginBottom:14,position:"relative",overflow:"hidden",
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
              <button
                onClick={() => {
                  fetch("/api/slayer-event", {
                    method: "POST",
                    headers: {"Content-Type":"application/json"},
                    body: JSON.stringify({ action: "enter", userId: localStorage.getItem("bluff_user_id") }),
                  }).then(r => r.json()).then(d => { if (d.url) window.location.href = d.url; }).catch(()=>{});
                }}
                style={{width:"100%",padding:"12px",fontSize:13,fontWeight:700,
                  background:"linear-gradient(135deg,#f43f5e,#d4294a)",color:"#fff",
                  border:"none",borderRadius:10,cursor:"pointer",fontFamily:"inherit",letterSpacing:"1px"}}>
                ⚡ Enter for €0.99
              </button>
            )}
          </div>
        )}

        <button onClick={() => {
            userInteractedRef.current = true;
            const silent = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARAAAAAgABAAIAZGF0YQQAAAAAAA==");
            silent.play().catch(()=>{});
            startGame();
          }} style={{width:"100%",minHeight:52,padding:"clamp(14px,3.5vw,17px)",fontSize:"clamp(13px,3.5vw,15px)",fontWeight:700,letterSpacing:"2px",textTransform:"uppercase",background:"linear-gradient(135deg,#e8c547,#d4a830)",color:T.bg,borderRadius:16,position:"relative",overflow:"hidden",boxShadow:"0 0 36px rgba(232,197,71,.14)",animation:"g-fadeUp .5s .4s both",transition:"transform .15s"}}
          onMouseDown={e=>e.currentTarget.style.transform="scale(.97)"} onMouseUp={e=>e.currentTarget.style.transform=""}
          onTouchStart={e=>e.currentTarget.style.transform="scale(.97)"} onTouchEnd={e=>e.currentTarget.style.transform=""}>
          <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)",animation:"g-btnShimmer 3s infinite"}}/>
          <span style={{position:"relative"}}>{total>0?"⚔️ Challenge AXIOM again":"⚔️ Challenge AXIOM"}</span>
        </button>
        <button
          onClick={() => setShowShop(true)}
          style={{width:"100%",minHeight:48,padding:"13px",marginTop:10,
            fontSize:"clamp(12px,3.5vw,14px)",fontWeight:600,letterSpacing:"1px",
            textTransform:"uppercase",background:"rgba(255,255,255,.03)",
            color:"#5a5a68",border:"1px solid rgba(255,255,255,.07)",
            borderRadius:16,fontFamily:"inherit",cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
          <span style={{fontSize:16}}>🎭</span>
          <span>AXIOM Skins</span>
          {ownedSkins.length <= 1 &&
            <span style={{fontSize:10,padding:"2px 7px",background:"rgba(232,197,71,.12)",
              color:"#e8c547",borderRadius:10,letterSpacing:"1px"}}>NEW</span>
          }
        </button>
        <div style={{marginTop:20,textAlign:"center",fontSize:10,color:"rgba(255,255,255,.1)",letterSpacing:"1px"}}>playbluff.games · SIAL Consulting d.o.o.</div>
      </div>

      {showShop && (
        <div style={{position:"fixed",inset:0,zIndex:500,
          background:"rgba(4,6,15,.95)",backdropFilter:"blur(8px)",
          overflowY:"auto",padding:"24px 16px 48px"}}>
          <div style={{maxWidth:460,margin:"0 auto"}}>
            <div style={{display:"flex",justifyContent:"space-between",
              alignItems:"center",marginBottom:20,paddingTop:"max(12px,env(safe-area-inset-top))"}}>
              <div>
                <div style={{fontFamily:"Georgia,serif",fontSize:22,fontWeight:900,color:"#e8c547"}}>AXIOM Skins</div>
                <div style={{fontSize:11,color:"#5a5a68",letterSpacing:"2px"}}>Choose your villain's voice</div>
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
                            console.log(`[shop] Checkout ${skin.id} user=${currentUserId}`);
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
                                alert(`❌ ${data.error || "Shop unavailable. Try again."}`);
                              }
                            })
                            .catch(err => {
                              console.error("[shop] Checkout error:", err);
                              alert("❌ Network error. Check connection and try again.");
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
              💀 Hall of Shame →
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
                  alert("❌ Restore failed. Try again.");
                }
              }}
              style={{display:"block",width:"100%",textAlign:"center",marginTop:10,
                padding:"10px",fontSize:12,color:"rgba(255,255,255,.2)",
                background:"transparent",border:"1px solid rgba(255,255,255,.06)",
                borderRadius:10,fontFamily:"inherit",cursor:"pointer"}}>
              Restore purchases
            </button>
          </div>
        </div>
      )}

      <GameStyles/>
    </div>
  );

  // ─── PLAY ──────────────────────────────────────────────────
  if(screen==="play") return (
    <div style={wrap}>
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
      {!revealed&&time<=3&&<div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:50,background:"rgba(244,63,94," + (0.08 + (3-time)*0.07) + ")",animation:"g-pulse .4s ease-in-out infinite",transition:"background .5s"}}/>}
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:460,padding:"clamp(14px,4vw,22px)"}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,paddingTop:"max(12px,env(safe-area-inset-top))"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <CategoryIcon category={category} size={22}/>
            <div>
              <div style={{fontSize:10,color:T.gold,letterSpacing:"3px",textTransform:"uppercase",fontWeight:600}}>{category}</div>
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
          <div style={{textAlign:"center",padding:"40px 0",color:T.dim,fontSize:14}}>
            <div style={{animation:"g-pulse 1s infinite",marginBottom:8,fontSize:22}}>🤖</div>
            AXIOM is preparing your deception...
          </div>
        ):fetchError?(
          <div style={{textAlign:"center",padding:"40px 20px"}}>
            <div style={{fontSize:32,marginBottom:12}}>⚠️</div>
            <div style={{color:"rgba(255,255,255,.5)",marginBottom:16,fontSize:14}}>AXIOM is unreachable.</div>
            <button onClick={()=>{
              const d = blitzMode ? (BLITZ_DIFFICULTY[roundIdx] || 4) : (ROUND_DIFFICULTY[roundIdx] || 3);
              setMultiplier(1.0);
              multiplierRef.current = 1.0;
              setMultiplierLocked(null);
              milestonesFiredRef.current = new Set();
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
              {revealed?(correct?"You found it! 🎯":"AXIOM won this one 🎭"):"Which one is the BLUFF?"}
            </h2>
            <p style={{fontSize:"clamp(10px,2.5vw,12px)",color:T.dim,margin:0}}>
              {revealed?(correct?"Your instincts beat the machine":"The fabricated lie is highlighted below"):"One statement was invented by AI."}
            </p>
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:14,animation:revealed&&!correct?"g-shake .5s":"none"}}>
            {stmts.map((s,i)=>{
              const isB=!s.real,isS=sel===i;
              let bg=T.card,border=T.gb,anim="";
              if(!revealed&&isS){bg=T.goldDim;border="rgba(232,197,71,.4)";}
              if(revealed&&isB){bg="rgba(244,63,94,.07)";border="rgba(244,63,94,.4)";anim="g-glow .8s";}
              if(revealed&&isS&&correct){bg="rgba(45,212,160,.07)";border="rgba(45,212,160,.4)";anim="g-correctGlow .8s";}
              return (
                <button key={i} onClick={()=>handleCardSelect(i)} style={{width:"100%",display:"flex",alignItems:"flex-start",gap:10,background:bg,border:`1.5px solid ${border}`,borderRadius:16,padding:"clamp(11px,3vw,14px)",cursor:revealed?"default":"pointer",transition:"all .22s ease",textAlign:"left",color:"#e8e6e1",fontSize:"clamp(13px,3.5vw,15px)",lineHeight:1.55,fontFamily:"inherit",minHeight:52,animation:`g-cardIn .3s ${i*.055}s both, ${anim}`}}>
                  <div style={{width:"clamp(24px,6vw,28px)",height:"clamp(24px,6vw,28px)",borderRadius:"50%",flexShrink:0,border:`2px solid ${isS&&!revealed?T.gold:revealed&&isB?T.bad:T.gb}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,marginTop:2,background:isS&&!revealed?T.gold:revealed&&isB?"rgba(244,63,94,.18)":"transparent",color:isS&&!revealed?T.bg:revealed&&isB?T.bad:T.dim,transition:"all .25s"}}>
                    {revealed&&isB?"!":String.fromCharCode(65+i)}
                  </div>
                  <div style={{flex:1}}>
                    {s.text}
                    {revealed&&<div style={{marginTop:6,fontSize:10,fontWeight:700,letterSpacing:"1.5px",color:isB?T.bad:isS?T.bad:T.ok,opacity:isB||isS?1:.4}}>
                      {isB?"🎭 AI FABRICATION":isS?"✗ This is actually real":"✓ Verified fact"}
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
            ?<button
              onClick={() => { if (sel !== null) { haptic.lockIn(); AudioTension.lockIn(); doReveal(); }}}
              disabled={sel === null}
              style={{
                width: "100%",
                minHeight: 52,
                padding: "clamp(14px,3.5vw,16px)",
                fontSize: "clamp(13px,3.5vw,15px)",
                fontWeight: 700,
                letterSpacing: "1.5px",
                textTransform: "uppercase",
                background: sel !== null ? "linear-gradient(135deg,#e8c547,#d4a830)" : T.card,
                color: sel !== null ? T.bg : T.dim,
                border: sel !== null ? "none" : `1.5px solid ${T.gb}`,
                borderRadius: 16,
                cursor: sel !== null ? "pointer" : "not-allowed",
                transition: "all .25s",
                fontFamily: "inherit",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {sel !== null && multiplier > 1.05 && (
                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                    animation: multiplier >= 3.0 ? "cashoutPulse 0.8s ease-in-out infinite" : "none",
                  }}
                >
                  <rect
                    x="1" y="1" width="98" height="98" rx="12" ry="12"
                    fill="none"
                    stroke={getRingColor(multiplier)}
                    strokeWidth="2"
                    strokeDasharray={`${((multiplier - 1) / 2.5) * 392} 392`}
                    style={{ transition: "stroke-dasharray 0.3s ease, stroke 0.5s ease" }}
                  />
                </svg>
              )}
              <span style={{ position: "relative", zIndex: 1 }}>
                {sel === null
                  ? "Select a statement"
                  : multiplier > 1.05
                    ? `🔒 Lock in @ ${multiplier.toFixed(1)}x 💰`
                    : "🔒 Lock in answer"}
              </span>
            </button>
            :<div style={{display:"flex",gap:10}}>
              <button onClick={()=>{clearInterval(timerRef.current);clearTimeout(autoAdvanceRef.current);setAutoAdvanceCount(null);setScreen("home");}} style={{flex:1,minHeight:52,padding:14,fontSize:"clamp(13px,3.5vw,15px)",fontWeight:600,background:T.glass,color:"#e8e6e1",border:`1.5px solid ${T.gb}`,borderRadius:12,fontFamily:"inherit"}}>Home</button>
              <button onClick={()=>{clearTimeout(autoAdvanceRef.current);setAutoAdvanceCount(null);if(roundIdx+1<(blitzMode?BLITZ_ROUNDS:ROUND_DIFFICULTY.length)) nextRound(); else showResultScreen();}} style={{flex:2,minHeight:52,padding:14,fontSize:"clamp(13px,3.5vw,15px)",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",background:"linear-gradient(135deg,#e8c547,#d4a830)",color:T.bg,borderRadius:12,fontFamily:"inherit",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
                <span style={{position:"relative"}}>{autoAdvanceCount!=null?(roundIdx+1<(blitzMode?BLITZ_ROUNDS:ROUND_DIFFICULTY.length)?`Next in ${autoAdvanceCount}...`:`Results in ${autoAdvanceCount}...`):(roundIdx+1<(blitzMode?BLITZ_ROUNDS:ROUND_DIFFICULTY.length)?"Next round →":"See results →")}</span>
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

          {/* Wave progress dots */}
          <div style={{display:"flex",justifyContent:"center",gap:5,marginTop:10,marginBottom:4}}>
            {Array.from({length:12},(_,i)=>(
              <div key={i} style={{width:i===roundIdx?8:5,height:i===roundIdx?8:5,borderRadius:"50%",transition:"all .2s",background:i<roundIdx?"rgba(255,255,255,.45)":i===roundIdx?WAVE_COLORS[getWave(i)]:"rgba(255,255,255,.1)",marginTop:i===roundIdx?-1.5:0}}/>
            ))}
          </div>
          <div style={{display:"flex",justifyContent:"center",gap:"clamp(12px,4vw,18px)",marginTop:12,fontSize:"clamp(10px,2.5vw,12px)",color:T.dim}}>
            <span>Points <b style={{color:T.gold,fontSize:13}}>{score.toLocaleString('en-US')}</b></span>
            <span style={{opacity:.2}}>|</span>
            <span>Hits <b style={{color:T.gold,fontSize:13}}>{correctCount}/{total}</b></span>
            <span style={{opacity:.2}}>|</span>
            <span>Streak <b style={{color:streak>0?T.gold:T.dim,fontSize:13}}>{streak}🔥</b></span>
          </div>
        </>)}
      </div>
      <GameStyles/>
    </div>
  );

  // ─── RESULT ────────────────────────────────────────────────
  const won = correctCount >= Math.ceil(total * 0.67);
  return (
    <div style={wrap}>
      <Particles/>
      {confetti&&<Confetti/>}
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:460,padding:"clamp(14px,4vw,22px)",paddingTop:"max(36px,env(safe-area-inset-top))"}}>
        <AxiomPanel mood={axiomMood} speech={axiomSpeech} loading={axiomLoading} compact={false}/>
        <div style={{background:T.glass,borderRadius:16,border:`1px solid ${T.gb}`,padding:"clamp(18px,4vw,24px)",marginBottom:16,textAlign:"center",animation:"g-fadeUp .5s .2s both"}}>
          <div style={{fontSize:48,marginBottom:8}}>{won?"🏆":"💀"}</div>
          <h2 style={{fontFamily:"Georgia,serif",fontSize:"clamp(18px,4.5vw,22px)",fontWeight:800,margin:"0 0 4px",color:won?T.gold:T.bad}}>{won?"You beat AXIOM!":"AXIOM wins... this time."}</h2>
          <p style={{fontSize:"clamp(10px,2.5vw,12px)",color:T.dim,margin:"0 0 16px"}}>{won?"Impressive. AXIOM did not expect this.":"Train harder. AXIOM is patient."}</p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
            {[[score.toLocaleString('en-US'),"Points",T.gold],[correctCount+"/"+total,`Accuracy ${total?Math.round(correctCount/total*100):0}%`,T.ok],[best+"🔥","Streak","#a78bfa"]].map(([v,l,c])=>(
              <div key={l} style={{background:"#07070e",borderRadius:10,border:`1px solid ${T.gb}`,padding:"12px 6px"}}>
                <div style={{fontSize:22,fontWeight:800,color:c,fontFamily:"Georgia,serif"}}>{v}</div>
                <div style={{fontSize:9,color:T.dim,letterSpacing:"1px",textTransform:"uppercase",marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        </div>
        {/* Daily result summary */}
        {dailyMode && (
          <div style={{background:"rgba(45,212,160,.06)",border:"1px solid rgba(45,212,160,.25)",borderRadius:14,padding:"14px 16px",marginBottom:16,animation:"g-fadeUp .5s .35s both"}}>
            <div style={{fontSize:10,letterSpacing:"3px",color:"rgba(45,212,160,.7)",fontWeight:700,marginBottom:10,textTransform:"uppercase"}}>
              📅 Daily Challenge Complete
            </div>
            <div style={{fontSize:24,letterSpacing:3,textAlign:"center",marginBottom:10}}>
              {dailyResultsRef.current.map(r => r ? "🟩" : "🟥").join("")}
            </div>
            {dailyRank ? (
              <div style={{textAlign:"center",fontSize:14,color:"rgba(255,255,255,.55)",marginBottom:10}}>
                You ranked{" "}
                <span style={{color:"#e8c547",fontWeight:800,fontSize:20,fontFamily:"Georgia,serif"}}>#{dailyRank}</span>
                {dailyPlayers > 0 && <span style={{color:"rgba(255,255,255,.35)"}}> of {dailyPlayers} players</span>}
              </div>
            ) : (
              <div style={{textAlign:"center",fontSize:12,color:"rgba(255,255,255,.3)",marginBottom:10}}>Submitting score...</div>
            )}
            <button
              onClick={() => {
                const grid = dailyResultsRef.current.map(r => r ? "🟩" : "🟥").join("");
                const rankStr = dailyRank ? ` · #${dailyRank}/${dailyPlayers}` : "";
                const scoreFmt = score.toLocaleString('en-US');
                const text = `BLUFF™ Daily #${dailyData?.dayNum ?? ""}\n${grid}\n${scoreFmt} pts · ${correctCount}/${total}${rankStr}\nplaybluff.games`;
                if (navigator.share) navigator.share({ text }).catch(() => navigator.clipboard?.writeText(text));
                else navigator.clipboard?.writeText(text).then(() => alert("Copied! 📋")).catch(() => alert(text));
              }}
              style={{width:"100%",minHeight:44,padding:"10px 14px",fontSize:13,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",background:"rgba(45,212,160,.1)",color:"#2dd4a0",border:"1px solid rgba(45,212,160,.3)",borderRadius:10,fontFamily:"inherit",cursor:"pointer"}}>
              📤 Share daily result
            </button>
          </div>
        )}

        {/* Blitz result */}
        {blitzMode && (
          <div style={{textAlign:"center",marginBottom:16,padding:"12px",
            background:"rgba(244,63,94,.08)",border:"1px solid rgba(244,63,94,.2)",
            borderRadius:12,animation:"g-fadeUp .5s .35s both"}}>
            <div style={{fontSize:11,letterSpacing:"3px",color:"#f43f5e",marginBottom:4}}>⚡ BLITZ RESULT</div>
            <div style={{fontFamily:"Georgia,serif",fontSize:48,fontWeight:900,color:"#f43f5e"}}>{correctCount}/4</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.55)",marginTop:2,fontFamily:"Georgia,serif"}}>{score.toLocaleString('en-US')} pts</div>
            <div style={{fontSize:12,color:"rgba(255,255,255,.4)",marginTop:4}}>
              {correctCount===4?"AXIOM demolished. 🔥":correctCount>=3?"Sharp. Very sharp.":correctCount>=2?"Decent.":"AXIOM wins."}
            </div>
          </div>
        )}

        {/* Share section */}
        <div style={{ marginBottom: 16, animation: "g-fadeUp .6s .5s both" }}>

          {/* Stories card */}
          <div style={{ fontSize: 10, letterSpacing: "3px", color: "rgba(255,255,255,.2)", textTransform: "uppercase", marginBottom: 10 }}>
            📸 Instagram Stories
          </div>
          {storiesImg ? (
            <div style={{ marginBottom: 14 }}>
              <img
                src={storiesImg}
                alt="Stories card"
                style={{ width: "50%", maxWidth: 180, borderRadius: 12, border: "1px solid rgba(255,255,255,.07)", marginBottom: 10, display: "block", margin: "0 auto 10px" }}
              />
              <a
                href={storiesImg}
                download="bluff-story.png"
                style={{ display: "block", width: "100%", minHeight: 48, padding: 14, fontSize: "clamp(13px,3.5vw,14px)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: "linear-gradient(135deg,rgba(131,58,180,.5),rgba(253,29,29,.5),rgba(252,176,69,.5))", color: "#fff", border: "1px solid rgba(255,255,255,.15)", borderRadius: 12, textAlign: "center", textDecoration: "none", fontFamily: "inherit" }}>
                📸 Save for Stories
              </a>
            </div>
          ) : (
            <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 12, padding: 14, textAlign: "center", fontSize: 13, color: "rgba(255,255,255,.3)", marginBottom: 14 }}>
              Generating...
            </div>
          )}

          {/* Challenge link */}
          <div style={{ fontSize: 10, letterSpacing: "3px", color: "rgba(255,255,255,.2)", textTransform: "uppercase", marginBottom: 10 }}>
            ⚔️ Challenge a friend
          </div>
          {challengeURL ? (
            <button
              onClick={() => {
                if (navigator.share) {
                  navigator.share({
                    title: "BLUFF™ — Can you beat me?",
                    text: won
                      ? `Crushed AXIOM with ${score.toLocaleString('en-US')} points. ${correctCount}/${total} reads. Think you can do better? 🎯`
                      : `AXIOM got me with ${score.toLocaleString('en-US')} points. ${correctCount}/${total} reads. Think you can do better? 🎭`,
                    url: challengeURL,
                  }).catch(() => {
                    navigator.clipboard?.writeText(challengeURL);
                    alert("Link copied! Share it with a friend.");
                  });
                } else {
                  navigator.clipboard?.writeText(challengeURL)
                    .then(() => alert("Challenge link copied! 📋"))
                    .catch(() => alert(challengeURL));
                }
              }}
              style={{ width: "100%", minHeight: 48, padding: 14, fontSize: "clamp(13px,3.5vw,14px)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: "rgba(34,211,238,.08)", color: "#22d3ee", border: "1px solid rgba(34,211,238,.25)", borderRadius: 12, fontFamily: "inherit", cursor: "pointer" }}>
              ⚔️ Send challenge link
            </button>
          ) : (
            <div style={{ background: "rgba(34,211,238,.04)", border: "1px solid rgba(34,211,238,.1)", borderRadius: 12, padding: 14, textAlign: "center", fontSize: 13, color: "rgba(34,211,238,.3)" }}>
              Generating...
            </div>
          )}

          {/* DUEL — same questions, head-to-head */}
          {!dailyMode && roundsPlayedRef.current.filter(Boolean).length >= ROUND_DIFFICULTY.length && (
            <>
              <div style={{ fontSize: 10, letterSpacing: "3px", color: "rgba(255,255,255,.2)", textTransform: "uppercase", marginTop: 14, marginBottom: 10 }}>
                ⚔️ Duel — same rounds, head to head
              </div>
              {!duelId && (
                <input
                  value={duelName}
                  onChange={e => setDuelName(e.target.value)}
                  placeholder="Your name for the duel..."
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
                        .then(() => alert("Duel link copied! 📋"))
                        .catch(() => alert(url));
                    }
                  }}
                  style={{ width: "100%", minHeight: 48, padding: 14, fontSize: "clamp(13px,3.5vw,14px)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: "rgba(232,197,71,.1)", color: "#e8c547", border: "1px solid rgba(232,197,71,.3)", borderRadius: 12, fontFamily: "inherit", cursor: "pointer" }}>
                  📋 Share duel link
                </button>
              ) : (
                <button
                  onClick={handleCreateDuel}
                  disabled={duelCreating}
                  style={{ width: "100%", minHeight: 48, padding: 14, fontSize: "clamp(13px,3.5vw,14px)", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", background: duelCreating ? T.glass : "rgba(232,197,71,.08)", color: duelCreating ? T.dim : "#e8c547", border: `1px solid ${duelCreating ? T.gb : "rgba(232,197,71,.3)"}`, borderRadius: 12, fontFamily: "inherit", cursor: duelCreating ? "not-allowed" : "pointer" }}>
                  {duelCreating ? "Creating duel..." : "⚔️ Challenge to a Duel"}
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
              ✈️ Share in Telegram chat
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
            ✈️ Send to Telegram
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
              💀 Submit to Hall of Shame?
            </div>
            <div style={{fontSize:13,color:"rgba(255,255,255,.5)",marginBottom:10,lineHeight:1.5}}>
              AXIOM will write an anonymous funny entry about your mistake.
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
                💀 Submit
              </button>
              <button
                onClick={() => setLastWrongStmt(null)}
                style={{flex:1,minHeight:44,padding:10,fontSize:13,fontWeight:600,
                  background:"transparent",color:"#5a5a68",
                  border:"1px solid rgba(255,255,255,.07)",borderRadius:10,
                  fontFamily:"inherit",cursor:"pointer"}}>
                Nope
              </button>
            </div>
          </div>
        )}
        {shameSent && (
          <div style={{textAlign:"center",fontSize:13,color:"rgba(244,63,94,.5)",
            marginBottom:16,padding:"12px",animation:"g-fadeUp .3s ease both"}}>
            💀 Submitted. playbluff.games/shame
          </div>
        )}

        <div style={{display:"flex",gap:10,animation:"g-fadeUp .6s .6s both"}}>
          <button onClick={()=>setScreen("home")} style={{flex:1,minHeight:52,padding:14,fontSize:"clamp(13px,3.5vw,15px)",fontWeight:600,background:T.glass,color:"#e8e6e1",border:`1.5px solid ${T.gb}`,borderRadius:12,fontFamily:"inherit"}}>Home</button>
          <button onClick={startGame} style={{flex:2,minHeight:52,padding:14,fontSize:"clamp(13px,3.5vw,15px)",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",background:"linear-gradient(135deg,#e8c547,#d4a830)",color:T.bg,borderRadius:12,fontFamily:"inherit",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
            <span style={{position:"relative"}}>⚔️ Rematch</span>
          </button>
        </div>
      </div>
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
    @keyframes axiomPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
    @keyframes ic-blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(0.05)}}
  `}</style>;
}

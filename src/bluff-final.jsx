import { useState, useEffect, useRef, useCallback } from "react";

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
  "history","internet","animals","science","popculture",
  "geography","food","culture","sports","history",
];
const CATEGORY_EMOJIS = {
  history:"🏛️", science:"🔬", animals:"🦎", geography:"🌍",
  food:"🍷", culture:"🎭", internet:"💻", popculture:"🎬", sports:"⚽",
};
// Round 1 = difficulty 0 (baby mode), gradual ramp
const ROUND_DIFFICULTY = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5];
const TIMER_PER_DIFF = { 0:50, 1:50, 2:55, 3:65, 4:80, 5:95 };
const DIFF_LABEL = ["","Warm-up","Easy","Sneaky","Devious","Diabolical"];
const DIFF_COLOR = ["","#2dd4a0","#a3e635","#fb923c","#f43f5e","#a855f7"];

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
  const s = v => Math.round(v * sc);
  const fid = `gc-${uid}`, cid = `hc-${uid}`;
  const Mouth = m.mouth.type === "line" ? <line {...m.mouth.p}/> : <path {...m.mouth.p}/>;

  return (
    <div style={{position:"relative",width:size,height:size,flexShrink:0}}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{position:"absolute",inset:0,animation:"hexRotate 13s linear infinite"}}>
        <polygon points={`${s(100)},${s(8)} ${s(186)},${s(52)} ${s(186)},${s(148)} ${s(100)},${s(192)} ${s(14)},${s(148)} ${s(14)},${s(52)}`}
          fill="none" stroke="rgba(34,211,238,.1)" strokeWidth="1.5" strokeDasharray="5 4"/>
      </svg>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{position:"absolute",inset:0,animation:"hexRotateCCW 9s linear infinite"}}>
        <polygon points={`${s(100)},${s(20)} ${s(174)},${s(62)} ${s(174)},${s(138)} ${s(100)},${s(180)} ${s(26)},${s(138)} ${s(26)},${s(62)}`}
          fill="none" stroke="rgba(34,211,238,.15)" strokeWidth="1" strokeDasharray="2 5"/>
      </svg>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{position:"absolute",inset:0}}>
        <defs>
          <filter id={fid}><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <clipPath id={cid}><polygon points={`${s(100)},${s(32)} ${s(168)},${s(70)} ${s(168)},${s(148)} ${s(100)},${s(186)} ${s(32)},${s(148)} ${s(32)},${s(70)}`}/></clipPath>
        </defs>
        <polygon points={`${s(100)},${s(32)} ${s(168)},${s(70)} ${s(168)},${s(148)} ${s(100)},${s(186)} ${s(32)},${s(148)} ${s(32)},${s(70)}`}
          fill="#030810" stroke={m.eye} strokeWidth={size>80?2:1.5} filter={`url(#${fid})`}/>
        <ellipse cx={s(82)} cy={s(94)} rx={s(15)} ry={s(11)} fill="rgba(2,6,16,.95)" stroke="rgba(34,211,238,.2)" strokeWidth="1"/>
        <ellipse cx={s(118)} cy={s(94)} rx={s(15)} ry={s(11)} fill="rgba(2,6,16,.95)" stroke="rgba(34,211,238,.2)" strokeWidth="1"/>
        <circle cx={s(82)} cy={s(94)} r={Math.round(m.er*sc*.85)} fill={m.eye} filter={`url(#${fid})`}/>
        <circle cx={s(118)} cy={s(94)} r={Math.round(m.er*sc*.85)} fill={m.eye} filter={`url(#${fid})`}/>
        <circle cx={s(82)} cy={s(94)} r={Math.max(1,Math.round(2.2*sc))} fill="#030810"/>
        <circle cx={s(118)} cy={s(94)} r={Math.max(1,Math.round(2.2*sc))} fill="#030810"/>
        <g transform={`scale(${sc})`}>{Mouth}</g>
        <line x1={s(m.bl.x1)} y1={s(m.bl.y1)} x2={s(m.bl.x2)} y2={s(m.bl.y2)} stroke="rgba(34,211,238,.35)" strokeWidth="1.5" strokeLinecap="round"/>
        <line x1={s(m.br.x1)} y1={s(m.br.y1)} x2={s(m.br.x2)} y2={s(m.br.y2)} stroke="rgba(34,211,238,.35)" strokeWidth="1.5" strokeLinecap="round"/>
        <rect x={s(32)} y={s(32)} width={s(136)} height="2" fill={m.eye} opacity=".04" clipPath={`url(#${cid})`} style={{animation:"scanDown 3s linear infinite"}}/>
      </svg>
      <div style={{position:"absolute",bottom:size>80?10:2,right:size>80?10:2,
        width:size>80?12:8,height:size>80?12:8,borderRadius:"50%",
        background:m.dot,border:"2px solid #04060f",
        boxShadow:`0 0 7px ${m.dot}`,animation:"axiomPulse 2s infinite",transition:"all .4s"}}/>
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

function generateShareCard(score,total,best,speech,won) {
  try {
    const c=document.createElement("canvas");
    c.width=900;c.height=500;
    const ctx=c.getContext("2d");
    ctx.fillStyle="#04060f";ctx.fillRect(0,0,900,500);
    ctx.strokeStyle="rgba(34,211,238,.04)";ctx.lineWidth=1;
    for(let x=0;x<900;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,500);ctx.stroke();}
    for(let y=0;y<500;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(900,y);ctx.stroke();}
    const grd=ctx.createRadialGradient(450,0,0,450,0,380);
    grd.addColorStop(0,"rgba(232,197,71,.08)");grd.addColorStop(1,"transparent");
    ctx.fillStyle=grd;ctx.fillRect(0,0,900,500);
    ctx.textAlign="center";
    ctx.fillStyle="rgba(255,255,255,.2)";ctx.font="500 11px system-ui";ctx.fillText("SIAL GAMES",450,48);
    ctx.font="900 88px Georgia,serif";
    const lg=ctx.createLinearGradient(300,0,600,0);
    lg.addColorStop(0,"#e8c547");lg.addColorStop(.5,"#fff");lg.addColorStop(1,"#e8c547");
    ctx.fillStyle=lg;ctx.fillText("BLUFF™",450,148);
    ctx.strokeStyle="rgba(232,197,71,.22)";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(300,168);ctx.lineTo(600,168);ctx.stroke();
    ctx.fillStyle=won?"#2dd4a0":"rgba(244,63,94,.85)";ctx.font="700 26px system-ui";
    ctx.fillText(won?"I defeated AXIOM":"AXIOM defeated me... for now",450,212);
    ctx.fillStyle="#e8c547";ctx.font="900 68px Georgia,serif";
    ctx.fillText(`${score}/${total}`,450,302);
    ctx.fillStyle="rgba(255,255,255,.35)";ctx.font="500 14px system-ui";
    ctx.fillText(`Accuracy: ${total?Math.round(score/total*100):0}%   ·   Best streak: ${best}🔥`,450,348);
    if(speech&&speech!=="..."){ctx.fillStyle="rgba(34,211,238,.5)";ctx.font="italic 500 15px system-ui";ctx.fillText(`"${speech}"`,450,395);}
    ctx.fillStyle="rgba(255,255,255,.14)";ctx.font="500 12px system-ui";
    ctx.fillText("playbluff.games  ·  SIAL Consulting d.o.o.",450,458);
    ctx.strokeStyle="rgba(232,197,71,.1)";ctx.lineWidth=2;ctx.strokeRect(1,1,898,498);
    return c.toDataURL("image/png");
  } catch(e) { console.error("[share-card]",e); return null; }
}

function generateStoriesCard(score, total, best, axiomSpeech, won, lieText, roastLine) {
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

    ctx.fillStyle = "#e8c547";
    ctx.font = "900 72px Georgia,serif";
    ctx.fillText(`${score}/${total}`, W/2, cy + 240);

    ctx.fillStyle = "rgba(255,255,255,.3)";
    ctx.font = "500 13px system-ui";
    ctx.fillText(
      `${total ? Math.round(score/total*100) : 0}% accuracy  ·  ${best}🔥 best streak`,
      W/2, cy + 272
    );

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(60, cy + 295); ctx.lineTo(W - 60, cy + 295); ctx.stroke();

    // AXIOM quote
    const displayQuote = roastLine || axiomSpeech;
    if (displayQuote && displayQuote !== "...") {
      ctx.fillStyle = "rgba(34,211,238,.55)";
      ctx.font = "italic 500 13px system-ui";
      const maxW = W - 80;
      const words = `"${displayQuote}"`.split(" ");
      let line = "", lines = [], y = cy + 322;
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
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function BluffGame() {
  const haptic = useHaptic();
  const tg = useTelegram();
  const [showIntro, setShowIntro] = useState(
    !localStorage.getItem("bluff_played")
  );
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
  const [confetti, setConfetti] = useState(false);
  const [loadingRound, setLoadingRound] = useState(false);
  const [axiomMood, setAxiomMood] = useState("idle");
  const [axiomSpeech, setAxiomSpeech] = useState("Your confidence is endearing. Begin.");
  const [axiomLoading, setAxiomLoading] = useState(false);
  const [shareImg, setShareImg] = useState(null);
  const [storiesImg, setStoriesImg] = useState(null);
  const [challengeURL, setChallengeURL] = useState(null);
  const [challenge, setChallenge] = useState(null);
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
  const audioRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const axiomBusyRef = useRef(false); // prevents concurrent AXIOM calls
  const wrongCountRef = useRef(0); // tracks consecutive wrongs for escalating taunts
  const currentStmtsRef = useRef([]); // always-current stmts for timer callbacks
  const currentSelRef = useRef(null);

  // ── Daily Challenge ──────────────────────────────────────────
  const [dailyMode, setDailyMode] = useState(false);
  const [dailyData, setDailyData] = useState(null);
  const [dailyRank, setDailyRank] = useState(null);
  const [dailyPlayers, setDailyPlayers] = useState(0);
  const [dailyAlreadyPlayed, setDailyAlreadyPlayed] = useState(false);
  const [loadingDaily, setLoadingDaily] = useState(false);
  const dailyModeRef = useRef(false);
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

  // Keep refs in sync
  useEffect(()=>{ currentStmtsRef.current = stmts; },[stmts]);
  useEffect(()=>{ currentSelRef.current = sel; },[sel]);

  // Persist language
  const changeLang = useCallback(code => {
    setLang(code);
    localStorage.setItem("bluff_lang", code);
  },[]);

  // ── DAILY CHALLENGE ─────────────────────────────────────────
  const loadDailyChallenge = useCallback(async () => {
    setLoadingDaily(true);
    try {
      const r = await fetch(`/api/daily-challenge?userId=${encodeURIComponent(userIdRef.current)}`);
      const data = await r.json();
      setDailyData(data);
      setDailyAlreadyPlayed(!!data.alreadyPlayed);
      if (data.myRank) setDailyRank(data.myRank);
      if (data.totalPlayers) setDailyPlayers(data.totalPlayers);
    } catch { setDailyData(null); }
    finally { setLoadingDaily(false); }
  }, []);

  const submitDailyResult = useCallback(async (finalScore, finalTotal) => {
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
  }, []);

  const startDailyChallenge = useCallback(() => {
    if (!dailyData?.rounds) return;
    dailyModeRef.current = true;
    dailyResultsRef.current = [];
    dailyStartTimeRef.current = Date.now();
    dailyRoundsRef.current = dailyData.rounds;
    setDailyMode(true);
    setDailyRank(null);
    clearInterval(timerRef.current);
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
    setStoriesImg(null);
    fetchRound(0);
    axiomSpeak("intro", "idle");
  }, [dailyData, fetchRound, axiomSpeak]);

  // ── AXIOM VOICE ─────────────────────────────────────────────
  const playAxiomVoice = useCallback(async (text, skin) => {
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
        const p = audio.play();
        if (p !== undefined) p.catch(() => { isPlayingRef.current = false; });
      } catch {
        isPlayingRef.current = false;
        playNext();
      }
    };

    playNext();
  }, [voiceEnabled]);

  // ── AXIOM SPEAK ─────────────────────────────────────────────
  const axiomSpeak = useCallback(async (context, mood) => {
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
  },[lang]);

  // Re-trigger intro speech if language changes on home screen
  useEffect(()=>{
    if(screen==="home" && !showIntro) axiomSpeak("intro","idle");
  },[lang]);

  // Detect challenge from URL
  useEffect(() => {
    const ch = getChallengeFromURL();
    if (ch && ch.s !== undefined && ch.t > 0) {
      setChallenge(ch);
      // Clean URL without reload
      window.history.replaceState({}, "", window.location.pathname);
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

  // Load daily challenge on mount
  useEffect(() => { loadDailyChallenge(); }, []);

  // ── FETCH ROUND ─────────────────────────────────────────────
  const fetchRound = useCallback(async (idx) => {
    setLoadingRound(true);

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
      }
      setLoadingRound(false);
      return;
    }

    const diff = ROUND_DIFFICULTY[idx]||3;
    const cat = CATEGORIES[idx % CATEGORIES.length];
    setCategory(cat);
    try {
      const res = await fetch("/api/generate-round",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ category:cat, difficulty:diff, lang }),
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
    } catch(e) {
      console.warn("[fetchRound] fallback:",e.message);
      const fb = shuffle([
        {text:"Napoleon was once attacked by a horde of rabbits during a hunting party after the Treaty of Tilsit.",real:true},
        {text:"Cleopatra lived closer in time to the Moon landing than to the Great Pyramid's construction.",real:true},
        {text:"The French army used over 600 Paris taxis to rush troops to the Battle of the Marne.",real:true},
        {text:"Ancient Romans built steam-powered door mechanisms making temple doors open by 'divine force.'",real:true},
        {text:"Queen Victoria kept a diary in Urdu exclusively for the last 13 years of her reign.",real:false},
      ]);
      setStmts(fb);
      currentStmtsRef.current = fb;
    } finally {
      setLoadingRound(false);
    }
  },[lang]);

  // ── TIMER ────────────────────────────────────────────────────
  const startTimer = useCallback((diff) => {
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
  },[axiomSpeak]);

  // Auto-reveal at 0
  useEffect(()=>{
    if(time===0&&!revealed&&screen==="play"&&currentStmtsRef.current.length>0) doReveal();
  },[time,revealed,screen]);

  // Timer starts only after round finishes loading
  useEffect(() => {
    if (!loadingRound && screen === "play" && stmts.length > 0) {
      clearInterval(timerRef.current);
      const diff = ROUND_DIFFICULTY[roundIdx] || 3;
      const maxT = TIMER_PER_DIFF[diff] || 60;
      setTime(maxT);
      timerRef.current = setInterval(() => {
        setTime(t => {
          if (t <= 1) { clearInterval(timerRef.current); return 0; }
          if (t === Math.floor(maxT * .45)) axiomSpeak("taunt_early", "taunting");
          if (t === 10) { axiomSpeak("taunt_late", "taunting"); haptic.timerWarning(); }
          if (t === 5) haptic.timerWarning();
          if (t === 3) haptic.timerWarning();
          return t - 1;
        });
      }, 1000);
    }
  }, [loadingRound]);

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
      const isLast = roundIdx + 1 >= ROUND_DIFFICULTY.length;
      webApp.MainButton.setText(isLast ? "SEE RESULTS →" : "NEXT ROUND →");
      webApp.MainButton.setParams({ color: "#22d3ee", text_color: "#04060f", is_active: true, is_visible: true });
      webApp.MainButton.onClick(isLast ? showResultScreen : nextRound);
      webApp.MainButton.show();
    }
  }, [screen, sel, revealed, roundIdx, doReveal, nextRound, showResultScreen]);

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

  // ── CARD SELECT — psychological warfare ─────────────────────
  const handleCardSelect = useCallback((i) => {
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
  },[revealed, axiomSpeak]);

  // ── REVEAL ───────────────────────────────────────────────────
  const doReveal = useCallback(()=>{
    clearInterval(timerRef.current);
    const stmtsCurrent = currentStmtsRef.current;
    const selCurrent = currentSelRef.current;
    const bi = stmtsCurrent.findIndex(s=>!s.real);
    const isCorrect = selCurrent===bi && bi!==-1;

    setRevealed(true);
    setTotal(t=>t+1);

    if (dailyModeRef.current) {
      dailyResultsRef.current = [...dailyResultsRef.current, isCorrect];
    }

    if(isCorrect){
      haptic.correct();
      setScore(s=>s+1);
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
  },[axiomSpeak]);

  // ── NEXT ROUND ───────────────────────────────────────────────
  const nextRound = useCallback(()=>{
    const next = roundIdx+1;
    if(next>=ROUND_DIFFICULTY.length){ showResultScreen(); return; }
    clearInterval(timerRef.current);
    setRoundIdx(next);
    setSel(null);
    currentSelRef.current=null;
    setRevealed(false);
    setConfetti(false);
    fetchRound(next);
    axiomSpeak("intro","idle");
  },[roundIdx,fetchRound,axiomSpeak]);

  // ── START ────────────────────────────────────────────────────
  const startGame = useCallback(()=>{
    clearInterval(timerRef.current);
    wrongCountRef.current=0;
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
    fetchRound(0);
    axiomSpeak("intro","idle");
  },[fetchRound,axiomSpeak]);

  // ── RESULT ───────────────────────────────────────────────────
  const showResultScreen = useCallback(()=>{
    clearInterval(timerRef.current);
    setScreen("result");

    // Submit daily result before any state mutation
    if (dailyModeRef.current) {
      setScore(sc => {
        setTotal(tt => {
          submitDailyResult(sc, tt);
          return tt;
        });
        return sc;
      });
    }

    setScore(sc=>{
      setTotal(tt=>{
        const won = sc>=Math.ceil(tt*.67);
        axiomSpeak(won?"final_win":"final_lose", won?"defeated":"taunting");
        if(won){ setConfetti(true); haptic.victory(); }
        return tt;
      });
      return sc;
    });
    setTimeout(()=>{
      setAxiomSpeech(speech=>{
        setScore(sc=>{
          setTotal(tt=>{
            setBest(b=>{
              const won=sc>=Math.ceil(tt*.67);
              const img=generateShareCard(sc,tt,b,speech,won);
              setShareImg(img);
              return b;
            });
            return tt;
          });
          return sc;
        });
        return speech;
      });
    },1000);

    // Build Stories card and challenge URL
    setTimeout(() => {
      setScore(sc => {
        setTotal(tt => {
          setBest(b => {
            setAxiomSpeech(speech => {
              const won = sc >= Math.ceil(tt * .67);
              const lieStmt = currentStmtsRef.current.find(s => !s.real);
              const lieText = lieStmt?.text || "";
              const img = generateStoriesCard(sc, tt, b, speech, won, lieText, lastAxiomLine);
              setStoriesImg(img);
              setChallengeURL(buildChallengeURL(sc, tt));
              return speech;
            });
            return b;
          });
          return tt;
        });
        return sc;
      });
    }, 1200);
  },[axiomSpeak, submitDailyResult]);

  useEffect(()=>()=>clearInterval(timerRef.current),[]);
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }
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
  const diff = ROUND_DIFFICULTY[roundIdx]||3;

  if(showIntro) return <><CinematicIntro onComplete={()=>{
    setShowIntro(false);
    localStorage.setItem("bluff_played","1");
    axiomSpeak("intro","idle");
  }}/><GameStyles/></>;

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
          {["🧠 AI generates 5 surprising statements","🎭 One is a masterfully crafted LIE","⏱️ Find the BLUFF before AXIOM wins","🔥 Build streaks — beat the machine"].map((t,i)=>(
            <div key={i} style={{display:"flex",gap:10,marginBottom:i<3?10:0,fontSize:"clamp(13px,3.5vw,15px)",lineHeight:1.5,animation:`g-fadeUp .5s ${.15+i*.07}s both`}}>
              <span style={{fontSize:16,flexShrink:0}}>{t.slice(0,2)}</span>
              <span style={{opacity:.8}}>{t.slice(3)}</span>
            </div>
          ))}
        </div>

        {total>0&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14,animation:"g-fadeUp .5s .3s both"}}>
            {[[score,"Correct",T.ok],[total,"Played",T.gold],[best+"🔥","Streak","#a78bfa"]].map(([v,l,c])=>(
              <div key={l} style={{background:T.glass,borderRadius:12,border:`1px solid ${T.gb}`,padding:"clamp(10px,3vw,14px) 6px",textAlign:"center"}}>
                <div style={{fontSize:"clamp(20px,6vw,28px)",fontWeight:800,color:c,fontFamily:"Georgia,serif"}}>{v}</div>
                <div style={{fontSize:9,color:T.dim,letterSpacing:"1px",textTransform:"uppercase",marginTop:3}}>{l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Daily Challenge block */}
        {(loadingDaily || dailyData) && (
          <div style={{marginBottom:14,animation:"g-fadeUp .5s .38s both"}}>
            <div style={{fontSize:10,letterSpacing:"3px",color:"rgba(232,197,71,.5)",fontWeight:700,marginBottom:8,textTransform:"uppercase"}}>
              📅 Today's Challenge
            </div>
            {loadingDaily ? (
              <div style={{background:"rgba(255,255,255,.03)",border:"1px solid rgba(255,255,255,.07)",borderRadius:14,padding:14,textAlign:"center",fontSize:13,color:"rgba(255,255,255,.3)"}}>
                Loading...
              </div>
            ) : dailyAlreadyPlayed && dailyData?.myResult ? (
              <div style={{background:"rgba(45,212,160,.06)",border:"1px solid rgba(45,212,160,.25)",borderRadius:14,padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#2dd4a0"}}>✓ Completed today</div>
                  {dailyRank && <div style={{fontSize:12,color:"rgba(232,197,71,.7)",fontWeight:600}}>#{dailyRank} / {dailyPlayers}</div>}
                </div>
                <div style={{fontSize:22,letterSpacing:3,marginBottom:6,textAlign:"center"}}>
                  {(dailyData.myResult.results || []).map(r => r ? "🟩" : "🟥").join("")}
                </div>
                <div style={{fontSize:11,color:"rgba(255,255,255,.35)",textAlign:"center",marginBottom:10}}>
                  {dailyData.myResult.score}/{dailyData.myResult.total} correct
                  {dailyData.myResult.timeTakenMs ? ` · ${Math.round(dailyData.myResult.timeTakenMs/1000)}s` : ""}
                </div>
                <button
                  onClick={() => {
                    const grid = (dailyData.myResult.results || []).map(r => r ? "🟩" : "🟥").join("");
                    const rankStr = dailyRank ? ` · #${dailyRank}/${dailyPlayers}` : "";
                    const text = `BLUFF™ Daily #${dailyData.dayNum}\n${grid}\n${dailyData.myResult.score}/${dailyData.myResult.total}${rankStr}\nplaybluff.games`;
                    if (navigator.share) navigator.share({ text }).catch(() => navigator.clipboard?.writeText(text));
                    else navigator.clipboard?.writeText(text).then(() => alert("Copied!")).catch(() => alert(text));
                  }}
                  style={{width:"100%",minHeight:40,padding:"8px 14px",fontSize:12,fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",background:"rgba(45,212,160,.1)",color:"#2dd4a0",border:"1px solid rgba(45,212,160,.25)",borderRadius:10,fontFamily:"inherit",cursor:"pointer"}}>
                  📤 Share result
                </button>
              </div>
            ) : dailyData?.rounds ? (
              <div style={{background:"rgba(232,197,71,.06)",border:"1px solid rgba(232,197,71,.25)",borderRadius:14,padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:700,color:"#e8c547",marginBottom:2}}>Same puzzle for everyone</div>
                    <div style={{fontSize:11,color:"rgba(255,255,255,.35)"}}>
                      {dailyData.totalPlayers > 0 ? `${dailyData.totalPlayers} player${dailyData.totalPlayers !== 1 ? "s" : ""} today` : "Be the first today!"}
                    </div>
                  </div>
                  <div style={{fontSize:11,color:"rgba(232,197,71,.4)",letterSpacing:"1px"}}>#{dailyData.dayNum}</div>
                </div>
                <button
                  onClick={startDailyChallenge}
                  style={{width:"100%",minHeight:44,padding:"10px 14px",fontSize:13,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#04060f",borderRadius:10,fontFamily:"inherit",cursor:"pointer",position:"relative",overflow:"hidden"}}>
                  <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
                  <span style={{position:"relative"}}>📅 Play today's challenge</span>
                </button>
              </div>
            ) : null}
          </div>
        )}

        {tg.isInsideTelegram && (
          <div style={{display:"flex",alignItems:"center",gap:6,justifyContent:"center",marginBottom:12,fontSize:11,color:"rgba(41,182,246,.45)",letterSpacing:"1px"}}>
            <span>✈️</span><span>Running inside Telegram</span>
          </div>
        )}

        <button onClick={startGame} style={{width:"100%",minHeight:52,padding:"clamp(14px,3.5vw,17px)",fontSize:"clamp(13px,3.5vw,15px)",fontWeight:700,letterSpacing:"2px",textTransform:"uppercase",background:"linear-gradient(135deg,#e8c547,#d4a830)",color:T.bg,borderRadius:16,position:"relative",overflow:"hidden",boxShadow:"0 0 36px rgba(232,197,71,.14)",animation:"g-fadeUp .5s .4s both",transition:"transform .15s"}}
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
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:460,padding:"clamp(14px,4vw,22px)"}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,paddingTop:"max(12px,env(safe-area-inset-top))"}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>{CATEGORY_EMOJIS[category]||"🎯"}</span>
            <div>
              <div style={{fontSize:10,color:T.gold,letterSpacing:"3px",textTransform:"uppercase",fontWeight:600}}>{category}</div>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{fontSize:9,color:T.dim}}>Round {roundIdx+1}/{ROUND_DIFFICULTY.length}</div>
                <div style={{fontSize:9,color:diff===0?"#2dd4a0":DIFF_COLOR[diff],letterSpacing:"1px"}}>· {diff === 0 ? "Baby mode 👶" : DIFF_LABEL[diff]}</div>
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

          {!revealed
            ?<button onClick={()=>{ if(sel!==null){ haptic.lockIn(); doReveal(); }}} disabled={sel===null} style={{width:"100%",minHeight:52,padding:"clamp(14px,3.5vw,16px)",fontSize:"clamp(13px,3.5vw,15px)",fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",background:sel!==null?"linear-gradient(135deg,#e8c547,#d4a830)":T.card,color:sel!==null?T.bg:T.dim,border:sel!==null?"none":`1.5px solid ${T.gb}`,borderRadius:16,cursor:sel!==null?"pointer":"not-allowed",transition:"all .25s",fontFamily:"inherit",position:"relative",overflow:"hidden"}}>
              {sel!==null&&<div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>}
              <span style={{position:"relative"}}>{sel!==null?"🔒 Lock in answer":"Select a statement"}</span>
            </button>
            :<div style={{display:"flex",gap:10}}>
              <button onClick={()=>{clearInterval(timerRef.current);setScreen("home");}} style={{flex:1,minHeight:52,padding:14,fontSize:"clamp(13px,3.5vw,15px)",fontWeight:600,background:T.glass,color:"#e8e6e1",border:`1.5px solid ${T.gb}`,borderRadius:12,fontFamily:"inherit"}}>Home</button>
              <button onClick={roundIdx+1<ROUND_DIFFICULTY.length?nextRound:showResultScreen} style={{flex:2,minHeight:52,padding:14,fontSize:"clamp(13px,3.5vw,15px)",fontWeight:700,letterSpacing:"1px",textTransform:"uppercase",background:"linear-gradient(135deg,#e8c547,#d4a830)",color:T.bg,borderRadius:12,fontFamily:"inherit",position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
                <span style={{position:"relative"}}>{roundIdx+1<ROUND_DIFFICULTY.length?"Next round →":"See results →"}</span>
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

          <div style={{display:"flex",justifyContent:"center",gap:"clamp(12px,4vw,18px)",marginTop:12,fontSize:"clamp(10px,2.5vw,12px)",color:T.dim}}>
            <span>Score <b style={{color:T.gold,fontSize:13}}>{score}/{total}</b></span>
            <span style={{opacity:.2}}>|</span>
            <span>Accuracy <b style={{color:T.gold,fontSize:13}}>{total?Math.round(score/total*100):0}%</b></span>
            <span style={{opacity:.2}}>|</span>
            <span>Streak <b style={{color:streak>0?T.gold:T.dim,fontSize:13}}>{streak}🔥</b></span>
          </div>
        </>)}
      </div>
      <GameStyles/>
    </div>
  );

  // ─── RESULT ────────────────────────────────────────────────
  const won = score>=Math.ceil(total*.67);
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
            {[[score+"/"+total,"Correct",T.ok],[Math.round(score/total*100)+"%","Accuracy",T.gold],[best+"🔥","Streak","#a78bfa"]].map(([v,l,c])=>(
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
                const text = `BLUFF™ Daily #${dailyData?.dayNum ?? ""}\n${grid}\n${score}/${total}${rankStr}\nplaybluff.games`;
                if (navigator.share) navigator.share({ text }).catch(() => navigator.clipboard?.writeText(text));
                else navigator.clipboard?.writeText(text).then(() => alert("Copied! 📋")).catch(() => alert(text));
              }}
              style={{width:"100%",minHeight:44,padding:"10px 14px",fontSize:13,fontWeight:700,letterSpacing:"1.5px",textTransform:"uppercase",background:"rgba(45,212,160,.1)",color:"#2dd4a0",border:"1px solid rgba(45,212,160,.3)",borderRadius:10,fontFamily:"inherit",cursor:"pointer"}}>
              📤 Share daily result
            </button>
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
                    text: `I scored ${score}/${total} against AXIOM. Think you can do better? 🎯`,
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
              const text = `🎭 I scored ${score}/${total} against AXIOM in BLUFF!${grid}\nCan you beat me?`;
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
  `}</style>;
}

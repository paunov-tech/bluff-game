// src/App.jsx — BLUFF™ v3 — Championship Ladder + Final Answer Ceremony
import { useState, useEffect, useRef, useCallback } from "react";

// ── Ladder config ───────────────────────────────────────────────────────────
export const LADDER = [
  { step:1,  pts:10,   level:1, label:"First Step",   timer:30 },
  { step:2,  pts:30,   level:1, label:"Rookie",        timer:30 },
  { step:3,  pts:60,   level:2, label:"Solid",         timer:40 },
  { step:4,  pts:100,  level:2, label:"Rising",        timer:40 },  // → Safety Net 1
  { step:5,  pts:200,  level:3, label:"Contender",     timer:40 },
  { step:6,  pts:300,  level:3, label:"Challenger",    timer:55 },
  { step:7,  pts:500,  level:4, label:"Advanced",      timer:55 },  // → Safety Net 2
  { step:8,  pts:800,  level:4, label:"Expert",        timer:55 },
  { step:9,  pts:1500, level:5, label:"Master Bluff",  timer:75 },
  { step:10, pts:2500, level:5, label:"GRAND BLUFF",   timer:75 },
];
// After completing step 4 → safetyFloor = 100
// After completing step 7 → safetyFloor = 500
const SAFETY_NETS = { 4: 100, 7: 500 };

const LEVEL_NAMES  = { 1:"Warm-up", 2:"Tricky", 3:"Sneaky", 4:"Devious", 5:"Diabolical" };
const LEVEL_COLORS = { 1:"#4a9eff", 2:"#f0d020", 3:"#fb923c", 4:"#f43f5e", 5:"#c0392b" };
const LEVEL_BG = {
  1: "radial-gradient(ellipse at 50% 0%,rgba(74,158,255,0.07) 0%,#0a0a14 65%)",
  2: "radial-gradient(ellipse at 50% 0%,rgba(232,197,71,0.07) 0%,#0a0a14 65%)",
  3: "radial-gradient(ellipse at 50% 0%,rgba(251,146,60,0.09) 0%,#0d0a0a 65%)",
  4: "radial-gradient(ellipse at 50% 0%,rgba(244,63,94,0.12) 0%,#14080a 65%)",
  5: "radial-gradient(ellipse at 50% 0%,rgba(160,20,20,0.20) 0%,#0a0404 65%)",
};
// Vignette intensity grows with step
const VIGNETTE = [
  "none",
  "none",
  "radial-gradient(ellipse at center,transparent 55%,rgba(0,0,0,0.3) 100%)",
  "radial-gradient(ellipse at center,transparent 45%,rgba(0,0,0,0.45) 100%)",
  "radial-gradient(ellipse at center,transparent 40%,rgba(0,0,0,0.55) 100%)",
  "radial-gradient(ellipse at center,transparent 35%,rgba(0,0,0,0.6) 100%)",
  "radial-gradient(ellipse at center,transparent 30%,rgba(0,0,0,0.65) 100%)",
  "radial-gradient(ellipse at center,transparent 25%,rgba(0,0,0,0.7) 100%)",
  "radial-gradient(ellipse at center,transparent 20%,rgba(180,0,0,0.15) 70%,rgba(0,0,0,0.75) 100%)",
  "radial-gradient(ellipse at center,transparent 15%,rgba(180,0,0,0.2) 65%,rgba(0,0,0,0.8) 100%)",
];

const FREE_CLIMBS_PER_DAY = 1;

const CATS = [
  { id:"history",    emoji:"🏛️",  label:"History"    },
  { id:"science",    emoji:"🔬",  label:"Science"    },
  { id:"animals",    emoji:"🦎",  label:"Animals"    },
  { id:"geography",  emoji:"🌍",  label:"Geography"  },
  { id:"food",       emoji:"🍕",  label:"Food"       },
  { id:"technology", emoji:"💻",  label:"Technology" },
  { id:"culture",    emoji:"🎭",  label:"Culture"    },
  { id:"sports",     emoji:"⚽",  label:"Sports"     },
];

// ── Storage helpers ─────────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem("bluff_did");
  if (!id) { id = Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem("bluff_did",id); }
  return id;
}
function getPremium() {
  try { const p=JSON.parse(localStorage.getItem("bluff_premium")||"{}"); if(p.expiresAt&&new Date(p.expiresAt)>new Date()) return p; } catch {}
  return null;
}
function getClimbsToday() {
  const today=new Date().toDateString();
  const s=JSON.parse(localStorage.getItem("bluff_climbs")||'{"d":"","c":0}');
  return s.d===today?s.c:0;
}
function incClimbsToday() {
  const today=new Date().toDateString(), c=getClimbsToday()+1;
  localStorage.setItem("bluff_climbs",JSON.stringify({d:today,c})); return c;
}
function getPlayerName() { return localStorage.getItem("bluff_name") || ""; }
function savePlayerName(n) { if(n) localStorage.setItem("bluff_name",n); }

// ── CinematicIntro ──────────────────────────────────────────────────────────
function CinematicIntro({ onComplete }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = [
      setTimeout(()=>setPhase(1),300),
      setTimeout(()=>setPhase(2),2800),
      setTimeout(()=>setPhase(3),4200),
      setTimeout(()=>setPhase(4),6200),
    ];
    return ()=>t.forEach(clearTimeout);
  }, []);
  return (
    <div onClick={()=>phase>=3&&onComplete()} style={{
      position:"fixed",inset:0,zIndex:10000,background:"#040408",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      cursor:phase>=3?"pointer":"default",overflow:"hidden",
    }}>
      <div style={{position:"absolute",inset:0,pointerEvents:"none"}}>
        {Array.from({length:30},(_,i)=>(
          <div key={i} style={{
            position:"absolute",width:2+Math.random()*4,height:2+Math.random()*4,borderRadius:"50%",background:"#e8c547",
            left:`${Math.random()*100}%`,top:`${Math.random()*100}%`,
            opacity:phase>=2?0.08+Math.random()*0.15:0,transition:`opacity ${1+Math.random()*2}s ease ${Math.random()}s`,
            animation:phase>=2?`ci-sparkle ${3+Math.random()*4}s ease-in-out ${Math.random()*2}s infinite`:"none",
          }}/>
        ))}
      </div>
      <div style={{position:"absolute",width:phase>=3?600:300,height:phase>=3?600:300,borderRadius:"50%",
        background:"radial-gradient(circle,rgba(232,197,71,0.12) 0%,transparent 70%)",
        opacity:phase>=1?1:0,transition:"all 1.5s ease",filter:"blur(40px)"}}/>
      <div style={{position:"absolute",top:"48%",left:0,right:0,height:2,
        background:"linear-gradient(90deg,transparent,rgba(232,197,71,0.6) 45%,rgba(255,255,255,0.8) 50%,rgba(232,197,71,0.6) 55%,transparent)",
        opacity:phase===2?1:0,transform:phase===2?"scaleX(1.5)":"scaleX(0)",
        transition:"all 0.6s cubic-bezier(0.16,1,0.3,1)",filter:"blur(1px)"}}/>
      {/* SIAL seal */}
      <div style={{position:"absolute",opacity:phase>=1&&phase<3?1:0,
        transform:phase===1?"scale(1)":phase===2?"scale(0.8) rotate(-5deg)":"scale(1.5)",
        transition:phase===1?"all 0.8s cubic-bezier(0.34,1.56,0.64,1)":"all 0.8s cubic-bezier(0.4,0,0.2,1)",
        display:"flex",flexDirection:"column",alignItems:"center"}}>
        <div style={{width:200,height:200,borderRadius:"50%",border:"3px solid rgba(232,197,71,0.5)",
          display:"flex",alignItems:"center",justifyContent:"center",position:"relative",
          boxShadow:"0 0 40px rgba(232,197,71,0.15),inset 0 0 30px rgba(232,197,71,0.08)"}}>
          <div style={{width:175,height:175,borderRadius:"50%",border:"1.5px solid rgba(232,197,71,0.25)",
            display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
            <div style={{fontSize:10,letterSpacing:8,color:"rgba(232,197,71,0.5)",marginBottom:6}}>★ ★ ★</div>
            <div style={{fontFamily:"Georgia,serif",fontSize:36,fontWeight:700,letterSpacing:6,color:"#e8c547",lineHeight:1}}>SIAL</div>
            <div style={{width:80,height:1.5,margin:"8px 0",background:"linear-gradient(90deg,transparent,rgba(232,197,71,0.5),transparent)"}}/>
            <div style={{fontSize:13,letterSpacing:7,fontWeight:600,color:"rgba(232,197,71,0.7)"}}>GAMES</div>
            <div style={{fontSize:10,letterSpacing:8,color:"rgba(232,197,71,0.5)",marginTop:6}}>★ ★ ★</div>
          </div>
          <svg width="200" height="200" style={{position:"absolute",top:0,left:0,animation:"ci-spin 20s linear infinite"}}>
            <defs><path id="cp" d="M 100,100 m -82,0 a 82,82 0 1,1 164,0 a 82,82 0 1,1 -164,0"/></defs>
            <text fill="rgba(232,197,71,0.25)" fontSize="9" letterSpacing="3" fontFamily="Georgia,serif">
              <textPath href="#cp">• DIGITAL FACTORY • SLOVENIA • EST. 2024 • QUALITY ENTERTAINMENT •</textPath>
            </text>
          </svg>
        </div>
        <div style={{marginTop:20,fontSize:12,letterSpacing:8,color:"rgba(232,197,71,0.5)",fontWeight:500,
          opacity:phase>=1?1:0,transition:"all 0.6s ease 0.4s"}}>PRESENTS</div>
      </div>
      {/* BLUFF logo */}
      <div style={{position:"absolute",display:"flex",flexDirection:"column",alignItems:"center",
        opacity:phase>=3?1:0,transform:phase>=3?"scale(1)":"scale(0.5) translateY(20px)",
        transition:"all 1s cubic-bezier(0.34,1.56,0.64,1) 0.1s"}}>
        <h1 style={{fontFamily:"Georgia,serif",fontSize:88,fontWeight:900,letterSpacing:-2,margin:0,lineHeight:1,
          background:"linear-gradient(135deg,#e8c547 0%,#f0d878 30%,#fff 50%,#f0d878 70%,#e8c547 100%)",
          backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          animation:"ci-logoShimmer 3s ease infinite",filter:"drop-shadow(0 0 30px rgba(232,197,71,0.3))"}}>
          BLUFF<sup style={{fontSize:16,fontWeight:500,WebkitTextFillColor:"rgba(232,197,71,0.6)",position:"relative",top:-40,marginLeft:2,fontFamily:"system-ui"}}>™</sup>
        </h1>
        <div style={{width:200,height:2,marginTop:12,background:"linear-gradient(90deg,transparent,rgba(232,197,71,0.5),transparent)",transition:"width 0.8s 0.5s"}}/>
        <div style={{marginTop:14,fontSize:14,letterSpacing:5,color:"rgba(232,197,71,0.6)",textTransform:"uppercase",fontWeight:500,
          opacity:phase>=4?1:0,transition:"all 0.6s ease 0.2s"}}>The AI Deception Game</div>
        <div style={{marginTop:40,fontSize:13,letterSpacing:3,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",
          opacity:phase>=4?1:0,animation:phase>=4?"ci-tapPulse 2s ease-in-out infinite":"none"}}>Tap anywhere to play</div>
      </div>
      <style>{`
        @keyframes ci-sparkle{0%,100%{transform:translateY(0);opacity:0.05}50%{transform:translateY(-12px);opacity:0.2}}
        @keyframes ci-spin{to{transform:rotate(360deg)}}
        @keyframes ci-logoShimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        @keyframes ci-tapPulse{0%,100%{opacity:0.3}50%{opacity:0.6}}
      `}</style>
    </div>
  );
}

// ── Particles ───────────────────────────────────────────────────────────────
function Particles({ count=16, color="#e8c547" }) {
  const ps = useRef(Array.from({length:35},()=>({
    x:Math.random()*100,y:Math.random()*100,s:2+Math.random()*4,
    d:3+Math.random()*6,dl:Math.random()*4,o:0.05+Math.random()*0.12,
  }))).current;
  return (
    <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none",zIndex:0}}>
      {ps.slice(0,count).map((p,i)=>(
        <div key={i} style={{position:"absolute",width:p.s,height:p.s,borderRadius:"50%",background:color,
          opacity:p.o,left:`${p.x}%`,top:`${p.y}%`,animation:`g-float ${p.d}s ease-in-out ${p.dl}s infinite`}}/>
      ))}
    </div>
  );
}

function Confetti() {
  const colors=["#e8c547","#2dd4a0","#f0d878","#60a5fa","#f43f5e","#a78bfa","#fb923c"];
  const ps=useRef(Array.from({length:80},()=>({
    x:Math.random()*100,dl:Math.random()*1.5,
    c:colors[Math.floor(Math.random()*colors.length)],
    w:4+Math.random()*10,h:4+Math.random()*10,
    r:Math.random()>.5,dur:1.8+Math.random()*2,
  }))).current;
  return (
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,overflow:"hidden"}}>
      {ps.map((p,i)=>(
        <div key={i} style={{position:"absolute",top:-20,left:`${p.x}%`,width:p.w,height:p.h,background:p.c,
          borderRadius:p.r?"50%":"2px",animation:`g-confetti ${p.dur}s ease-in ${p.dl}s forwards`}}/>
      ))}
    </div>
  );
}

function TimerRing({ time, max=45, size=56, urgent=false }) {
  const r=(size-6)/2, circ=2*Math.PI*r, pct=Math.max(0,time/max);
  const color=time<=8?"#f43f5e":time<=20?"#fb923c":"#e8c547";
  return (
    <div style={{position:"relative",width:size,height:size}}>
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={urgent?4:3}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={urgent?4:3}
          strokeDasharray={circ} strokeDashoffset={circ*(1-pct)} strokeLinecap="round"
          style={{transition:"stroke-dashoffset 1s linear,stroke .3s"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:17,fontWeight:700,color,animation:time<=5?"g-pulse .5s infinite":"none"}}>{time}</div>
    </div>
  );
}

// ── Ladder sidebar (mini) ───────────────────────────────────────────────────
function LadderMini({ currentStep, safetyFloor }) {
  const T = { gold:"#e8c547", dim:"rgba(255,255,255,0.15)", bg:"rgba(255,255,255,0.03)", border:"rgba(255,255,255,0.06)" };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:2,fontSize:10,width:120}}>
      {[...LADDER].reverse().map(rung => {
        const isCurrent = rung.step === currentStep;
        const isPassed  = rung.step < currentStep;
        const isSN      = SAFETY_NETS[rung.step] !== undefined;
        const col = LEVEL_COLORS[rung.level];
        return (
          <div key={rung.step}>
            {isSN && rung.step < currentStep && (
              <div style={{height:1,background:"rgba(45,212,160,0.3)",margin:"2px 0",borderRadius:1}}/>
            )}
            <div style={{
              display:"flex",justifyContent:"space-between",alignItems:"center",
              padding:"3px 7px",borderRadius:6,
              background:isCurrent?`${col}20`:isPassed?"rgba(45,212,160,0.06)":T.bg,
              border:`1px solid ${isCurrent?col:isPassed?"rgba(45,212,160,0.2)":T.border}`,
              opacity:isCurrent?1:isPassed?0.8:0.4,
              transition:"all .3s",
            }}>
              <span style={{color:isCurrent?col:isPassed?"#2dd4a0":T.dim,fontWeight:isCurrent?700:400}}>
                {isCurrent?"▶ ":""}{rung.step}. {rung.label.length>9?rung.label.slice(0,9)+"…":rung.label}
              </span>
              <span style={{color:isCurrent?col:isPassed?"#2dd4a0":"rgba(255,255,255,0.25)",fontWeight:600}}>
                {rung.pts}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Paywall screen ──────────────────────────────────────────────────────────
function PaywallScreen({ onUnlock, onTomorrow, deviceId }) {
  const [plan,setPlan]=useState("yearly");
  const [email,setEmail]=useState("");
  const [loading,setLoad]=useState(false);
  const [recMode,setRecMode]=useState(false);
  const [recEmail,setRec]=useState("");
  const [recLoad,setRL]=useState(false);
  const [msg,setMsg]=useState("");

  const PLANS=[
    {id:"monthly",  price:"€4.99/mo",  save:"",          label:"Pro Monthly"},
    {id:"yearly",   price:"€34.99/yr", save:"Save 42%",  label:"Pro Yearly"},
    {id:"lifetime", price:"€69.99",    save:"Best deal!",label:"Pro Lifetime"},
  ];

  async function checkout(){
    setLoad(true);setMsg("");
    try{
      const r=await fetch("/api/checkout",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({plan,deviceId,email:email||undefined,returnPath:"/"})});
      const d=await r.json();
      if(d.url) window.location.href=d.url;
      else setMsg(d.error||"Payment unavailable");
    }catch{setMsg("Connection error");}
    finally{setLoad(false);}
  }

  async function recover(){
    setRL(true);setMsg("");
    try{
      const r=await fetch("/api/recover",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email:recEmail,deviceId})});
      const d=await r.json();
      if(d.recovered){
        const expiresAt=new Date(Date.now()+d.days*86400000).toISOString();
        localStorage.setItem("bluff_premium",JSON.stringify({plan:d.plan,expiresAt}));
        setMsg("✓ Premium restored!");
        setTimeout(()=>onUnlock(),1200);
      } else setMsg(d.error||"No subscription found");
    }catch{setMsg("Connection error");}
    finally{setRL(false);}
  }

  return (
    <div style={{position:"fixed",inset:0,zIndex:5000,
      background:"radial-gradient(ellipse at 50% 0%,rgba(244,63,94,0.12) 0%,#0c0606 60%)",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-start",
      padding:"32px 20px 40px",overflowY:"auto"}}>
      <div style={{textAlign:"center",marginBottom:24,animation:"g-fadeUp .5s both"}}>
        <div style={{fontFamily:"Georgia,serif",fontSize:24,fontWeight:800,color:"#e8e6e1",marginBottom:6}}>
          That's your free climb for today
        </div>
        <div style={{fontSize:13,color:"#5a5a68"}}>Unlock Pro for unlimited climbing</div>
      </div>
      <div style={{width:"100%",maxWidth:360,background:"rgba(244,63,94,0.06)",
        border:"1px solid rgba(244,63,94,0.25)",borderRadius:18,padding:"16px 20px",
        marginBottom:20,textAlign:"center",animation:"g-fadeUp .5s .1s both"}}>
        <div style={{fontSize:13,fontWeight:700,color:"#f43f5e",letterSpacing:1.5,textTransform:"uppercase",marginBottom:8}}>
          ⭐⭐⭐⭐ Devious level awaits
        </div>
        <div style={{fontSize:13,color:"#5a5a68",lineHeight:1.6}}>
          Can you reach <strong style={{color:"#e8e6e1"}}>Grand Bluff</strong> with 2500 points?
        </div>
      </div>
      <div style={{width:"100%",maxWidth:360,animation:"g-fadeUp .5s .2s both"}}>
        {!recMode?(
          <>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:12}}>
              {PLANS.map(p=>(
                <div key={p.id} onClick={()=>setPlan(p.id)} style={{
                  padding:"13px 16px",borderRadius:14,cursor:"pointer",
                  border:`1.5px solid ${plan===p.id?"#e8c547":"rgba(255,255,255,0.07)"}`,
                  background:plan===p.id?"rgba(232,197,71,0.06)":"rgba(255,255,255,0.02)",
                  display:"flex",justifyContent:"space-between",alignItems:"center",transition:"all .2s"}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,color:plan===p.id?"#e8c547":"#e8e6e1"}}>{p.label}</div>
                    <div style={{fontSize:12,color:"#5a5a68",marginTop:2}}>{p.price}</div>
                  </div>
                  {p.save&&<div style={{fontSize:11,fontWeight:700,color:"#2dd4a0",background:"rgba(45,212,160,0.1)",padding:"3px 8px",borderRadius:8}}>{p.save}</div>}
                </div>
              ))}
            </div>
            <input type="email" placeholder="Email (optional — for recovery)" value={email} onChange={e=>setEmail(e.target.value)}
              style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1px solid rgba(255,255,255,0.07)",
                background:"rgba(255,255,255,0.03)",color:"#e8e6e1",fontSize:13,outline:"none",
                fontFamily:"inherit",marginBottom:10,boxSizing:"border-box"}}/>
            <button onClick={checkout} disabled={loading} style={{width:"100%",padding:"16px",fontSize:15,fontWeight:700,
              letterSpacing:1,textTransform:"uppercase",borderRadius:14,border:"none",cursor:"pointer",
              background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#08080f",fontFamily:"inherit",
              position:"relative",overflow:"hidden",opacity:loading?0.7:1,marginBottom:10}}>
              <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
              <span style={{position:"relative"}}>{loading?"Redirecting…":"🔓 Unlock Pro"}</span>
            </button>
            {msg&&<div style={{marginBottom:8,fontSize:12,color:"#f43f5e",textAlign:"center"}}>{msg}</div>}
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:"#5a5a68"}}>
              <button onClick={onTomorrow} style={{background:"none",border:"none",color:"#5a5a68",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>🕐 Come back tomorrow</button>
              <button onClick={()=>{setRecMode(true);setMsg("");}} style={{background:"none",border:"none",color:"#5a5a68",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>Already paid?</button>
            </div>
          </>
        ):(
          <>
            <div style={{fontSize:13,color:"#5a5a68",marginBottom:14,textAlign:"center"}}>Enter the email used at purchase to restore your subscription.</div>
            <input type="email" placeholder="your@email.com" value={recEmail} onChange={e=>setRec(e.target.value)}
              style={{width:"100%",padding:"12px 14px",borderRadius:12,border:"1px solid rgba(255,255,255,0.07)",
                background:"rgba(255,255,255,0.03)",color:"#e8e6e1",fontSize:13,outline:"none",fontFamily:"inherit",marginBottom:12,boxSizing:"border-box"}}/>
            <button onClick={recover} disabled={recLoad} style={{width:"100%",padding:"14px",fontSize:14,fontWeight:700,
              borderRadius:12,border:"none",background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#08080f",
              cursor:"pointer",fontFamily:"inherit",opacity:recLoad?0.7:1}}>{recLoad?"Checking…":"Restore Access"}</button>
            {msg&&<div style={{marginTop:10,fontSize:12,textAlign:"center",color:msg.startsWith("✓")?"#2dd4a0":"#f43f5e"}}>{msg}</div>}
            <button onClick={()=>{setRecMode(false);setMsg("");}} style={{display:"block",margin:"14px auto 0",background:"none",border:"none",color:"#5a5a68",cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>← Back</button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Result screen ───────────────────────────────────────────────────────────
function ResultScreen({ status, score, safetyFloor, stepReached, aiSpeech, speechLoading, playerName, onPlayAgain, onHome }) {
  const isGrand   = status === "won";
  const isWalked  = status === "walked";
  const stepData  = LADDER[stepReached-1] || LADDER[0];
  const T = { gold:"#e8c547", ok:"#2dd4a0", bad:"#f43f5e", dim:"#5a5a68" };

  return (
    <div style={{
      minHeight:"100dvh",
      background: isGrand
        ? "radial-gradient(ellipse at 50% 20%,rgba(232,197,71,0.18) 0%,#06060e 60%)"
        : LEVEL_BG[stepData.level],
      display:"flex",flexDirection:"column",alignItems:"center",
      justifyContent:"flex-start",padding:"40px 20px",
      fontFamily:"'DM Sans','Instrument Sans',system-ui,sans-serif",color:"#e8e6e1",
    }}>
      {isGrand && <Confetti />}

      <div style={{width:"100%",maxWidth:440,textAlign:"center"}}>
        {/* Result header */}
        <div style={{marginBottom:28,animation:"g-fadeUp .6s both"}}>
          {isGrand ? (
            <>
              <div style={{fontSize:52,marginBottom:12}}>🏆</div>
              <h1 style={{fontFamily:"Georgia,serif",fontSize:30,fontWeight:900,margin:"0 0 8px",
                background:"linear-gradient(135deg,#e8c547,#f0d878,#fff,#e8c547)",
                backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
                animation:"g-shimmer 3s linear infinite"}}>
                GRAND BLUFF COMPLETE
              </h1>
              <div style={{fontSize:14,color:T.dim,letterSpacing:2,textTransform:"uppercase"}}>All 10 rounds — Undefeated</div>
            </>
          ) : isWalked ? (
            <>
              <div style={{fontSize:40,marginBottom:8}}>🚶</div>
              <h1 style={{fontFamily:"Georgia,serif",fontSize:26,fontWeight:800,margin:"0 0 6px",color:"#e8e6e1"}}>Smart exit</h1>
              <div style={{fontSize:13,color:T.dim}}>You cashed out on step {stepReached}</div>
            </>
          ) : (
            <>
              <div style={{fontSize:40,marginBottom:8}}>💥</div>
              <h1 style={{fontFamily:"Georgia,serif",fontSize:26,fontWeight:800,margin:"0 0 6px",color:T.bad}}>
                {safetyFloor > 0 ? `Safety Net — ${safetyFloor} pts saved` : "Game Over"}
              </h1>
              <div style={{fontSize:13,color:T.dim}}>Fell on step {stepReached} of 10</div>
            </>
          )}
        </div>

        {/* Score card */}
        <div style={{background:"rgba(255,255,255,0.03)",borderRadius:20,border:"1px solid rgba(255,255,255,0.07)",
          padding:"24px",marginBottom:24,animation:"g-fadeUp .6s .1s both"}}>
          <div style={{fontSize:48,fontWeight:900,color:isGrand?T.gold:isWalked?T.ok:safetyFloor>0?"#fb923c":T.bad,
            fontFamily:"Georgia,serif",lineHeight:1}}>{score.toLocaleString()}</div>
          <div style={{fontSize:12,color:T.dim,letterSpacing:2,textTransform:"uppercase",marginTop:4}}>points earned</div>
          {isGrand && (
            <div style={{marginTop:12,fontSize:12,color:T.dim}}>Season 1 · April 2026</div>
          )}
        </div>

        {/* AI Speech (Grand Bluff only) */}
        {isGrand && (
          <div style={{background:"rgba(232,197,71,0.05)",borderRadius:18,
            border:"1px solid rgba(232,197,71,0.15)",padding:"20px 22px",
            marginBottom:24,animation:"g-fadeUp .6s .2s both",textAlign:"left"}}>
            <div style={{fontSize:10,color:T.gold,letterSpacing:3,textTransform:"uppercase",fontWeight:600,marginBottom:12}}>
              — Your AI Opponent
            </div>
            {speechLoading ? (
              <div style={{fontSize:13,color:T.dim,fontStyle:"italic"}}>AI is composing its defeat speech…</div>
            ) : (
              <div style={{fontSize:14,lineHeight:1.7,color:"rgba(232,197,71,0.85)",fontStyle:"italic",fontFamily:"Georgia,serif"}}>
                "{aiSpeech}"
              </div>
            )}
          </div>
        )}

        {/* Mini ladder summary */}
        <div style={{marginBottom:24,animation:"g-fadeUp .6s .25s both"}}>
          <div style={{fontSize:10,color:T.dim,letterSpacing:3,textTransform:"uppercase",marginBottom:10,fontWeight:600}}>Your climb</div>
          <div style={{display:"flex",flexDirection:"column",gap:3}}>
            {LADDER.map(rung=>{
              const reached  = rung.step < stepReached || (rung.step === stepReached && (isGrand||isWalked));
              const isFail   = rung.step === stepReached && !isGrand && !isWalked;
              const isSN     = SAFETY_NETS[rung.step];
              const col      = LEVEL_COLORS[rung.level];
              return (
                <div key={rung.step}>
                  {isSN && rung.step < 8 && (
                    <div style={{display:"flex",alignItems:"center",gap:6,margin:"3px 0"}}>
                      <div style={{flex:1,height:1,background:"rgba(45,212,160,0.2)"}}/>
                      <div style={{fontSize:9,color:reached&&rung.step<=stepReached?"#2dd4a0":"rgba(255,255,255,0.2)",letterSpacing:2,fontWeight:600}}>SAFETY NET {isSN===100?1:2} — {isSN}pts</div>
                      <div style={{flex:1,height:1,background:"rgba(45,212,160,0.2)"}}/>
                    </div>
                  )}
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"5px 10px",borderRadius:8,
                    background:isFail?"rgba(244,63,94,0.1)":reached?"rgba(45,212,160,0.06)":"rgba(255,255,255,0.02)",
                    border:`1px solid ${isFail?"rgba(244,63,94,0.3)":reached?"rgba(45,212,160,0.15)":"rgba(255,255,255,0.04)"}`,
                    opacity:isFail?1:reached?0.9:0.35}}>
                    <div style={{fontSize:11,color:isFail?T.bad:reached?"#2dd4a0":"rgba(255,255,255,0.4)",fontWeight:reached||isFail?600:400}}>
                      {isFail?"✗":reached?"✓":"·"} {rung.step}. {rung.label}
                    </div>
                    <div style={{fontSize:11,fontWeight:600,color:isFail?T.bad:reached?"#2dd4a0":col}}>{rung.pts}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div style={{display:"flex",gap:10,animation:"g-fadeUp .6s .35s both"}}>
          <button onClick={onHome} style={{flex:1,padding:"15px",fontSize:14,fontWeight:600,
            background:"rgba(255,255,255,0.03)",color:"#e8e6e1",border:"1.5px solid rgba(255,255,255,0.07)",
            borderRadius:14,cursor:"pointer",fontFamily:"inherit"}}>Home</button>
          <button onClick={onPlayAgain} style={{flex:2,padding:"15px",fontSize:14,fontWeight:700,
            letterSpacing:1,textTransform:"uppercase",
            background:"linear-gradient(135deg,#e8c547,#d4a830)",
            color:"#08080f",border:"none",borderRadius:14,cursor:"pointer",
            fontFamily:"inherit",position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
            <span style={{position:"relative"}}>Climb again ↑</span>
          </button>
        </div>
      </div>
      <GameStyles />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════════════════
export default function BluffGame() {
  const [showIntro, setShowIntro] = useState(true);
  const [screen, setScreen]       = useState("home"); // "home"|"play"|"result"|"paywall"

  // Climb state
  const [climbStep,     setClimbStep]     = useState(1);
  const [safetyFloor,   setSafetyFloor]   = useState(0);
  const [climbStatus,   setClimbStatus]   = useState("idle"); // "active"|"won"|"failed"|"walked"
  const catSequence = useRef([]); // categories used during current climb

  // Round state
  const [roundId,      setRoundId]      = useState(null);
  const [stmts,        setStmts]        = useState([]);
  const [sel,          setSel]          = useState(null);
  const [revealed,     setRevealed]     = useState(false);
  const [bluffIdx,     setBluffIdx]     = useState(null);
  const [explanation,  setExplanation]  = useState("");
  const [catInfo,      setCatInfo]      = useState(CATS[0]);

  // Timer
  const [time,    setTime]    = useState(30);
  const [timeMax, setTimeMax] = useState(30);
  const timerRef              = useRef(null);
  const climbStartRef         = useRef(null); // timestamp when climb started

  // Final answer ceremony
  const [lockInMode,   setLockInMode]   = useState(false);
  const [lockInPause,  setLockInPause]  = useState(false); // drum-roll 2s
  const [walkAwayMode, setWalkAwayMode] = useState(false);

  // Post-climb
  const [aiSpeech,      setAiSpeech]      = useState("");
  const [speechLoading, setSpeechLoading] = useState(false);
  const [finalScore,    setFinalScore]    = useState(0);

  // UI
  const [loading,    setLoading]    = useState(false);
  const [ansLoading, setAnsLoading] = useState(false);
  const [error,      setError]      = useState("");
  const [premium,    setPremium]    = useState(()=>!!getPremium());
  const [leaderboard,setLeaderboard]=useState([]);

  // Player name (for AI speech + leaderboard)
  const [playerName, setPlayerName] = useState(()=>getPlayerName()||"");
  const [namePrompt, setNamePrompt] = useState(false);

  const deviceId = useRef(getDeviceId()).current;

  // Payment success on mount
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const sessionId=params.get("session_id");
    if(params.get("payment")==="success"&&sessionId){
      fetch("/api/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId})})
        .then(r=>r.json()).then(d=>{
          if(d.verified){
            const expiresAt=new Date(Date.now()+d.days*86400000).toISOString();
            localStorage.setItem("bluff_premium",JSON.stringify({plan:d.plan,expiresAt}));
            setPremium(true);
          }
        }).catch(()=>{});
      window.history.replaceState({},"","/");
    }
  },[]);

  // Load daily leaderboard on home
  useEffect(()=>{
    if(screen!=="home") return;
    fetch("/api/leaderboard").then(r=>r.json()).then(d=>setLeaderboard(d.leaderboard||[])).catch(()=>{});
  },[screen]);

  // Auto-reveal on timer=0
  useEffect(()=>{
    if(time<=0&&!revealed&&stmts.length>0) doReveal(null);
  },[time]);

  useEffect(()=>()=>clearInterval(timerRef.current),[]);

  // ── Generate one step ──────────────────────────────────────
  const loadStep = useCallback(async (step) => {
    const rung   = LADDER[step-1];
    const cat    = CATS[Math.floor(Math.random()*CATS.length)];
    setCatInfo(cat);
    catSequence.current.push(cat.id);

    setLoading(true);
    setSel(null);
    setRevealed(false);
    setBluffIdx(null);
    setExplanation("");
    setStmts([]);
    setLockInMode(false);
    setLockInPause(false);
    setWalkAwayMode(false);
    clearInterval(timerRef.current);

    try {
      const r = await fetch("/api/generate-round",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({category:cat.id,difficulty:rung.level,lang:"en"}),
        signal:AbortSignal.timeout(30000),
      });
      const data = await r.json();
      if(!r.ok) throw new Error(data.error||"AI unavailable");
      setRoundId(data.roundId);
      setStmts(data.statements);
      setTimeMax(rung.timer);
      setTime(rung.timer);
      timerRef.current = setInterval(()=>setTime(t=>t-1),1000);
    } catch(e) {
      setError(e.message);
      setClimbStatus("idle");
      setScreen("home");
    } finally {
      setLoading(false);
    }
  },[]);

  // ── Start a new climb ──────────────────────────────────────
  const startClimb = useCallback(async ()=>{
    if(!premium && getClimbsToday()>=FREE_CLIMBS_PER_DAY){
      setScreen("paywall");
      return;
    }
    setClimbStep(1);
    setSafetyFloor(0);
    setClimbStatus("active");
    catSequence.current=[];
    climbStartRef.current=Date.now();
    setAiSpeech("");
    setFinalScore(0);
    setError("");
    incClimbsToday();
    setScreen("play");
    await loadStep(1);
  },[premium,loadStep]);

  // ── Reveal answer ──────────────────────────────────────────
  const doReveal = useCallback(async (selectedIdx)=>{
    clearInterval(timerRef.current);
    setAnsLoading(true);
    setLockInMode(false);
    setLockInPause(false);
    const finalSel = (selectedIdx!==null&&selectedIdx!==undefined) ? selectedIdx : sel;

    try {
      const r = await fetch("/api/check-answer",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({roundId,selectedIndex:finalSel,deviceId}),
      });
      const data = await r.json();
      setBluffIdx(data.bluffIndex??null);
      setExplanation(data.explanation||"");
      setRevealed(true);

      if(data.correct){
        const newFloor = SAFETY_NETS[climbStep] ?? safetyFloor;
        setSafetyFloor(newFloor);
        if(climbStep===10){
          // GRAND BLUFF!
          const score=2500;
          setFinalScore(score);
          setClimbStatus("won");
          // Submit to leaderboard
          const totalSecs=Math.round((Date.now()-climbStartRef.current)/1000);
          fetch("/api/leaderboard",{method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({deviceId,playerName:playerName||"Anonymous",score,climbComplete:true})}).catch(()=>{});
          // Generate AI speech
          setSpeechLoading(true);
          fetch("/api/generate-speech",{method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({playerName:playerName||"Champion",score,totalSeconds:totalSecs,categories:catSequence.current})})
            .then(r=>r.json()).then(d=>setAiSpeech(d.speech||"")).catch(()=>{})
            .finally(()=>setSpeechLoading(false));
        }
      } else {
        const fallbackScore = safetyFloor;
        setFinalScore(fallbackScore);
        setClimbStatus("failed");
        // Submit partial score
        fetch("/api/leaderboard",{method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({deviceId,playerName:playerName||"Anonymous",score:fallbackScore,climbComplete:false})}).catch(()=>{});
      }
    } catch {
      setRevealed(true);
      setFinalScore(safetyFloor);
      setClimbStatus("failed");
    } finally {
      setAnsLoading(false);
    }
  },[roundId,sel,deviceId,climbStep,safetyFloor,playerName]);

  // ── Walk Away ──────────────────────────────────────────────
  const doWalkAway = useCallback(()=>{
    clearInterval(timerRef.current);
    const rung=LADDER[climbStep-1];
    setFinalScore(rung.pts);
    setClimbStatus("walked");
    setWalkAwayMode(false);
    setRevealed(true);
    // Still show what the bluff was — need to reveal without selecting
    fetch("/api/check-answer",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({roundId,selectedIndex:-1,deviceId})})
      .then(r=>r.json()).then(d=>{setBluffIdx(d.bluffIndex??null);setExplanation(d.explanation||"");}).catch(()=>{});
    // Submit walked score
    fetch("/api/leaderboard",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({deviceId,playerName:playerName||"Anonymous",score:rung.pts,climbComplete:false})}).catch(()=>{});
  },[roundId,deviceId,climbStep,playerName]);

  // ── Continue to next step ──────────────────────────────────
  const nextStep = useCallback(async ()=>{
    const next=climbStep+1;
    setClimbStep(next);
    await loadStep(next);
  },[climbStep,loadStep]);

  // ── Show result after delay ────────────────────────────────
  useEffect(()=>{
    if(climbStatus==="won"||climbStatus==="failed"||climbStatus==="walked"){
      if(climbStatus==="failed"||climbStatus==="walked"){
        const t=setTimeout(()=>setScreen("result"),2200);
        return ()=>clearTimeout(t);
      }
      if(climbStatus==="won"){
        const t=setTimeout(()=>setScreen("result"),2500);
        return ()=>clearTimeout(t);
      }
    }
  },[climbStatus]);

  // ── Lock-in flow ───────────────────────────────────────────
  const handleLockIn = ()=>{
    if(sel===null||revealed||loading) return;
    setLockInMode(true);
  };
  const confirmFinalAnswer = ()=>{
    setLockInPause(true);
    setTimeout(()=>{
      setLockInPause(false);
      doReveal(sel);
    },1800);
  };

  const rung         = LADDER[climbStep-1] || LADDER[0];
  const level        = rung.level;
  const levColor     = LEVEL_COLORS[level];
  const correctNow   = revealed && sel!==null && sel===bluffIdx;
  const canWalkAway  = climbStep>=6 && !revealed && !loading;

  const T={bg:"#08080f",card:"#111119",gold:"#e8c547",gold2:"#f0d878",
    goldDim:"rgba(232,197,71,0.1)",ok:"#2dd4a0",bad:"#f43f5e",
    dim:"#5a5a68",glass:"rgba(255,255,255,0.03)",glassBorder:"rgba(255,255,255,0.07)"};

  // ─── INTRO ───────────────────────────────────────────────
  if(showIntro) return <CinematicIntro onComplete={()=>setShowIntro(false)}/>;

  // ─── PAYWALL ────────────────────────────────────────────
  if(screen==="paywall") return (
    <>
      <PaywallScreen deviceId={deviceId} onUnlock={()=>{setPremium(true);setScreen("home");}} onTomorrow={()=>setScreen("home")}/>
      <GameStyles/>
    </>
  );

  // ─── RESULT ─────────────────────────────────────────────
  if(screen==="result") return (
    <ResultScreen
      status={climbStatus}
      score={finalScore}
      safetyFloor={safetyFloor}
      stepReached={climbStep}
      aiSpeech={aiSpeech}
      speechLoading={speechLoading}
      playerName={playerName}
      onPlayAgain={startClimb}
      onHome={()=>setScreen("home")}
    />
  );

  // ─── HOME ────────────────────────────────────────────────
  if(screen==="home") {
    const climbs=getClimbsToday();
    return (
      <div style={{minHeight:"100dvh",background:LEVEL_BG[1],fontFamily:"'DM Sans','Instrument Sans',system-ui,sans-serif",
        display:"flex",flexDirection:"column",alignItems:"center",position:"relative",overflow:"hidden",color:"#e8e6e1"}}>
        <Particles count={16} color="#e8c547"/>
        <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:440,padding:"50px 20px 40px",textAlign:"center"}}>
          <div style={{fontSize:11,letterSpacing:7,color:T.dim,marginBottom:18,fontWeight:500}}>SIAL GAMES</div>
          <h1 style={{fontFamily:"Georgia,serif",fontSize:72,fontWeight:900,letterSpacing:-2,margin:"0 0 2px",lineHeight:1,
            background:`linear-gradient(135deg,${T.gold},${T.gold2},rgba(255,255,255,0.5),${T.gold})`,
            backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
            animation:"g-shimmer 4s linear infinite",filter:"drop-shadow(0 0 30px rgba(232,197,71,0.2))"}}>
            BLUFF<sup style={{fontSize:14,WebkitTextFillColor:"rgba(232,197,71,0.5)",position:"relative",top:-35,fontFamily:"system-ui",fontWeight:400}}>™</sup>
          </h1>
          <p style={{fontSize:13,color:T.dim,letterSpacing:4,textTransform:"uppercase",margin:"0 0 28px",fontWeight:500}}>The AI Deception Game</p>

          {/* The Bluff Ladder preview */}
          <div style={{background:T.glass,backdropFilter:"blur(16px)",borderRadius:18,border:`1px solid ${T.glassBorder}`,
            padding:"20px",marginBottom:18,animation:"g-fadeUp .6s .1s both"}}>
            <div style={{fontSize:10,color:T.gold,letterSpacing:3,textTransform:"uppercase",fontWeight:600,marginBottom:14,textAlign:"left"}}>
              The Bluff Ladder
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:2}}>
              {[...LADDER].reverse().map((rung,i)=>{
                const isSN=SAFETY_NETS[rung.step];
                const col=LEVEL_COLORS[rung.level];
                return (
                  <div key={rung.step}>
                    {isSN&&rung.step<10&&(
                      <div style={{display:"flex",alignItems:"center",gap:6,margin:"3px 0"}}>
                        <div style={{flex:1,height:1,background:"rgba(45,212,160,0.2)"}}/>
                        <div style={{fontSize:9,color:"rgba(45,212,160,0.5)",letterSpacing:2,fontWeight:600}}>SAFETY NET {isSN===100?1:2} — {isSN} PTS</div>
                        <div style={{flex:1,height:1,background:"rgba(45,212,160,0.2)"}}/>
                      </div>
                    )}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                      padding:"5px 10px",borderRadius:8,
                      background:rung.step===10?"rgba(232,197,71,0.08)":"rgba(255,255,255,0.02)",
                      border:`1px solid ${rung.step===10?"rgba(232,197,71,0.25)":"rgba(255,255,255,0.04)"}`,
                      opacity:rung.step===10?1:0.65}}>
                      <div style={{fontSize:11,color:rung.step===10?T.gold:col,fontWeight:rung.step===10?700:400}}>
                        {rung.step}. {rung.label}
                        {isSN?" 🛡️":""}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <div style={{fontSize:9,color:T.dim}}>[{LEVEL_NAMES[rung.level].toUpperCase()}]</div>
                        <div style={{fontSize:12,fontWeight:700,color:rung.step===10?T.gold:col}}>{rung.pts} pts</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Player name input */}
          <div style={{marginBottom:14,animation:"g-fadeUp .5s .2s both"}}>
            <input placeholder="Your name (for leaderboard)" value={playerName}
              onChange={e=>{setPlayerName(e.target.value);savePlayerName(e.target.value);}}
              style={{width:"100%",padding:"11px 14px",borderRadius:12,border:`1px solid ${T.glassBorder}`,
                background:T.glass,color:"#e8e6e1",fontSize:13,outline:"none",fontFamily:"inherit",
                boxSizing:"border-box",textAlign:"center"}}/>
          </div>

          {/* Free/Pro indicator */}
          <div style={{marginBottom:16,fontSize:12,color:T.dim,animation:"g-fadeUp .5s .25s both"}}>
            {!premium
              ? climbs>=FREE_CLIMBS_PER_DAY
                ? <><span style={{color:T.bad}}>Daily climb used.</span> <button onClick={()=>setScreen("paywall")} style={{color:T.gold,background:"none",border:"none",cursor:"pointer",fontSize:12,fontFamily:"inherit",textDecoration:"underline"}}>Upgrade to Pro →</button></>
                : `${FREE_CLIMBS_PER_DAY - climbs} free climb remaining today`
              : "✦ Pro — unlimited climbs"
            }
          </div>

          {error&&<div style={{marginBottom:12,fontSize:13,color:T.bad}}>{error}</div>}

          <button onClick={startClimb} disabled={loading} style={{
            width:"100%",padding:"18px",fontSize:16,fontWeight:700,letterSpacing:2,textTransform:"uppercase",
            background:loading?"rgba(232,197,71,0.3)":`linear-gradient(135deg,${T.gold},#d4a830)`,
            color:T.bg,border:"none",borderRadius:16,cursor:loading?"wait":"pointer",
            position:"relative",overflow:"hidden",fontFamily:"inherit",
            boxShadow:loading?"none":`0 0 50px ${T.goldDim},0 4px 20px rgba(232,197,71,0.2)`,
            animation:"g-fadeUp .6s .3s both",transition:"transform .2s",
          }}
          onMouseDown={e=>e.currentTarget.style.transform="scale(0.97)"}
          onMouseUp={e=>e.currentTarget.style.transform=""}>
            {!loading&&<div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 3s infinite"}}/>}
            <span style={{position:"relative"}}>{loading?"Generating…":"Start the Climb ↑"}</span>
          </button>

          {/* Daily leaderboard */}
          {leaderboard.length>0&&(
            <div style={{marginTop:24,animation:"g-fadeUp .6s .4s both"}}>
              <div style={{fontSize:10,color:T.dim,letterSpacing:3,textTransform:"uppercase",fontWeight:600,marginBottom:10}}>Today's leaderboard</div>
              {leaderboard.slice(0,5).map((entry,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"8px 12px",borderRadius:10,marginBottom:4,
                  background:i===0?"rgba(232,197,71,0.06)":T.glass,
                  border:`1px solid ${i===0?"rgba(232,197,71,0.2)":T.glassBorder}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:13,color:i===0?T.gold:i===1?"#c0c0c0":i===2?"#cd7f32":T.dim}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}</span>
                    <span style={{fontSize:13,color:"#e8e6e1"}}>{entry.playerName}</span>
                    {entry.climbComplete&&<span style={{fontSize:10,color:T.gold}}>🏆</span>}
                  </div>
                  <span style={{fontSize:13,fontWeight:700,color:i===0?T.gold:"#e8e6e1"}}>{entry.score.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{marginTop:28,fontSize:11,color:"rgba(255,255,255,0.12)",letterSpacing:1}}>BLUFF™ · SIAL Consulting d.o.o.</div>
        </div>
        <GameStyles/>
      </div>
    );
  }

  // ─── PLAY ────────────────────────────────────────────────
  const vigIdx = Math.min(climbStep-1, VIGNETTE.length-1);
  return (
    <div style={{minHeight:"100dvh",background:LEVEL_BG[level],
      fontFamily:"'DM Sans','Instrument Sans',system-ui,sans-serif",
      display:"flex",flexDirection:"column",alignItems:"center",
      position:"relative",overflow:"hidden",color:"#e8e6e1",
      transition:"background 0.8s ease"}}>

      {/* Vignette overlay */}
      {VIGNETTE[vigIdx]!=="none"&&(
        <div style={{position:"fixed",inset:0,background:VIGNETTE[vigIdx],pointerEvents:"none",zIndex:0}}/>
      )}

      <Particles count={8+climbStep*2} color={LEVEL_COLORS[level]}/>

      {/* Final Answer overlay */}
      {lockInMode&&(
        <div style={{position:"fixed",inset:0,zIndex:8000,background:"rgba(0,0,0,0.72)",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
          padding:20,animation:"g-fadeIn .2s both"}}>
          {lockInPause ? (
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:40,marginBottom:16,animation:"g-pulse .6s infinite"}}>⏳</div>
              <div style={{fontFamily:"Georgia,serif",fontSize:22,fontWeight:700,color:"#e8e6e1",letterSpacing:2}}>
                Checking…
              </div>
            </div>
          ) : (
            <>
              {/* Lifted selected card */}
              {sel!==null&&stmts[sel]&&(
                <div style={{
                  background:"rgba(232,197,71,0.08)",
                  border:"2px solid rgba(232,197,71,0.5)",
                  borderRadius:18,padding:"20px 24px",
                  maxWidth:380,marginBottom:28,
                  boxShadow:"0 0 60px rgba(232,197,71,0.2)",
                  animation:"g-riseUp .4s cubic-bezier(0.34,1.56,0.64,1)",
                  fontSize:15,lineHeight:1.6,color:"#e8e6e1",textAlign:"center",
                }}>
                  <div style={{fontSize:12,color:"rgba(232,197,71,0.6)",letterSpacing:2,textTransform:"uppercase",marginBottom:10,fontWeight:600}}>
                    {String.fromCharCode(65+sel)} — Your answer
                  </div>
                  {stmts[sel].text}
                </div>
              )}
              <div style={{fontFamily:"Georgia,serif",fontSize:24,fontWeight:800,color:"#e8e6e1",
                marginBottom:28,letterSpacing:1,textAlign:"center"}}>
                Final answer?
              </div>
              <div style={{display:"flex",gap:12,width:"100%",maxWidth:340}}>
                <button onClick={()=>setLockInMode(false)} style={{flex:1,padding:"16px",fontSize:14,fontWeight:600,
                  background:"rgba(255,255,255,0.05)",color:"#e8e6e1",border:"1.5px solid rgba(255,255,255,0.12)",
                  borderRadius:14,cursor:"pointer",fontFamily:"inherit"}}>← Change mind</button>
                <button onClick={confirmFinalAnswer} style={{flex:2,padding:"16px",fontSize:15,fontWeight:700,letterSpacing:1,
                  textTransform:"uppercase",background:"linear-gradient(135deg,#e8c547,#d4a830)",color:"#08080f",
                  border:"none",borderRadius:14,cursor:"pointer",fontFamily:"inherit",
                  position:"relative",overflow:"hidden"}}>
                  <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 1.5s infinite"}}/>
                  <span style={{position:"relative"}}>✓ FINAL</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Walk Away overlay */}
      {walkAwayMode&&(
        <div style={{position:"fixed",inset:0,zIndex:8000,background:"rgba(0,0,0,0.72)",
          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
          padding:20,animation:"g-fadeIn .2s both"}}>
          <div style={{width:"100%",maxWidth:360,textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:12}}>🚶</div>
            <div style={{fontFamily:"Georgia,serif",fontSize:22,fontWeight:800,color:"#e8e6e1",marginBottom:8}}>
              Walk away with {rung.pts} pts?
            </div>
            <div style={{fontSize:13,color:T.dim,marginBottom:28,lineHeight:1.6}}>
              Step {climbStep} of 10 — one correct answer could get you to {LADDER[climbStep]?.pts||"the top"}
            </div>
            <div style={{display:"flex",gap:12}}>
              <button onClick={()=>setWalkAwayMode(false)} style={{flex:1,padding:"16px",fontSize:14,fontWeight:600,
                background:"rgba(255,255,255,0.05)",color:"#e8e6e1",border:"1.5px solid rgba(255,255,255,0.12)",
                borderRadius:14,cursor:"pointer",fontFamily:"inherit"}}>Keep playing</button>
              <button onClick={doWalkAway} style={{flex:1,padding:"16px",fontSize:14,fontWeight:700,
                background:"rgba(45,212,160,0.12)",color:"#2dd4a0",border:"1.5px solid rgba(45,212,160,0.3)",
                borderRadius:14,cursor:"pointer",fontFamily:"inherit"}}>Cash out</button>
            </div>
          </div>
        </div>
      )}

      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:500,padding:"16px 14px 36px",
        display:"flex",gap:12}}>
        {/* Ladder sidebar */}
        <div style={{paddingTop:12,flexShrink:0,display:"none",width:0}}/>

        {/* Main content */}
        <div style={{flex:1,minWidth:0}}>
          {/* Header */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <span style={{fontSize:18}}>{catInfo.emoji}</span>
                <div style={{fontSize:11,color:levColor,letterSpacing:3,textTransform:"uppercase",fontWeight:600}}>{catInfo.label}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{fontSize:10,color:T.dim}}>Step {climbStep}/10</div>
                <div style={{width:60,height:3,borderRadius:2,background:"rgba(255,255,255,0.08)",overflow:"hidden"}}>
                  <div style={{height:"100%",borderRadius:2,background:levColor,width:`${(climbStep/10)*100}%`,transition:"width .4s"}}/>
                </div>
                <div style={{fontSize:10,color:levColor,fontWeight:700}}>{rung.pts} pts</div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:5}}>
              <div style={{display:"flex",alignItems:"center",gap:6,padding:"3px 10px",borderRadius:20,
                background:`${levColor}18`,border:`1px solid ${levColor}40`,
                fontSize:10,fontWeight:700,color:levColor,letterSpacing:0.5}}>
                {"⭐".repeat(level)} {LEVEL_NAMES[level].toUpperCase()}
              </div>
              {!revealed
                ? <TimerRing time={time} max={timeMax} urgent={climbStep>=9}/>
                : <div style={{width:50,height:50,borderRadius:"50%",
                    background:correctNow?"rgba(45,212,160,0.12)":climbStatus==="walked"?"rgba(45,212,160,0.08)":"rgba(244,63,94,0.12)",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:22,animation:"g-pulse .5s",
                    color:correctNow?T.ok:climbStatus==="walked"?T.ok:T.bad}}>
                    {correctNow?"✓":climbStatus==="walked"?"🚶":"✗"}
                  </div>
              }
            </div>
          </div>

          {/* Prompt */}
          <div style={{textAlign:"center",marginBottom:16,animation:revealed&&!correctNow&&climbStatus!=="walked"?"g-shake .5s":"none"}}>
            {loading ? (
              <div>
                <h2 style={{fontFamily:"Georgia,serif",fontSize:19,fontWeight:800,margin:"0 0 4px",color:T.dim}}>
                  {climbStep===1?"Starting your climb…":`Step ${climbStep} of 10…`}
                </h2>
                <p style={{fontSize:12,color:T.dim,margin:0}}>
                  {level>=5?"AI crafting diabolical deceptions…":level>=4?"AI designing devious traps…":"Generating round…"}
                </p>
              </div>
            ) : (
              <>
                <h2 style={{fontFamily:"Georgia,serif",fontSize:20,fontWeight:800,margin:"0 0 4px",
                  color:revealed?(correctNow?T.ok:climbStatus==="walked"?T.ok:T.bad):"#fff",transition:"color .4s"}}>
                  {revealed
                    ? (climbStatus==="walked"?"You cashed out — smart play 🚶":correctNow?`Step ${climbStep} cleared! ✓`:"The AI fooled you 🎭")
                    : "Which one is the BLUFF?"}
                </h2>
                <p style={{fontSize:12,color:T.dim,margin:0}}>
                  {revealed
                    ? (climbStatus==="walked"?"The bluff is revealed below":correctNow?(climbStep<10?`Climbing to step ${climbStep+1}…`:"GRAND BLUFF COMPLETE!"):explanation||"The lie is highlighted below")
                    : safetyFloor>0?`Safety floor: ${safetyFloor} pts | Aiming for ${rung.pts} pts`:`No safety net yet — ${rung.pts} pts if correct`}
                </p>
              </>
            )}
          </div>

          {/* Statement cards */}
          <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:16}}>
            {loading
              ? Array.from({length:5},(_,i)=>(
                  <div key={i} style={{height:68,borderRadius:14,background:T.card,
                    border:`1.5px solid ${T.glassBorder}`,
                    animation:`g-cardIn .35s ${i*.08}s both,g-shimmerBg 1.8s ${i*.1}s ease infinite`}}/>
                ))
              : stmts.map((s,i)=>{
                  const isB=revealed&&i===bluffIdx;
                  const isS=sel===i;
                  const isLiftedForCeremony = lockInMode&&isS;
                  let bg=T.card,border=T.glassBorder,glow="none",anim="";
                  if(!revealed&&isS){bg=T.goldDim;border="rgba(232,197,71,0.5)";glow=`0 0 20px ${T.goldDim}`;}
                  if(revealed&&isB){bg="rgba(244,63,94,0.08)";border="rgba(244,63,94,0.5)";glow="0 0 20px rgba(244,63,94,0.15)";anim=",g-revealGlow .8s";}
                  if(revealed&&isS&&correctNow){bg="rgba(45,212,160,0.08)";border="rgba(45,212,160,0.5)";glow="0 0 20px rgba(45,212,160,0.15)";anim=",g-correctGlow .8s";}
                  if(revealed&&isS&&!correctNow&&!isB) anim=",g-shake .5s";
                  return (
                    <button key={i} onClick={()=>!revealed&&!loading&&!lockInMode&&setSel(i)} style={{
                      width:"100%",display:"flex",alignItems:"flex-start",gap:10,
                      background:bg,border:`1.5px solid ${border}`,borderRadius:14,
                      padding:"13px",cursor:revealed||loading||lockInMode?"default":"pointer",
                      transition:"all .25s cubic-bezier(.4,0,.2,1)",
                      textAlign:"left",color:"#e8e6e1",fontSize:13,lineHeight:1.55,
                      fontFamily:"inherit",boxShadow:glow,
                      opacity:lockInMode&&!isS?0.3:1,
                      animation:`g-cardIn .35s ${i*.06}s both${anim}`,
                    }}>
                      <div style={{width:26,height:26,borderRadius:"50%",flexShrink:0,
                        border:`2px solid ${isS&&!revealed?T.gold:revealed&&isB?T.bad:"rgba(255,255,255,0.1)"}`,
                        display:"flex",alignItems:"center",justifyContent:"center",
                        fontSize:11,fontWeight:700,marginTop:2,
                        background:isS&&!revealed?T.gold:revealed&&isB?"rgba(244,63,94,0.2)":"transparent",
                        color:isS&&!revealed?T.bg:revealed&&isB?T.bad:T.dim,transition:"all .3s"}}>
                        {revealed&&isB?"!":String.fromCharCode(65+i)}
                      </div>
                      <div style={{flex:1}}>
                        {s.text}
                        {revealed&&(
                          <div style={{marginTop:6,fontSize:10,fontWeight:700,
                            color:isB?T.bad:isS&&!isB?T.bad:T.ok,
                            opacity:isB||isS?1:0.45,letterSpacing:0.5}}>
                            {isB?"🎭 AI FABRICATION":isS?"✗ This is actually real":"✓ Verified"}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
            }
          </div>

          {/* Action buttons */}
          {!revealed?(
            <div style={{display:"flex",gap:8}}>
              {canWalkAway&&(
                <button onClick={()=>setWalkAwayMode(true)} style={{
                  padding:"15px 14px",fontSize:13,fontWeight:600,
                  background:"rgba(45,212,160,0.08)",color:"#2dd4a0",
                  border:"1.5px solid rgba(45,212,160,0.2)",
                  borderRadius:14,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",
                }}>🚶 {rung.pts} pts</button>
              )}
              <button onClick={handleLockIn} disabled={sel===null||loading||ansLoading} style={{
                flex:1,padding:"15px",fontSize:14,fontWeight:700,letterSpacing:1,textTransform:"uppercase",
                background:sel!==null&&!loading?`linear-gradient(135deg,${T.gold},#d4a830)`:T.card,
                color:sel!==null&&!loading?T.bg:T.dim,
                border:sel!==null&&!loading?"none":`1.5px solid ${T.glassBorder}`,
                borderRadius:14,cursor:sel!==null&&!loading&&!ansLoading?"pointer":"not-allowed",
                transition:"all .3s",fontFamily:"inherit",
                boxShadow:sel!==null&&!loading?`0 0 40px ${T.goldDim}`:"none",
                position:"relative",overflow:"hidden",
              }}>
                {sel!==null&&!loading&&<div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>}
                <span style={{position:"relative"}}>
                  {ansLoading?"Checking…":sel!==null?"🔒 Lock In":"Select a statement"}
                </span>
              </button>
            </div>
          ):(
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{setScreen("home");}} style={{flex:1,padding:"14px",fontSize:13,fontWeight:600,
                background:T.glass,color:"#e8e6e1",border:`1.5px solid ${T.glassBorder}`,
                borderRadius:14,cursor:"pointer",fontFamily:"inherit"}}>Home</button>
              {(climbStatus==="active"&&correctNow&&climbStep<10)&&(
                <button onClick={nextStep} style={{flex:2,padding:"14px",fontSize:14,fontWeight:700,
                  letterSpacing:1,textTransform:"uppercase",
                  background:`linear-gradient(135deg,${T.gold},#d4a830)`,
                  color:T.bg,border:"none",borderRadius:14,cursor:"pointer",
                  fontFamily:"inherit",position:"relative",overflow:"hidden"}}>
                  <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
                  <span style={{position:"relative"}}>Step {climbStep+1} ↑</span>
                </button>
              )}
              {(climbStatus==="failed"||climbStatus==="won"||climbStatus==="walked")&&(
                <button onClick={()=>setScreen("result")} style={{flex:2,padding:"14px",fontSize:14,fontWeight:700,
                  background:`linear-gradient(135deg,${T.gold},#d4a830)`,color:T.bg,border:"none",
                  borderRadius:14,cursor:"pointer",fontFamily:"inherit",position:"relative",overflow:"hidden"}}>
                  <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
                  <span style={{position:"relative"}}>See results →</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <GameStyles/>
    </div>
  );
}

function GameStyles() {
  return <style>{`
    @keyframes g-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
    @keyframes g-fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes g-fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes g-shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
    @keyframes g-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
    @keyframes g-confetti{0%{transform:translateY(-10px) rotate(0);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:0}}
    @keyframes g-btnShimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
    @keyframes g-cardIn{from{opacity:0;transform:translateX(-14px) scale(.97)}to{opacity:1;transform:none}}
    @keyframes g-riseUp{from{opacity:0;transform:translateY(30px) scale(0.9)}to{opacity:1;transform:none}}
    @keyframes g-shake{0%,100%{transform:translateX(0)}15%,45%,75%{transform:translateX(-5px)}30%,60%,90%{transform:translateX(5px)}}
    @keyframes g-revealGlow{0%{box-shadow:0 0 0 rgba(244,63,94,0)}50%{box-shadow:0 0 30px rgba(244,63,94,.3)}100%{box-shadow:0 0 15px rgba(244,63,94,.1)}}
    @keyframes g-correctGlow{0%{box-shadow:0 0 0 rgba(45,212,160,0)}50%{box-shadow:0 0 30px rgba(45,212,160,.4)}100%{box-shadow:0 0 15px rgba(45,212,160,.15)}}
    @keyframes g-shimmerBg{0%,100%{opacity:0.5}50%{opacity:1}}
    * { -webkit-tap-highlight-color: transparent; }
  `}</style>;
}

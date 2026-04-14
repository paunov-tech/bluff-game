// src/App.jsx — BLUFF™ The AI Deception Game
// Based on bluff-final.jsx + API-backed rounds + Stripe paywall
import { useState, useEffect, useRef, useCallback } from "react";

// ── Config ──────────────────────────────────────────────────────
const FREE_ROUNDS_PER_DAY = 3;

const CATS = [
  { id: "history",    emoji: "🏛️",  label: "History"    },
  { id: "science",    emoji: "🔬",  label: "Science"    },
  { id: "animals",    emoji: "🦎",  label: "Animals"    },
  { id: "geography",  emoji: "🌍",  label: "Geography"  },
  { id: "food",       emoji: "🍕",  label: "Food"       },
  { id: "technology", emoji: "💻",  label: "Technology" },
  { id: "culture",    emoji: "🎭",  label: "Culture"    },
  { id: "sports",     emoji: "⚽",  label: "Sports"     },
];

// ── Storage helpers ─────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem("bluff_did");
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("bluff_did", id); }
  return id;
}

function getPremium() {
  try {
    const p = JSON.parse(localStorage.getItem("bluff_premium") || "{}");
    if (p.expiresAt && new Date(p.expiresAt) > new Date()) return p;
  } catch {}
  return null;
}

function getRoundsToday() {
  const today = new Date().toDateString();
  const s = JSON.parse(localStorage.getItem("bluff_today") || '{"d":"","c":0}');
  return s.d === today ? s.c : 0;
}

function incRoundsToday() {
  const today = new Date().toDateString();
  const c = getRoundsToday() + 1;
  localStorage.setItem("bluff_today", JSON.stringify({ d: today, c }));
  return c;
}

// ══════════════════════════════════════════════════════════════════
// CINEMATIC INTRO (from bluff-final.jsx)
// ══════════════════════════════════════════════════════════════════
function CinematicIntro({ onComplete }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 2800),
      setTimeout(() => setPhase(3), 4200),
      setTimeout(() => setPhase(4), 6200),
    ];
    return () => t.forEach(clearTimeout);
  }, []);

  return (
    <div onClick={() => phase >= 3 && onComplete()} style={{
      position:"fixed",inset:0,zIndex:10000,background:"#040408",
      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
      cursor:phase>=3?"pointer":"default",overflow:"hidden",
    }}>
      {/* Particles */}
      <div style={{position:"absolute",inset:0,pointerEvents:"none"}}>
        {Array.from({length:30},(_,i)=>(
          <div key={i} style={{
            position:"absolute",width:2+Math.random()*4,height:2+Math.random()*4,
            borderRadius:"50%",background:"#e8c547",
            left:`${Math.random()*100}%`,top:`${Math.random()*100}%`,
            opacity:phase>=2?0.08+Math.random()*0.15:0,
            transition:`opacity ${1+Math.random()*2}s ease ${Math.random()}s`,
            animation:phase>=2?`ci-sparkle ${3+Math.random()*4}s ease-in-out ${Math.random()*2}s infinite`:"none",
          }}/>
        ))}
      </div>
      {/* Glow */}
      <div style={{position:"absolute",width:phase>=3?600:300,height:phase>=3?600:300,borderRadius:"50%",
        background:"radial-gradient(circle,rgba(232,197,71,0.12) 0%,transparent 70%)",
        opacity:phase>=1?1:0,transition:"all 1.5s ease",filter:"blur(40px)"}}/>
      {/* Light streak */}
      <div style={{position:"absolute",top:"48%",left:0,right:0,height:2,
        background:"linear-gradient(90deg,transparent,rgba(232,197,71,0.6) 45%,rgba(255,255,255,0.8) 50%,rgba(232,197,71,0.6) 55%,transparent)",
        opacity:phase===2?1:0,transform:phase===2?"scaleX(1.5)":"scaleX(0)",
        transition:"all 0.6s cubic-bezier(0.16,1,0.3,1)",filter:"blur(1px)"}}/>

      {/* SIAL GAMES SEAL (phase 1-2) */}
      <div style={{position:"absolute",opacity:phase>=1&&phase<3?1:0,
        transform:phase===1?"scale(1) rotate(0deg)":phase===2?"scale(0.8) rotate(-5deg)":"scale(1.5)",
        transition:phase===1?"all 0.8s cubic-bezier(0.34,1.56,0.64,1)":"all 0.8s cubic-bezier(0.4,0,0.2,1)",
        display:"flex",flexDirection:"column",alignItems:"center"}}>
        <div style={{width:200,height:200,borderRadius:"50%",border:"3px solid rgba(232,197,71,0.5)",
          display:"flex",alignItems:"center",justifyContent:"center",position:"relative",
          boxShadow:phase>=1?"0 0 40px rgba(232,197,71,0.15),inset 0 0 30px rgba(232,197,71,0.08)":"none",
          transition:"box-shadow 0.5s"}}>
          <div style={{width:175,height:175,borderRadius:"50%",border:"1.5px solid rgba(232,197,71,0.25)",
            display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
            <div style={{fontSize:10,letterSpacing:8,color:"rgba(232,197,71,0.5)",marginBottom:6}}>★ ★ ★</div>
            <div style={{fontFamily:"Georgia,'Times New Roman',serif",fontSize:36,fontWeight:700,letterSpacing:6,
              color:"#e8c547",textShadow:"0 0 20px rgba(232,197,71,0.4)",lineHeight:1}}>SIAL</div>
            <div style={{width:80,height:1.5,margin:"8px 0",background:"linear-gradient(90deg,transparent,rgba(232,197,71,0.5),transparent)"}}/>
            <div style={{fontSize:13,letterSpacing:7,fontWeight:600,color:"rgba(232,197,71,0.7)",textTransform:"uppercase"}}>GAMES</div>
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
          opacity:phase>=1?1:0,transform:phase>=1?"translateY(0)":"translateY(10px)",
          transition:"all 0.6s ease 0.4s"}}>PRESENTS</div>
      </div>

      {/* BLUFF™ LOGO (phase 3+) */}
      <div style={{position:"absolute",display:"flex",flexDirection:"column",alignItems:"center",
        opacity:phase>=3?1:0,transform:phase>=3?"scale(1) translateY(0)":"scale(0.5) translateY(20px)",
        transition:"all 1s cubic-bezier(0.34,1.56,0.64,1) 0.1s"}}>
        <div style={{position:"relative"}}>
          <h1 style={{fontFamily:"Georgia,'Times New Roman',serif",fontSize:88,fontWeight:900,letterSpacing:-2,
            margin:0,lineHeight:1,
            background:"linear-gradient(135deg,#e8c547 0%,#f0d878 30%,#fff 50%,#f0d878 70%,#e8c547 100%)",
            backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
            animation:phase>=3?"ci-logoShimmer 3s ease infinite":"none",
            filter:"drop-shadow(0 0 30px rgba(232,197,71,0.3))"}}>
            BLUFF
            <sup style={{fontSize:16,fontWeight:500,WebkitTextFillColor:"rgba(232,197,71,0.6)",
              position:"relative",top:-40,marginLeft:2,fontFamily:"system-ui,sans-serif"}}>™</sup>
          </h1>
          <div style={{position:"absolute",top:"20%",left:"22%",width:8,height:8,borderRadius:"50%",
            background:"#fff",boxShadow:"0 0 15px 5px rgba(255,255,255,0.5),0 0 40px 10px rgba(232,197,71,0.3)",
            opacity:phase===3?1:0,transition:"opacity 0.3s ease 0.8s",
            animation:phase>=3?"ci-flare 2s ease 0.8s":"none"}}/>
        </div>
        <div style={{width:phase>=3?200:0,height:2,marginTop:12,
          background:"linear-gradient(90deg,transparent,rgba(232,197,71,0.5),transparent)",
          transition:"width 0.8s cubic-bezier(0.16,1,0.3,1) 0.5s"}}/>
        <div style={{marginTop:14,fontSize:14,letterSpacing:5,color:"rgba(232,197,71,0.6)",
          textTransform:"uppercase",fontWeight:500,
          opacity:phase>=4?1:0,transform:phase>=4?"translateY(0)":"translateY(10px)",
          transition:"all 0.6s ease 0.2s"}}>The AI Deception Game</div>
        <div style={{marginTop:40,fontSize:13,letterSpacing:3,color:"rgba(255,255,255,0.3)",
          textTransform:"uppercase",opacity:phase>=4?1:0,
          animation:phase>=4?"ci-tapPulse 2s ease-in-out infinite":"none"}}>Tap anywhere to play</div>
      </div>

      <style>{`
        @keyframes ci-sparkle{0%,100%{transform:translateY(0);opacity:0.05}50%{transform:translateY(-12px);opacity:0.2}}
        @keyframes ci-spin{to{transform:rotate(360deg)}}
        @keyframes ci-logoShimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        @keyframes ci-tapPulse{0%,100%{opacity:0.3}50%{opacity:0.6}}
        @keyframes ci-flare{0%{transform:scale(1);opacity:1}50%{transform:scale(3);opacity:0.6}100%{transform:scale(1);opacity:0}}
      `}</style>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// GAME PRIMITIVES
// ══════════════════════════════════════════════════════════════════
function Particles({ count = 20 }) {
  const ps = useRef(Array.from({ length: count }, () => ({
    x: Math.random() * 100, y: Math.random() * 100,
    s: 2 + Math.random() * 4, d: 3 + Math.random() * 6,
    dl: Math.random() * 4, o: 0.05 + Math.random() * 0.12,
  }))).current;
  return (
    <div style={{ position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none",zIndex:0 }}>
      {ps.map((p, i) => (
        <div key={i} style={{
          position:"absolute",width:p.s,height:p.s,borderRadius:"50%",
          background:"#e8c547",opacity:p.o,left:`${p.x}%`,top:`${p.y}%`,
          animation:`g-float ${p.d}s ease-in-out ${p.dl}s infinite`,
        }}/>
      ))}
    </div>
  );
}

function Confetti() {
  const colors = ["#e8c547","#2dd4a0","#f0d878","#60a5fa","#f43f5e","#a78bfa","#fb923c"];
  const ps = useRef(Array.from({ length: 60 }, () => ({
    x: Math.random() * 100, dl: Math.random() * 1.2,
    c: colors[Math.floor(Math.random() * colors.length)],
    w: 4 + Math.random() * 10, h: 4 + Math.random() * 10,
    r: Math.random() > 0.5, dur: 1.5 + Math.random() * 1.5,
  }))).current;
  return (
    <div style={{ position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,overflow:"hidden" }}>
      {ps.map((p, i) => (
        <div key={i} style={{
          position:"absolute",top:-20,left:`${p.x}%`,
          width:p.w,height:p.h,background:p.c,
          borderRadius:p.r?"50%":"2px",
          animation:`g-confetti ${p.dur}s ease-in ${p.dl}s forwards`,
        }}/>
      ))}
    </div>
  );
}

function TimerRing({ time, max = 45, size = 50 }) {
  const r = (size - 6) / 2, circ = 2 * Math.PI * r, pct = time / max;
  const color = time <= 10 ? "#f43f5e" : time <= 20 ? "#fb923c" : "#e8c547";
  return (
    <div style={{ position:"relative",width:size,height:size }}>
      <svg width={size} height={size} style={{ transform:"rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={circ} strokeDashoffset={circ*(1-pct)}
          strokeLinecap="round" style={{ transition:"stroke-dashoffset 1s linear,stroke .3s" }}/>
      </svg>
      <div style={{
        position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:16,fontWeight:700,color,
        animation:time<=5?"g-pulse .5s infinite":"none",
      }}>{time}</div>
    </div>
  );
}

// ── Paywall modal ───────────────────────────────────────────────
function Paywall({ onClose, onSuccess, deviceId }) {
  const [plan, setPlan]     = useState("yearly");
  const [email, setEmail]   = useState("");
  const [loading, setLoad]  = useState(false);
  const [recMode, setRecMode] = useState(false);
  const [recEmail, setRec]  = useState("");
  const [recLoading, setRL] = useState(false);
  const [msg, setMsg]       = useState("");

  const T = { bg:"#08080f",card:"#111119",gold:"#e8c547",dim:"#5a5a68",glassBorder:"rgba(255,255,255,0.07)" };

  const PLANS = [
    { id:"monthly",  price:"€4.99/mo",  save:"",          label:"Pro Monthly"  },
    { id:"yearly",   price:"€34.99/yr", save:"Save 42%",  label:"Pro Yearly"   },
    { id:"lifetime", price:"€69.99",    save:"Best deal!", label:"Pro Lifetime" },
  ];

  async function checkout() {
    setLoad(true); setMsg("");
    try {
      const r = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, deviceId, email: email || undefined, returnPath: "/" }),
      });
      const d = await r.json();
      if (d.url) window.location.href = d.url;
      else setMsg(d.error || "Payment unavailable");
    } catch { setMsg("Connection error"); }
    finally { setLoad(false); }
  }

  async function recover() {
    setRL(true); setMsg("");
    try {
      const r = await fetch("/api/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: recEmail, deviceId }),
      });
      const d = await r.json();
      if (d.recovered) {
        const expiresAt = d.expiresAt;
        localStorage.setItem("bluff_premium", JSON.stringify({ plan: d.plan, expiresAt }));
        setMsg("✓ Premium restored!");
        setTimeout(() => { onSuccess(); onClose(); }, 1200);
      } else {
        setMsg(d.error || "No subscription found for this email");
      }
    } catch { setMsg("Connection error"); }
    finally { setRL(false); }
  }

  return (
    <div style={{
      position:"fixed",inset:0,zIndex:5000,
      background:"rgba(4,4,8,0.92)",backdropFilter:"blur(12px)",
      display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",
    }}>
      <div style={{
        width:"100%",maxWidth:380,background:T.card,borderRadius:24,
        border:`1px solid ${T.glassBorder}`,padding:"28px 24px",
        animation:"g-fadeUp .4s ease",
      }}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:28,fontFamily:"Georgia,serif",fontWeight:900,
            background:"linear-gradient(135deg,#e8c547,#f0d878)",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",marginBottom:4}}>
            BLUFF™ Pro
          </div>
          <div style={{fontSize:13,color:T.dim}}>You've used your 3 free rounds today</div>
        </div>

        {!recMode ? (
          <>
            <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:18}}>
              {PLANS.map(p => (
                <div key={p.id} onClick={() => setPlan(p.id)} style={{
                  padding:"14px 16px",borderRadius:14,cursor:"pointer",
                  border:`1.5px solid ${plan===p.id?"#e8c547":T.glassBorder}`,
                  background:plan===p.id?"rgba(232,197,71,0.06)":"transparent",
                  display:"flex",justifyContent:"space-between",alignItems:"center",
                  transition:"all .2s",
                }}>
                  <div>
                    <div style={{fontSize:14,fontWeight:600,color:plan===p.id?"#e8c547":"#e8e6e1"}}>{p.label}</div>
                    <div style={{fontSize:12,color:T.dim,marginTop:2}}>{p.price}</div>
                  </div>
                  {p.save && (
                    <div style={{fontSize:11,fontWeight:700,color:"#2dd4a0",background:"rgba(45,212,160,0.1)",
                      padding:"3px 8px",borderRadius:8}}>{p.save}</div>
                  )}
                </div>
              ))}
            </div>

            <div style={{marginBottom:14}}>
              <input
                type="email" placeholder="Email (optional — for recovery)"
                value={email} onChange={e => setEmail(e.target.value)}
                style={{width:"100%",padding:"12px 14px",borderRadius:12,border:`1px solid ${T.glassBorder}`,
                  background:"rgba(255,255,255,0.03)",color:"#e8e6e1",fontSize:13,outline:"none",fontFamily:"inherit"}}
              />
            </div>

            <button onClick={checkout} disabled={loading} style={{
              width:"100%",padding:"16px",fontSize:15,fontWeight:700,letterSpacing:1,
              textTransform:"uppercase",borderRadius:14,border:"none",cursor:"pointer",
              background:"linear-gradient(135deg,#e8c547,#d4a830)",color:T.bg,
              fontFamily:"inherit",position:"relative",overflow:"hidden",
              opacity:loading?0.7:1,
            }}>
              <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
              <span style={{position:"relative"}}>{loading?"Redirecting…":"Upgrade to Pro"}</span>
            </button>

            {msg && <div style={{marginTop:10,fontSize:12,color:"#f43f5e",textAlign:"center"}}>{msg}</div>}

            <div style={{display:"flex",justifyContent:"space-between",marginTop:16,fontSize:12,color:T.dim}}>
              <button onClick={onClose} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
                Maybe later
              </button>
              <button onClick={() => { setRecMode(true); setMsg(""); }} style={{background:"none",border:"none",color:T.dim,cursor:"pointer",fontSize:12,fontFamily:"inherit"}}>
                Already paid?
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{fontSize:13,color:T.dim,marginBottom:14,textAlign:"center"}}>Enter the email used at purchase to restore your subscription.</div>
            <input
              type="email" placeholder="your@email.com"
              value={recEmail} onChange={e => setRec(e.target.value)}
              style={{width:"100%",padding:"12px 14px",borderRadius:12,border:`1px solid ${T.glassBorder}`,
                background:"rgba(255,255,255,0.03)",color:"#e8e6e1",fontSize:13,outline:"none",
                fontFamily:"inherit",marginBottom:12}}
            />
            <button onClick={recover} disabled={recLoading} style={{
              width:"100%",padding:"14px",fontSize:14,fontWeight:700,borderRadius:12,border:"none",
              background:"linear-gradient(135deg,#e8c547,#d4a830)",color:T.bg,cursor:"pointer",
              fontFamily:"inherit",opacity:recLoading?0.7:1,
            }}>
              {recLoading ? "Checking…" : "Restore Access"}
            </button>
            {msg && <div style={{marginTop:10,fontSize:12,color:msg.startsWith("✓")?"#2dd4a0":"#f43f5e",textAlign:"center"}}>{msg}</div>}
            <button onClick={() => { setRecMode(false); setMsg(""); }} style={{
              display:"block",margin:"14px auto 0",background:"none",border:"none",
              color:T.dim,cursor:"pointer",fontSize:12,fontFamily:"inherit",
            }}>← Back</button>
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// MAIN APP
// ══════════════════════════════════════════════════════════════════
export default function BluffGame() {
  const [showIntro, setShowIntro]     = useState(true);
  const [screen, setScreen]           = useState("home");

  // Game state
  const [roundId, setRoundId]         = useState(null);
  const [stmts, setStmts]             = useState([]);      // [{text}]
  const [sel, setSel]                 = useState(null);
  const [revealed, setRevealed]       = useState(false);
  const [bluffIdx, setBluffIdx]       = useState(null);
  const [explanation, setExplanation] = useState("");
  const [catInfo, setCatInfo]         = useState(CATS[0]);
  const [difficulty, setDifficulty]   = useState("medium");

  // Session stats
  const [score, setScore]   = useState(0);
  const [total, setTotal]   = useState(0);
  const [streak, setStreak] = useState(0);
  const [best, setBest]     = useState(0);

  // Timer
  const [time, setTime]           = useState(45);
  const timerRef                  = useRef(null);

  // UI
  const [loading, setLoading]         = useState(false);
  const [ansLoading, setAnsLoading]   = useState(false);
  const [showConfetti, setConfetti]   = useState(false);
  const [showPaywall, setPaywall]     = useState(false);
  const [premium, setPremium]         = useState(() => !!getPremium());
  const [error, setError]             = useState("");

  const deviceId = useRef(getDeviceId()).current;

  // ── Check for payment success on mount ──────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (params.get("payment") === "success" && sessionId) {
      fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
        .then(r => r.json())
        .then(d => {
          if (d.verified) {
            const expiresAt = new Date(Date.now() + d.days * 86400000).toISOString();
            localStorage.setItem("bluff_premium", JSON.stringify({ plan: d.plan, expiresAt }));
            setPremium(true);
          }
        })
        .catch(() => {});
      window.history.replaceState({}, "", "/");
    }
  }, []);

  // ── Auto-reveal when timer hits 0 ───────────────────────
  useEffect(() => {
    if (time <= 0 && !revealed && stmts.length > 0) doReveal(null);
  }, [time]);

  useEffect(() => () => clearInterval(timerRef.current), []);

  // ── Generate round via API ───────────────────────────────
  const startRound = useCallback(async (catId, diff) => {
    const cat  = catId  || CATS[Math.floor(Math.random() * CATS.length)].id;
    const dif  = diff   || difficulty;
    const info = CATS.find(c => c.id === cat) || CATS[0];

    if (!premium && getRoundsToday() >= FREE_ROUNDS_PER_DAY) {
      setPaywall(true);
      return;
    }

    setCatInfo(info);
    setLoading(true);
    setScreen("play");
    setSel(null);
    setRevealed(false);
    setBluffIdx(null);
    setExplanation("");
    setStmts([]);
    setError("");
    setConfetti(false);
    clearInterval(timerRef.current);

    try {
      const r = await fetch("/api/generate-round", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: cat, difficulty: dif, lang: "en" }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "AI unavailable");

      setRoundId(data.roundId);
      setStmts(data.statements);
      setTime(45);
      timerRef.current = setInterval(() => setTime(t => t - 1), 1000);
      incRoundsToday();
    } catch (e) {
      setError(e.message);
      setScreen("home");
    } finally {
      setLoading(false);
    }
  }, [difficulty, premium]);

  // ── Check answer via API ─────────────────────────────────
  const doReveal = useCallback(async (selectedIdx) => {
    clearInterval(timerRef.current);
    setAnsLoading(true);
    const finalSel = selectedIdx !== undefined ? selectedIdx : sel;

    try {
      const r = await fetch("/api/check-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId, selectedIndex: finalSel, deviceId }),
      });
      const data = await r.json();

      setBluffIdx(data.bluffIndex ?? null);
      setExplanation(data.explanation || "");
      setRevealed(true);
      setTotal(t => t + 1);

      if (data.correct) {
        setScore(s => s + 1);
        setStreak(s => { const n = s + 1; setBest(b => Math.max(b, n)); return n; });
        setConfetti(true);
        setTimeout(() => setConfetti(false), 3500);
      } else {
        setStreak(0);
      }
    } catch {
      setRevealed(true);
      setTotal(t => t + 1);
      setStreak(0);
    } finally {
      setAnsLoading(false);
    }
  }, [roundId, sel, deviceId]);

  const correct = revealed && sel !== null && sel === bluffIdx;

  // ─── Theme ────────────────────────────────────────────────
  const T = {
    bg:"#08080f",card:"#111119",gold:"#e8c547",gold2:"#f0d878",
    goldDim:"rgba(232,197,71,0.1)",ok:"#2dd4a0",bad:"#f43f5e",
    dim:"#5a5a68",glass:"rgba(255,255,255,0.03)",glassBorder:"rgba(255,255,255,0.07)",
  };

  const wrap = {
    minHeight:"100dvh",
    background:`radial-gradient(ellipse at 50% 0%,rgba(232,197,71,0.05) 0%,${T.bg} 55%)`,
    fontFamily:"'DM Sans','Instrument Sans',system-ui,sans-serif",
    display:"flex",flexDirection:"column",alignItems:"center",
    position:"relative",overflow:"hidden",color:"#e8e6e1",
  };

  // ─── INTRO ────────────────────────────────────────────────
  if (showIntro) return <CinematicIntro onComplete={() => setShowIntro(false)} />;

  // ─── HOME ─────────────────────────────────────────────────
  if (screen === "home") return (
    <div style={wrap}>
      <Particles />
      {showPaywall && (
        <Paywall
          deviceId={deviceId}
          onClose={() => setPaywall(false)}
          onSuccess={() => { setPremium(true); setPaywall(false); }}
        />
      )}
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:440,padding:"50px 20px 40px",textAlign:"center"}}>
        <div style={{fontSize:11,letterSpacing:7,color:T.dim,marginBottom:18,fontWeight:500}}>SIAL GAMES</div>
        <h1 style={{
          fontFamily:"Georgia,serif",fontSize:72,fontWeight:900,letterSpacing:-2,
          margin:"0 0 2px",lineHeight:1,
          background:`linear-gradient(135deg,${T.gold},${T.gold2},rgba(255,255,255,0.5),${T.gold})`,
          backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          animation:"g-shimmer 4s linear infinite",
          filter:"drop-shadow(0 0 30px rgba(232,197,71,0.2))",
        }}>
          BLUFF
          <sup style={{fontSize:14,WebkitTextFillColor:"rgba(232,197,71,0.5)",position:"relative",top:-35,fontFamily:"system-ui",fontWeight:400}}>™</sup>
        </h1>
        <p style={{fontSize:13,color:T.dim,letterSpacing:4,textTransform:"uppercase",margin:"0 0 32px",fontWeight:500}}>
          The AI Deception Game
        </p>

        {/* How to play */}
        <div style={{background:T.glass,backdropFilter:"blur(16px)",borderRadius:18,
          border:`1px solid ${T.glassBorder}`,padding:"24px 20px",marginBottom:20,textAlign:"left",
          animation:"g-fadeUp .6s .1s both"}}>
          <div style={{fontSize:11,color:T.gold,letterSpacing:3,textTransform:"uppercase",fontWeight:600,marginBottom:14}}>
            How to play
          </div>
          {[
            ["🧠","AI generates 5 surprising statements"],
            ["🎭","One is a masterfully crafted LIE"],
            ["⏱️","Find the BLUFF before time runs out"],
            ["🔥","Build streaks · Climb the leaderboard"],
          ].map(([e, t], i) => (
            <div key={i} style={{display:"flex",gap:10,marginBottom:i<3?11:0,fontSize:14,lineHeight:1.5,
              animation:`g-fadeUp .5s ${.15+i*.08}s both`}}>
              <span style={{fontSize:16}}>{e}</span>
              <span style={{opacity:.8}}>{t}</span>
            </div>
          ))}
        </div>

        {/* Stats */}
        {total > 0 && (
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20,animation:"g-fadeUp .6s .3s both"}}>
            {[[score,"Correct",T.ok],[total,"Played",T.gold],[best,"Best streak","#a78bfa"]].map(([v,l,c],i)=>(
              <div key={i} style={{background:T.glass,borderRadius:14,border:`1px solid ${T.glassBorder}`,padding:"14px 8px",textAlign:"center"}}>
                <div style={{fontSize:28,fontWeight:800,color:c,fontFamily:"Georgia,serif"}}>{v}</div>
                <div style={{fontSize:10,color:T.dim,letterSpacing:1,textTransform:"uppercase",marginTop:3}}>{l}</div>
              </div>
            ))}
          </div>
        )}

        {/* Free rounds indicator */}
        {!premium && (
          <div style={{marginBottom:14,fontSize:12,color:T.dim,animation:"g-fadeUp .5s .35s both"}}>
            {Math.max(0, FREE_ROUNDS_PER_DAY - getRoundsToday())} free rounds remaining today
            {getRoundsToday() >= FREE_ROUNDS_PER_DAY && (
              <button onClick={() => setPaywall(true)} style={{
                marginLeft:8,color:T.gold,background:"none",border:"none",cursor:"pointer",
                fontSize:12,fontFamily:"inherit",textDecoration:"underline",
              }}>Upgrade</button>
            )}
          </div>
        )}
        {premium && (
          <div style={{marginBottom:14,fontSize:11,color:T.dim,animation:"g-fadeUp .5s .35s both"}}>
            ✦ Pro — unlimited rounds
          </div>
        )}

        {error && <div style={{marginBottom:12,fontSize:13,color:T.bad,animation:"g-fadeUp .3s"}}>{error}</div>}

        {/* Play button */}
        <button
          onClick={() => startRound(null, null)}
          disabled={loading}
          style={{
            width:"100%",padding:"18px",fontSize:16,fontWeight:700,letterSpacing:2,textTransform:"uppercase",
            background:loading?"rgba(232,197,71,0.3)":`linear-gradient(135deg,${T.gold},#d4a830)`,
            color:T.bg,border:"none",borderRadius:16,
            cursor:loading?"wait":"pointer",position:"relative",overflow:"hidden",fontFamily:"inherit",
            boxShadow:loading?"none":`0 0 50px ${T.goldDim},0 4px 20px rgba(232,197,71,0.2)`,
            animation:"g-fadeUp .6s .4s both",transition:"transform .2s,background .3s",
          }}
          onMouseDown={e=>e.currentTarget.style.transform="scale(0.97)"}
          onMouseUp={e=>e.currentTarget.style.transform=""}
        >
          {!loading && <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 3s infinite"}}/>}
          <span style={{position:"relative"}}>
            {loading ? "Generating round…" : total > 0 ? "Play again" : "Find the bluff"}
          </span>
        </button>

        <div style={{marginTop:28,fontSize:11,color:"rgba(255,255,255,0.12)",letterSpacing:1}}>
          BLUFF™ · SIAL Consulting d.o.o.
        </div>
      </div>
      <GameStyles />
    </div>
  );

  // ─── PLAY ─────────────────────────────────────────────────
  return (
    <div style={wrap}>
      <Particles count={10} />
      {showConfetti && <Confetti />}

      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:460,padding:"20px 16px 36px"}}>
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:22}}>{catInfo.emoji}</span>
            <div>
              <div style={{fontSize:11,color:T.gold,letterSpacing:3,textTransform:"uppercase",fontWeight:600}}>{catInfo.label}</div>
              <div style={{fontSize:10,color:T.dim}}>Round {total + 1}</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            {streak > 0 && (
              <div style={{fontSize:13,color:T.gold,fontWeight:700,display:"flex",alignItems:"center",gap:3,
                background:T.goldDim,padding:"4px 10px",borderRadius:20,
                animation:streak>=3?"g-fire .6s infinite":"none"}}>
                🔥{streak}
              </div>
            )}
            {!revealed
              ? <TimerRing time={time} />
              : <div style={{width:50,height:50,borderRadius:"50%",
                  background:correct?"rgba(45,212,160,0.12)":"rgba(244,63,94,0.12)",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:22,animation:"g-pulse .5s",color:correct?T.ok:T.bad}}>
                  {correct ? "✓" : "✗"}
                </div>
            }
          </div>
        </div>

        {/* Prompt */}
        <div style={{textAlign:"center",marginBottom:18,
          animation:revealed&&!correct?"g-shake .5s":"none"}}>
          {loading ? (
            <div>
              <h2 style={{fontFamily:"Georgia,serif",fontSize:20,fontWeight:800,margin:"0 0 6px",color:T.dim}}>
                Generating round…
              </h2>
              <p style={{fontSize:13,color:T.dim,margin:0}}>Claude is crafting 5 statements + 1 perfect lie</p>
            </div>
          ) : (
            <>
              <h2 style={{fontFamily:"Georgia,serif",fontSize:22,fontWeight:800,margin:"0 0 4px",
                color:revealed?(correct?T.ok:T.bad):"#fff",transition:"color .4s"}}>
                {revealed
                  ? (correct ? "Brilliant! You found it 🎯" : "The AI fooled you 🎭")
                  : "Which one is the BLUFF?"}
              </h2>
              <p style={{fontSize:13,color:T.dim,margin:0}}>
                {revealed
                  ? (correct ? "Your instincts beat the machine" : explanation || "The fabricated lie is highlighted below")
                  : "One of these was invented by AI. Trust your gut."}
              </p>
            </>
          )}
        </div>

        {/* Statement cards */}
        <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:20}}>
          {loading
            ? Array.from({length:5},(_,i)=>(
                <div key={i} style={{height:72,borderRadius:16,background:T.card,
                  border:`1.5px solid ${T.glassBorder}`,
                  animation:`g-cardIn .35s ${i*.08}s both,g-shimmerBg 1.8s ${i*.1}s ease infinite`}}/>
              ))
            : stmts.map((s, i) => {
                const isB = revealed && i === bluffIdx;
                const isS = sel === i;
                let bg=T.card, border=T.glassBorder, glow="none", anim="";
                if (!revealed && isS) { bg=T.goldDim; border="rgba(232,197,71,0.5)"; glow=`0 0 20px ${T.goldDim}`; }
                if (revealed && isB) { bg="rgba(244,63,94,0.08)"; border="rgba(244,63,94,0.5)"; glow="0 0 20px rgba(244,63,94,0.15)"; anim=",g-revealGlow .8s"; }
                if (revealed && isS && correct) { bg="rgba(45,212,160,0.08)"; border="rgba(45,212,160,0.5)"; glow="0 0 20px rgba(45,212,160,0.15)"; anim=",g-correctGlow .8s"; }
                if (revealed && isS && !correct && !isB) anim=",g-shake .5s";

                return (
                  <button key={i} onClick={() => !revealed && !loading && setSel(i)} style={{
                    width:"100%",display:"flex",alignItems:"flex-start",gap:12,
                    background:bg,border:`1.5px solid ${border}`,borderRadius:16,
                    padding:"14px",cursor:revealed||loading?"default":"pointer",
                    transition:"all .25s cubic-bezier(.4,0,.2,1)",
                    textAlign:"left",color:"#e8e6e1",fontSize:14,lineHeight:1.6,
                    fontFamily:"inherit",boxShadow:glow,
                    animation:`g-cardIn .35s ${i*.06}s both${anim}`,
                  }}>
                    <div style={{
                      width:28,height:28,borderRadius:"50%",flexShrink:0,
                      border:`2px solid ${isS&&!revealed?T.gold:revealed&&isB?T.bad:"rgba(255,255,255,0.1)"}`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:12,fontWeight:700,marginTop:2,
                      background:isS&&!revealed?T.gold:revealed&&isB?"rgba(244,63,94,0.2)":"transparent",
                      color:isS&&!revealed?T.bg:revealed&&isB?T.bad:T.dim,
                      transition:"all .3s",
                    }}>
                      {revealed && isB ? "!" : String.fromCharCode(65+i)}
                    </div>
                    <div style={{flex:1}}>
                      {s.text}
                      {revealed && (
                        <div style={{marginTop:7,fontSize:11,fontWeight:700,
                          color:isB?T.bad:isS&&!isB?T.bad:T.ok,
                          opacity:isB||isS?1:0.45,letterSpacing:1}}>
                          {isB ? "🎭 AI FABRICATION" : isS ? "✗ This is actually real" : "✓ Verified"}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
          }
        </div>

        {/* Action button */}
        {!revealed ? (
          <button onClick={() => doReveal(sel)} disabled={sel===null||loading||ansLoading} style={{
            width:"100%",padding:"17px",fontSize:15,fontWeight:700,letterSpacing:1.5,
            textTransform:"uppercase",
            background:sel!==null&&!loading?`linear-gradient(135deg,${T.gold},#d4a830)`:T.card,
            color:sel!==null&&!loading?T.bg:T.dim,
            border:sel!==null&&!loading?"none":`1.5px solid ${T.glassBorder}`,
            borderRadius:16,
            cursor:sel!==null&&!loading&&!ansLoading?"pointer":"not-allowed",
            transition:"all .3s",fontFamily:"inherit",
            boxShadow:sel!==null&&!loading?`0 0 40px ${T.goldDim}`:"none",
            position:"relative",overflow:"hidden",
          }}>
            {sel!==null&&!loading&&<div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>}
            <span style={{position:"relative"}}>
              {ansLoading ? "Checking…" : sel!==null ? "🔒 Lock in answer" : "Select a statement"}
            </span>
          </button>
        ) : (
          <div style={{display:"flex",gap:10}}>
            <button onClick={()=>setScreen("home")} style={{
              flex:1,padding:"15px",fontSize:14,fontWeight:600,
              background:T.glass,color:"#e8e6e1",border:`1.5px solid ${T.glassBorder}`,
              borderRadius:14,cursor:"pointer",fontFamily:"inherit",
            }}>Home</button>
            <button onClick={()=>startRound(null,null)} style={{
              flex:2,padding:"15px",fontSize:14,fontWeight:700,letterSpacing:1,
              textTransform:"uppercase",
              background:`linear-gradient(135deg,${T.gold},#d4a830)`,
              color:T.bg,border:"none",borderRadius:14,cursor:"pointer",
              fontFamily:"inherit",position:"relative",overflow:"hidden",
            }}>
              <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
              <span style={{position:"relative"}}>Next round →</span>
            </button>
          </div>
        )}

        {/* Score bar */}
        <div style={{display:"flex",justifyContent:"center",gap:20,marginTop:16,fontSize:12,color:T.dim}}>
          <span>Score <b style={{color:T.gold,fontSize:14}}>{score}/{total}</b></span>
          <span style={{color:"rgba(255,255,255,0.08)"}}>|</span>
          <span>Accuracy <b style={{color:T.gold,fontSize:14}}>{total?Math.round(score/total*100):0}%</b></span>
          <span style={{color:"rgba(255,255,255,0.08)"}}>|</span>
          <span>Streak <b style={{color:streak>0?T.gold:T.dim,fontSize:14}}>{streak}🔥</b></span>
        </div>
      </div>
      <GameStyles />
    </div>
  );
}

function GameStyles() {
  return <style>{`
    @keyframes g-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
    @keyframes g-fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes g-shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
    @keyframes g-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
    @keyframes g-confetti{0%{transform:translateY(-10px) rotate(0);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:0}}
    @keyframes g-btnShimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
    @keyframes g-cardIn{from{opacity:0;transform:translateX(-16px) scale(.96)}to{opacity:1;transform:none}}
    @keyframes g-shake{0%,100%{transform:translateX(0)}15%,45%,75%{transform:translateX(-5px)}30%,60%,90%{transform:translateX(5px)}}
    @keyframes g-revealGlow{0%{box-shadow:0 0 0 rgba(244,63,94,0)}50%{box-shadow:0 0 30px rgba(244,63,94,.3)}100%{box-shadow:0 0 15px rgba(244,63,94,.1)}}
    @keyframes g-correctGlow{0%{box-shadow:0 0 0 rgba(45,212,160,0)}50%{box-shadow:0 0 30px rgba(45,212,160,.4)}100%{box-shadow:0 0 15px rgba(45,212,160,.15)}}
    @keyframes g-fire{0%{transform:scale(1)}50%{transform:scale(1.3)}100%{transform:scale(1)}}
    @keyframes g-shimmerBg{0%,100%{opacity:0.5}50%{opacity:1}}
    * { -webkit-tap-highlight-color: transparent; }
  `}</style>;
}

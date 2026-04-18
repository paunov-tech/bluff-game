import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════
// CINEMATIC INTRO — unchanged
// ═══════════════════════════════════════════════════════════════
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
      <div style={{position:"absolute",inset:0,pointerEvents:"none"}}>
        {Array.from({length:30},(_,i)=>(
          <div key={i} style={{
            position:"absolute",width:2+Math.random()*4,height:2+Math.random()*4,
            borderRadius:"50%",background:"#e8c547",
            left:`${Math.random()*100}%`,top:`${Math.random()*100}%`,
            opacity:phase>=2?0.08+Math.random()*0.15:0,
            transition:`opacity ${1+Math.random()*2}s ease ${Math.random()}s`,
            animation:phase>=2?`intro-sparkle ${3+Math.random()*4}s ease-in-out ${Math.random()*2}s infinite`:"none",
          }}/>
        ))}
      </div>
      <div style={{
        position:"absolute",width:phase>=3?600:300,height:phase>=3?600:300,borderRadius:"50%",
        background:"radial-gradient(circle,rgba(232,197,71,0.12) 0%,transparent 70%)",
        opacity:phase>=1?1:0,transition:"all 1.5s ease",filter:"blur(40px)",
      }}/>
      <div style={{
        position:"absolute",top:"48%",left:0,right:0,height:2,
        background:"linear-gradient(90deg,transparent 0%,rgba(232,197,71,0.6) 45%,rgba(255,255,255,0.8) 50%,rgba(232,197,71,0.6) 55%,transparent 100%)",
        opacity:phase===2?1:0,transform:phase===2?"scaleX(1.5)":"scaleX(0)",
        transition:"all 0.6s cubic-bezier(0.16,1,0.3,1)",filter:"blur(1px)",
      }}/>
      <div style={{
        position:"absolute",opacity:phase>=1&&phase<3?1:0,
        transform:phase===1?"scale(1) rotate(0deg)":phase===2?"scale(0.8) rotate(-5deg)":"scale(1.5)",
        transition:phase===1?"all 0.8s cubic-bezier(0.34,1.56,0.64,1)":"all 0.8s cubic-bezier(0.4,0,0.2,1)",
        display:"flex",flexDirection:"column",alignItems:"center",
      }}>
        <div style={{
          width:200,height:200,borderRadius:"50%",
          border:"3px solid rgba(232,197,71,0.5)",
          display:"flex",alignItems:"center",justifyContent:"center",
          position:"relative",
          boxShadow:phase>=1?"0 0 40px rgba(232,197,71,0.15),inset 0 0 30px rgba(232,197,71,0.08)":"none",
        }}>
          <div style={{width:175,height:175,borderRadius:"50%",border:"1.5px solid rgba(232,197,71,0.25)",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
            <div style={{fontSize:10,letterSpacing:8,color:"rgba(232,197,71,0.5)",marginBottom:6}}>{"★ ★ ★"}</div>
            <div style={{fontFamily:"Georgia,'Times New Roman',serif",fontSize:36,fontWeight:700,letterSpacing:6,color:"#e8c547",textShadow:"0 0 20px rgba(232,197,71,0.4)",lineHeight:1}}>SIAL</div>
            <div style={{width:80,height:1.5,margin:"8px 0",background:"linear-gradient(90deg,transparent,rgba(232,197,71,0.5),transparent)"}}/>
            <div style={{fontSize:13,letterSpacing:7,fontWeight:600,color:"rgba(232,197,71,0.7)",textTransform:"uppercase"}}>GAMES</div>
            <div style={{fontSize:10,letterSpacing:8,color:"rgba(232,197,71,0.5)",marginTop:6}}>{"★ ★ ★"}</div>
          </div>
          <svg width="200" height="200" style={{position:"absolute",top:0,left:0,animation:"intro-spin 20s linear infinite"}}>
            <defs><path id="cp" d="M 100,100 m -82,0 a 82,82 0 1,1 164,0 a 82,82 0 1,1 -164,0"/></defs>
            <text fill="rgba(232,197,71,0.25)" fontSize="9" letterSpacing="3" fontFamily="Georgia,serif">
              <textPath href="#cp">{"• DIGITAL FACTORY • SLOVENIA • EST. 2024 • QUALITY ENTERTAINMENT •"}</textPath>
            </text>
          </svg>
        </div>
        <div style={{marginTop:20,fontSize:12,letterSpacing:8,color:"rgba(232,197,71,0.5)",fontWeight:500,textTransform:"uppercase",opacity:phase>=1?1:0,transform:phase>=1?"translateY(0)":"translateY(10px)",transition:"all 0.6s ease 0.4s"}}>PRESENTS</div>
      </div>
      <div style={{
        position:"absolute",display:"flex",flexDirection:"column",alignItems:"center",
        opacity:phase>=3?1:0,transform:phase>=3?"scale(1) translateY(0)":"scale(0.5) translateY(20px)",
        transition:"all 1s cubic-bezier(0.34,1.56,0.64,1) 0.1s",
      }}>
        <h1 style={{
          fontFamily:"Georgia,'Times New Roman',serif",fontSize:88,fontWeight:900,letterSpacing:-2,
          margin:0,lineHeight:1,
          background:"linear-gradient(135deg,#e8c547 0%,#f0d878 30%,#fff 50%,#f0d878 70%,#e8c547 100%)",
          backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          animation:phase>=3?"intro-logoShimmer 3s ease infinite":"none",
          filter:"drop-shadow(0 0 30px rgba(232,197,71,0.3))",
        }}>
          BLUFF<sup style={{fontSize:16,fontWeight:500,WebkitTextFillColor:"rgba(232,197,71,0.6)",position:"relative",top:-40,marginLeft:2,fontFamily:"system-ui,sans-serif"}}>™</sup>
        </h1>
        <div style={{width:phase>=3?200:0,height:2,marginTop:12,background:"linear-gradient(90deg,transparent,rgba(232,197,71,0.5),transparent)",transition:"width 0.8s cubic-bezier(0.16,1,0.3,1) 0.5s"}}/>
        <div style={{marginTop:14,fontSize:14,letterSpacing:5,color:"rgba(232,197,71,0.6)",textTransform:"uppercase",fontWeight:500,opacity:phase>=4?1:0,transform:phase>=4?"translateY(0)":"translateY(10px)",transition:"all 0.6s ease 0.2s"}}>The AI Deception Game</div>
        <div style={{marginTop:40,fontSize:13,letterSpacing:3,color:"rgba(255,255,255,0.3)",textTransform:"uppercase",opacity:phase>=4?1:0,animation:phase>=4?"intro-tapPulse 2s ease-in-out infinite":"none"}}>Tap anywhere to play</div>
      </div>
      <style>{`
        @keyframes intro-sparkle{0%,100%{transform:translateY(0);opacity:0.05}50%{transform:translateY(-12px);opacity:0.2}}
        @keyframes intro-spin{to{transform:rotate(360deg)}}
        @keyframes intro-logoShimmer{0%{background-position:-200% center}100%{background-position:200% center}}
        @keyframes intro-tapPulse{0%,100%{opacity:0.3}50%{opacity:0.6}}
      `}</style>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ADAPTIVE TIMER MAP — shorter for easy rounds, longer for hard
// ═══════════════════════════════════════════════════════════════
const ROUND_TIMER = [
  0,   // placeholder (1-indexed)
  22,  // Round 1: Warm-up — brzo
  26,  // Round 2: Tricky
  28,  // Round 3: Tricky
  35,  // Round 4: Sneaky — TRAP
  25,  // Round 5: Safety Net — lagano pred prelaz
  48,  // Round 6: Devious
  38,  // Round 7: Sneaky — TRAP (opuštanje)
  60,  // Round 8: Diabolical
  65,  // Round 9: Diabolical
  70,  // Round 10: Grand Bluff
];
function getTimer(roundNum) {
  if (roundNum <= 10) return ROUND_TIMER[roundNum] || 35;
  // Posle runde 10, alternira teško/lako
  return roundNum % 2 === 0 ? 40 : 55;
}

// ═══════════════════════════════════════════════════════════════
// ROUNDS DATABASE — 15 rounds, diverse categories
// ═══════════════════════════════════════════════════════════════
const ROUNDS = [
  { cat:"history", emoji:"🏛️", label:"History", stmts:[
    {t:"Napoleon was once attacked by a horde of rabbits — he organized a rabbit hunt after the Treaty of Tilsit and hundreds of tame rabbits overwhelmed him.",r:true},
    {t:"Cleopatra lived closer in time to the Moon landing (1969) than to the construction of the Great Pyramid of Giza.",r:true},
    {t:"During WWI, France used 600+ Paris taxis to rush troops to the Battle of the Marne — the first military use of motor vehicles at scale.",r:true},
    {t:"Ancient Romans built steam-powered temple doors that opened 'by divine force' using a hidden altar fire and air pressure system.",r:true},
    {t:"Queen Victoria kept a personal diary written exclusively in Urdu for the last 13 years of her reign as tribute to her servant Abdul Karim.",r:false},
  ]},
  { cat:"science", emoji:"🔬", label:"Science", stmts:[
    {t:"Honey never spoils — archaeologists found 3,000-year-old honey in Egyptian tombs that was still perfectly edible.",r:true},
    {t:"A teaspoon of neutron star material would weigh approximately 6 billion tons on Earth's surface.",r:true},
    {t:"Bananas are slightly radioactive due to their potassium-40 content — a naturally occurring isotope.",r:true},
    {t:"Hot water can freeze faster than cold water under certain conditions — the Mpemba effect, still not fully explained by science.",r:true},
    {t:"Jupiter's core is a single enormous diamond roughly the size of Earth, formed under extreme gravitational pressure.",r:false},
  ]},
  { cat:"animals", emoji:"🦎", label:"Animals", stmts:[
    {t:"A group of flamingos is officially called a 'flamboyance' — one of the most whimsical collective nouns in English.",r:true},
    {t:"Octopuses have three hearts and blue blood. Two pump blood to the gills, one pumps it throughout the body.",r:true},
    {t:"Crows can recognize individual human faces and have been documented holding grudges against specific people for years.",r:true},
    {t:"The mimic octopus can impersonate over 15 different marine species including lionfish, flatfish, and sea snakes.",r:true},
    {t:"Dolphins sleep with both eyes closed but alternate which brain hemisphere stays awake, giving them a form of 'stereo dreaming.'",r:false},
  ]},
  { cat:"sports_nba", emoji:"🏀", label:"NBA", stmts:[
    {t:"LeBron James became the NBA's all-time leading scorer in 2023, surpassing Kareem Abdul-Jabbar's record of 38,387 points.",r:true},
    {t:"Wilt Chamberlain scored 100 points in a single NBA game on March 2, 1962 — a record that still stands today.",r:true},
    {t:"Stephen Curry set the all-time record for three-pointers in a single NBA season with 402 in 2015-16.",r:true},
    {t:"The Golden State Warriors went from last place in 2012 to NBA champions in 2015 — the fastest franchise turnaround in modern NBA history.",r:true},
    {t:"Michael Jordan was selected as the #1 overall pick in the 1984 NBA Draft by the Chicago Bulls.",r:false},
  ]},
  { cat:"sports_epl", emoji:"⚽", label:"Premier League", stmts:[
    {t:"Erling Haaland scored 36 Premier League goals in his debut season (2022/23) — smashing the previous record of 34.",r:true},
    {t:"Arsenal went the entire 2003/04 season unbeaten across 38 Premier League games — earning the nickname 'The Invincibles'.",r:true},
    {t:"Leicester City won the Premier League title in 2015/16 as 5000-1 outsiders — one of the biggest upsets in sports history.",r:true},
    {t:"Sergio Agüero's goal in the 93rd minute of the final game of the 2011/12 season won Manchester City their first title in 44 years.",r:true},
    {t:"Alan Shearer scored 260 Premier League goals — a record no player has come within 50 goals of matching.",r:false},
  ]},
  { cat:"showbiz", emoji:"🎬", label:"Show Biznis", stmts:[
    {t:"Taylor Swift's Eras Tour became the highest-grossing concert tour in history, surpassing $1 billion in revenue.",r:true},
    {t:"Oppenheimer and Barbie were released on the same day in July 2023, creating the cultural phenomenon 'Barbenheimer'.",r:true},
    {t:"Squid Game became Netflix's most-watched series ever in its first 28 days, with 1.65 billion viewing hours.",r:true},
    {t:"The Barbie movie (2023) crossed $1 billion at the box office in just 17 days — faster than any other Warner Bros. film.",r:true},
    {t:"BTS is the only K-pop act to have performed at the United Nations General Assembly as part of a youth climate initiative.",r:false},
  ]},
  { cat:"social_media", emoji:"📱", label:"Social Media", stmts:[
    {t:"TikTok was the most downloaded app in the world in 2020, surpassing Instagram and Facebook for the first time.",r:true},
    {t:"Kylie Jenner caused Snapchat's stock to drop by $1.3 billion in one day with a single tweet in 2018.",r:true},
    {t:"Threads, Meta's rival to Twitter/X, gained 100 million users in just 5 days — the fastest app to reach that milestone.",r:true},
    {t:"YouTube was acquired by Google in 2006 for $1.65 billion — just 18 months after YouTube was founded.",r:true},
    {t:"Instagram was originally designed as a check-in and location-sharing app before pivoting to photos just before launch.",r:true},
  ]},
  { cat:"sports_laliga", emoji:"⚽", label:"La Liga", stmts:[
    {t:"Lionel Messi scored 50 La Liga goals in the 2011/12 season — a record that still stands as the most in a single La Liga campaign.",r:true},
    {t:"Real Madrid won the Champions League three consecutive times between 2016 and 2018 under Zinedine Zidane.",r:true},
    {t:"Luka Modrić ended the 10-year Messi-Ronaldo stranglehold on the Ballon d'Or by winning it in 2018.",r:true},
    {t:"Atlético Madrid won La Liga in 2013/14, ending the dominance of Real Madrid and Barcelona with a title neither Madrid club expected to lose.",r:true},
    {t:"Cristiano Ronaldo scored exactly 450 goals for Real Madrid across all competitions during his nine seasons there.",r:false},
  ]},
  { cat:"weird_facts", emoji:"🌍", label:"Čudne Činjenice", stmts:[
    {t:"Oxford University is older than the Aztec Empire — teaching began there around 1096, while the Aztec Empire was founded in 1428.",r:true},
    {t:"Woolly mammoths were still alive when the Great Pyramid of Giza was being built — some survived on Wrangel Island until 1650 BC.",r:true},
    {t:"There are more possible iterations of a game of chess than there are atoms in the observable universe.",r:true},
    {t:"The Great Wall of China is not visible from space with the naked eye — this is a myth confirmed by Chinese astronaut Yang Liwei.",r:true},
    {t:"The average person swallows 8 spiders per year while sleeping — a figure backed by sleep laboratory research.",r:false},
  ]},
  { cat:"sports_nba", emoji:"🏀", label:"NBA Drama", stmts:[
    {t:"Nikola Jokić became the first center to win the NBA MVP award three times, doing so within a four-season span.",r:true},
    {t:"The Philadelphia 76ers deliberately tanked games for multiple seasons between 2013-17, a strategy publicly called 'The Process'.",r:true},
    {t:"Kevin Durant tore his Achilles tendon during the 2019 NBA Finals but initially tried to continue playing before collapsing.",r:true},
    {t:"Victor Wembanyama was considered so uniquely talented that NBA scouts called him a 'generational anomaly' — a phrase never used before.",r:true},
    {t:"LeBron James was the #1 overall pick in the 2003 NBA Draft, selected by his hometown Cleveland Cavaliers.",r:true},
  ]},
  { cat:"showbiz", emoji:"🎵", label:"Music Drama", stmts:[
    {t:"Drake and Kendrick Lamar's 2024 rap beef generated record-breaking streaming numbers — 'Not Like Us' hit #1 on Billboard Hot 100.",r:true},
    {t:"Beyoncé became the first Black woman to win the Grammy for Best Country Album in 2024 with her album 'Cowboy Carter'.",r:true},
    {t:"Celine Dion revealed she has been battling Stiff Person Syndrome — a rare neurological disorder affecting 1 in a million people.",r:true},
    {t:"The Weeknd publicly boycotted the Grammys and refused nominations, claiming the voting process was corrupt and non-transparent.",r:true},
    {t:"Sabrina Carpenter had three songs simultaneously in the Billboard Hot 100 Top 10 in 2024 — a rare achievement.",r:true},
  ]},
  { cat:"sports_epl", emoji:"⚽", label:"EPL Legends", stmts:[
    {t:"Thierry Henry scored 228 goals in all competitions for Arsenal — a record that stood for over 15 years until broken by another player.",r:true},
    {t:"Roberto Mancini won the Premier League with Manchester City in 2012 — their first title in 44 years, secured on goal difference on the final day.",r:true},
    {t:"Manchester City set the record for most points in a Premier League season under Pep Guardiola — reaching 100 points in 2017/18.",r:true},
    {t:"Liverpool's 'You'll Never Walk Alone' anthem became their official song after the 1965 FA Cup win — the first trophy the song accompanied.",r:true},
    {t:"Wayne Rooney scored 253 goals for Manchester United — the most by any player for a single Premier League club.",r:false},
  ]},
  { cat:"science", emoji:"🧬", label:"Biology Surprises", stmts:[
    {t:"Your body replaces most of its cells every 7-10 years — though brain neurons and heart cells largely remain from birth.",r:true},
    {t:"Tardigrades (water bears) can survive in the vacuum of space, withstand 1,000 times more radiation than would kill a human, and live through desiccation for decades.",r:true},
    {t:"The immortal jellyfish (Turritopsis dohrnii) can revert to its juvenile polyp state after reaching maturity — making it theoretically immortal.",r:true},
    {t:"Octopuses have photoreceptors in their skin, meaning they can detect light and possibly 'see' color through their skin without using their eyes.",r:true},
    {t:"Humans share approximately 60% of their DNA with a banana — a commonly cited fact in genetics textbooks worldwide.",r:false},
  ]},
  { cat:"sports_laliga", emoji:"⚽", label:"La Liga Drama", stmts:[
    {t:"FC Barcelona's La Masia academy produced 7 of the 11 starters in Spain's 2010 World Cup-winning squad.",r:true},
    {t:"Real Madrid's Bernabéu stadium underwent a complete renovation between 2020 and 2023 costing over €900 million.",r:true},
    {t:"Jude Bellingham scored 23 La Liga goals in his debut season at Real Madrid — a record for a midfielder in their first season.",r:true},
    {t:"Sevilla FC has won the UEFA Europa League (or its predecessor the UEFA Cup) a record six times.",r:true},
    {t:"Lionel Messi won La Liga exactly 10 times during his career at Barcelona between 2004 and 2021.",r:true},
  ]},
  { cat:"weird_facts", emoji:"🌌", label:"Mind-Bending Facts", stmts:[
    {t:"Every blue-eyed person on Earth is descended from a single ancestor who lived 6,000-10,000 years ago when a genetic mutation first appeared.",r:true},
    {t:"The number 0.999... (zero point nine repeating forever) is mathematically exactly equal to 1, not just an approximation.",r:true},
    {t:"There is a planet where it rains glass sideways at 4,350 mph — HD 189733b, located 63 light-years from Earth.",r:true},
    {t:"Our solar system travels through the Milky Way galaxy at approximately 828,000 km/h — yet we feel nothing because everything around us moves at the same speed.",r:true},
    {t:"Scientists have experimentally confirmed that quantum entanglement allows information to travel faster than the speed of light.",r:false},
  ]},
];

// ═══════════════════════════════════════════════════════════════
// WEB AUDIO ENGINE — sintetizovani zvuci, nula eksternih fajlova
// ═══════════════════════════════════════════════════════════════
const AudioEngine = (() => {
  let ctx = null;
  let master = null;
  let muted = false;

  const init = () => {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.65;
      master.connect(ctx.destination);
    } catch(e) { console.warn("Audio init failed", e); }
  };

  const play = (fn) => {
    if (muted || !ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    try { fn(ctx, master); } catch(e) {}
  };

  return {
    init,
    setMuted: (v) => { muted = v; if (master) master.gain.value = v ? 0 : 0.65; },

    tick(urgency = 1) {
      play((ctx, dst) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const t = ctx.currentTime;
        o.frequency.value = 500 + urgency * 180;
        o.type = "sine";
        g.gain.setValueAtTime(0.25 + urgency * 0.08, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
        o.connect(g); g.connect(dst);
        o.start(t); o.stop(t + 0.06);

        // Double-tick na urgency 2+
        if (urgency >= 2) {
          const o2 = ctx.createOscillator();
          const g2 = ctx.createGain();
          const t2 = t + 0.28;
          o2.frequency.value = 350;
          g2.gain.setValueAtTime(0.15, t2);
          g2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.04);
          o2.connect(g2); g2.connect(dst);
          o2.start(t2); o2.stop(t2 + 0.05);
        }
      });
    },

    whoosh() {
      play((ctx, dst) => {
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/d.length, 3);
        const src = ctx.createBufferSource();
        const g = ctx.createGain();
        const f = ctx.createBiquadFilter();
        src.buffer = buf; f.type = "highpass"; f.frequency.value = 1800;
        g.gain.setValueAtTime(0.18, ctx.currentTime);
        src.connect(f); f.connect(g); g.connect(dst); src.start();
      });
    },

    lockIn() {
      // Snare hit
      play((ctx, dst) => {
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.04, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2-1) * Math.pow(1-i/d.length, 1.5);
        const src = ctx.createBufferSource();
        const g = ctx.createGain();
        src.buffer = buf; g.gain.setValueAtTime(0.5, ctx.currentTime);
        src.connect(g); g.connect(dst); src.start();
      });
    },

    fanfare() {
      play((ctx, dst) => {
        [523, 659, 784, 1047].forEach((freq, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const t = ctx.currentTime + i * 0.11;
          o.frequency.value = freq; o.type = "triangle";
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.35, t + 0.02);
          g.gain.setValueAtTime(0.35, t + 0.09);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
          o.connect(g); g.connect(dst); o.start(t); o.stop(t + 0.5);
        });
        // Chord
        [523, 659, 784].forEach(freq => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const t = ctx.currentTime + 0.5;
          o.frequency.value = freq; o.type = "sine";
          g.gain.setValueAtTime(0.2, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
          o.connect(g); g.connect(dst); o.start(t); o.stop(t + 1);
        });
      });
    },

    buzzer() {
      play((ctx, dst) => {
        [[466,0],[370,0.03],[311,0.06]].forEach(([freq,delay]) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const t = ctx.currentTime + delay;
          o.frequency.value = freq; o.type = "sawtooth";
          g.gain.setValueAtTime(0.3, t);
          g.gain.setValueAtTime(0.3, t + 0.15);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
          o.connect(g); g.connect(dst); o.start(t); o.stop(t + 0.55);
        });
      });
    },

    levelUp() {
      play((ctx, dst) => {
        [440, 554, 659, 880].forEach((freq, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          const t = ctx.currentTime + i * 0.07;
          o.frequency.value = freq; o.type = "sine";
          g.gain.setValueAtTime(0.28, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
          o.connect(g); g.connect(dst); o.start(t); o.stop(t + 0.3);
        });
      });
    },
  };
})();

// ═══════════════════════════════════════════════════════════════
// AXIOS FACE — SVG animated AI character
// ═══════════════════════════════════════════════════════════════
function AxiosFace({ emotion, roundNum }) {
  const [blink, setBlink] = useState(false);
  const [microExpr, setMicroExpr] = useState(null);

  // Blink cycle
  useEffect(() => {
    const b = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 110);
    }, 2600 + Math.random() * 2000);
    return () => clearInterval(b);
  }, []);

  // Micro-expressions (ispod svesnog praga)
  useEffect(() => {
    if (emotion !== "idle") return;
    const m = setInterval(() => {
      const exprs = ["smug","thinking"];
      setMicroExpr(exprs[Math.floor(Math.random()*exprs.length)]);
      setTimeout(() => setMicroExpr(null), 90);
    }, 18000 + Math.random() * 10000);
    return () => clearInterval(m);
  }, [emotion]);

  const eff = microExpr || emotion;

  // Boja po rundi
  const axColor = roundNum <= 3 ? "#4a9eff"
    : roundNum <= 6 ? "#e8c547"
    : roundNum <= 8 ? "#ff8c42"
    : "#ff3366";

  const eyeRy = blink ? 0.5
    : eff === "shocked" ? 13
    : (eff === "smug" || eff === "thinking") ? 4.5
    : 9;

  const mouth = eff === "smug" ? "M 37,65 Q 52,61 65,60"
    : eff === "shocked" ? "M 34,60 Q 50,74 66,60 Q 50,70 34,60"
    : eff === "taunting" ? "M 33,62 Q 50,73 67,62"
    : eff === "defeated" ? "M 35,68 Q 50,62 65,68"
    : eff === "thinking" ? "M 36,65 Q 50,67 63,63"
    : "M 37,64 Q 50,67 63,64";

  const anim = eff === "defeated" ? "ax-meltdown 0.6s ease-in-out infinite"
    : eff === "taunting" ? "ax-laugh 0.4s ease-in-out infinite"
    : eff === "thinking" ? "ax-tilt 2.5s ease-in-out infinite"
    : "ax-breathe 4s ease-in-out infinite";

  return (
    <div style={{position:"relative",width:90,height:90,animation:anim,flexShrink:0}}>
      {/* Outer glow */}
      <div style={{
        position:"absolute",inset:-3,borderRadius:"50%",
        boxShadow:`0 0 ${eff==="defeated"?35:14}px ${axColor}`,
        opacity:eff==="defeated"?0.9:0.35,
        transition:"all 0.4s",
      }}/>
      <svg viewBox="0 0 100 100" width={90} height={90}>
        <circle cx="50" cy="50" r="46" fill="#0d0d1a" stroke={axColor} strokeWidth="2"/>
        {/* Scan lines */}
        <rect x="4" y="4" width="92" height="92" rx="42" fill="url(#sl)" opacity="0.06"/>
        <defs>
          <pattern id="sl" x="0" y="0" width="100" height="3" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="100" height="1" fill="white"/>
          </pattern>
        </defs>
        {/* Eyes */}
        {[33, 67].map((cx, i) => (
          <g key={i}>
            <ellipse cx={cx} cy="42" rx="10" ry={eyeRy} fill="#111"
              style={{transition:"ry 0.1s"}}/>
            <ellipse cx={cx} cy="42" rx="10" ry={eyeRy} fill="none"
              stroke={axColor} strokeWidth="1.5" opacity="0.7"
              style={{filter:`drop-shadow(0 0 4px ${axColor})`,transition:"ry 0.1s"}}/>
            <circle cx={cx + (i===0?1:-1)} cy="42" r={eyeRy > 3 ? 3 : 0.5}
              fill="#000" style={{transition:"r 0.1s"}}/>
            {/* Iris glow */}
            <circle cx={cx} cy="39" r={eyeRy > 5 ? 2.5 : 0}
              fill="white" opacity="0.4" style={{transition:"r 0.1s"}}/>
          </g>
        ))}
        {/* Nose dot */}
        <circle cx="50" cy="55" r="1.5" fill={axColor} opacity="0.3"/>
        {/* Mouth */}
        <path d={mouth} fill={eff==="shocked"||eff==="taunting"?"rgba(0,0,0,0.6)":"none"}
          stroke={axColor} strokeWidth="2.5" strokeLinecap="round"
          style={{transition:"d 0.2s",filter:`drop-shadow(0 0 3px ${axColor})`}}/>
        {/* Sentiment bar */}
        <rect x="22" y="82" width="56" height="2.5" rx="1.25" fill={axColor} opacity="0.15"/>
        <rect x="22" y="82" rx="1.25" height="2.5"
          width={eff==="shocked"||eff==="taunting"?56:eff==="defeated"?4:28}
          fill={axColor} style={{transition:"width 0.7s ease"}}/>
        {/* Defeated cracks */}
        {eff==="defeated" && <>
          <line x1="28" y1="22" x2="42" y2="46" stroke="#f43f5e" strokeWidth="1" opacity="0.5"/>
          <line x1="58" y1="18" x2="72" y2="48" stroke="#f43f5e" strokeWidth="1" opacity="0.4"/>
        </>}
      </svg>
      {/* AXIOS label */}
      <div style={{position:"absolute",bottom:-15,left:0,right:0,textAlign:"center",fontSize:8,letterSpacing:3.5,color:axColor,opacity:0.6,textTransform:"uppercase",fontWeight:600}}>AXIOS</div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════
function shuffle(a) {
  const b=[...a];
  for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];}
  return b;
}

function Particles({count=20}) {
  const ps=useRef(Array.from({length:count},()=>({
    x:Math.random()*100,y:Math.random()*100,s:2+Math.random()*4,
    d:3+Math.random()*6,dl:Math.random()*4,o:0.05+Math.random()*0.12
  }))).current;
  return <div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none",zIndex:0}}>
    {ps.map((p,i)=><div key={i} style={{position:"absolute",width:p.s,height:p.s,borderRadius:"50%",background:"#e8c547",opacity:p.o,left:`${p.x}%`,top:`${p.y}%`,animation:`g-float ${p.d}s ease-in-out ${p.dl}s infinite`}}/>)}
  </div>;
}

function Confetti() {
  const colors=["#e8c547","#2dd4a0","#f0d878","#60a5fa","#f43f5e","#a78bfa","#fb923c"];
  const ps=useRef(Array.from({length:50},()=>({x:Math.random()*100,dl:Math.random()*1.2,c:colors[Math.floor(Math.random()*colors.length)],w:4+Math.random()*10,h:4+Math.random()*10,r:Math.random()>0.5,dur:1.5+Math.random()*1.5}))).current;
  return <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:9999,overflow:"hidden"}}>
    {ps.map((p,i)=><div key={i} style={{position:"absolute",top:-20,left:`${p.x}%`,width:p.w,height:p.h,background:p.c,borderRadius:p.r?"50%":"2px",animation:`g-confetti ${p.dur}s ease-in ${p.dl}s forwards`}}/>)}
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// TIMER RING — with urgency system based on % remaining
// ═══════════════════════════════════════════════════════════════
function TimerRing({time, max, size=52}) {
  const r=(size-6)/2, circ=2*Math.PI*r, pct=time/max;
  const urgency = pct < 0.15 ? 3 : pct < 0.30 ? 2 : pct < 0.50 ? 1 : 0;
  const color = urgency===3 ? "#f43f5e" : urgency===2 ? "#fb923c" : "#e8c547";
  const pulse = urgency===3 ? "g-pulse 0.35s ease-in-out infinite"
    : urgency===2 ? "g-pulse 0.65s ease-in-out infinite"
    : urgency===1 ? "g-pulse 1.4s ease-in-out infinite"
    : "none";
  return (
    <div style={{position:"relative",width:size,height:size,animation:pulse,filter:urgency===3?`drop-shadow(0 0 8px ${color})`:"none"}}>
      {/* Ripple ring */}
      {urgency>=2&&<div style={{position:"absolute",inset:-4,borderRadius:"50%",border:`1.5px solid ${color}`,opacity:0,animation:`g-timerRipple ${urgency===3?"0.5s":"0.8s"} ease-out infinite`}}/>}
      <svg width={size} height={size} style={{transform:"rotate(-90deg)"}}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={urgency>=2?4:3}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={urgency>=2?4:3}
          strokeDasharray={circ} strokeDashoffset={circ*(1-pct)}
          strokeLinecap="round" style={{transition:"stroke-dashoffset 1s linear,stroke 0.4s"}}/>
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:urgency>=2?17:15,fontWeight:800,color,fontVariantNumeric:"tabular-nums"}}>
        {time}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════
export default function BluffGame() {
  const [showIntro, setShowIntro] = useState(true);
  const [screen, setScreen] = useState("home");
  const [roundIdx, setRoundIdx] = useState(0);
  const [stmts, setStmts] = useState([]);
  const [sel, setSel] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [total, setTotal] = useState(0);  // rounds played
  const [roundNum, setRoundNum] = useState(1); // 1-10 ladder position
  const [streak, setStreak] = useState(0);
  const [best, setBest] = useState(0);
  const [time, setTime] = useState(25);
  const [timerMax, setTimerMax] = useState(25);
  const [showConfetti, setShowConfetti] = useState(false);
  const [axiosEmotion, setAxiosEmotion] = useState("idle");
  const [flashColor, setFlashColor] = useState(null);
  const [autoCount, setAutoCount] = useState(null);
  const [confirmCount, setConfirmCount] = useState(null);
  const [muted, setMuted] = useState(false);

  const timerRef = useRef(null);
  const autoRef = useRef(null);
  const confirmRef = useRef(null);
  const playedRef = useRef(new Set());

  const T = {
    bg:"#08080f",card:"#111119",gold:"#e8c547",gold2:"#f0d878",
    goldDim:"rgba(232,197,71,0.1)",ok:"#2dd4a0",bad:"#f43f5e",
    dim:"#5a5a68",glass:"rgba(255,255,255,0.03)",glassBorder:"rgba(255,255,255,0.07)"
  };

  // Background color shifts with round difficulty
  const bgTint = roundNum <= 3 ? "rgba(74,158,255,0.04)"
    : roundNum <= 5 ? "rgba(232,197,71,0.05)"
    : roundNum <= 7 ? "rgba(255,120,50,0.06)"
    : "rgba(200,30,60,0.09)";

  // ─── GET NEXT ROUND (anti-repeat) ──────────────────────────
  const getNextRound = useCallback(() => {
    const available = ROUNDS
      .map((r,i) => ({r,i}))
      .filter(({i}) => !playedRef.current.has(i));

    // Reset if all played
    if (available.length === 0) {
      playedRef.current.clear();
      return Math.floor(Math.random() * ROUNDS.length);
    }

    const pick = available[Math.floor(Math.random() * available.length)];
    playedRef.current.add(pick.i);
    return pick.i;
  }, []);

  // ─── START ROUND ────────────────────────────────────────────
  const startRound = useCallback(() => {
    AudioEngine.init();

    const newRoundNum = Math.min((total % 10) + 1, 10);
    const newTimerMax = getTimer(newRoundNum);
    const idx = getNextRound();

    setRoundNum(newRoundNum);
    setRoundIdx(idx);
    setStmts(shuffle(ROUNDS[idx].stmts));
    setSel(null);
    setRevealed(false);
    setTime(newTimerMax);
    setTimerMax(newTimerMax);
    setShowConfetti(false);
    setAxiosEmotion("idle");
    setAutoCount(null);
    setConfirmCount(null);
    clearTimeout(autoRef.current);
    clearTimeout(confirmRef.current);
    setScreen("play");

    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTime(t => {
        const next = t - 1;
        if (next <= 0) return 0;
        return next;
      });
    }, 1000);
  }, [total, getNextRound]);

  // Timer tick effects
  useEffect(() => {
    if (screen !== "play" || revealed) return;
    if (time <= 0) { reveal(); return; }

    // Urgency sounds
    const pct = time / timerMax;
    if (pct < 0.15) AudioEngine.tick(3);
    else if (pct < 0.30) AudioEngine.tick(2);
    else if (time % 5 === 0) AudioEngine.tick(1);  // ogni 5s per round facile
  }, [time]);

  useEffect(() => () => clearInterval(timerRef.current), []);

  // ─── CARD TAP — single tap confirm ──────────────────────────
  const handleCardTap = (idx) => {
    if (revealed) return;
    AudioEngine.whoosh();

    // Second tap on same card = immediate lock-in
    if (sel === idx) {
      clearTimeout(confirmRef.current);
      setConfirmCount(null);
      setAxiosEmotion("thinking");
      reveal();
      return;
    }

    setSel(idx);
    setAxiosEmotion("thinking");
    clearTimeout(confirmRef.current);

    // 1.2s auto-confirm countdown
    let count = 3;
    setConfirmCount(count);
    const tick = () => {
      count--;
      if (count <= 0) {
        setConfirmCount(null);
        reveal();
      } else {
        setConfirmCount(count);
        confirmRef.current = setTimeout(tick, 380);
      }
    };
    confirmRef.current = setTimeout(tick, 380);
  };

  // ─── REVEAL ─────────────────────────────────────────────────
  const reveal = () => {
    clearInterval(timerRef.current);
    clearTimeout(confirmRef.current);
    setConfirmCount(null);

    const bi = stmts.findIndex(s => !s.r);
    const isCorrect = sel === bi;

    setRevealed(true);
    setTotal(t => t + 1);

    if (isCorrect) {
      setScore(s => s + 1);
      setStreak(s => { const n=s+1; setBest(b=>Math.max(b,n)); return n; });
      setShowConfetti(true);
      setAxiosEmotion("shocked");
      setFlashColor("#2dd4a0");
      AudioEngine.fanfare();
    } else {
      setStreak(0);
      setAxiosEmotion("taunting");
      setFlashColor("#f43f5e");
      AudioEngine.buzzer();
    }

    setTimeout(() => setFlashColor(null), 90);

    // Auto-advance: 2.5s countdown
    let ac = 3;
    setAutoCount(ac);
    const advTick = () => {
      ac--;
      if (ac <= 0) {
        setAutoCount(null);
        startRound();
      } else {
        setAutoCount(ac);
        autoRef.current = setTimeout(advTick, 750);
      }
    };
    autoRef.current = setTimeout(advTick, 800);
  };

  const cancelAutoAndGoHome = () => {
    clearTimeout(autoRef.current);
    setAutoCount(null);
    setScreen("home");
  };

  const cancelAutoAndNext = () => {
    clearTimeout(autoRef.current);
    setAutoCount(null);
    startRound();
  };

  const r = ROUNDS[roundIdx];
  const bi = stmts.findIndex(s => !s.r);
  const correct = sel === bi;

  if (showIntro) return <CinematicIntro onComplete={() => setShowIntro(false)} />;

  const wrap = {
    minHeight:"100vh",
    background:`radial-gradient(ellipse at 50% 0%,${bgTint} 0%,${T.bg} 55%)`,
    fontFamily:"'Instrument Sans','DM Sans',system-ui,sans-serif",
    display:"flex",flexDirection:"column",alignItems:"center",
    position:"relative",overflow:"hidden",color:"#e8e6e1",
    transition:"background 2s ease",
  };

  // ─── HOME ────────────────────────────────────────────────────
  if (screen === "home") return (
    <div style={wrap}>
      <Particles/>
      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:440,padding:"50px 20px 40px",textAlign:"center"}}>
        <div style={{fontSize:11,letterSpacing:7,color:T.dim,marginBottom:18,fontWeight:500}}>SIAL GAMES</div>
        <h1 style={{
          fontFamily:"Georgia,serif",fontSize:72,fontWeight:900,letterSpacing:-2,
          margin:"0 0 2px",lineHeight:1,
          background:`linear-gradient(135deg,${T.gold},${T.gold2},#fff8,${T.gold})`,
          backgroundSize:"200% auto",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",
          animation:"g-shimmer 4s linear infinite",
          filter:"drop-shadow(0 0 30px rgba(232,197,71,0.2))",
        }}>BLUFF<sup style={{fontSize:14,WebkitTextFillColor:"rgba(232,197,71,0.5)",position:"relative",top:-35,fontFamily:"system-ui",fontWeight:400}}>™</sup></h1>
        <p style={{fontSize:13,color:T.dim,letterSpacing:4,textTransform:"uppercase",margin:"0 0 40px",fontWeight:500}}>The AI Deception Game</p>
        <div style={{background:T.glass,backdropFilter:"blur(16px)",WebkitBackdropFilter:"blur(16px)",borderRadius:18,border:`1px solid ${T.glassBorder}`,padding:"24px 20px",marginBottom:20,textAlign:"left",animation:"g-fadeUp .6s .1s both"}}>
          <div style={{fontSize:11,color:T.gold,letterSpacing:3,textTransform:"uppercase",fontWeight:600,marginBottom:14}}>How to play</div>
          {[
            ["🧠","5 statements — 4 true, 1 crafted LIE"],
            ["🎭","Find the BLUFF before time runs out"],
            ["⏱️","Harder rounds = more time. Easy = fast!"],
            ["🔥","Build streaks · Beat AXIOS · Climb the ladder"],
          ].map(([e,t],i)=>
            <div key={i} style={{display:"flex",gap:10,marginBottom:i<3?11:0,fontSize:14,lineHeight:1.5,animation:`g-fadeUp .5s ${.15+i*.08}s both`}}>
              <span style={{fontSize:16}}>{e}</span><span style={{opacity:.8}}>{t}</span>
            </div>
          )}
        </div>
        {total>0&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20,animation:"g-fadeUp .6s .3s both"}}>
          {[[score,"Correct",T.ok],[total,"Played",T.gold],[best,"Best streak","#a78bfa"]].map(([v,l,c],i)=>
            <div key={i} style={{background:T.glass,borderRadius:14,border:`1px solid ${T.glassBorder}`,padding:"14px 8px",textAlign:"center"}}>
              <div style={{fontSize:28,fontWeight:800,color:c,fontFamily:"Georgia,serif"}}>{v}</div>
              <div style={{fontSize:10,color:T.dim,letterSpacing:1,textTransform:"uppercase",marginTop:3}}>{l}</div>
            </div>
          )}
        </div>}
        <button onClick={startRound} style={{
          width:"100%",padding:"18px",fontSize:16,fontWeight:700,letterSpacing:2,textTransform:"uppercase",
          background:`linear-gradient(135deg,${T.gold},#d4a830)`,color:T.bg,border:"none",borderRadius:16,
          cursor:"pointer",position:"relative",overflow:"hidden",fontFamily:"inherit",
          boxShadow:`0 0 50px ${T.goldDim},0 4px 20px rgba(232,197,71,0.2)`,
          animation:"g-fadeUp .6s .4s both",transition:"transform .15s",
        }}
          onMouseDown={e=>e.currentTarget.style.transform="scale(0.97)"}
          onMouseUp={e=>e.currentTarget.style.transform=""}
        >
          <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 3s infinite"}}/>
          <span style={{position:"relative"}}>{total>0?"Play again":"Find the bluff"}</span>
        </button>
        <div style={{marginTop:28,fontSize:11,color:"rgba(255,255,255,0.15)",letterSpacing:1}}>
          playbluff.games · SIAL Consulting d.o.o.
        </div>
      </div>
      <GameStyles/>
    </div>
  );

  // ─── PLAY ────────────────────────────────────────────────────
  return (
    <div style={wrap}>
      {/* Screen flash on reveal */}
      {flashColor&&<div style={{position:"fixed",inset:0,background:flashColor,opacity:0.14,pointerEvents:"none",zIndex:9998,animation:"g-flash 0.09s ease-out forwards"}}/>}

      {/* Vignette on high rounds */}
      {roundNum>=6&&<div style={{position:"fixed",inset:0,background:`radial-gradient(ellipse at 50% 50%,transparent ${40-(roundNum-6)*4}%,rgba(0,0,0,${0.08+(roundNum-6)*0.05}) 100%)`,pointerEvents:"none",zIndex:0,transition:"all 1s ease"}}/>}

      <Particles count={8}/>
      {showConfetti&&<Confetti/>}

      <div style={{position:"relative",zIndex:1,width:"100%",maxWidth:460,padding:"16px 16px 32px"}}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:20}}>{r?.emoji}</span>
            <div>
              <div style={{fontSize:11,color:T.gold,letterSpacing:3,textTransform:"uppercase",fontWeight:600}}>{r?.label}</div>
              <div style={{fontSize:10,color:T.dim}}>Round {total+1} · {timerMax}s</div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {streak>0&&<div style={{fontSize:13,color:T.gold,fontWeight:700,display:"flex",alignItems:"center",gap:3,background:T.goldDim,padding:"4px 10px",borderRadius:20,animation:streak>=3?"g-fire .6s infinite":"none"}}>🔥{streak}</div>}
            <button onClick={()=>{setMuted(m=>{AudioEngine.setMuted(!m);return !m;})}} style={{background:"none",border:"none",cursor:"pointer",fontSize:16,opacity:0.45,padding:4,color:"#fff"}}>
              {muted?"🔇":"🔊"}
            </button>
            {!revealed
              ? <TimerRing time={time} max={timerMax}/>
              : <div style={{width:52,height:52,borderRadius:"50%",background:correct?"rgba(45,212,160,0.12)":"rgba(244,63,94,0.12)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,animation:"g-pulse .5s",color:correct?T.ok:T.bad}}>
                  {correct?"✓":"✗"}
                </div>
            }
          </div>
        </div>

        {/* AXIOS + Speech */}
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14,padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderRadius:16,border:"1px solid rgba(255,255,255,0.05)"}}>
          <AxiosFace emotion={axiosEmotion} roundNum={roundNum}/>
          <div style={{flex:1}}>
            <div style={{fontSize:11,color:T.gold,letterSpacing:2,textTransform:"uppercase",fontWeight:600,marginBottom:4}}>AXIOS</div>
            <div style={{fontSize:13,color:"rgba(255,255,255,0.55)",lineHeight:1.5,fontStyle:"italic"}}>
              {revealed
                ? correct
                  ? "Impressive. You found my lie."
                  : "Too easy. You walked right into it."
                : confirmCount
                  ? `Locking in ${confirmCount}...`
                  : sel !== null
                    ? "Are you sure about that?"
                    : "One of these is my creation. Find it."}
            </div>
          </div>
        </div>

        {/* Prompt */}
        <div style={{textAlign:"center",marginBottom:14,animation:revealed&&!correct?"g-shake .5s":"none"}}>
          <h2 style={{fontFamily:"Georgia,serif",fontSize:20,fontWeight:800,margin:"0 0 3px",color:revealed?(correct?T.ok:T.bad):"#fff",transition:"color .35s"}}>
            {revealed?(correct?"You found the BLUFF 🎯":"The AI fooled you 🎭"):"Which one is the BLUFF?"}
          </h2>
          <p style={{fontSize:12,color:T.dim,margin:0}}>
            {revealed
              ? (correct?"Your instincts beat the machine":"The fabricated lie is highlighted below")
              : "Tap to select · Tap again to confirm instantly"}
          </p>
        </div>

        {/* Cards */}
        <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:16}}>
          {stmts.map((s,i)=>{
            const isB=!s.r, isS=sel===i;
            let bg=T.card, border=T.glassBorder, glow="none", anim="";
            if(!revealed&&isS){bg=T.goldDim;border="rgba(232,197,71,0.5)";glow=`0 0 18px ${T.goldDim}`;}
            if(revealed&&isB){bg="rgba(244,63,94,0.08)";border="rgba(244,63,94,0.5)";glow="0 0 18px rgba(244,63,94,0.15)";anim=",g-revealGlow .8s";}
            if(revealed&&isS&&correct){bg="rgba(45,212,160,0.08)";border="rgba(45,212,160,0.5)";glow="0 0 18px rgba(45,212,160,0.15)";anim=",g-correctGlow .8s";}
            if(revealed&&isS&&!correct&&!isB)anim=",g-shake .4s";

            let tag=null;
            if(revealed){
              if(isB)tag=<div style={{marginTop:6,fontSize:11,fontWeight:700,color:T.bad,letterSpacing:1.5}}>🎭 AI FABRICATION</div>;
              else if(isS)tag=<div style={{marginTop:6,fontSize:11,fontWeight:700,color:T.bad}}>✗ This is actually real</div>;
              else tag=<div style={{marginTop:6,fontSize:11,color:T.ok,opacity:.4,letterSpacing:1}}>✓ Verified</div>;
            }

            return (
              <button key={i} onClick={()=>!revealed&&handleCardTap(i)} style={{
                width:"100%",display:"flex",alignItems:"flex-start",gap:11,
                background:bg,border:`1.5px solid ${border}`,borderRadius:15,
                padding:"13px",cursor:revealed?"default":"pointer",
                textAlign:"left",color:"#e8e6e1",fontSize:14,lineHeight:1.6,
                fontFamily:"inherit",boxShadow:glow,
                animation:`g-cardSnap .18s ease-out ${i*.016}s both${anim}`,
                transition:"background .12s,border-color .12s,box-shadow .12s,transform .1s",
                position:"relative",overflow:"hidden",
              }}>
                {/* Confirm progress bar */}
                {!revealed&&isS&&confirmCount!==null&&(
                  <div style={{position:"absolute",bottom:0,left:0,right:0,height:3,background:"rgba(232,197,71,0.15)",borderRadius:"0 0 15px 15px"}}>
                    <div style={{height:"100%",background:"#e8c547",borderRadius:"inherit",animation:"g-lockProgress 1.2s linear forwards"}}/>
                  </div>
                )}
                <div style={{
                  width:27,height:27,borderRadius:"50%",flexShrink:0,
                  border:`2px solid ${isS&&!revealed?T.gold:revealed&&isB?T.bad:"rgba(255,255,255,0.1)"}`,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  fontSize:12,fontWeight:700,marginTop:1,
                  background:isS&&!revealed?T.gold:revealed&&isB?"rgba(244,63,94,0.2)":"transparent",
                  color:isS&&!revealed?T.bg:revealed&&isB?T.bad:T.dim,
                  transition:"all .25s",flexDirection:"column",
                }}>
                  {revealed&&isB?"!":String.fromCharCode(65+i)}
                </div>
                <div style={{flex:1}}>{s.t}{tag}</div>
              </button>
            );
          })}
        </div>

        {/* Action buttons */}
        {!revealed?(
          <button
            onClick={()=>{if(sel!==null){AudioEngine.lockIn();clearTimeout(confirmRef.current);setConfirmCount(null);reveal();}}}
            disabled={sel===null}
            style={{
              width:"100%",padding:"16px",fontSize:15,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",
              background:sel!==null?`linear-gradient(135deg,${T.gold},#d4a830)`:T.card,
              color:sel!==null?T.bg:T.dim,
              border:sel!==null?"none":`1.5px solid ${T.glassBorder}`,
              borderRadius:15,cursor:sel!==null?"pointer":"not-allowed",
              transition:"all .2s",fontFamily:"inherit",
              boxShadow:sel!==null?`0 0 35px ${T.goldDim}`:"none",
              position:"relative",overflow:"hidden",
            }}>
            {sel!==null&&<div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>}
            <span style={{position:"relative"}}>
              {sel===null?"Select a statement"
               :confirmCount!==null?`Locking in ${confirmCount}...`
               :"🔒 Lock in — or tap card again"}
            </span>
          </button>
        ):(
          <div style={{display:"flex",gap:9}}>
            <button onClick={cancelAutoAndGoHome} style={{flex:1,padding:"14px",fontSize:13,fontWeight:600,background:T.glass,color:"#e8e6e1",border:`1.5px solid ${T.glassBorder}`,borderRadius:13,cursor:"pointer",fontFamily:"inherit"}}>
              Home
            </button>
            <button onClick={cancelAutoAndNext} style={{flex:2,padding:"14px",fontSize:14,fontWeight:700,letterSpacing:1,textTransform:"uppercase",background:`linear-gradient(135deg,${T.gold},#d4a830)`,color:T.bg,border:"none",borderRadius:13,cursor:"pointer",fontFamily:"inherit",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",bottom:0,left:0,height:3,background:"rgba(255,255,255,0.35)",animation:autoCount!==null?"g-autoProgress 2.5s linear forwards":"none"}}/>
              <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent,rgba(255,255,255,0.2),transparent)",animation:"g-btnShimmer 2.5s infinite"}}/>
              <span style={{position:"relative"}}>{autoCount!==null?`Next in ${autoCount}...`:"Next round →"}</span>
            </button>
          </div>
        )}

        {/* Score bar */}
        <div style={{display:"flex",justifyContent:"center",gap:18,marginTop:14,fontSize:12,color:T.dim}}>
          <span>Score <b style={{color:T.gold,fontSize:13}}>{score}/{total}</b></span>
          <span style={{color:"rgba(255,255,255,0.07)"}}>|</span>
          <span>Accuracy <b style={{color:T.gold,fontSize:13}}>{total?Math.round(score/total*100):0}%</b></span>
          <span style={{color:"rgba(255,255,255,0.07)"}}>|</span>
          <span>Streak <b style={{color:streak>0?T.gold:T.dim,fontSize:13}}>{streak}🔥</b></span>
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
    @keyframes g-shimmer{0%{background-position:-200% center}100%{background-position:200% center}}
    @keyframes g-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}
    @keyframes g-confetti{0%{transform:translateY(-10px) rotate(0);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:0}}
    @keyframes g-btnShimmer{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
    @keyframes g-cardSnap{from{opacity:0;transform:translateX(10px) scale(0.98)}to{opacity:1;transform:none}}
    @keyframes g-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-5px)}40%,80%{transform:translateX(5px)}}
    @keyframes g-revealGlow{0%{box-shadow:0 0 0 rgba(244,63,94,0)}50%{box-shadow:0 0 28px rgba(244,63,94,.3)}100%{box-shadow:0 0 14px rgba(244,63,94,.1)}}
    @keyframes g-correctGlow{0%{box-shadow:0 0 0 rgba(45,212,160,0)}50%{box-shadow:0 0 28px rgba(45,212,160,.4)}100%{box-shadow:0 0 14px rgba(45,212,160,.15)}}
    @keyframes g-fire{0%{transform:scale(1)}50%{transform:scale(1.3)}100%{transform:scale(1)}}
    @keyframes g-flash{0%{opacity:0.14}100%{opacity:0}}
    @keyframes g-timerRipple{0%{transform:scale(1);opacity:0.55}100%{transform:scale(1.7);opacity:0}}
    @keyframes g-lockProgress{from{width:0}to{width:100%}}
    @keyframes g-autoProgress{from{width:0}to{width:100%}}
    @keyframes ax-breathe{0%,100%{transform:scale(1) translateY(0)}50%{transform:scale(1.015) translateY(-1px)}}
    @keyframes ax-tilt{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-4deg) translateX(-2px)}}
    @keyframes ax-laugh{0%,100%{transform:scale(1) rotate(0)}25%{transform:scale(1.04) rotate(-2deg)}75%{transform:scale(1.04) rotate(2deg)}}
    @keyframes ax-meltdown{0%{transform:scale(1) rotate(0);filter:hue-rotate(0deg)}33%{transform:scale(1.03) rotate(-2deg);filter:hue-rotate(120deg)}66%{transform:scale(0.97) rotate(2deg);filter:hue-rotate(240deg)}100%{transform:scale(1) rotate(0);filter:hue-rotate(360deg)}}
  `}</style>;
}

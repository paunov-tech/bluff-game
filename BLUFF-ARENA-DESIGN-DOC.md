# BLUFF: ARENA — Game Design Document v1.0

**SIAL Games | April 2026 | Author: Miroslav Paunov**

---

## Core concept

10 igrača ulaze u sobu. Svako uloži SWEAR. AXIOM postavlja runde. Pogrešna runda = ispadaš odmah. Poslednji igrač uzima sve.

**Igra traje 3-5 min.** Drama je u svakoj sekundi.

---

## Match flow (3 faze)

### Faza 1 — LOBBY (60s)

Igrač klikne "Enter Arena". Prikazuje se **lobby ekran**:

```
┌─────────────────────────────────────────┐
│           ⚔️  BLUFF ARENA               │
│                                         │
│      Buy-in: 100 SWEAR                  │
│      Pot: 1,000 SWEAR (winner takes)    │
│      Lobby: 7 / 10 players              │
│                                         │
│  ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐                  │
│  │🇷🇸│ │🇩🇪│ │🇧🇷│ │🇯🇵│ │🇺🇸│   ← live avatari    │
│  └─┘ └─┘ └─┘ └─┘ └─┘                  │
│  ┌─┐ ┌─┐ ┌─┐                          │
│  │🇰🇷│ │🇮🇹│ │YOU│                       │
│  └─┘ └─┘ └─┘                          │
│                                         │
│      Starting in: 0:43 ⏱️                │
│                                         │
│      [LEAVE — refund SWEAR]             │
└─────────────────────────────────────────┘
```

**Pravila:**
- Auto-start kad se popuni 10 igrača (ne čeka 60s)
- Ako 60s istekne sa <10 igrača: dopuni botova ili otkaži (refund)
- Igrač može da napusti pre starta — refund SWEAR
- Posle starta: nema napuštanja, gubiš ulog ako odeš

**Anti-cheat:** Lobby radi kroz PartyKit. Server zna ko je ko. Klijent ne može da fake-uje "ja sam u sobi".

---

### Faza 2 — BATTLE (10 rundi max, sudden death)

Svaka runda:

```
┌─────────────────────────────────────────┐
│  Round 3 / 10        ⚔️  Players: 7/10  │
│                                         │
│  🏛️ HISTORY · Difficulty: ⭐⭐⭐         │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ A. Cleopatra lived closer...      │  │
│  ├───────────────────────────────────┤  │
│  │ B. Napoleon was attacked by...    │  │
│  ├───────────────────────────────────┤  │
│  │ C. The French army used taxis...  │  │
│  ├───────────────────────────────────┤  │
│  │ D. Roman temples had steam...     │  │
│  ├───────────────────────────────────┤  │
│  │ E. Queen Victoria wrote in Urdu...│  │
│  └───────────────────────────────────┘  │
│                                         │
│         Timer: 35s  ⏱️                   │
│                                         │
│      [LOCK IN ANSWER]                   │
│                                         │
│  Live: 🇷🇸 Locked  🇩🇪 Locked  🇧🇷 ⏳    │
│        🇯🇵 ⏳     🇺🇸 Locked  🇰🇷 ⏳     │
└─────────────────────────────────────────┘
```

**Mehanike:**

1. **Timer:** 35s na lakim rundama, 50s na teškim
2. **Live presence:** Vidiš ko je već lock-ovao odgovor (ali NE ŠTA)
3. **Eliminacija:** Pogrešan = ispadaš ODMAH (animacija, vraćaš se u "spectator" mode)
4. **Tajming kao tie-breaker:** Ako svih 10 odgovore tačno → najsporiji ispada
5. **Lifelines:** NEMA lifelines u Arena modu. Čista veština.

**Šta se desi kad ispadneš:**

```
┌─────────────────────────────────────────┐
│                                         │
│         💀 ELIMINATED                   │
│                                         │
│      You finished #7 / 10               │
│                                         │
│      The bluff was: A                   │
│      You chose: D                       │
│                                         │
│  Watch the rest? [YES] [LEAVE]          │
└─────────────────────────────────────────┘
```

**Spectator mode:** Možeš gledati ostatak ARENA kao reality show. Vidiš live ko ispada, AXIOM komentariše.

---

### Faza 3 — VICTORY (15s celebration)

Kada ostane 1 igrač:

```
┌─────────────────────────────────────────┐
│                                         │
│            🏆 VICTOR                    │
│                                         │
│        🇷🇸  paunov                     │
│                                         │
│         +1,000 SWEAR                    │
│                                         │
│   [Replay key moments]   [Share]        │
│   [Enter another Arena]                 │
└─────────────────────────────────────────┘
```

Pobeda screen sadrži:
- Replay highlights (3 ključna momenta — gde su drugi ispali)
- Share card (autogenerisan, optimizovan za Twitter/Insta)
- Quick "Enter Another Arena" dugme (fascinante kockanje)

---

## Eliminacija logika — detaljno

### Slučaj 1: Igrač pogrešan
**Eliminisan odmah.** Animacija: njegov avatar pada sa screen-a (gravity drop), zvuk udarca, screen briefly shake.

### Slučaj 2: Igrač ne odgovori (timer ističe)
**Eliminisan kao "AFK".** Avatar postaje siv, "AFK" badge. Avatar se uklanja iz live presence trake.

### Slučaj 3: Svi tačno odgovore
**Najsporiji ispada.** Server beleži timestamp lock-a za svakog. Ako su tačno 10 ms razlike — random među najsporijim.

### Slučaj 4: Svi pogrešno odgovore
**Niko ne ispada.** AXIOM komentariše: "You all fell for it. Continuing." Sledeća runda počinje, ista lista igrača.

### Slučaj 5: Dvojica ostaju, oba pogrešno
**Sudden death runda 1v1.** Posebna runda, kraći timer (15s), oštrija pitanja. Pogrešan ispada. Ako oba tačno → brzina.

### Slučaj 6: Match traje 10 rundi sa više od 1 igrača preostalih
**Final round** — najteža moguća (Diabolical), 20s timer. Pogrešan ispada. Ako svi tačno → najsporiji ispada do 1 ostane.

---

## SWEAR ekonomija (Poker model)

### Buy-in tier-i:

| Tier | Buy-in | Pot (10 igrača) | Min Level |
|---|---|---|---|
| **Bronze** | 50 SWEAR | 500 SWEAR | Free |
| **Silver** | 200 SWEAR | 2,000 SWEAR | 1,000 lifetime SWEAR |
| **Gold** | 1,000 SWEAR | 10,000 SWEAR | 10,000 lifetime SWEAR |
| **Diamond** | 5,000 SWEAR | 50,000 SWEAR | Pro subscription |

**Min lifetime SWEAR** sprečava da početnik gubi sve na Diamond i napušta igru.

### Ko uzima šta:

- **#1 (winner):** 100% pot
- Svi ostali: 0%

**Čisti poker model.** Niko nije "sigurno bezbedan" — moraš pobediti ili gubiš sve.

### Anti-grinding:
- Free Bronze tier: max 5 ulazaka dnevno
- Posle toga, čekaš sutra ili plaćaš Pro

### Free play opcija:
**"Practice Arena"** — bez SWEAR-a, sa botovima za training. Ne ide na leaderboard.

---

## Real-time presence (PartyKit arhitektura)

### Šta klijent vidi:
- Live broj igrača preostalih
- Avatar svakog igrača sa flag-om
- "Locked / Pending" status (ne sam odgovor)
- Real-time eliminacije (avatar pada animirano)

### Šta klijent NE vidi:
- Šta su drugi izabrali (do reveal-a)
- Tajming drugih (do reveal-a)
- IP / lokaciju drugih (privacy)

### Server (PartyKit):
- Hosting room state
- Validacija svih submita (timestamp + answer)
- Eliminacija calculation
- Authoritative — klijent ne može da menja state

### Reconnect logic:
- Ako igrač izgubi internet u toku runde → 30s grace period
- Ako se vrati u 30s → nastavlja, timer ne resetuje
- Ako ne → eliminisan (kao AFK)

---

## Drama elementi u Arena modu

Svih 6 drama elemenata iz tvog plana — kako se uklapaju:

### 1. Sabotage moments (5% šansa po rundi)

U Arena, AXIOM može da "sabotira" **celu sobu**:
- Glitch efekat (svi vide, traju 3s)
- Timer skoči (svi vide, drama)
- Kratak reveal jedne tvrdnje (1s, sve briše, ostali nisu sigurni da li su videli)

**Bonus za 1v1:** Sabotage je 25% šanse u sudden death — drama je peak.

### 2. AXIOM physical reactions

U Arena AXIOM je vizuelno različit:
- Nakon eliminacije: smeje se eliminisanom igraču (njegov flag se pojavi pored AXIOM-a)
- Nakon "everyone wrong" runde: **eksplodira u smehu**, ekran trese, "FOOLED YOU ALL"
- Final round: AXIOM **gori**, postaje crveniji u svakoj rundi

### 3. The Pit (eliminacija drama)

Već specifikovano gore. Ali u Arena:
- Tvoj avatar pada **sa zvučnim efektom** (bell-tone)
- Drugi igrači **vide tvoj pad** u live presence traci
- "🇷🇸 paunov has fallen" — toast notifikacija svim ostalima

### 4. The Vault — NE radi u Arena

Vault je solo bonus mehanika. U Arena nema sense (nema "skip runde" kad se eliminacija odlučuje sad).

**Umesto toga: "Mercy Round"** — ako 9 ljudi ispadnu pre runde 5, AXIOM daje "easy round" da survive-ujesh. Drama: drugi igrači ne znaju da li je easy ili trick.

### 5. The Mirror — adaptacija za Arena

U Arena, Mirror moment je:
- Posle eliminacije, dok si u Spectator mode
- Pojavi se "Bi li ti uradio drugačije?" — tvoj odgovor vs winning igrač
- Filozofski moment: "Da si bio 0.3s brži, bio bi pobednik"

### 6. Real-time community presence

Već ugrađeno u Arena prirodno (svi smo zajedno, vidimo se).

**Bonus:** Posle Arena, "Top moments" highlights — slično Twitch clips. Možeš share-ovati specifičan moment.

---

## Rewards & Progression

### Posle Arena pobede:

```
Rewards screen pokaže:
  +1,000 SWEAR (pot)
  +50 XP
  +1 Arena Win
  
Streak bonus:
  3 wins in a row: +500 SWEAR bonus
  5 wins: Special "Arena Master" badge (visible to others)
  10 wins: AXIOM personalizes intro za sledeću Arena
```

### Arena rang lista (separate from Climb leaderboard):

- **Daily** — top 100 sa najviše Arena pobeda danas
- **Weekly** — top 100 nedelja
- **All-time** — top 1000 sve vreme
- **By tier** — separate rangiranje za Bronze/Silver/Gold/Diamond

### Achievements:
- "First Blood" — pobedio prvi Arena
- "Untouchable" — pobedio bez ijedne greške (svih 10 rundi tačno)
- "Phoenix" — pobedio nakon što si bio poslednji (rang 10/10) → vratio se → pobedio
- "Diamond Hands" — 10 pobeda u Diamond tier
- "Whale" — pojeo pot od 50,000+ SWEAR

---

## Anti-cheat & fairness

### Server-side:
- Sve tvrdnje generisane unapred (cache), klijent vidi samo statemente, ne "real" status
- Submit timestamp od server-a (ne klijent), ne može fake-ovati brzinu
- Random salt po rundi (sprečava replay napada)
- IP rate limit (max 5 Arena per minute po IP-u)

### Client-side detekcija:
- Ako odgovor stigne pre nego što je render-ovan na klijentu (sub-100ms) → flag
- Ako je tajming previše konzistentan (uvek 5.0s) → bot detekcija
- Ako pobedjuje 10 puta zaredom u Diamond → manual review

### Suspended accounts:
- Detected cheating → return SWEAR ulog → suspend 7 dana
- 2x detection → permanent ban + lose all SWEAR

---

## Matchmaking algoritam

### Faza 1 (launch): Random
Svi sa istog tier-a stavljeni u istu sobu. FIFO queue.

### Faza 2 (posle 1000+ igrača): Skill-based
- Compute "Arena rating" (ELO-style)
- Ljudi sa sličnim ratingom (±100) idu zajedno
- Niko ne čeka više od 60s

### Faza 3 (posle 10K igrača): Regional
- EU room, Americas room, Asia-Pacific room
- Smanjuje latency na <100ms

### Faza 4: Friend rooms
- Pozovi 2-9 prijatelja → private Arena
- Set custom buy-in (ili free)
- Ne ide na global leaderboard

---

## Vizuelni dizajn (briefing za UI)

### Lobby:
- Pozadina: gladijatorska arena (dark, fire pits)
- Avatari: krugovi sa zastavama (kao FIFA)
- Pot countdown sa zlatnim brojevima
- AXIOM u pozadini, gleda dole na arenu

### Battle:
- Pozadina: tamna sa subtle red tint (krv, drama)
- Statementi: kao na BLUFF Card-u, ali kompresovane (manje white-space)
- Live presence: gornja traka sa avatari + status dot
- Timer: ogromni, centar-vrh, pulsira crveno u poslednjih 5s

### Eliminacija animacija:
- Avatar zoom 50% → fall down off-screen → red glow ostavi
- "💀 FALLEN" tekst preko cele liste
- Kamera shake (subtle)

### Victory:
- Crowd cheering sound
- Confetti shower
- Pobednik avatar zoomed center, glow effect
- AXIOM bows to winner (animation)

---

## Tehnička arhitektura

### Stack:
- **Frontend:** React 19 + Vite (postojeći)
- **Real-time:** PartyKit (već imaš za Duel)
- **Backend:** Vercel serverless functions
- **DB:** Firestore (postojeći schema + new collections)
- **Auth:** GIS flow (radi)

### Nove kolekcije Firestore:
```
arena_rooms/{roomId}
  - status: "lobby" | "battle" | "ended"
  - tier: "bronze" | "silver" | "gold" | "diamond"
  - players: [{ uid, handle, flag, joinedAt, eliminated, eliminatedAt, eliminatedRound }]
  - currentRound: number
  - rounds: [{ statements, lockedAnswers: [{ uid, answer, timestamp }] }]
  - pot: number
  - winner: uid | null
  - createdAt, endedAt

arena_stats/{uid}
  - totalEntries: number
  - totalWins: number
  - totalSWEARWon: number
  - totalSWEARLost: number
  - longestStreak: number
  - currentStreak: number
  - achievements: string[]
  - tierStats: { bronze: {...}, silver: {...}, ... }
```

### PartyKit room schema:
```typescript
type ArenaRoom = {
  roomId: string;
  tier: "bronze" | "silver" | "gold" | "diamond";
  state: "lobby" | "battle" | "ended";
  players: Map<uid, PlayerState>;
  currentRound: Round | null;
  pot: number;
  startedAt: number;
};

type PlayerState = {
  uid: string;
  handle: string;
  flag: string;
  status: "alive" | "eliminated" | "afk" | "winner";
  lockedAt: number | null;
  answer: string | null;
};
```

### Serverless endpoints:
- `POST /api/arena/enter` — pay buy-in, queue for room
- `POST /api/arena/leave-lobby` — refund + leave
- `WS /party/arena/{roomId}` — real-time game
- `POST /api/arena/distribute` — winner gets pot (called by PartyKit on game end)

---

## Phase plan

### Phase 1 (1 nedelja) — Drama elementi u Solo modu

CC implementira:
- Sabotage moments (5% rundi)
- The Pit eliminacija drama (3-sekundna animacija pada)
- Real-time community presence (toast: "127 igrača sad bira A")
- AXIOM physical reactions (osnove: laugh on win, sad on loss)

**Cilj:** Korisnici dobijaju "uzbuđenje" odmah, dok mi gradimo Arena.

### Phase 2 (2 nedelje) — Arena MVP (10 igrača, bez stakes)

CC implementira:
- Lobby UI + matchmaking (FIFO, no SWEAR)
- PartyKit Arena room
- Battle flow sa eliminacijom
- Spectator mode
- Victory screen + share card

**Cilj:** Prvi Arena igraći do kraja Maja. Free, no SWEAR.

### Phase 3 (1 nedelja) — Drama u Arena + AXIOM personalities

CC implementira:
- Sabotage adaptiran za Arena (whole room)
- The Mirror posle eliminacije
- Mercy Round mehanika
- AXIOM personalities (3 varijante: Prime, Furioso, Sage)

### Phase 4 (1 nedelja) — Stakes + Tier-i + Rewards

CC implementira:
- SWEAR buy-in + pot mechanic
- 4 tier-a (Bronze/Silver/Gold/Diamond)
- Anti-cheat (server timestamps, salts)
- Achievements
- Arena leaderboards

**Cilj:** Full launch sa stakes, ranije od trenutnog 29.04 datuma.

### Phase 5 (continuous) — Optimizacija & content

- Friend rooms
- Regional matchmaking
- Tournament mode (16-igrača bracket)
- Sponsored Arena (brand pays for branded room)

---

## Risk assessment

### Tehnički rizici:
- **PartyKit scaling** — koliko soba istovremeno? Treba load test pre launch-a.
- **Server latency** — ako je ping 500ms, "live presence" deluje pokvareno. Treba regionalni hosting.
- **Reconnect bugs** — najteža kategorija. Testirati prekid mreže, refresh, app background.

### Game design rizici:
- **Sudden death može da bude frustrirajuće** — igrač gubi 100 SWEAR jer pogrešio prvu rundu. Treba "Free practice arena" jako vidljivo.
- **Top igrači dominiraju** — nakon 100 sati, isti par ljudi pobedjuje sve. Treba tier-i da odvajaju.
- **Bot problem** — ako bot-ovi ulaze sa CS + cheat-uju → ekonomija puca. Anti-cheat MUST raditi.

### Monetizacijska:
- **SWEAR deflation** — ako pobednici sakupe sve, novi igrači nemaju. Treba inflation source (daily login bonus, Pro subscription bonus, ad-watch reward).
- **Whale problem** — jedan korisnik dominira Diamond tier sa ogromnim balansom. Treba "Whale bracket" sa entry samo top 100 SWEAR holders.

---

## Success metrics

### MVP (Phase 2 launch):
- 50% korisnika koji pokrenu Arena dovrše prvu partiju
- Avg session = 2+ Arena podred
- D1 retention 35%+ za Arena igrače (vs 25% za Solo)

### Stakes launch (Phase 4):
- 30% Arena igrača kupi SWEAR pak (€5+)
- Avg pot size raste kroz vreme (igrači idu u višii tier)
- Arena = 60%+ DAU posle 2 meseca

### Long term:
- 10K MAU igraća Arena 2x nedeljno
- Top 100 igrači generišu 70% SWEAR ekonomije
- Sponsored Arena postaju revenue stream

---

## Sledeći korak

Ovo je dokument. Neka stoji. Pre nego što damo CC task-u Phase 1:

**Pregledaj** dokumentaciju. Reci mi:
1. Da li je 100 SWEAR Bronze buy-in OK (ili treba niže)?
2. Da li 35s timer u Arena rundi je dobar ili previše/premalo?
3. Da li želiš "AFK" eliminisanog igrača da gubi ulog ili da bude refund?
4. Bilo šta drugo što ne stoji?

Posle pregleda, ja pišem **CC TASK Phase 1** spreman za pokretanje.


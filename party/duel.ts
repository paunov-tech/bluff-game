import type * as Party from "partykit/server";

interface Player {
  id: string;
  name: string;
  score: number;
  ready: boolean;
  // Blitz clock
  timeLeft: number;      // ms remaining on clock
  clockRunning: boolean;
  lastTick: number;      // timestamp of last tick
}

interface DuelRoom {
  mode: "regular" | "blitz";
  players: Record<string, Player>;
  rounds: any[];         // pre-fetched questions
  currentRound: number;
  phase: "waiting" | "countdown" | "playing" | "round_result" | "finished";
  roundStartTime: number;
  answers: Record<string, { sel: number; time: number; correct: boolean }>;
}

const BLITZ_CLOCK = 60_000; // 60 seconds total per player
const REGULAR_TIMER = 45_000; // 45 seconds per round

export default class DuelServer implements Party.Server {
  state: DuelRoom;

  static FALLBACK_POOL = [
    {
      category: "history",
      statements: [
        { text: "Napoleon was once attacked by a horde of rabbits during a hunt.", real: true },
        { text: "Cleopatra lived closer in time to the Moon landing than the pyramids.", real: true },
        { text: "Roman priests built steam-powered mechanisms for temple doors.", real: true },
        { text: "The Eiffel Tower was originally built in Brussels in 1889.", real: false },
      ],
    },
    {
      category: "science",
      statements: [
        { text: "Honey never spoils — 3,000-year-old honey from tombs is still edible.", real: true },
        { text: "A teaspoon of neutron star weighs about 6 billion tons.", real: true },
        { text: "Bananas are slightly radioactive due to potassium-40.", real: true },
        { text: "Jupiter's core is a single diamond the size of Earth.", real: false },
      ],
    },
    {
      category: "animals",
      statements: [
        { text: "A group of flamingos is called a flamboyance.", real: true },
        { text: "Octopuses have three hearts and blue blood.", real: true },
        { text: "Crows can recognize human faces and hold grudges for years.", real: true },
        { text: "Dolphins sleep with both eyes closed using stereo dreaming.", real: false },
      ],
    },
    {
      category: "geography",
      statements: [
        { text: "Russia has 11 time zones across its territory.", real: true },
        { text: "Australia is wider than the Moon is in diameter.", real: true },
        { text: "Vatican City is the smallest country in the world.", real: true },
        { text: "The Nile flows north-to-south across Africa.", real: false },
      ],
    },
    {
      category: "food",
      statements: [
        { text: "Carrots were originally purple, not orange.", real: true },
        { text: "Peanuts are legumes, not nuts.", real: true },
        { text: "Honey is the only food that never goes bad.", real: true },
        { text: "Tomatoes were banned in France until 1850 as a poison.", real: false },
      ],
    },
    {
      category: "human_body",
      statements: [
        { text: "Your stomach gets a new lining every 3-4 days.", real: true },
        { text: "The human eye can distinguish about 10 million colors.", real: true },
        { text: "Your heart beats roughly 100,000 times per day.", real: true },
        { text: "Humans share 80% of their DNA with bananas.", real: false },
      ],
    },
    {
      category: "space",
      statements: [
        { text: "Venus rotates backward compared to most planets.", real: true },
        { text: "A day on Venus is longer than its year.", real: true },
        { text: "Saturn's density is low enough that it would float in water.", real: true },
        { text: "Neil Armstrong left a family photo on the Moon.", real: false },
      ],
    },
    {
      category: "technology",
      statements: [
        { text: "The first computer bug was an actual moth found in 1947.", real: true },
        { text: "Email existed before the World Wide Web.", real: true },
        { text: "The Firefox logo is actually a red panda, not a fox.", real: true },
        { text: "The @ symbol was invented for email in 1971.", real: false },
      ],
    },
    {
      category: "music",
      statements: [
        { text: "Beethoven continued composing after going deaf.", real: true },
        { text: "The Beatles were rejected by Decca Records in 1962.", real: true },
        { text: "Mozart wrote his first symphony at age 8.", real: true },
        { text: "Pianos have exactly 100 keys on a standard model.", real: false },
      ],
    },
    {
      category: "language",
      statements: [
        { text: "Mandarin has more native speakers than any other language.", real: true },
        { text: "The shortest English sentence uses just 'Go.'", real: true },
        { text: "The word 'set' has over 400 definitions in English.", real: true },
        { text: "The word 'queue' uses 80% silent letters.", real: false },
      ],
    },
    {
      category: "sports",
      statements: [
        { text: "The Olympic flame is lit using sunlight in Olympia, Greece.", real: true },
        { text: "Basketball was invented using a peach basket in 1891.", real: true },
        { text: "Golf balls have an average of 336 dimples.", real: true },
        { text: "Tennis scoring uses base-10 numbers like most sports.", real: false },
      ],
    },
    {
      category: "inventions",
      statements: [
        { text: "Bubble wrap was invented as textured wallpaper.", real: true },
        { text: "Post-it notes were discovered from a failed glue experiment.", real: true },
        { text: "The microwave was invented by accident in 1945.", real: true },
        { text: "Velcro was inspired by fish scales in the 1950s.", real: false },
      ],
    },
  ];

  constructor(readonly room: Party.Room) {
    this.state = {
      mode: "regular",
      players: {},
      rounds: [],
      currentRound: 0,
      phase: "waiting",
      roundStartTime: 0,
      answers: {},
    };
  }

  async onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    const url = new URL(ctx.request.url);
    const name = url.searchParams.get("name") || "Player";
    const mode = url.searchParams.get("mode") as "regular" | "blitz" || "regular";

    if (Object.keys(this.state.players).length === 0) {
      this.state.mode = mode;
    }

    this.state.players[conn.id] = {
      id: conn.id,
      name,
      score: 0,
      ready: false,
      timeLeft: BLITZ_CLOCK,
      clockRunning: false,
      lastTick: Date.now(),
    };

    this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));

    // If 2 players, seed fallback rounds and start immediately (no blocking fetch)
    if (Object.keys(this.state.players).length === 2 && this.state.rounds.length === 0) {
      this.state.rounds = this.buildFallbackRounds();
      console.log(`[server] seeded ${this.state.rounds.length} fallback rounds`);
      this.startCountdown();
    }
  }

  async fetchQuestions() {
    const categories = ["premier_league", "nba", "bundesliga", "sports", "popculture"];
    const difficulties = this.state.mode === "blitz" ? [3, 4, 4, 5] : [2, 3, 3, 4, 3, 4];
    const rounds = [];

    for (const diff of difficulties) {
      try {
        const cat = categories[Math.floor(Math.random() * categories.length)];
        const res = await fetch(`${this.room.env.PARTYKIT_HOST || "https://playbluff.games"}/api/generate-round`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: cat, difficulty: diff, lang: "en" }),
        });
        const data = await res.json();
        rounds.push({ category: cat, difficulty: diff, statements: data.statements });
      } catch {
        rounds.push(this.getFallbackRound(diff));
      }
    }

    this.state.rounds = rounds;
  }

  buildFallbackRounds() {
    const difficulties = this.state.mode === "blitz" ? [3, 4, 4, 5] : [2, 3, 3, 4, 3, 4];
    const pool = [...DuelServer.FALLBACK_POOL];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return difficulties.map((diff, idx) => ({
      category: pool[idx % pool.length].category,
      difficulty: diff,
      statements: pool[idx % pool.length].statements,
    }));
  }

  startCountdown() {
    this.state.phase = "countdown";
    this.room.broadcast(JSON.stringify({ type: "countdown", seconds: 3 }));
    setTimeout(() => this.startRound(), 3000);
  }

  startRound() {
    this.state.phase = "playing";
    this.state.roundStartTime = Date.now();
    this.state.answers = {};

    // Start blitz clocks
    if (this.state.mode === "blitz") {
      for (const p of Object.values(this.state.players)) {
        p.clockRunning = true;
        p.lastTick = Date.now();
      }
      this.tickClocks();
    }

    this.room.broadcast(JSON.stringify({
      type: "round_start",
      round: this.state.currentRound,
      data: this.state.rounds[this.state.currentRound],
      phase: "playing",
      timerMs: this.state.mode === "blitz" ? null : REGULAR_TIMER,
      startTime: Date.now(),
    }));

    // Regular mode: auto-advance after timer
    if (this.state.mode === "regular") {
      setTimeout(() => this.resolveRound(), REGULAR_TIMER);
    }
  }

  tickClocks() {
    if (this.state.phase !== "playing" || this.state.mode !== "blitz") return;

    const now = Date.now();
    let anyFlagged = false;

    for (const p of Object.values(this.state.players)) {
      if (p.clockRunning && !this.state.answers[p.id]) {
        const elapsed = now - p.lastTick;
        p.timeLeft = Math.max(0, p.timeLeft - elapsed);
        p.lastTick = now;

        if (p.timeLeft <= 0) {
          // FLAG FALLS
          p.clockRunning = false;
          anyFlagged = true;
          this.room.broadcast(JSON.stringify({
            type: "flag_fell",
            playerId: p.id,
            playerName: p.name,
          }));

          // Give opponent a bonus question opportunity
          const opponentId = Object.keys(this.state.players).find(id => id !== p.id);
          if (opponentId) {
            this.room.broadcast(JSON.stringify({
              type: "bonus_opportunity",
              forPlayerId: opponentId,
              round: this.state.currentRound,
              doublePoints: true,
            }));
          }
        }
      }
    }

    this.room.broadcast(JSON.stringify({
      type: "clock_update",
      clocks: Object.fromEntries(
        Object.values(this.state.players).map(p => [p.id, p.timeLeft])
      ),
    }));

    if (!anyFlagged && this.state.phase === "playing") {
      setTimeout(() => this.tickClocks(), 200);
    }
  }

  onMessage(message: string, sender: Party.Connection) {
    const msg = JSON.parse(message);

    if (msg.type === "new_game") {
      this.state.rounds = this.buildFallbackRounds();
      this.state.currentRound = 0;
      this.state.answers = {};
      this.state.phase = "countdown";
      for (const pid in this.state.players) {
        this.state.players[pid].score = 0;
        this.state.players[pid].ready = false;
        this.state.players[pid].timeLeft = BLITZ_CLOCK;
        this.state.players[pid].clockRunning = false;
      }
      this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));
      this.startCountdown();
      return;
    }

    if (msg.type === "answer") {
      const player = this.state.players[sender.id];
      if (!player || this.state.answers[sender.id]) return;

      const round = this.state.rounds[this.state.currentRound];
      const bluffIdx = round.statements.findIndex((s: any) => !s.real);
      const correct = msg.sel === bluffIdx;
      const timeUsed = Date.now() - this.state.roundStartTime;
      const doublePoints = msg.doublePoints || false;
      const points = correct ? (doublePoints ? 2 : 1) : 0;

      this.state.answers[sender.id] = {
        sel: msg.sel,
        time: timeUsed,
        correct,
      };

      if (correct) {
        player.score += points;
      }

      // Stop this player's clock in blitz
      if (this.state.mode === "blitz" && player) {
        player.clockRunning = false;
      }

      this.room.broadcast(JSON.stringify({
        type: "player_answered",
        playerId: sender.id,
        correct,
        points,
        score: player.score,
      }));

      // If both answered, resolve round
      if (Object.keys(this.state.answers).length >= Object.keys(this.state.players).length) {
        setTimeout(() => this.resolveRound(), 500);
      }
    }
  }

  resolveRound() {
    if (this.state.phase !== "playing") return;
    this.state.phase = "round_result";

    const round = this.state.rounds[this.state.currentRound];
    const bluffIdx = round.statements.findIndex((s: any) => !s.real);

    this.room.broadcast(JSON.stringify({
      type: "round_result",
      bluffIdx,
      answers: this.state.answers,
      scores: Object.fromEntries(
        Object.values(this.state.players).map(p => [p.id, p.score])
      ),
    }));

    const totalRounds = this.state.rounds.length;
    const nextRound = this.state.currentRound + 1;

    if (nextRound >= totalRounds) {
      setTimeout(() => this.finishGame(), this.state.mode === "blitz" ? 1500 : 2500);
    } else {
      this.state.currentRound = nextRound;
      setTimeout(() => this.startRound(), this.state.mode === "blitz" ? 1500 : 2500);
    }
  }

  finishGame() {
    this.state.phase = "finished";
    const players = Object.values(this.state.players);
    const sorted = [...players].sort((a, b) => b.score - a.score);
    const top = sorted[0];
    const isTie = sorted.length >= 2 && sorted[0].score === sorted[1].score;

    this.room.broadcast(JSON.stringify({
      type: "game_over",
      winner: isTie ? null : top.id,
      winnerName: isTie ? null : top.name,
      isTie,
      scores: Object.fromEntries(players.map(p => [p.id, p.score])),
    }));
  }

  async onClose(conn: Party.Connection) {
    console.log(`[server] onClose fired for ${conn.id}`);
    if (this.state.players[conn.id]) {
      delete this.state.players[conn.id];
      this.room.broadcast(JSON.stringify({ type: "state", state: this.state }));
      console.log(`[server] removed player ${conn.id}, remaining: ${Object.keys(this.state.players).length}`);
    }
  }

  getFallbackRound(diff: number) {
    return {
      category: "history",
      difficulty: diff,
      statements: [
        { text: "Napoleon was once attacked by a horde of rabbits during a hunting party.", real: true },
        { text: "Cleopatra lived closer in time to the Moon landing than to the pyramids.", real: true },
        { text: "The French army used 600 Paris taxis to rush troops to the Battle of the Marne.", real: true },
        { text: "Ancient Romans built steam-powered temple door mechanisms.", real: true },
        { text: "The Eiffel Tower was built in Brussels in 1889.", real: false },
      ],
    };
  }
}

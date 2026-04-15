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
const REGULAR_TIMER = 35_000; // 35 seconds per question

export default class DuelServer implements Party.Server {
  state: DuelRoom;

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

    this.broadcast(JSON.stringify({ type: "state", state: this.state }));

    // If 2 players, fetch questions and start
    if (Object.keys(this.state.players).length === 2 && this.state.rounds.length === 0) {
      await this.fetchQuestions();
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

  startCountdown() {
    this.state.phase = "countdown";
    this.broadcast(JSON.stringify({ type: "countdown", seconds: 3 }));
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

    this.broadcast(JSON.stringify({
      type: "round_start",
      round: this.state.currentRound,
      data: this.state.rounds[this.state.currentRound],
      phase: "playing",
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
          this.broadcast(JSON.stringify({
            type: "flag_fell",
            playerId: p.id,
            playerName: p.name,
          }));

          // Give opponent a bonus question opportunity
          const opponentId = Object.keys(this.state.players).find(id => id !== p.id);
          if (opponentId) {
            this.broadcast(JSON.stringify({
              type: "bonus_opportunity",
              forPlayerId: opponentId,
              round: this.state.currentRound,
              doublePoints: true,
            }));
          }
        }
      }
    }

    this.broadcast(JSON.stringify({
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

      this.broadcast(JSON.stringify({
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

    this.broadcast(JSON.stringify({
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
    const winner = players.reduce((a, b) => a.score > b.score ? a : b);

    this.broadcast(JSON.stringify({
      type: "game_over",
      winner: winner.id,
      winnerName: winner.name,
      scores: Object.fromEntries(players.map(p => [p.id, p.score])),
    }));
  }

  onClose(conn: Party.Connection) {
    delete this.state.players[conn.id];
    this.broadcast(JSON.stringify({
      type: "player_left",
      playerId: conn.id,
    }));
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

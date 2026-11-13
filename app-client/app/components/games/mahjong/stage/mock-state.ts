"use client";

// Scripted fake state for the 3D stage mock. No API, no rules engine: a hand that looks plausible,
// opponents who throw the tile they drew, and buttons that fire the big moments.

import { create } from "zustand";
import { TILES, tilesFrom, type TileId } from "@/app/lib/games/mahjong/tiles";

export type Mood = "idle" | "think" | "riichi" | "win";
export type MomentKind = "riichi" | "win" | "draw";
export type Moment = { id: number; kind: MomentKind; seat: number; how?: "ron" | "tsumo"; at: number };
export type Reaction = { id: number; seat: number; glyph: string; at: number; dx: number };
export type LowerThird = { id: number; kind: "win" | "draw"; kicker: string; title: string; value?: string; lines: string[]; seat: number };
export type Ticker = { id: number; text: string; seat: number };

export type SeatInfo = { name: string; short: string; symbol: string | null; colors: { night: string; day: string }; wind: string };

// Seat hues are picked to stay apart from each other: the three pilot talents' own colors are all blues.
export const SEATS: SeatInfo[] = [
  { name: "You", short: "YOU", symbol: null, colors: { night: "#3fb8f5", day: "#0e8fd6" }, wind: "W" },
  { name: "Usada Pekora", short: "PEKORA", symbol: "PEK", colors: { night: "#ff9a52", day: "#d0601a" }, wind: "N" },
  { name: "Hoshimachi Suisei", short: "SUISEI", symbol: "SUI", colors: { night: "#a993ff", day: "#6e4fd0" }, wind: "E" },
  { name: "Gawr Gura", short: "GURA", symbol: "GUR", colors: { night: "#4fdccf", day: "#0c8f87" }, wind: "S" },
];

export const seatColor = (seat: number, day: boolean) => (day ? SEATS[seat].colors.day : SEATS[seat].colors.night);

export const ROUND = { wind: "East", hand: 3, honba: 1 };

const CHEERS: string[][] = [
  ["👏", "🔥", "GG", "📈"],
  ["🥕", "👏", "📈", "🔥", "nice"],
  ["☄️", "✨", "👏", "📈", "W"],
  ["🦈", "🔥", "👏", "📈", "a"],
];

type Meld = { tiles: TileId[]; called: number };

function deal() {
  const used = new Set<TileId>();
  const take = (text: string) => tilesFrom(text, used);
  const hands = [take("2345m406p3457s77z8s"), take("234m567p22s34567s"), take("456m789p123s1112z"), take("678m345p5678s")];
  const wins = [-1, take("8s")[0], take("2z")[0], take("8s")[0]];
  const melds: Meld[][] = [[], [], [], [{ tiles: take("555z"), called: 0 }]];
  const ponds = [take("9m1z4z8p1s"), take("1p9s3z7m2p6z"), take("9p1m4z7z8m"), take("1s9m6z2s3z1p4p")];
  const dora = [...take("3p"), ...take("1m2m3m4m")];
  const pool: TileId[] = [];
  for (let id = 0; id < TILES; id++) if (!used.has(id)) pool.push(id);
  // A fixed shuffle so every reload plays the same.
  let seed = 7;
  for (let i = pool.length - 1; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return { hands, wins, melds, ponds, dora, pool };
}

const HISTORY = [
  [25000, 27000, 26000, 24700],
  [25000, 23000, 25300, 27600],
  [25000, 26000, 24000, 23000],
  [25000, 24000, 24700, 24700],
];

type StageState = {
  hands: TileId[][];
  /** Each opponent's scripted winning tile (shown on a win). */
  wins: TileId[];
  /** The viewer has a fresh draw sitting apart at the end of the hand. */
  drawn: boolean;
  melds: Meld[][];
  ponds: TileId[][];
  /** Discards turned sideways (riichi declarations). */
  sideways: TileId[];
  dora: TileId[];
  pool: TileId[];
  riichi: boolean[];
  sticks: number;
  moods: Mood[];
  points: number[];
  history: number[][];
  /** Grows from 0 to 1 when a new point lands on the charts. */
  chartAt: number;
  moment: Moment | null;
  reveal: number | null;
  reactions: Reaction[];
  cheers: number[];
  ticker: Ticker | null;
  lowerThird: LowerThird | null;
  camNonce: number;
  dayOverride: boolean | null;
  phone: boolean;
  ambient: boolean;
  reduced: boolean;
  hoverTile: TileId | null;

  discard: (id: TileId) => void;
  ambientTurn: () => void;
  riichiFor: (seat: number) => void;
  winFor: (seat: number, how: "ron" | "tsumo") => void;
  drawGame: () => void;
  burst: (seat: number, count?: number) => void;
  dismiss: () => void;
  resetCamera: () => void;
  reset: () => void;
  setDay: (day: boolean | null) => void;
  setPhone: (phone: boolean) => void;
  setAmbient: (on: boolean) => void;
  setReduced: (on: boolean) => void;
  setHover: (id: TileId | null) => void;
};

let nextId = 1;
const timers = new Set<ReturnType<typeof setTimeout>>();
function later(ms: number, run: () => void) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    run();
  }, ms);
  timers.add(timer);
}
function clearTimers() {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
}

const sortHand = (ids: TileId[]) => [...ids].sort((a, b) => a - b);

function fresh() {
  const dealt = deal();
  return {
    hands: dealt.hands.map((hand, seat) => (seat === 0 ? [...sortHand(hand.slice(0, 13)), hand[13]] : hand)),
    wins: dealt.wins,
    drawn: true,
    melds: dealt.melds,
    ponds: dealt.ponds,
    sideways: [] as TileId[],
    dora: dealt.dora,
    pool: dealt.pool,
    riichi: [false, false, false, false],
    sticks: 0,
    moods: ["idle", "idle", "idle", "idle"] as Mood[],
    points: HISTORY.map((line) => line[line.length - 1]),
    history: HISTORY.map((line) => [...line]),
    chartAt: 1,
    moment: null,
    reveal: null,
    reactions: [] as Reaction[],
    cheers: [3, 41, 28, 35],
    ticker: null,
    lowerThird: null,
  };
}

const fmt = (value: number) => value.toLocaleString("en-US");

export const useStage = create<StageState>((set, get) => {
  const setMood = (seat: number, mood: Mood, ms?: number) => {
    set((state) => ({ moods: state.moods.map((m, i) => (i === seat ? mood : m)) }));
    if (ms) later(ms, () => set((state) => ({ moods: state.moods.map((m, i) => (i === seat && m === mood ? "idle" : m)) })));
  };
  const growChart = () => {
    if (get().reduced) return set({ chartAt: 1 });
    const start = performance.now();
    set({ chartAt: 0 });
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / 900);
      set({ chartAt: t });
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  return {
    ...fresh(),
    camNonce: 0,
    dayOverride: null,
    phone: false,
    ambient: true,
    reduced: false,
    hoverTile: null,

    discard: (id) => {
      const state = get();
      if (state.moment || !state.drawn) return;
      const hand = state.hands[0].filter((tile) => tile !== id);
      if (hand.length === state.hands[0].length) return;
      set({
        hands: state.hands.map((h, seat) => (seat === 0 ? sortHand(hand) : h)),
        ponds: state.ponds.map((p, seat) => (seat === 0 ? [...p, id] : p)),
        drawn: false,
        hoverTile: null,
      });
      // The next draw comes round a moment later.
      later(state.reduced ? 50 : 1300, () => {
        const now = get();
        if (now.drawn || now.moment) return;
        const [next, ...pool] = now.pool;
        if (next === undefined) return;
        set({ hands: now.hands.map((h, seat) => (seat === 0 ? [...h, next] : h)), pool, drawn: true });
      });
    },

    ambientTurn: () => {
      const state = get();
      if (state.moment || state.reveal !== null) return;
      const candidates = [1, 2, 3].filter((seat) => state.ponds[seat].length < 14);
      if (!candidates.length) return;
      const seat = candidates[Math.floor(Math.random() * candidates.length)];
      setMood(seat, "think", 1400);
      later(state.reduced ? 0 : 1100, () => {
        const now = get();
        if (now.moment || now.reveal !== null) return;
        // They throw the tile they just drew, so the scripted hand stays whole.
        const [drawnTile, ...pool] = now.pool;
        if (drawnTile === undefined) return;
        set({ pool, ponds: now.ponds.map((p, i) => (i === seat ? [...p, drawnTile] : p)) });
        if (Math.random() < 0.45) get().burst(seat, 2);
      });
    },

    riichiFor: (seat) => {
      const state = get();
      if (state.moment || state.riichi[seat]) return;
      const moment: Moment = { id: nextId++, kind: "riichi", seat, at: performance.now() };
      // The declaring discard lies sideways.
      let pond = state.ponds[seat];
      let pool = state.pool;
      let hands = state.hands;
      let drawn = state.drawn;
      let tile: TileId | undefined;
      if (seat === 0 && state.drawn) {
        tile = state.hands[0][state.hands[0].length - 1];
        hands = state.hands.map((h, i) => (i === 0 ? sortHand(h.slice(0, -1)) : h));
        drawn = false;
      } else if (seat !== 0) {
        [tile, ...pool] = state.pool;
      }
      if (tile !== undefined) pond = [...pond, tile];
      set({
        moment,
        hands,
        drawn,
        pool,
        ponds: state.ponds.map((p, i) => (i === seat ? pond : p)),
        sideways: tile !== undefined ? [...state.sideways, tile] : state.sideways,
        riichi: state.riichi.map((r, i) => r || i === seat),
        sticks: state.sticks + 1,
        points: state.points.map((p, i) => (i === seat ? p - 1000 : p)),
        ticker: { id: moment.id, seat, text: `RIICHI · ${SEATS[seat].short === "YOU" ? "YOU OPEN" : `${SEATS[seat].short} OPENS`} A POSITION · 1,000 STAKED` },
      });
      if (seat !== 0) setMood(seat, "riichi", 4200);
      get().burst(seat, 5);
      later(state.reduced ? 2400 : 3600, () => {
        if (get().moment?.id === moment.id) set({ moment: null });
      });
      later(4200, () => {
        if (get().ticker?.id === moment.id) set({ ticker: null });
        const now = get();
        if (seat === 0 && !now.drawn && !now.moment) {
          const [next, ...rest] = now.pool;
          if (next !== undefined) set({ hands: now.hands.map((h, i) => (i === 0 ? [...h, next] : h)), pool: rest, drawn: true });
        }
      });
    },

    winFor: (seat, how) => {
      const state = get();
      if (state.moment) return;
      const moment: Moment = { id: nextId++, kind: "win", seat, how, at: performance.now() };
      const gain = 8000;
      // Ron: the mock always has an opponent deal in, so a loser's sparkline visibly dips.
      const payer = seat === 2 ? 3 : 2;
      const delta = state.points.map((_, i) => {
        if (i === seat) return gain + state.sticks * 1000 + 300;
        if (how === "ron") return i === payer ? -(gain + 300) : 0;
        return i === 2 ? -4100 : -2000;
      });
      const points = state.points.map((p, i) => p + delta[i]);
      set({
        moment,
        reveal: seat,
        sticks: 0,
        points,
        history: state.history.map((line, i) => [...line, points[i]]),
        moods: state.moods.map((m, i) => (i === seat ? "win" : i === 0 ? m : "think")),
        lowerThird: null,
      });
      growChart();
      get().burst(seat, 9);
      const who = seat === 0 ? "You" : SEATS[seat].short.charAt(0) + SEATS[seat].short.slice(1).toLowerCase();
      later(state.reduced ? 0 : 1500, () => {
        if (get().moment?.id !== moment.id) return;
        set({
          lowerThird: {
            id: moment.id,
            kind: "win",
            seat,
            kicker: `${how === "ron" ? "Ron" : "Tsumo"} · ${who}`,
            title: "EARNINGS BEAT",
            value: `+${fmt(gain)}`,
            lines: how === "ron" ? ["Riichi", "Ippatsu", "Dora 2"] : ["Riichi", "Tsumo", "Dora 2"],
          },
        });
      });
    },

    drawGame: () => {
      const state = get();
      if (state.moment) return;
      const moment: Moment = { id: nextId++, kind: "draw", seat: 0, at: performance.now() };
      set({ moment, lowerThird: null, moods: state.moods.map((m, i) => (i === 0 ? m : "think")) });
      later(state.reduced ? 0 : 1100, () => {
        if (get().moment?.id !== moment.id) return;
        set({ lowerThird: { id: moment.id, kind: "draw", seat: 0, kicker: "Exhaustive draw · no winner", title: "MARKET CLOSED FLAT", lines: ["The wall ran out", "Honba +1"] } });
      });
    },

    burst: (seat, count = 7) => {
      const now = performance.now();
      const glyphs = CHEERS[seat];
      const fresh: Reaction[] = Array.from({ length: count }, (_, i) => ({ id: nextId++, seat, glyph: glyphs[(i + Math.floor(Math.random() * glyphs.length)) % glyphs.length], at: now + i * 140, dx: Math.round((Math.random() - 0.5) * 36) }));
      set((state) => ({ reactions: [...state.reactions.filter((r) => now - r.at < 2600), ...fresh], cheers: state.cheers.map((c, i) => (i === seat ? c + count : c)) }));
      later(2600 + count * 140, () => set((state) => ({ reactions: state.reactions.filter((r) => performance.now() - r.at < 2600) })));
    },

    dismiss: () => {
      const state = get();
      if (!state.moment && state.reveal === null && !state.lowerThird) return;
      if (state.moment?.kind === "riichi") return;
      // The hand is over: sticks come off the table for the next one.
      set({ moment: null, reveal: null, lowerThird: null, moods: ["idle", "idle", "idle", "idle"], riichi: [false, false, false, false] });
    },

    resetCamera: () => set((state) => ({ camNonce: state.camNonce + 1, moment: state.moment?.kind === "riichi" ? null : state.moment })),

    reset: () => {
      clearTimers();
      set((state) => ({ ...fresh(), camNonce: state.camNonce + 1 }));
    },

    setDay: (dayOverride) => set({ dayOverride }),
    setPhone: (phone) => set({ phone }),
    setAmbient: (ambient) => set({ ambient }),
    setReduced: (reduced) => set({ reduced }),
    setHover: (hoverTile) => set({ hoverTile }),
  };
});

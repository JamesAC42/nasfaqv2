"use client";

// What the 3D stage draws, as plain data. The live table (live-model.ts) and the dev page's scripted
// mock (mock-state.ts) both produce a StageModel; the scene only ever reads this store, so the two
// can never drift apart. Seats here are stage seats: 0 is the bottom of the screen (you, or the seat a
// spectator watches from), then 1 to its right, 2 across and 3 to its left, in turn order.
//
// The model only carries tiles the viewer is allowed to see: a hidden hand is a count, never ids.

import { create } from "zustand";
import type { TileId } from "@/app/lib/games/mahjong/tiles";

export type Mood = "idle" | "think" | "riichi" | "win";
export type MomentKind = "riichi" | "win" | "draw";
/** A big beat the room reacts to (lights, camera, the riichi stick). `at` is performance.now(). */
export type Moment = { id: number; kind: MomentKind; seat: number; how?: "ron" | "tsumo"; at: number };

export type StageSeat = {
  /** Who sits there, as the nameplate shows it. */
  name: string;
  /** A talent's ticker: whose portrait sits behind this side of the table. */
  symbol: string | null;
  /** The seat's color for the current theme. */
  color: string;
  /** "E", "S", "W" or "N". */
  wind: string;
  dealer: boolean;
  points: number;
  /** Points after each finished hand, then now: the nameplate's sparkline and the board's chart. */
  history: number[];
  riichi: boolean;
  turn: boolean;
  mood: Mood;
  /** A short badge: "Bot", "Away", "Offline". */
  tag: string | null;
  /** Epoch ms this seat's clock runs out, while it's their move on a timed table. */
  deadline: number | null;
};

/**
 * A hand. `tiles` is null when the viewer can't see it (only `count` backs are drawn). `drawn` sets the
 * last tile apart. `revealed` lays a shown hand down at the end; `win` is its winning tile, set apart
 * and lit (it is also the last of `tiles`).
 */
export type StageHand = { tiles: TileId[] | null; count: number; drawn: boolean; revealed: boolean; win: TileId | null };

export type StagePondTile = { id: TileId; sideways: boolean };

/**
 * A called set in the order its owner sees it, left to right. `called` is the index of the tile taken
 * from a discard (turned sideways), -1 for none; `added` is the tile a kakan stacked onto it; a closed
 * kan shows its two end tiles face down.
 */
export type StageMeld = { tiles: TileId[]; called: number; added: TileId | null; closed: boolean };

export type StageModel = {
  /** Changes with every new hand, so tiles reset to their places instead of flying across the table. */
  key: string;
  seats: StageSeat[];
  hands: StageHand[];
  melds: StageMeld[][];
  ponds: StagePondTile[][];
  /** Dora indicators showing, in order (the rest of the five slots lie face down). */
  dora: TileId[];
  /** Tiles left to draw. */
  wall: number;
  round: { label: string; honba: number; sticks: number };
  moment: Moment | null;
  /** The latest discard, lit softly. */
  last: TileId | null;
};

/** How your own hand looks right now (set by whoever handles the input). */
export type StageUi = {
  hover: TileId | null;
  selected: TileId | null;
  /** Your tiles drawn darker: can't be thrown now, or not the lesson's move. */
  dim: ReadonlySet<TileId> | null;
  /** Your tiles lit: the lesson's move. */
  glow: ReadonlySet<TileId> | null;
  /** Camera moves, shakes and tweens off (prefers-reduced-motion or calm mode). */
  reduced: boolean;
};

const blankSeat = (wind: string): StageSeat => ({ name: "", symbol: null, color: "#3fb8f5", wind, dealer: false, points: 25000, history: [25000], riichi: false, turn: false, mood: "idle", tag: null, deadline: null });

export const EMPTY_MODEL: StageModel = {
  key: "",
  seats: ["E", "S", "W", "N"].map(blankSeat),
  hands: [0, 1, 2, 3].map(() => ({ tiles: null, count: 0, drawn: false, revealed: false, win: null })),
  melds: [[], [], [], []],
  ponds: [[], [], [], []],
  dora: [],
  wall: 0,
  round: { label: "", honba: 0, sticks: 0 },
  moment: null,
  last: null,
};

export const EMPTY_UI: StageUi = { hover: null, selected: null, dim: null, glow: null, reduced: false };

type StageStore = {
  model: StageModel;
  ui: StageUi;
  setModel: (model: StageModel) => void;
  setUi: (ui: Partial<StageUi>) => void;
  reset: () => void;
};

/** One stage per page: the dev mock or a live table. */
export const useStageStore = create<StageStore>((set) => ({
  model: EMPTY_MODEL,
  ui: EMPTY_UI,
  setModel: (model) => set({ model }),
  setUi: (ui) => set((state) => (Object.keys(ui).every((key) => state.ui[key as keyof StageUi] === ui[key as keyof StageUi]) ? state : { ui: { ...state.ui, ...ui } })),
  reset: () => set({ model: EMPTY_MODEL, ui: EMPTY_UI }),
}));

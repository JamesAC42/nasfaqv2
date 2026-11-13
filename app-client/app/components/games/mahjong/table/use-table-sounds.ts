"use client";

import { useEffect, useRef } from "react";
import { motionOff } from "@/app/lib/games/mahjong/motion";
import { playCue } from "@/app/lib/games/mahjong/sound";
import { standingOf } from "@/app/lib/games/mahjong/table-model";
import { isSeatHand, type MahjongTable, type SeatIndex } from "@/app/lib/games/mahjong/types";

type Snap = {
  key: string;
  status: string;
  ponds: number[];
  melds: string[];
  riichi: number[];
  drawn: number | null;
  over: boolean;
  asked: boolean;
};

/**
 * Plays the table's cues from what changed between one shown state and the next (the state on screen,
 * so the sound lands with the motion). A reload or a first look plays nothing, apart from the start of
 * a fresh game. `your_turn` is only for the seat you hold; spectators hear the rest.
 */
export function useTableSounds(table: MahjongTable | null, mySeat: SeatIndex | null) {
  const before = useRef<Snap | null>(null);
  const timers = useRef(new Set<number>());

  useEffect(() => {
    const live = timers.current;
    return () => {
      live.forEach((timer) => window.clearTimeout(timer));
      live.clear();
    };
  }, []);

  useEffect(() => {
    const later = (ms: number, task: () => void) => {
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        task();
      }, ms);
      timers.current.add(timer);
    };
    if (!table) {
      before.current = null;
      return;
    }
    const game = table.game;
    const hand = game?.hand ?? null;
    const previous = before.current;

    // The whole game finishing.
    if (table.status === "done" && previous && previous.status !== "done") {
      const line = mySeat !== null ? standingOf(table.status === "done" ? table.result : null, mySeat) : null;
      playCue(line?.place === 1 ? "game_over_win" : "game_over");
    }

    if (!game || !hand) {
      before.current = { key: "", status: table.status, ponds: [], melds: [], riichi: [], drawn: null, over: false, asked: false };
      return;
    }

    const seatHand = isSeatHand(hand) ? hand : null;
    const options = seatHand && hand.phase !== "over" ? seatHand.options : null;
    const asked = mySeat !== null && options !== null;
    const now: Snap = {
      key: `${table.id}:${game.hand_index}`,
      status: table.status,
      ponds: hand.seats.map((seat) => seat.pond.length),
      melds: hand.seats.map((seat) => seat.melds.map((meld) => meld.type).join(",")),
      riichi: hand.seats.map((seat) => seat.riichi),
      drawn: seatHand?.drawn ?? null,
      over: hand.phase === "over",
      asked,
    };
    before.current = now;

    if (!previous) {
      // Walking up to a table that has just begun.
      if (!now.over && now.ponds.every((count) => count === 0) && now.melds.every((text) => text === "")) playCue("game_start");
      return;
    }
    if (previous.key !== now.key) {
      if (asked) later(150, () => playCue("your_turn"));
      return;
    }

    const threw = now.ponds.some((count, index) => count > (previous.ponds[index] ?? 0));
    const declared = now.riichi.some((state, index) => state > (previous.riichi[index] ?? 0));
    const called = now.melds.some((text, index) => text !== previous.melds[index]);
    const drewMine = now.drawn !== null && now.drawn !== previous.drawn;
    let delay = 0;

    if (drewMine) playCue("draw");
    if (threw) {
      playCue("discard");
      delay = 90;
    }
    if (declared) later(delay + 40, () => playCue("riichi"));
    else if (called) later(delay + 40, () => playCue("call"));

    if (now.over && !previous.over && hand.result) {
      const result = hand.result;
      if (result.type === "win") {
        const first = result.wins[0];
        later(delay + 120, () => playCue(first?.tsumo ? "tsumo" : "ron"));
        // With the reveal playing, it sounds its own result; without it, sound it here.
        if (motionOff()) {
          const big = result.wins.some((win) => win.yakuman > 0);
          const mid = result.wins.some((win) => win.limit !== null);
          later(delay + 600, () => playCue(big ? "yakuman" : mid ? "win_big" : "win_small"));
        }
      } else {
        later(delay + 120, () => playCue("draw_game"));
      }
    }

    if (asked && !previous.asked) later(delay + (drewMine ? 140 : 40), () => playCue("your_turn"));
  }, [table, mySeat]);
}

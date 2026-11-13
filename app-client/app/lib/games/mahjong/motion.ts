"use client";

import { useEffect, useRef, useState } from "react";
import { isSeatHand, type MahjongTable, type PublicHand } from "@/app/lib/games/mahjong/types";
import { isCalm } from "@/app/providers/motion-provider";

// Pacing and motion helpers for the live table. Nothing here changes what the server sends: it only
// decides when the page shows each push, and what changed between two shown hands.

/** True when motion should be skipped: the OS asks for reduced motion, or calm mode is on. */
export function motionOff() {
  if (typeof window === "undefined") return true;
  return isCalm() || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A pushed state stays on screen at least this long before the next queued one (ms). */
export const ACTION_GAP_MS = 320;
/** More queued than this and the display jumps to the newest instead of lagging behind. */
export const MAX_QUEUE = 3;

type Timed = MahjongTable;

/** Two states may be played one after the other: same table, same hand, same viewer, the hand moving on. */
function followsOn(from: Timed, to: Timed) {
  if (from.id !== to.id || from.status !== to.status) return false;
  const a = from.game?.hand;
  const b = to.game?.hand;
  if (!a || !b || from.game?.hand_index !== to.game?.hand_index) return false;
  if (isSeatHand(a) !== isSeatHand(b) || (isSeatHand(a) && isSeatHand(b) && a.seat !== b.seat)) return false;
  return b.seq >= a.seq;
}

/** The viewer is being asked something: nothing may delay it. */
function asksMe(table: Timed) {
  const hand = table.game?.hand;
  return Boolean(hand && isSeatHand(hand) && hand.options !== null && hand.phase !== "over");
}

/**
 * The table to draw. Pushes that arrive in a burst (a bot's draw, discard and the next bot's turn) are
 * shown one after another, at least ACTION_GAP_MS apart, so each can be seen. A single push shows at
 * once. The queue collapses to the newest state once it holds more than MAX_QUEUE, and a state that
 * asks the viewer for a move (or any change of table, seat or hand) is shown the moment it arrives.
 * With motion off there is no queue at all.
 */
export function useDisplayTable<T extends Timed>(live: T | null): T | null {
  const [shown, setShown] = useState<T | null>(live);
  const shownRef = useRef<T | null>(live);
  const queue = useRef<T[]>([]);
  const timer = useRef<number | null>(null);
  const shownAt = useRef(0);

  useEffect(() => {
    const show = (next: T | null) => {
      shownRef.current = next;
      shownAt.current = performance.now();
      setShown(next);
    };
    const stop = () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
    const jump = (next: T | null) => {
      stop();
      queue.current = [];
      show(next);
    };
    const step = () => {
      timer.current = null;
      const next = queue.current.shift();
      if (next) show(next);
      if (queue.current.length) schedule();
    };
    function schedule() {
      if (timer.current !== null) return;
      timer.current = window.setTimeout(step, Math.max(0, ACTION_GAP_MS - (performance.now() - shownAt.current)));
    }

    if (!live) return jump(null);
    const base = queue.current.length ? queue.current[queue.current.length - 1] : shownRef.current;
    if (live === base) return;
    if (!base || motionOff() || !followsOn(base, live) || asksMe(live)) return jump(live);
    if (live.server_time === base.server_time) {
      // The same moment again (an HTTP answer after its push): swap it in place.
      if (queue.current.length) queue.current[queue.current.length - 1] = live;
      else show(live);
      return;
    }
    if (live.server_time < base.server_time) return;
    queue.current.push(live);
    if (queue.current.length > MAX_QUEUE) return jump(live);
    schedule();
  }, [live]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return shown ?? live;
}

/**
 * The hand as it was one shown state ago (null on the first, or when the hand changed to another one).
 * Computed while rendering, so what is "fresh" is known before the first paint of the new state.
 */
export function usePrevHand(hand: PublicHand | null, key: string): PublicHand | null {
  const [pair, setPair] = useState<{ key: string; hand: PublicHand | null; prev: PublicHand | null }>({ key, hand, prev: null });
  if (pair.hand !== hand || pair.key !== key) {
    const prev = pair.key === key && pair.hand && hand ? pair.hand : null;
    setPair({ key, hand, prev });
    return prev;
  }
  return pair.prev;
}

/** The highest pond number a seat had in the earlier state; Infinity when there was no earlier state (nothing is fresh). */
export function pondMark(prev: PublicHand | null, seat: number) {
  if (!prev) return Infinity;
  const pond = prev.seats[seat]?.pond ?? [];
  return pond.length ? pond[pond.length - 1].n : -1;
}

/** Where a throw started (the lifted tile in your hand), noted for a moment so the pond can fly it from there. */
let thrown: { x: number; y: number; at: number } | null = null;
export const noteThrow = (x: number, y: number) => {
  thrown = { x, y, at: performance.now() };
};
export function takeThrow() {
  const found = thrown && performance.now() - thrown.at < 4000 ? thrown : null;
  thrown = null;
  return found;
}

"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { motionOff } from "@/app/lib/games/mahjong/motion";
import styles from "@/app/components/games/mahjong/table/table-board.module.scss";

export type Point = { x: number; y: number };

/** The middle of the first element that matches, or null. */
export function centerOf(selector: string): Point | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (!box.width && !box.height) return null;
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

type FlyKind = "discard" | "riichi" | "meld";
const DURATION: Record<FlyKind, number> = { discard: 240, riichi: 320, meld: 340 };

/**
 * Wraps something that has just arrived. When `fresh`, it travels from `from` (a screen point: the hand
 * it was thrown out of, the pond tile that was called) to where it now sits, using transform and
 * opacity only. Without a start point it just settles into place. Does nothing under reduced motion or
 * calm mode. It adds no space of its own and never changes layout, so the hand dock cannot jump.
 */
export function Fly({ fresh, kind, from, children, ...data }: { fresh: boolean; kind: FlyKind; from?: () => Point | null; children: ReactNode; "data-tile"?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const fromRef = useRef(from);
  useLayoutEffect(() => {
    fromRef.current = from;
  });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!fresh || !element || typeof element.animate !== "function" || motionOff()) return;
    const box = element.getBoundingClientRect();
    const origin = fromRef.current?.() ?? null;
    const turn = kind === "riichi" ? " rotate(-90deg)" : "";
    const frames: Keyframe[] = origin
      ? [
          { transform: `translate(${Math.round(origin.x - (box.left + box.width / 2))}px, ${Math.round(origin.y - (box.top + box.height / 2))}px) scale(1.3)${turn}`, opacity: 0.85, zIndex: 6 },
          { transform: "none", opacity: 1, zIndex: 6 },
        ]
      : [
          { transform: `translateY(-14px) scale(0.8)${turn}`, opacity: 0, zIndex: 6 },
          { transform: "none", opacity: 1, zIndex: 6 },
        ];
    const animation = element.animate(frames, { duration: DURATION[kind], easing: "cubic-bezier(0.2, 0.85, 0.3, 1)" });
    return () => animation.cancel();
  }, [fresh, kind]);
  return (
    <span ref={ref} className={styles.fly} {...data}>
      {children}
    </span>
  );
}

"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Tile } from "@/app/components/games/mahjong/tile";
import { useElementWidth } from "@/app/components/games/mahjong/table/board";
import { motionOff, noteThrow } from "@/app/lib/games/mahjong/motion";
import { playCue } from "@/app/lib/games/mahjong/sound";
import { tileName, type TileId } from "@/app/lib/games/mahjong/tiles";
import { edgeOf, marksOf, marksSpoken, TileMarks } from "@/app/components/games/mahjong/table/hand-marks";
import styles from "@/app/components/games/mahjong/table/table-board.module.scss";

export type TileMark = "ready" | "best" | "lesson";

export type MyHandProps = {
  tiles: TileId[];
  drawn: TileId | null;
  /** Tiles you may discard right now (empty when it isn't your turn). */
  allowed: ReadonlySet<TileId>;
  /** On your turn: the tiles that can't be picked are grayed. */
  turn: boolean;
  selected: TileId | null;
  onSelect: (id: TileId | null) => void;
  /** The tile was picked (twice, or once with the single-tap setting). */
  onDiscard: (id: TileId) => void;
  singleTap: boolean;
  marks: ReadonlyMap<TileId, TileMark>;
  /** Tutorial: gray everything but the move the lesson wants. */
  fade?: (id: TileId) => boolean;
  label: string;
  /** The table says the hand is waiting on a tile: it glows softly. */
  ready?: boolean;
  /** Your seat: where your discards fly out from. */
  seat?: number;
  /** Tiles that are certainly safe against every riichi at the table (coached tables). */
  safe?: ReadonlySet<TileId>;
};

const MAX_TILE = 52;

/**
 * How your hand answers input, shared by the flat hand and the 3D table's tile buttons: tap to lift,
 * tap again (or once, with the one-tap setting) to throw; arrow keys, Home and End move between the
 * tiles you may throw; nothing stays lifted once it can no longer be thrown.
 */
export function useHandPress({ allowed, selected, onSelect, onDiscard, singleTap }: Pick<MyHandProps, "allowed" | "selected" | "onSelect" | "onDiscard" | "singleTap">) {
  useEffect(() => {
    if (selected !== null && !allowed.has(selected)) onSelect(null);
  }, [allowed, onSelect, selected]);

  const press = (id: TileId, element: HTMLElement) => {
    if (!allowed.has(id)) return;
    if (singleTap || selected === id) {
      const box = element.getBoundingClientRect();
      noteThrow(box.left + box.width / 2, box.top + box.height / 2);
      onDiscard(id);
    } else {
      playCue("ui_click");
      onSelect(id);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = at;
    if (event.key === "ArrowLeft") next = at <= 0 ? 0 : at - 1;
    else if (event.key === "ArrowRight") next = at < 0 ? 0 : Math.min(buttons.length - 1, at + 1);
    else if (event.key === "Home") next = 0;
    else next = buttons.length - 1;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return { press, onKeyDown };
}

/** Your concealed tiles, with the tile you just drew set apart. Tap to lift, tap again to discard. */
export function MyHand({ tiles, drawn, allowed, turn, selected, onSelect, onDiscard, singleTap, marks, fade, label, ready, seat, safe }: MyHandProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const rowRef = useRef<HTMLDivElement | null>(null);

  // The tile just drawn slides in (known while rendering, so it never flashes in place first).
  const [drawPair, setDrawPair] = useState({ drawn, before: drawn });
  if (drawPair.drawn !== drawn) setDrawPair({ drawn, before: drawPair.drawn });
  const newDraw = drawn !== null && drawPair.drawn === drawn && drawPair.before !== drawn ? drawn : null;

  // When tiles change places (a draw settles into the hand, a gap closes), each one glides from where it was.
  const lefts = useRef(new Map<number, number>());
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const next = new Map<number, number>();
    const animate = !motionOff();
    row.querySelectorAll<HTMLElement>("[data-id]").forEach((element) => {
      const id = Number(element.dataset.id);
      const left = element.offsetLeft; // layout position: a running transform does not move it
      next.set(id, left);
      const before = lefts.current.get(id);
      if (animate && before !== undefined && Math.abs(before - left) > 1 && !element.hasAttribute("data-new") && typeof element.animate === "function") {
        element.animate([{ transform: `translateX(${Math.round(before - left)}px)` }, { transform: "none" }], { duration: 170, easing: "cubic-bezier(0.2, 0.85, 0.3, 1)" });
      }
    });
    lefts.current = next;
  });
  const count = tiles.length + (drawn !== null ? 1 : 0);
  // One gap between neighbors, plus a wider one before the drawn tile.
  const size = width ? Math.max(18, Math.min(MAX_TILE, Math.floor((width - 2 * count - 12) / Math.max(count, 1)))) : 24;

  const { press, onKeyDown } = useHandPress({ allowed, selected, onSelect, onDiscard, singleTap });

  const render = (id: TileId, apart: boolean, index: number) => {
    const can = allowed.has(id);
    const mark = marks.get(id);
    const kinds = marksOf(id, marks, safe);
    const faded = (turn && !can) || (fade ? fade(id) : false);
    return (
      <span key={id} className={styles.slot} data-id={id} data-new={newDraw === id || undefined} data-apart={apart || undefined} data-mark={mark} data-mark-host={kinds.length ? "" : undefined} data-lifted={selected === id || undefined} style={apart ? { marginLeft: Math.round(size * 0.45) } : undefined}>
        <Tile id={id} size={size} dim={faded} selected={selected === id} onClick={can ? (event) => press(id, event.currentTarget) : undefined} disabled={!can} highlight={mark === "lesson"} title={kinds.length ? `${tileName(id)}: ${marksSpoken(kinds)}` : undefined} />
        <TileMarks kinds={kinds} edge={edgeOf(index, count)} />
      </span>
    );
  };

  return (
    <div ref={ref} className={styles.hand} role="group" aria-label={label} onKeyDown={onKeyDown} data-turn={turn || undefined} data-ready={ready || undefined}>
      <div ref={rowRef} className={styles.handRow} data-fly-src={seat}>
        {tiles.map((id, index) => render(id, false, index))}
        {drawn !== null ? render(drawn, true, tiles.length) : null}
      </div>
    </div>
  );
}

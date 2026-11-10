"use client";

import { useEffect, type KeyboardEvent } from "react";
import { Tile } from "@/app/components/games/mahjong/tile";
import { useElementWidth } from "@/app/components/games/mahjong/table/board";
import type { TileId } from "@/app/lib/games/mahjong/tiles";
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
};

const MAX_TILE = 52;

/** Your concealed tiles, with the tile you just drew set apart. Tap to lift, tap again to discard. */
export function MyHand({ tiles, drawn, allowed, turn, selected, onSelect, onDiscard, singleTap, marks, fade, label }: MyHandProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const count = tiles.length + (drawn !== null ? 1 : 0);
  // One gap between neighbors, plus a wider one before the drawn tile.
  const size = width ? Math.max(18, Math.min(MAX_TILE, Math.floor((width - 2 * count - 12) / Math.max(count, 1)))) : 24;

  // Nothing stays lifted once it can no longer be discarded (the turn moved on).
  useEffect(() => {
    if (selected !== null && !allowed.has(selected)) onSelect(null);
  }, [allowed, onSelect, selected]);

  const press = (id: TileId) => {
    if (!allowed.has(id)) return;
    if (singleTap || selected === id) onDiscard(id);
    else onSelect(id);
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

  const render = (id: TileId, apart: boolean) => {
    const can = allowed.has(id);
    const mark = marks.get(id);
    const faded = (turn && !can) || (fade ? fade(id) : false);
    return (
      <span key={id} className={styles.slot} data-apart={apart || undefined} data-mark={mark} data-lifted={selected === id || undefined} style={apart ? { marginLeft: Math.round(size * 0.45) } : undefined}>
        <Tile id={id} size={size} dim={faded} selected={selected === id} onClick={can ? () => press(id) : undefined} disabled={!can} highlight={mark === "lesson"} />
        {mark === "ready" ? <i className={styles.markReady} aria-label="Leaves you ready" /> : null}
        {mark === "best" ? <i className={styles.markBest} aria-label="Coach's pick" /> : null}
      </span>
    );
  };

  return (
    <div ref={ref} className={styles.hand} role="group" aria-label={label} onKeyDown={onKeyDown} data-turn={turn || undefined}>
      <div className={styles.handRow}>
        {tiles.map((id) => render(id, false))}
        {drawn !== null ? render(drawn, true) : null}
      </div>
    </div>
  );
}

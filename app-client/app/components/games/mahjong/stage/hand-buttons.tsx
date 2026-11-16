"use client";

// Your hand on the 3D table, as real buttons: one invisible button pinned over each of your tiles in
// the canvas (scene-tiles writes their boxes every frame). They take the same props as the flat hand
// and answer the same way (useHandPress): tap to lift, tap again to throw, arrow keys between tiles, a
// focus ring around the tile, the tile's name for a screen reader, Help's marks under it. Pointing at a
// tile, or focusing it, raises it a little in the scene; the lifted tile rises further.

import { useEffect, useMemo, type CSSProperties } from "react";
import { useHandPress, type MyHandProps } from "@/app/components/games/mahjong/table/my-hand";
import { handKey, registerOverlay } from "@/app/components/games/mahjong/stage/overlay";
import { useStageStore } from "@/app/components/games/mahjong/stage/model";
import { edgeOf, marksOf, marksSpoken, TileMarks } from "@/app/components/games/mahjong/table/hand-marks";
import { tileName, type TileId } from "@/app/lib/games/mahjong/tiles";
import styles from "@/app/components/games/mahjong/stage/stage.module.scss";

export function HandButtons({ tiles, drawn, allowed, turn, selected, onSelect, onDiscard, singleTap, marks, fade, label, ready, safe }: MyHandProps) {
  const { press, onKeyDown } = useHandPress({ allowed, selected, onSelect, onDiscard, singleTap });
  const setUi = useStageStore((s) => s.setUi);
  const laidDown = useStageStore((s) => s.model.hands[0]?.revealed ?? false);
  const all = useMemo(() => (drawn !== null ? [...tiles, drawn] : tiles), [tiles, drawn]);

  // What the scene shows of your hand: the lifted tile, the grayed ones, the lesson's lit ones.
  const dim = useMemo(() => new Set(all.filter((id) => (turn && !allowed.has(id)) || (fade ? fade(id) : false))), [all, allowed, turn, fade]);
  const glow = useMemo(() => new Set(all.filter((id) => marks.get(id) === "lesson")), [all, marks]);
  useEffect(() => {
    setUi({ selected, dim, glow });
  }, [selected, dim, glow, setUi]);
  useEffect(() => () => setUi({ selected: null, dim: null, glow: null, hover: null }), [setUi]);

  if (laidDown) return null;

  const button = (id: TileId, index: number) => {
    const can = allowed.has(id);
    const kinds = marksOf(id, marks, safe);
    const lifted = selected === id;
    return (
      <button
        key={id}
        ref={(el) => registerOverlay(handKey(id), el)}
        type="button"
        className={styles.handKey}
        data-lifted={lifted || undefined}
        data-mark-host={kinds.length ? "" : undefined}
        disabled={!can}
        aria-label={`${tileName(id)}${id === drawn ? ", just drawn" : ""}${kinds.length ? `: ${marksSpoken(kinds)}` : ""}`}
        aria-pressed={lifted || undefined}
        onClick={(event) => press(id, event.currentTarget)}
        onPointerEnter={() => setUi({ hover: id })}
        onPointerLeave={() => setUi({ hover: null })}
        onFocus={() => setUi({ hover: id })}
        onBlur={() => setUi({ hover: null })}
      >
        <TileMarks kinds={kinds} edge={edgeOf(index, all.length)} />
      </button>
    );
  };

  return (
    <div className={styles.handKeys} role="group" aria-label={label} onKeyDown={onKeyDown} data-turn={turn || undefined} data-ready={ready || undefined} style={{ "--hand-tiles": all.length } as CSSProperties}>
      {all.map(button)}
    </div>
  );
}

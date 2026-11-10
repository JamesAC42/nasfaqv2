"use client";

import { useMemo, type CSSProperties, type MouseEventHandler } from "react";
import { tileBackSvgElement, tileIdSvg, tileSvg, tileSvgElement, TILE_COLORS, type TileSvgOptions } from "@/app/components/games/mahjong/tile-art";
import { useTileLabels } from "@/app/lib/games/mahjong/tile-settings";
import { isRedFive, kindName, kindOf, relativeSeat, tileName, tilesFrom, type TileId, type TileKind } from "@/app/lib/games/mahjong/tiles";
import type { ExampleCall, YakuExample } from "@/app/lib/games/mahjong/yaku";
import type { Meld, MeldType } from "@/app/lib/games/mahjong/types";
import styles from "@/app/components/games/mahjong/tile.module.scss";

// The tile set (drawn in tile-art.ts). Server components that need a tile as a string (share cards)
// import `tileSvg` from tile-art directly; it is re-exported here for client code.
export { tileSvg, tileSvgElement, tileIdSvg, TILE_COLORS };
export type { TileSvgOptions };

export type TileProps = {
  /** A tile id 0-135 (a red five is known by its id). Give this or `kind`. */
  id?: TileId;
  /** A tile kind 0-33. */
  kind?: TileKind;
  /** With `kind`: a red five. */
  red?: boolean;
  /** Width in px. Height is 4/3 of it. Default 36. */
  size?: number;
  /** Small corner label. Default: the player's setting (on unless they turned it off). */
  labels?: boolean;
  /** Show the back (a tile in an opponent's hand, a wall tile). */
  faceDown?: boolean;
  /** Back color: the seat's talent color. */
  tint?: string | null;
  /** On its side: a tile taken in a call, a riichi discard. The box is then 4/3 wide. */
  rotated?: boolean;
  /** Grayed: a tile that was called away, or can't be picked. */
  dim?: boolean;
  /** A blue ring: the tile just discarded, a wait, a hint. */
  highlight?: boolean;
  /** Raised: picked to discard. */
  selected?: boolean;
  /** Makes the tile a button. */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Accessible name; defaults to the tile's name ("Red 5 of circles"). */
  title?: string;
};

const DEFAULT_SIZE = 36;

function resolve(props: Pick<TileProps, "id" | "kind" | "red">): { kind: TileKind; red: boolean } {
  if (props.id !== undefined) return { kind: kindOf(props.id), red: isRedFive(props.id) };
  return { kind: props.kind ?? 0, red: Boolean(props.red) };
}

/** One tile. Static unless `onClick` is given. */
export function Tile(props: TileProps) {
  const { size = DEFAULT_SIZE, faceDown = false, tint, rotated = false, dim, highlight, selected, onClick, disabled, className, style, title } = props;
  const [labelsSetting] = useTileLabels();
  const labels = props.labels ?? labelsSetting;
  const { kind, red } = resolve(props);
  const art = useMemo(() => {
    const options: TileSvgOptions = { size, red, labels, rotated, tint };
    return faceDown ? tileBackSvgElement({ size, rotated, tint }) : tileSvgElement(kind, options);
  }, [kind, red, size, labels, rotated, tint, faceDown]);
  const name = title ?? (faceDown ? "Face-down tile" : props.id !== undefined ? tileName(props.id) : red ? `Red ${kindName(kind)}` : kindName(kind));
  const width = rotated ? (size * 4) / 3 : size;
  const height = rotated ? size : (size * 4) / 3;
  const classes = [styles.tile, onClick ? styles.button : null, rotated ? styles.rotated : null, dim ? styles.dim : null, highlight ? styles.highlight : null, selected ? styles.selected : null, className].filter(Boolean).join(" ");
  const box = { width, height, ...(tint ? ({ "--tile-tint": tint } as CSSProperties) : null), ...style } as CSSProperties;
  if (onClick) {
    return (
      <button type="button" className={classes} style={box} onClick={onClick} disabled={disabled} aria-label={name} aria-pressed={selected || undefined} data-kind={kind}>
        {art}
      </button>
    );
  }
  return (
    <span className={classes} style={box} role="img" aria-label={name} data-kind={kind}>
      {art}
    </span>
  );
}

/** A tile back. */
export function TileBack(props: Omit<TileProps, "id" | "kind" | "red" | "faceDown" | "labels">) {
  return <Tile {...props} faceDown />;
}

// ── Rows and melds ──────────────────────────────────────────────────────────
export type RowMeld = {
  /** The set's tiles (4 for a kan; for a kakan the added tile is last). */
  tiles: TileId[];
  type?: MeldType;
  /** Index of the tile that lies sideways (taken from another player). None for a closed kan. */
  called?: number;
};

type CommonRow = { size?: number; labels?: boolean; dim?: boolean; className?: string };

/** A called set: the taken tile lies sideways, a closed kan has its end tiles face down, a kakan stacks one tile on another. */
export function TileMeld({ tiles, type = "pon", called, size = 30, labels, dim, tint }: RowMeld & CommonRow & { tint?: string | null }) {
  if (type === "ankan") {
    return (
      <span className={styles.meld}>
        {tiles.map((id, index) => (
          <Tile key={index} id={id} size={size} labels={labels} dim={dim} faceDown={index === 0 || index === tiles.length - 1} tint={tint} />
        ))}
      </span>
    );
  }
  const at = called ?? 0;
  if (type === "kakan" && tiles.length === 4) {
    const base = tiles.slice(0, 3);
    const added = tiles[3];
    return (
      <span className={styles.meld}>
        {base.map((id, index) =>
          index === at ? (
            <span key={index} className={styles.stack}>
              <Tile id={added} size={size} labels={labels} dim={dim} rotated />
              <Tile id={id} size={size} labels={labels} dim={dim} rotated />
            </span>
          ) : (
            <Tile key={index} id={id} size={size} labels={labels} dim={dim} />
          )
        )}
      </span>
    );
  }
  return (
    <span className={styles.meld}>
      {tiles.map((id, index) => (
        <Tile key={index} id={id} size={size} labels={labels} dim={dim} rotated={index === at} />
      ))}
    </span>
  );
}

/**
 * A meld from the table payload, drawn with the taken tile sideways at the place it came from:
 * leftmost if it came from the player before `owner`, middle from across, rightmost from the player after.
 */
export function PublicMeld({ meld, owner, size, labels, dim }: { meld: Meld; owner: number } & CommonRow) {
  if (meld.type === "ankan" || meld.called === null) return <TileMeld tiles={meld.tiles} type={meld.type} size={size} labels={labels} dim={dim} />;
  const called = meld.called;
  const base = meld.type === "kakan" && meld.added !== null ? meld.tiles.filter((id) => id !== meld.added) : meld.tiles;
  const rel = meld.from === null ? 3 : relativeSeat(meld.from, owner);
  // Chi is always from the previous seat. Otherwise: previous seat (3) left, across (2) middle, next seat (1) right.
  const place = meld.type === "chi" || rel === 3 ? 0 : rel === 2 ? 1 : base.length - 1;
  const arranged = base.filter((id) => id !== called);
  arranged.splice(Math.min(place, arranged.length), 0, called);
  const tiles = meld.type === "kakan" && meld.added !== null ? [...arranged, meld.added] : arranged;
  return <TileMeld tiles={tiles} type={meld.type} called={place} size={size} labels={labels} dim={dim} />;
}

export type TileRowProps = CommonRow & {
  /** The concealed tiles, as ids. */
  tiles?: TileId[];
  /** Or as notation: "123m406p11z". */
  notation?: string;
  /** Called sets, shown after the tiles. */
  melds?: RowMeld[];
  /** The winning tile, set apart. */
  win?: TileId;
  /** Put a gap after these tile indexes (to show sets: [2, 5, 8]). */
  gapAfter?: number[];
  /** Highlight these tile kinds. */
  highlightKinds?: TileKind[];
};

/** A static hand: for guides, results and share cards. */
export function TileRow({ tiles, notation, melds, win, gapAfter = [], highlightKinds, size = 30, labels, dim, className }: TileRowProps) {
  const ids = useMemo(() => tiles ?? (notation ? tilesFrom(notation) : []), [tiles, notation]);
  const runs: TileId[][] = [];
  let run: TileId[] = [];
  ids.forEach((id, index) => {
    run.push(id);
    if (gapAfter.includes(index)) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length) runs.push(run);
  return (
    <span className={[styles.row, className].filter(Boolean).join(" ")}>
      {runs.map((part, index) => (
        <span key={index} className={styles.run}>
          {part.map((id, at) => (
            <Tile key={at} id={id} size={size} labels={labels} dim={dim} highlight={highlightKinds?.includes(kindOf(id))} />
          ))}
        </span>
      ))}
      {melds?.map((meld, index) => (
        <TileMeld key={`m${index}`} {...meld} size={size} labels={labels} dim={dim} />
      ))}
      {win !== undefined ? (
        <span className={styles.win}>
          <Tile id={win} size={size} labels={labels} dim={dim} highlight />
        </span>
      ) : null}
    </span>
  );
}

/** The pieces of a TileRow for a yaku example (guides): `<TileRow {...rowFromExample(example)} />`. */
export function rowFromExample(example: YakuExample): Pick<TileRowProps, "tiles" | "melds" | "win"> {
  const used = new Set<TileId>();
  const calls: ExampleCall[] = example.calls ?? [];
  const melds: RowMeld[] = calls.map((call) => ({ tiles: tilesFrom(call.tiles, used), type: call.type, called: call.called }));
  const tiles = tilesFrom(example.hand, used);
  const [win] = tilesFrom(example.win, used);
  return { tiles, melds, win };
}

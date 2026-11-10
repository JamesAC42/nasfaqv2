"use client";

import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PublicMeld, Tile, TileBack } from "@/app/components/games/mahjong/tile";
import { SeatPortrait, type SeatStyle } from "@/app/components/games/mahjong/table/seat-portrait";
import type { ChibiPose } from "@/app/lib/art-manifest";
import { useRemaining } from "@/app/lib/games/use-remaining";
import { windLetter, windName } from "@/app/lib/games/mahjong/tiles";
import { RANK_NAMES, SIDES, points, seatLabel, seatsBySide, type Side } from "@/app/lib/games/mahjong/table-model";
import type { GameView, MahjongTable, PondEntry, PublicHand, PublicSeat, SeatIndex } from "@/app/lib/games/mahjong/types";
import styles from "@/app/components/games/mahjong/table/table-board.module.scss";

/** The width of an element, kept current. Zero until the first measure. */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(Math.floor(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(() => setWidth(Math.floor(element.getBoundingClientRect().width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export type Callout = { id: number; seat: SeatIndex; text: string; tone: "call" | "win" | "riichi" };

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const chunk = <T,>(items: readonly T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

/**
 * Pond tile width for a board this wide. Across the middle: a pond three columns wide on each side of
 * the center box (columns of six), and the top and bottom ponds six across over it.
 */
export function pondSize(width: number) {
  if (width <= 0) return 18;
  const narrow = (width - 164) / 6.68;
  const wide = (width - 24) / 13.08;
  return clamp(Math.floor(narrow <= 21.9 ? narrow : wide), 14, 28);
}

// ── One discard pond: lines of six, a riichi tile on its side, called tiles dimmed ───────────────
// Faces stay upright for every seat. The lines grow away from the center box, and each seat's tiles
// flow the way that seat reads them (top and right seats run backwards on screen).
const Pond = memo(function Pond({ entries, ps, lastTile, side }: { entries: PondEntry[]; ps: number; lastTile: number | null; side: Side }) {
  const lines = chunk(entries, 6);
  const vertical = side === "left" || side === "right";
  return (
    <div className={styles.pond} data-side={side} style={{ [vertical ? "minWidth" : "minHeight"]: vertical ? Math.round(ps * 3) : Math.round(ps * 4) } as CSSProperties} aria-label="Discards">
      {lines.map((line, index) => (
        <div key={index} className={styles.pondLine}>
          {line.map((entry) => (
            <Tile key={entry.n} id={entry.tile} size={ps} labels={ps >= 21 ? undefined : false} rotated={entry.riichi} dim={entry.called} highlight={entry.tile === lastTile} />
          ))}
        </div>
      ))}
    </div>
  );
});

// ── A name plate: portrait, name, badges ──────────────────────────────────────────────────────────
function PlateClock({ deadline }: { deadline: number }) {
  const left = useRemaining(deadline, 250);
  if (left === null) return null;
  return (
    <span className={styles.plateClock} data-urgent={left <= 5000 || undefined} role="timer">
      {Math.ceil(left / 1000)}s
    </span>
  );
}

function SeatPlate({
  seat,
  hand,
  seatIndex,
  style,
  pose,
  size,
  isMe,
  deadline,
  cheers,
  score,
}: {
  seat: PublicSeat | null;
  hand: PublicHand;
  seatIndex: SeatIndex;
  style: SeatStyle;
  pose: ChibiPose;
  size: number;
  isMe: boolean;
  deadline: number | null;
  cheers: number;
  score?: boolean;
}) {
  const info = hand.seats[seatIndex];
  const dealer = hand.dealer === seatIndex;
  const turn = hand.turn === seatIndex;
  const rank = seat?.rank ? RANK_NAMES[seat.rank] : null;
  return (
    <div className={styles.plate} data-turn={turn || undefined} data-me={isMe || undefined} style={{ "--tal": style.color } as CSSProperties}>
      <SeatPortrait seat={seat} pose={pose} size={size} color={style.color} />
      <div className={styles.plateText}>
        <span className={styles.plateName}>
          <b title={seat ? seatLabel(seat) : undefined}>{seatLabel(seat)}</b>
          {isMe ? <em>you</em> : null}
        </span>
        <span className={styles.plateMeta}>
          <i className={styles.wind} data-dealer={dealer || undefined} title={`${windName(info.wind)} seat${dealer ? ", dealer" : ""}`}>
            {windLetter(info.wind)}
          </i>
          {score ? <span className={styles.plateScore}>{points(hand.scores[seatIndex])}</span> : null}
          {seat?.bot ? <span className={styles.badge}>Bot</span> : null}
          {seat && !seat.bot && seat.away ? <span className={styles.badge} data-warn="">Away</span> : null}
          {seat && !seat.bot && !seat.connected && !seat.away ? <span className={styles.badge} data-warn="">Offline</span> : null}
          {info.riichi ? <span className={styles.riichi} title={info.riichi === 2 ? "Double riichi" : "Riichi"}><i aria-hidden="true" />{info.riichi === 2 ? "W" : ""}</span> : null}
          {rank && !seat?.bot ? <span className={styles.rank}>{rank}</span> : null}
          {seat && seat.rating !== null && !seat.bot ? <span className={styles.rating}>{seat.rating}</span> : null}
          {cheers > 0 ? <span className={styles.cheers} title="Cheers from the rail">{cheers}</span> : null}
          {deadline ? <PlateClock deadline={deadline} /> : null}
        </span>
      </div>
    </div>
  );
}

// ── The center box ────────────────────────────────────────────────────────────────────────────────
function CenterBox({ hand, game, bottom, ps }: { hand: PublicHand; game: GameView; bottom: SeatIndex; ps: number }) {
  const sides = seatsBySide(bottom);
  const dora = [...hand.dora];
  const slots = Array.from({ length: 5 }, (_, index) => dora[index] ?? null);
  const small = Math.max(11, Math.round(ps * 0.78));
  return (
    <div className={styles.center} aria-label="Table information">
      <div className={styles.centerTop}>
        <b className={styles.round}>{game.label}</b>
        <span className={styles.counters}>
          <span title="Honba: counter that adds 300 to a win">
            <i className={styles.honba} aria-hidden="true" />
            {hand.honba}
          </span>
          <span title="Riichi sticks on the table: the next winner takes them">
            <i className={styles.stickIcon} aria-hidden="true" />
            {hand.sticks}
          </span>
          <span title="Tiles left to draw" className={styles.left}>
            <small>left</small> {hand.remaining}
          </span>
        </span>
      </div>
      <div className={styles.dora} aria-label="Dora indicators">
        {slots.map((id, index) => (id === null ? <TileBack key={index} size={small} /> : <Tile key={index} id={id} size={small} labels={false} />))}
      </div>
      <div className={styles.compass} role="list" aria-label="Scores">
        {SIDES.map((side) => {
          const seat = sides[side];
          const info = hand.seats[seat];
          return (
            <span key={side} role="listitem" className={styles.cell} data-side={side} data-turn={hand.turn === seat || undefined} data-dealer={hand.dealer === seat || undefined}>
              <i>{windLetter(info.wind)}</i>
              <b>{points(hand.scores[seat])}</b>
            </span>
          );
        })}
      </div>
    </div>
  );
}

// ── The board ─────────────────────────────────────────────────────────────────────────────────────
export type BoardProps = {
  table: MahjongTable;
  game: GameView;
  hand: PublicHand;
  bottom: SeatIndex;
  me: SeatIndex | null;
  seatStyles: SeatStyle[];
  poses: Record<number, ChibiPose>;
  callouts: Callout[];
  /** The bottom seat's melds, drawn beside its name plate at the size given. */
  mineMelds?: (size: number) => ReactNode;
  floaters?: ReactNode;
};

export function Board({ table, game, hand, bottom, me, seatStyles, poses, callouts, mineMelds, floaters }: BoardProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const ps = pondSize(width);
  const sides = seatsBySide(bottom);
  const lastTile = hand.last_discard?.tile ?? null;
  const plateSize = clamp(Math.round(ps * 1.5), 28, 46);
  const back = Math.max(6, Math.floor((ps * 4) / 9));
  const meldSize = Math.max(11, Math.round(ps * 0.62));
  const centerWidth = clamp(Math.floor(width - 24 - ps * 6.8), 140, 340);
  const deadlineOf = (seat: SeatIndex) => (table.clock?.phase === "turn" && table.speed !== "untimed" ? (table.clock.seats.find((entry) => entry.seat === seat)?.deadline ?? null) : null);

  // A seat's plate, the backs of its hand and its melds.
  const info = (side: Exclude<Side, "bottom">) => {
    const seatIndex = sides[side];
    const seatInfo = hand.seats[seatIndex];
    const style = seatStyles[seatIndex];
    const concealed = seatInfo.has_drawn ? seatInfo.count - 1 : seatInfo.count;
    return (
      <div className={styles.seatInfo} data-side={side}>
        <SeatPlate seat={table.seats[seatIndex]} hand={hand} seatIndex={seatIndex} style={style} pose={poses[seatIndex] ?? "idle"} size={plateSize} isMe={false} deadline={deadlineOf(seatIndex)} cheers={table.cheers[seatIndex] ?? 0} />
        <div className={styles.backs} aria-label={`${seatInfo.count} tiles in hand`}>
          {Array.from({ length: concealed }, (_, index) => (
            <TileBack key={index} size={back} tint={style.color} />
          ))}
          {seatInfo.has_drawn ? <TileBack size={back} tint={style.color} style={{ marginLeft: Math.round(back * 0.5) }} /> : null}
        </div>
        {seatInfo.melds.length ? (
          <div className={styles.melds}>
            {seatInfo.melds.map((meld, index) => (
              <PublicMeld key={index} meld={meld} owner={seatIndex} size={meldSize} labels={false} />
            ))}
          </div>
        ) : null}
      </div>
    );
  };
  const pond = (side: Side) => {
    const seatIndex = sides[side];
    return <Pond entries={hand.seats[seatIndex].pond} ps={ps} lastTile={hand.last_discard?.seat === seatIndex ? lastTile : null} side={side} />;
  };

  const mine = sides.bottom;
  const myInfo = hand.seats[mine];
  return (
    <section ref={ref} className={styles.board} style={{ "--ps": `${ps}px`, "--cw": `${centerWidth}px` } as CSSProperties} aria-label="Table">
      <div className={styles.corner} data-side="left">
        {info("left")}
      </div>
      <div className={styles.topCol}>
        {info("top")}
        {pond("top")}
      </div>
      <div className={styles.corner} data-side="right">
        {info("right")}
      </div>
      <div className={styles.sidePond} data-side="left">
        {pond("left")}
      </div>
      <CenterBox hand={hand} game={game} bottom={bottom} ps={ps} />
      <div className={styles.sidePond} data-side="right">
        {pond("right")}
      </div>
      <div className={styles.bottomPond}>{pond("bottom")}</div>
      <div className={styles.mineRow}>
        <SeatPlate seat={table.seats[mine]} hand={hand} seatIndex={mine} style={seatStyles[mine]} pose={poses[mine] ?? "idle"} size={plateSize} isMe={me === mine} deadline={me === mine ? null : deadlineOf(mine)} cheers={table.cheers[mine] ?? 0} score />
        {myInfo.melds.length && mineMelds ? <div className={styles.mineMelds}>{mineMelds(Math.max(20, meldSize + 8))}</div> : null}
      </div>
      <CalloutLayer callouts={callouts} bottom={bottom} />
      {floaters}
    </section>
  );
}

// ── Callouts: Pon, Chi, Kan, Riichi, Ron, Tsumo, big and brief, at the seat that did it ───────────
function CalloutLayer({ callouts, bottom }: { callouts: Callout[]; bottom: SeatIndex }) {
  const sides = seatsBySide(bottom);
  const sideOf = (seat: SeatIndex) => SIDES.find((side) => sides[side] === seat) ?? "bottom";
  return (
    <div className={styles.callouts} aria-live="polite">
      {callouts.map((callout) => (
        <span key={callout.id} className={styles.callout} data-side={sideOf(callout.seat)} data-tone={callout.tone}>
          {callout.text}
        </span>
      ))}
    </div>
  );
}

/** Callouts that expire on their own. Calm mode shortens them and drops the motion (in the CSS). */
export function useCallouts() {
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const counter = useRef(0);
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const live = timers.current;
    return () => {
      live.forEach((timer) => window.clearTimeout(timer));
      live.clear();
    };
  }, []);
  const push = useCallback((seat: SeatIndex, text: string, tone: Callout["tone"]) => {
    counter.current += 1;
    const id = counter.current;
    setCallouts((current) => [...current.slice(-3), { id, seat, text, tone }]);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setCallouts((current) => current.filter((entry) => entry.id !== id));
    }, tone === "win" ? 2200 : 1500);
    timers.current.add(timer);
  }, []);
  return [callouts, push] as const;
}

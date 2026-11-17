"use client";

// The live table drawn as the 3D stage: the canvas (loaded lazily, browser only), the HTML over it
// (nameplates, your plate, callouts, reactions and stamps, the end-of-hand reveal, your tile buttons)
// and a tray under it for your moves. The table page decides when to use it; anything that goes wrong
// with WebGL calls `onFail` and the page falls back to the flat board for the rest of the visit.

import dynamic from "next/dynamic";
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalloutLayer, type Callout } from "@/app/components/games/mahjong/table/board";
import type { SeatStyle } from "@/app/components/games/mahjong/table/seat-portrait";
import { liveStageModel, realSeat, stageSeat, type LiveMoment } from "@/app/components/games/mahjong/stage/live-model";
import { useStageStore, type StageModel } from "@/app/components/games/mahjong/stage/model";
import { Nameplate, SeatHud, StampPop } from "@/app/components/games/mahjong/stage/stage-overlays";
import { kindName, kindOf, tileName, type TileId } from "@/app/lib/games/mahjong/tiles";
import type { GameView, MahjongTable, PublicHand, SeatHand, SeatIndex, StampPose } from "@/app/lib/games/mahjong/types";
import styles from "@/app/components/games/mahjong/stage/stage.module.scss";

const StageCanvas = dynamic(() => import("@/app/components/games/mahjong/stage/stage-canvas"), {
  ssr: false,
  loading: () => <div className={styles.loading}>Setting the table…</div>,
});

let webgl: boolean | null = null;
/** Whether this browser can draw WebGL at all (checked once). */
export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  if (webgl !== null) return webgl;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    webgl = Boolean(context);
    (context as WebGLRenderingContext | null)?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

/** Catches a canvas that fails to load or render and hands the table back. */
class CanvasBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** How long a riichi moment holds the room (the stick drops, the camera leans in and back). */
const RIICHI_MS = 4200;
/** In 3D the reveal card waits while the room turns to the winner. */
const REVEAL_DELAY_MS = 1600;

let momentIds = 0;

/**
 * The big beats, from what changed between two shown states of the same hand: a riichi declared, the
 * hand ending. A reload shows a finished hand as it stands, without the motion.
 */
function useLiveMoment(hand: PublicHand, key: string): LiveMoment | null {
  const [moment, setMoment] = useState<LiveMoment | null>(null);
  const previous = useRef<{ key: string; riichi: number[]; over: boolean } | null>(null);
  useEffect(() => {
    const now = { key, riichi: hand.seats.map((seat) => seat.riichi), over: hand.phase === "over" };
    const before = previous.current;
    previous.current = now;
    const result = hand.phase === "over" ? hand.result : null;
    const ending = (at: number): LiveMoment | null => {
      if (!result) return null;
      if (result.type === "win") {
        const first = result.wins[0];
        return first ? { id: ++momentIds, kind: "win", seat: first.seat, how: first.tsumo ? "tsumo" : "ron", at } : null;
      }
      return { id: ++momentIds, kind: "draw", seat: (result.by ?? 0) as SeatIndex, at };
    };
    if (!before || before.key !== key) {
      // A hand already over on arrival stands as it is (the motion long done).
      setMoment(now.over ? ending(performance.now() - 60_000) : null);
      return;
    }
    if (now.over && !before.over) {
      setMoment(ending(performance.now()));
      return;
    }
    const declared = now.riichi.findIndex((count, seat) => count > before.riichi[seat]);
    if (declared >= 0) {
      const next: LiveMoment = { id: ++momentIds, kind: "riichi", seat: declared as SeatIndex, at: performance.now() };
      setMoment(next);
      const timer = window.setTimeout(() => setMoment((current) => (current?.id === next.id ? null : current)), RIICHI_MS);
      return () => window.clearTimeout(timer);
    }
  }, [hand, key]);
  return moment;
}

/** The overlay (the reveal card), held back a moment in 3D so the room's own reveal plays first. */
function useHeldOverlay(overlay: ReactNode, reduced: boolean): ReactNode {
  const present = Boolean(overlay);
  const [ready, setReady] = useState(false);
  const [was, setWas] = useState(present);
  if (was !== present) {
    setWas(present);
    setReady(false);
  }
  useEffect(() => {
    if (!present || ready) return;
    const timer = window.setTimeout(() => setReady(true), reduced ? 0 : REVEAL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [present, ready, reduced]);
  return present && ready ? overlay : null;
}

/** What the canvas shows, in words, for a screen reader. */
function TableSummary({ model, hand }: { model: StageModel; hand: PublicHand }) {
  const names = (ids: TileId[]) => (ids.length ? ids.map(tileName).join(", ") : "none");
  return (
    <section className={styles.srOnly} aria-label="Table information">
      <p>
        {model.round.label}, {model.round.honba} honba, {model.round.sticks} riichi sticks, {model.wall} tiles left. Dora indicators: {names(model.dora)}.
      </p>
      <ul>
        {model.seats.map((seat, index) => (
          <li key={index}>
            {seat.name}, {seat.wind} seat{seat.dealer ? ", dealer" : ""}, {seat.points.toLocaleString("en-US")} points{seat.riichi ? ", in riichi" : ""}
            {seat.turn ? ", to move" : ""}. {model.hands[index].tiles && index !== 0 ? `Hand shown: ${names(model.hands[index].tiles!)}. ` : ""}
            {model.melds[index].length ? `Calls: ${model.melds[index].map((meld) => meld.tiles.map((id) => kindName(kindOf(id))).join(" ")).join("; ")}. ` : ""}
            Discards: {names(model.ponds[index].map((tile) => tile.id))}.
          </li>
        ))}
      </ul>
      {hand.last_discard ? <p>Last discard: {tileName(hand.last_discard.tile)}.</p> : null}
    </section>
  );
}

export type LiveStageProps = {
  table: MahjongTable;
  game: GameView;
  hand: PublicHand | SeatHand;
  bottom: SeatIndex;
  me: SeatIndex | null;
  seatStyles: SeatStyle[];
  callouts: Callout[];
  /** Talent stamps showing now, by real seat (yours included); `at` sets a repeat apart. */
  stamps?: Record<number, { pose: StampPose; at: number }>;
  floaters?: ReactNode;
  /** Drawn over the stage: the end-of-hand reveal. */
  overlay?: ReactNode;
  /** Your hand's buttons (HandButtons), pinned over your tiles; null when watching. */
  hand3d?: ReactNode;
  /** Under the stage: your moves (on a phone the table page puts them in its sticky dock, see StageTray). */
  tray?: ReactNode;
  day: boolean;
  reduced: boolean;
  onFail: () => void;
};

export function LiveStage({ table, game, hand, bottom, me, seatStyles, callouts, stamps, floaters, overlay, hand3d, tray, day, reduced, onFail }: LiveStageProps) {
  const key = `${table.id}:${game.hand_index}`;
  const moment = useLiveMoment(hand, key);
  const colorKey = seatStyles.map((style) => style.color).join("|");
  const model = useMemo(() => liveStageModel({ table, game, hand, bottom, me, colors: colorKey.split("|"), moment }), [table, game, hand, bottom, me, colorKey, moment]);

  const setModel = useStageStore((s) => s.setModel);
  const setUi = useStageStore((s) => s.setUi);
  const reset = useStageStore((s) => s.reset);
  useLayoutEffect(() => setModel(model), [model, setModel]);
  useLayoutEffect(() => setUi({ reduced }), [reduced, setUi]);
  useEffect(() => reset, [reset]);
  const held = useHeldOverlay(overlay, reduced);
  const shown = Object.entries(stamps ?? {}).map(([real, stamp]) => ({ seat: stageSeat(Number(real), bottom), ...stamp }));

  return (
    <div className={styles.live}>
      <div className={`${styles.stage} ${styles.liveStage}`} data-day={day || undefined} aria-label="Table">
        <CanvasBoundary onFail={onFail}>
          <StageCanvas day={day} onLost={onFail} />
        </CanvasBoundary>
        <div className={styles.overlays}>
          {[1, 2, 3].map((seat) => (
            <Nameplate key={realSeat(seat, bottom)} seat={seat} />
          ))}
        </div>
        <SeatHud you={me !== null} />
        <TableSummary model={model} hand={hand} />
        <CalloutLayer callouts={callouts} bottom={bottom} />
        {shown.map((stamp) => (
          <StampPop key={`${stamp.seat}-${stamp.at}`} seat={stamp.seat} pose={stamp.pose} />
        ))}
        {floaters}
        {hand3d}
        {held}
      </div>
      {tray ? <StageTray>{tray}</StageTray> : null}
    </div>
  );
}

/**
 * The tray of moves under the stage. `docked` is the copy a phone keeps in the table page's sticky
 * dock, so the call buttons stay above the site's bottom bar however the page is scrolled.
 */
export function StageTray({ docked, children }: { docked?: boolean; children: ReactNode }) {
  return (
    <div className={styles.tray} data-docked={docked || undefined}>
      {children}
    </div>
  );
}

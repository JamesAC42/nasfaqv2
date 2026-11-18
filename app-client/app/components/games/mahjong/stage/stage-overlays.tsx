"use client";

// The HTML that sits over the canvas, shared by the live table and the dev mock: the opponents'
// nameplates pinned to the rim in front of them, your own plate in the corner, and the talent stamps
// players send. They read the stage model, so they show the same seat the scene does.

import type { CSSProperties } from "react";
import { ReactionFace } from "@/app/components/common/reaction-face";
import { anchorKey, registerOverlay } from "@/app/components/games/mahjong/stage/overlay";
import { useStageStore, type StageSeat } from "@/app/components/games/mahjong/stage/model";
import type { StampPose } from "@/app/lib/games/mahjong/types";
import { useRemaining } from "@/app/lib/games/use-remaining";
import styles from "@/app/components/games/mahjong/stage/stage.module.scss";

const fmt = (value: number) => value.toLocaleString("en-US");

export function Sparkline({ line, color }: { line: number[]; color: string }) {
  if (line.length < 2) return <svg className={styles.spark} viewBox="0 0 56 20" aria-hidden="true" />;
  const lo = Math.min(...line) - 500;
  const hi = Math.max(...line) + 500;
  const pts = line.map((v, i) => `${((i / Math.max(1, line.length - 1)) * 56).toFixed(1)},${(18 - ((v - lo) / (hi - lo)) * 16).toFixed(1)}`);
  const last = line[line.length - 1];
  const prev = line[line.length - 2] ?? last;
  const tone = last > prev ? "var(--up)" : last < prev ? "var(--down)" : color;
  return (
    <svg className={styles.spark} viewBox="0 0 56 20" aria-hidden="true">
      <polyline points={pts.slice(0, -1).join(" ")} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <polyline key={line.length} className={styles.sparkTail} points={pts.slice(-2).join(" ")} fill="none" stroke={tone} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function SeatClock({ deadline }: { deadline: number }) {
  const left = useRemaining(deadline, 250);
  if (left === null) return null;
  return (
    <span className={styles.plateClock} data-urgent={left <= 5000 || undefined} role="timer">
      {Math.ceil(left / 1000)}s
    </span>
  );
}

function PlateBody({ seat, you }: { seat: StageSeat; you?: boolean }) {
  return (
    <>
      <span className={styles.plateWind} data-dealer={seat.dealer || undefined} title={seat.dealer ? "Dealer" : undefined}>
        {seat.wind}
      </span>
      <span className={styles.plateName} title={seat.name}>
        {you ? "You" : seat.name}
      </span>
      <span className={styles.platePts}>{fmt(seat.points)}</span>
      <Sparkline line={seat.history} color={seat.color} />
      {seat.riichi ? <span className={styles.plateRiichi}>Riichi</span> : null}
      {seat.tag ? <span className={styles.plateTag}>{seat.tag}</span> : null}
      {seat.deadline ? <SeatClock deadline={seat.deadline} /> : null}
    </>
  );
}

/** An opponent's plate, pinned to the rim in front of them (the canvas moves it). */
export function Nameplate({ seat }: { seat: number }) {
  const info = useStageStore((s) => s.model.seats[seat]);
  if (!info) return null;
  return (
    <div className={styles.pin} ref={(el) => registerOverlay(anchorKey("plate", seat), el)}>
      <div className={styles.plate} data-seat={seat} data-turn={info.turn || undefined} style={{ "--seat": info.color } as CSSProperties}>
        <PlateBody seat={info} />
      </div>
    </div>
  );
}

/** The bottom seat's plate, in the stage's top-left corner. */
export function SeatHud({ you, children }: { you: boolean; children?: React.ReactNode }) {
  const info = useStageStore((s) => s.model.seats[0]);
  if (!info) return null;
  return (
    <div className={styles.hudTop} data-turn={info.turn || undefined} style={{ "--seat": info.color } as CSSProperties}>
      <PlateBody seat={info} you={you} />
      {children}
    </div>
  );
}

/**
 * A talent stamp, popping up for as long as the table shows it: an opponent's out of their nameplate
 * and over it, yours on the felt in front of you, so you see what you sent too. The scene's portraits
 * have no stamp poses, so this is the only place a stamp shows on the stage.
 */
export function StampPop({ seat, pose }: { seat: number; pose: StampPose }) {
  const info = useStageStore((s) => s.model.seats[seat]);
  const reduced = useStageStore((s) => s.ui.reduced);
  if (!info?.symbol) return null;
  return (
    <div className={`${styles.pin} ${styles.stampPin}`} ref={(el) => registerOverlay(anchorKey("stamp", seat), el)}>
      <span className={styles.stampPop} data-you={seat === 0 || undefined} data-reduced={reduced || undefined} style={{ "--seat": info.color } as CSSProperties}>
        <span className={styles.stampFace}>
          <ReactionFace symbol={info.symbol} pose={pose} size={112} crop="full" />
        </span>
      </span>
    </div>
  );
}

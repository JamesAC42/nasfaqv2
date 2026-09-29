"use client";

import { useRemaining } from "@/app/lib/games/use-remaining";
import styles from "@/app/components/games/shared/timer-bar.module.scss";

/** A draining bar plus seconds for a table deadline. Turns amber in the last 5 seconds. */
export function TimerBar({ deadline, totalMs, label }: { deadline: number | null | undefined; totalMs: number; label?: string }) {
  const left = useRemaining(deadline, 100);
  if (left === null) return null;
  const pct = Math.max(0, Math.min(1, left / totalMs));
  const secs = Math.ceil(left / 1000);
  return (
    <div className={styles.timer} data-urgent={left <= 5000 || undefined} role="timer" aria-label={`${label ?? "Time left"}: ${secs} seconds`}>
      <span className={styles.track}>
        <i style={{ transform: `scaleX(${pct})` }} />
      </span>
      <b>{secs}s</b>
    </div>
  );
}

"use client";

import type { CSSProperties, ReactNode } from "react";
import { fmtInteger } from "@/app/lib/format";
import styles from "@/app/components/games/gacha/gacha-parts.module.scss";

// Small pieces shared by the card gacha and the capsule machine.

type PityBarProps = {
  label: string;
  /** Pulls until the guarantee. */
  left: number | null;
  /** Pulls done toward it. */
  done: number | null;
  total: number;
  color: string;
  /** Where soft pity starts, in pulls (draws a tick). */
  softFrom?: number;
  /** Soft pity is raising the rate right now. */
  hot?: boolean;
  note?: ReactNode;
};

export function PityBar({ label, left, done, total, color, softFrom, hot = false, note }: PityBarProps) {
  const pct = done === null ? 0 : Math.max(0, Math.min(100, (done / total) * 100));
  return (
    <div className={styles.pity} data-hot={hot || undefined} style={{ "--c": color } as CSSProperties}>
      <div className={styles.pityHead}>
        <span>{label}</span>
        <b>
          {left === null ? "—" : fmtInteger(left)}
          <small>{left === 1 ? " pull" : " pulls"}</small>
        </b>
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done ?? 0}
        aria-valuetext={left === null ? undefined : `${left} pulls to go`}
      >
        <span className={styles.fill} style={{ width: `${pct}%` }} />
        {softFrom ? <span className={styles.tick} style={{ left: `${(softFrom / total) * 100}%` }} title={`Soft pity from pull ${softFrom}`} /> : null}
      </div>
      <div className={styles.pityFoot}>
        <span>
          {done === null ? "—" : fmtInteger(done)}/{total}
        </span>
        {note ? <span className={styles.note}>{note}</span> : null}
      </div>
    </div>
  );
}

/** "3d 05:12:44" / "05:12:44" from a millisecond count. */
export function fmtCountdown(ms: number | null) {
  if (ms === null) return "—";
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const clock = [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
  return days > 0 ? `${days}d ${clock}` : clock;
}

/** Short form for tabs: "3d 5h" / "5h 12m" / "12m". */
export function fmtLeft(ms: number | null) {
  if (ms === null) return "";
  const minutes = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/** The shard glyph used next to shard counts. */
export function ShardGlyph() {
  return <i className={styles.shard} aria-hidden="true" />;
}

type PullButtonProps = {
  count: 1 | 10;
  cost: number | null;
  busy: boolean;
  disabled?: boolean;
  onClick: () => void;
  primary?: boolean;
};

/** "PULL ×10 · $900" */
export function PullButton({ count, cost, busy, disabled = false, onClick, primary = false }: PullButtonProps) {
  return (
    <button type="button" className={primary ? styles.pullPrimary : styles.pullSecondary} onClick={onClick} disabled={disabled || busy || cost === null} aria-busy={busy || undefined}>
      <span className={styles.pullLabel}>{busy ? "Pulling…" : `PULL ×${count}`}</span>
      <span className={styles.pullCost}>· ${cost === null ? "—" : fmtInteger(cost)}</span>
    </button>
  );
}

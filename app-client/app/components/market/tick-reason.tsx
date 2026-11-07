import type { IconType } from "react-icons";
import { FaArrowRightArrowLeft, FaCirclePlay, FaEye, FaMoon, FaShuffle, FaTowerBroadcast, FaUserPlus } from "react-icons/fa6";
import type { TickReason } from "@/app/lib/types";
import styles from "@/app/components/market/tick-reason.module.scss";

// Why a tick moved a stock, as the API wrote it when the tick landed (api/src/services/tickDrivers.js).
// The wording only ever explains the tick that happened, from public numbers, so it is shown as is.

const KINDS: Record<string, { icon: IconType; label: string }> = {
  subs: { icon: FaUserPlus, label: "Subscribers" },
  views: { icon: FaEye, label: "Views" },
  uploads: { icon: FaCirclePlay, label: "Uploads" },
  quiet: { icon: FaMoon, label: "Quiet channel" },
  stream: { icon: FaTowerBroadcast, label: "Big stream" },
  players: { icon: FaArrowRightArrowLeft, label: "Player trading" },
  mixed: { icon: FaShuffle, label: "No standout driver" },
};

export const tickReasonLabel = (kind: string) => KINDS[kind]?.label ?? "Driver";

/**
 * A tick's reasons: the full lines, or (`compact`) the short label of the first, for tables. The
 * hover title carries the full line and any detail ("170 shares net bought since the Open tick").
 */
export function TickReasons({ reasons, max = 2, compact = false, className }: { reasons?: TickReason[] | null; max?: number; compact?: boolean; className?: string }) {
  if (!reasons?.length) return null;
  const shown = compact ? reasons.slice(0, 1) : reasons.slice(0, max);
  return (
    <span className={[styles.reasons, compact ? styles.compact : null, className].filter(Boolean).join(" ")}>
      {shown.map((reason) => {
        const kind = KINDS[reason.kind] ?? KINDS.mixed;
        const Icon = kind.icon;
        const title = [compact ? reason.text : null, reason.detail].filter(Boolean).join(" · ") || undefined;
        return (
          <span key={`${reason.kind}-${reason.text}`} className={styles.reason} data-kind={reason.kind} title={title}>
            <Icon className={styles.icon} aria-label={kind.label} />
            <span className={styles.text}>{compact ? reason.short : reason.text}</span>
          </span>
        );
      })}
    </span>
  );
}

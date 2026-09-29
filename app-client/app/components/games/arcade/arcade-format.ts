/** "3d 14h", "5h 12m", "12m 30s", "40s". */
export function fmtLeft(ms: number | null | undefined) {
  if (ms === null || ms === undefined) return "—";
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/** "now", "40s", "12m", "3h", "2d". */
export function fmtAgo(iso: string | number, now = Date.now()) {
  const then = typeof iso === "number" ? iso : new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 10) return "now";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/** Whole dollars without cents when there are none: $500, $1,250, $12.50. */
export function fmtCash(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const whole = Math.abs(value) >= 1000 || Number.isInteger(value);
  const text = new Intl.NumberFormat("en-US", { maximumFractionDigits: whole ? 0 : 2, minimumFractionDigits: whole ? 0 : 2 }).format(Math.abs(value));
  return `${value < 0 ? "-" : ""}$${text}`;
}

export function fmtStake(stake: number) {
  return stake > 0 ? fmtCash(stake) : "Friendly";
}
